// scripts/record-clips.mts
// [CLIPS] Verticale schermopnames van de app, gegenereerd in plaats van gefilmd.
//
// Run (publieke tools — geen account nodig):
//   npx next build && npx next start -p 3100      # in één shell
//   npx tsx scripts/record-clips.mts              # in een andere
//
// Run (óók de /dashboard-clips):
//   SHOT_EMAIL=demo@boekbrug.nl SHOT_PASSWORD=… npx tsx scripts/record-clips.mts   (wachtwoord uit de kluis — deze repo is openbaar)
//
// Environment:
//   CLIP_BASE_URL   default http://127.0.0.1:3100
//   CLIP_OUT        default store-assets/clips
//   CLIP_ONLY       maak alleen de clips waarvan de naam dit bevat
//   CLIP_FFMPEG     pad naar ffmpeg (anders: ffmpeg-static, dan /usr/bin/ffmpeg)
//   SHOT_EMAIL      zet dit en de dashboard-clips draaien mee (zie hieronder)
//   SHOT_PASSWORD
//
// ── WAAROM GEGENEREERD EN NIET GEFILMD ──
//
// Een productvideo veroudert stil. Hij blijft staan waar hij is gepost, blijft een scherm tonen dat
// niet meer bestaat, en niemand merkt het — precies het probleem dat capture-screenshots.mjs voor
// de storefoto's oploste ("never reproducible and went stale the moment a screen changed"). Dit is
// dezelfde machine, met beweging erbij: het pad staat één keer in code, en één commando maakt alle
// clips opnieuw nadat een scherm is veranderd.
//
// ── DE DEMO-ADMINISTRATIE, NOOIT EEN ECHTE ──
//
// Een video verraadt méér dan een foto: scrollen toont rijen, een autocomplete toont klantnamen, en
// het bankscherm toont IBAN's en omschrijvingen. scripts/seed-demo-account.sql maakt een tenant van
// verzonnen gegevens voor precies dit doel — dezelfde die Play Console als testaccount wil. Deze
// clips draaien daar of ze draaien niet.
//
// ── EEN OPMERKING VOOR EEN CI-DOOS ──
//
// Inloggen gebeurt in de BROWSER, dus de browser moet de Supabase-host kunnen bereiken. Een
// egress-proxy die CONNECT weigert laat elke publieke clip gewoon slagen en alleen het inloggen
// vallen. De publieke clips hebben geen account nodig en draaien overal.

import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const BASE = process.env.CLIP_BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.CLIP_OUT ?? path.join("store-assets", "clips");
const EMAIL = process.env.SHOT_EMAIL;
const PASSWORD = process.env.SHOT_PASSWORD;

// Opnemen op de MOBIELE viewport, daarna naar 1080×1920 schalen.
//
// Playwright legt het beeld vast in CSS-pixels: deviceScaleFactor doet er voor de video niets toe,
// en een recordVideo-formaat dat groter is dan de viewport vult alleen de linkerbovenhoek en laat
// de rest grijs. (Nagemeten: viewport 540 op dsf 2 met video 1080 gaf een pagina in een kwart van
// het doek.) En de viewport op 1080 zetten haalt de mobiele layout weg — de app ziet dan gewoon een
// breed scherm, media queries en al.
//
// Dus: opnemen op 540×960, en ffmpeg schaalt naar 1080×1920 met lanczos. Dat is wat elke
// schermopname van een telefoon doet.
const VIEW = { width: 540, height: 960 };
const VIDEO = { width: 540, height: 960 };
const OUT_SIZE = { width: 1080, height: 1920 };

// ── Merk ──────────────────────────────────────────────────────────────────────
// Dezelfde kleur en hetzelfde lettertype als de deck-generator en de store-assets, uit
// dezelfde map. Een clip die een andere blauw gebruikt dan de slide ernaast leest als een andere
// firma.
const BLUE = "#1a73e8";
const FONT_DIR = path.join(process.cwd(), "scripts", "fonts");
const font = (f: string) => readFileSync(path.join(FONT_DIR, f)).toString("base64");
// Alleen Bold: elke ondertitel is vet, en twee volledige TTF's als data-URI in elke pagina duwen
// was het trage deel van de aanloop — zie de warm-up hieronder.
const OUTFIT_BOLD = font("Outfit-Bold.ttf");

