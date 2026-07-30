// src/app/dashboard/incoming/page.tsx
// [BOEK-011] Incoming invoices page — server component
// Fetches connection status + pending invoices + ignored invoices

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import IncomingInvoicesClient from "./IncomingInvoicesClient";
// [IMPORT-MONITOR] Part 1 — read-time health classification (visibility only).
import {
  classifyImportHealth,
  type ImportHealth,
  type FieldConfidence,
} from "@/lib/import-health";
// [QUEUE-COMPLETE] pages past PostgREST's silent ~1000-row cap.
import { fetchAllRows } from "@/lib/supabase-paginate";

export const dynamic = "force-dynamic";

// [BOEK-011] Shape of an incoming invoice row — matches the client component
interface IncomingInvoiceRow {
  id: string;
  client_name: string;
  client_email: string | null;
  // [BRIDGE-CREDITNOTA-SIGN] 'creditnota' → negative amounts by design; drives
  // the queue badge + the sign-inverted read-time health gate below.
  invoice_type: string | null;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  amount_paid?: number | null;
  invoice_date: string;
  invoice_number: string;
  source: string;
  pdf_url: string | null;
  document_id: string | null;
  created_at: string;
  folder_id: string | null;
  folder_name: string | null;
  // [BRIDGE-EXTRACT] per-field AI confidence — drives the modal's "confirm" flags.
  // [IMPORT-MONITOR] widened to FieldConfidence: at runtime this jsonb ALSO
  // carries a nested _safecore object on email-path invoices held for a math
  // problem. The classifier reads it; the existing modal still reads only the
  // flat AI scores (a structural subset), so nothing downstream breaks.
  field_confidence: FieldConfidence | null;
  // [IMPORT-MONITOR] Part 1 — read-time health verdict (clean | needs-review +
  // plain-language reasons). Computed server-side from existing signals only.
  health: ImportHealth;
  // [INCOMING-BEVESTIGD] Only set on the "Bevestigd" list — 'received' (verified, te betalen)
  // or 'paid' (settled). NULL/absent on pending (always 'processing') + ignored ('archived').
  status?: string | null;
  // [NEGEER-REDEN] Alleen op de Genegeerd-lijst geselecteerd, en ook daar optioneel: oude rijen
  // hebben hem niet, en zolang de migratie niet gedraaid is bestaat de kolom nog niet.
  archive_reason?: string | null;
  // [SUPERSEDE] The invoice number that replaced this one. Same conditions as archive_reason:
  // only on the Genegeerd list, and optional even there (older rows, and the migration may not
  // have been applied yet).
  superseded_by_number?: string | null;
}

// Plain column list — no join. The join broke the query and emptied the page.
// [BRIDGE-CREDITNOTA-SIGN] + invoice_type (badge + sign-inverted health gate).
const INVOICE_COLUMNS =
  "id, client_name, client_email, invoice_type, total_ex_btw, btw_amount, total_inc_btw, amount_paid, invoice_date, invoice_number, source, pdf_url, document_id, created_at, field_confidence";

