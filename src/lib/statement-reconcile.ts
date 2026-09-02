// src/lib/statement-reconcile.ts
// [STATEMENT-RECONCILE] Het rekeningoverzicht van een leverancier als KAASSCHAAF over je eigen
// administratie: welke factuur die de leverancier noemt, heb ik niet?
//
// WAAROM DIT BESTAAT
// Een rekeningoverzicht ("openstaande posten", "saldo-overzicht") is de enige papieren bron die
// van BUITEN vertelt wat je zou moeten hebben. Tot nu toe herkende de app zo'n overzicht wel
// (ai.ts: is_statement / isStatementFilename) en zette het bewust NIET in de boeken — terecht,
// want de optelsom ervan boeken telt de losse facturen dubbel — maar deed er daarna niets mee.
// De ene ontbrekende inkoopfactuur die de eigenaar geld kost (voorbelasting die hij niet
// terugvraagt, een kostenpost die niet in de winst zit) staat er letterlijk op, met nummer.
//
// WAT DIT MODULE WEL EN NIET DOET
//   ✔ Vergelijken: overzichtsregels × de facturen die we al van deze leverancier hebben.
//   ✔ Benoemen wat ONTBREEKT (met nummer, datum en bedrag), wat we hebben, en wat we hebben
//     maar genegeerd — dat laatste is geen gat maar wel een beslissing om te herzien.
//   ✘ NIETS boeken. Geen factuur aanmaken, geen bedrag optellen, geen BTW afleiden. Het
//     overzicht is een AANWIJZING, geen bewijsstuk: de eigenaar haalt de echte factuur op.
//   ✘ Nooit alarm slaan op een regel die we niet konden lezen. Een onleesbare regel is
//     'onleesbaar', niet 'ontbrekend' — een vals gat kost meer vertrouwen dan het oplevert.
//
// Puur en zonder I/O, zodat de matchregels los te testen zijn (statement-reconcile.test.ts).

import { round2 } from "./invoice-totals";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Eén regel zoals hij op het overzicht van de leverancier staat. */
export interface StatementLine {
  /** Het factuurnummer zoals de leverancier het afdrukt (mag null zijn). */
  invoice_number: string | null;
  /** Factuurdatum, ISO (YYYY-MM-DD). Null als het overzicht er geen toont. */
  date: string | null;
  /** Bedrag zoals afgedrukt. Positief = door ons te betalen; negatief = creditnota/betaling. */
  amount: number | null;
  /**
   * Wat voor regel dit is. Alleen 'invoice' en 'credit' zijn stukken die WIJ moeten hebben;
   * 'payment' (onze eigen betaling) en 'other' (saldoregel, subtotaal, aanmaningskosten)
   * horen niet in de vergelijking en worden apart gezet.
   */
  kind: "invoice" | "credit" | "payment" | "other";
  /** Vrije omschrijving van de regel, puur om de eigenaar te helpen herkennen. */
  description?: string | null;
}

/** Een inkoopfactuur zoals wij hem al hebben opgeslagen. */
export interface BookedInvoice {
  id: string;
  invoice_number: string | null;
  /** ISO (YYYY-MM-DD) of null wanneer de datum nog niet is ingevuld. */
  invoice_date: string | null;
  total_inc_btw: number | null;
  /** 'processing' (wachtrij) | 'received' (geboekt, te betalen) | 'paid' | 'archived' (genegeerd). */
  status: string;
  /**
   * [TWEE-BOEKEN] Waarom er een BEWIJS-veld naast de status staat.
   *
   * Een leverancier stuurt een openstaande-postenlijst met factuur 2034488 erop. Wij hebben hem
   * als 'paid'. Die twee spreken elkaar tegen, en tot nu toe belandde die regel in `matched` en
   * meldde de app "alle facturen op dit overzicht heb je al" — het ENE externe document dat de
   * eigen boeken tegenspreekt, gelezen als bevestiging.
   *
   * Maar niet elke tegenspraak weegt even zwaar, en het verschil is precies dit veld. Staat er een
   * BANKREGEL onder de betaling, dan is het geld aantoonbaar vertrokken en loopt de leverancier
   * hoogstwaarschijnlijk achter met verwerken. Is het een handmatige afvinking, dan is er aan onze
   * kant alleen een herinnering — en dan is de leverancier de enige partij met bewijs.
   *
   * true = een bankregel draagt de betaling. false = afgevinkt, of niet betaald.
   * Weglaten ⇒ false: zonder informatie is er geen bewijs, en dat is de voorzichtige kant.
   */
  paymentHasBankProof?: boolean;
}

