// src/lib/turnover-book.ts
// [SHEET-BOOK] Shared DB writers for turnover + ledger, used by BOTH the live upload path
// (/api/intake) and the reprocess-stored-files path (/api/documents/reprocess). Extracting them
// here means "upload now" and "book my already-stored files" produce byte-identical rows — one
// source of truth for how a kassa Z-report / daily-sales PDF becomes daily_turnover, and how a
// PIN/kas grootboek becomes a ledger_daily witness.
//
// Both upserts are idempotent on (user, day[, kind]) → re-running over the same file corrects,
// never doubles. That idempotency is what makes a bulk reprocess safe to run repeatedly.

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTurnoverArithmetic, type DailyTurnover } from "./turnover";
import type { LedgerKind } from "./ledger-import";
import { round2 } from "./invoice-totals";
// [DAG-GECLAIMD] Eén dag, één bron — de regel die tot nu toe alleen in de twee handmatige deuren stond.
import { liveCashEntries } from "./cash-live";
import { fetchAllRowsForIds } from "./supabase-paginate";
import { TILL_SOURCE } from "./till-book";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

export interface TurnoverBookResult {
  ok: boolean;
  days: number;
  span: string;
  total_incl: number;
  /**
   * [TURNOVER-ARITHMETIC] Days refused because their figures cannot be true, each with the reason
   * in Dutch. Empty on success AND on a database failure — so a caller can tell the two apart, and
   * never tells the owner "opslaan mislukt" when what really happened is that the numbers are wrong.
   */
  rejected: string[];
  /** [DAGOMZET-DUP-DAY] De dag die het blad twee keer noemt — de reden van de weigering. */
  duplicateDay?: string;
}

/**
 * Upsert DailyTurnover rows into daily_turnover (source distinguishes provenance). Idempotent on
 * (user, turnover_date). When opts.preserveSplit is set (the daily-sales PDF, which carries no
 * payment split), the pin/cash/other columns are OMITTED from the payload so an ON CONFLICT upsert
 * leaves a richer Excel-sourced split untouched instead of nulling it.
 */
