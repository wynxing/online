param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$BundleDir,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

# Normalize version (strip leading 'v' for JSON, Tauri accepts both but let's be clean)
$jsonVersion = $Version -replace '^v', ''

# Locate installer files and their signatures
$nsisExe = Get-ChildItem -Path "$BundleDir\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$msiFile = Get-ChildItem -Path "$BundleDir\msi\*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $nsisExe -and -not $msiFile) {
    Write-Error "No installer artifacts found in $BundleDir"
    exit 1
}

$platforms = @{}

# GitHub Releases base URL for asset downloads
# The caller must set GITHUB_REPO env var (owner/repo format)
$repo = $env:GITHUB_REPO
if (-not $repo) {
    Write-Warning "GITHUB_REPO not set; using placeholder URL"
    $repo = "OWNER/REPO"
}

$baseUrl = "https://github.com/$repo/releases/download/$Version"

if ($nsisExe) {
    $sigFile = "$($nsisExe.FullName).sig"
    if (-not (Test-Path $sigFile)) {
        Write-Error "Signature file not found: $sigFile"
        exit 1
    }
    $signature = (Get-Content $sigFile -Raw).Trim()
    $platforms["windows-x86_64"] = @{
        signature = $signature
        url       = "$baseUrl/$($nsisExe.Name)"
    }
    Write-Host "  Registered NSIS: $($nsisExe.Name)"
}

if ($msiFile) {
    $sigFile = "$($msiFile.FullName).sig"
    if (-not (Test-Path $sigFile)) {
        Write-Error "Signature file not found: $sigFile"
        exit 1
    }
    $signature = (Get-Content $sigFile -Raw).Trim()
    $platforms["windows-x86_64-msi"] = @{
        signature = $signature
        url       = "$baseUrl/$($msiFile.Name)"
    }
    Write-Host "  Registered MSI: $($msiFile.Name)"
}

$manifest = @{
    version  = $jsonVersion
    notes    = "See release notes for details"
    pub_date = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    platforms = $platforms
}

$manifest | ConvertTo-Json -Depth 10 | Set-Content $OutputPath -Encoding UTF8
Write-Host "Generated update manifest: $OutputPath"
Write-Host "  Version: $jsonVersion"
Write-Host "  Platforms: $($platforms.Keys -join ', ')"
