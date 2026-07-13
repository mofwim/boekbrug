// src/lib/readiness.ts
// [READINESS] The owner's one question — "ben ik klaar voor de boekhouder?" — answered by
// a PURE projection over the financial-truth layer already built (invoices, bank
// reconciliation, till/cash reconciliation, BTW). No new financial logic: it consumes
// signals other modules compute and turns them into ONE verdict + the few things that
// need attention. Fully testable (run: npx tsx src/lib/readiness.test.ts).
//
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

  // ── Invoices (evidence) ──
  verifiedInvoiceCount: number;         // verified in/out invoices in the quarter
  invoicesWithEvidence: number;         // of those, how many carry a source PDF/document
  missingEvidence: string[];            // invoice numbers (or ids) lacking a stored PDF

  // ── Bank ──
  bankTxCount: number;                  // bank transactions DATED in the quarter
  undocumentedCount: number;            // pending outgoing costs still without a document

  // ── Till / cash reconciliation (retail triangle: till ⇄ bank ⇄ drawer) ──
  usesTurnover: boolean;                // daily_turnover rows exist → the triangle applies
  turnoverDays: number;                 // days of dagomzet imported
  reconExceptions: ReconException[];    // days whose witnesses disagree beyond tolerance

  // ── BTW ──
  hasSales: boolean;                    // any sales source at all (invoices/cash/turnover)
  cashOmzetZonderBtw: number;           // euros of cash omzet with NO rate assigned
  quarterDays: number;                  // calendar days in the quarter
  hasUndecidableRate: boolean;          // a sale landed in rubriek 1c (mis-derived rate)
  hasEuPurchase: boolean;               // an EU inkoop (rubriek 4b — accountant handles)
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
}

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
    if (!applicable) notes.push("Nog geen facturen geïmporteerd voor dit kwartaal.");
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
      });
    } else {
      const resolved = Math.max(0, s.bankTxCount - s.undocumentedCount);
      subscore = clamp01(resolved / s.bankTxCount);
      detail = `${resolved} van ${s.bankTxCount} banktransacties verwerkt.`;
      if (s.undocumentedCount > 0) {
        missing.push({
          severity: "missing",
          title:
            s.undocumentedCount === 1
              ? "1 banktransactie wacht nog op een bon"
              : `${s.undocumentedCount} banktransacties wachten nog op een bon`,
          detail: "Uitgaven zonder document tellen niet mee als kosten en verlagen je aftrek.",
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
        missing.push({
          severity: "missing",
          title: `€${euro(s.cashOmzetZonderBtw)} contante omzet zonder BTW-tarief`,
          detail: "Ken 9% of 21% toe — anders staat deze omzet in geen enkele rubriek.",
        });
        detailBits.push("contante omzet zonder tarief");
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
