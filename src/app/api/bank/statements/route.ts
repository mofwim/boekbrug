// src/app/api/bank/statements/route.ts
// [BANK-STATEMENTS] List the bank statement files the owner has uploaded, for a
// simple "uploaded statements" table (filename + when it was uploaded + size).
//
// GET  → { ok: true, statements: [{ id, name, uploadedAt, size }] }
//
// Source: the documents table, where each uploaded statement is stored with
// doc_type = 'bankafschrift' (see the bank upload route's passthrough store).
// Read-only, scoped to the user.
//
// Honest limitation: transactions are NOT linked to the statement they came
// from (no statement_id on bank_transactions), so we cannot show a per-statement
// transaction count here — only the file and its upload time.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("documents")
    .select("id, file_name, created_at, file_size")
    .eq("user_id", user.id)
    .eq("doc_type", "bankafschrift")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "lookup_failed", detail: error.message }, { status: 500 });
  }

  const statements = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.file_name,
    uploadedAt: r.created_at,
    size: r.file_size,
  }));

  return NextResponse.json({ ok: true, statements });
}