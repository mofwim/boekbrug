// [ICON-SUBSET-GUARD] Every material-symbols icon the app USES must be in the font subset the
// app LOADS — run: npx tsx src/lib/material-icons.test.ts
//
// The Material Symbols font in src/app/layout.tsx is deliberately subset via `icon_names=` (a
// full icon font is megabytes; the subset is a few kB). The price of that subset is a silent
// failure mode: an icon whose name is NOT in the list renders as its RAW LIGATURE TEXT — and
// worse, any substring that IS a loaded icon still ligates, so `restart_alt` rendered as
// "RE☆T_ALT" (the "star" in the middle became a star glyph) on a button in production. The
// layout comment has warned about this trap for months; a comment does not fail CI, this does.
//
// Two assertions:
//   1. USED ⊆ LOADED — every icon name referenced in src/**/*.tsx is in the subset.
//   2. The subset is ALPHABETICALLY sorted — Google Fonts rejects an unsorted icon_names with
//      HTTP 400, which breaks EVERY icon in the app at once, not just one.
//
// Extraction covers the codebase's real patterns:
//   <span className="material-symbols-outlined">name</span>            (bare literal child)
//   <span ...>{cond ? 'a' : 'b'}</span>                                 (quoted strings in an expression)
//   { key: 'confirm', icon: 'fact_check', ... }                         (tab/config arrays)
// Comparison operands inside expressions (`x === 'ties' ? 'verified' : …`) are stripped first,
// so state strings never masquerade as icon names. If you add a NEW usage pattern this scanner
// cannot see, extend the scanner in the same commit — an unscanned icon is an unguarded icon.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const SRC = join(process.cwd(), "src");

// ── 1) The loaded subset, from the one place that defines it ─────────────────────────────────
const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
const subsetMatch = layout.match(/icon_names=([a-z0-9_,]+)/);
check("layout.tsx declares an icon_names subset", subsetMatch != null);
const loadedList = subsetMatch ? subsetMatch[1].split(",") : [];
const loaded = new Set(loadedList);

check(
  "the subset is alphabetically sorted (Google Fonts 400s otherwise — ALL icons would break)",
  JSON.stringify(loadedList) === JSON.stringify([...loadedList].sort()),
);
check("the subset has no duplicates", loaded.size === loadedList.length);

// ── 2) Every icon the app uses ───────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, out);
    } else if (p.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

const NAME_RE = /^[a-z][a-z0-9_]{2,}$/;
const used = new Map<string, string>(); // icon → first file that uses it

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(SRC.length - 3);

  // Pattern A/B: the span's child — a bare literal, or quoted strings inside an expression.
  for (const span of text.matchAll(/material-symbols-outlined[\s\S]{0,600}?>([\s\S]{0,300}?)<\/span>/g)) {
    const body = span[1].trim();
    if (body.startsWith("{")) {
      // Strip comparison operands first: `batch.status === 'ties' ? 'verified' : …` — the
      // 'ties' is state, only 'verified' is an icon.
      const cleaned = body.replace(/[=!]==\s*'[a-z0-9_]+'/g, "");
      for (const q of cleaned.matchAll(/'([a-z][a-z0-9_]{2,})'/g)) {
        if (!used.has(q[1])) used.set(q[1], rel);
      }
    } else if (NAME_RE.test(body)) {
      if (!used.has(body)) used.set(body, rel);
    }
  }

  // Pattern C: config arrays — { icon: 'fact_check' }.
  for (const m of text.matchAll(/\bicon:\s*'([a-z][a-z0-9_]{2,})'/g)) {
    if (!used.has(m[1])) used.set(m[1], rel);
  }
}

check("the scanner found a realistic number of icon usages (sanity floor)", used.size >= 50);

// ── 3) USED ⊆ LOADED — the assertion that would have caught "RE☆T_ALT" ──────────────────────
const missing = [...used.keys()].filter((icon) => !loaded.has(icon)).sort();
for (const icon of missing) {
  console.log(`    ✗ '${icon}' is used (${used.get(icon)}) but NOT in layout.tsx icon_names — it renders as raw text`);
}
check(
  `every used icon is in the loaded subset (${used.size} used, ${loaded.size} loaded)`,
  missing.length === 0,
);

// The three that were missing when this guard was written — pinned so a future subset cleanup
// cannot silently re-remove an icon that is still in use.
for (const icon of ["restart_alt", "swap_horiz", "date_range"]) {
  check(`'${icon}' (previously rendered as raw text) is loaded`, loaded.has(icon));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
