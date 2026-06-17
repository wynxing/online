# Development Guide

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 22+ |
| npm | 10+ |
| Rust | stable |

Python is no longer required for normal development or packaging.

## Setup

```powershell
npm install
npm run tauri:dev
```

The Rust runtime is embedded in Tauri. The frontend communicates with it through Tauri commands and events.

Frontend-only mode:

```powershell
npm run desktop
```

## Useful Checks

```powershell
npm run lint
npm test
npm run desktop:build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Runtime Modules

```text
apps/desktop/src-tauri/src/
+-- commands/      # Tauri invoke handlers
+-- api/           # ASR sanitization, ASR client, translation client
+-- audio/         # Device discovery and capture backends
+-- pipeline/      # Capture, DSP, segment, ASR, hallucination filter, translation, emit
|   +-- mod.rs     # Main pipeline orchestrator
|   +-- audio_dsp.rs  # Denoise, normalize, resample
+-- storage/       # SQLite persistence
+-- models.rs      # Serde models shared with TypeScript
+-- state.rs       # App state
```

The audio module uses native WASAPI loopback on Windows. macOS and Linux use `cpal` input capture with platform-specific system-source classification for virtual or monitor devices.

## Logs And Data

Runtime data defaults to `~/.online/`.

```text
~/.online/runtime.sqlite3
~/.online/logs/runtime.log
```

Use `ONLINE_DATA_DIR` to override this location during testing.
