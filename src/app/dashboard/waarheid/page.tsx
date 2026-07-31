// src/app/dashboard/waarheid/page.tsx
// [TRUTH-LENS] The living financial-truth surface. Server component: auth only — every figure is
// fetched live from /api/truth (the shared reconcile pipeline), so there is nothing to precompute
// here. One truth, a time lens on top.

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import WaarheidClient from "./WaarheidClient";

export const dynamic = "force-dynamic";

export default async function WaarheidPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // [NAMED-QUARTER] WaarheidClient reads ?year&quarter so it can open on a specific quarter — the
  // old /dashboard/resultaat redirects here carrying exactly that. useSearchParams opts a client
  // component into request-time rendering, so it must sit under a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <WaarheidClient />
    </Suspense>
  );
}
