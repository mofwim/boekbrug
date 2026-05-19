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
    .eq("sender_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .order("created_at", { ascending: false })
    .limit(100);

  // [BOEK-011] Ignored invoices — status 'archived', can be restored
  const { data: ignoredRaw } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("sender_id", user.id)
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

  // [BOEK-011] Resolve folder info separately — safe, never breaks the page.
  // Collect every linked document_id, fetch their folders in one query.
  const allDocIds = [...pendingBase, ...ignoredBase]
    .map((inv) => inv.document_id)
    .filter((id): id is string => !!id);

  const folderByDocId = new Map<string, { id: string | null; name: string | null }>();

  if (allDocIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, folder_id, folders(name)")
      .in("id", allDocIds);

    for (const doc of (docs ?? []) as unknown as Array<{
      id: string;
      folder_id: string | null;
      folders: { name: string | null } | null;
    }>) {
      folderByDocId.set(doc.id, {
        id: doc.folder_id,
        name: doc.folders?.name ?? null,
      });
    }
  }

  // Attach folder info to each invoice
  const withFolder = (
    rows: Omit<IncomingInvoiceRow, "folder_id" | "folder_name">[]
  ): IncomingInvoiceRow[] =>
    rows.map((inv) => {
      const folder = inv.document_id ? folderByDocId.get(inv.document_id) : null;
      return {
        ...inv,
        folder_id: folder?.id ?? null,
        folder_name: folder?.name ?? null,
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
    />
  );
}