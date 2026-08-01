# The bank link (GoCardless Bank Account Data)

*August 2026 — the PSD2 road into `bank_transactions`.*

Until now a bank statement only entered BoekBrug because the owner exported an MT940 or CAMT
file from his bank and uploaded it. That is the step people forget, and everything downstream
degrades quietly when they do: a kwartaal that misses a month, invoices that stay "openstaand"
because their payment was never imported, an accountant who never sees the whole money line.

With the owner's consent at his own bank, the transactions now arrive by themselves.

This document is the map. The reasoning lives in the file headers — each one says why it is the
way it is; this says how the pieces fit and what to watch out for.

---

## 1. The road, end to end

```
  owner                    BoekBrug                          GoCardless / his bank
  ─────                    ────────                          ─────────────────────
  "Koppel je bank"  ──▶  GET  /institutions/                    list of NL banks
  picks his bank    ──▶  POST /agreements/enduser/              consent scope + 90 days
                         POST /requisitions/                    → { id, link }
                         INSERT bank_connections (pending)
                    ◀──  redirect to `link`
  logs in at his bank ─────────────────────────────────────▶   authenticates, consents
                    ◀──  redirect to /callback?ref=<nonce>
                         GET  /requisitions/{id}/               status LN + account ids
                         GET  /accounts/{id}/details/           IBAN, holder
                         UPSERT bank_connection_accounts
                         UPDATE bank_connections (linked)
                    ◀──  redirect to /dashboard/bank?bank=gekoppeld
  page loads        ──▶  POST /api/bank/gocardless/sync
                         GET  /accounts/{id}/transactions/      the booked lines
                         → map → dedup → insert → auto-confirm
```

From then on `/api/cron/bank-sync` runs daily and repeats the last step.

## 2. The files

| File | What it owns |
|---|---|
| `src/lib/gocardless-client.ts` | Everything that touches the network. Token cache, typed errors, response normalisation. |
| `src/lib/gocardless-map.ts` | Berlin Group JSON → `BankTransaction`. Pure. **The correctness centre — see §3.** |
| `src/lib/gocardless-connection.ts` | Reads and writes `bank_connections` / `bank_connection_accounts`. The only place that does. |
| `src/lib/gocardless-sync.ts` | Pull → map → dedup → insert → auto-confirm. Plus the rate-limit guard and window arithmetic. |
| `src/app/api/bank/gocardless/*` | institutions · connect · callback · status · sync · disconnect. |
| `src/app/api/cron/bank-sync/route.ts` | The daily feed, and the consent-expiry warnings. |
| `src/app/dashboard/bank/BankConnectPanel.tsx` | The card above the upload zone. |
| `supabase/migrations/bank_connections.sql` | Two tables, RLS, and the CONTROLE block. |

## 3. The one property to never break

A transaction can now enter through **two doors**: an uploaded file, and the bank feed. Sooner or
later both carry the same transaction — the owner connects his bank in March and then uploads
January–March for his accountant.

Cross-upload dedup (`src/lib/bank-import.ts`) keys on

```
contentKey = date | amount | dedupName(counterpartName) | norm(reference)
```

If `gocardless-map.ts` derives a counterpart name or a reference even slightly differently from
`bank-parser.ts`, the same transaction gets two keys, lands in the table twice, and **every
figure built on it doubles**: omzet, kosten, the btw-aangifte, the kwartaalpakket the accountant
signs. That is a wrong tax return, not a display bug.

So the mapper does not re-implement those rules. It reshapes the JSON into what
`parseCAMT053Entry` sees and calls the *same* helpers — `extractInvoiceReference`,
`deriveReadableName` — in the *same* order.

`src/lib/gocardless-map.test.ts` asserts this directly: it builds one transaction as CAMT XML and
as bank-feed JSON and compares the resulting `contentKey`. **When you change either side, that
test is the one that has to stay green.**

## 4. Two limits that shape everything

**Rate limit.** Each access scope (details / balances / transactions) may be read only a handful
of times per day *per account* — GoCardless narrowed this to 10/day in August 2024 and documents
an intent to reach 4/day. Consequences already built in:

- `SYNC_MIN_INTERVAL_HOURS = 20` in `gocardless-sync.ts` — under a day so the daily cron never
  skips by drifting, far enough that the cron and the manual button do not race.
- The "Ververs" button is *disabled* when no account is due, with the reason shown. A button that
  silently no-ops teaches the owner the app is broken.
- A 429 is a first-class, calm outcome ("morgen halen we automatisch de rest op"), never an error
  state. `force` is deliberately not something the browser can ask for.

**Consent expiry.** A PSD2 consent lasts at most 90 days by default, and up to **180** where the
bank allows it — each institution publishes its own ceiling as `max_access_valid_for_days`, so
the connect route asks for that rather than the default. It is the difference between the owner
re-authorising twice a year and four times. After expiry the feed goes silent with no error, just
nothing. `access_valid_until` stores the window the bank *granted* (it may cap shorter than we
asked), the panel shows it, and the cron warns at 10, 3, 1 and 0 days. Those warnings are the only
thing standing between an expired consent and a quarter with a month missing.

## 4a. Errors: who is being asked to fix this?

The status code and the person who can act are different axes, and conflating them is how an
integration ends up telling an owner to "contact support" for something one tap fixes — or
telling him to reconnect against a setting only we control. `refineErrorCode` in
`gocardless-client.ts` is the single place that decides, and it reads the body, not just the
status:

