// src/lib/email-integration.ts
// [BOEK-011] Gmail API helpers + AI classification for incoming invoice pipeline
// All Claude API calls go through @/lib/ai — this file only handles Gmail + orchestration

// ─── OAuth URL builders (used by manual connect flow) ───────────────────────

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
  'profile',
].join(' ')

const OUTLOOK_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
].join(' ')

export function buildGmailOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/gmail`,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export function buildOutlookOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.OUTLOOK_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/outlook`,
    response_type: 'code',
    scope: OUTLOOK_SCOPES,
    state,
  })
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
}

// ─── Token exchange (manual connect flow) ───────────────────────────────────

export async function exchangeGmailCode(
  code: string
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/gmail`,
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange mislukt: ${body}`)
  }

  return res.json()
}

export async function getGmailUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return ''
  const data = await res.json()
  return data.email || ''
}

// ─── Gmail attachment fetcher ────────────────────────────────────────────────

export interface GmailAttachment {
  messageId: string
  filename: string
  mimeType: string
  data: string // base64url encoded
  subject: string
  from: string
  date: string
  size: number
}

/**
 * [BOEK-011] Fetch Gmail messages after syncAfter timestamp
 * Returns only PDF and image attachments — no metadata guessing
 */
export async function fetchGmailAttachments(
  accessToken: string,
  syncAfterMs: number
): Promise<GmailAttachment[]> {
  const afterDate = Math.floor(syncAfterMs / 1000)
  const query = `has:attachment after:${afterDate}`

  // 1. List message IDs
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!listRes.ok) {
    const body = await listRes.text()
    throw new Error(`Gmail list mislukt: ${body}`)
  }

  const listData = await listRes.json()
  const messages: Array<{ id: string }> = listData.messages || []

  const results: GmailAttachment[] = []

  // 2. Fetch each message in parallel (max 10 at a time)
  const chunks = chunkArray(messages, 10)
  for (const chunk of chunks) {
    const fetched = await Promise.all(chunk.map(m => fetchMessageAttachments(m.id, accessToken)))
    results.push(...fetched.flat())
  }

  return results
}

async function fetchMessageAttachments(
  messageId: string,
  accessToken: string
): Promise<GmailAttachment[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) return []

  const msg = await res.json()
  const headers: Array<{ name: string; value: string }> = msg.payload?.headers || []

  const subject = headers.find(h => h.name === 'Subject')?.value || ''
  const from = headers.find(h => h.name === 'From')?.value || ''
  const date = headers.find(h => h.name === 'Date')?.value || ''

  const attachments: GmailAttachment[] = []

  // Recursively find attachment parts
  function walkParts(parts: unknown[]): void {
    if (!Array.isArray(parts)) return
    for (const part of parts) {
      const p = part as {
        mimeType?: string
        filename?: string
        body?: { size?: number; attachmentId?: string; data?: string }
        parts?: unknown[]
      }
      if (p.parts) {
        walkParts(p.parts)
        continue
      }

      const mimeType = p.mimeType || ''
      const filename = p.filename || ''
      const size = p.body?.size || 0

      // Only process PDFs and images
      if (!filename || size === 0) continue
      if (mimeType !== 'application/pdf' && !mimeType.startsWith('image/')) continue

      const attachmentId = p.body?.attachmentId
      const inlineData = p.body?.data

      if (attachmentId) {
        // Will fetch separately — store placeholder with attachmentId
        attachments.push({
          messageId,
          filename,
          mimeType,
          data: attachmentId, // will be replaced below
          subject,
          from,
          date,
          size,
        })
      } else if (inlineData) {
        attachments.push({
          messageId,
          filename,
          mimeType,
          data: inlineData,
          subject,
          from,
          date,
          size,
        })
      }
    }
  }

  walkParts(msg.payload?.parts || [])

  // Fetch actual attachment data for non-inline attachments
  const resolved = await Promise.all(
    attachments.map(async (att) => {
      // If data looks like a base64url string (not an attachmentId), skip
      if (att.data.length > 100 && !att.data.includes('/')) return att

      try {
        const attRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${att.data}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (!attRes.ok) return null
        const attData = await attRes.json()
        return { ...att, data: attData.data } // base64url from Gmail
      } catch {
        return null
      }
    })
  )

  return resolved.filter(Boolean) as GmailAttachment[]
}

// ─── Outlook token exchange ──────────────────────────────────────────────────

// [BOEK-011] exchangeOutlookCode — May 2026
export async function exchangeOutlookCode(
  code: string
): Promise<{ access_token: string; refresh_token: string }> {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    code,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/outlook`,
    grant_type: 'authorization_code',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Outlook token exchange mislukt: ${body}`)
  }

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  }
}

// [BOEK-011] getOutlookUserEmail — May 2026
export async function getOutlookUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return ''
  const data = await res.json()
  return data.mail || data.userPrincipalName || ''
}

