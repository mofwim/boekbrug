// src/lib/vak-content.ts
// [VAK-CONTENT] The long-form content for the vakpagina's that have something of their own to say.
//
// The text is Dutch because it is read by a Dutch ondernemer on a public page — product content,
// not code (see AGENTS.md).
//
// WHY ONLY THREE VAKKEN HAVE AN ENTRY
// An audit of the eleven vakpagina's found that between 92% and 99% of every page's wording is
// shared with the other ten: all of it comes from the generator that renders on each. The answer
// to that is NOT a paragraph per vak with the trade name swapped — that produces eleven pages
// which differ in a noun, which is the shape a search engine collapses into one representative
// URL, and which gives a visitor nothing either.
//
// So a vak earns an entry here by having a QUESTION OF ITS OWN with a real answer:
//
//   · schilder    — 9% on labour for a home over two years old, 21% on materials, always.
//                   Getting it wrong is the single most common rate mistake in this file.
//   · bouw-klus   — the verleggingsregeling: no BTW charged at all, which is not 0% and not an
//                   exemption, and which people routinely conflate with both.
//   · loodgieter  — no exotic rate, but a genuinely composite invoice: hours, materials,
//                   voorrijkosten and out-of-hours work, each of which belongs on its own line.
//
// The other eight render exactly as before. A vak without a real question is better served by the
// short page it already has than by filler written to match its siblings.
//
// TONE: this explains a main rule; it never advises. Every rate stays the ondernemer's own choice
// — the same stance as vak-sjablonen.ts, where the safe 21% is pre-filled and the lower rate is a
// deliberate act. Each block therefore carries a `disclaimer` and none of them is optional.

import type { FaqItem } from "./invoice-tool-faq";

export interface VakInvoiceLine {
  /** The line as it would read on the invoice. */
  description: string;
  /** Why it is its own line. Not a rate — the rate is the ondernemer's call. */
  note: string;
}

export interface VakContent {
  /** The page heading. Overrides the generated one when present. */
  h1: string;
  title: string;
  description: string;
  /** Replaces the generic one-liner above the generator. */
  intro: string[];
  main: {
    heading: string;
    paragraphs: string[];
    disclaimer: string;
  };
  example: {
    heading: string;
    intro: string;
    lines: VakInvoiceLine[];
    note: string;
  };
  /** Rendered on the page AND emitted as FAQPage markup — one source, never two literals. */
  faq: FaqItem[];
}

