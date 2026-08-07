// src/app/afbeeldingen-uit-pdf/page.tsx
// [PDF-TOOLS] Public, login-free image extraction from a PDF.

import type { Metadata } from "next";
import AfbeeldingenUitPdf from "./AfbeeldingenUitPdf";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Afbeeldingen uit een PDF halen — gratis | BoekBrug",
  description:
    "Haal de foto's en logo's uit een PDF, op hun eigen resolutie. Los opslaan of alles in één zip. Gratis, in je browser, geen account.",
  keywords: [
    "afbeeldingen uit pdf",
    "foto uit pdf halen",
    "plaatjes uit pdf",
    "logo uit pdf halen",
  ],
  alternates: { canonical: "/afbeeldingen-uit-pdf" },
  openGraph: {
    title: "Afbeeldingen uit een PDF halen",
    description: "De foto's en logo's uit een document, op hun eigen resolutie. Gratis.",
    type: "website",
  },
};

const faq = [
  {
    q: "Wat is het verschil met 'PDF naar JPG'?",
    a: "Deze tool haalt de afbeeldingen eruit die er ín zitten — een logo, een foto — op de resolutie waarop ze zijn ingevoegd. 'PDF naar JPG' tekent de hele pagina over als één plaatje, inclusief de tekst. Bij een scan is de hele pagina één afbeelding, dus dan wil je die andere.",
  },
  {
    q: "Waarom vindt hij niets in mijn document?",
    a: "Dan zitten er geen losse afbeeldingen in. Een document van alleen tekst en lijnen heeft ze niet, en bij een scan is de pagina zelf de afbeelding.",
  },
  {
    q: "In welk formaat komen ze terug?",
    a: "Als PNG, zodat er niets verloren gaat bij het uitpakken. Wil je ze kleiner hebben, haal ze dan daarna door 'Afbeelding verkleinen'.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Afbeeldingen uit PDF",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Haalt de ingesloten afbeeldingen uit een PDF op hun eigen resolutie, in de browser.",
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

export default function AfbeeldingenUitPdfPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/afbeeldingen-uit-pdf"
        title="Afbeeldingen uit een PDF"
        intro="De foto's en logo's die in het document zitten, op de resolutie waarop ze erin zijn gezet — niet de pagina's overgetekend."
        faq={faq}
      >
        <AfbeeldingenUitPdf />
      </ToolPage>
    </>
  );
}
