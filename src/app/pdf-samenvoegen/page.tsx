// src/app/pdf-samenvoegen/page.tsx
// [PDF-TOOLS] Public, login-free PDF tool.

import type { Metadata } from "next";
import PdfSamenvoegen from "./PdfSamenvoegen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF samenvoegen — bonnetjes en facturen in één document | BoekBrug",
  description:
    "Voeg meerdere PDF's samen tot één bestand. Bepaal de volgorde en kies per bestand welke pagina's meegaan. Gratis, in je browser, geen account.",
  keywords: ["pdf samenvoegen", "pdf's combineren", "meerdere pdf naar één", "bonnetjes samenvoegen"],
  alternates: { canonical: "/pdf-samenvoegen" },
  openGraph: {
    title: "PDF samenvoegen",
    description: "Meerdere PDF's tot één document, in de volgorde die jij bepaalt. En je hoeft niet alles mee te nemen: per best",
    type: "website",
  },
};

const faq = [
  {
    q: "Kan ik maar een deel van een bestand meenemen?",
    a: "Ja. Bij elk bestand staat een veld voor de pagina's: vul bijvoorbeeld 2-4 in, of klik op 'Toon pagina's' en klik de pagina's aan die je niet wilt. Laat je het leeg, dan gaat het hele document mee.",
  },
  {
    q: "Blijft de kwaliteit behouden?",
    a: "Ja. De pagina's worden overgezet zoals ze zijn — er wordt niets opnieuw getekend. Tekst blijft tekst en de bestandsgrootte blijft ongeveer de som van de delen.",
  },
  {
    q: "Hoeveel bestanden kan ik samenvoegen?",
    a: "Zoveel als je geheugen aankan. Het werk gebeurt in je browser, dus bij honderden pagina's tegelijk kan het even duren op een telefoon.",
  },
  {
    q: "Worden mijn documenten geüpload?",
    a: "Nee. Alles gebeurt op je eigen apparaat. Er gaat geen enkel verzoek uit met je bestanden erin.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF samenvoegen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Voeg meerdere PDF's samen tot één bestand. Bepaal de volgorde en kies per bestand welke pagina's meegaan. Gratis, in je browser, geen account.",
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
        slug="/pdf-samenvoegen"
        title="PDF samenvoegen"
        intro="Meerdere PDF's tot één document, in de volgorde die jij bepaalt. En je hoeft niet alles mee te nemen: per bestand kies je welke pagina's erin gaan."
        faq={faq}
        close="Eén document met je bonnetjes is een goed begin. In BoekBrug staan ze naast je facturen en je BTW — klaar voor je aangifte en je boekhouder."
      >
        <PdfSamenvoegen />
      </ToolPage>
    </>
  );
}
