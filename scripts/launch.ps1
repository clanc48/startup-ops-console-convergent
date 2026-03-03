param(
  [switch]$Dev,
  [switch]$Prod,
  [switch]$NoInstall,
  [switch]$SkipMigrations,
  [switch]$Debug
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Write .env files as UTF-8 *without BOM* (Supabase CLI can fail to parse BOM on Windows)
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Require-Command([string]$name, [string]$installHint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required command '$name'. $installHint"
  }
}

function Write-Step([string]$msg) { Write-Host ("`n==> " + $msg) -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host $msg -ForegroundColor Red }
function Write-Dbg([string]$msg)  { if ($Debug) { Write-Host ("[debug] " + $msg) -ForegroundColor DarkGray } }

function Prompt([string]$msg, [string]$default = "") {
  if ([string]::IsNullOrWhiteSpace($default)) {
    return Read-Host $msg
  }
  $v = Read-Host "$msg [$default]"
  if ([string]::IsNullOrWhiteSpace($v)) { return $default }
  return $v
}

function Prompt-Secret([string]$msg) {
  $sec = Read-Host $msg -AsSecureString
  return (New-Object System.Net.NetworkCredential("", $sec)).Password
}

function Ensure-SupabaseCli {
  # Prefer a locally installed CLI if present; otherwise fall back to npx.
  $localCli = Join-Path (Get-Location) "node_modules/.bin/supabase.cmd"
  if (Test-Path $localCli) { return }

  try {
    npx --yes supabase --version | Out-Null
    return
  } catch {
    # continue
  }

  Write-Warn "Supabase CLI not found. We'll install it as a dev dependency (adds to package.json)."
  Write-Warn "If you prefer global install, cancel and run: npm i -g supabase"
  Write-Step "Installing Supabase CLI (npm i -D supabase)"
  npm i -D supabase
}

function Read-EnvValue([string]$path, [string]$key) {
  if (-not (Test-Path $path)) { return $null }
  $raw = Get-Content $path -Raw
  $m = [regex]::Match($raw, "(?m)^" + [regex]::Escape($key) + "\s*=\s*(.+)$")
  if (-not $m.Success) { return $null }
  
  $val = $m.Groups[1].Value.Trim()
  # Handle quotes around the value
  if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
    if ($val.Length -ge 2) {
      $val = $val.Substring(1, $val.Length - 2)
    }
  }
  return $val
}

function Set-EnvValue([string]$path, [string]$key, [string]$value) {
  $lines = @()
  if (Test-Path $path) { $lines = Get-Content $path }

  $re = "^" + [regex]::Escape($key) + "\s*="
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $re) {
      $lines[$i] = "$key=$value"
      $found = $true
    }
  }
  if (-not $found) {
    $lines += "$key=$value"
  }

  # Ensure UTF-8 without BOM to keep Supabase CLI happy on Windows
  [System.IO.File]::WriteAllLines((Resolve-Path $path), $lines, $script:Utf8NoBom)
}

function Ensure-EnvUtf8NoBom([string]$path) {
  if (-not (Test-Path $path)) { return }
  $text = Get-Content -Path $path -Raw
  if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) {
    $text = $text.TrimStart([char]0xFEFF)
  }
  [System.IO.File]::WriteAllText((Resolve-Path $path), $text, $script:Utf8NoBom)
}

function Require-NonEmpty([string]$name, [string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required but was empty."
  }
}

function Validate-SupabaseUrl([string]$sbUrl) {
  if (-not ($sbUrl -match "^https://[a-z0-9-]+\.supabase\.co/?$")) {
    throw "NEXT_PUBLIC_SUPABASE_URL doesn't look valid. Expected https://<project-ref>.supabase.co"
  }
}

function Validate-PublishableKey([string]$pub) {
  # New style: sb_publishable_...
  # Legacy anon key can be JWT-like (eyJ...)
  if (-not ($pub -match "^(sb_publishable_[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]+)$")) {
    throw "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY doesn't look valid. Expected sb_publishable_... or a JWT-like anon key starting with eyJ."
  }
}

