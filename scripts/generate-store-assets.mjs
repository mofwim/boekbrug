#!/usr/bin/env node
// scripts/generate-store-assets.mjs
// [ANDROID/PLAY] Generates the Google Play Store graphics into store-assets/:
//   play-icon-512.png                 hi-res store icon (512×512, Play masks it)
//   play-feature-graphic-1024x500.png feature graphic banner
//   screenshot-N-framed.png           any screenshots passed as CLI args, framed
//                                     on the brand background with a caption
//
// Usage:
//   node scripts/generate-store-assets.mjs
//   node scripts/generate-store-assets.mjs shot1.jpg shot2.jpg ...
//
// Reproducible + self-contained like generate-icons.mjs: registers the bundled
// Outfit fonts (scripts/fonts/, SIL OFL) via fontconfig. See
// docs/PLAY_STORE_LISTING.md for the full submission kit.

import sharp from "sharp";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "store-assets");
mkdirSync(OUT, { recursive: true });

// Register bundled Outfit (Bold + Regular) so text renders identically anywhere.
try {
  const fontDir = path.join(os.homedir(), ".fonts");
  mkdirSync(fontDir, { recursive: true });
  for (const f of ["Outfit-Bold.ttf", "Outfit-Regular.ttf"]) {
    const dest = path.join(fontDir, f);
    if (!existsSync(dest)) copyFileSync(path.join(HERE, "fonts", f), dest);
  }
  execFileSync("fc-cache", ["-f", fontDir], { stdio: "ignore" });
} catch (e) {
  console.warn("[store] could not register bundled fonts:", e.message);
}

const DEFS = `<defs>
  <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4c8dff"/><stop offset="0.55" stop-color="#1a73e8"/><stop offset="1" stop-color="#0b57d0"/>
  </linearGradient>
  <radialGradient id="hi" cx="0.28" cy="0.16" r="1"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="7"/><feOffset dy="7" result="o"/>
    <feFlood flood-color="#062a6b" flood-opacity="0.33"/><feComposite in2="o" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

// The "BB over a bridge" mark (same as the app icon), scalable/positionable.
const bridgeArt = (cx, cy, s) => `
  <g transform="translate(${cx},${cy}) scale(${s}) translate(-256,-256)" filter="url(#soft)">
    <text x="256" y="262" font-family="Outfit" font-weight="700" font-size="196"
      letter-spacing="-4" fill="white" text-anchor="middle">BB</text>
    <g fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">
      <line x1="100" y1="372" x2="412" y2="372" stroke-width="15"/>
      <line x1="160" y1="300" x2="160" y2="378" stroke-width="15"/>
      <line x1="352" y1="300" x2="352" y2="378" stroke-width="15"/>
      <path d="M100 372 L160 300 Q256 400 352 300 L412 372" stroke-width="13"/>
      <g stroke-width="7">
        <line x1="198" y1="333" x2="198" y2="372"/><line x1="227" y1="346" x2="227" y2="372"/>
        <line x1="256" y1="350" x2="256" y2="372"/><line x1="285" y1="346" x2="285" y2="372"/>
        <line x1="314" y1="333" x2="314" y2="372"/>
      </g>
    </g>
  </g>`;

// 1) Store icon 512 (full-bleed square; Play applies its own rounding).
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  ${DEFS}<rect width="512" height="512" fill="url(#blue)"/><rect width="512" height="512" fill="url(#hi)"/>
  ${bridgeArt(256, 256, 0.82)}</svg>`)).png().toFile(path.join(OUT, "play-icon-512.png"));
console.log("wrote play-icon-512.png");

// 2) Feature graphic 1024×500.
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
  ${DEFS}<rect width="1024" height="500" fill="url(#blue)"/><rect width="1024" height="500" fill="url(#hi)"/>
  <g transform="translate(70,110)"><rect width="280" height="280" rx="62" fill="#ffffff" opacity="0.12"/>${bridgeArt(140, 140, 0.46)}</g>
  <text x="410" y="205" font-family="Outfit" font-weight="700" font-size="92" fill="#ffffff">BoekBrug</text>
  <text x="414" y="272" font-family="Outfit" font-weight="400" font-size="36" fill="#eaf1ff">De brug tussen jou en je boekhouder</text>
  <text x="414" y="330" font-family="Outfit" font-weight="700" font-size="30" fill="#ffffff" opacity="0.92">Facturen · Scannen · BTW · Bank</text>
</svg>`)).png().toFile(path.join(OUT, "play-feature-graphic-1024x500.png"));
console.log("wrote play-feature-graphic-1024x500.png");

// 3) Frame any screenshots passed as CLI args (1080×1920, caption on top).
const CAPTIONS = [
  "Alles voor je administratie, in één app",
  "Scan je bon — klaar in seconden",
  "Je BTW altijd bij de hand",
  "Klaar voor je boekhouder",
  "Betalingen automatisch gematcht",
];
const shots = process.argv.slice(2);
for (let i = 0; i < shots.length; i++) {
  const W = 1080, H = 1920, shotW = 760;
  const shot = await sharp(shots[i]).resize({ width: shotW }).toBuffer();
  const { height: shotH } = await sharp(shot).metadata();
  const rounded = await sharp(shot)
    .composite([{ input: Buffer.from(`<svg><rect width="${shotW}" height="${shotH}" rx="36"/></svg>`), blend: "dest-in" }])
    .png().toBuffer();
  const caption = CAPTIONS[i] ?? "BoekBrug";
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${DEFS}
    <rect width="${W}" height="${H}" fill="url(#blue)"/><rect width="${W}" height="${H}" fill="url(#hi)"/>
    <text x="${W / 2}" y="150" font-family="Outfit" font-weight="700" font-size="54" fill="#ffffff" text-anchor="middle">${caption}</text></svg>`;
  const top = 240, left = Math.round((W - shotW) / 2);
  await sharp(Buffer.from(bg)).composite([
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${shotW + 24}" height="${shotH + 24}"><rect width="${shotW + 24}" height="${shotH + 24}" rx="48" fill="#ffffff" opacity="0.14"/></svg>`), left: left - 12, top: top - 12 },
    { input: rounded, left, top },
  ]).png().toFile(path.join(OUT, `screenshot-${i + 1}-framed.png`));
  console.log(`wrote screenshot-${i + 1}-framed.png`);
}

console.log("done -> store-assets/");
