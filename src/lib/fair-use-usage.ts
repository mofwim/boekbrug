// src/lib/fair-use-usage.ts
// [FAIR-USE] Het meten zelf — de brug tussen de gepubliceerde grenzen (fair-use.ts) en wat
// er werkelijk gebeurt.
//
// fair-use.ts is puur en zegt WAT de grenzen zijn. Dit bestand doet de I/O en zegt WAAR
// iemand staat. De scheiding is opzet: de grenzen worden gepubliceerd op /eerlijk-gebruik
// en in de voorwaarden §5, en die publicatie mag nooit afhangen van of een database
// bereikbaar is.
//
// ── TWEE SOORTEN GETALLEN, EN DAT VERSCHIL IS BELANGRIJK ──
//
//   GETELD  (aiDocuments, invoicesSent) — gebeurtenissen die voorbijgaan. Die moeten
//           worden opgeschreven op het moment dat ze plaatsvinden, anders zijn ze weg.
//           Staan in usage_counters, per kalendermaand.
//
//   GEMETEN (storageMb, mailboxes, administrations) — toestanden die je op elk moment
//           opnieuw kunt vaststellen uit de tabellen waar ze al in staan. Die tellen wij
//           NIET mee, want een geteld getal kan uit de pas lopen met de werkelijkheid en
//           een gemeten getal niet. Verwijdert iemand de helft van zijn documenten, dan
//           daalt zijn opslag meteen mee — precies zoals hij verwacht.
//
// ── DE FAALRICHTING, ÉÉN KEER EN OVERAL HETZELFDE ──
// Elke functie hier faalt OPEN. Kan de teller niet gelezen of geschreven worden, dan gaat
// de handeling door. Dat is regel 2 en 3 uit fair-use.ts: een maand te veel weggeven is
// minder erg dan iemand onterecht op slot zetten, en zeker minder erg dan hem op slot
// zetten door ONZE storing. De echte bodem onder de kosten is de globale dagzekering in
// ai-budget.ts, die geen database nodig heeft om te weigeren.

import { createPipelineClient } from "./supabase-pipeline";
import {
  FAIR_USE_LIMITS,
  fairUseLimit,
  type FairUseKey,
  type UsageCounts,
} from "./fair-use";

/** De metrieken die echt geteld moeten worden. De rest wordt gemeten. */
export const COUNTED_METRICS: readonly FairUseKey[] = FAIR_USE_LIMITS.filter(
  (l) => l.perMonth,
).map((l) => l.key);

/** Het plan waarvan de grens geldt. 'boekhouder' kent geen grenzen. */
export type UsagePlan = "free" | "plus" | "boekhouder";

/**
 * De meetperiode als sleutel: 'YYYY-MM' in UTC.
 *
 * UTC en niet lokale tijd, zodat de maandgrens overal hetzelfde moment is en niet afhangt
 * van waar de server toevallig draait. Puur, dus testbaar zonder klok.
 */
export function currentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * De grens die voor dit plan geldt, in de vorm die de database verwacht.
 * 0 betekent daar: tellen, maar niet begrenzen — dat is wat Plus en de boekhouder krijgen.
 *
 * Waarom Plus óók 0 krijgt en niet zijn eigen (hogere) grens: Plus is een betaald plan en
 * iemand die betaalt hoort niet halverwege de maand tegen een muur te lopen. De grens van
 * Plus in FAIR_USE_LIMITS is een verwachting die wij publiceren, geen slot dat wij
 * dichtdraaien. Loopt een Plus-gebruiker structureel ver over zijn grens heen, dan is dat
 * een gesprek — precies zoals §8 van /eerlijk-gebruik het beschrijft.
 */
export function limitForPlan(key: FairUseKey, plan: UsagePlan): number {
  if (plan !== "free") return 0;
  return fairUseLimit(key).free;
}

export type ConsumeVerdict = {
  /** Mag de kostbare handeling doorgaan? `false` is het ENIGE dat iets mag pauzeren. */
  allowed: boolean;
  /** Stand na deze handeling (of ervóór, als hij geweigerd is). */
  used: number;
  /** Wat er nog over is; -1 = geen grens. */
  remaining: number;
  /** Waarom — voor de logs en voor de melding aan de gebruiker. */
  reason: "within_limit" | "no_limit" | "exceeded" | "counter_unavailable";
  /** De periode waarop dit sloeg — nodig om later te kunnen teruggeven. */
  period: string;
};

/**
 * Reserveer één kostbare handeling. Roep dit aan VÓÓRDAT je hem uitvoert.
 *
 * Bij een weigering wordt er niets opgehoogd, dus de stand die de gebruiker te zien krijgt
 * klopt met wat hij werkelijk heeft gedaan.
 */
