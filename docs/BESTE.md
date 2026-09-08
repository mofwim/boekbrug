# BESTE — the app, page by page, against the best of the market

**The instruction.** Go through the app page by page, look at how each page handles what is on it,
look online at how the big packages handle the same data, and copy their best into BoekBrug —
without diluting BoekBrug. The goal is not parity; it is an app that gives its customers the best
it has, correctly.

**The method.** Three review passes, one per cluster (sales; purchases and bank; period, tax and
accountant), each against Moneybird, e-Boekhouden, Tellow, Jortt, SnelStart, Exact Online and the
international references (Xero, QuickBooks, FreshBooks) where they set the bar. Every claim a
review made about THIS codebase was checked in the code before anything was built — a review that
says "the client card has no edit action" is a hypothesis until `grep` agrees. The claims that did
not survive were dropped, not fixed.

**The spirit that must survive the copying** (docs/ZIEL.md, docs/RUSTIG.md, AGENTS.md): BoekBrug
does the work and the owner keeps the say; a screen says what it is and offers what to do; a
number beats a sentence; nothing books itself until the owner says so; a check that could not run
says so, never a comforting zero; the invoice, its e-mail, the e-factuur and the legal texts are
never translated. A feature is copied only when it fits inside those, and shaped to fit when the
original does not.

## Batch 1a — shipped

| Copied | From | Where it landed |
|---|---|---|
| The customer card opens each invoice; a late invoice is chipped late on the card; the card offers its own edit | every package | `klanten/[id]` |
| A customer with invoices or work on it cannot be deleted; the refusal names the counts | every package | `DELETE /api/clients` |
| "Nog een keer" on a sent sales invoice → a new concept for editing | Moneybird "Kopieer", e-Boekhouden "Kopiëren" | sales list |
| Openstaand and Te laat above the sales list, counted server-side over every invoice | Moneybird, Tellow, Xero | sales list header |
| Share the pay link as a WhatsApp message | Mollie request page, Tellow, Moneybird | betaalverzoek modal |
| The supplier's name opens that supplier's invoices | every package | Leveranciers → Crediteuren `?zoek=` |
| Three selectable years on the IB overview | every package | `/dashboard/jaar` |

Bugs found by the review and fixed in the same batch: the client card linked every row to the list;
the chip trusted a cron-moved status column; four Dutch strings had escaped the catalogue; the CSV
button said "Facturen".

## Batch 1b — next

- A pre-filing checklist on the aangifte screen from `/api/readiness` (what is still missing for
  this quarter, each item with the screen that fixes it). Moneybird and e-Boekhouden gate the
  filing on it; BoekBrug shows it above the figures and never blocks — the owner keeps the say.
- Crediteuren: verlopen / deze week / later with the sums, above the list (Moneybird "Te betalen").
- "Bekeken door de klant op …" on an invoice and an offerte, written the first time the customer
  opens the pay or offerte page (Moneybird, FreshBooks, Xero). A new column, `first_viewed_at`.
- The home screen's bank line gets two companions: free after the btw reserve, and the balance in
  thirty days — both from engines the app already runs on Vandaag.

## Batch 2 — medium

Cost kind on a purchase invoice defaulted from the supplier (unblocks the margin breakdown); per-
customer payment term and phone; open balance on the customer list; tips and drawer count on the
day closing; a period lock with the accountant's quarter verdict; privé/zakelijk split on a bank
line; attachments in the new-invoice editor; a payment timeline on the invoice; a deposit invoice
from an accepted offerte; a timer and week view on hours; asset disposal with a sale price; an
inbound e-mail address for receipts (needs the owner's DNS and Resend configuration).

## Deliberately not copied

- **A period lock on asset deletion.** The only lock the app has is the btw filing; depreciation is
  an income-tax matter and a wrongly registered asset must stay deletable until a real period lock
  exists (batch 2).
- **Bounding the debit read on Leveranciers.** The coverage window the corroboration reports comes
  from that same read; bounding it would let the screen invent shortfalls.
- **Automatic reminders that escalate to incasso.** BoekBrug reminds, three times by hand at most,
  with a cool-down and a bank check before each one (sales-overview.ts). Nobody is chased by a
  machine on this product.
- **Tax computed and "filed" in-app.** The aangifte screen is a concept the owner hands in on Mijn
  Belastingdienst Zakelijk; the app does not pretend to file.
- **Translating the documents.** Never — see AGENTS.md.
