// middleware.ts
// Auth guard + onboarding redirect (BOEK-015)
// Runs on every request before the page renders
// modified by 028 Accou Portal v2
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
// [BILLING] Pure decision module — no Stripe SDK, no I/O. Importing billing.ts
// here instead would pull the whole Stripe client into the Edge bundle.
import { decideAccess, isBillingEnforced } from "@/lib/subscription";

// Login-free public lead-gen tools — reachable by anyone, no session required:
// /factuur-maken (invoice generator), /btw-berekenen (VAT calculator),
// /kilometervergoeding (mileage), /uurtarief-berekenen (ZZP hourly rate).
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/wachtwoord-vergeten",
  "/wachtwoord-herstellen",
  "/invite",
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
  "/privacy",
  "/voorwaarden",
  "/cookies",
  // [BILLING] The price page is a marketing page first: it has to be readable
  // by a logged-out visitor (and by crawlers) exactly like /tools or /blog. It
  // is ALSO where the paywall sends a logged-in account whose trial ran out, so
  // it must never itself sit behind the guard — that would be a redirect loop.
  // Safe against the startsWith() rule below: no other route begins "/prijzen".
  "/prijzen",
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

  // Logged in, on dashboard → check onboarding, then billing
  if (
    user &&
    request.nextUrl.pathname.startsWith("/dashboard") &&
    !request.nextUrl.pathname.startsWith("/onboarding")
  ) {
    // [BILLING] One query serves both gates. The billing columns are added by
    // supabase/migrations/billing_subscription.sql, which the owner applies by
    // hand — so between deploying this code and applying that migration the
    // extended select fails AS A WHOLE, and with it the onboarding redirect
    // that has always lived here. That regression is not acceptable, so a
    // failure falls back to the original narrow select: onboarding keeps
    // working exactly as before, and billing simply stays dormant until the
    // columns exist.
    type GateProfile = {
      onboarding_done?: boolean | null;
      role?: string | null;
      subscription_status?: string | null;
      trial_ends_at?: string | null;
      current_period_end?: string | null;
    };

    let profile: GateProfile | null = null;
    let billingColumnsPresent = false;

    try {
      const extended = await supabase
        .from("profiles")
        .select("onboarding_done, role, subscription_status, trial_ends_at, current_period_end")
        .eq("id", user.id)
        .single();

      if (extended.error) {
        const basic = await supabase
          .from("profiles")
          .select("onboarding_done")
          .eq("id", user.id)
          .single();
        profile = (basic.data as GateProfile | null) ?? null;
      } else {
        profile = (extended.data as GateProfile | null) ?? null;
        billingColumnsPresent = true;
      }
    } catch (err) {
      // A thrown read (network blip) must never 500 the whole app. Leaving
      // profile null reproduces the pre-existing "no data → no redirect"
      // behaviour, and billing stays dormant. Fail open, always.
      console.error("[BILLING] middleware profile read threw:", err);
    }

    if (profile && !profile.onboarding_done) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }

    // [BILLING] The paywall. Inert unless BILLING_ENFORCED === "true".
    //
    // Every condition below is a reason NOT to turn someone away, and they are
    // checked before the decision is even consulted:
    //   · enforcement off (the default — the feature ships dark);
    //   · the migration is not applied, so we have no state to judge on;
    //   · the profile could not be read at all.
    // decideAccess() then applies the same fail-open rule internally, and
    // exempts accountants outright. See src/lib/subscription.ts.
    if (
      isBillingEnforced() &&
      billingColumnsPresent &&
      profile &&
      // The billing screen itself is always reachable. It is where Stripe
      // returns the customer after payment, and the webhook that flips them to
      // 'active' can land a second or two later — without this exemption that
      // race bounces a customer who has just paid back to the price page, which
      // reads as "my payment failed" at the worst possible moment.
      !request.nextUrl.pathname.startsWith("/dashboard/settings/facturering")
    ) {
      // [COST-GUARD] The accountant exemption needs evidence, not a claim —
      // `role` is picked by the user at signup, so on its own it is a
      // free-forever button. One extra existence check, and ONLY for the small
      // minority who claim to be accountants, so the common path is unchanged.
      // A failure here leaves it `undefined`, which decideAccess() reads as
      // "not checked" and resolves in the user's favour.
      let hasAccountantClients: boolean | undefined;
      if (profile.role === "accountant") {
        try {
          const { data: link } = await supabase
            .from("accountant_clients")
            .select("accountant_id")
            .eq("accountant_id", user.id)
            .limit(1)
            .maybeSingle();
          hasAccountantClients = Boolean(link);
        } catch {
          hasAccountantClients = undefined;
        }
      }

      const decision = decideAccess({
        role: profile.role ?? null,
        subscriptionStatus: profile.subscription_status ?? null,
        trialEndsAt: profile.trial_ends_at ?? null,
        currentPeriodEnd: profile.current_period_end ?? null,
        hasAccountantClients,
        nowMs: Date.now(),
      });

      if (!decision.allowed) {
        const url = new URL("/prijzen", request.url);
        url.searchParams.set("reden", decision.reason);
        return NextResponse.redirect(url);
      }
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