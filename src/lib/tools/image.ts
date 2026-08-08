// src/lib/tools/image.ts
// [PDF-TOOLS] Image work, in the browser.
//
// Everything the image tools need sits here so each page stays a thin layer of
// choices over a shared core: load a file, put it on a canvas at the size you
// want, encode it back out. Nothing is uploaded — a canvas is the whole engine,
// and a bonnetje photographed on a phone never leaves it.
//
// NB: src/lib/ai.ts downscales invoice photos with `sharp` on the SERVER before
// sending them to Claude. That is a different job in a different place; these
// two must not be merged.

import { ToolError } from "./errors";

export const MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type ImageMime = (typeof MIME)[keyof typeof MIME];

export const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
};

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Swap a filename's extension, keeping the rest of the name intact. */
export function renameExtension(name: string, extension: string): string {
  const base = String(name || "afbeelding").replace(/\.[^.]+$/, "");
  return `${base}.${extension}`;
}

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  revoke?: () => void;
}

/**
 * Decode a file into something drawable.
 *
 * `createImageBitmap` is the fast path and the only one that applies EXIF
 * orientation, so a receipt photographed sideways does not come out sideways.
 * An <img> covers what it refuses, SVG among them.
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    /* fall through to the <img> path */
  }

  const url = URL.createObjectURL(file);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ToolError("notAnImage", { name: file.name }));
      img.src = url;
    });
    return {
      source: element,
      width: element.naturalWidth || element.width,
      height: element.naturalHeight || element.height,
      revoke: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export type Fit = "contain" | "cover" | "stretch";

/**
 * Work out the drawing rectangle for a target box.
 *
 * `contain` keeps the whole picture and pads; `cover` fills the box and trims
 * the overflow evenly; `stretch` ignores the ratio.
 */
export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: Fit = "contain"
): { x: number; y: number; width: number; height: number } {
  if (fit === "stretch") return { x: 0, y: 0, width: boxWidth, height: boxHeight };

  const scale =
    fit === "cover"
      ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);

  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  return {
    x: Math.round((boxWidth - width) / 2),
    y: Math.round((boxHeight - height) / 2),
    width,
    height,
  };
}

/** Scale to fit inside a box without ever enlarging beyond the original. */
export function scaleWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Draw an image onto a fresh canvas of the given size. */
export function render(
  image: LoadedImage,
  {
    width,
    height,
    fit = "contain",
    background = "",
  }: { width: number; height: number; fit?: Fit; background?: string }
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ToolError("canvasBlocked");

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const rect = fitRect(image.width, image.height, canvas.width, canvas.height, fit);
  ctx.drawImage(image.source, rect.x, rect.y, rect.width, rect.height);
  return canvas;
}

export function encode(
  canvas: HTMLCanvasElement,
  mime: string = MIME.jpeg,
  quality = 0.82
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ToolError("encodeFailed"))),
      mime,
      mime === MIME.png ? undefined : quality
    );
  });
}

/** Does this browser actually produce the format it was asked for? */
export function supportsType(mime: string): boolean {
  if (typeof document === "undefined") return false;
  const canvas = makeCanvas(1, 1);
  return canvas.toDataURL(mime).startsWith(`data:${mime}`);
}

export interface BudgetResult {
  blob: Blob;
  quality: number;
  width: number;
  height: number;
  passes: number;
}

/**
 * Squeeze a file under a size budget by lowering quality, then dimensions.
 *
 * Quality goes first because it costs the least visible detail; only when that
 * is exhausted does the picture actually get smaller. The pass counters are
 * there so a pathological input cannot spin: twelve tries on quality, eight
 * more on size, then whatever it got to.
 */
export async function compressToBudget(
  image: LoadedImage,
  {
    mime = MIME.jpeg as string,
    maxBytes = 0,
    minQuality = 0.4,
    startQuality = 0.85,
    maxWidth = 0,
  } = {}
): Promise<BudgetResult> {
  let width = image.width;
  let height = image.height;
  if (maxWidth && width > maxWidth) {
    const scaled = scaleWithin(width, height, maxWidth, Number.MAX_SAFE_INTEGER);
    width = scaled.width;
    height = scaled.height;
  }

  const base = mime === MIME.jpeg ? "#ffffff" : "";
  let quality = startQuality;
  let passes = 0;

  let blob = await encode(render(image, { width, height, background: base }), mime, quality);
  passes++;

  if (!maxBytes) return { blob, quality, width, height, passes };

  while (blob.size > maxBytes && quality > minQuality && passes < 12) {
    quality = Math.max(minQuality, quality - 0.08);
    blob = await encode(render(image, { width, height, background: base }), mime, quality);
    passes++;
  }

  while (blob.size > maxBytes && width > 320 && passes < 20) {
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    blob = await encode(render(image, { width, height, background: base }), mime, quality);
    passes++;
  }

  return { blob, quality, width, height, passes };
}

// ---------------------------------------------------------------------------
// Favicons
// ---------------------------------------------------------------------------

export interface IcoEntry {
  size: number;
  bytes: Uint8Array;
}

/**
 * Pack PNGs into an .ico.
 *
 * The format is a small directory followed by the payloads; modern icons are
 * allowed to be PNG rather than BMP, which keeps this to a header and some
 * offsets. A size of 256 is written as 0, which is how the format says "256".
 */
export function buildIco(entries: IcoEntry[]): Blob {
  const header = 6;
  const directory = 16 * entries.length;
  let offset = header + directory;

  const total = entries.reduce((sum, entry) => sum + entry.bytes.length, offset);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon
  view.setUint16(4, entries.length, true);

  entries.forEach((entry, i) => {
    const at = header + i * 16;
    out[at] = entry.size >= 256 ? 0 : entry.size;
    out[at + 1] = entry.size >= 256 ? 0 : entry.size;
    out[at + 2] = 0; // palette
    out[at + 3] = 0; // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, entry.bytes.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(entry.bytes, offset);
    offset += entry.bytes.length;
  });

  return new Blob([out], { type: "image/x-icon" });
}

export const FAVICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512];

/**
 * The sizes people actually have to hit, grouped by where they post.
 *
 * Kept because a ZZP'er with a webshop or a Instagram-account posts as often as
 * he invoices, and "welk formaat moet dit zijn" is a real question with a
 * boring answer.
 */
export const SOCIAL_PRESETS = [
  {
    group: "Instagram",
    items: [
      { label: "Post (vierkant)", width: 1080, height: 1080 },
      { label: "Post (staand)", width: 1080, height: 1350 },
      { label: "Verhaal / Reel", width: 1080, height: 1920 },
    ],
  },
  {
    group: "Facebook",
    items: [
      { label: "Bericht", width: 1200, height: 630 },
      { label: "Omslagfoto", width: 1640, height: 856 },
      { label: "Verhaal", width: 1080, height: 1920 },
    ],
  },
  {
    group: "LinkedIn",
    items: [
      { label: "Bericht", width: 1200, height: 627 },
      { label: "Omslagfoto", width: 1584, height: 396 },
      { label: "Profielfoto", width: 400, height: 400 },
    ],
  },
  {
    group: "X / Twitter",
    items: [
      { label: "Bericht", width: 1600, height: 900 },
      { label: "Headerfoto", width: 1500, height: 500 },
    ],
  },
  {
    group: "YouTube",
    items: [
      { label: "Thumbnail", width: 1280, height: 720 },
      { label: "Kanaalbanner", width: 2560, height: 1440 },
    ],
  },
  {
    group: "Web",
    items: [
      { label: "Open Graph", width: 1200, height: 630 },
      { label: "E-mail header", width: 600, height: 200 },
    ],
  },
];
