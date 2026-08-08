// src/components/tools/usePreview.ts
// [PDF-TOOLS] A live look at what a setting will actually do.
//
// The preview is produced by the SAME engine as the result — one page put
// through the real operation and then rendered — rather than by drawing an
// approximation on top of a picture. An approximation would be faster, and it
// would eventually be wrong about something, which is the one thing a preview
// must never be.
//
// Work is debounced and the newest request always wins: dragging a slider makes
// a run of settings, and only the last one is worth looking at.
"use client";

import { useEffect, useRef, useState, type DependencyList } from "react";
import { openDocument, renderPage } from "@/lib/tools/pdfjs";

export interface PreviewState {
  url: string;
  busy: boolean;
  error: string;
}

export function usePagePreview(
  build: (() => Promise<Uint8Array>) | null,
  deps: DependencyList,
  { delay = 320, maxSide = 700 } = {}
): PreviewState {
  const [state, setState] = useState<PreviewState>({ url: "", busy: false, error: "" });
  const latest = useRef(0);
  const previous = useRef("");

  useEffect(() => {
    // "There is nothing to preview" is derived at the bottom rather than
    // written into state here: setting state synchronously inside an effect
    // costs a second render pass for something already known from the argument.
    if (!build) return undefined;

    const round = ++latest.current;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setState((current) => ({ ...current, busy: true }));
      let reader = null;
      try {
        const bytes = await build();
        if (cancelled || round !== latest.current) return;

        reader = await openDocument(bytes, { name: "preview.pdf" });
        const canvas = await renderPage(reader, 1, { scale: 1, maxSide });
        const url = canvas.toDataURL("image/jpeg", 0.85);
        canvas.width = 0;
        canvas.height = 0;

        if (cancelled || round !== latest.current) return;
        previous.current = url;
        setState({ url, busy: false, error: "" });
      } catch {
        if (cancelled || round !== latest.current) return;
        // Keep the last good picture rather than blanking the panel: a setting
        // that momentarily makes no sense should not wipe the page away.
        setState({ url: previous.current, busy: false, error: "preview" });
      } finally {
        await reader?.loadingTask.destroy();
      }
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return build ? state : { url: "", busy: false, error: "" };
}
