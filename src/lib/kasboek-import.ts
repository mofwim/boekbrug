// src/lib/kasboek-import.ts
// [KASBOEK-LEZEN] Het kasboek van de boekhouder, gelezen. Puur — geen SheetJS, geen I/O.
// Run: npx tsx --test src/lib/kasboek-import.test.ts
//
// ── WAAROM DIT BESTAAT ──
//
// Een echte klant leverde "Kiwi 2de kw 2026.xlsx" aan: 91 dagen kasboek in de lopende-saldo-vorm
// die elke Nederlandse boekhouder gebruikt — en die dit product ZELF exporteert (kasboek.ts →
// kasboekToMatrix). De app las hem niet. planSpreadsheetIngest gaf 'unknown', dus /api/intake
// bewaarde hem als een dichtgeplakt document.
//
// Dat was niet cosmetisch. Gemeten op datzelfde kwartaal:
//
//     ontvangsten in het bestand   € 25.209,05   ·   in de app   € 25.209,05   ✓ tot op de cent
//     uitgaven    in het bestand   € 22.377,02   ·   in de app   €  1.402,87   ✗
//
// De ontvangstenkant klopt (die komt uit de dagomzet-import). De UITGAVEN staan er bijna niet in:
// alleen wat via een factuur contant is afgeboekt. Trimex, salaris, privé-opnames, de meeste
// marktinkopen — die leven alleen in dit bestand. Gevolg: de lade staat in de app ruim €19.000 te
// hoog, en dat is precies het getal waar de Belastingdienst een kasadministratie op afwijst.
//
// ── WAT DIT MODULE WEL DOET, EN WAT MET OPZET NIET ──
//
// Het LEEST, het TELT, en het VERGELIJKT. Het schrijft niets, en er is één harde reden voor:
// een deel van die uitgaven staat al in de app, geboekt via de factuur die ermee betaald is. Een
// import die de kolom 'Uitgaven' klakkeloos overneemt boekt die dubbel — in het kasboek, waar een
// dubbele uitgave het saldo verlaagt en niemand het merkt tot de lade niet meer klopt. Welke regel
// welke bestaande boeking IS, kan alleen de eigenaar zeggen: de boekhouder schrijft "hano 006220 en
// 006305 : 1.591,83 ,, famzfood : 162,52" op één regel van € 1.754,35, en dat zijn drie boekingen
// achter één bedrag.
//
// Daarom levert dit een LEESRESULTAAT met een vergelijking, en laat het de beslissing bij de mens.
//
// ── DE CONTROLE DIE HET BESTAND ZELF MEEBRENGT ──
//
// Elke regel draagt beginsaldo, uitgaven, ontvangsten én eindsaldo. Dat maakt het bestand
// zelfcontrolerend op twee manieren, en allebei worden ze gebruikt:
//   1. PER REGEL   begin + ontvangsten − uitgaven = eind.
//   2. PER KETEN   het eindsaldo van gisteren is het beginsaldo van vandaag.
// De tweede is de sterkste: hij vindt de dag die ONTBREEKT, en dat is precies waar een hele
// weekomzet in verdwijnt zonder dat één regel er verkeerd uitziet.

import { round2 } from "./invoice-totals";
import type { Cell } from "./turnover-import";

/** Eén dag uit het kasboek, zoals het bestand hem opschrijft. */
export interface KasboekImportRow {
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Beginsaldo van die dag, zoals het bestand het noemt. */
  opening: number;
  /** Wat er die dag uit de lade ging (≥ 0). */
  spent: number;
  /** De omschrijving bij de uitgave, ongewijzigd — daar staat WELKE facturen erin zitten. */
  spentDescription: string | null;
  /** Wat er die dag in de lade kwam (≥ 0). */
  received: number;
  receivedDescription: string | null;
  /** Eindsaldo van die dag, zoals het bestand het noemt. */
  closing: number;
}

export interface KasboekImportWarning {
  /** 1-gebaseerd regelnummer zoals de eigenaar het in Excel ziet. 0 = over het hele blad. */
  row: number;
  code: "regel_telt_niet_op" | "keten_breekt" | "datum_buiten_bereik" | "geen_regels";
  /** Nederlands, want de eigenaar en zijn boekhouder lezen dit. */
  message: string;
}

