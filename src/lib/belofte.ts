// src/lib/belofte.ts
// [BELOFTE] De ene zin waarmee BoekBrug zichzelf uitlegt — op élke plek dezelfde.
//
// ── WAAROM DIT ÉÉN BESTAND IS ──
// De belofte stond op vijf plekken los ingetypt: de homepage, /register, /prijzen, de
// onboarding en de metadata. Vijf teksten die hetzelfde proberen te zeggen lopen altijd
// uiteen — dat is exact hoe de prijs ooit uit de pas liep met de voorwaarden. Hier staat
// hij één keer; de vijf pagina's lezen eruit.
//
// ── WAT ER VERANDERT, EN WAAROM ──
// De oude tekst was een OPSOMMING: "Maak en scan facturen, houd je BTW makkelijk bij en werk
// samen met je boekhouder." Dat plaatst BoekBrug in een vergelijking met SnelStart, Moneybird
// en Jortt op een featuretabel waarin het verliest — geen PSD2, geen indiening bij de
// Belastingdienst, geen Peppol. Een gevecht dat niet te winnen is en ook niet gevoerd hoeft
// te worden, want het gaat over de verkeerde vraag.
//
// De nieuwe tekst beschrijft niet wat de app KAN maar wat de gebruiker NIET MEER HOEFT:
//
//     Je hoeft geen boekhouding te doen. Je hoeft alleen niets kwijt te raken.
//
// Dat is geen slogan maar een beschrijving van het werkelijke product: intake per camera,
// e-mailkoppeling, AI-lezing, bankimport, automatische afletting, kwartaalgereedheid en de
// brug naar de boekhouder. Zes van de negen functiegebieden dienen precies deze zin.
//
// ── DE GRENS VAN DE BELOFTE, EN WAAROM DIE ER STAAT ──
// Er staat NERGENS "het kwartaal doet zichzelf". Dat zou §4.3 van de Algemene Voorwaarden
// tegenspreken, waarin wij vastleggen dat een AI-uitkomst een SUGGESTIE is en nooit een feit,
// en dat de controle bij de gebruiker blijft. Vandaar overal `staat klaar` en nooit
// `is gedaan` — het verschil is één woord en het is het verschil tussen een belofte die wij
// nakomen en een belofte waarop wij worden aangesproken.
//
// Om dezelfde reden staat er "klaar voor je boekhouder" en niet "je boekhouder haalt het op":
// een nieuwe gebruiker heeft nog geen boekhouder gekoppeld. Wij beloven de TOESTAND, niet de
// handeling van iemand anders.

/** De belofte, in twee zinnen. De eerste neemt werk weg, de tweede geeft één taak terug. */
export const BELOFTE_KOP = "Je hoeft geen boekhouding te doen." as const;
export const BELOFTE_KOP_2 = "Je hoeft alleen niets kwijt te raken." as const;

/** De uitleg eronder: wat de gebruiker doet, en wat er daarna vanzelf gebeurt. */
export const BELOFTE_UITLEG =
  "Facturen maak je hier. De rest fotografeer je, of laat je binnenkomen via je mail. " +
  "Aan het eind van het kwartaal staat alles klaar voor je boekhouder — geordend, compleet, " +
  "met één knop op te halen.";

/** Korte variant voor plekken met weinig ruimte (registratie, metadata). */
export const BELOFTE_KORT =
  "Fotografeer je bonnen of laat ze binnenkomen via je mail. Aan het eind van het kwartaal " +
  "staat alles klaar voor je boekhouder.";

/** Nog korter — voor een subtitel of een chip. */
export const BELOFTE_MINI = "Niets kwijtraken. De rest doen wij." as const;

/**
 * De geruststelling onder een knop.
 *
 * Elk deel hiervan is een contractuele toezegging, geen marketingzin: "gratis" en "nooit
 * automatisch afgeschreven" staan in voorwaarden §5.2, en "geen proefperiode" is de reden
 * dat `trial_ends_at` bewust NIET in billing_subscription.sql staat. Verandert een van deze
 * drie, dan verandert er een contract mee.
 */
export const BELOFTE_GERUST =
  "Gratis · geen proefperiode die afloopt · nooit automatisch afgeschreven" as const;

/**
 * Wat de gebruiker zelf moet doen — de enige taak die overblijft. Drie stappen, want meer
 * dan drie leest niemand, en deze drie zijn ook echt alles.
 */
export const BELOFTE_STAPPEN: readonly { kop: string; tekst: string }[] = [
  {
    kop: "Fotografeer of stuur door",
    tekst:
      "Een bon uit je broekzak, een inkoopfactuur in je mail. Wij lezen bedrag, btw en leverancier eruit.",
  },
  {
    kop: "Je bank erbij",
    tekst:
      "Upload je bankafschrift. Betalingen worden vanzelf aan de juiste factuur gekoppeld.",
  },
  {
    kop: "Het kwartaal staat klaar",
    tekst:
      "Je ziet precies wat er nog mist. Is het compleet, dan haalt je boekhouder het in één keer op.",
  },
] as const;

/**
 * De belofte richting de BOEKHOUDER. Een ander mens met een ander probleem: hij wil geen
 * software leren, hij wil geen schoenendoos meer krijgen. Zijn pijn is de klant die niets
 * aanlevert — en dat is precies de klant die de zin hierboven aanspreekt.
 */
export const BELOFTE_BOEKHOUDER =
  "Je klant levert een afgesloten kwartaal aan in plaats van een schoenendoos. " +
  "Je ziet alleen wat hij zelf heeft gecontroleerd, je haalt het per klant op, " +
  "en het portaal is gratis — ook met honderd klanten.";
