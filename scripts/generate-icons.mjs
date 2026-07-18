#!/usr/bin/env node
// scripts/generate-icons.mjs
// [ANDROID/PWA] Generates the BoekBrug launcher icons in public/icons/ — the
// white "BB" monogram on the brand-blue gradient used for the PWA / Android TWA
// install experience. See docs/ANDROID_TWA_GUIDE.md.
//
// Run from the repo root:   node scripts/generate-icons.mjs
// Uses `sharp` (already a project dependency) to rasterize an inline SVG, so no
// design tool is needed — edit the SVG below and re-run to rebrand.
//
// Outputs (512px master downscaled):
//   icon-192.png / icon-512.png              — "any" purpose, rounded corners
//   icon-maskable-192.png / -512.png         — full-bleed, Android crops to shape
//   apple-touch-icon.png (180)               — iOS home-screen

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons"
);
mkdirSync(OUT, { recursive: true });

// One geometric "B" built from stroked paths (no font dependency — resvg inside
// sharp renders paths deterministically). Local coords: stem at x=0, top y=0,
// height 210, lower bowl a touch larger for a classic B.
function B(tx, ty) {
  const H = 210;
  const sw = 34;
  return `
    <g transform="translate(${tx},${ty})" fill="none" stroke="white"
       stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M0 0 L0 ${H}"/>
      <path d="M0 0 L44 0 C92 0 92 105 44 105 L0 105"/>
      <path d="M0 105 L50 105 C104 105 104 ${H} 50 ${H} L0 ${H}"/>
    </g>`;
}

// Two B's, centered as a tight modern monogram.
const monogram = `${B(134, 151)}${B(274, 151)}`;

function svg({ rounded }) {
  const bg = rounded
    ? `<rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill="url(#g)"/>
       <rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill="url(#h)"/>`
    : `<rect x="0" y="0" width="512" height="512" fill="url(#g)"/>
       <rect x="0" y="0" width="512" height="512" fill="url(#h)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="g" x1="40" y1="20" x2="472" y2="500" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#4c8dff"/>
        <stop offset="0.55" stop-color="#1a73e8"/>
        <stop offset="1" stop-color="#0b57d0"/>
      </linearGradient>
      <radialGradient id="h" cx="0.30" cy="0.20" r="0.95">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
        <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${bg}
    ${monogram}
  </svg>`;
}

const roundedSvg = Buffer.from(svg({ rounded: true }));
const squareSvg = Buffer.from(svg({ rounded: false }));

async function png(buf, size, name) {
  await sharp(buf, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(OUT, name));
  console.log("wrote", name, `${size}x${size}`);
}

await png(roundedSvg, 192, "icon-192.png");
await png(roundedSvg, 512, "icon-512.png");
await png(squareSvg, 192, "icon-maskable-192.png");
await png(squareSvg, 512, "icon-maskable-512.png");
await png(squareSvg, 180, "apple-touch-icon.png");
console.log("done — icons in public/icons/");