export const VAK_CONTENT: Record<string, VakContent> = {
  // ───────────────────────────────────────────────────────────────────────────
  schilder: {
    // "en stukadoor" is not keyword padding: the templates carry a stucwerk line and the rate rule
    // below is written for both trades in vak-sjablonen.ts. Dropping it would leave the heading
    // narrower than the page's own content.
    h1: "Factuur maken voor schilder en stukadoor",
    title: "Factuur maken voor schilder | BoekBrug",
    description:
      "Maak eenvoudig een professionele factuur voor schilderwerk. Splits arbeidskosten en materialen en download je factuur direct als PDF.",
    intro: [
      "Als schilder of stukadoor factureer je zelden één ding. Op één klus staan arbeidsuren, verf en materiaal, en vaak voorbereidend werk zoals afplakken of schuren.",
      "Die regels zet je hieronder los van elkaar neer en download je als PDF — gratis, zonder account. Waarom dat scheiden bij dit vak meer uitmaakt dan bij de meeste andere, staat onder de generator.",
    ],
    main: {
      heading: "Arbeid en materiaal horen apart op de factuur",
      paragraphs: [
        "Voor schilder- en stukadoorswerk aan een woning die ouder is dan twee jaar kan over het ARBEIDSLOON het verlaagde tarief van 9% gelden. Het gaat daarbij om het werk zelf.",
        "De verf en het materiaal vallen daar niet vanzelf onder, ook niet als ze in dezelfde klus zitten. Beoordeel die regel op zichzelf in plaats van het tarief van het arbeidsloon over te nemen.",
        "Is de woning jonger dan twee jaar, dan is er geen verlaagd tarief om te verdelen.",
        "Staan arbeid en materiaal op één regel, dan is achteraf niet te zien welk deel tegen welk tarief is berekend — en dan valt het lage tarief niet te onderbouwen als er later naar gevraagd wordt. Twee regels in plaats van één kosten je tien seconden en lossen dat op.",
      ],
      disclaimer:
        "Dit is de hoofdregel in gewone woorden, geen belastingadvies. Of het verlaagde tarief in jouw situatie geldt hangt af van de woning en van het werk; controleer het bij twijfel bij de Belastingdienst of je boekhouder.",
    },
    example: {
      heading: "Zo ziet zo'n factuur eruit",
      intro: "Dezelfde klus, uit elkaar gehaald in regels die elk hun eigen tarief kunnen dragen:",
      lines: [
        { description: "Schilderwerk binnen — arbeidsloon", note: "het werk zelf, per uur" },
        { description: "Voorbereiden en afplakken", note: "hoort bij het arbeidsloon" },
        { description: "Verf en materiaal", note: "wat je levert, op een eigen regel" },
      ],
      note: "De bedragen en het tarief per regel vul je zelf in. BoekBrug rekent het totaal uit en kiest nooit een tarief voor je.",
    },
    faq: [
      {
        q: "Welk BTW-tarief geldt voor schilderwerk?",
        a: "Het gewone tarief is 21%. Voor schilder- en stukadoorswerk aan een woning die ouder is dan twee jaar kan over het arbeidsloon het verlaagde tarief van 9% gelden. Welk tarief per regel klopt, hangt af van de woning en het werk.",
      },
      {
        q: "Wanneer kan ik 9% BTW gebruiken voor schilderwerk?",
        a: "De regel draait om twee dingen: het moet gaan om schilder- of stukadoorswerk, en de woning moet ouder zijn dan twee jaar. Het verlaagde tarief gaat dan over het arbeidsloon, niet automatisch over de materialen. Ga per klus na of aan de voorwaarden is voldaan.",
      },
      {
        q: "Hoe zet ik arbeidskosten en materialen op mijn factuur?",
        a: "Als aparte regels. Zet het arbeidsloon op een eigen regel met je uren, en de verf en het materiaal op een andere. Op één regel samen is niet te zien welk deel tegen welk tarief is berekend, en dan kun je het lage tarief niet onderbouwen.",
      },
      {
        q: "Kan ik als schilder gratis een factuur maken?",
        a: "Ja, en zonder account. Het formulier hierboven zet de regels voor schilder- en stukadoorswerk alvast klaar, met arbeid en materiaal al uit elkaar gehaald — precies de splitsing die je nodig hebt om een tarief te kunnen onderbouwen.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  "bouw-klus": {
    h1: "Factuur maken voor bouwbedrijf en klusbedrijf",
    title: "Factuur maken voor bouwbedrijf | BoekBrug",
    description:
      "Maak eenvoudig een factuur voor bouw- en kluswerk. Lees wanneer BTW verlegd geldt en download je professionele factuur als PDF.",
    intro: [
      "Bouw- en kluswerk factureer je aan twee heel verschillende opdrachtgevers, en dat verschil bepaalt hoe de factuur eruitziet.",
      "Werk je rechtstreeks voor een particulier, dan reken je gewoon BTW. Werk je als onderaannemer voor een aannemer, dan kan de verleggingsregeling gelden en breng je juist géén BTW in rekening. Wat dat voor je factuurregels betekent, staat onder de generator.",
    ],
    main: {
      heading: "BTW verlegd is niet hetzelfde als 0%",
      paragraphs: [
        "Bij de verleggingsregeling breng je zelf geen BTW in rekening: je opdrachtgever geeft die aan. Op de factuur staat dan de vermelding 'BTW verlegd', samen met het BTW-nummer van die opdrachtgever.",
        "Dat is iets anders dan 0% en iets anders dan een vrijstelling. Bij 0% en bij een vrijstelling zit de bijzonderheid in de prestatie zelf; bij verlegging verschuift alleen WIE de BTW aangeeft. Voor je administratie en je aangifte zijn dat drie verschillende dingen die je niet door elkaar moet halen.",
        "De regeling geldt niet automatisch voor alles wat 'bouw' heet. Onderaanneming in de bouw is de bekendste situatie, maar het hangt af van het soort werk én van wie je opdrachtgever is. Werk je rechtstreeks voor een particulier, dan is verlegging niet aan de orde.",
        "Ga daarom per opdracht na of de regeling van toepassing is vóórdat je de factuur verstuurt — niet erna.",
      ],
      disclaimer:
        "Dit legt het verschil uit tussen drie dingen die op elkaar lijken; het is geen belastingadvies en geen oordeel over jouw opdracht. Twijfel je of verlegging geldt, leg de opdracht dan voor aan je boekhouder of aan de Belastingdienst.",
    },
    example: {
      heading: "Een factuurregel met BTW verlegd",
      intro: "Geldt de regeling, dan verandert er twee dingen aan de factuur — het tarief en een vermelding:",
      lines: [
        { description: "Timmerwerk — arbeidsloon", note: "0%, met 'BTW verlegd' in de omschrijving" },
        { description: "Materiaal (zie specificatie)", note: "hoort bij dezelfde prestatie" },
      ],
      note: "Zet daarnaast het BTW-nummer van je opdrachtgever op de factuur. In BoekBrug kies je 0% als tarief en zet je de vermelding 'BTW verlegd' in de omschrijving — 0% is hier de manier om het te noteren, niet de reden.",
    },
    faq: [
      {
        q: "Wanneer geldt BTW verlegd in de bouw?",
        a: "De bekendste situatie is onderaanneming: je werkt voor een aannemer die het werk doorlevert aan zijn eigen opdrachtgever. Of de regeling geldt hangt af van het soort werk en van wie je opdrachtgever is. Werk je rechtstreeks voor een particulier, dan geldt ze niet.",
      },
      {
        q: "Wat zet ik op een factuur met BTW verlegd?",
        a: "Je brengt geen BTW in rekening en zet de vermelding 'BTW verlegd' op de factuur, samen met het BTW-nummer van je opdrachtgever. De rest van de factuur blijft hetzelfde: je gegevens, de klant, een factuurnummer, de datum en het bedrag.",
      },
      {
        q: "Is BTW verlegd hetzelfde als 0% BTW?",
        a: "Nee. Bij 0% hoort een tarief bij de prestatie zelf. Bij verlegging is er wel BTW, maar geeft je opdrachtgever die aan in plaats van jij. In een factuurprogramma kies je vaak 0% om het te noteren — dat is de invoerwijze, niet de betekenis.",
      },
      {
        q: "Kan een klusbedrijf gratis een factuur maken?",
        a: "Ja, kosteloos en zonder registratie. De posten die bij bouw- en kluswerk horen staan klaar, en geldt de verleggingsregeling, dan kies je per regel 0% en zet je de vermelding in de omschrijving.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  loodgieter: {
    // Same test as "en stukadoor" above: the templates carry "Arbeidsloon installateur" and
    // "Plaatsen sanitair", so installateur is what the page already serves.
    h1: "Factuur maken voor loodgieter en installateur",
    title: "Factuur maken voor loodgieter | BoekBrug",
    description:
      "Maak snel een professionele factuur voor loodgieterswerk. Voeg arbeidsuren, materialen en voorrijkosten toe en download je factuur als PDF.",
    intro: [
      "Een loodgietersfactuur bestaat zelden uit één regel. Een lekkage opsporen, een kraan vervangen, een ketel onderhouden — er zitten arbeidsuren in, materiaal, en meestal voorrijkosten.",
      "Die regels staan hieronder al klaar. Je vult je eigen bedragen in en downloadt de factuur als PDF, zonder account. Hoe je zo'n factuur het beste indeelt, staat onder de generator.",
    ],
    main: {
      heading: "Hoe je een loodgietersfactuur indeelt",
      paragraphs: [
        "Arbeidsuren op een eigen regel, met het aantal uren en je tarief. Dan is achteraf navraag makkelijk en ziet de klant waar hij voor betaalt.",
        "Materiaal en onderdelen op een aparte regel, met een specificatie zodra het om meer dan één ding gaat.",
        "Voorrijkosten zijn een vaste post, geen uurtarief. Zet ze als eigen regel neer in plaats van ze in je uurtarief te verstoppen — een klant die de post ziet staan belt daar minder vaak over dan een klant die alleen een hoger totaal ziet.",
        "Werk buiten kantooruren of spoed reken je apart af als je daar een toeslag voor hanteert. Ook dat is een eigen regel, om dezelfde reden.",
        "Loodgieterswerk valt onder het normale tarief van 21%. Het verlaagde tarief dat voor woningen ouder dan twee jaar bestaat, hoort bij schilder-, stukadoors- en isolatiewerk, niet bij installatiewerk. Zit er isolatiewerk in de klus, zet die regel dan apart en beoordeel het tarief voor die regel op zichzelf.",
      ],
      disclaimer:
        "Welk tarief per regel geldt, hangt af van het werk en de situatie. Dit is uitleg over hoe je de factuur indeelt, geen belastingadvies — BoekBrug kiest nooit een tarief voor je.",
    },
    example: {
      heading: "Een loodgietersfactuur, regel voor regel",
      intro: "Eén klus, vier regels die elk iets anders zeggen:",
      lines: [
        { description: "Arbeidsloon installateur", note: "per uur" },
        { description: "Materiaal (zie specificatie)", note: "onderdelen apart van het werk" },
        { description: "Voorrijkosten", note: "vaste post, geen uurtarief" },
        { description: "Spoedtoeslag buiten kantooruren", note: "alleen als je die rekent" },
      ],
      note: "De bedragen zijn van jou: BoekBrug vult nooit een prijs of een tarief voor je in.",
    },
    faq: [
      {
        q: "Hoe maak ik een factuur als loodgieter?",
        a: "Zet je arbeidsuren, het materiaal en de voorrijkosten elk op een eigen regel, vul je bedragen in en download de factuur als PDF. De gebruikelijke regels voor loodgieterswerk staan op deze pagina al klaar.",
      },
      {
        q: "Kan ik arbeidsuren en materialen apart op mijn factuur zetten?",
        a: "Ja, en dat is ook de bedoeling. Aparte regels maken zichtbaar waar de klant voor betaalt, en ze laten je per regel het tarief kiezen dat bij die regel hoort.",
      },
      {
        q: "Hoe vermeld ik voorrijkosten op een factuur?",
        a: "Als een eigen regel met een vast bedrag, niet verwerkt in je uurtarief. Dan ziet de klant de post staan en is er achteraf niets uit te leggen.",
      },
      {
        q: "Kan ik als loodgieter gratis een factuur maken?",
        a: "Ja. Je maakt de factuur direct in je browser en downloadt hem als PDF. Je hebt geen account nodig en er zijn geen kosten.",
      },
    ],
  },
};

/** The long-form content for a vak, or undefined for the eight that render as before. */
export function vakContentBySlug(slug: string): VakContent | undefined {
  return VAK_CONTENT[slug];
}