function Validate-ServiceRoleKey([string]$srv) {
  if ([string]::IsNullOrWhiteSpace($srv)) { throw "SUPABASE_SERVICE_ROLE_KEY is required." }
  if (-not ($srv -match "^eyJ[A-Za-z0-9._-]+$")) {
    throw "SUPABASE_SERVICE_ROLE_KEY doesn't look valid. Expected a JWT-like key starting with eyJ." 
  }
}

function Get-ProjectRefFromUrl([string]$sbUrl) {
  $m = [regex]::Match($sbUrl, "https://([a-z0-9-]+)\.supabase\.co", "IgnoreCase")
  if ($m.Success) { return $m.Groups[1].Value }
  return ""
}

function Ensure-MigrationsFromSchema {
  # If migrations folder only has empty files, create a proper migration from supabase/schema.sql
  if (-not (Test-Path "supabase/schema.sql")) {
    Write-Dbg "No supabase/schema.sql found; skipping migration bootstrap."
    return
  }

  if (-not (Test-Path "supabase/migrations")) {
    New-Item -ItemType Directory -Path "supabase/migrations" | Out-Null
  }

  $migs = Get-ChildItem "supabase/migrations" -Filter "*.sql" -ErrorAction SilentlyContinue
  $hasNonEmpty = $false
  foreach ($m in $migs) {
    if ($m.Length -gt 0) { $hasNonEmpty = $true; break }
  }

  if ($hasNonEmpty) {
    Write-Dbg "Found non-empty migration(s); no need to bootstrap from schema.sql."
    return
  }

  Write-Warn "Migrations are empty (or only 0-byte). Bootstrapping migration from supabase/schema.sql..."
  Ensure-SupabaseCli

  Write-Step "Creating migration: init_schema"
  npx --yes supabase migration new init_schema | Out-Host

  $newMig = Get-ChildItem "supabase/migrations" -Filter "*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newMig) { throw "Failed to locate newly created migration file." }

  Write-Step ("Writing schema.sql into migration: " + $newMig.Name)
  $schemaText = Get-Content "supabase/schema.sql" -Raw
  if ([string]::IsNullOrWhiteSpace($schemaText)) { throw "supabase/schema.sql is empty." }
  [System.IO.File]::WriteAllText($newMig.FullName, $schemaText, $script:Utf8NoBom)

  foreach ($m in $migs) {
    if ($m.Length -eq 0) {
      Write-Dbg ("Removing 0-byte migration: " + $m.Name)
      Remove-Item $m.FullName -Force -ErrorAction SilentlyContinue
    }
  }
}

function Normalize-YesNo([string]$s) {
  if ($null -eq $s) { return $false }
  $t = ($s -replace "[^a-zA-Z]", "").ToLowerInvariant()
  return ($t -eq "y" -or $t -eq "yes")
}

function Ensure-MigrationsDir {
  if (-not (Test-Path "supabase")) { New-Item -ItemType Directory -Path "supabase" | Out-Null }
  if (-not (Test-Path "supabase/migrations")) { New-Item -ItemType Directory -Path "supabase/migrations" | Out-Null }
}

function Get-RemoteMigrationVersions {
  Ensure-SupabaseCli
  # Use JSON output to avoid parsing table formatting.
  $json = (npx --yes supabase migration list --linked --output json 2>$null) | Out-String
  $versions = @()
  try {
    $arr = $json | ConvertFrom-Json
    foreach ($row in $arr) {
      foreach ($p in $row.PSObject.Properties) {
        $v = [string]$p.Value
        if ($v -match "^[0-9]{14}$") { $versions += $v }
      }
    }
  } catch {
    foreach ($line in ($json -split "`r?`n")) {
      if ($line -match "\b([0-9]{14})\b") { $versions += $Matches[1] }
    }
  }
  return @($versions | Sort-Object -Unique)
}

