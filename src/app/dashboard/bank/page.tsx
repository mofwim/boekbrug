// src/app/dashboard/bank/page.tsx
// [BOEK-016] Bank reconciliation page (phase 4) — thin server shell.
// Auth is enforced by the dashboard layout + the /api/bank/* routes (401).
// All interaction (upload → match → confirm) lives in the client component.

import BankClient from "./BankClient";

// [SEARCH-DEEPLINK] BankClient reads ?find= via useSearchParams; force-dynamic keeps that
// out of static prerendering (no Suspense-boundary build error), matching the facturen page.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bank | BoekBrug",
};

export default function BankPage() {
  return <BankClient />;
}