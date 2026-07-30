// src/app/api/invoice/[id]/supersede/route.ts
// [SUPERSEDE] "Deze vervangt factuur X" — archive the invoice this one was flagged against.
//
//   POST /api/invoice/<new invoice id>/supersede
//
// `id` is the invoice the owner is LOOKING AT: the corrected re-issue sitting in the verify queue
// with a "mogelijk dubbel" flag. The one being replaced is NOT taken from the request. It is read
// from the flag this server itself wrote at import time
// (field_confidence._safecore.possible_duplicate_id), so the request carries no target the client
// could aim somewhere else. A body that could name any invoice would make this an archive
// endpoint with a friendly label, reachable from a screen that never showed the victim.
//
// The write is an ARCHIVE (status 'archived'), never a delete — bewaarplicht (art. 52 AWR) keeps
// the record seven years, and every financial surface in this app reads an allow-list, so one
// status change takes it out of kosten, BTW, the bank matcher, the accountant's workspace and the
// export at once. It stays reversible: Inkomend › Genegeerd puts it back.
//
// What it refuses, out loud rather than quietly (see invoice-supersede.ts for the reasoning):
//   · money settled on the old invoice — the same wall, with the same exit named;
//   · an accountant lock ('verwerkt');
//   · a pair that is not a pair (same row, not both purchase invoices, wrong statuses).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import {
  refuseSupersede,
  SUPERSEDE_REFUSAL_TEXT,
  type SupersedeInvoice,
} from "@/lib/invoice-supersede";
import { logAuditAction, getClientIP } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SELECT =
  "id, status, direction, invoice_number, amount_paid, accountant_status, field_confidence, sender_id, receiver_id";

