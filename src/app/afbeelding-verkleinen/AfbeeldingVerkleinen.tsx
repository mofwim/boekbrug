// src/app/afbeelding-verkleinen/AfbeeldingVerkleinen.tsx
// [PDF-TOOLS] The interactive half of /afbeelding-verkleinen.
"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
import {
  MIME,
  compressToBudget,
  loadImage,
  renameExtension,
  supportsType,
  type LoadedImage,
} from "@/lib/tools/image";

/**
 * Budgets people are actually held to, not round numbers for their own sake.
 * The upload limits on portals and e-mail are what this exists for.
 */
const BUDGETS = [
  { value: "0", label: "Vrij" },
  { value: String(250 * 1024), label: "250 kB" },
  { value: String(1024 * 1024), label: "1 MB" },
  { value: String(2 * 1024 * 1024), label: "2 MB" },
  { value: String(5 * 1024 * 1024), label: "5 MB" },
];

interface Result {
  blob: Blob;
  url: string;
  used: number;
  width: number;
  height: number;
  missed: boolean;
}

export default function AfbeeldingVerkleinen() {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [budget, setBudget] = useState(String(1024 * 1024));
  const [quality, setQuality] = useState(82);
  const [maxWidth, setMaxWidth] = useState(2400);
  const [format, setFormat] = useState<string>(MIME.jpeg);

  /**
   * Whether this browser really produces WebP.
   *
   * It has to be asked, not assumed: canvas.toBlob() silently hands back a PNG
   * when it does not know the format, so offering the option blindly would
   * produce a file called .webp that is not one.
   *
   * useSyncExternalStore rather than an effect — the value never changes, and
   * this is the one shape that can differ between the server render (where
   * there is no canvas) and the client without either tripping the
   * cascading-render rule or causing a hydration mismatch.
   */
  const webpOk = useSyncExternalStore(
    () => () => {},
    () => supportsType(MIME.webp),
    () => false
  );

  // Object URLs are handed to <img>; release them when they go out of use.
  useEffect(() => () => void (result?.url && URL.revokeObjectURL(result.url)), [result]);

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setResult(null);
    try {
      const loaded = await loadImage(picked[0]);
      setFile(picked[0]);
      setImage(loaded);
    } catch (err) {
      setFile(null);
      setImage(null);
      setError(describeError(err));
    }
  }, []);

  const run = useCallback(async () => {
    if (!image) return;
    setBusy(true);
    setError("");
    try {
      const bytes = Number(budget);
      const { blob, quality: used, width, height } = await compressToBudget(image, {
        mime: format,
        maxBytes: bytes,
        startQuality: quality / 100,
        maxWidth: maxWidth || 0,
      });
      setResult((previous) => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return {
          blob,
          url: URL.createObjectURL(blob),
          used: Math.round(used * 100),
          width,
          height,
          missed: bytes > 0 && blob.size > bytes,
        };
      });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [image, format, budget, quality, maxWidth]);

  const saved = result && file ? 1 - result.blob.size / file.size : 0;
  const extension = format === MIME.png ? "png" : format === MIME.webp ? "webp" : "jpg";

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="image/*"
        icon="image"
        paste
        title="Sleep een afbeelding hierheen"
        hint="of plak er een — een schermafdruk mag ook"
      />

      {error && <Note kind="error">{error}</Note>}

      {image && file && (
        <>
          <Panel title="Instellingen">
            <Field
              label="Maximale grootte"
              hint="De tool zakt met kwaliteit, en pas daarna met afmetingen, tot hij eronder komt."
            >
              <Segmented
                label="Maximale grootte"
                value={budget}
                onChange={setBudget}
                options={BUDGETS}
              />
            </Field>

            <Field label="Startkwaliteit">
              <Slider value={quality} onChange={setQuality} min={30} max={95} suffix="%" />
            </Field>

            <Field label="Maximale breedte" hint="In pixels. 0 laat de afmetingen zoals ze zijn.">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  value={maxWidth}
                  onChange={(event) => setMaxWidth(Number(event.target.value))}
                />
              )}
            </Field>

            <Field label="Formaat">
              <Segmented
                label="Formaat"
                value={format}
                onChange={setFormat}
                options={[
                  { value: MIME.jpeg as string, label: "JPG" },
                  ...(webpOk ? [{ value: MIME.webp as string, label: "WebP" }] : []),
                  { value: MIME.png as string, label: "PNG" },
                ]}
              />
            </Field>

            <Actions>
              <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
                {busy ? "Bezig…" : "Verkleinen"}
              </button>
            </Actions>
          </Panel>

          {result && (
            <Panel>
              {result.missed ? (
                <Note kind="warn">
                  Onder die grens komen lukte niet zonder de afbeelding onherkenbaar te maken. Dit
                  is zo klein als het verantwoord kon — zet de maximale breedte lager als het echt
                  kleiner moet.
                </Note>
              ) : (
                <Note kind="ok">
                  {saved > 0.02
                    ? `${Math.round(saved * 100)}% kleiner — van ${formatBytes(file.size)} naar ${formatBytes(result.blob.size)}.`
                    : `Deze afbeelding was al klein. Hij blijft ${formatBytes(result.blob.size)}.`}
                </Note>
              )}

              <dl className="tp-stat">
                <div>
                  <dt>Was</dt>
                  <dd>{formatBytes(file.size)}</dd>
                </div>
                <div>
                  <dt>Wordt</dt>
                  <dd className={saved > 0.02 ? "tp-win" : ""}>{formatBytes(result.blob.size)}</dd>
                </div>
                <div>
                  <dt>Afmeting</dt>
                  <dd>
                    {result.width}×{result.height}
                  </dd>
                </div>
                <div>
                  <dt>Kwaliteit</dt>
                  <dd>{result.used}%</dd>
                </div>
              </dl>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="tp-preview" src={result.url} alt="Het resultaat" />

              <Actions>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => download(renameExtension(file.name, extension), result.blob)}
                >
                  <Icon name="download" size={16} /> Opslaan
                </button>
              </Actions>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
