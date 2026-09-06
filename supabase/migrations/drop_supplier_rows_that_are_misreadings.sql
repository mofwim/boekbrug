-- =====================================================================
-- [GEEN-LEVERANCIER] A misread account number is not a company. Remove the rows it founded.
-- BoekBrug · 6 september 2026
-- =====================================================================
-- WHAT HAPPENED. The IBAN tier is the strongest identity key the supplier registry has, and row
-- creation was keyed on it without ever asking whether the number WAS an account number. So every
-- misread digit manufactured a new supplier. Sumer Food B.V. stands in one account's registry seven
-- times: NL78RABO0364345977 is the company, and NL0036434597700, NL3663043450977, NL3603643459977,
-- NL36SUME0364345977, NL36SNSB0363434977 and NL36SUMER0364345977 are the same number read wrong.
--
-- The cause is already fixed. identityIban (supplier-registry.ts, shipped 29 August in 0dfc9fa)
-- refuses a number that fails mod-97, so resolution now falls through to the KVK and name tiers,
-- which is where an unreadable account number belongs. The data proves it: broken rows created per
-- month on the account this was found on — July 5, August 1, September 0.
--
-- This file removes what was created before that guard existed. Nothing else.
--
-- WHY THEY ARE WORTH REMOVING AND NOT JUST IGNORING:
--   · they pad the supplier picker, so an owner scrolling their own list meets the same company
--     seven times and cannot tell which one is theirs;
--   · they split the crediteurenstand, which groups per supplier;
--   · one of them sits in the row knownIbanForVendor reads to answer "did this account number
--     change" — see [BETAALBAAR-NUMMER], which now skips them, but a registry that does not hold
--     them at all is one fewer thing depending on that skip.
--
-- ── WHAT MAKES THIS SAFE ──
--
-- suppliers has exactly two things pointing at it, and they behave differently on delete:
--   · invoices.supplier_id      ON DELETE SET NULL  → deleting a row DETACHES its invoices;
--   · supplier_aliases.supplier_id  ON DELETE CASCADE → deleting a row DESTROYS its lessons.
--
-- Both are losses, so a row that has either is out of scope, however malformed its number. Only a
-- row that NOTHING points at may go: no invoice, no lesson. Such a row carries no history, no
-- money and no owner decision — it is an artefact of a reading, and removing it removes nothing
-- that was ever true.
--
-- Measured across the whole database before writing this: 14 supplier rows hold a number that is
-- not a valid IBAN. SEVEN of them have no invoices and no aliases and are what this deletes. The
-- other seven each carry invoices — Dutch Sweets Company (2), Mollie B.V. (1), W. Ketels en Zoon
-- Eierhandel (1), Tankstation Noordpoort (3), Zakelijk Telecom Nederland (2), Atapack Cash & Carry
-- (1), moha bv (1) — and are deliberately left exactly where they are. Their account number is
-- wrong; that is a correction for the owner to make on the invoice, with the paper in hand. It is
-- not something a migration may decide by detaching eleven invoices from their supplier.
--
-- ── THE CHECK IS mod-97, NOT A SHAPE ──
--
-- An earlier count of these rows used a regular expression for the LOOK of a Dutch IBAN, and it
-- reported six. It missed two: NL36SUME0364345977 and NL36SNSB0363434977 are eighteen characters in
-- exactly the right pattern and fail the checksum. A shape test is not a validity test, so this
-- file computes the real ISO 7064 mod-97-10 — the same rule isValidIban applies in the app, so the
-- database and the code agree about what an account number is.
--
-- APPLY: run this whole file in the Supabase SQL editor. Idempotent / re-runnable: a second run
-- finds nothing left to delete.
-- =====================================================================

BEGIN;

