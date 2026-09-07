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

## One decision per proposal

The row and the invoice must never contradict each other, and two requests must never both run
the door. So the decide route:

- **claims** the row before calling the door (`applying_since`, compare-and-set on `status =
  open` and no live claim; a claim older than two minutes is a dead request and is ignored);
- **checks every row write** for the row it moved — a decline that lands while a claim is live is
  refused (`busy`), a second accept from another tab loses the claim and is refused;
- **closes the row from its claim** after the door wrote, and if the door refused because the
  invoice was paid, money was booked or it is verwerkt, closes it as `stale` (vervallen) — an
  open proposal nobody can ever accept showed the accountant "wacht op de klant" forever;
- **heals a broken run**: an invoice that already carries the proposal (the door ran, the row did
  not close) closes as `accepted` on the next tap, never as stale.

The stale check compares every field the door will WRITE (an amount proposal writes the trio,
so all three are compared — naming one left a 2-cent hole inside `SUM_TOLERANCE`), and the door
itself pins the five correctable values it read in its WHERE, so nothing — the client's own
editor, a second tab — can slip a newer truth under an accepted proposal between the check and
the write. Sign follows the document at build time: on a creditnota the proposed trio is stored
negative, exactly as the door would store it, so the card shows what will be stored; on a factuur
a negative amount is refused, here and at the door — that document is a creditnota.

## What it never does

Update an invoice on the accountant's word. The routes write `invoice_corrections` with the
service role after their own checks; RLS lets the accountant read their own proposals and the
client read the ones about them, and nobody writes through RLS.

## Gates

`correction-proposal.test.ts` (arithmetic, stale rule, the door's body shape), a render test for
the client's card, and a `[VOORSTEL]` lifecycle gate: the one door, owner-only, no direct
invoice writes on either route, the stale check, the claim before the door and the row-count
check on every close, the already-applied heal, the terminal door codes, the door's value pin
and sign refusal, both screens, the RLS shape.
