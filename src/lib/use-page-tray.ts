'use client'

// src/lib/use-page-tray.ts
// [PAGINA-VOLGORDE] The whole page tray as one piece of state, shared by the two screens that
// collect the pages of ONE paper invoice — /dashboard/incoming and /dashboard/upload.
//
// Both screens used to hold their own copy of this: their own array, their own cap, their own add
// handler, their own remove. Two copies of a decision is two decisions, and they had already
// drifted — one trimmed the surplus inside a state updater, the other outside it; one warned about
// the cap, the other also warned but from a different place. Neither ordered the pages at all.
//
// So the state moves here with the rules ([PAGINA-VOLGORDE] in page-order.ts), and the screens
// keep only what is genuinely theirs: when the tray is open, and what to do with the finished PDF.
//
// ── WHY THE PREVIEW IS MADE HERE AND NOT IN THE TRAY ────────────────────────────────────────────
//
// A thumbnail is the only thing that lets an owner recognise a page — `IMG_4821.jpg` tells them
// nothing — so every page needs an objectURL. That URL is a SIDE EFFECT, and it belongs in the
// event that caused it: the moment the file is added. Deriving it while rendering means creating
// it on the server (where URL.createObjectURL does not exist) and re-creating all twenty on every
// ↑, which both wastes the work and flickers the thumbnails on exactly the screen where the owner
// is comparing two pages. Keyed by the File object, a reorder touches nothing.
//
// An objectURL is a hard reference to the whole photo, so every one of them is released: when its
// page leaves the tray, and when the screen goes away.

import { useCallback, useEffect, useRef, useState } from 'react'

import { addPages, movePage } from './page-order'

/** One page as the tray renders it: the file that will be bound, and something to recognise it by. */
export interface TrayPage {
  file: File
  /** An objectURL for the thumbnail. Empty when there is no browser to make one. */
  preview: string
}

/** What the last add did, so the tray can say it out loud. Null once there is nothing to report. */
export interface TrayNotice {
  sorted: boolean
  duplicates: number
  overflow: number
  max: number
}

export interface PageTrayState {
  /** The pages, in the order they will be bound into the PDF. */
  pages: TrayPage[]
  /** The same pages as plain files — what combineImagesToPdf is handed, in the same order. */
  files: File[]
  notice: TrayNotice | null
  /** Add a picked or photographed group. Ordering, re-picks and the cap are handled for you. */
  add: (incoming: File[]) => void
  /** Move one page a single step. -1 is towards the front. */
  move: (index: number, direction: -1 | 1) => void
  remove: (index: number) => void
  /** Empty the tray — after a successful combine, or when the owner cancels. */
  reset: () => void
}

export function usePageTray(max: number): PageTrayState {
  const [pages, setPages] = useState<TrayPage[]>([])
  const [notice, setNotice] = useState<TrayNotice | null>(null)

  // Every URL currently handed out, so the unmount cleanup can release them all. Kept in a ref
  // because it is bookkeeping, not something the screen draws — and it is only ever read inside an
  // effect or an event handler, never while rendering.
  const held = useRef<string[]>([])
  const release = (urls: string[]) => {
    for (const url of urls) URL.revokeObjectURL(url)
    held.current = held.current.filter((url) => !urls.includes(url))
  }
  useEffect(() => {
    const bookkeeping = held
    return () => {
      for (const url of bookkeeping.current) URL.revokeObjectURL(url)
      bookkeeping.current = []
    }
  }, [])

  // [MP-PURE-UPDATER] Everything below computes OUTSIDE the state updater, and that is not a
  // style choice. A React updater must be pure: React may call it more than once for a single
  // click (StrictMode does it by default, and re-basing an interrupted update does it in
  // production). This exact mistake has already been made on this flow once, where it fired the
  // cap warning twice for one pick. Here it would be worse — creating an objectURL or revoking one
  // inside an updater leaks a photo, or releases a preview that is still on screen.

  const add = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return
    // The shared rules decide the order, the re-picks and what does not fit — see page-order.ts.
    const added = addPages(pages.map((p) => p.file), incoming, max)
    const byFile = new Map(pages.map((p) => [p.file, p] as const))
    const next = added.pages.map((file) => {
      // A page already in the tray keeps its preview, so a reorder never re-creates a thumbnail.
      const existing = byFile.get(file)
      if (existing) return existing
      const preview = typeof window === 'undefined' ? '' : URL.createObjectURL(file)
      if (preview) held.current.push(preview)
      return { file, preview }
    })
    setPages(next)
    setNotice({ sorted: added.sorted, duplicates: added.duplicates, overflow: added.overflow, max })
  }, [pages, max])

  const move = useCallback((index: number, direction: -1 | 1) => {
    // Pure: a reorder creates and releases nothing, so this one may live in the updater.
    setPages((current) => movePage(current, index, direction))
  }, [])

  const remove = useCallback((index: number) => {
    const going = pages[index]
    if (!going) return
    if (going.preview) release([going.preview])
    setPages(pages.filter((_, i) => i !== index))
  }, [pages])

  const reset = useCallback(() => {
    release(pages.map((p) => p.preview).filter(Boolean))
    setPages([])
    setNotice(null)
  }, [pages])

  return { pages, files: pages.map((p) => p.file), notice, add, move, remove, reset }
}
