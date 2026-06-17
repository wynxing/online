pub mod hallucinations;
pub mod retry;

use std::num::NonZeroUsize;
use std::sync::LazyLock;
use std::time::Duration;

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

// HTTP client timeout configuration (aligns with Python httpx settings).
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const HTTP_READ_TIMEOUT: Duration = Duration::from_secs(12);
const HTTP_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const ASR_POOL_MAX_IDLE: usize = 8;
const TRANSLATION_POOL_MAX_IDLE: usize = 10;

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
static RE_CYRILLIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Cyrillic}").unwrap());
static RE_HANGUL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Hangul}").unwrap());
static RE_HIRAGANA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Hiragana}").unwrap());
static RE_KATAKANA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Katakana}").unwrap());
static RE_LEADING_LINE_NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*\d{1,3}\s*[.)\]:]\s*").unwrap());

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
            http: reqwest::Client::builder()
                .connect_timeout(HTTP_CONNECT_TIMEOUT)
                .read_timeout(HTTP_READ_TIMEOUT)
                .timeout(HTTP_TOTAL_TIMEOUT)
                .pool_max_idle_per_host(ASR_POOL_MAX_IDLE)
                .build()
                .expect("Failed to build ASR HTTP client"),
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
        let format = self.format.clone();
        let this = self.clone();
        let prompt_owned = prompt.map(|s| s.to_string());
        let wav = std::sync::Arc::new(wav);
        let raw = retry::with_retry(move || {
            let f = format.clone();
            let p = prompt_owned.clone();
            let this = this.clone();
            let wav = std::sync::Arc::clone(&wav);
            async move {
                if f == "chat-completions" {
                    this.transcribe_chat(&wav, p.as_deref()).await
                } else {
                    this.transcribe_whisper(&wav, p.as_deref()).await
                }
            }
        })
        .await?;
        Ok(sanitize_asr_text(&raw, &self.language).text)
    }

    async fn transcribe_whisper(&self, wav: &[u8], prompt: Option<&str>) -> AppResult<String> {
        let part = multipart::Part::bytes(wav.to_vec())
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

    async fn transcribe_chat(&self, wav: &[u8], prompt: Option<&str>) -> AppResult<String> {
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
    cache: tokio::sync::Mutex<LruCache<String, String>>,
}

impl TranslationClient {
    pub fn from_config(config: &RuntimeConfig) -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(HTTP_CONNECT_TIMEOUT)
                .read_timeout(HTTP_READ_TIMEOUT)
                .timeout(HTTP_TOTAL_TIMEOUT)
                .pool_max_idle_per_host(TRANSLATION_POOL_MAX_IDLE)
                .build()
                .expect("Failed to build translation HTTP client"),
            base_url: config.base_url.clone(),
            api_key: config.api_key.clone(),
            model: config.translation_model.clone(),
            cache: tokio::sync::Mutex::new(LruCache::new(NonZeroUsize::new(512).unwrap())),
        }
    }

    pub async fn test(&self) -> AppResult<String> {
        self.translate("Hello world", "en", "zh-CN", &[], &[]).await
    }

    pub async fn translate(
        &self,
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
        {
            let mut cache = self.cache.lock().await;
            if let Some(value) = cache.get(&key) {
                return Ok(value.clone());
            }
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
                "Below are previously translated lines for reference only. DO NOT retranslate them. DO NOT include numbers or prefixes in your output:\n{}\n\nTranslate ONLY the following text from {source_lang} to {target_lang}:\n\n{source_text}",
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
        let http = self.http.clone();
        let url = format!("{}/chat/completions", self.base_url);
        let api_key = self.api_key.clone();
        let body_clone = body.clone();
        let response = retry::with_retry(move || {
            let http = http.clone();
            let url = url.clone();
            let api_key = api_key.clone();
            let body = body_clone.clone();
            async move {
                let resp = http
                    .post(&url)
                    .bearer_auth(&api_key)
                    .json(&body)
                    .send()
                    .await?
                    .error_for_status()?;
                Ok(resp)
            }
        })
        .await?;
        let mut translated = parse_chat_text(response.json::<ChatResponse>().await?)?;
        translated = clean_translation_text(&translated);
        translated = enforce_glossary(&translated, &matched);
        self.cache.lock().await.put(key, translated.clone());
        Ok(translated)
    }

    /// Streaming translation: POST with `stream: true`, parse SSE tokens,
    /// send each token chunk through the channel. Returns the full cleaned text.
    pub async fn translate_streaming(
        &self,
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
        {
            let mut cache = self.cache.lock().await;
            if let Some(value) = cache.get(&key) {
                if let Some(tx) = &token_tx {
                    let _ = tx.send(value.clone()).await;
                }
                return Ok(value.clone());
            }
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
                "Below are previously translated lines for reference only. DO NOT retranslate them. DO NOT include numbers or prefixes in your output:\n{}\n\nTranslate ONLY the following text from {source_lang} to {target_lang}:\n\n{source_text}",
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
        let http = self.http.clone();
        let url = format!("{}/chat/completions", self.base_url);
        let api_key = self.api_key.clone();
        let body_clone = body.clone();
        let response = retry::with_retry(move || {
            let http = http.clone();
            let url = url.clone();
            let api_key = api_key.clone();
            let body = body_clone.clone();
            async move {
                let resp = http
                    .post(&url)
                    .bearer_auth(&api_key)
                    .json(&body)
                    .send()
                    .await?
                    .error_for_status()?;
                Ok(resp)
            }
        })
        .await?;

        let mut stream = response.bytes_stream();
        let mut accumulated = String::new();
        let mut line_buf = Vec::<u8>::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(AppError::Http)?;

            // Split on '\n' using byte iteration — avoids per-char UTF-8 decode.
            // `from_utf8_lossy` is used at line boundaries: if a multi-byte UTF-8
            // char happens to be split across two network chunks, the broken
            // bytes are replaced with U+FFFD rather than silently dropping the
            // entire token line.
            for &byte in bytes.iter() {
                if byte == b'\n' {
                    let line = match std::str::from_utf8(&line_buf) {
                        Ok(s) => s.trim().to_string(),
                        Err(err) => {
                            tracing::debug!(
                                error = %err,
                                "SSE line contained invalid UTF-8 (likely a multi-byte char split across chunks); using lossy conversion"
                            );
                            String::from_utf8_lossy(&line_buf).trim().to_string()
                        }
                    };
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
                } else {
                    line_buf.push(byte);
                }
            }
        }

        let mut translated = clean_translation_text(&accumulated);
        translated = enforce_glossary(&translated, &matched);
        self.cache.lock().await.put(key, translated.clone());
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
        "You are a professional simultaneous interpreter. Translate speech subtitles from {source_lang} to {target_lang}.\n\nRules:\n- Use natural spoken language in the target language, not written/formal style\n- Keep translation concise\n- Preserve technical terminology exactly as specified in the glossary\n- For partial or fragmented input, translate the fragment as-is without adding missing words\n- Never translate literally word-by-word; produce natural target-language phrasing\n- Only output the translation, no explanations or notes\n- NEVER add line numbers, bullet points, numbering, or any prefixes to the translation\n- NEVER retranslate or repeat lines that are already provided as confirmed context"
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
    value = RE_LEADING_LINE_NUMBER.replace(&value, "").to_string();
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
    if hallucinations::is_hallucination(&text, source_lang) {
        return rejected("whisper_hallucination");
    }
    let latin_count = RE_LATIN.find_iter(&text).count();
    let cjk_count = RE_CJK.find_iter(&text).count();
    // Multi-language script out-of-bounds detection.
    // Short text (< 3 bytes) is skipped to avoid false positives.
    if text.len() >= 3 {
        let lang_prefix = source_lang.split('-').next().unwrap_or("en").to_lowercase();
        let is_out_of_bounds = match lang_prefix.as_str() {
            // Latin-script sources: reject if output is pure CJK with no Latin
            "en" | "fr" | "de" | "es" => cjk_count > 0 && latin_count == 0,
            // Japanese: reject if output has CJK but no kana (model translated to Chinese)
            "ja" => {
                cjk_count > 0
                    && RE_HIRAGANA.find_iter(&text).count() == 0
                    && RE_KATAKANA.find_iter(&text).count() == 0
            }
            // Korean: reject if output has CJK but no Hangul
            "ko" => cjk_count > 0 && RE_HANGUL.find_iter(&text).count() == 0,
            // Russian: reject if output has CJK but no Cyrillic
            "ru" => cjk_count > 0 && RE_CYRILLIC.find_iter(&text).count() == 0,
            // zh-* and others: no out-of-bounds rejection
            _ => false,
        };
        if is_out_of_bounds {
            return rejected("target_language_output");
        }
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
    use std::sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

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
    fn translation_cleanup_strips_leading_line_numbers() {
        assert_eq!(clean_translation_text("1. Hello world"), "Hello world");
        assert_eq!(clean_translation_text("2) 你好世界"), "你好世界");
        assert_eq!(
            clean_translation_text("3: translated text"),
            "translated text"
        );
        assert_eq!(clean_translation_text("12. Some text"), "Some text");
        // Should not strip numbers that are part of content.
        assert_eq!(clean_translation_text("2024年"), "2024年");
        assert_eq!(clean_translation_text("No number here"), "No number here");
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

    #[tokio::test]
    async fn streaming_translation_retries_before_stream_starts() {
        let body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"Bonjour\"}}]}\n\ndata: [DONE]\n\n";
        let (base_url, attempts, server) = spawn_response_server(vec![
            http_response(500, "Internal Server Error", ""),
            http_response(200, "OK", body),
        ])
        .await;
        let client = test_translation_client(base_url);

        let translated = client
            .translate_streaming("Hello", "en", "fr", &[], &[], None)
            .await
            .unwrap();

        server.await.unwrap();
        assert_eq!(translated, "Bonjour");
        assert_eq!(attempts.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn streaming_translation_does_not_retry_client_error() {
        let (base_url, attempts, server) =
            spawn_response_server(vec![http_response(400, "Bad Request", "")]).await;
        let client = test_translation_client(base_url);

        let result = client
            .translate_streaming("Hello", "en", "fr", &[], &[], None)
            .await;

        server.await.unwrap();
        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::Relaxed), 1);
    }

    fn test_translation_client(base_url: String) -> TranslationClient {
        TranslationClient {
            http: reqwest::Client::new(),
            base_url,
            api_key: "test-key".into(),
            model: "test-model".into(),
            cache: tokio::sync::Mutex::new(LruCache::new(NonZeroUsize::new(512).unwrap())),
        }
    }

    async fn spawn_response_server(
        responses: Vec<String>,
    ) -> (String, Arc<AtomicU32>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let attempts = Arc::new(AtomicU32::new(0));
        let attempts_for_server = attempts.clone();
        let server = tokio::spawn(async move {
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                attempts_for_server.fetch_add(1, Ordering::Relaxed);
                let mut buf = [0u8; 4096];
                let _ = socket.read(&mut buf).await.unwrap();
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (format!("http://{addr}"), attempts, server)
    }

    fn http_response(status: u16, reason: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Spins up a one-shot HTTP server that writes the SSE `body_parts` as
    /// distinct TCP segments (flush + short sleep between writes), forcing
    /// the client to observe multiple `bytes_stream` chunks. The total
    /// `Content-Length` is the sum of all parts so reqwest will wait for the
    /// whole body before returning.
    async fn spawn_chunked_body_server(
        body_parts: Vec<Vec<u8>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let total_len: usize = body_parts.iter().map(|p| p.len()).sum();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = socket.read(&mut buf).await.unwrap();
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {total_len}\r\nConnection: close\r\n\r\n"
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.flush().await.unwrap();
            for part in body_parts {
                socket.write_all(&part).await.unwrap();
                socket.flush().await.unwrap();
                // Small pause so the kernel delivers each write as a
                // distinct packet — reqwest will surface them as separate
                // `Bytes` chunks in `bytes_stream()`.
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        });
        (format!("http://{addr}"), server)
    }

    /// Replays the byte-based SSE splitter used in `translate_streaming` and
    /// collects the streamed tokens. Mirrors the production logic so the
    /// tests stay in sync with any fixes applied there.
    fn collect_sse_tokens(chunks: &[&[u8]]) -> String {
        let mut accumulated = String::new();
        let mut line_buf = Vec::<u8>::new();
        for chunk in chunks {
            for &byte in chunk.iter() {
                if byte == b'\n' {
                    let line = match std::str::from_utf8(&line_buf) {
                        Ok(s) => s.trim().to_string(),
                        Err(_) => String::from_utf8_lossy(&line_buf).trim().to_string(),
                    };
                    line_buf.clear();
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
                                    }
                                }
                            }
                        }
                    }
                } else {
                    line_buf.push(byte);
                }
            }
        }
        accumulated
    }

    #[test]
    fn sse_byte_split_parses_tokens() {
        let sse_body = b"data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\ndata: [DONE]\n\n";
        let accumulated = collect_sse_tokens(&[sse_body.as_slice()]);
        assert_eq!(accumulated, "Hello world");
    }

    #[test]
    fn sse_byte_split_handles_chunked_data() {
        // SSE data arriving in multiple chunks mid-line.
        // chunk1 ends mid-JSON, chunk2 completes it.
        let chunk1 = b"data: {\"choices\":[{\"delta\":{\"con";
        let chunk2 = b"tent\":\"Hi\"}}]}\n\ndata: [DONE]\n\n";
        let accumulated = collect_sse_tokens(&[chunk1.as_slice(), chunk2.as_slice()]);
        assert_eq!(accumulated, "Hi");
    }

    #[test]
    fn sse_byte_split_handles_multibyte_utf8_split_across_chunks() {
        // 中文 token "你" 是 3 字节 UTF-8 (E4 BD A0)。让一个 3 字节字符被
        // 切到两个 chunk 的边界，验证解析器不会把整行吞掉。
        let line1 = "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n";
        let line2 = "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n";
        let line3 = "data: [DONE]\n\n";

        // 在 "你" 的 3 字节中间切一次（E4 BD | A0），模拟网络 chunk 边界。
        let bytes = line1.as_bytes();
        let cut = bytes
            .windows(3)
            .position(|w| w == [0xE4, 0xBD, 0xA0])
            .unwrap()
            + 2;
        let chunk1 = &bytes[..cut];
        let chunk2 = &bytes[cut..];
        let chunk3 = line2.as_bytes();
        let chunk4 = line3.as_bytes();

        let accumulated = collect_sse_tokens(&[chunk1, chunk2, chunk3, chunk4]);
        // "你" 的字节被拆开后，lossy 转换会插入 U+FFFD 替换字符。
        // 关键不变量：第二个 token "好" 必须完整保留，且 3 个 token 都到达
        // （即整个流没有被一个坏字节阻断）。
        assert!(
            accumulated.contains('好'),
            "完整 token 必须在被截断后仍能恢复: got {accumulated:?}"
        );
        assert!(
            accumulated.ends_with('好'),
            "流应正常结束于最后一个完整 token: got {accumulated:?}"
        );
        // 整段不能少于 '好' 的字符数。
        assert!(accumulated.chars().count() >= 1);
    }

    #[tokio::test]
    async fn streaming_translation_handles_multibyte_utf8_split_across_tcp_chunks() {
        // End-to-end test: spin up a real HTTP server that writes the SSE
        // body in two distinct TCP segments with the multi-byte UTF-8 char
        // "你" straddling the boundary, and verify the translated result
        // recovers the second token "好" intact.
        let line1 = "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n";
        let line2 = "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n";
        let line3 = "data: [DONE]\n\n";

        // Locate the 3 bytes of '你' (E4 BD A0) and split the first line
        // right after the second byte so the third byte lands in part 2.
        let bytes = line1.as_bytes();
        let cut = bytes
            .windows(3)
            .position(|w| w == [0xE4, 0xBD, 0xA0])
            .unwrap()
            + 2;
        let part1: Vec<u8> = bytes[..cut].to_vec();
        let part2: Vec<u8> = bytes[cut..].to_vec();
        let part3 = line2.as_bytes().to_vec();
        let part4 = line3.as_bytes().to_vec();

        let (base_url, server) = spawn_chunked_body_server(vec![part1, part2, part3, part4]).await;
        let client = test_translation_client(base_url);

        let translated = client
            .translate_streaming("hello", "en", "zh", &[], &[], None)
            .await
            .unwrap();
        server.await.unwrap();

        // The first token's bytes were split, so it may be replaced with the
        // U+FFFD replacement character. The second token "好" arrives in a
        // single TCP chunk and must be recovered intact.
        assert!(
            translated.ends_with('好'),
            "流末尾的完整 token 必须保留: got {translated:?}"
        );
        assert!(
            translated.contains('好'),
            "流中必须出现 '好': got {translated:?}"
        );
    }

    #[tokio::test]
    async fn streaming_translation_handles_ascii_split_across_tcp_chunks() {
        // Sanity check that the chunked-body plumbing works for plain ASCII
        // — every token must round-trip cleanly.
        let body_a = b"data: {\"choices\":[{\"delta\":{\"content\":\"He";
        let body_b = b"llo\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" w";
        let body_c = b"orld\"}}]}\n\ndata: [DONE]\n\n";

        let (base_url, server) =
            spawn_chunked_body_server(vec![body_a.to_vec(), body_b.to_vec(), body_c.to_vec()])
                .await;
        let client = test_translation_client(base_url);

        let translated = client
            .translate_streaming("ignored", "en", "fr", &[], &[], None)
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(translated, "Hello world");
    }

    // ── Multi-language hallucination tests ──

    #[test]
    fn ja_hallucination_filtered() {
        assert_eq!(
            sanitize_asr_text("ご視聴ありがとうございました", "ja").reject_reason,
            Some("whisper_hallucination")
        );
    }

    #[test]
    fn ko_hallucination_filtered() {
        assert_eq!(
            sanitize_asr_text("시청해주셔서 감사합니다", "ko").reject_reason,
            Some("whisper_hallucination")
        );
    }

    #[test]
    fn ru_hallucination_filtered() {
        assert_eq!(
            sanitize_asr_text("Спасибо за просмотр", "ru").reject_reason,
            Some("whisper_hallucination")
        );
    }

    #[test]
    fn fr_hallucination_filtered() {
        assert_eq!(
            sanitize_asr_text("Merci d'avoir regardé", "fr").reject_reason,
            Some("whisper_hallucination")
        );
    }

    #[test]
    fn de_hallucination_filtered() {
        assert_eq!(
            sanitize_asr_text("Danke fürs zuschauen", "de").reject_reason,
            Some("whisper_hallucination")
        );
    }

    #[test]
    fn es_hallucination_filtered() {
        assert_eq!(
            sanitize_asr_text("Gracias por ver", "es").reject_reason,
            Some("whisper_hallucination")
        );
    }

    // ── Multi-language out-of-bounds tests ──

    #[test]
    fn ja_chinese_only_rejected_as_target_language() {
        assert_eq!(
            sanitize_asr_text("感谢观看", "ja").reject_reason,
            Some("target_language_output")
        );
    }

    #[test]
    fn ko_chinese_only_rejected_as_target_language() {
        assert_eq!(
            sanitize_asr_text("感谢观看", "ko").reject_reason,
            Some("target_language_output")
        );
    }

    #[test]
    fn ru_chinese_only_rejected_as_target_language() {
        assert_eq!(
            sanitize_asr_text("感谢观看", "ru").reject_reason,
            Some("target_language_output")
        );
    }

    #[test]
    fn fr_chinese_only_rejected_as_target_language() {
        assert_eq!(
            sanitize_asr_text("感谢观看", "fr").reject_reason,
            Some("target_language_output")
        );
    }

    // ── Normal text not falsely rejected ──

    #[test]
    fn ja_with_kana_not_rejected() {
        assert_eq!(
            sanitize_asr_text("こんにちは世界", "ja").reject_reason,
            None
        );
    }

    #[test]
    fn ko_with_hangul_not_rejected() {
        assert_eq!(
            sanitize_asr_text("안녕하세요 세계", "ko").reject_reason,
            None
        );
    }

    #[test]
    fn ru_with_cyrillic_not_rejected() {
        assert_eq!(sanitize_asr_text("Привет мир", "ru").reject_reason, None);
    }

    // ── Short text skips out-of-bounds ──

    #[test]
    fn short_text_skips_out_of_bounds_check() {
        // Text < 3 bytes skips out-of-bounds detection to avoid false positives
        // on very short utterances. "OK" is 2 bytes, so it's exempt.
        assert_eq!(sanitize_asr_text("OK", "fr").reject_reason, None);
    }

    // ── Common hallucination markers work for all languages ──

    #[test]
    fn common_hallucination_markers_filtered() {
        assert_eq!(
            sanitize_asr_text("[music]", "ja").reject_reason,
            Some("whisper_hallucination")
        );
        assert_eq!(
            sanitize_asr_text("[applause]", "ko").reject_reason,
            Some("whisper_hallucination")
        );
        assert_eq!(
            sanitize_asr_text("[laughter]", "ru").reject_reason,
            Some("whisper_hallucination")
        );
    }

    // ── Chinese source never triggers out-of-bounds ──

    #[test]
    fn zh_source_no_out_of_bounds_rejection() {
        assert_eq!(sanitize_asr_text("你好世界", "zh-CN").reject_reason, None);
    }
}
