// src/lib/kasboek-match.ts
// [KASBOEK-NAAST-KAS] Het kasboek van de boekhouder, dag voor dag naast de kas van de app. Puur.
// Run: npx tsx --test src/lib/kasboek-match.test.ts
//
// ── WAAROM PER DAG, EN NIET PER REGEL ──
//
// De verleiding is om regel tegen regel te leggen: dit bedrag in het bestand hoort bij díe boeking
// in de app. Dat werkt niet, en het echte bestand laat precies zien waarom. De boekhouder schrijft
//
//     08-04   € 1.754,35   "hano 006220 en 006305 : 1.591,83 ,,  famzfood : 162,52"
//
// op ÉÉN regel. Daar zitten drie betalingen in, waarvan de app er één al kent (via de factuur
// waarmee ze is voldaan) en twee niet. Een koppeling op bedrag vindt hier niets, en een koppeling
// die "ongeveer" matcht verzint welke factuur bedoeld is.
//
// Dus wordt er vergeleken op het niveau waarop het bestand geschreven IS: de dag. Wat die dag uit
// de lade ging volgens de boekhouder, tegen wat de app die dag kent. Het VERSCHIL is wat er
// ontbreekt — geen gok, gewoon aftrekken.
//
// ── DE DRIE UITKOMSTEN, EN WAAROM DE DERDE NIET WORDT "OPGELOST" ──
//
//   gelijk     de dag klopt aan beide kanten. Verschijnt niet op het scherm: een lijst van 91
//              dagen waarvan er 84 in orde zijn, is een lijst die niemand afloopt.
//   ontbreekt  het bestand kent meer uitgaven dan de app. Dít is het gat, en dit is het enige wat
//              geboekt KAN worden.
//   app_meer   de app kent een uitgave die niet in het kasboek staat. Wordt gemeld en NOOIT
//              verwijderd: dat zou betekenen dat de app besluit dat de boekhouder gelijk heeft over
//              een boeking die de ondernemer zelf heeft gedaan — en die boeking hangt vaak aan een
//              factuur met een bon eronder. Dat is een gesprek, geen knop.
//
// ── EN WAT HIER NIET WORDT VERGELEKEN ──
//
// De ONTVANGSTEN. Die komen in de app uit de dagomzet, met btw-tarieven en al, en die kant klopte
// bij de gemeten klant tot op de cent. Een tweede weg om contante omzet te boeken zou hem dubbel
// in de btw-aangifte zetten. Ontvangsten reizen hier dus mee als informatie en zijn nooit
// aanvinkbaar — dat is het werk van de dagomzet-import, en van niets anders.

import { round2 } from "./invoice-totals";
import type { KasboekImportRow } from "./kasboek-import";

export type DayVerdict = "gelijk" | "ontbreekt" | "app_meer";

export interface KasboekDayMatch {
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Wat de boekhouder die dag uit de lade boekte. */
  fileSpent: number;
  /** Wat de app die dag aan contante uitgaven kent. */
  appSpent: number;
  /** fileSpent − appSpent. Positief = de app mist dit bedrag. */
  delta: number;
  verdict: DayVerdict;
  /** De omschrijving uit het bestand, ongewijzigd — daar staat WAT er is betaald. */
  description: string | null;
  /** Ter informatie: de ontvangsten van die dag aan beide kanten. Nooit boekbaar hier. */
  fileReceived: number;
  appReceived: number;
}

export interface KasboekMatchSummary {
  days: number;
  /** Dagen met een gat, en wat ze samen groot zijn — het bedrag dat de lade te hoog staat. */
  missingDays: number;
  missingTotal: number;
  /** Dagen waarop de app méér weet dan het kasboek. Alleen melden. */
  extraDays: number;
  extraTotal: number;
  /** Dagen die aan beide kanten hetzelfde zeggen. */
  equalDays: number;
}

