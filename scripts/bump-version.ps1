param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Make the console render non-ASCII (e.g. the tauri.conf.json title) correctly
# on zh-CN / ja-JP / ko-KR systems where the OEM codepage is not UTF-8.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# UTF-8 encoding without BOM
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Remove leading 'v' if present
$Version = $Version -replace '^v', ''

Write-Host "Bumping version to $Version"

# Update apps/desktop/package.json
$desktopPkg = Join-Path $PSScriptRoot "..\apps\desktop\package.json"
$desktopContent = [System.IO.File]::ReadAllText($desktopPkg, $utf8NoBom) | ConvertFrom-Json
$desktopContent.version = $Version
$json = $desktopContent | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($desktopPkg, $json, $utf8NoBom)
Write-Host "  Updated apps/desktop/package.json"

# Update apps/desktop/src-tauri/tauri.conf.json
$tauriConf = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\tauri.conf.json"
$tauriContent = [System.IO.File]::ReadAllText($tauriConf, $utf8NoBom) | ConvertFrom-Json
$tauriContent.version = $Version
# Snapshot a non-ASCII field before write so we can verify the round-trip
# did not introduce encoding corruption (version-only checks can't see this).
$tauriTitleBefore = $tauriContent.app.windows[0].title
$json = $tauriContent | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($tauriConf, $json, $utf8NoBom)
Write-Host "  Updated apps/desktop/src-tauri/tauri.conf.json"

# Update apps/desktop/src-tauri/Cargo.toml
# Only replace the standalone `version = "..."` line under [package], not dependency versions
$cargoToml = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\Cargo.toml"
$cargoContent = [System.IO.File]::ReadAllText($cargoToml, $utf8NoBom)
$cargoContent = $cargoContent -replace '(?m)^version = ".*"', "version = `"$Version`""
[System.IO.File]::WriteAllText($cargoToml, $cargoContent, $utf8NoBom)
Write-Host "  Updated apps/desktop/src-tauri/Cargo.toml"

# Verify all files have the same version
Write-Host "`nVerifying version consistency..."

$desktopPkgCheck = ([System.IO.File]::ReadAllText($desktopPkg, $utf8NoBom) | ConvertFrom-Json).version
$tauriConfCheck = ([System.IO.File]::ReadAllText($tauriConf, $utf8NoBom) | ConvertFrom-Json).version
$cargoTomlCheck = ([System.IO.File]::ReadAllText($cargoToml, $utf8NoBom) | Select-String '(?m)^version = "(.*)"').Matches.Groups[1].Value
$tauriTitleAfter = ([System.IO.File]::ReadAllText($tauriConf, $utf8NoBom) | ConvertFrom-Json).app.windows[0].title

if ($desktopPkgCheck -ne $Version -or $tauriConfCheck -ne $Version -or $cargoTomlCheck -ne $Version) {
    Write-Error "Version mismatch detected! Expected: $Version"
    Write-Host "  apps/desktop/package.json: $desktopPkgCheck"
    Write-Host "  apps/desktop/src-tauri/tauri.conf.json: $tauriConfCheck"
    Write-Host "  apps/desktop/src-tauri/Cargo.toml: $cargoTomlCheck"
    exit 1
}

Write-Host "✓ All files have consistent version: $Version"

# Regression guard: non-ASCII content must survive the write round-trip.
# Version checks alone are blind to encoding corruption (version is ASCII),
# so compare a known non-ASCII field against its pre-write snapshot.
if ($tauriTitleBefore -ne $tauriTitleAfter) {
    Write-Error "tauri.conf.json content was corrupted by the write round-trip!"
    Write-Host "  title before: $tauriTitleBefore"
    Write-Host "  title after:  $tauriTitleAfter"
    exit 1
}
Write-Host "  tauri.conf.json title: $tauriTitleAfter"

# Refresh package-lock.json explicitly so the workspace version follows the
# desktop package version. Missing tools and refresh failures are fatal.
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required to refresh package-lock.json"
}
Write-Host "`nRefreshing package-lock.json..."
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& npm install --package-lock-only --ignore-scripts 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Host $_ }
$npmExit = $LASTEXITCODE
$ErrorActionPreference = $prevPref
if ($npmExit -ne 0) {
    throw "npm lockfile refresh failed with exit code $npmExit"
}

# Refresh Cargo.lock so it stays in sync with Cargo.toml. Without this, a
# release commit can ship with Cargo.lock trailing Cargo.toml (as happened
# for v0.4.3). cargo not on PATH is non-fatal -- the user can run it
# manually before committing.
$cargoManifest = Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\Cargo.toml"
if (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host "`nRefreshing Cargo.lock..."
    # PowerShell 5.1 turns any native-command stderr write into a non-terminating
    # error, which under $ErrorActionPreference='Stop' halts the script. cargo
    # always writes "Compiling..." to stderr, so temporarily relax the
    # preference for this call.
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & cargo check --manifest-path $cargoManifest --message-format=short 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Host $_ }
    $cargoExit = $LASTEXITCODE
    $ErrorActionPreference = $prevPref
    if ($cargoExit -ne 0) {
        throw "cargo lockfile refresh failed with exit code $cargoExit"
    } else {
        Write-Host "✓ Cargo.lock updated"
    }
} else {
    throw "cargo is required to refresh Cargo.lock"
}

Write-Host "`nVerifying all version metadata..."
$versionCheck = Join-Path $PSScriptRoot "check-version-consistency.mjs"
& node $versionCheck --expected $Version
if ($LASTEXITCODE -ne 0) {
    throw "Version consistency check failed"
}

Write-Host "`nVersion bumped to $Version in all files."
Write-Host "Next steps:"
Write-Host "  1. git add -A"
Write-Host "  2. git commit -m 'chore: release v$Version'"
Write-Host "  3. git tag v$Version"
Write-Host "  4. git push origin main --tags"
