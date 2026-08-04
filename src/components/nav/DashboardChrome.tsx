// src/components/nav/DashboardChrome.tsx
// [SUBNAV] Route-aware host for the shared sub-page header. Mounted ONCE in
// src/app/dashboard/layout.tsx, before {children}, so any dashboard page can
// inherit a consistent top bar without drawing its own.
//
// Title resolution, in priority order:
//   1. A dynamic config a page registered via useSubPageHeader() — used for
//      routes whose title/actions aren't a static path→label mapping
//      (/dashboard/invoice/[id] → "Factuur 263323", a client name, …).
//   2. STATIC_TITLES — exact path → fixed label, for pages already migrated onto
//      the shared bar. Added in the same change that removes a page's old chrome.
//   3. PATTERN_TITLES — a base label for a dynamic route TEMPLATE, so the bar
//      shows instantly (e.g. "Factuur") before the page's effect fills in the
//      concrete title. Prevents an empty-bar flash on first paint.
// If none match, render nothing (pages that keep their own full DashboardHeader —
// the two homes — or their own Drive header — bestanden).
//
// Exact-path matching for STATIC_TITLES avoids prefix collisions (e.g.
// "/dashboard/bank" vs its child "/dashboard/bank/categoriseren").

"use client";

import { usePathname } from "next/navigation";
import SubPageHeader from "./SubPageHeader";
import { useSubPageHeaderConfig } from "./SubPageHeaderContext";
import type { Role } from "@/lib/navigation";

// Exact route → fixed page title (static, migrated pages).
const STATIC_TITLES = new Map<string, string>([
  ["/dashboard/vandaag", "Vandaag"],
  ["/dashboard/brug", "Brug"],
  ["/dashboard/kas", "Kas"],
  ["/dashboard/aangifte", "Aangifte"],
  ["/dashboard/dagomzet", "Dagomzet"],
  ["/dashboard/upload", "Uploaden"],
  // [RESULT→WAARHEID] /dashboard/resultaat is a server redirect to /dashboard/waarheid, so this
  // chrome never renders for it — the title entry would be dead config. See that page's header.
  ["/dashboard/artikelen", "Artikelen"],
  ["/dashboard/kluis", "Kluis"],
  // [BRUG-RETOUR] De vragen van de boekhouder aan de ondernemer.
  ["/dashboard/vragen", "Vragen van je boekhouder"],
  ["/dashboard/klaar", "Ben ik klaar?"],
  ["/dashboard/quarterly", "Kwartaaloverzicht"],
  ["/dashboard/waarheid", "Waarheid"],
  ["/dashboard/bank", "Bank"],
  ["/dashboard/bank/categoriseren", "Wat is dit?"],
  ["/dashboard/settings", "Instellingen"],
  // [NAV] Without this entry the bar rendered nothing here — see the parent rule
  // for facturering in src/lib/navigation.ts.
  ["/dashboard/settings/facturering", "Facturering"],
  ["/dashboard/messages", "Berichten"],
  ["/dashboard/werkplek", "Mijn werkplek"],
  ["/dashboard/clients/invite", "Klant toevoegen"],
  ["/dashboard/clients/beheer", "Klanten beheren"],
  // [ROLE-PARITY] /dashboard/accountant/werkplek now redirects to the home (its
  // tools live there as a tile grid), so it no longer needs a sub-page title.
  // The board registers its refresh button via useSubPageHeader; this is its title.
  ["/dashboard/accountant/agenda", "Aangifte & status"],
  // [MANDAAT] Factureren namens een klant die daarvoor gemachtigd heeft.
  ["/dashboard/accountant/factuur", "Factuur namens klant"],
  // [DEBITEUREN] De chase-lijst over alle gemachtigde klanten heen.
  ["/dashboard/accountant/debiteuren", "Openstaande facturen"],
  // HAS-ACTIONS pages: the shared bar gives back + title; the page keeps its own
  // search/filter/sort controls as a secondary sticky toolbar offset below it.
  ["/dashboard/facturen", "Mijn facturen"],
  ["/dashboard/klanten", "Mijn klanten"],
  ["/dashboard/incoming/manage", "Inkoopfacturen"],
  ["/dashboard/incoming", "Inkomend"],
  // Base label; the page overrides it via useSubPageHeader with the concrete
  // type (Nieuwe factuur / Nieuwe offerte / Creditnota) once mounted.
  ["/dashboard/invoice/new", "Nieuwe factuur"],
]);

// Base label for a dynamic route TEMPLATE — shown until the page registers a
// concrete title via useSubPageHeader(). Ordered; first match wins. A template
// is added here in the same change that removes that page's bespoke bar, so the
// shared bar never stacks on an existing one.
const PATTERN_TITLES: ReadonlyArray<[RegExp, string]> = [
  // Invoice edit — page registers "Factuur bewerken · {number}". Listed before
  // the /invoice/[^/]+ pattern so the /edit child isn't swallowed by it.
  [/^\/dashboard\/invoice\/[^/]+\/edit$/, "Factuur bewerken"],
  // Invoice detail — the page keeps its own context toolbar (number/badge/status/
  // actions/PDF) below the shared bar, so the shared title stays generic "Factuur".
  // Excludes /invoice/new (a distinct create page, migrated separately) so it
  // isn't matched here while it still renders its own bar.
  [/^\/dashboard\/invoice\/(?!new$)[^/]+$/, "Factuur"],
  // ZZP client detail — the page registers the client name via useSubPageHeader.
  [/^\/dashboard\/klanten\/[^/]+$/, "Klant"],
  // Conversation — the page registers the partner's name via useSubPageHeader;
  // this base label shows on first paint. The /dashboard/messages LIST is an exact
  // STATIC key ("Berichten"), resolved before patterns, so it is unaffected.
  [/^\/dashboard\/messages\/[^/]+$/, "Gesprek"],
  // Accountant client quarter — registers "Q{q} {year} — {client}" + sort action.
  // Listed before the client-detail pattern below (more specific path first).
  [/^\/dashboard\/clients\/[^/]+\/kwartaal$/, "Kwartaal"],
  // Accountant client detail — registers client name + Ontkoppelen action.
  // NB: /dashboard/clients/beheer and /clients/invite are in STATIC_TITLES, which
  // is resolved BEFORE patterns, so this never overrides those fixed labels.
  [/^\/dashboard\/clients\/[^/]+$/, "Klant"],
];

function patternTitle(pathname: string): string | undefined {
  for (const [re, label] of PATTERN_TITLES) {
    if (re.test(pathname)) return label;
  }
  return undefined;
}

export default function DashboardChrome({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const ctx = useSubPageHeaderConfig();
  if (!pathname) return null;

  const title = ctx?.title ?? STATIC_TITLES.get(pathname) ?? patternTitle(pathname);
  if (!title) return null;

  return <SubPageHeader title={title} role={role} actions={ctx?.actions} />;
}
