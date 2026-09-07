# [ZIEL] The soul of BoekBrug — the app does the work, the owner keeps the say

The owner stated the equation in one breath: *the app must understand everything and process
everything by itself, correctly, because the client has no time — and at the same time the app
must stay tied to the client, so that all of the client's time is on BoekBrug.*

Read literally, the two halves fight. An app that does everything is an app nobody opens. An app
that keeps people inside it is, in most of software, an app that manufactures reasons to open it.
This document is what the research says about that fight, and the resolution BoekBrug builds on.

## What the research says

**1. Automation does not remove the human; it moves them to the hard 20 %.** The automation
paradox: when a system handles most cases, the cases it hands back are the ambiguous ones, and
they carry the risk. Human attention does not scale with the automation, so the design question
is not "how much can we automate" but "what does the human see when we could not" — and whether
they can trust what they see. Trust is calibrated by *meaningful communication of what the system
did and how sure it was*, not by friendliness or anthropomorphism; systems that assess and state
their own confidence measurably improve human trust and team performance.
(Sources: [Human-Automation Trust Expectation Model](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11457490/),
[self-assessment in machines boosts trust](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12146354/),
[the human-in-the-loop paradox](https://medium.com/@anna_42775/the-human-in-the-loop-paradox-when-ai-oversight-creates-new-risks-bffc4d2a5f13).)

**2. The best bookkeeping automation is built around one review per item, not zero.** Xero's
automatic bank reconciliation books when it is highly confident, suggests when it is not, keeps
every decision visible and reversible, and targets ten to fifteen seconds per item in the queue —
a single look, never a back-and-forth. The Dutch market says the same in the owner's words: the
reviewer who praises Moneybird says "I only need to check and approve; it does most of the work".
(Sources: [Xero automatic bank reconciliation](https://blog.xero.com/product-updates/automatic-bank-reconciliation-jax-beta/),
[Xero on AI in bank rec](https://www.accountingtoday.com/news/xero-adds-ai-to-bank-rec),
[Moneybird review](https://reviewnederland.nl/moneybird-review-ervaringen-beoordeling-en-alternatieven).)

**3. A habit built on notifications is not a habit.** The engagement literature that grew out of
the Hook model has a documented dark side; for money apps in particular, a daily push about
yesterday's coffee creates notification blindness. What retains people is a message tied to a
*financial state change* — payday, a bill that grew, an unusual charge, a deadline — and a product
that behaves like a companion rather than a mirror. The most durable feature may be the one that
eventually becomes unnecessary.
(Sources: [why personal finance apps fail at retention](https://www.productgrowth.blog/p/personal-finance-app-user-retention),
[engagement optimisation for finance apps](https://lifecyclearchitect.com/guides/engagement-optimization-for-personal-finance-apps/),
[the Hook model and its critics](https://yukaichou.com/gamification-analysis/hook-model-octalysis-habit-addiction/).)

**4. Dutch law draws the line the app must not cross.** Without an invoice there is no
voorbelasting (art. 15 Wet OB); the cost still deducts for income tax, with the bank line as
evidence. An app that "understands everything" must understand this: it may book the cost from a
bank line, it may never book the btw.
(Sources: [factuur kwijt — MKB Servicedesk](https://www.mkbservicedesk.nl/administratie/boekhouding/wat-moet-je-doen-als-een-deel-van-je-boekhouding-verloren-gaat),
[voorbelasting terugvragen — ZZP Boekhouder](https://zzp-boekhouder.nl/voorbelasting-btw-terugvragen-als-zzper-wat-aftrekken/).)

## The resolution

The two halves stop fighting once "tied to the client" is read correctly. The owner does not
want to spend time *doing* bookkeeping in BoekBrug. They want their *decisions* and their *truth*
to live there — and nowhere else. So:

> **BoekBrug does the work. The owner keeps the say.**
> Every booking the app can prove, it makes — visibly, reversibly, with the reason attached.
> Every booking it cannot prove, it hands to the owner as ONE question with the answer typed in.
> The owner's daily visit is short, ends in a decision or a confirmation, and is never manufactured.

Four rules follow, and every feature is judged by them:

1. **Prove it or ask.** A booking with no proof is not made; a question with no answer typed in
   is not asked. (`[ZELF-EERST]` gives the owner the switch; `[SOM-KLOPT]`, `[BANK-AUTO-CONFIRM]`
   and the auto-advance reasons are the proofs; `[WAAROM-WACHT]` is the question.)
2. **Say what you did, in the owner's words, where the money is.** A booking the owner cannot
   see is a booking they cannot trust. (`[WERK-GEDAAN]` for the accountant, the Vandaag line for
   the owner, the audit trail under both.)
3. **Every automatic act is one tap back.** Reversibility is what makes autonomy acceptable.
   (`Ontkoppelen`, `Andere factuur`, `Klopt`, `[STORNO]`.)
4. **Never make the owner come.** No streaks, no badges, no daily pulse about nothing. The app
   speaks when the money moved (`[PULS]`), a deadline nears, or a check could not run — and is
   silent otherwise. The visit that matters is the one the owner chooses.

## The measure

Three numbers, all from what happened, none from what a screen claims:

- **Self share** — of everything booked this week, the part booked with no human tap
  (`zelfstandig.ts`: audit actions `SELF_ACTIONS` over `SELF_ACTIONS + HAND_ACTIONS`). Shown on
  Vandaag in one sentence; absent when nothing was booked. The goal is not 100 % — that would
  mean the app booked things it could not prove — but a share that climbs as the app learns the
  owner's suppliers, customers and rhythms, with a hand share made of real decisions.
- **Waiting** — verify queue plus unexplained bank lines. Shown beside the share. The goal is a
  number the owner can clear in one short visit.
- **Time of the daily loop** — from opening Vandaag to the last decision. Not instrumented yet;
  the design target from the research is under two minutes on a phone.

## What this changes in how features are built

- A feature that adds a *chore* is wrong by default. A feature that removes a question the owner
  was being asked, or answers it better, is right by default.
- Copy is judged by `[RUSTIG]`: a screen says what it is and offers what to do.
- Every new automatic writer must (a) leave an audit row in `SELF_ACTIONS` so the measure sees it,
  (b) be reversible in one tap, (c) show its reason.
- Every new question to the owner must arrive with the answer typed in (`[VOORSTEL]` is the model:
  old → new, Akkoord).

## Gates

`zelfstandig.test.ts` (the share is null on nothing, the action lists are disjoint and count no
reversal), `[ZIEL]` in the lifecycle gates (this document names the equation; Vandaag renders the
sentence from the audit trail; every self-writer's action is in `SELF_ACTIONS`).
