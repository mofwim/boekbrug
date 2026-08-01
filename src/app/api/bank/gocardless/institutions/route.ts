// src/app/api/bank/gocardless/institutions/route.ts
// [GOCARDLESS] The bank picker: which banks can this owner connect?
//
// GET /api/bank/gocardless/institutions?country=NL
//   → { configured, institutions: [{ id, name, bic, transactionTotalDays, logo }] }
//
// `configured: false` is a first-class answer, not an error: a server without GoCardless
// credentials should make the card hide itself, not offer a button that can only fail.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  createGoCardlessClient,
  dutchGoCardlessError,
  GoCardlessError,
  isGoCardlessConfigured,
} from "@/lib/gocardless-client";

export const dynamic = "force-dynamic";

/** Two letters only. The value goes into the query string of an upstream call, so it is
 *  validated rather than escaped-and-hoped. */
function readCountry(raw: string | null): string {
  const c = (raw ?? "NL").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "NL";
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ configured: false, institutions: [] });
  }

  const country = readCountry(req.nextUrl.searchParams.get("country"));

  try {
    const client = createGoCardlessClient();
    const institutions = await client.getInstitutions(country);
    // Alphabetical: the owner is looking for HIS bank by name, and the API's own order is not
    // meaningful to him.
    institutions.sort((a, b) => a.name.localeCompare(b.name, "nl"));
    return NextResponse.json({ configured: true, country, institutions });
  } catch (err) {
    if (err instanceof GoCardlessError) {
      console.warn("[GOCARDLESS] listing institutions failed", { code: err.code });
      return NextResponse.json(
        { configured: true, error: dutchGoCardlessError(err.code), code: err.code, institutions: [] },
        { status: err.code === "NOT_CONFIGURED" ? 503 : 502 },
      );
    }
    console.error("[GOCARDLESS] unexpected error listing institutions", err);
    return NextResponse.json({ error: "Banklijst ophalen mislukt" }, { status: 500 });
  }
}
