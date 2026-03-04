param(
 [string]$Out = "submission.zip",
 [switch]$CleanIgnored
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command([string]$name) {
 if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
 throw "Missing required command: $name"
 }
}

Require-Command git

# Optionally remove ignored build artifacts/caches to reduce local disk size.
# This does NOT touch tracked source files.
if ($CleanIgnored) {
 Write-Host "Cleaning ignored files (node_modules, .next, etc.)..." -ForegroundColor Cyan
 git clean -fdX | Out-Host
}

# Exclude stuff that should never be in a submission zip.
$deny = @(
 "node_modules/",
 ".next/",
 ".git/",
 ".env.local",
 "*.tgz",
 "*.zip"
)

Write-Host "Collecting tracked files..." -ForegroundColor Cyan
$files = git ls-files | Where-Object { $_ -and ($_ -notmatch "^\.git/") }

# Filter tracked files against deny list (defensive; tracked files should already be clean).
$filtered = @()
foreach ($f in $files) {
 $skip = $false
 foreach ($d in $deny) {
 if ($d.EndsWith("/")) {
 if ($f.StartsWith($d)) { $skip = $true; break }
 } elseif ($d.Contains("*")) {
 if ($f -like $d) { $skip = $true; break }
 } else {
 if ($f -eq $d) { $skip = $true; break }
 }
 }
 if (-not $skip) { $filtered += $f }
}

# Only include files that currently exist on disk.
$existing = $filtered | Where-Object { Test-Path $_ }

if (Test-Path $Out) { Remove-Item $Out -Force }

Write-Host "Creating zip: $Out" -ForegroundColor Cyan
Compress-Archive -Path $existing -DestinationPath $Out -CompressionLevel Optimal

$zipInfo = Get-Item $Out
Write-Host ("Done. {0:N1} KB" -f ($zipInfo.Length /1KB)) -ForegroundColor Green
