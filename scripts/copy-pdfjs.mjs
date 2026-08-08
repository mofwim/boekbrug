// scripts/copy-pdfjs.mjs
// [PDF-TOOLS] Put pdf.js's runtime files where the browser can fetch them.
//
// Three things have to be reachable over HTTP rather than bundled: the worker,
// the character maps a CJK document needs to give up its text, and the fourteen
// standard fonts a PDF is allowed to assume the reader already has. pdf.js
// fetches each one only when a document actually asks for it, so this costs
// nothing on a page that never opens a PDF.
//
// Copied at build time rather than committed, so the files can never drift out
// of step with the installed version. public/pdfjs is gitignored for the same
// reason.
//
// NB: this is the CLIENT-side pdf.js. src/lib/ai.ts reads PDFs on the SERVER
// through unpdf and needs none of this.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "pdfjs-dist");
const to = join(root, "public", "pdfjs");

// [PDFJS-6-UPSERT] pdf.js 6 calls Map.prototype.getOrInsertComputed — TC39's
// upsert proposal, which only reached Chrome 142 — inside the WORKER as well as
// on the main thread. The worker is its own JavaScript context, so the shim in
// src/lib/tools/pdfjs.ts cannot reach it, and there is no hook to load one
// first. Prepending it to the file as it is copied is the whole of the fix.
//
// The `legacy` build is not the way out: it calls the same method MORE often
// (20 uses against 15). Verified on Chromium 141, where every PDF failed with
// "getOrInsertComputed is not a function" until this shipped.
const UPSERT_SHIM = `// prepended by scripts/copy-pdfjs.mjs — see the note there
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    configurable: true, writable: true,
    value: function (key, make) {
      if (this.has(key)) return this.get(key);
      const value = make(key);
      this.set(key, value);
      return value;
    },
  });
}
`;

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });

const worker = await readFile(join(from, "build", "pdf.worker.min.mjs"), "utf8");
await writeFile(join(to, "pdf.worker.min.mjs"), UPSERT_SHIM + worker);
await cp(join(from, "cmaps"), join(to, "cmaps"), { recursive: true });
await cp(join(from, "standard_fonts"), join(to, "standard_fonts"), { recursive: true });

console.log("pdf.js runtime copied to public/pdfjs");
