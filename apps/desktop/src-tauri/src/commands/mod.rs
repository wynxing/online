use crate::{
    api::{AsrClient, TranslationClient},
    audio,
    error::AppResult,
    models::{
        now_iso, GlossaryTerm, GlossaryTermInput, RuntimeConfig, SessionRecord,
        StartSessionRequest, TestAsrRequest, TestTranslationRequest,
    },
    state::AppState,
};

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
    let mut value = serde_json::to_value(&config).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        let key_present = |v: &serde_json::Value| match v.as_str() {
            Some(s) if !s.is_empty() => "••••",
            _ => "",
        };
        if let Some(v) = obj.get("apiKey") {
            let redacted = key_present(v);
            obj.insert("apiKey".into(), serde_json::Value::String(redacted.into()));
        }
        if let Some(v) = obj.get("asrApiKey") {
            let redacted = key_present(v);
            obj.insert(
                "asrApiKey".into(),
                serde_json::Value::String(redacted.into()),
            );
        }
    }
    Ok(value)
}

#[tauri::command]
pub async fn save_config(
    state: tauri::State<'_, AppState>,
    mut config: RuntimeConfig,
) -> Result<RuntimeConfig, String> {
    // If the frontend sends back the redacted placeholder, preserve the
    // existing key instead of overwriting it with "••••".
    let existing = state.storage.load_config().await.map_err(to_string)?;
    if config.api_key == "••••" {
        config.api_key = existing.api_key;
    }
    if config.asr_api_key == "••••" {
        config.asr_api_key = existing.asr_api_key;
    }
    map(state.storage.save_config(config).await)
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
    if let Some(session_id) = state.pipeline.stop().await {
        let ended_at = now_iso();
        state
            .storage
            .finish_session(session_id.clone(), ended_at.clone())
            .await
            .map_err(to_string)?;
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
pub async fn test_asr(request: TestAsrRequest) -> Result<serde_json::Value, String> {
    let config = RuntimeConfig {
        base_url: request.base_url,
        api_key: request.api_key,
        asr_base_url: request.asr_base_url,
        asr_api_key: request.asr_api_key,
        asr_model: request.asr_model,
        ..RuntimeConfig::default()
    }
    .normalized();
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
    request: TestTranslationRequest,
) -> Result<serde_json::Value, String> {
    let config = RuntimeConfig {
        base_url: request.base_url,
        api_key: request.api_key,
        translation_model: request.translation_model,
        ..RuntimeConfig::default()
    }
    .normalized();
    let mut client = TranslationClient::from_config(&config);
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
