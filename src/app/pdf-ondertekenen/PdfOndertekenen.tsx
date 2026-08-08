// src/app/pdf-ondertekenen/PdfOndertekenen.tsx
// [PDF-TOOLS] The interactive half of /pdf-ondertekenen.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { placeImage, save } from "@/lib/tools/pdf";
import { openDocument, renderPage } from "@/lib/tools/pdfjs";

interface Signature {
  bytes: Uint8Array;
  type: string;
  url: string;
}

type Point = { x: number; y: number };

/**
 * A pad to sign on.
 *
 * POINTER events rather than mouse or touch ones, so a finger, a stylus and a
 * trackpad all take the same path — and signing with a finger on a phone is the
 * case this exists for. The strokes are kept as points and redrawn on every
 * change, which is what makes undo a one-line operation.
 */
function SignaturePad({
  onChange,
  ink,
}: {
  onChange: (value: Signature | null) => void;
  ink: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef<Point[] | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.6;

    for (const stroke of strokes.current) {
      if (stroke.length < 2) {
        if (stroke.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke[0].x, stroke[0].y, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = ink;
          ctx.fill();
        }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }, [ink]);

  useEffect(() => redraw(), [redraw]);

  const publish = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strokes.current.length) {
      onChange(null);
      return;
    }
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      onChange({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        type: "image/png",
        url: URL.createObjectURL(blob),
      });
    }, "image/png");
  }, [onChange]);

  const at = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="tp-pad"
        width={760}
        height={240}
        aria-label="Tekenen"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = [at(event)];
          strokes.current.push(drawing.current);
          redraw();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          drawing.current.push(at(event));
          redraw();
        }}
        onPointerUp={() => {
          drawing.current = null;
          publish();
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = null;
          publish();
        }}
      />
      <Actions>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => {
            strokes.current.pop();
            redraw();
            publish();
          }}
        >
          Laatste weg
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => {
            strokes.current = [];
            redraw();
            onChange(null);
          }}
        >
          Wissen
        </button>
      </Actions>
    </>
  );
}

