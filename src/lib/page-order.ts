// src/lib/page-order.ts
// [PAGINA-VOLGORDE] The order of the pages of ONE paper invoice, decided in one place.
//
// The multi-page flow ("meerdere pagina's = één factuur") hands its list straight to
// combineImagesToPdf, whose own doc comment says it combines the files "in order". That order was
// `Array.from(fileList)` — the BROWSER's order, not the owner's. Nothing sorted it, nothing showed
// it, and the tray offered no way to change it: a page could only be removed.
//
// Why that is a money problem and not a cosmetic one. The combined PDF is the document that is
// booked, read by the extractor, and kept for the seven-year bewaarplicht. If page 2 of a supplier
// invoice lands after page 10, then the archived document is wrong, and the reader meets the totals
// before the lines that justify them. Nobody sees it: the tray lists `IMG_4821.jpg`, which tells
// the owner nothing about which page it is, so the only signal that the order is wrong is opening
// the finished PDF afterwards — which is exactly what nobody does on a stack of twenty.
//
// A plain string sort does not fix it either, and that is the trap: "pagina-10" sorts BEFORE
// "pagina-2", because '1' < '2'. Any list that reaches double digits is then reordered wrongly by
// the very code meant to order it. So the comparison has to read digit runs as numbers.
//
// ── THE THREE RULES ─────────────────────────────────────────────────────────────────────────────
//
// 1. ONLY THE NEWLY ADDED GROUP IS SORTED. Pages already in the tray keep the order they have —
//    which may be an order the owner FIXED by hand. Re-sorting everything on every add would undo
//    that silently, and a control that undoes the owner's correction is worse than no control.
//
// 2. THE SORT IS A GUESS, SO IT IS SAID OUT LOUD. `sorted` reports whether the natural order
//    actually differed from what the browser handed over. The screen uses it to tell the owner the
//    app arranged the pages — because a rearrangement nobody was told about is indistinguishable
//    from a bug.
//
// 3. THE SAME PHOTO PICKED TWICE IS NOT TWO PAGES. Name, size and modification time together
//    identify a re-pick well enough; a genuine second page differs in at least one of the three.
//    It is skipped and COUNTED, never silently swallowed — a duplicated page in a kept document is
//    as wrong as a missing one.
//
// Pure. No DOM, no network — the screens hand it a list and render what comes back.

/** One page, as much of a File as the ordering needs. Keeps the module testable without a DOM. */
export interface PageLike {
  name: string
  size: number
  lastModified: number
}

/**
 * Compare two filenames the way a person reads them: digit runs count as numbers, so
 * `pagina-2` comes before `pagina-10`.
 *
 * The leading zeros case matters too — a scanner writes `scan_007`, a phone writes `IMG_0007`.
 * `007` and `7` are the same page number, so they compare equal on the digits and the shorter
 * spelling then decides, which keeps the comparison a total order instead of an inconsistent one.
 */
export function naturalCompare(a: string, b: string): number {
  const chunks = (s: string) => s.match(/\d+|\D+/g) ?? []
  const ca = chunks(a)
  const cb = chunks(b)
  for (let i = 0; i < Math.min(ca.length, cb.length); i += 1) {
    const x = ca[i]
    const y = cb[i]
    const bothNumeric = /^\d/.test(x) && /^\d/.test(y)
    if (bothNumeric) {
      // Compare as numbers. Beyond Number.MAX_SAFE_INTEGER a filename is not a page number any
      // more, and comparing the trimmed strings by length then value stays exact at any size.
      const nx = x.replace(/^0+(?=\d)/, "")
      const ny = y.replace(/^0+(?=\d)/, "")
      if (nx.length !== ny.length) return nx.length - ny.length
      if (nx !== ny) return nx < ny ? -1 : 1
      // Same number, different spelling (`07` vs `7`): keep going, and let a later chunk decide.
      continue
    }
    if (x !== y) {
      // Case-insensitively first, so `Pagina2` and `pagina10` still order by their number.
      const lx = x.toLowerCase()
      const ly = y.toLowerCase()
      if (lx !== ly) return lx < ly ? -1 : 1
      return x < y ? -1 : 1
    }
  }
  return ca.length - cb.length
}

/** Natural order by filename, STABLE — equal names keep the order they came in. */
export function sortPagesByName<T extends PageLike>(pages: readonly T[]): T[] {
  return pages
    .map((page, index) => ({ page, index }))
    .sort((a, b) => naturalCompare(a.page.name, b.page.name) || a.index - b.index)
    .map((entry) => entry.page)
}

/** Two picks of the SAME file. A real second page differs in name, size or modification time. */
function isSamePick(a: PageLike, b: PageLike): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

export interface PageAddition<T extends PageLike> {
  /** The tray after the add — existing pages untouched, the new group appended in natural order. */
  pages: T[]
  /** True when the natural order differed from the order the browser handed over (see rule 2). */
  sorted: boolean
  /** How many of the incoming files were the same pick as a page already in the tray (rule 3). */
  duplicates: number
  /** How many pages did not fit under `max` and were therefore NOT added. Never silently dropped. */
  overflow: number
}

/**
 * Add `incoming` to `existing`, applying the three rules above.
 *
 * `max` caps the tray. What goes over is REPORTED rather than trimmed away quietly: the caller
 * shows a sentence naming how many pages did not fit, so the owner can split the invoice instead
 * of discovering later that pages 21 and 22 were never in the document.
 */
export function addPages<T extends PageLike>(
  existing: readonly T[],
  incoming: readonly T[],
  max: number,
): PageAddition<T> {
  const fresh: T[] = []
  let duplicates = 0
  for (const candidate of incoming) {
    if (existing.some((page) => isSamePick(page, candidate)) || fresh.some((page) => isSamePick(page, candidate))) {
      duplicates += 1
      continue
    }
    fresh.push(candidate)
  }

  const ordered = sortPagesByName(fresh)
  const sorted = ordered.some((page, i) => page !== fresh[i])

  const room = Math.max(0, max - existing.length)
  const admitted = ordered.slice(0, room)
  return {
    pages: [...existing, ...admitted],
    sorted,
    duplicates,
    overflow: ordered.length - admitted.length,
  }
}

/**
 * Move the page at `from` one step in `direction`. Returns the SAME array reference when the move
 * is impossible (first page up, last page down), so a caller can skip a pointless state write.
 */
export function movePage<T>(pages: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction
  if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) return pages
  const next = [...pages]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
