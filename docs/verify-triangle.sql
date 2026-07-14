-- ═══════════════════════════════════════════════════════════════════════════════
-- Verificatie van de reconciliatie-driehoek (kassa ↔ terminal ↔ bank)
-- Run in de Supabase SQL editor. Vervang <UID> door je eigen user_id (query 0).
-- Voer EERST de migratie uit: supabase/migrations/eft_settlements.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- 0) Vind je user_id (KIWI FOOD MARKET).
select id, company_name, full_name
from public.profiles
where company_name ilike '%kiwi%' or full_name ilike '%kiwi%';

-- ── 1) Is de migratie toegepast? Tabel + RLS-policies bestaan. ──────────────────
select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'eft_settlements';

select policyname, cmd
from pg_policies
where tablename = 'eft_settlements'
order by policyname;   -- verwacht: select/insert/update/delete _own

-- ── 2) Zijn er terminal-afrekeningen opgeslagen? (na upload via /api/eft/import) ─
select settlement_date, terminal_id, period_nr, gross_total, tx_count, by_scheme
from public.eft_settlements
where user_id = '<UID>'
order by settlement_date, period_nr;

-- Interne controle: som van kaartsoorten == gross_total (per afrekening).
select settlement_date, period_nr, gross_total,
       (select round(sum((s->>'amount')::numeric), 2)
          from jsonb_array_elements(by_scheme) s) as som_kaartsoorten
from public.eft_settlements
where user_id = '<UID>'
order by settlement_date;

-- ── 3) LEG A — kassa-PIN (bruto) vs terminal-bruto per dag. Moeten GELIJK zijn. ──
--     Een verschil hier = een ECHT verschil (ontbrekende bon / terminalstoring),
--     géén commissie.
select coalesce(t.turnover_date, e.settlement_date) as dag,
       t.pin_amount                       as kassa_pin_bruto,
       e.eft_bruto                         as terminal_bruto,
       round(coalesce(e.eft_bruto,0) - coalesce(t.pin_amount,0), 2) as verschil_leg_a
from public.daily_turnover t
full join (
  select settlement_date, sum(gross_total) as eft_bruto
  from public.eft_settlements
  where user_id = '<UID>'
  group by settlement_date
) e on e.settlement_date = t.turnover_date
where t.user_id = '<UID>' or t.user_id is null
order by dag;

-- ── 4) LEG B — terminal-bruto vs bank-NETTO uitbetaling = acquirer-commissie. ────
--     De bank pos_income-regels dragen de takings-datum in "DAT. YYYYMMDD".
--     Ruwe bankkant (netto uitbetaling per boekdatum):
select date as boekdatum, description, amount as netto_uitbetaald
from public.bank_transactions
where user_id = '<UID>' and category = 'pos_income'
order by date;

--     De commissie zelf (bruto − netto, per dag, na de DAT-parsing) wordt live
--     berekend door /api/result en NIET opgeslagen — zie query 6 om die te lezen.

-- ── 5) Dagomzet (kassa Z-rapporten) aanwezig voor het kwartaal? ─────────────────
select turnover_date, total_incl, pin_amount, cash_amount,
       (base_0 + base_9 + base_21) as netto_omzet, (btw_9 + btw_21) as btw
from public.daily_turnover
where user_id = '<UID>'
order by turnover_date;

-- ── 6) RLS-controle: een afrekening hoort ALTIJD bij zijn eigenaar. ─────────────
--     Als je dit als de ingelogde gebruiker via de app draait, moet dit 0 zijn
--     (RLS staat geen rijen van een andere user toe).
select count(*) as vreemde_rijen
from public.eft_settlements
where user_id <> '<UID>';

-- ═══════════════════════════════════════════════════════════════════════════════
-- De COMMISSIE + geboekte bedragen lees je uit /api/result (niet uit de DB):
--   GET /api/result?year=2026&quarter=3   →  veld "reconciliation":
--     { totalCommission, commissionBooked, acquirerFeeInvoices,
--       grossMismatchDays, incompleteDays, eftSettlements }
--   - totalCommission   = bruto − netto over alle sluitende dagen
--   - commissionBooked  = wat als kosten is geboekt (na aftrek acquirer-facturen)
--   - grossMismatchDays = dagen waar kassa-PIN ≠ terminal (controleer die dagen!)
-- En het winstcijfer ("result.resultaat") is nu NA aftrek van die commissie.
-- ═══════════════════════════════════════════════════════════════════════════════
