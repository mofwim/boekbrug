#!/usr/bin/env node
// scripts/capture-screenshots.mjs
// [STORE-SHOTS] Drives the running app with a real browser and writes phone-shaped PNGs.
//
// This is the missing input to scripts/generate-store-assets.mjs. That script frames and captions
// screenshots; until now the screenshots themselves were a manual step ("from the live app on your
// phone", docs/PLAY_STORE_LISTING.md §2), which means they were never reproducible and went stale
// the moment a screen changed.
//
// Usage:
//   npx next build && npx next start -p 3000        # in one shell
//   node scripts/capture-screenshots.mjs            # in another
//
// Environment:
//   SHOT_BASE_URL   default http://127.0.0.1:3000
//   SHOT_EMAIL      when set, the run logs in first and also captures the /dashboard screens
//   SHOT_PASSWORD   password for SHOT_EMAIL
//   SHOT_OUT        output directory, default store-assets/shots
//
// WITHOUT credentials this captures the public surface only — enough for social posts, not enough
// for the store listing, which is all /dashboard/*.
//
// The viewport is 540×960 CSS at deviceScaleFactor 2, so every file lands at 1080×1920 physical —
// Play's phone requirement (≥1080px short side, 9:16) with no resampling, and the exact aspect
// generate-store-assets.mjs expects when it insets the shot into the branded canvas.

import { chromium } from "@playwright/test";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.SHOT_OUT ?? path.join("store-assets", "shots");
const EMAIL = process.env.SHOT_EMAIL;
const PASSWORD = process.env.SHOT_PASSWORD;

mkdirSync(OUT, { recursive: true });

/** Public screens — reachable with no session. Useful for social, not for the store listing. */
const PUBLIC_SHOTS = [
  { name: "public-1-home", path: "/" },
  { name: "public-2-prijzen", path: "/prijzen" },
  { name: "public-3-boekhouder", path: "/voor-boekhouders" },
  { name: "public-4-tools", path: "/tools" },
  { name: "public-5-blog", path: "/blog" },
  // The blog publishes in four languages and /ar is right-to-left. An Arabic-language campaign
  // aimed at Arabic-speaking ondernemers in NL is a separate audience from the Dutch one, and this
  // is the only screen that shows the app speaking to it.
  { name: "public-6-blog-ar", path: "/ar/blog" },
];

/**
 * The five the store listing asks for, in the order the CAPTIONS array in
 * generate-store-assets.mjs is written — shot N gets caption N, so this order is load-bearing.
 */
const PRIVATE_SHOTS = [
  { name: "shot-1-klaar", path: "/dashboard/klaar" },      // "Alles voor je administratie, in één app"
  { name: "shot-2-scannen", path: "/dashboard/upload" },   // "Scan je bon — klaar in seconden"
  { name: "shot-3-aangifte", path: "/dashboard/aangifte" },// "Je BTW altijd bij de hand"
  { name: "shot-4-brug", path: "/dashboard/brug" },        // "Klaar voor je boekhouder"
  { name: "shot-5-bank", path: "/dashboard/bank" },        // "Betalingen automatisch gematcht"
];

/**
 * Which Chromium to drive.
 *
 * A CI image often ships one Playwright browser build while package.json pins a @playwright/test
 * that wants a newer one; the bundled resolver then points at a revision directory that was never
 * downloaded and the run dies with "Executable doesn't exist" — a browser IS installed, just not
 * the revision this client expects. Downloading another copy is the wrong fix in a sandbox with a
 * fixed disk allowance, so prefer whatever full chromium is already on the box and let the
 * bundled resolver have the last word only when nothing is found.
 */
function resolveChromium() {
  if (process.env.SHOT_CHROMIUM) return process.env.SHOT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  // Full chromium before headless_shell: the shell cannot take a non-headless screenshot and
  // renders some CSS differently, which is exactly what a store screenshot must not gamble on.
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
if (executablePath) console.log(`[STORE-SHOTS] chromium: ${executablePath}`);

/**
 * The app links its icon font from fonts.googleapis.com. In a sandbox whose egress is a local
 * proxy, Chromium does not inherit HTTPS_PROXY from the environment the way curl does, so that
 * stylesheet fails and every icon in the interface falls back to its ligature TEXT — a dashboard
 * photographed with the word "account_balance" where the bank icon belongs. Hand Chromium the same
 * proxy, and exempt the loopback address so the run still reaches its own server directly.
 */
const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxy = proxyServer ? { server: proxyServer, bypass: "127.0.0.1,localhost,::1" } : undefined;
if (proxy) console.log(`[STORE-SHOTS] proxy:   ${proxy.server}`);

const browser = await chromium.launch({ executablePath, proxy });
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  locale: "nl-NL",
  timezoneId: "Europe/Amsterdam",
  colorScheme: "light",
});
const page = await context.newPage();

/** Screenshot one path. Returns false when the server answered with a redirect or an error. */
async function shoot({ name, path: pathname }) {
  const res = await page.goto(BASE + pathname, { waitUntil: "networkidle", timeout: 45_000 });
  const status = res?.status() ?? 0;
  const landed = new URL(page.url()).pathname;
  if (landed !== pathname) {
    console.warn(`  ! ${pathname} → ${landed} (${status}) — not captured`);
    return false;
  }
  // A screen that is still drawing its skeleton photographs as a grey box. Give the client
  // components their fetch before the shutter.
  await page.waitForTimeout(1200);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${pathname} → ${file}`);
  return true;
}

console.log(`[STORE-SHOTS] base ${BASE}`);
console.log("public surface:");
for (const s of PUBLIC_SHOTS) await shoot(s);

if (EMAIL && PASSWORD) {
  console.log(`logging in as ${EMAIL} …`);
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  console.log(`  ✓ session established (landed on ${new URL(page.url()).pathname})`);

  console.log("dashboard screens:");
  for (const s of PRIVATE_SHOTS) await shoot(s);
} else {
  console.log("no SHOT_EMAIL/SHOT_PASSWORD — skipping the /dashboard screens.");
  console.log("The store listing needs those five; see docs/PLAY_STORE_LISTING.md §2.");
}

await browser.close();
console.log(`done -> ${OUT}/`);
