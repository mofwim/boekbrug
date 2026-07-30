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

test("een run die nooit afsluit blijft 'afgebroken' — daarvoor bestaat de startregel", () => {
  // De crons schreven eerst ALLEEN bij succes. Een cron die halverwege sterft (time-out van 300s,
  // geheugen op, harde crash) kwam dan nooit bij die regel en liet dus GEEN spoor na: hij zag eruit
  // als "nooit gedraaid", of twee slagen later als "te lang stil".
  //
  // Voor reconcile is dat twee uur vertraging. Voor quarter-close, met een marge van een half jaar,
  // zou een vastgelopen kwartaalafsluiting pas het volgende seizoen opvallen — precies de storing
  // die dit mechanisme moest vangen. Nu opent beginCronRun een regel met ok = null, en blijft die
  // staan als de run sterft.
  const halverwegeGestorven = { job: "quarter-close", started_at: gelede(1), ok: null };
  assert.equal(judgeCron("quarter-close", halverwegeGestorven, NU), "afgebroken");
  // En hij wordt ONMIDDELLIJK gezien, niet pas na de marge.
  assert.notEqual(judgeCron("quarter-close", halverwegeGestorven, NU), "ok");
});

test("de write-only-bij-succes-vorm komt niet terug", () => {
  // Vangnet: zou iemand recordCronRun opnieuw invoeren, dan is de startregel overbodig geworden
  // en verdwijnt 'afgebroken' stilletjes weer uit de werkelijkheid.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./cron-heartbeat") as Record<string, unknown>;
  assert.ok(typeof mod.beginCronRun === "function", "de startregel hoort te bestaan");
  assert.ok(typeof mod.finishCronRun === "function");
  assert.equal(mod.recordCronRun, undefined, "één schrijfmoment is niet genoeg — zie de test hierboven");
});

test("een cron van wie de beurt nog niet is langsgekomen, is niet stuk", () => {
  // DIT WAS EEN ECHTE LEUGEN OP PRODUCTIE. Elf minuten na het toepassen van cron_runs meldde de
  // gezondheidscheck dat reminders (07:00), recurring (06:00), retention-purge (maandag) en
  // quarter-close (5 oktober) "NOOIT GEDRAAID" hadden — met CRON_SECRET als vermoedelijke oorzaak,
  // terwijl email-sync en reconcile op datzelfde moment mét diezelfde sleutel netjes hadden
  // gedraaid. De waarheid: hun beurt was gewoon nog niet langsgekomen sinds we begonnen te meten.
  const elfMinuten = NU - 11 * 60_000;
  assert.equal(judgeCron("reminders", null, NU, elfMinuten), "nog-niet-langs");
  assert.equal(judgeCron("quarter-close", null, NU, elfMinuten), "nog-niet-langs");
  assert.equal(judgeCron("retention-purge", null, NU, elfMinuten), "nog-niet-langs");

  // En het vraagt GEEN aandacht — anders staat er iets rood dat niemand kan oplossen.
  const aandacht = cronsNeedingAttention({}, NU, elfMinuten);
  assert.deepEqual(aandacht, [], "elf minuten meten levert geen enkele storing op");
});

test("maar na zijn ritme is 'niet langsgekomen' wél een storing", () => {
  // De grens is het ritme van de cron zelf. Kijk je langer dan dat en is hij nooit verschenen,
  // dan is er echt iets mis met de bedrading.
  const tweeDagen = NU - 48 * 3_600_000;
  assert.equal(judgeCron("reminders", null, NU, tweeDagen), "nooit-gedraaid", "dagelijks, twee dagen niets");
  assert.equal(judgeCron("reconcile", null, NU, tweeDagen), "nooit-gedraaid", "elk uur, twee dagen niets");
  // quarter-close draait elk kwartaal; twee dagen zegt daar nog steeds niets.
  assert.equal(judgeCron("quarter-close", null, NU, tweeDagen), "nog-niet-langs");

  const aandacht = cronsNeedingAttention({}, NU, tweeDagen).map((a) => a.job);
  assert.ok(aandacht.includes("reminders") && aandacht.includes("reconcile"));
  assert.ok(!aandacht.includes("quarter-close"), "die mag pas na een kwartaal iets zeggen");
});

test("zonder meetvenster blijft het oude gedrag staan", () => {
  // Is er nog geen enkele rij, dan is er ook geen venster — dan kan er niets anders worden gezegd.
  assert.equal(judgeCron("reminders", null, NU), "nooit-gedraaid");
  assert.equal(judgeCron("reminders", null, NU, null), "nooit-gedraaid");
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
