// src/lib/truth-lens.ts
// [TRUTH-LENS] The time lens of the waarheid surface: which [start, end] window a lens means.
//
// Pure, injectable, fully testable (run: npx tsx src/lib/truth-lens.test.ts). It used to live
// inside /api/truth, where a Next route cannot export it and so nothing could test it — and it was
// carrying an invariant that had been quietly broken. Lifted out for exactly that reason.
//
// THE INVARIANT: the lenses are whole PERIODS, and periods nest.
//
//     kwartaal ⊆ jaar ⊆ alles
//
// It did not hold. A quarter window ran to the last day of the quarter — correct, and required,
// because it is the tax period and it must line up with the aangifte the screen links to. But
// "Dit jaar" and "Alles" were capped at TODAY. Anything dated ahead of today (an invoice written
// for month-end, a corrected date, a scheduled sale) therefore counted in "Dit kwartaal" and was
// missing from both "Dit jaar" and "Alles" — so a quarter could out-total the year containing it,
// and "Alles" could fail to contain everything. Two figures on one screen contradicting each other
// is the one thing a surface named "je financiële waarheid" cannot ship.
//
// Every period now runs to its own end, and `isLiveWindow` — not a truncated window — is what says
// the period has not finished yet ("loopt nog").

function pad(n: number): string { return String(n).padStart(2, "0"); }
function iso(d: Date): string { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The earliest date "Alles" looks back to — before any real Dutch ZZP bookkeeping in this app. */
export const ALL_TIME_FLOOR = "2015-01-01";
/**
 * The upper bound for "Alles". A plain ISO string compares correctly against every stored date, so
 * nothing dated in the future can fall outside "everything" — which is what the word has to mean.
 */
export const ALL_TIME_CEILING = "9999-12-31";

export type Lens = "this-quarter" | "last-quarter" | "quarter" | "ytd" | "year" | "all" | "custom";

export const LENSES: readonly Lens[] = ["this-quarter", "last-quarter", "quarter", "ytd", "year", "all", "custom"];

/** Narrow an untrusted ?lens value, falling back to the default lens. */
export function parseLens(raw: string | null | undefined): Lens {
  return LENSES.includes(raw as Lens) ? (raw as Lens) : "this-quarter";
}

export interface TruthWindow {
  start: string;               // ISO 'YYYY-MM-DD', inclusive
  end: string;                 // ISO 'YYYY-MM-DD', inclusive
  label: string;               // Dutch, shown as the period heading
  quarter?: number;            // set only for a SINGLE-quarter lens (drives filing + the aangifte link)
  year?: number;               // set for a single-quarter and a single-year lens
  isLiveWindow: boolean;       // the window runs to or past today → the figures are still moving
}

/**
 * Resolve a lens to its window.
 *
 * `todayIso` is the owner's TODAY in Europe/Amsterdam (format-nl.ts `amsterdamToday`), never the
 * server's UTC day: Vercel runs in UTC, so between 00:00 and 02:00 Dutch time getUTCDate() still
 * reports yesterday — and this value decides which QUARTER the owner is shown. Passed in rather
 * than read here so the whole module stays pure and the boundary cases are testable.
 *
 * `params` supplies ?year (lens=year) and ?from/?to (lens=custom).
 */
export function resolveWindow(
  lens: Lens,
  todayIso: string,
  params: { get(key: string): string | null },
): TruthWindow {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7)) - 1; // 0-11
  const curQ = Math.floor(m / 3) + 1;         // 1-4

  const quarterWindow = (qy: number, q: number): TruthWindow => {
    const sm = (q - 1) * 3;
    const startD = new Date(Date.UTC(qy, sm, 1));
    const endD = new Date(Date.UTC(qy, sm + 3, 0)); // day 0 of the next month = last day of this one
    // A quarter whose end is today or in the future is still "living" — not a final period.
    return {
      start: iso(startD), end: iso(endD),
      label: `Kwartaal ${q} ${qy}`, quarter: q, year: qy,
      isLiveWindow: iso(endD) >= todayIso,
    };
  };

  // A calendar year is a whole period exactly like a quarter, so `ytd` and `year` share this rule
  // and differ only in which year they point at. (`ytd` used to stop at today and was labelled
  // "tot nu" — that is what broke containment against the current quarter.)
  const yearWindow = (yr: number): TruthWindow => ({
    start: `${yr}-01-01`, end: `${yr}-12-31`,
    label: `${yr}`, year: yr,
    isLiveWindow: `${yr}-12-31` >= todayIso,
  });

  switch (lens) {
    case "last-quarter": {
      const q = curQ === 1 ? 4 : curQ - 1;
      const qy = curQ === 1 ? y - 1 : y;
      return quarterWindow(qy, q);
    }
    // [NAMED-QUARTER] An EXPLICIT ?year&quarter, so any historical quarter is reachable.
    //
    // The relative lenses only ever reach this quarter and the previous one — there was no way to
    // look at Q1 2024 on this screen at all. The one surface that could was /dashboard/resultaat,
    // whose quarter picker was its only capability the truth screen lacked; absorbing it here is
    // what lets that duplicate screen become a redirect instead of a second place to forget a
    // completeness warning. Same bounds as quarterWindow, so a named quarter and the relative lens
    // that happens to point at it are byte-identical.
    //
    // Out-of-range or malformed values fall back to the current quarter rather than inventing a
    // window: a truth screen must never answer a question it could not parse.
    case "quarter": {
      const qy = Number(params.get("year"));
      const q = Number(params.get("quarter"));
      const valid = Number.isInteger(qy) && qy >= 2000 && qy <= 2100 && Number.isInteger(q) && q >= 1 && q <= 4;
      return valid ? quarterWindow(qy, q) : quarterWindow(y, curQ);
    }
    case "ytd":
      return yearWindow(y);
    case "year":
      return yearWindow(Math.min(2100, Math.max(2000, Number(params.get("year")) || y)));
    case "all":
      return { start: ALL_TIME_FLOOR, end: ALL_TIME_CEILING, label: "Alles", isLiveWindow: true };
    case "custom": {
      const from = params.get("from");
      const to = params.get("to");
      const start = from && DATE_RE.test(from) ? from : `${y}-01-01`;
      const end = to && DATE_RE.test(to) ? to : todayIso;
      // Guard against a reversed range — swap so start ≤ end.
      const [s, e] = start <= end ? [start, end] : [end, start];
      return { start: s, end: e, label: `${s} — ${e}`, isLiveWindow: e >= todayIso };
    }
    case "this-quarter":
    default:
      return quarterWindow(y, curQ);
  }
}
