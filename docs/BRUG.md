# BRUG — where the app is, where the talk is, and what to build next

Measured on 8 September 2026 against the owner's positioning, with four independent read-only
reviews of the code (client side, accountant side, the question loop, signalling/periods/audit).
Every verdict below names the file that proves it. "Talk" means a sentence in a pitch or a doc
that the code does not yet carry.

## The positioning, in one paragraph

BoekBrug is not another accounting engine. It is the collaboration and preparation layer between
the ondernemer and the accountant: it collects (Verzamelen), links (Koppelen), signals what is
missing or doubtful (Signaleren), lets the two work on the same file (Samenwerken), lets the
accountant check and correct (Controleren), and hands over a clean period dossier (Overdragen).
The final bookkeeping stays in the accountant's own system. The one test that matters is the loop:

> client sends everything → BoekBrug organises it → the bank is matched → the unclear things
> surface → the accountant reviews → asks the client → the client answers → the period becomes
> complete → the accountant receives a finished dossier.

## The loop, step by step

| Step | Verdict | Evidence | What is missing |
|---|---|---|---|
| Client sends everything (upload, camera, e-mail) | **works** | `src/app/api/intake/route.ts`, `src/lib/email-integration.ts` | — |
| BoekBrug organises it (read, verify queue, duplicates, reminders, statements, tax letters) | **works** | `src/lib/intake-router.ts`, `src/lib/safecore.ts`, `src/lib/reminder-original.ts`, `src/lib/tax-letter.ts` | — |
| The bank is matched, with undo and no silent redo | **works** | `src/lib/bank-matching.ts`, `src/app/api/bank/unlink/route.ts` (`auto_book_blocked_at`), `src/lib/bank-rejections.ts` | — |
| The unclear things surface to the OWNER | **works** | `src/lib/readiness.ts`, `/dashboard/klaar`, `/dashboard/vandaag`, `src/lib/bank-waiting-reason.ts` | Vandaag folds bank lines into "dingen wachten op jou"; no named "N transacties controleren". |
| The accountant reviews invoices and documents | **works** | `src/app/dashboard/clients/[id]/kwartaal/page.tsx`, `src/app/api/accountant/bevestig/route.ts`, `documents_accountant_read_policy.sql` | — |
| The accountant reviews the BANK | **missing** | `database.sql:624-634`: `bank_transactions` is owner-only; the accountant gets a count and a CSV in the ZIP | Reconciliation, the largest part of the job, is invisible in-app. |
| The accountant asks on an item | **half** | invoice: `src/app/api/accountant/invoice-question/route.ts`; document: `src/app/api/accountant/subject-status/route.ts` | Not on a bank line. Two mechanisms, no question row of its own. |
| The client answers | **half** | `/dashboard/vragen`, `src/lib/vragen.ts`, answer via `/api/messages` | Text only. No document can be attached to the question; the upload lands in the general inbox. |
| The answer returns to the item and the state moves | **missing** | `invoice-question/route.ts:22-25` says it: the answer does not change the status; nothing ever clears `vraag` | The counts "Open vraag" only grow. |
| The period becomes complete and is signed off | **missing** | no period table, no lock, no sign-off; nearest: `btw_filings.sql`, `verwerkt_freeze_level.sql` (per invoice) | No `open → controle nodig → klaar voor accountant → afgerond`. |
| The accountant receives the dossier | **works** | `src/lib/closing-package.ts` (PDFs, UBL, bank, afletering, concept aangifte, ICP, XAF 3.2/4.0, warnings), `package_shares.sql`, `package_deliveries.sql` | Only the owner can create a share link. |
| The correction proposal (the one true state machine) | **works** | `invoice_corrections.sql` (`open/accepted/declined/stale`), `src/app/api/invoice-corrections/[id]/route.ts` | Five amount fields only. |

Verdict: eight of eleven steps stand. The three that do not are the same thing seen three times:
**there is no state for the conversation and no state for the period.** The app is a strong
collector and a strong signaller with a one-way question on top.

## The map: the six functions

Legend: ✅ exists · 🟡 partial · ❌ missing. File = the proof.

**Verzamelen** — ✅ account/company (`src/app/register`, `settings`); ✅ incoming invoices on three
doors; ✅ outgoing invoices (draft/send/PDF/numbering lock/creditnota/reminders, statuses
`draft sent paid overdue received processing processed unclear archived`); ✅ receipts as paid
purchases (`bon-betaalwijze.ts`); ✅ bank import MT940/CAMT/CSV; ✅ e-mail sync; ✅ duplicate guard
(bytes + semantic); ✅ reminders and statements never booked.

**Koppelen** — ✅ invoice ↔ document (two columns, `documents.invoice_id` and
`invoices.document_id`, no constraint between them); ✅ bank ↔ invoice, single and multi, partial
payments (`bank_tx_invoices.amount_applied`); ✅ unlink with a redo guard; ✅ invoice from a bank
line without a file; ✅ attachments on a bank line; ✅ storno.

