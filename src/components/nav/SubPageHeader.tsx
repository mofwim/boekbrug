// src/components/nav/SubPageHeader.tsx
// [SUBNAV] A lightweight, DATA-FREE sticky top bar for /dashboard sub-pages.
// Deliberately NOT the full DashboardHeader (which needs notifications / message
// counts / logout handlers, and so only lives on the two home pages). This bar
// carries only navigation:
//   [←  back]   BoekBrug (home)   ·   Page title
//
// Back + home targets come from the app's SINGLE SOURCE OF TRUTH for navigation
// (src/lib/navigation.ts) — exactly like BackLink ("the one and only back
// button"). The back arrow links to the canonical PARENT (never router.back() /
// history), so it is structurally loop-safe and identical to every other Terug
// in the app. Mounted once from the dashboard layout via DashboardChrome — never
// per-page — so the whole app shares one consistent sub-page header.
//
// Mobile / PWA: the bar honours env(safe-area-inset-top) so on a notched device
// in standalone mode it clears the status bar instead of colliding with it.

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { getParentPath, getHomePath, type Role } from "@/lib/navigation";
import { M3, FONT, PAGE_HEADER_HEIGHT } from "@/lib/design/tokens";
import type { ReactNode } from "react";

export default function SubPageHeader({
  title,
  role,
  actions,
}: {
  title: string;
  /** Viewer role — resolves role-dependent parents/home. Null → treated as zzper. */
  role: Role | null;
  /** Optional right-aligned node (page-provided menu/action), via SubPageHeaderContext. */
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();

  const navRole: Role = role === "accountant" ? "accountant" : "zzper";
  const backHref = getParentPath(pathname ?? "/dashboard", navRole, search);
  const homeHref = getHomePath(navRole);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        // [INSTANT] Anchors the bar during a view transition: globals.css gives
        // ::view-transition-group(page-header) `animation: none`, so the header
        // holds still while the content slides underneath it.
        viewTransitionName: "page-header",
        backgroundColor: M3.surface,
        borderBottom: `1px solid ${M3.outlineVariant}`,
        // Clear the device status bar in standalone PWA mode.
        paddingTop: "env(safe-area-inset-top)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: `calc(${PAGE_HEADER_HEIGHT}px + env(safe-area-inset-top))`,
        paddingLeft: 8,
        paddingRight: 12,
        fontFamily: FONT,
      }}
    >
      {/* Back → canonical parent (single source of truth, loop-safe) */}
      {/* [MOTION] `pressable` replaces the onMouseEnter/onMouseLeave pair that
          used to paint the hover tint from JavaScript. Mouse events never fire
          for a finger, so on a phone the most-tapped control in the whole app
          gave no feedback whatsoever between the tap and the next screen.
          Hover now lives in CSS (:hover) and the press-scale in :active, which
          a touch DOES fire. The tap target also grows to the 44px minimum —
          it was a 38px box around a 22px glyph. */}
      <Link
        href={backHref}
        aria-label="Terug"
        // [INSTANT] Marks this navigation as a RETURN, so PageTransition
        // slides the content right instead of left. Every "Terug" in the
        // app funnels through this component and SubPageHeader, so tagging
        // those two covers the whole app without touching each page.
        transitionTypes={['nav-back']}
        className="pressable nav-icon-btn"
        style={{
          background: "none",
          border: "none",
          padding: 8,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          minWidth: 44,
          minHeight: 44,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 18l-6-6 6-6"
            stroke={M3.onSurfaceVariant}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

      {/* Brand / home */}
      <Link
        href={homeHref}
        className="pressable"
        style={{
          fontWeight: 700,
          fontSize: 17,
          color: M3.primary,
          flexShrink: 0,
          letterSpacing: "-0.3px",
          lineHeight: 1,
          textDecoration: "none",
          fontFamily: FONT,
        }}
      >
        BoekBrug
      </Link>

      {/* Separator + page title */}
      <span style={{ color: "#DADCE0", flexShrink: 0, fontSize: 15 }}>/</span>
      <span
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: "#3C4043",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          flex: 1,
        }}
      >
        {title}
      </span>

      {/* Optional page-provided actions, right-aligned */}
      {actions ? (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
