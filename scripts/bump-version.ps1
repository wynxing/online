param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# UTF-8 encoding without BOM
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Remove leading 'v' if present
$Version = $Version -replace '^v', ''

Write-Host "Bumping version to $Version"

# Update apps/desktop/package.json
$desktopPkg = Join-Path $PSScriptRoot "..\apps\desktop\package.json"
$desktopContent = Get-Content $desktopPkg -Raw | ConvertFrom-Json
$desktopContent.version = $Version
$json = $desktopContent | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($desktopPkg, $json, $utf8NoBom)
Write-Host "  Updated apps/desktop/package.json"

# Update apps/desktop/src-tauri/tauri.conf.json
$tauriConf = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\tauri.conf.json"
$tauriContent = Get-Content $tauriConf -Raw | ConvertFrom-Json
$tauriContent.version = $Version
$json = $tauriContent | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($tauriConf, $json, $utf8NoBom)
Write-Host "  Updated apps/desktop/src-tauri/tauri.conf.json"

# Update apps/desktop/src-tauri/Cargo.toml
# Only replace the standalone `version = "..."` line under [package], not dependency versions
$cargoToml = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\Cargo.toml"
$cargoContent = Get-Content $cargoToml -Raw
$cargoContent = $cargoContent -replace '(?m)^version = ".*"', "version = `"$Version`""
[System.IO.File]::WriteAllText($cargoToml, $cargoContent, $utf8NoBom)
Write-Host "  Updated apps/desktop/src-tauri/Cargo.toml"

# Verify all files have the same version
Write-Host "`nVerifying version consistency..."

$desktopPkgCheck = (Get-Content $desktopPkg -Raw | ConvertFrom-Json).version
$tauriConfCheck = (Get-Content $tauriConf -Raw | ConvertFrom-Json).version
$cargoTomlCheck = (Get-Content $cargoToml -Raw | Select-String '(?m)^version = "(.*)"').Matches.Groups[1].Value

if ($desktopPkgCheck -ne $Version -or $tauriConfCheck -ne $Version -or $cargoTomlCheck -ne $Version) {
    Write-Error "Version mismatch detected! Expected: $Version"
    Write-Host "  apps/desktop/package.json: $desktopPkgCheck"
    Write-Host "  apps/desktop/src-tauri/tauri.conf.json: $tauriConfCheck"
    Write-Host "  apps/desktop/src-tauri/Cargo.toml: $cargoTomlCheck"
    exit 1
}

Write-Host "✓ All files have consistent version: $Version"

Write-Host "`nVersion bumped to $Version in all files."
Write-Host "Next steps:"
Write-Host "  1. git add -A"
Write-Host "  2. git commit -m 'chore: release v$Version'"
Write-Host "  3. git tag v$Version"
Write-Host "  4. git push origin main --tags"
