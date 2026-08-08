// src/app/pdf-naar-afbeelding/page.tsx
// [PDF-TOOLS] Public, login-free PDF → JPG/PNG. Dutch slug: people search
// "pdf naar jpg", not "convert pdf to image".

import type { Metadata } from "next";
import PdfNaarAfbeelding from "./PdfNaarAfbeelding";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF naar JPG of PNG — gratis, in je browser | BoekBrug",
  description:
    "Zet elke pagina van een PDF om naar een afbeelding. Kies de resolutie, pak alles in één zip. Gratis, geen account, je bestand blijft op je eigen apparaat.",
  keywords: ["pdf naar jpg", "pdf naar png", "pdf naar afbeelding", "pdf omzetten naar foto"],
  alternates: { canonical: "/pdf-naar-afbeelding" },
  openGraph: {
    title: "PDF naar JPG of PNG",
    description: "Elke pagina als afbeelding, in de resolutie die je nodig hebt. Gratis.",
    type: "website",
  },
};

const faq = [
  {
    q: "Welke resolutie moet ik kiezen?",
    a: "150 dpi is prima om iets te bekijken of door te sturen. Kies 300 dpi als de afbeelding gedrukt wordt — dat geeft grotere bestanden. 72 dpi is genoeg voor een snelle weergave op een scherm.",
  },
  {
    q: "Kan ik maar een paar pagina's omzetten?",
    a: "Ja. Vul bij 'Welke pagina's' bijvoorbeeld 1-3, 7 of 12- in — dezelfde notatie als in een printvenster. Laat je het leeg, dan wordt het hele document omgezet.",
  },
  {
    q: "JPG of PNG?",
    a: "JPG voor scans en foto's: veel kleiner, en het kwaliteitsverlies zie je niet. PNG als er scherpe lijnen of tekst op staan die haarscherp moeten blijven, of als je transparantie nodig hebt.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF naar afbeelding",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Zet PDF-pagina's om naar JPG of PNG, in de browser. Kies resolutie, formaat en pagina's.",
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

export default function PdfNaarAfbeeldingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/pdf-naar-afbeelding"
        title="PDF naar afbeelding"
        intro="Elke pagina wordt een JPG of een PNG, in de resolutie die je kiest. Meerdere pagina's komen als één zip terug."
        faq={faq}
      >
        <PdfNaarAfbeelding />
      </ToolPage>
    </>
  );
}
