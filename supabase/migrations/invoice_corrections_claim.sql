-- [VOORSTEL] Eén beslissing per voorstel: de claimkolom.
-- BoekBrug · september 2026
--
-- WAAROM
-- Akkoord loopt door de correctiedeur van de klant en sluit daarna de voorstelrij. Tussen die
-- twee stappen zit een venster, en twee tabbladen (of Akkoord en Niet akkoord vlak na elkaar)
-- konden daarin allebei de deur laten draaien of de rij in tegenspraak met de factuur achterlaten.
-- De route claimt de rij nu eerst (applying_since), compare-and-set op status = open en geen
-- levende claim; alleen de claimende aanvraag mag daarna de rij sluiten. Een claim ouder dan twee
-- minuten geldt als dood (de aanvraag stierf) en wordt genegeerd.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

ALTER TABLE public.invoice_corrections ADD COLUMN IF NOT EXISTS applying_since timestamptz;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice_corrections' AND column_name = 'applying_since';
