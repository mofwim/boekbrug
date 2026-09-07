// [REGEL-FACTUUR] Run: npx tsx --test src/lib/line-invoice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLineInvoice } from "./line-invoice";

const out = { amount: -121, date: "2026-09-03", counterpartName: "Sligro", rate: 21 as const, hasDocumentElsewhere: false };

test("[REGEL-FACTUUR] a purchase without a document carries NO btw — art. 15 Wet OB — and says so", () => {
  const v = buildLineInvoice(out);
  assert.ok(v.ok);
  assert.equal(v.draft.direction, "incoming");
  assert.equal(v.draft.totalIncBtw, 121);
  assert.equal(v.draft.btwAmount, 0, "no invoice, no voorbelasting");
  assert.equal(v.draft.totalExBtw, 121, "the whole amount is the cost for the income tax");
  assert.equal(v.draft.rateApplied, 0);
  assert.equal(v.draft.btwWithheldNoDocument, true, "…and the row says the rate was withheld, not that the supplier charges 0%");
  assert.equal(v.draft.documentMissing, false);
});

test("[REGEL-FACTUUR] with the document declared elsewhere the rate applies, and the row is flagged until it is attached", () => {
  const v = buildLineInvoice({ ...out, hasDocumentElsewhere: true });
  assert.ok(v.ok);
  assert.equal(v.draft.btwAmount, 21);
  assert.equal(v.draft.totalExBtw, 100);
  assert.equal(v.draft.btwWithheldNoDocument, false);
  assert.equal(v.draft.documentMissing, true);
  const nine = buildLineInvoice({ ...out, amount: -109, rate: 9, hasDocumentElsewhere: true });
  assert.ok(nine.ok && nine.draft.btwAmount === 9 && nine.draft.totalExBtw === 100);
});

test("[REGEL-FACTUUR] a sale owes btw whether or not an invoice was issued", () => {
  const v = buildLineInvoice({ ...out, amount: 242, counterpartName: "J. de Vries", hasDocumentElsewhere: false });
  assert.ok(v.ok);
  assert.equal(v.draft.direction, "outgoing");
  assert.equal(v.draft.btwAmount, 42);
  assert.equal(v.draft.totalExBtw, 200);
  assert.equal(v.draft.btwWithheldNoDocument, false, "the withholding rule is a purchase rule");
  assert.equal(v.draft.documentMissing, false);
});

test("[REGEL-FACTUUR] a 0% purchase without a document is not 'withheld' — nothing was asked", () => {
  const v = buildLineInvoice({ ...out, rate: 0 });
  assert.ok(v.ok && v.draft.btwWithheldNoDocument === false && v.draft.btwAmount === 0);
});

test("[REGEL-FACTUUR] refusals: no amount, no date, an impossible rate, no party", () => {
  assert.equal((buildLineInvoice({ ...out, amount: 0 }) as { code: string }).code, "zero_amount");
  assert.equal((buildLineInvoice({ ...out, date: "3-9-2026" }) as { code: string }).code, "bad_date");
  assert.equal((buildLineInvoice({ ...out, rate: 19 as never }) as { code: string }).code, "bad_rate");
  assert.equal((buildLineInvoice({ ...out, counterpartName: "  " }) as { code: string }).code, "no_name");
});

test("[REGEL-FACTUUR] cents: the split is exact and adds up", () => {
  const v = buildLineInvoice({ ...out, amount: -33.33, hasDocumentElsewhere: true });
  assert.ok(v.ok);
  assert.equal(Math.round((v.draft.totalExBtw + v.draft.btwAmount) * 100), 3333);
});
