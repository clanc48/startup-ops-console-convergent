# Cleaning Notes

Generated: 2026-03-02T23:19:44.817075Z

Removed:
- .env.local (to avoid leaking keys)
- .vs
- build/artifact folders: .next, node_modules, etc.

References to NEXT_PUBLIC_SUPABASE_ANON_KEY found: 1
- scripts/launch.ps1


Patched: 2026-03-02T23:20:25.335475+00:00 - scripts/launch.ps1: updated