function Ensure-LocalMigrationPlaceholders([string[]]$versions) {
  Ensure-MigrationsDir
  foreach ($v in $versions) {
    $exists = Get-ChildItem "supabase/migrations" -Filter "${v}_*.sql" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exists) {
      $path = Join-Path "supabase/migrations" ("${v}_remote_placeholder.sql")
      Write-Warn "Remote migration version $v exists but no local file found. Creating placeholder: $path"
      [System.IO.File]::WriteAllText((Resolve-Path (Split-Path $path -Parent)).Path + "\" + (Split-Path $path -Leaf), "-- Placeholder for remote migration version ${v}.`r`n-- Generated by scripts/launch.ps1 to satisfy supabase CLI history checks.`r`n", $script:Utf8NoBom)
    }
  }
}

function Sync-RemoteMigrationHistory {
  # Best-effort reconciliation only. Do not fail the wizard if remote sync tooling fails.
  Ensure-SupabaseCli
  Ensure-MigrationsDir

  # Avoid `supabase migration fetch` by default because it is interactive (overwrite prompt)
  # and can abort the wizard. We rely on `migration list` + placeholders instead.
  Write-Dbg "Skipping supabase migration fetch (interactive). Using migration list + placeholders."

  try {
    $remoteVersions = Get-RemoteMigrationVersions
    if ($remoteVersions -and $remoteVersions.Count -gt 0) {
      Ensure-LocalMigrationPlaceholders $remoteVersions
    }
  } catch {
    Write-Warn "Could not reconcile remote migration history automatically. db push may still fail with history mismatch."
    Write-Dbg $_
  }
}

function Test-PostgrestTableExists([string]$sbUrl, [string]$apiKey, [string]$tableName) {
  $url = ($sbUrl.TrimEnd('/') + "/rest/v1/" + $tableName + "?select=*&limit=1")
  Write-Dbg "Preflight: probing $url"

  try {
    $resp = Invoke-WebRequest -Uri $url -Method GET -UseBasicParsing -Headers @{ apikey = $apiKey; Authorization = ("Bearer " + $apiKey) } -TimeoutSec 15
    return $true
  }
  catch {
    $ex = $_.Exception
    $status = $null
    $body = ""

    try {
      if ($ex.Response) {
        $status = [int]$ex.Response.StatusCode
        $stream = $ex.Response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $body = $reader.ReadToEnd()
        }
      }
    } catch { }

    Write-Dbg ("Preflight HTTP status=" + $status)
    Write-Dbg ("Preflight body=" + $body)

    # Invalid/expired key => cannot conclude table exists.
    if ($status -eq 401 -and ($body -match "Invalid API key" -or $body -match "invalid api key")) {
      throw "Preflight failed: Supabase returned 401 Invalid API key. Check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY."
    }

    if ($body -match "PGRST205" -or $body -match "Could not find the table") {
      return $false
    }

    # 401/403 for other reasons may include RLS; treat as exists.
    if ($status -eq 401 -or $status -eq 403) {
      return $true
    }

    return $false
  }
}

function Wait-ForPostgrestSchemaCache([string]$sbUrl, [string]$apiKey, [string]$table, [int]$retries = 6, [int]$sleepSec = 5) {
  for ($i = 0; $i -lt $retries; $i++) {
    $ok = Test-PostgrestTableExists $sbUrl $apiKey $table
    if ($ok) { return $true }
    Write-Warn "Table '$table' not visible yet (schema cache). Waiting ${sleepSec}s... ($($i+1)/$retries)"
    Start-Sleep -Seconds $sleepSec
  }
  return $false
}

function Preflight-Checklist([string]$sbUrl, [string]$pubKey, [string]$srvKey) {
  Write-Step "Running Preflight Checklist"
  Write-Dbg "Checking basic connectivity to Supabase URL..."
  
  $url = $sbUrl.TrimEnd('/') + "/rest/v1/"
  try {
    # Check simple connectivity using pub key
    Invoke-WebRequest -Uri $url -Method GET -UseBasicParsing -Headers @{ apikey = $pubKey; Authorization = ("Bearer " + $pubKey) } -TimeoutSec 10 | Out-Null
    Write-Dbg "Connectivity OK"
  } catch {
    $ex = $_.Exception
    $status = 0
    if ($ex.Response) { $status = [int]$ex.Response.StatusCode }
    
    # 401 is okay for connectivity (key might be rejected but server is there)
    # But 0 or null means network error
    if ($status -eq 0) {
      throw "Could not connect to Supabase ($sbUrl). Check your internet connection or URL. Details: " + $ex.Message
    }
    if ($status -ge 500) {
      throw "Supabase returned server error ($status). The project may be down or under maintenance."
    }
    Write-Dbg "Connectivity OK (Status $status)"
  }
}

