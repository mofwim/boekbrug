// src/lib/verkoop-overzicht.ts
// [NAMENS] Het werkbord van de verkoper: wat staat er open, en mag ik daar iets aan doen?
// Run: npx tsx --test src/lib/verkoop-overzicht.test.ts
//
// WAAROM DIT EEN EIGEN MODULE IS
//
// Iemand die facturen maakt, maakt ze niet om ze te maken — hij maakt ze om betaald te worden.
// Een scherm dat alleen "hier zijn je facturen" zegt laat het halve werk liggen: welke staat er
// nog open, welke is te laat, en hoeveel geld is dat samen.
//
// Alles hier is puur. De klok komt binnen als parameter (`nowMs`), zodat de test exact is en er
// nooit een `new Date()` in een render belandt (react-hooks/purity).
//
// WAT HIER NADRUKKELIJK NIET STAAT
// Geen bankgegevens, geen winst, geen kosten. De verkoper ziet van elke factuur die HIJ maakte
// of hij betaald is — niet hoe het bedrijf ervoor staat. 'betaald' komt uit invoices.status, dat
// de eigenaar of de bankafstemming zet; de verkoper leest het, hij zet het nooit.

export type FactuurStand = "concept" | "open" | "te-laat" | "betaald" | "vervallen";

export interface VerkoopFactuur {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  client_email: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  status: string | null;
  /** ISO-tijd van de laatst verstuurde herinnering, of null. */
  laatste_herinnering?: string | null;
  /** Hoeveel herinneringen er al uit gingen — de cron-tiers meegeteld. */
  herinneringen?: number;
}

/**
 * In welke stand staat deze factuur, in de woorden die de verkoper gebruikt?
 *
 * 'vervallen' is de restbak voor een geannuleerde/gearchiveerde factuur. Die valt bewust NIET
 * onder 'open': hem meetellen in "wat moet er nog binnenkomen" is een getal dat niet klopt.
 */
export function standVan(f: VerkoopFactuur, nowMs: number): FactuurStand {
  const s = (f.status ?? "").toLowerCase();
  if (s === "draft") return "concept";
  if (s === "paid") return "betaald";
  if (s === "archived" || s === "cancelled" || s === "credited") return "vervallen";
  // 'sent' en 'overdue' zijn allebei "verstuurd, nog niet betaald". Of het TE LAAT is, bepaalt de
  // vervaldatum — niet de status, want die wordt pas door een cron bijgewerkt en loopt dus achter.
  const due = f.due_date ? Date.parse(`${f.due_date}T23:59:59.999Z`) : NaN;
  if (Number.isFinite(due) && nowMs > due) return "te-laat";
  return "open";
}

/** Wat er nog binnen moet komen. Nooit negatief, en nooit meer dan het totaal. */
export function openstaandBedrag(f: VerkoopFactuur): number {
  const totaal = typeof f.total_inc_btw === "number" && Number.isFinite(f.total_inc_btw)
    ? Math.abs(f.total_inc_btw)
    : 0;
  const betaald = typeof f.amount_paid === "number" && Number.isFinite(f.amount_paid) && f.amount_paid > 0
    ? f.amount_paid
    : 0;
  const rest = totaal - betaald;
  return rest <= 0 ? 0 : Math.round(rest * 100) / 100;
}

export interface VerkoopTotalen {
  concepten: number;
  open: number;
  teLaat: number;
  betaald: number;
  /** Som van alles wat nog binnen moet komen — open én te laat. */
  openstaand: number;
  /** Alleen het te late deel. Dit is het getal waar iemand vandaag iets aan kan doen. */
  teLaatBedrag: number;
}

export function telOp(facturen: readonly VerkoopFactuur[], nowMs: number): VerkoopTotalen {
  const t: VerkoopTotalen = { concepten: 0, open: 0, teLaat: 0, betaald: 0, openstaand: 0, teLaatBedrag: 0 };
  for (const f of facturen) {
    const stand = standVan(f, nowMs);
    const rest = openstaandBedrag(f);
    if (stand === "concept") t.concepten++;
    else if (stand === "betaald") t.betaald++;
    else if (stand === "open") { t.open++; t.openstaand += rest; }
    else if (stand === "te-laat") { t.teLaat++; t.openstaand += rest; t.teLaatBedrag += rest; }
    // 'vervallen' telt nergens in mee — zie standVan.
  }
  // Afronden ná het optellen: per stuk afronden en dan optellen geeft een ander getal dan de
  // som van de echte bedragen, en dat verschil is precies waar iemand over gaat bellen.
  t.openstaand = Math.round(t.openstaand * 100) / 100;
  t.teLaatBedrag = Math.round(t.teLaatBedrag * 100) / 100;
  return t;
}