export type MatchHow = "number" | "number_tail" | "amount_date";

export interface MatchedPair {
  line: StatementLine;
  invoice: BookedInvoice;
  how: MatchHow;
}

export interface ReconcileResult {
  /** Regels die we terugvinden in de administratie (en niet genegeerd zijn). */
  matched: MatchedPair[];
  /**
   * Regels die de leverancier noemt en die wij NIET hebben. Dit is waar het hele module om
   * draait — elke regel hier is een factuur die de eigenaar nog moet ophalen.
   */
  missing: StatementLine[];
  /**
   * Gevonden, maar de eigenaar had hem genegeerd (status 'archived'). Geen gat in de
   * administratie, wél een beslissing om te herzien: de leverancier vindt hem nog open.
   */
  archived: MatchedPair[];
  /**
   * Facturen die WIJ hebben binnen de periode van het overzicht maar die er niet op staan.
   * Meestal onschuldig (al betaald vóór de overzichtsdatum, of net nieuwer), soms het signaal
   * dat er iets dubbel in de boeken staat. Nooit als fout gepresenteerd — als vraag.
   */
  notOnStatement: BookedInvoice[];
  /** Regels die geen factuur zijn (betaling, saldo, subtotaal) — buiten de vergelijking. */
  skipped: StatementLine[];
  /** Regels die we niet konden lezen (geen nummer én geen bedrag) — nooit als 'ontbrekend' geteld. */
  unreadable: StatementLine[];
  /** De periode die het overzicht beslaat, afgeleid uit de regeldata (null als er geen datums zijn). */
  period: { from: string; to: string } | null;
  /** Som van de ontbrekende bedragen (absolute waarden), voor één eerlijke kopregel. */
  missingAmount: number;
  /**
   * [TWEE-BOEKEN] Regels die de leverancier NOG NOEMT terwijl wij ze als betaald hebben staan.
   *
   * Twee boekhoudingen over dezelfde factuur, en ze zijn het oneens. Dit is de enige controle in
   * de app waarbij een BUITENSTAANDER de eigen boeken tegenspreekt — de bank kan alleen zeggen wat
   * er van de rekening ging, niet of de leverancier het heeft ontvangen en verwerkt.
   *
   * Een deelverzameling van `matched`, nooit in plaats daarvan: de factuur IS gevonden, dat deel
   * van het antwoord blijft waar. Alleen de conclusie "dus is het in orde" vervalt.
   */
  alsoPaid: MatchedPair[];
  /**
   * Ziet dit overzicht eruit als een OPENSTAANDE-POSTENLIJST?
   *
   * Waarom dit erbij hoort en niet weggelaten kan worden: op een periodeoverzicht (alle facturen
   * van mei, betaald en onbetaald) is een betaalde factuur volstrekt normaal en zou `alsoPaid`
   * elke maand vals alarm slaan. Op een openstaande-postenlijst is dezelfde regel een tegenspraak.
   *
   * Het onderscheid rust op één waarneembaar feit, geen gok: een periodeoverzicht toont ONZE
   * betalingen als regels ('payment'), een openstaandelijst per definitie niet. Geen betaalregels
   * en wel factuurregels ⇒ openstaandelijst.
   */
  looksLikeOpenItems: boolean;
}

export interface ReconcileInput {
  lines: StatementLine[];
  booked: BookedInvoice[];
  /**
   * De periode die het overzicht zelf noemt ("openstaand per 31-05-2026", "mei 2026"), als de
   * lezer die van de kop kon halen. Beter dan de afgeleide periode: bij een overzicht met één
   * regel is het afgeleide venster één dag breed, en dan zegt `notOnStatement` niets zinnigs.
   * Weglaten ⇒ afleiden uit de regeldata.
   */
  period?: { from: string; to: string } | null;
  /** Bedragtolerantie in euro voor de amount+date-match. Default 2 cent (afrondingsverschil). */
  toleranceEur?: number;
  /** Datumvenster in dagen voor de amount+date-match. Default 7 (boekdatum ≠ factuurdatum). */
  dateWindowDays?: number;
}

// ─── Normalisatie ─────────────────────────────────────────────────────────────

/**
 * Factuurnummers vergelijken zoals een mens het doet: hoofdletters, streepjes, spaties en
 * punten zeggen niets. "2026-0118", "2026 0118" en "20260118" zijn hetzelfde nummer.
 */
