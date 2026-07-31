// [AUTH-NOINDEX] Zie login/layout.tsx voor de redenering. Een wachtwoord-vergeten-scherm hoort
// helemaal niet in een zoekresultaat: het is een stap in een flow die met een mail begint, niet
// een pagina waar iemand naartoe zoekt.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wachtwoord vergeten",
  robots: { index: false, follow: true },
};

export default function WachtwoordVergetenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
