use std::num::NonZeroUsize;
use std::sync::LazyLock;

use base64::Engine;
use lru::LruCache;
use regex::Regex;
use reqwest::multipart;
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    models::{GlossaryTerm, RuntimeConfig},
};

const CHAT_ASR_SYSTEM_PROMPT: &str = "You are a speech-to-text engine. Transcribe the input audio in the requested source language. Return only the transcript text. Do not translate. Do not explain. If the audio has no intelligible speech, return an empty string.";
const WHISPER_HALLUCINATIONS: &[&str] = &[
    "thank you",
    "thanks for watching",
    "subscribe",
    "please subscribe",
    "like and subscribe",
    "please like",
    "thank you for watching",
    "thank you for listening",
    "bye",
    "goodbye",
    "see you",
    "see you next time",
    "if you enjoyed",
    "don't forget to",
    "welcome back",
    "hello everyone",
    "[music]",
    "[applause]",
    "[laughter]",
    "you",
    "um",
    "uh",
    "ah",
    "hmm",
];

// Precompiled static regexes — compiled once instead of per-call.
static RE_THINK_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\x{3c}think\x{3e}.*?\x{3c}/think\x{3e}").unwrap());
static RE_CODE_FENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*```(?:\w+)?\s*|\s*```\s*$").unwrap());
static RE_ROLE_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(?:assistant|user|system|translation|answer)\s*[:\u{ff1a}]\s*").unwrap()
});
static RE_PROMPT_ECHO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*(?:previous\s+context|context)\s*:").unwrap());
static RE_HTML_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").unwrap());
static RE_LEADING_THINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*think>\s*").unwrap());
static RE_LEADING_THINK_WORD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*think\s+").unwrap());
static RE_NUMERIC_NOISE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*[\d\W_]+p?\.?\s*$").unwrap());
static RE_SHORT_MARKER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z]$").unwrap());
static RE_LATIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[A-Za-z]").unwrap());
static RE_CJK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\u{4e00}-\u{9fff}]").unwrap());

#[derive(Clone)]
pub struct AsrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
    language: String,
    format: String,
}

impl AsrClient {
    pub fn from_config(config: &RuntimeConfig) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: config.effective_asr_base_url(),
            api_key: config.effective_asr_api_key(),
            model: config.asr_model.clone(),
            language: config.asr_language.clone(),
            format: config.asr_format.clone(),
        }
    }

    pub async fn test_models_endpoint(&self) -> AppResult<()> {
        if self.base_url.is_empty() {
            return Err(AppError::Config("ASR Base URL is required.".into()));
        }
        if self.api_key.is_empty() {
            return Err(AppError::Config("ASR API Key is required.".into()));
        }
        if self.model.trim().is_empty() {
            return Err(AppError::Config("ASR model is required.".into()));
        }
        self.http
            .get(format!("{}/models", self.base_url))
            .bearer_auth(&self.api_key)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn transcribe(&self, wav: Vec<u8>, prompt: Option<&str>) -> AppResult<String> {
        let raw = if self.format == "chat-completions" {
            self.transcribe_chat(wav, prompt).await
        } else {
            self.transcribe_whisper(wav, prompt).await
        }?;
        Ok(sanitize_asr_text(&raw, &self.language).text)
    }

    async fn transcribe_whisper(&self, wav: Vec<u8>, prompt: Option<&str>) -> AppResult<String> {
        let part = multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| AppError::InvalidApiResponse(e.to_string()))?;
        let mut form = multipart::Form::new()
            .text("model", self.model.clone())
            .text("language", self.language.clone())
            .part("file", part);
        if let Some(p) = prompt.filter(|p| !p.is_empty()) {
            form = form.text("prompt", p.to_string());
        }
        let response = self
            .http
            .post(format!("{}/audio/transcriptions", self.base_url))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?
            .error_for_status()?;
        let body = response.json::<WhisperResponse>().await?;
        Ok(body.text.trim().to_string())
    }

    async fn transcribe_chat(&self, wav: Vec<u8>, prompt: Option<&str>) -> AppResult<String> {
        let audio = base64::engine::general_purpose::STANDARD.encode(wav);
        let system_content = if let Some(p) = prompt.filter(|p| !p.is_empty()) {
            format!("{CHAT_ASR_SYSTEM_PROMPT}\n\nPrevious context: {p}")
        } else {
            CHAT_ASR_SYSTEM_PROMPT.to_string()
        };
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system_content },
                {
                    "role": "user",
                    "content": [{
                        "type": "input_audio",
                        "input_audio": {
                            "data": format!("data:audio/wav;base64,{audio}")
                        }
                    }]
                }
            ],
            "asr_options": { "language": self.language }
        });
        let response = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        parse_chat_text(response.json::<ChatResponse>().await?)
    }
}

