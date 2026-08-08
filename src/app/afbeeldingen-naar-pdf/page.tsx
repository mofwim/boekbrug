// src/app/afbeeldingen-naar-pdf/page.tsx
// [PDF-TOOLS] Public, login-free JPG/PNG → PDF. The bonnetjes case: a quarter's
// worth of receipts photographed on a phone, wanted as one document.

import type { Metadata } from "next";
import AfbeeldingenNaarPdf from "./AfbeeldingenNaarPdf";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "Foto's naar PDF — bonnetjes in één document | BoekBrug",
  description:
    "Zet foto's van je bonnetjes of JPG- en PNG-bestanden om naar één PDF. Sleep ze in de goede volgorde en download. Gratis, geen account, alles blijft op je apparaat.",
  keywords: [
    "afbeeldingen naar pdf",
    "jpg naar pdf",
    "foto naar pdf",
    "bonnetjes naar pdf",
    "png naar pdf",
  ],
  alternates: { canonical: "/afbeeldingen-naar-pdf" },
  openGraph: {
    title: "Foto's naar PDF",
    description: "Bonnetjes en foto's als één nette PDF. Gratis en direct in je browser.",
    type: "website",
  },
};

const faq = [
  {
    q: "Kan ik de volgorde van de pagina's bepalen?",
    a: "Ja. Nadat je de afbeeldingen hebt toegevoegd staan ze in een lijst met pijltjes ernaast. De volgorde in die lijst is de volgorde in de PDF.",
  },
  {
    q: "Welke bestanden kan ik gebruiken?",
    a: "JPG en PNG. Een foto van je telefoon is bijna altijd JPG, dus die gaat er zo in. Andere bestanden worden geweigerd zodra je ze toevoegt, niet pas bij het opslaan.",
  },
  {
    q: "Waarom worden mijn bonnetjes op A4 gezet?",
    a: "Zodat het document er hetzelfde uitziet als de rest van je administratie en normaal print. Wil je dat elke pagina precies zo groot is als de foto, kies dan 'Op maat'.",
  },
  {
    q: "Is dit geschikt voor mijn boekhouding?",
    a: "Voor het verzamelen wel: één PDF met je bonnetjes is makkelijker te bewaren en door te sturen dan dertig losse foto's. Let er wel op dat de bedragen leesbaar blijven — bewaar de originelen zolang je bewaarplicht loopt.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Afbeeldingen naar PDF",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description:
        "Zet JPG- en PNG-afbeeldingen om naar één PDF, met instelbare volgorde, marge en papierformaat. Draait in de browser.",
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

export default function AfbeeldingenNaarPdfPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ToolPage
        slug="/afbeeldingen-naar-pdf"
        title="Afbeeldingen naar PDF"
        intro="Eén foto per pagina, in de volgorde die jij bepaalt. Handig om een kwartaal aan bonnetjes als één document te bewaren."
        faq={faq}
        close="Bonnetjes verzamelen is stap één. In BoekBrug staan ze naast je facturen en je BTW — klaar voor je aangifte en je boekhouder."
      >
        <AfbeeldingenNaarPdf />
      </ToolPage>
    </>
  );
}