export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * De "staart" van een nummer: het laatste cijferblok zonder voorloopnullen. Leveranciers drukken
 * op een overzicht vaak een korter nummer af dan op de factuur zelf ("118" tegenover "F2026-0118").
 * Zwakker dan een volledige match, dus alleen als tweede kans — en alleen bij 3+ cijfers, anders
 * koppelt "1" aan alles.
 */
export function invoiceNumberTail(raw: string | null | undefined): string {
  if (!raw) return "";
  // Bewust op de RUWE tekst: het scheidingsteken bepaalt waar het laatste cijferblok begint.
  // Op de genormaliseerde tekst ("F20260118") is dat blok niet meer te vinden en zou "0118"
  // stilzwijgend "20260118" worden — precies de match die dan nooit lukt.
  const groups = String(raw).match(/\d+/g);
  if (!groups || groups.length === 0) return "";
  const digits = groups[groups.length - 1].replace(/^0+/, "");
  // Onder de 3 cijfers is een staart geen identificatie meer maar een gok ("1" past overal).
  return digits.length >= 3 ? digits : "";
}

/** Dagen tussen twee ISO-datums; null wanneer een van beide ontbreekt of onleesbaar is. */
function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/** Een bedrag vergelijken op grootte — een creditnota staat negatief op het overzicht. */
function sameAmount(a: number | null | undefined, b: number | null | undefined, tol: number): boolean {
  if (a == null || b == null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
}

// ─── De vergelijking ──────────────────────────────────────────────────────────

/**
 * Vergelijk de regels van één leveranciersoverzicht met de facturen die wij van die leverancier
 * hebben. De aanroeper filtert `booked` al op de juiste leverancier — dit module kent geen
 * leveranciersnamen en gokt er dus ook nooit een.
 *
 * Volgorde van matchen (sterk → zwak), elke factuur wordt hoogstens één keer verbruikt:
 *   1. volledig genormaliseerd factuurnummer
 *   2. nummerstaart (3+ cijfers, zonder voorloopnullen)
 *   3. bedrag binnen tolerantie ÉN datum binnen het venster
 * Zwakker dan dit matchen we niet: liever een regel als 'ontbrekend' tonen die de eigenaar in
 * één blik herkent, dan twee stukken aan elkaar knopen die niets met elkaar te maken hebben.
 */
export function reconcileStatement(input: ReconcileInput): ReconcileResult {
  const tol = input.toleranceEur ?? 0.02;
  const windowDays = input.dateWindowDays ?? 7;

  const matched: MatchedPair[] = [];
  const archived: MatchedPair[] = [];
  const missing: StatementLine[] = [];
  const skipped: StatementLine[] = [];
  const unreadable: StatementLine[] = [];

  // Alleen factuur- en creditregels doen mee; de rest is geen stuk dat wij moeten hebben.
  const candidates: StatementLine[] = [];
  for (const line of input.lines ?? []) {
    if (line.kind === "payment" || line.kind === "other") {
      skipped.push(line);
      continue;
    }
    const hasNumber = !!normalizeInvoiceNumber(line.invoice_number);
    const hasAmount = line.amount != null && Number.isFinite(line.amount) && Math.abs(line.amount) > 0.004;
    // Zonder nummer én zonder bedrag valt er niets te zoeken — en dus ook niets te missen.
    if (!hasNumber && !hasAmount) {
      unreadable.push(line);
      continue;
    }
    candidates.push(line);
  }

  const used = new Set<string>();
  const byNumber = new Map<string, BookedInvoice[]>();
  const byTail = new Map<string, BookedInvoice[]>();
  for (const inv of input.booked ?? []) {
    const n = normalizeInvoiceNumber(inv.invoice_number);
    if (n) {
      const arr = byNumber.get(n) ?? [];
      arr.push(inv);
      byNumber.set(n, arr);
    }
    const t = invoiceNumberTail(inv.invoice_number);
    if (t) {
      const arr = byTail.get(t) ?? [];
      arr.push(inv);
      byTail.set(t, arr);
    }
  }

  const takeFirstFree = (list: BookedInvoice[] | undefined): BookedInvoice | null => {
    for (const inv of list ?? []) if (!used.has(inv.id)) return inv;
    return null;
  };

  const record = (line: StatementLine, invoice: BookedInvoice, how: MatchHow) => {
    used.add(invoice.id);
    // Genegeerd is gevonden-maar-buiten-de-boeken: apart, nooit stilzwijgend als 'in orde'.
    (invoice.status === "archived" ? archived : matched).push({ line, invoice, how });
  };

  for (const line of candidates) {
    const norm = normalizeInvoiceNumber(line.invoice_number);
    let hit = norm ? takeFirstFree(byNumber.get(norm)) : null;
    if (hit) {
      record(line, hit, "number");
      continue;
    }

    const tail = invoiceNumberTail(line.invoice_number);
    hit = tail ? takeFirstFree(byTail.get(tail)) : null;
    if (hit) {
      record(line, hit, "number_tail");
      continue;
    }

    // Laatste kans: bedrag + datum. Alleen wanneer BEIDE bekend zijn — bedrag alleen koppelt
    // twee toevallig gelijke facturen aan elkaar, en dat is precies het soort stille fout
    // waar deze hele controle tegen bestaat.
    if (line.amount != null && line.date) {
      const found = (input.booked ?? []).find((inv) => {
        if (used.has(inv.id)) return false;
        if (!sameAmount(line.amount, inv.total_inc_btw, tol)) return false;
        const d = daysBetween(line.date, inv.invoice_date);
        return d != null && d <= windowDays;
      });
      if (found) {
        record(line, found, "amount_date");
        continue;
      }
    }

    missing.push(line);
  }

  // Wat hebben WIJ binnen deze periode dat de leverancier niet noemt?
  const period = normalizePeriod(input.period) ?? derivePeriod(candidates);
  const notOnStatement = (input.booked ?? []).filter((inv) => {
    if (used.has(inv.id)) return false;
    if (inv.status === "archived") return false; // genegeerd: geen open vraag
    if (!period || !inv.invoice_date) return false; // zonder periode geen uitspraak
    return inv.invoice_date >= period.from && inv.invoice_date <= period.to;
  });

  const missingAmount = round2(
    missing.reduce((sum, l) => sum + (l.amount != null && Number.isFinite(l.amount) ? Math.abs(l.amount) : 0), 0)
  );

  // [TWEE-BOEKEN] Een openstaandelijst toont geen betalingen; een periodeoverzicht wel. Dat ene
  // waarneembare verschil beslist of een betaalde factuur op deze lijst een tegenspraak is of het
  // normaalste van de wereld — en het is af te lezen, niet te raden.
  const looksLikeOpenItems =
    candidates.length > 0 && !(input.lines ?? []).some((l) => l.kind === "payment");

  // Gevonden, betaald, en de leverancier noemt hem nog. Deelverzameling van `matched`: de factuur
  // is echt gevonden, alleen de conclusie "dus is het in orde" vervalt.
  const alsoPaid = matched.filter((m) => m.invoice.status === "paid");

  return {
    matched, missing, archived, notOnStatement, skipped, unreadable, period, missingAmount,
    alsoPaid, looksLikeOpenItems,
  };
}

/** Een door de lezer aangeleverde periode; alleen geldig als beide kanten echte ISO-datums zijn. */
function normalizePeriod(p: { from: string; to: string } | null | undefined): { from: string; to: string } | null {
  if (!p) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(p.from ?? "") || !iso.test(p.to ?? "")) return null;
  return p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from };
}

