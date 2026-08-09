-- scripts/check-migrations.sql
-- [MIGRATIE-CHECK] What is actually live in THIS database?
--
-- Paste the whole file into the Supabase SQL editor and run it. It writes nothing, changes
-- nothing and reads no customer data — it only looks at the schema and at the source of the
-- stored functions.
--
-- WHY EXISTENCE IS NOT THE QUESTION.
--
-- Four of the money functions below have been in this database for months in a version that is
-- WRONG. `book_bank_batch` existed and raised on every call it ever made; `apply_bank_payment`
-- existed and consumed a whole bank line when handed part of one. So "does the function exist"
-- answers nothing. Each row therefore looks for a fingerprint of the CORRECTED body inside
-- pg_get_functiondef — a phrase that only the fixed version contains.
--
-- Read the result as: OK = the fixed version is live · TE DOEN = run that migration file.

with checks(soort, naam, migratie, waarom, aanwezig) as (

  -- ── Columns ────────────────────────────────────────────────────────────────────────────────
  select 'kolom', 'profiles.vat_statement_note', 'vat_statement_note.sql',
         'de eigen toelichting bij een factuur zonder btw',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='vat_statement_note')

  union all select 'kolom', 'invoices.delivery_date', 'FACTUUR-A (leverdatum)',
         'wettelijk verplicht op elke factuur (art. 35a lid 1 sub f)',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='invoices' and column_name='delivery_date')

  union all select 'kolom', 'invoice_lines.vat_treatment', 'vrijgesteld',
         'de vlag waaraan vrijgestelde omzet te herkennen is',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='invoice_lines' and column_name='vat_treatment')

  union all select 'kolom', 'invoice_lines.unit', 'invoice_line_unit.sql',
         'de eenheid in de e-factuur; zonder deze kolom wordt alles C62',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='invoice_lines' and column_name='unit')

  union all select 'kolom', 'invoices.discount_type', 'invoice_discount.sql',
         'korting op de factuur',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='invoices' and column_name='discount_type')

  union all select 'kolom', 'bank_tx_invoices.amount_applied', 'bank_tx_invoices_amount.sql',
         'hoeveel van een banklijn naar welke factuur ging',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='bank_tx_invoices' and column_name='amount_applied')

  -- ── Functions, checked on their CONTENT ────────────────────────────────────────────────────
  union all select 'functie', 'book_bank_batch', 'book_bank_batch_atomic.sql + bank_confirm_atomic.sql',
         'RAISED OP ELKE AANROEP: geen enkele meervoudige batch werd ooit geboekt',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='book_bank_batch'
                   and pg_get_functiondef(p.oid) like '%variable_conflict use_column%'
                   and pg_get_functiondef(p.oid) like '%DISTINCT id) INTO p_invoice_ids%'
                   and pg_get_functiondef(p.oid) like '%+ EXCLUDED.amount_applied%')

  union all select 'functie', 'apply_bank_payment', 'invoice_partial_payments.sql',
         'consumeerde een HELE banklijn als hij een deel kreeg',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='apply_bank_payment'
                   and pg_get_functiondef(p.oid) like '%this function consumes the whole line%')

  union all select 'functie', 'allocate_bank_payment', 'allocate_bank_payment.sql',
         'de richting van het geld, en wat de lijn al had weggegeven',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='allocate_bank_payment'
                   and pg_get_functiondef(p.oid) like '%v_elsewhere%')

  union all select 'functie', 'confirm_bank_payment', 'bank_confirm_atomic.sql',
         'was tekenblind: kapte een factuur van EUR 1.000 af op EUR 700',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='confirm_bank_payment'
                   and pg_get_functiondef(p.oid) like '%GREATEST%')

  union all select 'functie', 'seed_invoice_counter', 'seed_invoice_counter.sql',
         'de nummerreeks mocht niet achteruit kunnen (art. 35 Wet OB)',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='seed_invoice_counter'
                   and pg_get_functiondef(p.oid) like '%GREATEST%')

  union all select 'functie', 'recompute_invoice_amount_paid', 'invoice_partial_payments.sql',
         'houdt amount_paid gelijk aan de som van de deelbetalingen',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='recompute_invoice_amount_paid')
)
select
  case when aanwezig then 'OK' else 'TE DOEN' end as status,
  soort, naam, migratie, waarom
from checks
order by aanwezig, soort, naam;
