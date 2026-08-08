// src/app/watermerk-op-foto/WatermerkOpFoto.tsx
// [PDF-TOOLS] The interactive half of /watermerk-op-foto.
"use client";

import { useCallback, useEffect, useState } from "react";
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
import { MIME, encode, loadImage, makeCanvas, renameExtension, type LoadedImage } from "@/lib/tools/image";

const PLACES = [
  { value: "bottom-right", label: "Rechtsonder" },
  { value: "bottom-left", label: "Linksonder" },
  { value: "top-right", label: "Rechtsboven" },
  { value: "top-left", label: "Linksboven" },
  { value: "center", label: "Midden" },
  { value: "tile", label: "Over de hele foto" },
];

/** Where the text sits, given the canvas and how big the text turned out. */
function place(
  where: string,
  canvas: HTMLCanvasElement,
  textWidth: number,
  textHeight: number,
  margin: number
) {
  const right = canvas.width - textWidth - margin;
  const bottom = canvas.height - margin;
  const top = margin + textHeight;

  switch (where) {
    case "bottom-left":
      return { x: margin, y: bottom };
    case "top-right":
      return { x: right, y: top };
    case "top-left":
      return { x: margin, y: top };
    case "center":
      return { x: (canvas.width - textWidth) / 2, y: (canvas.height + textHeight) / 2 };
    default:
      return { x: right, y: bottom };
  }
}

export default function WatermerkOpFoto() {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");

  const [text, setText] = useState("© jouw naam");
  const [where, setWhere] = useState("bottom-right");
  const [size, setSize] = useState(5);
  const [opacity, setOpacity] = useState(60);
  const [colour, setColour] = useState("#ffffff");

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

  useEffect(() => {
    if (!image || !text.trim()) return undefined;
    let cancelled = false;

    (async () => {
      const canvas = makeCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);

      // Size relative to the picture, so the mark looks the same on a phone
      // snap and on a 6000px camera file.
      const fontSize = Math.max(
        12,
        Math.round((Math.min(canvas.width, canvas.height) * size) / 100)
      );
      const margin = Math.round(fontSize * 0.8);

      ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle = colour;
      // A soft shadow keeps light text readable over a light photo.
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = Math.round(fontSize * 0.25);

      const textWidth = ctx.measureText(text).width;
      const textHeight = fontSize;

      if (where === "tile") {
        const stepX = textWidth + fontSize * 2.5;
        const stepY = fontSize * 4;
        ctx.rotate(-0.4);
        for (let y = -canvas.height; y < canvas.height * 1.6; y += stepY) {
          for (let x = -canvas.width; x < canvas.width * 1.6; x += stepX) {
            ctx.fillText(text, x, y);
          }
        }
      } else {
        const at = place(where, canvas, textWidth, textHeight, margin);
        ctx.fillText(text, at.x, at.y);
      }

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
  }, [image, text, where, size, opacity, colour]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="image/*"
        icon="pencil"
        paste
        title="Sleep een afbeelding hierheen"
        hint="of plak er een"
      />

      {error && <Note kind="error">{error}</Note>}

      {image && file && (
        <>
          <Panel title="Watermerk">
            <Field label="Tekst">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  value={text}
                  maxLength={80}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="© jouw naam"
                />
              )}
            </Field>

            <Field label="Plek">
              {(id) => (
                <select id={id} value={where} onChange={(event) => setWhere(event.target.value)}>
                  {PLACES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Grootte">
              <Slider value={size} onChange={setSize} min={2} max={14} suffix="%" />
            </Field>

            <Field label="Doorzichtigheid">
              <Slider value={opacity} onChange={setOpacity} min={10} max={100} suffix="%" />
            </Field>

            <Field label="Kleur">
              <Segmented
                label="Kleur"
                value={colour}
                onChange={setColour}
                options={[
                  { value: "#ffffff", label: "Wit" },
                  { value: "#000000", label: "Zwart" },
                ]}
              />
            </Field>
          </Panel>

          {result && (
            <Panel>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="tp-preview" src={result.url} alt="Voorbeeld met watermerk" />
              <Actions>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    download(
                      renameExtension(file.name, "jpg").replace(/\.jpg$/, "-watermerk.jpg"),
                      result.blob
                    )
                  }
                >
                  <Icon name="download" size={16} /> Opslaan ({formatBytes(result.blob.size)})
                </button>
              </Actions>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
