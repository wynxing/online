$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

python -m PyInstaller --clean --noconfirm runtime\ai-interpretation-runtime.spec

$targetTriple = "x86_64-pc-windows-msvc"
$sidecarDir = Join-Path $root "apps\desktop\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $sidecarDir | Out-Null

$source = Join-Path $root "dist\ai-interpretation-runtime.exe"
$target = Join-Path $sidecarDir "ai-interpretation-runtime-$targetTriple.exe"
Copy-Item -Force -LiteralPath $source -Destination $target

Write-Host "Built runtime sidecar: $target"
