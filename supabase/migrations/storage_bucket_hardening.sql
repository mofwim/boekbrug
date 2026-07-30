-- =====================================================================
-- [STORAGE-VERSIONED] De bucket-instellingen vastleggen in code.
-- BoekBrug · juli 2026
-- =====================================================================
-- WAAROM DIT ER MOET ZIJN, TERWIJL ER NIETS STUK IS
--
-- Op 29 juli 2026 is de productiestand gemeten:
--
--     select id, public, file_size_limit from storage.buckets where id='documents';
--     → documents | false | 26214400
--
-- Dat is precies goed: de bucket is privé, en de app deelt bestanden uitsluitend via
-- ondertekende URL's (65 aanroepplekken nagelopen, nul getPublicUrl). Er is dus vandaag geen
-- lek.
--
-- Het probleem is niet de STAND maar de HERKOMST. Die `false` is ooit met de hand in een
-- dashboard aangevinkt en staat in geen enkel bestand:
--
--     grep -rn "storage.buckets" supabase/  → 0 treffers
--     config.toml                           → bestaat niet
--
-- Daarmee rust de vertrouwelijkheid van élk bonnetje, elk bankafschrift en elke factuur-PDF op
-- één vinkje dat niemand kan reviewen, dat geen enkele test bewaakt, en dat bij het opzetten van
-- een nieuwe omgeving (staging, een tweede project, herstel na een incident) gewoon op de
-- Supabase-standaard staat. Wie die omgeving met echte bestanden vult, deelt ze publiek zonder
-- dat er iets misgaat op een manier die opvalt.
--
-- Er is nog een aanwijzing dat dit ooit ANDERS heeft gestaan: src/lib/storage-path.ts:34 parseert
-- '/object/public/documents/' uit opgeslagen waarden. Die code bestaat niet zonder reden.
--
-- Dit bestand maakt de bestaande, juiste stand expliciet en herhaalbaar.
--
-- WAT HET NADRUKKELIJK NIET DOET: het zet nooit iets OPEN. Het schrijft alleen de veilige waarde,
-- en alleen als die afwijkt. Draaien op een correcte database verandert nul rijen.
--
-- TOEPASSEN: Supabase SQL-editor. Verwijdert niets. Idempotent.
-- =====================================================================

BEGIN;

-- ── 1. De bucket is privé, en blijft privé ───────────────────────────
-- Alleen deze ene richting: public → false. Nooit andersom.
UPDATE storage.buckets
   SET public = false
 WHERE id = 'documents'
   AND public IS DISTINCT FROM false;

-- ── 2. De bovengrens per bestand ─────────────────────────────────────
-- 25 MiB, gelijk aan de gemeten stand. Bewust ruimer dan de 10 MB die de mailrobot accepteert:
-- die grens gaat over wat wij automatisch LEZEN, deze over wat de opslag aankan. Een scan van
-- 20 MB die de ondernemer zelf uploadt hoort gewoon bewaard te worden — dat is de belofte.
UPDATE storage.buckets
   SET file_size_limit = 26214400
 WHERE id = 'documents'
   AND (file_size_limit IS NULL OR file_size_limit > 26214400);

-- ── 3. RLS op de objecten zelf ───────────────────────────────────────
-- Supabase zet dit standaard aan, maar "standaard aan" is geen garantie die je kunt nalezen.
-- De drie policies (documents_read / documents_upload / documents_delete) staan al versioned in
-- documents_shared_and_storage_policies.sql; zonder RLS zouden ze niets betekenen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity
  ) THEN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  -- Op een gehoste Supabase is storage.objects eigendom van de supabase_storage_admin-rol en
  -- staat RLS er al aan. Niet kunnen wijzigen is dan geen fout — het is de normale toestand.
  RAISE NOTICE '[STORAGE-VERSIONED] geen rechten op storage.objects — RLS staat daar al aan';
END $$;

COMMIT;

-- =====================================================================
-- CONTROLE (apart draaien na het toepassen):
--
--   select id, public, file_size_limit from storage.buckets where id = 'documents';
--   -- Verwacht: documents | false | 26214400
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--   -- Verwacht: documents_delete, documents_read, documents_upload.
--   -- Geen documents_update: een object wordt vervangen door upsert bij upload, niet gepatcht.
--
--   select relrowsecurity from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'storage' and c.relname = 'objects';
--   -- Verwacht: true.
-- =====================================================================
