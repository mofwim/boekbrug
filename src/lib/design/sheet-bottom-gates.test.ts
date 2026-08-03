// [SHEET-BOTTOM] Pure node test — run: npx tsx --test src/lib/design/sheet-bottom-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// The "Betalen" sheet on Inkoopfacturen ended in two buttons — "Ja, ik heb betaald" and "Nog niet"
// — and on a phone only the first one existed. The second sat behind the fixed bottom navigation,
// which is painted over the sheet, and it could not be scrolled to either: the sheet had already
// reached the end of its own scroll box. The owner's exits from a payment sheet were to confirm a
// payment they had not made, or to tap the backdrop and hope.
//
// Six sheets across the money line had it — /bank twice, Inkoopfacturen three times, the intake
// sheet, plus the offerte-conversion dialog. Every one of them ends in the buttons that decide
// something.
//
// WHY NO OTHER GATE CATCHES IT
//
// It is invisible to every gate this repo runs, and not by accident. tsc and eslint never look at
// a style value. The render gate calls renderToStaticMarkup, which has no layout, no viewport and
// no bottom bar — the button IS in the markup, so an assertion on the output passes while the
// button is unreachable. Playwright sweeps the public surface without a session and never opens a
// dashboard sheet. And --bottom-nav-h is 0px above the 640px breakpoint, so a desktop browser
// shows the bug at full health. It only exists on the device the app is actually used on.
//
// So this reads the SOURCE. A panel pinned to the bottom edge of the screen must reserve room for
// the bar that is painted on top of it.
//
// WHAT COUNTS AS PINNED
//
// `position: fixed` + `inset: 0` + `alignItems: 'flex-end'` — a full-screen overlay whose content
// is pushed against the bottom edge. That is the shape, and it is the shape that has the problem;
// a centred dialog floats clear of the bar and is none of this test's business.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .tsx under src/, so a sheet added in a new folder is covered the day it lands. */
function allTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allTsx(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const PINNED = /alignItems: ?['"]flex-end['"]/;
/** The clearance itself, or the helper that produces it. */
const CLEARS_NAV = /--bottom-nav-h|sheetPaddingBottom/;
/** How far below the overlay line the panel's own style may sit. */
const PANEL_WINDOW = 14;

test("[SHEET-BOTTOM] every bottom-pinned sheet clears the bottom navigation", () => {
  const files = allTsx("src");
  // A floor, for the same reason the intake gate carries one: if the walk silently returned
  // nothing, an empty loop would pass while proving the opposite of what it claims.
  assert.ok(files.length > 50, `walked ${files.length} .tsx files — the directory walk broke`);

  const offenders: string[] = [];
  let sheets = 0;
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!(PINNED.test(l) && l.includes("position:") && l.includes("fixed"))) continue;
      sheets++;
      if (!CLEARS_NAV.test(lines.slice(i, i + PANEL_WINDOW).join("\n"))) {
        offenders.push(`${f}:${i + 1}`);
      }
    }
  }

  // Same floor logic one level down: the scan must actually have found sheets to judge.
  assert.ok(sheets >= 6, `found only ${sheets} bottom-pinned sheets — the pattern stopped matching`);
  assert.deepEqual(
    offenders, [],
    `these sheets end underneath the bottom navigation, so their last control cannot be tapped:\n` +
      offenders.map((o) => `  · ${o}`).join("\n") +
      `\n\nGive the panel paddingBottom: sheetPaddingBottom(<its own bottom padding>) ` +
      `from @/lib/design/tokens.`,
  );
});

test("[SHEET-BOTTOM] the helper reserves the bar AND the home-indicator inset", () => {
  // Both halves matter and they are different things: --bottom-nav-h is the app's own bar (64px on
  // a phone, 0 above the breakpoint, so this is correct at both sizes with no media query), and
  // env(safe-area-inset-bottom) is the device's gesture area below it. A sheet that reserves only
  // one of the two still loses part of its last button on the hardware that has the other.
  // Asserted on the real token so a well-meant "simplification" of it fails here.
  const src = readFileSync("src/lib/design/tokens.ts", "utf8");
  const at = src.indexOf("export const sheetPaddingBottom");
  assert.notEqual(at, -1, "sheetPaddingBottom must exist in the tokens module");
  const body = src.slice(at);
  assert.match(body, /var\(--bottom-nav-h\)/, "the app's own bottom bar must be reserved");
  assert.match(body, /env\(safe-area-inset-bottom\)/, "the device inset must be reserved too");
});
