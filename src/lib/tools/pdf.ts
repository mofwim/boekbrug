// src/lib/tools/pdf.ts
// [PDF-TOOLS] PDF structure work, in the browser.
//
// pdf-lib reads and writes the file structure without rendering anything, which
// is exactly what these tools need: pages get moved, rotated, dropped or
// stamped, and the original content is carried across untouched. Nothing is
// rasterised, so text stays text and a merged document is as sharp as what went
// into it. src/lib/tools/pdfjs.ts is the other half — the one that can SEE a
// page — and the two are deliberately separate.
//
// [PDF-LAZY] pdf-lib is imported inside loadPdfLib() rather than at the top of
// the file. These are public pages whose whole job is to convince a stranger on
// a phone, and the same static-import-cancels-the-deferral trap that cost
// /factuur-maken 1,4 MB applies here: one ordinary `import { PDFDocument } from
// "pdf-lib"` anywhere in this chain puts the library in the first load of every
// tool page, whether or not anybody opens a file.

import { ToolError, fail } from "./errors";

type PdfLib = typeof import("pdf-lib");
// Not InstanceType<>: pdf-lib's PDFDocument has a private constructor, so its
// type is only reachable through what the factory returns.
type PDFDocument = Awaited<ReturnType<PdfLib["PDFDocument"]["create"]>>;

let pdfLibPromise: Promise<PdfLib> | null = null;

export function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) pdfLibPromise = import("pdf-lib");
  return pdfLibPromise;
}

function niceError(name: string, err: unknown): ToolError {
  const message = String((err as { message?: string })?.message || err);
  if (/encrypt|password/i.test(message)) return new ToolError("pdfLocked", { name });
  return new ToolError("pdfUnreadable", { name });
}

export async function readDocument(file: File, { forEditing = true } = {}): Promise<PDFDocument> {
  const { PDFDocument } = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: forEditing });
  } catch (err) {
    throw niceError(file.name, err);
  }
}

export async function save(
  doc: PDFDocument,
  { name = "document.pdf" } = {}
): Promise<{ blob: Blob; name: string }> {
  const bytes = await doc.save({ useObjectStreams: true });
  return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), name };
}

/** How many pages, and how big page one is — enough to describe a file. */
export async function describe(file: File) {
  const doc = await readDocument(file);
  const pages = doc.getPageCount();
  const first = pages ? doc.getPage(0).getSize() : { width: 0, height: 0 };
  return {
    pages,
    width: Math.round(first.width),
    height: Math.round(first.height),
    portrait: first.height >= first.width,
  };
}

/**
 * Read a page selection the way a print dialog does: "1-3, 7, 12-".
 *
 * Returns zero-based indices, in order, without duplicates.
 */
export function parsePageRange(input: string, total: number): number[] {
  const text = String(input || "").trim();
  if (!text) return [];
  if (/^(alle|all|\*)$/i.test(text)) return Array.from({ length: total }, (_, i) => i);

  const picked = new Set<number>();
  for (const part of text.split(/[,;]/)) {
    const chunk = part.trim();
    if (!chunk) continue;

    const range = chunk.match(/^(\d+)?\s*[-–]\s*(\d+)?$/);
    if (range) {
      const from = range[1] ? Number(range[1]) : 1;
      const to = range[2] ? Number(range[2]) : total;
      for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
        if (n >= 1 && n <= total) picked.add(n - 1);
      }
      continue;
    }

    const single = Number(chunk);
    if (Number.isInteger(single) && single >= 1 && single <= total) picked.add(single - 1);
  }

  return [...picked].sort((a, b) => a - b);
}