export async function bookTurnoverRows(
  supabase: AnySupabase,
  userId: string,
  rows: DailyTurnover[],
  source: string,
  opts?: { preserveSplit?: boolean },
): Promise<TurnoverBookResult> {
  // [TURNOVER-ARITHMETIC] The gate, before anything is written.
  //
  // This is the door the AI comes through: /api/intake books a PHOTOGRAPHED Z-report here, and
  // /api/documents/reprocess re-books stored ones. daily_turnover feeds rubriek 1a/1b of the
  // aangifte directly, so a misread rate lands in tax owed with nobody looking — there is no verify
  // queue on this path the way there is for purchase invoices.
  //
  // All or nothing, and the days are named. A half-booked Z-report is worse than an unbooked one:
  // the owner cannot tell which half is in, and the aangifte reads whatever is there.
  const rejected: string[] = [];
  for (const r of rows) {
    const breaks = checkTurnoverArithmetic({
      turnover_date: r.turnover_date,
      base_0: r.base_0 ?? 0, base_9: r.base_9 ?? 0, base_21: r.base_21 ?? 0,
      btw_9: r.btw_9 ?? 0, btw_21: r.btw_21 ?? 0,
      total_incl: r.total_incl ?? null,
      pin_amount: r.pin_amount ?? null, cash_amount: r.cash_amount ?? null, other_amount: r.other_amount ?? null,
    });
    if (breaks.length > 0) rejected.push(`${r.turnover_date}: ${breaks[0].note}`);
  }
  // [DAG-GECLAIMD] Een Z-rapport mag geen dag inpikken die de eigenaar al met de hand heeft geboekt.
  //
  // daySourceConflict bewaakt "één dag, één bron" en wordt gelezen door precies twee deuren: het
  // Kassa-ticket en het handmatig getypte dagtotaal. De drie IMPORT-deuren — /api/turnover/import,
  // de gefotografeerde dagstaat via /api/intake, en /api/documents/reprocess — komen alle drie hier
  // langs en vroegen niets. De upsert op (user_id, turnover_date) claimde de dag gewoon.
  //
  // Dat is niet "de dag wordt overschreven met een ander getal", wat al erg genoeg zou zijn. Zodra
  // de dag een Z-rapport draagt staat hij in `covered`, en de covered-day-regel in
  // financial-result.ts slaat de contante 'omzet'-boekingen van die dag over als dubbeltellingen.
  // Een handmatig geboekte contante verkoop van € 300 verdwijnt dan volledig: € 247,93 omzet en
  // € 52,07 uit rubriek 1a, zonder waarschuwing op enig scherm — terwijl het Z-rapport alleen de
  // pintransacties bevatte die de terminal zag.
  //
  // De regel hoort bij de SCHRIJVER, om precies de reden die twintig regels hoger staat voor
  // [DAGOMZET-DUP-DAY: "waar élke deur langskomt". De twee handmatige bronnen zijn uitgezonderd:
  // die hebben daySourceConflict al gesteld, en de Kassa moet de dag die hij zelf opbouwt altijd
  // kunnen herschrijven.
  //
  // Weigeren, niet stilletjes overslaan: dat is wat deze functie al doet zodra één dag niet klopt,
  // en een half toegepaste import laat de eigenaar met een boekhouding zitten waarvan hij niet kan
  // zien welke dagen erin zitten.
  if (source !== TILL_SOURCE && rows.length > 0) {
    const dagen = [...new Set(rows.map((r) => r.turnover_date))];
    const live = await liveCashEntries(supabase);
    // [IN-CHUNK] Gehakt én gepagineerd. De lijst is hier dagen, niet id's, maar een jaarblad noemt
    // er driehonderdvijfenzestig en één dag kan meerdere kasboekingen dragen — dus zowel de
    // URL-lengte als het rijenplafond zijn bereikbaar, en allebei zouden ze hetzelfde verkeerde
    // antwoord geven: "niemand claimt deze dagen".
    let kasRijen: Array<{ entry_date: string }>;
    try {
      kasRijen = await fetchAllRowsForIds<{ entry_date: string }, string>(
        dagen,
        (chunk, from, to) => live.only(
          supabase.from("cash_entries").select("entry_date")
            .eq("user_id", userId).eq("category", "omzet").in("entry_date", chunk),
        ).order("entry_date", { ascending: true }).range(from, to),
      );
    } catch {
      // [NO-SILENT-EMPTY] Een mislukte lezing is geen "niemand claimt deze dagen". Dat antwoord is
      // precies het antwoord dat de contante boekingen laat verdwijnen, dus het mag niet uit een
      // hapering komen.
      return {
        ok: false, days: 0, span: "", total_incl: 0,
        rejected: ["We konden niet nagaan of je voor deze dagen al contante omzet hebt geboekt. Er is niets opgeslagen — probeer het zo meteen opnieuw."],
      };
    }
    const geclaimd = [...new Set(kasRijen.map((r) => r.entry_date))].sort();
    if (geclaimd.length > 0) {
      const lijst = geclaimd.join(", ");
      return {
        ok: false, days: 0, span: "", total_incl: 0,
        rejected: [
          `Voor ${geclaimd.length === 1 ? "deze dag" : "deze dagen"} heb je al contante omzet in je Kas geboekt: ${lijst}. ` +
          "Eén dag telt uit één bron — anders telt die contante verkoop straks niet meer mee. " +
          "Haal die kasboeking(en) weg, of laat deze dag(en) uit het bestand.",
        ],
      };
    }
  }

  if (rejected.length > 0) {
    const dates = rows.map((r) => r.turnover_date).sort();
    return {
      ok: false,
      days: 0,
      span: dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : "",
      total_incl: 0,
      rejected,
    };
  }

  const records = rows.map((r) => {
    const base = {
      user_id: userId,
      turnover_date: r.turnover_date,
      base_0: r.base_0 ?? 0, base_9: r.base_9 ?? 0, base_21: r.base_21 ?? 0,
      btw_9: r.btw_9 ?? 0, btw_21: r.btw_21 ?? 0,
      total_incl: r.total_incl ?? null,
      source,
    };
    if (opts?.preserveSplit) return base;
    return { ...base, pin_amount: r.pin_amount ?? null, cash_amount: r.cash_amount ?? null, other_amount: r.other_amount ?? null };
  });
  // [DAGOMZET-DUP-DAY in de schrijver] Postgres kan ON CONFLICT DO UPDATE niet twee keer op
  // dezelfde rij toepassen in één statement (21000): een blad dat een dag twee keer noemt liet
  // de HELE upsert vallen. De handmatige route weigerde dit al mét de dagnaam — maar die guard
  // stond in de route, dus de intake-deur en /api/documents/reprocess kregen hem niet en
  // antwoordden "probeer het opnieuw" op een fout die bij elke poging identiek terugkomt. De
  // regel hoort bij de schrijver, waar élke deur langskomt. Optellen of laatste-wint is allebei
  // fout (zie de route voor waarom): weigeren en de dag noemen is het enige dat de eigenaar
  // verder helpt.
  const seenDay = new Set<string>();
  for (const r of records) {
    if (seenDay.has(r.turnover_date)) {
      return { ok: false, days: 0, span: "", total_incl: 0, rejected: [], duplicateDay: r.turnover_date };
    }
    seenDay.add(r.turnover_date);
  }
  const { error } = await supabase.from("daily_turnover").upsert(records, { onConflict: "user_id,turnover_date" });
  const dates = rows.map((r) => r.turnover_date).sort();
  const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : "";
  const total_incl = round2(records.reduce((s, r) => s + (r.total_incl ?? 0), 0));
  return { ok: !error, days: records.length, span, total_incl, rejected: [] };
}

