// src/app/dashboard/waarheid/page.tsx
// [TRUTH-LENS] The living financial-truth surface. Server component: auth only — every figure is
// fetched live from /api/truth (the shared reconcile pipeline), so there is nothing to precompute
// here. One truth, a time lens on top.

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import WaarheidClient from "./WaarheidClient";

export const dynamic = "force-dynamic";

export default async function WaarheidPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
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
