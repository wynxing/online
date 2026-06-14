# AI Interpretation Assistant

Desktop app for real-time bilingual subtitles. The app captures local audio, sends segments to OpenAI-compatible ASR and translation APIs, and renders live subtitles in the main console or a floating window.

## Stack

| Layer | Technology |
| --- | --- |
| Desktop runtime | Tauri v2 + Rust |
| Runtime backend | Embedded Rust commands, events, Tokio pipeline |
| UI | React 18 + TypeScript + Vite |
| Storage | SQLite via `rusqlite` |
| AI services | OpenAI-compatible ASR and chat completions |
| Packaging | Tauri bundles |

## Development

```powershell
npm install
npm run tauri:dev
```

The runtime is embedded in the Tauri process. There is no Python service, sidecar binary, HTTP port, or WebSocket server to start.

For frontend-only iteration:

```powershell
npm run desktop
```

## Data

Runtime data is stored under `~/.online/` by default:

```text
~/.online/
├── runtime.sqlite3
└── logs/
    └── runtime.log
```

Set `ONLINE_DATA_DIR` to override the data directory.

## Build And Test

```powershell
npm run lint
npm run test
npm run desktop:build
cd apps/desktop/src-tauri
cargo test
```

Local release build:

```powershell
npm run release:local
```

## Project Layout

```text
apps/desktop/
├── src/                 # React UI
└── src-tauri/
    ├── src/
    │   ├── commands/    # Tauri command surface
    │   ├── api/         # ASR and translation clients
    │   ├── audio/       # Native audio device/capture boundary
    │   ├── pipeline/    # Capture -> ASR -> translation -> events
    │   ├── storage/     # SQLite persistence
    │   ├── models.rs
    │   └── state.rs
    └── tauri.conf.json
docs/
scripts/
```

## Notes

- The user-visible mock/demo mode has been removed.
- Existing Python runtime files are no longer part of development, CI, or packaging.
- Version `0.5.0` is the Rust embedded-runtime release line.
