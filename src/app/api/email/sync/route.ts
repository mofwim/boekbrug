// src/app/api/email/sync/route.ts
// [BOEK-011] Sync Gmail inbox — fetch PDF attachments, AI-classify as invoice or not
// POST /api/email/sync
// Called: after OAuth callback (background) + manually from incoming page

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { fetchGmailAttachments, classifyAttachment } from '@/lib/email-integration'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }

  // [BOEK-011] Get stored Gmail token
  const { data: connection } = await supabase
    .from('email_connections')
    .select('access_token, refresh_token, email')
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .single()

  if (!connection?.access_token) {
    return NextResponse.json({ error: 'Gmail niet verbonden' }, { status: 400 })
  }

  // [BOEK-011] Get sync boundary — only fetch emails after profile.created_at
  const { data: profile } = await supabase
    .from('profiles')
    .select('created_at')
    .eq('id', user.id)
    .single()

  const syncAfter = profile?.created_at
    ? new Date(profile.created_at).getTime()
    : Date.now() - 30 * 24 * 60 * 60 * 1000 // fallback: 30 days

  // [BOEK-011] Fetch Gmail messages with PDF attachments
  let attachments: Array<{
    messageId: string
    filename: string
    mimeType: string
    data: string // base64
    subject: string
    from: string
    date: string
    size: number
  }>

  try {
    attachments = await fetchGmailAttachments(connection.access_token, syncAfter)
  } catch (err: unknown) {
    // Token might be expired — return error, frontend can prompt reconnect
    const message = err instanceof Error ? err.message : 'Onbekende fout'
    return NextResponse.json(
      { error: 'Gmail ophalen mislukt', detail: message },
      { status: 502 }
    )
  }

  if (attachments.length === 0) {
    return NextResponse.json({ synced: 0, queued: 0 })
  }

  // [BOEK-011] Check which messageIds already exist to avoid duplicates
  const { data: existingInvoices } = await supabase
    .from('invoices')
    .select('source')
    .eq('sender_id', user.id)
    .eq('direction', 'incoming')
    .eq('source', 'email')

  // We store Gmail message IDs in a separate dedup check
  // Use email subject + from + date as dedup key (simpler than storing messageId)
  const existingKeys = new Set(
    (existingInvoices || []).map((inv) => inv.source)
  )

  let queued = 0
  const errors: string[] = []

  for (const attachment of attachments) {
    // Skip if already processed (dedup by messageId)
    const dedupKey = `gmail:${attachment.messageId}:${attachment.filename}`
    if (existingKeys.has(dedupKey)) continue

    // [BOEK-011] AI classification — only PDFs and images
    if (
      attachment.mimeType !== 'application/pdf' &&
      !attachment.mimeType.startsWith('image/')
    ) {
      continue
    }

    let classification: {
      isInvoice: boolean
      confidence: number
      vendor?: string
      amount?: number
      invoiceDate?: string
      invoiceNumber?: string
      currency?: string
    }

    try {
      classification = await classifyAttachment(attachment.data, attachment.mimeType, attachment.filename)
    } catch {
      errors.push(`Classificatie mislukt: ${attachment.filename}`)
      continue
    }

    // [BOEK-011] Only process if confidence >= 0.6 AND is a real invoice
    if (!classification.isInvoice || classification.confidence < 0.6) continue

    // [BOEK-011] Upload PDF to Supabase Storage
    const fileBuffer = Buffer.from(attachment.data, 'base64')
    const storagePath = `${user.id}/${new Date().getFullYear()}/incoming/${Date.now()}_${attachment.filename}`

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: attachment.mimeType,
        upsert: false,
      })

    if (uploadError) {
      errors.push(`Upload mislukt: ${attachment.filename}`)
      continue
    }

    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath)

    // [BOEK-011] Insert invoice as incoming, pending client confirmation
    const { error: invoiceError } = await supabase.from('invoices').insert({
      sender_id: user.id,
      direction: 'incoming',
      status: 'received', // awaiting client confirmation
      source: dedupKey, // use as dedup key
      client_name: attachment.from,
      invoice_number: classification.invoiceNumber || '',
      invoice_date: classification.invoiceDate || attachment.date,
      total_inc_btw: classification.amount || 0,
      total_ex_btw: classification.amount ? classification.amount / 1.21 : 0,
      btw_amount: classification.amount ? classification.amount - classification.amount / 1.21 : 0,
      pdf_url: publicUrl,
      invoice_type: 'factuur',
    })

    if (!invoiceError) {
      queued++
    }
  }

  return NextResponse.json({
    synced: attachments.length,
    queued,
    errors: errors.length > 0 ? errors : undefined,
  })
}