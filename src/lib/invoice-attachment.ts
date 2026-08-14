// src/lib/invoice-attachment.ts
// [FACTUUR-BIJLAGE] Het eigen bestand dat met de factuurmail meegaat. Puur, geen I/O.
// Run: npx tsx --test src/lib/invoice-attachment.test.ts
//
// ── WAAROM DIT ER MOET ZIJN ──
//
// De factuurmail droeg precies één ding: de PDF die de app zelf maakt. Een schilder die een
// werkbon meestuurt, een adviseur met een urenstaat, een leverancier met een pakbon — hun klant
// kan de factuur niet verwerken zonder dat papier erbij. De uitweg was de factuur uit BoekBrug
// halen en met de hand vanuit een eigen mailprogramma versturen, en daarmee valt alles weg wat
// deze app eromheen doet: het verzendspoor, de herinneringen, de koppeling met de bank.
//
// ── DE WEIGERING KOMT VÓÓR HET NUMMER ──
//
// Dit is de hele reden dat deze regels een eigen bestand hebben.
//
// De verstuurroute doet twee dingen na elkaar: een nummer munten uit de doorlopende reeks (Art. 35
// Wet OB — onomkeerbaar, geen gaten) en dan de mail versturen. Zou de bijlage pas bij dat tweede
// worden opgehaald en dan niet blijken te kunnen, dan zijn er twee slechte uitkomsten en geen
// goede:
//
//   · versturen zonder de bijlage → de klant krijgt een onvolledig pakket en kan de factuur niet
//     verwerken, terwijl de ondernemer denkt dat hij hem compleet heeft gestuurd;
//   · afbreken → het nummer is al verbruikt, en er staat een gat in de reeks dat niet meer te
//     dichten is.
//
// Dus wordt de bijlage OPGEHAALD EN GEKEURD voordat er een nummer bestaat. Kan hij niet mee, dan
// gaat er niets de deur uit, is er niets verbruikt, en hoort de ondernemer waarom.
//
// ── DE GRENS ──
//
// Een mail met een bijlage van tientallen megabytes komt niet aan: de meeste mailservers weigeren
// boven de 25 MB, en base64 maakt een bestand onderweg een derde groter. De grens hieronder is dus
// niet "wat wij aankunnen" maar "wat er bij de klant binnenkomt" — en hij houdt rekening met de
// factuur-PDF die er óók nog bij zit.

/** De ruwe grens van wat een mailbox doorgaans nog accepteert, na base64. */
const MAILBOX_LIMIT_BYTES = 25 * 1024 * 1024;

/** Base64 maakt een bestand ~4/3 zo groot. Dat gebeurt onderweg, niet in de opslag. */
const BASE64_FACTOR = 4 / 3;

/** Ruimte die de factuur-PDF zelf ook nog nodig heeft, plus de tekst eromheen. */
const RESERVED_FOR_INVOICE_BYTES = 3 * 1024 * 1024;

/**
 * Het grootste bestand dat nog mee kan, in bytes zoals het in de opslag staat.
 *
 * Afgerond naar beneden op een hele MB, omdat dit een getal is dat aan een mens wordt getoond:
 * "maximaal 16 MB" is een regel die je kunt onthouden, "maximaal 16.515.072 bytes" niet.
 */
export const MAX_ATTACHMENT_BYTES =
  Math.floor((MAILBOX_LIMIT_BYTES / BASE64_FACTOR - RESERVED_FOR_INVOICE_BYTES) / (1024 * 1024)) * 1024 * 1024;

/** Waarom dit bestand niet mee kan. Null = het mag. */
export type AttachmentRefusal = "not_found" | "not_owned" | "trashed" | "too_large" | "empty";

/** Zoveel van een documentrij als deze regels lezen. */
export interface AttachableDocument {
  id?: string | null;
  user_id?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  trashed?: boolean | null;
}

/**
 * Mag dit bestand met de factuur mee?
 *
 * `ownerId` is de EIGENAAR van de factuur, niet de ingelogde persoon: stuurt een
 * verkoopmedewerker de factuur namens zijn werkgever, dan is de bijlage een bestand van dat
 * bedrijf. Een bestand van iemand anders meesturen zou andermans document naar een derde sturen,
 * en dat is het soort fout waar geen scherm op wijst.
 */
export function attachmentRefusal(
  doc: AttachableDocument | null | undefined,
  ownerId: string,
): AttachmentRefusal | null {
  if (!doc || !doc.id || !doc.file_url) return "not_found";
  if (!doc.user_id || doc.user_id !== ownerId) return "not_owned";
  // Een weggegooid bestand is weggegooid. Het staat nog in de prullenbak en is dus technisch
  // leesbaar — dat is precies waarom het hier expliciet wordt geweigerd.
  if (doc.trashed) return "trashed";
  const grootte = Number(doc.file_size);
  if (!Number.isFinite(grootte) || grootte <= 0) return "empty";
  if (grootte > MAX_ATTACHMENT_BYTES) return "too_large";
  return null;
}

/** Kan dit bestand mee? */
export function canAttach(doc: AttachableDocument | null | undefined, ownerId: string): boolean {
  return attachmentRefusal(doc, ownerId) === null;
}

/** Megabytes, met één decimaal en een Nederlandse komma. */
export function formatMegabytes(bytes: number): string {
  const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

/**
 * Wat de ondernemer leest wanneer de bijlage niet mee kan.
 *
 * Nederlands in een Engels bestand (AGENTS.md): dit is de zin die de verstuurroute terugstuurt en
 * het scherm toont. Elke variant zegt WAT eraan schort en WAT je eraan doet — "bijlage
 * ongeldig" laat iemand achter met een factuur die niet verstuurt en geen idee waarom.
 */
export function attachmentRefusalText(reason: AttachmentRefusal): string {
  switch (reason) {
    case "not_found":
      return "De bijlage die je koos bestaat niet meer. Haal hem van de factuur af of kies een ander bestand.";
    case "not_owned":
      return "Dit bestand hoort niet bij deze administratie en kan niet worden meegestuurd.";
    case "trashed":
      return "De bijlage staat in de prullenbak. Zet hem terug of kies een ander bestand.";
    case "too_large":
      return `De bijlage is te groot om mee te mailen — maximaal ${formatMegabytes(MAX_ATTACHMENT_BYTES)}. Veel mailboxen weigeren een grotere mail, dan komt je factuur niet aan.`;
    case "empty":
      return "De bijlage is leeg. Kies een ander bestand.";
  }
}

/**
 * De naam waaronder de bijlage bij de klant aankomt.
 *
 * De eigen naam van het bestand, want die is door de ondernemer gekozen en zegt wat het is
 * ("werkbon-augustus.pdf"). Alleen wat een bestandsnaam kapotmaakt gaat eraf: paden, aanhalings-
 * tekens en regeleindes — een naam met een schuine streep erin belandt bij sommige mailclients als
 * een map, en een naam met een regeleinde kan een mailheader breken.
 */
export function safeAttachmentName(fileName: string | null | undefined): string {
  const schoon = (fileName ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/["']/g, "")
    .trim()
    .slice(0, 120);
  return schoon || "bijlage";
}
