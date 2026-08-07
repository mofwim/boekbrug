// src/app/pdf-naar-tekst/page.tsx
// [PDF-TOOLS] Public, login-free PDF → plain text.

import type { Metadata } from "next";
import PdfNaarTekst from "./PdfNaarTekst";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF naar tekst — kopieer de tekst uit een PDF | BoekBrug",
  description:
    "Haal de tekst uit een PDF en kopieer of bewaar hem als .txt. Gratis, in je browser, geen account. Werkt niet bij scans — dat zegt de tool er eerlijk bij.",
  keywords: ["pdf naar tekst", "tekst uit pdf halen", "pdf naar txt", "pdf tekst kopiëren"],
  alternates: { canonical: "/pdf-naar-tekst" },
  openGraph: {
    title: "PDF naar tekst",
    description: "De tekst uit een PDF, om te kopiëren of te bewaren. Gratis.",
    type: "website",
  },
};

const faq = [
  {
    q: "Waarom krijg ik niets terug bij mijn scan?",
    a: "Omdat er geen tekst in zit. Bij een scan of een fotokopie zijn de letters plaatjes, geen tekens — er valt dus niets uit te kopiëren. Daar heb je tekstherkenning (OCR) voor nodig. De tool zegt dit met zoveel woorden in plaats van een leeg vak te tonen.",
  },
  {
    q: "Blijft de opmaak behouden?",
    a: "Nee, en dat kan ook niet: een PDF bewaart posities, geen alinea's. Wat je terugkrijgt is de tekst met de regeleinden op de plek waar ze op de pagina stonden. Kolommen en tabellen komen er daardom door elkaar uit.",
  },
  {
    q: "Gaat mijn document naar een server?",
    a: "Nee. Het lezen gebeurt in je eigen browser. Er gaat geen enkel verzoek uit met je bestand erin — je kunt dat nakijken in het netwerktabblad.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF naar tekst",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Haalt de tekstlaag uit een PDF, in de browser. Kopiëren of opslaan als .txt.",
    },
    {
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

export default function PdfNaarTekstPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/pdf-naar-tekst"
        title="PDF naar tekst"
        intro="De tekst uit een PDF, om te kopiëren of te bewaren. Zit er geen tekstlaag in — bij een scan — dan zegt de tool dat, in plaats van een leeg vak te tonen."
        faq={faq}
      >
        <PdfNaarTekst />
      </ToolPage>
    </>
  );
}