/** Eén ondertitel: de zin, en hoe lang hij blijft staan. */
interface Beat {
  text: string;
  ms: number;
  /** Laat de zin STAAN. Voor de laatste van een clip: anders vervaagt hij over het beeld heen en
   *  eindigt de clip op een halfdoorzichtige regel over de pagina. */
  hold?: boolean;
}

interface Clip {
  name: string;
  /** Vereist een sessie? Zonder SHOT_EMAIL worden die overgeslagen in plaats van te falen. */
  auth?: boolean;
  path: string;
  /** De hook — staat één seconde vóór er iets beweegt. Dit is wat scrollen stopt. */
  hook: string;
  /**
   * [UITLEG] Hoe lang deze clip hoogstens mag worden, in seconden. Standaard MAX_LEN_S.
   *
   * Een teaser en een uitleg zijn niet hetzelfde soort film. De teasers hierboven duren tien tot
   * vijftien seconden en dat is hun hele opzet: iemand die scrollt moet stoppen. Een UITLEG wordt
   * bekeken door iemand die al is gestopt, en die heeft tijd nodig om te lezen wat er verandert —
   * op vijftien seconden geperst wordt hetzelfde pad een flikkering die niets uitlegt.
   *
   * Ruim zetten, niet krap: het snijden gebeurt aan de STAART (-ss … -t …), dus een te lage waarde
   * knipt precies de slotzin eraf. De lengte wordt geregeld door het tempo van `run`, niet hier.
   */
  maxLen?: number;
  /**
   * Het pad zelf. `say` zet de ondertitel; `step` verzet de balk bovenin; alles ertussen is echte
   * interactie.
   */
  run: (p: Page, say: (b: Beat) => Promise<void>, step: (t: string) => Promise<void>) => Promise<void>;
}

// ── De ondertitellaag ─────────────────────────────────────────────────────────
// In de PAGINA getekend, niet er achteraf overheen gebrand. Twee redenen: de tekst blijft
// vectorscherp op 1080 breed en staat in het merklettertype, en er is geen tweede gereedschap
// nodig om hem te plaatsen. Onderin, waar de duim hem niet bedekt en waar elk platform zijn eigen
// UI NIET zet.
const CAPTION_CSS = `
@font-face{font-family:ClipFont;font-weight:700;font-display:block;src:url(data:font/ttf;base64,${OUTFIT_BOLD}) format("truetype")}
#clip-cap{
  position:fixed; left:0; right:0; bottom:0; z-index:2147483647; pointer-events:none;
  padding:24px 20px 30px; box-sizing:border-box;
  background:linear-gradient(to top, rgba(15,18,22,.94) 62%, rgba(15,18,22,0));
  font-family:ClipFont,system-ui,sans-serif; color:#fff;
  font-size:27px; line-height:1.3; font-weight:700; letter-spacing:-.01em;
  text-align:center; opacity:0; transition:opacity .18s ease;
}
#clip-cap.on{opacity:1}
#clip-cap b{color:#7fb2f7; font-weight:700}
#clip-badge{
  position:fixed; top:0; left:0; right:0; z-index:2147483646; pointer-events:none;
  padding:14px 18px; box-sizing:border-box; text-align:center;
  font-family:ClipFont,system-ui,sans-serif; font-weight:700; font-size:15px; letter-spacing:.04em;
  color:#fff; background:${BLUE};
}`;

async function installCaption(p: Page, badge: string) {
  await p.addStyleTag({ content: CAPTION_CSS });
  await p.evaluate((b) => {
    const cap = document.createElement("div"); cap.id = "clip-cap";
    const bar = document.createElement("div"); bar.id = "clip-badge"; bar.textContent = b;
    document.body.append(bar, cap);
  }, badge);
}

/**
 * [UITLEG] De balk bovenin verzetten — "stap 2 van 4".
 *
 * Voor een teaser staat daar de merknaam en verder niets. Voor een uitleg is dat de enige plek waar
 * de kijker kan zien WAAR hij is: zonder die balk lijkt een film van veertig seconden één lange
 * handeling, en wie halverwege instapt weet niet of hij het begin heeft gemist.
 */
function stepper(p: Page) {
  return async (text: string) => {
    await p.evaluate((t) => {
      const el = document.getElementById("clip-badge");
      if (el) el.textContent = t;
    }, text);
  };
}

