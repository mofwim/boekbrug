// src/lib/nav-destinations.ts
// [NAV-BESTEMMINGEN] The app's primary destinations — declared ONCE, rendered by two bars.
// Run: npx tsx --test src/lib/nav-destinations.test.ts
//
// This list lived inside BottomNav.tsx, which was right while the phone bar was the only global
// navigation there was. It no longer is: the desktop rail renders the same destinations down the
// side. Two bars reading two lists is how they drift — one gains a destination the other never
// hears about, and the app quietly means different things depending on the width of the screen.
//
// So the list moved out and the bars became renderers. The gate walks BOTH and requires them to
// read this module rather than declare anything of their own.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); `label` is a catalogue KEY,
// so the words themselves live in messages.ts and reach the owner in their own language. A
// hard-coded Dutch label here would be the one piece of Dutch an owner reading Arabic could never
// get away from — the navigation is on every screen.

import type { MessageKey } from "./i18n/messages";
import type { Role } from "./navigation";

export interface Destination {
  href: string;
  label: MessageKey;
  /** Material Symbols name. */
  icon: string;
  /** Extra paths that should light this destination up (children of it). */
  also?: string[];
  /**
   * Match this destination on the exact path only, never on its descendants.
   * Set on the home tab: `/dashboard` is a prefix of EVERY dashboard route, so without this it
   * claimed all of them — standing on Kas, Waarheid, Berichten or Instellingen lit up "Start",
   * which tells the user they are somewhere they are not. A bar that misreports your position is
   * worse than one that admits it does not cover this screen.
   */
  exact?: boolean;
}

// Chosen from what each role's home screen puts first, so the bars shortcut the journeys people
// already take rather than inventing a new hierarchy.
//
// [VAK-BRUG] The counter trade's list. Four destinations again, and three of them the same — only
// the second changes, and that one change is the whole point.
//
// A kapper is paid EUR 25 by someone who walks out. He sends no invoice and has no "client", and
// the bar on every screen of his app led with Facturen and Inkomend: a list he never adds to, and
// an inbox for bills he barely gets. The Kassa he would use thirty times a day was a card inside
// the home screen. The first thing he read, everywhere, was that this app is for somebody else.
//
// Facturen is not gone — it is one tap away on the home tiles. What moved is which of the two is
// one tap and which is two, and for this owner the counter is the frequent one by an order of
// magnitude. Inkomend stays: a barber does receive wholesaler bills, and that queue is where his
// voorbelasting comes from.
export const OWNER_COUNTER: Destination[] = [
  { href: "/dashboard", label: "nav.start", icon: "home", exact: true },
  { href: "/dashboard/kassa", label: "nav.kassa", icon: "storefront" },
  { href: "/dashboard/incoming", label: "nav.incoming", icon: "inbox", also: ["/dashboard/upload"] },
  { href: "/dashboard/bestanden", label: "nav.files", icon: "folder_open" },
];

export const OWNER: Destination[] = [
  { href: "/dashboard", label: "nav.start", icon: "home", exact: true },
  { href: "/dashboard/facturen", label: "nav.invoices", icon: "receipt_long", also: ["/dashboard/invoice"] },
  { href: "/dashboard/incoming", label: "nav.incoming", icon: "inbox", also: ["/dashboard/upload"] },
  { href: "/dashboard/bestanden", label: "nav.files", icon: "folder_open" },
];

export const ACCOUNTANT: Destination[] = [
  { href: "/dashboard/accountant", label: "nav.start", icon: "home", exact: true },
  { href: "/dashboard/clients/beheer", label: "nav.clients", icon: "people", also: ["/dashboard/clients"] },
  { href: "/dashboard/quarterly", label: "nav.quarter", icon: "bar_chart" },
  { href: "/dashboard/bestanden", label: "nav.files", icon: "folder_open" },
];

/**
 * Which destinations this viewer gets.
 *
 * An accountant's list never varies by trade — the trade describes the OWNER, and the accountant
 * works across many of them. Same reasoning as the accountant module's own language rule.
 */
export function destinationsFor(role: Role | null, counter = false): Destination[] {
  if (role === "accountant") return ACCOUNTANT;
  return counter ? OWNER_COUNTER : OWNER;
}

/**
 * Which destination owns this path. Longest match wins, so /dashboard/facturen beats a shorter
 * prefix instead of both lighting up.
 *
 * Returns null when the current screen belongs to no destination — Kas, Brug, Waarheid,
 * Instellingen and the rest are reached from the home tiles, not from these bars. Nothing lit is
 * the honest answer there; see `exact` above for the bug that made "Start" claim them all.
 */
export function activeHref(pathname: string, items: readonly Destination[]): string | null {
  let best: { href: string; len: number } | null = null;
  for (const item of items) {
    for (const prefix of [item.href, ...(item.also ?? [])]) {
      const hit = item.exact
        ? pathname === prefix
        : pathname === prefix || pathname.startsWith(prefix + "/");
      if (hit && (!best || prefix.length > best.len)) best = { href: item.href, len: prefix.length };
    }
  }
  return best?.href ?? null;
}
