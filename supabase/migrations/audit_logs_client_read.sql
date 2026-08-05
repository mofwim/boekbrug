-- audit_logs_client_read.sql
-- [SPOOR-KLANT] De ondernemer mag zien wat er in ZIJN administratie is gebeurd — ook als iemand
-- anders het deed.
--
-- HET GAT
--   CREATE POLICY "Users see own logs" ON public.audit_logs
--     FOR SELECT TO public USING (auth.uid() = user_id);
--
-- `user_id` op audit_logs is de ACTOR: wie de handeling verrichtte. Dus zag iedereen zijn eigen
-- daden, en niemand die van een ander. Zolang alleen de ondernemer zelf schreef, viel dat samen.
-- Sinds vandaag valt het uit elkaar: een gemachtigde boekhouder reikt facturen uit onder het
-- BTW-nummer van zijn klant, herinnert diens afnemers, en bevestigt diens inkoopfacturen — en
-- elke auditregel daarvan staat op naam van de BOEKHOUDER. De ondernemer, die er wettelijk
-- aansprakelijk voor blijft (art. 35a Wet OB, art. 52 AWR), kon er precies niets van zien.
--
-- Wij hebben hem meldingen gegeven bij elke handeling, en dat blijft de dagelijkse weg. Maar een
-- melding is vluchtig: je leest hem, hij verdwijnt, en over twee jaar is de vraag niet "wat kreeg
-- ik te zien" maar "wat is er gebeurd". Dát is waar een auditspoor voor is, en het stond voor de
-- enige persoon die het nodig heeft op slot.
--
-- WAAROM DIT GEEN ÉÉN REGEL IS
--
-- Een auditregel wijst met (entity_type, entity_id) naar iets, en per soort hangt dat aan een
-- andere tabel. Er bestaat geen kolom "eigenaar" om op te filteren; die moet per soort worden
-- opgezocht. Vandaar een SECURITY DEFINER-functie met een EXPLICIETE lijst, en niet iets slims:
-- een nieuwe entity_type valt buiten de lijst en is dus NIET zichtbaar — de veilige kant. Zou de
-- functie bij twijfel `true` teruggeven, dan opent elke nieuwe soort ongemerkt andermans spoor.
--
-- WAT DIT NADRUKKELIJK NIET DOET
--   · Het toont geen regels van een ANDERE ondernemer. De koppeling is de rij zelf: de factuur
--     moet van hem zijn.
--   · Het geeft de boekhouder niets nieuws. Hij ziet zijn eigen daden al via de bestaande policy;
--     deze regel is er uitsluitend voor de kant die niets zag.
--   · Het toont geen ip_address van een ander. Die kolom is opzettelijk niet uitgesloten — een
--     auditspoor zonder herkomst is een half spoor — maar de enige regels die hierdoor extra
--     zichtbaar worden, gaan over de eigen administratie van de lezer.

-- ── De vraag: gaat deze auditregel over de administratie van deze mens? ──────
CREATE OR REPLACE FUNCTION public.audit_row_is_about_me(
  p_entity_type text,
  p_entity_id   uuid,
  p_viewer      uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_entity_type
    -- Een factuur is van hem als hij hem verstuurt of ontvangt. Dit dekt alles wat een
    -- gemachtigde boekhouder doet: uitreiken, herinneren, bevestigen.
    WHEN 'invoice' THEN EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.id = p_entity_id
         AND (i.sender_id = p_viewer OR i.receiver_id = p_viewer)
    )
    -- De machtiging zelf: verleend, ingetrokken, door wie. De klant hoort dat te kunnen nalezen,
    -- juist omdat de boekhouder hem óók mag intrekken.
    WHEN 'accountant_invoice_mandate' THEN EXISTS (
      SELECT 1 FROM public.accountant_invoice_mandates m
       WHERE m.id = p_entity_id
         AND m.zzper_id = p_viewer
    )
    -- Koppelen en ontkoppelen. entity_id is de accountant_clients-rij; die kan zijn verwijderd
    -- (ontkoppelen is een DELETE), en dan is er niets meer om aan te toetsen. Bij twijfel: niet
    -- tonen. De klant houdt de e-mail en de melding die hij op dat moment kreeg.
    WHEN 'accountant_client' THEN EXISTS (
      SELECT 1 FROM public.accountant_clients ac
       WHERE ac.id = p_entity_id
         AND ac.zzper_id = p_viewer
    )
    -- Alles wat hier niet staat: NIET zichtbaar. Zie de kop — een nieuwe soort hoort dicht te
    -- beginnen en pas open te gaan als iemand er bewust over heeft nagedacht.
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.audit_row_is_about_me(text, uuid, uuid) IS
  '[SPOOR-KLANT] Gaat deze auditregel over de administratie van p_viewer? Expliciete lijst per entity_type; een onbekende soort geeft false (dicht). Gebruikt door audit_logs_about_me.';

-- ── De policy ────────────────────────────────────────────────────────────────
-- ADDITIEF naast "Users see own logs": die blijft ongewijzigd, zodat iedereen zijn eigen daden
-- blijft zien. Deze voegt er één ding aan toe — de daden van een ander IN JOUW BOEKEN.
--
-- De volgorde van de condities is niet toevallig: eerst de goedkope ongelijkheid (het is niet
-- mijn eigen regel, die zag ik al), dan pas de opzoekfunctie.
DROP POLICY IF EXISTS audit_logs_about_me ON public.audit_logs;
CREATE POLICY audit_logs_about_me ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    user_id IS DISTINCT FROM auth.uid()
    AND entity_id IS NOT NULL
    AND public.audit_row_is_about_me(entity_type, entity_id, auth.uid())
  );

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Staat hij er, naast de bestaande?
--    SELECT policyname FROM pg_policies
--     WHERE schemaname='public' AND tablename='audit_logs' ORDER BY 1;
--    Verwacht: "Users see own logs" én audit_logs_about_me.
--
-- 2) Het echte bewijs: laat een gemachtigde boekhouder één factuur namens een klant versturen,
--    log daarna in als die KLANT en draai
--      SELECT action, user_id, created_at FROM public.audit_logs
--       WHERE entity_type='invoice' ORDER BY created_at DESC LIMIT 5;
--    Verwacht: hij ziet de regel, met de boekhouder in user_id. Vóór deze migratie: geen rijen.
--
-- 3) En de andere kant, die dicht moet blijven: dezelfde query als een WILLEKEURIGE andere
--    ondernemer geeft die regel NIET.