/** Zet een ondertitel, laat hem staan, haal hem weg. Retourneert pas als de beat voorbij is. */
function sayer(p: Page) {
  return async ({ text, ms, hold }: Beat) => {
    await p.evaluate((t) => {
      const el = document.getElementById("clip-cap");
      if (!el) return;
      el.innerHTML = t;
      el.classList.add("on");
    }, text);
    await p.waitForTimeout(ms);
    if (hold) return;
    await p.evaluate(() => document.getElementById("clip-cap")?.classList.remove("on"));
    await p.waitForTimeout(220);
  };
}

/** Typen met een menselijk ritme. Een fill() springt en leest als een screenshot, niet als gebruik. */
async function type(p: Page, selector: string, value: string, perChar = 55) {
  const el = p.locator(selector).first();
  await el.click();
  await el.fill("");
  await el.type(value, { delay: perChar });
  await p.waitForTimeout(380);
}

/**
 * Het veld ONDER een opschrift, gevonden op dat opschrift.
 *
 * `typeNth` hieronder telt invoervelden, en dat werkt tot iemand er één tussen zet. Het formulier
 * op /factuur-maken heeft geen label-koppeling en geen id's, maar wél een zichtbaar woord boven elk
 * veld — "Bedrijfsnaam", "Naam / bedrijf" — en dát woord is wat de kijker in beeld ziet. Erop
 * mikken is daarom niet alleen steviger, het is ook hetzelfde als wat de clip beweert te tonen.
 */
function byLabel(p: Page, label: string) {
  return p.locator(`xpath=//*[normalize-space(text())=${JSON.stringify(label)}]/following::input[1]`).first();
}

/**
 * Breng iets op ooghoogte: niet "net in beeld", maar op een vaste hoogte in het scherm.
 *
 * scrollIntoViewIfNeeded doet het minimum, en het minimum is meestal ONDERAAN het scherm — precies
 * waar de ondertitelbalk staat. In de eerste opname van de uitleg-clip stond het uitgerekende
 * totaal daardoor achter zijn eigen bijschrift: € 1.512,50 werd genoemd en was niet te zien.
 *
 * Een vaste fractie van de viewport lost dat op en is niet gevoelig voor de lengte van de pagina.
 * 0.42 zet het bedrag in de bovenste helft, ruim boven de balk van ±140 px onderin.
 */
async function bringToEyeLine(p: Page, target: ReturnType<Page["locator"]>, fraction = 0.42) {
  await target.scrollIntoViewIfNeeded();
  await p.waitForTimeout(120);
  const box = await target.boundingBox();
  if (!box) return;
  const want = VIEW.height * fraction;
  await p.evaluate((dy) => window.scrollBy(0, dy), Math.round(box.y - want));
  await p.waitForTimeout(260);
}

/** Typen in het veld onder een opschrift, met hetzelfde menselijke ritme als type(). */
async function typeUnder(p: Page, label: string, value: string, perChar = 70) {
  const el = byLabel(p, label);
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await el.fill("");
  await el.type(value, { delay: perChar });
  await p.waitForTimeout(400);
}

/** Hetzelfde, maar op het zoveelste invoerveld van de pagina — voor formulieren zonder id's. */
async function typeNth(p: Page, index: number, value: string, perChar = 45) {
  const el = p.locator("input").nth(index);
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await el.fill("");
  await el.type(value, { delay: perChar });
  await p.waitForTimeout(260);
}

