// src/lib/readiness.ts
// [READINESS] The owner's one question — "ben ik klaar voor de boekhouder?" — answered by
// a PURE projection over the financial-truth layer already built (invoices, bank
// reconciliation, till/cash reconciliation, BTW). No new financial logic: it consumes
// signals other modules compute and turns them into ONE verdict + the few things that
// need attention. Fully testable (run: npx tsx src/lib/readiness.test.ts).
//
import type { RegimeFlag } from "./regime-flags";
import { BAD_DEBT_MIN_EUR } from "./bad-debt";

// THE SCORE IS NOT COSMETIC. Every point is earned by a PROVABLE condition:
//   score = 100 × Σ(weight·subscore over APPLICABLE dimensions) / Σ(weight over applicable)
// A dimension we cannot measure for this owner (e.g. till reconciliation for a ZZP with no
// turnover) is marked n.v.t. and EXCLUDED from the denominator — never faked to 100%. Each
// dimension's subscore is a ratio of resolved/total real items, so "87%" means literally
// "87% of the applicable readiness checks pass", and the checks are listed. The first time
// the app says a number the boekhouder can disprove, trust is gone — so we only claim what
// the data proves, and every limit is stated in `notes`.

export interface ReadinessSignals {
  quarterLabel: string;                 // "Q1 2026"
  // [AUTO-EXCLUDE-REVIEW] The numeric quarter, so a deep-link can scope the review list to
  // EXACTLY the lines a quarter-scoped count flagged (counted ⟺ shown). Optional so older
  // callers/tests keep compiling (absent → the link opens the all-time review list).
  year?: number;
  quarter?: number;

  // ── Invoices (evidence) ──
  verifiedInvoiceCount: number;         // verified in/out invoices in the quarter
  invoicesWithEvidence: number;         // of those, how many carry a source PDF/document
  missingEvidence: string[];            // invoice numbers (or ids) lacking a stored PDF
  // [PACKAGE-READINESS] Invoices dated in this quarter STILL in the verify queue
  // (status processing/draft). They are real bills the owner hasn't confirmed, so they
  // do NOT count as verified above and would reach the accountant NOWHERE. A genuine
  // "missing invoice" gap — it must block "klaar" until the owner clears the queue.
  // Optional so older callers/tests keep compiling (undefined → 0 → no block).
  unverifiedInvoiceCount?: number;
  // [AUTO-ADVANCE] Invoices the app auto-verified (clean + confident) without a manual tap.
  // They ARE booked correctly in the common case, so this does NOT block "klaar" — but the
  // owner should eyeball them before closing (a confidently-consistent misread has no other
  // human catch). Surfaced as a RISK, not a gap. Optional (undefined → 0 → no nudge).
  autoVerifiedCount?: number;

  // ── Bank ──
  bankTxCount: number;                  // bank transactions DATED in the quarter
  undocumentedCount: number;            // pending outgoing costs still without a document
  // [TRUST-READY] pending INCOMING payments (credits) with no linked invoice AND no
  // category — money in we cannot yet explain. Was invisible to readiness (a credit
  // never "needs a document"), so a payment with no invoice behind it scored the
  // quarter "100% klaar". A genuine gap: revenue the accountant can't tie to a sale.
  unmatchedIncomeCount: number;
  // [RD6] Bank credits the owner categorised 'omzet' (so they're booked as NEW revenue) whose exact
  // amount also matches an existing invoice's gross — probably an invoice PAYMENT mis-tapped as
  // omzet, which would double-count the sale (the invoice already booked it on its own date). A
  // risk to eyeball, not a hard block. Optional (older callers omit it → treated as 0).
  probablePaymentAsOmzetCount?: number;
  // [AUTO-EXCLUDE-REVIEW] Bank lines the app AUTO-CODED (category_confirmed=false) into an EXCLUDED
  // identity — privé / overboeking / belasting (pnlRole 'excluded') — that the owner never reviewed.
  // An excluded line is removed from omzet, kosten AND BTW entirely, and it is invisible to every
  // other readiness signal (undocumentedCount skips non-'kosten'; unmatchedIncomeCount needs a null
  // category). So a real business receipt or cost the classifier MISlabelled (a look-alike name, a
  // memory-key collision) silently falls out of the whole administration with no trace — a hidden
  // cost/revenue (constraint #1) that a green "klaar" would paper over (constraint #3). A RISK, never
  // a hard block: these are USUALLY correct (BTW payments, ATM, private withdrawals), so blocking
  // every quarter would make the verdict useless — but the owner must be told to eyeball them once.
  // Self-clearing: confirming a line (category_confirmed=true) drops it from this count. Optional
  // (undefined → 0 → no risk) so older callers/tests are unchanged.
  unreviewedExcludedCount?: number;

