# [MOLLIE-AFREKENING] A Mollie payout is a netted settlement, read from the API

## The gap

A Mollie payout is the sum of the payments Mollie collected, minus Mollie's fees (21% btw), in
one bank credit. Three things were true at once:

- the payments were booked: an iDEAL payment on a BoekBrug payment link marks its invoice paid
  when Mollie's webhook rings;
- the fees were booked nowhere: Mollie's monthly invoice was read by no path in the app, so a
  cost with deductible btw stayed out of the result;
- the payout bank line was held from every category on purpose (`bank-double-booking.ts`,
  [MOLLIE-UITBETALING]): the fee shifts every amount, so no invoice matches, and booking it as
  omzet would count the payments twice.

The Settlements API (docs on GitHub, key already in the Vault) answers all three per settlement.

## What it does, per settlement (daily cron `mollie-settlements`)

1. **Reconcile or refuse.** Σ revenue gross − Σ costs gross must equal the payout, in cents;
   every cost line must satisfy net + vat = gross. Otherwise the settlement is recorded as
   `refused` with the reason and nothing books.
2. **The fee** becomes a purchase invoice from "Mollie B.V." numbered `MOLLIE-<bank reference>`
   (one per settlement, never Mollie's monthly invoice id, which spans several settlements),
   dated on the settlement date, with Mollie's invoice ids in the trail. It is marked paid on
   that date through `apply_manual_payment`, keyed on the settlement row, because it was deducted
   at source and no bank line will ever pay it. The key is one per (settlement row, invoice), so a
   retry replays and a fee invoice the owner deleted is recreated and settled under its own key.
   Under "ik kijk zelf naar alles" it enters the queue as `processing`; once the owner confirms
   it, the next run settles it (the deduction is a fact, not a booking decision). Until then the
   row is `held` with that reason — never an open Mollie payable that nothing can pay. The row
   records the moment (`fee_paid_at`), and a failed RPC is retried on the next run.
   **Do not also forward Mollie's monthly invoice into the inbox**: it spans several settlements
   whose fees are already booked here, and no duplicate detector can match a different number
   with a different total.
3. **The payments** are split into ours (the payment id maps to a BoekBrug payment link, learned
   once from the Payment Links API and stored on the link) and not ours (the owner's webshop).
4. **Refunds and chargebacks** are read (`/settlements/{id}/refunds`, `/chargebacks`). Any at
   all holds the settlement: a refund of one of OUR invoices leaves that invoice standing as paid
   while the money went back, and "every payment is ours" would be a false all-clear. The
   payments must also add up to the revenue, or something that is not a payment sits in it.
5. **The payout bank line** — cent-exact amount, "Mollie" or the bank reference in the text,
   within 5 days of the settlement date — is coded `transfer` (unconfirmed, source `rule`) only
   when every payment is ours, nothing was refunded or charged back, and the double-booking guard
   does not say the line may be a paid invoice's own payment (then the line is found but NOT
   coded, and the row is held with that reason). Otherwise the line stays uncoded, the row is
   `held`, and the owner gets one notification that says the line is ONE netted amount (omzet
   minus Mollie's fee): split it, or book the revenue apart and set the line to overboeking —
   never the whole line as omzet, which would book the linked part twice.

## What it never does

Guess a category, guess an amount, book revenue, or touch a category the owner already set.

## Tables

`mollie_settlements` (one row per settlement: Mollie's figures, the split, the fee invoice, the
bank line, the status and reason) and `mollie_payment_links.payment_id`.
