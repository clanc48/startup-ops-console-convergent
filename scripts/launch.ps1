param(
 [switch]$Dev,
 [switch]$Prod,
 [switch]$NoInstall,
 [switch]$SkipMigrations,
 [switch]$Debug,
 [switch]$RepairMigrations
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --------------------------------------------------------------------------------------
# LAUNCH WIZARD (scripts/launch.ps1)
# --------------------------------------------------------------------------------------
# WHO this is for:
# - Anyone running this project locally on Windows (PowerShell) who wants a guided setup.
# - You do NOT need to be a PowerShell expert.
#
# WHAT this script does:
# - Ensures you have Node + NPM available.
# - Creates/updates `.env.local` with the required Supabase keys.
# - (Optionally) installs dependencies (`npm install`).
# - (Optionally) pushes database migrations to your Supabase project.
# - Verifies the required tables exist before you try to use the UI.
# - Starts the application (`npm run dev` or `npm run build && npm run start`).
#
# WHEN you should run it:
# - The first time you clone/open the repo.
# - Anytime you switch to a new Supabase project.
# - Anytime migrations drift and `supabase db push` is complaining.
#
# WHERE it runs:
# - From the project root folder (the folder that contains `package.json`).
# - It reads/writes files in this repo, especially `.env.local` and `supabase/migrations/*`.
#
# WHY it exists:
# - Setup for Supabase + Next.js involves multiple steps and keys.
# - This wizard reduces "it works on my machine" problems and avoids common Windows pitfalls.
# --------------------------------------------------------------------------------------

# WHO/WHAT/WHY: Supabase CLI on Windows can choke if `.env.local` has a UTF?8 BOM marker.
# WHEN: Any time we write `.env.local`, we use this encoding.
# WHERE: Used by Set-EnvValue/Ensure-EnvUtf8NoBom.
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Require-Command([string]$name, [string]$installHint) {
 # WHO: the person running the wizard.
 # WHAT: checks your machine has a required command (`node`, `npm`, `npx`, etc.).
 # WHEN: at the start of the script.
 # WHY: we fail fast with a helpful message instead of blowing up later.
 if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
 throw "Missing required command '$name'. $installHint"
 }
}

function Write-Step([string]$msg) {
 # WHAT: prints a big, readable step header.
 # WHY: makes the wizard output easy to follow.
 Write-Host ("`n==> " + $msg) -ForegroundColor Cyan
}
function Write-Warn([string]$msg) {
 # WHAT: prints a warning (non-fatal).
 Write-Host $msg -ForegroundColor Yellow
}
function Write-Err([string]$msg) {
 # WHAT: prints an error message.
 Write-Host $msg -ForegroundColor Red
}
function Write-Dbg([string]$msg) {
 # WHAT: prints extra debug details.
 # WHEN: only when you run `scripts/launch.ps1 -Debug`.
 if ($Debug) { Write-Host ("[debug] " + $msg) -ForegroundColor DarkGray }
}

function Prompt([string]$msg, [string]$default = "") {
 # WHO: you (the person running the wizard).
 # WHAT: asks a question in the terminal.
 # WHEN: any time we need an environment value or a yes/no decision.
 # WHY: so you can paste your Supabase keys without editing files manually.
 if ([string]::IsNullOrWhiteSpace($default)) {
 return Read-Host $msg
 }
 $v = Read-Host "$msg [$default]"
 if ([string]::IsNullOrWhiteSpace($v)) { return $default }
 return $v
}

function Prompt-Secret([string]$msg) {
 # WHO: you.
 # WHAT: asks for a secret (like API keys) without echoing it to the screen.
 # WHEN: when entering keys like OPENAI_API_KEY or WORKER_TOKEN.
 # WHY: reduces the chance of accidentally sharing a key in a screenshot or screen recording.
 $sec = Read-Host $msg -AsSecureString
 return (New-Object System.Net.NetworkCredential("", $sec)).Password
}

