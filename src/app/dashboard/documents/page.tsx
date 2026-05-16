// app/dashboard/documents/page.tsx
// [BOEK-010] Documents page — supports ?clientId= for accountant mode

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { DocumentsClient } from "./DocumentsClient";

interface Props {
  searchParams: Promise<{ clientId?: string }>;
}

export default async function DocumentsPage({ searchParams }: Props) {
  const { clientId } = await searchParams;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // [BOEK-010] If clientId → resolve client name for the header
  let clientName: string | undefined;
  if (clientId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, company_name")
      .eq("id", clientId)
      .single();

    if (profile) {
      clientName = profile.company_name || profile.full_name || undefined;
    }
  }

  return (
    <main>
      <DocumentsClient clientName={clientName} />
    </main>
  );
}