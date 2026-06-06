// src/app/api/bank/upload/route.ts
// [BOEK-016] Upload + parse + store a bank statement (phase 2).
// Flow: auth → read file → parseBankFile() → content dedup → insert (status 'pending').
// NO matching here (phase 3) and NO payment side effects — this only stores raw transactions.
//
// Auth via the project's server client. Everything else (parse, dedup, insert)
// uses verified BOEK-016 helpers + the documented service_role pipeline client.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { parseBankFile } from "@/lib/bank-parser";
import { dedupTransactions, mapToRows, dateRange } from "@/lib/bank-import";

const MAX_BYTES = 5_000_000; // 5 MB — bank statements are small text/XML

export async function POST(req: NextRequest) {
  // 1. Auth — session client (RLS). User may only upload for themselves.
  //    (await assumes the helper is async, i.e. it reads cookies() — drop await if it's sync.)
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Read the uploaded file
  let content: string;
  let filename: string;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no_file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    content = await file.text();
    filename = file.name || "afschrift";
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  // 3. Parse (format auto-detected: CAMT.053 / MT940). No AI — pure parsing.
  const parsed = parseBankFile(content, filename);
  if (parsed.transactions.length === 0) {
    return NextResponse.json(
      { error: "no_transactions", parseWarnings: parsed.parseErrors },
      { status: 422 }
    );
  }

  // 4. Dedup against what this user already has, scoped to the file's date range.
  //    service_role (pipeline) is safe here: user_id is pinned to the authenticated user.
  const pipeline = createPipelineClient();
  const { min, max } = dateRange(parsed.transactions);

  let existing: {
    date: string | null;
    amount: number | null;
    description: string | null;
    counterpart_name: string | null;
    reference: string | null;
  }[] = [];

  if (min && max) {
    const { data, error } = await pipeline
      .from("bank_transactions")
      .select("date, amount, description, counterpart_name, reference")
      .eq("user_id", user.id)
      .gte("date", min)
      .lte("date", max);
    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", detail: error.message },
        { status: 500 }
      );
    }
    existing = data ?? [];
  }

  const { toInsert, skipped } = dedupTransactions(parsed.transactions, existing);

  // 5. Insert new transactions (status 'pending' — human confirms matches later).
  let inserted = 0;
  if (toInsert.length > 0) {
    const rows = mapToRows(toInsert, user.id);
    const { error } = await pipeline.from("bank_transactions").insert(rows);
    if (error) {
      return NextResponse.json(
        { error: "insert_failed", detail: error.message },
        { status: 500 }
      );
    }
    inserted = rows.length;
  }

  // [BOEK-016 — OPTIONAL] audit + rate-limit hooks to match project conventions:
  //   await logAuditAction(user.id, 'BANK_UPLOAD', 'bank_transactions', null,
  //                        { format: parsed.format, inserted, skipped });
  //   (and a RATE_LIMITS preset for /api/bank/upload via the atomic limiter).

  return NextResponse.json({
    ok: true,
    format: parsed.format,
    accountIban: parsed.accountIban,
    parsed: parsed.transactions.length,
    inserted,
    skipped,
    parseWarnings: parsed.parseErrors,
  });
}