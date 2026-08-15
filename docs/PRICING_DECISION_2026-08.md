# Pricing decision — August 2026

_Written 14 August 2026. This is a decision record, not a plan: it says what was decided, on what
evidence, what it costs if it is wrong, and exactly how to undo it._

> **Read this first.** These prices have never been discussed with an administratiekantoor. They
> are derived from what comparable vendors charge, and the vendor prices they are derived from are
> themselves marked unverified in `MARKTPOSITIE_2026.md`. They are a documented guess. They are
> published as *prepared and not active*, and nothing bills anyone while that is true.

---

## 1. Why this was decided now instead of after the research

`MARKTPOSITIE_2026.md` closes three of its stop points with the same instruction: go speak to ten
offices. Stop point 2 asks whether the problem is felt, 5 whether there is money in it, 8 whether
anyone will pay € 150 a month. All three are still open, and the owner has said plainly that those
conversations are not going to happen in the near term.

That leaves two options, and only two. Leave the pricing unresolved until research that is not
scheduled produces an answer — or set a defensible default now, publish it as prepared, and make
it cheap to change. Waiting is not the safe choice it looks like, because the *previous* text was
not neutral: it committed in public to a rate "per gekoppelde klant per maand". A published
commitment is not a placeholder. It was free to remove while no office had signed; it would not
have been afterwards.

So the decision is: **choose the shape now, publish it as prepared, keep the number in one place,
and do not charge anyone until an office has been told 30 days in advance.**

## 2. What was decided

### 2.1 A band, not a per-client rate

| Linked clients | Per office per month |
|---|---|
| up to and including 10 | € 0 |
| 11 – 25 | € 49 excl. btw (€ 59,29 incl.) |
| 26 – 50 | € 89 excl. btw (€ 107,69 incl.) |
| 51 or more | € 149 excl. btw (€ 180,29 incl.) |

**Why a band.** A per-client rate makes an office's bill grow in a straight line with its own
growth, which turns every new client into a moment to reconsider the software. Inside a band, one
more client costs nothing. A band is also predictable a year out, which is what a fixed cost line
has to be in order to stop being examined every quarter.

**Why not one flat fee per office.** An office with 11 clients and one with 60 are not the same
customer. A single fee either prices the small one out or leaves the large one paying less than it
costs to serve.

**Where the numbers come from,** with the reliability marks from `MARKTPOSITIE_2026.md` §3:

| Anchor | Price | Reliability |
|---|---|---|
| Basecone (Wolters Kluwer) | ± € 7,50 per administratie | unverified, partly 2017–2021 |
| TriFact365 | € 2,50 → € 0,99 per administratie | unverified |
| A2X / Link My Books | from ± $ 25–29 per channel per month | verified, July 2026 |
| The study's own recommendation | "test € 150 per office per month" | a recommendation, not a finding |

The bands work out to € 1,96–€ 4,45 per linked client: above TriFact365's floor, well under
Basecone, with the top band landing on the € 150 the study wanted tested. That is a defensible
position between the two Dutch reference points. It is not a measurement of willingness to pay.

### 2.2 Amounts are shown excluding btw, with the inclusive amount next to them

The buyer here is a business that reclaims the btw, so the excl. amount is the one it compares
against a competitor. The rest of the product quotes inclusive prices because its reader is a
one-person business that often cannot reclaim; the accountant portal has a different reader, and
quoting only the inclusive amount made BoekBrug look 21% more expensive than it is against
competitors who quote exclusive.

### 2.3 Existing limits are now grandfathered (§5.5.1)

An account that existed on the day a limit reduction is announced keeps the limit it had. Not
lowered afterwards — not with notice, not after a transition period, not in a later revision. This
covers both the fair-use limits of §5.2 and the 10-client boundary of §5.8.

