-- [AFZENDERREGEL] "Altijd negeren van deze afzender."
--
-- Eén adres in de mailbox stuurt elke week een PDF die geen boekbaar stuk is — een reclamemail,
-- een nieuwsbrief, een overzicht waar niets mee geboekt hoeft te worden. De AI leest hem, de
-- wachtrij toont hem, de eigenaar negeert hem. Volgende week weer. Eén regel maakt daar een eind
-- aan.
--
-- Bewust ÉÉN soort regel: overslaan. Geen categorieën, geen btw-standaarden, geen automatisch
-- doorboeken. Een regel die alleen iets NIET importeert kan hooguit één fout maken (te veel
-- overslaan), en die fout is zichtbaar in de skip-registry en met één tik terug te draaien.
--
-- Per ADRES, nooit per domein: "@kpn.com" zou de reclamemail én de echte telefoonrekening treffen.
--
-- Waarom een eigen tabel en geen kolom op suppliers: de afzender van een mail is niet hetzelfde
-- als een leverancier. Juist de adressen waar dit over gaat (noreply@, nieuwsbrief@) worden nooit
-- een leverancier, want er komt nooit een boekbare factuur vandaan.

CREATE TABLE IF NOT EXISTS public.email_sender_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- Altijd genormaliseerd opgeslagen: kleine letters, alleen het adresdeel (zie
  -- normalizeSenderEmail in src/lib/sender-rules.ts). De import vergelijkt op exact deze vorm.
  sender_email text NOT NULL,
  -- Alleen 'ignore' bestaat vandaag. De kolom staat er zodat een tweede soort regel later geen
  -- migratie van bestaande rijen nodig heeft — niet omdat er al een tweede gepland is.
  action text NOT NULL DEFAULT 'ignore',
  -- Waar kwam deze regel vandaan? Puur voor uitleg achteraf ("dit stelde de app voor nadat je
  -- drie keer iets van dit adres negeerde"). Nooit gedrag.
  created_from_invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_sender_rules_pkey PRIMARY KEY (id),
  CONSTRAINT email_sender_rules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT email_sender_rules_action_check CHECK (action IN ('ignore'))
);

-- Eén regel per adres per gebruiker. Maakt "regel toevoegen" idempotent: nog een keer op de knop
-- drukken kan nooit twee regels opleveren.
CREATE UNIQUE INDEX IF NOT EXISTS email_sender_rules_user_email_uidx
  ON public.email_sender_rules (user_id, sender_email);

ALTER TABLE public.email_sender_rules ENABLE ROW LEVEL SECURITY;

-- Strikt eigen rijen, alle vier de handelingen. Er is geen enkele reden waarom een boekhouder
-- of wie dan ook aan de mailboxregels van een ander zou moeten komen.
DROP POLICY IF EXISTS email_sender_rules_select_own ON public.email_sender_rules;
CREATE POLICY email_sender_rules_select_own ON public.email_sender_rules
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS email_sender_rules_insert_own ON public.email_sender_rules;
CREATE POLICY email_sender_rules_insert_own ON public.email_sender_rules
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS email_sender_rules_update_own ON public.email_sender_rules;
CREATE POLICY email_sender_rules_update_own ON public.email_sender_rules
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS email_sender_rules_delete_own ON public.email_sender_rules;
CREATE POLICY email_sender_rules_delete_own ON public.email_sender_rules
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Tabel, unieke index en RLS staan er, en er zijn vier policies. Alles moet true zijn.
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'email_sender_rules') AS heeft_tabel,
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'email_sender_rules_user_email_uidx') AS heeft_unieke_index,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_sender_rules'::regclass) AS rls_aan,
  (SELECT count(*) = 4 FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'email_sender_rules') AS heeft_vier_policies;
