// src/lib/supabase-pipeline.ts
// [BOEK-TYPES] Pipeline / service-role client — May 2026
//
// ⚠️  NEVER import this in user-facing routes or client components.
//     This client bypasses RLS entirely.
//
// USE FOR: Gmail sync, AI pipeline, cron jobs, audit writes, rate-limit checks
// DO NOT USE FOR: Any request triggered directly by a user HTTP call

import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

export function createPipelineClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error("[PIPELINE] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export type PipelineClient = ReturnType<typeof createPipelineClient>