export interface KasboekImportResult {
  rows: KasboekImportRow[];
  /** Het beginsaldo van de EERSTE dag — de openingsstand van de lade. */
  openingBalance: number | null;
  /** Het eindsaldo van de LAATSTE dag. */
  closingBalance: number | null;
  totalReceived: number;
  totalSpent: number;
  warnings: KasboekImportWarning[];
}

const norm = (c: Cell): string =>
  String(c ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const num = (c: Cell): number | null => {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const t = c.trim().replace(/[€\s]/g, "");
    if (t === "") return null;
    // Nederlandse notatie: 1.234,56 — de laatste separator is de decimale.
    const cleaned = t.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Excel-serienummer → ISO. Alleen het 1900-stelsel: dat is wat Excel en SheetJS hier leveren. */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return null;
  // 25569 = 1970-01-01 in Excel-serienummers. UTC-rekenwerk, geen lokale tijdzone: een kasdag is
  // een KALENDERDAG, en een uur verschuiving zet hem een dag terug (format-nl.ts:17-23).
  const ms = (serial - 25569) * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Een datumcel → ISO, of null. Accepteert het serienummer én een reeds geformatteerde datum. */
export function kasboekDate(cell: Cell): string | null {
  if (typeof cell === "number") return serialToIso(cell);
  if (typeof cell === "string") {
    const t = cell.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    const nl = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
    if (nl) return `${nl[3]}-${nl[2].padStart(2, "0")}-${nl[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Herkent dit blad als een kasboek in de lopende-saldo-vorm?
 *
 * Op de KOPPEN, niet op de kolomvolgorde: elk kantoor schuift kolommen. Beginsaldo én eindsaldo
 * moeten er allebei staan — dat is wat dit blad onderscheidt van een grootboekoverzicht, dat wel
 * uitgaven en ontvangsten kent maar geen lopend saldo.
 */
export function looksLikeKasboekSheet(matrix: Cell[][]): boolean {
  return headerRowIndex(matrix) !== -1;
}

/** De regel met de kolomkoppen, of -1. Alleen de eerste 12 regels: daarboven staat hooguit een titel. */
function headerRowIndex(matrix: Cell[][]): number {
  for (let i = 0; i < Math.min(12, matrix.length); i += 1) {
    const cells = (matrix[i] ?? []).map(norm);
    const heeft = (re: RegExp) => cells.some((c) => re.test(c));
    if (heeft(/^beginsaldo$/) && heeft(/^eindsaldo$/) && heeft(/^uitgaven$/) && heeft(/^ontvangsten$/)) {
      return i;
    }
  }
  return -1;
}

/** Kolomposities, gelezen uit de koprij. -1 wanneer een kop ontbreekt. */
function columns(headerCells: Cell[]): {
  opening: number; spent: number; spentDesc: number; received: number; receivedDesc: number; closing: number;
} {
  const c = headerCells.map(norm);
  const find = (re: RegExp) => c.findIndex((x) => re.test(x));
  const opening = find(/^beginsaldo$/);
  const spent = find(/^uitgaven$/);
  const received = find(/^ontvangsten$/);
  const closing = find(/^eindsaldo$/);
  // De omschrijving hoort bij de kolom die ervóór staat: "Uitgaven | Omschrijving | … |
  // Ontvangsten | Omschrijving". Op positie zoeken en niet op naam, want beide heten hetzelfde.
  const descAfter = (from: number) => {
    for (let i = from + 1; i < c.length && i <= from + 2; i += 1) if (/^omschrijving$/.test(c[i])) return i;
    return -1;
  };
  return { opening, spent, spentDesc: descAfter(spent), received, receivedDesc: descAfter(received), closing };
}

const text = (c: Cell): string | null => {
  const t = String(c ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Lees het kasboek.
 *
 * Geeft `null` wanneer dit blad geen kasboek is — dat is informatie, geen fout: de aanroeper
 * probeert de andere lezers en bewaart het bestand anders ongelezen.
 */
export function parseKasboekSheet(matrix: Cell[][]): KasboekImportResult | null {
  const h = headerRowIndex(matrix);
  if (h === -1) return null;
  const col = columns(matrix[h] ?? []);
  if (col.opening < 0 || col.spent < 0 || col.received < 0 || col.closing < 0) return null;

  const rows: KasboekImportRow[] = [];
  const warnings: KasboekImportWarning[] = [];
  let vorigEind: { date: string; closing: number } | null = null;

  for (let i = h + 1; i < matrix.length; i += 1) {
    const r = matrix[i] ?? [];
    // De datum staat vóór de saldokolommen; we nemen de eerste cel die een datum OPLEVERT, zodat
    // een blad met een extra hulpkolom links niet stukloopt.
    let date: string | null = null;
    for (let k = 0; k < Math.min(col.opening, r.length); k += 1) {
      date = kasboekDate(r[k]);
      if (date) break;
    }
    const opening = num(r[col.opening]);
    const closing = num(r[col.closing]);
    // Geen datum of geen saldi → dit is een maandkop, een lege regel of een totaalregel. Overslaan,
    // stil: een kasboek staat er vol mee en er is niets mis mee.
    if (!date || opening === null || closing === null) continue;

    if (date < "2000-01-01" || date > "2099-12-31") {
      warnings.push({ row: i + 1, code: "datum_buiten_bereik", message: `Regel ${i + 1}: de datum ${date} ligt buiten elk redelijk boekjaar.` });
      continue;
    }

    const spent = Math.abs(num(r[col.spent]) ?? 0);
    const received = Math.abs(num(r[col.received]) ?? 0);

    // 1) Telt de regel zelf op?
    const verwacht = round2(opening + received - spent);
    if (Math.abs(verwacht - round2(closing)) >= 0.005) {
      warnings.push({
        row: i + 1,
        code: "regel_telt_niet_op",
        message:
          `Regel ${i + 1} (${date}): beginsaldo + ontvangsten − uitgaven = ${verwacht.toFixed(2)}, ` +
          `maar het eindsaldo zegt ${round2(closing).toFixed(2)}.`,
      });
    }

    // 2) Sluit hij aan op gisteren? Dit is de controle die een ONTBREKENDE dag vindt — de regels
    //    die er staan kloppen dan allemaal, en toch mist er een week.
    if (vorigEind && Math.abs(round2(vorigEind.closing) - round2(opening)) >= 0.005) {
      warnings.push({
        row: i + 1,
        code: "keten_breekt",
        message:
          `Regel ${i + 1} (${date}): begint met ${round2(opening).toFixed(2)}, terwijl ${vorigEind.date} ` +
          `eindigde op ${round2(vorigEind.closing).toFixed(2)}. Er zit een dag of een boeking tussen die hier niet staat.`,
      });
    }

    rows.push({
      date,
      opening: round2(opening),
      spent: round2(spent),
      spentDescription: col.spentDesc >= 0 ? text(r[col.spentDesc]) : null,
      received: round2(received),
      receivedDescription: col.receivedDesc >= 0 ? text(r[col.receivedDesc]) : null,
      closing: round2(closing),
    });
    vorigEind = { date, closing };
  }

  if (rows.length === 0) {
    return {
      rows: [], openingBalance: null, closingBalance: null, totalReceived: 0, totalSpent: 0,
      warnings: [{ row: 0, code: "geen_regels", message: "Dit lijkt een kasboek, maar er staat geen enkele dagregel in die we konden lezen." }],
    };
  }

  return {
    rows,
    openingBalance: rows[0].opening,
    closingBalance: rows[rows.length - 1].closing,
    totalReceived: round2(rows.reduce((s, r) => s + r.received, 0)),
    totalSpent: round2(rows.reduce((s, r) => s + r.spent, 0)),
    warnings,
  };
}

/** Wat de app van deze periode al weet — de andere helft van de vergelijking. */
export interface KasboekAppState {
  /** Σ contante ontvangsten die de app voor deze periode kent (dagomzet + kasboekingen in). */
  received: number;
  /** Σ contante uitgaven die de app kent. */
  spent: number;
  /** De openingsstand die de app hanteert (profiles.kas_opening_balance + alles ervoor). */
  opening: number | null;
}

export interface KasboekComparison {
  receivedDelta: number;
  spentDelta: number;
  openingDelta: number | null;
  /** Nederlandse zinnen, één per verschil dat groot genoeg is om iets te betekenen. */
  findings: string[];
}

/**
 * Leg het gelezen kasboek naast wat de app heeft.
 *
 * Dit is het hele punt van het lezen zonder te schrijven: het bestand is de waarheid van de
 * boekhouder, de app is de waarheid van de ondernemer, en het VERSCHIL is wat iemand moet
 * oplossen. Een import die dat verschil zelf zou "wegwerken" verzint welke van de twee gelijk had.
 *
 * De drempel is één cent: kleiner dan dat is afronding, en een melding erover leert mensen deze
 * vergelijking over te slaan.
 */
export function compareKasboek(file: KasboekImportResult, app: KasboekAppState): KasboekComparison {
  const receivedDelta = round2(file.totalReceived - app.received);
  const spentDelta = round2(file.totalSpent - app.spent);
  const openingDelta =
    file.openingBalance === null || app.opening === null ? null : round2(file.openingBalance - app.opening);

  // Het VERSCHIL is een grootte ("er zit 20.974,15 tussen"), maar een SALDO heeft een teken, en
  // dat teken is hier het halve verhaal: een lade die op −892,86 begint is fysiek onmogelijk, en
  // dat is precies waar de Belastingdienst een kasadministratie op afwijst. Math.abs op een saldo
  // zou dat minteken wegpoetsen — de eerste versie van deze zin deed dat, en las daardoor als een
  // gewoon verschil van 1.911,18 tussen twee normale bedragen.
  const bedrag = (n: number) => `€ ${Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const eur = bedrag;
  const saldo = (n: number) => (n < 0 ? `−${bedrag(n)}` : bedrag(n));
  const findings: string[] = [];

  if (Math.abs(receivedDelta) >= 0.01) {
    findings.push(
      receivedDelta > 0
        ? `In het kasboek staat ${eur(receivedDelta)} méér aan contante ontvangsten dan in de app.`
        : `In de app staat ${eur(receivedDelta)} méér aan contante ontvangsten dan in het kasboek.`,
    );
  }
  if (Math.abs(spentDelta) >= 0.01) {
    findings.push(
      spentDelta > 0
        ? `In het kasboek staat ${eur(spentDelta)} aan contante uitgaven die de app niet kent. Zolang die ontbreken staat je kassaldo te hoog.`
        : `De app kent ${eur(spentDelta)} aan contante uitgaven die niet in dit kasboek staan.`,
    );
  }
  if (openingDelta !== null && Math.abs(openingDelta) >= 0.01) {
    findings.push(
      `De lade begint in dit kasboek op ${saldo(file.openingBalance ?? 0)} en in de app op ` +
        `${saldo(app.opening ?? 0)} — ${bedrag(openingDelta)} verschil op de openingsstand.` +
        ((app.opening ?? 0) < 0
          ? " Een kassaldo onder nul kan niet: er is meer uit de lade geboekt dan erin zat."
          : ""),
    );
  }
  if (findings.length === 0) {
    // Twee verschillende geruststellingen, en het verschil is precies de helft die NIET is
    // vergeleken. "Ontvangsten, uitgaven én openingsstand komen overeen" over een openingsstand
    // die we niet kenden, is de valse groene uitslag waar dit hele bestand omheen is gebouwd —
    // en de test die dat vond, vond het door ernaar te vragen, niet door de zin te lezen.
    findings.push(
      openingDelta === null
        ? "Ontvangsten en uitgaven komen overeen met wat de app kent. De openingsstand van de lade konden we niet vergelijken."
        : "Het kasboek en de app zeggen hetzelfde: ontvangsten, uitgaven én openingsstand komen overeen.",
    );
  }
  return { receivedDelta, spentDelta, openingDelta, findings };
}
