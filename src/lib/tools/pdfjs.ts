// src/lib/tools/pdfjs.ts
// [PDF-TOOLS] Reading a PDF the way a reader does — as pictures and as words.
//
// pdf-lib next door moves pages about without ever looking inside them, which
// is exactly right for merging and rotating: nothing is redrawn, so nothing is
// lost. But it cannot SHOW a page, and a page organiser that renders numbered
// grey rectangles is asking somebody to work from memory. This is the other
// half.
//
// [PDF-COST] It is the heaviest thing these tools pull in, so nothing here is
// imported statically: a page that never opens a PDF never downloads it. The
// worker, the character maps and the standard fonts are fetched over HTTP from
// /pdfjs (see scripts/copy-pdfjs.mjs) rather than bundled, so a document that
// needs a Japanese cmap gets that one file and every other document gets none.
//
// NB: this is the CLIENT-side reader. src/lib/ai.ts reads PDFs on the SERVER
// through unpdf; the two do not meet and must not be merged.

import { fail } from "./errors";

// pdfjs-dist has no single exported "module" type, and importing its types
// eagerly would defeat the lazy load above. The shapes used here are narrow
// enough to state directly.
type PdfjsModule = typeof import("pdfjs-dist");
type PDFDocumentProxy = Awaited<ReturnType<PdfjsModule["getDocument"]>["promise"]>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;

let libraryPromise: Promise<PdfjsModule> | null = null;

/** Load pdf.js and point it at its runtime files. Cached — one load per tab. */
export function loadPdfjs(): Promise<PdfjsModule> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      // pdf.js 6 uses Promise.withResolvers in 27 places and Safari only grew
      // it in 17.4. One line here is cheaper than telling a reader their
      // browser is too old for a tool that would otherwise work.
      if (typeof Promise.withResolvers !== "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Promise as any).withResolvers = function withResolvers<T>() {
          let resolve!: (value: T | PromiseLike<T>) => void;
          let reject!: (reason?: unknown) => void;
          const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          return { promise, resolve, reject };
        };
      }

      // [PDFJS-6-UPSERT] pdf.js 6 calls Map.prototype.getOrInsertComputed, from
      // the TC39 upsert proposal, which only reached Chrome 142 — and it does so
      // in the worker as well as on the main thread. Neither build ships a
      // polyfill and the `legacy` build uses it MORE, not less, so it is no way
      // out. Without this, every PDF fails on any browser more than a few months
      // old with "getOrInsertComputed is not a function" surfacing as nothing
      // more useful than "this file could not be read" — verified on Chromium
      // 141, where every tool here was dead until this ran.
      //
      // The worker is a separate JavaScript context that this cannot reach, so
      // scripts/copy-pdfjs.mjs prepends the same shim to the worker file as it
      // copies it. Both halves are needed: the main thread parses the document
      // structure and the worker decodes the pages.
      if (typeof (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed !== "function") {
        Object.defineProperty(Map.prototype, "getOrInsertComputed", {
          configurable: true,
          writable: true,
          value: function getOrInsertComputed<K, V>(this: Map<K, V>, key: K, make: (key: K) => V): V {
            if (this.has(key)) return this.get(key) as V;
            const value = make(key);
            this.set(key, value);
            return value;
          },
        });
      }

      const pdfjs = (await import("pdfjs-dist/build/pdf.min.mjs")) as unknown as PdfjsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return pdfjs;
    })();
  }
  return libraryPromise;
}

const RUNTIME = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
};

/**
 * Open a document for reading — from a file, or from bytes already in hand.
 *
 * The bytes are copied first: pdf.js takes ownership of the buffer it is given
 * and detaches it, which would quietly break a tool that hands the same file to
 * pdf-lib as well. Several here do exactly that.
 */
export async function openDocument(
  source: File | Uint8Array,
  { password, name }: { password?: string; name?: string } = {}
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const label = name || (source instanceof File ? source.name : "") || "Dit bestand";
  const data =
    source instanceof Uint8Array
      ? new Uint8Array(source)
      : new Uint8Array(await source.arrayBuffer());

  try {
    return await pdfjs.getDocument({ data, password, ...RUNTIME }).promise;
  } catch (err) {
    if ((err as { name?: string })?.name === "PasswordException") fail("pdfLocked", { name: label });
    return fail("pdfUnreadable", { name: label });
  }
}

