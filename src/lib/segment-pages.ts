// src/lib/segment-pages.ts
// [SEGMENT-VOORDEUR] The copy for the segment front doors. Pure data — no I/O, no JSX.
//
// ── ONE PRODUCT, THREE MESSAGES ──
//
// Not three products and not three codebases: the same app, entered through the door that names
// the reader's own day. The renderer is one component; everything that differs between segments
// is here, in a list a person can read end to end and check.
//
// ── WHY THESE THREE, AND WHY NOT THE OBVIOUS ONES ──
//
// The tempting list starts with IT freelancers and consultants. Measured against what this app
// actually does well, that is the wrong end. On one real administration the app handled 275
// INCOMING documents a month — supplier invoices by e-mail, a cash drawer, a till, 9% and 21%
// mixed — and everything deep in this product lives on that side: the reader, the grounding, the
// duplicate probe, the bank match, the kasboek, the quarter close.
//
// A consultant receives almost no invoices. Their whole month is two invoices OUT, which is the
// one surface where the incumbents are strongest and this app is not yet. Leading with them means
// competing on somebody else's home ground while the ground we do own goes unmentioned.
//
// So the order is by how much paper a month hits the reader:
//   1. winkel / horeca / groothandel-inkoop — the measured profile, hundreds of documents
//   2. bouw / klus / installatie            — materials from many suppliers, receipts, hours
//   3. schoonmaak                           — the same clients every month, so recurring billing
//
// The accountant already has a front door at /voor-boekhouders and is not repeated here.
//
// ── THE RULE THIS FILE IS UNDER ──
//
// The same one /voor-boekhouders states, and it is the reason `claims` exists: ONLY WHAT EXISTS.
// Every promise names a dashboard route, a [SEGMENT-VOORDEUR] gate asserts that route has a page,
// and a promise whose screen is deleted fails the build instead of quietly becoming a lie. What
// tempted me while writing these: mileage. There is a vehicles API and no screen, so no page says
// a word about kilometers.
//
// Dutch, and not translated: this is what a Dutch entrepreneur reads before they have an account.

export interface SegmentStep {
  /** The dashboard route this step is about, without the leading /dashboard/. */
  route: string;
  title: string;
  body: string;
}

export interface SegmentPage {
  /** URL segment under /voor-… */
  slug: string;
  /** Browser title and H1. */
  naam: string;
  title: string;
  description: string;
  keywords: string[];
  /** The reader's own day, in one sentence. Never the word "boekhouding". */
  probleem: string;
  /** What changes. One sentence, checkable. */
  belofte: string;
  stappen: SegmentStep[];
  /** What this app does NOT do for them. Same reason as on the accountant page. */
  nietDit: string[];
}

/**
 * The three doors. Order is deliberate — see the header.
 *
 * Every `route` here must exist under src/app/dashboard/<route>/page.tsx.
 */
