// src/app/afbeeldingen-uit-pdf/AfbeeldingenUitPdf.tsx
// [PDF-TOOLS] The interactive half of /afbeeldingen-uit-pdf.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Actions, FileDrop, Icon, Note, Panel, download, formatBytes } from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import { openDocument, pageImages } from "@/lib/tools/pdfjs";
import { makeZip, uniqueNames } from "@/lib/tools/zip";

interface Found {
  blob: Blob;
  width: number;
  height: number;
  name: string;
  url: string;
}

export default function AfbeeldingenUitPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<Found[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => images.forEach((image) => URL.revokeObjectURL(image.url)), [images]);

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setImages([]);
    setFile(picked[0]);

    let reader = null;
    try {
      reader = await openDocument(picked[0]);
      const found: Found[] = [];
      for (let number = 1; number <= reader.numPages; number++) {
        setProgress({ done: number - 1, total: reader.numPages });
        for (const image of await pageImages(reader, number)) {
          found.push({
            ...image,
            name: `${picked[0].name.replace(/\.pdf$/i, "")}-p${number}-${found.length + 1}.png`,
            url: URL.createObjectURL(image.blob),
          });
        }
      }
      setImages(found);
    } catch (err) {
      setFile(null);
      setError(describeError(err));
    } finally {
      await reader?.loadingTask.destroy();
      setProgress(null);
    }
  }, []);

  const saveZip = useCallback(async () => {
    if (!file) return;
    const names = uniqueNames(images.map((image) => image.name));
    const zip = await makeZip(images.map((image, at) => ({ name: names[at], data: image.blob })));
    download(`${file.name.replace(/\.pdf$/i, "")}-afbeeldingen.zip`, zip);
  }, [images, file]);

  const total = images.reduce((sum, image) => sum + image.blob.size, 0);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="image"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {progress && (
        <Note kind="ok">
          Bezig met zoeken — pagina {progress.done} van {progress.total}
        </Note>
      )}
      {error && <Note kind="error">{error}</Note>}
      {file && !progress && !images.length && !error && (
        <Note kind="warn">
          Er zitten geen losse afbeeldingen in dit document. Bij een scan is de hele pagina één
          afbeelding — gebruik daarvoor &lsquo;PDF naar JPG&rsquo;.
        </Note>
      )}

      {images.length > 0 && (
        <Panel title="Gevonden">
          <Note kind="ok">
            {images.length} afbeelding{images.length === 1 ? "" : "en"} — samen{" "}
            {formatBytes(total)}.
          </Note>
          <p className="tp-hint">
            Dit zijn de afbeeldingen zoals ze in het document zitten, op hun eigen resolutie — niet
            de pagina&apos;s zelf.
          </p>

          <ul className="tp-shots">
            {images.map((image) => (
              <li key={image.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" loading="lazy" />
                <span>
                  {image.width}×{image.height} · {formatBytes(image.blob.size)}
                </span>
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

          {images.length > 1 && (
            <Actions>
              <button type="button" className="btn btn-primary" onClick={saveZip}>
                <Icon name="download" size={16} /> Alles als zip
              </button>
            </Actions>
          )}
        </Panel>
      )}
    </>
  );
}
