// src/lib/tools/pdfcompress.ts
// [PDF-TOOLS] Making a PDF smaller the way it should be done.
//
// The naive way — draw every page as a picture and rebuild the document from
// those — is what most browser tools do, and it is wrong twice over. On a
// document that is mostly text it makes the file BIGGER, because a page of type
// compresses far worse as pixels than as glyphs. And on the documents where it
// does win, it wins by destroying the thing people came for: the text stops
// being text, so it cannot be selected, searched, or read by whoever receives
// it. For a bonnetje going to a boekhouder that is the whole value gone.
//
// What a real compressor does is leave the text and vector objects completely
// alone and go after the only thing that is actually large: the embedded
// images. A scan is one enormous picture per page; an invoice is a logo and a
// photograph at whatever resolution somebody's phone happened to produce. Those
// are downsampled and re-encoded, and the rest of the file is carried across
// untouched.
//
// Anything this cannot decode SAFELY is left exactly as it was. A tool that
// mangles one image in fifty is worse than one that skips it and says so.

import { fail } from "./errors";
import { loadPdfLib, readDocument } from "./pdf";

type PdfLib = typeof import("pdf-lib");
type PDFNameCtor = PdfLib["PDFName"];
// pdf-lib's low-level object model is not exported as usable types; the four
// members touched here are stated inline rather than pulled in wholesale.
interface RawStream {
  dict: { get(key: unknown): unknown };
  getContents(): Uint8Array;
}

/** Colour spaces this understands well enough to rebuild an image from. */
const PLAIN_COLOURS = new Set(["DeviceRGB", "DeviceGray", "CalRGB", "CalGray"]);

