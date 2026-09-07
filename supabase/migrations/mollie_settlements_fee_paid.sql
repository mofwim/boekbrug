-- [MOLLIE-AFREKENING] Wanneer de kostenfactuur van Mollie is afgeboekt.
-- BoekBrug · september 2026
--
-- WAAROM
-- fee_invoice_id zei alleen dat de kostenfactuur BESTOND. Onder "ik kijk zelf naar alles" wacht
-- die factuur in de wachtrij en is hij nog niet afgeboekt; en als de RPC één keer faalde, werd hij
-- nooit meer geprobeerd — een openstaande schuld aan Mollie die geen bankregel ooit betaalt, in
-- de prognose en op het betaalscherm. De sync legt nu het MOMENT van afboeken vast en probeert
-- het elke run opnieuw zolang dat leeg is.
--
-- Ook de betekenis van 'held' klopt nu met de code: de betalingen zijn niet allemaal van ons, OF
-- er zit een terugbetaling/chargeback in, OF de bankregel is niet gevonden of niet gecodeerd, OF
-- de kostenfactuur is nog niet afgeboekt.
--
-- APPLY: draaien in de Supabase SQL editor. Verwijdert niets. Idempotent.

ALTER TABLE public.mollie_settlements ADD COLUMN IF NOT EXISTS fee_paid_at timestamptz;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'mollie_settlements' AND column_name = 'fee_paid_at';
