// src/lib/card-panel.ts
// [COM-IN-DE-REGEL] Does the card-reconciliation panel have anything to say, and does it have
// figures worth printing? Pure, no I/O. Run: npx tsx --test src/lib/card-panel.test.ts
//
// ── WHY A MODULE FOR TWO BOOLEANS ────────────────────────────────────────────────────────────
//
// Because both of them were wrong, in the same way, and nothing could see it. They lived as inline
// conditions in WaarheidClient — one deciding whether the panel exists at all, one deciding whether
// its two stat tiles print — and each listed the triangle's own figures and nothing else:
//
//     eftSettlements > 0 || totalCommission > 0 || grossMismatchDays > 0 || …
//
// That was complete for as long as the triangle was the only way a commission could be found. The
// moment a commission could also come from the bank line itself ([COM-IN-DE-REGEL]), it stopped
// being complete — and the shop it stopped being complete for is every shop in production, because
// `eft_settlements` is empty across the whole database. Such a shop now has its commission booked
// into kosten and every condition above false: the cost is in the figures, and the panel that
// explains where it came from is not on the screen.
//
// A screen that books a cost and cannot show its origin is exactly the failure this repo's control
// surfaces exist to prevent, and a JSX condition is not somewhere a test can reach. So the decision
// moved here, where it can be asserted, and the component asks instead of deciding.
//
// The [NO-ZERO-LEAD] intent is unchanged and is the reason these are two predicates and not one:
// a shop with nothing uploaded must not be met with two tiles reading "€ 0,00" and "0" — a
// confident answer to a question nobody could ask yet. The panel may open to say what is missing
// while the figures stay hidden until they mean something.

/** The reconciliation fields these two decisions read. A subset of RangeResult's. */
export interface CardPanelFacts {
  eftSettlements: number;
  totalCommission: number;
  grossMismatchDays: number;
  incompleteDays: number;
  commissionIssueDays: number;
  /** Optional so a response predating [COM-IN-DE-REGEL] still decides correctly. */
  statedCommission?: { total: number; unverified: number } | null;
}

/**
 * Is there any card activity at all to talk about?
 *
 * Deliberately generous: an incomplete day or a single unreadable settlement line is a reason to
 * open the panel, because the panel is where the owner is told what is missing. Only a window with
 * no card story whatsoever stays closed.
 */
export function cardPanelVisible(rec: CardPanelFacts): boolean {
  return (
    rec.eftSettlements > 0 ||
    rec.totalCommission > 0 ||
    (rec.statedCommission?.total ?? 0) > 0 ||
    (rec.statedCommission?.unverified ?? 0) > 0 ||
    rec.grossMismatchDays > 0 ||
    rec.incompleteDays > 0 ||
    rec.commissionIssueDays > 0
  );
}

/**
 * Are there measured FIGURES worth printing in the two stat tiles?
 *
 * Stricter than the panel itself, and that gap is the [NO-ZERO-LEAD] rule: a panel that opens to
 * say "upload your terminal settlement" is useful; the same panel leading with "€ 0,00" is not.
 */
export function cardStatsVisible(rec: CardPanelFacts): boolean {
  return (
    rec.totalCommission > 0 ||
    rec.eftSettlements > 0 ||
    (rec.statedCommission?.total ?? 0) > 0
  );
}
