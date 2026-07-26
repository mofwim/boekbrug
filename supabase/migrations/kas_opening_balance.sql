-- =====================================================================
-- [KAS-OPENING] Cash drawer opening balance (beginsaldo / starting float).
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: openingBalanceForQuarter accepted a startingBalance param but every
-- production caller omitted it, so the opening float was permanently 0. A shop
-- that starts with cash already in the till had no place to record it, so both
-- the headline "SALDO IN KASSA" and the accountant's Kasboek eindsaldo were
-- understated by that float, with the only workaround being a mis-categorised
-- cash_entry (which then produces a wrong number somewhere else).
--
-- FIX: one honest config value on the profile. It is NOT revenue and NOT a cash
-- movement — it is the drawer's balance at the moment bookkeeping started, so it
-- belongs as a starting constant, added to every saldo/eindsaldo computation and
-- never counted as omzet/BTW.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kas_opening_balance numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.kas_opening_balance IS
  '[KAS-OPENING] Cash-in-drawer balance at the moment bookkeeping started (beginsaldo). A starting constant added to the kas saldo / Kasboek eindsaldo — never revenue or BTW.';

COMMIT;
