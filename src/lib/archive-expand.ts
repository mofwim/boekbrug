// src/lib/archive-expand.ts
// [ARCHIEF-OPEN] Een zip-bijlage vervangen door de documenten die erin zitten.
//
// Het OORDEEL staat in archive-attachment.ts en is puur; dit bestand doet alleen het uitpakken,
// met jszip (al een dependency). De scheiding is met opzet: de plafonds en de weigerredenen zijn
// het deel dat getest moet worden en dat een mens moet kunnen nalezen, en die horen niet verstopt
// te zitten achter een bibliotheekaanroep.
//
// De uitgepakte bestanden gaan het pad in ALSOF ze los aan de mail hingen: dezelfde classificatie,
// dezelfde dubbelpoorten, dezelfde verificatierij. Een archief is een envelop, geen achterdeur.

import JSZip from "jszip";
import { planArchive, isOpenableArchive, type ArchiveEntry } from "./archive-attachment";

/** Zo min mogelijk van de mailbijlage — genoeg om er een nieuwe van te maken. */
export interface ExpandableAttachment {
  messageId?: string;
  filename: string;
  mimeType: string;
  /** base64 (of base64url, zoals Gmail levert). */
  data: string;
  size?: number;
  /**
   * Gezet op alles wat hier UIT een archief komt. De aanroeper heeft dat nodig: een uitgepakt
   * bestand kan niet op het watermerk vertrouwen om nog een kans te krijgen (het archief is
   * onvoorwaardelijk afgehandeld), dus moet een mislukte lezing daar meteen worden bewaard in
   * plaats van doorgeschoven naar een sync die nooit komt.
   */
  fromArchive?: boolean;
}

export interface ExpandResult<T> {
  attachments: T[];
  /** Wat er niet uit mocht, mét reden — bestemd voor het overgeslagen-paneel. */
  skipped: Array<{ filename: string; reason: string }>;
  /**
   * De archieven die zijn VERVANGEN, als `messageId:filename`.
   *
   * ── WAAROM DIT ER MOET ZIJN ──
   * De watermerk-controle in email-integration.ts loopt over de OORSPRONKELIJK opgehaalde
   * bijlagen en eist dat elke sleutel `messageId:filename` is afgehandeld. Een zip die hier
   * wordt vervangen komt daar dus nooit meer langs onder zijn eigen naam: de sleutel van het
   * ARCHIEF blijft eeuwig openstaan, het bericht leest als onvoltooid, en het watermerk schuift
   * nooit op. Dat is niet "een bijlage te veel" maar een sync die blijft rondlopen en elke
   * mailbox erna uithongert — precies de bevroren-watermerk-bug waar de omliggende code drie
   * alinea's aan wijdt.
   *
   * De aanroeper markeert deze sleutels als afgehandeld. Het archief IS afgehandeld: zijn inhoud
   * is doorgestuurd of geregistreerd als overgeslagen, en er is niets meer om op te wachten.
   */
  consumedKeys: string[];
}

/** base64url → Buffer. Gmail levert `-`/`_`; Outlook gewoon base64. */
function toBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  heic: "image/heic", webp: "image/webp", xml: "application/xml", ubl: "application/xml",
  csv: "text/csv", txt: "text/plain",
  // [ARCHIEF-OPEN] Zonder deze twee komt een kassa-xlsx uit de zip als application/octet-stream
  // en herkent de spreadsheetlezer hem niet meer — uitgepakt en dan alsnog onleesbaar.
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Vervang elke te openen zip door zijn bruikbare inhoud.
 *
 * Niet-archieven blijven ongemoeid en houden hun plaats in de lijst. Faalt het uitpakken zelf
 * (kapot bestand, versleuteld), dan verdwijnt het archief niet stilletjes maar komt het als
 * overgeslagen mét reden terug — dat is de hele reden dat dit bestand bestaat.
 */
export async function expandArchives<T extends ExpandableAttachment>(
  attachments: readonly T[],
): Promise<ExpandResult<T>> {
  const out: T[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];
  const consumedKeys: string[] = [];

  for (const att of attachments) {
    if (!isOpenableArchive(att.filename)) {
      out.push(att);
      continue;
    }
    // Vanaf hier is dit archief afgehandeld, wat er ook gebeurt — ook als het uitpakken faalt.
    // Zie consumedKeys: laat je hem hier weg, dan bevriest het watermerk.
    if (att.messageId) consumedKeys.push(`${att.messageId}:${att.filename}`);

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(toBuffer(att.data));
    } catch {
      skipped.push({
        filename: att.filename,
        reason: "het archief kon niet worden geopend (beschadigd of met een wachtwoord beveiligd)",
      });
      continue;
    }

    const files = Object.values(zip.files).filter((f) => !f.dir);
    const entries: ArchiveEntry[] = files.map((f) => ({
      filename: f.name,
      // `_data.uncompressedSize` is wat jszip uit de zip-index leest — de OPGEGEVEN maat, vóór
      // uitpakken. Precies wat een plafond nodig heeft: een zip-bom afwijzen zonder hem eerst te
      // laten groeien in het geheugen.
      bytes: Number((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
    }));

    const plan = planArchive(entries);
    if (plan.refusedWhole) {
      skipped.push({ filename: att.filename, reason: plan.refusedWhole });
      continue;
    }
    for (const s of plan.skipped) {
      skipped.push({ filename: `${att.filename} → ${s.filename}`, reason: s.reason });
    }

    for (const wanted of plan.take) {
      const f = files.find((x) => x.name === wanted.filename);
      if (!f) continue;
      try {
        const buf = await f.async("nodebuffer");
        // De naam draagt het archief mee. Zonder dat staan er straks tien "dagafsluiting.pdf"
        // in de lijst en weet niemand meer uit welke envelop welke kwam.
        const naam = `${att.filename.replace(/\.zip$/i, "")} — ${f.name.split("/").pop()}`;
        out.push({
          ...att,
          fromArchive: true,
          filename: naam,
          mimeType: mimeFor(f.name),
          data: buf.toString("base64"),
          size: buf.length,
        } as T);
      } catch {
        skipped.push({ filename: `${att.filename} → ${f.name}`, reason: "dit bestand kon niet uit het archief worden gelezen" });
      }
    }
  }
  return { attachments: out, skipped, consumedKeys };
}
