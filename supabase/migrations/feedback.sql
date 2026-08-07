-- supabase/migrations/feedback.sql
-- [FEEDBACK] "Er ging iets mis" — een bericht van de ondernemer, met eventueel een schermafbeelding.
--
-- WAAROM DEZE TABEL BESTAAT
-- De hele app is gebouwd om niet stil te falen: het overslag-paneel geeft toe wat het niet kon
-- lezen, de bankpagina zegt wanneer een regel kan blijven terugkomen, een mislukte read weigert in
-- plaats van "niets" te antwoorden. Maar die eerlijkheid houdt op bij het scherm. De ondernemer
-- krijgt te horen dat er iets misging, en er is geen weg waarlangs dat iemand bereikt die het kan
-- repareren — van buitenaf is het app-eigen alarm dus niet te onderscheiden van stilte.
--
-- De RIJ is de waarheid, niet de e-mail. Een melding kan mislukken (Resend weigert, de sleutel
-- ontbreekt); dan staat het bericht er nog steeds en is het terug te vinden. Andersom zou een
-- bericht dat alleen als e-mail bestaat verloren zijn zodra die e-mail niet aankomt — precies de
-- stilte waar deze tabel tegen is.
--
-- IDEMPOTENT: opnieuw draaien kan geen kwaad.

CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Het bericht zelf. NOT NULL: een lege melding is geen melding — src/lib/feedback.ts weigert hem
  -- al met een eigen zin, en de kolom mag die regel niet stilletjes ondermijnen.
  message     text NOT NULL CHECK (length(btrim(message)) BETWEEN 4 AND 4000),
  -- Welke pagina. Wordt MEEGESTUURD, niet gevraagd: "welke pagina?" is de vraag die iemand onder
  -- stress verkeerd beantwoordt, en de app weet het zelf. Zonder querystring (zie feedback.ts).
  page_path   text,
  -- Het pad in de bestaande `documents`-bucket: <user_id>/feedback/<...>. Geen nieuwe bucket en
  -- geen nieuw beleid — het bestaande eigenaar-pad-beleid dekt dit al.
  image_path  text,
  -- Wat de browser was. Een bug die alleen op één telefoon gebeurt is anders niet te reproduceren.
  user_agent  text,
  -- 'new' | 'seen' | 'done'. Vrij tekstveld met CHECK: statusstromen groeien, en een enum
  -- uitbreiden is een migratie waar een CHECK dat niet is.
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'done')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- De enige leesvolgorde die telt: nieuwste eerst, per gebruiker.
CREATE INDEX IF NOT EXISTS feedback_user_created_idx
  ON public.feedback (user_id, created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Schrijven: alleen voor jezelf. `WITH CHECK` op auth.uid() — anders kan een geldig ingelogde
-- gebruiker een melding op naam van iemand anders zetten.
DROP POLICY IF EXISTS feedback_insert_own ON public.feedback;
CREATE POLICY feedback_insert_own ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Lezen: alleen je eigen meldingen. De beheerder leest mee via service_role (dat omzeilt RLS) —
-- daar is bewust GEEN policy voor, zodat "wie mag alles zien" niet in de tabel staat maar in de
-- sleutel die de server bewaart.
DROP POLICY IF EXISTS feedback_select_own ON public.feedback;
CREATE POLICY feedback_select_own ON public.feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Geen UPDATE- of DELETE-policy. Een melding is een verslag van een moment; hem later kunnen
-- wijzigen of wissen maakt hem als bewijs waardeloos, en niemand heeft dat nodig.
