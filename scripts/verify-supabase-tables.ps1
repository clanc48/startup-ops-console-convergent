param(
 [string]$Table,
 [string]$Schema = "public",
 [switch]$List
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-EnvValue([string]$path, [string]$key) {
 if (-not (Test-Path $path)) { return $null }
 $raw = Get-Content $path -Raw
 $m = [regex]::Match($raw, "(?m)^" + [regex]::Escape($key) + "\s*=\s*(.+)$")
 if (-not $m.Success) { return $null }
 return $m.Groups[1].Value.Trim()
}

$sbUrl = $env:NEXT_PUBLIC_SUPABASE_URL
if ([string]::IsNullOrWhiteSpace($sbUrl)) { $sbUrl = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_URL" }

$pub = $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if ([string]::IsNullOrWhiteSpace($pub)) { $pub = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" }

if ([string]::IsNullOrWhiteSpace($sbUrl) -or [string]::IsNullOrWhiteSpace($pub)) {
 throw "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in environment or .env.local"
}

$headers = @{ apikey = $pub; Authorization = ("Bearer " + $pub) }

function Invoke-Postgrest([string]$path) {
 $url = $sbUrl.TrimEnd('/') + $path
 Invoke-RestMethod -Method GET -Uri $url -Headers $headers
}

if ($List) {
 $encodedSchema = [uri]::EscapeDataString($Schema)
 $rows = Invoke-Postgrest ("/rest/v1/information_schema_tables?table_schema=eq.$encodedSchema&select=table_name")
 $rows | Select-Object -ExpandProperty table_name | Sort-Object
 exit0
}

if (-not $Table) {
 throw "Provide -Table <name> or use -List"
}

$encodedSchema = [uri]::EscapeDataString($Schema)
$encodedTable = [uri]::EscapeDataString($Table)
$rows = Invoke-Postgrest ("/rest/v1/information_schema_tables?table_schema=eq.$encodedSchema&table_name=eq.$encodedTable&select=table_name")

if ($null -ne $rows -and $rows.Count -gt0) {
 Write-Host "OK: Found table $Schema.$Table" -ForegroundColor Green
 exit0
}

Write-Host "MISSING: Table not found: $Schema.$Table" -ForegroundColor Red
exit2
