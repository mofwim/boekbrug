# BoekBrug — Work Queue (saved snapshot)

> Saved on request ("احفظ طابور العمل لنعود اليه لاحقاً"). Return trigger: the user says
> "عد الى الطابور" / "back to the queue". This is the durable copy of the in-session task list.

## ⚠️ ACTION REQUIRED FROM THE OWNER — apply these migrations
These are written but NOT yet applied to the database. Features run safely without them,
but the new writes error until the tables/columns exist.
1. `supabase/migrations/circle_integrity_and_indexes.sql` (content_hash / shared / needs_reauth / FK indexes)
2. `supabase/migrations/ledger_daily.sql` (PIN/cash grootboek cross-check table — needed before a ledger upload can save)

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

## 🔭 Larger automation items previously discussed (not yet queued as tasks)
- Proactive notifications / unified "Wat nu?" exceptions inbox / accountant handoff automation / bank PSD2 live feed.

## 🧭 R&D reports under review (separate from the build queue)
Four R&D team reports received; owner wants my code-checked verdict per team before they build.
See the session for the per-team verdicts (Team 1 files-as-truth, Team 2 search, Team 3 product-facts, Team 4 go-to-market).
