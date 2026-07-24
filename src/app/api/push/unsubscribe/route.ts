// src/app/api/push/unsubscribe/route.ts
// [PUSH] Remove this device's subscription (user turned notifications off, or the
// browser rotated its endpoint). Scoped to the caller: an endpoint is only
// deleted when it belongs to the authenticated user, so one user can never
// delete another's device row.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let endpoint = "";
  try {
    const body = await req.json();
    endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: "missing_endpoint" }, { status: 400 });

  try {
    const pipeline = createPipelineClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (pipeline as any)
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", user.id); // scope to the caller — never delete someone else's device

    if (error) {
      console.error("[push/unsubscribe] delete failed:", error.message ?? error);
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/unsubscribe] error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
