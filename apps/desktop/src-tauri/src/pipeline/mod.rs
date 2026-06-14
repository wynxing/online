use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

use tauri::{AppHandle, Emitter};
use tokio::{sync::mpsc, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use crate::{
    api::{encode_wav, AsrClient, TranslationClient},
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
        self.inner.lock().unwrap().is_some()
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
            let mut guard = inner.lock().unwrap();
            if guard
                .as_ref()
                .map(|active| active.session_id == cleanup_session_id)
                .unwrap_or(false)
            {
                *guard = None;
            }
        });
        *self.inner.lock().unwrap() = Some(ActivePipeline {
            session_id: active_session_id,
            cancel,
            handle,
        });
        Ok(())
    }

    pub async fn stop(&self) -> Option<String> {
        let active = self.inner.lock().unwrap().take();
        if let Some(active) = active {
            active.cancel.cancel();
            let _ = active.handle.await;
            return Some(active.session_id);
        }
        None
    }

    pub fn blocking_stop(&self) {
        if let Some(active) = self.inner.lock().unwrap().take() {
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
            std::thread::spawn(move || {
                let _ = rt.block_on(handle);
            })
            .join()
            .ok();
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

    let segmenter = tokio::spawn(segmenter_task(
        audio_rx,
        segment_tx,
        config.clone(),
        token.clone(),
        app.clone(),
        session_id.clone(),
    ));
    let asr = tokio::spawn(asr_task(
        segment_rx,
        asr_tx,
        AsrClient::from_config(&config),
        token.clone(),
        app.clone(),
        session_id.clone(),
    ));
    let translation = tokio::spawn(translation_task(
        asr_rx,
        TranslationClient::from_config(&config),
        session_id.clone(),
        request.source_lang,
        request.target_lang,
        glossary,
        token.clone(),
        app.clone(),
        storage,
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
    let _ = translation.await;
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
}

#[derive(Debug)]
struct RecognizedSegment {
    id: String,
    source_text: String,
    start_time: f32,
    end_time: f32,
    asr_ms: f32,
}

async fn segmenter_task(
    mut rx: mpsc::Receiver<AudioFrame>,
    tx: mpsc::Sender<AudioSegment>,
    config: RuntimeConfig,
    token: CancellationToken,
    app: AppHandle,
    session_id: String,
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
                    };
                    segment_start = stream_time;
                    if tx.send(segment).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
}

async fn asr_task(
    mut rx: mpsc::Receiver<AudioSegment>,
    tx: mpsc::Sender<RecognizedSegment>,
    asr: AsrClient,
    token: CancellationToken,
    app: AppHandle,
    session_id: String,
) {
    while let Some(segment) = rx.recv().await {
        if token.is_cancelled() {
            break;
        }
        let started = Instant::now();
        let wav = encode_wav(&segment.samples, segment.channels, segment.sample_rate);
        match asr.transcribe(wav).await {
            Ok(source_text) if !source_text.is_empty() => {
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
                let _ = tx
                    .send(RecognizedSegment {
                        id: segment.id,
                        source_text,
                        start_time: segment.start_time,
                        end_time: segment.end_time,
                        asr_ms,
                    })
                    .await;
            }
            Ok(_) => {}
            Err(error) => emit_error(&app, "ASR_FAILED", &error.to_string(), true),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn translation_task(
    mut rx: mpsc::Receiver<RecognizedSegment>,
    mut translation: TranslationClient,
    session_id: String,
    source_lang: String,
    target_lang: String,
    glossary: Vec<GlossaryTerm>,
    token: CancellationToken,
    app: AppHandle,
    storage: Storage,
) {
    let mut context = Vec::<(String, String)>::new();
    while let Some(segment) = rx.recv().await {
        if token.is_cancelled() {
            break;
        }
        let started = Instant::now();
        match translation
            .translate(
                &segment.source_text,
                &source_lang,
                &target_lang,
                &glossary,
                &context,
            )
            .await
        {
            Ok(translated_text) => {
                let translation_ms = started.elapsed().as_secs_f32() * 1000.0;
                let subtitle = SubtitleSegment {
                    id: segment.id.clone(),
                    session_id: session_id.clone(),
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
                emit_metrics(
                    &app,
                    PipelineMetricsPayload {
                        session_id: Some(subtitle.session_id.clone()),
                        segment_id: Some(segment.id),
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
                context.push((segment.source_text, translated_text));
                if context.len() > 8 {
                    context.remove(0);
                }
            }
            Err(error) => emit_error(&app, "TRANSLATION_FAILED", &error.to_string(), true),
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_handles_empty_and_signal() {
        assert_eq!(rms(&[]), 0.0);
        assert!(rms(&[100, -100, 100, -100]) > 99.0);
    }
}
