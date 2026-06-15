-- =====================================================================
-- [BRIDGE-D] Soft-delete test-data pollution  -  6 documents
-- =====================================================================
-- Scope (Option A, reversible):
--   * Soft-delete ONLY (trashed = true) on 6 confirmed junk documents.
--   * NO folder deletion        (folders lack a `trashed` column; FK risk).
--   * NO storage deletion       (rows still point to objects -> no orphans).
--   * NO schema change          (guard cancelled: folder_type is a category,
--                                not a key; init is sound; dup is inert).
--   -> Folders + storage objects deferred to a later HARD-cleanup ticket.
--
-- Why these 6 are safe (BRIDGE-DIAG-01 verification):
--   invoice_id = null  AND  used_by_invoice = 0  for all six.
--   '2026-0285.pdf' is NOT a real invoice (3740 bytes, unreferenced).
--   The two 'مهم.docx' rows are the SAME file (identical 157828 bytes).
--
-- Run order (REVIEW each step's output before running the next):
--   STEP 1  snapshot   -> keep this output as the pre-change record
--   STEP 2  soft update -> expect: UPDATE 6
--   STEP 3  verify      -> all six show trashed = true
--   THEN run: scripts/bridge-d-audit.ts   (writes audit_logs via logAuditAction)
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1  -  SNAPSHOT  (pre-change record; copy/keep this output)
-- ---------------------------------------------------------------------
SELECT
  id,
  user_id,
  file_name,
  file_url,
  file_size,
  file_type,
  folder_id,
  shared,
  invoice_id,
  trashed,
  trashed_at,
  created_at
FROM public.documents
WHERE id IN (
  '45a026eb-59bd-4349-ac10-8251b820978e',  -- مشروع المحاسب.docx            (folder c78ef0cf, /shared/ path)
  'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',  -- English_Content_Network_...    (folder c78ef0cf, full public URL)
  '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',  -- مهم.docx                        (folder c78ef0cf)
  'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',  -- مهم.docx  (duplicate, same size) (folder c89af5db)
  'f15a973a-30d1-4404-bff0-6d4eade2c93d',  -- 2026-0285.pdf  (not a real invoice) (folder c89af5db)
  '8cdccc7b-86c2-4d74-ac54-eb5c416caa06'   -- Kiwi Offerfeest...xlsx          (folder c89af5db)
)
ORDER BY created_at;


-- ---------------------------------------------------------------------
-- STEP 2  -  SOFT DELETE  (reversible)
-- Idempotent: the `AND trashed = false` guard means re-running this
-- statement will NOT reset trashed_at on already-trashed rows.
-- Expected result: UPDATE 6
-- ---------------------------------------------------------------------
UPDATE public.documents
SET
  trashed    = true,
  trashed_at = now()
WHERE id IN (
  '45a026eb-59bd-4349-ac10-8251b820978e',
  'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',
  '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',
  'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',
  'f15a973a-30d1-4404-bff0-6d4eade2c93d',
  '8cdccc7b-86c2-4d74-ac54-eb5c416caa06'
)
AND trashed = false;


-- ---------------------------------------------------------------------
-- STEP 3  -  VERIFY  (all six must show trashed = true)
-- ---------------------------------------------------------------------
SELECT id, file_name, trashed, trashed_at
FROM public.documents
WHERE id IN (
  '45a026eb-59bd-4349-ac10-8251b820978e',
  'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',
  '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',
  'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',
  'f15a973a-30d1-4404-bff0-6d4eade2c93d',
  '8cdccc7b-86c2-4d74-ac54-eb5c416caa06'
)
ORDER BY created_at;


-- ---------------------------------------------------------------------
-- ROLLBACK  (if needed, before/after audit -- fully reverses STEP 2)
-- ---------------------------------------------------------------------
-- UPDATE public.documents
-- SET trashed = false, trashed_at = NULL
-- WHERE id IN (
--   '45a026eb-59bd-4349-ac10-8251b820978e',
--   'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',
--   '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',
--   'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',
--   'f15a973a-30d1-4404-bff0-6d4eade2c93d',
--   '8cdccc7b-86c2-4d74-ac54-eb5c416caa06'
-- );
-- =====================================================================
