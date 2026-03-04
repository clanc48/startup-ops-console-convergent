# Cleaning Notes

2026-03-02

Removed:
- .env.local (to avoid leaking keys)
- .vs
- build/artifact folders: .next, node_modules, etc.

References to NEXT_PUBLIC_SUPABASE_ANON_KEY found: 1
- scripts/launch.ps1


Patched: 2026-03-02 - scripts/launch.ps1: updated