This is deliberately **not** "your price is frozen forever". Freezing price at zero customers is a
promise that becomes very expensive at five thousand users, and it is not the promise anyone
actually needs. Freezing *limits* says: you can be moved into paying by your own growth, never by
our decision to move the line. One of those the customer controls; the other they do not. That
distinction is the entire commitment.

**What this gives up:** the ability to tighten a limit later and let existing users drift into a
paid plan. That is a real revenue route, and it is closed on purpose. It was closed now because
this is the only period in which closing it costs nothing, and because a promise made before there
is a reason to want it narrower is worth more than the same words added later.

### 2.4 Nothing is activated

`ACCOUNTANT_PRICING_ACTIVE` is `false`. While it is false, `monthlyChargeExclBtw()` returns zero
for every office regardless of size, and §5.8.1 says in the published Terms that the portal is free
above the boundary too. The published table is explicitly labelled prepared-not-active, and §5.8.1
states in its own words that no office has been consulted about the amounts.

## 3. What was deliberately not decided

- **The ondernemer side.** Gratis / Plus at € 12,99 is untouched. Changing the consumer-facing
  tier is a different decision with a different reader, and folding it into this one would have
  meant two unvalidated changes hiding each other.
- **Whether the office market exists at all.** Stop point 2 is still open. Every number here is
  conditional on an answer nobody has.
- **The dagafsluiting as a separately priced product.** The market study's central recommendation
  is to sell the daily close to offices. That is a product decision before it is a pricing one,
  and pricing a feature that has not shipped would be inventing twice.

## 4. How to change or undo this

| Goal | Action |
|---|---|
| Change an amount | Edit `monthlyExclBtw` in `src/lib/accountant-pricing.ts`. The Terms regenerate on the next build; there is no second copy. |
| Change the bands | Edit `ACCOUNTANT_BANDS`. Keep it sorted; keep the last entry's `upTo: null`. |
| Postpone indefinitely | Leave `ACCOUNTANT_PRICING_ACTIVE` false. This is a complete, publishable state — not an unfinished one. |
| Undo the whole thing | `git revert` the commit that added `src/lib/accountant-pricing.ts`. It restores the previous §5.8 wording, including the per-client rate. |
| Undo only the grandfathering | `git revert` the commit that added §5.5.1. Note that this is the one change that gets *harder* to reverse over time: once users have read the promise, removing it is a takeaway even if no code depends on it. |

**Activating is not just the flag.** §5.5 and §5.8.1 promise 30 days' notice by e-mail, no
retroactive invoicing, and no automatic collection without explicit confirmation. Flipping
`ACCOUNTANT_PRICING_ACTIVE` without sending that notice breaks a published promise. The flag is
the last step, not the first.

## 5. What guards this

- `src/lib/accountant-pricing.test.ts` — band boundaries at the boundary (10 free, 11 charged, 25/26,
  50/51), the open-ended top band, negative input, btw rounding, table ordering, and that an
  inactive price charges nobody.
- `src/content/legal/pricing-commitments.test.ts` — asserts the **rendered** `/voorwaarden`: that
  the grandfathering clause still says what it says and closes all three erosion routes, that the
  price table matches the constants, that the placeholder is never shipped raw, and that the
  "we have not spoken to an office" disclosure survives.

That second file exists because this exact drift already happened here: in July 2026 the Terms
quoted € 25 and € 45 while the database CHECK constraint knew a different four-tier model, and
neither knew about the other. Two copies of one fact drift apart eventually — not through
carelessness, but because changing one of them is a complete-looking change. The table is
generated now, and the test is what proves the generated one is the one that reaches the page.

## 6. The honest summary

This is a documented guess, published as a guess, in one editable place, charging nobody, with the
promise most likely to be regretted (grandfathering) made at the only moment it is free. It is not
a validated price and this document should not be cited as if it were. The ten conversations in
stop points 2, 5 and 8 remain the thing that would replace it, and until they happen, every number
above is anchored on competitor prices that `MARKTPOSITIE_2026.md` itself marks unverified.
