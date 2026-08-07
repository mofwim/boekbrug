// src/lib/tools/zip.ts
// [PDF-TOOLS] One download instead of forty.
//
// Forty pages exported as forty separate downloads is not a result, it is a
// chore — and browsers throttle them anyway.
//
// [PDF-LAZY] jszip is on the HEAVY list in bundle-weight-gates.test.ts, and
// these are public pages aimed at a stranger on a phone. It is imported inside
// the function rather than at the top, so a visitor who opens a tool and never
// exports anything never downloads the compressor. Same reasoning, same shape,
// as the deferral around @react-pdf on /factuur-maken.

export interface ZipEntry {
  name: string;
  data: Blob | Uint8Array | string;
}

/**
 * Everything is STORED, not deflated.
 *
 * The contents are JPEGs, PNGs and PDFs, which are already compressed. Running
 * deflate over them costs a second of somebody's time to save about a percent,
 * on a phone, while they wait.
 */
export async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  for (const entry of entries) {
    zip.file(entry.name, entry.data);
  }

  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

/**
 * Names inside an archive: no separators, no duplicates, nothing surprising.
 *
 * A path separator in a name is how an archive ends up with folders nobody
 * asked for, and two pages called "pagina-1.jpg" is how one of them vanishes.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();

  return names.map((raw) => {
    const clean = String(raw || "bestand")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 100);

    const count = seen.get(clean) || 0;
    seen.set(clean, count + 1);
    if (!count) return clean;

    const dot = clean.lastIndexOf(".");
    return dot > 0
      ? `${clean.slice(0, dot)}-${count + 1}${clean.slice(dot)}`
      : `${clean}-${count + 1}`;
  });
}