function Ensure-SupabaseCli {
 # WHO: this wizard.
 # WHAT: ensures the Supabase CLI exists so we can run migrations.
 # WHEN: only if/when you choose to push migrations.
 # WHERE: tries local `node_modules/.bin/supabase.cmd` first, then uses `npx supabase`.
 # WHY: avoids requiring a global install while still keeping setup simple.

 # Prefer a locally installed CLI if present; otherwise fall back to npx.
 $localCli = Join-Path (Get-Location) "node_modules/.bin/supabase.cmd"
 if (Test-Path $localCli) { return }

 try {
 npx --yes supabase --version | Out-Null
 return
 } catch {
 # If this fails, we will install the CLI as a dev dependency below.
 }

 Write-Warn "Supabase CLI not found. We'll install it as a dev dependency (adds to package.json)."
 Write-Warn "If you prefer global install, cancel and run: npm i -g supabase"
 Write-Step "Installing Supabase CLI (npm i -D supabase)"
 npm i -D supabase
}

function Read-EnvValue([string]$path, [string]$key) {
 # WHO: the wizard.
 # WHAT: reads an environment variable from a `.env`-style file.
 # WHEN: before prompting, so we can offer "keep existing" choices.
 # WHY: avoids overwriting existing working config.
 if (-not (Test-Path $path)) { return $null }
 $raw = Get-Content $path -Raw
 $m = [regex]::Match($raw, "(?m)^" + [regex]::Escape($key) + "\s*=\s*(.+)$")
 if (-not $m.Success) { return $null }

 $val = $m.Groups[1].Value.Trim()

 # WHAT: supports quoted values like KEY="value".
 # WHY: people often add quotes in .env files.
 if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
 if ($val.Length -ge2) {
 $val = $val.Substring(1, $val.Length -2)
 }
 }
 return $val
}

function Set-EnvValue([string]$path, [string]$key, [string]$value) {
 # WHO: the wizard.
 # WHAT: writes/updates KEY=value inside `.env.local`.
 # WHEN: after you confirm a value.
 # WHY: so you don't have to manually edit `.env.local`.

 $lines = @()
 if (Test-Path $path) { $lines = Get-Content $path }

 $re = "^" + [regex]::Escape($key) + "\s*="
 $found = $false
 for ($i =0; $i -lt $lines.Count; $i++) {
 if ($lines[$i] -match $re) {
 $lines[$i] = "$key=$value"
 $found = $true
 }
 }
 if (-not $found) {
 $lines += "$key=$value"
 }

 # WHY: Supabase CLI can fail on Windows if a UTF?8 BOM exists.
 # WHAT: write the file as UTF?8 without BOM.
 [System.IO.File]::WriteAllLines((Resolve-Path $path), $lines, $script:Utf8NoBom)
}

function Ensure-EnvUtf8NoBom([string]$path) {
 # WHO: the wizard.
 # WHAT: rewrites the env file without a BOM marker.
 # WHEN: very early, before `supabase` reads `.env.local`.
 # WHY: prevents confusing parse errors on Windows.
 if (-not (Test-Path $path)) { return }
 $text = Get-Content -Path $path -Raw
 if ($text.Length -gt0 -and [int]$text[0] -eq0xFEFF) {
 $text = $text.TrimStart([char]0xFEFF)
 }
 [System.IO.File]::WriteAllText((Resolve-Path $path), $text, $script:Utf8NoBom)
}

function Require-NonEmpty([string]$name, [string]$value) {
 # WHAT: throws an error if a required value is missing.
 # WHY: prevents subtle "Unauthorized"/"Invalid API key" errors later.
 if ([string]::IsNullOrWhiteSpace($value)) {
 throw "$name is required but was empty."
 }
}

function Validate-SupabaseUrl([string]$sbUrl) {
 # WHAT: checks the URL looks like a Supabase project URL.
 # WHY: catches copy/paste mistakes early.
 if (-not ($sbUrl -match "^https://[a-z0-9-]+\.supabase\.co/?$")) {
 throw "NEXT_PUBLIC_SUPABASE_URL doesn't look valid. Expected https://<project-ref>.supabase.co"
 }
}

function Validate-PublishableKey([string]$pub) {
 # NOTE: Key formats can vary (legacy anon JWT vs new sb_ prefixes). Supabase will validate.
 return
}

function Validate-ServiceRoleKey([string]$srv) {
 # NOTE: Do not enforce format here; require non-empty only.
 if ([string]::IsNullOrWhiteSpace($srv)) { throw "SUPABASE_SERVICE_ROLE_KEY is required." }
 return
}

