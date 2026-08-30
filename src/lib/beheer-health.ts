// src/lib/beheer-health.ts
// [BEHEER-GEZOND] De systeemkant van de beheerpagina: draaien de crons nog, en sinds wanneer niet.
//
// ── HET GAT DAT DIT DICHT ──
// cron-heartbeat.ts legt elke run vast en judgeCron velt er een oordeel over. Dat oordeel had
// precies één lezer: /api/health, een endpoint dat je moet CURLEN met het cron-secret. En
// cronsNeedingAttention — de functie die bestaat om te zeggen wat er stukgaat — had in de hele
// productiecode geen enkele aanroeper; alleen haar eigen test.
//
// Dus: het systeem meet dat een cron is gestopt, velt daar een oordeel over, en vertelt het aan
// niemand. Valt /api/cron/reminders om, dan worden er geen herinneringen meer gestuurd; valt
// payment-due om, dan mist een ondernemer zijn betaaltermijnen — en in beide gevallen ziet het
// scherm er normaal uit. De module die is gebouwd om stille storingen te voorkomen, is er zelf
// één, één laag hoger.
//
// Deze module VELT GEEN EIGEN OORDEEL. judgeCron blijft de enige die dat doet; dit vormt de
// uitkomst alleen om tot iets wat een mens op een pagina leest en wat een cron kan mailen. Twee
// plekken die "gezond" verschillend definiëren is hoe een dashboard groen staat terwijl de
// gezondheidscheck rood is.

import { CRON_JOBS, judgeCron, cronHealthNote, type CronJob, type CronHealth, type CronRunRow } from "./cron-heartbeat";

/** One cron, as the operator reads it. */
export interface CronStatus {
  job: CronJob;
  health: CronHealth;
  /** ISO of the most recent recorded run, or null when there has never been one. */
  lastRunAt: string | null;
  /** Hours since that run. Null when it never ran. */
  hoursAgo: number | null;
  /** The sentence for anything that is not plain 'ok'. */
  note: string | null;
  /** Does this one need someone to look? 'nog-niet-langs' is an empty observation, not a fault. */
  needsAttention: boolean;
}

export interface SystemHealth {
  /**
   * [NO-SILENT-EMPTY] False when cron_runs could not be read at all. An empty list then means
   * "we could not look", never "nothing is wrong" — and on a page whose entire job is to say
   * whether the machine is running, those two must never render the same.
   */
  readable: boolean;
  crons: CronStatus[];
  /** Sharpest first: what an operator should act on today. */
  attention: CronStatus[];
  /** True when every job is plain 'ok'. False also when unreadable — see `readable`. */
  allWell: boolean;
}

const HOUR = 3_600_000;

/**
 * Judge every registered cron from its most recent run.
 *
 * `latestByJob` holds at most one row per job. `watchingSince` is the earliest recorded run in the
 * whole table — judgeCron needs it, and without it the answer is a lie: minutes after the
 * migration was applied, every job that had not yet come round looked like it had stopped.
 */
export function buildSystemHealth(
  latestByJob: Partial<Record<CronJob, CronRunRow | null>>,
  nowMs: number,
  watchingSince: number | null,
  readable = true,
): SystemHealth {
  if (!readable) return { readable: false, crons: [], attention: [], allWell: false };

  const crons: CronStatus[] = (Object.keys(CRON_JOBS) as CronJob[]).map((job) => {
    const run = latestByJob[job] ?? null;
    const health = judgeCron(job, run, nowMs, watchingSince);
    const startedMs = run?.started_at ? Date.parse(run.started_at) : NaN;
    return {
      job,
      health,
      lastRunAt: run?.started_at ?? null,
      hoursAgo: Number.isFinite(startedMs) ? Math.max(0, Math.round((nowMs - startedMs) / HOUR)) : null,
      note: health === "ok" ? null : cronHealthNote(job, health),
      // 'nog-niet-langs' betekent: hij is sinds we meten nog niet aan de beurt geweest. Dat is een
      // lege waarneming en geen storing — precies de reden dat judgeCron hem apart benoemt.
      needsAttention: health !== "ok" && health !== "nog-niet-langs",
    };
  });

  const attention = crons.filter((c) => c.needsAttention);
  return { readable: true, crons, attention, allWell: attention.length === 0 };
}

/**
 * The line the operator gets mailed when something stopped — or null when nothing did.
 *
 * Null on a healthy machine is the whole point: a daily "everything is fine" is a mail people
 * filter, and then the one that mattered is filtered with it.
 *
 * NOT null when the table could not be read. "We could not check" is not "nothing is wrong", and
 * on the one signal that says whether the machine runs, silence on a failed check is the same
 * failure this module exists to end.
 */
export function healthAlarm(health: SystemHealth): { subject: string; body: string } | null {
  if (!health.readable) {
    return {
      subject: "BoekBrug — de cron-hartslag is niet te lezen",
      body:
        "We konden cron_runs niet lezen, dus we weten niet of de achtergrondtaken nog draaien. " +
        "Dit is geen bevestiging dat er iets stuk is, en ook geen bevestiging dat alles goed gaat — " +
        "het is precies het geval waarin niemand het merkt. Kijk op /dashboard/beheer.",
    };
  }
  if (health.attention.length === 0) return null;

  const regels = health.attention.map((c) => {
    const wanneer = c.lastRunAt
      ? `laatst ${c.hoursAgo === null ? "onbekend" : `${c.hoursAgo} uur geleden`}`
      : "nog nooit gedraaid";
    return `· ${c.job} — ${c.health} (${wanneer}). ${c.note ?? ""}`.trim();
  });

  const aantal = health.attention.length;
  return {
    subject:
      aantal === 1
        ? `BoekBrug — ${health.attention[0].job} draait niet meer`
        : `BoekBrug — ${aantal} achtergrondtaken draaien niet meer`,
    body:
      "Deze taken hebben aandacht nodig:\n\n" +
      regels.join("\n") +
      "\n\nWat dat betekent: een gestopte cron geeft geen foutmelding en verandert niets aan het " +
      "scherm. De gevolgen zijn stil — geen herinneringen, geen bankregels, geen betaaltermijn die " +
      "op tijd wordt gemeld.",
  };
}