// ── Mag er een herinnering uit? ───────────────────────────────────────────────────────────────

/** Meer dan dit met de hand versturen is geen herinneren meer. */
export const MAX_HANDMATIGE_HERINNERINGEN = 3;
/** Zo lang moet er tussen twee herinneringen zitten — ook tussen een cron-mail en een handmatige. */
export const HERINNERING_RUSTDAGEN = 3;

export type HerinneringOordeel =
  | { mag: true }
  | { mag: false; reden: string };

/**
 * Mag deze factuur nu een herinnering krijgen?
 *
 * DE REDEN DAT DIT ZO STRENG IS
 * Aan de andere kant van deze knop zit een KLANT van de ondernemer, geen gebruiker van ons. Een
 * herinnering te veel kost die ondernemer een relatie, en dat is een schade die hij niet zelf
 * heeft veroorzaakt en niet kan terugdraaien. Daarom faalt dit naar "nee, en dit is waarom" —
 * met een zin die de verkoper kan lezen, niet een knop die niets doet.
 */
export function magHerinneren(f: VerkoopFactuur, nowMs: number): HerinneringOordeel {
  const stand = standVan(f, nowMs);
  if (stand === "concept") return { mag: false, reden: "Deze factuur is nog niet verstuurd." };
  if (stand === "betaald") return { mag: false, reden: "Deze factuur is betaald." };
  if (stand === "vervallen") return { mag: false, reden: "Deze factuur telt niet meer mee." };
  if (openstaandBedrag(f) <= 0) {
    // Volledig betaald terwijl de status nog niet is bijgewerkt. Een herinnering sturen over
    // geld dat al binnen is, is de pijnlijkste mail die dit product kan versturen.
    return { mag: false, reden: "Er staat niets meer open op deze factuur." };
  }
  if (!f.client_email) return { mag: false, reden: "Deze klant heeft geen e-mailadres." };
  if (stand !== "te-laat") {
    return { mag: false, reden: "De vervaldatum is nog niet voorbij — herinneren kan vanaf dan." };
  }
  if ((f.herinneringen ?? 0) >= MAX_HANDMATIGE_HERINNERINGEN) {
    return {
      mag: false,
      reden: `Er zijn al ${MAX_HANDMATIGE_HERINNERINGEN} herinneringen verstuurd. Vraag je werkgever wat er verder moet gebeuren.`,
    };
  }
  if (f.laatste_herinnering) {
    const ms = Date.parse(f.laatste_herinnering);
    if (Number.isFinite(ms)) {
      const dagen = (nowMs - ms) / 86_400_000;
      if (dagen < HERINNERING_RUSTDAGEN) {
        const nog = Math.max(1, Math.ceil(HERINNERING_RUSTDAGEN - dagen));
        return { mag: false, reden: `Er ging net een herinnering uit. Wacht nog ${nog} dag${nog === 1 ? "" : "en"}.` };
      }
    } else {
      // Onleesbare datum: dan weten we niet wanneer de vorige uitging, en is stilstaan het
      // veilige antwoord. Liever een dag te laat herinnerd dan een klant twee keer op één dag.
      return { mag: false, reden: "De vorige herinnering is niet te dateren — probeer het morgen." };
    }
  }
  return { mag: true };
}

/**
 * Het volgende `day_offset` voor een HANDMATIGE herinnering.
 *
 * De cron gebruikt positieve tiers (14, 30) en invoice_reminders heeft UNIQUE(invoice_id,
 * day_offset). Handmatige verzendingen krijgen daarom NEGATIEVE nummers: -1, -2, -3. Zo botsen
 * ze nooit met een cron-tier, blijft elke verzending een eigen regel in het spoor, en blijft de
 * unieke index doen waarvoor hij bestaat.
 */
export function volgendeHandmatigeOffset(alGebruikt: readonly number[]): number {
  const handmatig = alGebruikt.filter((n) => n < 0);
  return handmatig.length === 0 ? -1 : Math.min(...handmatig) - 1;
}