function Get-ProjectRefFromUrl([string]$sbUrl) {
 # WHAT: extracts the `project-ref` from https://<project-ref>.supabase.co
 # WHY: used as a sensible default when linking with the Supabase CLI.
 $m = [regex]::Match($sbUrl, "https://([a-z0-9-]+)\.supabase\.co", "IgnoreCase")
 if ($m.Success) { return $m.Groups[1].Value }
 return ""
}

function Ensure-MigrationsFromSchema {
 # WHO: the wizard.
 # WHAT: ensures you have at least one real migration if a repo ships only `schema.sql`.
 # WHEN: before attempting `supabase db push`.
 # WHY: Supabase expects migrations; schema-only repos often confuse new users.

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
 if ($m.Length -gt0) { $hasNonEmpty = $true; break }
 }

 if ($hasNonEmpty) {
 Write-Dbg "Found non-empty migration(s); no need to bootstrap from schema.sql."
 return
 }

 Write-Warn "Migrations are empty (or only0-byte). Bootstrapping migration from supabase/schema.sql..."
 Ensure-SupabaseCli

 Write-Step "Creating migration: init_schema"
 npx --yes supabase migration new init_schema | Out-Host

 $newMig = Get-ChildItem "supabase/migrations" -Filter "*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
 if (-not $newMig) { throw "Failed to locate newly created migration file." }

 Write-Step ("Writing schema.sql into migration: " + $newMig.Name)
 $schemaText = Get-Content "supabase/schema.sql" -Raw
 if ([string]::IsNullOrWhiteSpace($schemaText)) { throw "supabase/schema.sql is empty." }
 [System.IO.File]::WriteAllText($newMig.FullName, $schemaText, $script:Utf8NoBom)

 # WHAT/WHY: clean up old0-byte migration placeholders so they don't confuse new users.
 foreach ($m in $migs) {
 if ($m.Length -eq0) {
 Write-Dbg ("Removing0-byte migration: " + $m.Name)
 Remove-Item $m.FullName -Force -ErrorAction SilentlyContinue
 }
 }
}

function Normalize-YesNo([string]$s) {
 # WHAT: turns "y", "yes", "Y" etc. into a boolean.
 # WHY: keeps prompts consistent.
 if ($null -eq $s) { return $false }
 $t = ($s -replace "[^a-zA-Z]", "").ToLowerInvariant()
 return ($t -eq "y" -or $t -eq "yes")
}

function Ensure-MigrationsDir {
 # WHAT: ensures the `supabase/migrations` folder exists.
 # WHY: some repos start without migrations until you run the wizard.
 if (-not (Test-Path "supabase")) { New-Item -ItemType Directory -Path "supabase" | Out-Null }
 if (-not (Test-Path "supabase/migrations")) { New-Item -ItemType Directory -Path "supabase/migrations" | Out-Null }
}

function Get-RemoteMigrationVersions {
 # WHO: the wizard.
 # WHAT: asks Supabase CLI for the migration versions already applied remotely.
 # WHEN: before pushing local migrations.
 # WHY: if remote history contains versions not present locally, `db push` will fail.

 Ensure-SupabaseCli

 # Use JSON output to avoid parsing table formatting.
 # IMPORTANT: output format is `json`; stderr redirection must be separate.
 $json = (& npx --yes supabase migration list --linked --output json)2>$null | Out-String

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
 # Fallback parser if JSON parsing fails.
 foreach ($line in ($json -split "`r?`n")) {
 if ($line -match "\b([0-9]{14})\b") { $versions += $Matches[1] }
 }
 }
 return @($versions | Sort-Object -Unique)
}

function Ensure-MigrationsAreUtf8NoBom {
 # WHAT: ensures all migration .sql files are UTF-8 without BOM.
 # WHY: Supabase CLI/remote can error with `syntax error at or near "?"`.
 if (-not (Test-Path "supabase/migrations")) { return }
 $files = Get-ChildItem "supabase/migrations" -Filter "*.sql" -ErrorAction SilentlyContinue
 foreach ($f in $files) {
 try {
 $text = Get-Content -Path $f.FullName -Raw
 if ($text.Length -gt0 -and [int]$text[0] -eq0xFEFF) {
 Write-Warn ("Removing UTF-8 BOM from migration: " + $f.Name)
 $text = $text.TrimStart([char]0xFEFF)
 [System.IO.File]::WriteAllText($f.FullName, $text, $script:Utf8NoBom)
 }
 } catch {
 Write-Dbg ("Failed to normalize migration encoding: " + $f.Name)
 }
 }
}