// ── De clips ──────────────────────────────────────────────────────────────────
// Kort, en elk begint bij een PROBLEEM in plaats van bij een scherm. Wie dit voorbij ziet komen
// heeft de app niet; een rondleiding langs knoppen is voor wie hem al heeft.
const CLIPS: Clip[] = [
  {
    name: "01-btw-berekenen",
    path: "/btw-berekenen",
    hook: "Hoeveel btw zit er op € 1.000?",
    run: async (p, say) => {
      await type(p, "input", "1000");
      await say({ text: "21% erbij: <b>€ 210</b><br>Totaal <b>€ 1.210</b>", ms: 1900 });
      await say({ text: "Geen account. Geen upload.<br><b>boekbrug.nl</b>", ms: 2000, hold: true });
    },
  },
  {
    name: "02-uurtarief",
    path: "/uurtarief-berekenen",
    hook: "Wat moet je per uur vragen?",
    run: async (p, say) => {
      await type(p, "input", "45000");
      await say({ text: "Zeg wat je wilt verdienen —<br>de rest rekent mee", ms: 1800 });
      await p.mouse.wheel(0, 340);
      await p.waitForTimeout(700);
      await say({ text: "Vakantie, ziekte en<br>onbetaalde uren zitten erin", ms: 1900 });
      await say({ text: "Gratis op <b>boekbrug.nl</b>", ms: 2000, hold: true });
    },
  },
  {
    name: "03-kilometervergoeding",
    path: "/kilometervergoeding",
    hook: "€ 0,25 per zakelijke kilometer",
    run: async (p, say) => {
      await type(p, "input", "4200");
      await say({ text: "€ 0,25 per km in 2026<br>= <b>€ 1.050</b> aftrekbaar", ms: 2000 });
      await say({ text: "Reken het na op<br><b>boekbrug.nl</b>", ms: 2000, hold: true });
    },
  },
  {
    name: "04-factuur-maken",
    path: "/factuur-maken",
    hook: "Een factuur die klopt, in één minuut",
    run: async (p, say) => {
      // Een echte factuur wordt opgebouwd. Alleen scrollen langs een leeg formulier laat zien dat
      // het bestaat; dít laat zien dat het werkt — het totaal onderaan loopt mee terwijl er getypt
      // wordt. Verzonnen namen, want dit is een publieke pagina.
      await typeNth(p, 7, "Van Dijk Ontwerp");
      await typeNth(p, 16, "Bakkerij De Korenbloem");
      await say({ text: "Jij, je klant —<br>en dan de regels", ms: 1500 });
      await typeNth(p, 22, "Ontwerp huisstijl");
      await typeNth(p, 24, "1250");
      await p.waitForTimeout(400);
      // Naar het TOTAAL toe, niet een aantal pixels omlaag. Een vast getal schoot er in de vorige
      // versie voorbij en de clip eindigde op de uitlegtekst onderaan de pagina in plaats van op
      // het bedrag dat zojuist is uitgerekend — precies het beeld waar de clip voor bestaat.
      await p.getByText("Totaal incl. BTW").first().scrollIntoViewIfNeeded();
      await p.evaluate(() => window.scrollBy(0, -160));
      await p.waitForTimeout(800);
      await say({ text: "Btw en totaal rekenen<br>zichzelf uit", ms: 2000 });
      await say({ text: "Geen account. Alles blijft<br>in je browser. <b>boekbrug.nl</b>", ms: 2200, hold: true });
    },
  },
  // ── [UITLEG] Eén lange, langzame. Een ander soort film dan de vier hierboven. ──
  //
  // De teasers duren twaalf seconden en beginnen bij een probleem, omdat ze iemand moeten
  // tegenhouden die aan het scrollen is. Deze duurt bijna veertig en legt één ding helemaal uit,
  // voor iemand die al is blijven kijken. Dat is geen langere teaser maar een andere vorm, en het
  // verschil zit in drie dingen die hieronder allemaal expres staan:
  //
  //   · de balk bovenin telt de stappen, zodat je altijd weet waar je bent;
  //   · elke zin blijft ruim twee seconden staan, want hij moet gelezen worden, niet opgevangen;
  //   · na elk resultaat valt een stilte, zodat het oog op het getal kan landen dat net veranderde.
  //
  // En het pad is niet willekeurig gekozen. Het eindigt bij het btw-tarief, omdat dát het moment is
  // waarop te zien is dat de app rékent en niet alleen een formulier toont: 21% wordt 9%, en het
  // totaal eronder verandert mee terwijl je kijkt. Een uitleg die daar niet komt, heeft niets
  // uitgelegd.
  {
    name: "10-uitleg-factuur-maken",
    path: "/factuur-maken",
    maxLen: 60, // ruim: het tempo van run() bepaalt de lengte, niet de schaar
    hook: "Een factuur die klopt.<br>Zonder account, zonder installatie.",
    run: async (p, say, step) => {
      // Het TOTAAL, en waar het moet staan. Één plek, want het is drie keer in beeld en het mag
      // geen van die drie keren achter zijn eigen bijschrift verdwijnen.
      const totaal = p.getByText("Totaal incl. BTW").first();

      // ── Stap 1 · wie stuurt, wie ontvangt ──
      await step("Factuur maken · stap 1 van 4");
      await say({ text: "Eerst jij: van wie komt de factuur?", ms: 2100 });
      await typeUnder(p, "Bedrijfsnaam", "Van Dijk Ontwerp", 55);
      await p.waitForTimeout(500);
      await say({ text: "Dan je klant.", ms: 2100 });
      await typeUnder(p, "Naam / bedrijf", "Bakkerij De Korenbloem", 45);
      await p.waitForTimeout(450);

      // ── Stap 2 · wat je hebt geleverd ──
      await step("Factuur maken · stap 2 van 4");
      await say({ text: "Nu de regel:<br>wát je hebt geleverd.", ms: 2300 });
      await bringToEyeLine(p, p.locator('input[placeholder="Omschrijving"]').first(), 0.34);
      await type(p, 'input[placeholder="Omschrijving"]', "Ontwerp huisstijl", 55);
      await p.waitForTimeout(400);
      await say({ text: "En het bedrag, exclusief btw.", ms: 2200 });
      await type(p, 'input[placeholder="0,00"]', "1250", 75);
      await p.waitForTimeout(700);

      // Het bedrag op ooghoogte — het btw-veld staat er 150 px boven en komt dus vanzelf mee, wat
      // stap 3 nodig heeft: daar moeten de keuze en het bedrag tegelijk zichtbaar zijn.
      await bringToEyeLine(p, totaal, 0.50);
      await p.waitForTimeout(500);
      await say({ text: "Het totaal rekent zichzelf uit:<br><b>€ 1.512,50</b>", ms: 2400 });
      await p.waitForTimeout(500);

      // ── Stap 3 · het btw-tarief — waar de uitleg om draait ──
      await step("Factuur maken · stap 3 van 4");
      await say({ text: "Ander btw-tarief?<br>Eén keuze.", ms: 2200 });
      const btw = p.locator("select").filter({ hasText: "21%" }).first();
      await btw.selectOption("9");
      await p.waitForTimeout(950);
      await say({ text: "9% in plaats van 21% —<br>en alles telt opnieuw.", ms: 2700 });
      await p.waitForTimeout(700);

      // ── Stap 4 · klaar ──
      // Nog één keer op ooghoogte: de kijker verlaat de clip met het bedrag in beeld, niet met een
      // bijschrift over de plek waar het stond.
      await step("Factuur maken · stap 4 van 4");
      await bringToEyeLine(p, totaal, 0.40);
      await say({ text: "Klaar. Downloaden als pdf,<br>of mailen vanuit de app.", ms: 2300 });
      await say({ text: "Gratis, zonder account.<br><b>boekbrug.nl/factuur-maken</b>", ms: 2700, hold: true });
    },
  },
  // ── Achter een sessie. Overgeslagen zonder SHOT_EMAIL. ──
  {
    name: "05-klaar-voor-je-boekhouder",
    auth: true,
    path: "/dashboard/klaar",
    hook: "Ben ik klaar voor mijn boekhouder?",
    run: async (p, say) => {
      await say({ text: "Elk kwartaal dezelfde vraag:<br><b>ben ik compleet?</b>", ms: 1900 });
      await say({ text: "Eén scherm dat antwoordt<br>met feiten, niet met een vinkje", ms: 2000 });
      await p.mouse.wheel(0, 420);
      await p.waitForTimeout(900);
      await say({ text: "En zegt wat er nog mist.<br><b>boekbrug.nl</b>", ms: 2200, hold: true });
    },
  },
  {
    name: "06-btw-per-kwartaal",
    auth: true,
    path: "/dashboard/aangifte",
    hook: "Je btw-aangifte groeit met je mee",
    run: async (p, say) => {
      await say({ text: "Je btw wachtte altijd<br>tot het kwartaal om was.", ms: 1900 });
      await say({ text: "Hier staat hij al —<br>per rubriek, elke dag bij", ms: 2000 });
      await p.mouse.wheel(0, 460);
      await p.waitForTimeout(900);
      await say({ text: "Klaar om over te typen<br>bij de Belastingdienst.<br><b>boekbrug.nl</b>", ms: 2200, hold: true });
    },
  },
  {
    name: "07-bank-matchen",
    auth: true,
    path: "/dashboard/bank",
    hook: "Wie heeft er betaald?",
    run: async (p, say) => {
      await say({ text: "Je bankafschrift erin —<br>en dan het saaie werk", ms: 1900 });
      await p.mouse.wheel(0, 380);
      await p.waitForTimeout(900);
      await say({ text: "De app koppelt betalingen<br>aan je facturen", ms: 2000 });
      await p.mouse.wheel(0, 420);
      await p.waitForTimeout(900);
      await say({ text: "Jij kijkt na wat zij<br>niet zeker weet.<br><b>boekbrug.nl</b>", ms: 2300, hold: true });
    },
  },
  {
    name: "08-naar-je-boekhouder",
    auth: true,
    path: "/dashboard/brug",
    hook: "Elk kwartaal een map vol pdf's mailen",
    run: async (p, say) => {
      await say({ text: "Elk kwartaal dezelfde mail<br>met dezelfde bijlagen.", ms: 2000 });
      await p.mouse.wheel(0, 400);
      await p.waitForTimeout(900);
      await say({ text: "Facturen, bonnen, bank en<br>je concept-aangifte — in één bestand", ms: 2300 });
      await say({ text: "Eén keer klikken.<br><b>boekbrug.nl</b>", ms: 2100, hold: true });
    },
  },
];

