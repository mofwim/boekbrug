// middleware.ts
// Auth guard + onboarding redirect (BOEK-015)
// Runs on every request before the page renders
// modified by 028 Accou Portal v2
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// [PUBLIC-SURFACE] The public path list moved to src/lib/public-paths.ts so the smoke test can
// assert against the SAME array this guard enforces. It was unreachable from anywhere else, which
// is how /eerlijk-gebruik ended up in the footer of every public page, in sitemap.xml and in the
// terms as "volledig openbaar" while this guard redirected every logged-out visitor to /login.
import { isPublic } from "@/lib/public-paths";

/**
 * [BESTEMMING] The login URL for a request, carrying where the visitor was going.
 *
 * This used to be inlined at the single redirect below; it is a function now because the
 * env-degrade branch above sends people to the same place and must send them there the same way —
 * a second, slightly different copy is how "?redirect=" quietly stops working on one of the paths.
 *
 * pathname + search, so a quarter filter or a search term travels along. The value comes from our
 * own request, so it always starts with a single "/" — and /login re-checks it with safeRedirect
 * regardless.
 */
function loginUrlFor(request: NextRequest): URL {
  const login = new URL("/login", request.url);
  const vandaan = request.nextUrl.pathname + request.nextUrl.search;
  // "/" is de openbare homepage en geen bestemming om naar terug te keren.
  if (vandaan !== "/") login.searchParams.set("redirect", vandaan);
  return login;
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // [ENV-DEGRADE] The two keys were read with `!`, which is a promise to TypeScript and nothing at
  // all at runtime: with either one missing, createServerClient throws HERE — in middleware, before
  // any route handler runs. And the matcher deliberately does NOT exclude /api (see [SESSION-REFRESH]
  // at the bottom), so ONE typo in a Vercel environment variable takes down every page and every
  // API route at once, including:
  //   · /privacy and /voorwaarden — which AVG art. 13 requires to stay reachable;
  //   · /api/health — the diagnostic built for exactly this outage, dead in the outage.
  // A missing key is not "the session is invalid", it is "we cannot check any session". So degrade
  // to the honest version of that: no session, public pages and API routes still served, everything
  // else sent to the login it would have been sent to anyway. Loud in the logs, never a 500.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[ENV-DEGRADE] Supabase env vars missing — serving without a session check", {
      hasUrl: !!supabaseUrl,
      hasAnonKey: !!supabaseAnonKey,
      path: request.nextUrl.pathname,
    });
    // /api/* answers for itself (its handlers return their own 401/503 with a body a caller can
    // read); a public page renders. Both keep working while the deployment is repaired.
    if (request.nextUrl.pathname.startsWith("/api") || isPublic(request.nextUrl.pathname)) {
      return response;
    }
    return NextResponse.redirect(loginUrlFor(request));
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // [SESSION-REFRESH] API routes: getUser() above already refreshed the token
  // (and wrote new cookies onto `response`) if it was expired-but-refreshable.
  // We must NOT redirect API requests — a fetch() caller expects JSON, not an
  // HTML login page. So for /api/*, return here: the session is refreshed, and
  // if it was truly dead the route itself returns a proper 401 JSON. This is
  // what fixes the intermittent 42501 on API writes (e.g. accountant invite),
  // which previously never ran middleware at all (api was in the matcher exclude).
  if (request.nextUrl.pathname.startsWith("/api")) {
    return response;
  }

  // Not logged in → send to login (except public paths).
  //
  // [BESTEMMING] Mét waar hij heen wilde: deze regel stuurde naar een kaal /login, dus na het
  // inloggen kwam iedereen op /dashboard uit — ook wie halverwege zijn werk zat. Hoe dat wordt
  // meegegeven staat bij loginUrlFor hierboven, zodat er één versie van die regel bestaat.
  if (!user && !isPublic(request.nextUrl.pathname)) {
    return NextResponse.redirect(loginUrlFor(request));
  }

  // Logged in, on dashboard → check onboarding
  if (
    user &&
    request.nextUrl.pathname.startsWith("/dashboard") &&
    !request.nextUrl.pathname.startsWith("/onboarding")
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_done")
      .eq("id", user.id)
      .single();

    if (profile && !profile.onboarding_done) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
  }

  return response;
}

export const config = {
  // [SESSION-REFRESH] `api` removed from the exclude list so middleware runs on
  // /api/* and refreshes the Supabase session before the route handler executes.
  // (Previously `|api` here meant API routes never refreshed the token → an
  // expired JWT reached Postgres → auth.uid() null → RLS 42501 on writes.)
  // API requests are handled early above (session refreshed, never redirected).
  // [SEO] sitemap.xml, robots.txt and the generated social images
  // (opengraph-image / twitter-image) must be fetchable without a session, so
  // exclude them from the matcher entirely — otherwise the auth guard below
  // redirects an unauthenticated crawler to /login and search engines / social
  // scrapers never see them.
  // [ANDROID/TWA] Same reasoning for the PWA/TWA install assets: the launcher
  // icons under /icons/ and the Digital Asset Links file at
  // /.well-known/assetlinks.json are fetched by Android / PWABuilder / Google's
  // link verifier with no session — if the auth guard redirects them to /login
  // the app icon is missing and the URL-bar-hiding verification silently fails.
  // [PWA] sw.js must be reachable at the origin root (its scope) and offline.html
  // is the fallback the worker serves with no session — both must skip the auth
  // guard, or SW registration / the offline page break.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|icons/|\\.well-known/|sw.js|offline.html|opengraph-image|twitter-image).*)"],
};