// ─── AI Classification ────────────────────────────────────────────────────────

export interface AttachmentClassification {
  isInvoice: boolean
  confidence: number
  vendor?: string
  amount?: number
  invoiceDate?: string
  invoiceNumber?: string
}

/**
 * [BOEK-011] Classify a PDF/image attachment via Claude API
 * Uses verifyInvoiceFromPdf from @/lib/ai — reads actual file content
 * Confidence threshold enforced inside verifyInvoiceFromPdf (0.6)
 */
export async function classifyAttachment(
  base64Data: string,
  mimeType: string,
  filename: string
): Promise<AttachmentClassification> {
  const { verifyInvoiceFromPdf } = await import('@/lib/ai')

  // Convert base64url to base64 if needed (Gmail uses base64url)
  const base64 = base64Data.replace(/-/g, '+').replace(/_/g, '/')

  const result = await verifyInvoiceFromPdf(base64, mimeType, filename)

  return {
    isInvoice: result.is_invoice,
    confidence: result.confidence,
    vendor: result.vendor,
    amount: result.amount,
    invoiceDate: result.invoice_date,
    invoiceNumber: result.invoice_number,
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
// ─── Main sync entry point ────────────────────────────────────────────────────

export type EmailProvider = 'gmail' | 'outlook'

/**
 * [BOEK-011] syncUserEmails — called by /api/email/sync
 *
 * Flow:
 * 1. Get email connection from DB
 * 2. Get profile.created_at as sync boundary — never fetch before registration
 * 3. Fetch attachments after that date
 * 4. Claude reads each PDF/image — real invoice or not
 * 5. Save verified invoices with status='received'
 */
export async function syncUserEmails(userId: string): Promise<{
  provider: EmailProvider
  fetched: number
  verified: number
  saved: number
  errors: number
} | null> {
  const { createServerSupabaseClient } = await import('@/lib/supabase-server')
  const supabase = await createServerSupabaseClient()

  // Get email connection
  const { data: connection } = await supabase
    .from('email_connections')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .single()

  if (!connection) return null

  // [BOEK-011] Sync boundary = registration date
  // Emails before this date = user's responsibility to upload manually
  const { data: profile } = await supabase
    .from('profiles')
    .select('created_at')
    .eq('id', userId)
    .single()

  const syncAfterMs = profile?.created_at
    ? new Date(profile.created_at).getTime()
    : Date.now() // fallback: now — fetches nothing from the past

  // Fetch attachments after registration date
  let attachments: GmailAttachment[] = []
  try {
    if (connection.provider === 'gmail') {
      attachments = await fetchGmailAttachments(connection.access_token, syncAfterMs)
    }
    // Outlook: same pattern — add fetchOutlookAttachments when needed
  } catch (error) {
    console.error('[BOEK-011] Fetch failed:', error)
    return { provider: connection.provider, fetched: 0, verified: 0, saved: 0, errors: 1 }
  }

  let verified = 0
  let saved = 0
  let errors = 0

  for (const attachment of attachments) {
    try {
      // Claude reads the actual file — not metadata
      const classification = await classifyAttachment(
        attachment.data,
        attachment.mimeType,
        attachment.filename
      )

      // Not an invoice → discard, no trace in DB
      if (!classification.isInvoice) continue
      verified++

      // Deduplication — already processed this message?
      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('sender_id', userId)
        .eq('source', 'email')
        .ilike('client_btw_number', `msg:${attachment.messageId}`)
        .limit(1)

      if (existing && existing.length > 0) continue

      // Save as incoming invoice — awaiting client confirmation
      const invoiceDate = classification.invoiceDate
        ? new Date(classification.invoiceDate).toISOString().split('T')[0]
        : new Date(attachment.date).toISOString().split('T')[0]

      const { error: dbError } = await supabase.from('invoices').insert({
        sender_id: userId,
        direction: 'incoming',
        status: 'received',
        source: 'email',
        client_name: classification.vendor || attachment.from,
        client_email: extractEmail(attachment.from),
        invoice_date: invoiceDate,
        invoice_number: classification.invoiceNumber || `EMAIL-${Date.now()}`,
        total_inc_btw: classification.amount || 0,
        total_ex_btw: 0,
        btw_amount: 0,
        // messageId stored for deduplication
        client_btw_number: `msg:${attachment.messageId}`,
      })

      if (dbError) {
        console.error('[BOEK-011] Save error:', dbError.message)
        errors++
      } else {
        saved++
      }
    } catch (error) {
      console.error('[BOEK-011] Processing error:', error)
      errors++
    }
  }

  return {
    provider: connection.provider,
    fetched: attachments.length,
    verified,
    saved,
    errors,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/)
  return match ? match[1] : from.trim()
}