/** The id this invoice was flagged against at import time, or null when there is no usable flag. */
function flaggedTwinId(fieldConfidence: unknown): string | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object") return null;
  const safecore = (fieldConfidence as Record<string, unknown>)._safecore;
  if (!safecore || typeof safecore !== "object") return null;
  const s = safecore as Record<string, unknown>;
  if (s.possible_duplicate !== true) return null;
  const id = s.possible_duplicate_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();

  // The replacement — the invoice the owner is looking at. Owner-pinned.
  const { data: replacement } = await pipeline
    .from("invoices")
    .select(SELECT)
    .eq("id", id)
    .eq("receiver_id", user.id)
    .maybeSingle();
  if (!replacement) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  // The target comes from OUR OWN flag, never from the request.
  const oldId = flaggedTwinId((replacement as { field_confidence?: unknown }).field_confidence);
  if (!oldId) {
    return NextResponse.json(
      {
        error: "no_flagged_duplicate",
        detail:
          "Voor deze factuur is geen dubbele factuur aangewezen. Verwijder de oude dan handmatig bij Inkoopfacturen.",
      },
      { status: 409 },
    );
  }

  const { data: old } = await pipeline
    .from("invoices")
    .select(SELECT)
    .eq("id", oldId)
    .eq("receiver_id", user.id)
    .maybeSingle();
  if (!old) {
    // The flag points at a row this owner no longer has (removed, or never theirs). Say so —
    // an empty success would leave the owner believing a second cost is gone when it is not.
    return NextResponse.json(
      { error: "twin_not_found", detail: "De aangewezen factuur bestaat niet meer." },
      { status: 409 },
    );
  }

  const refusal = refuseSupersede(old as SupersedeInvoice, replacement as SupersedeInvoice);
  if (refusal) {
    return NextResponse.json(
      { error: refusal, detail: SUPERSEDE_REFUSAL_TEXT[refusal] },
      { status: 409 },
    );
  }

  // A booked payment always leaves a join row. Refuse on its mere existence — the rows written
  // before amount_applied existed carry no amount, so refuseSupersede's money check cannot see
  // them. Same guard, same reason, as /api/invoice/[id]/archive.
  const { data: links } = await pipeline
    .from("bank_tx_invoices")
    .select("transaction_id")
    .eq("user_id", user.id)
    .eq("invoice_id", oldId)
    .limit(1);
  if ((links ?? []).length > 0) {
    return NextResponse.json(
      {
        error: "bank_linked",
        detail:
          "Er is een banktransactie aan de oude factuur gekoppeld — ontkoppel die eerst op de Bank-pagina.",
      },
      { status: 409 },
    );
  }

  const archivedAt = new Date().toISOString();
  const newNumber = ((replacement as { invoice_number?: string | null }).invoice_number ?? "").trim();

  // The WHERE clause re-asserts every gate: this runs on the service-role client (no auth.uid(),
  // so no verwerkt trigger) and the reads above can be seconds stale.
  // `superseded_by_number` is not in the generated types until invoice_superseded_by.sql has run
  // and the types are regenerated — the same reason /api/btw/file casts for btw_filings. The cast
  // is on the PATCH only; every WHERE clause below stays fully typed.
  const archiveOld = (patch: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipeline as any)
      .from("invoices")
      .update(patch)
      .eq("id", oldId)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .in("status", ["processing", "received"])
      .or("accountant_status.is.null,accountant_status.neq.verwerkt")
      .select("id");

  const basePatch = { status: "archived", updated_at: archivedAt };
  const reasonPatch = { ...basePatch, archive_reason: "dubbel", archived_at: archivedAt };
  // [DEPLOY-SAFE] invoice_superseded_by.sql and invoice_archive_reason.sql are applied by hand in
  // this project, and INDEPENDENTLY — so the two notes can be missing separately. The archive must
  // never die on a label, but it must not throw away a label that WOULD have worked either: a
  // single all-or-nothing fallback would drop "Dubbel" (whose migration is long applied) just
  // because superseded_by_number is not there yet. Hence one step at a time, most informative
  // first. On a missing-column error (PostgREST PGRST204 / Postgres 42703) we try the next.
  const missingColumn = (e: { code?: string } | null) => e?.code === "PGRST204" || e?.code === "42703";

  let { data: updated, error } = await archiveOld(
    newNumber ? { ...reasonPatch, superseded_by_number: newNumber } : reasonPatch,
  );
  if (missingColumn(error) && newNumber) {
    console.warn("[SUPERSEDE] superseded_by_number ontbreekt nog — migratie niet toegepast; archiveer zonder dat label");
    ({ data: updated, error } = await archiveOld(reasonPatch));
  }
  if (missingColumn(error)) {
    console.warn("[SUPERSEDE] archive_reason/archived_at ontbreken nog; archiveer zonder notitie");
    ({ data: updated, error } = await archiveOld(basePatch));
  }
  if (error) {
    return NextResponse.json({ error: "supersede_failed", detail: error.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Someone paid it, the accountant locked it, or it was archived between our read and this
    // write. Nothing changed — report the conflict rather than an imaginary success.
    return NextResponse.json(
      { error: "not_supersedable", detail: SUPERSEDE_REFUSAL_TEXT.not_supersedable },
      { status: 409 },
    );
  }

  // ── The warning on the REPLACEMENT has now been answered ──────────────────────────────────
  // Leaving it would be a stale alarm: the card would keep saying "mogelijk dubbel met X" about
  // an invoice the owner just resolved, keep the row out of auto-advance, and keep offering a
  // button whose target is already archived (a second tap would only earn an "already_archived"
  // refusal). Clearing it is the honest record of what happened — the owner answered the question
  // this flag was asking. Everything ELSE in _safecore stays: the arithmetic verdict, an IBAN
  // change, a reminder marker are separate concerns and none of them were answered here.
  //
  // Best-effort on purpose, and last on purpose: the archive above is the act that matters. If
  // this write fails the owner sees a warning that has become untrue — annoying, and visible —
  // rather than a second cost silently back in the books.
  try {
    const fc = (replacement as { field_confidence?: unknown }).field_confidence;
    if (fc && typeof fc === "object") {
      const next = { ...(fc as Record<string, unknown>) };
      const safecore = { ...((next._safecore ?? {}) as Record<string, unknown>) };
      delete safecore.possible_duplicate;
      delete safecore.possible_duplicate_of;
      delete safecore.possible_duplicate_id;
      delete safecore.possible_duplicate_reason;
      next._safecore = safecore;
      await pipeline
        .from("invoices")
        // field_confidence is a jsonb; the generated Json type cannot express an object built
        // from unknown-valued keys, so the cast is on the VALUE only — the row is still pinned.
        .update({ field_confidence: next as never })
        .eq("id", id)
        .eq("receiver_id", user.id);
    }
  } catch {
    /* non-fatal — the archive stands; the owner sees a warning that is merely out of date */
  }

  // The id-exact link on BOTH sides lives here, where "who did what, when" belongs. The column is
  // only a label for the screen.
  await logAuditAction({
    userId: user.id,
    action: "invoice.superseded",
    entityType: "invoice",
    entityId: oldId,
    oldValue: { status: (old as { status?: string | null }).status },
    newValue: {
      status: "archived",
      superseded_by_id: id,
      superseded_by_number: newNumber || null,
      invoice_number: (old as { invoice_number?: string | null }).invoice_number ?? null,
      via: "verify_queue_supersede",
    },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    ok: true,
    archivedId: oldId,
    archivedNumber: (old as { invoice_number?: string | null }).invoice_number ?? null,
  });
}
