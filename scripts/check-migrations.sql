-- scripts/check-migrations.sql
-- [MIGRATIE-CHECK] What is actually live in THIS database?
--
-- Paste the whole file in the Supabase SQL editor and run it. It writes nothing, changes
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
--
-- VERIFIED AGAINST A REAL POSTGRESQL 16 IN ALL THREE STATES, because a checker nobody has run is
-- a claim and not a check — and the two ways it could fail are opposite and both quiet:
--
--   empty database          every row says TE DOEN
--   migrations applied      every function row flips to OK, so no fingerprint is a typo that
--                           would send someone chasing a migration they already ran
--   PRE-FIX book_bank_batch installed from the commit before the fix: TE DOEN, exactly where a
--                           "does the function exist" check would have said OK
--
-- [SUPPLETIE] The four btw_filings rows were verified the same way, in both directions: on a
-- database built from btw_filings.sql alone all four say TE DOEN; after btw_filings_divergence.sql
-- and btw_filings_carried.sql all four flip to OK; and running both a second time changes nothing
-- (every statement is IF NOT EXISTS, and the CHECK is guarded by a pg_constraint lookup). The
-- constraint gets its own row because a column can exist while the rule around it never was
-- created — and that rule is what keeps "verwerkt in 2026-Q7" off an accountant's screen.
--
-- That last one is the whole reason this file exists rather than a list in a chat message.

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
                   -- The de-dup fingerprint stops at array_agg(DISTINCT id) on purpose, and the
                   -- reason is worth a note because it will bite anyone who lengthens it.
                   --
                   -- That line in the migration continues with the keyword that assigns a query
                   -- result to a variable, followed by the parameter name. In plpgsql that is an
                   -- assignment; at the top level of a script the same keyword CREATES A TABLE.
                   -- The Supabase SQL editor's linter reads tokens without honouring quoting, so
                   -- with the longer phrase in this string literal it concluded that this file
                   -- creates an unprotected table and asked whether to run it without RLS.
                   --
                   -- Nothing was ever created — the whole file is a single SELECT — but a schema
                   -- CHECKER that makes a money database raise a security prompt teaches exactly
                   -- the wrong reflex, and "just click through it" is not a habit to build here.
                   -- The shorter fingerprint is equally unique to the corrected body. Keep any
                   -- future fingerprint free of that keyword for the same reason.
                   and pg_get_functiondef(p.oid) like '%array_agg(DISTINCT id)%'
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

  -- [SUPPLETIE] The two columns that hold the moment a filed quarter first moved. Without them the
  -- correction routes still work and still tell the owner — the stamp is deploy-safe — but the
  -- moment of awareness is not recorded, and art. 10a AWR runs its clock from exactly that moment.
  -- It cannot be reconstructed afterwards, which is why this row exists rather than a shrug.
  union all select 'kolom', 'btw_filings.first_divergence_at', 'btw_filings_divergence.sql',
         'het moment waarop een ingediend kwartaal voor het EERST veranderde (art. 10a AWR)',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='btw_filings' and column_name='first_divergence_at')

  union all select 'kolom', 'btw_filings.last_divergence_at', 'btw_filings_divergence.sql',
         'wanneer het voor het LAATST veranderde — of een kwartaal nog in beweging is',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='btw_filings' and column_name='last_divergence_at')

  -- Without this one the "Verwerkt"-knop op de aangifte antwoordt 503 en legt niets vast. Dat is
  -- eerlijk, maar het betekent ook dat dezelfde correctie volgend kwartaal opnieuw wordt
  -- aangeboden — en twee keer aangeven is duurder dan één keer vergeten.
  union all select 'kolom', 'btw_filings.carried_saldo', 'btw_filings_carried.sql',
         'hoeveel van een correctie al in een latere aangifte is verwerkt (zonder dit: dubbel aangeven)',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='btw_filings' and column_name='carried_saldo')

  -- De begrenzing zelf, niet alleen de kolom: zonder de CHECK kan er "verwerkt in 2026-Q7" op het
  -- scherm van een boekhouder komen. Op naam gecontroleerd, want een kolom kan bestaan terwijl de
  -- constraint eromheen nooit is aangemaakt.
  union all select 'constraint', 'btw_filings_carried_quarter_check', 'btw_filings_carried.sql',
         'een verwerkt-kwartaal moet een BESTAAND kwartaal zijn (1 t/m 4)',
         exists (select 1 from pg_constraint where conname='btw_filings_carried_quarter_check')

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