/** The inverse: indices back into the grammar somebody typed. */
export function formatPageRange(indices: number[]): string {
  if (!indices.length) return "";
  const parts: string[] = [];
  let start = indices[0];
  let previous = indices[0];

  for (const index of indices.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    parts.push(start === previous ? `${start + 1}` : `${start + 1}-${previous + 1}`);
    start = index;
    previous = index;
  }
  parts.push(start === previous ? `${start + 1}` : `${start + 1}-${previous + 1}`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type MergeEntry = File | { file: File; pages?: number[] };

/**
 * One document out of several, in the order they were given.
 *
 * An entry may be a file, or a file with the pages wanted from it. The second
 * form is what turns "assemble one document out of parts of others" from four
 * round trips — split, download, upload, merge — into one, which is the shape
 * that job actually has in somebody's head. Bonnetjes for a quarter are exactly
 * that shape.
 */
export async function mergeFiles(
  entries: MergeEntry[],
  { onProgress }: { onProgress?: (done: number, total: number) => void } = {}
): Promise<{ doc: PDFDocument; pages: number }> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  let pages = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const file = entry instanceof File ? entry : entry.file;
    const chosen = entry instanceof File ? undefined : entry.pages;
    const source = await readDocument(file);

    // No selection means the whole document. An EMPTY one means somebody
    // deliberately took nothing from this file, which is not the same thing.
    const wanted = chosen
      ? chosen.filter((index) => index >= 0 && index < source.getPageCount())
      : source.getPageIndices();

    if (wanted.length) {
      const copied = await out.copyPages(source, wanted);
      for (const page of copied) out.addPage(page);
      pages += copied.length;
    }
    onProgress?.(i + 1, entries.length);
  }

  if (!pages) fail("noPages");
  return { doc: out, pages };
}

/** A new document holding only the chosen pages. */
export async function extractPages(file: File, indices: number[]): Promise<PDFDocument> {
  const { PDFDocument } = await loadPdfLib();
  const source = await readDocument(file);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, indices);
  for (const page of copied) out.addPage(page);
  return out;
}

/** Split into fixed-size chunks: every N pages becomes its own document. */
export async function splitEvery(file: File, size: number): Promise<number[][]> {
  const source = await readDocument(file);
  const total = source.getPageCount();
  const groups: number[][] = [];
  for (let start = 0; start < total; start += size) {
    groups.push(Array.from({ length: Math.min(size, total - start) }, (_, i) => start + i));
  }
  return groups;
}

export interface PagePlan {
  index: number;
  rotate?: number;
}

/**
 * Rebuild a document from a plan: which pages, in which order, turned how far.
 *
 * Moving, turning and dropping are one operation rather than three because they
 * are one thought — "this is what the document should look like". Doing it by
 * copying into a FRESH document rather than by shuffling the original also means
 * an index never has to be corrected for an earlier removal, which is where a
 * page-order bug always comes from.
 */
export async function rebuildPages(file: File, plan: PagePlan[]): Promise<PDFDocument> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const source = await readDocument(file);

  const wanted = plan.filter((entry) => entry.index >= 0 && entry.index < source.getPageCount());
  if (!wanted.length) fail("allDropped");

  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    wanted.map((entry) => entry.index)
  );

  copied.forEach((page, at) => {
    const turn = wanted[at].rotate || 0;
    // A page can already carry a rotation of its own; this adds to it.
    if (turn) page.setRotation(degrees((page.getRotation().angle + turn + 360) % 360));
    out.addPage(page);
  });

  return out;
}

// ---------------------------------------------------------------------------
// Document properties
// ---------------------------------------------------------------------------

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  created: Date | null;
  modified: Date | null;
  pages: number;
}

/** What the file says about itself. */
export async function readMetadata(file: File): Promise<PdfMetadata> {
  const doc = await readDocument(file);
  const asDate = (value: Date | undefined) => {
    try {
      return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
    } catch {
      return null;
    }
  };

  return {
    title: doc.getTitle() || "",
    author: doc.getAuthor() || "",
    subject: doc.getSubject() || "",
    keywords: (doc.getKeywords() || "").trim(),
    creator: doc.getCreator() || "",
    producer: doc.getProducer() || "",
    created: asDate(doc.getCreationDate()),
    modified: asDate(doc.getModificationDate()),
    pages: doc.getPageCount(),
  };
}

/**
 * Write the properties back.
 *
 * An empty field CLEARS the entry rather than writing an empty string, so
 * "haal mijn naam uit dit document" actually removes it — which is most of why
 * anyone opens a metadata editor in the first place. A ZZP'er sending an offerte
 * often has no idea his word processor wrote his full name and his employer's
 * licence key into it.
 */