  // ── Till / cash reconciliation (retail triangle: till ⇄ bank ⇄ drawer) ──
  usesTurnover: boolean;                // daily_turnover rows exist → the triangle applies
  turnoverDays: number;                 // days of dagomzet imported
  reconExceptions: ReconException[];    // days whose witnesses disagree beyond tolerance

  // ── BTW ──
  hasSales: boolean;                    // any sales source at all (invoices/cash/turnover)
  cashOmzetZonderBtw: number;           // euros of omzet with NO rate assigned (cash + bank + till)
  // Of cashOmzetZonderBtw, the portion from BANK revenue or an un-split till day. > 0 → the
  // rate split needs the Z-report (dagomzet), so the fix points there, not to Kas. Optional
  // so older callers keep compiling (undefined → treated as 0 → the old Kas/Dagomzet rule).
  omzetZonderBtwNonCash?: number;
  quarterDays: number;                  // calendar days in the quarter
  hasUndecidableRate: boolean;          // a sale landed in rubriek 1c (mis-derived rate)
  hasEuPurchase: boolean;               // an EU inkoop (rubriek 4b — accountant handles)
  // [KAS-NEGATIEF] The lowest point the cash drawer reached this quarter, when it went BELOW zero
  // (from lowestDrawerPoint). A negative kassaldo is physically impossible and the single biggest
  // red flag the Belastingdienst uses to reject a cash administration (it implies hidden omzet), so
  // it must BLOCK "klaar". Optional so older callers/tests keep compiling (undefined → no block).
  negativeCashDay?: { date: string; balance: number } | null;
  // [REGIME-FLAGS] Special BTW regimes the concept aangifte does NOT auto-compute (KOR active,
  // BTW verlegd, margeregeling). They do NOT block "klaar" — the owner did their part by
  // importing the data — but they must travel to the accountant flagged, so they surface as
  // RISKS. Optional so older callers/tests keep compiling (undefined → none).
  regimeFlags?: RegimeFlag[];
  // [KASSTELSEL] Under cash basis: paid money we could NOT date must BLOCK "klaar" — it would
  // otherwise silently under-declare the quarter's BTW. estimatedPaidCount (paid-date only an
  // estimate) also blocks, because a wrong estimate places the BTW in the wrong quarter. Both
  // optional (undefined → 0 → no block) so factuur callers/tests are unchanged.
  undatedPaidCount?: number;
  estimatedPaidCount?: number;
  // [DATE-GAP] Geverifieerde facturen ZONDER factuurdatum. Postgres-bereikfilters
  // (.gte/.lte op invoice_date) laten NULL-rijen stil vallen, dus zo'n factuur hoort bij deze
  // eigenaar, is gecontroleerd, en zit tóch in GEEN enkel kwartaalpakket en in GEEN enkele
  // concept-aangifte — haar BTW verdwijnt gewoon. Elke andere plek in de app rekent er al mee
  // (het pakket waarschuwt erover); alleen dit scherm, dat het eindoordeel "ben ik klaar?"
  // uitspreekt, wist er niets van en kon dus 100% klaar melden terwijl er geld buiten beeld lag.
  //
  // Bewust een RISICO en geen ontbrekend item: de telling is ALL-TIME, dus een harde blokkade
  // zou al ingediende kwartalen voorgoed rood zetten — ook op het werkbord van de boekhouder.
  // Als risico trekt hij de eerlijkheidsgrens hieronder (100 → 99) en is "stil klaar" onmogelijk.
  datelessInvoiceCount?: number;
  // [BAD-DEBT] Sales invoices > 1 year past due and still unpaid (factuur only): the BTW paid on
  // them is reclaimable (oninbare vordering). A helpful nudge (risk), never a block — it's money to
  // get back, not a gap. Optional (undefined → none).
  badDebt?: { count: number; reclaimableBtw: number };
}

export interface ReconException {
  date: string;                         // 'YYYY-MM-DD'
  kind: string;                         // pin | cash | internal | unknown
  note: string;                         // human-readable
  diff: number;                         // signed euro gap
}

export type DimensionKey = "invoices" | "bank" | "cash" | "vat";

