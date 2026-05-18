// src/app/page.tsx
// [Google-OAuth] Redirect homepage based on auth state — May 2026
// Prevents ?code= from landing on homepage unused

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export default async function Home() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}