// src/app/api/invoice/continuity/route.ts
// [DOORLOPEND] Does this administration's invoice numbering run unbroken?
//
// The rule is in src/lib/invoice-continuity.ts with fourteen tests; this route only fetches. What
// it decides is WHICH SERIES EXIST — the templates — because that depends on the owner's stored
// settings and the pure module must stay free of database shapes.
//
// ── WHAT IT READS, AND WHY EACH READ IS ALLOWED TO FAIL ALONE ──
//
//   invoices          every number ever issued here. Paged: [PAGINATION] PostgREST silently caps a
//                     plain select at ~1000 rows, and a truncated read would report the numbers
//                     above the cap as missing — a hundred imaginary gaps on the screen of an owner
//                     whose administration is perfectly in order, which is the worst way for this
//                     particular feature to be wrong.
//   invoice_counters  where the counter stands. Its own failure, because it answers a question the
//                     invoices cannot: the gap at the END of the series (see the module header).
//   profiles          the owner's numbering template. Absent = the product default.
//
// A failed counters read yields `counters: null`, which the rule turns into burnedAtEnd: null —
// "we did not check that half" — and never into a comfortable zero.

import { NextResponse, type NextRequest } from "next/server";

// [ACTING-FOR] requireOwner and not getSessionUser — see the block at the guard below.
import { requireOwner } from "@/lib/owner-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { getSessionUser } from "@/lib/session-user";
// [BRUG] Dubbelpad, gedeeld met /api/closing-package en de kwartaalroutes — zie het blok in GET.
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  checkContinuity,
  totalUnaccounted,
  type CounterRow,
  type NumberedInvoice,
  type SeriesFormat,
} from "@/lib/invoice-continuity";

export const dynamic = "force-dynamic";

/** The product default when no template has been stored yet — see invoice-numbering.ts. */
const DEFAULT_TEMPLATE = "{year}{seq}";
const DEFAULT_PADDING = 4;

