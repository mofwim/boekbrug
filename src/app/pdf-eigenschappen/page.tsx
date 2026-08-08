// src/app/pdf-eigenschappen/page.tsx
// [PDF-TOOLS] Public, login-free PDF metadata editor. The real use is removal:
// a word processor writes your full name — and sometimes a former employer's
// licence — into every document you send out.

import type { Metadata } from "next";
import PdfEigenschappen from "./PdfEigenschappen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF-eigenschappen bekijken en wissen — gratis | BoekBrug",
  description:
    "Zie welke naam, titel en software er in je PDF staan, en haal ze eruit voordat je hem verstuurt. Gratis, in je browser, geen account.",
  keywords: [
    "pdf eigenschappen",
    "pdf metadata verwijderen",
    "naam uit pdf halen",
    "pdf auteur wijzigen",
  ],
  alternates: { canonical: "/pdf-eigenschappen" },
  openGraph: {
    title: "PDF-eigenschappen bekijken en wissen",
    description: "Zie wat er in je document over jou staat, en haal het eruit. Gratis.",
    type: "website",
  },
};

const faq = [
  {
    q: "Wat staat er eigenlijk in een PDF over mij?",
    a: "Vaak meer dan je denkt: je naam als auteur, de titel van het bestand waar je ooit mee begon, en welk programma het heeft opgeslagen — soms met de licentienaam van een vorige werkgever erin. Dat reist mee met elke offerte die je verstuurt.",
  },
  {
    q: "Wist een leeg veld de eigenschap echt?",
    a: "Ja. Er wordt geen lege tekst ingevuld; de eigenschap wordt verwijderd. Met 'Alles leegmaken' haal je ze in één keer allemaal weg.",
  },
  {
    q: "Verandert er iets aan de inhoud?",
    a: "Nee. De pagina's blijven precies zoals ze waren — alleen de eigenschappen van het bestand veranderen. De wijzigingsdatum wordt wel bijgewerkt, want die is per definitie nu.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF-eigenschappen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Bekijk en wijzig of wis de metadata van een PDF — titel, auteur, trefwoorden — in de browser.",
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

export default function PdfEigenschappenPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/pdf-eigenschappen"
        title="PDF-eigenschappen"
        intro="Titel, auteur, trefwoorden en de software die het bestand schreef. Bekijk wat erin staat, pas het aan, of haal het er helemaal uit voordat je het document verstuurt."
        faq={faq}
      >
        <PdfEigenschappen />
      </ToolPage>
    </>
  );
}
