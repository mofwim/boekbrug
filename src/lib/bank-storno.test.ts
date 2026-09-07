// [STORNO] Run: npx tsx --test src/lib/bank-storno.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findStornoOrigin, isStornoLine, type OriginLine, type StornoLine } from "./bank-storno";

const storno: StornoLine = {
  id: "s", amount: 89, date: "2026-09-05", counterpartIban: "NL91ABNA0417164300", counterpartName: "KPN B.V.",
  description: "SEPA Incasso storno KPN", typeCode: null,
};
const origin: OriginLine = { id: "o", amount: -89, date: "2026-09-01", counterpartIban: "NL91ABNA0417164300", counterpartName: "KPN B.V.", status: "matched", invoiceId: "inv-1" };

test("[STORNO] money IN with a direct-debit marker is a storno; money OUT never is", () => {
  assert.equal(isStornoLine(storno), true);
  assert.equal(isStornoLine({ ...storno, amount: -89 }), false, "a collection is not a reversal");
  assert.equal(isStornoLine({ ...storno, description: "Overboeking", typeCode: null }), false, "no marker, no storno");
  assert.equal(isStornoLine({ ...storno, description: "Betaling", typeCode: "NDDT" }), true, "the bank's own code counts");
});

test("[STORNO] the origin is the one matched debit of the same amount and party, at most 45 days earlier", () => {
  assert.equal(findStornoOrigin(storno, [origin])?.id, "o");
  assert.equal(findStornoOrigin(storno, [{ ...origin, amount: -89.01 }]), null, "a cent off is another payment");
  assert.equal(findStornoOrigin(storno, [{ ...origin, status: "pending" }]), null, "an unmatched debit paid nothing to undo");
  assert.equal(findStornoOrigin(storno, [{ ...origin, invoiceId: null }]), null);
  assert.equal(findStornoOrigin(storno, [{ ...origin, date: "2026-09-06" }]), null, "an origin after the storno is not its origin");
  assert.equal(findStornoOrigin(storno, [{ ...origin, date: "2026-07-01" }]), null, "too long ago");
  assert.equal(findStornoOrigin(storno, [{ ...origin, counterpartIban: "NL02RABO0123456789" }]), null, "another account is another party");
  assert.equal(findStornoOrigin({ ...storno, counterpartIban: null }, [{ ...origin, counterpartIban: null }])?.id, "o", "no accounts on either side: the name decides");
  assert.equal(findStornoOrigin({ ...storno, counterpartIban: null, counterpartName: "Jansen BV" }, [{ ...origin, counterpartIban: null, counterpartName: "Jansen Holding" }]), null, "a shared surname is not an identity");
});

test("[STORNO] two possible origins is a question, never a guess", () => {
  const twin: OriginLine = { ...origin, id: "o2", date: "2026-08-25" };
  assert.equal(findStornoOrigin(storno, [origin, twin]), null);
  assert.equal(findStornoOrigin(storno, [origin, { ...twin, amount: -90 }])?.id, "o", "a different amount is not a rival");
});
