// src/lib/queue-sync.ts
// [WACHTRIJ-VERS] What a server refresh may and may not do to a list a screen is already holding.
//
// ── THE PROBLEM THIS EXISTS FOR ──
//
// The verify queue seeds its rows from the server render and then owns them:
//
//     const [pending, setPending] = useState<IncomingInvoice[]>(initialInvoices)
//
// A `useState` initial value is read ONCE. Every later server render — and the page calls
// router.refresh() after a re-read, after a correction, after archiving — arrives as a new prop
// that React hands to a hook which has already made up its mind. The comment at one of those call
// sites said "pick up the refreshed amounts + health"; nothing of the sort could happen.
//
// So a card kept showing the amounts read at page load. After "Opnieuw inlezen" corrected a
// misread total, the screen still showed the wrong one — and the verify modal opens seeded from
// that row, so the owner reviewing "the corrected invoice" was looking at, and confirming, the
// number the correction had just replaced.
//
// ── WHY THIS IS A MERGE AND NOT A REPLACEMENT ──
//
// The obvious fix — setPending(initialInvoices) whenever the prop changes — trades one bug for a
// worse one. This screen removes rows OPTIMISTICALLY: confirming an invoice takes it out of the
// list before the server has answered, and puts it back if the server refuses. A refresh that
// landed in that window would carry the row (the server had not written it yet) and drop it back
// into the queue the owner just cleared. An invoice that reappears after being confirmed is
// exactly the kind of thing that makes someone confirm it twice.
//
// So the rule is narrow, and the narrowness IS the design:
//
//     MEMBERSHIP belongs to the screen. CONTENT belongs to the server.
//
// A refresh updates the rows the screen is holding and touches nothing else. It cannot add a row,
// cannot remove one, and cannot resurrect one. What it can do is make the numbers on the cards
// true, which is the whole point.
//
// The cost, stated plainly: an invoice that arrives during a sync is not inserted by a refresh
// alone. That was already true before this existed — the list never grew on a refresh — and it is
// the honest half of the trade, because the alternative loses a removal rather than a delay.

/** The minimum a row must have to be recognised across a refresh. */
export interface Identified {
  id: string;
}

/**
 * The screen's list, with each row's CONTENT replaced by the server's version of that same row.
 *
 * Rows the server no longer returns keep whatever the screen has (they are usually mid-flight);
 * rows the server has and the screen does not are ignored. Order is the screen's, not the
 * server's — a list that reorders itself under a reading finger is its own small betrayal.
 *
 * Pure, and O(n+m).
 */
export function applyServerRefresh<T extends Identified>(
  held: readonly T[],
  fromServer: readonly T[],
): T[] {
  if (held.length === 0) return [];
  const byId = new Map<string, T>();
  for (const row of fromServer) {
    // First occurrence wins: a duplicated id in the payload must not make the result depend on
    // which copy came last.
    if (row && typeof row.id === "string" && !byId.has(row.id)) byId.set(row.id, row);
  }
  let changed = false;
  const next = held.map((row) => {
    const fresh = byId.get(row.id);
    if (fresh === undefined || fresh === row) return row;
    changed = true;
    return fresh;
  });
  // Identity is load-bearing here: returning a new array on every refresh would re-render the
  // whole queue (and re-run every effect keyed on the list) for a refresh that changed nothing.
  return changed ? next : (held as T[]);
}
