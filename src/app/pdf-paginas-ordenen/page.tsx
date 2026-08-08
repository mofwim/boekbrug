// src/app/pdf-paginas-ordenen/page.tsx
// [PDF-TOOLS] Public, login-free PDF tool.

import type { Metadata } from "next";
import PdfPaginasOrdenen from "./PdfPaginasOrdenen";
import ToolPage from "@/components/tools/ToolPage";

export const metadata: Metadata = {
  title: "PDF-pagina's draaien, verplaatsen en verwijderen | BoekBrug",
  description:
    "Draai scheve pagina's recht, verplaats ze en gooi weg wat je niet nodig hebt — alles in één overzicht. Gratis, in je browser, geen account.",
  keywords: ["pdf pagina draaien", "pdf pagina verwijderen", "pdf pagina's ordenen", "pdf roteren"],
  alternates: { canonical: "/pdf-paginas-ordenen" },
  openGraph: {
    title: "PDF-pagina's ordenen",
    description: "Zet scheve pagina's rechtop en gooi eruit wat je niet wilt. Elke pagina staat als een tegel voor je; wat je aa",
    type: "website",
  },
};

const faq = [
  {
    q: "Mijn scan staat op zijn kant. Kan dat rechtgezet worden?",
    a: "Ja, dat is precies waar dit voor is. Onder elke pagina staan twee draaiknoppen. De draaiing wordt in het bestand opgeslagen, dus hij staat overal goed.",
  },
  {
    q: "Kan ik een verwijderde pagina terugzetten?",
    a: "Ja, tot je op Toepassen drukt. Een weggegooide pagina wordt lichter weergegeven en de knop verandert in een terugzetknop.",
  },
  {
    q: "Verandert de kwaliteit als ik pagina's draai?",
    a: "Nee. Er wordt niets opnieuw getekend — alleen de draaiing wordt genoteerd. De pagina blijft precies zo scherp als hij was.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "PDF-pagina's ordenen",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      description: "Draai scheve pagina's recht, verplaats ze en gooi weg wat je niet nodig hebt — alles in één overzicht. Gratis, in je browser, geen account.",
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
        slug="/pdf-paginas-ordenen"
        title="PDF-pagina's ordenen"
        intro="Zet scheve pagina's rechtop en gooi eruit wat je niet wilt. Elke pagina staat als een tegel voor je; wat je aanwijst verandert meteen."
        faq={faq}
      >
        <PdfPaginasOrdenen />
      </ToolPage>
    </>
  );
}
