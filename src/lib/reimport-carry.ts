// src/lib/reimport-carry.ts
// [REIMPORT-CARRY] Wat blijft er staan als een factuur OPNIEUW wordt ingelezen? Puur, geen I/O.
// Run: npx tsx --test src/lib/reimport-carry.test.ts
//
// WAAROM DIT EEN EIGEN BESTAND IS
// "Opnieuw inlezen" bestaat om een slechte AI-lezing te herstellen. Maar de route verving
// `_safecore` in zijn geheel door het verse rekenoordeel — en in dat ene object wonen DRIE
// soorten waarheid door elkaar:
//
//   1. het REKENOORDEEL (arithmetic_ok / reason / flags / held_at) — gaat over de bedragen,
//      dus een verse lezing is daar de baas;
//   2. de DUBBEL-SIGNALEN (possible_duplicate*, dedup, dedup_reason) — gaan over de RELATIE
//      met een ándere factuur. De re-import draait geen enkele dedup-query, dus een verse
//      lezing kan die niet opnieuw afleiden. Ze verdwenen dus gewoon;
//   3. het HERINNERINGS-signaal (reminder, reminder_of) — dat de verse lezing juist wél
//      opnieuw bepaalt.
//
// Gevolg van (2): een factuur met "mogelijk dubbel met X" werd door één druk op de knop
// schoon. classifyImportHealth zag geen vlag meer, de rij mocht weer auto-boeken, en dezelfde
// kostenpost kon een tweede keer de administratie in. De knop die het vertrouwen moest
// herstellen, wiste juist het signaal dat om aandacht vroeg — zonder melding, en zonder dat er
// iets op het scherm veranderde behalve dat de waarschuwing weg was.
//
// De `_dedup*`-tak in de oude carry-lus was daarbij dode code: geen enkele schrijver zet een
// top-level sleutel die zo begint. Dedup woont IN `_safecore`.

/** De sleutels binnen `_safecore` die over het REKENWERK gaan — de verse lezing is hier de baas. */
const ARITHMETIC_KEYS = ["arithmetic_ok", "reason", "flags", "held_at"] as const;

/**
 * De sleutels binnen `_safecore` die over de RELATIE met een andere factuur gaan.
 * Deze overleven een re-import ALTIJD: opnieuw naar dít document kijken zegt niets over de
 * vraag of er elders een tweeling ligt, en de route zoekt die tweeling niet opnieuw op.
 */
const RELATION_KEYS = [
  "possible_duplicate",
  "possible_duplicate_of",
  "possible_duplicate_reason",
  "dedup",
  "dedup_reason",
] as const;

/** Het rekenoordeel zoals evaluateArithmetic het teruggeeft. */
export interface ArithmeticVerdict {
  ok: boolean;
  reason?: string;
  flags?: string[];
}

export interface ReimportCarryInput {
  /** field_confidence zoals het nu in de database staat. */
  priorFc: Record<string, unknown> | null;
  /** De per-veld zekerheden uit de VERSE AI-lezing. */
  aiConfidence: Record<string, unknown> | null;
  /** Zijn er bruikbare verse bedragen? Zo nee, dan blijven de OPGESLAGEN bedragen staan. */
  freshHasTotal: boolean;
  /** Het verse rekenoordeel over die verse bedragen; null als er geen verse bedragen zijn. */
  verdict: ArithmeticVerdict | null;
  /** Tijdstempel voor een nieuw hold — meegegeven, zodat deze module puur blijft. */
  heldAt: string;
  /** Zag de VERSE lezing een betalingsherinnering? */
  freshIsReminder: boolean;
  /** Het originele factuurnummer waar die herinnering bij hoort. */
  freshReminderOf: string | null;
}

/**
 * Bouwt het nieuwe field_confidence voor een opnieuw ingelezen factuur.
 *
 * Retourneert null als er niets te bewaren valt (dan hoort de kolom leeg te zijn).
 */
export function buildReimportFieldConfidence(input: ReimportCarryInput): Record<string, unknown> | null {
  const { priorFc, aiConfidence, freshHasTotal, verdict, heldAt, freshIsReminder, freshReminderOf } = input;

  const carried: Record<string, unknown> = {};
  const priorSafecore = asRecord(priorFc?._safecore);

  if (priorFc) {
    for (const k of Object.keys(priorFc)) {
      // De camera-hints beschrijven hoe het document binnenkwam; een herlezing verandert daar
      // niets aan. (Ook _intake_paid_evidence en _intake_paid_card4 horen hierbij: dat is het
      // bewijs waarop de betaalwijze rust — een audit-spoor dat niet mag verdampen.)
      if (k.startsWith("_intake")) carried[k] = priorFc[k];
      // [BTW-SUM-FIX] _btw_derived verklaart de OPGESLAGEN bedragen ("deze BTW is van ons, niet
      // van de factuur"). Blijven die bedragen staan, dan moet de verklaring meegaan; komen er
      // verse bedragen, dan gaat de verklaring met de oude bedragen mee weg.
      else if (!freshHasTotal && k === "_btw_derived") carried[k] = priorFc[k];
    }
  }

  // ── _safecore, per soort waarheid opnieuw samengesteld ──────────────────────────────────
  const safecore: Record<string, unknown> = {};

  // (2) De relatie-signalen overleven altijd — zie de kop.
  if (priorSafecore) {
    for (const k of RELATION_KEYS) {
      if (k in priorSafecore) safecore[k] = priorSafecore[k];
    }
  }

  // (1) Het rekenoordeel. Verse bedragen → vers oordeel (en een schone lezing laat geen oud
  // hold staan). Geen verse bedragen → de opgeslagen bedragen zijn ongewijzigd, dus het oude
  // oordeel geldt onverkort.
  if (freshHasTotal) {
    if (verdict && !verdict.ok) {
      safecore.arithmetic_ok = false;
      if (verdict.reason !== undefined) safecore.reason = verdict.reason;
      if (verdict.flags !== undefined) safecore.flags = verdict.flags;
      safecore.held_at = heldAt;
    }
  } else if (priorSafecore) {
    for (const k of ARITHMETIC_KEYS) {
      if (k in priorSafecore) safecore[k] = priorSafecore[k];
    }
  }

  // (3) De herinnering komt van de VERSE lezing — nooit blind overgenomen. Dat is precies wat
  // deze knop hoort te kunnen: een ten onrechte gezette herinneringsvlag weer weghalen. Zou je
  // hem meedragen, dan is die vlag onherstelbaar door het enige middel dat ervoor bestaat.
  if (freshIsReminder) {
    safecore.reminder = true;
    if (freshReminderOf) safecore.reminder_of = freshReminderOf;
  }

  if (Object.keys(safecore).length > 0) carried._safecore = safecore;

  const merged = { ...(aiConfidence ?? {}), ...carried };
  return Object.keys(merged).length > 0 ? merged : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
