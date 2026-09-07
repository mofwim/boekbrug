// [IB-JAAR] Pure node test — run: npx tsx --test src/lib/ib-jaar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIbJaarOverzicht, URENCRITERIUM_HOURS } from "./ib-jaar";

const base = { year: 2026, omzet: 85000.5, kosten: 32000.25, resultaat: 53000.25, cashOmzetZonderBtw: 0, hoursTotal: 1400 };

test("[IB-JAAR] the W&V is the engine's numbers, arranged — never recomputed", () => {
  const o = buildIbJaarOverzicht(base);
  assert.equal(o.wv.opbrengsten, 85000.5);
  assert.equal(o.wv.kosten, 32000.25);
  assert.equal(o.wv.saldo, 53000.25);
});

test("[IB-JAAR] the urencriterium speaks from the registration, in both directions", () => {
  const met = buildIbJaarOverzicht(base);
  assert.equal(met.uren.met, true);
  assert.match(met.uren.sentence, /gehaald/);

  const short = buildIbJaarOverzicht({ ...base, hoursTotal: 1100 });
  assert.equal(short.uren.met, false);
  assert.match(short.uren.sentence, /nog 125 uur onder/);
  assert.match(short.uren.sentence, /Alleen geregistreerde uren tellen/, "the limit of the claim is stated");
  assert.equal(URENCRITERIUM_HOURS, 1225);
});

test("[IB-JAAR] a failed hours read is 'could not look', never 'not met'", () => {
  const o = buildIbJaarOverzicht({ ...base, hoursTotal: null });
  assert.equal(o.uren.met, null);
  assert.match(o.uren.sentence, /niet beoordeeld/);
});

test("[IB-JAAR] what is not tracked is named, and unrated omzet gets its caveat", () => {
  const o = buildIbJaarOverzicht({ ...base, cashOmzetZonderBtw: 4200 });
  assert.ok(o.nietBijgehouden.some((r) => /afschrijvingen/.test(r)));
  assert.ok(o.nietBijgehouden.some((r) => /voorraad/.test(r)));
  assert.ok(o.kanttekeningen.some((k) => /4\.200,00/.test(k) && /telt hij gewoon mee/.test(k)));
  assert.equal(buildIbJaarOverzicht(base).kanttekeningen.length, 0, "no caveat invented when there is nothing to say");
});

test("[BEDRIJFSMIDDEL] the year names the investment, the depreciation and the boekwaarde, and says when it could not read them", () => {
  const withRegister = buildIbJaarOverzicht({ ...base, investeringen: 3000, afschrijvingen: 625, boekwaardeEinde: 2375, assetCount: 1 });
  assert.equal(withRegister.wv.afschrijvingen, 625);
  assert.equal(withRegister.bedrijfsmiddelen.investeringen, 3000);
  assert.equal(withRegister.bedrijfsmiddelen.boekwaardeEinde, 2375);
  assert.equal(withRegister.bedrijfsmiddelen.aantal, 1);
  assert.ok(!withRegister.nietBijgehouden.some((r) => /volledige kost/.test(r)), "with a register the old apology is gone");
  assert.ok(withRegister.nietBijgehouden.some((r) => /boekwinst/.test(r)), "…and what is still a boekhouder's call is named");

  const empty = buildIbJaarOverzicht(base);
  assert.equal(empty.wv.afschrijvingen, 0);
  assert.equal(empty.bedrijfsmiddelen.aantal, 0);
  assert.ok(empty.nietBijgehouden.some((r) => /€ 450/.test(r) && /register/i.test(r)), "an empty register points at itself");

  const broken = buildIbJaarOverzicht({ ...base, assetsUnreadable: true, boekwaardeEinde: 999 });
  assert.equal(broken.bedrijfsmiddelen.unreadable, true);
  assert.equal(broken.bedrijfsmiddelen.boekwaardeEinde, null, "never a number over a failed read");
  assert.ok(broken.kanttekeningen.some((k) => /register van bedrijfsmiddelen kon nu niet gelezen/.test(k)));
});
