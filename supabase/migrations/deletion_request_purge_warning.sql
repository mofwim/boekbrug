-- deletion_request_purge_warning.sql
-- [WAARSCHUWING] Eén kolom, en hij maakt een belofte uit de voorwaarden afdwingbaar.
--
-- WAT DE VOORWAARDEN BELOVEN (§5.7.5)
--   "Wij verwijderen daarna niets zonder je minstens 30 dagen vooraf per e-mail te waarschuwen,
--    en in die periode kun je alles alsnog kosteloos exporteren."
--
-- Er was niets dat dat waarmaakte. decidePurge() gaf groen licht op het moment dat de zeven jaar
-- om waren; er is nooit een brief verstuurd. Deze kolom is het bewijs dat hij WEL is verstuurd, en
-- vanaf nu is dat bewijs een VOORWAARDE voor het wissen — niet een stap ervoor.
--
-- Het verschil is niet academisch. Een stap ervóór kan worden overgeslagen: een mislukte cron-run,
-- een uitgezette cron, iemand die de purge ooit los aanroept. Een voorwaarde kan dat niet. Zonder
-- deze kolom, of met een lege waarde, weigert decidePurge() onvoorwaardelijk. De faalstand is
-- daarmee "te lang bewaard" — wat §5.7.5 niets kost — in plaats van "gewist zonder bericht", en
-- dat laatste is het enige wat dat artikel moet voorkomen.
--
-- WAAROM DIT NU WORDT GESCHREVEN EN NIET IN 2033
-- De eerste verwijdering kan niet vóór 2033 vallen. Precies daarom: tegen die tijd herinnert
-- niemand zich die zin meer, en is de code het enige dat hem nog kent.

ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS purge_warning_sent_at timestamptz;

COMMENT ON COLUMN public.deletion_requests.purge_warning_sent_at IS
  '[WAARSCHUWING] Wanneer de 30-dagenbrief van voorwaarden art. 5.7.5 is verstuurd. NULL = niet verstuurd, en dan weigert decidePurge() te wissen. Wordt nooit gewist zodra hij gezet is: hij is het bewijs dat er is gewaarschuwd.';

-- De cron zoekt op "nog niet gewaarschuwd, wel gedeactiveerd". Een partiële index houdt hem klein:
-- de overgrote meerderheid van de rijen is al gewaarschuwd of gaat nooit weg.
CREATE INDEX IF NOT EXISTS deletion_requests_unwarned_idx
  ON public.deletion_requests (data_eligible_for_deletion_at)
  WHERE purge_warning_sent_at IS NULL AND purged_at IS NULL;

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Bestaat de kolom?
--    SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='deletion_requests'
--       AND column_name='purge_warning_sent_at';
--    Verwacht: 1.
--
-- 2) Staat er nog niemand op scherp? Zolang dit 0 is, kan de purge sowieso niets doen.
--    SELECT count(*) FROM public.deletion_requests
--     WHERE purge_warning_sent_at IS NOT NULL;
--
-- 3) Wie zou er als eerste een brief krijgen (alleen kijken, niets doen):
--    SELECT id, user_id, deleted_at, data_eligible_for_deletion_at
--      FROM public.deletion_requests
--     WHERE purged_at IS NULL AND deleted_at IS NOT NULL
--       AND purge_warning_sent_at IS NULL
--       AND data_eligible_for_deletion_at < now() + interval '60 days'
--     ORDER BY data_eligible_for_deletion_at;
--    Verwacht vóór 2033: geen rijen.
