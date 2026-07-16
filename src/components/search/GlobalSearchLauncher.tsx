// src/components/search/GlobalSearchLauncher.tsx
// [SEARCH] Makes the global search reachable on EVERY dashboard page (not just the
// ZZP home). Renders a floating search button (opens the full-screen overlay; Cmd/Ctrl+K
// also works) via the SearchBar "launcher" variant.
//
// Hidden where a search entry point already exists or would collide:
//   - "/dashboard"            → the ZZP home header already renders the inline SearchBar.
//   - "/dashboard/invoice/*"  → the invoice form pages have a full-width bottom action bar.

"use client";

import { usePathname } from "next/navigation";
import { SearchBar } from "@/components/search/SearchBar";

export default function GlobalSearchLauncher() {
  const pathname = usePathname();

  if (
    !pathname ||
    pathname === "/dashboard" ||
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
