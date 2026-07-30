// [CRON-HARTSLAG] Pure node test — run: npx tsx --test src/lib/cron-heartbeat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { judgeCron, cronsNeedingAttention, cronHealthNote, CRON_JOBS } from "./cron-heartbeat";

const NU = Date.parse("2026-07-30T12:00:00.000Z");
const gelede = (uur: number) => new Date(NU - uur * 3_600_000).toISOString();
const run = (uur: number, ok: boolean | null = true) => ({ job: "x", started_at: gelede(uur), ok });

test("de zes crons uit vercel.json staan erin, met hun ritme", () => {
  assert.deepEqual(Object.keys(CRON_JOBS).sort(), [
    "email-sync", "quarter-close", "reconcile", "recurring", "reminders", "retention-purge",
  ]);
  assert.equal(CRON_JOBS["reconcile"], 1);
  assert.equal(CRON_JOBS["email-sync"], 2);
});

test("een verse geslaagde run is gewoon goed", () => {
  assert.equal(judgeCron("reconcile", run(0.5), NU), "ok");
  assert.equal(judgeCron("email-sync", run(1), NU), "ok");
  assert.equal(judgeCron("reminders", run(20), NU), "ok");
});

test("nooit gedraaid is een ANDERE storing dan gefaald", () => {
  // Dit is de storing die livegang stuk maakt: de bedrading klopt niet. Een ontbrekende
  // CRON_SECRET geeft 401 op élke cron, en op Hobby laat een te frequente cron de deploy falen.
  assert.equal(judgeCron("reconcile", null, NU), "nooit-gedraaid");
  assert.equal(judgeCron("reconcile", { job: "reconcile", started_at: null, ok: null }, NU), "nooit-gedraaid");
});

test("halverwege gestorven is óók een andere storing dan gefaald", () => {
  // ok = null betekent: begonnen, nooit afgerond. Time-out of crash. Wat hij tot dat punt deed
  // staat wél in de database — dat vraagt om iets anders dan een run die zelf 'mislukt' meldde.
  assert.equal(judgeCron("reconcile", run(0.2, null), NU), "afgebroken");
  assert.equal(judgeCron("reconcile", run(0.2, false), NU), "gefaald");
});

test("twee gemiste slagen is een patroon, één is ruis", () => {
  // Vercel spreidt aanroepen binnen het uur, dus één gemiste slag zegt niets.
  assert.equal(judgeCron("reconcile", run(1.9), NU), "ok", "1,9 uur bij een uurcron: nog binnen de marge");
  assert.equal(judgeCron("reconcile", run(2.1), NU), "te-lang-stil");
  assert.equal(judgeCron("email-sync", run(3.9), NU), "ok");
  assert.equal(judgeCron("email-sync", run(4.1), NU), "te-lang-stil");
});

test("quarter-close slaat geen alarm omdat hij vier keer per jaar draait", () => {
  // Zonder deze marge zou hij permanent rood staan en daarmee waardeloos worden — een alarm dat
  // altijd afgaat, leert mensen alarmen te negeren.
  assert.equal(judgeCron("quarter-close", run(24 * 60), NU), "ok", "twee maanden stil is normaal");
  assert.equal(judgeCron("quarter-close", run(24 * 200), NU), "te-lang-stil", "ruim een half jaar niet");
});

test("een onleesbare tijdstempel wordt niet stilzwijgend goedgekeurd", () => {
  assert.equal(judgeCron("reconcile", { job: "reconcile", started_at: "geen datum", ok: true }, NU), "afgebroken");
});

test("de lijst met aandacht bevat alleen wat niet in orde is", () => {
  const alles = cronsNeedingAttention(
    {
      "email-sync": run(1),
      reconcile: run(0.5),
      reminders: run(2),
      recurring: run(2),
      "retention-purge": run(10),
      "quarter-close": run(24 * 30),
    },
    NU,
  );
  assert.deepEqual(alles, [], "een gezonde machine geeft een lege lijst");

  const kapot = cronsNeedingAttention({ reconcile: run(50), "email-sync": null }, NU);
  const jobs = kapot.map((k) => k.job).sort();
  // Alles wat ontbreekt telt als nooit-gedraaid — dat is de juiste kant om op te falen: liever
  // een keer te veel kijken dan een cron die stil ligt en niemand die het weet.
  assert.ok(jobs.includes("reconcile") && jobs.includes("email-sync"));
  assert.equal(kapot.find((k) => k.job === "reconcile")?.health, "te-lang-stil");
  assert.equal(kapot.find((k) => k.job === "email-sync")?.health, "nooit-gedraaid");
});

test("de uitleg noemt de oorzaken die je een halfuur zoeken schelen", () => {
  const n = cronHealthNote("reconcile", "nooit-gedraaid");
  // Op Pro is CRON_SECRET vrijwel altijd de oorzaak; die hoort dus vooraan te staan.
  assert.ok(/CRON_SECRET/.test(n));
  assert.ok(n.indexOf("CRON_SECRET") < n.indexOf("Hobby"), "de relevante oorzaak eerst");
  assert.ok(/vercel\.json/.test(n));
  // En elk oordeel heeft een zin — geen enkele valt door de mand.
  for (const h of ["ok", "nooit-gedraaid", "afgebroken", "gefaald", "te-lang-stil"] as const) {
    assert.ok(cronHealthNote("reconcile", h).length > 10, `${h} heeft uitleg nodig`);
  }
});
