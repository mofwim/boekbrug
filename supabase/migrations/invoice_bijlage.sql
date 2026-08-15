-- supabase/migrations/invoice_bijlage.sql
-- [FACTUUR-BIJLAGE] Eén eigen bestand meesturen met de factuurmail.
--
-- ── WAT ER ONTBRAK ──
-- De factuurmail draagt precies één ding: de PDF die de app zelf maakt. Voor een schilder die een
-- werkbon meestuurt, een adviseur met een urenstaat of een leverancier met een pakbon is dat niet
-- genoeg — hun klant kan de factuur niet verwerken zonder dat papier erbij. De uitweg was de
-- factuur uit BoekBrug halen en hem met de hand vanuit een eigen mailprogramma versturen, en
-- daarmee valt alles weg wat deze app eromheen doet: het verzendspoor, de herinneringen, de
-- koppeling met de bank.
--
-- ── WAAROM ÉÉN, EN NIET EEN LIJST ──
-- Eén kolom, geen koppeltabel. Het werkelijke geval is één bijlage — een bon, een staat, een
-- pakbon — en voor de zeldzame twee bestaat er al een weg in deze app: voeg ze samen tot één PDF
-- (/pdf-samenvoegen). Een koppeltabel met RLS-policies erbij is meer machinerie dan het probleem
-- groot is, en machinerie die niemand gebruikt gaat stuk zonder dat het opvalt.
--
-- ── DE BIJLAGE IS EEN VERWIJZING, GEEN KOPIE ──
-- Hij wijst naar een rij in `documents` die de ondernemer al heeft. Geen tweede exemplaar in de
-- opslag, dus geen tweede versie die kan gaan afwijken van het origineel. Gooit hij het bestand
-- weg, dan wordt deze verwijzing NULL (ON DELETE SET NULL) en gaat de factuurmail zonder bijlage —
-- nooit een factuur die niet verstuurd kan worden omdat er een bestand ontbreekt dat de ondernemer
-- zelf heeft opgeruimd.
--
-- ── WAT DE APP ERMEE DOET ──
-- Bij het versturen wordt het bestand opgehaald en meegestuurd. Lukt dat NIET, dan wordt er
-- geweigerd — vóór er een factuurnummer wordt gemunt. Zie de kop van invoice-attachment.ts: een
-- factuur die de deur uit gaat zonder de bijlage die de ondernemer er bewust bij zette, is een
-- onvolledig pakket bij de klant, en het nummer is dan al onomkeerbaar verbruikt (Art. 35).
--
-- Idempotent. Draait veilig meerdere keren.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS attachment_document_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_attachment_document_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_attachment_document_id_fkey
      FOREIGN KEY (attachment_document_id)
      REFERENCES public.documents (id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- De weg die de verstuurroute loopt: van factuur naar bijlage. Klein en zeldzaam gevuld, dus een
-- gedeeltelijke index.
CREATE INDEX IF NOT EXISTS invoices_attachment_document_id_idx
  ON public.invoices (attachment_document_id)
  WHERE attachment_document_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.attachment_document_id IS
  '[FACTUUR-BIJLAGE] Eén eigen bestand dat met de factuurmail meegaat. Een verwijzing naar '
  'documents, nooit een kopie. Wordt NULL als de ondernemer het bestand weggooit.';
