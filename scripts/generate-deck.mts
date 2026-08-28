#!/usr/bin/env node
// scripts/generate-deck.mts
// [DECK] Renders the demonstration deck to PNG slides and a PDF.
//
// Usage:
//   npx tsx scripts/generate-deck.mts
//
// Environment:
//   DECK_OUT        output directory, default store-assets/deck
//   DECK_CHROMIUM   explicit chromium binary, if the bundled resolver picks a missing one
//
// No server and no build: the slides are rendered from src/lib/deck.ts with page.setContent(),
// so this runs on a clean checkout and cannot photograph a stale page.
//
// TWO SHAPES, ONE ARGUMENT. Square 1080×1080 is what gets posted — a LinkedIn carousel, an
// Instagram post, a screenshot pasted into a Facebook group for ZZP'ers. Widescreen 1920×1080 is
// what gets presented and becomes the PDF. Both are driven from the same slide list, so the deck
// cannot say one thing in one shape and something else in the other.
//
// The type is sized against the canvas HEIGHT, which is 1080 in both shapes. That is the reason
// the same words land at the same reading size in a square and a widescreen slide; the widescreen
// one simply has more room beside them.

import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildDeck, type Deck, type DeckLocale, type Slide } from "../src/lib/deck";

const OUT = process.env.DECK_OUT ?? path.join("store-assets", "deck");
const LOCALES: DeckLocale[] = ["nl", "en"];

/** The two canvases. `key` names the files; `pdf` marks the one the PDF is built from. */
const SHAPES = [
  { key: "square", width: 1080, height: 1080, pdf: false },
  { key: "wide", width: 1920, height: 1080, pdf: true },
] as const;

// ── the typeface ────────────────────────────────────────────────────────────
//
// Outfit, embedded as a data URI rather than linked from Google Fonts.
//
// Two reasons, and the first one bit before it was fixed. A linked webfont makes this script
// depend on the network: behind a proxy the request hangs, `networkidle` never settles, and the
// run stalls instead of failing. Worse is the case where it half-works — the stylesheet times out,
// every slide silently renders in a fallback face, and the deck looks fine until it is next to
// one that was generated on a machine where the font arrived.
//
// The second reason is that this is already the deck's face. scripts/generate-store-assets.mjs
// draws the Play Store icon and feature graphic in Outfit from this same directory, so a slide
// and the store listing it points at are set in one typeface instead of two that nearly match.
//
// Only Bold and Regular are vendored, which is the whole palette: weight, size, tracking and
// colour carry the hierarchy. A third weight would be a third file to license and ship.
const FONT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "fonts");
function embedFont(file: string): string {
  return readFileSync(path.join(FONT_DIR, file)).toString("base64");
}
const OUTFIT_REGULAR = embedFont("Outfit-Regular.ttf");
const OUTFIT_BOLD = embedFont("Outfit-Bold.ttf");
const FONT_FACES = `
  @font-face { font-family: Outfit; font-weight: 400; font-display: block;
    src: url(data:font/ttf;base64,${OUTFIT_REGULAR}) format("truetype"); }
  @font-face { font-family: Outfit; font-weight: 700; font-display: block;
    src: url(data:font/ttf;base64,${OUTFIT_BOLD}) format("truetype"); }`;

// ── the look ────────────────────────────────────────────────────────────────
//
// The palette is the app's own: #1a73e8 is the theme-color in layout.tsx, so a slide and the
// screen it advertises are the same blue rather than two blues that nearly match.
//
// The deck runs dark → blue → light → dark. That is not decoration: the dark slides are the
// problem and the close, the blue slide is the single sentence where the argument turns, and the
// light slides are what the reader actually has to do. A reader scrolling a carousel can see the
// turn happen without reading a word.
const INK = "#0f1216";
const BLUE = "#1a73e8";
const PAPER = "#f7f8fa";

/** Which ground a slide sits on. Keyed by the slide's purpose, never by its position. */
function ground(kind: Slide["kind"]): "dark" | "blue" | "light" {
  if (kind === "cover" || kind === "problem" || kind === "close") return "dark";
  if (kind === "bridge") return "blue";
  return "light";
}

