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

export const dynamic = "force-dynamic";

// [BOEK-011] Shape of an incoming invoice row — matches the client component
interface IncomingInvoiceRow {
  id: string;
  client_name: string;
  client_email: string | null;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
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
}

// Plain column list — no join. The join broke the query and emptied the page.
const INVOICE_COLUMNS =
  "id, client_name, client_email, total_ex_btw, btw_amount, total_inc_btw, invoice_date, invoice_number, source, pdf_url, document_id, created_at, field_confidence";

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
    .select("provider, email, connected_at")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  // [BOEK-011] Pending invoices — status 'processing', awaiting confirmation.
  // Sorted by invoice_date (newest first): created_at is the IMPORT moment,
  // which for backfilled email syncs has nothing to do with the invoice's real
  // date — sorting on it made the queue look shuffled.
  const { data: pendingRaw } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "processing")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  // [BOEK-011] Ignored invoices — status 'archived', can be restored
  const { data: ignoredRaw } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(50);

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

  // [BOEK-011] Resolve folder PATH for each invoice — safe, never breaks the page.
  // 1. Get the folder_id for each linked document
  // 2. Load all the user's folders once
  // 3. Walk parent_id up to build the full path: "2026 / Q1 / maart / Facturen"
  const allDocIds = [...pendingBase, ...ignoredBase]
    .map((inv) => inv.document_id)
    .filter((id): id is string => !!id);

  // document_id → folder_id
  const folderIdByDocId = new Map<string, string | null>();

  if (allDocIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, folder_id")
      .in("id", allDocIds);

    for (const doc of (docs ?? []) as unknown as Array<{
      id: string;
      folder_id: string | null;
    }>) {
      folderIdByDocId.set(doc.id, doc.folder_id);
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
        health: classifyImportHealth({
          total_ex_btw: inv.total_ex_btw,
          btw_amount: inv.btw_amount,
          total_inc_btw: inv.total_inc_btw,
          invoice_date: inv.invoice_date,
          field_confidence: inv.field_confidence,
        }),
      };
    });

  const pendingInvoices = withFolder(pendingBase);
  const ignoredInvoices = withFolder(ignoredBase);

  const connectionStatus = {
    connected: !!connection,
    provider: (connection?.provider ?? null) as 'gmail' | 'outlook' | null,
    email: (connection?.email ?? null) as string | null,
    connected_at: connection?.connected_at ?? null,
    pending_count: pendingInvoices.length,
  };

  return (
    <IncomingInvoicesClient
      initialInvoices={pendingInvoices}
      ignoredInvoices={ignoredInvoices}
      connectionStatus={connectionStatus}
      userRole={userRole}
    />
  );
}