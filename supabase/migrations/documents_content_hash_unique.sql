-- documents_content_hash_unique.sql
-- [DEDUP-ATOMIC] Make the byte-hash dedup RACE-SAFE.
--
-- The interactive upload paths (src/app/api/intake, /api/email/upload, /api/bank/attach-invoice)
-- dedup with a SELECT-then-INSERT on (user_id, content_hash). Two CONCURRENT requests for the same
-- file — a double-tap, or a client retry of a slow request — can both pass the SELECT before either
-- inserts, so both insert. That creates two documents + two invoices for ONE bill; attach-invoice
-- inserts status='paid', so the cost + voorbelasting are DOUBLE-COUNTED immediately. The email SYNC
-- path was already race-safe (UNIQUE on (receiver_id, source_message_id) + 23505 handling); the
-- interactive paths had the same dedup LOGIC but no DB constraint behind it.
--
-- This adds the missing UNIQUE index. The three routes now catch its 23505 and return a clean
-- "duplicate" (never a second invoice), exactly like the SELECT-found duplicate.
--
-- SAFE TO APPLY. Step 1 removes ONLY orphan byte-duplicate documents — copies that carry NO invoice
-- link (pure re-uploads; no bookkeeping row depends on them) — keeping one row per (user_id,
-- content_hash), preferring the invoice-linked/earliest one. An invoice-linked document is NEVER
-- deleted. If two invoice-LINKED documents still share a hash afterwards, step 2 errors out: that is
-- a real, already-double-booked invoice to resolve by hand (delete the duplicate invoice), not
-- something to paper over.

-- 1) Drop orphan (unlinked) byte-duplicate documents. row_number keeps rank 1 per (user, hash):
--    invoice-linked first, then earliest created_at, then smallest id — a fully deterministic keep.
--    Only ranks > 1 that have NO invoice_id are deleted, so nothing linked to bookkeeping is lost.
DELETE FROM public.documents
WHERE id IN (
  SELECT id FROM (
    SELECT id, invoice_id,
           row_number() OVER (
             PARTITION BY user_id, content_hash
             ORDER BY (invoice_id IS NOT NULL) DESC, created_at ASC, id ASC
           ) AS rn
    FROM public.documents
    WHERE content_hash IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1 AND ranked.invoice_id IS NULL
);

-- 2) The race-safe UNIQUE index (partial — only rows that actually carry a hash).
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_content_hash
  ON public.documents (user_id, content_hash) WHERE content_hash IS NOT NULL;
