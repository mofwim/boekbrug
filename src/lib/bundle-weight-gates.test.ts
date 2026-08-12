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

// ─── [INTAKE-QUEUE] The camera must not lock while the reader works ───────────
//
// Photographing a receipt took seconds, and the cause was not the processing — it was a lock.
// `if (busy) return 'error'` REFUSED a second photo outright, and every trigger carried
// disabled={busy}, so the owner stood still after each bon and their second tap vanished with no
// message at all. The server never asked for that: each request stands alone and the duplicate gate
// is already race-safe ([DEDUP-ATOMIC]). The brake was entirely in this component.
//
// These assertions hold the shape of the fix, because the regression is a one-word edit — `busy`
// reads so naturally in a disabled= that putting it back would pass every review.

/** Source with comments stripped — this file explains the old lock in prose, and a gate that
 *  matched its own explanation would fail forever while the code was correct. */
function intakeCode(): string {
  return readFileSync("src/components/intake/IntakeButton.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Just the body of handleFile — the upload outcome path. Navigations elsewhere (a "Terugzetten"
 *  tap, for instance) are deliberate user actions and must NOT wait for a queue. */
function handleFileBody(): string {
  const src = intakeCode();
  const at = src.indexOf("async function handleFile(");
  assert.notEqual(at, -1, "handleFile must still exist");
  const end = src.indexOf("\n  // ─── Trigger button", at);
  return src.slice(at, end === -1 ? src.length : end);
}

test("[INTAKE-QUEUE] a second photo is never refused outright", () => {
  const src = intakeCode();
  assert.doesNotMatch(
    src, /if \(busy\) return 'error'/,
    "the hard lock is back: a second capture is being rejected instead of queued",
  );
  assert.match(src, /const \[inFlight, setInFlight\]/, "the counter must still exist");
  assert.match(src, /inFlight >= MAX_PARALLEL_INTAKE/, "only the concurrency cap may refuse");
});

test("[INTAKE-QUEUE] no trigger is disabled merely because something is processing", () => {
  const src = intakeCode();
  assert.doesNotMatch(
    src, /disabled=\{busy\}/,
    "a trigger is locked on `busy` again — that is the wait this change removed",
  );
});

test("[INTAKE-QUEUE] the single-capture experience is unchanged", () => {
  // The conservative half, and the one worth protecting: one photo must still take the owner to
  // where it landed. mayNavigate() is what keeps that true, so every navigation must go through it.
  const src = handleFileBody();
  const pushes = [...src.matchAll(/setTimeout\(\(\) => router\.push\([^)]*\), 600\)/g)];
  assert.ok(pushes.length >= 3, `expected the destination navigations, found ${pushes.length}`);
  for (const p of pushes) {
    const before = src.slice(Math.max(0, p.index! - 120), p.index!);
    assert.match(
      before, /mayNavigate\(\)/,
      `a navigation runs unconditionally — during a batch it would abandon the other uploads: ${p[0]}`,
    );
  }
});

test("[INTAKE-QUEUE] a refused duplicate is never summarised as 'added'", () => {
  // The one way a batch could lose something quietly: a photo rejected as a duplicate, listed in
  // the summary as if it had been filed. The owner would count three and have two.
  const src = intakeCode();
  // [TAAL] The sentences live in the catalogue now; the gate follows them there — the key must
  // be the one whose Dutch says the file was NOT added, and the wording check moves to the
  // catalogue so a retranslation cannot quietly soften it.
  assert.match(src, /noteLanded\(file\.name, t\('int\.landed\.dubbel'\)\)/, "a byte-hash duplicate must say it was not added");
  assert.match(src, /noteLanded\(file\.name, t\('int\.landed\.mogelijkDubbel'\)\)/, "a semantic duplicate must say the choice is the owner's");
  const catalogue = readFileSync("src/lib/i18n/messages.ts", "utf8");
  assert.match(catalogue, /'int\.landed\.dubbel':[\s\S]{0,40}nl: 'dubbel — niet toegevoegd'/, "the Dutch must keep saying 'niet toegevoegd'");
  assert.match(catalogue, /'int\.landed\.mogelijkDubbel':[\s\S]{0,40}nl: 'mogelijk dubbel — jouw keuze'/, "the Dutch must keep saying the choice is the owner's");
});

// ─── [LIST-PAINT] Crediteuren skips the painting, never the rows ──────────────
//
// The list on /dashboard/incoming/manage is as long as the owner's backlog: every open invoice
// plus the 200 most recent paid ones, and page.tsx pages past PostgREST's silent 1000-row ceiling
// on purpose, because a row that is not in the list cannot be paid from it. A real one measures
// 326 rows = 5.908 DOM elements, sixteen of which are on screen.
//
// The fix is a browser instruction, not a smaller list: content-visibility: auto skips style,
// layout and paint for the rows that are off screen while every one of them stays in the DOM.
// Measured on the real markup in Chromium at 4x CPU throttle: main thread 912 ms → 365 ms.
//
// Two halves, and the gate exists for the second one. The rule itself is easy to delete by
// accident during a stylesheet tidy — it looks like a stray line, and nothing on any screen turns
// red when it goes. And the tempting "real" optimisation, slicing the list to the first fifty
// rows, would pass every test in this repo while making an overdue invoice unreachable.

const MANAGE = "src/app/dashboard/incoming/manage/IncomingManageClient.tsx";

