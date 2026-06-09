param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Remove leading 'v' if present
$Version = $Version -replace '^v', ''

Write-Host "Bumping version to $Version"

# Update apps/desktop/package.json
$desktopPkg = Join-Path $PSScriptRoot "..\apps\desktop\package.json"
$desktopContent = Get-Content $desktopPkg -Raw | ConvertFrom-Json
$desktopContent.version = $Version
$desktopContent | ConvertTo-Json -Depth 10 | Set-Content $desktopPkg -Encoding UTF8
Write-Host "  Updated apps/desktop/package.json"

# Update apps/desktop/src-tauri/tauri.conf.json
$tauriConf = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\tauri.conf.json"
$tauriContent = Get-Content $tauriConf -Raw | ConvertFrom-Json
$tauriContent.version = $Version
$tauriContent | ConvertTo-Json -Depth 10 | Set-Content $tauriConf -Encoding UTF8
Write-Host "  Updated apps/desktop/src-tauri/tauri.conf.json"

# Update apps/desktop/src-tauri/Cargo.toml
$cargoToml = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\Cargo.toml"
$cargoContent = Get-Content $cargoToml -Raw
$cargoContent = $cargoContent -replace 'version = ".*"', "version = `"$Version`""
$cargoContent | Set-Content $cargoToml -Encoding UTF8
Write-Host "  Updated apps/desktop/src-tauri/Cargo.toml"

Write-Host "`nVersion bumped to $Version in all files."
Write-Host "Next steps:"
Write-Host "  1. git add -A"
Write-Host "  2. git commit -bchore: release v$Version"
Write-Host "  3. git tag v$Version"
Write-Host "  4. git push origin main --tags"
