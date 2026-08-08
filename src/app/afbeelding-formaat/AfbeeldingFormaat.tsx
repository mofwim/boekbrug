// src/app/afbeelding-formaat/AfbeeldingFormaat.tsx
// [PDF-TOOLS] The interactive half of /afbeelding-formaat.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Actions,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  Segmented,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { describeError } from "@/lib/tools/errors";
import {
  MIME,
  SOCIAL_PRESETS,
  encode,
  loadImage,
  render,
  renameExtension,
  type Fit,
  type LoadedImage,
} from "@/lib/tools/image";

export default function AfbeeldingFormaat() {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [preset, setPreset] = useState("1200x630");
  const [fit, setFit] = useState<Fit>("cover");
  const [background, setBackground] = useState("#ffffff");
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");

  const [width, height] = preset.split("x").map(Number);

  useEffect(() => () => void (result?.url && URL.revokeObjectURL(result.url)), [result]);

  const take = useCallback(async (picked: File[]) => {
    setError("");
    try {
      const loaded = await loadImage(picked[0]);
      setFile(picked[0]);
      setImage(loaded);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  // Re-render whenever a choice changes: the preview IS the product here, so
  // there is nothing to press. The work happens in an async callback rather
  // than synchronously, which is also what keeps it off the render path.
  useEffect(() => {
    if (!image) return undefined;
    let cancelled = false;

    (async () => {
      const canvas = render(image, {
        width,
        height,
        fit,
        background: fit === "cover" ? "" : background,
      });
      const blob = await encode(canvas, MIME.jpeg, 0.9);
      if (cancelled) return;
      setResult((previous) => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [image, width, height, fit, background]);

  const label = useMemo(() => {
    for (const group of SOCIAL_PRESETS) {
      const hit = group.items.find((item) => `${item.width}x${item.height}` === preset);
      if (hit) return `${group.group} · ${hit.label}`;
    }
    return preset;
  }, [preset]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="image/*"
        icon="crop"
        paste
        title="Sleep een afbeelding hierheen"
        hint="of plak er een"
      />

      {error && <Note kind="error">{error}</Note>}

      {image && file && (
        <>
          <Panel title="Formaat">
            <Field label="Waarvoor">
              {(id) => (
                <select id={id} value={preset} onChange={(event) => setPreset(event.target.value)}>
                  {SOCIAL_PRESETS.map((group) => (
                    <optgroup label={group.group} key={group.group}>
                      {group.items.map((item) => (
                        <option
                          key={`${item.width}x${item.height}-${item.label}`}
                          value={`${item.width}x${item.height}`}
                        >
                          {item.label} — {item.width}×{item.height}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label="Passend maken"
              hint={
                fit === "cover"
                  ? "Vult het kader helemaal; wat buiten de maat valt gaat eraf."
                  : "De hele afbeelding blijft zichtbaar; de rest wordt opgevuld."
              }
            >
              <Segmented
                label="Passend maken"
                value={fit}
                onChange={setFit}
                options={[
                  { value: "cover" as Fit, label: "Vullen" },
                  { value: "contain" as Fit, label: "Passend" },
                ]}
              />
            </Field>

            {fit === "contain" && (
              <Field label="Randkleur">
                {(id) => (
                  <input
                    id={id}
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  />
                )}
              </Field>
            )}
          </Panel>

          {result && (
            <Panel title={label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="tp-preview" src={result.url} alt="Voorbeeld" />
              <dl className="tp-stat">
                <div>
                  <dt>Afmeting</dt>
                  <dd>
                    {width}×{height}
                  </dd>
                </div>
                <div>
                  <dt>Grootte</dt>
                  <dd>{formatBytes(result.blob.size)}</dd>
                </div>
              </dl>
              <Actions>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    download(
                      renameExtension(`${file.name.replace(/\.[^.]+$/, "")}-${width}x${height}`, "jpg"),
                      result.blob
                    )
                  }
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
