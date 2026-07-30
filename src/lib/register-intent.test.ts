// [OAUTH-ROL] Pure node test — run: npx tsx --test src/lib/register-intent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { ROLE_PARAM, parseRole } from "./register-intent";

test("de twee rollen die iemand bij registratie van zichzelf kan zeggen", () => {
  assert.equal(parseRole("zzper"), "zzper");
  assert.equal(parseRole("accountant"), "accountant");
  assert.equal(ROLE_PARAM, "rol");
});

test("alles wat geen bekende rol is levert null — niet stilzwijgend 'zzper'", () => {
  // Het verschil is geen muggenzifterij: de callback krijgt een BESTAAND profiel voor zich, en
  // "er is niets gekozen" hoort daar met rust gelaten te worden. Een stille terugval op 'zzper'
  // zou een boekhouder die al ingericht is kunnen terugzetten.
  for (const raw of [null, undefined, "", "Zzper", "ZZPER", "boekhouder", "admin", "1", "true"]) {
    assert.equal(parseRole(raw), null, `${String(raw)} mag geen rol worden`);
  }
});

test("'client' is geen rol die iemand zichzelf bij de voordeur geeft", () => {
  // 'client' staat wél in de CHECK op profiles.role — het is de rol van iemand die door een
  // boekhouder is aangemaakt, niet iets wat je bij registratie over jezelf verklaart.
  assert.equal(parseRole("client"), null);
});
