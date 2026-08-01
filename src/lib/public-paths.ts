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
  // [NAMENS] De landingspagina van een teamuitnodiging. Publiek, net als /invite: de genodigde
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
 * Is this path reachable without a session?
 *
 * The homepage is matched EXACTLY — never via the prefix rule, or "/" would make every route
 * public. Everything else is a prefix match, so nested routes under a public section (a blog
 * post, a tool's sub-page) are public with it.
 */
export function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}
