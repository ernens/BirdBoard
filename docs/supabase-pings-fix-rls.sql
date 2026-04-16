-- ══════════════════════════════════════════════════════════════════════════
-- Fix INSERT permission on pings table — disable RLS, rely on GRANTs
--
-- Why disable RLS here:
-- The new sb_publishable_* keys don't map cleanly to anon/authenticated/
-- PUBLIC for RLS evaluation. Since this table is write-only by design
-- (only INSERT is granted, no SELECT/UPDATE/DELETE), GRANT-based access
-- control is sufficient and simpler. service_role still reads as needed.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- ══════════════════════════════════════════════════════════════════════════

-- Make sure the GRANTs are in place (idempotent)
GRANT INSERT ON TABLE pings TO anon;
GRANT INSERT ON TABLE pings TO authenticated;

-- Drop any leftover policies
DROP POLICY IF EXISTS "anon_insert_pings"          ON pings;
DROP POLICY IF EXISTS "pings_insert_anon"          ON pings;
DROP POLICY IF EXISTS "pings_insert_authenticated" ON pings;
DROP POLICY IF EXISTS "pings_insert_public"        ON pings;

-- Disable RLS — security comes from GRANT INSERT only (no SELECT grant)
ALTER TABLE pings DISABLE ROW LEVEL SECURITY;

-- Verify (optional):
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'pings';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_name = 'pings';
