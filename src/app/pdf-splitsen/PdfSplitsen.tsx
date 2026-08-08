// src/app/pdf-splitsen/PdfSplitsen.tsx
// [PDF-TOOLS] The interactive half of /pdf-splitsen.
"use client";

import { useCallback, useMemo, useState } from "react";
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
import { GRID_LABELS, PageGrid, usePageThumbnails } from "@/components/tools/PageGrid";
import { describeError } from "@/lib/tools/errors";
import {
  describe,
  extractPages,
  formatPageRange,
  parsePageRange,
  save,
  splitEvery,
} from "@/lib/tools/pdf";
import { makeZip, uniqueNames } from "@/lib/tools/zip";

interface Part {
  blob: Blob;
  name: string;
  pages: number;
}

export default function PdfSplitsen() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ pages: number } | null>(null);
  const [mode, setMode] = useState<"pick" | "every">("pick");
  const [range, setRange] = useState("1");
  const [every, setEvery] = useState(1);
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const { thumbs, done, total } = usePageThumbnails(file);

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setParts([]);
    setBusy("Bezig met lezen…");
    try {
      const described = await describe(picked[0]);
      setFile(picked[0]);
      setInfo(described);
      setRange("1");
    } catch (err) {
      setFile(null);
      setInfo(null);
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, []);

  // The typed range is the ONE truth; clicking a page rewrites it. Two states
  // that mean the same thing would only be two states to keep in step.
  const chosen = useMemo(() => (info ? parsePageRange(range, info.pages) : []), [range, info]);
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);

  const toggle = useCallback(
    (index: number) => {
      const next = new Set(chosenSet);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setRange(formatPageRange([...next].sort((a, b) => a - b)));
      setParts([]);
    },
    [chosenSet]
  );

  const pages = useMemo(
    () =>
      info
        ? Array.from({ length: info.pages }, (_, index) => ({
            key: String(index),
            index,
            number: index + 1,
            selected: chosenSet.has(index),
          }))
        : [],
    [info, chosenSet]
  );

  const run = useCallback(async () => {
    if (!file || !info) return;
    setError("");
    setBusy("Bezig met splitsen…");

    try {
      const base = file.name.replace(/\.pdf$/i, "");
      const groups =
        mode === "pick"
          ? chosen.length
            ? [chosen]
            : []
          : await splitEvery(file, Math.max(1, every));

      if (!groups.length) {
        setError("Je hebt nog geen pagina's gekozen.");
        return;
      }

      const made: Part[] = [];
      for (let i = 0; i < groups.length; i++) {
        const doc = await extractPages(file, groups[i]);
        const label =
          mode === "pick" ? formatPageRange(groups[i]).replace(/[,\s]+/g, "_") : `deel-${i + 1}`;
        made.push({
          ...(await save(doc, { name: `${base}-${label}.pdf` })),
          pages: groups[i].length,
        });
      }
      setParts(made);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, [file, info, mode, chosen, every]);

  const saveZip = useCallback(async () => {
    if (!file) return;
    const names = uniqueNames(parts.map((part) => part.name));
    const zip = await makeZip(parts.map((part, at) => ({ name: names[at], data: part.blob })));
    download(`${file.name.replace(/\.pdf$/i, "")}.zip`, zip);
  }, [parts, file]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="crop"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {busy && <Note kind="ok">{busy}</Note>}
      {error && <Note kind="error">{error}</Note>}

      {info && file && (
        <Panel title={`${file.name} · ${info.pages} pagina${info.pages === 1 ? "" : "'s"}`}>
          <Field label="Hoe">
            <Segmented
              label="Hoe"
              value={mode}
              onChange={setMode}
              options={[
                { value: "pick" as const, label: "Pagina's kiezen" },
                { value: "every" as const, label: "Elke zoveel" },
              ]}
            />
          </Field>

          {mode === "pick" ? (
            <>
              <Field label="Welke pagina's" hint="Bijvoorbeeld 1-3, 7, 12- — net als in een printvenster.">
                {(id) => (
                  <input
                    id={id}
                    type="text"
                    value={range}
                    onChange={(event) => {
                      setRange(event.target.value);
                      setParts([]);
                    }}
                    placeholder="1-3, 7, 12-"
                    inputMode="numeric"
                  />
                )}
              </Field>

              <p className="tp-hint">
                Klikken op een pagina zet hem erbij of haalt hem eruit.
                {done < total ? ` · Bezig met tekenen — ${done} van ${total}` : ""}
              </p>

              <PageGrid
                pages={pages}
                thumbs={thumbs}
                onToggle={toggle}
                selectable
                labels={GRID_LABELS}
              />

              <Actions>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => setRange(`1-${info.pages}`)}
                >
                  Alles
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRange("")}>
                  Niets
                </button>
              </Actions>

              <Note kind={chosen.length ? "ok" : "warn"}>
                {chosen.length
                  ? `${chosen.length} van ${info.pages} pagina${info.pages === 1 ? "" : "'s"} gekozen.`
                  : "Je hebt nog geen pagina's gekozen."}
              </Note>
            </>
          ) : (
            <Field label="Elke zoveel pagina's">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={info.pages}
                  value={every}
                  onChange={(event) => {
                    setEvery(Number(event.target.value));
                    setParts([]);
                  }}
                />
              )}
            </Field>
          )}

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(busy)}
            >
              Splitsen
            </button>
          </Actions>
        </Panel>
      )}

      {parts.length > 0 && (
        <Panel title={`${parts.length} bestand${parts.length === 1 ? "" : "en"}`}>
          <ul className="tp-rows">
            {parts.map((part) => (
              <li key={part.name}>
                <Icon name="file" size={18} />
                <span className="tp-row-text">
                  <strong>{part.name}</strong>
                  <span>
                    {part.pages} pagina{part.pages === 1 ? "" : "'s"} · {formatBytes(part.blob.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => download(part.name, part.blob)}
                >
                  <Icon name="download" size={15} /> Opslaan
                </button>
              </li>
            ))}
          </ul>

          {parts.length > 1 && (
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
