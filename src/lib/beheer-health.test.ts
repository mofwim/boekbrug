// src/lib/beheer-health.test.ts
// Run: npx tsx --test src/lib/beheer-health.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemHealth, healthAlarm } from "./beheer-health";
import { CRON_JOBS, type CronJob, type CronRunRow } from "./cron-heartbeat";

const NU = Date.parse("2026-09-04T09:00:00Z");
const UUR = 3_600_000;
const run = (urenGeleden: number, ok = true): CronRunRow =>
  ({ job: "x", started_at: new Date(NU - urenGeleden * UUR).toISOString(), ok } as unknown as CronRunRow);
// Meten doen we al een half jaar — anders leest élke taak als "nog niet langs geweest".
const SINDS = NU - 180 * 24 * UUR;

/** Every registered job, all healthy. */
const alleGezond = (): Partial<Record<CronJob, CronRunRow | null>> => {
  const uit: Partial<Record<CronJob, CronRunRow | null>> = {};
  for (const job of Object.keys(CRON_JOBS) as CronJob[]) uit[job] = run(1);
  return uit;
};

test("[BEHEER-GEZOND] a healthy machine says nothing at all", () => {
  const h = buildSystemHealth(alleGezond(), NU, SINDS);
  assert.equal(h.readable, true);
  assert.equal(h.allWell, true);
  assert.deepEqual(h.attention, []);
  // Null is the point: a daily "everything is fine" is a mail people filter, and then the one
  // that mattered is filtered with it.
  assert.equal(healthAlarm(h), null);
  // Every registered job is judged — a job added to CRON_JOBS is covered by construction.
  assert.equal(h.crons.length, Object.keys(CRON_JOBS).length);
});

test("[BEHEER-GEZOND] a stopped cron is named, with what it means", () => {
  const rijen = alleGezond();
  // reminders is a daily job; four days of silence is not a rhythm, it is a stop.
  rijen.reminders = run(24 * 4);
  const h = buildSystemHealth(rijen, NU, SINDS);
  assert.equal(h.allWell, false);
  assert.ok(h.attention.some((c) => c.job === "reminders"), "the stopped job is not on the list");
  const alarm = healthAlarm(h)!;
  assert.match(alarm.subject, /reminders/);
  assert.match(alarm.body, /96 uur geleden/, "the mail says how long, not just that");
  // The consequence, in words: a stopped cron produces no error and changes nothing on screen.
  assert.match(alarm.body, /De gevolgen zijn stil/);
});

test("[BEHEER-GEZOND] never having run is different from having stopped", () => {
  const rijen = alleGezond();
  rijen["payment-due"] = null;
  // watchingSince is RECENT: we only just started recording, so a job that has not come round yet
  // is an empty observation. judgeCron owns that distinction; this asserts we respect it.
  const vers = buildSystemHealth(rijen, NU, NU - 2 * UUR);
  const versRij = vers.crons.find((c) => c.job === "payment-due")!;
  assert.equal(versRij.lastRunAt, null);
  assert.equal(versRij.hoursAgo, null);
  assert.equal(versRij.needsAttention, false, "'not yet come round' is not a fault");
  assert.equal(healthAlarm(vers), null);

  // …but a daily job that has not run in the half year we HAVE been watching, has stopped.
  const oud = buildSystemHealth(rijen, NU, SINDS);
  assert.ok(oud.attention.some((c) => c.job === "payment-due"));
  assert.match(healthAlarm(oud)!.body, /nog nooit gedraaid/);
});

test("[NO-SILENT-EMPTY] 'we could not look' is not 'nothing is wrong'", () => {
  const h = buildSystemHealth({}, NU, SINDS, false);
  assert.equal(h.readable, false);
  assert.deepEqual(h.crons, [], "an unreadable table yields no judgements — never invented ones");
  assert.equal(h.allWell, false, "unreadable may never render as healthy");
  // And it MAILS. Silence on a failed check is the same failure this module exists to end.
  const alarm = healthAlarm(h)!;
  assert.match(alarm.subject, /niet te lezen/);
  assert.match(alarm.body, /geen bevestiging dat alles goed gaat/);
});

test("[BEHEER-GEZOND] a failed run is not a missing run", () => {
  const rijen = alleGezond();
  rijen.recurring = run(1, false); // ran an hour ago, and failed
  const h = buildSystemHealth(rijen, NU, SINDS);
  const rij = h.crons.find((c) => c.job === "recurring")!;
  assert.equal(rij.lastRunAt !== null, true, "it DID run — the timestamp stays");
  assert.equal(rij.needsAttention, true, "…and a failed run still needs someone");
  assert.ok(rij.note, "a job that is not plain 'ok' carries its sentence");
});

// ── [STORINGSBEELD] ──────────────────────────────────────────────────────────
import { buildEventSummary } from "./beheer-health";

const ev = (tag: string, urenGeleden: number, severity = "gate-unavailable") =>
  ({ tag, severity, at: new Date(NU - urenGeleden * UUR).toISOString() });

test("[STORINGSBEELD] grouped by what broke, frequency first", () => {
  const s = buildEventSummary(
    [ev("CASH-SETTLE", 1), ev("CASH-SETTLE", 5), ev("CASH-SETTLE", 30), ev("MOLLIE", 2)],
    NU, 7,
  );
  assert.equal(s.total, 4);
  assert.equal(s.groups.length, 2);
  // Frequency, not severity: one data-integrity event is a thing to look at; the same one forty
  // times is a thing happening RIGHT NOW, and that is what an operator needs from a glance.
  assert.equal(s.groups[0].tag, "CASH-SETTLE");
  assert.equal(s.groups[0].count, 3);
  // The most RECENT of the group, so "is this still going on" is answerable.
  assert.equal(s.groups[0].hoursAgo, 1);
});

test("[STORINGSBEELD] the worst severity a tag ever had is the one shown", () => {
  // A tag that was data-integrity once and something mild twenty times is still a tag that CAN be
  // data-integrity — showing the last one would hide exactly the event worth seeing.
  const s = buildEventSummary(
    [ev("KAS", 1, "gate-unavailable"), ev("KAS", 2, "data-integrity"), ev("KAS", 3, "gate-unavailable")],
    NU, 7,
  );
  assert.equal(s.groups[0].severity, "data-integrity");
});

test("[NO-SILENT-EMPTY] 'nothing broke' and 'we could not look' are different answers", () => {
  const stil = buildEventSummary([], NU, 7);
  assert.equal(stil.readable, true);
  assert.deepEqual(stil.groups, [], "a quiet week is a real and good answer");

  const stuk = buildEventSummary([], NU, 7, false);
  assert.equal(stuk.readable, false, "unreadable may never render as a calm empty list");
  assert.equal(stuk.total, 0);
});

test("[STORINGSBEELD] the shape itself cannot carry a customer's data", () => {
  // This is the guarantee, and it is structural rather than a scrubber you have to trust: the row
  // has three fields. A free-text message is where an amount, an invoice number or a supplier name
  // would eventually land, and a failure log that carries those is a back door into every client's
  // books — the one thing this product promises never to pool.
  const s = buildEventSummary([ev("MOLLIE", 1)], NU, 7);
  const velden = Object.keys(s.groups[0]).sort();
  assert.deepEqual(velden, ["count", "hoursAgo", "lastAt", "severity", "tag"],
    "a field was added to the failure view — if it can hold free text, it can hold a customer's data");
});
