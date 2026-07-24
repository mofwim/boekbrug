// src/components/nav/SubPageHeader.tsx
// [SUBNAV] A lightweight, DATA-FREE sticky top bar for /dashboard sub-pages that
// would otherwise have NO header and NO way back. Deliberately NOT the full
// DashboardHeader (which needs notifications / message counts / logout handlers,
// and so only lives on the two home pages). This bar carries only navigation:
//   [←  back]   BoekBrug (home)   ·   Page title
// It is mounted once from the dashboard layout via DashboardChrome — never
// per-page — so the whole app shares one consistent sub-page header.
//
// Mobile / PWA: the bar honours env(safe-area-inset-top) so on a notched device
// in standalone mode it clears the status bar instead of colliding with it.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SubPageHeader({
  title,
  homeHref,
}: {
  title: string;
  /** Role-aware home target (ZZP → /dashboard, accountant → /dashboard/accountant). */
  homeHref: string;
}) {
  const router = useRouter();

  const onBack = () => {
    // Prefer the real previous page; fall back to home when the page was opened
    // directly (deep link / fresh tab) and there is no in-app history to pop.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(homeHref);
    }
  };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backgroundColor: "#fff",
        borderBottom: "1px solid #E0E0E0",
        // Clear the device status bar in standalone PWA mode.
        paddingTop: "env(safe-area-inset-top)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: "calc(56px + env(safe-area-inset-top))",
        paddingLeft: 8,
        paddingRight: 12,
        fontFamily: "'Roboto', sans-serif",
      }}
    >
      {/* Back */}
      <button
        onClick={onBack}
        aria-label="Terug"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 8,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#F1F3F4")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent")
        }
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 18l-6-6 6-6"
            stroke="#5F6368"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Brand / home */}
      <Link
        href={homeHref}
        style={{
          fontWeight: 700,
          fontSize: 17,
          color: "#1A73E8",
          flexShrink: 0,
          letterSpacing: "-0.3px",
          lineHeight: 1,
          textDecoration: "none",
          fontFamily: "'Roboto', sans-serif",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.75")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")}
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
        }}
      >
        {title}
      </span>
    </header>
  );
}