// ── Opnemen ───────────────────────────────────────────────────────────────────
function chromiumPath(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => d.startsWith("chromium-"));
  return dir ? path.join(root, dir, "chrome-linux", "chrome") : undefined;
}

/** ffmpeg, als het er is. Zonder blijft de .webm staan — die speelt overal behalve op iOS. */
function ffmpeg(): string | null {
  // Een expliciet pad wint van alles. ffmpeg-static is ~80 MB en hoort niet in de dependencies van
  // een boekhoud-app; wie hem elders al heeft staan, wijst hem hiermee aan.
  const given = process.env.CLIP_FFMPEG;
  if (given && existsSync(given)) return given;
  if (given) console.error(`[CLIPS] CLIP_FFMPEG=${given} bestaat niet — verder zoeken.`);
  // createRequire, niet require: dit bestand is een ES-module en `require` bestaat er niet. De
  // eerste versie hiervan viel daardoor stil terug op .webm terwijl ffmpeg-static gewoon stond —
  // een catch die alles opvangt, ook de fout in zichzelf.
  try {
    const mod = createRequire(import.meta.url)("ffmpeg-static") as unknown;
    if (typeof mod === "string" && existsSync(mod)) return mod;
  } catch { /* niet geïnstalleerd — geen probleem, zie hieronder */ }
  for (const c of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) if (existsSync(c)) return c;
  return null;
}

