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
  /**
   * [SEGMENT-VAK] The trade this door hands over to /register, or absent when we do not know it.
   *
   * NOT a new mechanism: vak-profile.ts already carries a trade from the public funnel into the
   * app, and three places behind the login read it — the price-list seeds and the BTW warning on
   * /dashboard/artikelen, the vehicles tile, and whether the Kassa leads the bar. A door that
   * knows its reader's trade and then links to a bare /register throws that away at the one
   * moment the visitor volunteered it. That is the bug account-purpose.ts records having had.
   *
   * Must be a slug parseVak() accepts, and the gate checks it. A typo would not fail loudly on
   * its own: it parses to null and means "unknown", which is a normal and workable state, so it
   * would be invisible. That is exactly why it is worth a test.
   */
  vak?: string;
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
 * The doors. Order is deliberate — see the header; the fourth (garage) follows the owner's
 * go-to-market ranking.
 *
 * Every `route` here must exist under src/app/dashboard/<route>/page.tsx.
 */
export const SEGMENT_PAGES: readonly SegmentPage[] = [
  {
    slug: 'winkel',
    // GEEN vak, en dat is een besluit en geen gat. VAKKEN kent geen 'winkel', en er een verzinnen
    // zou een prijslijst én een BTW-tarief moeten bedenken voor een groep die van alles verkoopt:
    // eten 9%, de rest 21%. Een verkeerd voorgevuld tarief is precies de fout die pas bij de
    // aangifte bovenkomt, als de bon allang over de toonbank is. Niets weten is hier goedkoop.
    //
    // Het kost deze bezoeker ook niets: /dashboard/kas en /dashboard/dagomzet — de twee schermen
    // die deze pagina belooft — staan in ieders balk, ongeacht vak. Alleen de Kassa vóóraan komt
    // uit sellsOverCounter, en of een winkelier daar hoort is een echte productvraag (hij
    // beantwoordt "wisselt het geld van hand op het moment van het werk?" met een luider ja dan de
    // kapper) — maar daar hoort een vak bij dat klopt, en dat is een aparte beslissing.
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
    // De deur heet 'bouw', het vak heet 'bouw-klus'. Bewust niet gelijkgetrokken: de slug staat in
    // een URL die we naar buiten brengen, de vaknaam in een gegevenstabel die elf vakken beschrijft.
    // Wie hier binnenkomt leest de verleggingsregeling bij zijn prijslijst in plaats van in een
    // naheffing: werk je voor een aannemer, dan breng je géén BTW in rekening en vermeld je 'BTW
    // verlegd' met diens nummer — en dat is iets anders dan 0%.
    vak: 'bouw-klus',
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
          'Eén scherm dat per kwartaal telt hoeveel betalingen nog geen bon of factuur hebben, met ' +
          'één tik door naar precies die bankregels — zodat je boekhouder niet achter je aan hoeft ' +
          'te bellen.',
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
    // Dezelfde slug, en dat is geen toeval: vak-sjablonen.ts kent dit vak al, inclusief de regel
    // die pas op de aangifte zichtbaar wordt — schoonmaken BINNEN een woning is 9%, kantoren en de
    // buitenkant 21%. Die waarschuwing komt nu bij de prijslijst te staan in plaats van bij het
    // kwartaal.
    vak: 'schoonmaak',
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
  {
    // [SEGMENT-GARAGE] The fourth door, on the owner's go-to-market ranking (bouw, garage,
    // schoonmaak). The trade exists in VAKKEN as 'automonteur' — a price list of arbeidsloon,
    // beurten, APK and onderdelen at 21% — and it is in both sellsOverCounter (the bar leads with
    // the Kassa) and VEHICLE_TRADES (the vehicles tile shows). Only what exists is promised: there
    // is no werkorder and no RDW lookup, and the nietDit list says so.
    slug: 'garage',
    vak: 'automonteur',
    naam: 'garages en autobedrijven',
    title: 'BoekBrug voor de garage — onderdelen, arbeidsloon en de pin, zonder avondwerk',
    description:
      'Onderdelen van vijf leveranciers, arbeidsloon per uur, de pin aan de balie. BoekBrug leest je ' +
      'inkoopfacturen zelf in, zet je prijslijst klaar en houdt kenteken en APK-datum per klant bij.',
    keywords: [
      'administratie garage', 'boekhouding autobedrijf', 'factuur automonteur',
      'onderdelen factuur inlezen', 'apk bijhouden klanten', 'kasboek garage pin',
    ],
    probleem:
      'De onderdelen komen van vijf leveranciers, elk met een eigen factuur. De klant rekent aan de ' +
      'balie af met de pin, soms contant. En aan het eind van de dag moet arbeidsloon plus onderdelen ' +
      'één factuur worden — terwijl de volgende auto al op de brug staat.',
    belofte:
      'Je fotografeert of mailt de inkoopfactuur één keer. Je factuur kiest uit je eigen prijslijst — ' +
      'arbeidsloon, kleine beurt, APK, onderdelen — en de pinbetaling wordt in je bankafschrift ' +
      'teruggevonden.',
    stappen: [
      {
        route: 'incoming',
        title: 'Onderdelenfacturen die zichzelf inlezen',
        body:
          'Laat de leverancier mailen, of maak een foto van de bon. Leverancier, factuurnummer, bedrag ' +
          'en btw worden gelezen; een betalingsherinnering wordt herkend en nooit als tweede kost ' +
          'geboekt.',
      },
      {
        route: 'facturen',
        title: 'Arbeidsloon en onderdelen op één factuur',
        body:
          'Je prijslijst ligt klaar om in te vullen: arbeidsloon per uur, kleine en grote beurt, ' +
          'APK-keuring, onderdelen en banden staan er met het juiste btw-tarief bij — jij zet er één ' +
          'keer je eigen prijzen naast. Daarna kies je die regels op elke factuur, zonder overtypen.',
      },
      {
        route: 'voertuigen',
        title: 'Kenteken, klant en APK-datum bij elkaar',
        body:
          'Per auto het kenteken, de eigenaar en de APK-vervaldatum. Het scherm zet vooraan welke ' +
          'keuring het eerst verloopt, zodat je weet wie je kunt bellen.',
      },
      {
        route: 'kas',
        title: 'Contant in het kasboek, pin op je afschrift',
        body:
          'Staat er Kontant, Wisselgeld, Bankpas of PIN op de bon, dan wordt hij meteen als betaald ' +
          'geboekt — contant beweegt je kasboek, pin vind je terug op je bankafschrift. Zegt de bon ' +
          'het niet, dan staat hij klaar met één tik. Het kasboek houdt een lopend kassaldo bij dat ' +
          'je tegen de la kunt leggen.',
      },
      {
        route: 'klaar',
        title: 'Wat er nog mist, vóór het kwartaal dicht is',
        body:
          'Eén scherm dat per kwartaal telt hoeveel betalingen nog geen inkoopfactuur hebben, met ' +
          'één tik door naar precies die bankregels — zodat je boekhouder niet achter je aan hoeft ' +
          'te bellen.',
      },
    ],
    nietDit: [
      'Er is geen werkorder of werkplaatsplanning.',
      'Onderdelenvoorraad wordt niet bijgehouden.',
      'Het kenteken wordt niet bij de RDW opgezocht; je typt het zelf.',
      'BoekBrug mailt je klanten niet over een verlopende APK.',
      'Garantie- en schadeafhandeling met verzekeraars staan er niet in.',
    ],
  },
  {
    // [SEGMENT-TRANSPORT] The fifth door, fourth on the owner's go-to-market ranking. The trade
    // exists in VAKKEN as 'transport' — transportkosten per km, rit, wachttijd, laden en lossen,
    // spoedtoeslag, opslag, all at 21% — with a let_op that names the one trap of this trade:
    // goederen 21%, personen 9%. It is in VEHICLE_TRADES (the vehicles tile shows; a courier thinks
    // in kentekens and APK dates) and NOT in COUNTER_TRADES (nobody pays a courier at a desk).
    // Only what exists is promised: no rittenregistratie, no planning, no tachograaf.
    slug: 'transport',
    vak: 'transport',
    naam: 'transport en koeriers',
    title: 'BoekBrug voor transport en koeriers — brandstofbonnen, ritten en de wagen, zonder avondwerk',
    description:
      'Brandstofbonnen, tol, lease en onderhoud van drie leveranciers, en elke rit een factuur. ' +
      'BoekBrug leest je bonnen zelf in, zet je ritprijzen klaar en houdt kenteken en APK per wagen bij.',
    keywords: [
      'administratie koerier', 'boekhouding transportbedrijf zzp', 'factuur per rit maken',
      'brandstofbonnen scannen', 'apk bijhouden bestelbus', 'btw goederenvervoer 21 procent',
    ],
    probleem:
      'Je tankt drie keer per week en de bon ligt in het dashboardkastje. De lease, de tol en het ' +
      'onderhoud komen per mail. Elke rit moet een factuur worden — en die maak je ’s avonds, ' +
      'als de wagen al stilstaat en jij eigenlijk ook.',
    belofte:
      'Je fotografeert de tankbon bij de pomp en hij is afgehandeld. Je factuur kiest uit je eigen ' +
      'ritprijzen — per kilometer, per rit, wachttijd, laden en lossen — en de betaling wordt in je ' +
      'bankafschrift teruggevonden.',
    stappen: [
      {
        route: 'incoming',
        title: 'Tankbonnen en leasefacturen die zichzelf inlezen',
        body:
          'Foto van de bon bij de pomp, of koppel je mailbox en laat de leasemaatschappij mailen. ' +
          'Bedrag en btw worden ' +
          'gelezen, en een bon waarop PIN of Bankpas staat afgedrukt wordt als betaald afgehandeld in ' +
          'plaats van als openstaande schuld. Een tankpasbon is geen betaling en wacht op de factuur.',
      },
      {
        route: 'facturen',
        title: 'Een factuur per rit, uit je eigen prijslijst',
        body:
          'Transportkosten per kilometer, rit of opdracht, wachttijd, laden en lossen, spoedtoeslag, ' +
          'opslag per dag — die regels staan als voorstel klaar op 21%; de prijs vul je zelf in, en ' +
          'alleen wat je een prijs geeft komt in je prijslijst. Zolang die leeg is, staat erbij dat ' +
          'personenvervoer op 9% hoort.',
      },
      {
        route: 'voertuigen',
        title: 'Kenteken en APK-datum per wagen',
        body:
          'Per wagen het kenteken en de APK-vervaldatum. Het scherm zet vooraan welke keuring het ' +
          'eerst verloopt, zodat een bus niet stilstaat op de dag dat hij moet rijden.',
      },
      {
        route: 'bank',
        title: 'Je bankafschrift koppelt zichzelf aan je facturen',
        body:
          'Bankregels worden gematcht op factuurnummer, bedrag en rekeningnummer. Staan de ' +
          'factuurnummers in de betaling, dan wordt een opdrachtgever die vijf ritten in één keer ' +
          'betaalt aan alle vijf gekoppeld; staan ze er niet in, dan zoekt BoekBrug tot vier ' +
          'openstaande facturen waarvan de som precies klopt en kies jij.',
      },
      {
        route: 'klaar',
        title: 'Wat er nog mist, vóór het kwartaal dicht is',
        body:
          'Eén scherm dat per kwartaal telt hoeveel betalingen nog geen tankbon of factuur hebben, ' +
          'met één tik door naar precies die bankregels — zodat je boekhouder niet achter je aan ' +
          'hoeft te bellen.',
      },
    ],
    nietDit: [
      'Er is geen ritten- of kilometerregistratie; kilometers typ je op de factuurregel.',
      'Er is geen ritplanning en geen tachograaf- of rijtijdenregistratie.',
      'Een brandstofkaart of tolkastje wordt niet gekoppeld; de factuur daarvan lees je in.',
      'Personenvervoer staat niet automatisch op 9%; dat tarief zet je zelf op de regels.',
    ],
  },
] as const;

/** Every dashboard route the pages promise. Read by the gate — never hand-maintained. */
export function claimedRoutes(): string[] {
  return [...new Set(SEGMENT_PAGES.flatMap((p) => p.stappen.map((s) => s.route)))].sort();
}

/** One page by slug, or undefined. */
export function segmentBySlug(slug: string): SegmentPage | undefined {
  return SEGMENT_PAGES.find((p) => p.slug === slug);
}
