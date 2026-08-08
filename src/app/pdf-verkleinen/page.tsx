// src/app/pdf-verkleinen/page.tsx
// [PDF-TOOLS] Public, login-free PDF compressor — a lead-gen tool aimed at the
// one moment every ZZP'er hits: an upload that refuses the file. Server
// component: owns the SEO metadata and structured data, and renders the
// interactive client half. Dutch slug on purpose — people search "pdf
// verkleinen", not "compress pdf". Added to PUBLIC_PATHS and to lib/tools.ts.

import type { Metadata } from "next";
import PdfVerkleinen from "./PdfVerkleinen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF verkleinen zonder de tekst te verliezen — gratis | BoekBrug",
  description:
    "Maak een PDF kleiner voor de upload bij de Belastingdienst of je boekhouder. Alleen de afbeeldingen gaan omlaag; je tekst blijft tekst. Gratis, in je browser, geen account.",
  keywords: [
    "pdf verkleinen",
    "pdf comprimeren",
    "pdf kleiner maken",
    "pdf te groot om te uploaden",
    "factuur verkleinen",
  ],
  alternates: { canonical: "/pdf-verkleinen" },
  openGraph: {
    title: "PDF verkleinen zonder de tekst te verliezen",
    description:
      "Kleiner voor de upload, en je tekst blijft doorzoekbaar. Gratis en direct in je browser.",
    type: "website",
  },
};

const faq = [
  {
    q: "Blijft mijn tekst doorzoekbaar?",
    a: "Ja, bij de standaardinstelling. Alleen de afbeeldingen in het document worden verkleind; de tekst en de lijnen worden niet aangeraakt. Kies je 'Alles', dan wordt elke pagina als afbeelding overgetekend en is de tekst geen tekst meer — dat staat er ook bij, want dat is zelden wat je wilt.",
  },
  {
    q: "Waarom wordt mijn PDF nauwelijks kleiner?",
    a: "Omdat er weinig in zit dat groot is. Een document van een paar bladzijden tekst is al klein; wat een PDF zwaar maakt zijn foto's en scans. Zitten er geen afbeeldingen in, dan zegt de tool dat en verandert er niets.",
  },
  {
    q: "Wordt mijn bestand geüpload?",
    a: "Nee. Het hele proces draait in je eigen browser. Er gaat geen enkel verzoek uit met je bestand erin — je kunt dat zelf nakijken in het netwerktabblad van je browser. Sluit je het tabblad, dan is alles weg.",
  },
  {
    q: "Hoe groot mag een bijlage bij de Belastingdienst zijn?",
    a: "Dat verschilt per portaal en per formulier. Loop je tegen een grens aan, dan is een scan meestal de oorzaak: die staat vaak op een veel hogere resolutie dan nodig. Zet de resolutie op 'Scherm' of 'Normaal' en het verschil is doorgaans groot.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF verkleinen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Gratis PDF-compressor die alleen de afbeeldingen verkleint, zodat de tekst doorzoekbaar blijft. Draait volledig in de browser.",
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

export default function PdfVerkleinenPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/pdf-verkleinen"
        title="PDF verkleinen"
        intro="Twee manieren, allebei eerlijk benoemd. Netjes opnieuw opslaan verandert niets aan de pagina's. De zware manier tekent ze opnieuw als afbeelding: veel kleiner, maar de tekst is dan geen tekst meer."
        faq={faq}
        close="Een kleinere PDF is één stap. In BoekBrug staan je bonnetjes, facturen en BTW bij elkaar — klaar voor je aangifte en je boekhouder."
      >
        <PdfVerkleinen />
      </ToolPage>
    </>
  );
}