test("[LIST-PAINT] the long invoice list still tells the browser it may skip off-screen rows", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(
    css, /\.inv-card\s*\{[^}]*content-visibility:\s*auto/,
    "the .inv-card rule is gone — the browser lays out and paints all 326 rows again",
  );
  assert.match(
    css, /\.inv-card\s*\{[^}]*contain-intrinsic-size:\s*auto\s+\d+px/,
    "without an assumed row height the page reports the wrong scroll length until you scroll past",
  );
  // All three long lists, because the rule applies to nothing without the class, and a class that
  // is on no element is exactly the kind of line a cleanup deletes as unused.
  const wearers = [
    MANAGE,
    "src/app/dashboard/facturen/FacturenClient.tsx",
    "src/app/dashboard/incoming/IncomingInvoicesClient.tsx",
  ];
  for (const f of wearers) {
    assert.match(
      readFileSync(f, "utf8"), /className="inv-card"/,
      `${f} lost the class, so the stylesheet rule now applies to nothing there`,
    );
  }
});

test("[LIST-PAINT] and it renders every row it was given — no window, no slice", () => {
  // The half that is about money rather than milliseconds. Skipping the PAINT of a row is
  // invisible to the owner; skipping the ROW is an invoice they never see and never pay. If a
  // later change does want a window, it has to come with a way to reach the rest, and this
  // assertion is where that decision gets made deliberately instead of in passing.
  const src = readFileSync(MANAGE, "utf8");
  assert.match(
    src, /\{displayed\.map\(inv => \{/,
    "the list is no longer rendered straight from `displayed` — check nothing was cut out of view",
  );
  assert.doesNotMatch(
    src, /displayed\s*\.\s*slice\s*\(/,
    "`displayed` is being sliced before it is rendered: some invoices are not on the screen at all",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// [DASHBOARD-TOOLS] The same rule, on the screen that is opened most
// ─────────────────────────────────────────────────────────────────────────────
// The gate above walks src/app/factuur-maken and nothing else, which was right
// when /factuur-maken was the only place a heavy library had reached. It is no
// longer: the file tools live in src/lib/tools and src/components/tools, and the
// dashboard now touches them — /dashboard/upload shrinks an oversized PDF, and
// both home screens link to the tool pages.
//
// Links cost nothing. The shrink does not, and that is exactly why it is behind
// `await import()`. Nothing enforced that: the dashboard is authenticated, so
// the public-surface sweep never loads it, and a static import here would put
// pdf-lib and pdfjs — a megabyte between them — into the first download of the
// screen a shop owner opens every morning. It would look completely fine in
// development.

/** Everything the logged-in dashboard loads eagerly. */
function dashboardSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
    }
  };
  walk("src/app/dashboard");
  walk("src/modules/accountant");
  return out;
}

/** The tool engines, which pull pdf-lib or pdfjs behind them. */
const TOOL_ENGINES = [
  "@/lib/tools/pdf",
  "@/lib/tools/pdfjs",
  "@/lib/tools/pdfcompress",
  "@/lib/tools/zip",
  "@/components/tools/ui",
  "@/components/tools/PageGrid",
  "@/components/tools/usePreview",
];

test("[DASHBOARD-TOOLS] the dashboard does not pull a heavy library into its first load", () => {
  const files = dashboardSources();
  assert.ok(files.length >= 20, `walked ${files.length} dashboard files — the walk broke`);

  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const mod of [...HEAVY, ...TOOL_ENGINES, "pdf-lib", "pdfjs-dist"]) {
      if (staticallyImports(src, mod)) offenders.push(`${f} → ${mod}`);
    }
  }

  assert.deepEqual(
    offenders, [],
    `these static imports land a heavy library in the first download of the dashboard:\n` +
      offenders.map((o) => `  · ${o}`).join("\n") +
      `\n\nThe dashboard is opened every day by people who may never touch a PDF. Load it where it ` +
      `is used — see shrinkAndRetry in upload/UploadClient.tsx, which imports pdfcompress inside ` +
      `the handler. A next/dynamic() elsewhere in the file does NOT help: one static import ` +
      `anywhere in the chain pulls the whole library in.`,
  );
});

test("[DASHBOARD-TOOLS] the tool links are links, not embedded tools", () => {
  // The cheap way to get this wrong is to render the tool components in the
  // dashboard section rather than linking to their pages. That would be a nicer
  // demo and a megabyte on every load, so it is asserted rather than trusted.
  const src = readFileSync("src/components/tools/DashboardTools.tsx", "utf8");
  assert.match(src, /from "next\/link"/, "DashboardTools stopped using Link");
  for (const mod of ["@/lib/tools/pdf", "@/lib/tools/pdfcompress", "pdf-lib"]) {
    assert.ok(
      !staticallyImports(src, mod),
      `DashboardTools imports ${mod} — it is meant to be a list of links, nothing more`,
    );
  }
});

test("[SIZE-SHRINK] the upload's shrink offer keeps its escape hatch", () => {
  const src = readFileSync("src/app/dashboard/upload/UploadClient.tsx", "utf8");
  // A file that cannot get under the ceiling must not be uploaded anyway: the
  // server would refuse it and the owner would be back where they started, one
  // wasted wait later.
  assert.match(
    src, /if \(!fits\)/,
    "shrinkAndRetry no longer checks whether the result actually fits before queueing it",
  );
  // And the flag has to be cleared on a retry, or "Verklein en probeer opnieuw"
  // turns up on a row whose second attempt failed for some other reason.
  //
  // Read as the BLOCK rather than as "within N characters of the name". The
  // first version of this used a 400-character window and failed the moment a
  // comment was added inside the object — a gate that breaks when somebody
  // explains themselves is a gate that teaches people not to.
  const reset = src.match(/const RESET_ON_RETRY[^}]*\}/)?.[0];
  assert.ok(reset, "RESET_ON_RETRY is gone or no longer a plain object literal");
  assert.match(
    reset, /tooBig: false/,
    "tooBig is no longer reset on a retry — the shrink button can appear on an unrelated failure",
  );
});
