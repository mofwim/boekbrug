// src/app/api/cron/reminders/route.ts
// [REMINDERS] Scheduled payment-reminder heartbeat — the third cron of the app.
// For every owner who has OPTED IN (profiles.reminders_enabled), it finds their
// outgoing invoices that are still openstaand past the due date, and — for each
// invoice whose next reminder tier has come due — e-mails the client a gentle,
// escalating reminder. "The app chases your money for you, even with nobody
// logged in."
//
// SECURITY: iterates across users → never publicly callable. Bearer CRON_SECRET,
// constant-time compare, fail-closed (identical guard to /api/cron/reconcile).
//
// FINANCIAL-TRUTH / TRUST discipline (why this cron is safe):
//   * It NEVER writes to a financial record — no status, amount, match or filing
//     changes. It only reads invoices and writes to invoice_reminders (a send log).
//   * CLAIM-THEN-SEND: the reminder row is inserted FIRST with ignoreDuplicates on
//     UNIQUE(invoice_id, day_offset). An empty insert result = another run already
//     claimed this tier → we do NOT send. This makes a double-reminder impossible
//     even if two cron runs overlap — the worse failure (dunning a client twice)
//     can't happen.
//   * The decision (which tier, or none) is the pure reminderTierDue(); the amount
//     shown is the pure openstaandOf() (remaining, never the full total). Neither
//     touches I/O, both are unit-tested.
//   * Best-effort per owner AND per invoice: one failure never stops the rest, and
//     a failed send is recorded status='failed' (visible), never retried as a
//     double-send.
//   * Ships DARK: reminders_enabled defaults false, so until an owner turns it on
//     this cron finds zero enabled owners and sends nothing.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import {
  reminderTierDue,
  openstaandOf,
  amsterdamTodayDayNumber,
} from "@/lib/invoice-reminders";
import { sendInvoiceReminder } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Storage bucket that holds rendered invoice PDFs (see invoice/send route).
const PDF_BUCKET = "documents";

type OwnerProfile = {
  id: string;
  reminder_offsets: number[] | null;
  company_name: string | null;
  full_name: string | null;
};

type CandidateInvoice = {
  id: string;
  sender_id: string | null;
  client_name: string | null;
  client_email: string | null;
  invoice_number: string | null;
  due_date: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  pdf_url: string | null;
  invoice_type: string | null;
  status: string | null;
};

