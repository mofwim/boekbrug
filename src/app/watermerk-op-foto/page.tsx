// src/app/watermerk-op-foto/page.tsx
// [PDF-TOOLS] Public, login-free image tool.

import type { Metadata } from "next";
import WatermerkOpFoto from "./WatermerkOpFoto";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Watermerk op een foto zetten — gratis | BoekBrug",
  description:
    "Zet je naam of bedrijfsnaam als watermerk op een foto. Kies plek, grootte en doorzichtigheid, en zie het meteen. Gratis, in je browser, geen account.",
  keywords: ["watermerk foto", "watermerk toevoegen", "logo op foto", "copyright op foto"],
  alternates: { canonical: "/watermerk-op-foto" },
  openGraph: {
    title: "Watermerk op een foto",
    description: "Je naam of je bedrijf over de foto, in de hoek of over het hele beeld. Je ziet het meteen — er is niets om op ",
    type: "website",
  },
};

const faq = [
  {
    q: "Beschermt een watermerk mijn foto?",
    a: "Het maakt hergebruik zonder toestemming lastiger en duidelijk zichtbaar, maar het is geen slot. Wie wil kan het wegwerken. Over het hele beeld is moeilijker weg te halen dan alleen in een hoek.",
  },
  {
    q: "Waarom is mijn watermerk zo klein of zo groot?",
    a: "De grootte is een percentage van de foto, niet een vast aantal pixels. Zo ziet hij er hetzelfde uit op een telefoonkiekje als op een bestand van je camera.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Watermerk op een foto",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Zet je naam of bedrijfsnaam als watermerk op een foto. Kies plek, grootte en doorzichtigheid, en zie het meteen. Gratis, in je browser, geen account.",
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
        slug="/watermerk-op-foto"
        title="Watermerk op een foto"
        intro="Je naam of je bedrijf over de foto, in de hoek of over het hele beeld. Je ziet het meteen — er is niets om op te drukken."
        faq={faq}
      >
        <WatermerkOpFoto />
      </ToolPage>
    </>
  );
}
