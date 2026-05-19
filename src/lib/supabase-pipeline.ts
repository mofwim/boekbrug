// src/lib/supabase-pipeline.ts
// [PIPELINE-CORE] service_role client — bypasses RLS
// للـ Pipeline والـ background jobs فقط — لا تستخدمه في user requests

import { createClient } from '@supabase/supabase-js'

export function createPipelineClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}