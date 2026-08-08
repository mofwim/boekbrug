// src/app/afbeelding-omzetten/page.tsx
// [PDF-TOOLS] Public, login-free image tool.

import type { Metadata } from "next";
import AfbeeldingOmzetten from "./AfbeeldingOmzetten";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Afbeelding omzetten naar WebP, JPG of PNG — gratis | BoekBrug",
  description:
    "Zet foto's om naar WebP, JPG of PNG, meerdere tegelijk. Verander achteraf van formaat zonder opnieuw te uploaden. Gratis, in je browser, geen account.",
  keywords: ["afbeelding omzetten", "png naar jpg", "jpg naar webp", "webp maken", "afbeelding converteren"],
  alternates: { canonical: "/afbeelding-omzetten" },
  openGraph: {
    title: "Afbeelding omzetten",
    description: "WebP voor het web, JPG voor waar alles het doet, PNG als je transparantie nodig hebt. Meerdere bestanden tegel",
    type: "website",
  },
};

const faq = [
  {
    q: "Welk formaat moet ik kiezen?",
    a: "WebP is het kleinst bij dezelfde kwaliteit en wordt overal ondersteund — de standaardkeuze voor het web. JPG als het ergens naartoe moet waar je niet zeker weet of WebP mag. PNG alleen bij transparantie of harde lijnen.",
  },
  {
    q: "Kan ik achteraf een ander formaat kiezen?",
    a: "Ja. Zet je de keuze om, dan worden je afbeeldingen opnieuw omgezet uit het origineel — je hoeft ze niet nog een keer toe te voegen.",
  },
  {
    q: "Gaat er kwaliteit verloren?",
    a: "Bij JPG en WebP wel een beetje, en met de schuif bepaal je hoeveel. PNG verliest niets, maar is voor foto's juist groter.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Afbeelding omzetten",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Zet foto's om naar WebP, JPG of PNG, meerdere tegelijk. Verander achteraf van formaat zonder opnieuw te uploaden. Gratis, in je browser, geen account.",
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
        slug="/afbeelding-omzetten"
        title="Afbeelding omzetten"
        intro="WebP voor het web, JPG voor waar alles het doet, PNG als je transparantie nodig hebt. Meerdere bestanden tegelijk mag, en je kunt van gedachten veranderen."
        faq={faq}
      >
        <AfbeeldingOmzetten />
      </ToolPage>
    </>
  );
}
