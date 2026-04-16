-- ══════════════════════════════════════════════════════════════════════════
-- pings table — anonymous install + alive tracking
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pings (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event      TEXT NOT NULL CHECK (event IN ('install', 'alive', 'update')),
  version    TEXT,
  hardware   TEXT,
  os         TEXT,
  country    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_pings_event ON pings(event);
CREATE INDEX IF NOT EXISTS idx_pings_created ON pings(created_at);

-- RLS: allow anonymous inserts only (no read, no update, no delete)
ALTER TABLE pings ENABLE ROW LEVEL SECURITY;

-- Allow inserts from anon AND authenticated roles. Both publishable
-- (sb_publishable_*) and the legacy anon key need to be covered;
-- the new publishable key format also satisfies "authenticated" in
-- some contexts, so granting both keeps the policy permissive enough
-- without exposing reads/updates/deletes.
CREATE POLICY "pings_insert_anon"          ON pings FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "pings_insert_authenticated" ON pings FOR INSERT TO authenticated WITH CHECK (true);

-- No SELECT for anon/authenticated (only service_role can read)
-- This means the data is write-only from the client side.

COMMENT ON TABLE pings IS 'Anonymous usage pings — install events and monthly alive heartbeats. No PII, no GPS, no UUID.';