/**
 * Render one page onto a canvas at a given scale, and hand back the canvas.
 *
 * [PDFJS-6] `render()` takes `canvas` now. `canvasContext` still works for
 * backwards compatibility, but only when `canvas` is explicitly null — passing
 * both is the one combination the API rejects. Handing over the canvas also
 * means the white base goes through the documented `background` option rather
 * than being painted underneath and hoped for.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  number: number,
  { scale = 1, maxSide = 0, background = "#ffffff" } = {}
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(number);
  let viewport = page.getViewport({ scale });

  // A cap in pixels rather than in scale, because "the tile is 150 across" is
  // the thing a caller actually knows; the page's own size is not.
  if (maxSide > 0) {
    const longest = Math.max(viewport.width, viewport.height);
    if (longest > maxSide) viewport = page.getViewport({ scale: (scale * maxSide) / longest });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  await page.render({ canvas, viewport, background }).promise;
  page.cleanup();
  return canvas;
}

/** A page as an image file, at a resolution given in dots per inch. */
export async function pageToBlob(
  doc: PDFDocumentProxy,
  number: number,
  { dpi = 150, mime = "image/jpeg", quality = 0.9 } = {}
): Promise<Blob> {
  // A PDF point is 1/72 inch, so the scale is simply the ratio.
  const canvas = await renderPage(doc, number, { scale: dpi / 72 });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("canvas"))),
      mime,
      mime === "image/png" ? undefined : quality
    );
  });
  // Free the backing store now rather than when the collector gets round to it;
  // a hundred page-sized canvases is a lot of memory to leave lying about.
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/** A small preview of a page, as a data URL that can go straight in an <img>. */
export async function pageThumbnail(
  doc: PDFDocumentProxy,
  number: number,
  { maxSide = 200 } = {}
): Promise<string> {
  const canvas = await renderPage(doc, number, { scale: 1, maxSide });
  const url = canvas.toDataURL("image/jpeg", 0.72);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

/**
 * The words on a page, with the line breaks put back.
 *
 * pdf.js hands back positioned fragments, not lines — a PDF has no idea what a
 * paragraph is. Fragments are grouped by their vertical position, which is what
 * makes the difference between readable text and one endless line.
 */
export async function pageText(doc: PDFDocumentProxy, number: number): Promise<string> {
  const page = await doc.getPage(number);
  const content = await page.getTextContent();

  const lines: { y: number; parts: string[] }[] = [];
  let current: { y: number; parts: string[] } | null = null;

  for (const item of content.items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    const y = Math.round(item.transform[5]);

    if (!current || Math.abs(current.y - y) > 2) {
      current = { y, parts: [] };
      lines.push(current);
    }
    current.parts.push(item.str);
    if (item.hasEOL) current = null;
  }

  page.cleanup();
  return lines
    .map((line) => line.parts.join("").replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface EmbeddedImage {
  blob: Blob;
  width: number;
  height: number;
  page: number;
}

/**
 * The pictures embedded in a page, at their own resolution.
 *
 * Not the page rendered as a picture — the actual photographs and logos that
 * were put INTO the document, pulled back out at the size they went in at. A
 * scan of a page is one image; an invoice with a logo is a couple, at whatever
 * resolution the sender supplied.
 */
export async function pageImages(
  doc: PDFDocumentProxy,
  number: number,
  { minSide = 24 } = {}
): Promise<EmbeddedImage[]> {
  const pdfjs = await loadPdfjs();
  const page = await doc.getPage(number);
  const operators = await page.getOperatorList();

  // The worker only hands the decoded pixels over while the page is being
  // drawn. Asking the object store before that waits for ever, so the page is
  // rendered small and thrown away purely to make the images arrive.
  const viewport = page.getViewport({ scale: 0.2 });
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.round(viewport.width));
  scratch.height = Math.max(1, Math.round(viewport.height));
  try {
    await page.render({ canvas: scratch, viewport }).promise;
  } catch {
    // A page that will not draw may still have readable objects; carry on.
  }
  scratch.width = 0;
  scratch.height = 0;

  // [PDFJS-6] paintJpegXObject is gone — a JPEG now arrives through the same
  // paintImageXObject as everything else. paintImageXObjectRepeat is the tiled
  // form, and its first argument is the same object id.
  const wanted = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintImageXObjectRepeat]);
  const found: EmbeddedImage[] = [];
  const seen = new Set<string>();

  for (let at = 0; at < operators.fnArray.length; at++) {
    if (!wanted.has(operators.fnArray[at])) continue;
    const name = operators.argsArray[at][0];
    // The same logo on a page ten times is still one picture.
    if (typeof name !== "string" || seen.has(name)) continue;
    seen.add(name);

    const image = await resolveObject(page, name);
    if (!image?.width || !image?.height) continue;
    if (Math.min(image.width, image.height) < minSide) continue;

    const canvas = toCanvas(image);
    if (!canvas) continue;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0;
    canvas.height = 0;
    if (blob) found.push({ blob, width: image.width, height: image.height, page: number });
  }

  page.cleanup();
  return found;
}

