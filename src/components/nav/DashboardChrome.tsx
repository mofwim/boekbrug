// src/components/nav/DashboardChrome.tsx
// [SUBNAV] Route-aware host for the shared sub-page header. Mounted ONCE in
// src/app/dashboard/layout.tsx, before {children}, so any dashboard page can
// inherit a consistent top bar without drawing its own.
//
// Same philosophy as GlobalSearchLauncher: a simple, deterministic path list —
// no DOM probing. We render the shared SubPageHeader ONLY on routes that today
// have NO top chrome and NO way back (the "worst-first" set the owner asked us
// to fix first). Pages that already own their chrome render nothing here and are
// left exactly as they were:
//   - the two home pages ("/dashboard", "/dashboard/accountant") — full DashboardHeader
//   - pages with their own bespoke sticky bar (facturen, bank, invoice/*, werkplek,
//     clients/*, klanten, incoming/manage, accountant/werkplek, clients/beheer)
//   - /dashboard/bestanden/* — its own Drive-style header
// As later PRs migrate those bespoke bars onto this shared header, add their exact
// path + title here and delete the hand-rolled bar. Matching is EXACT-path to
// avoid prefix collisions (e.g. "/dashboard/incoming" gets a bar, but its child
// "/dashboard/incoming/manage" — which has its own — does not).

"use client";

import { usePathname } from "next/navigation";
import SubPageHeader from "./SubPageHeader";

// Exact route → page title. Scoped tightly to the GENUINELY stranded pages: those
// that today render NO top bar AND NO back affordance at all. Verified page-by-page —
// every other /dashboard sub-page already ships either its own sticky top bar
// (settings, messages, incoming) or at least an in-flow back link (kas, aangifte,
// dagomzet, upload, quarterly, klaar, resultaat, artikelen, kluis), so adding this
// bar there would double a header or a back control. Those pages are migrated to the
// shared bar in a later step (replacing their bespoke chrome, not stacking on it).
const SUBPAGE_TITLES = new Map<string, string>([
  ["/dashboard/vandaag", "Vandaag"],
  ["/dashboard/brug", "Brug"],
]);

export default function DashboardChrome({ homeHref }: { homeHref: string }) {
  const pathname = usePathname();
  if (!pathname) return null;

  const title = SUBPAGE_TITLES.get(pathname);
  if (!title) return null;

  return <SubPageHeader title={title} homeHref={homeHref} />;
}
