// src/app/pdf-splitsen/page.tsx
// [PDF-TOOLS] Public, login-free PDF tool.

import type { Metadata } from "next";
import PdfSplitsen from "./PdfSplitsen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF splitsen — pagina's eruit halen | BoekBrug",
  description:
    "Haal losse pagina's uit een PDF of knip hem in gelijke delen. Klik de pagina's aan of typ een bereik zoals 1-3, 7. Gratis, in je browser, geen account.",
  keywords: ["pdf splitsen", "pagina uit pdf halen", "pdf knippen", "pdf pagina's scheiden"],
  alternates: { canonical: "/pdf-splitsen" },
  openGraph: {
    title: "PDF splitsen",
    description: "Haal de pagina's eruit die je nodig hebt, of knip het document in gelijke delen. Klikken op een pagina werkt n",
    type: "website",
  },
};

const faq = [
  {
    q: "Hoe kies ik welke pagina's?",
    a: "Op twee manieren, en ze zijn hetzelfde: typ een bereik zoals 1-3, 7, 12- net als in een printvenster, of klik de pagina's aan in het overzicht. Wat je klikt verschijnt in het veld.",
  },
  {
    q: "Wat doet 'elke zoveel'?",
    a: "Die knipt het document in stukken van een vast aantal pagina's. Een document van twaalf pagina's bij 'elke 4' wordt drie bestanden van vier.",
  },
  {
    q: "Krijg ik één bestand of meerdere?",
    a: "Bij het kiezen van pagina's krijg je één bestand met die pagina's erin. Bij 'elke zoveel' krijg je meerdere, die je los of als zip kunt opslaan.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF splitsen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Haal losse pagina's uit een PDF of knip hem in gelijke delen. Klik de pagina's aan of typ een bereik zoals 1-3, 7. Gratis, in je browser, geen account.",
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

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/pdf-splitsen"
        title="PDF splitsen"
        intro="Haal de pagina's eruit die je nodig hebt, of knip het document in gelijke delen. Klikken op een pagina werkt net zo goed als een bereik typen."
        faq={faq}
      >
        <PdfSplitsen />
      </ToolPage>
    </>
  );
}
