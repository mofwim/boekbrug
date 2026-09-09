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

/**
 * [TELEFOONBREEDTE] 540 CSS-pixels is geen telefoon.
 *
 * Een iPhone is 390 tot 430 CSS-pixels breed, een Android meestal 360 tot 412. Op 540 opnemen en
 * naar 1080 schalen levert dus een beeld dat 25% kleiner oogt dan wat een échte telefoon van
 * dezelfde pagina laat zien — precies op de plek waar het om gaat, de cijfers.
 *
 * 432×768 is exact 1080×1920 gedeeld door 2,5. Dat is een gewone telefoonbreedte, alles wordt een
 * kwart groter in het eindbeeld, en de schaalfactor blijft heel (geen halve pixels op de randen
 * van letters).
 *
 * Per clip instelbaar en niet globaal: de bestaande clips zijn op 540 gekaderd en opnieuw kaderen
 * is een andere film, geen verbetering die je stilletjes doorvoert.
 */
const PHONE = { width: 432, height: 768 };

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
  /**
   * [STEM] Wat er wordt UITGESPROKEN, als dat anders moet zijn dan wat er staat.
   *
   * Een ondertitel is kort omdat lezen tijd kost; een gesproken zin mag een lidwoord meer hebben.
   * Leeg laten betekent: spreek het bijschrift uit, zonder de opmaak.
   */
  voice?: string;
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
  /** Afwijkend opnameformaat. Standaard VIEW; PHONE voor een echte telefoonbreedte. */
  view?: { width: number; height: number };
  /**
   * [KAAL] Geen ondertitels en geen stapbalk — alleen het scherm en de muis.
   *
   * Voor een clip waar een ECHTE stem onder komt. Twee dragers naast elkaar (gesproken tekst én
   * geschreven tekst die iets anders zegt) laten de kijker kiezen welke hij volgt, en dat is er
   * één te veel. De muis blijft: die vertelt geen tweede verhaal, hij laat zien wie er handelt.
   */
  bare?: boolean;
  /**
   * [STEM-MONTAGE] Een ingesproken bestand waar de beelden op vallen.
   *
   * `beats` zijn de tijdstippen waarop elke zin BEGINT, in seconden, gemeten uit het geluid zelf
   * (silencedetect + een passing op tekstlengte — zie docs/SOCIAL_CLIPS.md). Beeld i staat op het
   * scherm van beats[i] tot beats[i+1]; de laatste tot het einde van het geluid.
   */
  voiceOver?: { file: string; beats: number[]; end: number };
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
   * Het pad zelf. `say` zet de ondertitel; `step` verzet de balk bovenin; `at` wacht tot een
   * tijdstip op de klok van de gesproken tekst; alles ertussen is echte interactie.
   */
  run: (
    p: Page,
    say: (b: Beat) => Promise<void>,
    step: (t: string) => Promise<void>,
    at: (second: number) => Promise<void>,
    stamp: (html: string) => Promise<void>,
  ) => Promise<void>;
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
/* [SCHIJNWERPER] Alles dimmen behalve het blok waar de uitleg het over heeft.
   Een uitleg die zegt "hier vul je je klant in" terwijl het hele formulier even hard staat te
   schreeuwen, wijst nergens naar. De rest gaat achter een waas; het blok komt ervoor te staan. */
#clip-dim{
  position:fixed; inset:0; z-index:2147483640; pointer-events:none;
  background:rgba(8,12,20,.62); opacity:0; transition:opacity .38s ease;
}
#clip-dim.on{opacity:1}
/* Geen padding of border: die zouden de pagina laten verspringen midden in de opname.
   box-shadow tekent buiten het element en kost geen enkele pixel layout. */
.clip-focus{
  position:relative; z-index:2147483641; background:#fff; border-radius:14px;
  box-shadow:0 0 0 10px #fff, 0 0 0 13px ${BLUE}, 0 22px 60px rgba(0,0,0,.45);
  transition:box-shadow .3s ease;
}
/* Eén veld binnen dat blok aanwijzen — voor wat wordt genoemd maar niet ingetypt. */
.clip-point{
  position:relative; z-index:2147483642;
  box-shadow:0 0 0 3px ${BLUE}, 0 0 0 7px rgba(26,115,232,.28); border-radius:9px;
}
/* [CURSOR] Playwright neemt GEEN muisaanwijzer op. Elke opname liet dus dingen vanzelf gebeuren:
   een veld dat oplicht, een keuzelijst die verspringt, zonder dat te zien was dat er iemand klikte.
   Dit tekent er zelf een, met een rimpel bij elke klik — precies wat schermopnamegereedschap als
   Screen Studio doet, en om dezelfde reden: een zoom of een klik moet gemotiveerd lijken. */
#clip-cursor{
  position:fixed; top:0; left:0; z-index:2147483645; pointer-events:none;
  width:22px; height:22px; margin:-4px 0 0 -3px; opacity:0;
  transition:opacity .25s ease;
  filter:drop-shadow(0 2px 4px rgba(0,0,0,.45));
}
#clip-cursor.on{opacity:1}
.clip-ripple{
  position:fixed; z-index:2147483644; pointer-events:none;
  width:18px; height:18px; margin:-9px 0 0 -9px; border-radius:50%;
  border:2px solid ${BLUE}; background:rgba(26,115,232,.22);
  animation:clipRipple .55s ease-out forwards;
}
@keyframes clipRipple{
  from{transform:scale(.4); opacity:.95}
  to{transform:scale(3.4); opacity:0}
}
/* [STEMPEL] Een kort woord dat op de nadruk van de stem valt.
 *
 * Dit is niet de ondertitel van clip 10-12 in het groot. Een ondertitel VERTELT — en naast een
 * sprekende stem is dat een tweede verhaal, waarvan de kijker er één volgt en de andere mist.
 * Een stempel HERHAALT: twee of drie woorden die samenvallen met wat er op dat moment wordt
 * gezegd. Dat concurreert niet, dat zet vast — en het werkt ook als het geluid uit staat, wat op
 * de meeste tijdlijnen de standaard is. */
