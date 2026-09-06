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

// ── [KORTE-WEG] The one destination both owner lists share in the middle ────────────────────────
//
// "Vandaag" is the screen that answers "what do I have to do?" — the invoices to pay, the clients
// to remind, the offertes still open, and the btw-potje with the aangifte deadline printed on it.
// It had no standing door on a phone, and that is not a matter of taste: below 640px
// `.dash-nav-links` is `display: none !important` (globals.css), the rail only appears from
// 1024px, and the home screen linked here ONLY from inside `{attention.length > 0 && …}` — a block
// that collapses the moment nothing is overdue. So the owner with a deadline in four days and no
// late invoice had no way to the screen that states the deadline. btw-deadline-notice.ts opens
// with that same sentence; this is the other half of that repair.
//
// It sits THIRD, and the trade still owns the second slot: a kapper reaches the Kassa thirty times
// a day and Vandaag once, so the counter's shortcut keeps its place ([VAK-BRUG] below). Third of
// five is also where a thumb rests on a phone held in one hand.
//
// FIVE and not four now. The bar's own note says "M3 allows up to five, and past that the labels
// stop fitting on a 320px screen" — the objection was to six. At 320px each column is 64px, the
// active pill is 56px, and the labels truncate rather than wrap; on the 360px screens these owners
// actually hold it is 72px per column.
//
// The label is `chrome.vandaag`, the key the sub-page header already uses for this screen, not a
// second key with the same word in it. One screen, one key, so the bar and the header cannot come
// to call it two different things in any language — the reasoning [DEUR] wrote out in
// DashboardChrome for kassa.titel, uren.titel and the other two.
const VANDAAG: Destination = { href: "/dashboard/vandaag", label: "chrome.vandaag", icon: "today" };

// Chosen from what each role's home screen puts first, so the bars shortcut the journeys people
// already take rather than inventing a new hierarchy.
//
// [VAK-BRUG] The counter trade's list. The same five destinations as the owner's — only the second
// changes, and that one change is the whole point.
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
  VANDAAG,
  { href: "/dashboard/incoming", label: "nav.incoming", icon: "inbox", also: ["/dashboard/upload"] },
  { href: "/dashboard/bestanden", label: "nav.files", icon: "folder_open" },
];

export const OWNER: Destination[] = [
  { href: "/dashboard", label: "nav.start", icon: "home", exact: true },
  { href: "/dashboard/facturen", label: "nav.invoices", icon: "receipt_long", also: ["/dashboard/invoice"] },
  VANDAAG,
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

// ── The desktop rail: the whole home screen, not four of it ─────────────────────────────────────
//
// The four above are a PHONE constraint, and the file that held them says so out loud: "Four and
// not six on purpose — M3 allows up to five, and past that the labels stop fitting on a 320px
// screen". A 240px rail down the side of a desktop has no such problem, and the first version of
// it shipped with four items anyway — which put a rail next to a home screen carrying fifteen
// tiles and made the rail look like a worse way to reach the same place.
//
// So the rail carries what the home screen carries, in the home screen's own groups. The labels
// are the home screen's OWN catalogue keys (start.tegel.*, start.waarheid, start.conceptBtw,
// start.jaar) rather than new ones: the rail and the tile then cannot come to call the same
// destination two different things, in any language.
//
// The four primary destinations stay a SUBSET of this — asserted in the tests, because that is the
// invariant that keeps the phone and the desktop describing one app. What the rail may not do is
// carry a destination the home screen does not have; the [ZIJBALK] gate walks ZzpDashboard for
// exactly that.

export interface RailSection {
  /** The home screen's own section heading, or null for the top group. */
  heading: MessageKey | null;
  items: Destination[];
}

/**
 * What the rail shows, per role.
 *
 * NOT the vehicle trade's Voertuigen tile: the rail is mounted in the dashboard layout, which
 * reads `vak` for the counter trade and nothing else, and one more profile read on every screen in
 * the app is a poor price for one row. It stays a home tile. Said here rather than left as a
 * silent absence.
 *
 * The accountant's rail is still the four primary destinations, and that is a product decision not
 * yet made rather than an oversight: their home carries a different set of tools, and which of
 * them deserve a permanent rail is their question, not this module's.
 */
export function railSectionsFor(role: Role | null, counter = false): RailSection[] {
  if (role === "accountant") return [{ heading: null, items: ACCOUNTANT }];

  const administratie: Destination[] = [
    { href: "/dashboard/facturen", label: "start.tegel.facturen", icon: "receipt_long", also: ["/dashboard/invoice"] },
    { href: "/dashboard/incoming", label: "start.tegel.inkomend", icon: "inbox", also: ["/dashboard/upload"] },
    { href: "/dashboard/incoming/manage", label: "start.tegel.inkoop", icon: "request_quote" },
    { href: "/dashboard/leveranciers", label: "start.tegel.leveranciers", icon: "local_shipping" },
    { href: "/dashboard/bank", label: "start.tegel.bank", icon: "account_balance" },
    { href: "/dashboard/kas", label: "start.tegel.kas", icon: "payments" },
    { href: "/dashboard/dagomzet", label: "start.tegel.dagomzet", icon: "point_of_sale" },
    { href: "/dashboard/artikelen", label: "start.tegel.artikelen", icon: "inventory_2" },
    { href: "/dashboard/uren", label: "start.tegel.uren", icon: "schedule" },
  ];
  // [VAK-BRUG] The counter owner reaches the Kassa thirty times a day; it leads their phone bar for
  // that reason and belongs at the top of their rail for the same one.
  if (counter) administratie.unshift({ href: "/dashboard/kassa", label: "nav.kassa", icon: "storefront" });

  return [
    // [KORTE-WEG] Start and Vandaag, above the first heading: where am I, and what do I have to do.
    // Vandaag is here because it is a primary destination and every one of those must be somewhere
    // in the rail ([ZIJBALK]) — but also because the rail had the same hole the phone did. The one
    // link to this screen on a wide display was the header's text link, which the sub-page bar
    // replaces on most routes.
    { heading: null, items: [OWNER[0], VANDAAG] },
    { heading: "start.administratie", items: administratie },
    {
      heading: "start.cijfers",
      items: [
        { href: "/dashboard/waarheid", label: "start.waarheid", icon: "monitoring" },
        { href: "/dashboard/aangifte", label: "start.conceptBtw", icon: "receipt" },
        { href: "/dashboard/jaar", label: "start.jaar", icon: "calendar_month" },
      ],
    },
    {
      heading: "start.meer",
      items: [
        { href: "/dashboard/werkplek", label: "start.tegel.werkplek", icon: "work" },
        { href: "/dashboard/bestanden", label: "nav.files", icon: "folder_open" },
        { href: "/dashboard/settings/team", label: "start.tegel.team", icon: "group_add" },
      ],
    },
  ];
}

/** Every destination the rail shows, flattened — for activeHref and for the tests. */
export function railDestinations(role: Role | null, counter = false): Destination[] {
  return railSectionsFor(role, counter).flatMap((s) => s.items);
}
