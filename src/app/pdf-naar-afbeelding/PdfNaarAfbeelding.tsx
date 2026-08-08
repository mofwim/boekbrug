// src/app/pdf-naar-afbeelding/PdfNaarAfbeelding.tsx
// [PDF-TOOLS] The interactive half of /pdf-naar-afbeelding.
"use client";

import { useCallback, useState } from "react";
import {
  Actions,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  Segmented,
  Slider,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import { parsePageRange } from "@/lib/tools/pdf";
import { openDocument, pageToBlob } from "@/lib/tools/pdfjs";
import { makeZip, uniqueNames } from "@/lib/tools/zip";

interface Shot {
  name: string;
  blob: Blob;
  url: string;
  number: number;
}

export default function PdfNaarAfbeelding() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [dpi, setDpi] = useState<"72" | "150" | "300">("150");
  const [format, setFormat] = useState<"image/jpeg" | "image/png">("image/jpeg");
  const [quality, setQuality] = useState(88);
  const [range, setRange] = useState("");
  const [images, setImages] = useState<Shot[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setImages([]);
    setRange("");
    try {
      const reader = await openDocument(picked[0]);
      setPages(reader.numPages);
      setFile(picked[0]);
      await reader.loadingTask.destroy();
    } catch (err) {
      setFile(null);
      setPages(0);
      setError(describeError(err));
    }
  }, []);

  const run = useCallback(async () => {
    if (!file) return;
    setError("");
    setImages([]);

    // Object URLs from an earlier run are released before the next one starts,
    // so a few passes over a long document do not quietly hold every page.
    images.forEach((image) => URL.revokeObjectURL(image.url));

    const wanted = range.trim()
      ? parsePageRange(range, pages)
      : Array.from({ length: pages }, (_, i) => i);
    if (!wanted.length) {
      setError("Die pagina's bestaan niet in dit document.");
      return;
    }

    let reader = null;
    try {
      reader = await openDocument(file);
      const base = file.name.replace(/\.pdf$/i, "");
      const extension = format === "image/png" ? "png" : "jpg";
      const made: Shot[] = [];

      for (let at = 0; at < wanted.length; at++) {
        const number = wanted[at] + 1;
        setProgress({ done: at, total: wanted.length });
        const blob = await pageToBlob(reader, number, {
          dpi: Number(dpi),
          mime: format,
          quality: quality / 100,
        });
        made.push({
          name: `${base}-${String(number).padStart(String(pages).length, "0")}.${extension}`,
          blob,
          url: URL.createObjectURL(blob),
          number,
        });
      }
      setImages(made);
    } catch (err) {
      setError(describeError(err));
    } finally {
      await reader?.loadingTask.destroy();
      setProgress(null);
    }
  }, [file, pages, range, dpi, format, quality, images]);

  const saveZip = useCallback(async () => {
    if (!file) return;
    const names = uniqueNames(images.map((image) => image.name));
    const zip = await makeZip(images.map((image, at) => ({ name: names[at], data: image.blob })));
    download(`${file.name.replace(/\.pdf$/i, "")}.zip`, zip);
  }, [images, file]);

  const totalSize = images.reduce((sum, image) => sum + image.blob.size, 0);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="image"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {error && <Note kind="error">{error}</Note>}

      {file && (
        <Panel title={`${file.name} · ${pages} pagina${pages === 1 ? "" : "'s"}`}>
          <Field label="Resolutie" hint="150 dpi is prima om te bekijken; 300 dpi als het gedrukt wordt.">
            <Segmented
              label="Resolutie"
              value={dpi}
              onChange={setDpi}
              options={[
                { value: "72", label: "72 dpi" },
                { value: "150", label: "150 dpi" },
                { value: "300", label: "300 dpi" },
              ]}
            />
          </Field>

          <Field label="Formaat">
            <Segmented
              label="Formaat"
              value={format}
              onChange={setFormat}
              options={[
                { value: "image/jpeg", label: "JPG" },
                { value: "image/png", label: "PNG" },
              ]}
            />
          </Field>

          {format === "image/jpeg" && (
            <Field label="Kwaliteit">
              <Slider value={quality} onChange={setQuality} min={50} max={100} suffix="%" />
            </Field>
          )}

          <Field label="Welke pagina's" hint="Bijvoorbeeld 1-3, 7, 12- . Leeg is alles.">
            {(id) => (
              <input
                id={id}
                type="text"
                value={range}
                onChange={(event) => setRange(event.target.value)}
                placeholder="alle pagina's"
                inputMode="numeric"
              />
            )}
          </Field>

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(progress)}
            >
              {progress ? `Bezig — ${progress.done} van ${progress.total}` : "Omzetten"}
            </button>
          </Actions>
        </Panel>
      )}

      {images.length > 0 && (
        <Panel title="Resultaat">
          <Note kind="ok">
            {images.length} afbeelding{images.length === 1 ? "" : "en"} — samen{" "}
            {formatBytes(totalSize)}.
          </Note>

          <ul className="tp-shots">
            {images.map((image) => (
              <li key={image.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`Pagina ${image.number}`} loading="lazy" />
                <span>{image.number}</span>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => download(image.name, image.blob)}
                >
                  <Icon name="download" size={14} /> Opslaan
                </button>
              </li>
            ))}
          </ul>

          <Actions>
            <button type="button" className="btn btn-primary" onClick={saveZip}>
              <Icon name="download" size={16} /> Alles als zip ({formatBytes(totalSize)})
            </button>
          </Actions>
        </Panel>
      )}
    </>
  );
}
