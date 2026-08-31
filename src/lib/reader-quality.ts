// src/lib/reader-quality.ts
// [LEESKWALITEIT] How often does a human have to correct what the machine read — and WHERE.
//
// ── WHY THIS EXISTS ──
//
// Measured on one real administration over a year: 586 incoming invoices read, the amount
// corrected by hand on 5, the IBAN on none, and not one correction after the invoice was paid.
// Read as a percentage that is 0.9%, and 0.9% is a number that invites you to relax.
//
// The five were not five failures. They were ONE: the same supplier, five credit notes, all
// numbered CR…, all corrected inside 42 seconds by someone who had just worked out what was
// wrong. The model returned is_credit_note=false on a document that printed its total as
// € -33,87, so a credit was booked as a debt and its btw was ADDED to the reclaim instead of
// subtracted. See creditnota-signal.ts, which names that document by number.
//
// A single percentage hides exactly that shape. Failures do not arrive evenly — they arrive per
// supplier, per document type, per template — and the moment you can see WHICH supplier, a
// systematic misread stops looking like noise and starts looking like a bug with an address.
//
// And it was found because somebody happened to run a query. That is the real gap this closes:
// the same sight, standing, on the operator's own page.
//
// ── WHAT A CORRECTION DOES AND DOES NOT PROVE ──
//
// A correction means a human CHANGED a machine-read number. It is not proof of a misread — the
// owner may be completing something the paper never printed. But an amount or an account number
// is not the kind of field anybody edits for fun, and those two are where money moves.
//
// The opposite is the real limit, and it is stated on the screen rather than hidden: a misread
// NOBODY NOTICED looks exactly like a correct read from here. This measures the error rate that
// was CAUGHT, which is a floor, never the true rate.
//
// Pure. No I/O, no clock of its own — the page hands it rows and a `nowMs`.

import { fetchAllRows } from "@/lib/supabase-paginate";

/** One invoice the reader produced, as the panel needs it. */
export interface ReadInvoice {
  id: string;
  supplierName: string | null;
  createdAtMs: number | null;
  /** The status the row carries TODAY. */
  status: string | null;
}

/** One audit row in which a human changed a machine-read field. */
export interface CorrectionRow {
  invoiceId: string;
  atMs: number | null;
  amountBefore: string | null;
  amountAfter: string | null;
  ibanBefore: string | null;
  ibanAfter: string | null;
}

export interface SupplierTrouble {
  supplierName: string;
  /** How many of this supplier's invoices had an amount or IBAN corrected. */
  corrected: number;
  /** How many of this supplier's invoices were read at all — the denominator that matters. */
  read: number;
}

export interface Correction {
  invoiceId: string;
  supplierName: string;
  atMs: number;
  /** "amount" | "iban" | "both" — what a human actually changed. */
  what: "bedrag" | "iban" | "beide";
  amountBefore: string | null;
  amountAfter: string | null;
  ibanBefore: string | null;
  ibanAfter: string | null;
  /** True when the invoice is paid TODAY — the category that cost money. */
  afterPayment: boolean;
}

export interface ReaderQuality {
  /** Invoices read inside the window. */
  read: number;
  /** …of which a human corrected the amount. */
  amountCorrected: number;
  /** …of which a human corrected the account number. Fraud and misdirected payments live here. */
  ibanCorrected: number;
  /**
   * Corrections on an invoice that is paid today. This is the only figure on the panel that
   * describes money that already left, and it is meant to read as zero.
   */
  afterPayment: number;
  /**
   * Suppliers with more than one corrected invoice, worst first. One supplier appearing twice is
   * worth more attention than two suppliers appearing once: the second is chance, the first is a
   * template the reader does not handle.
   */
  troubleSuppliers: SupplierTrouble[];
  /** The most recent corrections, newest first, capped by the caller's `limit`. */
  recent: Correction[];
}

/** A field changed when both sides are present and differ — a null on either side says nothing. */
function changed(before: string | null, after: string | null): boolean {
  if (before === null || after === null) return false;
  return before.trim() !== after.trim();
}

const NAMELESS = "(zonder leverancier)";

/**
 * Fold the read invoices and the correction rows into one judgement.
 *
 * `windowDays` scopes BOTH sides from `nowMs`: counting a year of corrections against a month of
 * invoices would produce a ratio above 100% and a panel nobody believes twice.
 */
