# Exit plan — how BoekBrug closes without taking anyone's administration with it

*Written 2 August 2026. Everything about the product below was read in the code or in
`src/content/legal/algemene-voorwaarden.ts`; where something is unknown or unverified, it says so.*

> **This is not a pessimism document.** It is written now, at zero customers, because that is the
> only moment it is free. An administratiekantoor's first objection to a one-person supplier is
> *"and if you disappear? I hold 25 clients' administraties and I carry the liability."* A written,
> pre-committed exit is the answer to that objection. Today it costs a text file. At 40 offices it
> is a negotiation, and at the moment of actually closing it is not writable at all.

**English, per AGENTS.md.** The communication templates in §6 are Dutch on purpose: they are what a
Dutch entrepreneur reads, and translating them would change what is sent.

---

## 0. The one rule

**A bookkeeping app does not close like a photo app.**

Article 52 AWR puts a seven-year `bewaarplicht` on **the entrepreneur**, not on us — the AV says so
itself (§5.7.2: *"Wij nemen jouw bewaarplicht niet over"*). If BoekBrug disappears and the data
disappears with it, the user does not merely lose a tool: they are put in breach of a legal
obligation that outlives our closure by up to seven years.

Everything else in this document follows from that:

> **The announcement is the LAST step, not the first. Open the door before you tell anyone to walk
> through it.**

An e-mail that says *"we are closing, export your data"* followed by an export that falls over
under the load is how a quiet shutdown becomes the thing people remember.

---

## 1. What already exists

Verified in the repo, not assumed:

| Capability | Where |
|---|---|
| 90-day notice, automatic archive delivery, pro-rata refund | AV §5.7.6 — **Bewaarkluis customers only**, see §2 |
| Full account export (ZIP): invoices, filed BTW-aangiftes, bank, kas, dagomzet, messages, profile, the actual files | `src/lib/account-export.ts` → `/api/account/export` |
| Per-fiscal-year archive with `index.csv` + a README stating the bewaarplicht | `/api/kluis/export` |
| 12 months free retention after account termination, 30 days' warning before any deletion | AV §10.3, §5.7.5 |
| GDPR erasure that **cannot fire by accident** — `CRON_SECRET`, `RETENTION_PURGE_ENABLED` unset ⇒ dry run, nothing due before 2033 | `src/app/api/cron/retention-purge/route.ts` |
| Transactional e-mail | Resend (`src/lib/email.ts`) |

The purge cron is worth calling out: because erasure is fail-closed and disabled by default, the
worst shutdown scenario — data destroyed while people still need it — is not reachable by accident.
**Do not "clean up" storage on the way out.** Leaving it running costs a few euro a month and is
cheaper than one owner losing an administratie.

---

## 2. What does NOT exist yet — fix these before the first paying customer

**2.1 The shutdown clause covers almost nobody.**
AV §5.7.6 reads *"ontvangt iedere **Bewaarkluis-klant** automatisch zijn volledige archief"*. Every
other user — which today is literally every user — has no clause at all for "the service closes".
§10.3 governs the end of an **account**; the end of the **company** is a different event and is
unwritten. Generalise §5.7.6 to all users, paid or not.

**2.2 There is no accountant-side exit.**
AV §7.4 covers breaking one link. Nothing covers the platform closing while an office holds N
administraties, and every export path is owner-scoped (`/api/account/export` and `/api/kluis/export`
both key on the session user). On shutdown day an office with 25 clients has to chase 25 people to
press a button each. Either add a bulk export for the accountant role, or commit in writing to
producing those archives on request — the second is a sentence, the first is a feature.

**2.3 The prepaid Bewaarkluis is an unfundable promise.**
AV §5.7.4 sells *"€ 19 per resterend bewaarjaar, in één keer vooruit voldaan"* — up to seven years
collected today against an obligation running to 2033, and §5.7.6 promises a pro-rata refund if we
stop. From a natural person with no BV and no reserve, that refund is not fundable; in a personal
bankruptcy it is worth nothing.

Fix before the first sale, while it is still one line: cap prepayment at one year until there is a
legal entity with a reserve, **or** hold the prepaid amount in a separate account and never spend
it as operating cash.

**2.4 There is still no legal entity.**
`/voorwaarden` and `/privacy` are live with `[JOUW NAAM]` and `KVK-nummer [INVULLEN]`. Every promise
in this document is made by a party that is not identified. This blocks the exit plan the same way
it blocks everything else (`MARKTPOSITIE_2026.md` §8, stoppunt 0).

**2.5 Two export limits that only bite on shutdown day.**
- `/api/kluis/export` caps at `MAX_FILES = 500` and `MAX_TOTAL_BYTES = 150 MB` per year. The README
  records what was left out, so it is never silent — but a large account's archive is *incomplete*,
  which on shutdown day is the wrong time to discover.
- `buildAccountExportZip` holds every file and the ZIP in memory at once (noted in the file as a
  deliberate, measurement-first deferral). Fine for one user on a normal day; unproven for the
  concentrated load that a shutdown announcement creates.

**Both must be load-tested against the largest real account BEFORE any announcement goes out.**
That test is phase 0 of §4 and it is not optional.

---

## 3. Timing: the tax calendar decides, not you

Never announce and never close during an aangifte month — **January, April, July, October**. An
owner reconciling a quarter under a deadline cannot also migrate their administration.

The safe window: announce **mid-quarter**, and close only **after the next quarter's filing deadline
has passed**. That gives every user at least one full, undisturbed quarter to move, and it means no
one is mid-aangifte when access ends.

