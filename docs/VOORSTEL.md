# [VOORSTEL] The accountant proposes a correction, the client taps OK

## The gap

The amount guard (`accountant_amount_guard`) keeps a boekhouder from changing the money on a
client's invoice, and that is right: art. 52 AWR leaves the administration the owner's. But the
boekhouder is the one who sees the wrong btw split, the wrong date, the total that does not match
the paper — and the only tool was a free-text question that ended in WhatsApp.

## What it is

A proposal is a question with the answer already typed in.

1. **Propose** (accountant, quarter page, only on a booked and unpaid purchase invoice): five
   fields prefilled from the invoice — excl. btw, btw, total, invoice date, due date — and a
   reason. `POST /api/accountant/invoice-correction` validates with the same arithmetic the
   client's own editor enforces (all three amounts or none, ex + btw = total, no btw over nothing,
   no rate above 21%), snapshots the current values, stores one row in `invoice_corrections`
   (one open proposal per invoice) and notifies the client. Nothing on the invoice changes.
2. **Decide** (client, `/dashboard/vragen`): the card shows old → new per field and the reason,
   with Akkoord and Niet akkoord. `POST /api/invoice-corrections/[id]`:
   - **stale check** — if the invoice no longer matches the snapshot on the fields the proposal
     names, the proposal lapses (`stale`) and nothing applies;
   - **Akkoord** builds the exact request the client's editor sends and calls the PATCH handler of
     `/api/invoice/[id]/amounts` in the client's own session. Every check that door makes runs
     unchanged: owner-only, status, settled money, arithmetic, the duplicate-number check, the
     filed-quarter impact, the audit row. A refusal reaches the client in the door's own words and
     the proposal stays open.
3. **Outcome** back to the accountant: a notification and a status chip on the quarter page
   (wacht op de klant · overgenomen · afgewezen · vervallen).

## What it never does

Update an invoice on the accountant's word. The routes write `invoice_corrections` with the
service role after their own checks; RLS lets the accountant read their own proposals and the
client read the ones about them, and nobody writes through RLS.

## Gates

`correction-proposal.test.ts` (arithmetic, stale rule, the door's body shape), a render test for
the client's card, and a `[VOORSTEL]` lifecycle gate: the one door, owner-only, no direct
invoice writes on either route, the stale check, both screens, the RLS shape.
