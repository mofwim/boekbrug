# When something we depend on is unreachable

The owner made an observation that is architecturally correct and worth writing down before it is
lost in a chat log: **a Claude API outage and a phone with no signal are the same problem.** In both
cases the app is asked to do work while something it needs is not there, and in both cases the only
question that matters is *what happens to what the owner already handed over.*

This file is the ruling on that class of failure — for the reader, for the network, and for
anything else we depend on and do not control. It states what the rule is, what already obeys it,
what was fixed to obey it, and what we are deliberately NOT building.

## The rule

> **An action taken while a dependency is unreachable may create intent. Only the server may
> create authoritative accounting state.**

Intent is a file we are holding, a draft, a queued attempt. Accounting state is a number that
appears in an aangifte, on an invoice a customer receives, or in an auditfile: an invoice number, a
booked BTW split, a journal line, a settled payment, a closed period.

The rule cuts both ways, and the second half is the half that gets forgotten: intent must **survive**
(it may never be discarded because a dependency was down), and it must **never be promoted** to
accounting state by anything other than the server.

## What already obeys it

Not aspiration — this is the app as it stands, verified:

| Thing | How it obeys the rule |
| --- | --- |
| Invoice numbering | `next_invoice_seq()` is a Postgres function, atomic, and drawn only at *send*. A draft invoice has no number, so a draft is intent by construction — `dashboard/invoice/new/page.tsx` says so in as many words. |
| The service worker | `public/sw.js` caches exactly one thing: a branded offline page. It never caches a live page, never touches `/api/*`, never serves an authenticated response from cache. Its own header explains why: in an auth-heavy financial app, stale content is dangerous. That decision predates this file and this file agrees with it. |
| E-mail intake | An attachment that cannot be read is kept (`saveKeptAttachment`) and the watermark is held, so it is read again by itself. The queue is the mailbox; the retry is free. |
| Duplicate protection | Intake dedupes on `content_hash`, so replaying a queued upload cannot book the same document twice. That is idempotency, and it is what makes any retry safe. |
| Cost of a failed read | `[FAIR-USE §3]` — a read that did not happen is not counted against the owner's month. Our outage may not cost them a document. |

## What was fixed to obey it

**`[BEWAAR-EERST]`** — the upload door. `/api/intake` called the reader first and stored nothing
until it answered; the comment above the call said so out loud. On a reader outage it answered 503
and kept nothing, and during an outage of hours it discarded the same document on every retry. The
two doors into this app disagreed about the rule, and the weaker one was the one a **human** stands
at.

Now the bytes are stored first, labelled `could_not_read`, which is exactly what the skipped panel
counts — so the file arrives there with the `[TWEEDE-KANS]` "lees opnieuw" button already on it. No
new screen, no new state: the machinery for the second attempt existed and was simply never handed
anything from this door.

**`[LEZER-STIL]`** — the alarm. An app-wide reader refusal throws nothing, it *holds*, so every
per-mailbox sync "succeeded" and the run was written `ok:true` while not one document was read.
Every job green, nothing happening. A held run is now simply not a successful run, so the watchman
that already exists fires by itself — no second watchman was added.

## What we are deliberately NOT building

### Offline-first for the screens

A local mirror of the administratie (IndexedDB + two-way sync + conflict resolution) is not a
feature; it is a second app, and every part of it can put a wrong number on a screen. Three reasons,
in the order they matter:

1. **A stale number is worse than no number.** An owner who opens the app in a tunnel and sees "nog
   te ontvangen: € 12.400" from yesterday makes a decision on it. An owner who sees nothing knows
   they know nothing. The service worker already refuses to do this, on this exact reasoning.
2. **A conflict on money is not resolvable by a rule.** Last-write-wins is wrong; a merge is wrong;
   so the only correct resolution is "ask the owner", and an owner adjudicating sync conflicts is a
   worse product than an owner who could not type an invoice in a tunnel.
3. **It buys almost nothing here.** The work this app asks of an owner is not typing — it is
   capturing (a photo of a bon) and deciding (yes, book it). Deciding needs the server anyway,
   because only the server may create the state the decision produces.

### A connection-state indicator

`navigator.onLine` genuinely lies — it reports "online" on a captive portal and on a dead uplink —
and the six-state model (ONLINE / DEGRADED / OFFLINE / AUTH_REQUIRED / SERVER_UNAVAILABLE /
SYNCING) is an accurate description of reality. It is still the wrong thing to put on a screen.

State is derived from what happened to the last real request, not from a browser flag, and it is
shown **on the thing that failed**, not in a global badge: "niet opgeslagen — we proberen het zo
opnieuw", on the row. A permanent connection widget explains our own machinery to someone who did
not ask, which is precisely what `docs/RUSTIG.md` forbids.

## What is worth building, and when

### 1. The capture queue (the one offline door that earns its keep)

A file the owner picked while the network was gone is held in the browser and uploaded when it comes
back. This is `[BEWAAR-EERST]` extended exactly one layer outward — from "the server keeps it when
the reader is down" to "the browser keeps it when the server is unreachable" — and it creates no
accounting state whatsoever, because an upload is intent by definition: `/api/intake` still decides
everything about it.

It is bounded work: one queue, one retry, no conflicts possible (the queue is append-only and
`content_hash` makes a double send harmless).

**Trigger:** the first report of a lost capture, or the first owner who works somewhere without
signal (bouw, transport — both already have a front door). Not before: there is no measured loss
today, and an unmeasured fix in the money path is how you buy a new bug with an old one.

### 2. Processing checkpoints (deferred, with its trigger written down)

The reader pipeline is currently one attempt: read → decide → store. A staged version records what
it already knows after each stage, so a failure at stage 3 does not re-do stages 1 and 2, and a
half-read document can be resumed rather than restarted.

**Why it is deferred.** Every one of its benefits — nothing lost, no double charge, a way back to a
document that could not be read — is already delivered by cheaper machinery: the bytes are stored
before anything is decided, the read is not billed when it fails, and `[TWEEDE-KANS]` re-reads on
one tap. Checkpoints would buy latency and cost on a retry, not correctness. They also introduce
partial state, which is a new way to be wrong about money.

**Trigger:** when a single document's read costs enough that redoing it matters (multi-page
auditfiles, a bank statement of thousands of lines), or when the reader gains a second expensive
stage. Then stage it — and stage it in the database, not in memory, or the checkpoint dies with the
process it was protecting.

### 3. A second reader, from a different provider

Rejected as stated, and the reason is not cost. **Two readers mean two sets of numbers on the same
document**, and the day they disagree about a BTW amount there is no principled way to choose. That
is a correctness risk taken on to buy availability, on the one path where correctness is the
product.

The one shape that would be acceptable: a second provider that **never produces a number** — it may
classify (is this an invoice, a bon, a reminder?) so the file lands in the right place, and the
amounts still wait for the primary reader. Availability for routing, one source of truth for money.
