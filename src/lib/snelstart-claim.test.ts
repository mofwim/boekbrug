// [SNELSTART-CLAIM] Pure node test — run: npx tsx --test src/lib/snelstart-claim.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAIMING_STATUSES,
  isClaiming,
  claimStatusAfterFailure,
  unknownOutcomeMessage,
} from "./snelstart-claim";

test("een geboekte én een onbekende factuur claimen allebei", () => {
  // Het slot moet vóór de POST dicht kunnen. 'pushed' claimt omdat het gelukt is, 'unknown'
  // omdat we niet WETEN of het gelukt is — en dat is precies wanneer opnieuw boeken gevaarlijk is.
  assert.equal(isClaiming("pushed"), true);
  assert.equal(isClaiming("unknown"), true);
  // 'failed' is bewezen niet-geboekt en mag dus gewoon opnieuw mee.
  assert.equal(isClaiming("failed"), false);
  assert.deepEqual([...CLAIMING_STATUSES].sort(), ["pushed", "unknown"]);
});

test("een geweigerde boeking geeft de claim vrij", () => {
  // Allemaal weigeringen vóór verwerking: SnelStart heeft niets geboekt, dus opnieuw proberen
  // is veilig en de factuur hoort weer in de wachtrij.
  for (const code of [
    "NOT_CONFIGURED", "INVALID_KEY", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "VALIDATION",
  ]) {
    assert.equal(claimStatusAfterFailure(code), "failed", `${code} is bewezen niet geboekt`);
  }
});

test("een mapping-fout is nooit het net op gegaan", () => {
  for (const code of [
    "MISSING_NUMBER", "MISSING_DATE", "MISSING_RELATION", "NO_AMOUNTS",
    "AMOUNT_MISMATCH", "NO_BTW_MATCH", "NOT_EXPORTABLE",
  ]) {
    assert.equal(claimStatusAfterFailure(code), "failed", `${code} wordt vóór de POST gegooid`);
  }
});

test("een netwerk- of serverfout laat de claim staan", () => {
  // HET HART VAN DEZE MODULE. De POST kán zijn aangekomen: SnelStart boekte hem en pas het
  // ANTWOORD ging verloren. De claim vrijgeven zou bij de volgende poging een TWEEDE boeking in
  // het wettelijke inkoopboek van de klant zetten.
  assert.equal(claimStatusAfterFailure("SERVER"), "unknown");
  assert.equal(claimStatusAfterFailure("NETWORK"), "unknown");
  assert.equal(claimStatusAfterFailure("UNKNOWN"), "unknown");
});

test("de faalrichting is voorzichtig: onbekend blijft claimen", () => {
  // Een foutcode die we ooit toevoegen en hier vergeten, mag nooit tot een dubbele boeking in
  // andermans grootboek leiden. Eén handmatige controle te veel is de goedkope kant.
  for (const raar of ["IETS_NIEUWS", "", "   ", null, undefined, "teapot"]) {
    assert.equal(
      claimStatusAfterFailure(raar),
      "unknown",
      `${String(raar)} moet de voorzichtige kant kiezen`,
    );
  }
});

test("hoofdletters en spaties veranderen de beslissing niet", () => {
  assert.equal(claimStatusAfterFailure("  validation  "), "failed");
  assert.equal(claimStatusAfterFailure("Server"), "unknown");
  assert.equal(claimStatusAfterFailure("network"), "unknown");
});

test("de melding bij 'unknown' beweert niet dat het mislukte, en niet dat het lukte", () => {
  const m = unknownOutcomeMessage("F-2026-014");
  assert.ok(m.includes("F-2026-014"));
  assert.ok(/mogelijk/i.test(m), "het woord dat de onzekerheid draagt");
  assert.ok(/controleer/i.test(m), "en de handeling die de onzekerheid oplost");
  assert.ok(!/mislukt/i.test(m), "'mislukt' zou een bewering zijn die we niet kunnen doen");
  // Zonder nummer blijft de zin lopen.
  assert.ok(unknownOutcomeMessage(null).startsWith("Deze factuur"));
  assert.ok(unknownOutcomeMessage("  ").startsWith("Deze factuur"));
});

test("de app boekt nooit vanzelf opnieuw na een onbekende afloop", () => {
  // Het contract in één regel: onbekend ⇒ claimt ⇒ de wachtrij slaat hem over.
  const na = claimStatusAfterFailure("NETWORK");
  assert.equal(na, "unknown");
  assert.equal(isClaiming(na), true, "een onbekende afloop MOET blijven claimen");

  // En het spiegelbeeld: bewezen mislukt ⇒ claimt niet ⇒ mag gewoon opnieuw.
  const bewezen = claimStatusAfterFailure("VALIDATION");
  assert.equal(isClaiming(bewezen), false);
});
