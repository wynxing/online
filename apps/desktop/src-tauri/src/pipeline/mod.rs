use std::{
    sync::{
        atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Instant,
};

use regex::Regex;

use tauri::{AppHandle, Emitter};
use tokio::{sync::mpsc, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use crate::{
    api::{encode_wav, prepare_for_asr, AsrClient, TranslationClient},
    audio::{self, AudioFrame},
    error::{AppError, AppResult},
    models::{
        now_iso, GlossaryTerm, PipelineMetricsPayload, RuntimeConfig, RuntimeErrorPayload,
        SessionStatusPayload, SubtitleSegment, SubtitleStatus,
    },
    storage::Storage,
};

/// Minimum IPC metrics emit interval. Without throttling, metrics are
/// emitted every audio frame (~100×/s at 48 kHz/10 ms), far exceeding
/// what the UI can consume.
const METRICS_THROTTLE_MS: u64 = 300;

/// RMS threshold below which an audio segment is considered silence.
/// At 90.0, this corresponds to roughly 0.27% of i16 full-scale amplitude
/// (32768 × 0.0027 ≈ 90), filtering out ambient noise floor.
const SILENCE_RMS_THRESHOLD: f32 = 90.0;

/// Segments waiting longer than this in the ASR input queue are dropped.
const ASR_STALE_SECS: f32 = 12.0;

/// Segments waiting longer than this in the translation input queue are dropped.
const TRANSLATION_STALE_SECS: f32 = 10.0;

/// Maximum wait for a missing sequence number before skipping (aligns with Python
/// TRANSLATION_REORDER_WAIT_SECONDS = 1.2s). The previous 100 ms was too aggressive
/// and caused incorrect skips when ASR workers completed out of order.
const REORDER_WAIT_MS: u64 = 1200;

/// How often the signal monitor checks for audio activity.
const SIGNAL_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

/// If no audio frames arrive within this window, emit a no-signal warning.
const NO_SIGNAL_THRESHOLD: std::time::Duration = std::time::Duration::from_secs(10);

/// Regex: sentence-ending punctuation with optional closing quotes/brackets.
static RE_SENTENCE_BOUNDARY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[.!?…]["')\]]*(?:\s+|$)"#).unwrap());

/// Regex: text ending with sentence punctuation.
static RE_SENTENCE_END: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[.!?…]["')\]]*\s*$"#).unwrap());

/// Regex: comma/semicolon followed by space and an uppercase letter (fallback for long segments).
static RE_LONG_SEGMENT_BOUNDARY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[,;]["')\]]*\s+[A-Z]"#).unwrap());

/// Regex: whitespace before punctuation (for join cleanup).
static RE_SPACE_BEFORE_PUNCT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+([,.!?;:])").unwrap());

/// Regex: multiple whitespace.
static RE_MULTI_SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

fn is_sentence_complete(source_text: &str) -> bool {
    let text = source_text.trim();
    if RE_SENTENCE_END.is_match(text) {
        return true;
    }
    text.chars().count() > 80 && RE_LONG_SEGMENT_BOUNDARY.is_match(text)
}

fn split_first_sentence(source_text: &str) -> (Option<String>, String) {
    let text = source_text.trim();
    if let Some(m) = RE_SENTENCE_BOUNDARY.find(text) {
        let end = m.end();
        return (
            Some(text[..end].trim().to_string()),
            text[end..].trim().to_string(),
        );
    }
    if text.chars().count() > 80 {
        if let Some(m) = RE_LONG_SEGMENT_BOUNDARY.find(text) {
            let end = m.end();
            return (
                Some(text[..end].trim().to_string()),
                text[end..].trim().to_string(),
            );
        }
    }
    (None, text.to_string())
}

fn join_source_text(parts: &[&str]) -> String {
    let text: String = parts
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let text = RE_SPACE_BEFORE_PUNCT.replace_all(&text, "$1").to_string();
    RE_MULTI_SPACE.replace_all(&text, " ").trim().to_string()
}

#[derive(Clone)]
pub struct PipelineManager {
    inner: Arc<Mutex<Option<ActivePipeline>>>,
    app: AppHandle,
    storage: Storage,
}

struct ActivePipeline {
    session_id: String,
    cancel: CancellationToken,
    handle: JoinHandle<()>,
}

impl PipelineManager {
    pub fn new(app: AppHandle, storage: Storage) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            app,
            storage,
        }
    }

    pub fn is_running(&self) -> bool {
        self.inner.lock().ok().map_or(false, |g| g.is_some())
    }

    pub fn start(
        &self,
        session_id: String,
        request: crate::models::StartSessionRequest,
        config: RuntimeConfig,
        glossary: Vec<GlossaryTerm>,
    ) -> AppResult<()> {
        // Stop any existing pipeline first. The separate is_running()
        // check in commands/mod.rs is now informational only — the real
        // guard is here, inside a single lock acquisition, so there is
        // no TOCTOU race.
        self.blocking_stop();
        let cancel = CancellationToken::new();
        let app = self.app.clone();
        let storage = self.storage.clone();
        let cleanup_storage = storage.clone();
        let token = cancel.clone();
        let inner = self.inner.clone();
        let active_session_id = session_id.clone();
        let cleanup_session_id = session_id.clone();
        let handle = tokio::spawn(async move {
            if let Err(error) = run_pipeline(
                app.clone(),
                storage,
                session_id.clone(),
                request,
                config,
                glossary,
                token,
            )
            .await
            {
                emit_error(&app, "PIPELINE_FAILED", &error.to_string(), false);
                emit_status(&app, Some(session_id), "stopped");
            }
            let _ = cleanup_storage
                .finish_session(cleanup_session_id.clone(), now_iso())
                .await;
            let Ok(mut guard) = inner.lock() else { return };
            if guard
                .as_ref()
                .map(|active| active.session_id == cleanup_session_id)
                .unwrap_or(false)
            {
                *guard = None;
            }
        });
        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(ActivePipeline {
                session_id: active_session_id,
                cancel,
                handle,
            });
        }
        Ok(())
    }

    pub async fn stop(&self) -> Option<String> {
        let active = self.inner.lock().ok().and_then(|mut g| g.take());
        if let Some(active) = active {
            active.cancel.cancel();
            let _ = active.handle.await;
            return Some(active.session_id);
        }
        None
    }

    pub fn blocking_stop(&self) {
        if let Some(active) = self.inner.lock().ok().and_then(|mut g| g.take()) {
            active.cancel.cancel();
            // Do NOT abort: let the CancellationToken propagate so the
            // cleanup code in the spawned task (finish_session, clearing
            // inner) can still execute. We synchronously wait for the task
            // to finish so that ended_at is written to SQLite before return.
            //
            // Capture the runtime handle on the calling thread (which IS
            // inside the Tokio runtime). Handle::current() inside a fresh
            // std::thread would panic.
            let Ok(rt) = tokio::runtime::Handle::try_current() else {
                // No runtime context (e.g. called from a non-async test).
                // Fall back to abort to avoid hanging.
                active.handle.abort();
                return;
            };
            let handle = active.handle;
            let abort_handle = handle.abort_handle();
            let (tx, rx) = std::sync::mpsc::channel();
            let worker = std::thread::spawn(move || {
                let _ = rt.block_on(handle);
                let _ = tx.send(());
            });
            if rx.recv_timeout(std::time::Duration::from_secs(5)).is_err() {
                // Pipeline didn't finish in time — abort to let app exit
                tracing::warn!("blocking_stop: pipeline did not finish within 5s, aborting");
                abort_handle.abort();
            }
            // Always join the worker thread to guarantee cleanup.
            // After abort, block_on returns immediately with JoinError.
            let _ = worker.join();
        }
    }
}

async fn run_pipeline(
    app: AppHandle,
    storage: Storage,
    session_id: String,
    request: crate::models::StartSessionRequest,
    config: RuntimeConfig,
    glossary: Vec<GlossaryTerm>,
    token: CancellationToken,
) -> AppResult<()> {
    if config.effective_asr_base_url().is_empty() || config.effective_asr_api_key().is_empty() {
        return Err(AppError::Config("ASR configuration is incomplete.".into()));
    }
    if config.api_key.is_empty() {
        return Err(AppError::Config("Translation API Key is required.".into()));
    }

    emit_status(&app, Some(session_id.clone()), "running");

    let (audio_tx, audio_rx) = mpsc::channel::<AudioFrame>(64);
    let (segment_tx, segment_rx) = mpsc::channel::<AudioSegment>(16);
    let (asr_tx, asr_rx) = mpsc::channel::<RecognizedSegment>(32);
    let capture_token = token.clone();
    let capture_device = request.input_device_id.clone();
    let capture = tokio::task::spawn_blocking(move || {
        audio::capture_blocking(capture_device, audio_tx, capture_token)
    });

    let frame_counter = Arc::new(AtomicU64::new(0));
    let segment_counter = Arc::new(AtomicU64::new(0));
    let segment_queue_depth = Arc::new(AtomicUsize::new(0));
    let translation_queue_depth = Arc::new(AtomicUsize::new(0));

    let segmenter = tokio::spawn(segmenter_task(
        audio_rx,
        segment_tx,
        config.clone(),
        token.clone(),
        app.clone(),
        session_id.clone(),
        frame_counter.clone(),
        segment_counter.clone(),
        segment_queue_depth.clone(),
    ));
    let asr = tokio::spawn(asr_task(
        segment_rx,
        asr_tx,
        AsrClient::from_config(&config),
        config.asr_concurrency,
        token.clone(),
        app.clone(),
        session_id.clone(),
        segment_queue_depth.clone(),
    ));

    let (reorder_tx, reorder_rx) = mpsc::channel::<TranslatedSegment>(32);
    let dispatcher = tokio::spawn(translation_dispatcher(
        asr_rx,
        TranslationClient::from_config(&config),
        config.translation_concurrency,
        reorder_tx,
        session_id.clone(),
        request.source_lang.clone(),
        request.target_lang.clone(),
        glossary.clone(),
        token.clone(),
        app.clone(),
        translation_queue_depth.clone(),
    ));
    let reorder = tokio::spawn(reorder_task(
        reorder_rx,
        TranslationClient::from_config(&config),
        session_id.clone(),
        request.source_lang,
        request.target_lang,
        glossary,
        token.clone(),
        app.clone(),
        storage,
    ));

    let monitor = tokio::spawn(signal_monitor_task(
        frame_counter,
        segment_counter,
        token.clone(),
        app.clone(),
        session_id.clone(),
    ));

    tokio::select! {
        result = capture => {
            match result {
                Ok(Ok(_device)) => {}
                Ok(Err(error)) => return Err(error),
                Err(error) => return Err(AppError::Join(error)),
            }
        }
        _ = token.cancelled() => {}
    }

    let _ = segmenter.await;
    let _ = asr.await;
    let _ = dispatcher.await;
    let _ = reorder.await;
    let _ = monitor.await;
    emit_status(&app, Some(session_id), "stopped");
    Ok(())
}

#[derive(Debug)]
struct AudioSegment {
    id: String,
    samples: Vec<i16>,
    sample_rate: u32,
    channels: u16,
    start_time: f32,
    end_time: f32,
    created_at: Instant,
}

#[derive(Debug)]
struct RecognizedSegment {
    id: String,
    source_text: String,
    start_time: f32,
    end_time: f32,
    asr_ms: f32,
    created_at: Instant,
}

#[allow(clippy::too_many_arguments)]
async fn segmenter_task(
    mut rx: mpsc::Receiver<AudioFrame>,
    tx: mpsc::Sender<AudioSegment>,
    config: RuntimeConfig,
    token: CancellationToken,
    app: AppHandle,
    session_id: String,
    frame_counter: Arc<AtomicU64>,
    segment_counter: Arc<AtomicU64>,
    segment_queue_depth: Arc<AtomicUsize>,
) {
    let mut sample_rate = 48_000;
    let mut channels = 1;
    let mut min_samples =
        (sample_rate as f32 * config.segment_min_duration) as usize * channels as usize;
    let mut max_samples =
        (sample_rate as f32 * config.segment_max_duration) as usize * channels as usize;
    let mut buffer = Vec::<i16>::with_capacity(max_samples);
    let mut index = 0u64;
    let mut stream_time = 0.0f32;
    let mut segment_start = 0.0f32;
    let mut frames = 0u64;
    let mut low_energy_drops = 0u64;
    let mut last_metrics_emit = Instant::now();

    loop {
        tokio::select! {
            _ = token.cancelled() => break,
            frame = rx.recv() => {
                let Some(frame) = frame else { break };
                if frame.sample_rate != sample_rate || frame.channels != channels {
                    sample_rate = frame.sample_rate;
                    channels = frame.channels;
                    min_samples = (sample_rate as f32 * config.segment_min_duration) as usize * channels as usize;
                    max_samples = (sample_rate as f32 * config.segment_max_duration) as usize * channels as usize;
                    if buffer.capacity() < max_samples {
                        buffer.reserve(max_samples - buffer.capacity());
                    }
                }
                frames += 1;
                frame_counter.fetch_add(1, Ordering::Relaxed);
                stream_time += frame.samples.len() as f32 / (sample_rate as f32 * channels as f32);
                buffer.extend(frame.samples);
                let frame_rms = rms(&buffer);

                // Throttle metrics to avoid flooding the IPC channel.
                if last_metrics_emit.elapsed().as_millis() >= METRICS_THROTTLE_MS as u128 {
                    last_metrics_emit = Instant::now();
                    emit_metrics(&app, PipelineMetricsPayload {
                        session_id: Some(session_id.clone()),
                        segment_id: None,
                        stage: "audio".into(),
                        status: "stats".into(),
                        updated_at: Some(now_iso()),
                        drop_reason: None,
                        dropped_count: None,
                        worker_id: None,
                        audio_start: None,
                        audio_end: None,
                        audio_duration_ms: None,
                        asr_duration_ms: None,
                        translation_duration_ms: None,
                        end_to_end_ms: None,
                        queue_lag_ms: None,
                        segment_queue_size: None,
                        translation_queue_size: None,
                        frames: Some(frames),
                        segments: Some(index),
                        low_energy_drops: Some(low_energy_drops),
                        last_frame_rms: Some(frame_rms),
                        max_frame_rms: Some(frame_rms),
                        last_segment_rms: None,
                        max_segment_rms: None,
                        error: None,
                    });
                }
                if buffer.len() >= max_samples && buffer.len() >= min_samples {
                    // Reuse frame_rms for silence gate instead of recomputing.
                    if frame_rms < SILENCE_RMS_THRESHOLD {
                        buffer.clear();
                        segment_start = stream_time;
                        low_energy_drops += 1;
                        continue;
                    }
                    index += 1;
                    let segment = AudioSegment {
                        id: format!("seg_{index:06}"),
                        samples: std::mem::take(&mut buffer),
                        sample_rate,
                        channels,
                        start_time: segment_start,
                        end_time: stream_time,
                        created_at: Instant::now(),
                    };
                    segment_start = stream_time;
                    segment_counter.fetch_add(1, Ordering::Relaxed);
                    segment_queue_depth.fetch_add(1, Ordering::Relaxed);
                    if tx.send(segment).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    // Flush remaining buffer as a final segment on pipeline end.
    if !buffer.is_empty() {
        index += 1;
        segment_queue_depth.fetch_add(1, Ordering::Relaxed);
        let _ = tx
            .send(AudioSegment {
                id: format!("seg_{index:06}"),
                samples: buffer,
                sample_rate,
                channels,
                start_time: segment_start,
                end_time: stream_time,
                created_at: Instant::now(),
            })
            .await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn asr_task(
    mut rx: mpsc::Receiver<AudioSegment>,
    tx: mpsc::Sender<RecognizedSegment>,
    asr: AsrClient,
    concurrency: usize,
    token: CancellationToken,
    app: AppHandle,
    session_id: String,
    segment_queue_depth: Arc<AtomicUsize>,
) {
    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let recent_source: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let worker_id_counter = Arc::new(AtomicU64::new(0));
    let consecutive_empty = Arc::new(AtomicU32::new(0));

    while let Some(segment) = rx.recv().await {
        let _ = segment_queue_depth.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_sub(1));
        if token.is_cancelled() {
            break;
        }

        // Drop segments that waited too long in the queue.
        let queue_lag = segment.created_at.elapsed().as_secs_f32();
        if queue_lag > ASR_STALE_SECS {
            tracing::warn!(
                segment = %segment.id,
                queue_lag_ms = (queue_lag * 1000.0) as u64,
                "Drop stale ASR segment"
            );
            emit_drop_metrics(&app, &session_id, &segment.id, "asr_stale", queue_lag);
            continue;
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let asr = asr.clone();
        let tx = tx.clone();
        let token = token.clone();
        let app = app.clone();
        let session_id = session_id.clone();
        let recent_source = recent_source.clone();
        let consecutive_empty = consecutive_empty.clone();
        let segment_queue_depth = segment_queue_depth.clone();
        let worker_id = worker_id_counter.fetch_add(1, Ordering::Relaxed);

        tokio::spawn(async move {
            let queue_lag_ms = segment.created_at.elapsed().as_secs_f32() * 1000.0;
            let started = Instant::now();
            let (prepared, prep_ch, prep_rate) =
                prepare_for_asr(&segment.samples, segment.channels, segment.sample_rate);
            let wav = encode_wav(&prepared, prep_ch, prep_rate);
            let prompt = recent_source.lock().unwrap().clone();
            match asr.transcribe(wav, prompt.as_deref()).await {
                Ok(source_text) if !source_text.is_empty() => {
                    consecutive_empty.store(0, Ordering::Relaxed);
                    let asr_ms = started.elapsed().as_secs_f32() * 1000.0;
                    let interim = SubtitleSegment {
                        id: segment.id.clone(),
                        session_id: session_id.clone(),
                        source_text: source_text.clone(),
                        translated_text: "Translating...".into(),
                        status: SubtitleStatus::Interim,
                        version: 1,
                        start_time: segment.start_time,
                        end_time: None,
                        updated_at: now_iso(),
                        superseded_by: None,
                    };
                    let _ = app.emit("subtitle:segment-created", &interim);
                    emit_metrics(
                        &app,
                        PipelineMetricsPayload {
                            session_id: Some(session_id.clone()),
                            segment_id: Some(segment.id.clone()),
                            stage: "asr".into(),
                            status: "finished".into(),
                            updated_at: Some(now_iso()),
                            drop_reason: None,
                            dropped_count: None,
                            worker_id: Some(worker_id as u32),
                            audio_start: Some(segment.start_time),
                            audio_end: Some(segment.end_time),
                            audio_duration_ms: Some(
                                (segment.end_time - segment.start_time) * 1000.0,
                            ),
                            asr_duration_ms: Some(asr_ms),
                            translation_duration_ms: None,
                            end_to_end_ms: None,
                            queue_lag_ms: Some(queue_lag_ms),
                            segment_queue_size: Some(segment_queue_depth.load(Ordering::Relaxed)),
                            translation_queue_size: None,
                            frames: None,
                            segments: None,
                            low_energy_drops: None,
                            last_frame_rms: None,
                            max_frame_rms: None,
                            last_segment_rms: None,
                            max_segment_rms: None,
                            error: None,
                        },
                    );
                    *recent_source.lock().unwrap() = Some(source_text.clone());
                    let _ = tx
                        .send(RecognizedSegment {
                            id: segment.id,
                            source_text,
                            start_time: segment.start_time,
                            end_time: segment.end_time,
                            asr_ms,
                            created_at: Instant::now(),
                        })
                        .await;
                }
                Ok(_) => {
                    // Empty ASR result — track consecutive empties and warn user.
                    let count = consecutive_empty.fetch_add(1, Ordering::Relaxed) + 1;
                    if count >= 3 {
                        if !token.is_cancelled() {
                            emit_error(
                                &app,
                                "ASR_EMPTY",
                                "连续收到空的语音识别结果。请检查：1) 系统音频回环设备是否正确 2) 音频语言设置 3) 播放音量 4) ASR 模型配置",
                                true,
                            );
                        }
                        consecutive_empty.store(0, Ordering::Relaxed);
                    }
                }
                Err(error) => {
                    if !token.is_cancelled() {
                        emit_error(&app, "ASR_FAILED", &error.to_string(), true);
                    }
                }
            }
            drop(permit);
        });
    }
}

struct OpenTail {
    segment: RecognizedSegment,
    source_text: String,
    version: u32,
}

/// Result of a concurrent translation, to be reordered.
struct TranslatedSegment {
    seq: u64,
    segment: RecognizedSegment,
    translated_text: String,
    translation_ms: f32,
}

struct QueueDepthGuard {
    depth: Arc<AtomicUsize>,
    active: bool,
}

impl QueueDepthGuard {
    fn new(depth: Arc<AtomicUsize>) -> Self {
        depth.fetch_add(1, Ordering::Relaxed);
        Self {
            depth,
            active: true,
        }
    }

    fn release(mut self) -> usize {
        self.active = false;
        self.depth
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_sub(1))
            .unwrap_or(0)
    }
}

impl Drop for QueueDepthGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = self
                .depth
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_sub(1));
        }
    }
}

/// Extract monotonic sequence number from segment ID (format: `seg_NNNNNN`).
fn extract_sequence(id: &str) -> u64 {
    id.strip_prefix("seg_")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

/// Dispatches recognized segments to concurrent translation workers.
#[allow(clippy::too_many_arguments)]
async fn translation_dispatcher(
    mut rx: mpsc::Receiver<RecognizedSegment>,
    translation: TranslationClient,
    concurrency: usize,
    reorder_tx: mpsc::Sender<TranslatedSegment>,
    session_id: String,
    source_lang: String,
    target_lang: String,
    glossary: Vec<GlossaryTerm>,
    token: CancellationToken,
    app: AppHandle,
    translation_queue_depth: Arc<AtomicUsize>,
) {
    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let translation = Arc::new(translation);
    let glossary = Arc::new(glossary);
    let worker_id_counter = Arc::new(AtomicU64::new(0));

    while let Some(segment) = rx.recv().await {
        if token.is_cancelled() {
            break;
        }

        // Drop segments that waited too long in the queue.
        let queue_lag = segment.created_at.elapsed().as_secs_f32();
        if queue_lag > TRANSLATION_STALE_SECS {
            tracing::warn!(
                segment = %segment.id,
                queue_lag_ms = (queue_lag * 1000.0) as u64,
                "Drop stale translation segment"
            );
            emit_drop_metrics(
                &app,
                &session_id,
                &segment.id,
                "translation_stale",
                queue_lag,
            );
            continue;
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let queue_guard = QueueDepthGuard::new(translation_queue_depth.clone());
        let translation = translation.clone();
        let reorder_tx = reorder_tx.clone();
        let token = token.clone();
        let app = app.clone();
        let session_id = session_id.clone();
        let source_lang = source_lang.clone();
        let target_lang = target_lang.clone();
        let glossary = glossary.clone();
        let _worker_id = worker_id_counter.fetch_add(1, Ordering::Relaxed);

        tokio::spawn(async move {
            let seq = extract_sequence(&segment.id);
            let started = Instant::now();

            // Create a token channel for streaming emission.
            let (token_tx, mut token_rx) = mpsc::channel::<String>(64);
            let seg_id = segment.id.clone();
            let app_clone = app.clone();
            // Spawn a task to forward tokens from the channel to Tauri events.
            let emitter = tokio::spawn(async move {
                while let Some(token) = token_rx.recv().await {
                    let _ = app_clone.emit(
                        "subtitle:token",
                        serde_json::json!({
                            "segment_id": seg_id,
                            "token": token,
                        }),
                    );
                }
            });

            // Workers translate without context — context is maintained by reorder_task.
            let result = translation
                .translate_streaming(
                    &segment.source_text,
                    &source_lang,
                    &target_lang,
                    &glossary,
                    &[],
                    Some(token_tx),
                )
                .await;
            let _ = emitter.await;

            match result {
                Ok(translated_text) => {
                    let translation_ms = started.elapsed().as_secs_f32() * 1000.0;
                    let queue_size = queue_guard.release();
                    emit_queue_metrics(&app, &session_id, queue_size);
                    let _ = reorder_tx
                        .send(TranslatedSegment {
                            seq,
                            segment,
                            translated_text,
                            translation_ms,
                        })
                        .await;
                }
                Err(error) => {
                    let queue_size = queue_guard.release();
                    emit_queue_metrics(&app, &session_id, queue_size);
                    if !token.is_cancelled() {
                        emit_error(&app, "TRANSLATION_FAILED", &error.to_string(), true);
                    }
                }
            }
            drop(permit);
        });
    }
}

/// Receives translated segments out-of-order, buffers them, and emits in sequence.
/// Maintains open_tail for sentence-completion correction.
#[allow(clippy::too_many_arguments)]
async fn reorder_task(
    mut rx: mpsc::Receiver<TranslatedSegment>,
    translation: TranslationClient,
    session_id: String,
    source_lang: String,
    target_lang: String,
    glossary: Vec<GlossaryTerm>,
    token: CancellationToken,
    app: AppHandle,
    storage: Storage,
) {
    use std::collections::BTreeMap;

    let mut pending: BTreeMap<u64, TranslatedSegment> = BTreeMap::new();
    let mut next_seq: u64 = 1;
    let mut context = Vec::<(String, String)>::new();
    let mut open_tail: Option<OpenTail> = None;

    loop {
        // Try to drain all in-order segments from the pending map.
        while let Some(item) = pending.remove(&next_seq) {
            let segment = item.segment;
            let recognized = RecognizedSegment {
                id: segment.id.clone(),
                source_text: segment.source_text.clone(),
                start_time: segment.start_time,
                end_time: segment.end_time,
                asr_ms: segment.asr_ms,
                created_at: segment.created_at,
            };
            emit_translated_segment(
                recognized,
                item.translated_text,
                item.translation_ms,
                &mut open_tail,
                &session_id,
                &source_lang,
                &target_lang,
                &glossary,
                &mut context,
                &translation,
                &app,
                &storage,
            )
            .await;
            next_seq += 1;
        }

        if token.is_cancelled() {
            break;
        }

        // Wait for the next translated segment or timeout for pending flush.
        if pending.is_empty() {
            // No buffered items — wait for next.
            match rx.recv().await {
                Some(item) => {
                    pending.insert(item.seq, item);
                }
                None => break, // Channel closed.
            }
        } else {
            // Have buffered items waiting for an earlier seq — wait briefly.
            tokio::select! {
                item = rx.recv() => {
                    match item {
                        Some(item) => { pending.insert(item.seq, item); }
                        None => break,
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(REORDER_WAIT_MS)) => {
                    // Timeout — skip missing seq to avoid stalling.
                    if let Some((&skipped, _)) = pending.iter().next() {
                        tracing::warn!(
                            expected = next_seq,
                            skipped_to = skipped,
                            "Skipping missing translation sequence"
                        );
                        next_seq = skipped;
                    }
                }
            }
        }
    }

    // Flush remaining open_tail as final segment on pipeline end.
    if let Some(tail) = open_tail.take() {
        flush_open_tail(
            tail,
            &translation,
            &session_id,
            &source_lang,
            &target_lang,
            &glossary,
            &context,
            &app,
            &storage,
        )
        .await;
    }
}

/// Emit a translated segment, handling open_tail sentence-completion correction.
/// Uses pre-computed translation for the normal path; re-translates for corrections.
#[allow(clippy::too_many_arguments)]
async fn emit_translated_segment(
    segment: RecognizedSegment,
    translated_text: String,
    translation_ms: f32,
    open_tail: &mut Option<OpenTail>,
    session_id: &str,
    source_lang: &str,
    target_lang: &str,
    glossary: &[GlossaryTerm],
    context: &mut Vec<(String, String)>,
    translation: &TranslationClient,
    app: &AppHandle,
    storage: &Storage,
) {
    if let Some(tail) = open_tail.take() {
        // Previous incomplete segment — correction path requires re-translation.
        let combined = join_source_text(&[&tail.source_text, &segment.source_text]);
        let (completed, remainder) = split_first_sentence(&combined);
        let correction_source = completed.unwrap_or_else(|| combined.clone());

        let started = Instant::now();
        match translation
            .translate(
                &correction_source,
                source_lang,
                target_lang,
                glossary,
                context,
            )
            .await
        {
            Ok(correction_text) => {
                let correction_ms = started.elapsed().as_secs_f32() * 1000.0;
                let corrected = SubtitleSegment {
                    id: tail.segment.id.clone(),
                    session_id: session_id.to_string(),
                    source_text: correction_source,
                    translated_text: correction_text.clone(),
                    status: SubtitleStatus::Corrected,
                    version: tail.version + 1,
                    start_time: tail.segment.start_time,
                    end_time: Some(segment.end_time),
                    updated_at: now_iso(),
                    superseded_by: None,
                };
                let _ = storage.upsert_segment(corrected.clone()).await;
                let _ = app.emit("subtitle:segment-corrected", &corrected);
                emit_translation_metrics(app, &corrected, &tail.segment, correction_ms);
                context.push((corrected.source_text.clone(), correction_text));
                trim_context(context);

                if !remainder.is_empty() {
                    *open_tail = Some(OpenTail {
                        segment: RecognizedSegment {
                            id: segment.id.clone(),
                            source_text: remainder,
                            start_time: segment.start_time,
                            end_time: segment.end_time,
                            asr_ms: segment.asr_ms,
                            created_at: segment.created_at,
                        },
                        source_text: segment.source_text.clone(),
                        version: 1,
                    });
                }
            }
            Err(error) => {
                emit_error(app, "TRANSLATION_FAILED", &error.to_string(), true);
                *open_tail = Some(OpenTail {
                    segment,
                    source_text: tail.source_text,
                    version: tail.version,
                });
            }
        }
    } else {
        // Normal path — use pre-computed translation.
        let subtitle = SubtitleSegment {
            id: segment.id.clone(),
            session_id: session_id.to_string(),
            source_text: segment.source_text.clone(),
            translated_text: translated_text.clone(),
            status: SubtitleStatus::Final,
            version: 2,
            start_time: segment.start_time,
            end_time: Some(segment.end_time),
            updated_at: now_iso(),
            superseded_by: None,
        };
        let _ = storage.upsert_segment(subtitle.clone()).await;
        let _ = app.emit("subtitle:segment-updated", &subtitle);
        emit_translation_metrics(app, &subtitle, &segment, translation_ms);
        context.push((segment.source_text.clone(), translated_text));
        trim_context(context);

        if !is_sentence_complete(&segment.source_text) {
            *open_tail = Some(OpenTail {
                segment,
                source_text: subtitle.source_text.clone(),
                version: 2,
            });
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn flush_open_tail(
    tail: OpenTail,
    translation: &TranslationClient,
    session_id: &str,
    source_lang: &str,
    target_lang: &str,
    glossary: &[GlossaryTerm],
    context: &[(String, String)],
    app: &AppHandle,
    storage: &Storage,
) {
    let started = Instant::now();
    match translation
        .translate(
            &tail.source_text,
            source_lang,
            target_lang,
            glossary,
            context,
        )
        .await
    {
        Ok(translated_text) => {
            let translation_ms = started.elapsed().as_secs_f32() * 1000.0;
            let subtitle = SubtitleSegment {
                id: tail.segment.id.clone(),
                session_id: session_id.to_string(),
                source_text: tail.source_text,
                translated_text,
                status: SubtitleStatus::Final,
                version: tail.version + 1,
                start_time: tail.segment.start_time,
                end_time: Some(tail.segment.end_time),
                updated_at: now_iso(),
                superseded_by: None,
            };
            let _ = storage.upsert_segment(subtitle.clone()).await;
            let _ = app.emit("subtitle:segment-updated", &subtitle);
            emit_translation_metrics(app, &subtitle, &tail.segment, translation_ms);
        }
        Err(error) => emit_error(app, "TRANSLATION_FAILED", &error.to_string(), true),
    }
}

fn emit_translation_metrics(
    app: &AppHandle,
    subtitle: &SubtitleSegment,
    segment: &RecognizedSegment,
    translation_ms: f32,
) {
    emit_metrics(
        app,
        PipelineMetricsPayload {
            session_id: Some(subtitle.session_id.clone()),
            segment_id: Some(segment.id.clone()),
            stage: "translation".into(),
            status: "finished".into(),
            updated_at: Some(now_iso()),
            drop_reason: None,
            dropped_count: None,
            worker_id: None,
            audio_start: Some(subtitle.start_time),
            audio_end: subtitle.end_time,
            audio_duration_ms: subtitle
                .end_time
                .map(|end| (end - subtitle.start_time) * 1000.0),
            asr_duration_ms: Some(segment.asr_ms),
            translation_duration_ms: Some(translation_ms),
            end_to_end_ms: Some(segment.asr_ms + translation_ms),
            queue_lag_ms: None,
            segment_queue_size: None,
            translation_queue_size: None,
            frames: None,
            segments: None,
            low_energy_drops: None,
            last_frame_rms: None,
            max_frame_rms: None,
            last_segment_rms: None,
            max_segment_rms: None,
            error: None,
        },
    );
}

fn emit_queue_metrics(app: &AppHandle, session_id: &str, translation_queue_size: usize) {
    emit_metrics(
        app,
        PipelineMetricsPayload {
            session_id: Some(session_id.to_string()),
            segment_id: None,
            stage: "queue".into(),
            status: "stats".into(),
            updated_at: Some(now_iso()),
            drop_reason: None,
            dropped_count: None,
            worker_id: None,
            audio_start: None,
            audio_end: None,
            audio_duration_ms: None,
            asr_duration_ms: None,
            translation_duration_ms: None,
            end_to_end_ms: None,
            queue_lag_ms: None,
            segment_queue_size: None,
            translation_queue_size: Some(translation_queue_size),
            frames: None,
            segments: None,
            low_energy_drops: None,
            last_frame_rms: None,
            max_frame_rms: None,
            last_segment_rms: None,
            max_segment_rms: None,
            error: None,
        },
    );
}

fn trim_context(context: &mut Vec<(String, String)>) {
    if context.len() > 8 {
        context.remove(0);
    }
}

fn rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum = samples
        .iter()
        .map(|sample| {
            let value = *sample as f64;
            value * value
        })
        .sum::<f64>();
    (sum / samples.len() as f64).sqrt() as f32
}

fn emit_status(app: &AppHandle, session_id: Option<String>, status: &str) {
    let _ = app.emit(
        "session:status",
        SessionStatusPayload {
            session_id,
            status: status.into(),
            updated_at: now_iso(),
        },
    );
}

fn emit_error(app: &AppHandle, code: &str, message: &str, recoverable: bool) {
    let _ = app.emit(
        "runtime:error",
        RuntimeErrorPayload {
            code: code.into(),
            message: message.into(),
            recoverable,
        },
    );
}

fn emit_metrics(app: &AppHandle, payload: PipelineMetricsPayload) {
    let _ = app.emit("pipeline:metrics", payload);
}

fn emit_drop_metrics(
    app: &AppHandle,
    session_id: &str,
    segment_id: &str,
    reason: &str,
    queue_lag: f32,
) {
    emit_metrics(
        app,
        PipelineMetricsPayload {
            session_id: Some(session_id.into()),
            segment_id: Some(segment_id.into()),
            stage: "drop".into(),
            status: "dropped".into(),
            updated_at: Some(now_iso()),
            drop_reason: Some(reason.into()),
            dropped_count: Some(1),
            worker_id: None,
            audio_start: None,
            audio_end: None,
            audio_duration_ms: None,
            asr_duration_ms: None,
            translation_duration_ms: None,
            end_to_end_ms: None,
            queue_lag_ms: Some(queue_lag * 1000.0),
            segment_queue_size: None,
            translation_queue_size: None,
            frames: None,
            segments: None,
            low_energy_drops: None,
            last_frame_rms: None,
            max_frame_rms: None,
            last_segment_rms: None,
            max_segment_rms: None,
            error: None,
        },
    );
}

/// Monitors audio activity and warns if no signal is detected.
async fn signal_monitor_task(
    frame_counter: Arc<AtomicU64>,
    segment_counter: Arc<AtomicU64>,
    token: CancellationToken,
    app: AppHandle,
    _session_id: String,
) {
    let mut last_frame_count = frame_counter.load(Ordering::Relaxed);
    let mut last_segment_count = segment_counter.load(Ordering::Relaxed);
    let mut last_activity = Instant::now();

    loop {
        tokio::select! {
            _ = token.cancelled() => break,
            _ = tokio::time::sleep(SIGNAL_CHECK_INTERVAL) => {}
        }

        let current_frames = frame_counter.load(Ordering::Relaxed);
        let current_segments = segment_counter.load(Ordering::Relaxed);

        if current_frames > last_frame_count || current_segments > last_segment_count {
            last_activity = Instant::now();
            last_frame_count = current_frames;
            last_segment_count = current_segments;
        } else if last_activity.elapsed() > NO_SIGNAL_THRESHOLD {
            emit_error(
                &app,
                "AUDIO_NO_SIGNAL",
                "No audio signal detected. Check your audio source.",
                true,
            );
            // Reset to avoid flooding — only emit once per threshold window.
            last_activity = Instant::now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_handles_empty_and_signal() {
        assert_eq!(rms(&[]), 0.0);
        assert!(rms(&[100, -100, 100, -100]) > 99.0);
    }

    #[test]
    fn sentence_complete_detects_punctuation() {
        assert!(is_sentence_complete("Hello world."));
        assert!(is_sentence_complete("Really?"));
        assert!(is_sentence_complete("Stop!"));
        assert!(is_sentence_complete("Wait…"));
        assert!(!is_sentence_complete("Hello world"));
        assert!(!is_sentence_complete("partial fragment"));
    }

    #[test]
    fn sentence_complete_accepts_long_comma_boundary() {
        let long = "This is a very long sentence that goes on and on, and eventually reaches the long threshold.";
        assert!(long.len() > 80);
        // Has sentence-ending punctuation, so should be complete
        assert!(is_sentence_complete(long));
    }

    #[test]
    fn sentence_complete_accepts_comma_uppercase_boundary() {
        // Comma followed by space + uppercase letter counts as boundary for long text
        let long = "This is a very long sentence that goes on and on, And eventually reaches the longer threshold";
        assert!(long.len() > 80);
        assert!(is_sentence_complete(long));
    }

    #[test]
    fn split_first_sentence_basic() {
        let (first, rest) = split_first_sentence("Hello world. Next sentence.");
        assert_eq!(first.as_deref(), Some("Hello world."));
        assert_eq!(rest, "Next sentence.");
    }

    #[test]
    fn split_first_sentence_no_boundary() {
        let (first, rest) = split_first_sentence("No punctuation here");
        assert_eq!(first, None);
        assert_eq!(rest, "No punctuation here");
    }

    #[test]
    fn join_source_text_cleans_whitespace() {
        assert_eq!(join_source_text(&["Hello", "world."]), "Hello world.");
        assert_eq!(join_source_text(&["Hello ", " world"]), "Hello world");
        assert_eq!(join_source_text(&["word ."]), "word.");
        assert_eq!(join_source_text(&["", "  ", "text"]), "text");
    }
}