/** HTML-escape. The copy is ours, but it contains apostrophes and an ampersand or two. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The progress rule along the foot of every slide: one segment per slide, the current one blue
 * and wide. It earns its place twice — a carousel reader wants to know how far in they are, and
 * the product is named for a span between two sides.
 */
function progress(index: number, total: number, tone: "dark" | "blue" | "light"): string {
  const dim = tone === "light" ? "rgba(15,18,22,.16)" : "rgba(255,255,255,.28)";
  const on = tone === "blue" ? "#ffffff" : BLUE;
  const seg = Array.from({ length: total }, (_, i) => {
    const active = i === index;
    return `<i style="width:${active ? "calc(var(--u)*34)" : "calc(var(--u)*14)"};background:${active ? on : dim}"></i>`;
  }).join("");
  return `<div class="prog">${seg}</div>`;
}

function slideHtml(slide: Slide, index: number, deck: Deck, width: number, height: number): string {
  const tone = ground(slide.kind);
  const bg = tone === "dark" ? INK : tone === "blue" ? BLUE : PAPER;
  const fg = tone === "light" ? INK : "#ffffff";
  const soft = tone === "light" ? "rgba(15,18,22,.62)" : "rgba(255,255,255,.76)";
  const accent = tone === "blue" ? "#ffffff" : BLUE;

  // The cover carries the promise as two lines and nothing else; every other slide is
  // eyebrow → heading → body. Kept as one branch rather than a flag, because the cover is the
  // only slide whose type is meant to dominate the canvas.
  const isCover = slide.kind === "cover";
  const headSize = isCover ? 78 : slide.kind === "problem" ? 46 : 58;

  const eyebrow = slide.eyebrow
    ? `<p class="eyebrow">${esc(slide.eyebrow)}</p>`
    : "";

  const stepMark =
    slide.step !== undefined
      ? `<p class="stepmark">${slide.step}<span>/${slide.stepCount}</span></p>`
      : "";

  const body = slide.body ? `<p class="body">${esc(slide.body)}</p>` : "";

  const items = slide.items?.length
    ? `<ul class="items">${slide.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    : "";

  const head = esc(slide.head)
    .split("\n")
    .map((line) => `<span>${line}</span>`)
    .join("");

  return `<!doctype html><html lang="${deck.locale}" dir="${deck.dir}"><head><meta charset="utf-8">
<style>${FONT_FACES}
  /* One unit = one thousand-and-eightieth of the canvas height. Both shapes are 1080 tall, so a
     heading is the same reading size in a square post and on a projector. */
  :root { --u: calc(${height} / 1080 * 1px); }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; }
  body {
    background: ${bg};
    color: ${fg};
    font-family: Outfit, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: calc(var(--u) * 88);
  }
  /* The content block owns the whole area above the footer and centres itself in it. Pinning it
     to the top instead left every short slide — which is most of them — with an empty lower half. */
  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    max-width: calc(var(--u) * ${width > height ? 1240 : 904});
  }
  .eyebrow {
    font-family: Outfit, system-ui, sans-serif;
    font-size: calc(var(--u) * 22);
    font-weight: 700;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: ${accent};
    margin-bottom: calc(var(--u) * 26);
  }
  .stepmark {
    font-family: Outfit, system-ui, sans-serif;
    font-size: calc(var(--u) * 92);
    font-weight: 700;
    line-height: 1;
    color: ${accent};
    margin-bottom: calc(var(--u) * 24);
  }
  .stepmark span { font-size: calc(var(--u) * 34); opacity: .5; }
  h1 {
    font-size: calc(var(--u) * ${headSize});
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -.022em;
    text-wrap: balance;
  }
  h1 span { display: block; }
  ${isCover ? `h1 span + span { color: ${BLUE}; }` : ""}
  .body {
    font-size: calc(var(--u) * 27);
    line-height: 1.55;
    color: ${soft};
    margin-top: calc(var(--u) * 30);
    max-width: calc(var(--u) * 780);
  }
  .items {
    list-style: none;
    margin-top: calc(var(--u) * 36);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: calc(var(--u) * 14) calc(var(--u) * 40);
    max-width: calc(var(--u) * 880);
  }
  .items li {
    font-size: calc(var(--u) * 26);
    font-weight: 700;
    padding-inline-start: calc(var(--u) * 26);
    position: relative;
  }
  .items li::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: calc(var(--u) * 14);
    width: calc(var(--u) * 10);
    height: calc(var(--u) * 10);
    border-radius: 50%;
    background: ${accent};
  }
  footer { display: flex; flex-direction: column; gap: calc(var(--u) * 22); }
  .prog { display: flex; gap: calc(var(--u) * 7); align-items: center; }
  .prog i { height: calc(var(--u) * 4); border-radius: 999px; display: block; }
  .mark {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: Outfit, system-ui, sans-serif;
    font-size: calc(var(--u) * 23);
    letter-spacing: .04em;
    color: ${soft};
  }
  .mark b { color: ${fg}; font-weight: 700; }