-- The rows this will delete, before deleting them. Read it; it is the whole change.
-- Every one shows facturen = 0 and aliassen = 0, or the DELETE below will not touch it either.
WITH schoon AS (
  SELECT s.id, s.user_id, s.name, s.iban,
         upper(regexp_replace(s.iban, '[^A-Za-z0-9]', '', 'g')) AS c
    FROM public.suppliers s
   WHERE s.iban IS NOT NULL
), letters_als_cijfers AS (
  -- IBAN mod-97: move the first four characters to the end, then read every letter as its
  -- position in the alphabet plus 9 (A = 10 … Z = 35).
  SELECT h.id, h.user_id, h.name, h.iban, h.c,
         string_agg(
           CASE WHEN t.ch ~ '^[0-9]$' THEN t.ch ELSE (ascii(t.ch) - 55)::text END,
           '' ORDER BY t.ord
         ) AS n
    FROM (SELECT id, user_id, name, iban, c, substr(c, 5) || substr(c, 1, 4) AS r FROM schoon) h,
         LATERAL regexp_split_to_table(h.r, '') WITH ORDINALITY AS t(ch, ord)
   GROUP BY h.id, h.user_id, h.name, h.iban, h.c
)
SELECT v.user_id, v.name, v.iban, length(v.c) AS lengte,
       (SELECT count(*) FROM public.invoices i WHERE i.supplier_id = v.id)         AS facturen,
       (SELECT count(*) FROM public.supplier_aliases a WHERE a.supplier_id = v.id) AS aliassen
  FROM letters_als_cijfers v
 WHERE NOT (length(v.c) = 18 AND v.n ~ '^[0-9]+$' AND mod(v.n::numeric, 97) = 1)
   AND NOT EXISTS (SELECT 1 FROM public.invoices i        WHERE i.supplier_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM public.supplier_aliases a WHERE a.supplier_id = v.id)
 ORDER BY v.user_id, v.name, v.iban;

WITH schoon AS (
  SELECT s.id, upper(regexp_replace(s.iban, '[^A-Za-z0-9]', '', 'g')) AS c
    FROM public.suppliers s
   WHERE s.iban IS NOT NULL
), letters_als_cijfers AS (
  SELECT h.id, h.c,
         string_agg(
           CASE WHEN t.ch ~ '^[0-9]$' THEN t.ch ELSE (ascii(t.ch) - 55)::text END,
           '' ORDER BY t.ord
         ) AS n
    FROM (SELECT id, c, substr(c, 5) || substr(c, 1, 4) AS r FROM schoon) h,
         LATERAL regexp_split_to_table(h.r, '') WITH ORDINALITY AS t(ch, ord)
   GROUP BY h.id, h.c
), te_verwijderen AS (
  SELECT id FROM letters_als_cijfers
   WHERE NOT (length(c) = 18 AND n ~ '^[0-9]+$' AND mod(n::numeric, 97) = 1)
)
DELETE FROM public.suppliers s
 USING te_verwijderen t
 WHERE s.id = t.id
   -- Said twice on purpose. The set above should already exclude these, and this is a DELETE on a
   -- table whose foreign keys detach invoices and destroy lessons — the second lock costs nothing
   -- and is the difference between a bug here being a no-op and being a loss.
   AND NOT EXISTS (SELECT 1 FROM public.invoices i        WHERE i.supplier_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.supplier_aliases a WHERE a.supplier_id = s.id);

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Must return 0: no supplier row is left holding a number that is not an account number while
-- nothing points at it. Rows whose invalid number DOES carry invoices are out of scope by design
-- and are not counted here.
WITH schoon AS (
  SELECT s.id, upper(regexp_replace(s.iban, '[^A-Za-z0-9]', '', 'g')) AS c
    FROM public.suppliers s WHERE s.iban IS NOT NULL
), letters_als_cijfers AS (
  SELECT h.id, h.c,
         string_agg(CASE WHEN t.ch ~ '^[0-9]$' THEN t.ch ELSE (ascii(t.ch) - 55)::text END,
                    '' ORDER BY t.ord) AS n
    FROM (SELECT id, c, substr(c, 5) || substr(c, 1, 4) AS r FROM schoon) h,
         LATERAL regexp_split_to_table(h.r, '') WITH ORDINALITY AS t(ch, ord)
   GROUP BY h.id, h.c
)
SELECT count(*) AS nog_te_doen
  FROM letters_als_cijfers v
 WHERE NOT (length(v.c) = 18 AND v.n ~ '^[0-9]+$' AND mod(v.n::numeric, 97) = 1)
   AND NOT EXISTS (SELECT 1 FROM public.invoices i        WHERE i.supplier_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM public.supplier_aliases a WHERE a.supplier_id = v.id);
