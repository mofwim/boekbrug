// src/app/afbeelding-omzetten/AfbeeldingOmzetten.tsx
// [PDF-TOOLS] The interactive half of /afbeelding-omzetten.
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Actions,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  ResultFile,
  Segmented,
  Slider,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import {
  EXTENSION,
  MIME,
  encode,
  loadImage,
  render,
  renameExtension,
  supportsType,
} from "@/lib/tools/image";
import { makeZip, uniqueNames } from "@/lib/tools/zip";

interface Converted {
  name: string;
  was: number;
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

export default function AfbeeldingOmzetten() {
  // The pictures as they were dropped, kept so a change of format can be
  // answered by converting them again rather than by asking for them again.
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Converted[]>([]);
  const [chosen, setFormat] = useState<string>(MIME.webp);
  const [quality, setQuality] = useState(85);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const webpOk = useSyncExternalStore(
    () => () => {},
    () => supportsType(MIME.webp),
    () => false
  );

  // A browser that cannot make WebP falls back to JPG — derived rather than
  // corrected in an effect, which would cost a second render to reach the same
  // answer that is already knowable here.
  const format = webpOk || chosen !== MIME.webp ? chosen : (MIME.jpeg as string);

  useEffect(() => () => items.forEach((item) => URL.revokeObjectURL(item.url)), [items]);

  /**
   * Convert whenever the pictures or the settings change.
   *
   * This used to run once, on drop, against whatever the settings happened to
   * be — so changing the format afterwards did nothing at all, and the drop
   * zone had to carry the instruction "pick the format first". Deciding before
   * you can see anything is the wrong way round; now the answer follows the
   * question, and the settings sit under the result where they belong.
   */
  useEffect(() => {
    // Nothing dropped means nothing to show, which is derived at the use site
    // rather than written into state here.
    if (!files.length) return undefined;

    // Settings can change faster than a large picture encodes, so a superseded
    // run must not overwrite a newer one — nor leak the blobs it already made.
    let live = true;

    (async () => {
      setBusy(true);
      const out: Converted[] = [];
      for (const file of files) {
        try {
          const image = await loadImage(file);
          // JPEG has no transparency; without a white base it comes out black.
          const canvas = render(image, {
            width: image.width,
            height: image.height,
            fit: "stretch",
            background: format === MIME.jpeg ? "#ffffff" : "",
          });
          const blob = await encode(canvas, format, quality / 100);
          out.push({
            name: renameExtension(file.name, EXTENSION[format] || "img"),
            was: file.size,
            blob,
            url: URL.createObjectURL(blob),
            width: image.width,
            height: image.height,
          });
        } catch (err) {
          if (live) setError(`${file.name}: ${describeError(err)}`);
        }
      }

      if (!live) {
        out.forEach((item) => URL.revokeObjectURL(item.url));
        return;
      }
      setItems(out);
      setBusy(false);
    })();

    return () => {
      live = false;
    };
  }, [files, format, quality]);

  // Stale results from a previous drop never survive a clear.
  const shown = files.length ? items : [];

  return (
    <>
      {/* The one thing to do, first and alone. This page used to open with a
          format picker and a quality slider for a picture that did not exist
          yet — five controls where every other tool opens with one drop zone. */}
      <FileDrop
        onFiles={setFiles}
        accept="image/*"
        multiple
        icon="shuffle"
        paste
        title="Sleep je afbeeldingen hierheen"
        hint="meerdere tegelijk mag — het formaat kies je hierna"
      />

      {files.length > 0 && (
        <Panel title="Waar naartoe">
          <Field label="Formaat">
            <Segmented
              label="Formaat"
              value={format}
              onChange={setFormat}
              options={[
                ...(webpOk ? [{ value: MIME.webp as string, label: "WebP" }] : []),
                { value: MIME.jpeg as string, label: "JPG" },
                { value: MIME.png as string, label: "PNG" },
              ]}
            />
          </Field>
          {format !== MIME.png && (
            <Field label="Kwaliteit">
              <Slider value={quality} onChange={setQuality} min={40} max={100} suffix="%" />
            </Field>
          )}
          {!webpOk && (
            <Note kind="warn">Deze browser maakt geen WebP. JPG en PNG werken wel.</Note>
          )}
        </Panel>
      )}

      {busy && <Note kind="ok">Bezig met omzetten…</Note>}
      {error && <Note kind="error">{error}</Note>}

      {shown.length > 0 && (
        <Panel title={`${shown.length} klaar`}>
          <ul className="tp-rows">
            {shown.map((item, i) => (
              <ResultFile
                key={`${item.name}-${i}`}
                name={item.name}
                blob={item.blob}
                previewUrl={item.url}
                meta={`${item.width}×${item.height} · ${formatBytes(item.was)} → ${formatBytes(item.blob.size)}`}
              />
            ))}
          </ul>
          {shown.length > 1 && (
            <Actions>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const names = uniqueNames(shown.map((item) => item.name));
                  const zip = await makeZip(
                    shown.map((item, at) => ({ name: names[at], data: item.blob }))
                  );
                  download("afbeeldingen.zip", zip);
                }}
              >
                <Icon name="download" size={16} /> Alles als zip
              </button>
            </Actions>
          )}
        </Panel>
      )}
    </>
  );
}
