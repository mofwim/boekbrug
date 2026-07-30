// src/lib/app-origin.ts
// [ORIGIN] Waar draait deze app? Eén antwoord, één plek. Puur, geen I/O.
// Run: npx tsx --test src/lib/app-origin.test.ts
//
// WAAROM DIT BESTAAT
//
// Er waren TWEE namen voor hetzelfde ding, en dat is precies één te veel:
//
//   NEXT_PUBLIC_APP_URL   — zes aanroepers (billing-checkout, billing-portal, berichten,
//                           uitnodiging-boekhouder, uitnodiging-klant)
//   NEXT_PUBLIC_SITE_URL  — één aanroeper (de kwartaal-cron), en NIET gedocumenteerd in
//                           .env.example
//
// Wie de app opzet volgens .env.example zet dus APP_URL en mist SITE_URL. De kwartaal-cron valt
// dan terug op het hardgecodeerde 'https://boekbrug.nl' — wat toevallig goed gaat zolang dát het
// domein is, en stil de verkeerde kant op wijst zodra iemand op een ander domein, een preview of
// een staging-omgeving draait. De boekhouder krijgt dan een pakket-link naar een andere site.
//
// En één aanroeper had helemaal geen vangnet:
//   src/app/api/messages/route.ts:130
//     conversationUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/messages/${user.id}`
// Ontbreekt de variabele, dan interpoleert JavaScript het woord "undefined" en vertrekt er een
// e-mail naar een echt mens met de link `undefined/dashboard/messages/...`. Geen foutmelding,
// geen logregel — alleen een ontvanger die op een kapotte link klikt.
//
// Dit bestand maakt daar één keten van, met de volgorde die op elk platform klopt.

/**
 * Wat de omgeving aanreikt. Los meegegeven zodat deze module puur en testbaar blijft.
 *
 * Bewust een losse record: de aanroepers geven `process.env` door, en die is in Next.js strikt
 * getypeerd zonder index-signatuur — een smalle interface zou daar niet op passen. De sleutels
 * die ertoe doen staan hieronder gedocumenteerd:
 *
 *   NEXT_PUBLIC_APP_URL   de gedocumenteerde, expliciete keuze; wint altijd
 *   NEXT_PUBLIC_SITE_URL  de oudere tweede naam; blijft werken zodat een bestaande omgeving
 *                         niet omvalt doordat wij consolideren
 *   VERCEL_URL            zet Vercel zelf, zonder schema ("boekbrug-abc123.vercel.app")
 */
export type OriginEnv = Readonly<Record<string, string | undefined>>;

/**
 * De basis-URL van deze installatie, zonder slash aan het eind.
 *
 * `requestOrigin` is de origin van het binnenkomende verzoek — het beste antwoord dat er is
 * wanneer niets is ingesteld, want het klopt per definitie met waar de gebruiker nu is. Alleen
 * achtergrondwerk (crons) heeft er geen: daar is er geen verzoek, en daarom moet de variabele
 * daar wél gezet zijn.
 *
 * Retourneert null wanneer er niets bruikbaars is. Bewust null en niet een gokje: een aanroeper
 * die geen URL kan bouwen hoort dat te weten en de link weg te laten, niet "undefined" te mailen.
 */
export function appOrigin(env: OriginEnv, requestOrigin?: string | null): string | null {
  const kandidaten = [
    env.NEXT_PUBLIC_APP_URL,
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_URL ? withScheme(env.VERCEL_URL) : null,
    requestOrigin,
  ];
  for (const k of kandidaten) {
    const schoon = normalise(k);
    if (schoon) return schoon;
  }
  return null;
}

/**
 * Hetzelfde, maar met een laatste vangnet voor code die per se een string nodig heeft.
 *
 * Gebruik dit ALLEEN waar een ontbrekende link erger is dan een mogelijk verkeerde — in de
 * praktijk: nergens in een e-mail. Een verkeerd domein in een mail naar een boekhouder is niet
 * beter dan geen link; het is slechter, want het ziet er goed uit.
 */
export function appOriginOrFallback(
  env: OriginEnv,
  requestOrigin: string | null | undefined,
  fallback: string,
): string {
  return appOrigin(env, requestOrigin) ?? normalise(fallback) ?? fallback;
}

/** Bouwt een absolute URL, of null als er geen origin is. Nooit "undefined/..." als tekst. */
export function appUrl(
  env: OriginEnv,
  path: string,
  requestOrigin?: string | null,
): string | null {
  const origin = appOrigin(env, requestOrigin);
  if (!origin) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

// ── intern ────────────────────────────────────────────────────────────────────────────────────

function withScheme(host: string): string {
  const h = host.trim();
  if (!h) return "";
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
}

/**
 * Trimt, verwijdert slashes aan het eind, en weigert alles wat geen http(s)-URL is.
 *
 * Die weigering is het punt: de letterlijke tekst "undefined" of "null" is precies wat er in een
 * omgeving belandt waar iemand `NEXT_PUBLIC_APP_URL=${SOMETHING}` heeft gezet zonder waarde, en
 * dat mag niet als geldige origin doorgaan.
 */
function normalise(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  const met = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(met);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // new URL() is verrassend inschikkelijk: het slikt "https://${SOMETHING}" als een geldige
    // hostnaam. Een echte hostnaam bestaat uit letters, cijfers, koppeltekens en punten — meer
    // niet. Zonder deze controle zou een niet-ingevulde shell-variabele in de omgeving als
    // origin doorgaan en in een e-mail belanden.
    if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return `${u.origin}`;
  } catch {
    return null;
  }
}
