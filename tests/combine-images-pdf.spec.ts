// tests/combine-images-pdf.spec.ts
// [MULTI-PAGE-FIT] The one piece of this app that cannot be tested with `npx tsx`.
//
// combineImagesToPdf turns the photographed pages of ONE paper invoice into a single PDF in the
// BROWSER, and it is the only thing standing between "Factuur met meerdere pagina's" and an upload
// the server refuses. It runs on createImageBitmap, <canvas> and document — none of which exist in
// Node, which is why the escalation ladder it contains shipped with no test at all and had to be
// reasoned about instead of run.
//
// A browser is exactly what Playwright has. So: bundle the real module (no copy, no stub — esbuild
// resolves pdf-lib and ./image-normalize-client the same way Next does), inject it into a blank
// page, build real JPEGs there, and assert on the bytes that come out.
//
// What is worth locking down, and why each case exists:
//   1. N images in → a PDF of N pages. The plain promise of the button.
//   2. A set that would blow past the cap comes back UNDER it. This is the regression test: pages
//      used to be embedded at their original size with no bound, so three phone photos already
//      exceeded the server's 10 MB limit — and the sheet then re-offered the same pages, so every
//      retry failed identically, forever.
//   3. When they genuinely cannot be made to fit, it THROWS with a sentence that names the real
//      problem (too many pages) rather than letting the server answer "Bestand te groot".
//   4. An undecodable page names ITS page number, so the owner knows which photo to redo.
//   5. Small originals are passed through LOSSLESSLY — the quality discipline for a document with
//      a seven-year retention is not silently traded away by the ladder that was added for size.
//
// Run: npx playwright test --project=chromium tests/combine-images-pdf.spec.ts
//      (browsers via `npx playwright install chromium`, or set PW_CHROMIUM_PATH — see below)

import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

// Default: whatever `npx playwright install` put in place — the ordinary developer path, nothing
// to configure. PW_CHROMIUM_PATH is the escape hatch for an image that already ships a Chromium
// (a CI runner, a sandbox) whose build number does not match the one this Playwright pins; without
// it the run dies on "Executable doesn't exist" for a browser that is sitting right there. Also
// asks for the full browser rather than the headless shell, which is the build these APIs
// (createImageBitmap, canvas.toBlob) are exercised against.
const CHROMIUM = process.env.PW_CHROMIUM_PATH;
test.use(
  CHROMIUM
    ? { launchOptions: { executablePath: CHROMIUM } }
    : { channel: 'chromium' },
);

