$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

npm install
python -m pip install -r runtime\requirements.txt
.\scripts\build-runtime-sidecar.ps1
npm run tauri -- build