#clip-stamp{
  position:fixed; left:0; right:0; bottom:0; z-index:2147483643; pointer-events:none;
  padding:54px 26px 44px; box-sizing:border-box; text-align:center;
  /* Een eigen donkere voet. Witte letters met alleen een schaduw zijn onleesbaar op een lichte
     pagina, en juist de hook en de eindkaart spelen zich af zónder schijnwerper — dus daar viel
     de tekst weg. De band draagt hem overal. */
  background:linear-gradient(to top, rgba(7,11,19,.94) 58%, rgba(7,11,19,0));
  font-family:ClipFont,system-ui,sans-serif; font-weight:700;
  font-size:46px; line-height:1.14; color:#fff;
  text-shadow:0 2px 10px rgba(6,10,18,.6);
  opacity:0; transform:scale(.9);
  transition:opacity .2s ease, transform .22s cubic-bezier(.2,1.5,.4,1);
}
#clip-stamp.on{opacity:1; transform:scale(1)}
#clip-stamp em{font-style:normal; display:block; font-size:29px; margin-top:12px; color:#8ec5ff}
/* De eindkaart: de knop klopt, hij knippert niet. */
@keyframes clipPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.clip-pulse{animation:clipPulse 1.15s ease-in-out infinite}
#clip-badge{
  position:fixed; top:0; left:0; right:0; z-index:2147483646; pointer-events:none;
  padding:14px 18px; box-sizing:border-box; text-align:center;
  font-family:ClipFont,system-ui,sans-serif; font-weight:700; font-size:15px; letter-spacing:.04em;
  color:#fff; background:${BLUE};
}`;

async function installCaption(p: Page, badge: string, bare = false) {
  await p.addStyleTag({ content: CAPTION_CSS });
  await p.evaluate(({ b, bare }) => {
    const dim = document.createElement("div"); dim.id = "clip-dim";
    // Een echte pijl, geen stip: een stip leest als een aanwijslaser, een pijl als een gebruiker.
    const cur = document.createElement("div"); cur.id = "clip-cursor";
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">' +
      '<path d="M3 2 L3 17.5 L7.2 13.6 L9.9 19.6 L12.7 18.3 L10 12.4 L15.8 12.2 Z" ' +
      'fill="#fff" stroke="#16223a" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.addEventListener("mousemove", (e) => {
      cur.classList.add("on");
      cur.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }, true);
    document.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "clip-ripple";
      r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 650);
    }, true);
    document.body.appendChild(cur);
    document.body.appendChild(dim);
    const stamp = document.createElement("div"); stamp.id = "clip-stamp";
    document.body.appendChild(stamp); // ook (juist) in een kale clip
    if (bare) return; // alleen scherm en muis — de stem doet de rest
    const cap = document.createElement("div"); cap.id = "clip-cap";
    const bar = document.createElement("div"); bar.id = "clip-badge"; bar.textContent = b;
    document.body.append(bar, cap);
  }, { b: badge, bare });
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

/**
 * [STEM] Wanneer elke zin in beeld kwam, gemeten op de klok van de opname zelf.
 *
 * Niet uitgerekend uit de som van de `ms`-waarden: daar zitten typen, scrollen en wachten tussen,
 * en die duren nooit twee keer precies hetzelfde. Een spoor dat de werkelijke tijdstippen bewaart
 * is het enige dat de stem op de ondertitel laat vallen in plaats van ernaast.
 */
interface VoiceCue { at: number; say: string }

/**
 * [STEMPEL] Een kort woord neerzetten, of weghalen met een lege string.
 *
 * Bewust géén duur: de stempel blijft staan tot de volgende. Een `ms` erbij zou een tweede klok
 * introduceren naast de stem, en twee klokken lopen uit elkaar.
 */
function stamper(p: Page) {
  return async (html: string) => {
    await p.evaluate((t) => {
      const el = document.getElementById("clip-stamp");
      if (!el) return;
      if (!t) { el.classList.remove("on"); return; }
      el.classList.remove("on");
      el.innerHTML = t;
      // Twee frames wachten, anders slaat de browser de animatie over omdat hij de tussenstand
      // nooit heeft getekend.
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
    }, html);
    await p.waitForTimeout(60);
  };
}

/** Een element laten kloppen — voor de knop op de eindkaart. */
async function pulse(p: Page, target: ReturnType<Page["locator"]>, on = true) {
  await target.evaluate((el, v) => el.classList.toggle("clip-pulse", v), on).catch(() => {});
}

/** Ondertitel weergeven, en het tijdstip onthouden voor de stem. */
function sayer(p: Page, cues?: VoiceCue[], t0?: number) {
  return async ({ text, ms, hold, voice }: Beat) => {
    if (cues && t0 !== undefined) {
      // De opmaak eruit: <br> wordt een pauze, <b> zegt niets hoorbaars.
      const spoken = (voice ?? text.replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "")).trim();
      if (spoken) cues.push({ at: (Date.now() - t0) / 1000, say: spoken });
    }
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
  const want = (p.viewportSize()?.height ?? VIEW.height) * fraction;
  await p.evaluate((dy) => window.scrollBy(0, dy), Math.round(box.y - want));
  await p.waitForTimeout(260);
}

// ── [SCHIJNWERPER] Een blok kiezen, centreren en uitlichten ──────────────────

/** Het blok achter een sectiekop ("Document", "Klant (ontvanger)"). */
function section(p: Page, caption: string) {
  return p.locator(`xpath=//p[normalize-space(text())=${JSON.stringify(caption)}]/..`).first();
}

/**
 * Het zoveelste invoerveld BINNEN een blok — en een harde controle op het aantal.
 *
 * Een globale index over de hele pagina ("het 16e input-veld") is precies het soort selector dat
 * stil verschuift zodra iemand een veld toevoegt: de opname slaagt, en filmt het verkeerde vakje.
 * Binnen een blok met een naam zijn het er een handvol, en `expect` maakt van een verschuiving een
 * FOUT in plaats van een verkeerde film.
 */
function fieldIn(block: ReturnType<Page["locator"]>, index: number) {
  return block.locator("input, select").nth(index);
}

async function expectFields(block: ReturnType<Page["locator"]>, n: number, what: string) {
  const got = await block.locator("input, select").count();
  if (got !== n) {
    throw new Error(
      `[CLIPS] "${what}" heeft ${got} velden in plaats van ${n}. Het formulier is veranderd, dus ` +
      `de clip zou een ander vakje filmen dan het bijschrift belooft. Werk de volgorde bij.`,
    );
  }
}

/**
 * Zet een blok in het MIDDEN van het beeld.
 *
 * Niet op ooghoogte maar echt gecentreerd, en niet in de hele viewport: bovenin staat de stapbalk
 * (±44 px) en onderin de ondertitel (±150 px). Het midden van wat de kijker kan zien ligt dus
 * hoger dan het midden van het scherm.
 */
async function centerBlock(p: Page, block: ReturnType<Page["locator"]>) {
  await block.scrollIntoViewIfNeeded();
  await p.waitForTimeout(140);
  const box = await block.boundingBox();
  if (!box) return;
  const TOP_BAR = 44, CAPTION = 150;
  const h = p.viewportSize()?.height ?? VIEW.height;
  const middle = TOP_BAR + (h - TOP_BAR - CAPTION) / 2;
  await p.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), Math.round(box.y + box.height / 2 - middle));
  await p.waitForTimeout(700); // de smooth scroll uitlopen — een sprong leest als een montagefout
}

/** Centreren én uitlichten. De vorige uitlichting gaat vanzelf uit. */
async function focusBlock(p: Page, block: ReturnType<Page["locator"]>) {
  await centerBlock(p, block);
  await p.evaluate(() => {
    document.querySelectorAll(".clip-focus").forEach((e) => {
      (e as HTMLElement).style.transform = ""; // een blok dat nog ingezoomd staat, blijft dat anders
      e.classList.remove("clip-focus");
    });
    document.getElementById("clip-dim")?.classList.add("on");
  });
  await block.evaluate((el) => el.classList.add("clip-focus"));
  await p.waitForTimeout(430);
}

/** De waas weg — voor het moment waarop de kijker het geheel weer moet zien. */
async function unfocus(p: Page) {
  await p.evaluate(() => {
    document.querySelectorAll(".clip-focus, .clip-point").forEach((e) => {
      (e as HTMLElement).style.transform = "";
      e.classList.remove("clip-focus", "clip-point");
    });
    document.getElementById("clip-dim")?.classList.remove("on");
  });
  await p.waitForTimeout(380);
}

/**
 * De muis er echt naartoe bewegen, zodat de getekende cursor meereist.
 *
 * Playwright klikt standaard door de muis in één sprong te verplaatsen. Op een opname leest dat als
 * teleporteren; `steps` maakt er een beweging van. De klik zelf tekent zijn eigen rimpel.
 */
async function moveTo(p: Page, target: ReturnType<Page["locator"]>, steps = 28, settle = 300) {
  // Kort wachten en dan doorlopen: een muis die niet beweegt kost een beeld, een opname die
  // dertig seconden hangt en dan gooit kost de hele reeks.
  const box = await target.boundingBox({ timeout: 4000 }).catch(() => null);
  if (!box) return;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await p.waitForTimeout(settle);
}

/** Eén veld aanwijzen binnen het uitgelichte blok, en het daarna weer loslaten. */
async function pointAt(p: Page, field: ReturnType<Page["locator"]>, ms: number) {
  await field.evaluate((el) => el.classList.add("clip-point"));
  await p.waitForTimeout(ms);
  await field.evaluate((el) => el.classList.remove("clip-point"));
  await p.waitForTimeout(160);
}

/** Typen in een veld dat al is aangewezen — zonder scrollen, want het blok staat al goed. */
/**
 * Typen in een veld, met de muis erheen.
 *
 * `settle` en `steps` staan los, want bij een clip die op een STEM is gemonteerd is de rust na een
 * veld geen smaakkwestie meer maar een budget: past de handeling niet in de zin die erbij hoort,
 * dan schuift alles erna mee. Drie velden kosten alleen al bijna drie seconden aan muis en rust,
 * en dat was precies wat het blok "je klant" over zijn zin heen duwde.
 */
