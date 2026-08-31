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

  // [HARTSLAG-BEWIJS] Draaide er ÉÉN taak? Dan zijn CRON_SECRET en vercel.json bewezen in orde, en
  // mag de uitleg bij een taak die nooit draaide de lezer niet naar de omgeving sturen. Het scherm
  // deed dat wel: acht taken op "ok" met tijden van uren geleden, en ernaast de bewering dat de
  // sleutel waarmee die acht waren binnengekomen ontbrak.
  const othersRan = (Object.keys(CRON_JOBS) as CronJob[]).some((j) => !!latestByJob[j]?.started_at);

  const crons: CronStatus[] = (Object.keys(CRON_JOBS) as CronJob[]).map((job) => {
    const run = latestByJob[job] ?? null;
    const health = judgeCron(job, run, nowMs, watchingSince);
    const startedMs = run?.started_at ? Date.parse(run.started_at) : NaN;
    return {
      job,
      health,
      lastRunAt: run?.started_at ?? null,
      hoursAgo: Number.isFinite(startedMs) ? Math.max(0, Math.round((nowMs - startedMs) / HOUR)) : null,
      note: health === "ok" ? null : cronHealthNote(job, health, othersRan),
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

/**
 * Read the heartbeat and judge it. The ONE reader, used by both the operator page and the cron
 * that mails the alarm.
 *
 * It exists because those two had the same twenty lines twice, and two readers of one table drift:
 * the page would have said "healthy" on a window the mail computed differently. It also keeps the
 * clock read out of a server component's render, where it is an impure call.
 *
 * [NO-SILENT-EMPTY] A failed read returns readable:false, never an empty-but-healthy answer.
 */
export async function readSystemHealth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  nowMs: number = Date.now(),
): Promise<SystemHealth> {
  let rijen: CronRunRow[] = [];
  try {
    // cron_runs staat niet in de gegenereerde types (handmatig toegepaste migratie) — dezelfde
    // versoepelde cast die /api/health en de hartslagmodule zelf gebruiken.
    const { data, error } = await pipeline
      .from("cron_runs").select("job, started_at, ok")
      .order("started_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    rijen = (data ?? []) as CronRunRow[];
  } catch {
    return buildSystemHealth({}, nowMs, null, false);
  }

  // Nieuwste eerst, dus de EERSTE die we per job zien is de laatste run.
  const laatste: Partial<Record<CronJob, CronRunRow | null>> = {};
  for (const r of rijen) {
    const job = r.job as CronJob;
    if (job in CRON_JOBS && !(job in laatste)) laatste[job] = r;
  }
  // De vroegste rij in de hele tabel: judgeCron heeft hem nodig om "sinds we meten nog niet aan de
  // beurt geweest" te scheiden van "gestopt". Zonder hem meldde de gezondheidscheck elf minuten na
  // de migratie dat de halve app stilstond.
  const tijden = rijen
    .map((r) => (r.started_at ? Date.parse(r.started_at) : NaN))
    .filter((n) => Number.isFinite(n));
  return buildSystemHealth(laatste, nowMs, tijden.length > 0 ? Math.min(...tijden) : null, true);
}

// ── [STORINGSBEELD] Wat er de laatste dagen misging ──────────────────────────
//
// reportHandledFailure meldt elke afgevangen storing aan Sentry en de serverlog. Allebei buiten de
// app, dus je moet ergens ANDERS inloggen om te zien of er iets aan de hand is — en daarom kijkt
// niemand. Dit is dezelfde informatie op de plek waar de beheerder toch al kijkt.
//
// Bewust GEEN logboekweergave. Vierduizend regels ruwe tekst beantwoorden de vraag niet; "welke
// storing, hoe vaak, wanneer voor het laatst" wel. En de tabel draagt met opzet geen message en
// geen context (system_events.sql legt uit waarom), dus die weergave zou er ook niet kunnen zijn.

/** One kind of failure, over the window. */
export interface EventGroup {
  tag: string;
  severity: string;
  count: number;
  /** ISO of the most recent one. */
  lastAt: string;
  /** Hours since that one. */
  hoursAgo: number | null;
}

export interface EventSummary {
  /** [NO-SILENT-EMPTY] False when the table could not be read — never an empty, calm list. */
  readable: boolean;
  /** How many days the window covers, so the counts can be read. */
  days: number;
  groups: EventGroup[];
  total: number;
}

/**
 * Group raw events by tag, sharpest first.
 *
 * "Sharpest" is FREQUENCY, not severity: a data-integrity event that happened once is a thing to
 * look at; the same one forty times is a thing that is happening RIGHT NOW, and that is the
 * distinction an operator needs from a glance.
 */
export function buildEventSummary(
  rows: Array<{ tag: string; severity: string; at: string }>,
  nowMs: number,
  days: number,
  readable = true,
): EventSummary {
  if (!readable) return { readable: false, days, groups: [], total: 0 };

  const byTag = new Map<string, { severity: string; count: number; lastAt: string }>();
  for (const r of rows) {
    const prev = byTag.get(r.tag);
    if (!prev) {
      byTag.set(r.tag, { severity: r.severity, count: 1, lastAt: r.at });
      continue;
    }
    prev.count++;
    // De ERNSTIGSTE die onder deze tag voorkwam blijft staan, niet de laatste: een tag die één keer
    // data-integrity was en daarna twintig keer iets milds, is nog steeds een tag die data-integrity
    // kán zijn — en dat is wat een beheerder moet zien.
    if (r.severity === "data-integrity") prev.severity = r.severity;
    if (r.at > prev.lastAt) prev.lastAt = r.at;
  }

  const groups: EventGroup[] = [...byTag.entries()]
    .map(([tag, v]) => {
      const ms = Date.parse(v.lastAt);
      return {
        tag,
        severity: v.severity,
        count: v.count,
        lastAt: v.lastAt,
        hoursAgo: Number.isFinite(ms) ? Math.max(0, Math.round((nowMs - ms) / HOUR)) : null,
      };
    })
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));

  return { readable: true, days, groups, total: rows.length };
}

/**
 * Read the window. The ONE reader, like readSystemHealth — see its note on why two readers of one
 * table drift.
 *
 * [NO-SILENT-EMPTY] A failed read returns readable:false. "Nothing went wrong this week" is a
 * genuinely good answer and a genuinely different one from "we could not look", and on an operator
 * page those two must never render the same.
 */
export async function readEventSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  nowMs: number = Date.now(),
  days = 7,
): Promise<EventSummary> {
  const vanaf = new Date(nowMs - days * 24 * HOUR).toISOString();
  try {
    const { data, error } = await pipeline
      .from("system_events").select("tag, severity, at")
      .gte("at", vanaf)
      .order("at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return buildEventSummary((data ?? []) as Array<{ tag: string; severity: string; at: string }>, nowMs, days, true);
  } catch {
    return buildEventSummary([], nowMs, days, false);
  }
}