const name = (value: string | undefined) => (value ? String(value).replace(/^\//, "") : "");

/**
 * Read the filter list out of an image dictionary, whatever shape it takes:
 * a single name on most images, an array on some.
 */
function filtersOf(dict: RawStream["dict"], PDFName: PDFNameCtor): string[] {
  const filter = dict.get(PDFName.of("Filter")) as
    | { asArray?: () => unknown[]; toString?: () => string }
    | undefined;
  if (!filter) return [];
  const asArray = typeof filter.asArray === "function" ? filter.asArray() : null;
  return (asArray || [filter]).map((entry) =>
    name((entry as { toString?: () => string })?.toString?.())
  );
}

function numberOf(dict: RawStream["dict"], PDFName: PDFNameCtor, key: string): number | null {
  const value = dict.get(PDFName.of(key)) as { asNumber?: () => number } | undefined;
  return typeof value?.asNumber === "function" ? value.asNumber() : null;
}

/** Inflate a Flate-encoded stream using the browser's own decompressor. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type Decoded = (ImageBitmap | HTMLCanvasElement) & { close?: () => void };

/**
 * Decode one image object into something drawable, or return null when it is
 * not something this understands. Null is a perfectly good answer: the caller
 * leaves that image exactly as it found it.
 */
async function decodeImage(stream: RawStream, PDFName: PDFNameCtor): Promise<Decoded | null> {
  const dict = stream.dict;
  const width = numberOf(dict, PDFName, "Width");
  const height = numberOf(dict, PDFName, "Height");
  if (!width || !height) return null;

  // A stencil mask is one bit per pixel and belongs to the drawing, not to the
  // picture; re-encoding one as a photograph would be nonsense.
  if (dict.get(PDFName.of("ImageMask"))) return null;
  // Transparency cannot survive a trip through JPEG, so anything carrying it is
  // left alone rather than quietly losing its cut-out.
  if (dict.get(PDFName.of("SMask")) || dict.get(PDFName.of("Mask"))) return null;

  const filters = filtersOf(dict, PDFName);
  const colour = name(
    (dict.get(PDFName.of("ColorSpace")) as { toString?: () => string } | undefined)?.toString?.()
  );
  const bits = numberOf(dict, PDFName, "BitsPerComponent");
  const bytes = stream.getContents();

  // The common case by a distance: the stream is already a JPEG, so the
  // browser's own decoder reads it.
  if (filters.includes("DCTDecode")) {
    if (colour === "DeviceCMYK") return null; // four-channel JPEG, decoded wrong by canvas
    try {
      return (await createImageBitmap(
        new Blob([bytes as BlobPart], { type: "image/jpeg" })
      )) as Decoded;
    } catch {
      return null;
    }
  }

  // The other common case: raw samples, deflated. Only the straightforward
  // colour spaces at eight bits are rebuilt here.
  if (
    filters.length === 1 &&
    filters[0] === "FlateDecode" &&
    bits === 8 &&
    PLAIN_COLOURS.has(colour)
  ) {
    let raw: Uint8Array;
    try {
      raw = await inflate(bytes);
    } catch {
      return null;
    }

    const channels = colour === "DeviceGray" || colour === "CalGray" ? 1 : 3;
    if (raw.length < width * height * channels) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(width, height);

    for (
      let pixel = 0, at = 0, from = 0;
      pixel < width * height;
      pixel++, at += 4, from += channels
    ) {
      if (channels === 1) {
        image.data[at] = image.data[at + 1] = image.data[at + 2] = raw[from];
      } else {
        image.data[at] = raw[from];
        image.data[at + 1] = raw[from + 1];
        image.data[at + 2] = raw[from + 2];
      }
      image.data[at + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas as Decoded;
  }

  // JPX, CCITT, JBIG2, LZW, indexed palettes — all left alone on purpose.
  return null;
}

/** Draw a decoded image at its new size and encode it as a JPEG. */
async function reEncode(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number
): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  canvas.width = 0;
  canvas.height = 0;
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export interface CompressResult {
  blob: Blob;
  pages: number;
  images: number;
  changed: number;
  skipped: number;
  before: number;
  after: number;
}

/**
 * [SIZE-GUARD] Get a PDF under a byte budget, or say plainly that it cannot.
 *
 * The upload has a hard 10 MB ceiling and the screen already tells people to
 * "splits een grote PDF" — this is what makes that sentence actionable. It is
 * separate from compressImages() because the caller there has one question,
 * "does it fit now", and no interest in dpi.
 *
 * Two passes, and no more: a sensible one first, then a harder one only if the
 * first missed. Grinding further trades readability for bytes on a document
 * somebody has to be able to READ — a bonnetje nobody can make out is worth
 * less than one that needed splitting.
 *
 * Always resolves. A document that cannot get under the budget comes back with
 * `fits: false` and the size it reached, so the screen can say which.
 */
export async function compressToFit(
  file: File,
  maxBytes: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ file: File; fits: boolean; before: number; after: number }> {
  const before = file.size;
  let best: Blob | null = null;

  for (const attempt of [
    { dpi: 150, quality: 0.72 },
    { dpi: 110, quality: 0.58 },
  ]) {
    const result = await compressImages(file, { ...attempt, onProgress });
    // Keep whichever pass got furthest — the harder one is not guaranteed to
    // win, since an image already below the lower ceiling is left alone by both.
    if (!best || result.blob.size < best.size) best = result.blob;
    if (best.size <= maxBytes) break;
  }

  const after = best ? best.size : before;
  // Nothing was gained? Hand back the original rather than a same-sized copy
  // that has quietly lost detail for no reason.
  if (!best || after >= before) {
    return { file, fits: before <= maxBytes, before, after: before };
  }

  return {
    file: new File([best], file.name, { type: "application/pdf" }),
    fits: after <= maxBytes,
    before,
    after,
  };
}

/**
 * Compress a document by rewriting its images.
 *
 * `dpi` is the resolution the images are worth keeping at, judged against the
 * size of the page they could fill.
 */
export async function compressImages(
  file: File,
  {
    dpi = 150,
    quality = 0.72,
    onProgress,
  }: { dpi?: number; quality?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<CompressResult> {
  const { PDFName, PDFRawStream, PDFDict } = await loadPdfLib();
  const doc = await readDocument(file);
  if (!doc.getPageCount()) fail("pdfEmpty", { name: file.name });

  // An image is never worth more pixels than the largest page could show at the
  // chosen resolution. That is a CEILING, not a target: a small logo stays
  // small, and only the oversized scans come down.
  const longestPage = doc.getPages().reduce((longest, page) => {
    const { width, height } = page.getSize();
    return Math.max(longest, width, height);
  }, 0);
  const ceiling = Math.max(200, Math.round((longestPage * dpi) / 72));

  const objects = doc.context.enumerateIndirectObjects();
  const images = objects.filter(
    ([, object]) =>
      object instanceof PDFRawStream &&
      object.dict instanceof PDFDict &&
      name(
        (object.dict.get(PDFName.of("Subtype")) as { toString?: () => string } | undefined)
          ?.toString?.()
      ) === "Image"
  );

  let changed = 0;
  let skipped = 0;
  let before = 0;
  let after = 0;

  for (let at = 0; at < images.length; at++) {
    const [ref, object] = images[at];
    const stream = object as unknown as RawStream;
    onProgress?.(at, images.length);

    const originalSize = stream.getContents().length;
    before += originalSize;

    const decoded = await decodeImage(stream, PDFName);
    if (!decoded) {
      skipped++;
      after += originalSize;
      continue;
    }

    const width = decoded.width as number;
    const height = decoded.height as number;
    const scale = Math.min(1, ceiling / Math.max(width, height));
    const target = {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };

    const bytes = await reEncode(decoded, target.width, target.height, quality);
    decoded.close?.();

    // Only accept a rewrite that actually pays: a JPEG that comes out larger
    // than what was there is a loss of quality for nothing.
    if (!bytes || bytes.length >= originalSize * 0.92) {
      skipped++;
      after += originalSize;
      continue;
    }

    const replacement = doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: target.width,
      Height: target.height,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
      Length: bytes.length,
    });
    doc.context.assign(ref, PDFRawStream.of(replacement as never, bytes));

    changed++;
    after += bytes.length;
  }

  onProgress?.(images.length, images.length);
  const saved = await doc.save({ useObjectStreams: true });

  return {
    blob: new Blob([saved as BlobPart], { type: "application/pdf" }),
    pages: doc.getPageCount(),
    images: images.length,
    changed,
    skipped,
    before,
    after,
  };
}