`/api/cron/quarter-close` runs `0 8 5 1,4,7,10 *`, which is the same calendar seen from the other
side.

---

## 4. The sequence

**Phase 0 — Open the door (before a word is sent).**
- Export works, load-tested against the largest real account (§2.5).
- `btw-aangiftes.csv` is in the ZIP — the artefact a Belastingdienst controle asks for, and the one
  thing in the account that *cannot* be recomputed later (a late invoice moves the live figures; the
  filed snapshot is the record of what was actually sent). Closed 2 Aug 2026, `[EXPORT-FILED]`.
- `RETENTION_PURGE_ENABLED` confirmed unset. Nothing may be deleted during a wind-down.

**Phase 1 — Accountants first, individually, two weeks ahead of everyone else.**
A phone call, not a broadcast. They are moving N administraties, not one, and they need lead time to
pick a replacement package. An office that learns this from a mass e-mail *at the same moment as its
own clients* will say so out loud, in a small market.

**Phase 2 — The public announcement, 90 days out.** Template in §6.

**Phase 3 — Push the archive; do not wait to be pulled.**
AV §5.7.6 already promises automatic delivery to Bewaarkluis customers. Do it for everyone: send
each active account its ZIP, or a long-lived signed link. **The people who never open the e-mail are
exactly the people who will need the file in three years.**

**Phase 4 — Reminders at T-30, T-7, T-1** to anyone who has not exported. One line each.

**Phase 5 — After the close.** Keep storage alive. Answer `support@` for at least twelve months
(AV §10.3 already commits to this). Do not enable the purge cron; let 2033 arrive on its own.

---

## 5. Refunds and money

- Plus (€ 12,99/mnd, AV §5.1) is monthly — stop billing at the announcement, not at the close. The
  last 90 days are free; the goodwill is worth more than the revenue.
- Bewaarkluis prepayments: pro-rata refund from the close date, per §5.7.6. See §2.3 for why this
  must be funded in advance rather than promised.
- AV §5.4 ("no refund of paid periods") is written for a user who leaves. It must **not** be applied
  to a user we leave. Say so explicitly in the announcement.

---

## 6. The announcement — Dutch, five mandatory elements

Dutch because it is what the reader reads (AGENTS.md). The five elements are mandatory; the wording
around them is not.

1. **The exact closing date.** Not "binnenkort".
2. **The last day exports work** — later than the closing date, never earlier.
3. **The export link in the body of the mail.** Not "ga naar Instellingen en dan…".
4. **The bewaarplicht, stated plainly.**
5. **What happens to money**, with a date.

A sixth element is optional and worth more than the other five together: **where to go instead.**
One or two named alternatives turn an abandonment into a handover.

```
Onderwerp: BoekBrug stopt op <datum> — zo haal je je administratie op

Beste <naam>,

BoekBrug stopt op <datum>. Je kunt tot en met <datum + marge> je volledige
administratie downloaden:

    <directe exportlink>

Je krijgt één ZIP met je facturen, je ingediende BTW-aangiftes, je bank- en
kasboekingen, je dagomzet en al je documenten.

**Bewaar dit bestand.** Je bewaarplicht van 7 jaar (art. 52 AWR) rust op jou als
ondernemer en loopt door nadat BoekBrug stopt. Wij nemen die plicht niet over —
dat hebben we nooit gedaan en dat verandert nu niet.

Wat er met je geld gebeurt: we factureren vanaf vandaag niets meer. Heb je
vooruitbetaald voor de Bewaarkluis, dan krijg je het niet-verbruikte deel terug
op <datum>. Je hoeft daar niets voor te doen.

Werk je met een boekhouder? Die is apart geïnformeerd op <datum>.

Waar je terecht kunt: <alternatief 1>, <alternatief 2>.

Het spijt me. Vragen mogen tot minstens <datum + 12 maanden> naar
support@boekbrug.nl — die blijft bemand.

<naam>
```

**Tone.** State it, do not perform it. No "exciting new chapter", no "journey". A Dutch ondernemer
being told that their bookkeeping tool is disappearing wants the date, the link and the file — the
apology belongs in one sentence, near the end.

---

## 7. Checklist

- [ ] KvK registered; `[JOUW NAAM]` / `[INVULLEN]` replaced everywhere in `src/content/legal/`
- [ ] AV §5.7.6 generalised from Bewaarkluis customers to all users
- [ ] Accountant exit written into the AV (bulk export, or a commitment to produce archives on request)
- [ ] Bewaarkluis prepayment capped at one year, or held separately from operating cash
- [ ] Export load-tested against the largest real account
- [ ] `RETENTION_PURGE_ENABLED` confirmed unset
- [x] `btw_filings` in the account export — `[EXPORT-FILED]`, 2 Aug 2026

The first four are text. Only the fifth costs engineering time.

---

## 8. What this document does not settle

- **Whether the AV wording holds up.** Nothing here has been read by a Dutch lawyer. The gaps in §2
  are gaps in coverage, not a legal opinion. Have §5.7.6, §10.3 and Bijlage A reviewed once by
  someone qualified, before the first kantoor is asked to sign anything.
- **Whether an office would accept this as an answer.** That is stoppunt 2 in
  `MARKTPOSITIE_2026.md` — ask it in the same ten phone calls. *"If I disappeared, what would you
  need to have in your hands?"* is a better question than any clause written without an answer to it.
- **The one scenario this plan cannot cover: not being there to execute it.** An orderly 90-day
  wind-down assumes a founder who is available and solvent. If that is a risk worth insuring
  against, the mechanism is a data escrow or a named second person with access — and both cost real
  money, so decide only once there is revenue to protect.
