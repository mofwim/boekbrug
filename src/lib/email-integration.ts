// src/lib/email-integration.ts
// [BOEK-011] Gmail API helpers + AI classification for incoming invoice pipeline
// All Claude API calls go through @/lib/ai — this file only handles Gmail + orchestration

// [BOEK-011 + BOEK-SECURITY] OAuth tokens are stored in Supabase Vault,
// never in plaintext columns. The three helpers below are the ONLY way to
// read, write, or delete tokens — never touch access_token / refresh_token
// columns directly (they are NULL since the BOEK-SECURITY migration).
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [BRIDGE-EXTRACT] byte-hash dedup — één bestand → één hash → één record
import { computeContentHash } from '@/lib/content-hash'
import { logAuditAction } from '@/lib/audit'
// [IMPORT-MONITOR Part 0] SAFECORE primitives moved to a shared module so the
// read-time health classifier can reuse the EXACT same logic. Move-only: these
// were defined privately below; behaviour is identical.
import {
  evaluateArithmetic,
  isPlaceholderInvoiceNumber,
  isReliableVendor,
  deriveDueDate,
} from '@/lib/safecore'
// [BOEK-SAFECORE] jsonb column type for invoices.field_confidence — mirrors the
// audit.ts pattern (derive the Json type from generated types, cast at write).
import type { Database } from '@/types/database.types'
type InvoiceFieldConfidence =
  Database['public']['Tables']['invoices']['Insert']['field_confidence']

// ─── Vault-backed token helpers ─────────────────────────────────────────────

/**
 * [BOEK-011 + BOEK-SECURITY] Read tokens for a user from Vault.
 * Returns null when no connection exists or Vault read fails.
 *
 * [BOEK-011] Provider-agnostic: a user has one email connection, and its
 * provider (gmail | outlook) is read from the row — NOT assumed. Passing a
 * `provider` still filters to that provider when needed (e.g. multi-account
 * later), but the default is "whatever connection this user has". This is the
 * fix for Outlook-only accounts: the old default 'gmail' filter returned null
 * for a user whose only connection was Outlook, so sync 404'd.
 */
export async function getEmailTokens(
  userId: string,
  provider?: 'gmail' | 'outlook'
): Promise<{
  accessToken: string
  refreshToken: string
  provider: 'gmail' | 'outlook'
  email: string
  connectionId: string
} | null> {
  const supabase = createPipelineClient()

  let query = supabase
    .from('email_connections')
    .select('id, provider, email, access_token_secret_id, refresh_token_secret_id')
    .eq('user_id', userId)

  // Only constrain by provider when the caller explicitly asked for one.
  if (provider) {
    query = query.eq('provider', provider)
  }

  const { data: conn, error } = await query.maybeSingle()

  if (error) {
    console.error('[BOEK-011] email_connections read failed', { userId, provider, error })
    return null
  }
  if (!conn) return null
  if (!conn.access_token_secret_id || !conn.refresh_token_secret_id) {
    console.error('[BOEK-011] Connection missing Vault secret IDs', { userId, provider })
    return null
  }

  const { data: accessToken, error: accErr } = await supabase.rpc(
    'vault_read_secret',
    { p_secret_id: conn.access_token_secret_id }
  )
  const { data: refreshToken, error: refErr } = await supabase.rpc(
    'vault_read_secret',
    { p_secret_id: conn.refresh_token_secret_id }
  )

  if (accErr || refErr || !accessToken || !refreshToken) {
    console.error('[BOEK-011] Vault read failed', { userId, provider, accErr, refErr })
    return null
  }

  return {
    accessToken: accessToken as string,
    refreshToken: refreshToken as string,
    provider: conn.provider as 'gmail' | 'outlook',
    email: conn.email ?? '',
    connectionId: conn.id,
  }
}

/**
 * [BOEK-011 + BOEK-SECURITY] Write tokens to Vault and upsert the connection.
 * Used by:
 *   - OAuth callbacks (new connection)
 *   - refreshAccessToken (after Google/MS returns a new access_token)
 *
 * Returns { success: false, error } so the caller can show a real message
 * to the user instead of failing silently.
 */
