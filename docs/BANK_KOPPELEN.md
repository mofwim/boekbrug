# [BANK-KOPPELEN] One bank line, the right invoices, and the owner's own controls

The owner's requirement, in one sentence: the bank must match invoices — outgoing and incoming —
without error, especially one payment that covers several invoices; and when the app does not
know, the owner must be able to do whatever is needed on that line: add, delete, link, upload.

An adversarial read of `/bank`, its 25 routes and 30 libraries found fourteen gaps. This is what
changed, ranked by what it cost.

## Money

1. **Every plain "Bevestig" answered 500.** `confirm_bank_payment` was revoked from `authenticated`
   on 18 August as "no caller in the code"; on 2 September `/api/bank/confirm` started calling it
   with the session client, through a variable name the `[ANON-RPC]` gate could not see. Only the
   split-with-amount path worked. The grant is restored (`confirm_bank_payment_regrant.sql`, the
   function carries the same caller guard as its siblings), the gate now matches the NAME, and a
   second gate keeps the revoke list and the call sites from disagreeing again.
2. **A suggested sum with a creditnota could never book right.** The client looped one confirm per
   invoice in list order; invoice-first closed the line on the invoice alone and counted the
   credit's "already processed" as success; credit-first refused the credit. The sum now books as
   ONE batch through `book_bank_batch` (locked, tie re-proved on the current rows, creditnota
   signed, all or nothing).
3. **A printed number booked the wrong supplier.** Supplier numbers are not unique across
   suppliers; paying B € 121 under B's "2026-014" booked A's open "2026-014". The bank's own
   counterparty now vetoes: a different account → no tier; a strange name on a payment OUT with no
   account to confirm → booked flagged, never silently. Money IN quoting OUR number stays certain.
4. **Ontkoppelen left the category standing** → the line counted as kosten AND the restored
   invoice as kosten, voorbelasting doubled. Unlinking clears the category with the link.
5. **Batch unlink skipped an invoice whose LAST payment was cash** (the `payment_method = bank`
   filter) → it stayed paid with its € 600 removed. The filter is gone, as delete-statement had
   already learned.
6. **Same party, same amount, a date apart** booked by the date bonus alone — January's late
   payment on February's invoice, February's payment then on January. A human choice now.
7. **Negeren of a partly-booked line** hid the unassigned remainder from every list. Refused; the
   line says "ontkoppel eerst".

## The owner's controls (what was missing)

- **A file with a line** (`[BIJLAGE-BIJ-REGEL]`): a receipt, a customer's remittance, the letter
  behind a storno — attached to the line, several per line, opened from the card, removed from
  the card. Never a booking: nothing on the line changes. Table `bank_tx_attachments` (owner
  reads through RLS, routes write after checks), route `/api/bank/attachment` (GET/POST/DELETE),
  the strip under every card on every tab.
- **Delete one line** (`[REGEL-WEG]`): a bank's correction line, a test payment, a duplicate an
  import produced twice. Two taps, refused while money sits on the line, identity in the audit
  trail. Route `/api/bank/delete-line`. A re-import of the same statement recreates it.
- **Open the invoice from the linked card** (`[OPEN-FACTUUR]`): the document behind a booking, one
  tap from the line that paid it.
- **The remainder of a partly-booked line** is what the matcher sees now (`[REST-MATCHT]`), so the
  € 400 invoice is suggested for the € 400 that is left.
- **"Staat nog niet in je administratie"** is no longer said of a named invoice that IS there,
  open: the refusal says so and points at Verdelen.

## What was verified and left alone

Cent-exact compares in integer cents; the batch tie re-proved under the line lock; the same
invoice twice in a batch de-duplicated; credits applied first in Verdelen; partly-paid invoices
never auto-booked; rematch never overwrites a human link; deleting a linked invoice refused;
reversals by link id with a recompute.

## Still open

- Incasso/storno signals (`type_code`, `mandate_id`) are stored and not yet read by the matcher:
  a storno credit sits in "Geen factuur" while the original incasso stays matched.
- No file-less "create an invoice from this line" — attach-invoice reads a file.

## Gates

`bank-matching.test.ts` ([NUMMER-BOTST], [TWEELING]), `bank-attachments.test.ts`, a render test
for the strip, `[BANK-KOPPELEN]`, `[BEVESTIG-DICHT]` and the hardened `[ANON-RPC]`.
