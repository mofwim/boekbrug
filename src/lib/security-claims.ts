// src/lib/security-claims.ts
// [BELOFTE-BEWIJS] Every security claim BoekBrug makes in public, and the code that makes it true.
//
// ── WHY A REGISTER AND NOT JUST A PAGE ──
//
// A security page is the easiest page in a product to turn into a lie, and the only one where that
// is unforgivable. Nothing breaks when a feature is removed: the prose sits there, still confident,
// still indexed, and the only way anyone finds out is the day it matters. Prose has no compiler.
//
// So the sentences do not live on the page. They live here, each one tied to the file and the
// pattern that make it TRUE, and src/lib/security-claims.test.ts fails the build the moment the
// evidence stops existing. Rip out the two-step gate and the claim about it does not quietly become
// marketing — it turns the build red, on a test that names which promise is now empty.
//
// It runs in both directions on purpose:
//   · a claim whose evidence is gone   → the page is claiming something the app no longer does;
//   · a claim that no page renders     → a promise nobody reads, which is the [LOGBOEK] failure;
//   · a limit that no page renders     → the honest half quietly dropped while the flattering half
//                                        stayed, which is how a page like this rots without lying
//                                        in a single sentence.
//
// ── WHY THE DUTCH LIVES IN AN ENGLISH FILE ──
//
// AGENTS.md allows it for user-facing text, and this text is the point of the file: a claim and the
// proof of it are one object, and separating them into a catalogue and a register is exactly the
// gap where they drift apart. Same reasoning as /bewaarplicht, which keeps its own prose for the
// same reason — a public page's argument is not app chrome.

/** One file that must still say something, or a promise has gone empty. */
export type Evidence = {
  /** Repo-relative path. */
  file: string;
  /** What that file must still contain. */
  pattern: RegExp;
  /** What this proves, for whoever reads the failure message six months from now. */
  proves: string;
};

export type SecurityClaim = {
  /** Stable id — the test names it, so it must not be renamed casually. */
  id: string;
  /** The heading, as an owner reads it. */
  title: string;
  /** The claim itself. Present tense, no "we streven ernaar", no future. */
  body: string;
  /** Remove the evidence and the claim is a lie; the test says so by name. */
  evidence: readonly Evidence[];
};

/**
 * What BoekBrug says it does — every sentence backed by a file.
 *
 * The order is the order on the page, and it is deliberate: the lock, then who holds a key, then
 * the record of what was done with it, then what happens to the whole thing if we disappear. That
 * is the sequence of a zzp'er's actual worry, not a feature list.
 */
