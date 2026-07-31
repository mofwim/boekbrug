# BoekBrug — Work Queue (saved snapshot)

> Saved on request ("احفظ طابور العمل لنعود اليه لاحقاً"). Return trigger: the user says
> "عد الى الطابور" / "back to the queue". This is the durable copy of the in-session task list.

## ⚠️ ~~ACTION REQUIRED FROM THE OWNER — apply these migrations~~ — ACHTERHAALD (26 juli)

> **Lees dit niet als een openstaande taak.** Dit bestand is een SNAPSHOT van een takenlijst uit
> een sessie op 26 juli, geen meting. Op **29 juli** is de echte database uitgelezen met
> `docs/WELKE_MIGRATIES_STAAN_ER.sql`, en dat resultaat staat in `docs/JOUW_LIJST.md` §1
> ("de migraties zijn af" — *"niet gemeld, maar gemeten"*). Die meting is jonger dan deze lijst en
> wint dus. Er stond volgens die meting nog één migratie open, en het is een pure snelheidsindex
> (`search_engine_clients_kvk_city.sql`): geen schema-, data- of gedragswijziging.
>
> De twee hieronder blijven staan als geschiedenis, doorgestreept, omdat weggummen de volgende
> lezer laat denken dat er nooit iets openstond. **Wat je wél doet als je twijfelt:** draai
> `docs/WELKE_MIGRATIES_STAAN_ER.sql` opnieuw — het is één query en het antwoord is de waarheid,
> niet dit bestand.
>
> Eén reden om dat te doen ook als je denkt dat het goed zit: `ledger_daily` wordt SOFT gelezen
> (`compute-result-range.ts`, `[LEDGER-READ]`). Ontbreekt die tabel, dan schreeuwt er niets — het
> rapport zet alleen `pinLedgerAvailable: false` en de PIN-kruiscontrole is stilletjes zwakker in
> elk kwartaal. Precies het soort ontbreken dat je alleen vindt door te kijken.

1. ~~`supabase/migrations/circle_integrity_and_indexes.sql`~~ (content_hash / shared / needs_reauth / FK indexes)
2. ~~`supabase/migrations/ledger_daily.sql`~~ (PIN/cash grootboek cross-check table — needed before a ledger upload can save)