export interface ReadinessDimension {
  key: DimensionKey;
  label: string;                        // Dutch
  weight: number;                       // 30 / 30 / 20 / 20
  applicable: boolean;                  // false → n.v.t., excluded from the score
  subscore: number;                     // 0..1 (0 when not applicable)
  detail: string;                       // Dutch, what this dimension found
}

export interface ReadinessItem {
  severity: "missing" | "risk";         // missing = a gap that lowers readiness;
                                        // risk = a reconciliation signal to eyeball
  title: string;                        // Dutch, specific
  detail?: string;
  // [ACTIONABLE] Where the owner fixes THIS gap. A readiness item that only STATES a
  // problem with no way to act on it is a dead-end — the owner has to hunt the menu. Set
  // only when the destination is unambiguous; omitted when we can't be sure (better no
  // link than a wrong one). The UI renders the item as a tap-through when present.
  fix?: { label: string; href: string };
}

// The owner-facing fix destinations (dashboard routes). Kept here so the gap and its
// remedy are defined together and never drift.
const FIX = {
  bank: { label: "Naar Bank", href: "/dashboard/bank" },
  dagomzet: { label: "Naar Dagomzet", href: "/dashboard/dagomzet" },
  kas: { label: "Naar Kas", href: "/dashboard/kas" },
  nieuweFactuur: { label: "Omzet invoeren", href: "/dashboard/invoice/new" },
  facturen: { label: "Naar Facturen", href: "/dashboard/facturen" },
} as const;

export type ReadinessStatus = "ready" | "almost" | "attention";

export interface ReadinessReport {
  quarterLabel: string;
  score: number;                        // 0..100, whole number
  status: ReadinessStatus;
  ready: boolean;                       // status === "ready"
  dimensions: ReadinessDimension[];     // the rubric, always all four (some n.v.t.)
  missing: ReadinessItem[];             // fix-these — gaps
  risks: ReadinessItem[];               // eyeball-these — reconciliation differences
  notes: string[];                      // honest limits of this verdict
}

const DIM_LABEL: Record<DimensionKey, string> = {
  invoices: "Facturen & bonnen",
  bank: "Bank verwerkt",
  cash: "Kassa & kas sluit aan",
  vat: "BTW compleet",
};
const DIM_WEIGHT: Record<DimensionKey, number> = { invoices: 30, bank: 30, cash: 20, vat: 20 };

const euro = (n: number) => Math.round(n);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Build the readiness verdict from the signals. Pure — the caller gathers the signals
 * (from summarizeClosingPackage / computeResult / buildTurnoverClosing / buildAangifte)
 * and this decides the score, the status, and the two short lists.
 */
