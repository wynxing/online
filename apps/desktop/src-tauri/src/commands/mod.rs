use crate::{
    api::{AsrClient, TranslationClient},
    audio,
    error::{AppError, AppResult},
    models::{
        now_iso, GlossaryTerm, GlossaryTermInput, RuntimeConfig, SessionRecord,
        StartSessionRequest, TestAsrRequest, TestTranslationRequest,
    },
    state::AppState,
};

const REDACTED_SECRET: &str = "••••";

fn is_redacted_secret(value: &str) -> bool {
    value == REDACTED_SECRET
}

fn resolve_test_secret(requested: &str, stored: &str) -> String {
    let requested = requested.trim();
    if requested.is_empty() || is_redacted_secret(requested) {
        stored.trim().to_string()
    } else {
        requested.to_string()
    }
}

fn redacted_config(config: &RuntimeConfig) -> AppResult<serde_json::Value> {
    let mut value = serde_json::to_value(config).map_err(|e| AppError::Config(e.to_string()))?;
    if let Some(obj) = value.as_object_mut() {
        for key in ["apiKey", "asrApiKey"] {
            let present = obj
                .get(key)
                .and_then(serde_json::Value::as_str)
                .is_some_and(|v| !v.is_empty());
            obj.insert(
                key.into(),
                serde_json::Value::String(if present { REDACTED_SECRET } else { "" }.into()),
            );
        }
    }
    Ok(value)
}

fn translation_test_config(
    request: TestTranslationRequest,
    stored: &RuntimeConfig,
) -> AppResult<RuntimeConfig> {
    let api_key = resolve_test_secret(&request.api_key, &stored.api_key);
    if api_key.is_empty() {
        return Err(AppError::Config("Translation API Key is required.".into()));
    }
    Ok(RuntimeConfig {
        base_url: request.base_url,
        api_key,
        translation_model: request.translation_model,
        ..RuntimeConfig::default()
    }
    .normalized())
}

fn asr_test_config(request: TestAsrRequest, stored: &RuntimeConfig) -> AppResult<RuntimeConfig> {
    let api_key = resolve_test_secret(&request.api_key, &stored.api_key);
    let asr_api_key = resolve_test_secret(&request.asr_api_key, &stored.asr_api_key);
    let config = RuntimeConfig {
        base_url: request.base_url,
        api_key,
        asr_base_url: request.asr_base_url,
        asr_api_key,
        asr_model: request.asr_model,
        ..RuntimeConfig::default()
    }
    .normalized();
    if config.effective_asr_api_key().is_empty() {
        return Err(AppError::Config("ASR API Key is required.".into()));
    }
    Ok(config)
}

#[tauri::command]
pub async fn health_check() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "status": "ok" }))
}

#[tauri::command]
pub async fn list_devices() -> Result<Vec<crate::models::Device>, String> {
    Ok(audio::list_devices())
}

/// Returns config with API keys replaced by presence indicators,
/// preventing key material from crossing the IPC boundary.
#[tauri::command]
pub async fn get_config(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.storage.load_config().await.map_err(to_string)?;
    redacted_config(&config).map_err(to_string)
}

#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, AppState>,
    mut config: RuntimeConfig,
) -> Result<serde_json::Value, String> {
    // If the frontend sends back the redacted placeholder, preserve the
    // existing key instead of overwriting it with "••••".
    let existing = state.storage.load_config().await.map_err(to_string)?;
    if is_redacted_secret(&config.api_key) {
        config.api_key = existing.api_key;
    }
    if is_redacted_secret(&config.asr_api_key) {
        config.asr_api_key = existing.asr_api_key;
    }
    let saved = state.storage.save_config(config).await.map_err(to_string)?;
    redacted_config(&saved).map_err(to_string)
}

#[tauri::command]
pub async fn start_session(
    state: tauri::State<'_, AppState>,
    request: StartSessionRequest,
) -> Result<SessionRecord, String> {
    if state.pipeline.is_running() {
        return Err("Session already running".into());
    }

    let mut config = state.storage.load_config().await.map_err(to_string)?;
    config.default_input_device_id = request.input_device_id.clone();
    config.display_mode = request.display_mode.clone();
    config.asr_provider = request.asr_provider.clone();
    config.translation_provider = request.translation_provider.clone();
    config = config.normalized();

    let session_id = format!("session_{}", uuid::Uuid::new_v4().simple());
    let record = SessionRecord {
        id: session_id.clone(),
        title: format!("Interpretation {}", chrono::Local::now().format("%H:%M:%S")),
        source_lang: request.source_lang.clone(),
        target_lang: request.target_lang.clone(),
        started_at: now_iso(),
        ended_at: None,
    };

    let record = state
        .storage
        .create_session(record)
        .await
        .map_err(to_string)?;
    let glossary = if config.glossary_enabled {
        state.storage.list_glossary().await.map_err(to_string)?
    } else {
        Vec::new()
    };
    state
        .pipeline
        .start(session_id, request, config, glossary)
        .map_err(to_string)?;
    Ok(record)
}

