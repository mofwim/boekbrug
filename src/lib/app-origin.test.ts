// [ORIGIN] Pure node test — run: npx tsx --test src/lib/app-origin.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { appOrigin, appUrl, appOriginOrFallback } from "./app-origin";

test("de expliciete keuze wint van alles", () => {
  const o = appOrigin(
    { NEXT_PUBLIC_APP_URL: "https://boekbrug.nl", NEXT_PUBLIC_SITE_URL: "https://oud.nl", VERCEL_URL: "x.vercel.app" },
    "https://verzoek.nl",
  );
  assert.equal(o, "https://boekbrug.nl");
});

test("de oude tweede naam blijft werken", () => {
  // Een bestaande omgeving die alleen SITE_URL heeft, mag niet omvallen doordat wij
  // consolideren op APP_URL.
  assert.equal(appOrigin({ NEXT_PUBLIC_SITE_URL: "https://boekbrug.nl" }), "https://boekbrug.nl");
});

test("Vercel's eigen host krijgt een schema", () => {
  // VERCEL_URL komt zonder https:// — zonder deze stap wordt het een ongeldige URL.
  assert.equal(appOrigin({ VERCEL_URL: "boekbrug-abc123.vercel.app" }), "https://boekbrug-abc123.vercel.app");
});

test("zonder instelling telt het verzoek zelf — dat klopt per definitie", () => {
  assert.equal(appOrigin({}, "https://preview-7.vercel.app"), "https://preview-7.vercel.app");
});

test("een slash aan het eind levert nooit een dubbele slash op", () => {
  assert.equal(appOrigin({ NEXT_PUBLIC_APP_URL: "https://boekbrug.nl/" }), "https://boekbrug.nl");
  assert.equal(appUrl({ NEXT_PUBLIC_APP_URL: "https://boekbrug.nl/" }, "/dashboard"), "https://boekbrug.nl/dashboard");
  assert.equal(appUrl({ NEXT_PUBLIC_APP_URL: "https://boekbrug.nl" }, "dashboard"), "https://boekbrug.nl/dashboard");
});

// ── DE BUG DIE DIT BESTAAND MAAKT ─────────────────────────────────────────────────────────────

test("er komt NOOIT het woord 'undefined' in een URL", () => {
  // src/app/api/messages/route.ts:130 deed `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/...`
  // zonder vangnet. Ontbreekt de variabele, dan mailt JavaScript de tekst
  // "undefined/dashboard/messages/..." naar een echt mens. Geen fout, geen log — alleen een
  // ontvanger die op een kapotte link klikt.
  assert.equal(appOrigin({}), null);
  assert.equal(appUrl({}, "/dashboard/messages/abc"), null, "geen origin → geen URL, niet een kapotte");

  // En de vorm die dit in de praktijk aanneemt: een lege waarde in de omgeving.
  for (const rommel of ["undefined", "null", "", "   ", "${SOMETHING}", "niet-een-url::"]) {
    assert.equal(
      appOrigin({ NEXT_PUBLIC_APP_URL: rommel }),
      null,
      `${JSON.stringify(rommel)} mag geen geldige origin zijn`,
    );
  }
});

test("een kapotte waarde valt door naar de volgende bron, niet naar de afgrond", () => {
  // Staat APP_URL leeg maar SITE_URL goed, dan hoort de app gewoon te werken.
  assert.equal(
    appOrigin({ NEXT_PUBLIC_APP_URL: "undefined", NEXT_PUBLIC_SITE_URL: "https://boekbrug.nl" }),
    "https://boekbrug.nl",
  );
  assert.equal(appOrigin({ NEXT_PUBLIC_APP_URL: "  " }, "https://verzoek.nl"), "https://verzoek.nl");
});

test("een host zonder schema wordt https, nooit http", () => {
  assert.equal(appOrigin({ NEXT_PUBLIC_APP_URL: "boekbrug.nl" }), "https://boekbrug.nl");
  // Expliciet http blijft http — lokaal ontwikkelen moet kunnen.
  assert.equal(appOrigin({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }), "http://localhost:3000");
});

test("het vangnet is er, maar het accepteert geen rommel als vangnet", () => {
  assert.equal(appOriginOrFallback({}, null, "https://boekbrug.nl"), "https://boekbrug.nl");
  assert.equal(appOriginOrFallback({ NEXT_PUBLIC_APP_URL: "https://echt.nl" }, null, "https://boekbrug.nl"), "https://echt.nl");
});