</style></head><body>
  <div class="col">${eyebrow}${stepMark}<h1>${head}</h1>${body}${items}</div>
  <footer>
    ${progress(index, deck.slides.length, tone)}
    <div class="mark"><b>${esc(deck.site)}</b><span>${index + 1} / ${deck.slides.length}</span></div>
  </footer>
</body></html>`;
}

/**
 * Which Chromium to drive. Same reasoning as capture-screenshots.mjs: a sandbox often ships one
 * browser build while package.json pins a client that wants a newer one, and downloading another
 * copy is the wrong fix on a fixed disk allowance.
 */
function resolveChromium(): string | undefined {
  if (process.env.DECK_CHROMIUM) return process.env.DECK_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const executablePath = resolveChromium();
if (executablePath) console.log(`[DECK] chromium: ${executablePath}`);

// No proxy argument, and that is the point: the page fetches nothing. The typeface is inline and
// there is no server to reach, so this run behaves the same on a laptop and in a locked-down CI.
const browser = await chromium.launch({ executablePath });

let fontFailures = 0;

for (const locale of LOCALES) {
  const deck = buildDeck(locale);
  const dir = path.join(OUT, locale);
  mkdirSync(dir, { recursive: true });
  console.log(`\n[DECK] ${locale} — ${deck.slides.length} slides`);

  const widePages: string[] = [];

  for (const shape of SHAPES) {
    const context = await browser.newContext({
      viewport: { width: shape.width, height: shape.height },
      deviceScaleFactor: 1,
      locale: locale === "nl" ? "nl-NL" : "en-GB",
    });
    const page = await context.newPage();

    for (const [i, slide] of deck.slides.entries()) {
      await page.setContent(slideHtml(slide, i, deck, shape.width, shape.height), {
        waitUntil: "domcontentloaded",
      });
      // The face is inline, so there is nothing to fetch — but it still has to be parsed and
      // applied before the shutter, or the first slide photographs mid-swap.
      await page.evaluate(() => document.fonts.ready);

      // A slide drawn in the fallback face is the failure that looks like success. Ask the
      // document, rather than trusting that the stylesheet arrived.
      const gotFont = await page.evaluate(() => document.fonts.check('700 78px Outfit'));
      if (!gotFont) fontFailures++;

      const file = path.join(dir, `${shape.key}-${String(i + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: file });
      if (shape.pdf) widePages.push(file);
    }

    await context.close();
    console.log(`  ✓ ${shape.key} ${shape.width}×${shape.height} → ${dir}/${shape.key}-*.png`);
  }

  // The PDF is the widescreen deck: one page per slide, no margins, no resampling. This is the
  // file that gets attached to a LinkedIn document post or e-mailed to an administratiekantoor.
  const pdf = await PDFDocument.create();
  pdf.setTitle(`BoekBrug — ${locale.toUpperCase()}`);
  for (const file of widePages) {
    const png = await pdf.embedPng(await import("node:fs/promises").then((fs) => fs.readFile(file)));
    const p = pdf.addPage([png.width, png.height]);
    p.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  }
  const pdfPath = path.join(dir, `boekbrug-${locale}.pdf`);
  writeFileSync(pdfPath, await pdf.save());
  console.log(`  ✓ pdf → ${pdfPath}`);
}

await browser.close();

if (fontFailures > 0) {
  console.warn(
    `\n[DECK] ⚠ ${fontFailures} slide(s) rendered without Outfit — the embedded face did not ` +
      `apply, so they are in a fallback. Do not publish these; investigate scripts/fonts/ first.`,
  );
  process.exitCode = 1;
} else {
  console.log(`\n[DECK] done -> ${OUT}/`);
}