/**
 * Waar begint het beeld?
 *
 * De opname start bij het aanmaken van de context, dus vooraan staat de tijd waarin de pagina nog
 * wit is. Die duurt niet elke keer even lang, en twee pogingen om hem te bereken — de wandklok, en
 * daarna een warme browser met een vast getal — zaten er allebei naast, want de tijdlijn van de
 * opname begint pas bij het eerste frame.
 *
 * Dus niet rekenen maar KIJKEN. Het beeld omkeren maakt van wit zwart, en ffmpeg's blackdetect
 * zegt dan precies wanneer het witte stuk ophoudt. Dat is het moment waarop de pagina er staat.
 */
function firstPaintSeconds(ff: string, webm: string): number {
  // spawnSync en niet execFileSync: ffmpeg schrijft blackdetect naar stderr en eindigt met code 0,
  // dus een `catch` ziet nooit iets. De eerste versie hiervan las de uitvoer alleen in de catch en
  // gaf daardoor altijd 0 terug — de detectie draaide, klopte, en werd weggegooid.
  const r = spawnSync(ff, ["-hide_banner", "-i", webm, "-vf", "negate,blackdetect=d=0.2:pic_th=0.97",
    "-f", "null", "-"], { encoding: "utf8" });
  const err = `${r.stderr ?? ""}`;
  // Alleen een wit stuk dat AAN HET BEGIN staat telt; een witte pauze in het midden is inhoud.
  const m = /black_start:0(?:\.0+)?\s+black_end:([0-9.]+)/.exec(err);
  return m ? Math.max(0, Number(m[1]) - 0.15) : 0;
}

async function login(ctx: BrowserContext): Promise<boolean> {
  const p = await ctx.newPage();
  try {
    await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await p.locator('input[type="email"]').first().fill(EMAIL!);
    await p.locator('input[type="password"]').first().fill(PASSWORD!);
    await p.locator('button[type="submit"]').first().click();
    await p.waitForURL(/\/dashboard/, { timeout: 30_000 });
    return true;
  } catch (e) {
    console.error(`[CLIPS] inloggen mislukt — de dashboard-clips worden overgeslagen.`);
    console.error(`[CLIPS] ${e instanceof Error ? e.message : String(e)}`);
    console.error(`[CLIPS] Inloggen gebeurt in de BROWSER: die moet de Supabase-host kunnen bereiken.`);
    return false;
  } finally {
    await p.close();
  }
}

