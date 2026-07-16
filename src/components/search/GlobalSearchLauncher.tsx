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
//   - "/dashboard/invoice/*" — the invoice form pages have a full-width bottom action bar.

"use client";

import { usePathname } from "next/navigation";
import { SearchBar } from "@/components/search/SearchBar";

const INLINE_HEADER_PATHS = new Set(["/dashboard", "/dashboard/accountant"]);

export default function GlobalSearchLauncher() {
  const pathname = usePathname();

  if (
    !pathname ||
    INLINE_HEADER_PATHS.has(pathname) ||
    pathname.startsWith("/dashboard/invoice/")
  ) {
    return null;
  }

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 150 }}>
      <SearchBar variant="launcher" />
    </div>
  );
}
