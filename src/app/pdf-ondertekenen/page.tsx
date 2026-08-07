// src/app/pdf-ondertekenen/page.tsx
// [PDF-TOOLS] Public, login-free PDF tool.

import type { Metadata } from "next";
import PdfOndertekenen from "./PdfOndertekenen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF ondertekenen zonder printen — gratis | BoekBrug",
  description:
    "Zet je handtekening op een offerte of contract: teken hem met je vinger of upload een foto, en wijs aan waar hij komt. Gratis, in je browser, geen account.",
  keywords: ["pdf ondertekenen", "handtekening pdf", "offerte ondertekenen", "digitaal ondertekenen"],
  alternates: { canonical: "/pdf-ondertekenen" },
  openGraph: {
    title: "PDF ondertekenen",
    description: "Teken met je muis of je vinger, of gebruik een foto van je handtekening. Wijs op de pagina waar hij moet komen",
    type: "website",
  },
};

const faq = [
  {
    q: "Is dit een rechtsgeldige handtekening?",
    a: "Het is een afbeelding van je handtekening op de pagina — in de praktijk genoeg voor een offerte of een opdrachtbevestiging, en dat is waar het meestal om gaat. Het is géén gekwalificeerde digitale handtekening met certificaat; die heb je nodig bij documenten waar de wet dat eist.",
  },
  {
    q: "Kan ik met mijn vinger tekenen?",
    a: "Ja. Op een telefoon of tablet teken je gewoon op het vak. Met 'Laatste weg' haal je alleen de laatste haal terug in plaats van opnieuw te beginnen.",
  },
  {
    q: "Gaat mijn handtekening naar een server?",
    a: "Nee. Zowel het document als je handtekening blijven in je browser. Er wordt niets geüpload en niets bewaard.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF ondertekenen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Zet je handtekening op een offerte of contract: teken hem met je vinger of upload een foto, en wijs aan waar hij komt. Gratis, in je browser, geen account.",
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
        slug="/pdf-ondertekenen"
        title="PDF ondertekenen"
        intro="Teken met je muis of je vinger, of gebruik een foto van je handtekening. Wijs op de pagina waar hij moet komen — zonder printen en scannen."
        faq={faq}
      >
        <PdfOndertekenen />
      </ToolPage>
    </>
  );
}