## ✅ Done + verified + pushed this session (branch `claude/boekbrug-file-architecture-4b8s6o`)
- **HIGH money fix — covered-day card-payout double-count** (3 adversarial review rounds → SHIP). Budget-bounded suppression (pin_amount), shared `toResultBankTx` mapper across the 4 money surfaces, SETTLE_LAG=5, cardBudgetBound. 76 tests.
- **Kasboek as LIVE DATA** end-to-end: pure projection engine (`kasboek.ts`, 13 tests) · `/api/kasboek` (JSON + Kiwi .xlsx) · Kas screen quarterly running-balance panel + accountant download · closing-package now ships the running-balance Kasboek.xlsx (the old flat CSV was never even included).
- **PIN/cash ledger → triangle (#75)**: `ledger_daily` table + `/api/ledger/import` + wired into `/api/result` & closing-package as `pinLedgerByDay` (Leg-A witness only, books no money). Adversarial review found 2 MED (commission-withhold, orphan-day drop) → both fixed + regression-tested.
- Daily cron schedule (Vercel Hobby) · Storting/Opname labels.

## ⏳ Pending queue (resume here)
- **#76 — Kasboek opening-balance config + persist raw Z-report**
  - #2: owner-set starting cash balance (Beginsaldo) → `profiles.kas_opening_balance` (migration) → fed to `openingBalanceForQuarter` (currently defaults 0). Needs a small settings UI.
  - #6: persist the raw uploaded Z-report file + link `daily_turnover.document_id` (column already exists) for evidence in the accountant package.
- **#56 — M7 (SUSPECTED)**: verify the direction/sign guard doesn't reject credit-note refunds in bank matching.
- **#63 — Strengthen duplicate handling**: warn "mogelijk dubbel met X" even when uncertain.
- **#77 — PERFORMANCE: make the app faster without changing a single behaviour.**
  Queued on request ("احفظ هذه المهمة بالطابور لاحقاً"). Findings are from STATIC ANALYSIS of the
  code — no profiling was run and the DB was not reachable from the session, so confirm against
  prod first: `select indexname, indexdef from pg_indexes where tablename in
  ('invoices','bank_transactions','notifications') order by tablename;`
  Ordered by impact / risk. The first two are pure SQL and touch no application code.
  1. **No index on the ownership columns** (biggest, zero-risk). `invoices` has FK constraints on
     `sender_id` + `receiver_id` (`database.sql:350-353`) but no index on either — PostgreSQL, unlike
     MySQL, does not index a foreign key automatically. Every query in the app filters on exactly
     those columns, so every page load is a sequential scan of the whole table. Same gap on
     `bank_transactions.user_id`, `notifications.user_id`, `suppliers.user_id` (`cash_entries` is
     covered by `idx_cash_entries_user_date`). Wanted, matching the real query shapes:
     `invoices(receiver_id, direction, status, created_at DESC)`,
     `invoices(sender_id, direction, status, created_at DESC)`,
     `bank_transactions(user_id, status)` — all `CREATE INDEX CONCURRENTLY` (no table lock).
  2. **Every RLS policy re-evaluates `auth.uid()` per row.** 60 policies in `database.sql` hold 81
     bare `auth.uid()` calls, plus ~90 more across `supabase/migrations/` — none wrapped in
     `(select auth.uid())`. Bare, it is treated as volatile and runs for every row scanned; wrapped
     in a scalar subquery Postgres evaluates it once (InitPlan) and reuses it. Identical security
     semantics, same rows, same permissions.
  3. **Middleware does two network round trips on every request.** `src/middleware.ts:77` calls
     `supabase.auth.getUser()` — a real HTTP call to the Auth server — on every request including
     every `/api/*` (the early return at :86 happens *after* the call), then a second query for
     `profiles.onboarding_done` on every `/dashboard/*` (:101). The page then repeats getUser +
     profile. Opening `/dashboard` = 4 sequential round trips before any data is fetched.
     `supabase-js` 2.105.4 ships `getClaims()`, which verifies the JWT locally against a cached
     JWKS — no round trip. Using it for the middleware's redirect decision removes one hop from
     every request in the app.
  4. **Client-side request waterfall.** `BankClient.tsx:303-326` awaits `/api/bank/match`, then
     `/api/bank/ignored`, then `/api/bank/categorize` in sequence although they are independent —
     and each re-does `getUser()` server-side. `Promise.all` turns three round trips into one.
     Worth sweeping the other screens for the same shape.
  5. **Server pages serialise what could run in parallel.** The `getUser()` → `select profile` →
     data-queries chain repeats in every `page.tsx`, though the data queries do not depend on the
     profile. `incoming/manage/page.tsx` alone runs four sequential queries.
  6. Smaller: `select('*')` in 33 places (13 of them on `profiles`) ships every column each load ·
     `BankClient` 125 KB / `IncomingManageClient` 107 KB / `FacturenClient` 84 KB as single source
     files, so every sheet and dialog is in the first paint's bundle (`dynamic()` would split them) ·
     Sentry `replayIntegration` is always loaded client-side even at a 5% sample rate.

## 🔭 Larger automation items previously discussed (not yet queued as tasks)
- Proactive notifications / unified "Wat nu?" exceptions inbox / accountant handoff automation / bank PSD2 live feed.

## 🧭 R&D reports under review (separate from the build queue)
Four R&D team reports received; owner wants my code-checked verdict per team before they build.
See the session for the per-team verdicts (Team 1 files-as-truth, Team 2 search, Team 3 product-facts, Team 4 go-to-market).
