// src/app/favicon-maken/page.tsx
// [PDF-TOOLS] Public, login-free image tool.

import type { Metadata } from "next";
import FaviconMaken from "./FaviconMaken";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Favicon maken van je logo — alle maten en .ico | BoekBrug",
  description:
    "Maak van één afbeelding een complete set favicons: het .ico-bestand, alle PNG-maten en de HTML-regels. Gratis, in je browser, geen account.",
  keywords: ["favicon maken", "favicon generator", "ico maken", "apple touch icon"],
  alternates: { canonical: "/favicon-maken" },
  openGraph: {
    title: "Favicon maken",
    description: "Eén logo erin, alle maten eruit — inclusief het .ico-bestand en de regels die je in je HTML plakt.",
    type: "website",
  },
};

const faq = [
  {
    q: "Welke maten heb ik nodig?",
    a: "In de praktijk: favicon.ico voor oude browsers, 32×32 voor het tabblad, 180×180 voor een iPhone die je site op het beginscherm zet, en 192×192 voor Android. Die zitten er allemaal bij, plus een paar extra.",
  },
  {
    q: "Waarom een achtergrondkleur?",
    a: "Een doorzichtig logo kan wegvallen op een donkere tabbladbalk. Zet je er een vulkleur onder, dan blijft het altijd zichtbaar.",
  },
  {
    q: "Waar zet ik de bestanden neer?",
    a: "In de hoofdmap van je site, naast index.html. Plak daarna de regels uit het laatste vak in de <head> van je pagina's.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Favicon maken",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Maak van één afbeelding een complete set favicons: het .ico-bestand, alle PNG-maten en de HTML-regels. Gratis, in je browser, geen account.",
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
        slug="/favicon-maken"
        title="Favicon maken"
        intro="Eén logo erin, alle maten eruit — inclusief het .ico-bestand en de regels die je in je HTML plakt."
        faq={faq}
      >
        <FaviconMaken />
      </ToolPage>
    </>
  );
}
