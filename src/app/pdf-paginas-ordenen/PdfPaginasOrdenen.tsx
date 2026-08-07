// src/app/pdf-paginas-ordenen/PdfPaginasOrdenen.tsx
// [PDF-TOOLS] The interactive half of /pdf-paginas-ordenen.
"use client";

import { useCallback, useMemo, useState } from "react";
import { Actions, FileDrop, Icon, Note, Panel, download, formatBytes } from "@/components/tools/ui";
import { GRID_LABELS, PageGrid, usePageThumbnails } from "@/components/tools/PageGrid";
import { describeError } from "@/lib/tools/errors";
import { describe, rebuildPages, save } from "@/lib/tools/pdf";

interface PlanEntry {
  index: number;
  rotate: number;
  dropped: boolean;
}

/** Every page, in order, turned no further than it already is. */
const initialPlan = (count: number): PlanEntry[] =>
  Array.from({ length: count }, (_, index) => ({ index, rotate: 0, dropped: false }));

export default function PdfPaginasOrdenen() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ pages: number } | null>(null);
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const { thumbs, done, total } = usePageThumbnails(file);

  const take = useCallback(async (picked: File[]) => {
    setError("");
    setResult(null);
    setPlan([]);
    setBusy("Bezig met lezen…");
    try {
      const described = await describe(picked[0]);
      setFile(picked[0]);
      setInfo(described);
      setPlan(initialPlan(described.pages));
    } catch (err) {
      setFile(null);
      setInfo(null);
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, []);

  const move = useCallback((from: number, to: number) => {
    setPlan((current) => {
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setResult(null);
  }, []);

  const rotate = useCallback((index: number, by: number) => {
    setPlan((current) =>
      current.map((entry) =>
        entry.index === index ? { ...entry, rotate: (entry.rotate + by + 360) % 360 } : entry
      )
    );
    setResult(null);
  }, []);

  const toggle = useCallback((index: number) => {
    setPlan((current) =>
      current.map((entry) => (entry.index === index ? { ...entry, dropped: !entry.dropped } : entry))
    );
    setResult(null);
  }, []);

  const pages = useMemo(
    () =>
      plan.map((entry) => ({
        key: String(entry.index),
        index: entry.index,
        number: entry.index + 1,
        rotate: entry.rotate,
        dropped: entry.dropped,
      })),
    [plan]
  );

  const keep = plan.filter((entry) => !entry.dropped);

  const run = useCallback(async () => {
    if (!file || !keep.length) return;
    setBusy("Bezig met opbouwen…");
    setError("");
    try {
      const doc = await rebuildPages(
        file,
        keep.map((entry) => ({ index: entry.index, rotate: entry.rotate }))
      );
      setResult(await save(doc, { name: `${file.name.replace(/\.pdf$/i, "")}-geordend.pdf` }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, [file, keep]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        icon="shuffle"
        title="Sleep een PDF hierheen"
        hint="of klik om te kiezen"
      />

      {busy && <Note kind="ok">{busy}</Note>}
      {error && <Note kind="error">{error}</Note>}

      {info && file && (
        <Panel title={`${file.name} · ${info.pages} pagina${info.pages === 1 ? "" : "'s"}`}>
          <Note kind={keep.length ? "ok" : "warn"}>
            {keep.length
              ? `${keep.length} van ${info.pages} pagina${info.pages === 1 ? "" : "'s"} blijven over.`
              : "Je hebt alle pagina's weggegooid — er blijft niets over om op te slaan."}
          </Note>
          <p className="tp-hint">
            Sleep een pagina om hem te verplaatsen, of gebruik de pijltjes eronder.
            {done < total ? ` · Bezig met tekenen — ${done} van ${total}` : ""}
          </p>

          <PageGrid
            pages={pages}
            thumbs={thumbs}
            onMove={move}
            onRotate={rotate}
            onToggle={toggle}
            labels={GRID_LABELS}
          />

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(busy) || !keep.length}
            >
              Toepassen
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setPlan(initialPlan(info.pages));
                setResult(null);
              }}
            >
              Beginstand
            </button>
          </Actions>
        </Panel>
      )}

      {result && (
        <Panel>
          <Note kind="ok">Klaar — {formatBytes(result.blob.size)}.</Note>
          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => download(result.name, result.blob)}
            >
              <Icon name="download" size={16} /> Opslaan
            </button>
          </Actions>
        </Panel>
      )}
    </>
  );
}