#[tauri::command]
pub async fn stop_session(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    if let Some(session_id) = state.pipeline.stop().await.map_err(to_string)? {
        let sessions = state.storage.list_sessions().await.map_err(to_string)?;
        if let Some(record) = sessions.into_iter().find(|item| item.id == session_id) {
            return serde_json::to_value(record).map_err(|e| e.to_string());
        }
    }
    Ok(serde_json::json!({ "status": "idle" }))
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionRecord>, String> {
    map(state.storage.list_sessions().await)
}

#[tauri::command]
pub async fn get_segments(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<crate::models::SubtitleSegment>, String> {
    map(state.storage.list_segments(session_id).await)
}

#[tauri::command]
pub async fn list_glossary(state: tauri::State<'_, AppState>) -> Result<Vec<GlossaryTerm>, String> {
    map(state.storage.list_glossary().await)
}

#[tauri::command]
pub async fn create_glossary(
    state: tauri::State<'_, AppState>,
    term: GlossaryTermInput,
) -> Result<GlossaryTerm, String> {
    map(state.storage.create_glossary(term).await)
}

#[tauri::command]
pub async fn update_glossary(
    state: tauri::State<'_, AppState>,
    term: GlossaryTerm,
) -> Result<GlossaryTerm, String> {
    map(state.storage.save_glossary(term).await)
}

#[tauri::command]
pub async fn delete_glossary(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    state.storage.delete_glossary(id).await.map_err(to_string)?;
    Ok(serde_json::json!({ "deleted": true }))
}

#[tauri::command]
pub async fn test_asr(
    state: tauri::State<'_, AppState>,
    request: TestAsrRequest,
) -> Result<serde_json::Value, String> {
    let stored = state.storage.load_config().await.map_err(to_string)?;
    let config = asr_test_config(request, &stored).map_err(to_string)?;
    let client = AsrClient::from_config(&config);
    client.test_models_endpoint().await.map_err(to_string)?;
    Ok(serde_json::json!({
        "ok": true,
        "model": config.asr_model,
        "base_url": config.effective_asr_base_url()
    }))
}

#[tauri::command]
pub async fn test_translation(
    state: tauri::State<'_, AppState>,
    request: TestTranslationRequest,
) -> Result<serde_json::Value, String> {
    let stored = state.storage.load_config().await.map_err(to_string)?;
    let config = translation_test_config(request, &stored).map_err(to_string)?;
    let client = TranslationClient::from_config(&config);
    let sample = client.test().await.map_err(to_string)?;
    Ok(serde_json::json!({
        "ok": true,
        "sample": sample,
        "model": config.translation_model,
        "base_url": config.base_url
    }))
}

fn map<T>(result: AppResult<T>) -> Result<T, String> {
    result.map_err(to_string)
}

fn to_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_config() -> RuntimeConfig {
        RuntimeConfig {
            api_key: "stored-general".into(),
            asr_api_key: "stored-asr".into(),
            ..RuntimeConfig::default()
        }
    }

    #[test]
    fn redacts_all_secrets_in_ipc_config() {
        let value = redacted_config(&stored_config()).unwrap();
        assert_eq!(value["apiKey"], REDACTED_SECRET);
        assert_eq!(value["asrApiKey"], REDACTED_SECRET);
        assert!(!value.to_string().contains("stored-general"));
        assert!(!value.to_string().contains("stored-asr"));
    }

    #[test]
    fn empty_secrets_remain_empty_when_redacted() {
        let value = redacted_config(&RuntimeConfig::default()).unwrap();
        assert_eq!(value["apiKey"], "");
        assert_eq!(value["asrApiKey"], "");
    }

    #[test]
    fn test_secret_uses_stored_value_for_empty_or_redacted_requests() {
        assert_eq!(resolve_test_secret("", "stored"), "stored");
        assert_eq!(resolve_test_secret(REDACTED_SECRET, "stored"), "stored");
    }

    #[test]
    fn test_secret_prefers_new_request_without_persisting_it() {
        let stored = stored_config();
        assert_eq!(resolve_test_secret("new-key", &stored.api_key), "new-key");
        assert_eq!(stored.api_key, "stored-general");
    }

    #[test]
    fn asr_test_uses_saved_keys_and_general_key_fallback() {
        let request = TestAsrRequest {
            base_url: "https://example.com/v1".into(),
            api_key: REDACTED_SECRET.into(),
            asr_base_url: String::new(),
            asr_api_key: REDACTED_SECRET.into(),
            asr_model: "whisper-1".into(),
        };
        let config = asr_test_config(request, &stored_config()).unwrap();
        assert_eq!(config.effective_asr_api_key(), "stored-asr");

        let mut stored = stored_config();
        stored.asr_api_key.clear();
        let request = TestAsrRequest {
            base_url: "https://example.com/v1".into(),
            api_key: REDACTED_SECRET.into(),
            asr_base_url: String::new(),
            asr_api_key: String::new(),
            asr_model: "whisper-1".into(),
        };
        let config = asr_test_config(request, &stored).unwrap();
        assert_eq!(config.effective_asr_api_key(), "stored-general");
    }

    #[test]
    fn connectivity_tests_reject_missing_credentials_before_http() {
        let stored = RuntimeConfig::default();
        let translation = TestTranslationRequest {
            base_url: "https://example.com/v1".into(),
            api_key: String::new(),
            translation_model: "model".into(),
        };
        assert!(translation_test_config(translation, &stored).is_err());

        let asr = TestAsrRequest {
            base_url: "https://example.com/v1".into(),
            api_key: String::new(),
            asr_base_url: String::new(),
            asr_api_key: String::new(),
            asr_model: "model".into(),
        };
        assert!(asr_test_config(asr, &stored).is_err());
    }
}