export const SECURITY_CLAIMS: readonly SecurityClaim[] = [
  {
    id: "tweestaps",
    title: "Je administratie kan achter een tweede stap",
    body:
      "Wie jouw wachtwoord heeft, kan facturen uitreiken op jouw naam en in jouw doorlopende " +
      "nummerreeks — en die kun je daarna niet meer intrekken. Daarom kun je verificatie in twee " +
      "stappen aanzetten met de authenticator-app die je al hebt. Je zet hem zelf aan, en zelf weer uit.",
    evidence: [
      {
        file: "src/lib/mfa.ts",
        pattern: /export function mfaGate/,
        proves: "the rule that decides whether a session still owes the second step",
      },
      {
        file: "src/components/settings/TweestapsPaneel.tsx",
        pattern: /challengeAndVerify/,
        proves: "the screen where an owner actually switches it on",
      },
    ],
  },
  {
    id: "tweestaps-overal",
    title: "Die tweede stap geldt overal, niet alleen op de schermen",
    body:
      "Een slot dat alleen voor de schermen geldt, is geen slot: wie een wachtwoord steelt heeft " +
      "geen scherm nodig. Bij BoekBrug staat dezelfde stap voor de programmakant — dezelfde adressen " +
      "waarmee je eigen browser facturen aanmaakt en verstuurt — en niet alleen voor de pagina's die " +
      "je ziet.",
    evidence: [
      {
        file: "src/middleware.ts",
        pattern: /mfa_required/,
        proves: "the API refusal, which is what makes the gate more than decoration",
      },
      {
        file: "src/lib/mfa.ts",
        pattern: /"\/api\/cron"/,
        proves: "the short, argued list of what stays reachable — the shape of a gate that covers /api",
      },
    ],
  },
  {
    id: "toegang",
    title: "Je ziet wie erbij kan, en je haalt ze er zelf uit",
    body:
      "Op één scherm staat iedereen die deze administratie kan openen: jij, je boekhouder als je er " +
      "een hebt gekoppeld, en iedere medewerker die je hebt uitgenodigd — met sinds wanneer. Toegang " +
      "intrekken doe je zelf, zonder ons erbij.",
    evidence: [
      {
        file: "src/app/api/beveiliging/route.ts",
        pattern: /accountant_clients/,
        proves: "the read that lists every human with access",
      },
      {
        file: "src/app/dashboard/settings/team/TeamClient.tsx",
        pattern: /fetch\('\/api\/company\/members'/,
        proves: "the screen where access is granted and revoked",
      },
    ],
  },
  {
    id: "logboek",
    title: "Alles wat er gebeurt, staat in een logboek dat jij leest",
    body:
      "Elke handeling in je administratie wordt vastgelegd — ook die van je boekhouder, die onder " +
      "zijn eigen naam in het logboek staat terwijl jij aansprakelijk blijft voor wat er onder jouw " +
      "BTW-nummer uitgaat. Je hoeft er niet om te vragen en je hebt ons er niet voor nodig: het " +
      "logboek staat gewoon in je eigen scherm.",
    evidence: [
      {
        file: "src/app/api/logboek/route.ts",
        pattern: /audit_logs/,
        proves: "the trail is actually readable by the owner, not only written",
      },
      {
        file: "src/app/dashboard/logboek/page.tsx",
        pattern: /LogboekClient/,
        proves: "the screen it is read on",
      },
    ],
  },
  {
    id: "afgeschermd",
    title: "Elke administratie is in de database van de andere gescheiden",
    body:
      "De scheiding zit niet in onze schermen maar in de database zelf: die geeft een gebruiker " +
      "alleen zijn eigen rijen terug, ook als er in de programmatuur erboven iets misgaat. Dat is " +
      "de enige plek waar zo'n scheiding thuishoort — een vergissing in een scherm mag nooit " +
      "iemands boekhouding kunnen openleggen.",
    evidence: [
      {
        file: "database.sql",
        pattern: /ENABLE ROW LEVEL SECURITY/,
        proves: "row-level security is switched on at the table level",
      },
    ],
  },
  {
    id: "export",
    title: "Je haalt alles er in één keer weer uit",
    body:
      "Je hele administratie komt er als één zip-bestand uit — facturen, documenten, klanten, " +
      "boekingen. Zonder ons te mailen, zonder opzegtermijn, en zonder dat het iets kost. Een " +
      "administratie die je er niet uit krijgt, is niet van jou.",
    evidence: [
      {
        file: "src/app/api/account/export/route.ts",
        pattern: /application\/zip/,
        proves: "the export really produces a file, rather than opening a support ticket",
      },
    ],
  },
  {
    id: "stoppen",
    title: "En als BoekBrug zelf stopt, krijg je je archief toegestuurd",
    body:
      "Dat staat in de voorwaarden, niet in een blogbericht: minstens 90 dagen van tevoren bericht, " +
      "je archief wordt je toegestuurd zonder dat je erom hoeft te vragen, er wordt in die periode " +
      "niets verwijderd, en de einddatum valt in januari, april, juli of oktober — na een " +
      "aangifteperiode en niet middenin. Het geldt voor iedere gebruiker, ook zonder betaald pakket.",
    evidence: [
      {
        file: "src/content/legal/algemene-voorwaarden.ts",
        pattern: /Je krijgt je archief; je hoeft er niet om te vragen\./,
        proves: "the clause itself, in the terms, pinned separately by exit-commitments.test.ts",
      },
    ],
  },
] as const;

/**
 * What BoekBrug does NOT claim.
 *
 * ── WHY THIS HALF IS NOT OPTIONAL ──
 *
 * A security page with nothing but good news is read as marketing, and correctly so. These four
 * sentences are the ones that make the seven above worth believing, and they are also the ones a
 * later rewrite quietly deletes first — the flattering half stays, the honest half goes, and the
 * page has become a lie without a single false sentence in it. The test therefore asserts that each
 * of these is still rendered, exactly like the claims.
 *
 * They carry no evidence field because they are statements about what we do NOT do, and there is no
 * file whose absence proves an absence. Their gate is that they are on the page at all.
 */
export const SECURITY_LIMITS: readonly { id: string; body: string }[] = [
  {
    id: "geen-certificaat",
    body:
      "Wij zijn niet ISO- of SOC-gecertificeerd. Zo'n traject kost tienduizenden euro's per jaar, " +
      "en dat geld zit nu in het product. Wat hierboven staat kun je zelf nalopen; een keurmerk zou " +
      "je van ons moeten aannemen.",
  },
  {
    id: "waar-staan-de-gegevens",
    body:
      "Je gegevens staan bij Supabase en Vercel. Supabase Inc. is een Amerikaans bedrijf; de " +
      "doorgifte loopt onder standaardcontractbepalingen (SCC's) en waar het kan kiezen wij " +
      "EU-datacenters. Het volledige verhaal, met alle subverwerkers, staat in de privacyverklaring.",
  },
  {
    id: "wat-het-logboek-niet-ziet",
    body:
      "Het logboek legt vast wat er via BoekBrug gebeurt. Wie rechtstreeks in de database zou " +
      "kijken, komt daar niet in te staan. Wij vertellen je dat liever zelf dan dat je het ooit " +
      "ergens anders leest.",
  },
  {
    id: "wij-kunnen-erbij",
    body:
      "En het eerlijkste: wij kunnen technisch bij je gegevens. Er is geen versleuteling waar wij " +
      "zelf niet doorheen kunnen — dat zou betekenen dat wij je facturen niet kunnen versturen, je " +
      "bonnen niet kunnen lezen en je aangifte niet kunnen voorbereiden. Iedere boekhoudleverancier " +
      "die het tegendeel suggereert, verkoopt je iets anders dan een boekhoudprogramma. Wat wij er " +
      "tegenover zetten staat hierboven: een tweede stap die wij niet voor je kunnen zetten, een " +
      "logboek dat je zelf leest, en een uitgang die altijd open staat.",
  },
] as const;