export async function writeMetadata(
  file: File,
  fields: Partial<Record<"title" | "author" | "subject" | "creator" | "producer" | "keywords", string>> & {
    touchModified?: boolean;
    now?: Date;
  }
): Promise<PDFDocument> {
  const doc = await readDocument(file);

  const set = (value: string | undefined, write: (v: string) => void) => {
    const text = String(value ?? "").trim();
    write(text);
  };

  set(fields.title, (v) => doc.setTitle(v));
  set(fields.author, (v) => doc.setAuthor(v));
  set(fields.subject, (v) => doc.setSubject(v));
  set(fields.creator, (v) => doc.setCreator(v));
  set(fields.producer, (v) => doc.setProducer(v));

  const keywords = String(fields.keywords ?? "").trim();
  doc.setKeywords(keywords ? keywords.split(/\s*,\s*/).filter(Boolean) : []);

  if (fields.touchModified !== false) doc.setModificationDate(fields.now || new Date());
  return doc;
}

// ---------------------------------------------------------------------------
// Signatures and images
// ---------------------------------------------------------------------------

export interface ImagePlacement {
  page: number;
  /** Centre of the image, 0–1 from the left and from the TOP. */
  x: number;
  y: number;
  /** Width as a fraction of the page. */
  width: number;
  opacity?: number;
}

/**
 * Put an image on one page, positioned in fractions of the page.
 *
 * Fractions rather than points because the caller is a person pointing at a
 * preview, and a preview is whatever size the screen made it.
 */
export async function placeImage(
  file: File,
  image: { bytes: Uint8Array; type: string },
  place: ImagePlacement
): Promise<PDFDocument> {
  const doc = await readDocument(file);
  const isPng = image.type === "image/png";

  let embedded;
  try {
    embedded = isPng ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  } catch {
    try {
      embedded = isPng ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes);
    } catch {
      fail("badImage", { name: "handtekening" });
    }
  }

  const page = doc.getPage(Math.min(Math.max(place.page, 0), doc.getPageCount() - 1));
  const size = page.getSize();

  const width = size.width * place.width;
  const height = (width / embedded.width) * embedded.height;

  page.drawImage(embedded, {
    // PDF measures from the bottom; a person points from the top.
    x: size.width * place.x - width / 2,
    y: size.height * (1 - place.y) - height / 2,
    width,
    height,
    opacity: place.opacity ?? 1,
  });

  return doc;
}

const A4 = { width: 595.28, height: 841.89 };

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = String(hex || "#000000").replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** Images onto pages: one picture per page, fitted with a margin. */
export async function imagesToPdf(
  files: File[],
  { pageSize = "a4", margin = 36, background = "#ffffff" } = {}
): Promise<PDFDocument> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();

  const tint = hexToRgb(background);
  const fill = rgb(tint.r, tint.g, tint.b);

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = /\.png$/i.test(file.name) || file.type === "image/png";

    let embedded;
    try {
      embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      // A misnamed file is common enough to be worth one retry the other way.
      try {
        embedded = isPng ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      } catch {
        fail("badImage", { name: file.name });
      }
    }

    const size =
      pageSize === "fit"
        ? { width: embedded.width + margin * 2, height: embedded.height + margin * 2 }
        : embedded.width > embedded.height
          ? { width: A4.height, height: A4.width }
          : A4;

    const page = doc.addPage([size.width, size.height]);
    page.drawRectangle({ x: 0, y: 0, width: size.width, height: size.height, color: fill });

    const room = { width: size.width - margin * 2, height: size.height - margin * 2 };
    const scale = Math.min(room.width / embedded.width, room.height / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;

    page.drawImage(embedded, {
      x: (size.width - width) / 2,
      y: (size.height - height) / 2,
      width,
      height,
    });
  }

  if (!doc.getPageCount()) fail("noImages");
  return doc;
}

/**
 * Text across every page, plus optional page numbers.
 *
 * `firstNumber` and `total` exist for the preview: a sample built from one page
 * still has to read "3 / 12" rather than "1 / 1", or the preview would be
 * showing something the finished document never does.
 */
