# Architecture

## Overview

```text
Desktop App (Tauri v2)
+-- React UI
|   +-- invoke(command)
|   +-- listen(event)
+-- Rust runtime
    +-- commands
    +-- audio capture
    +-- pipeline
    |   +-- audio DSP (denoise, normalize, resample)
    |   +-- segmenter (VAD)
    |   +-- ASR workers
    |   +-- hallucination filter
    |   +-- translation workers
    |   +-- Tauri event emitter
    +-- ASR client (sanitizer + Whisper)
    +-- translation client (glossary + cache)
    +-- SQLite storage
```

The runtime is embedded in the Tauri process. The app no longer starts a Python process, binds a local HTTP port, or uses WebSocket transport.

## Audio Capture

Audio devices are discovered through platform-specific backends behind the Rust `audio` module:

- Windows uses native WASAPI. Render endpoints are exposed as `wasapi_loopback_*` system-audio sources, followed by capture endpoints as `wasapi_mic_*` microphone sources.
- macOS and Linux use `cpal` input devices. Virtual audio devices such as BlackHole, Loopback, Soundflower, and PulseAudio/PipeWire monitor sources are classified as `system`; other inputs are classified as `microphone`.
- Legacy ids such as `system_loopback`, `default_microphone`, and an empty id resolve to the best available current device.

Captured frames carry their source sample rate and channel count through the pipeline, so segmentation no longer assumes 48 kHz mono audio.

## Audio DSP

Before reaching the ASR stage, audio frames pass through a preprocessing chain (`pipeline/audio_dsp.rs`):

1. **Denoise** — RNN-based noise suppression via `nnnoiseless`. Runs on 48 kHz mono input; skipped for other sample rates. Persistent state across frames for temporal modeling.
2. **Mono downmix** — multi-channel audio is averaged to mono.
3. **Resample** — resampled to 16 kHz (ASR target) via `rubato` sinc resampler.
4. **Peak normalization** — amplifies quiet audio or attenuates clipping to a target peak level.

Denoise and peak normalization are individually configurable via `audio_denoise_enabled` and `audio_peak_normalize_enabled` in RuntimeConfig.

## ASR Hallucination Detection

Whisper models can produce hallucinated output (e.g. repeating the previous prompt). The pipeline detects this by comparing new ASR output against the most recent source text:

- **Exact match** after case/whitespace normalization → dropped as hallucination.
- **Substring containment** with high length ratio (>0.8) → dropped as hallucination.
- Consecutive hallucination counts are tracked; metrics still update so the UI stays responsive.

Known Whisper noise phrases (e.g. "thank you for watching", "subscribe") are also rejected by the ASR client's sanitizer before they reach translation.

## Data Flow

```text
Audio capture -> DSP (denoise/normalize/resample) -> segmenter (VAD) -> ASR -> hallucination filter -> translation -> storage -> Tauri events -> React UI
```

The pipeline uses bounded Tokio channels and cancellation tokens. `stop_session` cancels the active pipeline, waits for tasks to finish, marks the session ended, and returns the saved session record.

## Storage

SQLite lives under `~/.online/runtime.sqlite3` unless `ONLINE_DATA_DIR` is set. The schema stores runtime config, sessions, subtitle segments, and glossary terms.

## Frontend Contract

Rust models serialize with camelCase field names so the TypeScript contracts remain stable:

- `RuntimeConfig`
- `Device`
- `SessionRecord`
- `SubtitleSegment`
- `GlossaryTerm`