mkdirSync(OUT, { recursive: true });
const exe = chromiumPath();
if (exe) console.log(`[CLIPS] chromium: ${exe}`);
const browser = await chromium.launch({ executablePath: exe });
const ff = ffmpeg();
if (ff) {
  console.log(`[CLIPS] ffmpeg:   ${ff}`);
} else {
  // Geen harde afhankelijkheid: ffmpeg-static is ~80 MB en de meeste mensen die dit repo klonen
  // maken geen clips. Maar .webm is op Instagram en TikTok geen bruikbaar bestand, dus de melding
  // moet zeggen wat je moet doen in plaats van alleen wat er mist.
  console.log(`[CLIPS] ffmpeg niet gevonden — de clips blijven .webm (niet overal te uploaden).`);
  console.log(`[CLIPS] Voor .mp4:  npm i -D ffmpeg-static   en draai dit opnieuw.`);
}
console.log(`[CLIPS] base:     ${BASE}`);

let sessionOk = false;
let storage: string | undefined;
if (EMAIL && PASSWORD) {
  const ctx = await browser.newContext({ viewport: VIEW });
  sessionOk = await login(ctx);
  if (sessionOk) storage = JSON.stringify(await ctx.storageState());
  await ctx.close();
} else {
  console.log(`[CLIPS] geen SHOT_EMAIL — alleen de publieke clips (die hebben geen account nodig)`);
}

/**
 * De maximale lengte van een clip, geknipt vanaf het EIND.
 *
 * De opname loopt op de wandklok en die is niet twee keer hetzelfde: dezelfde clip kwam op 10 en
 * op 23 seconden uit, met de stille aanloop vooraan als verschil. Vooraan wegknippen op een
 * gemeten aanloop werkte niet — de tijdlijn van de opname begint pas bij het eerste frame, niet
 * bij het aanmaken van de context, dus dezelfde berekening sneed de ene keer niets en de andere
 * keer de halve clip weg.
 *
 * Vanaf het eind knippen kan niet misgaan, want daar staat waar het om gaat: het uitgerekende
 * bedrag en de laatste zin. Wat er dan afvalt is precies wat niemand wil zien — een pagina die
 * nog aan het laden is.
 */
const MAX_LEN_S = 15;

// [CLIP-ONLY] Eén clip opnieuw maken zonder de andere acht af te wachten. Bestaat omdat het
// afstellen van één uitleg-clip anders elke keer de hele reeks kost — en een reeks die vijf minuten
// duurt, stel je niet af.
const ONLY = process.env.CLIP_ONLY;
const SELECTED = ONLY ? CLIPS.filter((c) => c.name.includes(ONLY)) : CLIPS;
if (ONLY && SELECTED.length === 0) {
  console.error(`[CLIPS] CLIP_ONLY=${ONLY} komt met geen enkele clip overeen. Beschikbaar:`);
  for (const c of CLIPS) console.error(`[CLIPS]   ${c.name}`);
  process.exit(2);
}

// Warm draaien. De eerste pagina die Chromium opent betaalt voor alles: de Next-chunks, het
// icoonlettertype van Google, de verbinding. Zonder deze ronde draagt clip 01 die rekening en de
// rest niet, en dan klopt één vaste aanloop voor alle clips niet.
{
  const warm = await browser.newContext({ viewport: VIEW });
  const wp = await warm.newPage();
  // ELKE clip, niet de eerste paar. Met alleen de eerste twee betaalden clip 03 en 04 hun eigen
  // koude start binnen hun eigen opname: seconden wit beeld vooraan, en een clip die daardoor niet
  // op dezelfde lengte uitkwam als de rest.
  for (const c of SELECTED.filter((c) => !c.auth)) {
    await wp.goto(BASE + c.path, { waitUntil: "domcontentloaded" }).catch(() => {});
    await wp.waitForTimeout(600);
  }
  await warm.close();
  console.log(`[CLIPS] warm.`);
}

