// src/app/afbeeldingen-naar-pdf/AfbeeldingenNaarPdf.tsx
// [PDF-TOOLS] The interactive half of /afbeeldingen-naar-pdf.
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
import { imagesToPdf, save } from "@/lib/tools/pdf";

interface Item {
  file: File;
  key: string;
}

export default function AfbeeldingenNaarPdf() {
  const [items, setItems] = useState<Item[]>([]);
  const [pageSize, setPageSize] = useState<"a4" | "fit">("a4");
  const [margin, setMargin] = useState(36);
  const [background, setBackground] = useState("#ffffff");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string; pages: number } | null>(null);

  /**
   * Only JPG and PNG go in, and that is checked HERE rather than at the end.
   * A file that cannot become a page should be refused while somebody is still
   * looking at the drop zone — not three settings later, when they have
   * forgotten which one they added.
   */
  const take = useCallback((files: File[]) => {
    setResult(null);

    const usable: File[] = [];
    const refused: string[] = [];
    for (const file of files) {
      const looksRight = /image\/(jpeg|png)/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
      if (looksRight && file.size > 0) usable.push(file);
      else refused.push(file.name);
    }

    setError(
      refused.length
        ? refused.length === files.length
          ? "Hier kan geen PDF van gemaakt worden — alleen JPG en PNG gaan erin."
          : `${refused.length} bestand${refused.length === 1 ? "" : "en"} overgeslagen (${refused.slice(0, 3).join(", ")}): alleen JPG en PNG gaan erin.`
        : ""
    );
    if (!usable.length) return;

    setItems((previous) => [
      ...previous,
      ...usable.map((file, i) => ({
        file,
        key: `${file.name}-${file.size}-${previous.length + i}`,
      })),
    ]);
  }, []);

  const move = (index: number, by: number) =>
    setItems((previous) => {
      const next = previous.slice();
      const target = index + by;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const run = useCallback(async () => {
    if (!items.length) return;
    setBusy("Bezig met bouwen…");
    setError("");
    try {
      const doc = await imagesToPdf(
        items.map((item) => item.file),
        { pageSize, margin, background }
      );
      setResult({ ...(await save(doc, { name: "afbeeldingen.pdf" })), pages: doc.getPageCount() });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, [items, pageSize, margin, background]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        multiple
        icon="image"
        paste
        title="Sleep je afbeeldingen hierheen"
        hint="meerdere tegelijk mag — de volgorde pas je hierna aan"
      />

      {error && <Note kind="error">{error}</Note>}
      {busy && <Note kind="ok">{busy}</Note>}

      {items.length > 0 && (
        <Panel title="Opmaak">
          <Field label="Papier">
            <Segmented
              label="Papier"
              value={pageSize}
              onChange={setPageSize}
              options={[
                { value: "a4", label: "A4" },
                { value: "fit", label: "Op maat" },
              ]}
            />
          </Field>
          <Field label="Marge">
            <Slider value={margin} onChange={setMargin} min={0} max={120} step={4} suffix=" pt" />
          </Field>
          <Field label="Achtergrond">
            {(id) => (
              <input
                id={id}
                type="color"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
              />
            )}
          </Field>

          <ul className="tp-rows">
            {items.map((item, index) => (
              <li key={item.key}>
                <Icon name="image" size={18} />
                <span className="tp-row-text">
                  <strong>{item.file.name}</strong>
                  <span>{formatBytes(item.file.size)}</span>
                </span>
                <span className="tp-row-actions">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`${item.file.name} omhoog`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label={`${item.file.name} omlaag`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => setItems((p) => p.filter((_, i) => i !== index))}
                    aria-label={`${item.file.name} weghalen`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(busy)}
            >
              PDF maken
            </button>
          </Actions>
        </Panel>
      )}

      {result && (
        <Panel>
          <Note kind="ok">
            Klaar — {result.pages} pagina{result.pages === 1 ? "" : "'s"}.
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
