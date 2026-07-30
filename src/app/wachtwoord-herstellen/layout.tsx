// [AUTH-NOINDEX] Zie login/layout.tsx. Deze pagina wordt bereikt via een token in een mail en is
// buiten die flow betekenisloos — geïndexeerd raken is hier puur ruis.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wachtwoord herstellen",
  robots: { index: false, follow: true },
};

export default function WachtwoordHerstellenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
