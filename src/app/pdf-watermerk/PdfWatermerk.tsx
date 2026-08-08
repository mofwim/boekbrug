// src/app/pdf-watermerk/PdfWatermerk.tsx
// [PDF-TOOLS] The interactive half of /pdf-watermerk.
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Actions,
  Field,
  FileDrop,
  Icon,
  Note,
  Panel,
  Slider,
  download,
  formatBytes,
} from "@/components/tools/ui";
import { usePagePreview } from "@/components/tools/usePreview";
import { describeError } from "@/lib/tools/errors";
import { describe, samplePage, save, stampDocument } from "@/lib/tools/pdf";

export default function PdfWatermerk() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ pages: number } | null>(null);
  const [text, setText] = useState("KOPIE");
  const [size, setSize] = useState(56);
  const [opacity, setOpacity] = useState(22);
  const [angle, setAngle] = useState(45);
  const [colour, setColour] = useState("#d00000");
  const [numbers, setNumbers] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; pages: number } | null>(null);

  const options = useMemo(
    () => ({ text: text.trim(), size, opacity: opacity / 100, angle, colour, numbers }),
    [text, size, opacity, angle, colour, numbers]
  );

  // Built by the same call that builds the result, on one page — so what you
  // are looking at cannot differ from what you get.
  const preview = usePagePreview(
    file && info
      ? () =>
          samplePage(file, Math.min(page, info.pages - 1), (sample) =>
            stampDocument(sample, { ...options, firstNumber: page + 1, total: info.pages })
          )
      : null,
    [file, info, page, options]
  );

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setResult(null);
    setBusy("Bezig met lezen…");
    try {
      const described = await describe(picked[0]);
      setFile(picked[0]);
      setInfo(described);
    } catch (err) {
      setFile(null);
      setInfo(null);
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, []);

  const run = useCallback(async () => {
    if (!file) return;
    if (!text.trim() && !numbers) {
      setError("Er is niets om te stempelen — vul een tekst in of zet paginanummers aan.");
      return;
    }
    setBusy("Bezig met stempelen…");
    setError("");
    try {
      const doc = await stampDocument(file, options);
      setResult({
        ...(await save(doc, { name: `${file.name.replace(/\.pdf$/i, "")}-gestempeld.pdf` })),
        pages: doc.getPageCount(),
      });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, [file, text, numbers, options]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="pencil"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {busy && <Note kind="ok">{busy}</Note>}
      {error && <Note kind="error">{error}</Note>}

      {info && (
        <Panel title={`Stempel · ${info.pages} pagina${info.pages === 1 ? "" : "'s"}`}>
          <Field label="Tekst">
            {(id) => (
              <input
                id={id}
                type="text"
                value={text}
                maxLength={40}
                onChange={(event) => setText(event.target.value)}
                placeholder="KOPIE, CONCEPT, VERTROUWELIJK…"
              />
            )}
          </Field>
          <Field label="Grootte">
            <Slider value={size} onChange={setSize} min={16} max={140} suffix=" pt" />
          </Field>
          <Field label="Doorzichtigheid">
            <Slider value={opacity} onChange={setOpacity} min={5} max={100} suffix="%" />
          </Field>
          <Field label="Hoek">
            <Slider value={angle} onChange={setAngle} min={0} max={90} suffix="°" />
          </Field>
          <Field label="Kleur">
            {(id) => (
              <input
                id={id}
                type="color"
                value={colour}
                onChange={(event) => setColour(event.target.value)}
              />
            )}
          </Field>
          <Field label="Paginanummers">
            <input
              type="checkbox"
              className="tp-switch"
              checked={numbers}
              onChange={(event) => setNumbers(event.target.checked)}
            />
          </Field>

          {info.pages > 1 && (
            <Field label="Voorbeeldpagina">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={info.pages}
                  value={page + 1}
                  onChange={(event) =>
                    setPage(Math.min(info.pages - 1, Math.max(0, Number(event.target.value) - 1)))
                  }
                />
              )}
            </Field>
          )}

          <div className={`tp-sheet tp-sheet-still${preview.busy ? " is-busy" : ""}`}>
            {preview.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={`Voorbeeld — pagina ${page + 1}`} />
            ) : (
              <span className="tp-sheet-waiting">Voorbeeld…</span>
            )}
          </div>

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(busy)}
            >
              Toepassen
            </button>
          </Actions>
        </Panel>
      )}

      {result && (
        <Panel>
          <Note kind="ok">
            Klaar — {result.pages} pagina{result.pages === 1 ? "" : "'s"} gestempeld.
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
