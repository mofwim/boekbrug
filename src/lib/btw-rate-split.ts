// src/lib/btw-rate-split.ts
// [RUBRIEK-SPLIT] Which BTW rubriek does an invoice's omzet belong to — 1a (21%), 1b (9%) or 1c
// (other)? Pure, no I/O. Run: npx tsx src/lib/btw-rate-split.test.ts
//
// The aangifte does not ask for one omzet number; it asks for omzet PER RATE. The engine derived
// that rate from the invoice HEADER — btw ÷ ex, snapped to the nearest legal rate — which is
// exact for the overwhelming majority of invoices, because they carry one rate. For an invoice
// that genuinely mixes rates it is not:
//
//     €1.000 @ 21% + €1.000 @ 9%  →  header 2.000 ex / 300 btw  →  15%  →  snapped to 21%
//
// The BTW total stays right (€300 is €300), but the whole €2.000 lands in rubriek 1a while €1.000
// of it belongs in 1b. A caterer, a shop selling food next to non-food, a plumber charging
// materials at 21% next to a 9% labour rate — all normal, all currently mis-rubriceerd.
//
// The invoice already knows better: invoice_lines carries the rate per line. This module turns
// those lines into rate buckets, under one strict condition — the buckets must ADD UP to the
// header, or they are not used at all. The header is the money-truth (it is what was invoiced,
// what the customer paid, and what every other figure in this app is derived from); lines are a
// finer description of it. A line set that disagrees with its own header is a corrupt read, not a
// better one, so it is refused rather than trusted.

import { nearestLegalRate } from "./btw-rate";
import { round2 } from "./invoice-totals";

/** Omzet + BTW for ONE legal rate. Signed: a creditnota's shares are negative and net correctly. */
export interface RateShare {
  rate: number;
  ex: number;
  btw: number;
}

/** The raw line as stored (invoice_lines). line_total is EXCL. BTW. */
export interface RateLine {
  btw_rate?: number | null;
  line_total?: number | null;
}

/** Half a cent — below this two amounts are the same amount. */
const EPS = 0.005;
/** How far the lines may collectively drift from the header and still be believed. A cent per
 *  line is normal rounding; more than two cents overall means they describe something else. */
const HEADER_TOLERANCE = 0.02;

const cents = round2;

/**
 * Turn an invoice's lines into rate buckets that sum EXACTLY to its header.
 *
 * Returns null — meaning "use the header rate, as before" — whenever the lines cannot be trusted:
 * no lines, a single rate (nothing to split), or a line sum that misses the header by more than a
 * rounding tick. Never returns buckets that would change the invoice's totals: the residue
 * against the header is placed on the largest bucket, so Σex ≡ headerEx and Σbtw ≡ headerBtw to
 * the cent, always.
 */
export function rateSharesFromLines(
  lines: readonly RateLine[] | null | undefined,
  headerEx: number,
  headerBtw: number,
): RateShare[] | null {
  if (!lines || lines.length === 0) return null;

  const byRate = new Map<number, number>(); // legal rate → ex
  for (const l of lines) {
    const ex = Number(l?.line_total);
    if (!Number.isFinite(ex) || Math.abs(ex) < EPS) continue; // a €0 line is not a bucket
    // A stored rate is what the owner chose per line; snap it to a legal NL rate so a typo like
    // 20 cannot invent a rubriek that does not exist on the aangifte.
    const rate = nearestLegalRate(Math.round(Number(l?.btw_rate ?? 0)));
    byRate.set(rate, (byRate.get(rate) ?? 0) + ex);
  }
  if (byRate.size === 0) return null;
  // One rate ⇒ the header derivation already gives exactly this. Nothing to gain, and returning
  // buckets here would only add a rounding step.
  if (byRate.size === 1) return null;

  const shares: RateShare[] = [...byRate.entries()]
    .map(([rate, ex]) => ({ rate, ex: cents(ex), btw: cents((ex * rate) / 100) }))
    .sort((a, b) => b.rate - a.rate);

  const sumEx = cents(shares.reduce((s, r) => s + r.ex, 0));
  const sumBtw = cents(shares.reduce((s, r) => s + r.btw, 0));
  // The refusal that keeps this safe: lines that do not describe this header are not a better
  // truth about it. (Also catches an invoice whose lines were never saved, or half-saved.)
  if (Math.abs(sumEx - cents(headerEx)) > HEADER_TOLERANCE) return null;
  if (Math.abs(sumBtw - cents(headerBtw)) > HEADER_TOLERANCE) return null;

  // Absorb the rounding residue into the biggest bucket, so the split can never move a cent of
  // the totals — only WHERE they sit.
  const biggest = shares.reduce((a, b) => (Math.abs(b.ex) > Math.abs(a.ex) ? b : a));
  biggest.ex = cents(biggest.ex + (cents(headerEx) - sumEx));
  biggest.btw = cents(biggest.btw + (cents(headerBtw) - sumBtw));
  return shares;
}

