-- docs/BANK_ZEGT_BETAALD_LIJST_ZEGT_OPEN.sql
-- [BANK-SPLIT] Read-only sweep for the state a person found by eye: the Bank page shows a line
-- as "afgehandeld / automatisch gekoppeld" while the invoice it points at sits on the incoming
-- list as open and overdue (the FAMZFOOD BV case, tx date 2026-06-08).
--
-- Every booking path writes the pair (tx 'matched' + invoice 'paid') atomically-with-rollback
-- TODAY, and every reversal detaches the link before or with the un-pay — so current code cannot
-- create this split. It can only PERSIST from before those orderings existed, from a crash
-- between two writes, or from a hand edit. The app-side detector for it now lives in
-- src/lib/money-invariants.ts (kind 'matched_tx_unpaid_invoice', shown on the beveiliging
-- screen's GeldPaneel) — but that audit reads the LIVE books only; this sweep also sees archived
-- rows and names the history.
--
-- HOW TO RUN: paste each numbered block into the Supabase SQL editor and send me the results.
-- Every statement is a SELECT — nothing here changes a single row. Repair is a decision, not a
-- script: per found row either the payment is real (invoice must be marked paid) or the match is
-- wrong (the line's "Ontkoppelen" button on the Bank page detaches it cleanly, including for
-- exactly this half-state — verified against /api/bank/unlink).
--
-- Column labels are Dutch: the result grid is read by the owner, and pasted back as-is.

-- ── 1. De splitsing zelf: bankregel zegt afgehandeld, factuur zegt open ─────────────────────────
-- Every 'matched' line whose invoice is neither 'paid' nor covered by amount_paid.
-- Archived invoices are INCLUDED here (worse, not better: the cost left the books entirely).
select
  t.date                                as bankdatum,
  t.amount                              as bedrag_bank,
  t.counterpart_name                    as tegenpartij,
  t.reference                           as omschrijving_ref,
  t.auto_match_reason                   as automatisch_gekoppeld_op,
  i.invoice_number                      as factuurnummer,
  i.client_name                         as leverancier,
  i.status                              as factuur_status,
  i.invoice_type                        as soort,
  i.total_inc_btw                       as factuurbedrag,
  coalesce(i.amount_paid, 0)            as als_betaald_geboekt,
  i.payment_date                        as betaaldatum_op_factuur,
  i.due_date                            as vervaldatum,
  i.accountant_status                   as boekhouder,
  t.id                                  as tx_id,
  i.id                                  as factuur_id
from public.bank_transactions t
join public.invoices i on i.id = t.invoice_id
where t.status = 'matched'
  and i.status <> 'paid'
  and coalesce(i.amount_paid, 0) + 0.005 < abs(coalesce(i.total_inc_btw, 0))
order by t.date desc;

-- ── 1b. Afgehandelde regels die naar NIETS meer wijzen ──────────────────────────────────────────
-- invoice_id has ON DELETE SET NULL: deleting an invoice row leaves its line 'matched' onto
-- nothing. The money then counts nowhere while the Bank page shows it handled.
select t.date as bankdatum, t.amount as bedrag_bank, t.counterpart_name as tegenpartij,
       t.reference as omschrijving_ref, t.category as categorie, t.id as tx_id
from public.bank_transactions t
where t.status = 'matched' and t.invoice_id is null
order by t.date desc;

-- ── 2. Het betaalbewijs naast elke gevonden splitsing ───────────────────────────────────────────
-- For every split from block 1: do join rows (bank_tx_invoices) still exist, and for how much?
-- Surviving rows → the booking half-survived (amount_paid was reset without detaching);
-- no rows → the reversal half-ran (links cleared, tx left standing).
select
  t.id                                  as tx_id,
  i.invoice_number                      as factuurnummer,
  count(l.id)                           as koppelrijen,
  coalesce(sum(abs(l.amount_applied)), 0) as som_toegepast
from public.bank_transactions t
join public.invoices i on i.id = t.invoice_id
left join public.bank_tx_invoices l
       on l.transaction_id = t.id and l.invoice_id = i.id
where t.status = 'matched'
  and i.status <> 'paid'
  and coalesce(i.amount_paid, 0) + 0.005 < abs(coalesce(i.total_inc_btw, 0))
group by t.id, i.invoice_number
order by max(t.date) desc;

-- ── 3. FAMZFOOD zelf: alle facturen en alle bankregels ──────────────────────────────────────────
-- Both sides by name, so we can see whether the matched invoice and the queued invoice are ONE
-- row (a reset) or TWO rows (a twin: second copy or same-amount sibling).
select 'factuur' as kant, i.id::text, i.invoice_number as nummer, i.client_name as naam,
       i.status, i.invoice_type as soort, i.total_inc_btw as bedrag,
       coalesce(i.amount_paid,0) as betaald, i.invoice_date as factuurdatum,
       i.due_date as vervaldatum, i.payment_date as betaaldatum,
       i.created_at::date as aangemaakt, i.source as bron
from public.invoices i
where i.client_name ilike '%famz%'
union all
select 'bankregel', t.id::text, coalesce(t.auto_match_reason,'') , t.counterpart_name,
       t.status, t.category, t.amount, null, t.date, null, null, t.created_at::date,
       left(coalesce(t.reference,''), 60)
from public.bank_transactions t
where t.counterpart_name ilike '%famz%' or t.reference ilike '%famz%' or t.description ilike '%famz%'
order by aangemaakt, kant;

-- ── 4. Tweelingen in de hele administratie ──────────────────────────────────────────────────────
-- Same supplier + same amount, one paid and one still open/queued — the shape a second copy or a
-- recurring same-amount invoice leaves behind. Non-archived incoming rows only.
select i.receiver_id as eigenaar, lower(trim(i.client_name)) as leverancier,
       i.total_inc_btw as bedrag,
       count(*)                                          as aantal,
       count(*) filter (where i.status = 'paid')          as waarvan_betaald,
       count(*) filter (where i.status in ('processing','received')) as waarvan_open,
       array_agg(i.invoice_number order by i.created_at)  as nummers,
       array_agg(i.status         order by i.created_at)  as statussen,
       array_agg(i.invoice_date::text order by i.created_at) as factuurdata
from public.invoices i
where i.direction = 'incoming' and i.status <> 'archived'
group by i.receiver_id, lower(trim(i.client_name)), i.total_inc_btw
having count(*) filter (where i.status = 'paid') > 0
   and count(*) filter (where i.status in ('processing','received')) > 0
order by aantal desc;

-- ── 5. Wie heeft het gedaan: het spoor van elke splitsing ───────────────────────────────────────
-- The audit trail for every invoice found in block 1 (and every FAMZFOOD invoice), oldest first.
-- The action names the door: bank.auto_confirmed / bank.unlinked / invoice.reimported /
-- invoice.status_changed / invoice.restored — whichever wrote last before the split names the
-- generator, or its absence says the write bypassed the app.
select a.created_at as moment, a.action as handeling, a.entity_type as op,
       a.old_value as oud, a.new_value as nieuw
from public.audit_logs a
where a.entity_id in (
        select i.id
        from public.bank_transactions t
        join public.invoices i on i.id = t.invoice_id
        where t.status = 'matched'
          and i.status <> 'paid'
          and coalesce(i.amount_paid, 0) + 0.005 < abs(coalesce(i.total_inc_btw, 0))
      )
   or a.entity_id in (select id from public.invoices where client_name ilike '%famz%')
order by a.created_at asc;