function Ensure-LocalMigrationPlaceholders([string[]]$versions) {
 # WHO: the wizard.
 # WHAT: creates small "placeholder" migration files locally for any migrations that exist remote-only.
 # WHEN: before `supabase db push`.
 # WHERE: in `supabase/migrations`.
 # WHY: Supabase CLI requires migration history to match.

 Ensure-MigrationsDir
 foreach ($v in $versions) {
 # Only check for versioned migrations; don't ever overwrite an existing migration.
 $exists = Get-ChildItem "supabase/migrations" -Filter "${v}_*.sql" -ErrorAction SilentlyContinue | Select-Object -First 1
 if (-not $exists) {
 $path = Join-Path "supabase/migrations" ("${v}_remote_placeholder.sql")
 Write-Warn "Remote migration version $v exists but no local file found. Creating placeholder: $path"

 [System.IO.File]::WriteAllText(
 $path,
 "-- Placeholder for remote migration version ${v}.`r`n-- Generated by scripts/launch.ps1 to satisfy supabase CLI history checks.`r`n",
 $script:Utf8NoBom
 )
 }
 }
}

function Sync-RemoteMigrationHistory {
 # WHO: the wizard.
 # WHAT: best-effort reconcile local vs remote migration VERSION lists.
 # WHEN: right before pushing migrations.
 # WHY: prevents the most common "Remote migration versions not found" error.

 # Best-effort reconciliation only. Do not fail the wizard if remote sync tooling fails.
 Ensure-SupabaseCli
 Ensure-MigrationsDir

 # WHY: `supabase migration fetch` is interactive (it asks to overwrite files).
 # WHAT: we avoid it to keep the wizard non-blocking.
 # Instead: `migration list` + create local placeholder files.
 Write-Dbg "Skipping supabase migration fetch (interactive). Using migration list + placeholders."

 try {
 $remoteVersions = Get-RemoteMigrationVersions
 if ($remoteVersions -and $remoteVersions.Count -gt0) {
 Ensure-LocalMigrationPlaceholders $remoteVersions
 }
 } catch {
 Write-Warn "Could not reconcile remote migration history automatically. db push may still fail with history mismatch."
 Write-Dbg $_
 }
}

function Test-PostgrestTableExists([string]$sbUrl, [string]$apiKey, [string]$tableName) {
 # WHO: the wizard.
 # WHAT: checks whether PostgREST can see a given table.
 # WHEN: after migrations to ensure schema cache is ready.
 # WHY: prevents you from logging in and seeing confusing missing-table errors.

 $url = ($sbUrl.TrimEnd('/') + "/rest/v1/" + $tableName + "?select=*&limit=1")
 Write-Dbg "Preflight: probing $url"

 try {
 $resp = Invoke-WebRequest -Uri $url -Method GET -UseBasicParsing -Headers @{ apikey = $apiKey; Authorization = ("Bearer " + $apiKey) } -TimeoutSec15
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

 # WHY: invalid key is the most common failure. Call it out clearly.
 if ($status -eq401 -and ($body -match "Invalid API key" -or $body -match "invalid api key")) {
 throw "Preflight failed: Supabase returned401 Invalid API key. Check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY."
 }

 # PGRST205 means PostgREST hasn't seen the table yet.
 if ($body -match "PGRST205" -or $body -match "Could not find the table") {
 return $false
 }

 #401/403 can also mean Row Level Security blocked the request.
 # In that case, the table exists; you just can't read it with that key.
 if ($status -eq401 -or $status -eq403) {
 return $true
 }

 return $false
 }
}

function Wait-ForPostgrestSchemaCache([string]$sbUrl, [string]$apiKey, [string]$table, [int]$retries =6, [int]$sleepSec =5) {
 # WHO: the wizard.
 # WHAT: retries table detection because Supabase's schema cache can lag after migrations.
 # WHEN: right after pushing migrations.
 # WHY: avoids false failures caused by cache propagation delay.
 for ($i =0; $i -lt $retries; $i++) {
 $ok = Test-PostgrestTableExists $sbUrl $apiKey $table
 if ($ok) { return $true }
 Write-Warn "Table '$table' not visible yet (schema cache). Waiting ${sleepSec}s... ($($i+1)/$retries)"
 Start-Sleep -Seconds $sleepSec
 }
 return $false
}

