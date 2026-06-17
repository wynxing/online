# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-06-15

### Added

- **Audio DSP preprocessing** — RNN-based denoise (`nnnoiseless`) and peak normalization applied before ASR, configurable via `audio_denoise_enabled` and `audio_peak_normalize_enabled` in RuntimeConfig.
- **ASR hallucination detection** — Whisper repeating-prompt filter in the pipeline; suspected hallucinations are dropped and consecutive counts tracked.
- **ASR output sanitizer** — rejects known Whisper noise outputs (e.g. "thank you", "subscribe") at the API client layer before they reach translation.

### Fixed

- Clippy warning resolved (`unnecessary_map_or`); `cargo fmt` applied.

## [0.6.0] - 2026-06-15

### Added

- **VAD toggle** — `vad_enabled` config field and UI checkbox in Settings panel, allowing users to enable/disable voice activity detection.
- **Translation prompt improvement** — refined system prompt for better translation quality.
- **SSE byte-level parsing** — improved streaming response parsing for translation API.

## [0.5.0] - 2026-06-14

### Changed

- **Runtime migrated from Python to Rust/Tauri** — removed `runtime/` directory (29 Python files) + PyInstaller sidecar build. The entire backend now runs as native Rust inside the Tauri process.
- **Audio capture** — WASAPI loopback (Windows) + cpal (cross-platform) replaces SoundCard Python wrapper.
- **ASR** — dual-mode Whisper API + Chat Completions replaces Python OpenAI client.
- **Translation** — LRU cache with language-pair keys, glossary enforcement with literal replacement, context window.
- **Pipeline** — Tokio channel 3-stage async pipeline (audio → ASR → translation) replaces Python asyncio pipeline.
- **Storage** — SQLite via rusqlite with WAL mode replaces Python JSON file storage.
- **IPC** — 13 Tauri commands (`invoke`/`listen`) replace REST API + WebSocket. API keys are redacted in IPC responses.
- **Frontend** — migrated from HTTP/WS to Tauri invoke/listen IPC.

### Removed

- Python FastAPI sidecar runtime and PyInstaller build.
- Demo/mock mode.
- JSON config file (now stored in SQLite).

### Breaking

- Old session data is **not** migrated (by design).
- Config format changed (now stored in SQLite instead of JSON file).

### Fixed

- API keys no longer leak through Debug output or IPC boundary.
- `blocking_stop` now waits for cleanup (session `ended_at` is written to SQLite).
- Translation cache keys include language pair to prevent cross-language cache hits.
- Glossary replacement uses literal strings (no capture group expansion).
- IPC metrics throttled to 300ms instead of per-frame (~100/s).
- Regex patterns precompiled with `LazyLock` instead of per-call compilation.
- RMS computed once per frame (reused for silence gate).
- IO errors use dedicated `AppError::Io` variant instead of misusing rusqlite error.
- Storage tests use temporary directories instead of `set_var`.
- CI now runs `cargo clippy` and `cargo fmt --check`.
- CI and release workflows use consistent Node.js 22.