interface DecodedImage {
  width: number;
  height: number;
  data?: Uint8ClampedArray | Uint8Array;
  kind?: number;
  bitmap?: ImageBitmap;
}

/**
 * Fetch one decoded object, from wherever it ended up.
 *
 * An image used by a single page lives on that page's own store; one shared
 * across pages is promoted to the common store. Both hang off the PAGE — the
 * version of this that asked the DOCUMENT for `commonObjs` was reading
 * `undefined` and skipping the second lookup silently, which the typechecker
 * found the moment this moved to TypeScript.
 *
 * Neither lookup is allowed to hang: an object that never arrives means one
 * missing picture, not a stuck tool.
 */
async function resolveObject(page: PDFPageProxy, name: string): Promise<DecodedImage | null> {
  for (const store of [page.objs, page.commonObjs]) {
    if (!store) continue;
    try {
      if (typeof store.has === "function" && store.has(name)) return store.get(name) as DecodedImage;
    } catch {
      // Not in this one; try the next.
    }
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    try {
      page.objs.get(name, (value: unknown) => {
        clearTimeout(timer);
        resolve(value as DecodedImage);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** pdf.js's three pixel layouts, laid out into the one a canvas accepts. */
function toCanvas(image: DecodedImage): HTMLCanvasElement | null {
  const { width, height, data, kind, bitmap } = image;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Newer builds hand back an ImageBitmap directly, which is simply drawn.
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  }
  if (!data) return null;

  const out = ctx.createImageData(width, height);
  const pixels = out.data;

  if (kind === 3 || data.length === width * height * 4) {
    pixels.set(data.subarray(0, pixels.length));
  } else if (kind === 2 || data.length === width * height * 3) {
    for (let i = 0, at = 0; i < data.length; i += 3, at += 4) {
      pixels[at] = data[i];
      pixels[at + 1] = data[i + 1];
      pixels[at + 2] = data[i + 2];
      pixels[at + 3] = 255;
    }
  } else if (kind === 1) {
    // One bit per pixel, packed eight to a byte, most significant first.
    const perRow = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * perRow + (x >> 3)] >> (7 - (x & 7))) & 1;
        const at = (y * width + x) * 4;
        const tone = bit ? 255 : 0;
        pixels[at] = tone;
        pixels[at + 1] = tone;
        pixels[at + 2] = tone;
        pixels[at + 3] = 255;
      }
    }
  } else {
    return null;
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
}

export interface DocumentFacts {
  pages: number;
  width: number;
  height: number;
  portrait: boolean;
  title: string;
  author: string;
  producer: string;
}

/** Everything a tool wants to say about a document before doing anything. */
export async function describeDocument(doc: PDFDocumentProxy): Promise<DocumentFacts> {
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, string | undefined>;
  const first = await doc.getPage(1);
  const view = first.getViewport({ scale: 1 });
  first.cleanup();

  return {
    pages: doc.numPages,
    width: Math.round(view.width),
    height: Math.round(view.height),
    portrait: view.height >= view.width,
    title: info.Title || "",
    author: info.Author || "",
    producer: info.Producer || "",
  };
}

/** Page sizes for every page, which is what an organiser needs to lay out. */
export async function pageSizes(
  doc: PDFDocumentProxy
): Promise<{ width: number; height: number }[]> {
  const sizes: { width: number; height: number }[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const view = page.getViewport({ scale: 1 });
    sizes.push({ width: Math.round(view.width), height: Math.round(view.height) });
    page.cleanup();
  }
  return sizes;
}

export type { PDFDocumentProxy };