/** De periode die het overzicht beslaat, puur uit de regeldata (ISO-datums sorteren als tekst). */
export function derivePeriod(lines: StatementLine[]): { from: string; to: string } | null {
  const dates = lines
    .map((l) => l.date)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (dates.length === 0) return null;
  return { from: dates[0], to: dates[dates.length - 1] };
}

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.

// ─── Eén eerlijke zin voor de eigenaar ────────────────────────────────────────

/**
 * De kopregel die de eigenaar leest. Nooit "alles klopt" wanneer er regels onleesbaar waren —
 * dan weten we het gewoon niet, en dat zeggen we. Alleen tellen wat we echt vergeleken hebben.
 */
export function summarizeReconcile(r: ReconcileResult, vendor?: string | null): string {
  const compared = r.matched.length + r.archived.length + r.missing.length;
  const who = vendor ? ` van ${vendor}` : "";
  if (compared === 0) {
    return r.unreadable.length > 0
      ? `We konden de regels op dit overzicht${who} niet lezen — het staat wel in je bestanden.`
      : `Geen factuurregels gevonden op dit overzicht${who}.`;
  }
  const parts: string[] = [];
  // [TWEE-BOEKEN] "Alle facturen heb je al" mag niet meer als de leverancier iets nog open ziet
  // dat jij als betaald hebt staan. Dat was de zin die het enige externe document dat de eigen
  // boeken tegensprak, las als bevestiging — en die daarna niemand meer nakeek.
  const tegenspraak = r.looksLikeOpenItems ? r.alsoPaid : [];
  if (r.missing.length === 0 && tegenspraak.length === 0) {
    parts.push(`Alle ${compared} facturen op dit overzicht${who} heb je al.`);
  } else if (r.missing.length === 0) {
    parts.push(`Alle ${compared} facturen op dit overzicht${who} heb je al — maar niet allemaal met dezelfde stand.`);
  } else {
    parts.push(
      r.missing.length === 1
        ? `1 van de ${compared} facturen op dit overzicht${who} heb je niet.`
        : `${r.missing.length} van de ${compared} facturen op dit overzicht${who} heb je niet.`
    );
  }
  // De tegenspraak zelf, vóór de genegeerde en de onleesbare regels: dit is de enige regel op dit
  // overzicht waar geld aan hangt dat de eigenaar denkt kwijt te zijn.
  //
  // Twee zinnen, want de bewijslast verschilt. Draagt de betaling een BANKREGEL, dan is het geld
  // aantoonbaar vertrokken en loopt de leverancier waarschijnlijk achter — een geruststelling met
  // een actie erin. Is het een handmatige afvinking, dan heeft alleen de leverancier bewijs, en
  // dan is dit precies het geval waarin de eigenaar een tweede keer betaalt of een aanmaning krijgt
  // voor iets dat in zijn eigen app groen staat.
  if (tegenspraak.length > 0) {
    const metBank = tegenspraak.filter((m) => m.invoice.paymentHasBankProof === true).length;
    const zonderBank = tegenspraak.length - metBank;
    if (zonderBank > 0) {
      parts.push(
        zonderBank === 1
          ? "1 factuur die jij hebt afgevinkt als betaald, staat hier nog open — en er is geen bankregel die die betaling draagt. Controleer of hij echt betaald is."
          : `${zonderBank} facturen die jij hebt afgevinkt als betaald, staan hier nog open — en er is geen bankregel die die betalingen draagt. Controleer of ze echt betaald zijn.`
      );
    }
    if (metBank > 0) {
      parts.push(
        metBank === 1
          ? "1 factuur staat hier nog open terwijl jouw bank de betaling wél laat zien. Waarschijnlijk heeft je leverancier hem nog niet verwerkt."
          : `${metBank} facturen staan hier nog open terwijl jouw bank die betalingen wél laat zien. Waarschijnlijk heeft je leverancier ze nog niet verwerkt.`
      );
    }
  }
  if (r.archived.length > 0) {
    parts.push(
      r.archived.length === 1
        ? "1 daarvan had je genegeerd — de leverancier ziet hem nog open."
        : `${r.archived.length} daarvan had je genegeerd — de leverancier ziet ze nog open.`
    );
  }
  if (r.unreadable.length > 0) {
    parts.push(
      r.unreadable.length === 1
        ? "1 regel konden we niet lezen."
        : `${r.unreadable.length} regels konden we niet lezen.`
    );
  }
  return parts.join(" ");
}

