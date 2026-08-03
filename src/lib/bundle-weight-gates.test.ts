// [PDF-LAZY] Pure node test — run: npx tsx --test src/lib/bundle-weight-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// /factuur-maken is the free invoice generator: twelve public pages whose entire job is to convince
// a stranger on a phone. It shipped 2,5 MB of JavaScript, 1,4 MB of which was @react-pdf — a
// library nobody needs until they press "Download PDF".
//
// It was already meant to be deferred. GratisFactuur loaded PDFDownloadLink through next/dynamic
// and said so in a comment. Twelve lines above it stood an ordinary import:
//
//     import { InvoicePDF } from '@/lib/invoice-pdf'   // which itself does:
//     import { Document, Page, … } from '@react-pdf/renderer'
//
// One static import further along the same chain pulls the whole library into the first download,
// so the dynamic() around the other half was decoration. Same shape as the rest of this week's
// findings: a deferral written, commented, and quietly cancelled by a sibling line.
//
// A bundler will never complain about this — a static import is exactly what it is asked to
// resolve — and no runtime test can see it either, because the page works perfectly. It is only
// visible in the build output, which nobody reads on the way past. So the gate reads the imports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Modules heavy enough that a static import into a public page is a defect, not a choice. */
const HEAVY = ["@react-pdf/renderer", "qrcode", "xlsx", "jszip"];

/** Everything the free generator's page tree loads eagerly. */
function publicGeneratorSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
  };
  walk("src/app/factuur-maken");
  return out;
}

/** Static `import … from 'x'` only — `await import('x')` and next/dynamic are the point. */
function staticallyImports(src: string, mod: string): boolean {
  const escaped = mod.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`^\\s*import\\s[^\\n]*['"]${escaped}['"]`, "m").test(src);
}

test("[PDF-LAZY] the public invoice generator does not pull a heavy library into its first load", () => {
  const files = publicGeneratorSources();
  assert.ok(files.length >= 2, `walked ${files.length} files under factuur-maken — the walk broke`);

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // The lazily-loaded leaf is ALLOWED to import them — that is where they belong, and keeping
    // the renderer and its document together in one lazy file is what makes the boundary hold.
    if (/PdfDownloadButton\.tsx$/.test(f)) continue;
    for (const mod of HEAVY) {
      if (staticallyImports(src, mod)) offenders.push(`${f} → ${mod}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `these static imports land a heavy library in the first download of a public page:\n` +
      offenders.map((o) => `  · ${o}`).join("\n") +
      `\n\nLoad it where it is used instead — see PdfDownloadButton.tsx. A next/dynamic() elsewhere ` +
      `in the file does NOT help: one static import anywhere in the chain pulls the whole library in.`,
  );
});

test("[PDF-LAZY] and it does not reach one indirectly either", () => {
  // The exact way it was broken: not @react-pdf itself, but a local module that imports it. A gate
  // that only looked for the library name would have passed the entire time the bug existed.
  const indirect = ["@/lib/invoice-pdf", "@/lib/invoice-pdf-server", "@/lib/multi-invoice-pdf"];
  const offenders: string[] = [];
  for (const f of publicGeneratorSources()) {
    if (/PdfDownloadButton\.tsx$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const mod of indirect) {
      if (staticallyImports(src, mod)) offenders.push(`${f} → ${mod}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    `these modules import @react-pdf themselves, so importing them statically has the same effect:\n` +
      offenders.map((o) => `  · ${o}`).join("\n"),
  );
});

test("[PDF-LAZY] the lazy leaf really does hold both halves", () => {
  // The boundary only works while the renderer AND the document it renders sit behind it together.
  // Split them again and the static half drags the library back into the page.
  const leaf = readFileSync("src/app/factuur-maken/PdfDownloadButton.tsx", "utf8");
  assert.ok(staticallyImports(leaf, "@react-pdf/renderer"), "the leaf must own the renderer");
  assert.ok(staticallyImports(leaf, "@/lib/invoice-pdf"), "…and the document, or the page pulls it");

  const page = readFileSync("src/app/factuur-maken/GratisFactuur.tsx", "utf8");
  assert.match(
    page, /dynamic\(\(\) => import\(['"]\.\/PdfDownloadButton['"]\)/,
    "the page must reach the leaf through next/dynamic, or nothing is deferred at all",
  );
});
