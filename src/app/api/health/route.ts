// src/app/api/health/route.ts
// [DEPLOY-HEALTH] Eén URL die na een deploy zegt of de bedrading klopt.
//
// GET /api/health   met   Authorization: Bearer $CRON_SECRET
//
// WAT DIT WEL IS
// Een rookproef voor de BEHEERDER. Na een deploy weet je dat de code er staat; je weet niet of de
// omgeving compleet is, of de database bereikbaar is, of de crons daadwerkelijk draaien. De
// duurste variabelen zijn juist die waarvan het ontbreken NIETS zichtbaars doet — zonder
// CRON_SECRET antwoorden alle zes crons 401 en doet de app verder alsof er niets aan de hand is.
//
// WAT DIT NADRUKKELIJK NIET IS
// Geen beheerdersdashboard. Er is geen admin-rol in dit product en er komt er geen: het hele
// vertrouwensverhaal is dat alleen de eigenaar en zijn gekozen boekhouder bij de gegevens kunnen.
// Dit eindpunt raakt daarom GEEN klantgegevens, telt niets per gebruiker, en geeft NOOIT een
// waarde van een omgevingsvariabele terug — alleen aanwezig of niet. Een gezondheidsrapport dat
// sleutels lekt is zelf het lek.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { checkEnv, envVerdict, missingEnv } from "@/lib/deploy-health";
import { CRON_JOBS, judgeCron, cronHealthNote, type CronJob, type CronRunRow } from "@/lib/cron-heartbeat";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Dezelfde sleutel als de crons — dit is beheer, geen eigenaarsfunctie.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Dit is geen weigering maar HET antwoord: staat CRON_SECRET er niet, dan is dat precies wat
    // je zocht. Alle zes crons antwoorden dan 401 en doen niets, en niets op enig scherm verraadt
    // dat. Daarom zeggen we het hier hardop in plaats van een kale 401 terug te geven.
    return NextResponse.json(
      {
        ok: false,
        verdict: "kapot",
        diagnose:
          "CRON_SECRET staat niet in de omgeving. Dat betekent óók dat alle zes crons 401 antwoorden en niets doen: geen mailimport, geen herinneringen, geen kwartaalafsluiting. Zet hem, deploy opnieuw, en vraag deze pagina daarna nog eens op.",
      },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 1. De omgeving ───────────────────────────────────────────────────
  const env = checkEnv(process.env);
  const envOordeel = envVerdict(env);
  const envMist = missingEnv(env).map((m) => ({ key: m.key, ernst: m.severity, gevolg: m.gevolg }));

  // ── 2. Is de database bereikbaar, en staan de bestanden dicht? ───────
  const pipeline = createPipelineClient();

  let dbBereikbaar = false;
  let dbFout: string | null = null;
  try {
    // De goedkoopst mogelijke echte query: telt niets, leest niets van een gebruiker.
    const { error } = await pipeline.from("profiles").select("id", { count: "exact", head: true }).limit(1);
    dbBereikbaar = !error;
    dbFout = error ? error.message : null;
  } catch (e) {
    dbFout = e instanceof Error ? e.message : String(e);
  }

  // De bucket hoort privé te zijn. Staat hij open, dan zijn alle bonnen van alle klanten met een
  // geraden URL te lezen — dat is het ergste wat deze installatie kan overkomen.
  let bucketPrive: boolean | null = null;
  try {
    const { data } = await pipeline.storage.getBucket("documents");
    bucketPrive = data ? data.public === false : null;
  } catch {
    bucketPrive = null;
  }

  // ── 3. Leeft de machine? ─────────────────────────────────────────────
  // Hier valt het meeste te zien: een cron die nooit heeft gedraaid verraadt een bedradingsfout
  // die verder nergens zichtbaar is.
  const nu = Date.now();
  const crons: Array<{ job: string; health: string; laatst: string | null; toelichting?: string }> = [];
  let cronsLeesbaar = true;
  for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
    let run: CronRunRow | null = null;
    try {
      // [DEPLOY-SAFE] De gegenereerde types kennen cron_runs nog niet — die worden pas
      // bijgewerkt nadat de migratie is toegepast. Zelfde ontsnapping als elders in de codebase;
      // de 42P01-tak hieronder vangt het geval dat de tabel er echt nog niet is.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (pipeline as any)
        .from("cron_runs")
        .select("job, started_at, ok")
        .eq("job", job)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // 42P01 = cron_runs.sql is nog niet toegepast. Dan weten we het simpelweg niet, en dat is
      // iets anders dan "hij draait niet" — zeg dat dus ook zo.
      if (error && error.code === "42P01") { cronsLeesbaar = false; break; }
      run = (data as CronRunRow | null) ?? null;
    } catch {
      cronsLeesbaar = false;
      break;
    }
    const health = judgeCron(job, run, nu);
    crons.push({
      job,
      health,
      laatst: run?.started_at ?? null,
      ...(health === "ok" ? {} : { toelichting: cronHealthNote(job, health) }),
    });
  }

  const cronsMetProbleem = crons.filter((c) => c.health !== "ok");

  // ── Het eindoordeel ──────────────────────────────────────────────────
  const kapot = envOordeel === "kapot" || !dbBereikbaar || bucketPrive === false;
  const letOp = envOordeel === "let-op" || cronsMetProbleem.length > 0 || bucketPrive === null;
  const verdict = kapot ? "kapot" : letOp ? "let-op" : "gezond";

  return NextResponse.json(
    {
      ok: verdict === "gezond",
      verdict,
      omgeving: {
        oordeel: envOordeel,
        // Alleen wat mist. Wat er staat is niet interessant, en de waarden verlaten de server nooit.
        mist: envMist,
      },
      database: { bereikbaar: dbBereikbaar, ...(dbFout ? { fout: dbFout } : {}) },
      bestanden: {
        bucketPrive,
        ...(bucketPrive === null
          ? { let_op: "kon de bucket-instelling niet lezen — controleer met de hand dat 'documents' op privé staat" }
          : {}),
      },
      crons: cronsLeesbaar
        ? { leesbaar: true, aandacht: cronsMetProbleem.length, alle: crons }
        : {
            leesbaar: false,
            reden:
              "cron_runs bestaat nog niet — pas supabase/migrations/cron_runs.sql toe. Tot die tijd is niet te zien óf de crons draaien; dat is iets anders dan dat ze stilliggen.",
          },
    },
    { status: verdict === "kapot" ? 503 : 200 },
  );
}