const made: string[] = [];
for (const clip of SELECTED) {
  if (clip.auth && !sessionOk) { console.log(`[CLIPS] … ${clip.name} overgeslagen (geen sessie)`); continue; }
  const tmp = path.join(OUT, `.raw-${clip.name}`);
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
    recordVideo: { dir: tmp, size: VIDEO },
    ...(clip.auth && storage ? { storageState: JSON.parse(storage) } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(BASE + clip.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  // Elk /dashboard-scherm bepaalt de sessie op de SERVER (dashboard/layout.tsx en de pagina zelf),
  // dus een sessie die daar niet aankomt stuurt je naar /login vóór er één byte HTML is. Zonder
  // deze controle levert dat een keurige clip op van het inlogscherm — het soort fout dat je pas
  // ziet als hij al gepost is.
  if (clip.auth && /\/login/.test(page.url())) {
    console.error(`[CLIPS] ✗ ${clip.name}: /dashboard stuurde door naar /login.`);
    console.error(`[CLIPS]   De browser moet de Supabase-host kunnen bereiken, en SHOT_EMAIL/`);
    console.error(`[CLIPS]   SHOT_PASSWORD moeten van de DEMO-tenant zijn (seed-demo-account.sql).`);
    await ctx.close();
    rmSync(tmp, { recursive: true, force: true });
    continue;
  }
  await installCaption(page, "boekbrug.nl");
  const say = sayer(page);
  // De hook staat stil vóór er iets beweegt: dat is de anderhalve seconde waarin iemand besluit
  // door te scrollen of niet.
  // Een uitleg opent trager dan een teaser: er is geen scroll te stoppen, er is iets te begrijpen.
  await say({ text: clip.hook, ms: clip.maxLen && clip.maxLen > MAX_LEN_S ? 2600 : 1600 });
  await clip.run(page, say, stepper(page));
  await page.waitForTimeout(500);
  await ctx.close(); // pas hierna is het bestand geschreven

  const raw = readdirSync(tmp).find((f) => f.endsWith(".webm"));
  if (!raw) { console.error(`[CLIPS] ✗ ${clip.name}: geen opname`); continue; }
  const webm = path.join(OUT, `${clip.name}.webm`);
  renameSync(path.join(tmp, raw), webm);
  rmSync(tmp, { recursive: true, force: true });

  if (ff) {
    const mp4 = path.join(OUT, `${clip.name}.mp4`);
    // yuv420p + faststart: de twee dingen zonder welke een mp4 op één platform zwart blijft.
    // GEEN "-r 30": Playwright schrijft een variabele framerate, en er een vaste op forceren
    // rekt de clip uit — clip 03 werd zo 21 seconden voor zeven seconden werk. passthrough houdt
    // de tijdstempels van de opname aan.
    // lanczos + een lichte unsharp: een opname van 540 breed die naar 1080 gaat wordt anders zacht
    // op precies de plek waar het om gaat, de cijfers. yuv420p en +faststart zijn de twee dingen
    // zonder welke een mp4 op één of ander platform zwart blijft.
    // -ss vóór -i: knip de aanloop eraf (zie leadIn hierboven). Een derde seconde blijft staan, zodat
    // de clip niet midden in een beweging begint.
    //
    // Vooraan tot het eerste beeld, en daarna hoogstens MAX_LEN_S — het staart-deel, want daar
    // staat het uitgerekende bedrag en de slotzin.
    const from = firstPaintSeconds(ff, webm);
    execFileSync(ff, ["-y", "-ss", from.toFixed(2), "-i", webm, "-t", String(clip.maxLen ?? MAX_LEN_S),
      "-vf", `scale=${OUT_SIZE.width}:${OUT_SIZE.height}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "19",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-fps_mode", "passthrough", mp4], { stdio: "pipe" });
    rmSync(webm, { force: true });
    made.push(mp4);
    console.log(`[CLIPS] ✓ ${clip.name}.mp4`);
  } else {
    made.push(webm);
    console.log(`[CLIPS] ✓ ${clip.name}.webm`);
  }
}

await browser.close();
console.log(`\n[CLIPS] ${made.length} clips in ${OUT}/`);
if (!sessionOk && !EMAIL) {
  console.log(`[CLIPS] Voor de dashboard-clips:`);
  console.log(`[CLIPS]   SHOT_EMAIL=demo@boekbrug.nl SHOT_PASSWORD=… npx tsx scripts/record-clips.mts`);
}