function Print-DebugSummary {
  Write-Host "`n--- Debug Summary ---" -ForegroundColor DarkGray
  try {
    Write-Host ("PWD: " + (Get-Location)) -ForegroundColor DarkGray
    Write-Host ("Node: " + (node -v)) -ForegroundColor DarkGray
    Write-Host ("NPM: " + (npm -v)) -ForegroundColor DarkGray
  } catch { }

  try {
    $sbUrl = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_URL"
    $pub   = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    Write-Host ("NEXT_PUBLIC_SUPABASE_URL=" + $sbUrl) -ForegroundColor DarkGray
    if ($pub) {
      $mask = if ($pub.Length -gt 12) { $pub.Substring(0,8) + "..." + $pub.Substring($pub.Length-4) } else { "***" }
      Write-Host ("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=" + $mask) -ForegroundColor DarkGray
    }
  } catch { }

  try {
    if (Test-Path "supabase/migrations") {
      $migs = Get-ChildItem "supabase/migrations" -Filter "*.sql" | Sort-Object Name
      Write-Host "Migrations:" -ForegroundColor DarkGray
      foreach ($m in $migs) { Write-Host (" - " + $m.Name + " (" + $m.Length + " bytes)") -ForegroundColor DarkGray }
    }
  } catch { }

  Write-Host "Tips:" -ForegroundColor DarkGray
  Write-Host " - Re-run with -Debug for more output" -ForegroundColor DarkGray
  Write-Host " - Confirm you're in the same Supabase project as NEXT_PUBLIC_SUPABASE_URL" -ForegroundColor DarkGray
  Write-Host " - If tables still missing, check Dashboard -> Database -> Migrations for history" -ForegroundColor DarkGray
  Write-Host "---------------------`n" -ForegroundColor DarkGray
}

Write-Host "Startup Ops Console Launch Wizard" -ForegroundColor Cyan