export async function GET(req: NextRequest) {
  // ── Auth — fail-closed, constant-time (same as reconcile/email-sync) ──
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-REMINDERS] CRON_SECRET is not configured — reminders are DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const today = amsterdamTodayDayNumber();

  // ── 1) Only owners who OPTED IN. No enabled owners → nothing to do (dark). ──
  //    A column-missing error (migration not yet applied) is caught and returned
  //    as a clean no-op, never a 500.
  let owners: OwnerProfile[];
  try {
    owners = await fetchAllRows<OwnerProfile>((from, to) =>
      pipeline
        .from("profiles")
        .select("id, reminder_offsets, company_name, full_name")
        .eq("reminders_enabled", true)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error("[CRON-REMINDERS] enabled-owner lookup failed (migration applied?)", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ ok: true, enabledOwners: 0, note: "lookup_failed" });
  }

  if (owners.length === 0) {
    return NextResponse.json({ ok: true, enabledOwners: 0, sent: 0 });
  }

  const ownerById = new Map<string, OwnerProfile>();
  for (const o of owners) ownerById.set(o.id, o);
  const ownerIds = [...ownerById.keys()];

  // ── 2) Their outgoing, still-open invoices (paginated, bounded to opted-in owners). ──
  const invoices = await fetchAllRows<CandidateInvoice>((from, to) =>
    pipeline
      .from("invoices")
      .select(
        "id, sender_id, client_name, client_email, invoice_number, due_date, total_inc_btw, amount_paid, pdf_url, invoice_type, status",
      )
      .in("sender_id", ownerIds)
      .eq("direction", "outgoing")
      .in("status", ["sent", "overdue"])
      .eq("reminders_paused", false)
      .not("due_date", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    console.error("[CRON-REMINDERS] candidate invoice fetch failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [] as CandidateInvoice[];
  });

  if (invoices.length === 0) {
    return NextResponse.json({ ok: true, enabledOwners: owners.length, sent: 0 });
  }

  // ── 3) Which tiers were already sent, per invoice (one batched read). ──
  const invoiceIds = invoices.map((i) => i.id);
  const sentRows = await fetchAllRows<{ invoice_id: string; day_offset: number }>((from, to) =>
    pipeline
      .from("invoice_reminders")
      .select("invoice_id, day_offset")
      .in("invoice_id", invoiceIds)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch(() => [] as { invoice_id: string; day_offset: number }[]);

  // ── [CREDITNOTA-NO-CHASE] Which candidates were withdrawn with a creditnota? ──
  // A credited invoice KEEPS its 'sent'/'overdue' status, its positive total and its due date
  // (the +omzet must stay to be netted by the creditnota's −omzet), so nothing the query above
  // filters on reveals it. Without this read the cron mails the customer a payment demand for
  // an invoice the owner already withdrew. One batched query over the same candidate ids;
  // a failure degrades to "none credited", i.e. exactly the old behaviour, never a crash.
  // Keyed on the OWNERS (the same bounded list the candidate query uses), not on the candidate
  // ids: an .in() over thousands of uuids would blow the URL length long before it broke
  // anything visible. A creditnota per owner is rare, so this stays a small read.
  const creditNoteRows = await fetchAllRows<{ original_invoice_id: string | null }>((from, to) =>
    pipeline
      .from("invoices")
      .select("original_invoice_id")
      .in("sender_id", ownerIds)
      .eq("invoice_type", "creditnota")
      .not("original_invoice_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    console.error("[CRON-REMINDERS] creditnota lookup failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [] as { original_invoice_id: string | null }[];
  });
  const creditedInvoiceIds = new Set(
    creditNoteRows.map((r) => r.original_invoice_id).filter((id): id is string => !!id),
  );

  const sentByInvoice = new Map<string, number[]>();
  for (const r of sentRows) {
    const arr = sentByInvoice.get(r.invoice_id) ?? [];
    arr.push(r.day_offset);
    sentByInvoice.set(r.invoice_id, arr);
  }

  // Group candidate invoices by owner so we can rotate fairly across owners.
  const invoicesByOwner = new Map<string, CandidateInvoice[]>();
  for (const inv of invoices) {
    if (!inv.sender_id) continue;
    const arr = invoicesByOwner.get(inv.sender_id) ?? [];
    arr.push(inv);
    invoicesByOwner.set(inv.sender_id, arr);
  }

  // ── 4) Fairness rotation + soft deadline (same discipline as reconcile). ──
  const orderedOwners = [...invoicesByOwner.keys()];
  const epochHour = Math.floor(Date.now() / 3_600_000);
  const offset = orderedOwners.length > 0 ? epochHour % orderedOwners.length : 0;
  const rotated = [...orderedOwners.slice(offset), ...orderedOwners.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000; // stop ~50s before the 300s ceiling, between owners

  let sent = 0;
  let failed = 0;
  let skippedDuplicate = 0;
  let ownersProcessed = 0;
  let truncated = 0;

  for (const ownerId of rotated) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = rotated.length - ownersProcessed;
      console.warn("[CRON-REMINDERS] soft deadline hit — deferring remaining owners", { remaining: truncated });
      break;
    }
    ownersProcessed += 1;

    const owner = ownerById.get(ownerId);
    if (!owner) continue;
    const offsets = owner.reminder_offsets && owner.reminder_offsets.length > 0
      ? owner.reminder_offsets
      : [14, 30];
    const maxTier = Math.max(...offsets);
    const zzperName = owner.company_name?.trim() || owner.full_name?.trim() || "BoekBrug";
    const ownerInvoices = invoicesByOwner.get(ownerId) ?? [];

    for (const inv of ownerInvoices) {
      // Pure decision: which tier (or none) is due right now?
      const tier = reminderTierDue({
        dueDate: inv.due_date,
        todayDayNumber: today,
        offsets,
        sentOffsets: sentByInvoice.get(inv.id) ?? [],
        status: inv.status,
        invoiceType: inv.invoice_type,
        direction: "outgoing",
        totalIncBtw: inv.total_inc_btw,
        amountPaid: inv.amount_paid,
        clientEmail: inv.client_email,
        remindersPaused: false,
        // [CREDITNOTA-NO-CHASE] Withdrawn with a creditnota → stop chasing the customer.
        hasCreditnota: creditedInvoiceIds.has(inv.id),
      });
      if (tier == null) continue;

      // CLAIM the tier atomically. ignoreDuplicates → an empty result means a
      // concurrent run already claimed it, so we send NOTHING (no double dunning).
      const { data: claimed, error: claimError } = await pipeline
        .from("invoice_reminders")
        .upsert(
          {
            invoice_id: inv.id,
            user_id: ownerId,
            day_offset: tier,
            email_to: inv.client_email,
            status: "sent",
          },
          { onConflict: "invoice_id,day_offset", ignoreDuplicates: true },
        )
        .select("id");

      if (claimError) {
        console.error("[CRON-REMINDERS] claim insert failed (non-fatal)", { invoiceId: inv.id, tier, error: claimError.message });
        failed += 1;
        continue;
      }
      if (!claimed || claimed.length === 0) {
        skippedDuplicate += 1; // already claimed by another run — do not send
        continue;
      }
      const claimId = claimed[0].id as string;

      // The ONLY amount a reminder may show — remaining, never the full total.
      const openstaand = openstaandOf(inv.total_inc_btw, inv.amount_paid);

      // Best-effort PDF re-attach from the stored invoice PDF. Any failure →
      // send without attachment (the template renders fine without it).
      let pdfBuffer: Buffer | undefined;
      if (inv.pdf_url) {
        try {
          const { data: blob } = await pipeline.storage.from(PDF_BUCKET).download(inv.pdf_url);
          if (blob) pdfBuffer = Buffer.from(await blob.arrayBuffer());
        } catch {
          /* non-blocking — reminder goes out without the PDF */
        }
      }

      try {
        await sendInvoiceReminder({
          toEmail: inv.client_email as string, // guaranteed non-empty by reminderTierDue
          clientName: inv.client_name?.trim() || "klant",
          zzperName,
          invoiceNumber: inv.invoice_number?.trim() || "—",
          openstaand,
          dueDate: inv.due_date as string,
          firm: offsets.length > 1 && tier === maxTier,
          pdfBuffer,
        });
        sent += 1;
        // Reflect the send in the pre-read map so a later pass in THIS run can't re-pick it.
        const arr = sentByInvoice.get(inv.id) ?? [];
        arr.push(tier);
        sentByInvoice.set(inv.id, arr);

        // Notify the owner (best-effort) — visible proof the app acted for them.
        try {
          await pipeline.from("notifications").insert({
            user_id: ownerId,
            title: "Herinnering verstuurd",
            body: `We hebben een herinnering gestuurd voor factuur ${inv.invoice_number ?? ""} aan ${inv.client_name ?? "je klant"}.`,
            type: "invoice",
            read: false,
            link: `/dashboard/invoice/${inv.id}`,
          });
        } catch {
          /* low severity — the reminder itself already succeeded */
        }
      } catch (sendErr) {
        // sendInvoiceReminder is best-effort (won't throw on a Resend rejection),
        // so a throw here is unexpected. Mark the claimed row 'failed' for
        // visibility; we do NOT retry it (never risk a double-send).
        failed += 1;
        console.error("[CRON-REMINDERS] reminder send threw (non-fatal)", { invoiceId: inv.id, tier, error: sendErr instanceof Error ? sendErr.message : String(sendErr) });
        try {
          await pipeline.from("invoice_reminders").update({ status: "failed" }).eq("id", claimId);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    enabledOwners: owners.length,
    candidates: invoices.length,
    sent,
    failed,
    skippedDuplicate,
    ownersProcessed,
    truncated,
  });
}
