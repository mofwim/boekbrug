// src/components/tools/PageGrid.tsx
// [PDF-TOOLS] The pages of a document, as pages.
//
// Several tools need the same thing — see every page, pick some, move them,
// turn them — and a numbered grey rectangle is not a page. This renders the
// real thing with pdf.js, one at a time so a two-hundred page document does not
// lock the tab up before the first tile appears.
//
// Reordering works by dragging with a mouse AND by two buttons for everyone
// else, because drag-and-drop alone is unusable from a keyboard and awkward on
// a phone — which is where most of these pages are opened.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import { openDocument, pageThumbnail } from "@/lib/tools/pdfjs";

export interface GridPage {
  key: string;
  /** Index in the ORIGINAL document, which never changes as tiles move. */
  index: number;
  number: number;
  dropped?: boolean;
  selected?: boolean;
  rotate?: number;
}

export interface ThumbnailState {
  thumbs: string[];
  done: number;
  total: number;
}

const EMPTY: ThumbnailState = { thumbs: [], done: 0, total: 0 };

/** Thumbnails for one file, rendered in the background. */
export function usePageThumbnails(file: File | null, { maxSide = 190 } = {}): ThumbnailState {
  const [state, setState] = useState<ThumbnailState>(EMPTY);

  useEffect(() => {
    // "No file" is derived at the bottom rather than written into state here.
    if (!file) return undefined;

    let cancelled = false;
    let reader: Awaited<ReturnType<typeof openDocument>> | null = null;

    (async () => {
      try {
        reader = await openDocument(file);
        if (cancelled) return;
        setState({
          thumbs: new Array(reader.numPages).fill(""),
          done: 0,
          total: reader.numPages,
        });

        for (let number = 1; number <= reader.numPages; number++) {
          const url = await pageThumbnail(reader, number, { maxSide });
          if (cancelled) return;
          setState((current) => {
            const thumbs = current.thumbs.slice();
            thumbs[number - 1] = url;
            return { ...current, thumbs, done: number };
          });
        }
      } catch {
        // A document pdf.js will not open still has to be usable through the
        // page numbers, so this fails quietly and the tiles stay blank.
        if (!cancelled) setState((current) => ({ ...current, done: current.total }));
      }
    })();

    return () => {
      cancelled = true;
      reader?.loadingTask.destroy();
    };
  }, [file, maxSide]);

  return file ? state : EMPTY;
}

export interface GridLabels {
  page: string;
  moveLeft: string;
  moveRight: string;
  rotateLeft: string;
  rotateRight: string;
  remove: string;
  restore: string;
}

export function PageGrid({
  pages,
  thumbs,
  onMove,
  onRotate,
  onToggle,
  labels,
  selectable = false,
}: {
  pages: GridPage[];
  thumbs: string[];
  onMove?: (from: number, to: number) => void;
  onRotate?: (index: number, by: number) => void;
  onToggle?: (index: number) => void;
  labels: GridLabels;
  selectable?: boolean;
}) {
  const dragging = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to || to < 0 || to >= pages.length) return;
      onMove?.(from, to);
    },
    [onMove, pages.length]
  );

  return (
    <ol className="tp-grid">
      {pages.map((page, position) => (
        <li
          key={page.key}
          className={[
            "tp-grid-item",
            page.dropped ? "is-dropped" : "",
            page.selected ? "is-selected" : "",
            over === position ? "is-over" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          draggable={Boolean(onMove)}
          onDragStart={() => {
            dragging.current = position;
          }}
          onDragOver={(event) => {
            if (dragging.current === null) return;
            event.preventDefault();
            setOver(position);
          }}
          onDragLeave={() => setOver((current) => (current === position ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging.current !== null) move(dragging.current, position);
            dragging.current = null;
            setOver(null);
          }}
          onDragEnd={() => {
            dragging.current = null;
            setOver(null);
          }}
        >
          <button
            type="button"
            className="tp-grid-sheet"
            aria-pressed={selectable ? Boolean(page.selected) : undefined}
            aria-label={`${labels.page} ${page.number}`}
            onClick={() => onToggle?.(page.index)}
            disabled={!onToggle}
            // The stylesheet turns the thumbnail; this only says how far. Doing
            // it the other way round would put the rotation on the <img> and
            // leave the tile the wrong shape around it.
            style={{ "--turn": `${page.rotate || 0}deg` } as React.CSSProperties}
          >
            {thumbs[page.index] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[page.index]} alt="" loading="lazy" />
            ) : (
              <span className="tp-grid-blank">{page.number}</span>
            )}
            {selectable && (
              <span className="tp-grid-tick" aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
            )}
          </button>

          <span className="tp-grid-no">{page.number}</span>

          <span className="tp-grid-tools">
            {onMove && (
              <>
                <button
                  type="button"
                  onClick={() => move(position, position - 1)}
                  disabled={position === 0}
                  title={labels.moveLeft}
                  aria-label={`${labels.moveLeft}: ${labels.page} ${page.number}`}
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => move(position, position + 1)}
                  disabled={position === pages.length - 1}
                  title={labels.moveRight}
                  aria-label={`${labels.moveRight}: ${labels.page} ${page.number}`}
                >
                  ›
                </button>
              </>
            )}
            {onRotate && (
              <>
                <button
                  type="button"
                  onClick={() => onRotate(page.index, -90)}
                  title={labels.rotateLeft}
                  aria-label={`${labels.rotateLeft}: ${labels.page} ${page.number}`}
                >
                  ⟲
                </button>
                <button
                  type="button"
                  onClick={() => onRotate(page.index, 90)}
                  title={labels.rotateRight}
                  aria-label={`${labels.rotateRight}: ${labels.page} ${page.number}`}
                >
                  ⟳
                </button>
              </>
            )}
            {onToggle && !selectable && (
              <button
                type="button"
                data-danger
                onClick={() => onToggle(page.index)}
                title={page.dropped ? labels.restore : labels.remove}
                aria-label={`${page.dropped ? labels.restore : labels.remove}: ${labels.page} ${page.number}`}
              >
                {page.dropped ? "↺" : "×"}
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The Dutch words the grid says, in one place. */
export const GRID_LABELS: GridLabels = {
  page: "Pagina",
  moveLeft: "Naar links",
  moveRight: "Naar rechts",
  rotateLeft: "Linksom draaien",
  rotateRight: "Rechtsom draaien",
  remove: "Weggooien",
  restore: "Terugzetten",
};
