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
    +-- segmentation pipeline
    +-- ASR client
    +-- translation client
    +-- SQLite storage
    +-- Tauri event emitter
```

The runtime is embedded in the Tauri process. The app no longer starts a Python process, binds a local HTTP port, or uses WebSocket transport.

## Audio Capture

Audio devices are discovered through platform-specific backends behind the Rust `audio` module:

- Windows uses native WASAPI. Render endpoints are exposed as `wasapi_loopback_*` system-audio sources, followed by capture endpoints as `wasapi_mic_*` microphone sources.
- macOS and Linux use `cpal` input devices. Virtual audio devices such as BlackHole, Loopback, Soundflower, and PulseAudio/PipeWire monitor sources are classified as `system`; other inputs are classified as `microphone`.
- Legacy ids such as `system_loopback`, `default_microphone`, and an empty id resolve to the best available current device.

Captured frames carry their source sample rate and channel count through the pipeline, so segmentation no longer assumes 48 kHz mono audio.

## Data Flow

```text
Audio capture -> segmenter -> ASR -> translation -> storage -> Tauri events -> React UI
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