export default async function IncomingPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // [BOEK-011] Fetch role for the Logo Universal Click pattern
  // (Navigation Strategy v1.0). Incoming is ZZP-only in practice,
  // but the link is dynamic for consistency across the app.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const userRole: "zzper" | "accountant" =
    profile?.role === "accountant" ? "accountant" : "zzper";

  // Email connection status
  const { data: connection } = await supabase
    .from("email_connections")
    // needs_reauth post-dates the generated types → cast on read (as the sync path does).
    .select("provider, email, connected_at, needs_reauth")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  // [BOEK-011] Pending invoices — status 'processing', awaiting confirmation.
  // Sorted by invoice_date (newest first): created_at is the IMPORT moment,
  // which for backfilled email syncs has nothing to do with the invoice's real
  // date — sorting on it made the queue look shuffled.
  //
  // [QUEUE-COMPLETE] fetchAllRows, no cap: this is the ONLY surface where a
  // 'processing' invoice can be verified, while the badges elsewhere
  // (ZzpDashboard, Vandaag's toVerifyCount) show the EXACT head-count. With
  // the old .limit(100), a large mailbox backfill said "130 wachten" while
  // the queue showed 100 and rows 101+ were unreachable.
  const pendingRaw = await fetchAllRows((from, to) => supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "processing")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to)
  ).catch(() => null);

  // [BOEK-011] Ignored invoices — status 'archived', can be restored
  // [QUEUE-COMPLETE] Also uncapped (was 50): an archived invoice beyond the
  // cap was invisible on the only surface that can restore it (Bewaarplicht —
  // archive is the app's "delete", so recovery must always be reachable).
  //
  // [NEGEER-REDEN] Deze lijst — en alleen deze — leest ook archive_reason, want dat label hoort
  // bij "waarom staat dit hier". De migratie invoice_archive_reason.sql wordt met de hand
  // toegepast, dus zolang die nog niet gedraaid is bestaat de kolom niet en zou de hele query
  // falen → een LEEG Genegeerd-tabblad, precies de plek waar niets verloren mag lijken. Daarom:
  // probeer mét de kolom, val bij een fout terug op de kale kolomlijst. Dan ontbreekt hooguit
  // het label.
  // [SUPERSEDE] superseded_by_number rides along on the SAME fallback: archive_reason says the
  // CATEGORY ("Dubbel"), this says WHICH invoice replaced it. Both arrive by hand-applied
  // migration, and both are labels — if either column is missing the query falls back to the bare
  // list, so the Genegeerd tab is never empty over a missing note.
  const ignoredColumns = `${INVOICE_COLUMNS}, archive_reason, superseded_by_number`;
  const fetchIgnored = (columns: string) =>
    fetchAllRows((from, to) => supabase
      .from("invoices")
      .select(columns)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "archived")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
    );
  const ignoredRaw = await fetchIgnored(ignoredColumns)
    .catch(() => fetchIgnored(INVOICE_COLUMNS).catch(() => null));

  // [INCOMING-BEVESTIGD] Confirmed invoices — verified out of the queue ('received', te betalen)
  // or already settled ('paid'). Before this tab they vanished to /incoming/manage (Crediteuren),
  // which felt like the work was lost. Surfacing the recent ones here — in place, read-only with a
  // status badge — closes that gap. Newest first, bounded; the full ledger stays on Crediteuren.
  //
  // [INBOX-CROWD-OUT] Two queries, not one shared cap: in the old single query
  // (received+paid, newest 50 by invoice_date) newer paid rows crowded older
  // UNPAID rows out of the tab, so an open bill shown on Vandaag was nowhere to
  // be found here. Unpaid ('received') rows are actionable → own query, higher
  // bound; paid rows stay a bounded recent slice (full ledger on Crediteuren).
  const { data: confirmedReceivedRaw } = await supabase
    .from("invoices")
    .select(`${INVOICE_COLUMNS}, status`)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const { data: confirmedPaidRaw } = await supabase
    .from("invoices")
    .select(`${INVOICE_COLUMNS}, status`)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "paid")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  // Merge back to one newest-first list (the client renders a single tab).
  // ISO dates compare correctly as strings; nulls sort last, created_at breaks ties.
  const confirmedRaw = [
    ...(confirmedReceivedRaw ?? []),
    ...(confirmedPaidRaw ?? []),
  ].sort((a, b) => {
    const ad = (a as { invoice_date: string | null }).invoice_date ?? "";
    const bd = (b as { invoice_date: string | null }).invoice_date ?? "";
    if (ad !== bd) return ad ? (bd ? bd.localeCompare(ad) : -1) : 1;
    const ac = (a as { created_at: string }).created_at ?? "";
    const bc = (b as { created_at: string }).created_at ?? "";
    return bc.localeCompare(ac);
  });

  // [BOEK-011] Base rows — cast through unknown (Supabase returns a wide union).
  // [IMPORT-MONITOR] Also omit `health` here: it is computed below, not selected.
  const pendingBase = (pendingRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name" | "health"
  >[];
  const ignoredBase = (ignoredRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name" | "health"
  >[];
  const confirmedBase = (confirmedRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name" | "health"
  >[];

  // [BOEK-011] Resolve folder PATH for each invoice — safe, never breaks the page.
  // 1. Get the folder_id for each linked document
  // 2. Load all the user's folders once
  // 3. Walk parent_id up to build the full path: "2026 / Q1 / maart / Facturen"
  const allDocIds = [...pendingBase, ...ignoredBase, ...confirmedBase]
    .map((inv) => inv.document_id)
    .filter((id): id is string => !!id);

  // document_id → folder_id
  const folderIdByDocId = new Map<string, string | null>();

  if (allDocIds.length > 0) {
    // [INBOX-CROWD-OUT] Chunked: the confirmed list can now hold hundreds of
    // rows, and supabase-js sends .in() filters in the URL — one giant id list
    // could exceed URL-length limits and silently drop every folder path.
    for (let i = 0; i < allDocIds.length; i += 150) {
      const { data: docs } = await supabase
        .from("documents")
        .select("id, folder_id")
        .in("id", allDocIds.slice(i, i + 150));

      for (const doc of (docs ?? []) as unknown as Array<{
        id: string;
        folder_id: string | null;
      }>) {
        folderIdByDocId.set(doc.id, doc.folder_id);
      }
    }
  }

  // Load every folder the user owns — to resolve full paths
  const { data: allFolders } = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .eq("user_id", user.id);

  const folderById = new Map<string, { name: string; parent_id: string | null }>();
  for (const f of (allFolders ?? []) as unknown as Array<{
    id: string;
    name: string;
    parent_id: string | null;
  }>) {
    folderById.set(f.id, { name: f.name, parent_id: f.parent_id });
  }

  // Build "2026 / Q1 / maart / Facturen" by walking up parent_id
  function buildFolderPath(folderId: string | null): string | null {
    if (!folderId) return null;
    const parts: string[] = [];
    let current: string | null = folderId;
    let guard = 0; // safety — never loop forever
    while (current && guard < 10) {
      const node = folderById.get(current);
      if (!node) break;
      parts.unshift(node.name);
      current = node.parent_id;
      guard++;
    }
    return parts.length > 0 ? parts.join(" / ") : null;
  }

  // Attach folder id + full path + [IMPORT-MONITOR] computed import health.
  const withFolder = (
    rows: Omit<IncomingInvoiceRow, "folder_id" | "folder_name" | "health">[]
  ): IncomingInvoiceRow[] =>
    rows.map((inv) => {
      const folderId = inv.document_id
        ? folderIdByDocId.get(inv.document_id) ?? null
        : null;
      return {
        ...inv,
        folder_id: folderId,
        folder_name: buildFolderPath(folderId),
        // [IMPORT-MONITOR] Part 1 — health from existing signals only (reads the
        // stored _safecore, else recomputes via the shared arithmetic gate; plus
        // the AI per-field confidence). Pure, read-time, no writes.
        // [BRIDGE-CREDITNOTA-SIGN] invoice_type routes a creditnota to the
        // sign-inverted gate — a clean negative creditnota reads "ready".
        health: classifyImportHealth({
          total_ex_btw: inv.total_ex_btw,
          btw_amount: inv.btw_amount,
          total_inc_btw: inv.total_inc_btw,
          invoice_date: inv.invoice_date,
          invoice_number: inv.invoice_number,
          invoice_type: inv.invoice_type,
          field_confidence: inv.field_confidence,
        }),
      };
    });

  const pendingInvoices = withFolder(pendingBase);
  const ignoredInvoices = withFolder(ignoredBase);
  const confirmedInvoices = withFolder(confirmedBase);

  const connectionStatus = {
    connected: !!connection,
    provider: (connection?.provider ?? null) as 'gmail' | 'outlook' | null,
    email: (connection?.email ?? null) as string | null,
    connected_at: connection?.connected_at ?? null,
    // [EMAIL-HEALTH] true = the OAuth grant died; the automatic import has stopped and the owner
    // must reconnect. Surfaced as a banner so the connection can no longer rot silently green.
    needs_reauth: connection?.needs_reauth ?? false,
    pending_count: pendingInvoices.length,
  };

  return (
    <IncomingInvoicesClient
      initialInvoices={pendingInvoices}
      ignoredInvoices={ignoredInvoices}
      confirmedInvoices={confirmedInvoices}
      connectionStatus={connectionStatus}
      userRole={userRole}
    />
  );
}