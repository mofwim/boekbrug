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
  // [BOEK-011] folder info — joined from the linked document
  folder_id: string | null;
  folder_name: string | null;
}

// [BOEK-011] Raw row from Supabase — documents join comes back nested
interface RawInvoiceRow {
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
  documents: {
    folder_id: string | null;
    folders: { name: string | null } | null;
  } | null;
}

// Columns — includes a nested join to documents → folders for the folder link
const INVOICE_COLUMNS =
  "id, client_name, client_email, total_ex_btw, btw_amount, total_inc_btw, invoice_date, invoice_number, source, pdf_url, document_id, created_at, documents(folder_id, folders(name))";

// Flatten the nested documents/folders join into top-level fields
function flatten(rows: RawInvoiceRow[]): IncomingInvoiceRow[] {
  return rows.map((r) => ({
    id: r.id,
    client_name: r.client_name,
    client_email: r.client_email,
    total_ex_btw: r.total_ex_btw,
    btw_amount: r.btw_amount,
    total_inc_btw: r.total_inc_btw,
    invoice_date: r.invoice_date,
    invoice_number: r.invoice_number,
    source: r.source,
    pdf_url: r.pdf_url,
    document_id: r.document_id,
    created_at: r.created_at,
    folder_id: r.documents?.folder_id ?? null,
    folder_name: r.documents?.folders?.name ?? null,
  }));
}

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

  // [BOEK-011] Cast through unknown — Supabase select() returns a wide union
  const pendingInvoices = flatten((pendingRaw ?? []) as unknown as RawInvoiceRow[]);
  const ignoredInvoices = flatten((ignoredRaw ?? []) as unknown as RawInvoiceRow[]);

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