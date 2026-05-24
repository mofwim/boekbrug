// src/lib/supabase-server.ts
// [BOEK-TYPES] Typed user-facing Supabase client — May 2026
//
// ⚠️  Pipeline / service-role client lives in src/lib/supabase-pipeline.ts
//     Import createPipelineClient from there — NOT from here.

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { Database } from "@/types/database.types"

// ─── User-facing client (respects RLS) ───────────────────────────────────────
// Use for all requests that run in a user session (API routes, Server Components)

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookie writes are ignored safely
          }
        },
      },
    }
  )
}

// ─── Type helper ─────────────────────────────────────────────────────────────
export type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
