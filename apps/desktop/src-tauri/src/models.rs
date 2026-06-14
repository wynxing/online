use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DisplayMode {
    Source,
    Translated,
    Bilingual,
}

impl Default for DisplayMode {
    fn default() -> Self {
        Self::Bilingual
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubtitleStatus {
    Interim,
    Final,
    Corrected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub kind: String,
    pub is_default: bool,
    pub available: bool,
    pub description: Option<String>,
}

/// Runtime config with redacted secrets in Debug output.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub base_url: String,
    pub api_key: String,
    pub translation_model: String,
    pub asr_provider: String,
    pub translation_provider: String,
    pub default_input_device_id: String,
    pub display_mode: DisplayMode,
    pub font_size: u32,
    pub glossary_enabled: bool,
    pub asr_base_url: String,
    pub asr_api_key: String,
    pub asr_model: String,
    pub asr_language: String,
    pub source_lang: String,
    pub target_lang: String,
    pub asr_format: String,
    pub asr_concurrency: usize,
    pub translation_concurrency: usize,
    pub segment_min_duration: f32,
    pub segment_max_duration: f32,
    pub segment_silence_duration: f32,
    pub diagnostics_enabled: bool,
}

impl fmt::Debug for RuntimeConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeConfig")
            .field("base_url", &self.base_url)
            .field("api_key", &"[REDACTED]")
            .field("translation_model", &self.translation_model)
            .field("asr_provider", &self.asr_provider)
            .field("translation_provider", &self.translation_provider)
            .field("default_input_device_id", &self.default_input_device_id)
            .field("display_mode", &self.display_mode)
            .field("font_size", &self.font_size)
            .field("glossary_enabled", &self.glossary_enabled)
            .field("asr_base_url", &self.asr_base_url)
            .field("asr_api_key", &"[REDACTED]")
            .field("asr_model", &self.asr_model)
            .field("asr_language", &self.asr_language)
            .field("source_lang", &self.source_lang)
            .field("target_lang", &self.target_lang)
            .field("asr_format", &self.asr_format)
            .field("asr_concurrency", &self.asr_concurrency)
            .field("translation_concurrency", &self.translation_concurrency)
            .field("segment_min_duration", &self.segment_min_duration)
            .field("segment_max_duration", &self.segment_max_duration)
            .field("segment_silence_duration", &self.segment_silence_duration)
            .field("diagnostics_enabled", &self.diagnostics_enabled)
            .finish()
    }
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            translation_model: "gpt-4o-mini".into(),
            asr_provider: "openai-compatible".into(),
            translation_provider: "openai-compatible".into(),
            default_input_device_id: String::new(),
            display_mode: DisplayMode::Bilingual,
            font_size: 24,
            glossary_enabled: true,
            asr_base_url: String::new(),
            asr_api_key: String::new(),
            asr_model: "whisper-1".into(),
            asr_language: "en".into(),
            source_lang: "en".into(),
            target_lang: "zh-CN".into(),
            asr_format: "whisper".into(),
            asr_concurrency: 2,
            translation_concurrency: 3,
            segment_min_duration: 1.2,
            segment_max_duration: 3.0,
            segment_silence_duration: 0.35,
            diagnostics_enabled: true,
        }
    }
}

impl RuntimeConfig {
    pub fn normalized(mut self) -> Self {
        self.base_url = self.base_url.trim().trim_end_matches('/').to_string();
        self.asr_base_url = self.asr_base_url.trim().trim_end_matches('/').to_string();
        self.api_key = self.api_key.trim().to_string();
        self.asr_api_key = self.asr_api_key.trim().to_string();
        self.asr_language = self.asr_language.trim().to_string();
        self.source_lang = if self.source_lang.trim().is_empty() {
            "en".into()
        } else {
            self.source_lang.trim().to_string()
        };
        self.target_lang = if self.target_lang.trim().is_empty() {
            "zh-CN".into()
        } else {
            self.target_lang.trim().to_string()
        };
        self.font_size = self.font_size.clamp(14, 56);
        self.asr_concurrency = self.asr_concurrency.clamp(1, 8);
        self.translation_concurrency = self.translation_concurrency.clamp(1, 8);
        self.segment_min_duration = self.segment_min_duration.clamp(0.4, 10.0);
        self.segment_max_duration = self.segment_max_duration.clamp(0.8, 20.0);
        self.segment_silence_duration = self.segment_silence_duration.clamp(0.1, 3.0);
        self
    }

    pub fn effective_asr_base_url(&self) -> String {
        if self.asr_base_url.is_empty() {
            self.base_url.clone()
        } else {
            self.asr_base_url.clone()
        }
    }

    pub fn effective_asr_api_key(&self) -> String {
        if self.asr_api_key.is_empty() {
            self.api_key.clone()
        } else {
            self.asr_api_key.clone()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionRequest {
    pub input_device_id: String,
    pub source_lang: String,
    pub target_lang: String,
    pub display_mode: DisplayMode,
    pub asr_provider: String,
    pub translation_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestTranslationRequest {
    pub base_url: String,
    pub api_key: String,
    pub translation_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAsrRequest {
    pub base_url: String,
    pub api_key: String,
    pub asr_base_url: String,
    pub asr_api_key: String,
    pub asr_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    pub source_lang: String,
    pub target_lang: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSegment {
    pub id: String,
    pub session_id: String,
    pub source_text: String,
    pub translated_text: String,
    pub status: SubtitleStatus,
    pub version: u32,
    pub start_time: f32,
    pub end_time: Option<f32>,
    pub updated_at: String,
    pub superseded_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    pub id: String,
    pub source: String,
    pub target: String,
    pub domain: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTermInput {
    pub source: String,
    pub target: String,
    pub domain: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeErrorPayload {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusPayload {
    pub session_id: Option<String>,
    pub status: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineMetricsPayload {
    pub session_id: Option<String>,
    pub segment_id: Option<String>,
    pub stage: String,
    pub status: String,
    pub updated_at: Option<String>,
    pub drop_reason: Option<String>,
    pub dropped_count: Option<u32>,
    pub worker_id: Option<u32>,
    pub audio_start: Option<f32>,
    pub audio_end: Option<f32>,
    pub audio_duration_ms: Option<f32>,
    pub asr_duration_ms: Option<f32>,
    pub translation_duration_ms: Option<f32>,
    pub end_to_end_ms: Option<f32>,
    pub queue_lag_ms: Option<f32>,
    pub segment_queue_size: Option<usize>,
    pub translation_queue_size: Option<usize>,
    pub frames: Option<u64>,
    pub segments: Option<u64>,
    pub low_energy_drops: Option<u64>,
    pub last_frame_rms: Option<f32>,
    pub max_frame_rms: Option<f32>,
    pub last_segment_rms: Option<f32>,
    pub max_segment_rms: Option<f32>,
    pub error: Option<String>,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
