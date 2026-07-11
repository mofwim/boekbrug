// middleware.ts
// Auth guard + onboarding redirect (BOEK-015)
// Runs on every request before the page renders
// modified by 028 Accou Portal v2
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Login-free public lead-gen tools — reachable by anyone, no session required:
// /factuur-maken (invoice generator), /btw-berekenen (VAT calculator),
// /kilometervergoeding (mileage), /uurtarief-berekenen (ZZP hourly rate).
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/invite",
  "/pay",
  "/factuur-maken",
  "/btw-berekenen",
  "/kilometervergoeding",
  "/uurtarief-berekenen",
  "/btw-aangifte-berekenen",
  "/netto-inkomen-zzp",
  "/factuur-scannen",
  "/tools",
  "/privacy",
  "/voorwaarden",
  "/cookies",
];

function isPublic(pathname: string): boolean {
  // The homepage is a public landing page. Match it EXACTLY — never via the
  // prefix rule below, or "/" would make every route public.
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // Not logged in → send to login (except public paths)
  if (!user && !isPublic(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
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
  // [SEO] sitemap.xml and robots.txt must be crawlable without a session, so
  // exclude them from the matcher entirely — otherwise the auth guard below
  // redirects an unauthenticated crawler to /login and search engines never
  // see them.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};