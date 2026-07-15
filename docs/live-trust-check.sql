-- ============================================================================
-- BoekBrug — LIVE TRUST CHECK  (read-only; runs no writes, no deletes)
-- ----------------------------------------------------------------------------
-- Purpose: bridge from "code-confident" to "live-confident". Every query below
-- answers one trust question against the OWNER'S REAL DATA. Run the whole file in
-- the Supabase SQL editor and read each result against the "VERWACHT" note.
--
-- HOW TO USE: change the one uuid on the next line to the account you want to check
-- (Kiwi = ac22189e-7052-4c48-b4ec-90947cf92ecc), then Run — in the Supabase SQL
-- editor. Everything is a SELECT; nothing is modified.
--
-- IMPORTANT: run Section A FIRST. If a table shows FALSE there, its migration is not
-- applied yet — the queries that use it will error until it is:
--   • B3 needs invoice_counters   • B4/B5/C2 need bank_transactions (core, exists)
--   • C3 needs daily_turnover.
-- Apply the missing migration, then run those queries.
-- ============================================================================
-- The account under test — used by every query. (Change ONLY this line.)
DROP VIEW IF EXISTS me;
CREATE TEMP VIEW me AS SELECT 'ac22189e-7052-4c48-b4ec-90947cf92ecc'::uuid AS uid;

-- ============================================================================
-- A) SCHEMA / MIGRATION PRESENCE — is what we built actually deployed live?
--    A missing row here means a migration was never applied → that feature is
--    dead on live even though the code exists. (This was the case earlier.)
-- ============================================================================
SELECT 'A. migraties toegepast?' AS check,
       to_regclass('public.daily_turnover')  IS NOT NULL AS daily_turnover,
       to_regclass('public.eft_settlements') IS NOT NULL AS eft_settlements,
       to_regclass('public.articles')        IS NOT NULL AS articles,
       to_regclass('public.cash_entries')    IS NOT NULL AS cash_entries,
       to_regclass('public.invoice_counters')IS NOT NULL AS invoice_counters,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='client_id')  AS invoices_client_id,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='pay_token')  AS invoices_pay_token,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='clients'  AND column_name='notes')      AS clients_notes,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='bank_transactions' AND column_name='category') AS bank_category;
-- VERWACHT: alle kolommen TRUE. Elke FALSE = een niet-toegepaste migratie.

-- ============================================================================
-- B) THE TRUST INVARIANTS — each of these SHOULD return 0 rows / 0 counts.
-- ============================================================================

-- B1. LIMBO: an invoice marked 'sent' (legally issued) with NO number.
--     A truthful "verstuurd" must always carry a legal number.
SELECT 'B1. verstuurd zonder nummer (limbo)' AS check, count(*) AS aantal
FROM invoices, me
WHERE sender_id = me.uid AND status = 'sent'
  AND (invoice_number IS NULL OR btrim(invoice_number) = '');
-- VERWACHT: 0.

-- B2. DUPLICATE legal numbers for one issuer (Art. 35 — must be unique).
SELECT 'B2. dubbele factuurnummers' AS check, invoice_number, count(*) AS keer
FROM invoices, me
WHERE sender_id = me.uid AND invoice_number IS NOT NULL
GROUP BY invoice_number HAVING count(*) > 1;
-- VERWACHT: geen rijen.

-- B3. NUMBER GAPS: the counter has advanced further than the invoices actually
--     issued → a minted-but-lost number (the double-send gap we hardened).
--     Compares invoice_counters.current_value to the count of numbered invoices.
SELECT 'B3. nummer-gaten (teller vs uitgegeven)' AS check,
       c.type, c.year, c.last_seq AS teller,
       (SELECT count(*) FROM invoices i, me
          WHERE i.sender_id = me.uid AND i.invoice_number IS NOT NULL
            AND i.invoice_type = c.type
            AND (c.year = 0 OR extract(year FROM i.invoice_date)::int = c.year)) AS uitgegeven
FROM invoice_counters c, me
WHERE c.user_id = me.uid;
-- VERWACHT: teller ≈ uitgegeven. teller >> uitgegeven = verbrande nummers (gaten).

-- B4. UNMATCHED INCOME: money IN with no invoice and no category — revenue the
--     accountant cannot tie to a sale. Now blocks readiness; here we count it live.
SELECT 'B4. ontvangen betalingen zonder factuur' AS check, count(*) AS aantal,
       coalesce(sum(amount),0) AS totaal_euro
