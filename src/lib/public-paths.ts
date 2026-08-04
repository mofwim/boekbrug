// src/lib/public-paths.ts
// [PUBLIC-SURFACE] Which paths are reachable WITHOUT a session — the one list, in one place.
//
// It used to live inside middleware.ts, where nothing else could read it. That is precisely why
// a page could be public in every sense that matters (written, built, linked from the footer of
// every public page, listed in sitemap.xml, named in the terms as "volledig openbaar") and still
// be redirected to /login by the guard: the two facts had no place to meet, so nothing could
// compare them. Exported here so the smoke test asserts against the SAME array the middleware
// enforces — a copy in the test would drift the first time this list changes.
//
// THE PREFIX RULE: a path here makes every route that STARTS WITH it public (isPublic uses
// startsWith). So before adding an entry, check that no other route begins with the same string.
// "/prijzen" is safe because nothing else starts with it; "/" would make the whole app public,
// which is why the homepage is matched exactly instead.

export const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/wachtwoord-vergeten",
  "/wachtwoord-herstellen",
  "/invite",
  // [ACTING-FOR] De landingspagina van een teamuitnodiging. Publiek, net als /invite: de genodigde
  // heeft vaak nog geen account, en moet de uitnodiging kunnen LEZEN voordat hij besluit zich
  // aan te melden. Accepteren kan pas ingelogd — dat is de route erachter, en die eist boven-
  // dien dat zijn e-mailadres gelijk is aan het uitgenodigde adres.
  "/team/accepteren",
  "/pay",
  "/factuur-maken",
  "/bankafschrift-naar-excel",
  "/btw-berekenen",
  "/kilometervergoeding",
  "/uurtarief-berekenen",
  "/btw-aangifte-berekenen",
  "/netto-inkomen-zzp",
  "/factuur-scannen",
  "/tools",
  // [EN-TOOLS] English versions of the public calculators, targeting expat /
  // English search demand ("Dutch VAT calculator", etc). Same tool engines,
  // English UI — must be reachable without a session, like their NL originals.
  "/en/btw-berekenen",
  "/en/netto-inkomen-zzp",
  "/en/uurtarief-berekenen",
  "/en/kilometervergoeding",
  "/en/btw-aangifte-berekenen",
  // [BLOG] The public blog (NL default + EN under /en/blog) must be reachable
  // without a session — logged-out visitors AND search crawlers, otherwise the
  // auth guard redirects them to /login and the SEO blog never gets indexed.
  "/blog",
  "/en/blog",
  "/ar/blog",
  "/tr/blog",
  "/privacy",
  // [BILLING] De prijzenpagina is in de eerste plaats een marketingpagina: een uitgelogde
  // bezoeker (en een crawler) moet kunnen zien wat BoekBrug kost zonder account. Veilig
  // tegen de startsWith()-regel hieronder: geen andere route begint met "/prijzen".
  "/prijzen",
  "/en/prijzen",
  "/ar/prijzen",
  "/tr/prijzen",
  // [KLUIS] De voordeur voor mensen die geen boekhoudprogramma zoeken maar een oplossing voor
  // hun bewaarplicht. Moet uitgelogd leesbaar zijn — dat is het hele punt van de pagina.
  "/bewaarplicht",
  "/voorwaarden",
  "/cookies",
  // [PUBLIC-SURFACE] Deze twee stonden er NIET in, en dat was zichtbaar voor iedere bezoeker.
  //
  // · /eerlijk-gebruik wordt in de voorwaarden (§5.2) "volledig openbaar" genoemd en is
  //   onderdeel van de overeenkomst, staat in de footer van ELKE openbare pagina
  //   (public-footer.tsx) en in sitemap.xml — en stuurde iedere uitgelogde bezoeker en iedere
  //   crawler naar /login. Een pagina waarvan je zelf zegt dat hij openbaar is, en die je in je
  //   sitemap aan Google aanbiedt, mag niet achter de inlog staan.
  // · /steun staat in dezelfde sitemap en is de doneer/steunpagina — die vraagt per definitie
  //   iets van iemand die (nog) geen account heeft.
  //
  // Geen van beide botst met de prefix-regel: er is geen andere route die met "/steun" of
  // "/eerlijk-gebruik" begint (gecontroleerd op src/app).
  "/eerlijk-gebruik",
  "/steun",
] as const;

/**
 * [EXACT-PUBLIC] Public as themselves, without opening anything nested underneath.
 *
 * These cannot go in PUBLIC_PATHS, because that list is a prefix rule: "/" there would make the
 * entire app public, and "/en" there would make every future route under /en public — plus every
 * route that merely BEGINS with those two letters, since startsWith("/en") also matches
 * "/energie". So they are matched exactly, and each page under them stays listed on its own.
 *
 * "/en" is here because it was missing everywhere: the English homepage was written, built and
 * linked from boekbrug.nl ("Read this page in English →"), while /en/prijzen, /en/blog and the
 * five /en/* calculators were all in the prefix list — so the one page a visitor actually clicked
 * was the one the guard sent to /login?redirect=%2Fen. No gate could see it either: the smoke
 * test's three sweeps read PUBLIC_PATHS (which did not have it), sitemap.xml (which did not have
 * it either — fixed in sitemap.ts) and the footer (the link sits in a section above it).
 */
export const EXACT_PUBLIC_PATHS = ["/", "/en"] as const;

/**
 * Is this path reachable without a session?
 *
 * Two rules, and the difference matters: EXACT_PUBLIC_PATHS matches the path and nothing below it
 * (see the note there), PUBLIC_PATHS is a prefix match so nested routes under a public section — a
 * blog post, a tool's sub-page — are public with it.
 */
export function isPublic(pathname: string): boolean {
  // A trailing slash is the same page. Next normalises "/en/" to "/en" with a redirect, but that
  // is a config default (trailingSlash), not a guarantee this guard should depend on.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((EXACT_PUBLIC_PATHS as readonly string[]).includes(path)) return true;
  return PUBLIC_PATHS.some((p) => path.startsWith(p));
}
