-- [STORNO] Een zesde reden om een bankregel apart te zetten: storno.
-- BoekBrug · september 2026
--
-- WAAROM
-- Een teruggeboekte incasso is twee regels die samen nul zijn: het geld ging weg en kwam terug, en
-- de factuur is NIET betaald. Beide regels horen buiten de boeken, met een reden die dat zegt —
-- 'dubbel' of 'niet van mij' is het niet. bank-ignore-reason.ts telt 'storno' niet mee in de
-- boeken, net als privé en dubbel.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_ignore_reason_check;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_ignore_reason_check
  CHECK (
    ignore_reason IS NULL OR ignore_reason IN (
      'prive',            -- privé-uitgave, hoort niet in de boekhouding
      'geen_factuur',     -- vaste last / abonnement waar nooit een factuur bij komt
      'dubbel',           -- deze regel staat er al een keer in
      'niet_van_mij',     -- niet mijn transactie (terugboeking, vergissing)
      'storno',           -- teruggeboekte incasso: geld weg en terug, factuur niet betaald
      'anders'
    )
  );

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'bank_transactions_ignore_reason_check';  → bevat 'storno'
