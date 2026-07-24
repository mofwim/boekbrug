// src/components/nav/DashboardChrome.tsx
// [SUBNAV] Route-aware host for the shared sub-page header. Mounted ONCE in
// src/app/dashboard/layout.tsx, before {children}, so any dashboard page can
// inherit a consistent top bar without drawing its own.
//
// Same philosophy as GlobalSearchLauncher: a simple, deterministic exact-path
// list — no DOM probing. A route appears here once its page has been migrated
// ONTO the shared bar (its own in-flow BackLink / bespoke top bar removed), so
// there is never a double header. Pages not yet migrated (or that keep their own
// full DashboardHeader — the two homes) simply aren't in the map and render
// nothing here.
//
// Matching is EXACT-path to avoid prefix collisions (e.g. "/dashboard/incoming"
// could get a bar while its child "/dashboard/incoming/manage" — with its own
// chrome — would not).

"use client";

import { usePathname } from "next/navigation";
import SubPageHeader from "./SubPageHeader";
import type { Role } from "@/lib/navigation";

// Exact route → page title. A page is added here in the same change that removes
// its old bespoke chrome, so the shared bar replaces it (never stacks on it).
const SUBPAGE_TITLES = new Map<string, string>([
  ["/dashboard/vandaag", "Vandaag"],
  ["/dashboard/brug", "Brug"],
  ["/dashboard/kas", "Kas"],
  ["/dashboard/aangifte", "Aangifte"],
  ["/dashboard/dagomzet", "Dagomzet"],
  ["/dashboard/upload", "Uploaden"],
  ["/dashboard/resultaat", "Resultaat"],
  ["/dashboard/artikelen", "Artikelen"],
  ["/dashboard/kluis", "Kluis"],
  ["/dashboard/klaar", "Ben ik klaar?"],
  ["/dashboard/quarterly", "Kwartaaloverzicht"],
  ["/dashboard/waarheid", "Waarheid"],
  ["/dashboard/bank", "Bank"],
  ["/dashboard/bank/categoriseren", "Wat is dit?"],
  ["/dashboard/settings", "Instellingen"],
  ["/dashboard/messages", "Berichten"],
  ["/dashboard/werkplek", "Mijn werkplek"],
  ["/dashboard/clients/invite", "Klant toevoegen"],
  ["/dashboard/clients/beheer", "Klanten beheren"],
  ["/dashboard/accountant/werkplek", "Mijn werkplek"],
]);

export default function DashboardChrome({ role }: { role: Role | null }) {
  const pathname = usePathname();
  if (!pathname) return null;

  const title = SUBPAGE_TITLES.get(pathname);
  if (!title) return null;

  return <SubPageHeader title={title} role={role} />;
}
