// src/app/dashboard/incoming/page.tsx
// [BOEK-011] Incoming invoices page — server component
// Fetches connection status + pending invoices + ignored invoices

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import IncomingInvoicesClient from "./IncomingInvoicesClient";

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
}

// Plain column list — no join. The join broke the query and emptied the page.
const INVOICE_COLUMNS =
  "id, client_name, client_email, total_ex_btw, btw_amount, total_inc_btw, invoice_date, invoice_number, source, pdf_url, document_id, created_at";

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

  // [BOEK-011] Pending invoices — status 'received', awaiting confirmation
  const { data: pendingRaw } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
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

  // [BOEK-011] Base rows — cast through unknown (Supabase returns a wide union)
  const pendingBase = (pendingRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name"
  >[];
  const ignoredBase = (ignoredRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name"
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

  // Attach folder id + full path to each invoice
  const withFolder = (
    rows: Omit<IncomingInvoiceRow, "folder_id" | "folder_name">[]
  ): IncomingInvoiceRow[] =>
    rows.map((inv) => {
      const folderId = inv.document_id
        ? folderIdByDocId.get(inv.document_id) ?? null
        : null;
      return {
        ...inv,
        folder_id: folderId,
        folder_name: buildFolderPath(folderId),
      };
    });

  const pendingInvoices = withFolder(pendingBase);
  const ignoredInvoices = withFolder(ignoredBase);

  const connectionStatus = {
    connected: !!connection,
    provider: connection?.provider ?? null,
    email: connection?.email ?? null,
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