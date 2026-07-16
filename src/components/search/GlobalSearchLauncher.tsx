// src/components/search/GlobalSearchLauncher.tsx
// [SEARCH] Makes the global search reachable on EVERY dashboard page (not just the
// ZZP/accountant home). Renders a floating search button (opens the full-screen overlay;
// Cmd/Ctrl+K also works) via the SearchBar "launcher" variant.
//
// Hidden where a search entry point already exists or would collide:
//   - Any page that renders DashboardHeader (which contains the INLINE SearchBar) — today
//     the ZZP home ("/dashboard") and the accountant hub ("/dashboard/accountant"). We
//     exclude those two paths explicitly (no flash) AND fall back to a DOM check for
//     `[data-dashboard-header]` so any future header page can't double-mount two SearchBars
//     (duplicate ids + two Cmd/Ctrl+K listeners).
//   - "/dashboard/invoice/*" — the invoice form pages have a full-width bottom action bar.

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SearchBar } from "@/components/search/SearchBar";

const INLINE_HEADER_PATHS = new Set(["/dashboard", "/dashboard/accountant"]);

export default function GlobalSearchLauncher() {
  const pathname = usePathname();
  const [inlineHeaderPresent, setInlineHeaderPresent] = useState(false);

  // Safety net for any page that renders DashboardHeader without being in the list above.
  // Re-checks on every route change (after the new page has committed to the DOM).
  useEffect(() => {
    setInlineHeaderPresent(!!document.querySelector("[data-dashboard-header]"));
  }, [pathname]);

  const excluded =
    !pathname ||
    INLINE_HEADER_PATHS.has(pathname) ||
    pathname.startsWith("/dashboard/invoice/") ||
    inlineHeaderPresent;

  if (excluded) return null;

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 150 }}>
      <SearchBar variant="launcher" />
    </div>
  );
}
