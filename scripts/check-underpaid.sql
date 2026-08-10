-- scripts/check-underpaid.sql
-- [ONDERBETAALD] Which invoices did the sign-blind confirm_bank_payment leave short?
--
-- Applying the migrations repairs the FUNCTIONS. It does not repair rows those functions already
-- wrote. confirm_bank_payment was sign-blind for months: handed a bank line that fully covered an
-- invoice, it could book less than the whole — the measured case capped a EUR 1.000 invoice at
-- EUR 700. Nothing contradicts itself afterwards: amount_paid still equals the sum of what was
-- applied, so every internal check passes. The invoice simply sits there looking part-paid.
--
-- This finds them. Read-only: one SELECT, no writes, no schema changes.
--
-- WHAT IT LOOKS FOR
-- An invoice with a bank line linked to it whose own amount was big enough to settle it, where
-- amount_paid nevertheless stayed below the invoice total. Compared on MAGNITUDES, because a
-- creditnota and a purchase invoice are stored negative and the question is about size, not
-- direction. A two-cent tolerance, the same one the money functions use.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- It does not fix anything, and it must not: some of these are legitimate part-payments an owner
-- made on purpose, and a blanket repair would overwrite those with a number nobody chose. Check a
-- few against the bank statement first. The reliable repair is per invoice, from the app: unlink
-- the bank line and match it again, which now runs through the corrected function.

select
  i.invoice_number,
  i.invoice_date,
  i.client_name,
  round(abs(i.total_inc_btw), 2)                                as factuurbedrag,
  round(coalesce(i.amount_paid, 0), 2)                          as geboekt_als_betaald,
  round(abs(i.total_inc_btw) - coalesce(i.amount_paid, 0), 2)   as verschil,
  round(abs(t.amount), 2)                                       as bedrag_op_de_banklijn,
  t.date                                                        as datum_banklijn,
  i.status
from public.invoices i
join public.bank_tx_invoices l on l.invoice_id = i.id
join public.bank_transactions t on t.id = l.transaction_id
where i.total_inc_btw is not null
  and abs(i.total_inc_btw) > 0.02
  -- the line on its own could have settled the whole invoice …
  and abs(t.amount) >= abs(i.total_inc_btw) - 0.02
  -- … and yet the invoice was left short
  and coalesce(i.amount_paid, 0) < abs(i.total_inc_btw) - 0.02
order by verschil desc, i.invoice_date desc;
