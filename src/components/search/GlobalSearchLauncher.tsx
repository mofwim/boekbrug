// src/components/search/GlobalSearchLauncher.tsx
// [SEARCH] Makes the global search reachable on EVERY dashboard page (not just the
// ZZP/accountant home). Renders a floating search button (opens the full-screen overlay;
// Cmd/Ctrl+K also works) via the SearchBar "launcher" variant.
//
// Hidden where a search entry point already exists or would collide:
//   - Pages that render DashboardHeader (which already contains the INLINE SearchBar):
//     the ZZP home ("/dashboard") and the accountant hub ("/dashboard/accountant").
//     Rendering the launcher there too would mount a SECOND SearchBar → duplicate DOM
//     ids + two Cmd/Ctrl+K listeners.  ⚠️ If a new page ever renders DashboardHeader,
//     add its path here. (An earlier DOM-probe version of this check could get stuck
//     hiding the FAB when navigating away from a header page, so we keep it a simple,
//     deterministic path list — DashboardHeader is only used by these two routes.)
//   - Pages with a full-width bottom-anchored input/action bar that the FAB would sit on:
//     "/dashboard/invoice/*" (invoice form action bar) and "/dashboard/messages/*" (the
//     conversation composer textarea, sticky bottom-0). A fixed corner can't dodge these.

"use client";

import { usePathname } from "next/navigation";
import { SearchBar } from "@/components/search/SearchBar";

const INLINE_HEADER_PATHS = new Set(["/dashboard", "/dashboard/accountant"]);

// Routes whose full-width bottom bar/composer would collide with the bottom-left FAB.
const BOTTOM_BAR_PREFIXES = ["/dashboard/invoice/", "/dashboard/messages/"];

export default function GlobalSearchLauncher() {
  const pathname = usePathname();

  if (
    !pathname ||
    INLINE_HEADER_PATHS.has(pathname) ||
    BOTTOM_BAR_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return null;
  }

  // Bottom-LEFT: the primary page FABs ("+ Nieuwe factuur/klant", etc.) live
  // bottom-right on facturen/klanten/werkplek — a bottom-right search FAB overlapped them.
  return (
    <div style={{
      position: "fixed", zIndex: 150,
      // [ZIJBALK] Clears the desktop rail the same way `bottom` clears the phone bar below:
      // --rail-w is 0px under 1024px, so this one expression is correct at every width. Without
      // it this button sat on the rail's bottom corner — the same defect as the FAB that hid
      // behind the bottom bar, at the other edge.
      insetInlineStart: "calc(20px + var(--rail-w))",
      // [MOBILE-FAB] Boven de BottomNav via de gedeelde --bottom-nav-h (0px op
      // desktop, 64px op mobiel). Op de vaste `bottom: 20` stond deze knop op een
      // telefoon ACHTER die balk — alleen een streepje blauw stak uit de linkerrand,
      // en zoeken was daar dus onbereikbaar.
      bottom: "calc(20px + var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px))",
    }}>
      <SearchBar variant="launcher" />
    </div>
  );
}