**Signaleren** — ✅ readiness per quarter with a score and a missing list, for both sides
(`readiness.ts`, `readiness_cache.sql`, `readiness-board.ts`); ✅ persistent holds
(`_safecore`, hold reasons); 🟡 the list lacks the two HUMAN signals: "accountant waits on your
answer" and "supplier IBAN changed, confirm"; 🟡 Vandaag has "N dingen wachten op jou" but no
readiness percentage and no bank-review count; ❌ one todo surface that unites klaar, vragen and
vandaag.

**Samenwerken** — 🟡 question on an invoice or document; ❌ question on a bank line; 🟡 client
answers by text only; ❌ answer does not return to the item; ❌ no `answered`/`resolved` state;
❌ no audit row for a document question, an answer, or a resolution; ✅ correction proposals;
✅ request-for-documents (`document-request.ts`, fire-and-forget); ✅ loose chat (`/api/messages`).

**Controleren** — ✅ mandate split, amount guard (art. 52 AWR), accountant may only move
`accountant_status` and `accountant_note`; ✅ confirm `processing → received`; ✅ office board
with per-client score and missing count; 🟡 client-period view is an invoice list, not the promised
tiles (transactions complete, documents missing, "BTW: klaar voor controle", "Pakket: X%");
❌ bank visible to the accountant; ❌ period sign-off.

**Overdragen** — ✅ closing package ZIP; ✅ XAF 3.2 and 4.0; ✅ UBL; ✅ share link without an
account, deliveries fingerprinted; ✅ SnelStart push; 🟡 Exact/AFAS/Twinfield/Moneybird are served
by file import only (that is enough for stage one); ❌ accountant cannot forward the dossier.

**Foundations** — ✅ audit log with 113 actions and a logboek the owner reads; ✅ search over
invoices, documents, clients, bank, kas (suppliers not yet); ✅ roles owner/verkoop/accountant with
RLS per client, demo isolation; 🟡 the period model is quarters only (a monthly filer has no
tijdvak).

## What is talk today

- "Open → Vraag gesteld → Antwoord ontvangen → Bevestigd": only the first arrow exists.
- "Open → Controle nodig → Klaar voor accountant → Afgerond": no period entity at all.
- "Jan de Vries BV · Q3 · 124 transacties compleet · 3 te controleren · 2 documenten ontbreken ·
  BTW klaar voor controle · Pakket 95%": the score and the missing count exist; the other tiles
  are not computed.
- "€89 KPN · Nog niet verklaard · Koppel factuur / Markeer als privé / Vraag klant": the first
  two exist for the OWNER; none of the three exists for the accountant.

## What should NOT be applied now

Everything that makes BoekBrug an accounting engine or a second product is built and works, and
none of it is the bridge. Keep it, do not extend it, do not advertise it as the product: Mollie
payment links and settlements, betaalverzoek bundles, auto-incasso, cash-flow forecast, asset
depreciation and bedrijfsmiddelen, vehicles, uren and the urencriterium, artikelen, kassa and
dagomzet ingest, kasboek, the kluis, the blog and the thirty tool pages, four languages.
Two of these serve the bridge indirectly and stay in scope: the XAF/UBL exports (they are the
handover) and the till/bank/drawer reconciliation (it is a signal). Do not start live API
integrations with Exact/AFAS/Twinfield/Moneybird; the file handover is what an office imports
today, and an integration before the loop closes is the wrong order.

## What to apply, in order

Each item is one batch: verify-claim-first, pure module, tests, lifecycle gate, gates on the merge.

1. **[VRAAG] The question is a row with a life.** Table `questions(item_type, item_id, asked_by,
   asked_at, text, answer_text, answered_at, resolved_at, status open|answered|resolved)`.
   Ask from an invoice, a document, a bank line. Answer lands on the row and on the ITEM; the
   client may attach a document to the answer and it links to the item. Resolve is the
   accountant's tap. Audit actions `question.asked / answered / resolved`. Notifications deep-link
   to the item on both sides. Replaces `accountant_status='vraag'` + `messages` prefix.
2. **[PERIODE] The period is a row with a status.** `periods(user_id, year, quarter, status
   open|controle_nodig|klaar_voor_accountant|afgerond, ready_at, signed_off_by, signed_off_at)`.
   Derived transitions from readiness (open → controle nodig → klaar), the accountant's sign-off
   as the terminal state, and a lock that turns money edits in a signed-off period into a
   proposal. Shown on Vandaag, Klaar, the office board and the kwartaal page.
3. **[BANK-VOOR-BOEKHOUDER] The accountant sees the bank.** A read policy on `bank_transactions`
   and `bank_tx_invoices` for the mandated accountant, the same card the owner has, and on an
   unexplained line exactly three actions: koppel factuur (proposal), markeer als privé
   (proposal), vraag klant (item 1).
4. **[KLANT-PERIODE] The tiles the pitch promises**, computed from what exists: transactions
   complete / to check, invoices, documents missing, open questions, BTW verdict (from
   `aangifte.ts`), package completeness (from readiness). One query, on the kwartaal page and
   the office board.
5. **[SIGNAAL-MENS] Readiness carries the human signals**: open question (waiting on client),
   IBAN change to confirm; Vandaag names the bank-review count and shows the period status.

After these five the loop the owner described runs end to end in one state machine, and every
sentence in the pitch is a sentence the code carries.
