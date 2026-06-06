// src/app/dashboard/bank/page.tsx
// [BOEK-016] Bank reconciliation page (phase 4) — thin server shell.
// Auth is enforced by the dashboard layout + the /api/bank/* routes (401).
// All interaction (upload → match → confirm) lives in the client component.

import BankClient from "./BankClient";

export const metadata = {
  title: "Bank | BoekBrug",
};

export default function BankPage() {
  return <BankClient />;
}