export async function consumeFairUse(params: {
  userId: string;
  metric: FairUseKey;
  plan: UsagePlan;
  amount?: number;
  now?: Date;
}): Promise<ConsumeVerdict> {
  const period = currentPeriod(params.now);
  const limit = limitForPlan(params.metric, params.plan);
  const amount = Math.max(1, params.amount ?? 1);

  try {
    const pipeline = createPipelineClient();
    // fair_use_consume komt uit fair_use_usage.sql en staat niet in de gegenereerde
    // typen → ontspannen client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (pipeline as any).rpc("fair_use_consume", {
      p_user_id: params.userId,
      p_period: period,
      p_metric: params.metric,
      p_limit: limit,
      p_amount: amount,
    });

    if (error || !data || data.length === 0) {
      console.warn(
        `[FAIR-USE] teller niet beschikbaar — ${params.metric} toegestaan`,
        error?.message ?? "geen rijen",
      );
      return { allowed: true, used: 0, remaining: -1, reason: "counter_unavailable", period };
    }

    const row = data[0] as { allowed: boolean; used: number; remaining: number };
    return {
      allowed: Boolean(row.allowed),
      used: Number(row.used ?? 0),
      remaining: Number(row.remaining ?? -1),
      reason: !row.allowed ? "exceeded" : limit === 0 ? "no_limit" : "within_limit",
      period,
    };
  } catch (err) {
    console.warn(`[FAIR-USE] teller wierp een fout — ${params.metric} toegestaan:`, err);
    return { allowed: true, used: 0, remaining: -1, reason: "counter_unavailable", period };
  }
}

/**
 * Geef een reservering terug omdat de handeling mislukte.
 *
 * Dit maakt de zin op /eerlijk-gebruik waar: "Een bestand dat wij niet konden lezen telt
 * ook niet mee — mislukte pogingen komen nooit op jouw rekening."
 *
 * Nooit blokkerend en nooit luidruchtig: als dit zelf faalt heeft de gebruiker één document
 * te veel op zijn teller staan, en dat is een klein onrecht vergeleken met een verzoek dat
 * hierop blijft hangen.
 */
export async function releaseFairUse(params: {
  userId: string;
  metric: FairUseKey;
  amount?: number;
  period?: string;
  now?: Date;
}): Promise<void> {
  try {
    const pipeline = createPipelineClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (pipeline as any).rpc("fair_use_release", {
      p_user_id: params.userId,
      p_period: params.period ?? currentPeriod(params.now),
      p_metric: params.metric,
      p_amount: Math.max(1, params.amount ?? 1),
    });
  } catch (err) {
    console.warn(`[FAIR-USE] teruggave van ${params.metric} mislukt:`, err);
  }
}

// ── Meten: de volledige stand, voor het scherm ───────────────────────────────

/** Minimale vorm van een Supabase-client — zodat zowel de server- als de pipelineclient past. */
type QueryableClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * De volledige stand van één gebruiker: getelde metrieken uit usage_counters, gemeten
 * metrieken uit de tabellen zelf. Geschikt om rechtstreeks in evaluateFairUse() te stoppen.
 *
 * Elke deelmeting is afzonderlijk ingepakt. Valt er één om (een tabel die er nog niet is,
 * een migratie die nog niet is toegepast), dan blijft de rest gewoon staan en ontbreekt
 * alleen dat ene getal — wat evaluateFairUse() als 0 leest en dus nooit als overschrijding.
 */
export async function measureUsage(
  client: QueryableClient,
  userId: string,
  now: Date = new Date(),
): Promise<UsageCounts> {
  const period = currentPeriod(now);
  const usage: UsageCounts = {};

  // 1. Getelde metrieken — één query voor alle rijen van deze maand.
  try {
    const { data } = await client
      .from("usage_counters")
      .select("metric, count")
      .eq("user_id", userId)
      .eq("period", period);
    for (const row of (data ?? []) as Array<{ metric: string; count: number }>) {
      if ((COUNTED_METRICS as readonly string[]).includes(row.metric)) {
        usage[row.metric as FairUseKey] = Number(row.count ?? 0);
      }
    }
  } catch {
    /* teller onbereikbaar → onbekend → 0 → nooit een overschrijding */
  }

  // 2. Opslag — GEMETEN, niet geteld. Prullenbak telt niet mee: wie opruimt hoort dat
  //    meteen terug te zien, anders voelt opruimen zinloos.
  try {
    const { data } = await client
      .from("documents")
      .select("file_size")
      .eq("user_id", userId)
      .or("trashed.is.null,trashed.eq.false");
    const bytes = ((data ?? []) as Array<{ file_size: number | null }>).reduce(
      (sum, d) => sum + (Number(d.file_size) || 0),
      0,
    );
    usage.storageMb = Math.round(bytes / (1024 * 1024));
  } catch {
    /* niet te meten → laat weg */
  }

  // 3. Gekoppelde mailboxen — ook gemeten.
  try {
    const { count } = await client
      .from("email_connections")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId);
    usage.mailboxes = Number(count ?? 0);
  } catch {
    /* niet te meten → laat weg */
  }

  // 4. Administraties worden bewust NIET gemeten. Eén account is één onderneming; meerdere
  //    administraties per account bestaan als functie nog niet, dus er valt niets vast te
  //    stellen. Hem hard op 1 zetten leek netter (het scherm toont dan de grens die ook op
  //    /eerlijk-gebruik staat) maar was fout: bij een grens van 1 zit iedereen dan
  //    permanent op 100%. Een getal dat wij niet echt meten hoort hier niet te staan.
  //    Komt de functie er, dan is dit de plek waar hij geteld gaat worden.

  return usage;
}

/**
 * De Nederlandse zin die de gebruiker te zien krijgt wanneer een handeling pauzeert.
 * Komt letterlijk uit `onExceed` in fair-use.ts, zodat het scherm nooit iets anders zegt
 * dan de gepubliceerde tekst — dezelfde discipline als bij de prijzen.
 */
export function exceededMessage(metric: FairUseKey): string {
  return fairUseLimit(metric).onExceed;
}
