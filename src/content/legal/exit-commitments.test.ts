// src/content/legal/exit-commitments.test.ts
// [EXIT-CLAUSE] What the Terms promise if BoekBrug itself closes down.
//
// Why a test guards prose. These clauses exist to answer one question an administratiekantoor asks
// before it puts 25 clients' administraties in a one-person supplier: "and if you disappear?" They
// were written at zero customers, which is the only moment they are free to write — and that is
// exactly what makes them easy to lose later. A future rewrite of §5, §7 or §10 that drops or
// narrows them produces no error, no failing build, and no visible change until the day it matters,
// by which time the promise cannot be made any more.
//
// The single most important assertion here is the SCOPE one. The clause used to promise 90 days'
// notice and an automatic archive to "iedere Bewaarkluis-klant" — i.e. to nobody, since the
// Bewaarkluis is a paid add-on nobody had. That is the regression to make loud: a shutdown promise
// that quietly applies to paying customers only.
//
// Asserts the RENDERED document, like company.test.ts, so it covers what /voorwaarden actually says.
import test from "node:test";
import assert from "node:assert/strict";
import voorwaarden from "./algemene-voorwaarden";

test("the shutdown clause is not scoped to paying customers", () => {
  assert.ok(
    voorwaarden.includes("### 10.4 Als BoekBrug zelf stopt"),
    "§10.4 — the end of the SERVICE, distinct from §10.1/§10.2 which end an ACCOUNT",
  );
  assert.ok(
    voorwaarden.includes("Het geldt voor **iedere gebruiker**"),
    "§10.4 must say in its own words that it covers every user",
  );
  // The exact phrasing that made the old promise empty. If it returns, the archive commitment has
  // been narrowed back to Bewaarkluis customers.
  assert.ok(
    !voorwaarden.includes("iedere Bewaarkluis-klant"),
    "the archive-on-shutdown promise must never be scoped to Bewaarkluis customers again",
  );
});

test("the shutdown clause keeps its four load-bearing promises", () => {
  // Notice period — the number an office plans its migration around.
  assert.ok(voorwaarden.includes("minstens 90 dagen vooraf per e-mail aan"));
  // Delivery is pushed, not pulled: whoever never opens the mail is whoever needs the file in 2032.
  assert.ok(voorwaarden.includes("Je krijgt je archief; je hoeft er niet om te vragen."));
  // Nothing is erased during a wind-down.
  assert.ok(voorwaarden.includes("Wij verwijderen in die periode niets."));
  // The tax calendar, which is what makes the difference between a survivable and an unsurvivable
  // closing date for a bookkeeping product.
  assert.ok(voorwaarden.includes("januari, april, juli of oktober"));
});

test("the no-refund rules are carved out when WE are the ones leaving", () => {
  // §5.4 and the last line of §10.3 both say "no refund of paid periods". Both are written for a
  // user who leaves; applying them to a user we leave is the thing this carve-out forbids.
  assert.ok(
    voorwaarden.includes("**§5.4 en de laatste regel van §10.3 (geen restitutie) gelden hier uitdrukkelijk niet**"),
    "the carve-out must name both clauses it overrides, or it will not be found when it is needed",
  );
});

test("the accountant has an exit of their own", () => {
  assert.ok(voorwaarden.includes("### 7.5 Als BoekBrug stopt terwijl er klanten aan je gekoppeld zijn"));
  // Told first, and separately — an office learning this in the same mail as its own clients is
  // the failure this bullet exists to prevent.
  assert.ok(voorwaarden.includes("minstens **14 dagen vóór** de algemene aankondiging"));
  // The whole point: 25 clients must not mean chasing 25 people to press a button each.
  assert.ok(voorwaarden.includes("Je ontvangt per gekoppelde klant een archief."));
  // …and the limit that keeps it lawful: a closure is not a reason to widen access.
  assert.ok(voorwaarden.includes("Nooit meer dan je al zag."));
});

test("every section the exit clauses point at actually exists", () => {
  // These clauses lean on each other by number, and a renumbering elsewhere in the Terms turns a
  // cross-reference into a dead end without breaking anything visible.
  for (const heading of [
    "### 7.2 Wat de accountant ziet",
    "### 10.3 Gevolgen van beëindiging",
    "**5.7.2 Wat wij uitdrukkelijk NIET leveren.**",
    "### 5.4 Opzeggen",
  ]) {
    assert.ok(voorwaarden.includes(heading), `cross-referenced section missing: ${heading}`);
  }
  // §5.7.6 must hand off to §10.4 rather than carry its own, narrower version of the promise.
  assert.ok(voorwaarden.includes("Wat er dan gebeurt staat in **§10.4**"));
});
