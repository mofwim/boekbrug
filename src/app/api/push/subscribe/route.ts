// src/app/api/push/subscribe/route.ts
// [PUSH] Store (or refresh) the calling user's Web Push subscription for this
// device. Auth is here; user_id is taken from the session and can never be
// spoofed. UPSERT on the endpoint (its natural key) so re-subscribing the same
// browser refreshes its keys instead of duplicating a row.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";

interface PushSub {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let sub: PushSub | null = null;
  try {
    const parsed = await req.json();
    sub = (parsed?.subscription ?? parsed) as PushSub;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;

  try {
    const pipeline = createPipelineClient();
    // push_subscriptions is not yet in generated types → relaxed client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (pipeline as any)
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          user_agent: userAgent,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );

    if (error) {
      console.error("[push/subscribe] upsert failed:", error.message ?? error);
      return NextResponse.json({ error: "store_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe] error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
