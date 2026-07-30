-- [STATEMENT-CONTINUITY] Wat beslaat een ingelezen bankafschrift, en met welke saldi?
--
-- WAAROM
-- We controleren al of één afschrift IN ZICHZELF klopt (beginsaldo + mutaties = eindsaldo,
-- bank-statement-balance.ts). Wat we niet konden zien is het afschrift dat er niet is: wie
-- januari en maart uploadt en februari vergeet, heeft twee bestanden die allebei perfect
-- kloppen en een maand aan betalingen die nergens bestaat. De readiness keek alleen of het
-- kwartaal ÉÉN transactie had, dus die maand viel er stilletjes tussenuit.
--
-- Om dat te kunnen zien moeten we per afschrift onthouden welke PERIODE het beslaat en met
-- welke saldi het begint en eindigt. De parser leest die gegevens al uit MT940/CAMT — ze
-- werden alleen nergens bewaard. Deze tabel is die herinnering, en niets meer:
--   · geen bedragen die meetellen in een boeking (dit is administratie, geen grootboek),
--   · één rij per opgeslagen afschrift (documents.id is de sleutel),
--   · verdwijnt mee met het bestand (ON DELETE CASCADE), zodat "afschrift verwijderen"
--     ook deze herinnering opruimt en een her-import schoon begint.
--
-- Idempotent: veilig meerdere keren te draaien.

CREATE TABLE IF NOT EXISTS public.bank_statement_periods (
  document_id     uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- De rekening waar dit afschrift over gaat. Null bij een formaat/bestand zonder IBAN:
  -- de continuïteitscontrole behandelt die rijen dan als één naamloze rekening.
  iban            text,
  -- Eerste en laatste dag die het afschrift beslaat (uit de transactiedata van het bestand).
  period_start    date,
  period_end      date,
  -- Begin-/eindsaldo zoals het afschrift ze ZELF noemt. Null wanneer het formaat ze niet
  -- draagt (CSV) — dan draait alleen de datumcontrole, en dat zegt de app er eerlijk bij.
  opening_balance numeric,
  closing_balance numeric,
  currency        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_statement_periods ENABLE ROW LEVEL SECURITY;

-- Alleen de eigenaar leest zijn eigen afschriftperiodes. Schrijven gebeurt uitsluitend door
-- de import (service_role, net als elke andere pipeline-schrijver), dus er is bewust GEEN
-- INSERT/UPDATE-policy voor de ingelogde gebruiker.
DROP POLICY IF EXISTS bsp_owner_read ON public.bank_statement_periods;
CREATE POLICY bsp_owner_read ON public.bank_statement_periods
  FOR SELECT USING (auth.uid() = user_id);

-- De volgorde waarin de continuïteitscontrole leest: per gebruiker, per rekening, op datum.
CREATE INDEX IF NOT EXISTS idx_bsp_user_iban_start
  ON public.bank_statement_periods (user_id, iban, period_start);

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- Verwacht: 1 rij (de tabel bestaat), rls_enabled = true, 1 policy, 2 indexen (pkey + idx).
--
-- SELECT c.relname,
--        c.relrowsecurity AS rls_enabled,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname = 'public' AND p.tablename = 'bank_statement_periods') AS policies,
--        (SELECT count(*) FROM pg_indexes i
--          WHERE i.schemaname = 'public' AND i.tablename = 'bank_statement_periods') AS indexes
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relname = 'bank_statement_periods';