/**
 * Split ONE settled amount across an invoice's rate mix, in proportion.
 *
 * Under kasstelsel a payment settles a FRACTION of an invoice, and that fraction carries a
 * proportional share of each rate on it — a €500 instalment on a mixed 21%/9% invoice is not
 * 21% money, it is both. `shares` is the invoice's full rate mix (from rateSharesFromLines);
 * sliceEx/sliceBtw are what this payment booked. The result sums back to the slice exactly, with
 * the residue on the largest bucket, so no cent is created or lost on the way.
 */
export function splitSliceByShares(
  shares: readonly RateShare[] | null | undefined,
  sliceEx: number,
  sliceBtw: number,
): RateShare[] | null {
  if (!shares || shares.length < 2) return null;
  const totalEx = shares.reduce((s, r) => s + r.ex, 0);
  if (Math.abs(totalEx) < EPS) return null;

  // ── [BTW-EIGEN-GEWICHT] The turnover splits by ex; the BTW splits by BTW ──
  //
  // Both used to divide by the ex-share, and on a MIXED-rate invoice that is simply the wrong
  // arithmetic. A plumber's invoice of €1.000 materials @21% (BTW €210) and €1.000 labour @9%
  // (BTW €90) has an even ex-split, so half a payment gave each bucket €75 of BTW — declaring
  // rubriek 1a as €500 turnover with €75 BTW (a 15% rate in the 21% box) and 1b as €500 with €75
  // (a 15% rate in the 9% box). €30 in the wrong rubriek on each side, from a correct invoice.
  //
  // A 0% line makes it worse rather than smaller: €10.000 intracommunautair @0% beside €1.000
  // domestic @21% has 91% of the ex and none of the BTW, so it absorbed 91% of the BTW too — real
  // BTW booked into a rubriek that carries none, and the taxed rubriek left short.
  //
  // The BTW of a slice belongs to each rate in proportion to THAT RATE'S OWN BTW. The ex-weight
  // is kept only for the ex, and as the fallback when there is no BTW to distribute at all (an
  // all-0% mix), where every bucket's share is zero either way.
  const totalBtw = shares.reduce((s, r) => s + r.btw, 0);
  const btwWeighted = Math.abs(totalBtw) >= EPS;

  const out: RateShare[] = shares.map((r) => ({
    rate: r.rate,
    ex: cents(sliceEx * (r.ex / totalEx)),
    btw: cents(sliceBtw * (btwWeighted ? r.btw / totalBtw : r.ex / totalEx)),
  }));
  const sumEx = cents(out.reduce((s, r) => s + r.ex, 0));
  const sumBtw = cents(out.reduce((s, r) => s + r.btw, 0));
  // The rounding residue lands on the biggest bucket of its OWN axis. Since the two axes are now
  // weighted differently, the largest ex-bucket is not necessarily the largest BTW-bucket — and
  // putting a BTW cent on a 0% bucket would be the very error this function just stopped making.
  const biggestEx = out.reduce((a, b) => (Math.abs(b.ex) > Math.abs(a.ex) ? b : a));
  const biggestBtw = out.reduce((a, b) => (Math.abs(b.btw) > Math.abs(a.btw) ? b : a));
  biggestEx.ex = cents(biggestEx.ex + (cents(sliceEx) - sumEx));
  biggestBtw.btw = cents(biggestBtw.btw + (cents(sliceBtw) - sumBtw));
  return out;
}
