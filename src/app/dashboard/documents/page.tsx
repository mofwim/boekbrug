// app/dashboard/documents/page.tsx
// File system page (BOEK-010)

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { DocumentsClient } from "./DocumentsClient";

export const metadata = {
  title: "Documenten — BoekBrug",
};

export default async function DocumentsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Documenten</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Facturen, bonnen, contracten en bankafschriften op één plek
        </p>
      </div>
      <DocumentsClient userId={user.id} />
    </div>
  );
}