// [KLUIS][OAUTH-ROL] Pure node test — run: npx tsx --test src/lib/auth-landing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { planAfterOAuth, type CallbackProfile } from "./auth-landing";

// Bij Google maakt de trigger het profiel aan tijdens exchangeCodeForSession: de rij bestaat al
// als de callback kijkt, maar is kaal — een OAuth-aanmelding draagt geen signUp-metadata.
const kaal: CallbackProfile = { role: "zzper", onboarding_done: false, onboarding_step: 1 };
const halverwege: CallbackProfile = { role: "accountant", onboarding_done: false, onboarding_step: 3 };
const klaar: CallbackProfile = { role: "zzper", onboarding_done: true, onboarding_step: 6 };

const geen = { next: null, role: null, purpose: null };

test("een gewone Google-registratie gaat de wizard in", () => {
  const plan = planAfterOAuth({ ...geen, role: "zzper" }, kaal);
  assert.equal(plan.destination, "/onboarding");
  assert.equal(plan.markArchief, false);
  assert.equal(plan.roleUpdate, null); // stond al op zzper — niets te schrijven
});

test("de boekhouder uit stap 1 wordt ook echt boekhouder", () => {
  // Dit is de reparatie: de rol reisde niet mee en de callback schreef onvoorwaardelijk 'zzper'.
  const plan = planAfterOAuth({ ...geen, role: "accountant" }, kaal);
  assert.equal(plan.roleUpdate, "accountant");
  assert.equal(plan.destination, "/onboarding");
});

test("een profiel dat de rolvraag al gepasseerd is wordt niet aangeraakt", () => {
  // Halverwege de wizard (stap 3) en na afronding: de keuze is daar gemaakt, niet in een URL.
  assert.equal(planAfterOAuth({ ...geen, role: "zzper" }, halverwege).roleUpdate, null);
  assert.equal(planAfterOAuth({ ...geen, role: "accountant" }, klaar).roleUpdate, null);
});

test("een onbekende rol schrijft niets", () => {
  for (const rol of ["admin", "client", "", "ZZPER"]) {
    assert.equal(planAfterOAuth({ ...geen, role: rol }, kaal).roleUpdate, null, rol);
  }
});

test("het archiefpad landt in de kluis en niet in de wizard", () => {
  // De fout die dit bestand bestaat om te vangen: `next` wees al naar de kluis, maar de regel
  // "stuur elke nieuwe gebruiker naar /onboarding" stond ervóór en won altijd.
  const plan = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief" },
    kaal,
  );
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief");
  assert.equal(plan.markArchief, true);
});

test("het archiefpad werkt ook zonder meegegeven bestemming", () => {
  const plan = planAfterOAuth({ ...geen, purpose: "archief" }, kaal);
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief");
  assert.equal(plan.markArchief, true);
});

test("draaide de trigger niet, dan maken wij het archiefprofiel zelf — zonder wizard", () => {
  const plan = planAfterOAuth({ ...geen, role: "zzper", purpose: "archief" }, null);
  assert.deepEqual(plan.profileToCreate, {
    role: "zzper",
    onboarding_done: true, // geen wizard over facturen voor wie zijn zaak komt wegzetten
    onboarding_step: 1,
  });
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief");
  assert.equal(plan.markArchief, true);
});

test("zonder profiel en zonder archiefdoel: gewoon de wizard", () => {
  const plan = planAfterOAuth({ ...geen, role: "accountant" }, null);
  assert.deepEqual(plan.profileToCreate, {
    role: "accountant",
    onboarding_done: false,
    onboarding_step: 1,
  });
  assert.equal(plan.destination, "/onboarding");
});

test("een meegegeven bestemming gaat vóór de standaardlanding van het archiefpad", () => {
  // Wie via een uitnodiging binnenkomt hoort bij die uitnodiging uit te komen, ook als hij
  // tegelijk een archiefaccount aanmaakt.
  const plan = planAfterOAuth(
    { next: "/invite/accept?token=abc", role: "zzper", purpose: "archief" },
    kaal,
  );
  assert.equal(plan.destination, "/invite/accept?token=abc");
  assert.equal(plan.markArchief, true);
});

test("een bestaand, afgerond account wordt hier nooit omgezet naar archief", () => {
  // Dat blijft aan het zelfherstel op /dashboard/kluis: zichtbaar, op de pagina die de gebruiker
  // zelf opvroeg, en niet als bijwerking van een aanmelding.
  const plan = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: null, purpose: "archief" },
    klaar,
  );
  assert.equal(plan.markArchief, false);
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief"); // de kluis herstelt het daar
});

test("een gewone login komt uit waar hij altijd uitkwam", () => {
  assert.equal(planAfterOAuth(geen, klaar).destination, "/dashboard");
  assert.equal(planAfterOAuth({ ...geen, next: "/dashboard/facturen" }, klaar).destination, "/dashboard/facturen");
  assert.equal(planAfterOAuth(geen, kaal).destination, "/onboarding");
  assert.equal(planAfterOAuth(geen, halverwege).destination, "/onboarding");
});

test("[SEC-REDIRECT] een vreemde bestemming haalt het nooit — ook niet via het archiefpad", () => {
  for (const kwaad of ["https://evil.nl", "//evil.nl", "javascript:alert(1)", "/\\evil.nl"]) {
    assert.equal(planAfterOAuth({ ...geen, next: kwaad }, klaar).destination, "/dashboard", kwaad);
    assert.equal(
      planAfterOAuth({ ...geen, next: kwaad, purpose: "archief" }, kaal).destination,
      "/dashboard/kluis?doel=archief",
      kwaad,
    );
  }
});

// ── [UITNODIGING] De uitnodigingslink wint van de wizard ────────────────────────────────────────
//
// Tweede keer dezelfde les als het archiefpad in de kop van auth-landing.ts: `next` wees goed,
// de onboarding-regel stond ervóór en won. Hier was de schade groter — de genodigde klant van
// een kantoor registreerde, bevestigde zijn mail, en het token verdween: uitnodiging bleef stil
// 'pending'. Het hoofdpad van het distributiekanaal faalde precies bij nieuwe gebruikers, en
// elke genodigde is er een.

test("[UITNODIGING] een vers account met een uitnodigingsbestemming gaat EERST accepteren", () => {
  const next = "/invite/accept?token=abc-123";
  // Nog geen profiel (e-mailbevestiging maakte het net aan): de uitnodiging gaat voor.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null }, null).destination, next);
  // Kaal profiel (trigger was sneller): zelfde antwoord.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null }, kaal).destination, next);
  // Halverwege de wizard: de uitnodiging gaat nog steeds voor — de acceptatiepagina stuurt na de
  // tik zelf naar /dashboard, waar de middleware hem de wizard weer in leidt. Niets slaat over.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null }, halverwege).destination, next);
});

test("[UITNODIGING] alleen een ECHTE uitnodigingsbestemming wint — niet een gewone next", () => {
  // De regel is smal met opzet: elke andere bestemming blijft achter de wizard staan, precies
  // zoals altijd. Anders wordt "next wint" de nieuwe standaard en is de wizard optioneel
  // geworden als bijwerking.
  assert.equal(
    planAfterOAuth({ next: "/dashboard/facturen", role: null, purpose: null }, kaal).destination,
    "/onboarding",
  );
  // [SEC-REDIRECT] Een vreemde origin blijft geweigerd; de terugval is /dashboard en een vers
  // account gaat dan gewoon de wizard in.
  assert.equal(
    planAfterOAuth({ next: "https://evil.example/invite/accept?token=x", role: null, purpose: null }, kaal).destination,
    "/onboarding",
  );
});
