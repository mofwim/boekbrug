// src/app/api/invoice/audit/route.ts
// [NAREKENEN] "Reken mijn boeken na" — re-check the amounts that are ALREADY booked against the
// documents they came from.
//
// ── THE GAP THIS CLOSES ──
// [GEGROND] gave every amount an independent witness: for a text PDF, either the number occurs in
// the document's own characters or it does not. But it runs at IMPORT, so it says nothing about the
// invoices that were already in the books — which is precisely the set an owner doubts. Being told
// "everything from today onwards is verified" does not answer "is what is in there now right?".
//
// ── IT WRITES EVIDENCE. IT NEVER WRITES A FIGURE. ──
// Not one amount, date, status or BTW field is touched, and that is not caution for its own sake.
// An audit that can also "fix" what it finds is an audit whose results cannot be checked; and on a
// booked invoice a silent correction moves a figure that may already sit in a filed aangifte. The
// owner is told what was found. What to do about it is theirs, through the correction paths that
// already exist (Bedragen corrigeren, Opnieuw inlezen).
//
// The only write is field_confidence._grounding — the verdict itself — so a second run does not
// have to redo the work, and so the verify screen can show the result on the row.
//
// ── FREE, AND HONEST ABOUT WHAT IT SKIPPED ──
// The mechanical witness needs characters, so this reads the stored PDF's text layer: no AI call, no
// cost, nothing to rate-limit but the storage reads. A photographed receipt has no text, and the OCR
// witness costs an API call per document — running that across a whole administration would be a
// bill nobody asked for. Those come back UNCHECKED and the report says so out loud, because
// "everything checks out" while silently skipping the photographs is a claim about documents nobody
// opened.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { readPdfTextLayer } from "@/lib/pdf-text";
import { groundMoneyFields } from "@/lib/amount-grounding";
import { summarizeAudit, type AuditedInvoice } from "@/lib/books-audit";
import { requireOwner } from "@/lib/owner-only";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How many documents one run downloads. A whole quarter fits; a whole history is several runs. */
const MAX_PER_RUN = 300;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  { const w = await requireOwner('De bedragen van geboekte inkoopfacturen narekenen'); if (w.response) return w.response }

  const limited = await checkRateLimit({
    userId: user.id,
    endpoint: "invoice-audit",
    ...RATE_LIMITS.DOCUMENTS_REPROCESS,
  });
  if (!limited.allowed) return rateLimitResponse(limited);

  const body = await req.json().catch(() => ({}));
  const year = Number((body as { year?: unknown }).year);
  const scopedYear = Number.isInteger(year) && year > 2000 && year < 2100 ? year : null;

  const pipeline = createPipelineClient();

  // Confirmed purchase invoices only. A row still in the verify queue is about to be looked at by a
  // human anyway, and its grounding was already computed at import.
  let invoices: Array<{
    id: string; invoice_number: string | null; client_name: string | null;
    total_inc_btw: number | null; total_ex_btw: number | null; btw_amount: number | null;
    document_id: string | null; field_confidence: unknown;
  }>;
  try {
    invoices = await fetchAllRows((from, to) => {
      const q = pipeline.from("invoices")
        .select("id, invoice_number, client_name, total_inc_btw, total_ex_btw, btw_amount, document_id, field_confidence")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .in("status", ["received", "paid"]);
      const scoped = scopedYear
        ? q.gte("invoice_date", `${scopedYear}-01-01`).lte("invoice_date", `${scopedYear}-12-31`)
        : q;
      return scoped.order("id", { ascending: true }).range(from, to);
    });
  } catch (e) {
    // [NO-SILENT-EMPTY] A failed read must never come back as "nothing to check" — on a screen whose
    // entire purpose is to say whether the books are right, that reads as a clean bill of health.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[NAREKENEN] invoice lookup failed", { userId: user.id, error: message });
    return NextResponse.json({ error: "lookup_failed" }, { status: 503 });
  }

  const withDoc = invoices.filter((i) => !!i.document_id).slice(0, MAX_PER_RUN);
  const truncated = invoices.filter((i) => !!i.document_id).length - withDoc.length;

  // Resolve the storage paths in one chunked read.
  const docPaths = new Map<string, string>();
  if (withDoc.length > 0) {
    try {
      const docs = await fetchAllRowsForIds<{ id: string; file_url: string | null }, string>(
        withDoc.map((i) => i.document_id as string),
        (chunk, from, to) =>
          pipeline.from("documents").select("id, file_url")
            .eq("user_id", user.id).in("id", chunk)
            .order("id", { ascending: true }).range(from, to),
      );
      for (const d of docs) if (d.file_url) docPaths.set(d.id, d.file_url);
    } catch (e) {
      console.error("[NAREKENEN] document lookup failed", { userId: user.id, error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: "lookup_failed" }, { status: 503 });
    }
  }

  const audited: AuditedInvoice[] = [];

  for (const inv of withDoc) {
    const path = inv.document_id ? docPaths.get(inv.document_id) : null;
    let text: string | null = null;
    if (path) {
      try {
        const { data } = await pipeline.storage.from("documents").download(path);
        if (data) {
          const buf = Buffer.from(await data.arrayBuffer());
          // Only a PDF has a text layer to read. An image returns null here, which is exactly the
          // 'unreadable' the report counts separately — never a failed check.
          text = (await readPdfTextLayer(buf)).text;
        }
      } catch {
        // A file that will not download is not evidence about the invoice. It falls through as
        // unreadable, which is the honest answer.
      }
    }

    const grounding = groundMoneyFields(
      { totalIncBtw: inv.total_inc_btw, totalExBtw: inv.total_ex_btw, btwAmount: inv.btw_amount },
      text,
      "text",
    );

    audited.push({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      clientName: inv.client_name,
      totalIncBtw: inv.total_inc_btw,
      verdict: grounding.totalIncBtw,
    });

    // The ONLY write, and it is evidence: the verdict, merged into field_confidence beside whatever
    // is already there. Every money field, the date and the status are untouched — see the header.
    const merged = {
      ...(inv.field_confidence && typeof inv.field_confidence === "object" ? inv.field_confidence : {}),
      _grounding: grounding,
    };
    const { error: wErr } = await pipeline
      .from("invoices")
      // jsonb: the generated types model it as a recursive Json union, which a typed object does not
      // satisfy structurally. Cast at the boundary only — `merged` itself is built from real values.
      .update({ field_confidence: merged } as never)
      .eq("id", inv.id)
      .eq("receiver_id", user.id);
    if (wErr) {
      // Storing the verdict is a convenience, not the result. The owner still gets the answer in
      // this response, so a failed write is logged and never turns into a wrong report.
      console.warn("[NAREKENEN] could not store the verdict", { invoiceId: inv.id, error: wErr.message });
    }
  }

  const summary = summarizeAudit(audited);
  return NextResponse.json({
    ok: true,
    summary: {
      confirmed: summary.confirmed,
      unchecked: summary.unchecked,
      examined: summary.examined,
      mismatched: summary.mismatched,
    },
    // Named rather than silently dropped: a cap the owner cannot see is a report that claims to
    // cover more than it did.
    truncated,
    // Invoices with no stored document at all cannot be checked against anything, and that is a
    // different gap with its own fix ([ORIGINEEL] — "Origineel toevoegen").
    withoutDocument: invoices.length - (withDoc.length + truncated),
  });
}