export async function GET(req: NextRequest) {
  // [ACTING-FOR] Owner only — and the gate in acting-for-gates.test.ts caught the first version of
  // this route for saying nothing about it. That gate's comment describes exactly what happened
  // here: "someone adds /api/invoice/something-new, writes user.id like everywhere else, and
  // nothing visible happens."
  //
  // What would have happened is worse than nothing. A verkoop medewerker's user.id is the sender_id
  // of no invoice at all, so he would have read an EMPTY series — and an empty series has no holes,
  // so this screen would have told him his numbering runs unbroken while reporting on an
  // administration he cannot see. A false green on the one check whose whole value is that it is
  // never falsely green.
  //
  // REFUSED rather than resolved, which is the other option the gate offers. The numbering report
  // is the owner's business and /dashboard/klaar is an owner's screen (canAccessScreen does not open
  // it to a member) — and resolving the owner here would mean reading his entire invoice list
  // through a member's session, where RLS returns only that member's own rows and would manufacture
  // a gap out of every row it withheld.
  const supabase = await createServerSupabaseClient();
  const clientId = req.nextUrl.searchParams.get("clientId");

  // [BRUG] De boekhouder mag deze uitslag ook zien — het is de eerste vraag die hij stelt, en tot
  // nu toe kwam het antwoord alleen in het kwartaalpakket voorbij. Zelfde dubbelpad als
  // /api/closing-package, met dezelfde twee verschillen als daar:
  //
  //   · zonder clientId blijft requireOwner staan, want resolveQuarterOwner kent het verschil
  //     tussen een eigenaar en een MEDEWERKER niet — en die zou een lege reeks lezen, waarna dit
  //     scherm hem meldt dat zijn nummering doorloopt over facturen die hij niet kan zien;
  //   · met clientId leest de pipeline, want RLS geeft een boekhouder geen enkele factuurrij van
  //     zijn klant, en een lege lezing is hier precies de valse groene uitslag die deze controle
  //     bestaat om te voorkomen.
  let ownerId: string;
  let db = supabase;
  if (clientId) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const resolved = await resolveQuarterOwner(supabase, user.id, clientId);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    ownerId = resolved.ownerId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db = createPipelineClient() as any;
  } else {
    const guard = await requireOwner("Deze controle");
    if (guard.response) return guard.response;
    ownerId = guard.acting!.ownerId;
  }

  // [WATERVAL] Three independent reads, started together. allSettled because each has its own
  // honest failure and Promise.all would let one drag down two answers that arrived fine.
  const [invoicesResult, countersResult, profileResult] = await Promise.allSettled([
    fetchAllRows<NumberedInvoice>((from, to) =>
      db
        .from("invoices")
        .select("invoice_number, invoice_type")
        .eq("sender_id", ownerId)
        .not("invoice_number", "is", null)
        // Ordered by id (unique) rather than created_at: [PAGINATION] ties in a timestamp have no
        // defined order, and a page boundary inside a tie silently drops or repeats a row.
        .order("id", { ascending: true })
        .range(from, to),
    ),
    db.from("invoice_counters").select("type, year, last_seq").eq("user_id", ownerId),
    db
      .from("profiles")
      .select("invoice_number_template, invoice_number_padding")
      .eq("id", ownerId)
      .maybeSingle(),
  ]);

  // The invoices are the one read this cannot do without: with none of them there is no series to
  // judge, and reporting "alles loopt door" over a failed read would be the exact false comfort
  // this check exists to remove.
  if (invoicesResult.status === "rejected") {
    console.error("[DOORLOPEND] Could not read the invoices — refusing to judge the numbering", {
      error: String(invoicesResult.reason),
    });
    return NextResponse.json({ error: "numbering_unreadable" }, { status: 503 });
  }
  const invoices = invoicesResult.value;

  // The owner's own format. A missing profile row, an unreadable one, or a null template all mean
  // the same thing: nothing custom was ever stored, so the product default applies.
  const profile =
    profileResult.status === "fulfilled" && !profileResult.value.error ? profileResult.value.data : null;
  const template = (profile?.invoice_number_template ?? "").trim() || DEFAULT_TEMPLATE;
  const padding =
    typeof profile?.invoice_number_padding === "number" && profile.invoice_number_padding > 0
      ? profile.invoice_number_padding
      : DEFAULT_PADDING;

  // Two series, keyed exactly like invoice_counters (user_id, year, type). The creditnota series
  // keeps the system format whatever the owner chose for his invoices — invoice-numbering.ts is
  // explicit that customisation is factuur-only, and reading a CR- number with the factuur template
  // would invent a hole in one series and hide one in the other.
  //
  // pro_forma is deliberately absent: an offerte is not a fiscal document and has no place in the
  // doorlopende reeks. The rule leaves a type it was given no format for alone.
  const formats: SeriesFormat[] = [
    { type: "factuur", template, padding },
    { type: "creditnota", template: "CR-{year}{seq}", padding: 4 },
  ];

  let counters: CounterRow[] | null = null;
  if (countersResult.status === "fulfilled" && !countersResult.value.error && countersResult.value.data) {
    counters = countersResult.value.data as CounterRow[];
  } else {
    // Loud: without it the report silently loses the only check that can see a gap at the END of a
    // series, which is the likeliest gap there is.
    console.error("[DOORLOPEND] Could not read the counters — the end of each series stays unchecked", {
      error:
        countersResult.status === "rejected"
          ? String(countersResult.reason)
          : countersResult.value.error?.message,
    });
  }

  const report = checkContinuity({ invoices, formats, counters });

  return NextResponse.json({
    ok: true,
    series: report.series,
    unreadable: report.unreadable,
    clean: report.clean,
    // null when either half of the check could not run — never a reassuring 0.
    unaccounted: totalUnaccounted(report),
    // So the screen can say WHICH half it could not check, instead of a vague warning.
    countersRead: counters !== null,
  });
}
