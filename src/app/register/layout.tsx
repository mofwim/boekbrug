// [AUTH-NOINDEX] De tegenhanger van login/layout.tsx — en met opzet de andere keuze.
//
// Die commit zette /login, /wachtwoord-vergeten en /wachtwoord-herstellen op `noindex` en zei er
// expliciet bij dat /register daar NIET bij hoort: dat scherm staat bewust in de sitemap als
// landingspagina voor aanmelden en moest indexeerbaar blijven. Dat blijft zo; hier staat geen
// robots-regel.
//
// Maar de reden dat /login eruit moest, gold woordelijk ook hier: de pagina gaf zelf niets mee,
// dus stond er de titel van de root-layout boven — "BoekBrug — Financieel Command Center" — met
// de omschrijving van de homepage eronder. Voor een uitgesloten pagina is dat rommelig; voor de
// pagina waar advertenties en de "Gratis account"-knop op uitkomen is het de zoekresultaatregel
// zelf. Twee pagina's die om hetzelfde zoekwoord meedingen met exact dezelfde titel, en de
// bezoeker leest een naam voor een product in plaats van wat hij hier kan doen.
//
// Waarom een layout en niet de pagina: page.tsx is een client component en `metadata` wordt
// alleen in server components ondersteund (zie generate-metadata.md in de Next-docs van deze
// versie). Dezelfde reden, dezelfde vorm als bij de drie schermen hiernaast.
import type { Metadata } from "next";

export const metadata: Metadata = {
  // Met "| BoekBrug" erachter, zoals elke andere pagina die wél in de index staat
  // (/bewaarplicht, /voorwaarden). De drie noindex-schermen hiernaast dragen een kale titel, en
  // dat kan daar: die titel komt nergens terecht.
  title: "Gratis account aanmaken | BoekBrug",
  description:
    "Maak in één minuut een gratis BoekBrug-account. Geen creditcard, geen proefperiode die " +
    "afloopt — je bonnen, facturen en BTW op één plek, klaar voor je boekhouder.",
  alternates: { canonical: "/register" },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
