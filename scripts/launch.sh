#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF=""
MODE="dev"
NO_INSTALL=0
SKIP_MIGRATIONS=0

while [[ $# -gt0 ]]; do
 case "$1" in
 --project-ref)
 PROJECT_REF="$2"; shift2;;
 --prod)
 MODE="prod"; shift;;
 --no-install)
 NO_INSTALL=1; shift;;
 --skip-migrations)
 SKIP_MIGRATIONS=1; shift;;
 -h|--help)
 echo "Usage: ./scripts/launch.sh [--project-ref <ref>] [--prod] [--no-install] [--skip-migrations]";
 exit0;;
 *)
 echo "Unknown arg: $1"; exit1;;
 esac
done

echo "== Startup Ops Console: quick launch =="

command -v node >/dev/null2>&1 || { echo "Missing node. Install Node.js LTS: https://nodejs.org/"; exit1; }
command -v npm >/dev/null2>&1 || { echo "Missing npm. Install Node.js LTS: https://nodejs.org/"; exit1; }

if [[ ! -f .env.local ]]; then
 if [[ -f .env.local.example ]]; then
 cp .env.local.example .env.local
 echo "Created .env.local from .env.local.example. Fill in your Supabase keys.";
 else
 echo "Missing .env.local and .env.local.example. Create .env.local."; exit1;
 fi
fi

if [[ $NO_INSTALL -eq0 ]]; then
 echo "Installing npm dependencies..."
 npm install
fi

if [[ $SKIP_MIGRATIONS -eq0 ]]; then
 if [[ -z "$PROJECT_REF" ]]; then
 # Infer from NEXT_PUBLIC_SUPABASE_URL
 if grep -q "NEXT_PUBLIC_SUPABASE_URL" .env.local; then
 PROJECT_REF=$(grep "NEXT_PUBLIC_SUPABASE_URL" .env.local | sed -E 's/.*https:\/\/([a-z0-9-]+)\.supabase\.co.*/\1/i' | head -n1)
 if [[ -n "$PROJECT_REF" ]]; then
 echo "Inferred Supabase project ref: $PROJECT_REF"
 fi
 fi
 fi

 if [[ -n "$PROJECT_REF" ]]; then
 echo "Linking Supabase project ($PROJECT_REF)..."
 npx supabase link --project-ref "$PROJECT_REF"

 echo "Pushing migrations to remote..."
 npx supabase db push --include-all --yes
 else
 echo "No project ref provided; skipping Supabase link/db push.";
 echo "Run: npx supabase link --project-ref <ref> && npx supabase db push --include-all --yes";
 fi
fi

if [[ "$MODE" == "dev" ]]; then
 echo "Starting dev server..."
 npm run dev
else
 echo "Building app..."
 npm run build
 echo "Starting production server..."
 npm run start
fi
