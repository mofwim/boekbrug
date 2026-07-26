// src/app/dashboard/waarheid/page.tsx
// [TRUTH-LENS] The living financial-truth surface. Server component: auth only — every figure is
// fetched live from /api/truth (the shared reconcile pipeline), so there is nothing to precompute
// here. One truth, a time lens on top.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import WaarheidClient from "./WaarheidClient";

export const dynamic = "force-dynamic";

export default async function WaarheidPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <WaarheidClient />;
}
