// app/api/files/route.ts
// Document upload (POST) + list (GET) (BOEK-010)
// src/app/api/files/route.ts
// GET: lijst bestanden van user
// POST: upload bestand → notificeer boekhouder

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createNotification } from '@/lib/notifications'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { file_name, file_url, file_size, file_type, doc_type, period, year, invoice_id, notes } = body

  const { data, error } = await supabase
    .from('documents')
    .insert({ user_id: user.id, file_name, file_url, file_size, file_type, doc_type, period, year, invoice_id, notes })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify accountant if user has one linked
  const { data: link } = await supabase
    .from('accountant_clients')
    .select('accountant_id')
    .eq('zzper_id', user.id)
    .maybeSingle()

  if (link?.accountant_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', user.id)
      .single()

    const senderName = profile?.company_name || profile?.full_name || 'Een klant'

    await createNotification({
      supabase,
      userId: link.accountant_id,
      title: 'Nieuw document ontvangen',
      body: `${senderName} heeft een bestand geüpload: ${file_name}`,
      type: 'invoice',
      link: `/dashboard/clients/${user.id}`,
    })
  }

  return NextResponse.json({ document: data })
}