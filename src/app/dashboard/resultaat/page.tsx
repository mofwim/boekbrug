// src/app/dashboard/resultaat/page.tsx
// [RESULT→WAARHEID] This screen is now /dashboard/waarheid.
//
// WHY IT MERGED. "Financieel overzicht" and "Je waarheid" rendered the SAME six numbers — both ran
// computeResultForRange over the same quarter bounds, so no arithmetic could ever differ between
// them. What differed was what each said AROUND those numbers, and that is exactly the problem: two
// screens over one engine means every completeness signal has to be implemented twice, and the
// second one is where they get forgotten. It happened: six honesty gaps were closed on waarheid
// (kasstelsel basis, undated paid money, unconfirmed purchases, the exception counters, the ledger
// cross-check, the divergence copy) and this screen still had all six, plus one of its own — its
// card-reconciliation block hid the very instruction that would have fixed it.
//
// The dashboard header had already recorded the decision and named the mechanism: "Truly merging
// waarheid+resultaat is a separate product+page decision; do that at the page level (redirect
// resultaat → waarheid) before removing this link, never by orphaning." This is that redirect.
//
// WHAT MOVED, so nothing was lost with the page:
//   · the Q1–Q4 + year picker  → waarheid's `quarter` lens (truth-lens.ts). It was the one thing
//     this screen could do that waarheid could not: reach an arbitrary historical quarter.
//   · the KAART-CONTROLE block → waarheid, with a wider visibility rule and measured-vs-booked
//     commission split out (see WaarheidClient).
//
// ?year&quarter is carried across, so an existing bookmark of a specific quarter still lands on
// that quarter. The route itself stays — deleting it would 404 those bookmarks.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ResultaatPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const { year, quarter } = await searchParams;
  // Only forward a period that is actually a period; waarheid re-validates it either way and falls
  // back to the default lens, so a junk query can never open a window nobody asked for.
  const y = Number(year);
  const q = Number(quarter);
  const keep =
    Number.isInteger(y) && y >= 2000 && y <= 2100 &&
    Number.isInteger(q) && q >= 1 && q <= 4;
  redirect(keep ? `/dashboard/waarheid?year=${y}&quarter=${q}` : "/dashboard/waarheid");
}
