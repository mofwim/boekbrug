// [AUTH-NOINDEX] /login stond in Google geïndexeerd, met de titel uit de root-layout
// ("Financieel Command Center") omdat de pagina zelf niets meegeeft. Een inlogformulier heeft
// geen zoekwaarde: wie het vindt kan er niets mee zonder account, en het verdunt de set pagina's
// waarop het domein beoordeeld wordt met een scherm zonder inhoud.
//
// Het staat bewust NIET in robots.txt. Een Disallow houdt de crawler weg van de pagina, maar
// niet uit de index — Google mag een geblokkeerde URL nog steeds tonen, dan zónder titel of
// omschrijving, wat slechter oogt dan nu. `noindex` moet gelezen kunnen worden om te werken,
// dus de pagina blijft crawlbaar en zegt zelf dat hij er niet in hoort.
//
// `follow: true` blijft staan: de links naar de openbare pagina's mogen gewoon gevolgd worden.
//
// Waarom een layout en niet de pagina: page.tsx is een client component en `metadata` wordt
// alleen in server components ondersteund (zie generate-metadata.md in de Next-docs van deze
// versie). De layout is de server-kant die er wél omheen zit.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inloggen",
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
