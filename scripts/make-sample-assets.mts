// scripts/make-sample-assets.mts
// [DEMO-BESTANDEN] De bestanden die de gereedschapsclips in de uploadvelden stoppen.
//
// Run:  npx tsx scripts/make-sample-assets.mts
// Uit:  scripts/samples/  (buiten git — zie .gitignore; ze worden hier gemaakt, niet bewaard)
//
// ── WAAROM GEGENEREERD ──
//
// De helft van het publieke gereedschap (pdf-samenvoegen, watermerk, afbeelding-verkleinen…) doet
// niets tot er een bestand in gaat. Voor een clip is dus een bestand nodig, en daar zijn precies
// twee slechte antwoorden op: een echt document van een echte klant (dat is de regel uit
// PLAY_STORE_LISTING.md, en die geldt hier net zo hard — een video verraadt méér dan een foto), of
// een leeg wit vel, dat de clip er goedkoop uit laat zien.
//
// Dus: verzonnen documenten die eruitzien als echt werk. Alle namen, bedragen en nummers zijn
// verzonnen; de bedrijven bestaan niet. Eén commando maakt ze opnieuw, dus ze hoeven niet in de
// repository te staan en kunnen niet stilletjes verouderen.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.env.SAMPLE_OUT ?? path.join("scripts", "samples");
mkdirSync(OUT, { recursive: true });

const BLUE = rgb(0.1, 0.45, 0.91);
const INK = rgb(0.07, 0.11, 0.16);
const GREY = rgb(0.45, 0.5, 0.56);
const RULE = rgb(0.85, 0.88, 0.91);

/** Eén verzonnen inkoopfactuur, zoals een zzp'er er tientallen per kwartaal krijgt. */
interface Bill {
  supplier: string;
  /** Eigen adresregel per leverancier: drie facturen met dezelfde postbus leest als één sjabloon. */
  address: string;
  number: string;
  date: string;
  iban: string;
  lines: Array<[string, number]>;
}

const BILLS: Bill[] = [
  {
    supplier: "Groothandel De Kuiper",
    address: "Postbus 244 · 5038 AA Tilburg · KVK 61094327",
    number: "2026-4471",
    date: "14-08-2026",
    iban: "NL29 RABO 0142 5567 20",
    lines: [["Verpakkingsmateriaal", 248.5], ["Reinigingsmiddelen", 96.75], ["Bezorging", 12.5]],
  },
  {
    supplier: "Van Leeuwen Techniek",
    address: "Ambachtsweg 8 · 5145 PE Waalwijk · KVK 17208844",
    number: "F-88213",
    date: "22-08-2026",
    iban: "NL62 INGB 0007 7391 04",
    lines: [["Onderhoud installatie", 420.0], ["Vervangen filter", 87.25]],
  },
  {
    supplier: "Kantoorzaak Tilburg",
    address: "Spoorlaan 112 · 5038 CB Tilburg · KVK 58330192",
    number: "INV-30912",
    date: "02-09-2026",
    iban: "NL08 ABNA 0553 1188 42",
    lines: [["Printerpapier A4, 5 pak", 34.9], ["Tonercartridge", 119.0], ["Ordners", 18.6]],
  },
];

const euro = (n: number) => `EUR ${n.toFixed(2).replace(".", ",")}`;

async function makeBillsPdf(file: string, bills: Bill[]) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);

  for (const bill of bills) {
    const page = pdf.addPage([595, 842]); // A4 in punten
    const { width, height } = page.getSize();
    let y = height - 64;

    page.drawText(bill.supplier, { x: 48, y, size: 20, font: bold, color: INK });
    y -= 18;
    page.drawText(bill.address, { x: 48, y, size: 9, font: plain, color: GREY });
    y -= 40;

    page.drawText("FACTUUR", { x: 48, y, size: 13, font: bold, color: BLUE });
    y -= 20;
    page.drawText(`Factuurnummer   ${bill.number}`, { x: 48, y, size: 10, font: plain, color: INK });
    y -= 14;
    page.drawText(`Factuurdatum      ${bill.date}`, { x: 48, y, size: 10, font: plain, color: INK });
    y -= 14;
    page.drawText("Aan                        Van Dijk Ontwerp, Havenstraat 14, Tilburg", { x: 48, y, size: 10, font: plain, color: INK });
    y -= 34;

    page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 1, color: RULE });
    y -= 18;
    page.drawText("Omschrijving", { x: 48, y, size: 9, font: bold, color: GREY });
    page.drawText("Bedrag", { x: width - 118, y, size: 9, font: bold, color: GREY });
    y -= 16;

    let net = 0;
    for (const [what, amount] of bill.lines) {
      net += amount;
      page.drawText(what, { x: 48, y, size: 11, font: plain, color: INK });
      page.drawText(euro(amount), { x: width - 118, y, size: 11, font: plain, color: INK });
      y -= 18;
    }

    y -= 8;
    page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 1, color: RULE });
    y -= 20;
    const btw = Math.round(net * 21) / 100;
    for (const [label, value, heavy] of [
      ["Subtotaal excl. btw", euro(net), false],
      ["Btw 21%", euro(btw), false],
      ["Totaal incl. btw", euro(net + btw), true],
    ] as Array<[string, string, boolean]>) {
      page.drawText(label, { x: width - 260, y, size: heavy ? 12 : 11, font: heavy ? bold : plain, color: INK });
      page.drawText(value, { x: width - 118, y, size: heavy ? 12 : 11, font: heavy ? bold : plain, color: INK });
      y -= 18;
    }

    page.drawText(`Betaling binnen 14 dagen op ${bill.iban}`, {
      x: 48, y: 64, size: 9, font: plain, color: GREY,
    });
  }

  writeFileSync(path.join(OUT, file), await pdf.save());
  console.log(`[SAMPLE] ${file} — ${bills.length} pagina's`);
}