pub struct TranslationClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
    cache: LruCache<String, String>,
}

impl TranslationClient {
    pub fn from_config(config: &RuntimeConfig) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: config.base_url.clone(),
            api_key: config.api_key.clone(),
            model: config.translation_model.clone(),
            cache: LruCache::new(NonZeroUsize::new(128).unwrap()),
        }
    }

    pub async fn test(&mut self) -> AppResult<String> {
        self.translate("Hello world", "en", "zh-CN", &[], &[]).await
    }

    pub async fn translate(
        &mut self,
        source_text: &str,
        source_lang: &str,
        target_lang: &str,
        glossary_terms: &[GlossaryTerm],
        context: &[(String, String)],
    ) -> AppResult<String> {
        if self.base_url.is_empty() {
            return Err(AppError::Config("Translation Base URL is required.".into()));
        }
        if self.api_key.is_empty() {
            return Err(AppError::Config("Translation API Key is required.".into()));
        }
        if self.model.trim().is_empty() {
            return Err(AppError::Config("Translation model is required.".into()));
        }

        let key = normalize_cache_key(source_lang, target_lang, source_text);
        if let Some(value) = self.cache.get(&key) {
            return Ok(value.clone());
        }

        let matched = matched_glossary_terms(source_text, context, glossary_terms);
        let mut system = translation_system_prompt(source_lang, target_lang);
        if !matched.is_empty() {
            system.push_str("\n\nGlossary (apply these translations exactly):\n");
            system.push_str(
                &serde_json::to_string(&matched)
                    .map_err(|e| AppError::InvalidApiResponse(e.to_string()))?,
            );
        }

        let context_payload = bounded_context_payload(source_text, context);

        let user = if context_payload.is_empty() {
            format!("Translate from {source_lang} to {target_lang}:\n\n{source_text}")
        } else {
            format!(
                "Recent confirmed context. Do not retranslate these lines:\n{}\n\nTranslate from {source_lang} to {target_lang}:\n\n{source_text}",
                serde_json::to_string(&context_payload).unwrap_or_default()
            )
        };

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ],
            "temperature": 0,
            "max_tokens": 256
        });
        let response = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        let mut translated = parse_chat_text(response.json::<ChatResponse>().await?)?;
        translated = clean_translation_text(&translated);
        translated = enforce_glossary(&translated, &matched);
        self.cache.put(key, translated.clone());
        Ok(translated)
    }

    /// Streaming translation: POST with `stream: true`, parse SSE tokens,
    /// send each token chunk through the channel. Returns the full cleaned text.
    pub async fn translate_streaming(
        &mut self,
        source_text: &str,
        source_lang: &str,
        target_lang: &str,
        glossary_terms: &[GlossaryTerm],
        context: &[(String, String)],
        token_tx: Option<tokio::sync::mpsc::Sender<String>>,
    ) -> AppResult<String> {
        if self.base_url.is_empty() {
            return Err(AppError::Config("Translation Base URL is required.".into()));
        }
        if self.api_key.is_empty() {
            return Err(AppError::Config("Translation API Key is required.".into()));
        }
        if self.model.trim().is_empty() {
            return Err(AppError::Config("Translation model is required.".into()));
        }

        let key = normalize_cache_key(source_lang, target_lang, source_text);
        if let Some(value) = self.cache.get(&key) {
            if let Some(tx) = &token_tx {
                let _ = tx.send(value.clone()).await;
            }
            return Ok(value.clone());
        }

        let matched = matched_glossary_terms(source_text, context, glossary_terms);
        let mut system = translation_system_prompt(source_lang, target_lang);
        if !matched.is_empty() {
            system.push_str("\n\nGlossary (apply these translations exactly):\n");
            system.push_str(
                &serde_json::to_string(&matched)
                    .map_err(|e| AppError::InvalidApiResponse(e.to_string()))?,
            );
        }

        let context_payload = bounded_context_payload(source_text, context);
        let user = if context_payload.is_empty() {
            format!("Translate from {source_lang} to {target_lang}:\n\n{source_text}")
        } else {
            format!(
                "Recent confirmed context. Do not retranslate these lines:\n{}\n\nTranslate from {source_lang} to {target_lang}:\n\n{source_text}",
                serde_json::to_string(&context_payload).unwrap_or_default()
            )
        };

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ],
            "temperature": 0,
            "max_tokens": 256,
            "stream": true
        });

        use futures::StreamExt;
        let response = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let mut stream = response.bytes_stream();
        let mut accumulated = String::new();
        let mut line_buf = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(AppError::Http)?;
            let text = std::str::from_utf8(&bytes).unwrap_or("");

            for ch in text.chars() {
                line_buf.push(ch);
                if ch == '\n' {
                    let line = line_buf.trim().to_string();
                    line_buf.clear();

                    // SSE format: "data: {...}" or "data: [DONE]"
                    if let Some(json_str) = line.strip_prefix("data:") {
                        let json_str = json_str.trim();
                        if json_str == "[DONE]" {
                            continue;
                        }
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if let Some(delta) = val.pointer("/choices/0/delta/content") {
                                if let Some(token) = delta.as_str() {
                                    if !token.is_empty() {
                                        accumulated.push_str(token);
                                        if let Some(tx) = &token_tx {
                                            let _ = tx.send(token.to_string()).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut translated = clean_translation_text(&accumulated);
        translated = enforce_glossary(&translated, &matched);
        self.cache.put(key, translated.clone());
        Ok(translated)
    }
}

pub fn encode_wav(samples: &[i16], channels: u16, sample_rate: u32) -> Vec<u8> {
    let data_size = samples.len() * 2;
    let byte_rate = sample_rate * channels as u32 * 2;
    let block_align = channels * 2;
    let mut out = Vec::with_capacity(44 + data_size);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_size as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_size as u32).to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Target sample rate for ASR (Whisper expects 16 kHz).
const ASR_TARGET_RATE: u32 = 16_000;

/// Convert audio to mono and downsample for ASR.
///
/// - Stereo → mono: averages L+R channels (via i32 to avoid overflow).
/// - Downsample: block-average decimation to `ASR_TARGET_RATE`.
///
/// Returns `(samples, channels, sample_rate)` — caller passes to `encode_wav`.
pub fn prepare_for_asr(samples: &[i16], channels: u16, sample_rate: u32) -> (Vec<i16>, u16, u32) {
    // Fast path: already mono 16 kHz.
    if channels == 1 && sample_rate == ASR_TARGET_RATE {
        return (samples.to_vec(), channels, sample_rate);
    }

    // Stereo → mono.
    let (mono, _channels) = if channels == 2 && samples.len() >= 2 {
        let mono: Vec<i16> = samples
            .chunks_exact(2)
            .map(|pair| ((pair[0] as i32 + pair[1] as i32) / 2) as i16)
            .collect();
        (mono, 1u16)
    } else {
        (samples.to_vec(), channels)
    };

    // Downsample via block-average decimation.
    if sample_rate > ASR_TARGET_RATE && !mono.is_empty() {
        let ratio = (sample_rate / ASR_TARGET_RATE) as usize;
        if ratio > 1 && mono.len() >= ratio {
            let trim_len = (mono.len() / ratio) * ratio;
            let downsampled: Vec<i16> = mono[..trim_len]
                .chunks_exact(ratio)
                .map(|block| {
                    let sum: i32 = block.iter().map(|&s| s as i32).sum();
                    (sum / ratio as i32) as i16
                })
                .collect();
            return (downsampled, 1, ASR_TARGET_RATE);
        }
    }

    (mono, 1, sample_rate)
}

#[derive(Deserialize)]
struct WhisperResponse {
    text: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

fn parse_chat_text(response: ChatResponse) -> AppResult<String> {
    response
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_ref())
        .map(|text| text.trim().to_string())
        .ok_or_else(|| AppError::InvalidApiResponse("missing chat completion content".into()))
}

/// Cache key includes language pair to prevent cross-language cache hits.
fn normalize_cache_key(source_lang: &str, target_lang: &str, text: &str) -> String {
    let normalized = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    format!("{source_lang}:{target_lang}:{normalized}")
}

fn matched_glossary_terms(
    source_text: &str,
    context: &[(String, String)],
    terms: &[GlossaryTerm],
) -> Vec<GlossaryTerm> {
    let mut haystack = source_text.to_lowercase();
    for (source, _) in context {
        haystack.push(' ');
        haystack.push_str(&source.to_lowercase());
    }
    terms
        .iter()
        .filter(|term| {
            term.enabled
                && !term.source.trim().is_empty()
                && haystack.contains(&term.source.to_lowercase())
        })
        .cloned()
        .collect()
}

fn translation_system_prompt(source_lang: &str, target_lang: &str) -> String {
    format!(
        "You are a professional simultaneous interpreter. Translate speech subtitles from {source_lang} to {target_lang}.\n\nRules:\n- Use natural spoken language in the target language, not written/formal style\n- Keep translation concise\n- Preserve technical terminology exactly as specified in the glossary\n- For partial or fragmented input, translate the fragment as-is without adding missing words\n- Never translate literally word-by-word; produce natural target-language phrasing\n- Only output the translation, no explanations or notes"
    )
}

fn bounded_context_payload(
    source_text: &str,
    context: &[(String, String)],
) -> Vec<serde_json::Value> {
    let mut total_chars = source_text.len();
    let mut selected = Vec::new();
    for (source, translation) in context.iter().rev().take(4) {
        let item_chars = source.len() + translation.len();
        if total_chars + item_chars > 2400 {
            break;
        }
        total_chars += item_chars;
        selected.push(serde_json::json!({ "source": source, "translation": translation }));
    }
    selected.reverse();
    selected
}

fn clean_translation_text(text: &str) -> String {
    let mut value = RE_THINK_BLOCK.replace_all(text, " ").to_string();
    value = RE_CODE_FENCE.replace_all(&value, "").to_string();
    value = value.replace("```", " ");
    for _ in 0..3 {
        let stripped = RE_ROLE_PREFIX.replace(&value, "").to_string();
        if stripped == value {
            break;
        }
        value = stripped;
    }
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['"', '\''])
        .to_string()
}

fn enforce_glossary(translated: &str, terms: &[GlossaryTerm]) -> String {
    let mut value = translated.to_string();
    for term in terms {
        if term.source.trim().is_empty() || term.target.trim().is_empty() {
            continue;
        }
        let pattern = Regex::new(&format!("(?i){}", regex::escape(&term.source))).unwrap();
        // Use literal replacement: term.target may contain "$0" or "${name}"
        // which would trigger capture-group expansion in Regex::replace.
        let literal = regex::NoExpand(&term.target);
        value = pattern.replace(&value, literal).to_string();
    }
    value
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SanitizedAsrText {
    text: String,
    reject_reason: Option<&'static str>,
}

fn sanitize_asr_text(raw_text: &str, source_lang: &str) -> SanitizedAsrText {
    let mut text = raw_text.trim().to_string();
    if text.is_empty() {
        return rejected("empty");
    }

    if RE_PROMPT_ECHO.is_match(&text) {
        return rejected("prompt_echo");
    }

    text = RE_THINK_BLOCK.replace_all(&text, " ").to_string();
    text = text.replace("```", " ");
    text = RE_HTML_TAG.replace_all(&text, " ").to_string();
    text = RE_LEADING_THINK.replace(&text, "").to_string();
    text = RE_LEADING_THINK_WORD.replace(&text, "").to_string();
    for _ in 0..3 {
        let stripped = RE_ROLE_PREFIX.replace(&text, "").to_string();
        if stripped == text {
            break;
        }
        text = stripped;
    }
    text = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['"', '\''])
        .to_string();

    if text.is_empty() {
        return rejected("empty_after_cleanup");
    }
    if RE_PROMPT_ECHO.is_match(&text) {
        return rejected("prompt_echo");
    }
    if RE_NUMERIC_NOISE.is_match(&text)
        || RE_SHORT_MARKER.is_match(&text)
        || !text.chars().any(char::is_alphabetic)
    {
        return rejected("numeric_or_symbol_noise");
    }
    let lower = text.to_lowercase();
    let normalized = lower.trim_matches(['.', ',', '!', '?', ';', ':']).trim();
    if WHISPER_HALLUCINATIONS.contains(&normalized) {
        return rejected("whisper_hallucination");
    }
    let latin_count = RE_LATIN.find_iter(&text).count();
    let cjk_count = RE_CJK.find_iter(&text).count();
    if source_lang.to_lowercase().starts_with("en") && cjk_count > 0 && latin_count == 0 {
        return rejected("target_language_output");
    }
    SanitizedAsrText {
        text,
        reject_reason: None,
    }
}

fn rejected(reason: &'static str) -> SanitizedAsrText {
    SanitizedAsrText {
        text: String::new(),
        reject_reason: Some(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_has_riff_header() {
        let wav = encode_wav(&[0, 100, -100], 1, 16_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 50);
    }

    #[test]
    fn translation_cleanup_removes_roles_and_fences() {
        assert_eq!(
            clean_translation_text("assistant: ```translated```"),
            "translated"
        );
        assert_eq!(
            clean_translation_text("<think>reasoning</think>answer"),
            "answer"
        );
    }

    #[test]
    fn asr_sanitizer_removes_protocol_noise() {
        assert_eq!(
            sanitize_asr_text("<think>x</think> Final answer.", "en").text,
            "Final answer."
        );
        assert_eq!(
            sanitize_asr_text("assistant: The answer is yes.", "en").text,
            "The answer is yes."
        );
        assert_eq!(
            sanitize_asr_text("Previous context: ignored", "en").reject_reason,
            Some("prompt_echo")
        );
    }

    #[test]
    fn asr_sanitizer_rejects_noise_and_hallucinations() {
        assert_eq!(
            sanitize_asr_text("1.", "en").reject_reason,
            Some("numeric_or_symbol_noise")
        );
        assert_eq!(
            sanitize_asr_text("a", "en").reject_reason,
            Some("numeric_or_symbol_noise")
        );
        assert_eq!(
            sanitize_asr_text("Thanks for watching!", "en").reject_reason,
            Some("whisper_hallucination")
        );
        assert_eq!(
            sanitize_asr_text("\u{4f60}\u{597d}", "en").reject_reason,
            Some("target_language_output")
        );
    }

    #[test]
    fn glossary_matching_uses_context_and_skips_disabled_terms() {
        let terms = vec![
            GlossaryTerm {
                id: "1".into(),
                source: "edge computing".into(),
                target: "edge".into(),
                domain: None,
                enabled: true,
            },
            GlossaryTerm {
                id: "2".into(),
                source: "disabled".into(),
                target: "disabled".into(),
                domain: None,
                enabled: false,
            },
        ];
        let context = vec![("Edge computing is growing.".into(), "context".into())];
        let matched = matched_glossary_terms("Servers are close.", &context, &terms);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].source, "edge computing");
    }

    #[test]
    fn glossary_enforcement_is_case_insensitive() {
        let terms = vec![GlossaryTerm {
            id: "1".into(),
            source: "Vector Database".into(),
            target: "vector-db".into(),
            domain: None,
            enabled: true,
        }];
        assert_eq!(
            enforce_glossary("Using vector database.", &terms),
            "Using vector-db."
        );
    }

    #[test]
    fn cache_key_normalizes_case_and_whitespace() {
        assert_eq!(
            normalize_cache_key("en", "zh-CN", "  Hello   World  "),
            "en:zh-CN:hello world"
        );
    }

    #[test]
    fn glossary_replacement_is_literal_not_capture_group() {
        let terms = vec![GlossaryTerm {
            id: "1".into(),
            source: "foo".into(),
            target: "$0".into(),
            domain: None,
            enabled: true,
        }];
        // If $0 were treated as a capture group, the result would be "foo" (the
        // matched text). With NoExpand it must be the literal "$0".
        assert_eq!(enforce_glossary("say foo here", &terms), "say $0 here");
    }

    #[test]
    fn cache_key_includes_language_pair() {
        let key_en_zh = normalize_cache_key("en", "zh-CN", "hello world");
        let key_en_ja = normalize_cache_key("en", "ja", "hello world");
        assert_ne!(key_en_zh, key_en_ja);
    }
}
