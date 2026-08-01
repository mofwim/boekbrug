// [NAMENS] Pure node test — run: npx tsx --test src/lib/created-by.test.ts
//
// DE FOUT DIE DEZE TEST BEWAAKT
// `as any` zwijgt de typecontrole, niet de database. Op een installatie zonder de migratie
// antwoordde PostgREST met PGRST204 op elke INSERT die created_by meestuurde — en dat is de
// insert waarmee een factuur ONTSTAAT. tsc schoon, tests groen, build compleet, en toch kon
// niemand meer een factuur maken.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isKolomOnbekend, schrijfMetSpoor, leesMetSpoor, KOLOM_ONBEKEND } from "./created-by";

test("de twee foutcodes van 'die kolom ken ik niet' worden herkend", () => {
  assert.deepEqual([...KOLOM_ONBEKEND], ["PGRST204", "42703"]);
  assert.equal(isKolomOnbekend({ code: "PGRST204" }), true, "PostgREST: schema cache");
  assert.equal(isKolomOnbekend({ code: "42703" }), true, "Postgres: undefined_column");
});

test("een ANDERE fout wordt NIET als ontbrekende kolom gelezen", () => {
  // Dit is de gevaarlijke kant. Zou een schending van een unieke index (23505) of een
  // RLS-weigering (42501) hier als "kolom ontbreekt" tellen, dan werd de rij daarna zonder spoor
  // opnieuw weggeschreven — en dan omzeilt een tweede poging stilletjes de fout die het eerste
  // verzoek juist tegenhield.
  for (const code of ["23505", "42501", "23514", "23503", "PGRST116", "P0001"]) {
    assert.equal(isKolomOnbekend({ code }), false, `${code} is geen ontbrekende kolom`);
  }
  assert.equal(isKolomOnbekend(null), false);
  assert.equal(isKolomOnbekend(undefined), false);
  assert.equal(isKolomOnbekend("kapot"), false);
  assert.equal(isKolomOnbekend({}), false);
});

test("zonder foutcode telt alleen een boodschap die de kolom ÉN 'column' noemt", () => {
  assert.equal(isKolomOnbekend({ message: "Could not find the 'created_by' column of 'invoices'" }), true);
  assert.equal(isKolomOnbekend({ message: "created_by mag niet leeg zijn" }), false, "geen 'column'");
  assert.equal(isKolomOnbekend({ message: "column foo does not exist" }), false, "andere kolom");
});

// ── schrijven ─────────────────────────────────────────────────────────────────────────────────

test("normaal geval: één poging, mét spoor", async () => {
  const pogingen: Array<Record<string, unknown>> = [];
  const uit = await schrijfMetSpoor(
    async (extra) => { pogingen.push(extra); return { data: { id: "1" }, error: null }; },
    { created_by: "mens-1" },
  );
  assert.equal(pogingen.length, 1, "geen tweede poging als de eerste slaagt");
  assert.deepEqual(pogingen[0], { created_by: "mens-1" });
  assert.equal(uit.spoorGezet, true);
  assert.deepEqual(uit.data, { id: "1" });
});

test("kolom bestaat nog niet: tweede poging ZONDER spoor, en het werk gaat door", async () => {
  // Dit is het hele punt. Zonder deze terugval kon er op een installatie met een openstaande
  // migratie GEEN FACTUUR MEER WORDEN AANGEMAAKT.
  const pogingen: Array<Record<string, unknown>> = [];
  const uit = await schrijfMetSpoor(
    async (extra) => {
      pogingen.push(extra);
      if (Object.keys(extra).length > 0) return { data: null, error: { code: "PGRST204" } };
      return { data: { id: "1" }, error: null };
    },
    { created_by: "mens-1" },
  );
  assert.equal(pogingen.length, 2);
  assert.deepEqual(pogingen[1], {}, "de tweede poging stuurt het spoor niet mee");
  assert.equal(uit.spoorGezet, false, "en zegt eerlijk dat het spoor ontbreekt");
  assert.deepEqual(uit.data, { id: "1" }, "het werk is wél gedaan");
  assert.equal(uit.error, null);
});

test("een ECHTE fout wordt niet weggepoetst met een tweede poging", async () => {
  // Zou een duplicaat (23505) hier een retry zonder spoor uitlokken, dan werd de bescherming
  // waar die index voor bestaat stilletjes overgeslagen.
  let n = 0;
  const uit = await schrijfMetSpoor(
    async () => { n++; return { data: null, error: { code: "23505", message: "duplicate key" } }; },
    { created_by: "mens-1" },
  );
  assert.equal(n, 1, "geen tweede poging");
  assert.equal(uit.error.code, "23505", "de fout komt onveranderd terug");
  assert.equal(uit.spoorGezet, true, "er is niets weggelaten");
});

test("faalt de tweede poging ook, dan komt díe fout terug — niet een verzonnen succes", async () => {
  const uit = await schrijfMetSpoor(
    async (extra) =>
      Object.keys(extra).length > 0
        ? { data: null, error: { code: "42703" } }
        : { data: null, error: { code: "42501", message: "RLS" } },
    { created_by: "mens-1" },
  );
  assert.equal(uit.data, null);
  assert.equal(uit.error.code, "42501");
  assert.equal(uit.spoorGezet, false);
});

// ── lezen ─────────────────────────────────────────────────────────────────────────────────────

test("lezen valt terug op de kolommenlijst zonder het spoor", async () => {
  const gevraagd: string[] = [];
  const uit = await leesMetSpoor(
    async (kolommen) => {
      gevraagd.push(kolommen);
      if (kolommen.includes("created_by")) return { data: null, error: { code: "42703" } };
      return { data: { id: "1", status: "draft" }, error: null };
    },
    "id, status, created_by",
    "id, status",
  );
  assert.deepEqual(gevraagd, ["id, status, created_by", "id, status"]);
  assert.equal(uit.spoorGezet, false);
  assert.deepEqual(uit.data, { id: "1", status: "draft" });
});

test("en leest gewoon in één keer zodra de kolom er is", async () => {
  let n = 0;
  const uit = await leesMetSpoor(
    async () => { n++; return { data: { id: "1", created_by: "mens-1" }, error: null }; },
    "id, created_by",
    "id",
  );
  assert.equal(n, 1);
  assert.equal(uit.spoorGezet, true);
});

test("een rij zonder created_by wordt nooit aan een medewerker toegerekend", async () => {
  // Sluit de cirkel met acting-for.ts: valt het lezen terug op de lijst zónder het spoor, dan is
  // created_by undefined — en magFactuur() geeft een medewerker daar geen toegang op. De eigenaar
  // wél, want die toetst alleen op sender_id. Dat is precies de bedoelde faalrichting.
  const { magFactuur, resolveActingFor } = await import("./acting-for");
  const BAAS = "b", LID = "l";
  const lid = resolveActingFor(LID, { owner_id: BAAS, member_id: LID, role: "verkoop", revoked_at: null }, 0);
  const baas = resolveActingFor(BAAS, null, 0);
  assert.equal(magFactuur(lid, { sender_id: BAAS }), false);
  assert.equal(magFactuur(baas, { sender_id: BAAS }), true);
});
