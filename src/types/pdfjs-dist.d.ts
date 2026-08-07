// src/types/pdfjs-dist.d.ts
// [PDF-TOOLS] pdfjs-dist ships types for its package root but not for the
// individual build files, and src/lib/tools/pdfjs.ts imports the minified build
// directly — deliberately, because that is the one the browser should download
// and `await import("pdfjs-dist")` would pull the unminified one into the
// bundle. The two are the same module; this says so.

declare module "pdfjs-dist/build/pdf.min.mjs" {
  export * from "pdfjs-dist";
}
