// src/app/afbeelding-verkleinen/page.tsx
// [PDF-TOOLS] Public, login-free image compressor. The everyday case: a phone
// photo of a bonnetje is 4 MB and the upload will not take it.

import type { Metadata } from "next";
import AfbeeldingVerkleinen from "./AfbeeldingVerkleinen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Afbeelding verkleinen tot onder een MB — gratis | BoekBrug",
  description:
    "Maak een foto of schermafdruk kleiner tot onder de grens die je nodig hebt: 250 kB, 1 MB, 2 MB. Gratis, in je browser, je bestand blijft op je eigen apparaat.",
  keywords: [
    "afbeelding verkleinen",
    "foto verkleinen",
    "jpg verkleinen",
    "foto kleiner maken",
    "afbeelding comprimeren",
  ],
  alternates: { canonical: "/afbeelding-verkleinen" },
  openGraph: {
    title: "Afbeelding verkleinen",
    description: "Tot onder de grens die je nodig hebt. Gratis en direct in je browser.",
    type: "website",
  },
};

const faq = [
  {
    q: "Hoe klein kan een foto worden zonder dat je het ziet?",
    a: "Voor een bonnetje of een schermafdruk is 1 MB ruim voldoende, en meestal zie je het verschil met het origineel niet. De tool zakt eerst met de kwaliteit — dat kost de minste zichtbare details — en pas als dat op is met de afmetingen.",
  },
  {
    q: "Waarom is mijn foto van 4 MB te groot?",
    a: "Een moderne telefoon maakt foto's van twaalf megapixel of meer. Dat is prachtig om in te zoomen en volstrekt overbodig voor een bonnetje dat alleen leesbaar hoeft te zijn. Zet de maximale breedte op 2400 pixels en het bestand wordt vaak een fractie van wat het was.",
  },
  {
    q: "JPG, WebP of PNG?",
    a: "JPG voor foto's — dat is waar het formaat voor gemaakt is. WebP is nog kleiner bij dezelfde kwaliteit en wordt overal ondersteund, maar niet elk portaal accepteert het. PNG alleen als je transparantie nodig hebt; voor foto's is het juist groter.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Afbeelding verkleinen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Gratis afbeeldingscompressor met een instelbaar maximum in kB of MB. Draait volledig in de browser.",
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

export default function AfbeeldingVerkleinenPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/afbeelding-verkleinen"
        title="Afbeelding verkleinen"
        intro="Zeg hoe groot het bestand hoogstens mag zijn en de tool zoekt het op: eerst met kwaliteit, dan pas met afmetingen. Zonder dat je zelf hoeft te rekenen."
        faq={faq}
      >
        <AfbeeldingVerkleinen />
      </ToolPage>
    </>
  );
}