function Preflight-Checklist([string]$sbUrl, [string]$pubKey, [string]$srvKey) {
 # WHO: the wizard.
 # WHAT: quick connectivity check to your Supabase project.
 # WHEN: before doing deeper checks.
 # WHY: if the network/URL is wrong, don't waste time on migrations.

 Write-Step "Running Preflight Checklist"
 Write-Dbg "Checking basic connectivity to Supabase URL..."

 $url = $sbUrl.TrimEnd('/') + "/rest/v1/"
 try {
 # Check simple connectivity using pub key.
 Invoke-WebRequest -Uri $url -Method GET -UseBasicParsing -Headers @{ apikey = $pubKey; Authorization = ("Bearer " + $pubKey) } -TimeoutSec 10 | Out-Null
 Write-Dbg "Connectivity OK"
 } catch {
 $ex = $_.Exception

 $status =0
 try {
 if ($null -ne $ex -and ($ex | Get-Member -Name Response -MemberType Properties)) {
 if ($ex.Response) { $status = [int]$ex.Response.StatusCode }
 }
 } catch { }

 if ($status -eq0) {
 throw "Could not connect to Supabase ($sbUrl). Check your internet connection, VPN/firewall, or URL. Details: " + $ex.Message
 }
 if ($status -ge500) {
 throw "Supabase returned server error ($status). The project may be down or under maintenance."
 }
 Write-Dbg "Connectivity OK (Status $status)"
 }
}

