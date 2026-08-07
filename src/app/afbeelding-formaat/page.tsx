// src/app/afbeelding-formaat/page.tsx
// [PDF-TOOLS] Public, login-free image tool.

import type { Metadata } from "next";
import AfbeeldingFormaat from "./AfbeeldingFormaat";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Afbeelding op de juiste maat — social media en web | BoekBrug",
  description:
    "Zet een foto in één klik op het formaat van LinkedIn, Instagram, een Open Graph-plaatje of een e-mailheader. Gratis, in je browser, geen account.",
  keywords: ["afbeelding formaat", "foto bijsnijden", "linkedin formaat", "open graph afbeelding", "instagram formaat"],
  alternates: { canonical: "/afbeelding-formaat" },
  openGraph: {
    title: "Afbeelding op maat",
    description: "Kies waar de afbeelding voor is en hij wordt meteen op die maat gezet. Vullen snijdt bij, passend houdt alles ",
    type: "website",
  },
};

const faq = [
  {
    q: "Wat is het verschil tussen vullen en passend?",
    a: "Vullen maakt de afbeelding precies zo groot als het kader en snijdt weg wat er niet in past — goed voor foto's. Passend houdt de hele afbeelding zichtbaar en vult de rest met een kleur naar keuze — goed voor een logo dat compleet moet blijven.",
  },
  {
    q: "Welke maat heb ik nodig?",
    a: "Dat staat in de lijst, per platform. Voor een link die je deelt is Open Graph (1200×630) bijna altijd de juiste; voor LinkedIn een bericht van 1200×627.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Afbeelding op maat",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Zet een foto in één klik op het formaat van LinkedIn, Instagram, een Open Graph-plaatje of een e-mailheader. Gratis, in je browser, geen account.",
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
        slug="/afbeelding-formaat"
        title="Afbeelding op maat"
        intro="Kies waar de afbeelding voor is en hij wordt meteen op die maat gezet. Vullen snijdt bij, passend houdt alles zichtbaar met een rand."
        faq={faq}
      >
        <AfbeeldingFormaat />
      </ToolPage>
    </>
  );
}