async function fill(
  p: Page, field: ReturnType<Page["locator"]>, value: string,
  perChar = 55, settle = 340, steps = 28,
) {
  await moveTo(p, field, steps, Math.min(settle, 300));
  await field.click();
  await field.fill("");
  await field.type(value, { delay: perChar });
  await p.waitForTimeout(settle);
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

// ── [GEREEDSCHAP] De publieke gereedschapskist, als korte clips ───────────────
//
// Zestien publieke pagina's doen echt werk zonder account: pdf's samenvoegen, splitsen,
// ondertekenen, foto's verkleinen, een watermerk erop. Ze delen één vorm — er gebeurt niets tot
// er een BESTAND in gaat, daarna verschijnt de bediening, en daarna een resultaat — dus ze delen
// hier ook één definitie in plaats van zestien bijna-gelijke clips.
//
// ── HET BESTAND ──
//
// scripts/make-sample-assets.mts maakt verzonnen documenten die eruitzien als echt werk. Nooit een
// document van een echte klant: dezelfde regel als voor de winkelfoto's, en een video verraadt
// méér dan een foto. Alle namen, bedragen, KVK- en IBAN-nummers zijn verzonnen.
//
// Eén ding daarvan is gemeten en niet bedacht: /afbeeldingen-uit-pdf gaf niets terug op de
// facturen-PDF, en dat was het JUISTE antwoord — er zit geen enkele afbeelding in, alleen
// vectortekst. Daar hoort een gescande PDF bij, en die maakt het script nu apart.

/** Eén stap in een gereedschapsclip: wat er op het scherm staat, en wat er ondertussen gebeurt. */
interface ToolBeat {
  /** De stempel. Leeg = de vorige laten staan. */
  stamp?: string;
  /** Hoe lang deze stap duurt. */
  ms: number;
  /** Wat de gebruiker doet. Weglaten = alleen kijken. */
  act?: (p: Page) => Promise<void>;
}

interface ToolSpec {
  name: string;
  path: string;
  /** Bestandsnamen uit scripts/samples/ die in het uploadveld gaan. */
  samples: string[];
  /** De openingszin, in beeld vóór het bestand erin gaat. */
  hook: string;
  /** Hoe lang de tool nodig heeft om het bestand te lezen voordat de bediening verschijnt. */
  readMs?: number;
  beats: ToolBeat[];
}

const SAMPLES = process.env.CLIP_SAMPLES ?? path.join("scripts", "samples");

/** Van compacte beschrijving naar een echte Clip. Eén definitie voor de hele gereedschapskist. */
function toolClip(spec: ToolSpec): Clip {
  return {
    name: spec.name,
    path: spec.path,
    view: PHONE,
    bare: true,
    maxLen: 60,
    hook: "",
    run: async (p, _say, _step, _at, stamp) => {
      await stamp(spec.hook);
      await p.waitForTimeout(1900);

      // Het bestand erin. Geen sleep-animatie: setInputFiles is wat de knop ook doet, en een
      // nagespeelde sleepbeweging is de enige stap in deze clips die niet echt zou zijn.
      const input = p.locator('input[type="file"]').first();
      await input.setInputFiles(spec.samples.map((f) => path.join(SAMPLES, f)));
      await p.waitForTimeout(spec.readMs ?? 2600);

      for (const beat of spec.beats) {
        if (beat.stamp !== undefined) await stamp(beat.stamp);
        if (beat.act) await beat.act(p);
        await p.waitForTimeout(beat.ms);
      }
      await stamp("GRATIS, ZONDER ACCOUNT<br><em>boekbrug.nl" + spec.path + "</em>");
      await p.waitForTimeout(2700);
    },
  };
}

/**
 * Klikken met de muis erheen, zodat de getekende cursor het doet — en NIET de hele reeks
 * omleggen als de knop er niet is.
 *
 * De eerste versie wachtte de volle 30 seconden op een knop die niet bestond en gooide toen; één
 * verkeerde selector nam daarmee vijf clips mee die het wél deden. Een gemiste knop is hier een
 * regel in het verslag, geen afgebroken opname: de clip wordt zwakker, de reeks blijft staan.
 */
async function tap(p: Page, target: ReturnType<Page["locator"]>, settle = 520) {
  if ((await target.count()) === 0) {
    console.error(`[CLIPS] ! knop niet gevonden — stap overgeslagen`);
    return;
  }
  await moveTo(p, target, 22, 200);
  await target.click({ timeout: 4000 }).catch(() => console.error(`[CLIPS] ! klik mislukt — stap overgeslagen`));
  await p.waitForTimeout(settle);
}

/** De voorbeeldafbeelding: de laatste <img> op de pagina is het resultaatvoorbeeld. */
const fotoIn = (p: Page) => p.locator("img").last();

/**
 * Een knop op zijn opschrift.
 *
 * Zonder anker (`^`), en dat is gemeten: de opslaanknop van /watermerk-op-foto heet
 * `" Opslaan (204 kB)"` — met een spatie ervoor van het icoon, en met een grootte die meebeweegt
 * met de instellingen. Een anker of een getal in de selector is dus twee keer fout.
 */
const btn = (p: Page, label: string | RegExp) =>
  p.locator("button").filter({ hasText: label }).first();

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
  // ── [RONDLEIDING] Elk veld bij naam, en het blok waar het over gaat in het MIDDEN. ──
  //
  // Clip 10 laat zien DAT het werkt. Deze legt uit HOE, veld voor veld, voor iemand die het zelf
  // gaat doen. Het verschil zit niet in de lengte maar in waar de kijker kijkt: zeggen "hier vul je
  // je klant in" terwijl het hele formulier even hard in beeld staat, wijst nergens naar. Dus gaat
  // per stap één blok in het midden van het beeld staan en de rest achter een waas.
  //
  // "Het midden" is niet het midden van het scherm: bovenin staat de stapbalk en onderin de
  // ondertitel, dus het midden van wat de kijker kán zien ligt hoger. centerBlock() rekent dat uit.
  //
  // De velden worden per BLOK geteld, niet over de hele pagina, en het aantal wordt gecontroleerd.
  // Een globale index ("het 16e input-veld") verschuift stil zodra iemand een veld toevoegt: de
  // opname slaagt en filmt het verkeerde vakje, met een bijschrift dat iets anders belooft. Nu
  // faalt hij in plaats daarvan.
  {
    name: "11-rondleiding-factuur",
    path: "/factuur-maken",
    maxLen: 90, // ruim: het tempo van run() bepaalt de lengte, de schaar niet
    hook: "Een factuur maken —<br>elk veld uitgelegd.",
    run: async (p, say, step) => {
      const doc = section(p, "Document");
      const mij = section(p, "Jouw gegevens (afzender)");
      const klant = section(p, "Klant (ontvanger)");
      const regels = section(p, "Regels");
      // De volgorde binnen elk blok is wat de bijschriften hieronder beloven. Verandert het
      // formulier, dan stopt de opname hier in plaats van een verkeerd vakje te filmen.
      await expectFields(doc, 8, "Document");
      await expectFields(mij, 9, "Jouw gegevens (afzender)");
      await expectFields(klant, 6, "Klant (ontvanger)");
      await expectFields(regels, 5, "Regels");

      // ── 1 · Het document ──
      await step("1 van 5 · Het document");
      await focusBlock(p, doc);
      await pointAt(p, fieldIn(doc, 1), 800);
      await say({ text: "Het <b>nummer</b> telt vanzelf door.<br>Geen gaten — dat eist de wet.", ms: 2600 });
      await pointAt(p, fieldIn(doc, 2), 700);
      await say({ text: "En drie datums: factuur-,<br>verval- en leverdatum.", ms: 2400 });

      // ── 2 · Jouw gegevens ──
      await step("2 van 5 · Jouw gegevens");
      await focusBlock(p, mij);
      await say({ text: "Hier zet je wie de factuur<br>stuurt. Dat ben jij.", ms: 2200 });
      await fill(p, fieldIn(mij, 0), "Van Dijk Ontwerp");
      await say({ text: "Je <b>adres</b> en plaats.", ms: 1800 });
      await fill(p, fieldIn(mij, 2), "Havenstraat 14", 42);
      await fill(p, fieldIn(mij, 4), "Tilburg", 45);
      await say({ text: "<b>KVK</b> en <b>btw-nummer</b> zijn<br>verplicht op een factuur.", ms: 2500 });
      await fill(p, fieldIn(mij, 5), "83102947", 45);
      await fill(p, fieldIn(mij, 6), "NL003829471B72", 32);
      await say({ text: "En je <b>IBAN</b>, want daar<br>moet het geld heen.", ms: 2200 });
      await fill(p, fieldIn(mij, 7), "NL91 INGB 0002 4455 88", 28);

      // ── 3 · Je klant ──
      await step("3 van 5 · Je klant");
      await focusBlock(p, klant);
      await say({ text: "En hier je <b>klant</b>: naam,<br>adres en plaats.", ms: 2400 });
      await fill(p, fieldIn(klant, 0), "Bakkerij De Korenbloem");
      await fill(p, fieldIn(klant, 2), "Kerkstraat 7", 42);
      await fill(p, fieldIn(klant, 4), "Breda", 45);
      await say({ text: "Zijn btw-nummer alleen als<br>je aan een bedrijf levert.", ms: 2400 });
      await pointAt(p, fieldIn(klant, 5), 900);

      // ── 4 · De regels ──
      await step("4 van 5 · Wat je levert");
      await focusBlock(p, regels);
      await say({ text: "Eén regel per ding<br>dat je hebt geleverd.", ms: 2100 });
      await say({ text: "<b>Omschrijving</b>: wat het was.", ms: 1900 });
      await fill(p, fieldIn(regels, 1), "Ontwerp huisstijl");
      await say({ text: "<b>Aantal</b>: hoeveel uur,<br>stuks of diensten.", ms: 2200 });
      await fill(p, fieldIn(regels, 2), "3", 200);
      await say({ text: "<b>Prijs</b> per stuk,<br>exclusief btw.", ms: 2100 });
      await fill(p, fieldIn(regels, 3), "450", 130);
      await say({ text: "En het <b>btw-tarief</b>:<br>21%, 9% of 0%.", ms: 2300 });
      await pointAt(p, fieldIn(regels, 4), 900);

      // ── 5 · Het totaal ──
      // De waas gaat weg: na vier keer inzoomen moet de kijker het geheel terugzien, en het
      // btw-veld en het totaal moeten tegelijk in beeld staan — anders is de volgende zin niet te
      // controleren.
      await step("5 van 5 · Het totaal");
      await unfocus(p);
      await bringToEyeLine(p, p.getByText("Totaal incl. BTW").first(), 0.52);
      await say({ text: "3 × € 450 = € 1.350, plus<br>21% btw = <b>€ 1.633,50</b>", ms: 3000 });
      await fieldIn(regels, 4).selectOption("9");
      await p.waitForTimeout(800);
      await say({ text: "Ander tarief? Eén keuze —<br>en alles telt opnieuw.", ms: 2600 });
      await say({ text: "Gratis, zonder account.<br><b>boekbrug.nl/factuur-maken</b>", ms: 2800, hold: true });
    },
  },
  // ── [FORMULE] Dezelfde rondleiding, gebouwd op wat de vakliteratuur er wél over zegt. ──
  //
  // Clip 11 is een goede rondleiding en overtreedt drie regels waar elke bron het over eens is.
  // Deze is dezelfde inhoud, opnieuw gemonteerd volgens die regels — zodat de twee naast elkaar te
  // vergelijken zijn in plaats van dat er één wordt vervangen.
  //
  //   1. PIJN VOOR FUNCTIE. "Een factuur maken — elk veld uitgelegd" is een functie. Elke bron zegt
  //      hetzelfde: open bij het probleem van de kijker, niet bij het product. De eerste drie
  //      seconden beslissen, en ze beslissen op "gaat dit over mij?" — niet op "wat is dit?".
  //   2. ONDER DE MINUUT. Betrokkenheid zakt scherp voorbij de zestig seconden; clip 11 duurt 65.
  //      Dezelfde inhoud past in vijftig als de uitleg de handeling niet dubbelop vertelt.
  //   3. BEWIJS AAN HET EIND. Niet nóg een functie, maar het resultaat dat de belofte waarmaakt:
  //      het tarief verandert en de bedragen lopen mee. Dat is de "proof"-beat.
  //
  // En drie dingen uit het ambacht van schermopnames die hier ontbraken:
  //
  //   · een MUISAANWIJZER. Playwright neemt er geen op, dus gebeurde alles vanzelf: velden lichtten
  //     op zonder dat iemand ze aanraakte. Er wordt er nu één getekend, met een rimpel bij de klik.
  //   · ZOOMEN op het veld dat wordt genoemd, met een ease-out-curve. Een blok uitlichten zegt
  //     "hier ergens"; inzoomen zegt "dit".
  //   · TELEFOONBREEDTE. 540 CSS-pixels is geen telefoon (390–430 is het). Op 432 opnemen maakt
  //     alles een kwart groter in hetzelfde eindbeeld — op de cijfers, waar het om gaat.
  {
    name: "12-factuur-formule",
    path: "/factuur-maken",
    view: PHONE,
    maxLen: 90,
    // De pijn, niet de functie. Dit is de zin die bepaalt of er verder gekeken wordt.
    hook: "Een factuur maken kost je<br>een half uur. En dan klopt<br>de btw nóg niet.",
    run: async (p, say, step) => {
      const mij = section(p, "Jouw gegevens (afzender)");
      const klant = section(p, "Klant (ontvanger)");
      const regels = section(p, "Regels");
      await expectFields(mij, 9, "Jouw gegevens (afzender)");
      await expectFields(klant, 6, "Klant (ontvanger)");
      await expectFields(regels, 5, "Regels");

      // ── De belofte, meteen na de pijn. Eén zin, dan bewegen. ──
      await say({
        text: "Dit duurt één minuut,<br>en de btw rekent zichzelf.",
        voice: "Dit duurt één minuut. En de btw rekent zichzelf uit.",
        ms: 2600,
      });

      // ── Jij ──
      await step("1 · Wie stuurt de factuur");
      await focusBlock(p, mij);
      await say({
        text: "Je eigen gegevens,<br>één keer.",
        voice: "Eerst je eigen gegevens. Die vul je één keer in.",
        ms: 2400,
      });
      await fill(p, fieldIn(mij, 0), "Van Dijk Ontwerp", 48);
      await fill(p, fieldIn(mij, 2), "Havenstraat 14", 48);
      await fill(p, fieldIn(mij, 4), "Tilburg", 55);
      await say({
        text: "<b>KVK</b> en <b>btw-nummer</b>:<br>wettelijk verplicht.",
        voice: "Je K V K nummer en je btw nummer zijn wettelijk verplicht.",
        ms: 2600,
      });
      await fill(p, fieldIn(mij, 6), "NL003829471B72", 44);

      // ── Je klant ──
      await step("2 · Wie hem ontvangt");
      await focusBlock(p, klant);
      await say({
        text: "Je klant: naam,<br>adres en plaats.",
        voice: "Dan je klant. Naam, adres en plaats.",
        ms: 2500,
      });
      await fill(p, fieldIn(klant, 0), "Bakkerij De Korenbloem", 46);
      await fill(p, fieldIn(klant, 2), "Kerkstraat 7", 48);
      await fill(p, fieldIn(klant, 4), "Breda", 55);

      // ── Wat je levert ──
      await step("3 · Wat je hebt geleverd");
      await focusBlock(p, regels);
      await say({
        text: "Wat je deed,<br>hoeveel, en waarvoor.",
        voice: "Nu de regel. Wat je deed, hoeveel, en voor welk bedrag.",
        ms: 2500,
      });
      await fill(p, fieldIn(regels, 1), "Ontwerp huisstijl", 48);
      await fill(p, fieldIn(regels, 2), "3", 220);
      await fill(p, fieldIn(regels, 3), "450", 150);
      await say({ text: "3 uur × € 450", voice: "Drie uur, keer vierhonderdvijftig euro.", ms: 2100 });

      // ── Het bewijs: de belofte uit de hook, waargemaakt ──
      await step("Het rekent zichzelf");
      await moveTo(p, fieldIn(regels, 4));
      await say({
        text: "21% erop:<br><b>€ 1.633,50</b>",
        voice: "Eenentwintig procent btw erop. Totaal: zestienhonderd drieëndertig euro vijftig.",
        ms: 2800,
      });
      await fieldIn(regels, 4).selectOption("9");
      await p.waitForTimeout(1100);
      await say({
        text: "9%? <b>€ 1.471,50</b><br>Direct opnieuw geteld.",
        voice: "Negen procent? Veertienhonderd eenenzeventig vijftig. Direct opnieuw geteld.",
        ms: 3000,
      });
      await unfocus(p);
      await bringToEyeLine(p, p.getByText("Totaal incl. BTW").first(), 0.55);
      await say({
        text: "Nooit meer zelf<br>btw uitrekenen.",
        voice: "Nooit meer zelf btw uitrekenen.",
        ms: 2500,
      });
      await say({
        text: "Gratis, zonder account.<br><b>boekbrug.nl/factuur-maken</b>",
        voice: "Gratis, en zonder account. Boekbrug punt N L.",
        ms: 3000, hold: true,
      });
    },
  },
  // ── [STEM-MONTAGE] Op een ingesproken tekst gemonteerd. Geen letter in beeld. ──
  //
  // Alle clips hiervoor dragen hun uitleg in ondertitels, omdat er niemand sprak. Hier spreekt er
  // wél iemand, en dan is geschreven tekst ernaast geen extra maar een tweede verhaal: de kijker
  // kiest er één om te volgen en mist de andere. Dus alleen het scherm en de muis.
  //
  // ── HOE DE TIJDEN ZIJN BEPAALD ──
  //
  // Niet geschat. Uit het geluid zelf gemeten: silencedetect geeft elke pauze, en welke pauze bij
  // welke zin hoort volgt uit een passing op tekstlengte (één stem in één taal leest ongeveer even
  // snel). De eerste gok — "de elf langste pauzes zijn de elf zinsgrenzen" — was fout: er kwamen
  // zinnen van drie woorden uit die vier seconden zouden duren. De passing haalt 13% gemiddelde
  // afwijking, en de korte zinnen vallen precies op de korte stukken, wat het bewijs is dat de
  // toewijzing klopt en niet alleen goedkoop past.
  //
  // `at(seconde)` wacht tot dat punt op de klok van de stem. Wat ervóór staat, moet er dus in
  // passen; loopt een handeling uit, dan zegt het verslag het in plaats van stilletjes te schuiven.
  {
    name: "13-factuur-stem",
    path: "/factuur-maken",
    view: PHONE,
    bare: true,
    maxLen: 75,
    hook: "", // niet gebruikt: bare
    voiceOver: {
      file: path.join("scripts", "voice", "factuur-nl.mp3"),
      beats: [0, 4.29, 7.63, 9.42, 14.50, 22.78, 27.48, 32.67, 34.53, 43.04, 48.07, 53.84],
      end: 59.90,
    },
    run: async (p, _say, _step, at) => {
      const mij = section(p, "Jouw gegevens (afzender)");
      const klant = section(p, "Klant (ontvanger)");
      const regels = section(p, "Regels");
      await expectFields(mij, 9, "Jouw gegevens (afzender)");
      await expectFields(klant, 6, "Klant (ontvanger)");
      await expectFields(regels, 5, "Regels");
      const totaal = p.getByText("Totaal incl. BTW").first();

      // 1 · "Nog steeds een half uur bezig met één factuur?" — het lege formulier, stil.
      await at(0.4);
      await p.mouse.move(230, 300, { steps: 20 });

      // 2 · "En dan moet je de btw ook nog zelf uitrekenen." — naar de lege btw-regel: € 0,00.
      await at(4.29);
      await bringToEyeLine(p, totaal, 0.46);

      // 3 · "Dat kan makkelijker." — één tel rust op die nullen.
      await at(7.63);

      // 4 · "Met BoekBrug maak je in ongeveer één minuut een professionele factuur."
      await at(9.42);
      await focusBlock(p, mij);

      // 5 · "Eerst vul je één keer je eigen gegevens in: je bedrijfsnaam, KVK-nummer en
      //      btw-nummer." — precies die drie, in die volgorde. Het beeld volgt het woord.
      await at(14.50);
      await fill(p, fieldIn(mij, 0), "Van Dijk Ontwerp", 52);
      await fill(p, fieldIn(mij, 5), "83102947", 60);
      await fill(p, fieldIn(mij, 6), "NL003829471B72", 46);

      // 6 · "Daarna de gegevens van je klant: naam, adres en plaats."
      await at(22.78);
      // Krap venster (4,7 s voor drie velden): kortere muisbogen en minder rust erna.
      await focusBlock(p, klant);
      await fill(p, fieldIn(klant, 0), "Bakkerij De Korenbloem", 26, 150, 14);
      await fill(p, fieldIn(klant, 2), "Kerkstraat 7", 30, 150, 14);
      await fill(p, fieldIn(klant, 4), "Breda", 46, 200, 14);

      // 7 · "En als laatste vul je in wat je hebt gedaan, hoeveel en waarvoor."
      await at(27.48);
      // Ook krap (5,2 s): "wat, hoeveel, waarvoor" is drie velden in één adem.
      await focusBlock(p, regels);
      await fill(p, fieldIn(regels, 1), "Ontwerp huisstijl", 36, 170, 14);
      await fill(p, fieldIn(regels, 2), "3", 160, 200, 14);
      await fill(p, fieldIn(regels, 3), "450", 120, 220, 14);

      // 8 · "De rest gaat vanzelf." — de bedragen staan er. Stil laten staan.
      await at(32.67);
      await moveTo(p, totaal);

      // 9 · "Kies je btw-tarief van 21% of 9%, en de bedragen worden automatisch berekend."
      //     De stem pauzeert hoorbaar op 38,71 en 42,34 — dáár valt de keuze, niet ervoor.
      await at(34.53);
      await moveTo(p, fieldIn(regels, 4));
      await at(38.71);
      await fieldIn(regels, 4).selectOption("9");
      await at(41.0);
      await moveTo(p, totaal);

      // 10 · "Zo hoef je nooit meer zelf de btw uit te rekenen." — op het bedrag blijven.
      await at(43.04);

      // 11 · "Geen gedoe. Geen ingewikkelde berekeningen. En je hebt geen account nodig."
      //      De waas gaat weg: de kijker ziet de hele factuur terug.
      await at(48.07);
      await unfocus(p);
      await bringToEyeLine(p, totaal, 0.40);

      // 12 · "Maak je factuur gratis op boekbrug.nl/factuur-maken." — naar de knop, en blijven.
      //
      // Verdraagzaam gezocht: deze knop staat er pas als het formulier compleet genoeg is, en zijn
      // naam draagt een pijl ("↓ Download PDF"). Een clip mag niet afbreken op één knop die net
      // anders heet — dan is er geen film in plaats van een film met een saai slot.
      await at(53.84);
      // PDFDownloadLink levert een <a>, geen <button> — daarom zocht de vorige versie zich
      // suf. Op de TEKST zoeken, want dat is wat de kijker ziet staan.
      const pdf = p.locator("a, button").filter({ hasText: /Download PDF/i }).first();
      if (await pdf.count() > 0) {
        await moveTo(p, pdf);
      } else {
        console.error("[CLIPS] ! 13-factuur-stem: de Download-PDF-knop is niet gevonden — slot op het totaal.");
      }
      await at(59.9);
    },
  },
  // ── [STEMPELS] Dezelfde stem, met korte woorden die op de nadruk vallen. ──
  //
  // Clip 13 draagt alles op de stem en zet geen letter in beeld. Dit is de andere kant van dezelfde
  // keuze: twee of drie woorden per zin, in hoofdletters, die HERHALEN wat er net gezegd wordt.
  //
  // Het verschil met de ondertitels van 10-12 is niet de grootte maar de functie. Een ondertitel
  // vertelt, en naast een sprekende stem is dat een tweede verhaal — de kijker volgt er één en
  // mist de andere. Een stempel vertelt niets nieuws; hij zet vast wat het oor net hoorde, en hij
  // werkt óók als het geluid uit staat, wat op de meeste tijdlijnen de standaard is.
  //
  // ── DE TIJDEN, EN WAAROM ZE NIET RONDE GETALLEN ZIJN ──
  //
  // Uit het geluid gemeten, niet gekozen. Een voorstel voor deze clip had ronde tijden (0-3, 3-7,
  // 7-10 …) en die liepen tot 6,5 seconden uit de pas met wat er werkelijk wordt gezegd: het
  // btw-moment zou een halve zin te laat vallen. De grenzen hieronder komen uit silencedetect,
  // met de staart gesplitst op de kleinere pauzes — "Geen gedoe", "Geen ingewikkelde
  // berekeningen" en "En je hebt geen account nodig" zijn drie zinnen en krijgen drie stempels.
  //
  // ── HET MOMENT ZELF ──
  //
  // "De rest gaat vanzelf" is de beste zin van de tekst, en het bedrag hoort er precies op te
  // landen. Dat is geen truc: het totaal rekent in de app mee terwijl je typt, dus de prijs wordt
  // zó laat ingetypt dat de laatste toets valt op 32,5 — een fractie vóór de zin, want het oog
  // heeft een tel nodig voordat het woord komt.
  {
    name: "14-factuur-stempels",
    path: "/factuur-maken",
    view: PHONE,
    bare: true,
    maxLen: 75,
    hook: "",
    voiceOver: {
      file: path.join("scripts", "voice", "factuur-nl.mp3"),
      beats: [0, 4.29, 7.63, 9.42, 14.50, 22.78, 27.48, 32.67, 34.53, 43.04, 48.07, 50.79, 53.84, 56.20],
      end: 59.90,
    },
    run: async (p, _say, _step, at, stamp) => {
      const mij = section(p, "Jouw gegevens (afzender)");
      const klant = section(p, "Klant (ontvanger)");
      const regels = section(p, "Regels");
      await expectFields(mij, 9, "Jouw gegevens (afzender)");
      await expectFields(klant, 6, "Klant (ontvanger)");
      await expectFields(regels, 5, "Regels");
      const totaal = p.getByText("Totaal incl. BTW").first();

      // 1 · "Nog steeds een half uur bezig met één factuur?"
      await stamp("EEN HALF UUR<br>VOOR EEN FACTUUR?");
      await at(0.5);
      await p.mouse.move(230, 300, { steps: 20 });

      // 2 · "En dan moet je de btw ook nog zelf uitrekenen." — de lege btw-regel: € 0,00.
      await at(4.29);
      await stamp("EN DE BTW<br>ZELF UITREKENEN?");
      await bringToEyeLine(p, totaal, 0.44);

      // 3 · "Dat kan makkelijker."
      await at(7.63);
      await stamp("DAT KAN<br>MAKKELIJKER");

      // 4 · "Met BoekBrug maak je in ongeveer één minuut een professionele factuur."
      await at(9.42);
      await stamp("EEN MINUUT");
      await focusBlock(p, mij);

      // 5 · "Eerst vul je één keer je eigen gegevens in: je bedrijfsnaam, KVK-nummer en btw-nummer."
      await at(14.50);
      await stamp("JOUW GEGEVENS");
      await fill(p, fieldIn(mij, 0), "Van Dijk Ontwerp", 52);
      await fill(p, fieldIn(mij, 5), "83102947", 60);
      await fill(p, fieldIn(mij, 6), "NL003829471B72", 46);

      // 6 · "Daarna de gegevens van je klant: naam, adres en plaats."
      await at(22.78);
      await stamp("JE KLANT");
      await focusBlock(p, klant);
      await fill(p, fieldIn(klant, 0), "Bakkerij De Korenbloem", 26, 150, 14);
      await fill(p, fieldIn(klant, 2), "Kerkstraat 7", 30, 150, 14);
      await fill(p, fieldIn(klant, 4), "Breda", 46, 200, 14);

      // 7 · "En als laatste vul je in wat je hebt gedaan, hoeveel en waarvoor."
      await at(27.48);
      await stamp("WAT &middot; HOEVEEL<br>&middot; WAARVOOR");
      await focusBlock(p, regels);
      await fill(p, fieldIn(regels, 1), "Ontwerp huisstijl", 36, 170, 14);
      await fill(p, fieldIn(regels, 2), "3", 160, 200, 14);
      // De prijs bewust LAAT: de laatste toets moet vlak vóór "De rest gaat vanzelf" vallen.
      await at(31.40);
      await fill(p, fieldIn(regels, 3), "450", 175, 110, 12);

      // 8 · "De rest gaat vanzelf." — het bedrag staat er nu. Niets doen, laten staan.
      await at(32.67);
      await stamp("AUTOMATISCH");

      // 9 · "Kies je btw-tarief van 21% of 9%, en de bedragen worden automatisch berekend."
      await at(34.53);
      await stamp("21% &rarr; 9%");
      await moveTo(p, fieldIn(regels, 4));
      await at(38.71); // de hoorbare pauze na "21% of 9%,"
      await fieldIn(regels, 4).selectOption("9");
      await at(41.0);
      await moveTo(p, totaal);

      // 10 · "Zo hoef je nooit meer zelf de btw uit te rekenen."
      await at(43.04);
      await stamp("NOOIT MEER<br>ZELF REKENEN");

      // 11 · Drie korte zinnen, drie stempels. De waas gaat weg: de hele factuur terug in beeld.
      await at(48.07);
      await stamp("GEEN GEDOE");
      await unfocus(p);
      await bringToEyeLine(p, totaal, 0.40);
      await at(50.79);
      await stamp("GEEN REKENWERK");
      await at(53.84);
      await stamp("GEEN ACCOUNT");

      // 12 · "Maak je factuur gratis op boekbrug.nl/factuur-maken."
      await at(56.20);
      await stamp("GRATIS FACTUUR MAKEN<br><em>boekbrug.nl/factuur-maken</em>");
      const pdf = p.locator("a, button").filter({ hasText: /Download PDF/i }).first();
      if (await pdf.count() > 0) {
        await moveTo(p, pdf, 20, 120);
        await pulse(p, pdf, true);
      }
      await at(59.9);
    },
  },
  // ── [GEREEDSCHAP] Eerste reeks. Elke bediening hieronder is nagemeten in de draaiende app. ──
  toolClip({
    name: "20-watermerk-op-foto",
    path: "/watermerk-op-foto",
    samples: ["bon-foto.jpg"],
    hook: "JE FOTO<br>DOORSTUREN?",
    beats: [
      // [KADER] De foto staat 400 pixels ónder de bediening, en die twee passen niet samen in
      // beeld. De eerste opname liet daardoor "METEEN TE ZIEN" zien terwijl de foto buiten beeld
      // stond — een bijschrift dat zijn eigen scherm tegensprak. Dus wisselt de clip bewust tussen
      // twee kaders: de knoppen waar je iets doet, en de foto waar je het ziet gebeuren.
      {
        stamp: "ZET ER JE NAAM OP",
        ms: 700,
        act: async (p) => {
          await bringToEyeLine(p, p.locator('input[placeholder="© jouw naam"]').first(), 0.14);
          // Linksboven meteen: het merk staat dan aan de BOVENkant van de foto, en dat is de kant
          // die in beeld komt als je naar de foto scrollt.
          const pos = p.locator("select").first();
          await pos.selectOption({ label: "Linksboven" }).catch(() => {});
        },
      },
      {
        ms: 900,
        act: async (p) => {
          const naam = p.locator('input[placeholder="© jouw naam"]').first();
          await moveTo(p, naam, 22, 200);
          await naam.click();
          await naam.fill("");
          await naam.type("© Van Dijk Ontwerp", { delay: 62 });
        },
      },
      {
        stamp: "METEEN OP JE FOTO",
        ms: 2600,
        act: async (p) => { await bringToEyeLine(p, fotoIn(p), 0.17); },
      },
      {
        stamp: "WIT OF ZWART",
        ms: 1500,
        act: async (p) => {
          await bringToEyeLine(p, p.locator('input[placeholder="© jouw naam"]').first(), 0.14);
          await tap(p, btn(p, /Zwart/));
        },
      },
      {
        stamp: "",
        ms: 2200,
        act: async (p) => { await bringToEyeLine(p, fotoIn(p), 0.17); },
      },
      {
        stamp: "EN OPSLAAN",
        ms: 2000,
        act: async (p) => {
          await bringToEyeLine(p, btn(p, /Opslaan/), 0.34);
          await moveTo(p, btn(p, /Opslaan/), 22, 200);
        },
      },
    ],
  }),

  toolClip({
    name: "21-afbeelding-verkleinen",
    path: "/afbeelding-verkleinen",
    samples: ["bon-foto.jpg"],
    hook: "FOTO TE GROOT<br>OM TE MAILEN?",
    beats: [
      { stamp: "KIES EEN DOELGROOTTE", ms: 1400 },
      { ms: 1500, act: async (p) => { await tap(p, btn(p, /250 kB/)); } },
      { stamp: "OF EEN ANDER FORMAAT", ms: 1500, act: async (p) => { await tap(p, btn(p, /WebP/)); } },
      {
        stamp: "VERKLEINEN",
        ms: 3200,
        act: async (p) => {
          await tap(p, btn(p, /Verkleinen/), 200);
          await p.waitForTimeout(2400);
        },
      },
      // Het laatste woord is het RESULTAAT, niet de knop die je net indrukte.
      { stamp: "VAN 1,2 MB<br>NAAR 250 KB", ms: 2600 },
    ],
  }),

  toolClip({
    name: "22-pdf-samenvoegen",
    path: "/pdf-samenvoegen",
    samples: ["inkoopfacturen-3p.pdf", "inkoopfactuur-1p.pdf"],
    hook: "VIER LOSSE PDF'S<br>NAAR JE BOEKHOUDER?",
    readMs: 3200,
    beats: [
      { stamp: "SLEEP ZE ER SAMEN IN", ms: 1600 },
      {
        stamp: "ZET DE VOLGORDE GOED",
        ms: 1800,
        act: async (p) => { await tap(p, p.locator("button").filter({ hasText: "↑" }).nth(1)); },
      },
      {
        stamp: "SAMENVOEGEN",
        ms: 3000,
        act: async (p) => {
          await tap(p, btn(p, /Samenvoegen/), 200);
          await p.waitForTimeout(2200);
        },
      },
      { stamp: "ÉÉN DOCUMENT", ms: 2000 },
    ],
  }),

  toolClip({
    name: "23-pdf-ondertekenen",
    path: "/pdf-ondertekenen",
    samples: ["inkoopfactuur-1p.pdf"],
    hook: "MOET JE HEM<br>NOG TEKENEN?",
    readMs: 3200,
    beats: [
      {
        stamp: "TEKEN MET JE VINGER",
        ms: 900,
        // Het tekenvlak staat onder de knoppen en viel buiten beeld: de eerste opname liet de
        // handtekening verschijnen zonder dat iemand hem zag zetten — precies het moment waar deze
        // clip om bestaat. Eerst in beeld brengen, dan pas tekenen.
        act: async (p) => { await bringToEyeLine(p, p.locator("canvas").first(), 0.22); },
      },
      {
        ms: 1600,
        act: async (p) => {
          // Een echte handtekening op het echte tekenvlak: muis omlaag, een lus, muis omhoog.
          const canvas = p.locator("canvas").first();
          const box = await canvas.boundingBox();
          if (!box) return;
          const x = box.x, y = box.y + box.height / 2;
          await p.mouse.move(x + box.width * 0.12, y + 14, { steps: 8 });
          await p.mouse.down();
          for (const [dx, dy] of [[0.20, -26], [0.28, 16], [0.36, -20], [0.46, 10], [0.56, -24], [0.66, 6], [0.78, -12]]) {
            await p.mouse.move(x + box.width * (dx as number), y + (dy as number), { steps: 6 });
          }
          await p.mouse.up();
          await p.waitForTimeout(400);
        },
      },
      { stamp: "ZET HEM OP DE PAGINA", ms: 2200 },
      {
        stamp: "ONDERTEKENEN",
        ms: 3000,
        act: async (p) => {
          await tap(p, btn(p, /Ondertekenen/), 200);
          await p.waitForTimeout(2200);
        },
      },
      { stamp: "GETEKEND", ms: 1900 },
    ],
  }),

  toolClip({
    name: "24-pdf-naar-tekst",
    path: "/pdf-naar-tekst",
    samples: ["inkoopfacturen-3p.pdf"],
    hook: "TEKST UIT EEN PDF<br>OVERTYPEN?",
    readMs: 3400,
    beats: [
      { stamp: "DE TEKST STAAT ER AL", ms: 2600 },
      { stamp: "MET OF ZONDER<br>PAGINANUMMERS", ms: 1900, act: async (p) => { await tap(p, btn(p, /Zonder/)); } },
      { stamp: "KOPIËREN OF OPSLAAN", ms: 2200, act: async (p) => { await moveTo(p, btn(p, /Kopiëren/), 22, 200); } },
    ],
  }),

  toolClip({
    name: "25-pdf-splitsen",
    path: "/pdf-splitsen",
    samples: ["inkoopfacturen-3p.pdf"],
    hook: "ÉÉN PAGINA UIT<br>EEN DIKKE PDF?",
    readMs: 3400,
    beats: [
      { stamp: "KIES WELKE PAGINA'S", ms: 1500 },
      {
        ms: 1700,
        act: async (p) => {
          const vak = p.locator('input[placeholder*="1-3"]').first();
          await moveTo(p, vak, 22, 200);
          await vak.click();
          await vak.fill("");
          await vak.type("2", { delay: 120 });
        },
      },
      {
        stamp: "SPLITSEN",
        ms: 3000,
        act: async (p) => {
          await tap(p, btn(p, /Splitsen/), 200);
          await p.waitForTimeout(2200);
        },
      },
      { stamp: "ALLEEN DIE PAGINA", ms: 2000 },
    ],
  }),

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

/**
 * [STEM] Een gesproken spoor onder de clip leggen, op de tijdstippen waarop de zinnen in beeld
 * kwamen.
 *
 * Alleen als CLIP_VOICE staat: stil is de standaard en dat blijft zo. De meeste mensen kijken
 * zonder geluid, dus de ondertitels blijven de drager — een stem is een extra, nooit de enige weg
 * waarop de boodschap aankomt.
 *
 * Welke stem: `espeak-ng` is een formant-synthesizer en klinkt daar ook naar. Dit is er om te
 * HOREN of gesproken tekst de uitleg helpt, niet om te publiceren. Een echte stem — of een neuraal
 * model — vervangt hem zonder dat er iets aan de tijdlijn hoeft te veranderen, want die staat
 * hieronder los van de spreker.
 */
/** De lengte van een mediabestand, gelezen uit ffmpeg's eigen verslag (ffprobe ontbreekt hier). */
function mediaSeconds(ff: string, file: string): number {
  const r = spawnSync(ff, ["-i", file], { encoding: "utf-8" });
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(`${r.stderr ?? ""}`);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function speak(ff: string, cues: Array<{ at: number; say: string }>, dir: string, name: string, from: number): string | null {
  // `from` is hier het NULPUNT VAN DE VIDEO op de klok van dit script, niet alleen de afgeknipte
  // aanloop. Zie de berekening bij de aanroep: Playwright begint pas te filmen bij het eerste
  // beeld, niet bij het aanmaken van de context, en dat scheelde hier dertien seconden — de eerste
  // gesproken zin viel op het moment dat de derde ondertitel in beeld stond.
  const say = "espeak-ng";
  try { execFileSync(say, ["--version"], { stdio: "pipe" }); } catch { 
    console.error(`[CLIPS] geen ${say} — clip blijft stil. apt-get install ${say}`);
    return null;
  }
  const parts: string[] = [];
  const args: string[] = [];
  const delays: string[] = [];
  cues.forEach((c, i) => {
    const wav = path.join(dir, `.voice-${name}-${i}.wav`);
    // -s 150: iets trager dan standaard, want dit is uitleg. -g 6: adempauze tussen woorden.
    // -p 35: lager dan standaard; hoog klinkt bij deze synthese meteen als een robot uit 1985.
    execFileSync(say, ["-v", "nl", "-s", "150", "-g", "6", "-p", "35", "-w", wav, c.say], { stdio: "pipe" });
    parts.push(wav);
    const at = Math.max(0, Math.round((c.at - from) * 1000));
    delays.push(`[${i}:a]adelay=${at}|${at},volume=1.35[a${i}]`);
  });
  if (parts.length === 0) return null;
  if (process.env.CLIP_VOICE_DEBUG) {
    console.log(`[STEM] from=${from.toFixed(2)}s  cues=${cues.map((c) => c.at.toFixed(2)).join(", ")}`);
  }
  for (const w of parts) args.push("-i", w);
  const out = path.join(dir, `.voice-${name}.wav`);
  const graph = `${delays.join(";")};${parts.map((_, i) => `[a${i}]`).join("")}amix=inputs=${parts.length}:duration=longest:normalize=0[out]`;
  execFileSync(ff, ["-y", ...args, "-filter_complex", graph, "-map", "[out]", out], { stdio: "pipe" });
  for (const w of parts) rmSync(w, { force: true });
  return out;
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
// Kommagescheiden, want "CLIP_ONLY=2" ving ook 02-uurtarief en 12-factuur-formule: een filter dat
// te veel pakt kost een kwartier opnemen aan clips waar je niet om vroeg.
const ONLY_LIST = ONLY ? ONLY.split(",").map((x) => x.trim()).filter(Boolean) : [];
const SELECTED = ONLY_LIST.length ? CLIPS.filter((c) => ONLY_LIST.some((o) => c.name.includes(o))) : CLIPS;
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
  const view = clip.view ?? VIEW;
  const ctx = await browser.newContext({
    viewport: view,
    deviceScaleFactor: 2,
    recordVideo: { dir: tmp, size: view },
    ...(clip.auth && storage ? { storageState: JSON.parse(storage) } : {}),
  });
  // De klok van deze opname. Playwright begint met filmen zodra de context bestaat, dus dit is
  // nulpunt nul van de videotijdlijn — vóór de navigatie, niet erna.
  const t0 = Date.now();
  const cues: VoiceCue[] = [];
  const page = await ctx.newPage();
  await page.goto(BASE + clip.path, { waitUntil: "domcontentloaded" });
  // Kort, niet 900 ms: dit venster is alleen bedoeld om een server-redirect te laten gebeuren,
  // en elke milliseconde erna is beeld waar niets op staat. Zie de hook hieronder.
  await page.waitForTimeout(350);
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
  await installCaption(page, "boekbrug.nl", clip.bare);
  const say = sayer(page, cues, t0);
  // De hook staat stil vóór er iets beweegt: dat is de anderhalve seconde waarin iemand besluit
  // door te scrollen of niet.
  //
  // [EERSTE FRAME] En hij staat er METEEN. Dit stond hier achter 900 ms bezinktijd, en op de
  // opname was dat te zien: anderhalve seconde stilstaande paginakop vóór de eerste letter. Elke
  // bron over verticale video zegt hetzelfde over die anderhalve seconde — dat is de gemiddelde
  // kijktijd, niet de aanloop ernaartoe. Het eerste frame is ook het frame dat een platform als
  // voorbeeld toont, dus een leeg eerste frame is een lege voorvertoning.
  //
  // De pagina bezinkt nu ACHTER de hook: die staat toch stil, dus de tijd is gratis.
  // Een uitleg opent trager dan een teaser: er is geen scroll te stoppen, er is iets te begrijpen.
  const hookMs = clip.maxLen && clip.maxLen > MAX_LEN_S ? 2600 : 1600;
  if (!clip.voiceOver) await say({ text: clip.hook, ms: hookMs });

  /**
   * [STEM-MONTAGE] Seconde nul van de gesproken tekst, hier op de klok gezet.
   *
   * Alles wat hierboven gebeurde — laden, bezinken, de laag installeren — valt VÓÓR het geluid.
   * De video wordt straks op dit punt afgeknipt, zodat beeld en stem allebei bij nul beginnen.
   */
  const voStart = Date.now();
  const overruns: string[] = [];
  const at = async (second: number) => {
    const wait = voStart + second * 1000 - Date.now();
    if (wait < -120) {
      // Niet stil doorlopen: als een handeling langer duurde dan de zin die erbij hoort, schuift
      // alles erna mee en valt het beeld naast de stem. Dat wil je in het verslag zien staan.
      overruns.push(`${second.toFixed(2)}s te laat met ${(-wait / 1000).toFixed(2)}s`);
      return;
    }
    if (wait > 0) await page.waitForTimeout(wait);
  };
  try {
    await clip.run(page, say, stepper(page), at, stamper(page));
  } catch (e) {
    // De opname tot hier is bruikbaar; wegdoen zou de andere clips ook kosten.
    console.error(`[CLIPS] ! ${clip.name}: afgebroken — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  if (overruns.length > 0) {
    console.error(`[CLIPS] ! ${clip.name}: beeld loopt achter op de stem — ${overruns.join(" · ")}`);
  }
  const voStartElapsed = (voStart - t0) / 1000;
  await page.waitForTimeout(500);
  await ctx.close(); // pas hierna is het bestand geschreven
  // [STEM-SYNC] De opname stopt hier. Dit moment, min de lengte van het bestand, is seconde nul
  // van de video op de klok van dit script — zie de berekening bij de stem hieronder.
  const closedAt = (Date.now() - t0) / 1000;

  const raw = readdirSync(tmp).find((f) => f.endsWith(".webm"));
  if (!raw) { console.error(`[CLIPS] ✗ ${clip.name}: geen opname`); continue; }
  const webm = path.join(OUT, `${clip.name}.webm`);
  renameSync(path.join(tmp, raw), webm);
  const rawWebmForTiming = webm; // gemeten vóór het knippen: dit is de volle opname
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
    const webmSeconds = mediaSeconds(ff, rawWebmForTiming);
    // [STEM-MONTAGE] Met een stem eronder wordt niet op het eerste beeld geknipt maar op seconde
    // nul van die stem: alles daarvoor is aanloop die de kijker niet hoort.
    const videoZero = closedAt - webmSeconds;
    const from = clip.voiceOver
      ? Math.max(0, voStartElapsed - videoZero)
      : firstPaintSeconds(ff, webm);
    execFileSync(ff, ["-y", "-ss", from.toFixed(2), "-i", webm, "-t", String(clip.maxLen ?? MAX_LEN_S),
      "-vf", `scale=${OUT_SIZE.width}:${OUT_SIZE.height}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "19",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-fps_mode", "passthrough", mp4], { stdio: "pipe" });
    rmSync(webm, { force: true });

    // [STEM-MONTAGE] Het ingesproken bestand eronder. Beeld en geluid beginnen allebei bij nul,
    // want daar is hierboven op geknipt.
    if (clip.voiceOver) {
      if (!existsSync(clip.voiceOver.file)) {
        console.error(`[CLIPS] ! ${clip.name}: ${clip.voiceOver.file} niet gevonden — clip blijft stil.`);
      } else {
        const spoken = path.join(OUT, `${clip.name}-stem.mp4`);
        execFileSync(ff, ["-y", "-i", mp4, "-i", clip.voiceOver.file,
          "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", spoken], { stdio: "pipe" });
        made.push(spoken);
        console.log(`[CLIPS] ✓ ${clip.name}-stem.mp4`);
      }
    }

    // [STEM] Optioneel, en als aparte stap: mislukt de stem, dan staat de stille clip er nog.
    if (process.env.CLIP_VOICE) {
      // [STEM-SYNC] Waar ligt seconde nul van de video op de klok van dit script?
      //
      // Niet bij t0: Playwright schrijft het eerste frame pas als de pagina iets tekent, en de
      // navigatie ervoor duurde hier dertien seconden. Wél afleidbaar, want de opname stopt exact
      // bij ctx.close(): het nulpunt is dat moment MIN de lengte van de opname. Daar komt de
      // afgeknipte aanloop (`from`) nog bij, want die is uit het begin van de video geknipt.
      //
      // Gemeten en niet aangenomen — de eerste versie trok alleen `from` af, en `from` was nul.
      const videoStart = closedAt - webmSeconds + from;
      const wav = speak(ff, cues, OUT, clip.name, videoStart);
      if (wav) {
        const withVoice = path.join(OUT, `${clip.name}-stem.mp4`);
        execFileSync(ff, ["-y", "-i", mp4, "-i", wav,
          "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", withVoice], { stdio: "pipe" });
        rmSync(wav, { force: true });
        made.push(withVoice);
        console.log(`[CLIPS] ✓ ${clip.name}-stem.mp4 (${cues.length} zinnen)`);
      }
    }
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