FROM bank_transactions, me
WHERE user_id = me.uid AND status = 'pending'
  AND invoice_id IS NULL AND category IS NULL AND amount > 0;
-- VERWACHT: laag / verklaarbaar. Elk = omzet zonder onderliggende factuur.

-- B5. UNCATEGORISED BANK LINES overall (the "789 AFREK" problem): how many
--     bank rows are still category NULL (unresolved), split in/uit.
SELECT 'B5. bankregels zonder categorie' AS check,
       count(*) FILTER (WHERE amount > 0) AS ontvangen_zonder_cat,
       count(*) FILTER (WHERE amount < 0) AS betaald_zonder_cat
FROM bank_transactions, me
WHERE user_id = me.uid AND category IS NULL;
-- VERWACHT: zo laag mogelijk. Hoog = de reconciliatie is nog niet compleet.

-- B6. AMOUNT-TRUST: incoming invoices whose extracted total is MISSING or €0,
--     or whose amount was read with LOW confidence — the money-truth to check.
SELECT 'B6. facturen met ontbrekend/onzeker bedrag' AS check,
       count(*) FILTER (WHERE total_inc_btw IS NULL OR abs(total_inc_btw) < 0.005) AS bedrag_leeg_of_0,
       count(*) FILTER (WHERE (field_confidence->>'amount') IS NOT NULL
                          AND (field_confidence->>'amount')::float < 0.7)          AS bedrag_onzeker
FROM invoices, me
WHERE (receiver_id = me.uid OR sender_id = me.uid);
-- VERWACHT: deze horen in de "controleer"-wachtrij te staan, niet stil geboekt.

-- B7. ARITHMETIC: invoices where excl + BTW ≠ incl (beyond 2 cent) — a booked
--     row whose numbers don't add up.
SELECT 'B7. bedragen kloppen niet (excl+btw≠incl)' AS check, count(*) AS aantal
FROM invoices, me
WHERE (receiver_id = me.uid OR sender_id = me.uid)
  AND total_ex_btw IS NOT NULL AND btw_amount IS NOT NULL AND total_inc_btw IS NOT NULL
  AND abs(coalesce(total_ex_btw,0) + coalesce(btw_amount,0) - coalesce(total_inc_btw,0)) > 0.02;
-- VERWACHT: 0 (of alleen bekende, gemarkeerde uitzonderingen).

-- B8. EVIDENCE: issued/received invoices with NO source PDF/document — the
--     accountant can't verify these.
SELECT 'B8. facturen zonder brondocument' AS check, count(*) AS aantal
FROM invoices, me
WHERE (receiver_id = me.uid OR sender_id = me.uid)
  AND status IN ('sent','received','paid','processed','overdue')
  AND (pdf_url IS NULL OR btrim(pdf_url) = '')
  AND document_id IS NULL;
-- VERWACHT: laag. Hoog = de closing-package mist bewijs.

-- ============================================================================
-- C) LIVE SPOT-CHECK you verify BY HAND against reality
--    Pick your most recent full quarter and eyeball these three numbers against
--    what you KNOW the shop did. This is the "match every euro by hand" step.
-- ============================================================================
-- C1. Outgoing revenue (issued invoices) this year, per quarter.
SELECT 'C1. uitgaande omzet per kwartaal' AS check,
       extract(quarter FROM invoice_date)::int AS kwartaal,
       count(*) AS facturen, sum(total_inc_btw) AS incl_btw
FROM invoices, me
WHERE sender_id = me.uid AND direction = 'outgoing'
  AND invoice_type IN ('factuur','creditnota')
  AND invoice_date >= date_trunc('year', now())
GROUP BY 1,2 ORDER BY 2;

-- C2. Bank money in vs out this year (does the direction/total feel right?).
SELECT 'C2. bank in/uit dit jaar' AS check,
       sum(amount) FILTER (WHERE amount > 0) AS ontvangen,
       sum(amount) FILTER (WHERE amount < 0) AS betaald
FROM bank_transactions, me
WHERE user_id = me.uid AND date >= date_trunc('year', now());

-- C3. Till turnover days imported (if retail) — completeness of the daily record.
SELECT 'C3. dagen dagomzet geïmporteerd' AS check, count(*) AS dagen,
       min(turnover_date) AS van, max(turnover_date) AS tot
FROM daily_turnover, me
WHERE user_id = me.uid AND turnover_date >= date_trunc('year', now());
-- VERWACHT: ~1 rij per handelsdag. Grote gaten = ontbrekende Z-rapporten.
