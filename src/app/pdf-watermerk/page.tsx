// src/app/pdf-watermerk/page.tsx
// [PDF-TOOLS] Public, login-free watermark and page numbers.

import type { Metadata } from "next";
import PdfWatermerk from "./PdfWatermerk";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Watermerk op een PDF zetten — KOPIE of CONCEPT | BoekBrug",
  description:
    "Zet KOPIE, CONCEPT of je eigen tekst over elke pagina van een PDF, met paginanummers erbij. Je ziet meteen hoe het wordt. Gratis, in je browser, geen account.",
  keywords: [
    "watermerk pdf",
    "pdf watermerk toevoegen",
    "kopie stempel pdf",
    "paginanummers pdf",
  ],
  alternates: { canonical: "/pdf-watermerk" },
  openGraph: {
    title: "Watermerk op een PDF zetten",
    description: "KOPIE, CONCEPT of je eigen tekst, met een echt voorbeeld. Gratis.",
    type: "website",
  },
};

const faq = [
  {
    q: "Klopt het voorbeeld met wat ik krijg?",
    a: "Ja, en dat is met opzet zo gebouwd. Het voorbeeld wordt gemaakt door precies dezelfde bewerking als het eindresultaat, op één pagina — er wordt geen benadering overheen getekend. Wat je ziet is wat er in het bestand komt.",
  },
  {
    q: "Kan ik alleen paginanummers zetten, zonder watermerk?",
    a: "Ja. Laat het tekstveld leeg en zet 'Paginanummers' aan. Andersom kan ook.",
  },
  {
    q: "Is een watermerk juridisch bindend?",
    a: "Nee. Het is een duidelijke aanwijzing voor wie het document leest — 'dit is een concept', 'dit is een kopie' — en dat voorkomt in de praktijk verwarring. Het beveiligt niets en kan er ook weer af.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF-watermerk",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Zet een tekst als watermerk over elke pagina van een PDF, met optionele paginanummers. Live voorbeeld, in de browser.",
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

export default function PdfWatermerkPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/pdf-watermerk"
        title="Watermerk op een PDF"
        intro="KOPIE, CONCEPT of je eigen tekst over elke pagina, met paginanummers erbij als je wilt. Het voorbeeld is geen benadering: het wordt gemaakt door dezelfde bewerking als het resultaat."
        faq={faq}
      >
        <PdfWatermerk />
      </ToolPage>
    </>
  );
}