export async function saveEmailTokens(params: {
  userId: string
  provider: 'gmail' | 'outlook'
  email: string
  accessToken: string
  refreshToken: string
}): Promise<{ success: boolean; error?: string }> {
  const { userId, provider, email, accessToken, refreshToken } = params
  const supabase = createPipelineClient()

  // Look up existing secret IDs — if present, vault_update_or_create_secret
  // updates them in place; if null, it creates new ones.
  const { data: existing } = await supabase
    .from('email_connections')
    .select('id, access_token_secret_id, refresh_token_secret_id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  // Unique name per write — required by Vault when creating a new secret.
  // Existing secrets are matched by p_secret_id, so the name is only used
  // for fresh creates. We append a timestamp to avoid name collisions if
  // the row is deleted and recreated quickly.
  const namePrefix = `${existing?.id ?? 'new'}_${Date.now()}`

  const { data: newAccessId, error: accErr } = await supabase.rpc(
    'vault_update_or_create_secret',
    {
      p_secret_id: (existing?.access_token_secret_id ?? null) as unknown as string,
      p_value: accessToken,
      p_name: `oauth_access_${provider}_${namePrefix}`,
    }
  )
  if (accErr || !newAccessId) {
    console.error('[BOEK-011] Vault write failed (access)', { userId, provider, accErr })
    return { success: false, error: accErr?.message ?? 'Vault access write failed' }
  }

  const { data: newRefreshId, error: refErr } = await supabase.rpc(
    'vault_update_or_create_secret',
    {
      p_secret_id: (existing?.refresh_token_secret_id ?? null) as unknown as string,
      p_value: refreshToken,
      p_name: `oauth_refresh_${provider}_${namePrefix}`,
    }
  )
  if (refErr || !newRefreshId) {
    console.error('[BOEK-011] Vault write failed (refresh)', { userId, provider, refErr })
    return { success: false, error: refErr?.message ?? 'Vault refresh write failed' }
  }

  // Upsert by (user_id, provider) — UNIQUE constraint guarantees one row.
  // [BOEK-011 + BOEK-SECURITY Step 1h] The plaintext access_token and
  // refresh_token columns have been dropped. Vault secret_ids are the only
  // source of truth — never reference the old columns anywhere in code.
  const { error: upsertErr } = await supabase
    .from('email_connections')
    .upsert(
      {
        user_id: userId,
        provider,
        email,
        access_token_secret_id: newAccessId,
        refresh_token_secret_id: newRefreshId,
        tokens_encrypted_at: new Date().toISOString(),
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    )

  if (upsertErr) {
    console.error('[BOEK-011] email_connections upsert failed', { userId, provider, upsertErr })
    return { success: false, error: upsertErr.message }
  }

  return { success: true }
}

/**
 * [BOEK-011 + BOEK-SECURITY] Disconnect: delete Vault secrets, then the row.
 * Replaces the previous "DELETE FROM email_connections" which left orphan
 * secrets in Vault forever.
 */
export async function deleteEmailConnection(
  userId: string,
  provider: 'gmail' | 'outlook' = 'gmail'
): Promise<{ success: boolean }> {
  const supabase = createPipelineClient()

  const { data: conn } = await supabase
    .from('email_connections')
    .select('access_token_secret_id, refresh_token_secret_id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  // Best-effort Vault cleanup — log but never block the row delete.
  // A failed delete here leaves an orphan secret, not a security hole;
  // a failed row delete leaves the user "still connected", which is worse.
  if (conn?.access_token_secret_id) {
    const { error } = await supabase.rpc('vault_delete_secret', {
      p_secret_id: conn.access_token_secret_id,
    })
    if (error) console.warn('[BOEK-011] Vault delete failed (access)', error)
  }
  if (conn?.refresh_token_secret_id) {
    const { error } = await supabase.rpc('vault_delete_secret', {
      p_secret_id: conn.refresh_token_secret_id,
    })
    if (error) console.warn('[BOEK-011] Vault delete failed (refresh)', error)
  }

  const { error } = await supabase
    .from('email_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)

  if (error) {
    console.error('[BOEK-011] email_connections delete failed', { userId, provider, error })
    return { success: false }
  }
  return { success: true }
}

/**
 * [BOEK-011] Refresh access_token via the provider's OAuth endpoint.
 * Saves the new access_token (and refresh_token if returned) back to Vault.
 * Returns the new access_token, or null on failure.
 */
async function refreshAccessToken(userId: string): Promise<string | null> {
  const tokens = await getEmailTokens(userId)
  if (!tokens) {
    console.error('[BOEK-011] refreshAccessToken: no tokens to refresh', { userId })
    return null
  }

  const isGmail = tokens.provider === 'gmail'
  const endpoint = isGmail
    ? 'https://oauth2.googleapis.com/token'
    : 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

  const clientId = isGmail
    ? process.env.GOOGLE_CLIENT_ID
    : process.env.MICROSOFT_CLIENT_ID
  const clientSecret = isGmail
    ? process.env.GOOGLE_CLIENT_SECRET
    : process.env.MICROSOFT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('[BOEK-011] Missing OAuth client credentials', { provider: tokens.provider })
    return null
  }

  let refreshData: { access_token?: string; refresh_token?: string }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error('[BOEK-011] Refresh HTTP error', {
        userId,
        provider: tokens.provider,
        status: response.status,
        body: errBody,
      })
      return null
    }
    refreshData = await response.json()
  } catch (err) {
    console.error('[BOEK-011] Refresh network error', { userId, err })
    return null
  }

  if (!refreshData.access_token) {
    console.error('[BOEK-011] Refresh returned no access_token', { userId, refreshData })
    return null
  }

  // Providers usually return only access_token — keep the old refresh_token
  // unless they explicitly issued a new one (Google rotates rarely, MS more often).
  const result = await saveEmailTokens({
    userId,
    provider: tokens.provider,
    email: tokens.email,
    accessToken: refreshData.access_token,
    refreshToken: refreshData.refresh_token ?? tokens.refreshToken,
  })

  if (!result.success) {
    console.error('[BOEK-011] Failed to persist refreshed tokens', result.error)
    return null
  }

  return refreshData.access_token
}

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
    client_id: process.env.MICROSOFT_CLIENT_ID!,
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

  // [BOEK-011] Intermediate shape — explicit flag, no guessing by string length
  interface PendingAttachment {
    filename: string
    mimeType: string
    size: number
    // Exactly one of these is set:
    attachmentId?: string  // needs a second fetch
    inlineData?: string    // base64url already present
  }

  const pending: PendingAttachment[] = []

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

      // [BOEK-011 PERF] Same signature/logo pre-filter as Outlook. Gmail's
      // has:attachment already hides most inline images, so this rarely fires
      // here — but keeping both paths identical means consistent behaviour and
      // no surprise if Gmail starts surfacing inline parts.
      if (!isLikelyInvoiceCandidate({ filename, mimeType, size })) continue

      // [BOEK-011] Store with explicit flag — never confuse ID with data
      if (p.body?.attachmentId) {
        pending.push({ filename, mimeType, size, attachmentId: p.body.attachmentId })
      } else if (p.body?.data) {
        pending.push({ filename, mimeType, size, inlineData: p.body.data })
      }
    }
  }

  walkParts(msg.payload?.parts || [])

  // [BOEK-011] Resolve each attachment — fetch by ID or use inline data
  // Gmail always returns base64url → convert to standard base64 exactly once
  const resolved = await Promise.all(
    pending.map(async (att): Promise<GmailAttachment | null> => {
      let base64url: string | undefined

      if (att.attachmentId) {
        // Needs a second fetch to get the actual bytes
        try {
          const attRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${att.attachmentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (!attRes.ok) return null
          const attData = await attRes.json()
          base64url = attData.data as string
        } catch {
          return null
        }
      } else {
        base64url = att.inlineData
      }

      if (!base64url) return null

      // [BOEK-011] base64url → standard base64 — done exactly once, here
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')

      return {
        messageId,
        filename: att.filename,
        mimeType: att.mimeType,
        data: base64,
        subject,
        from,
        date,
        size: att.size,
      }
    })
  )

  return resolved.filter((a): a is GmailAttachment => a !== null)
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

// ─── Outlook attachment fetching (Microsoft Graph) ──────────────────────────

/**
 * [BOEK-011] Fetch Outlook messages after syncAfter timestamp via Microsoft Graph.
 * Returns the SAME GmailAttachment shape as the Gmail path, so the save loop in
 * syncUserEmails is provider-agnostic — no downstream changes needed.
 *
 * Key differences from Gmail (all simpler):
 *  - Graph returns attachment content as `contentBytes` in STANDARD base64,
 *    not base64url. No -/_ → +/ conversion, no padding fix. cleanBase64 in ai.ts
 *    still runs and is a safe no-op on already-standard base64.
 *  - One list call returns messages; attachments come from a per-message call.
 *  - $filter is on receivedDateTime only; hasAttachments is checked in code
 *    (Graph rejects filtering hasAttachments while ordering by date).
 */
export async function fetchOutlookAttachments(
  accessToken: string,
  syncAfterMs: number
): Promise<GmailAttachment[]> {
  // Graph wants an ISO 8601 timestamp for the date filter
  const afterIso = new Date(syncAfterMs).toISOString()

  // 1. List messages received after the boundary — WITH pagination.
  //
  // [BOEK-011] Graph returns pages of $top messages plus @odata.nextLink for
  // the next page. Without following nextLink we only ever saw the newest 50
  // messages (orderby desc) — attachments from earlier in the range (e.g.
  // February–May when SYNC_START_DATE=2026-02-01) never arrived, and every
  // sync surfaced a few "new" invoices as recent mail pushed older ones out
  // of the window. Following nextLink covers the whole range.
  //
  // Safety cap: 10 pages × 50 = 500 messages per sync. A pilot inbox fits
  // comfortably; if a mailbox is larger the next sync continues (dedup skips
  // what's already imported).
  //
  // [BOEK-011] Graph rejects "$filter on hasAttachments + $orderby on
  // receivedDateTime" (InefficientFilter) — filter on the date only, order by
  // the same field, and check hasAttachments in code below.
  const filter = `receivedDateTime ge ${afterIso}`
  const firstUrl =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,subject,from,receivedDateTime,hasAttachments` +
    `&$orderby=receivedDateTime desc` +
    `&$top=50`

  type OutlookMessage = {
    id: string
    subject?: string
    from?: { emailAddress?: { name?: string; address?: string } }
    receivedDateTime?: string
    hasAttachments?: boolean
  }

  const messages: OutlookMessage[] = []
  let nextUrl: string | null = firstUrl
  let page = 0
  const MAX_PAGES = 10

  while (nextUrl && page < MAX_PAGES) {
    const listRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!listRes.ok) {
      const body = await listRes.text()
      // First page failing is a real error; a later page failing shouldn't
      // discard everything we already collected.
      if (page === 0) {
        throw new Error(`Outlook list mislukt: ${body}`)
      }
      console.error('[BOEK-011] Outlook pagination stopped early', { page, body })
      break
    }

    const listData = await listRes.json()
    messages.push(...((listData.value || []) as OutlookMessage[]))
    nextUrl = (listData['@odata.nextLink'] as string | undefined) ?? null
    page++
  }

  const results: GmailAttachment[] = []

  // [BOEK-011] Only messages that actually have attachments — the check moved
  // here from the $filter (see InefficientFilter note above).
  const withAttachments = messages.filter((m) => m.hasAttachments)

  // 2. Fetch attachments per message, in parallel chunks (max 10 at a time)
  const chunks = chunkArray(withAttachments, 10)
  for (const chunk of chunks) {
    const fetched = await Promise.all(
      chunk.map((m) => fetchOutlookMessageAttachments(m, accessToken))
    )
    results.push(...fetched.flat())
  }

  return results
}

async function fetchOutlookMessageAttachments(
  message: {
    id: string
    subject?: string
    from?: { emailAddress?: { name?: string; address?: string } }
    receivedDateTime?: string
    hasAttachments?: boolean
  },
  accessToken: string
): Promise<GmailAttachment[]> {
  const attRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${message.id}/attachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!attRes.ok) return []

  const attData = await attRes.json()
  const attachments: Array<{
    '@odata.type'?: string
    name?: string
    contentType?: string
    size?: number
    contentBytes?: string // standard base64 (fileAttachment only)
  }> = attData.value || []

  // Build the "from" string in the same shape Gmail produces: "Name <email>"
  const fromName = message.from?.emailAddress?.name || ''
  const fromAddr = message.from?.emailAddress?.address || ''
  const from = fromName && fromAddr ? `${fromName} <${fromAddr}>` : (fromAddr || fromName)

  const out: GmailAttachment[] = []

  for (const att of attachments) {
    // Only file attachments carry contentBytes. Inline/item attachments (e.g.
    // embedded emails) have no contentBytes → skip. Same intent as Gmail:
    // PDFs and images only.
    if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue
    if (!att.contentBytes) continue

    const mimeType = att.contentType || ''
    const filename = att.name || ''
    if (!filename) continue
    if (mimeType !== 'application/pdf' && !mimeType.startsWith('image/')) continue

    // [BOEK-011 PERF] Drop signature/logo images before they cost a Claude call.
    // Conservative: PDFs always pass, only tiny/chrome-named images are dropped.
    if (!isLikelyInvoiceCandidate({ filename, mimeType, size: att.size || 0 })) {
      continue
    }

    out.push({
      messageId: message.id,
      filename,
      mimeType,
      data: att.contentBytes, // already standard base64 — no conversion needed
      subject: message.subject || '',
      from,
      date: message.receivedDateTime || new Date().toISOString(),
      size: att.size || 0,
    })
  }

  return out
}

// ─── AI Classification ────────────────────────────────────────────────────────

export interface AttachmentClassification {
  isInvoice: boolean
  confidence: number
  vendor?: string
  amount?: number          // total incl. BTW
  invoiceDate?: string
  invoiceNumber?: string
  // [EXTRACT-DUE-DATE] two raw signals from the AI (never computed by it):
  // an explicit printed due date, and/or a "binnen X dagen" term in days.
  // safecore.deriveDueDate() applies the priority + math at insert time.
  dueDate?: string
  paymentTermDays?: number
  // [BOEK-011] full BTW breakdown — extracted in the same Claude call
  totalExBtw?: number
  btwAmount?: number
  totalIncBtw?: number
  btwRate?: number
  // [PAY-SAFE-EXTRACT] vendor payment details (IBAN to pay + betalingskenmerk)
  vendorIban?: string
  paymentReference?: string
  // [BRIDGE-EXTRACT] per-field AI confidence (vendor/number/date)
  fieldConfidence?: {
    vendor?: number
    invoice_number?: number
    invoice_date?: number
  }
}

/**
 * [BOEK-011] Classify a PDF/image attachment via Claude API
 * Uses verifyInvoiceFromPdf from @/lib/ai — reads actual file content
 * Confidence threshold enforced inside verifyInvoiceFromPdf (0.6)
 */
export async function classifyAttachment(
  base64Data: string,
  mimeType: string,
  filename: string,
  // [BRIDGE-EXTRACT] receiver identity (our company) — passed to the AI so it
  // never returns us as the vendor on an incoming invoice.
  receiverName?: string | null
): Promise<AttachmentClassification> {
  const { verifyInvoiceFromPdf } = await import('@/lib/ai')

  // [BOEK-011] Data is already base64 (converted in fetchMessageAttachments)
  const result = await verifyInvoiceFromPdf(base64Data, mimeType, filename, receiverName)

  return {
    isInvoice: result.is_invoice,
    confidence: result.confidence,
    vendor: result.vendor,
    amount: result.amount,
    invoiceDate: result.invoice_date,
    invoiceNumber: result.invoice_number,
    // [EXTRACT-DUE-DATE] carry the two raw due-date signals through the mapper.
    dueDate: result.due_date,
    paymentTermDays: result.payment_term_days,
    totalExBtw: result.total_ex_btw,
    btwAmount: result.btw_amount,
    totalIncBtw: result.total_inc_btw,
    btwRate: result.btw_rate,
    // [PAY-SAFE-EXTRACT] vendor payment details from the same Claude call
    vendorIban: result.vendor_iban,
    paymentReference: result.payment_reference,
    fieldConfidence: result.field_confidence,
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

/**
 * [BOEK-011 PERF] Pre-Claude filter — reject things that are obviously NOT
 * invoices before they cost an AI call (~2s each) and a skip-registry row.
 *
 * WHY Outlook is slower than Gmail was: Gmail's `has:attachment` server filter
 * returned only messages with real attachments, and inline signature images are
 * usually not surfaced as attachments. Outlook/Graph returns EVERY file part —
 * so a single email is "logo.png + signature.png + invoice.pdf" = 3 attachments,
 * and all 3 were going to Claude. Result: 103 attachments where ~50 were tiny
 * signature/logo images. That's the slowness — attachment COUNT, not per-call speed.
 *
 * ── DESIGN RULE (financial app): FALSE-DROP is catastrophic, false-keep is cheap.
 * Dropping a real invoice = a missing number in a tax return, silently. A wasted
 * Claude call = a few cents and 2 seconds. So EVERY heuristic here is tuned to
 * only drop things that are almost certainly email chrome, and to let anything
 * ambiguous through to Claude. Reviewed cases that MUST still pass:
 *   · Any PDF — never size/name filtered. A valid invoice PDF can be 8 KB.
 *   · A vendor literally named "Iconic Foods" / "Banner Print" / "LogoMakers" —
 *     their invoice image must NOT be dropped just because the vendor name
 *     contains 'icon'/'banner'/'logo'. → patterns are ANCHORED to the whole
 *     filename, not substring-matched anywhere in it.
 *   · A small/compressed receipt photo (thermal, B/W) — the size threshold is
 *     kept very low (12 KB) so a legible one-page receipt still passes.
 *
 * Returns true = keep (send to Claude). false = drop (not even worth an AI call).
 */
export function isLikelyInvoiceCandidate(att: {
  filename: string
  mimeType: string
  size: number
}): boolean {
  // PDFs always go through — the strongest invoice signal, never size/name filtered.
  if (att.mimeType === 'application/pdf') return true

  // Non-image, non-pdf shouldn't reach here (fetchers already filter), but be safe.
  if (!att.mimeType.startsWith('image/')) return false

  // From here: it's an image. Apply the cheap signature/logo heuristics.
  const name = att.filename.toLowerCase().trim()

  // Tiny images are signatures / logos / tracking pixels — never an invoice scan.
  // 12 KB: deliberately very low. A legible one-page receipt photo — even a
  // compressed thermal/B&W scan — is comfortably larger. We'd rather send a
  // borderline 15 KB image to Claude than risk dropping a real small receipt.
  // (size===0 means "unknown" from the provider → do NOT size-filter → passes.)
  const TINY_IMAGE_BYTES = 12 * 1024
  if (att.size > 0 && att.size < TINY_IMAGE_BYTES) return false

  // Auto-generated inline-image names from mail clients — email chrome.
  //
  // 🔴 ANCHORED, not substring. Each pattern matches the ENTIRE filename (^…$),
  // so a vendor invoice named "iconic-foods-factuur.png" is NOT caught by the
  // 'icon' rule, and "banner-print-invoice.png" is NOT caught by 'banner'.
  // Only files whose WHOLE name is the chrome pattern are dropped.
  const base = name.replace(/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i, '')
  const chromeExactPatterns = [
    /^image\d{3,}$/,        // image001, image017  (Outlook inline)
    /^att\d{5,}$/,          // ATT00001            (Apple Mail / forwards)
    /^oledata$/,            // oledata.mso
    /^logo$/,               // exactly "logo.png"
    /^logo[-_]?\d*$/,       // logo, logo1, logo_2
    /^signature$/,          // exactly "signature.png"
    /^signature[-_]?\d*$/,  // signature, signature-1
    /^sig$/,                // "sig.png"
    /^icon$/,               // exactly "icon.png"
    /^banner$/,             // exactly "banner.png"
    /^footer$/,             // signature footers
    /^header$/,             // letterhead headers (image, not the invoice)
    /^spacer$/,             // layout spacers
    /^pixel$/,              // tracking pixels
  ]
  if (chromeExactPatterns.some((re) => re.test(base))) return false

  // Unsure → keep. A larger, normally-named image could be a photographed
  // invoice; we let Claude be the judge. Better a wasted AI call than a lost
  // invoice.
  return true
}

// ─── [IMPORT-MONITOR Part 0] SAFECORE primitives moved to src/lib/safecore.ts ──
//
// evaluateArithmetic / ArithmeticVerdict (Rule 1 — arithmetic safety) and the
// SAFECORE-GAP dedup helpers (isPlaceholderInvoiceNumber / normalizeVendor /
// isReliableVendor) previously lived here as private functions. They are now
// imported from @/lib/safecore (move-only, identical behaviour) so the
// read-time import-health classifier can reuse the exact same logic.


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
  remaining: number
  skipped: number
} | null> {
  const { createServerSupabaseClient } = await import('@/lib/supabase-server')
  const supabase = await createServerSupabaseClient()

  // [BOEK-011 + BOEK-SECURITY] Load tokens via Vault. We still need a few
  // fields from email_connections directly (provider) — getEmailTokens
  // returns them so we don't have to query twice.
  const tokens = await getEmailTokens(userId)
  if (!tokens) {
    // No connection at all, or Vault read failed. Either way: nothing to sync.
    return null
  }

  // [BOEK-011] Sync boundary = registration date
  // Emails before this date = user's responsibility to upload manually
  // [BRIDGE-EXTRACT] also grab the receiver identity (our company name) so the
  // AI never returns us as the vendor on incoming invoices.
  const { data: profile } = await supabase
    .from('profiles')
    .select('created_at, company_name, full_name')
    .eq('id', userId)
    .single()

  const receiverName = profile?.company_name || profile?.full_name || null

  // [BOEK-011] Sync start boundary.
  //
  // TESTING: set SYNC_START_DATE (e.g. "2026-02-01") in the environment to
  // pull invoices from a fixed date regardless of when the user registered.
  // Used now so the pilot (Kiwi) imports real historical invoices.
  //
  // PRODUCTION: leave SYNC_START_DATE unset → the boundary is the user's
  // registration date (profile.created_at). Emails before signup are the
  // user's responsibility to upload manually. Deleting the env var reverts
  // to this behaviour with no code change.
  const syncAfterMs = process.env.SYNC_START_DATE
    ? new Date(process.env.SYNC_START_DATE).getTime()
    : profile?.created_at
      ? new Date(profile.created_at).getTime()
      : Date.now() // fallback: now — fetches nothing from the past

  // [BOEK-011] Refresh access_token before every sync — they expire after 1h.
  // refreshAccessToken reads from Vault, hits the provider, writes back to Vault.
  // On failure (revoked grant, expired refresh_token, network) → null → abort.
  const accessToken = await refreshAccessToken(userId)
  if (!accessToken) {
    console.error('[BOEK-011] Could not obtain a fresh access_token', { userId })
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, errors: 1, remaining: 0, skipped: 0 }
  }

  // Fetch attachments after registration date
  let attachments: GmailAttachment[] = []
  try {
    if (tokens.provider === 'gmail') {
      attachments = await fetchGmailAttachments(accessToken, syncAfterMs)
    } else if (tokens.provider === 'outlook') {
      // [BOEK-011] Outlook via Microsoft Graph — same GmailAttachment shape,
      // so the save loop below is unchanged and provider-agnostic.
      attachments = await fetchOutlookAttachments(accessToken, syncAfterMs)
    }
  } catch (error) {
    console.error('[BOEK-011] Fetch failed:', error)
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, errors: 1, remaining: 0, skipped: 0 }
  }

  let verified = 0
  let saved = 0
  let errors = 0
  // [BOEK-011] Non-invoice attachments registered this run. Counts as PROGRESS
  // for the client's auto-continue loop: a batch of pure logos saves 0 invoices
  // but still moves the backlog forward (those attachments won't be re-scanned).
  let skipped = 0
  // [BOEK-SAFECORE] Rule 1 — count of invoices HELD in 'processing' for an
  // arithmetic problem (subset of `saved`; they exist but aren't shared yet).
  let held = 0

  // [BOEK-011] resolveImportTarget owned by BOEK-033 — places file in correct folder
  const { resolveImportTarget } = await import('@/lib/bestanden')

  // [BOEK-011] Two-phase processing to optimize duration without race conditions.
  //
  // PHASE 1 — AI classification in parallel (the slow part: ~2s × N → ~2s total).
  // Anthropic accepts well over 3 concurrent calls per account, but we cap at 3
  // to stay polite and avoid rate-limit surprises during big syncs.
  //
  // PHASE 2 — Save loop runs sequentially over the classified results.
  // Sequential is critical here: dedup queries the DB after every insert, so
  // two attachments with the same content would both pass dedup if processed
  // in parallel ("nothing exists yet"). Keep sequential, keep correctness.
  //
  // Result: total time drops from ~Σ(AI) + Σ(save) to ~max(AI) + Σ(save).
  // For 14 PDFs: 42s → ~12-15s.

  type Classified = {
    attachment: typeof attachments[number]
    classification: Awaited<ReturnType<typeof classifyAttachment>>
    // [BOEK-011] true = transient error (retry next sync), never registry-skip
    classifyFailed: boolean
  }

  // Mini concurrency limiter — no external dep. Inline so the helper stays
  // self-contained. Caps concurrent promises at `max`.
  async function mapConcurrent<T, R>(
    items: T[],
    max: number,
    fn: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let cursor = 0
    async function worker() {
      while (true) {
        const i = cursor++
        if (i >= items.length) return
        results[i] = await fn(items[i])
      }
    }
    const workers = Array.from({ length: Math.min(max, items.length) }, worker)
    await Promise.all(workers)
    return results
  }

  // ── PHASE 0 — pre-AI dedup + chronological sort ────────────────────────────
  //
  // [BOEK-011 PERF] The dedup key (messageId:filename) is known BEFORE any AI
  // call. Previously Check A ran in the save loop — AFTER classification — so
  // every sync re-sent every attachment to Claude (~2s each) only for dedup to
  // skip it. With pagination now covering the whole date range, a no-op sync
  // cost dozens of wasted Claude calls. One DB query here removes them all:
  // repeat syncs drop from ~40s to ~3s.
  //
  // Check A stays in the save loop too (cheap, belt-and-braces + the DB unique
  // index); Check B (content match) must stay there — it needs AI output.
  const allKeys = attachments.map((a) => `${a.messageId}:${a.filename}`)
  const knownKeys = new Set<string>()
  if (allKeys.length > 0) {
    // Chunk the IN() to stay well under URL/param limits on big backfills.
    for (const keyChunk of chunkArray(allKeys, 100)) {
      const { data: existingRows } = await supabase
        .from('invoices')
        .select('source_message_id')
        .eq('receiver_id', userId)
        .eq('source', 'email')
        .in('source_message_id', keyChunk)
      for (const row of (existingRows ?? []) as Array<{ source_message_id: string | null }>) {
        if (row.source_message_id) knownKeys.add(row.source_message_id)
      }
      // [BOEK-011] Also skip attachments we previously classified as NOT an
      // invoice (logos, signatures, catalogs). Without this registry they left
      // no DB trace → re-classified by Claude on every sync, and a batch full
      // of them made the sync loop spin with zero progress.
      const { data: skippedRows } = await supabase
        .from('email_skipped_attachments')
        .select('source_message_id')
        .eq('user_id', userId)
        .in('source_message_id', keyChunk)
      for (const row of (skippedRows ?? []) as Array<{ source_message_id: string | null }>) {
        if (row.source_message_id) knownKeys.add(row.source_message_id)
      }
    }
  }

  const freshAll = attachments
    .filter((a) => !knownKeys.has(`${a.messageId}:${a.filename}`))
    // [BOEK-011] Oldest email first → save order (created_at) follows real
    // chronology, so lists sorted on created_at read naturally. Graph returns
    // newest-first; Gmail is unordered — this sort normalizes both providers.
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // [BOEK-011] Batch cap — at most 25 NEW classifications per sync.
  // A 63-invoice backfill costs ~4 min (AI + storage + sequential save) and
  // flirts with the 5-minute function ceiling. Capping keeps every sync
  // comfortably inside the limit; because PHASE 0 skips everything already
  // saved, pressing sync again simply continues where the last run stopped
  // (oldest-first, so chronology is preserved across batches).
  const SYNC_BATCH_MAX = 25
  const freshAttachments = freshAll.slice(0, SYNC_BATCH_MAX)
  const remainingAfterBatch = freshAll.length - freshAttachments.length

  console.log('[BOEK-011] Sync scope', {
    fetched: attachments.length,
    alreadyImported: knownKeys.size,
    newTotal: freshAll.length,
    thisBatch: freshAttachments.length,
    remainingForNextSync: remainingAfterBatch,
  })

  // PHASE 1 — classify only NEW attachments in parallel (max 3 in flight)
  const classified: Classified[] = await mapConcurrent(
    freshAttachments,
    3,
    async (attachment) => {
      try {
        const classification = await classifyAttachment(
          attachment.data,
          attachment.mimeType,
          attachment.filename,
          receiverName
        )
        return { attachment, classification, classifyFailed: false }
      } catch (err) {
        console.error('[BOEK-011] Classification error', { filename: attachment.filename, err })
        // [BOEK-011] Transient failure (rate limit, network) — NOT a verdict.
        // classifyFailed=true tells PHASE 2 to skip WITHOUT registering in the
        // skip registry, so the attachment is retried on the next sync. Only a
        // genuine Claude "not an invoice" verdict may be registered permanently.
        return {
          attachment,
          classification: { isInvoice: false } as Awaited<ReturnType<typeof classifyAttachment>>,
          classifyFailed: true,
        }
      }
    }
  )

  // PHASE 2 — save loop, sequential by design (dedup correctness)
  for (const { attachment, classification, classifyFailed } of classified) {
    try {
      // Transient classification failure (rate limit / network) → skip WITHOUT
      // registering; the next sync retries it. A real invoice must never be
      // permanently skipped because of one bad network moment.
      if (classifyFailed) {
        errors++
        continue
      }

      // Not an invoice → record in the skip registry, then discard.
      // [BOEK-011] The registry entry is what stops this attachment from being
      // re-sent to Claude on every future sync (PHASE 0 reads it). Idempotent:
      // the unique index makes a repeat insert a harmless conflict.
      if (!classification.isInvoice) {
        const skipPipeline = createPipelineClient()
        await skipPipeline
          .from('email_skipped_attachments')
          .upsert(
            {
              user_id: userId,
              source_message_id: `${attachment.messageId}:${attachment.filename}`,
              filename: attachment.filename,
              reason: 'not_invoice',
            },
            { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
          )
        skipped++
        continue
      }
      verified++

      // [BRIDGE-EXTRACT] Check 0 (PRIMARY) — byte-hash dedup.
      // Deterministic: identical bytes → identical hash, regardless of how the
      // AI named the vendor (Atapack vs Atapacks) or which email carried it.
      // Cross-path: catches the same file from manual upload / Mijn bestanden too.
      // Runs BEFORE Storage and BOTH inserts → a rejected duplicate never creates
      // an orphan invoice. Checks A/B below remain as a secondary net.
      const fileBuffer = Buffer.from(attachment.data, 'base64')
      const contentHash = computeContentHash(fileBuffer)

      const { data: existingByHash } = await supabase
        .from('documents')
        .select('id')
        .eq('user_id', userId)
        .eq('content_hash', contentHash)
        .limit(1)
        .maybeSingle()

      if (existingByHash) {
        await logAuditAction({
          userId,
          action: 'document.duplicate_blocked',
          entityType: 'document',
          entityId: existingByHash.id,
          newValue: { file_name: attachment.filename, content_hash: contentHash, path: 'email' },
        })
        continue
      }

      // [BOEK-011] Deduplication — two checks before saving.
      //
      // Check A: same messageId + filename → same attachment seen before.
      //   Catches re-syncs of the same email.
      //
      // Check B: same invoice_number + total → same invoice arrived in a
      //   different email (forward, reminder, vendor re-sent). Different
      //   messageId, so Check A misses it. Without this, we get duplicates
      //   like ZIZZGFPN-0001 ×2, 26302362 ×2 etc.
      //
      // Both checks query receiver_id (not sender_id) — incoming invoices
      // have sender_id = null since the architectural fix.
      const dedupKey = `${attachment.messageId}:${attachment.filename}`

      const { data: existingByMessage } = await supabase
        .from('invoices')
        .select('id')
        .eq('receiver_id', userId)
        .eq('source', 'email')
        .eq('source_message_id', dedupKey)
        .limit(1)

      if (existingByMessage && existingByMessage.length > 0) continue

      // ── [BOEK-SAFECORE] Rule 2 — semantic idempotency (no double financial effect) ──
      //
      // Check B catches the SAME invoice arriving as a DIFFERENT file (vendor
      // re-sent, forward, reminder, regenerated PDF). Byte-hash (Check 0) misses
      // these — different bytes → different hash. So this is the financial-truth
      // net that prevents paying the same invoice twice.
      //
      // [SAFECORE-GAP] The key is now PLACEHOLDER-AWARE and GRADED:
      //
      //   1. Real invoice number → key = invoice_number + total (+ date if real).
      //      WIDE catch is safe here: the number is the precision ANCHOR, so a
      //      false positive is rare. (vendor NOT in key — a duplicate must be
      //      caught even when the vendor name differs; Silifke≡OZ&ER → ALIAS.)
      //
      //   2. Placeholder number (UPLOAD-/EMAIL-<ts>, or empty) → the number is
      //      junk (unique per arrival), so we DON'T trust it. Fall back to the
      //      next anchor:
      //        a. RELIABLE vendor → key = vendor_normalized + total + date.
      //        b. UNRELIABLE vendor (empty / "Onbekende afzender") → mark
      //           un-dedupable + log; do NOT match on total+date alone. Without a
      //           number AND without a reliable vendor, total+date is too loose —
      //           it could BLOCK a legitimate invoice (a missing crediteur at the
      //           accountant = its own financial-truth error). So we stop honestly
      //           and let the human review (the invoice is held in the queue).
      //
      // 🔴 ASYMMETRY NOTE: "wide catch is safe" held ONLY because the number was
      // the precision anchor. With the number gone, going wider (total+date) is
      // DANGEROUS, not safer — it can block a real invoice. So the no-number path
      // is deliberately CONSERVATIVE: reliable vendor or nothing.
      //
      // 🔴 KNOWN LIMITS (named, not hidden):
      //   · No stored vendor KvK/BTW → vendor anchor is name-only; "same vendor,
      //     different name" stays a gap → BRIDGE-ALIAS.
      //   · Automated semantic fallback is EMAIL-path only. The upload path has
      //     byte-hash + human review (it writes 'processing'); a shared dedup
      //     function for both paths is deferred (Option B) until real data shows
      //     it recurring.
      //
      // Cross-path on email: scoped to receiver_id + direction='incoming' (not
      // source='email'), so an email copy of a manually-uploaded invoice matches.

      // [SAFECORE-GAP] carried to the insert when we cannot dedup an invoice —
      // recorded in field_confidence._safecore for the audit trail / human review.
      let dedupNote: { dedup: string; reason: string } | null = null

      if (typeof classification.totalIncBtw === 'number') {
        const numberIsReal = !isPlaceholderInvoiceNumber(classification.invoiceNumber)

        // Real date (AI-extracted), used as an extra filter when available.
        const hasRealDate =
          typeof classification.invoiceDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(classification.invoiceDate)
        const realDateIso = hasRealDate
          ? new Date(classification.invoiceDate as string).toISOString().split('T')[0]
          : null

        // Decide the key tier.
        type DedupTier =
          | { kind: 'number' }
          | { kind: 'vendor' }
          | { kind: 'none'; reason: string }
        let tier: DedupTier

        if (numberIsReal) {
          tier = { kind: 'number' }
        } else if (isReliableVendor(classification.vendor)) {
          tier = { kind: 'vendor' }
        } else {
          tier = {
            kind: 'none',
            reason:
              'geen betrouwbaar factuurnummer en geen betrouwbare afzender — duplicaatcontrole niet mogelijk',
          }
        }

        if (tier.kind === 'none') {
          // Un-dedupable: do NOT run a loose total+date match (would risk
          // blocking a legitimate invoice). Record it; the human reviews it in
          // the verify queue. Non-fatal audit.
          dedupNote = { dedup: 'un-dedupable', reason: tier.reason }
          await logAuditAction({
            userId,
            action: 'invoice.duplicated',
            entityType: 'invoice',
            entityId: undefined,
            newValue: {
              reason: 'un_dedupable',
              detail: tier.reason,
              invoice_number: classification.invoiceNumber ?? null,
              total_inc_btw: classification.totalIncBtw,
              rejected_vendor: classification.vendor ?? null,
              message_id: dedupKey,
            },
          })
          console.log('[SAFECORE-GAP] Invoice un-dedupable — held for human review', {
            totalIncBtw: classification.totalIncBtw,
            messageId: dedupKey,
          })
          // Fall through to insert — we do NOT skip a possibly-real invoice.
        } else {
          // Build the query for the chosen anchor (number or vendor).
          let contentQuery = supabase
            .from('invoices')
            .select('id, source_message_id, invoice_date, client_name, invoice_number')
            .eq('receiver_id', userId)
            .eq('direction', 'incoming')
            .eq('total_inc_btw', classification.totalIncBtw)

          if (tier.kind === 'number') {
            contentQuery = contentQuery.eq('invoice_number', classification.invoiceNumber as string)
          } else {
            // vendor tier: client_name on an incoming invoice IS the vendor.
            // ilike handles case-insensitivity; we pass the RAW (trimmed) vendor
            // so we don't fight the stored formatting. 🔴 Limit: ilike is exact
            // apart from case — it does NOT collapse internal whitespace, so
            // "Atapack  B.V." (two spaces) won't match "Atapack B.V." (one).
            // Full normalization needs a DB function; deferred (this is the rare
            // placeholder+reliable-vendor fallback). The date filter below adds
            // the precision that makes this acceptable. Stronger vendor matching
            // is BRIDGE-ALIAS territory.
            contentQuery = contentQuery.ilike('client_name', (classification.vendor ?? '').trim())
          }

          // Date filter: applied when we have a real date. For the vendor tier
          // it's especially valuable (tightens a looser key). For the number
          // tier it's an extra precision filter (number already anchors).
          if (realDateIso) {
            contentQuery = contentQuery.eq('invoice_date', realDateIso)
          }

          const { data: existingByContent } = await contentQuery.limit(1)

          if (existingByContent && existingByContent.length > 0) {
            const original = existingByContent[0]

            // [BOEK-SAFECORE] Audit the blocked duplicate — truth in the log,
            // silence in the UI. entityId = the ORIGINAL (the duplicate is never
            // created); newValue carries the REJECTED candidate. Non-fatal.
            await logAuditAction({
              userId,
              action: 'invoice.duplicated',
              entityType: 'invoice',
              entityId: original.id,
              newValue: {
                reason: 'semantic_duplicate_blocked',
                matched_on: tier.kind, // 'number' | 'vendor'
                invoice_number: classification.invoiceNumber ?? null,
                total_inc_btw: classification.totalIncBtw,
                rejected_vendor: classification.vendor ?? null,
                rejected_message_id: dedupKey,
                original_message_id: original.source_message_id ?? null,
                date_matched: Boolean(realDateIso),
              },
            })

            console.log('[BOEK-SAFECORE] Skipping semantic duplicate', {
              matchedOn: tier.kind,
              totalIncBtw: classification.totalIncBtw,
              dateMatched: Boolean(realDateIso),
              existingMessageId: original.source_message_id,
              newMessageId: dedupKey,
            })
            continue
          }
        }
      }

      const invoiceDate = classification.invoiceDate
        ? new Date(classification.invoiceDate).toISOString().split('T')[0]
        : new Date(attachment.date).toISOString().split('T')[0]

      // [BOEK-011] Step 1: store the PDF/image in Supabase Storage
      let documentId: string | null = null
      let pdfUrl: string | null = null

      try {
        // [BRIDGE-EXTRACT] fileBuffer already computed above for the byte-hash gate
        const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`

        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, fileBuffer, {
            contentType: attachment.mimeType,
            upsert: false,
          })

        if (!uploadErr) {
          // [BOEK-011] Resolve the correct folder via BOEK-033's function
          // ctx='pipeline' — background job, service_role, no user session
          // Never returns null — falls back to "Geïmporteerde bestanden"
          const folderId = await resolveImportTarget(
            userId,
            classification.invoiceDate ?? null,
            'facturen',
            'pipeline'
          )

          // [BOEK-011] Step 2: create the documents record with correct folder_id
          const { data: doc } = await supabase
            .from('documents')
            .insert({
              user_id: userId,
              file_name: attachment.filename,
              file_url: storagePath,
              file_size: fileBuffer.length,
              file_type: attachment.mimeType,
              doc_type: 'factuur',
              folder_id: folderId,
              year: new Date(invoiceDate).getFullYear(),
              source: 'email',
              ai_processed: true,
              ai_doc_type: 'invoice',
              content_hash: contentHash,         // [BRIDGE-EXTRACT] byte-hash for cross-path dedup
            })
            .select('id')
            .single()

          documentId = doc?.id ?? null
          pdfUrl = storagePath
        } else {
          console.error('[BOEK-011] Storage upload failed:', uploadErr.message)
        }
      } catch (storageError) {
        console.error('[BOEK-011] Storage error:', storageError)
        // Continue — invoice record is still saved without the file
      }

      // [BOEK-011] Step 3: save the invoice with full AI-extracted breakdown.
      //
      // CRITICAL: incoming invoices use receiver_id, NOT sender_id.
      //   - The user RECEIVES this invoice → receiver_id = userId
      //   - The vendor SENDS it but isn't a BoekBrug user → sender_id = null
      //
      // useInfiniteInvoices queries `.eq('sender_id', userId)` for "Mijn facturen"
      // (outgoing). If we put userId in sender_id here, incoming invoices would
      // appear there as if the user created them. They also wouldn't appear in
      // /dashboard/incoming, which queries `.eq('receiver_id', userId)`.
      // [BOEK-011 + BOEK-SECURITY] Invoice insert MUST use service_role.
      //
      // The invoices_zzp_insert RLS policy has WITH CHECK (sender_id = auth.uid()).
      // Incoming invoices have sender_id = NULL (vendor isn't a BoekBrug user),
      // so the user client fails with 403 — silently leaving an orphan document.
      //
      // Email sync is a pipeline operation by design (background job, AI-driven,
      // no direct user action) — exactly the case service_role exists for.

      // ── [BOEK-SAFECORE] Rule 1 — arithmetic gate, computed BEFORE insert ──
      // A bad invoice is HELD in 'processing' (verify queue, excluded from
      // `shared`) instead of going straight to 'received' → shared → accountant.
      // The reason is MERGED into field_confidence (never overwriting the AI's
      // per-field confidence) under a _safecore key.
      const verdict = evaluateArithmetic(classification)

      // Merge, don't overwrite: keep the AI's fieldConfidence, add _safecore
      // only when held. When there's nothing at all, keep null (parity with the
      // pre-SAFECORE behaviour for clean invoices — no empty {} churn).
      const aiConfidence = classification.fieldConfidence ?? null
      let fieldConfidenceValue: Record<string, unknown> | null = aiConfidence
      // [SAFECORE-GAP] _safecore also carries the dedup note (un-dedupable) so
      // the audit/human-review trail records WHY this invoice skipped dedup.
      if (!verdict.ok || dedupNote) {
        const safecore: Record<string, unknown> = {}
        if (!verdict.ok) {
          safecore.arithmetic_ok = false
          safecore.reason = verdict.reason
          safecore.flags = verdict.flags
          safecore.held_at = new Date().toISOString()
        }
        if (dedupNote) {
          safecore.dedup = dedupNote.dedup
          safecore.dedup_reason = dedupNote.reason
        }
        fieldConfidenceValue = {
          ...(aiConfidence ?? {}),
          _safecore: safecore,
        }
      }

      // [BOEK-011] ALL email imports enter the verify queue ('processing') —
      // the user reviews and confirms in /dashboard/incoming, and only then
      // does the invoice become a Crediteur ('received' → /incoming/manage).
      // This matches the intake (camera/upload) path and M's confirmed design:
      // import → queue → human confirm → Crediteuren. Previously only
      // SAFECORE-held invoices were queued (verdict.ok skipped straight to
      // 'received'), which made email invoices bypass confirmation entirely.
      // The _safecore hold data above is still recorded for problem invoices —
      // the queue's health badge uses it to flag which ones need extra care.
      const invoiceStatus = 'processing'

      const insertPipeline = createPipelineClient()
      const { data: insertedInvoice, error: dbError } = await insertPipeline
        .from('invoices')
        .insert({
          sender_id: null,
          receiver_id: userId,
          direction: 'incoming',
          status: invoiceStatus,
          source: 'email',
          client_name: classification.vendor || extractSenderName(attachment.from),
          client_email: extractEmail(attachment.from),
          invoice_date: invoiceDate,
          // [EXTRACT-DUE-DATE] explicit due date → invoice_date + term → null.
          // Same single source of truth (safecore) as the intake path.
          due_date: deriveDueDate(
            invoiceDate,
            classification.dueDate ?? null,
            classification.paymentTermDays ?? null
          ),
          invoice_number: classification.invoiceNumber || `EMAIL-${Date.now()}`,
          total_ex_btw: classification.totalExBtw ?? 0,
          btw_amount: classification.btwAmount ?? 0,
          total_inc_btw: classification.totalIncBtw ?? classification.amount ?? 0,
          pdf_url: pdfUrl,
          document_id: documentId,
          source_message_id: dedupKey,
          // [PAY-SAFE-EXTRACT] vendor payment details — null when the AI didn't
          // find them (prepares a future payment; never processes money).
          vendor_iban: classification.vendorIban ?? null,
          payment_reference: classification.paymentReference ?? null,
          // [BRIDGE-EXTRACT] per-field AI confidence + [BOEK-SAFECORE] _safecore
          // hold reason (merged when held; null when nothing to store).
          // Cast to Json — sanitized, JSON-compatible content (same pattern as
          // audit.ts). The jsonb column type is Json | null.
          field_confidence: fieldConfidenceValue as InvoiceFieldConfidence,
        })
        .select('id')
        .single()

      if (dbError) {
        console.error('[BOEK-011] Save error:', dbError.message)
        errors++
      } else {
        saved++

        // [BOEK-SAFECORE] When held for an arithmetic problem, audit it —
        // truth in the log. Non-fatal. (Only on a held invoice; a clean
        // 'received' invoice needs no SAFECORE audit row.)
        if (!verdict.ok && insertedInvoice?.id) {
          held++
          await logAuditAction({
            userId,
            action: 'invoice.arithmetic_blocked',
            entityType: 'invoice',
            entityId: insertedInvoice.id,
            newValue: {
              held_status: 'processing',
              reason: verdict.reason,
              flags: verdict.flags,
              invoice_number: classification.invoiceNumber ?? null,
              total_ex_btw: classification.totalExBtw ?? null,
              btw_amount: classification.btwAmount ?? null,
              total_inc_btw: classification.totalIncBtw ?? classification.amount ?? null,
            },
          })
        }

        // [BOEK-011] Link the document back to the invoice (bidirectional)
        // documents.invoice_id ↔ invoices.document_id
        // documents has its own RLS that allows the owner — but pipeline is
        // simpler/safer here since we're already in service_role context.
        if (documentId && insertedInvoice?.id) {
          await insertPipeline
            .from('documents')
            .update({ invoice_id: insertedInvoice.id })
            .eq('id', documentId)
        }
      }
    } catch (error) {
      console.error('[BOEK-011] Processing error:', error)
      errors++
    }
  }

  // [BOEK-011 + BOEK-SECURITY Phase 2.5] Notify the user about imported invoices.
  // After Phase 2.5 cleanup, notifications has no INSERT policy for the
  // authenticated context — any user-client insert returns 403. All notification
  // writes must go through service_role (createPipelineClient). The user client
  // (`supabase`) stays for reads where RLS is the right boundary.
  if (saved > 0) {
    const pipeline = createPipelineClient()
    // [BOEK-011] Provider-aware copy — Outlook users shouldn't read "Gmail".
    const providerLabel = tokens.provider === 'outlook' ? 'Outlook' : 'Gmail'
    // [BOEK-SAFECORE] Honest copy: when some invoices are HELD for review, say
    // so — don't tell the user to confirm payment on an invoice we've flagged
    // as arithmetically wrong. We don't over-claim ("all checked"); we state
    // the concrete situation only.
    const cleanCount = saved - held
    let body: string
    if (held > 0 && cleanCount > 0) {
      body =
        `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald. ` +
        `${held} ${held === 1 ? 'factuur staat' : 'facturen staan'} klaar ter controle ` +
        `(mogelijk een rekenfout). Bevestig de rest.`
    } else if (held > 0 && cleanCount === 0) {
      body =
        `BoekBrug heeft ${held} ${held === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald die ` +
        `${held === 1 ? 'controle nodig heeft' : 'controle nodig hebben'} (mogelijk een rekenfout).`
    } else {
      body = `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald. Bevestig ze in Inkomend.`
    }

    const { error: notifErr } = await pipeline.from('notifications').insert({
      user_id: userId,
      title: `${saved} nieuwe ${saved === 1 ? 'factuur' : 'facturen'} geïmporteerd`,
      body,
      type: 'invoice',
      read: false,
      link: '/dashboard/incoming',
    })
    if (notifErr) {
      console.error('[BOEK-011] Failed to write notification', notifErr)
      // Non-fatal — the import itself succeeded, the user just won't get a bell.
    }
  }

  return {
    provider: tokens.provider,
    fetched: attachments.length,
    verified,
    saved,
    errors,
    // [BOEK-011] New attachments beyond this batch's cap — the client uses
    // this to auto-continue syncing until the backlog is drained, showing
    // progress instead of silently importing a fraction.
    remaining: remainingAfterBatch,
    // [BOEK-011] Attachments registered as non-invoice this run — the client
    // counts (saved + skipped) as progress, so a pure-logo batch doesn't trip
    // the no-progress guard.
    skipped,
  }
}

function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/)
  return match ? match[1] : from.trim()
}

function extractSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</)
  if (match) return match[1].trim()
  return extractEmail(from)
}