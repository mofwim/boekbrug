#!/usr/bin/env node
// scripts/generate-icons.mjs
// [ANDROID/PWA] Generates the BoekBrug launcher icons in public/icons/ — the
// white "BB" wordmark over a suspension bridge (BoekBrug = "book bridge") on the
// brand-blue gradient, used for the PWA / Android TWA install experience.
// See docs/ANDROID_TWA_GUIDE.md.
//
// Run from the repo root:   node scripts/generate-icons.mjs
// Reproducible + self-contained: uses `sharp` (a project dependency) to
// rasterize an inline SVG, and registers the bundled Outfit font
// (scripts/fonts/, SIL OFL) via fontconfig so it renders identically on any
// machine. Edit the SVG below and re-run to rebrand.
//
// Outputs (512px master downscaled):
//   icon-192.png / icon-512.png              — "any" purpose, rounded corners
//   icon-maskable-192.png / -512.png         — full-bleed, art scaled into the
//                                              Android safe zone (no clipping)
//   apple-touch-icon.png (180)               — iOS home-screen

import sharp from "sharp";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// Make the bundled Outfit-Bold available to fontconfig (librsvg inside sharp
// resolves SVG <text> fonts by family name), so `node scripts/generate-icons.mjs`
// produces the same glyphs everywhere without a system font install.
try {
  const fontDir = path.join(os.homedir(), ".fonts");
  mkdirSync(fontDir, { recursive: true });
  const dest = path.join(fontDir, "Outfit-Bold.ttf");
  if (!existsSync(dest)) copyFileSync(path.join(HERE, "fonts", "Outfit-Bold.ttf"), dest);
  execFileSync("fc-cache", ["-f", fontDir], { stdio: "ignore" });
} catch (e) {
  console.warn("[icons] could not register bundled font, relying on system Outfit:", e.message);
}

const S = 512;

const defs = `<defs>
  <linearGradient id="blue" x1="40" y1="10" x2="480" y2="504" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4c8dff"/>
    <stop offset="0.55" stop-color="#1a73e8"/>
    <stop offset="1" stop-color="#0b57d0"/>
  </linearGradient>
  <radialGradient id="hi" cx="0.3" cy="0.18" r="0.95">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
    <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.05"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="7"/>
    <feOffset dy="7" result="o"/>
    <feFlood flood-color="#062a6b" flood-opacity="0.33"/>
    <feComposite in2="o" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

// "BB" over a clean suspension bridge — all white so it reads as one mark.
const art = `
  <g filter="url(#soft)">
    <text x="256" y="262" font-family="Outfit" font-weight="700" font-size="196"
      letter-spacing="-4" fill="white" text-anchor="middle">BB</text>
    <g fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">
      <line x1="100" y1="372" x2="412" y2="372" stroke-width="15"/>
      <line x1="160" y1="300" x2="160" y2="378" stroke-width="15"/>
      <line x1="352" y1="300" x2="352" y2="378" stroke-width="15"/>
      <path d="M100 372 L160 300 Q256 400 352 300 L412 372" stroke-width="13"/>
      <g stroke-width="7">
        <line x1="198" y1="333" x2="198" y2="372"/>
        <line x1="227" y1="346" x2="227" y2="372"/>
        <line x1="256" y1="350" x2="256" y2="372"/>
        <line x1="285" y1="346" x2="285" y2="372"/>
        <line x1="314" y1="333" x2="314" y2="372"/>
      </g>
    </g>
  </g>`;

const bg = (rounded) =>
  rounded
    ? `<rect width="${S}" height="${S}" rx="115" ry="115" fill="url(#blue)"/>
       <rect width="${S}" height="${S}" rx="115" ry="115" fill="url(#hi)"/>`
    : `<rect width="${S}" height="${S}" fill="url(#blue)"/>
       <rect width="${S}" height="${S}" fill="url(#hi)"/>`;

// maskable → full-bleed square + art scaled to 0.82 so nothing lands outside the
// Android circular safe zone.
const svg = ({ rounded, maskable }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  ${defs}${bg(rounded)}
  ${maskable ? `<g transform="translate(256,256) scale(0.82) translate(-256,-256)">${art}</g>` : art}
</svg>`;

const rounded = Buffer.from(svg({ rounded: true, maskable: false }));
const maskable = Buffer.from(svg({ rounded: false, maskable: true }));
const appleSquare = Buffer.from(svg({ rounded: false, maskable: false }));

async function png(buf, size, name) {
  await sharp(buf).resize(size, size).png().toFile(path.join(OUT, name));
  console.log("wrote", name, `${size}x${size}`);
}

await png(rounded, 192, "icon-192.png");
await png(rounded, 512, "icon-512.png");
await png(maskable, 192, "icon-maskable-192.png");
await png(maskable, 512, "icon-maskable-512.png");
await png(appleSquare, 180, "apple-touch-icon.png");
console.log("done — icons in public/icons/");