/**
 * De regel die we op het opgeslagen bestand zelf zetten (documents.notes), zodat het overzicht
 * in Mijn bestanden zijn eigen uitkomst draagt — ook als de eigenaar het venster wegklikt.
 * Kort, feitelijk, met de nummers die hij moet gaan zoeken.
 */
export function reconcileNote(r: ReconcileResult, vendor?: string | null): string {
  const head = summarizeReconcile(r, vendor);
  // [TWEE-BOEKEN] De nummers van de tegenspraak horen op het bestand, om dezelfde reden als de
  // ontbrekende: een zin met een aantal erin is geen zin waarmee iemand kan gaan zoeken.
  const tegenspraak = r.looksLikeOpenItems ? r.alsoPaid : [];
  const betwist = tegenspraak.length > 0
    ? ` Nog open bij de leverancier, betaald in je administratie: ${tegenspraak
        .map((m) => m.invoice.invoice_number?.trim() || m.line.invoice_number?.trim() || "zonder nummer")
        .slice(0, 12)
        .join(", ")}.`
    : "";
  if (r.missing.length === 0) return head + betwist;
  const numbers = r.missing
    .map((l) => l.invoice_number?.trim() || (l.date ? `zonder nummer (${l.date})` : "zonder nummer"))
    .slice(0, 12);
  const more = r.missing.length > numbers.length ? ` en nog ${r.missing.length - numbers.length}` : "";
  return `${head}${betwist} Ontbreekt: ${numbers.join(", ")}${more}.`;
}