try {
  Require-Command "node" "Install Node.js (LTS): https://nodejs.org/"
  Require-Command "npm"  "Install Node.js (LTS): https://nodejs.org/"
  Require-Command "npx"  "Install Node.js (LTS): https://nodejs.org/"

  if ($Prod -and $Dev) { throw "Choose only one: -Dev or -Prod" }
  if (-not $Dev -and -not $Prod) { $Dev = $true }

  Write-Host "This wizard will:" -ForegroundColor DarkCyan
  Write-Host "1) Ensure dependencies" -ForegroundColor DarkCyan
  Write-Host "2) Configure .env.local (Supabase URL/keys)" -ForegroundColor DarkCyan
  Write-Host "3) Ensure migrations exist (bootstrap from schema.sql if needed)" -ForegroundColor DarkCyan
  Write-Host "4) Optionally push Supabase migrations via CLI" -ForegroundColor DarkCyan
  Write-Host "5) Verify tables exist before login" -ForegroundColor DarkCyan
  Write-Host "6) Start the app" -ForegroundColor DarkCyan

  # Ensure env file exists
  if (-not (Test-Path ".env.local")) {
    if (Test-Path ".env.local.example") {
      Copy-Item ".env.local.example" ".env.local" -Force
      Write-Warn "Created .env.local from .env.local.example"
    } else {
      Write-Err "Missing .env.local and .env.local.example. Cannot continue."
      exit 1
    }
  }

  # Normalize encoding early so downstream CLIs can parse it reliably
  Ensure-EnvUtf8NoBom ".env.local"

  # Install deps
  if (-not $NoInstall) {
    Write-Step "Installing npm dependencies"
    npm install
  } else {
    Write-Dbg "Skipping npm install (-NoInstall)"
  }

  # Prompt for keys
  Write-Step "Configuring environment (.env.local)"
  Write-Host "Directions: In Supabase Dashboard -> Project Settings -> API" -ForegroundColor DarkCyan

  # Supabase URL
  $sbUrl = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_URL"
  if ([string]::IsNullOrWhiteSpace($sbUrl) -or $sbUrl -like "*YOURPROJECT*") {
    $sbUrl = Prompt "Enter NEXT_PUBLIC_SUPABASE_URL (e.g. https://xxxx.supabase.co)"
  } else {
    $keepUrl = Prompt "Keep existing NEXT_PUBLIC_SUPABASE_URL? (y/n)" "y"
    if (-not ($keepUrl -match "^(y|yes)$")) {
      $sbUrl = Prompt "Enter NEXT_PUBLIC_SUPABASE_URL (e.g. https://xxxx.supabase.co)"
    }
  }
  Require-NonEmpty "NEXT_PUBLIC_SUPABASE_URL" $sbUrl
  Validate-SupabaseUrl $sbUrl
  Set-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_URL" $sbUrl

  # Publishable key (always ask unless keep)
  $existingPub = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  if (-not [string]::IsNullOrWhiteSpace($existingPub) -and -not ($existingPub -like "*YOUR_PUBLISHABLE_KEY*" -or $existingPub -like "*YOUR_ANON_KEY*")) {
    Write-Host "Current NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set." -ForegroundColor DarkCyan
    $keep = Prompt "Keep existing publishable key? (y/n)" "y"
    if ($keep -match "^(y|yes)$") {
      $pub = $existingPub
    } else {
      $pub = Prompt "Enter NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_... from Dashboard -> Settings -> API)"
    }
  } else {
    $pub = Prompt "Enter NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_... from Dashboard -> Settings -> API)"
  }
  Require-NonEmpty "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" $pub
  Validate-PublishableKey $pub
  Set-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" $pub

  # Service role key is required for reliable setup tasks (migrations / preflight). Always prompt unless explicitly kept.
  $existingService = Read-EnvValue ".env.local" "SUPABASE_SERVICE_ROLE_KEY"
  if (-not [string]::IsNullOrWhiteSpace($existingService) -and -not ($existingService -like "*YOUR_SERVICE_ROLE_KEY*")) {
    Write-Host "Current SUPABASE_SERVICE_ROLE_KEY is set (server-only)." -ForegroundColor DarkCyan
    $keepSrv = Prompt "Keep existing service role key? (y/n)" "y"
    if ($keepSrv -match "^(y|yes)$") {
      $service = $existingService
    } else {
      $service = Prompt "Enter SUPABASE_SERVICE_ROLE_KEY (service_role; server-only)"
    }
  } else {
    Write-Warn "SUPABASE_SERVICE_ROLE_KEY is server-only and is required for migrations/admin features."
    $service = Prompt "Enter SUPABASE_SERVICE_ROLE_KEY (service_role; server-only)"
  }
  Require-NonEmpty "SUPABASE_SERVICE_ROLE_KEY" $service
  Validate-ServiceRoleKey $service
  Set-EnvValue ".env.local" "SUPABASE_SERVICE_ROLE_KEY" $service

  # Optional integrity secret
  $integrity = Read-EnvValue ".env.local" "INTEGRITY_SECRET"
  if ([string]::IsNullOrWhiteSpace($integrity) -or $integrity -like "use-a-long-random-string-here") {
    $setInt = Prompt "Set INTEGRITY_SECRET now? (y/n)" "y"
    if (Normalize-YesNo $setInt) {
      $integrity = Prompt "Enter INTEGRITY_SECRET (any long random string)" "use-a-long-random-string-here"
      Set-EnvValue ".env.local" "INTEGRITY_SECRET" $integrity
    }
  }

  # Optional OpenAI
  $openai = Read-EnvValue ".env.local" "OPENAI_API_KEY"
  if ([string]::IsNullOrWhiteSpace($openai) -or $openai -like "your_key_here") {
    $setAi = Prompt "Set OPENAI_API_KEY now? (y/n)" "n"
    if ($setAi -match "^(y|yes)$") {
      $openai = Prompt-Secret "Enter OPENAI_API_KEY"
      Set-EnvValue ".env.local" "OPENAI_API_KEY" $openai
    }
  }

  # Optional worker token
  $worker = Read-EnvValue ".env.local" "WORKER_TOKEN"
  if ([string]::IsNullOrWhiteSpace($worker) -or $worker -like "use-a-long-random-string-here") {
    $setW = Prompt "Set WORKER_TOKEN now? (y/n)" "n"
    if (Normalize-YesNo $setW) {
      $worker = Prompt-Secret "Enter WORKER_TOKEN (protects /api/jobs/worker in production)"
      Set-EnvValue ".env.local" "WORKER_TOKEN" $worker
    }
  }

  Set-EnvValue ".env.local" "DEBUG_SERVER" "1"

  # Ensure migrations are real
  Write-Step "Checking migrations"
  Ensure-MigrationsFromSchema

  # Migrations (optional)
  if (-not $SkipMigrations) {
    $doMigrate = Prompt "Push DB migrations to Supabase now? (y/n)" "y"
    if (Normalize-YesNo $doMigrate) {
      Ensure-SupabaseCli

      $refDefault = Get-ProjectRefFromUrl $sbUrl
      $ref = Prompt "Supabase project ref" $refDefault

      Write-Host "Directions: if prompted, a browser window will open for Supabase CLI login." -ForegroundColor DarkCyan

      if (-not (Test-Path "supabase/config.toml")) {
        Write-Step "Initializing Supabase CLI project"
        npx --yes supabase init | Out-Host
      }

      Write-Step "Linking Supabase project"
      npx --yes supabase link --project-ref $ref | Out-Host

      # Safety: reconcile migration history mismatches automatically.
      Sync-RemoteMigrationHistory

      Write-Step "Pushing migrations"
      try {
        npx --yes supabase db push --include-all --yes | Out-Host
      } catch {
        Write-Warn "db push failed (possibly due to migration history mismatch). Attempting one more reconciliation and retry..."
        Sync-RemoteMigrationHistory
        npx --yes supabase db push --include-all --yes | Out-Host
      }
    } else {
      Write-Warn "Skipping migrations. If the app errors with missing tables, run migrations later."
    }
  } else {
    Write-Dbg "Skipping migrations (-SkipMigrations)"
  }

  # Run preflight checklist early (before migrations) so we don't waste time.
  Preflight-Checklist $sbUrl $pub $service

  # Preflight: confirm tables exist before user tries to log in
  Write-Step "Preflight: verifying tables exist"
  $okGames = Wait-ForPostgrestSchemaCache $sbUrl $service "games" -retries 12 -sleepSec 5
  $okQuarters = Wait-ForPostgrestSchemaCache $sbUrl $service "quarters" -retries 12 -sleepSec 5
  $okJobs = Wait-ForPostgrestSchemaCache $sbUrl $service "jobs" -retries 12 -sleepSec 5

  if (-not ($okGames -and $okQuarters -and $okJobs)) {
    throw "Preflight failed: required tables are not visible to PostgREST (PGRST205/missing tables). Migrations may not have applied, or PostgREST schema cache did not refresh."
  }
  Write-Host "Preflight OK: required tables are visible (games/quarters/jobs)." -ForegroundColor Green

  # Start app
  if ($Dev) {
    Write-Step "Starting dev server"
    npm run dev
  } else {
    Write-Step "Building app"
    npm run build
    Write-Step "Starting production server"
    npm run start
  }
}
catch {
  Write-Err ("Wizard failed: " + $_.Exception.Message)
  if ($Debug) {
    Write-Host "`nFull error:" -ForegroundColor DarkGray
    Write-Host $_ -ForegroundColor DarkGray
  }
  Print-DebugSummary
  exit 1
}