function Print-DebugSummary {
 # WHO: you.
 # WHAT: prints extra context to help troubleshoot.
 # WHEN: only after an error.
 # WHY: makes it easier to fix environment issues without guessing.

 Write-Host "`n--- Debug Summary ---" -ForegroundColor DarkGray
 try {
 Write-Host ("PWD: " + (Get-Location)) -ForegroundColor DarkGray
 Write-Host ("Node: " + (node -v)) -ForegroundColor DarkGray
 Write-Host ("NPM: " + (npm -v)) -ForegroundColor DarkGray
 } catch { }

 try {
 $sbUrl = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_URL"
 $pub = Read-EnvValue ".env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
 Write-Host ("NEXT_PUBLIC_SUPABASE_URL=" + $sbUrl) -ForegroundColor DarkGray
 if ($pub) {
 $mask = if ($pub.Length -gt12) { $pub.Substring(0,8) + "..." + $pub.Substring($pub.Length-4) } else { "***" }
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
 # WHO: you.
 # WHAT: verify your machine has Node tooling.
 # WHY: without these we can't install deps or run the app.
 Require-Command "node" "Install Node.js (LTS): https://nodejs.org/"
 Require-Command "npm" "Install Node.js (LTS): https://nodejs.org/"
 Require-Command "npx" "Install Node.js (LTS): https://nodejs.org/"

 # WHAT: choose dev vs prod.
 # WHY: dev uses hot reload; prod simulates deployment.
 if ($Prod -and $Dev) { throw "Choose only one: -Dev or -Prod" }
 if (-not $Dev -and -not $Prod) { $Dev = $true }

 Write-Host "This wizard will:" -ForegroundColor DarkCyan
 Write-Host "1) Ensure dependencies" -ForegroundColor DarkCyan
 Write-Host "2) Configure .env.local (Supabase URL/keys)" -ForegroundColor DarkCyan
 Write-Host "3) Ensure migrations exist (bootstrap from schema.sql if needed)" -ForegroundColor DarkCyan
 Write-Host "4) Optionally push Supabase migrations via CLI" -ForegroundColor DarkCyan
 Write-Host "5) Verify tables exist before login" -ForegroundColor DarkCyan
 Write-Host "6) Start the app" -ForegroundColor DarkCyan

 # WHAT: ensure `.env.local` exists.
 # WHY: Next.js reads environment variables from `.env.local` during dev.
 if (-not (Test-Path ".env.local")) {
 if (Test-Path ".env.local.example") {
 Copy-Item ".env.local.example" ".env.local" -Force
 Write-Warn "Created .env.local from .env.local.example"
 } else {
 Write-Err "Missing .env.local and .env.local.example. Cannot continue."
 exit 1
 }
 }

 # WHAT: fix encoding issues early.
 # WHY: prevents Supabase CLI parse failures later on Windows.
 Ensure-EnvUtf8NoBom ".env.local"

 # WHAT: install dependencies.
 # WHEN: can be skipped with -NoInstall.
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
 Set-EnvValue ".env.local" "SUPABASE_SERVICE_ROLE_KEY" $service

 # Optional OpenAI (Executive Summary)
 $openai = Read-EnvValue ".env.local" "OPENAI_API_KEY"
 $openaiLooksPlaceholder = [string]::IsNullOrWhiteSpace($openai) -or ($openai -match "(?i)^(your[_-]?openai[_-]?key[_-]?here|your[_-]?key[_-]?here)$")

 if (-not $openaiLooksPlaceholder) {
 Write-Host "Current OPENAI_API_KEY is set (server-only)." -ForegroundColor DarkCyan
 $keepAi = Prompt "Keep existing OPENAI_API_KEY? (y/n)" "y"
 if (-not (Normalize-YesNo $keepAi)) {
 $openai = Prompt-Secret "Enter OPENAI_API_KEY (starts with sk-...)"
 Require-NonEmpty "OPENAI_API_KEY" $openai
 Set-EnvValue ".env.local" "OPENAI_API_KEY" $openai
 }
 } else {
 $defaultEnableAi = if ($Dev) { "y" } else { "n" }
 $setAi = Prompt "Enable OpenAI executive summaries (set OPENAI_API_KEY now)? (y/n)" $defaultEnableAi
 if (Normalize-YesNo $setAi) {
 $openai = Prompt-Secret "Enter OPENAI_API_KEY (starts with sk-...)"
 Require-NonEmpty "OPENAI_API_KEY" $openai
 Set-EnvValue ".env.local" "OPENAI_API_KEY" $openai
 }
 }

 # Optional worker token
 $worker = Read-EnvValue ".env.local" "WORKER_TOKEN"
 if ([string]::IsNullOrWhiteSpace($worker) -or $worker -like "use-a-long-random-string-here") {
 $setW = Prompt "Set WORKER_TOKEN now? (y/n)" "n"
 if (Normalize-YesNo $setW) {
 $worker = Prompt-Secret "Enter WORKER_TOKEN (protects /api/jobs/worker in production)"
 Require-NonEmpty "WORKER_TOKEN" $worker
 Set-EnvValue ".env.local" "WORKER_TOKEN" $worker
 }
 }

 # WHAT: ensures server debug logs are on.
 # WHY: makes it easier to troubleshoot auth/cookie issues during development.
 Set-EnvValue ".env.local" "DEBUG_SERVER" "1"

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
 Write-Warn "db push failed. This is commonly caused by migration history mismatch (remote already has versions)."
 Try-RepairMigrationHistory $ref
 Write-Warn "After repair, re-run the wizard or run db push again."
 throw
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
 $okGames = Wait-ForPostgrestSchemaCache $sbUrl $service "games" -retries12 -sleepSec5
 $okQuarters = Wait-ForPostgrestSchemaCache $sbUrl $service "quarters" -retries12 -sleepSec5

 # `jobs` is optional (AI summaries only). Only verify it if AI is enabled.
 $openaiKey = Read-EnvValue ".env.local" "OPENAI_API_KEY"
 $aiEnabled = -not [string]::IsNullOrWhiteSpace($openaiKey)
 $okJobs = $true
 if ($aiEnabled) {
 $okJobs = Wait-ForPostgrestSchemaCache $sbUrl $service "jobs" -retries12 -sleepSec5
 } else {
 Write-Warn "AI not enabled (OPENAI_API_KEY missing). Skipping jobs table verification."
 }

 if (-not ($okGames -and $okQuarters -and $okJobs)) {
 throw "Preflight failed: required tables are not visible to PostgREST. Core requires games/quarters; jobs is only required when AI is enabled."
 }

 if ($aiEnabled) {
 Write-Host "Preflight OK: required tables are visible (games/quarters/jobs)." -ForegroundColor Green
 } else {
 Write-Host "Preflight OK: required tables are visible (games/quarters)." -ForegroundColor Green
 }

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