export const SEGMENT_PAGES: readonly SegmentPage[] = [
  {
    slug: 'winkel',
    naam: 'winkels, horeca en groothandel-inkoop',
    title: 'BoekBrug voor winkel en horeca — honderden inkoopfacturen, zonder avondwerk',
    description:
      'Je leveranciers mailen de hele week facturen. BoekBrug leest ze, koppelt ze aan je ' +
      'bankafschrift, houdt je kas bij en zet je kwartaal klaar voor de boekhouder.',
    keywords: [
      'boekhouding winkel', 'administratie horeca', 'inkoopfacturen automatisch verwerken',
      'kasboek winkel', 'dagomzet bijhouden', 'btw 9 procent horeca',
    ],
    probleem:
      'Er komen elke week tientallen inkoopfacturen binnen — per mail, in een doos, soms als foto. ' +
      'Daarnaast een kassa, een la met contant geld, en twee btw-tarieven door elkaar. Het werk is ' +
      'niet moeilijk. Het is alleen nooit klaar.',
    belofte:
      'Je stuurt of fotografeert het document één keer. BoekBrug leest het, zoekt de betaling in je ' +
      'bankafschrift, en zegt precies welke stukken er nog missen voordat je het kwartaal afsluit.',
    stappen: [
      {
        route: 'incoming',
        title: 'Inkoopfacturen die zichzelf inlezen',
        body:
          'Koppel je mailbox, of maak een foto. Leverancier, datum, factuurnummer en de btw-splitsing ' +
          'worden gelezen. Een factuur waar niets op aan te merken valt, boekt zichzelf — en bij elke ' +
          'factuur die tóch op je wacht, staat erbij waaróm.',
      },
      {
        route: 'bank',
        title: 'Je bankafschrift koppelt zichzelf aan je facturen',
        body:
          'Bankregels worden gematcht op factuurnummer, bedrag en rekeningnummer. Wat niet zeker is, ' +
          'krijgt geen gok maar een uitleg: één factuur kiezen, of één keer een categorie geven.',
      },
      {
        route: 'kas',
        title: 'Kasboek en dagomzet, met een saldo dat klopt',
        body:
          'Beginsaldo, contante uitgaven, kasomzet uit de kassa — in één lopend saldo dat je tegen de ' +
          'la in je zaak kunt leggen. Kan de koppeling met je facturen even niet bijwerken, dan zegt ' +
          'het scherm dat, in plaats van een saldo te tonen dat achterloopt.',
      },
      {
        route: 'aangifte',
        title: 'Concept-btw en het kwartaal in één keer klaar',
        body:
          'Rubriek 1a, 1b, 5b en 5a live, over elke periode. En als je afsluit, ziet je boekhouder wat ' +
          'er nog ontbreekt — voordat hij ernaar moet vragen.',
      },
    ],
    nietDit: [
      'BoekBrug doet je aangifte niet vóór je: je stuurt hem zelf in, of je boekhouder doet dat.',
      'Er is geen koppeling met kassasystemen; dagomzet voer je per dag in of importeer je.',
      'Voorraad wordt niet bijgehouden.',
    ],
  },
  {
    slug: 'bouw',
    naam: 'bouw, klus en installatie',
    title: 'BoekBrug voor de bouw — van uren en materiaal naar één factuur',
    description:
      'Uren op de bouwplaats, bonnetjes in de bus, materiaal van tien leveranciers. BoekBrug zet ' +
      'je uren op de factuur en leest je inkoopbonnen zelf in.',
    keywords: [
      'administratie bouw zzp', 'uren op factuur zetten', 'bonnetjes scannen bouw',
      'offerte maken bouw', 'boekhouding klusbedrijf',
    ],
    probleem:
      'Je uren staan in een appje, je bonnetjes in de bus, en het materiaal komt van tien ' +
      'leveranciers. Aan het eind van de maand moet dat alles één factuur worden — en dat is precies ' +
      'het moment dat je liever nog een klus doet.',
    belofte:
      'Je schrijft je uren op de dag zelf. Als je factureert, staan ze er al op — met de bonnen van ' +
      'die klus erbij.',
    stappen: [
      {
        route: 'uren',
        title: 'Uren die op de factuur belanden',
        body:
          'Schrijf uren per klant en per dag. Bij het maken van een factuur kies je welke uren mee ' +
          'moeten; ze komen als regels op de factuur en worden meteen als gefactureerd gemarkeerd, ' +
          'zodat je ze nooit twee keer stuurt.',
      },
      {
        route: 'incoming',
        title: 'Materiaal en bonnen, met de telefoon',
        body:
          'Foto van de bon bij de groothandel, of laat de leverancier mailen. Bedragen en btw worden ' +
          'gelezen, en een bon die contant of met de pin is betaald wordt als betaald afgehandeld in ' +
          'plaats van als openstaande schuld.',
      },
      {
        route: 'facturen',
        title: 'Offerte, en daarna dezelfde factuur',
        body:
          'Maak een offerte, laat hem akkoord geven, en zet hem om in de factuur — met dezelfde ' +
          'regels, zonder overtypen.',
      },
      {
        route: 'klaar',
        title: 'Wat er nog mist, vóór het kwartaal dicht is',
        body:
          'Eén scherm dat zegt welke bonnen er nog ontbreken en welke bankregels nog geen factuur ' +
          'hebben — zodat je boekhouder niet achter je aan hoeft te bellen.',
      },
    ],
    nietDit: [
      'Er is geen kilometer- of rittenregistratie in het scherm.',
      'Er is geen projectcalculatie of meerwerkadministratie.',
      'Materiaalvoorraad wordt niet bijgehouden.',
    ],
  },
  {
    slug: 'schoonmaak',
    naam: 'schoonmaakbedrijven',
    title: 'BoekBrug voor de schoonmaak — vaste klanten, facturen die zichzelf klaarzetten',
    description:
      'Elke maand dezelfde klanten en vrijwel dezelfde bedragen. BoekBrug zet de factuur elke ' +
      'periode voor je klaar; jij drukt op versturen. Herinneren aan wie te laat is kan het zelf.',
    keywords: [
      'terugkerende facturen', 'automatisch factureren schoonmaak', 'administratie schoonmaakbedrijf',
      'facturatie vaste klanten', 'herinnering sturen factuur',
    ],
    probleem:
      'Elke maand dezelfde klanten, vrijwel dezelfde bedragen, en toch elke maand hetzelfde half uur ' +
      'overtypen. En daarna onthouden wie er niet betaald heeft.',
    belofte:
      'De factuur van deze maand staat klaar voordat je eraan denkt. Jij leest hem na en drukt op ' +
      'versturen — dat is het hele werk.',
    stappen: [
      {
        route: 'facturen',
        title: 'Terugkerende facturen, elke periode klaargezet',
        body:
          'Tik één keer op een factuur die je al stuurde en kies: wekelijks, maandelijks, per ' +
          'kwartaal of per jaar. Elke periode staat er een nieuw concept klaar met dezelfde regels. ' +
          'Versturen doe jij — de app stuurt nooit uit zichzelf een factuur naar je klant, want een ' +
          'verkeerde factuur die vanzelf de deur uit gaat krijg je niet meer terug.',
      },
      {
        route: 'klanten',
        title: 'Je klanten op één plek',
        body:
          'Adres, btw-nummer en betaaltermijn per klant — één keer invullen, daarna staat het op elke ' +
          'factuur die je stuurt.',
      },
      {
        route: 'uren',
        title: 'Extra uren erbij, als er meer gedaan is',
        body:
          'Een maand met extra werk? Schrijf de uren en zet ze op dezelfde factuur, zonder een tweede ' +
          'document te hoeven maken.',
      },
      {
        route: 'bank',
        title: 'En je ziet wie er betaald heeft',
        body:
          'Je bankafschrift wordt aan je facturen gekoppeld, dus "wie moet er nog betalen" is een ' +
          'lijst en geen zoektocht. Zet je herinneringen aan, dan mailt BoekBrug wie te laat is — ' +
          'oplopend, en nooit twee keer dezelfde.',
      },
    ],
    nietDit: [
      'Een terugkerende factuur wordt als concept klaargezet, niet verstuurd: die knop houd jij.',
      'Herinneringen staan uit tot je ze zelf aanzet.',
      'Er is geen planning of urenroostering voor personeel.',
      'Er wordt niet automatisch geïncasseerd; betalen doet de klant zelf.',
      'Contracten en werkbonnen worden niet beheerd.',
    ],
  },
] as const;

/** Every dashboard route the three pages promise. Read by the gate — never hand-maintained. */
export function claimedRoutes(): string[] {
  return [...new Set(SEGMENT_PAGES.flatMap((p) => p.stappen.map((s) => s.route)))].sort();
}

/** One page by slug, or undefined. */
export function segmentBySlug(slug: string): SegmentPage | undefined {
  return SEGMENT_PAGES.find((p) => p.slug === slug);
}