| What happened | Comes back as | Code | Who fixes it |
|---|---|---|---|
| `EUAExpiredError` / `AccessExpiredError` | **401** | `CONSENT_EXPIRED` | owner — reconnect |
| `AccountValidEUAError` | 403 | `CONSENT_EXPIRED` | owner — reconnect |
| `AccountSuspendedError` | 409 | `ACCOUNT_SUSPENDED` | owner — reconnect |
| `AccountInactiveError` | 401 | `ACCOUNT_INACTIVE` | owner — reconnect |
| `RateLimitError` | 429 | `RATE_LIMITED` | nobody — tomorrow |
| `ServiceError` / `ConnectionError` | 503 | `SERVER` | nobody — the *bank* is down |
| `IPAccessDenied` | 403 | `IP_NOT_ALLOWED` | **us** — portal IP whitelist |
| Free usage limit exceeded | **402** | `QUOTA_EXCEEDED` | **us** — our plan |
| `InvalidToken` | 401 | `INVALID_CREDENTIALS` | us — rotated secrets |

Three consequences worth knowing before you touch this:

- **`EUAExpiredError` is a 401 with no `type` field.** On the status alone it is
  indistinguishable from our credentials dying. Getting this one wrong defeats the entire point
  of the expiry machinery above, so it has its own test built from the spec's verbatim payload.
- **A 401 only clears the token cache when it is *about* the token** (`isTokenFailure`). Our
  token is fine when a consent lapses; dropping it would make one owner's expired connection
  force a fresh exchange for every account behind it in the cron run, against a token endpoint
  that has its own rate limit.
- **Validation errors arrive in a second, non-overlapping shape**: the offending field is the
  key (`{"access_scope": [{summary, detail}], "status_code": 400}`) with no top-level `summary`
  at all. `parseErrorBody` flattens both shapes; reading only `ErrorResponse` makes every
  connect-time validation error look like an empty body.

## 4b. Access scope: ask for what we use, but survive a bank that says no

The agreement requests `["details", "transactions"]` — the feature, plus the IBAN and holder
name on the connection card. **`balances` is deliberately absent**: nothing in this app reads a
saldo, and asking an owner to hand over data we will not use is over-collection, not
future-proofing (see `docs/legal/05_Verwerkingsregister.md`).

But the scope is not ours alone to pick. The API documents three separate refusals — scopes that
must be requested *together*, scopes that are *mandatory*, and scopes an institution does not
support at all. A single fixed list therefore makes some banks impossible to connect: the owner
picks his bank, gets "koppelen mislukt", and retrying never helps. So `createAgreement` walks
`ACCESS_SCOPE_LADDER`: what we use → everything → `transactions` only. Only a `SCOPE_UNSUPPORTED`
advances the ladder; any other error is the real answer and is thrown immediately.

## 5. What it deliberately does not do

- **Pending transactions are never imported.** A pending line has no final amount or date; when
  it books it arrives again with different values and would import a second time — the
  fingerprint cannot save us, because the fingerprint itself changed. Only `booked` is money.
- **No passthrough document is stored.** There is no original file — the bank fed us JSON. The
  closing package already says so for such a quarter ("Banktransacties zijn aanwezig, maar het
  originele bankafschrift-bestand kon niet automatisch worden bijgevoegd"), and the panel repeats
  it. A generated file would *look* like a bank statement without being one, and an accountant
  cannot tell the difference by eye. **The upload card stays** — a linked bank does not replace it.
- **No statement-balance check.** That check proves an uploaded *file* is internally complete
  (opening + Σtx = closing). A feed has no statement boundaries, so a "pass" would be fabricated.

## 6. Security notes

- **The callback trusts one thing only.** `/api/bank/gocardless/callback` is a redirect target,
  so its query string is attacker-controllable. The only value read from it is `ref`, a 256-bit
  nonce we generated and stored ourselves; it is a lookup key, never a claim. There is no user id
  in that URL, and adding one would be the whole vulnerability. Whether the consent succeeded is
  decided by asking GoCardless, never by believing the query string.
- **No session is required on the callback**, on purpose: the owner may finish the bank flow on
  his phone. The row carries the owner, and we wrote it.
- **Nothing in the two tables is a secret.** A requisition or account id grants nothing without
  `GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY`, which live in the server environment. Hence
  no Vault dance, unlike the SnelStart maatwerksleutel.
- **RLS is read-only for the owner.** Writes go exclusively through service_role. A client that
  could set `status='linked'` or invent an `account_id` could attach an account id of its
  choosing to its own row and read that account through our credentials.
- **Disconnect withdraws upstream first**, then marks our rows. A half-failure then leaves a dead
  row that syncs nothing (visible, harmless) rather than a live authorisation to read someone's
  bank account with no row to revoke it from.

## 7. Turning it on

1. Get a secret pair from <https://bankaccountdata.gocardless.com/user-secrets/> and set
   `GOCARDLESS_SECRET_ID` + `GOCARDLESS_SECRET_KEY`. Unset → the card hides itself, the routes
   answer 503, the cron reports `configured:false`. Uploading is unaffected.
2. Apply `supabase/migrations/bank_connections.sql` and run its CONTROLE block. Every column must
   come back `true`.
3. Confirm `CRON_SECRET` is set — without it the daily feed refuses to run (fail-closed) and says
   so loudly in the log.
4. `vercel.json` already schedules `/api/cron/bank-sync` at 05:00 UTC daily.

**Test it before trusting it with a real quarter.** GoCardless publishes a mock institution,
`SANDBOXFINANCE_SFIN0000`, which walks the whole consent journey without a real bank. Connect it
once from `/dashboard/bank` and check that transactions land, that they are matched, and that
re-running the sync inserts nothing the second time (the dedup working).

If the portal has an IP whitelist configured, add the deploy's egress IP — otherwise every call
fails 403 `IPAccessDenied` and the app will correctly, but unhelpfully, tell users to contact
support.

The generated types in `src/types/database.types.ts` carry both new tables by hand until the next
`supabase gen types` run; the header there lists them.
