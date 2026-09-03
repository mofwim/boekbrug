-- =====================================================================
-- [LES-TELT-MEE] Apply the lessons the owner already taught, to the invoices already in the book.
-- BoekBrug · 3 september 2026
-- =====================================================================
-- WHAT THIS IS FOR. An owner corrects a misread supplier name and the app writes the lesson down in
-- supplier_aliases: "this printed spelling means that supplier". From now on the import reads that
-- lesson back (see supplier-registry.ts and iban-change.ts). The invoices that arrived BEFORE the
-- lesson still carry the misreading in invoices.client_name — and the crediteurenstand groups by
-- that name, not by supplier_id, because a bank line has no supplier_id to group by. So one company
-- stands in the list twice, with its balance split across the two spellings.
--
-- Measured on the account this was found on: 17 of 434 linked invoices display a name that
-- disagrees with the supplier they are linked to, across 7 spellings, EUR 10.748 in total.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not rename every invoice to match its link. Of those
-- 7 spellings only ONE is backed by a lesson the owner wrote by hand; the other six were linked by
-- IBAN or by name key, and among them is a row where the DISPLAYED name is the correct one and the
-- LINK is wrong ("W. Ketels & zn eierhandel" pointing at a supplier row called "Jim Ketels", which
-- is a delivery stamp the reader took for a company). Renaming by link would overwrite the one
-- correct field on that invoice with the mistake.
--
-- So the rule here is narrow and it is the owner's own: change the name only where THIS owner
-- explicitly taught that THIS spelling means THIS supplier. Nothing is inferred, nothing is
-- guessed, and every row it touches is one the owner already corrected once by hand.
--
-- The remaining mismatches are left alone on purpose. They are not silent: /dashboard/leveranciers
-- offers the merge door for two rows that are one company, and the correction sheet fixes a wrong
-- link. Both need evidence a migration does not have.
--
-- WHAT IT TOUCHES. invoices.client_name only. No amount, no btw, no status, no link, no date. The
-- invoice document itself is untouched — this is the name the SCREEN shows, and the paper still
-- says what it always said. supplier_aliases keeps printed_name, so what the paper printed is not
-- lost by this edit; it is exactly where the owner put it.
--
-- MATCHED ON printed_name, NOT ON alias_key. alias_key is the NORMALISED form — supplierNameKey
-- strips punctuation and entity words, so "Silifke / Hocaoglu" is stored as "silifke hocaoglu" and
-- "CHUR MARKT BV" as "chur markt". Comparing it to lower(btrim(client_name)) matches nothing: all
-- three of this account's lessons return false on that test, so an earlier draft of this file would
-- have run clean and changed zero rows. printed_name holds the spelling exactly as it stood on the
-- invoice, which is precisely the string being replaced.
--
-- APPLY: run this whole file in the Supabase SQL editor. Idempotent / re-runnable: a second run
-- finds nothing left to change.
-- =====================================================================

BEGIN;

-- The rows this will touch, before touching them. Read it; it is the whole change.
SELECT i.receiver_id,
       i.invoice_number,
       i.invoice_date,
       i.client_name AS wordt_vervangen,
       s.name        AS wordt,
       a.printed_name AS de_les_van_de_eigenaar
  FROM public.invoices i
  JOIN public.suppliers s
    ON s.id = i.supplier_id
  JOIN public.supplier_aliases a
    ON a.user_id = i.receiver_id
   AND a.supplier_id = i.supplier_id
   AND lower(btrim(a.printed_name)) = lower(btrim(i.client_name))
 WHERE i.client_name IS NOT NULL
   AND lower(btrim(i.client_name)) IS DISTINCT FROM lower(btrim(s.name))
 ORDER BY i.receiver_id, i.invoice_date;

UPDATE public.invoices i
   SET client_name = s.name
  FROM public.suppliers s,
       public.supplier_aliases a
 WHERE s.id = i.supplier_id
   -- The lesson must be THIS owner's, about THIS spelling, pointing at THIS supplier. All three,
   -- or the update reaches an invoice the owner never spoke about.
   AND a.user_id = i.receiver_id
   AND a.supplier_id = i.supplier_id
   AND lower(btrim(a.printed_name)) = lower(btrim(i.client_name))
   AND i.client_name IS NOT NULL
   -- Already right → not touched, so a second run changes nothing.
   AND lower(btrim(i.client_name)) IS DISTINCT FROM lower(btrim(s.name));

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Must return 0: no invoice still shows a spelling its own owner has mapped to the supplier it is
-- linked to. Any OTHER mismatch is out of scope by design and is not counted here.
SELECT count(*) AS nog_te_doen
  FROM public.invoices i
  JOIN public.suppliers s
    ON s.id = i.supplier_id
  JOIN public.supplier_aliases a
    ON a.user_id = i.receiver_id
   AND a.supplier_id = i.supplier_id
   AND lower(btrim(a.printed_name)) = lower(btrim(i.client_name))
 WHERE i.client_name IS NOT NULL
   AND lower(btrim(i.client_name)) IS DISTINCT FROM lower(btrim(s.name));
