// src/app/pdf-samenvoegen/PdfSamenvoegen.tsx
// [PDF-TOOLS] The interactive half of /pdf-samenvoegen.
"use client";

import { useCallback, useMemo, useState } from "react";
import { Actions, FileDrop, Icon, Note, Panel, download, formatBytes } from "@/components/tools/ui";
import { GRID_LABELS, PageGrid, usePageThumbnails } from "@/components/tools/PageGrid";
import { describeError } from "@/lib/tools/errors";
import { describe, formatPageRange, mergeFiles, parsePageRange, save } from "@/lib/tools/pdf";
import { openDocument, pageThumbnail } from "@/lib/tools/pdfjs";

interface Item {
  file: File;
  pages: number;
  key: string;
  range: string;
  cover?: string;
}

export default function PdfSamenvoegen() {
  const [items, setItems] = useState<Item[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    blob: Blob;
    name: string;
    pages: number;
    files: number;
  } | null>(null);

  const take = useCallback(async (files: File[]) => {
    setError("");
    setResult(null);
    setBusy("Bezig met lezen…");

    const added: Item[] = [];
    for (const file of files) {
      try {
        const info = await describe(file);
        added.push({
          file,
          pages: info.pages,
          // Empty means "all of it". Only what somebody types narrows it, so
          // adding two files and pressing merge behaves as it always did.
          range: "",
          key: `${file.name}-${file.size}-${added.length}-${performance.now()}`,
        });
      } catch (err) {
        setError(describeError(err));
      }
    }
    setItems((previous) => [...previous, ...added]);
    setBusy("");

    // The cover of each file, fetched after the list is already on screen —
    // seeing which document is which beats reading four similar filenames.
    for (const item of added) {
      try {
        const reader = await openDocument(item.file);
        const cover = await pageThumbnail(reader, 1, { maxSide: 120 });
        await reader.loadingTask.destroy();
        setItems((previous) =>
          previous.map((entry) => (entry.key === item.key ? { ...entry, cover } : entry))
        );
      } catch {
        // No cover is a missing picture, not a failure worth reporting.
      }
    }
  }, []);

  const move = (index: number, by: number) =>
    setItems((previous) => {
      const next = previous.slice();
      const target = index + by;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const setRange = useCallback((key: string, range: string) => {
    setItems((previous) =>
      previous.map((entry) => (entry.key === key ? { ...entry, range } : entry))
    );
    setResult(null);
  }, []);

  /** Which pages each file contributes, and how many that is in total. */
  const chosen = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        count: item.pages,
        picked: item.range.trim()
          ? parsePageRange(item.range, item.pages)
          : Array.from({ length: item.pages }, (_, i) => i),
      })),
    [items]
  );

  const totalPages = chosen.reduce((sum, item) => sum + item.picked.length, 0);
  const narrowed = chosen.some((item) => item.range.trim());
  const emptyPick = chosen.some((item) => item.range.trim() && item.picked.length === 0);

  const run = useCallback(async () => {
    if (items.length < 2) {
      setError("Voeg er minstens twee toe — anders valt er niets samen te voegen.");
      return;
    }
    if (!totalPages) {
      setError("Er is nog niets gekozen om mee te nemen.");
      return;
    }
    setBusy("Bezig met samenvoegen…");
    setError("");
    try {
      const { doc, pages } = await mergeFiles(
        chosen.map((item) => ({ file: item.file, pages: item.picked }))
      );
      const saved = await save(doc, { name: "samengevoegd.pdf" });
      setResult({ ...saved, pages, files: items.length });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy("");
    }
  }, [items, chosen, totalPages]);

  return (
    <>
      <FileDrop
        onFiles={take}
        accept="application/pdf,.pdf"
        multiple
        icon="file"
        title="Sleep je PDF's hierheen"
        hint="meerdere tegelijk mag — de volgorde pas je hierna aan"
      />

      {busy && <Note kind="ok">{busy}</Note>}
      {error && <Note kind="error">{error}</Note>}

      {items.length > 0 && (
        <Panel
          title={`Volgorde · ${totalPages} pagina${totalPages === 1 ? "" : "'s"}`}
        >
          <ul className="tp-rows">
            {chosen.map((item, index) => (
              <li key={item.key} className="tp-row-tall">
                <span className="tp-row-main">
                  {item.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="tp-cover" src={item.cover} alt="" />
                  ) : (
                    <Icon name="file" size={18} />
                  )}
                  <span className="tp-row-text">
                    <strong>{item.file.name}</strong>
                    <span>
                      {item.range.trim()
                        ? `${item.picked.length} van ${item.count} pagina's`
                        : `${item.count} pagina${item.count === 1 ? "" : "'s"}`}{" "}
                      · {formatBytes(item.file.size)}
                    </span>
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
                      onClick={() => {
                        setItems((p) => p.filter((_, i) => i !== index));
                        setOpened(null);
                      }}
                      aria-label={`${item.file.name} weghalen`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                </span>

                {/* Which pages to take from this one. The typed range is the
                    single truth; opening the pages below only rewrites it. */}
                <span className="tp-row-pages">
                  <label>
                    <span className="tp-row-pages-label">Pagina&apos;s</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={item.range}
                      onChange={(event) => setRange(item.key, event.target.value)}
                      placeholder="alles"
                      aria-label={`Pagina's uit ${item.file.name}`}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    aria-expanded={opened === item.key}
                    onClick={() => setOpened(opened === item.key ? null : item.key)}
                  >
                    {opened === item.key ? "Verberg pagina's" : "Toon pagina's"}
                  </button>
                  {item.range.trim() && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => setRange(item.key, "")}
                    >
                      Alles
                    </button>
                  )}
                </span>

                {opened === item.key && (
                  <FilePages
                    file={item.file}
                    count={item.count}
                    picked={item.picked}
                    onToggle={(page) => {
                      // Starts from whatever is currently taken — which, with
                      // an empty field, is EVERY page. So the first click on a
                      // page reads as "not that one", which is what somebody
                      // looking at a whole document means by clicking it.
                      const next = new Set(item.picked);
                      if (next.has(page)) next.delete(page);
                      else next.add(page);

                      const sorted = [...next].sort((a, b) => a - b);
                      // Back to everything is "all of it", not a range that
                      // happens to list all of it — only one of those two stays
                      // true when the file is swapped.
                      setRange(
                        item.key,
                        sorted.length === item.count ? "" : formatPageRange(sorted)
                      );
                    }}
                  />
                )}
              </li>
            ))}
          </ul>

          {emptyPick && (
            <Note kind="warn">
              Uit één van de bestanden wordt niets meegenomen — het bereik klopt niet met het aantal
              pagina&apos;s.
            </Note>
          )}
          {narrowed && !emptyPick && (
            <Note kind="ok">
              Er worden {totalPages} pagina{totalPages === 1 ? "" : "'s"} meegenomen.
            </Note>
          )}

          <Actions>
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={Boolean(busy) || items.length < 2 || !totalPages}
            >
              Samenvoegen
            </button>
          </Actions>
        </Panel>
      )}

      {result && (
        <Panel>
          <Note kind="ok">
            {result.files} bestanden samengevoegd tot {result.pages} pagina
            {result.pages === 1 ? "" : "'s"}.
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

/**
 * One file's pages, drawn only while it is open.
 *
 * Rendering every page of every file up front would mean a hundred thumbnails
 * for four documents nobody has asked to look inside yet. The hook starts when
 * this mounts and stops when it unmounts, so the work follows the reader.
 */
function FilePages({
  file,
  count,
  picked,
  onToggle,
}: {
  file: File;
  count: number;
  picked: number[];
  onToggle: (page: number) => void;
}) {
  const { thumbs } = usePageThumbnails(file, { maxSide: 150 });
  const chosen = new Set(picked);

  // Laid out from the page COUNT rather than from the thumbnails, so every tile
  // is there from the first frame and the grid does not grow under the pointer
  // as the pictures arrive.
  const pages = Array.from({ length: count }, (_, index) => ({
    key: String(index),
    index,
    number: index + 1,
    selected: chosen.has(index),
  }));

  return (
    <PageGrid pages={pages} thumbs={thumbs} onToggle={onToggle} selectable labels={GRID_LABELS} />
  );
}