/** Bundle the REAL module into one IIFE that hangs its export on window. */
async function bundleCombiner(): Promise<string> {
  const result = await build({
    stdin: {
      contents: `
        import { combineImagesToPdf } from './src/lib/combine-images-pdf';
        window.__combine = combineImagesToPdf;
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    // The module is written for a browser; keep esbuild from shimming anything away.
    target: 'es2020',
  });
  return result.outputFiles[0].text;
}

/**
 * Make a JPEG in the page. `noise` matters: a flat colour compresses to almost nothing, so only
 * random pixels produce a file with the bulk of a real photo — which is the whole point of the
 * size cases below.
 */
const MAKE_FILE = `
  window.__makeJpeg = async (name, size, noise) => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    let seed = 42;
    for (let i = 0; i < img.data.length; i += 4) {
      // A deterministic LCG — the same test must not become flaky because a random photo
      // happened to compress better on one run than the next.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = noise ? (seed >> 8) & 0xff : 200;
      img.data[i] = v; img.data[i + 1] = (v * 7) & 0xff; img.data[i + 2] = (v * 13) & 0xff;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.95));
    return new File([blob], name, { type: 'image/jpeg' });
  };
`;

test.describe('combineImagesToPdf', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: await bundleCombiner() });
    await page.addScriptTag({ content: MAKE_FILE });
  });

  test('N photos become one PDF of N pages', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const files = [];
      for (let i = 0; i < 4; i++) files.push(await window.__makeJpeg(`p${i}.jpg`, 400, false));
      const pdf = await window.__combine(files);
      return { name: pdf.name, type: pdf.type, bytes: Array.from(new Uint8Array(await pdf.arrayBuffer())) };
    });

    expect(out.type).toBe('application/pdf');
    expect(out.name).toMatch(/\.pdf$/);
    const doc = await PDFDocument.load(Uint8Array.from(out.bytes));
    expect(doc.getPageCount()).toBe(4);
  });

  test('a set that would overflow the real cap comes back under it', async ({ page }) => {
    // Deliberately generous: this case builds a ~15 MB PDF, measures it, then decodes and
    // re-encodes six 1600px images to build a second one. That is real work — it is what the
    // owner's phone does when they combine a six-page invoice — and it does not fit the default
    // 30s. Slow here is honest, not a smell.
    test.setTimeout(180_000);
    // THE regression test, run against the ACTUAL production limit — no synthetic cap. Six 1600px
    // photos measure ~15.7 MB as originals, which is the shape of a real multi-page invoice shot on
    // a phone. The old combiner embedded them at that size and handed the server a file it refuses
    // (MAX_BYTES = 10 MB in /api/intake), then the sheet re-offered the same pages so every retry
    // failed identically. Passing here means the escalation ladder measured the produced PDF and
    // re-encoded until it fit — the whole point of it existing.
    const CAP = 10 * 1024 * 1024; // /api/intake MAX_BYTES, via MAX_INTAKE_UPLOAD_BYTES
    const out = await page.evaluate(async () => {
      const files = [];
      for (let i = 0; i < 6; i++) files.push(await window.__makeJpeg(`p${i}.jpg`, 1600, true));
      const originalTotal = files.reduce((s, f) => s + f.size, 0);
      const pdf = await window.__combine(files); // default maxBytes — the real one
      return {
        originalTotal,
        size: pdf.size,
        bytes: Array.from(new Uint8Array(await pdf.arrayBuffer())),
      };
    });

    // The premise: these originals really would have been refused by the server.
    expect(out.originalTotal).toBeGreaterThan(CAP);
    // …and what came out is a file the upload accepts.
    expect(out.size).toBeLessThanOrEqual(CAP);
    // Proof the ladder actually re-encoded rather than getting lucky: the PDF is materially
    // smaller than the bytes that went in.
    expect(out.size).toBeLessThan(out.originalTotal);
    // Not achieved by dropping pages — that is the one trade this must never make.
    const doc = await PDFDocument.load(Uint8Array.from(out.bytes));
    expect(doc.getPageCount()).toBe(6);
  });

  test('when they truly cannot fit it says so, naming the real problem', async ({ page }) => {
    const err = await page.evaluate(async () => {
      const files = [];
      for (let i = 0; i < 8; i++) files.push(await window.__makeJpeg(`p${i}.jpg`, 1200, true));
      try {
        // A cap no eight-page document can meet, even at the tightest tier.
        await window.__combine(files, 'factuur.pdf', 20_000);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(err).not.toBeNull();
    // It must name the page count and the limit — "Bestand te groot" from the server would leave
    // the owner with nothing to change.
    expect(err).toMatch(/Deze 8 pagina/);
    expect(err).toMatch(/minder pagina|splits/i);
  });

  test('an undecodable page names its own page number', async ({ page }) => {
    const err = await page.evaluate(async () => {
      const ok = await window.__makeJpeg('good.jpg', 300, false);
      const junk = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.jpg', { type: 'image/jpeg' });
      try {
        await window.__combine([ok, junk, ok]);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(err).not.toBeNull();
    // Page 2, not "something went wrong" — the owner has to know which photo to retake.
    expect(err).toMatch(/Pagina 2/);
  });

  test('small originals are embedded losslessly, not re-encoded', async ({ page }) => {
    // The ladder exists for size. It must not cost quality when size was never a problem: a set
    // that fits has to take the lossless path, and the proof is that the original JPEG bytes are
    // present verbatim inside the PDF.
    const out = await page.evaluate(async () => {
      const files = [await window.__makeJpeg('a.jpg', 500, true), await window.__makeJpeg('b.jpg', 500, true)];
      const first = Array.from(new Uint8Array((await files[0].arrayBuffer()).slice(0, 64)));
      const pdf = await window.__combine(files);
      return { first, bytes: Array.from(new Uint8Array(await pdf.arrayBuffer())) };
    });

    const haystack = Buffer.from(Uint8Array.from(out.bytes));
    const needle = Buffer.from(Uint8Array.from(out.first));
    expect(haystack.includes(needle)).toBe(true);
  });
});

declare global {
  interface Window {
    __combine: (files: File[], outName?: string, maxBytes?: number) => Promise<File>;
    __makeJpeg: (name: string, size: number, noise: boolean) => Promise<File>;
  }
}
