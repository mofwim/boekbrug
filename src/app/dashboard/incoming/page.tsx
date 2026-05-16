// src/app/dashboard/incoming/page.tsx
// [BOEK-011] Incoming invoices page — server component
// Fetches connection status + pending invoices, passes to client

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import IncomingInvoicesClient from "./IncomingInvoicesClient";

export const dynamic = "force-dynamic";

export default async function IncomingPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch email connection status
  const { data: connection } = await supabase
    .from("email_connections")
    .select("provider, email, connected_at")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  // Count pending incoming invoices
  const { count: pendingCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received");

  // Fetch pending invoices for payment confirmation
  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, client_name, client_email, total_inc_btw, invoice_date, invoice_number, source, created_at"
    )
    .eq("sender_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .order("created_at", { ascending: false })
    .limit(50);

  const connectionStatus = {
    connected: !!connection,
    provider: connection?.provider ?? null,
    email: connection?.email ?? null,
    connected_at: connection?.connected_at ?? null,
    pending_count: pendingCount ?? 0,
  };

  return (
    <IncomingInvoicesClient
      initialInvoices={invoices ?? []}
      connectionStatus={connectionStatus}
    />
  );
}