/**
 * Een foto van een bon, zoals iemand hem met de telefoon maakt.
 *
 * Geen echte foto (die hebben we niet en mogen we niet verzinnen uit andermans bon), maar een
 * getekende bon op een papierkleurige ondergrond met een lichte schaduw. Groot genoeg dat
 * "verkleinen" iets zichtbaars doet: 2400x3200 is wat een telefooncamera levert.
 */
async function makeReceiptPhoto(file: string) {
  const W = 2400, H = 3200;
  const lines: string[] = [];
  const push = (y: number, text: string, size: number, weight: string, fill: string, anchor = "start", x = 300) =>
    lines.push(
      `<text x="${x}" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" ` +
      `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${text}</text>`,
    );

  push(560, "GROOTHANDEL DE KUIPER", 96, "700", "#1b2430");
  push(650, "Tilburg · KVK 61094327", 52, "400", "#6b7480");
  push(820, "BON 2026-4471", 64, "700", "#1b2430");
  push(890, "14-08-2026   11:42", 52, "400", "#6b7480");

  let y = 1050;
  for (const [what, amount] of [
    ["Verpakkingsmateriaal", "248,50"],
    ["Reinigingsmiddelen", "96,75"],
    ["Bezorging", "12,50"],
  ]) {
    push(y, what, 58, "400", "#1b2430");
    push(y, amount, 58, "400", "#1b2430", "end", 2100);
    y += 96;
  }
  y += 40;
  lines.push(`<line x1="300" y1="${y}" x2="2100" y2="${y}" stroke="#c9d0d8" stroke-width="4"/>`);
  y += 90;
  push(y, "Subtotaal", 58, "400", "#1b2430");
  push(y, "357,75", 58, "400", "#1b2430", "end", 2100);
  y += 90;
  push(y, "Btw 21%", 58, "400", "#1b2430");
  push(y, "75,13", 58, "400", "#1b2430", "end", 2100);
  y += 100;
  push(y, "TOTAAL", 72, "700", "#1b2430");
  push(y, "432,88", 72, "700", "#1b2430", "end", 2100);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#5b6472"/>
    <rect x="180" y="260" width="2040" height="2680" rx="18" fill="#fdfcf8"/>
    ${lines.join("\n    ")}
  </svg>`;

  // [FOTOGEWICHT] Ruis erover, en dat is geen opsmuk.
  //
  // De eerste versie was een vlakke tekening en woog 181 kB. Op /afbeelding-verkleinen leverde dat
  // "van 181 kB naar 65 kB" onder een clip die vraagt of je foto te groot is om te mailen — een
  // belofte die het eigen scherm tegensprak. Een telefoonfoto van een bon is 2 tot 5 MB, en die
  // grootte komt van sensorruis: fijne korrel die niet wegcomprimeert. Dus wordt hij toegevoegd,
  // en weegt het bestand wat een echte foto weegt.
  // De korrel zelf zacht houden (rond 128 = neutraal bij overlay); sharp kent geen opacity op een
  // composite, dus de sterkte zit in de waarden en niet in een laagdekking.
  const grain = Buffer.alloc(W * H * 3);
  for (let i = 0; i < grain.length; i++) grain[i] = 122 + ((i * 2654435761) % 13);
  await sharp(Buffer.from(svg))
    .composite([{ input: grain, raw: { width: W, height: H, channels: 3 }, blend: "overlay" }])
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
    .toFile(path.join(OUT, file));
  console.log(`[SAMPLE] ${file} — ${W}x${H} JPEG`);
}

/**
 * Een PDF met een FOTO erin — voor /afbeeldingen-uit-pdf.
 *
 * Gemeten en niet aangenomen: die tool gaf op de facturen-PDF hierboven niets terug, en dat was
 * geen fout maar het juiste antwoord — er zit geen enkele afbeelding in, alleen vectortekst. Een
 * clip die "haal de foto's eruit" belooft en een lege lijst toont, is een clip die het gereedschap
 * kapot laat lijken terwijl het klopt.
 */
async function makeScanPdf(file: string) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const jpg = await pdf.embedJpg(readFileSync(path.join(OUT, "bon-foto.jpg")));

  for (const [title, note] of [
    ["Bonnetje augustus", "Gescand op 14-08-2026"],
    ["Bonnetje september", "Gescand op 02-09-2026"],
  ]) {
    const page = pdf.addPage([595, 842]);
    page.drawText(title, { x: 48, y: 790, size: 18, font: bold, color: INK });
    page.drawText(note, { x: 48, y: 770, size: 10, font: plain, color: GREY });
    const w = 380;
    const h = (jpg.height / jpg.width) * w;
    page.drawImage(jpg, { x: (595 - w) / 2, y: 730 - h, width: w, height: h });
  }
  writeFileSync(path.join(OUT, file), await pdf.save());
  console.log(`[SAMPLE] ${file} — 2 gescande pagina's met een foto erin`);
}

await makeBillsPdf("inkoopfacturen-3p.pdf", BILLS);
await makeBillsPdf("inkoopfactuur-1p.pdf", [BILLS[0]]);
await makeReceiptPhoto("bon-foto.jpg");
await makeScanPdf("gescande-bonnen-2p.pdf"); // ná de foto: hij wordt erin gezet
console.log(`\n[SAMPLE] klaar in ${OUT}/`);
