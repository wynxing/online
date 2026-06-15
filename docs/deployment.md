# Deployment

The desktop app is packaged directly by Tauri. There is no Python runtime build step and no sidecar binary.

## Local Release Build

```powershell
npm run release:local
```

This runs:

1. `npm install`
2. `npm run tauri -- build`

## CI Release Build

The release workflow builds Windows x64, macOS x64, macOS arm64, and Linux x64 bundles. Each job installs Node and Rust, runs frontend tests, runs Rust tests, then invokes Tauri build.

Linux jobs install WebKit, appindicator, SVG, patchelf, and ALSA development packages required by Tauri and audio capture.

## Update Manifest

Release publishing still generates `latest.json` with `scripts/generate-latest-json.mjs` and uploads it with the Tauri bundle artifacts.
