-- fix pgcrypto extension to be on public schema so digest() is available in search path
-- Explicitly install pgcrypto into public for hash functions
create extension if not exists pgcrypto schema public;

-- Ensure public schema is in search path for future calls
alter database postgres set search_path to "$user", public, extensions;