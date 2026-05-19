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
}

// Columns fetched for every incoming invoice card
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

  // [BOEK-011] Cast through unknown — Supabase select() returns a wide union
  const pendingInvoices = (pendingRaw ?? []) as unknown as IncomingInvoiceRow[];
  const ignoredInvoices = (ignoredRaw ?? []) as unknown as IncomingInvoiceRow[];

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