export function buildReadiness(s: ReadinessSignals): ReadinessReport {
  const dimensions: ReadinessDimension[] = [];
  const missing: ReadinessItem[] = [];
  const risks: ReadinessItem[] = [];
  const notes: string[] = [];

  // ── 1) Invoices & bonnen (30%) — every verified invoice must carry its source PDF ──
  {
    const applicable = s.verifiedInvoiceCount > 0;
    const withEv = Math.min(s.invoicesWithEvidence, s.verifiedInvoiceCount);
    const subscore = applicable ? clamp01(withEv / s.verifiedInvoiceCount) : 0;
    const gap = s.verifiedInvoiceCount - withEv;
    dimensions.push({
      key: "invoices",
      label: DIM_LABEL.invoices,
      weight: DIM_WEIGHT.invoices,
      applicable,
      subscore,
      detail: applicable
        ? `${withEv} van ${s.verifiedInvoiceCount} facturen met origineel document.`
        : "Geen facturen in dit kwartaal — dit onderdeel telt niet mee.",
    });
    if (applicable && gap > 0) {
      missing.push({
        severity: "missing",
        title: gap === 1 ? "1 factuur mist het originele document" : `${gap} facturen missen het originele document`,
        detail: s.missingEvidence.length
          ? `Zonder PDF: ${s.missingEvidence.slice(0, 5).join(", ")}${s.missingEvidence.length > 5 ? " …" : ""}. De boekhouder kan deze niet controleren.`
          : "De boekhouder kan deze niet controleren zonder de bon/factuur.",
      });
    }
    // [PACKAGE-READINESS] Unverified invoices dated in the quarter block "klaar": they are
    // real bills sitting in the verify queue and would never reach the accountant. This is
    // separate from the evidence gap above (that's about verified invoices without a PDF).
    const unverified = s.unverifiedInvoiceCount ?? 0;
    if (unverified > 0) {
      missing.push({
        severity: "missing",
        title:
          unverified === 1
            ? "1 factuur staat nog in de verwerkingsrij"
            : `${unverified} facturen staan nog in de verwerkingsrij`,
        detail: "Controleer en bevestig deze facturen voordat je afsluit — anders gaan ze niet mee naar de boekhouder.",
        fix: { label: "Naar Facturen", href: "/dashboard/incoming" },
      });
    }
    if (!applicable) notes.push("Nog geen facturen geïmporteerd voor dit kwartaal.");

    // [AUTO-ADVANCE] Auto-verified invoices are booked, but the quarter-close is the moment to
    // eyeball them — a confidently-consistent misread has no other human catch. A RISK (review),
    // never a blocking gap, so daily automation stays hands-off.
    const autoV = s.autoVerifiedCount ?? 0;
    if (autoV > 0) {
      risks.push({
        severity: "risk",
        title: autoV === 1 ? "1 factuur is automatisch verwerkt" : `${autoV} facturen zijn automatisch verwerkt`,
        detail: "De app heeft deze duidelijk leesbare facturen automatisch geverifieerd. Loop ze even na (tab 'Automatisch verwerkt') voordat je afsluit.",
        fix: { label: "Bekijk", href: "/dashboard/incoming/manage" },
      });
    }
  }

  // ── 2) Bank (30%) — data present, and every line resolved (income/transfer/known cost,
  //       or a cost that has its bon). Subscore = resolved / total bank lines. ──
  {
    const applicable = true; // every business moves money; absence of data is itself a gap
    let subscore = 0;
    let detail: string;
    if (s.bankTxCount === 0) {
      subscore = 0;
      detail = "Geen banktransacties voor dit kwartaal gevonden.";
      missing.push({
        severity: "missing",
        title: "Bankafschrift ontbreekt",
        detail: "Upload het bankafschrift van dit kwartaal — zonder bank kan de boekhouder niets aansluiten.",
        fix: FIX.bank,
      });
    } else {
      // [NO-CODEER] The per-line "give every bank debit a category" flow is intentionally
      // NOT a readiness gap. For a retail administration costs belong on the INCOMING
      // invoice (which carries the BTW you reclaim) and revenue on the Z-report/dagomzet —
      // hand-coding a bare bank debit as a cost gives no voorbelasting and risks double
      // counting the invoice you already booked. So undocumentedCount (uncoded cost debits)
      // no longer lowers the score. The ONE bank signal that survives is unmatched INCOME:
      // money in with no invoice behind it, which would silently understate omzet — that
      // still blocks "klaar". (undocumentedCount stays computed for other surfaces; it just
      // no longer drives readiness.)
      const openBank = s.unmatchedIncomeCount;
      const resolved = Math.max(0, s.bankTxCount - openBank);
      subscore = clamp01(resolved / s.bankTxCount);
      detail = `${resolved} van ${s.bankTxCount} banktransacties verwerkt.`;
      if (s.unmatchedIncomeCount > 0) {
        // The one thing a bank check exists to catch: money in with no invoice behind
        // it. A genuine gap — it blocks "klaar" so the owner links it or explains it.
        missing.push({
          severity: "missing",
          title:
            s.unmatchedIncomeCount === 1
              ? "1 ontvangen betaling zonder factuur"
              : `${s.unmatchedIncomeCount} ontvangen betalingen zonder factuur`,
          detail: "Koppel de betaling aan een factuur of geef aan wat het is (bijv. huur, lening, privé). Onverklaarde omzet kan de boekhouder niet aansluiten.",
          fix: FIX.bank,
        });
      }
      // [VOORBELASTING-RISK] Supplier-like payments (needsDocument) paid by bank with NO purchase
      // invoice behind them: the deductible BTW (voorbelasting, 5b) on those costs is not claimed,
      // so the owner would pay MORE BTW than needed. Per [NO-CODEER] we do NOT hand-code the debit
      // (coding a bare debit yields no voorbelasting and risks double-counting the invoice) — we
      // surface it as a RISK to upload the inkoopfactuur. It doesn't hard-block daily automation,
      // but it means readiness can never say "klaar" in silence while deductible BTW is missing.
      if (s.undocumentedCount > 0) {
        risks.push({
          severity: "risk",
          title:
            s.undocumentedCount === 1
              ? "1 leverancierbetaling zonder inkoopfactuur"
              : `${s.undocumentedCount} leverancierbetalingen zonder inkoopfactuur`,
          detail: "Je hebt deze kosten per bank betaald, maar er is nog geen inkoopfactuur. Upload de factuur — anders mis je de BTW-aftrek (voorbelasting) op deze kosten en betaal je te veel.",
          fix: FIX.bank,
        });
      }
      // [RD6] A bank credit booked as 'omzet' whose amount equals an existing invoice is probably a
      // factuurbetaling mis-tapped as revenue — booking it AND the invoice double-counts the sale.
      const dubbel = s.probablePaymentAsOmzetCount ?? 0;
      if (dubbel > 0) {
        risks.push({
          severity: "risk",
          title:
            dubbel === 1
              ? "1 ontvangst als omzet geboekt lijkt op een factuurbetaling"
              : `${dubbel} ontvangsten als omzet geboekt lijken op een factuurbetaling`,
          detail: "Het bedrag is gelijk aan een factuur. Als dit de betaling van die factuur is, koppel hem — anders telt de omzet dubbel (de factuur telt al mee).",
          fix: FIX.bank,
        });
      }
      // [AUTO-EXCLUDE-REVIEW] Lines the app auto-coded as privé/overboeking/belasting and the owner
      // never confirmed. These are EXCLUDED from omzet, kosten and BTW, so a MISlabelled one silently
      // hides a real receipt or cost. A RISK (self-clearing on confirm), never a block — most are
      // correct, but readiness must not say "klaar" in silence while machine-excluded money sits
      // unreviewed. Points at the review list so one pass clears the correct ones.
      const autoExcluded = s.unreviewedExcludedCount ?? 0;
      if (autoExcluded > 0) {
        // Scope the deep-link to THIS quarter AND to only the excluded (privé/overboeking/belasting)
        // lines, so the review list shows EXACTLY the counted set — counted ⟺ shown. Without the
        // quarter scope an older quarter's flagged lines could fall off the review page; without
        // only=excluded the owner would hunt the flagged rows among unrelated omzet/kosten lines and
        // the small excluded set keeps the 200-row page from truncating the oldest ones. Falls back
        // to the all-time excluded review list when the quarter isn't known.
        const reviewHref =
          s.year && s.quarter
            ? `/dashboard/bank/categoriseren?view=review&only=excluded&year=${s.year}&quarter=${s.quarter}`
            : "/dashboard/bank/categoriseren?view=review&only=excluded";
        risks.push({
          severity: "risk",
          title:
            autoExcluded === 1
              ? "1 bankregel automatisch als privé/overboeking/belasting geboekt"
              : `${autoExcluded} bankregels automatisch als privé/overboeking/belasting geboekt`,
          detail:
            "Deze regel(s) zijn automatisch ingedeeld als privé, overboeking of belasting en tellen daarom NIET mee in je omzet, kosten of BTW. Controleer eenmalig of er geen zakelijke ontvangst of kost tussen zit — die zou anders buiten je boekhouding vallen.",
          fix: { label: "Controleer", href: reviewHref },
        });
      }
    }
    dimensions.push({ key: "bank", label: DIM_LABEL.bank, weight: DIM_WEIGHT.bank, applicable, subscore, detail });
  }

  // ── 3) Kassa & kas (20%) — the retail triangle. Applicable ONLY when the store keeps a
  //       till (turnover): otherwise there is nothing to reconcile and we DON'T fake it. ──
  {
    const applicable = s.usesTurnover && s.turnoverDays > 0;
    let subscore = 0;
    let detail: string;
    if (!applicable) {
      detail = "Geen kassa-omzet — dit onderdeel telt niet mee.";
    } else {
      const exceptionDays = new Set(s.reconExceptions.map((e) => e.date)).size;
      const okDays = Math.max(0, s.turnoverDays - exceptionDays);
      subscore = clamp01(okDays / s.turnoverDays);
      detail = `${okDays} van ${s.turnoverDays} kassadagen sluiten aan met bank en kas.`;
      // [KAS-NEGATIEF] A negative drawer zeroes the cash subscore so the number visibly reflects the
      // red flag (the line-409 honesty guard only caps 100→99). The hard block is the missing gate
      // below (independent of till applicability); this only shapes the displayed score.
      if (s.negativeCashDay && s.negativeCashDay.balance < 0) {
        subscore = 0;
        detail = `Kassaldo negatief op ${s.negativeCashDay.date} — dit onderdeel sluit niet aan.`;
      }
      // Each disagreeing day is a RISK the owner should eyeball (not a blocking gap): it
      // travels to the accountant flagged, but a big daily gap is exactly what to catch.
      for (const e of s.reconExceptions) {
        risks.push({
          severity: "risk",
          title: `${e.date}: ${describeBreak(e)}`,
          detail: e.note,
        });
      }
    }
    dimensions.push({ key: "cash", label: DIM_LABEL.cash, weight: DIM_WEIGHT.cash, applicable, subscore, detail });
  }

  // [KAS-NEGATIEF] A negative cash balance blocks "klaar" — OUTSIDE the till-applicability guard on
  // purpose: a pure-cash ZZP (no daily_turnover → the cash dimension is n.v.t.) can still run the
  // drawer below zero, and a legally-impossible drawer must never ship as ready. Pushing a `missing`
  // item makes missing.length > 0, so the final verdict can never be "ready". Never a wrong number —
  // it computes nothing, it only refuses to say "klaar" on an impossible drawer (constraint: no
  // false reassurance). The starting float is honored (opening balance from profile), so a shop that
  // legitimately opened with cash in the till is not falsely flagged.
  if (s.negativeCashDay && s.negativeCashDay.balance < 0) {
    missing.push({
      severity: "missing",
      title: `Kassaldo negatief op ${s.negativeCashDay.date}: €${Math.abs(s.negativeCashDay.balance).toFixed(2)}`,
      detail:
        "Een negatief kassaldo kan niet — je kunt geen contant geld uitgeven dat er niet is. Dit is de grootste rode vlag voor de Belastingdienst (het wijst op niet-geboekte omzet). Controleer je beginsaldo, kasontvangsten en kasuitgaven.",
      fix: FIX.kas,
    });
  }

  // [KASSTELSEL] Under cash basis, paid money that couldn't be dated must BLOCK "klaar": its BTW
  // can't be placed in a quarter, so the aangifte would be silently too low. A hard gap (pushing
  // `missing`), with the fix pointing to the bank screen where the owner links the payment.
  const undatedPaid = s.undatedPaidCount ?? 0;
  if (undatedPaid > 0) {
    missing.push({
      severity: "missing",
      title: undatedPaid === 1
        ? "1 betaalde factuur zonder betaaldatum"
        : `${undatedPaid} betaalde facturen zonder betaaldatum`,
      detail: "Je administratie staat op kasstelsel: de BTW telt op de betaaldatum. Deze betaalde factu(u)r(en) hebben geen datum, dus de BTW kan niet in het juiste kwartaal — koppel de bankbetaling of vul de betaaldatum in.",
      fix: FIX.bank,
    });
  }
  const dateless = s.datelessInvoiceCount ?? 0;
  if (dateless > 0) {
    risks.push({
      severity: "risk",
      title: dateless === 1
        ? "1 gecontroleerde factuur heeft geen datum"
        : `${dateless} gecontroleerde facturen hebben geen datum`,
      detail:
        "Zonder factuurdatum valt een factuur buiten elk kwartaal: ze komt in geen enkel " +
        "kwartaalpakket en in geen enkele concept-aangifte, dus haar BTW telt nergens mee. " +
        "Vul de datum aan, dan telt ze weer gewoon mee.",
      fix: FIX.facturen,
    });
  }
  const estimatedPaid = s.estimatedPaidCount ?? 0;
  if (estimatedPaid > 0) {
    risks.push({
      severity: "risk",
      title: estimatedPaid === 1
        ? "1 betaaldatum is een schatting"
        : `${estimatedPaid} betaaldata zijn een schatting`,
      detail: "De betaaldatum is 'handmatig betaald' i.p.v. uit een bankregel — controleer of het kwartaal klopt (onder kasstelsel bepaalt de betaaldatum het BTW-tijdvak).",
      fix: FIX.bank,
    });
  }

  // A business with money movement but NO recorded revenue is not a "channel we don't
  // use" — it is an incomplete quarter. `hasActivity` distinguishes an empty quarter
  // (nothing to judge → BTW genuinely n.v.t.) from a quarter that HAS bank/purchase
  // activity yet no sales side (a real gap, never n.v.t. — see the BTW block below).
  const hasActivity =
    s.bankTxCount > 0 || s.verifiedInvoiceCount > 0 || s.turnoverDays > 0 || s.cashOmzetZonderBtw > 0;

  // ── 4) BTW (20%) — is the omzet fully recorded, rated and covered? When there IS a
  //       sales side: check rating, kassadag coverage, and undecidable rate. When there
  //       is activity but NO sales side at all (bank-only): this is a GAP (subscore 0 +
  //       a 'missing' item), NOT n.v.t. — otherwise a lone bank statement would score
  //       100% "klaar" while zero revenue is recorded. Only a truly empty quarter is
  //       n.v.t. here. ──
  {
    const salesApplicable = s.hasSales;
    const applicable = s.hasSales || hasActivity;
    const checks: boolean[] = [];
    const detailBits: string[] = [];
    if (salesApplicable) {
      // a) all cash omzet has a rate
      const ratedOk = s.cashOmzetZonderBtw <= 0;
      checks.push(ratedOk);
      if (!ratedOk) {
        // [FIX-ROUTING] Where the owner splits this omzet by tarief depends on its SOURCE,
        // not just on whether the store keeps a till. Bank-received omzet (pin/card
        // settlements) and un-split till days both get their 9%/21% split from the
        // Z-report → the fix is Dagomzet. Only PLAIN cash (no bank, no till) is fixed at
        // Kas. Routing bank omzet to "Naar Kas" sent the owner to the wrong screen — the
        // common retail case (money arrives on the bank, the rate lives in the Z-report).
        const fromZReport = (s.omzetZonderBtwNonCash ?? 0) > 0;
        missing.push({
          severity: "missing",
          title: `€${euro(s.cashOmzetZonderBtw)} omzet zonder BTW-tarief`,
          detail: fromZReport
            ? "Deze omzet kwam via de bank of een kassadag binnen zonder tarief. Importeer het Z-rapport bij Dagomzet zodat de 9%/21%-verdeling meekomt — anders staat deze omzet in geen enkele rubriek."
            : "Ken 9% of 21% toe — anders staat deze omzet in geen enkele rubriek.",
          fix: fromZReport || s.usesTurnover ? FIX.dagomzet : FIX.kas,
        });
        detailBits.push("omzet zonder tarief");
      }
      // b) full kassadag coverage (only when the store uses a till)
      if (s.usesTurnover) {
        const coverageOk = s.turnoverDays >= s.quarterDays;
        checks.push(coverageOk);
        if (!coverageOk) {
          missing.push({
            severity: "missing",
            title: `${s.turnoverDays} van ${s.quarterDays} kassadagen geïmporteerd`,
            detail: "Ontbrekende dagen tellen niet mee in de omzet — controleer of alle Z-rapporten erin zitten.",
            fix: FIX.dagomzet,
          });
          detailBits.push(`${s.quarterDays - s.turnoverDays} kassadagen ontbreken`);
        }
      }
      // c) no undecidable rate slipping into rubriek 1c
      const rateOk = !s.hasUndecidableRate;
      checks.push(rateOk);
      if (!rateOk) {
        risks.push({
          severity: "risk",
          title: "Een verkoop heeft een onbekend BTW-tarief (rubriek 1c)",
          detail: "Controleer de betreffende factuur/omzet zodat de BTW in het juiste vak staat.",
        });
        detailBits.push("onbekend tarief");
      }
    }
    let subscore: number;
    let detail: string;
    if (salesApplicable) {
      const passed = checks.filter(Boolean).length;
      subscore = checks.length > 0 ? passed / checks.length : 1;
      detail = detailBits.length === 0
        ? "Omzet volledig ingedeeld per BTW-tarief."
        : `Aandacht: ${detailBits.join(", ")}.`;
      if (s.hasEuPurchase) {
        notes.push("Er zijn EU-inkopen: BTW-verlegging (rubriek 4b) wordt niet automatisch berekend — je boekhouder verwerkt dit.");
      }
    } else if (applicable) {
      // Activity but no revenue recorded at all — the whole sales side is missing.
      subscore = 0;
      detail = "Nog geen omzet vastgelegd (geen verkoopfacturen, kassa of kas-omzet).";
      missing.push({
        severity: "missing",
        title: "Nog geen omzet vastgelegd",
        detail: "Er is wel bank- of inkoopactiviteit, maar geen verkoopfacturen, kassa-omzet of kas-omzet. Controleer of je omzet is ingevoerd voordat je afsluit.",
        fix: s.usesTurnover ? FIX.dagomzet : FIX.nieuweFactuur,
      });
    } else {
      subscore = 0;
      detail = "Nog geen gegevens — dit onderdeel telt niet mee.";
    }
    dimensions.push({ key: "vat", label: DIM_LABEL.vat, weight: DIM_WEIGHT.vat, applicable, subscore, detail });
  }

  // Honest limit on voorbelasting (fix D): we can only reclaim BTW on inkoopfacturen the
  // owner actually entered — an un-entered bon means the aftrek is too low. Stated when
  // there is any activity (not on a truly empty quarter).
  if (hasActivity) {
    notes.push("Voorbelasting telt alleen ingevoerde inkoopfacturen/bonnen — ontbreekt er een bon, dan is je BTW-aftrek te laag en betaal je te veel.");
  }

  // [REGIME-FLAGS] Special regimes (KOR / BTW verlegd / margeregeling) travel to the accountant
  // flagged as RISKS — never a blocking gap (the owner imported the data; the regime is the
  // accountant's to apply). A KOR-active shop, a verlegd purchase or a margeregeling sale would
  // otherwise silently ride out in a concept whose 5a is computed as if the regime didn't apply.
  for (const f of s.regimeFlags ?? []) {
    risks.push({
      severity: "risk",
      title: f.title,
      detail: f.evidence ? `${f.detail} (bijv. factuur ${f.evidence})` : f.detail,
    });
  }

  // [BAD-DEBT] Sales invoices >1 year past due and still unpaid: the BTW you declared on them is
  // reclaimable (oninbare vordering, art. 29 Wet OB). Always a RISK, never a blocking gap — it is
  // money to get BACK, so it can never make an aangifte "too low", and whether/when to reclaim is
  // the owner's/accountant's call. Kasstelsel never reaches here (collector short-circuits to none).
  if (s.badDebt && s.badDebt.reclaimableBtw >= BAD_DEBT_MIN_EUR && s.badDebt.count > 0) {
    const n = s.badDebt.count;
    risks.push({
      severity: "risk",
      title: `${n} onbetaalde factu${n === 1 ? "ur" : "ren"} >1 jaar — €${euro(s.badDebt.reclaimableBtw)} BTW terugvraagbaar`,
      detail:
        "Deze verkoopfactu(u)r(en) staan meer dan een jaar na de vervaldatum open. De BTW die je hierover hebt afgedragen kun je terugvragen (oninbare vordering, art. 29 Wet OB). Dit wordt NIET automatisch verrekend — bespreek met je boekhouder in welk tijdvak je het terugvraagt.",
      fix: FIX.facturen,
    });
  }

  // ── The score: weighted mean over APPLICABLE dimensions only (n.v.t. is excluded, never
  //    counted as 0 or as 100 — we don't inflate or punish for what we can't measure). ──
  const applicableWeight = dimensions.filter((d) => d.applicable).reduce((sum, d) => sum + d.weight, 0);
  const earned = dimensions.filter((d) => d.applicable).reduce((sum, d) => sum + d.weight * d.subscore, 0);
  let score = applicableWeight > 0 ? Math.round((100 * earned) / applicableWeight) : 0;
  // Honesty guard: never show a perfect 100% while anything still needs attention. A
  // single off-day among 90 rounds the reconciliation ratio to 100 — but if there is a
  // gap or a flagged risk, 100% would read as "nothing to check", which is false.
  if (score >= 100 && (missing.length > 0 || risks.length > 0)) score = 99;

  const isEmpty =
    s.verifiedInvoiceCount === 0 && s.bankTxCount === 0 && s.turnoverDays === 0 && !s.hasSales;
  if (isEmpty) {
    notes.push("Er zijn nog geen gegevens om te beoordelen — importeer facturen, bank of dagomzet.");
  }
  notes.push("Deze score meet alleen wat is geïmporteerd. Ontbreekt er een bron, dan is het beeld nog niet compleet.");

  // ── Status: 'ready' only when NOTHING is missing AND the score is high. Documented
  //    risks may remain (they travel to the accountant flagged) — but a gap never hides. ──
  const hasData = applicableWeight > 0;
  let status: ReadinessStatus;
  if (hasData && missing.length === 0 && score >= 90) status = "ready";
  else if (hasData && score >= 70) status = "almost";
  else status = "attention";

  return {
    quarterLabel: s.quarterLabel,
    score,
    status,
    ready: status === "ready",
    dimensions,
    missing,
    risks,
    notes,
  };
}

/** Human one-liner for a reconciliation break, in the owner's terms. */
function describeBreak(e: ReconException): string {
  const abs = Math.abs(euro(e.diff));
  if (e.kind === "pin") {
    return e.diff > 0
      ? `bank ontving €${abs} méér pin dan de kassa telde`
      : `bank ontving €${abs} minder pin dan de kassa telde`;
  }
  if (e.kind === "cash") {
    return e.diff > 0
      ? `€${abs} méér contant geteld dan de kassa aangaf`
      : `€${abs} minder contant geteld dan de kassa aangaf`;
  }
  if (e.kind === "internal") return `kassa telt intern €${abs} niet op`;
  return `€${abs} onverklaard verschil`;
}
