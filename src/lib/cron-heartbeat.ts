// src/lib/cron-heartbeat.ts
// [CRON-HARTSLAG] Leeft de machine nog? De pure helft staat hier en is getest;
// het wegschrijven is één best-effort functie eronder.
// Run: npx tsx --test src/lib/cron-heartbeat.test.ts
//
// Zes crons draaien onbewaakt. Valt er één stil — een ontbrekende CRON_SECRET, een deploy die
// vercel.json niet meenam, een plan-limiet, een 500 die blijft terugkomen — dan merkt niemand
// het: geen scherm, geen uitblijvende mail die iemand mist, geen getal dat verandert.
//
// Bij quarter-close is dat het ergst én het traagst zichtbaar: hij draait VIER KEER PER JAAR.
// Een stil kapotte quarter-close ontdek je een jaar later, met de vraag "waarom heeft mijn
// boekhouder nooit iets ontvangen?" — precies de belofte van dit product.

/** De zes crons uit vercel.json, met hun bedoelde ritme in uren. */
export const CRON_JOBS = {
  "email-sync": 2,
  reconcile: 1,
  reminders: 24,
  recurring: 24,
  "retention-purge": 168,
  // Vier keer per jaar. Deze ziet er dus bijna altijd "stil" uit — de oordeelfunctie hieronder
  // houdt daar rekening mee, anders zou hij permanent alarm slaan en daarmee waardeloos worden.
  "quarter-close": 2184,
} as const;

export type CronJob = keyof typeof CRON_JOBS;

export type CronHealth = "ok" | "nooit-gedraaid" | "afgebroken" | "gefaald" | "te-lang-stil";

export interface CronRunRow {
  job: string;
  started_at: string | null;
  ok: boolean | null;
}

/**
 * Het oordeel over één cron.
 *
 * `nowMs` wordt meegegeven — geen klok in een pure functie, en het maakt de test exact.
 *
 * De vier storingen zijn bewust NIET één 'kapot': ze vragen om verschillend handelen.
 *   nooit-gedraaid → de bedrading klopt niet (CRON_SECRET, vercel.json, plan-limiet)
 *   afgebroken     → hij begon en stierf halverwege (time-out, geheugen, crash)
 *   gefaald        → hij kwam tot het einde en gaf zelf aan dat het misging
 *   te-lang-stil   → hij liep ooit goed en is daarna niet meer langs geweest
 */
export function judgeCron(job: CronJob, run: CronRunRow | null, nowMs: number): CronHealth {
  if (!run || !run.started_at) return "nooit-gedraaid";
  if (run.ok === null) return "afgebroken";
  if (run.ok === false) return "gefaald";

  const startedMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedMs)) return "afgebroken";

  // Twee keer het bedoelde ritme: één gemiste slag is ruis (Vercel spreidt aanroepen binnen het
  // uur), twee gemiste slagen is een patroon.
  const marge = CRON_JOBS[job] * 2 * 3_600_000;
  return nowMs - startedMs > marge ? "te-lang-stil" : "ok";
}

/** Vraagt iets aandacht? Handig als één regel in een monitoringcheck. */
export function cronsNeedingAttention(
  runsByJob: Partial<Record<CronJob, CronRunRow | null>>,
  nowMs: number,
): Array<{ job: CronJob; health: CronHealth }> {
  const uit: Array<{ job: CronJob; health: CronHealth }> = [];
  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    const health = judgeCron(job, runsByJob[job] ?? null, nowMs);
    if (health !== "ok") uit.push({ job, health });
  }
  return uit;
}

/**
 * De Nederlandse uitleg bij een oordeel — en, belangrijker, wat het waarschijnlijk IS.
 *
 * De twee meest voorkomende oorzaken staan er letterlijk in, want dat scheelt een halfuur zoeken:
 * een ontbrekende CRON_SECRET (elke cron antwoordt dan 401 en doet niets) en Vercel Hobby, waar
 * een cron die vaker dan één keer per dag draait de DEPLOY laat falen.
 */
export function cronHealthNote(job: CronJob, health: CronHealth): string {
  switch (health) {
    case "ok":
      return `${job}: draait zoals bedoeld.`;
    case "nooit-gedraaid":
      return `${job}: heeft NOOIT gedraaid. Op dit project (Vercel Pro, waar crons per minuut mogen) is de oorzaak vrijwel altijd dat CRON_SECRET niet in de omgeving staat — dan antwoordt elke cron 401 en doet niets. Kijk anders of vercel.json wel is meegedeployd. (Op Hobby zou een cron vaker dan 1x per dag de deploy laten falen; hier speelt dat niet.)`;
    case "afgebroken":
      return `${job}: begonnen maar nooit afgerond — het proces is halverwege gestopt (time-out of crash). Wat hij tot dat punt had gedaan, staat wél in de database.`;
    case "gefaald":
      return `${job}: de laatste run meldde zelf dat het misging. De reden staat in cron_runs.error.`;
    case "te-lang-stil":
      return `${job}: liep ooit goed en is daarna meer dan twee slagen niet langs geweest.`;
  }
}

// ── Het wegschrijven ──────────────────────────────────────────────────────────────────────────

/**
 * Legt vast dat een cron heeft gedraaid, en wat hij deed.
 *
 * BEST EFFORT, en dat is hier geen luiheid maar de juiste keuze: het bijhouden van de hartslag
 * mag nooit de cron zelf laten vallen. Een mislukte schrijfactie logt en gaat verder — het werk
 * dat de cron deed is echt gedaan, ook als het opschrijven niet lukte.
 *
 * DEPLOY-SAFE: bestaat de tabel nog niet (cron_runs.sql niet toegepast), dan is dit een no-op.
 * De code staat live vóór de migratie; zonder deze tak zou elke cron-run een foutregel loggen.
 */
export async function recordCronRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  job: CronJob,
  outcome: { startedAt: string; ok: boolean; result?: unknown; error?: string },
): Promise<void> {
  try {
    const { error } = await client.from("cron_runs").insert({
      job,
      started_at: outcome.startedAt,
      finished_at: new Date().toISOString(),
      ok: outcome.ok,
      result: outcome.result ?? null,
      error: outcome.error ? String(outcome.error).slice(0, 500) : null,
    });
    // 42P01 = de tabel bestaat nog niet. Dat is de normale toestand vóór de migratie, geen fout.
    if (error && error.code !== "42P01") {
      console.error("[CRON-HARTSLAG] kon de run niet vastleggen", { job, error });
    }
  } catch (e) {
    console.error("[CRON-HARTSLAG] kon de run niet vastleggen", { job, error: String(e) });
  }
}