export function judgeReaderQuality(
  invoices: ReadInvoice[],
  corrections: CorrectionRow[],
  opts: { nowMs: number; windowDays: number; recentLimit?: number },
): ReaderQuality {
  const floor = opts.nowMs - opts.windowDays * 24 * 60 * 60 * 1000;
  const inWindow = invoices.filter((i) => i.createdAtMs !== null && i.createdAtMs >= floor);
  const byId = new Map(inWindow.map((i) => [i.id, i]));

  // One invoice corrected three times is ONE invoice the reader got wrong, not three.
  const perInvoice = new Map<string, Correction>();
  for (const c of corrections) {
    if (c.atMs === null || c.atMs < floor) continue;
    const inv = byId.get(c.invoiceId);
    if (!inv) continue; // a correction on an invoice outside the window
    const bedrag = changed(c.amountBefore, c.amountAfter);
    const iban = changed(c.ibanBefore, c.ibanAfter);
    if (!bedrag && !iban) continue;

    const eerder = perInvoice.get(c.invoiceId);
    const what: Correction["what"] =
      bedrag && iban ? "beide" : bedrag ? "bedrag" : "iban";
    // Keep the NEWEST correction as the one shown, but remember that either field was ever touched.
    const samengevoegd: Correction["what"] =
      eerder && eerder.what !== what ? "beide" : what;
    if (!eerder || c.atMs > eerder.atMs) {
      perInvoice.set(c.invoiceId, {
        invoiceId: c.invoiceId,
        supplierName: (inv.supplierName ?? "").trim() || NAMELESS,
        atMs: c.atMs,
        what: samengevoegd,
        amountBefore: c.amountBefore,
        amountAfter: c.amountAfter,
        ibanBefore: c.ibanBefore,
        ibanAfter: c.ibanAfter,
        afterPayment: (inv.status ?? "") === "paid",
      });
    } else if (eerder.what !== what) {
      perInvoice.set(c.invoiceId, { ...eerder, what: "beide" });
    }
  }

  const alle = [...perInvoice.values()];

  // Denominator per supplier over the SAME window, so "2 of 3" and "2 of 400" cannot look alike.
  const readPerSupplier = new Map<string, number>();
  for (const i of inWindow) {
    const naam = (i.supplierName ?? "").trim() || NAMELESS;
    readPerSupplier.set(naam, (readPerSupplier.get(naam) ?? 0) + 1);
  }
  const correctedPerSupplier = new Map<string, number>();
  for (const c of alle) {
    correctedPerSupplier.set(c.supplierName, (correctedPerSupplier.get(c.supplierName) ?? 0) + 1);
  }

  const troubleSuppliers: SupplierTrouble[] = [...correctedPerSupplier.entries()]
    .filter(([, n]) => n > 1)
    .map(([supplierName, corrected]) => ({
      supplierName,
      corrected,
      read: readPerSupplier.get(supplierName) ?? 0,
    }))
    .sort((a, b) => b.corrected - a.corrected || a.supplierName.localeCompare(b.supplierName));

  const recent = alle
    .slice()
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, opts.recentLimit ?? 10);

  return {
    read: inWindow.length,
    amountCorrected: alle.filter((c) => c.what === "bedrag" || c.what === "beide").length,
    ibanCorrected: alle.filter((c) => c.what === "iban" || c.what === "beide").length,
    afterPayment: alle.filter((c) => c.afterPayment).length,
    troubleSuppliers,
    recent,
  };
}

/**
 * The caught error rate as a percentage, one decimal. Null when nothing was read — "0.0%" over
 * zero invoices is a claim the data does not support, and this panel exists to stop exactly that
 * kind of confident emptiness.
 */
export function caughtErrorPct(q: ReaderQuality): number | null {
  if (q.read === 0) return null;
  return Math.round((1000 * (q.amountCorrected + q.ibanCorrected)) / q.read) / 10;
}

// ── De lezing ────────────────────────────────────────────────────────────────
//
// Apart van het oordeel hierboven, en dat scheelt: het oordeel is puur en testbaar met rijen die
// de takken raken, en dit stuk raakt alleen de database.

/**
 * Read what the panel needs, for EVERY account.
 *
 * Paginated on both sides, en dat is geen netheid: `.limit()` op de noemer terwijl de teller
 * compleet is, verhoogt het foutpercentage stilletjes — precies het getal dat dit paneel bestaat
 * om eerlijk te tonen.
 *
 * Faalt de lezing, dan komt er `null` uit en zegt het scherm dat het niet kon kijken. "Nul fouten"
 * en "we konden niet meten" mogen op deze pagina nooit hetzelfde zijn.
 */
export async function readReaderQuality(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  opts: { nowMs: number; windowDays: number; recentLimit?: number },
): Promise<ReaderQuality | null> {
  const sinds = new Date(opts.nowMs - opts.windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const facturen = await fetchAllRows<{
      id: string; client_name: string | null; created_at: string | null; status: string | null;
    }>((lo, hi) =>
      pipeline
        .from("invoices")
        .select("id, client_name, created_at, status")
        .eq("direction", "incoming")
        .gte("created_at", sinds)
        .order("id", { ascending: true })
        .range(lo, hi),
    );

    const trail = await fetchAllRows<{
      entity_id: string | null; created_at: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      old_value: any; new_value: any;
    }>((lo, hi) =>
      pipeline
        .from("audit_logs")
        .select("entity_id, created_at, old_value, new_value")
        .in("action", ["invoice.corrected", "invoice.updated"])
        .eq("entity_type", "invoice")
        .gte("created_at", sinds)
        .order("id", { ascending: true })
        .range(lo, hi),
    );

    const veld = (v: unknown, naam: string): string | null => {
      if (!v || typeof v !== "object") return null;
      const x = (v as Record<string, unknown>)[naam];
      return x === null || x === undefined ? null : String(x);
    };

    return judgeReaderQuality(
      facturen.map((f) => ({
        id: f.id,
        supplierName: f.client_name,
        createdAtMs: f.created_at ? Date.parse(f.created_at) : null,
        status: f.status,
      })),
      trail.flatMap((a) =>
        a.entity_id
          ? [{
              invoiceId: a.entity_id,
              atMs: a.created_at ? Date.parse(a.created_at) : null,
              amountBefore: veld(a.old_value, "total_inc_btw"),
              amountAfter: veld(a.new_value, "total_inc_btw"),
              ibanBefore: veld(a.old_value, "vendor_iban"),
              ibanAfter: veld(a.new_value, "vendor_iban"),
            }]
          : [],
      ),
      opts,
    );
  } catch {
    return null;
  }
}