/** Wat de app per dag kent. Ontbrekende dag = niets geboekt, wat iets anders is dan nul euro. */
export interface AppDayTotals {
  /** ISO datum → contante uitgaven die de app die dag kent. */
  spent: ReadonlyMap<string, number>;
  /** ISO datum → contante ontvangsten die de app die dag kent (dagomzet). */
  received: ReadonlyMap<string, number>;
}

/** Eén cent. Daaronder is het afronding, en een melding erover leert mensen deze lijst overslaan. */
const CENT = 0.005;

/**
 * Leg het gelezen kasboek naast de kas van de app, dag voor dag.
 *
 * Geeft ELKE dag terug, ook de gelijke: het scherm filtert, en een functie die alvast weglaat maakt
 * het onmogelijk om te zeggen "84 van de 91 dagen kloppen" — wat precies de zin is die vertrouwen
 * geeft in de zeven die dat niet doen.
 */
export function matchKasboekDays(
  rows: readonly KasboekImportRow[],
  app: AppDayTotals,
): { days: KasboekDayMatch[]; summary: KasboekMatchSummary } {
  const days: KasboekDayMatch[] = [];

  for (const r of rows) {
    const fileSpent = round2(r.spent);
    const appSpent = round2(app.spent.get(r.date) ?? 0);
    const delta = round2(fileSpent - appSpent);
    const verdict: DayVerdict =
      delta > CENT ? "ontbreekt" : delta < -CENT ? "app_meer" : "gelijk";

    days.push({
      date: r.date,
      fileSpent,
      appSpent,
      delta,
      verdict,
      description: r.spentDescription,
      fileReceived: round2(r.received),
      appReceived: round2(app.received.get(r.date) ?? 0),
    });
  }

  const missing = days.filter((d) => d.verdict === "ontbreekt");
  const extra = days.filter((d) => d.verdict === "app_meer");

  return {
    days,
    summary: {
      days: days.length,
      missingDays: missing.length,
      missingTotal: round2(missing.reduce((s, d) => s + d.delta, 0)),
      extraDays: extra.length,
      extraTotal: round2(extra.reduce((s, d) => s + Math.abs(d.delta), 0)),
      equalDays: days.filter((d) => d.verdict === "gelijk").length,
    },
  };
}

/**
 * De zin boven de lijst. Nederlands, want de ondernemer leest hem.
 *
 * Hij noemt eerst wat er KLOPT. Een scherm dat opent met zeven problemen over een kasboek waarvan
 * 84 dagen in orde zijn, leest als "je administratie is stuk" — en dat is niet waar, en het is ook
 * niet wat er moet gebeuren.
 */
export function matchHeadline(s: KasboekMatchSummary): string {
  const eur = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (s.days === 0) return "Er zijn geen dagen uit dit kasboek gelezen.";
  if (s.missingDays === 0 && s.extraDays === 0) {
    return `Alle ${s.days} dagen kloppen: je kas zegt hetzelfde als het kasboek van je boekhouder.`;
  }
  const delen: string[] = [`${s.equalDays} van de ${s.days} dagen kloppen`];
  if (s.missingDays > 0) {
    delen.push(
      `op ${s.missingDays === 1 ? "1 dag" : `${s.missingDays} dagen`} mist je kas samen ${eur(s.missingTotal)} aan uitgaven`,
    );
  }
  if (s.extraDays > 0) {
    delen.push(
      `en op ${s.extraDays === 1 ? "1 dag" : `${s.extraDays} dagen`} kent je kas ${eur(s.extraTotal)} die niet in het kasboek staat`,
    );
  }
  return `${delen.join(", ")}.`;
}

/**
 * Wat een aangevinkte dag zou boeken.
 *
 * Alleen het VERSCHIL, nooit het hele bedrag van de regel: het deel dat de app al kent staat er al,
 * en dat er nog eens bij boeken verlaagt het kassaldo met een uitgave die twee keer bestaat. Dat is
 * de fout die niemand terugvindt, want beide regels zien er correct uit.
 */
export function bookableAmount(day: KasboekDayMatch): number | null {
  return day.verdict === "ontbreekt" ? day.delta : null;
}