export interface LedgerBookResult {
  ok: boolean;
  days: number;
  span: string;
  /** [DUP-DAY] De dag die het blad twee keer noemt. */
  duplicateDay?: string;
  /** [GEEN-STILLE-KAP] Het aantal rijen waarmee het bestand het plafond overschreed. */
  tooMany?: number;
}

/**
 * Upsert per-day ledger totals into ledger_daily (a reconciliation WITNESS — never the P&L).
 * Idempotent on (user, ledger_date, kind). Gross day-totals are ≥ 0 (a refund lives in 'spent').
 */
export async function bookLedgerRows(
  supabase: AnySupabase,
  userId: string,
  kind: LedgerKind,
  accountNr: string | null,
  rows: { ledger_date: string; received: number; spent: number }[],
): Promise<LedgerBookResult> {
  // [GEEN-STILLE-KAP] slice(0, 1000) rapporteerde de afgekapte telling als succes: "1000 dagen
  // (…)" over een bestand met meer, en niets zei dat er rijen vielen. De handmatige route
  // WEIGERT >1000 met uitleg — het juiste gedrag, aan de verkeerde kant van de gedeelde
  // schrijver. Nu weigert de schrijver zelf, zodat elke deur dezelfde eerlijke uitkomst geeft.
  if (rows.length > 1000) {
    return { ok: false, days: 0, span: "", tooMany: rows.length };
  }
  // [DUP-DAY] Zelfde 21000-val als bij dagomzet: één dubbel genoemde dag laat anders de hele
  // upsert vallen met een niets-zeggende fout.
  const seenLedgerDay = new Set<string>();
  for (const r of rows) {
    if (seenLedgerDay.has(r.ledger_date)) {
      return { ok: false, days: 0, span: "", duplicateDay: r.ledger_date };
    }
    seenLedgerDay.add(r.ledger_date);
  }
  const records = rows.map((r) => ({
    user_id: userId,
    ledger_date: r.ledger_date,
    kind,
    received: r.received > 0 ? r.received : 0,
    spent: r.spent > 0 ? r.spent : 0,
    account_nr: accountNr,
    source: "ledger_xlsx",
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("ledger_daily").upsert(records, { onConflict: "user_id,ledger_date,kind" });
  const dates = records.map((r) => r.ledger_date).sort();
  const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : "";
  return { ok: !error, days: records.length, span };
}
