// [SEC-INVITE] Pure node test — run: npx tsx --test src/lib/invite-guard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { newestInvitation, shouldBlockReinvite } from "./invite-guard";

test("alleen een écht openstaande uitnodiging blokkeert een herhaling", () => {
  assert.equal(shouldBlockReinvite("pending"), true);

  // Alles anders laat opnieuw uitnodigen toe. Dit is de bug die 14 dagen lang elke
  // herhaling weigerde toen de accept-status nooit werd weggeschreven.
  for (const status of ["accepted", "expired", "declined", null, undefined, "", "iets_nieuws"]) {
    assert.equal(
      shouldBlockReinvite(status),
      false,
      `${String(status)} mag een nieuwe uitnodiging niet blokkeren`,
    );
  }
});

test("de faalrichting is toestaan, niet blokkeren", () => {
  // Een uitnodiging te veel is een mailtje. Een uitnodiging die niet verstuurd kan worden
  // is een klant die nooit gekoppeld raakt — en die koppeling is het hele product.
  assert.equal(shouldBlockReinvite(undefined), false);
  assert.equal(shouldBlockReinvite("PENDING"), false, "hoofdletters zijn een andere waarde, niet 'ongeveer pending'");
});

test("de nieuwste rij wint, en een kapotte datum wint nooit", () => {
  const rows = [
    { status: "expired", created_at: "2026-01-01T00:00:00.000Z" },
    { status: "pending", created_at: "2026-07-01T00:00:00.000Z" },
    { status: "accepted", created_at: "2026-03-01T00:00:00.000Z" },
  ];
  assert.equal(newestInvitation(rows)?.status, "pending");

  // Een onleesbare tijdstempel mag de beslissing niet kapen.
  assert.equal(
    newestInvitation([
      { status: "pending", created_at: "geen datum" },
      { status: "accepted", created_at: "2026-07-01T00:00:00.000Z" },
    ])?.status,
    "accepted",
  );

  assert.equal(newestInvitation([]), null);
  assert.equal(newestInvitation([{ status: "pending" }])?.status, "pending", "geen datum overal → eerste rij");
});

test("samen genomen: na een geaccepteerde koppeling kan opnieuw worden uitgenodigd", () => {
  // De situatie die vóór de reparatie onmogelijk was: klant accepteert, koppeling wordt
  // later verbroken, boekhouder nodigt opnieuw uit.
  const rows = [
    { status: "accepted", created_at: "2026-05-01T00:00:00.000Z" },
    { status: "expired", created_at: "2026-02-01T00:00:00.000Z" },
  ];
  const newest = newestInvitation(rows);
  assert.equal(shouldBlockReinvite(newest?.status), false);
});