export async function stampDocument(
  file: File,
  {
    text = "",
    opacity = 0.25,
    size = 48,
    angle = 45,
    colour = "#ff0000",
    numbers = false,
    firstNumber = 1,
    total = 0,
  } = {}
): Promise<PDFDocument> {
  const { StandardFonts, degrees, rgb } = await loadPdfLib();
  const doc = await readDocument(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const tint = hexToRgb(colour);
  const ink = rgb(tint.r, tint.g, tint.b);

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const { width, height } = page.getSize();

    if (text) {
      const textWidth = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: width / 2 - (textWidth / 2) * Math.cos((angle * Math.PI) / 180),
        y: height / 2 - (textWidth / 2) * Math.sin((angle * Math.PI) / 180),
        size,
        font,
        color: ink,
        opacity,
        rotate: degrees(angle),
      });
    }

    if (numbers) {
      const label = `${index + firstNumber} / ${total || pages.length}`;
      const labelWidth = plain.widthOfTextAtSize(label, 10);
      page.drawText(label, {
        x: width - labelWidth - 36,
        y: 24,
        size: 10,
        font: plain,
        color: rgb(0.35, 0.35, 0.38),
      });
    }
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Making it smaller
// ---------------------------------------------------------------------------

/**
 * Rewrite the file without changing a single page.
 *
 * Object streams pack the structure tightly and anything the original left
 * unreferenced is dropped on the way through. On a file that came out of a word
 * processor this is often a fifth of it; on one that is already tight it is
 * nothing, and the tool says so rather than pretending.
 */
export async function restructure(file: File): Promise<{ blob: Blob; pages: number }> {
  const doc = await readDocument(file);
  const bytes = await doc.save({ useObjectStreams: true });
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    pages: doc.getPageCount(),
  };
}

/**
 * Draw every page as a picture and build a new document from those.
 *
 * This is the version that makes a scanned document a tenth of its size, and it
 * is also the version that turns text into pixels — no more selecting, searching
 * or copying, and no more OCR for whoever receives it. Both halves of that are
 * true, so both are said on the page and the reader picks. It is never done
 * silently.
 */
export async function rasterise(
  file: File,
  {
    dpi = 150,
    quality = 0.72,
    onProgress,
  }: { dpi?: number; quality?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ blob: Blob; pages: number }> {
  const { PDFDocument } = await loadPdfLib();
  const { openDocument, renderPage } = await import("./pdfjs");

  const reader = await openDocument(file);
  const out = await PDFDocument.create();

  for (let number = 1; number <= reader.numPages; number++) {
    const page = await reader.getPage(number);
    const view = page.getViewport({ scale: 1 });
    page.cleanup();

    const canvas = await renderPage(reader, number, { scale: dpi / 72 });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("canvas"))),
        "image/jpeg",
        quality
      );
    });
    canvas.width = 0;
    canvas.height = 0;

    const embedded = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    // The new page keeps the old one's size in points, so the document still
    // prints on the same paper however coarsely it was rendered.
    const sheet = out.addPage([view.width, view.height]);
    sheet.drawImage(embedded, { x: 0, y: 0, width: view.width, height: view.height });

    onProgress?.(number, reader.numPages);
  }

  // [PDFJS-6] destroy() lives on the loading task, not on the document proxy.
  await reader.loadingTask.destroy();
  const bytes = await out.save({ useObjectStreams: true });
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    pages: out.getPageCount(),
  };
}

/**
 * One page, put through the very operation being previewed.
 *
 * The preview is built by the same engine that builds the result, so the two
 * cannot drift apart. Drawing an approximation on top of a picture would be
 * faster and would eventually be wrong about something.
 */
export async function samplePage(
  file: File,
  index: number,
  operate: (sample: File) => Promise<PDFDocument>
): Promise<Uint8Array> {
  const one = await extractPages(file, [index]);
  const bytes = await one.save();
  const sample = new File([bytes as BlobPart], file.name, { type: "application/pdf" });
  const doc = await operate(sample);
  return doc.save();
}

export const __testing = { hexToRgb };
export type { PDFDocument };