export default function PdfOndertekenen() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState("");
  const [source, setSource] = useState<"draw" | "image">("draw");
  const [ink, setInk] = useState("#1c1c1e");
  const [signature, setSignature] = useState<Signature | null>(null);
  const [place, setPlace] = useState({ x: 0.68, y: 0.82, width: 0.24 });
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setResult(null);
    let reader = null;
    try {
      reader = await openDocument(picked[0]);
      setFile(picked[0]);
      setPages(reader.numPages);
      setPage(0);
    } catch (err) {
      setFile(null);
      setPages(0);
      setError(describeError(err));
    } finally {
      await reader?.loadingTask.destroy();
    }
  }, []);

  // The page being signed, rendered large enough to point at accurately.
  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    let reader = null;

    (async () => {
      try {
        reader = await openDocument(file);
        const canvas = await renderPage(reader, page + 1, { scale: 1, maxSide: 900 });
        if (!cancelled) setPreview(canvas.toDataURL("image/jpeg", 0.82));
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        if (!cancelled) setPreview("");
      } finally {
        await reader?.loadingTask.destroy();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, page]);

  useEffect(() => () => void (signature?.url && URL.revokeObjectURL(signature.url)), [signature]);

  const takeImage = useCallback(async (picked: File[]) => {
    const bytes = new Uint8Array(await picked[0].arrayBuffer());
    const type = picked[0].type === "image/png" ? "image/png" : "image/jpeg";
    setSignature({ bytes, type, url: URL.createObjectURL(picked[0]) });
  }, []);

  const pointAt = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPlace((current) => ({
      ...current,
      x: Math.min(0.98, Math.max(0.02, (event.clientX - rect.left) / rect.width)),
      y: Math.min(0.98, Math.max(0.02, (event.clientY - rect.top) / rect.height)),
    }));
    setResult(null);
  };

  const run = useCallback(async () => {
    if (!file || !signature) return;
    setBusy(true);
    setError("");
    try {
      const doc = await placeImage(file, signature, { ...place, page });
      setResult(await save(doc, { name: `${file.name.replace(/\.pdf$/i, "")}-ondertekend.pdf` }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [file, signature, place, page]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="pencil"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {error && <Note kind="error">{error}</Note>}

      {file && (
        <>
          <Panel title="Handtekening">
            <Field label="Manier">
              <Segmented
                label="Manier"
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setSignature(null);
                }}
                options={[
                  { value: "draw" as const, label: "Tekenen" },
                  { value: "image" as const, label: "Afbeelding" },
                ]}
              />
            </Field>

            {source === "draw" ? (
              <>
                <Field label="Inkt">
                  {(id) => (
                    <input
                      id={id}
                      type="color"
                      value={ink}
                      onChange={(event) => setInk(event.target.value)}
                    />
                  )}
                </Field>
                <SignaturePad
                  onChange={(value) => {
                    setSignature(value);
                    setResult(null);
                  }}
                  ink={ink}
                />
                <p className="tp-hint">
                  Teken met je muis, je vinger of een pen. Met &lsquo;Laatste weg&rsquo; haal je
                  alleen de laatste haal terug.
                </p>
              </>
            ) : (
              <>
                <FileDrop
                  onFiles={takeImage}
                  accept="image/png,image/jpeg"
                  icon="image"
                  title="Sleep een foto van je handtekening hierheen"
                  hint="een PNG met doorzichtige achtergrond ziet er het netst uit"
                />
                {signature && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="tp-sign-preview" src={signature.url} alt="Je handtekening" />
                )}
              </>
            )}
          </Panel>

          <Panel title="Plek">
            {pages > 1 && (
              <Field label="Op welke pagina">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={1}
                    max={pages}
                    value={page + 1}
                    onChange={(event) => {
                      setPage(Math.min(pages - 1, Math.max(0, Number(event.target.value) - 1)));
                      setResult(null);
                    }}
                  />
                )}
              </Field>
            )}

            <Field label="Breedte">
              <Slider
                value={Math.round(place.width * 100)}
                onChange={(value) => {
                  setPlace((current) => ({ ...current, width: value / 100 }));
                  setResult(null);
                }}
                min={5}
                max={60}
                suffix="%"
              />
            </Field>

            <p className="tp-hint">Klik of tik op de pagina om je handtekening daar neer te zetten.</p>

            {preview ? (
              <div className="tp-sheet" onClick={pointAt} role="presentation">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt={`Pagina ${page + 1}`} />
                {signature && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="tp-sheet-mark"
                    src={signature.url}
                    alt=""
                    style={{
                      left: `${place.x * 100}%`,
                      top: `${place.y * 100}%`,
                      width: `${place.width * 100}%`,
                    }}
                  />
                )}
              </div>
            ) : (
              <Note kind="warn">Deze pagina kon niet getekend worden om op te wijzen.</Note>
            )}

            <Actions>
              <button
                type="button"
                className="btn btn-primary"
                onClick={run}
                disabled={busy || !signature}
              >
                {busy ? "Bezig…" : "Ondertekenen"}
              </button>
            </Actions>
            {!signature && (
              <p className="tp-hint">Zet eerst een handtekening hierboven.</p>
            )}
          </Panel>
        </>
      )}

      {result && (
        <Panel title="Klaar">
          {/* Said plainly, because the word "ondertekenen" promises more than
              this does. A drawn signature is an image on a page — genoeg voor
              een offerte of een opdrachtbevestiging, geen digitale handtekening
              met certificaat. */}
          <Note kind="ok">
            Je handtekening staat in het document. Let op: dit is een afbeelding op de pagina, geen
            gecertificeerde digitale handtekening.
          </Note>
          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => download(result.name, result.blob)}
            >
              <Icon name="download" size={16} /> Opslaan ({formatBytes(result.blob.size)})
            </button>
          </Actions>
        </Panel>
      )}
    </>
  );
}
