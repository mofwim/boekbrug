-- repair_mandate_policies.sql
-- [HERSTEL] Wat er na de vier migraties nog ontbrak — en niets anders.
--
-- WAAROM DIT BESTAND BESTAAT IN PLAATS VAN "DRAAI DIE TWEE OPNIEUW"
--
-- De drie ontbrekende policies staan in de STAART van accountant_invoice_mandate.sql. Dat bestand
-- opnieuw draaien zou ze aanmaken, maar het herschrijft onderweg ook has_active_invoice_mandate()
-- en prevent_accountant_amount_changes() — en die zijn intussen door accountant_confirm_mandate.sql
-- verbeterd (filter op kind, plus uitzondering 5). Je zou dus één gat dichten en er twee openen,
-- precies de volgordeval die in beide bestanden inmiddels als waarschuwing staat.
--
-- Dit bestand definieert daarom GEEN ENKELE FUNCTIE. Alleen de policies en de kolom die misten.
-- Het is idempotent en de volgorde ten opzichte van alle andere migraties doet er niet toe.
--
-- WAT ER MISTE, EN WAT DAT DEED
--   · invoices_mandate_draft_read / _issue en invoice_lines_mandate_read
--     Zonder deze drie geeft ELKE factuur namens een klant een 404. /api/invoice/draft schrijft
--     het concept met service_role (dat lukt), waarna /api/invoice/send het met de SESSIE-client
--     terugleest — en nul rijen krijgt, want een concept is niet `shared`. Er blijft een concept
--     achter in de administratie van de klant, en elke nieuwe poging maakt er nog één.
--   · deletion_requests.purge_warning_sent_at
--     decidePurge() eist sinds kort een aantoonbare brief van 30 dagen oud (voorwaarden §5.7.5).
--     Zonder de kolom kan die brief niet worden vastgelegd, dus wist de purge NIETS — de veilige
--     kant, en precies waarom dit geen spoedgeval was. Maar de belofte staat pas als de kolom er is.

-- ── 1. De boekhouder moet het concept KUNNEN ZIEN dat hij zojuist liet maken ──
-- Alle bestaande boekhouderspolicies hangen aan de gegenereerde kolom `shared`:
--     shared boolean GENERATED ALWAYS AS (status = ANY (ARRAY['sent','received','paid'])) STORED
-- Een concept is dus per definitie onzichtbaar voor hem. Elke voorwaarde hieronder is dezelfde als
-- in uitzondering 4 van prevent_accountant_amount_changes(): een leesrecht dat ruimer is dan het
-- schrijfrecht laat hem rondkijken in concepten die hij nooit mag aanraken.
DROP POLICY IF EXISTS invoices_mandate_draft_read ON public.invoices;
CREATE POLICY invoices_mandate_draft_read ON public.invoices
  FOR SELECT TO authenticated
  USING (
    status = 'draft'
    AND created_by = auth.uid()
    AND public.has_active_invoice_mandate(auth.uid(), sender_id)
  );

-- De UPDATE die het nummer vastlegt en de status op 'sent' zet.
--   USING      kijkt naar de OUDE rij: nog een concept, en van hem.
--   WITH CHECK kijkt naar de NIEUWE rij, en mag daarom NIET op status = 'draft' staan — na deze
--              update is hij 'sent'. Wat er verder niet mag bewegen (bedragen, sender_id, richting)
--              bewaakt de trigger, die hier gewoon overheen loopt.
DROP POLICY IF EXISTS invoices_mandate_draft_issue ON public.invoices;
CREATE POLICY invoices_mandate_draft_issue ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    status = 'draft'
    AND created_by = auth.uid()
    AND public.has_active_invoice_mandate(auth.uid(), sender_id)
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_active_invoice_mandate(auth.uid(), sender_id)
  );

-- De regels, want de PDF wordt uit de regels gerenderd. invoice_lines_select_accountant bestaat
-- al, maar eist `i.status = 'paid'` — bedoeld voor het nakijken van een afgeronde factuur, niet
-- voor het maken van er een. Zonder deze policy rendert de PDF met een lege regeltabel: een
-- factuur zonder inhoud, met een verbruikt nummer.
DROP POLICY IF EXISTS invoice_lines_mandate_read ON public.invoice_lines;
CREATE POLICY invoice_lines_mandate_read ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_lines.invoice_id
      AND i.created_by = auth.uid()
      AND public.has_active_invoice_mandate(auth.uid(), i.sender_id)
  ));

-- ── 2. De 30-dagenbrief van §5.7.5 kan pas worden vastgelegd met deze kolom ──
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS purge_warning_sent_at timestamptz;

COMMENT ON COLUMN public.deletion_requests.purge_warning_sent_at IS
  '[WAARSCHUWING] Wanneer de 30-dagenbrief van voorwaarden art. 5.7.5 is verstuurd. NULL = niet verstuurd, en dan weigert decidePurge() te wissen. Wordt nooit gewist zodra hij gezet is: hij is het bewijs dat er is gewaarschuwd.';

CREATE INDEX IF NOT EXISTS deletion_requests_unwarned_idx
  ON public.deletion_requests (data_eligible_for_deletion_at)
  WHERE purge_warning_sent_at IS NULL AND purged_at IS NULL;

-- =====================================================================
-- CONTROLE — draai dit blok NA de migratie.
-- =====================================================================
-- 1) Staan de acht policies er nu allemaal?
--    SELECT tablename, policyname FROM pg_policies
--     WHERE schemaname='public' AND policyname IN (
--       'invoices_mandate_draft_read','invoices_mandate_draft_issue','invoice_lines_mandate_read',
--       'invoices_mandate_confirm_read','invoices_mandate_confirm_write',
--       'accountant_invoice_mandates_select','folders_accountant_read','audit_logs_about_me')
--     ORDER BY 1,2;
--    Verwacht: ACHT rijen.
--
-- 2) En de kolom:
--    SELECT count(*) FROM information_schema.columns
--     WHERE table_name='deletion_requests' AND column_name='purge_warning_sent_at';
--    Verwacht: 1.
--
-- 3) Dit bestand raakt GEEN functies aan, dus deze twee horen onveranderd true te blijven —
--    controleer het toch, want het is de goedkoopste manier om zeker te weten dat er niets is
--    teruggerold:
--    SELECT (SELECT prosrc LIKE '%has_active_confirm_mandate%' FROM pg_proc
--             WHERE proname='prevent_accountant_amount_changes' LIMIT 1) AS guard_kent_bevestigen,
--           (SELECT prosrc LIKE '%kind%' FROM pg_proc
--             WHERE proname='has_active_invoice_mandate' LIMIT 1)        AS soort_filter_actief;
--    Verwacht: true, true.
