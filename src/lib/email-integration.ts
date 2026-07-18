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
import { escapeLikeValue } from '@/lib/sanitize'
import { logAuditAction } from '@/lib/audit'
// [IMPORT-MONITOR Part 0] SAFECORE primitives moved to a shared module so the
// read-time health classifier can reuse the EXACT same logic. Move-only: these
// were defined privately below; behaviour is identical.
import {
  evaluateArithmetic,
  isPlaceholderInvoiceNumber,
  isReliableVendor,
  normalizeVendor,
  normalizeInvoiceNumber,
  normalizeToIso,
  deriveDueDate,
} from '@/lib/safecore'
import { shouldAutoAdvanceInvoice } from '@/lib/auto-advance'
import { resolveSupplierForImport } from '@/lib/supplier-registry'

// Legal suffixes / entity noise stripped when comparing two vendor names for the
// duplicate check, so "Atapack B.V." ≡ "Atapack" ≡ "atapack  bv". Deliberately small
// and conservative — only universally-safe suffixes, never real name words.
const VENDOR_SUFFIX_NOISE = new Set([
  'bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'bvba', 'holding', 'maatschap', 'inc', 'llc',
])

/** A comparison key for a vendor name: lowercased, legal suffixes + punctuation
 *  stripped, collapsed. Pure. Empty string when there's nothing usable. */
export function vendorCoreKey(name: string | null | undefined): string {
  const tokens = normalizeVendor(name)
    .replace(/\./g, '')          // collapse dotted acronyms first: "b.v." → "bv"
    .replace(/[^a-z0-9\s]/g, ' ') // other punctuation → separator
    .split(/\s+/)
    .filter((t) => t.length > 0 && !VENDOR_SUFFIX_NOISE.has(t))
  return tokens.join(' ')
}

/** True ONLY when both vendors are reliable AND their core keys differ — i.e. these
 *  are genuinely DIFFERENT suppliers (who might each issue the same invoice number for
 *  the same total). When either vendor is unknown/junk we cannot tell them apart, so we
 *  return false (do not treat as different) and let the strong number+total anchor decide.
 *  This lets a duplicate through the exact-string DB filter without missing it, while
 *  still refusing to merge two real different vendors that share a number+total. */
export function vendorsAreDifferent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!isReliableVendor(a) || !isReliableVendor(b)) return false
  return vendorCoreKey(a) !== vendorCoreKey(b)
}
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
    .select('id, provider, email, access_token_secret_id, refresh_token_secret_id, connected_at')
    .eq('user_id', userId)

  // Only constrain by provider when the caller explicitly asked for one.
  if (provider) {
    query = query.eq('provider', provider)
  }

  // [BOEK-011] Robust against MULTIPLE connections. The product model is one
  // ACTIVE connection per user (switching providers replaces the old one — see
  // saveEmailTokens). But a stale row can exist transiently (e.g. a switch that
  // half-completed). maybeSingle() would THROW on >1 row and break sync
  // entirely. Instead we order by connected_at desc and take the newest — the
  // one the user most recently authorised — so sync always works even mid-switch.
  const { data: rows, error } = await query
    .order('connected_at', { ascending: false })
    .limit(1)

  const conn = rows?.[0] ?? null

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

  // [BOEK-011] Single active connection per user. If the user is SWITCHING
  // providers (e.g. connected Gmail in May, now connects Outlook), remove the
  // OTHER provider's connection so sync doesn't straddle two accounts and the
  // watermark stays single. We purge the other provider's Vault secrets first,
  // then delete its row (which also drops its watermark).
  //
  // IMPORTANT: this removes the CONNECTION only. Invoices already imported from
  // the old provider are KEPT — bewaarplicht (7-year retention) forbids deleting
  // financial records, and the user's history must survive a provider switch.
  // This runs AFTER the new provider is safely saved, so a failure here leaves
  // the user connected to the new provider (worst case: a harmless stale row,
  // which getEmailTokens already tolerates by picking the newest).
  {
    const { data: others } = await supabase
      .from('email_connections')
      .select('id, provider, access_token_secret_id, refresh_token_secret_id')
      .eq('user_id', userId)
      .neq('provider', provider)

    for (const other of (others ?? []) as Array<{
      id: string
      provider: string
      access_token_secret_id: string | null
      refresh_token_secret_id: string | null
    }>) {
      if (other.access_token_secret_id) {
        const { error } = await supabase.rpc('vault_delete_secret', {
          p_secret_id: other.access_token_secret_id,
        })
        if (error) console.warn('[BOEK-011] switch: Vault delete failed (access)', error)
      }
      if (other.refresh_token_secret_id) {
        const { error } = await supabase.rpc('vault_delete_secret', {
          p_secret_id: other.refresh_token_secret_id,
        })
        if (error) console.warn('[BOEK-011] switch: Vault delete failed (refresh)', error)
      }
      const { error: delErr } = await supabase
        .from('email_connections')
        .delete()
        .eq('id', other.id)
      if (delErr) {
        console.warn('[BOEK-011] switch: old connection delete failed (non-fatal)', {
          removedProvider: other.provider,
          delErr,
        })
      } else {
        console.log('[BOEK-011] Provider switched', {
          from: other.provider,
          to: provider,
          note: 'old connection removed; imported invoices kept',
        })
      }
    }
  }

  return { success: true }
}

/**
 * [BOEK-011 + BOEK-SECURITY] Disconnect: delete Vault secrets, then the row.
 * Replaces the previous "DELETE FROM email_connections" which left orphan
 * secrets in Vault forever.
 *
 * [BOEK-011 watermark] Deleting the row also deletes last_synced_email_at —
 * so "Ontkoppel + reconnect" is the supported way to force a FULL re-import
 * (e.g. after wiping test data). Dedup makes the re-import harmless.
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
): Promise<{
  attachments: GmailAttachment[]
  complete: boolean
  messageIndex: Array<{ messageId: string; date: string }>
}> {
  const afterDate = Math.floor(syncAfterMs / 1000)
  // [OWN-SENT] Exclude the owner's OWN outbound mail. A ZZP'er emails invoices to
  // customers from this same mailbox; those live in Sent (To=customer, never in the
  // Inbox), and if fetched they were booked as INCOMING costs — phantom voorbelasting
  // attributed to the owner's own customer. `-in:sent -in:drafts -in:chats` drops those
  // while KEEPING a supplier invoice the owner forwarded to themselves (its Inbox copy
  // is not in Sent), so real incoming documents are not lost.
  // [SCAN-EVERYWHERE] `in:anywhere` also searches Spam and Trash — without it, a supplier
  // invoice that a Gmail filter (or Google) routed to Spam, or that was soft-deleted, is never
  // listed and silently missed. Custom labels / archived "All Mail" are already covered by a
  // bare query; Spam+Trash are the one gap. For a bookkeeping tool, completeness wins: a
  // recovered invoice only ever lands in the verify queue (never auto-booked), so surfacing a
  // trashed one costs a glance, while missing a real one costs a deduction.
  const query = `has:attachment after:${afterDate} in:anywhere -in:sent -in:drafts -in:chats`

  // 1. List message IDs — WITH pagination.
  //
  // [BOEK-TRUST A.1] This used to fetch a single page of maxResults=50 with no
  // nextPageToken follow — the exact silent-loss bug we fixed in Outlook. A
  // Gmail mailbox with more than 50 matching messages would only ever surface
  // the newest 50; older invoices were never listed. Since most ZZP users are
  // on Gmail, this was the highest-impact gap in the whole import path.
  //
  // Fix mirrors the Outlook fetcher: follow nextPageToken until Gmail returns
  // none (natural end), capped at MAX_PAGES for safety. listComplete is now a
  // FACT (did we reach the end?) instead of the old "< 50" heuristic — so the
  // watermark advances only over a genuinely complete listing.
  const GMAIL_PAGE_SIZE = 100 // Gmail allows up to 500; 100 keeps pages light
  const MAX_PAGES = 40        // 40 × 100 = 4000 messages / sync, same ceiling as Outlook

  const messagesRaw: Array<{ id: string }> = []
  let pageToken: string | null = null
  let page = 0
  let listComplete = true

  do {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
      `?q=${encodeURIComponent(query)}` +
      `&maxResults=${GMAIL_PAGE_SIZE}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')

    const listRes: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!listRes.ok) {
      const body = await listRes.text()
      // First page failing is a real error; a later page failing keeps what we
      // have but marks the listing incomplete (watermark holds — see below).
      if (page === 0) {
        throw new Error(`Gmail list mislukt: ${body}`)
      }
      console.error('[BOEK-011] Gmail pagination stopped early', { page, body })
      listComplete = false
      break
    }

    // [BOEK-TRUST] Explicit type — the do/while condition depends on pageToken,
    // which is derived from listData; without an annotation TypeScript reports a
    // circular "implicitly has type any" on the loop variables.
    const listData: { messages?: Array<{ id: string }>; nextPageToken?: string } =
      await listRes.json()
    messagesRaw.push(...(listData.messages ?? []))
    pageToken = listData.nextPageToken ?? null
    page++
  } while (pageToken && page < MAX_PAGES)

  // Hit the page cap with more still to list → older tail wasn't fetched.
  if (pageToken && page >= MAX_PAGES) {
    console.warn('[BOEK-011] Gmail listing capped at MAX_PAGES — fetch incomplete')
    listComplete = false
  }

  // De-dup by id (defensive; Gmail list is normally unique).
  const seenIds = new Set<string>()
  const messages: Array<{ id: string }> = []
  for (const m of messagesRaw) {
    if (m.id && !seenIds.has(m.id)) {
      seenIds.add(m.id)
      messages.push(m)
    }
  }
  console.log('[BOEK-011] Gmail listing', {
    rawRows: messagesRaw.length,
    uniqueMessages: messages.length,
    pages: page,
    complete: listComplete,
  })

  const results: GmailAttachment[] = []
  let attachmentsOk = true

  // 2. Fetch each message in parallel (max 10 at a time)
  const chunks = chunkArray(messages, 10)
  for (const chunk of chunks) {
    const fetched = await Promise.all(chunk.map(m => fetchMessageAttachments(m.id, accessToken)))
    for (const f of fetched) {
      results.push(...f.items)
      if (!f.ok) attachmentsOk = false
    }
  }

  // [BOEK-011] messageIndex for the watermark walk. Gmail doesn't do done-skip
  // (its list is IDs only, dates arrive with the message fetch), so the fetched
  // attachments already carry every processed message's date. De-dup by id.
  const miSeen = new Set<string>()
  const messageIndex: Array<{ messageId: string; date: string }> = []
  for (const a of results) {
    if (!miSeen.has(a.messageId)) {
      miSeen.add(a.messageId)
      messageIndex.push({ messageId: a.messageId, date: a.date })
    }
  }

  return { attachments: results, complete: listComplete && attachmentsOk, messageIndex }
}

async function fetchMessageAttachments(
  messageId: string,
  accessToken: string
): Promise<{ items: GmailAttachment[]; ok: boolean }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  // [BOEK-011 throttle×watermark] ok:false = this email wasn't fully read; the
  // caller marks the whole fetch incomplete so the watermark holds.
  if (!res.ok) return { items: [], ok: false }

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

      const rawMime = p.mimeType || ''
      const filename = p.filename || ''
      const size = p.body?.size || 0

      // [H2] Accept PDFs/images even when the server mislabelled the MIME — infer from the
      // extension so a genuine `factuur.pdf` sent as octet-stream is not dropped silently.
      // [FUNNEL] Do NOT drop on size===0. The provider reports 0 for "unknown size" on some
      // inline/forwarded parts; isLikelyInvoiceCandidate already treats 0 as "keep" (a PDF
      // always passes). Dropping here first contradicted that and lost real attachments.
      if (!filename) continue
      const mimeType = normalizeAttachmentMime(rawMime, filename)
      if (!mimeType) continue

      // [BOEK-011 PERF] Same signature/logo pre-filter as Outlook. Gmail's
      // has:attachment already hides most inline images, so this rarely fires
      // here — but keeping both paths identical means consistent behaviour and
      // no surprise if Gmail starts surfacing inline parts.
      if (!isLikelyInvoiceCandidate({ filename, mimeType, size })) continue

      // [BOEK-011] Store with explicit flag — never confuse ID with data. The
      // NORMALISED mime is stored so the classifier downstream gets a type it can read.
      if (p.body?.attachmentId) {
        pending.push({ filename, mimeType, size, attachmentId: p.body.attachmentId })
      } else if (p.body?.data) {
        pending.push({ filename, mimeType, size, inlineData: p.body.data })
      }
    }
  }

  // [FUNNEL] A message whose body IS a single PDF has no `payload.parts` — the PDF sits on
  // `payload` itself (mimeType/filename/body.attachmentId). Passing only `parts` skipped those
  // single-part invoices entirely (automated senders emit them often). Fall back to the payload
  // itself when there are no parts so a single-attachment invoice is examined too.
  const payload = msg.payload as { parts?: unknown[] } | undefined
  walkParts(payload?.parts ?? (payload ? [payload] : []))

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

  // [BOEK-011 throttle×watermark] Every null in `resolved` is a failed
  // attachment fetch (filters already ran in walkParts) — one failure marks
  // this email incomplete so the watermark holds this round.
  const items = resolved.filter((a): a is GmailAttachment => a !== null)
  return { items, ok: items.length === resolved.length }
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

// [BOEK-011 throttle] One retry that respects Retry-After. Microsoft Graph
// throttles per-mailbox (MailboxConcurrency ≈ 4 concurrent; plus rate windows)
// and answers 429/"ApplicationThrottled" with a Retry-After header. Seen in
// production at pagination page 6. One polite wait-and-retry absorbs the
// common case; a second failure returns the response so the caller can mark
// the fetch INCOMPLETE (which holds the watermark — see fetchOutlookAttachments).
async function graphFetch(url: string, accessToken: string): Promise<Response> {
  const doFetch = () =>
    fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })

  let res = await doFetch()
  if (res.status === 429 || res.status === 503) {
    const retryAfter = Number(res.headers.get('retry-after'))
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15000)
        : 4000
    console.warn(`[BOEK-011] Graph throttled (${res.status}) — waiting ${waitMs}ms`)
    await new Promise((r) => setTimeout(r, waitMs))
    res = await doFetch()
  }
  return res
}

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
  syncAfterMs: number,
  // [BOEK-011 throttle] Message IDs already fully processed (every attachment
  // imported or skip-registered). We skip fetching their attachments entirely —
  // the expensive per-message Graph call that trips throttling. Built cheaply
  // from source_message_id in the DB before we get here. This is a PERFORMANCE
  // skip only; correctness still rests on PHASE 0/2 dedup downstream.
  alreadyDoneMessageIds?: Set<string>,
  // [OWN-SENT] The connected mailbox address. Graph's /me/messages spans ALL
  // folders (incl. Sent Items), so the owner's OWN outbound invoices would be
  // fetched and booked as incoming costs. We drop a message that the owner SENT
  // to someone else (from == owner AND owner not a recipient), while keeping a
  // supplier invoice the owner forwarded to THEMSELVES (owner is a recipient).
  ownerEmail?: string | null
): Promise<{
  attachments: GmailAttachment[]
  complete: boolean
  // [BOEK-011] Every LISTED message as {messageId, date} — including ones whose
  // attachment fetch we skipped because they're already done. The watermark
  // walk needs the full timeline, not just freshly-fetched attachments;
  // otherwise skipping done-messages would empty the walk and freeze the mark.
  messageIndex: Array<{ messageId: string; date: string }>
}> {
  // Graph wants an ISO 8601 timestamp for the date filter
  const afterIso = new Date(syncAfterMs).toISOString()

  const filter = `receivedDateTime ge ${afterIso}`
  const firstUrl =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,subject,from,toRecipients,receivedDateTime,hasAttachments` +
    `&$orderby=receivedDateTime desc` +
    `&$top=50`

  type OutlookMessage = {
    id: string
    subject?: string
    from?: { emailAddress?: { name?: string; address?: string } }
    toRecipients?: Array<{ emailAddress?: { address?: string } }>
    receivedDateTime?: string
    hasAttachments?: boolean
  }

  // [OWN-SENT] true when the owner SENT this message to someone else — from == owner
  // AND owner is not among the recipients. Own outbound invoices must not be booked as
  // incoming. A forward-to-self (owner is a recipient) is NOT own-outbound → kept.
  const owner = (ownerEmail ?? '').trim().toLowerCase()
  const isOwnOutbound = (m: OutlookMessage): boolean => {
    if (!owner) return false
    const fromAddr = (m.from?.emailAddress?.address ?? '').trim().toLowerCase()
    if (fromAddr !== owner) return false
    const toAddrs = (m.toRecipients ?? []).map((r) => (r.emailAddress?.address ?? '').trim().toLowerCase())
    return !toAddrs.includes(owner)
  }

  // [FOLDER-DEDUP] Graph's /me/messages spans ALL folders and can return the SAME message
  // more than once (per-folder view + the AllItems view). The OLD loop counted RAW pages
  // against a page cap and de-duplicated only AFTERWARDS — so on a mailbox with MANY folders
  // the duplicate folder-views filled the page budget and the listing was cut BEFORE reaching
  // the older, still-in-window messages. Because we list newest-first and the watermark then
  // advances, that older tail fell outside every future window: a permanent, silent miss — and
  // "many folders" is exactly the shape the owner reported. Fix: de-duplicate INSIDE the loop
  // and budget by UNIQUE messages, never raw pages, so folder-view repeats can't consume the
  // ceiling. A hard API-call cap still bounds a pathological mailbox in wall-clock time.
  const MAX_UNIQUE = 4000    // unique messages per sync — the real ceiling
  const MAX_API_CALLS = 200  // safety bound on Graph list calls (folder dupes inflate paging)

  const seenIds = new Set<string>()
  const messages: OutlookMessage[] = []
  let nextUrl: string | null = firstUrl
  let apiCalls = 0

  // [BOEK-011 throttle×watermark] `complete` = the listing reached its natural end AND every
  // attachment fetch succeeded. Any early stop (throttle, error, ceiling) marks the fetch
  // incomplete, and the caller HOLDS the watermark for this round — the older tail is never
  // skipped; only the window refuses to shrink until a fully-covered pass.
  let listComplete = true

  while (nextUrl && messages.length < MAX_UNIQUE && apiCalls < MAX_API_CALLS) {
    const listRes: Response = await graphFetch(nextUrl, accessToken)
    apiCalls++

    if (!listRes.ok) {
      const body = await listRes.text()
      // First call failing is a real error; a later one shouldn't discard what we collected —
      // but it DOES make the fetch incomplete (hold the watermark).
      if (apiCalls === 1) {
        throw new Error(`Outlook list mislukt: ${body}`)
      }
      console.error('[BOEK-011] Outlook pagination stopped early', { apiCalls, body })
      listComplete = false
      break
    }

    const listData = await listRes.json()
    // De-duplicate as we page: a folder-view repeat never counts toward MAX_UNIQUE.
    for (const m of ((listData.value || []) as OutlookMessage[])) {
      if (m.id && !seenIds.has(m.id)) {
        seenIds.add(m.id)
        messages.push(m)
      }
    }
    nextUrl = (listData['@odata.nextLink'] as string | undefined) ?? null
  }

  // Ceiling hit with more pages remaining → the older tail wasn't listed: hold the watermark.
  if (nextUrl && (messages.length >= MAX_UNIQUE || apiCalls >= MAX_API_CALLS)) {
    console.warn('[BOEK-011] Outlook listing capped (unique/api ceiling) — fetch incomplete')
    listComplete = false
  }
  console.log('[BOEK-011] Outlook listing', {
    uniqueMessages: messages.length,
    apiCalls,
    complete: listComplete,
  })

  const results: GmailAttachment[] = []

  // [BOEK-011] Only messages that actually have attachments — the check moved
  // here from the $filter (see InefficientFilter note above).
  // [H3] The old code ALSO skipped any message whose id was in alreadyDoneMessageIds —
  // but that set is prefix-matched on messageId, so a message entered it the moment ANY
  // ONE of its attachments was stored. On a multi-attachment email where invoice A imported
  // but invoice B failed (transient DB error, or B fell past SYNC_BATCH_MAX while A was in
  // it), the whole message was then skipped forever and the watermark advanced past it —
  // invoice B was lost silently, the exact opposite of the comment's claim. We now fetch
  // every in-window message with attachments and let the per-attachment dedup (knownKeys)
  // skip the already-stored ones cheaply, so no pending attachment can be stranded.
  // Correctness over the throttle micro-optimisation: once the watermark advances, done
  // messages leave the window, so the re-fetch stays bounded to the current frontier.
  void alreadyDoneMessageIds
  const withAttachments = messages.filter((m) => {
    if (!m.hasAttachments) return false
    if (isOwnOutbound(m)) return false // [OWN-SENT] owner's own outbound mail — not incoming
    return true
  })
  console.log('[BOEK-011] Outlook attachment fetch', {
    messagesWithAttachments: messages.filter((m) => m.hasAttachments).length,
    afterDoneSkip: withAttachments.length,
  })

  // [BOEK-011] Full message timeline for the watermark walk — every listed
  // message with a valid date, regardless of whether we fetched its
  // attachments. Built from the de-duplicated `messages` list.
  const messageIndex: Array<{ messageId: string; date: string }> = messages
    .filter((m) => m.id && m.receivedDateTime)
    .map((m) => ({ messageId: m.id, date: m.receivedDateTime as string }))

  // 2. Fetch attachments per message.
  // [BOEK-011 throttle] Concurrency 3 (was 10): Microsoft Graph enforces
  // MailboxConcurrency ≈ 4 concurrent requests per mailbox — 10 parallel
  // attachment calls is a guaranteed violation and is what tripped the
  // throttle seen in production. 3 stays under the limit with headroom.
  let attachmentsOk = true
  const chunks = chunkArray(withAttachments, 3)
  for (const chunk of chunks) {
    const fetched = await Promise.all(
      chunk.map((m) => fetchOutlookMessageAttachments(m, accessToken))
    )
    for (const f of fetched) {
      results.push(...f.items)
      if (!f.ok) attachmentsOk = false
    }
  }

  return { attachments: results, complete: listComplete && attachmentsOk, messageIndex }
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
): Promise<{ items: GmailAttachment[]; ok: boolean }> {
  const attRes = await graphFetch(
    `https://graph.microsoft.com/v1.0/me/messages/${message.id}/attachments`,
    accessToken
  )

  // [BOEK-011 throttle×watermark] A failed attachment fetch used to return []
  // silently — the email then simply didn't exist in the watermark walk, and
  // the mark could advance past its timestamp via neighbours: permanent loss.
  // ok:false bubbles up and marks the whole fetch incomplete instead.
  if (!attRes.ok) {
    console.error('[BOEK-011] Outlook attachment fetch failed', {
      messageId: message.id,
      status: attRes.status,
    })
    return { items: [], ok: false }
  }

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

    const rawMime = att.contentType || ''
    const filename = att.name || ''
    if (!filename) continue
    // [H2] Same mislabelled-MIME recovery as Gmail — a real PDF/image sent with a generic
    // content-type is normalised by extension instead of being dropped unseen.
    const mimeType = normalizeAttachmentMime(rawMime, filename)
    if (!mimeType) continue

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

  return { items: out, ok: true }
}

// ─── AI Classification ────────────────────────────────────────────────────────

export interface AttachmentClassification {
  isInvoice: boolean
  confidence: number
  // [TRUST-UNCERTAIN] The reader recognised likely-invoice content but wasn't sure
  // it read it right. Such an item is imported FLAGGED (not skipped) so it reaches
  // the human verify queue instead of vanishing.
  uncertain?: boolean
  // [STATEMENT-SKIP] Claude's short Dutch reason when is_invoice=false (e.g.
  // "rekeningoverzicht — samenvatting van bestaande facturen"). Stored in the
  // skip registry so the owner/dev can audit WHAT was skipped and WHY, instead
  // of a blanket 'not_invoice'.
  reason?: string
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
  // [SUPPLIER-IDENTITY] vendor legal identity — strong keys for supplier matching
  vendorKvk?: string
  vendorBtw?: string
  // [BRIDGE-CREDITNOTA-SIGN] Is this a creditnota? Drives the sign-inverted
  // SAFECORE gate + invoice_type='creditnota' at insert. Amounts stay NEGATIVE
  // as printed (matching outgoing creditnota [BOEK-031]).
  isCreditNote?: boolean
  // [REMINDER] This attachment is a payment reminder for an invoice sent earlier — a real
  // single invoice, but likely already booked, so it is flagged (not booked as a 2nd cost).
  isReminder?: boolean
  reminderOfInvoiceNumber?: string | null
  // [AUTO-ADVANCE] Defense-in-depth signals so the email auto-advance gate has the SAME inputs
  // as the intake gate — a statement/other-kind read as an invoice must never auto-book.
  isStatement?: boolean
  documentKind?: string | null
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
  receiverName?: string | null,
  // [REREAD-STRONG] Optional read-strategy override. The automatic sync passes nothing (Haiku,
  // cheap text path). The manual "Opnieuw inlezen" passes a stronger model + preferRawPdf so a
  // stuck complex invoice is re-read on the real page layout by a more capable model.
  // [RECEIVER-IDENTITY] receiverKvk/Btw/Iban = OUR own legal numbers, so the AI can tell ours from
  // the vendor's and never return ours as the vendor.
  opts?: {
    model?: string; preferRawPdf?: boolean
    receiverKvk?: string | null; receiverBtw?: string | null; receiverIban?: string | null
  }
): Promise<AttachmentClassification> {
  const { verifyInvoiceFromPdf } = await import('@/lib/ai')

  // [BOEK-011] Data is already base64 (converted in fetchMessageAttachments)
  // [TRANSIENT-RETRY] Opt in: a transient Claude/network failure re-throws (→ PHASE 1 marks the
  // attachment classifyFailed → retried next sync) instead of returning a confidence-0 FALLBACK
  // that the caller would misread as "could not read" and permanently skip.
  const result = await verifyInvoiceFromPdf(base64Data, mimeType, filename, receiverName, {
    throwOnTransient: true,
    model: opts?.model,
    preferRawPdf: opts?.preferRawPdf,
    receiverKvk: opts?.receiverKvk,
    receiverBtw: opts?.receiverBtw,
    receiverIban: opts?.receiverIban,
  })

  return {
    isInvoice: result.is_invoice,
    confidence: result.confidence,
    uncertain: result.uncertain,
    // [STATEMENT-SKIP] why Claude rejected it — surfaces in the skip registry
    reason: result.reason,
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
    // [SUPPLIER-IDENTITY] vendor legal identity for supplier matching/storage
    vendorKvk: result.vendor_kvk,
    vendorBtw: result.vendor_btw,
    paymentReference: result.payment_reference,
    // [BRIDGE-CREDITNOTA-SIGN] creditnota signal from the same Claude call
    isCreditNote: result.is_credit_note,
    // [REMINDER] reminder signal (+ the original invoice number when known)
    isReminder: result.is_reminder,
    reminderOfInvoiceNumber: result.reminder_of_invoice_number ?? null,
    // [AUTO-ADVANCE] statement / kind — defense-in-depth for the auto-advance gate.
    isStatement: result.is_statement,
    documentKind: result.document_kind ?? null,
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
// [M1] Untrusted inbound email attachments get the same hard byte ceiling as the
// manual upload path (email/upload/route.ts caps at 10 MB). Without it, anyone who
// emails the owner a large PDF causes an unbounded Storage write + a Claude call —
// storage-growth / AI-spend DoS from untrusted mail.
const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024

// [H2] A real supplier invoice often arrives with a CORRECT filename but a WRONG or
// generic MIME type — many mail servers stamp attachments application/octet-stream (or an
// empty type). The old MIME gate then dropped a genuine `factuur.pdf` silently. Trust the
// filename extension in that case and return the media type verifyInvoiceFromPdf can read
// (application/pdf or an image/*), or null when it is a type we cannot classify — the
// caller then leaves it for the could-not-read / skip path rather than losing it unseen.
export function normalizeAttachmentMime(mimeType: string, filename: string): string | null {
  const mt = (mimeType || "").toLowerCase()
  if (mt === "application/pdf") return "application/pdf"
  if (mt.startsWith("image/")) return mt // existing broad image behaviour is preserved
  // Wrong/generic MIME → infer from the extension. Only the types the classifier reads.
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "")
  if (ext === "pdf") return "application/pdf"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  return null
}

export function isLikelyInvoiceCandidate(att: {
  filename: string
  mimeType: string
  size: number
}): boolean {
  // [M1] Upper ceiling first — applies to PDFs and images alike. A provider-reported
  // size over the cap is dropped BEFORE we fetch the bytes (no download, no Storage,
  // no AI). size===0 means "unknown" → enforced at the byte-length chokepoint below.
  if (att.size > MAX_EMAIL_ATTACHMENT_BYTES) return false

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
export async function syncUserEmails(
  userId: string,
  // [BACKFILL] Optional re-scan window. `fromMs` fetches from an explicit date instead of the
  // incremental watermark (so an already-passed email can be re-listed and imported); when set,
  // `holdWatermark` keeps the normal incremental mark untouched so a backfill is purely additive
  // and never rewinds or advances the daily window. Absent ⇒ exactly the previous behaviour.
  opts?: { fromMs?: number; holdWatermark?: boolean },
): Promise<{
  provider: EmailProvider
  fetched: number
  verified: number
  saved: number
  errors: number
  remaining: number
  skipped: number
  // [COULD-NOT-READ] Attachments kept in bestanden because we couldn't read them
  // (never asserted "not an invoice"). Surfaced so the owner can go check them.
  couldNotRead: number
  // [BOEK-TRUST] Honest reconciliation for "did everything arrive?". Every
  // fetched attachment this run lands in exactly one bucket; balanced=true means
  // the buckets sum to fetched with nothing unaccounted. This is deliberately a
  // PER-SYNC statement of what we actually observed — not an invented absolute
  // "inbox total", which would risk a wrong number that erodes trust.
  balance: {
    fetched: number      // attachments pulled from the provider this run
    imported: number     // saved as invoices
    skipped: number      // registered as non-invoice (logos/signatures/etc.)
    duplicate: number    // recognised as already-imported
    couldNotRead: number // kept in bestanden, couldn't be read (not asserted non-invoice)
    pending: number      // deferred to next sync (batch cap / transient fail)
    balanced: boolean    // imported+skipped+duplicate+couldNotRead+pending === fetched
  }
} | null> {
  // [CRON] Use the service-role pipeline (not the session client) so syncUserEmails is
  // callable both from the user's /api/email/sync AND the scheduled /api/cron/email-sync
  // (which has no session). The only read below is this user's OWN profile, explicitly
  // scoped by id — service-role here is safe and removes the request-session coupling.
  const supabase = createPipelineClient()

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
    .select('created_at, company_name, full_name, kvk_number, btw_number, iban')
    .eq('id', userId)
    .single()

  const receiverName = profile?.company_name || profile?.full_name || null
  // [RECEIVER-IDENTITY] Our own legal numbers → the AI (and its backstop) can tell OURS from the
  // vendor's and never store our own company as a supplier.
  const receiverKvk = profile?.kvk_number || null
  const receiverBtw = profile?.btw_number || null
  const receiverIban = profile?.iban || null

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
  const floorMs = process.env.SYNC_START_DATE
    ? new Date(process.env.SYNC_START_DATE).getTime()
    : profile?.created_at
      ? new Date(profile.created_at).getTime()
      : Date.now() // fallback: now — fetches nothing from the past

  // ── [BOEK-011] High-water mark — incremental fetch window ──────────────────
  //
  // last_synced_email_at = receivedDateTime of the newest email whose
  // attachments were ALL fully processed. When present, we fetch from there
  // instead of from the floor — the daily sync lists hours of mail, not months.
  //
  // Double-checked safety rules (each maps to a failure case we analysed):
  //   1. The mark is the EMAIL's receivedDateTime, never the invoice's own
  //      date — an old invoice re-sent in a new email is still fetched.
  //   2. OVERLAP: we rewind the mark by 24h when fetching and rely on PHASE 0
  //      dedup to skip the re-fetched knowns. This makes ge/gt boundary
  //      semantics, same-second ties, and minor server clock skew irrelevant.
  //   3. The mark is only ADVANCED over complete emails (see end of PHASE 2) —
  //      it stops at the first transient failure, so classifyFailed items are
  //      re-fetched next sync instead of being silently skipped forever.
  //   4. It never moves backward (guarded update).
  //   5. First sync (NULL mark) = full backfill from the floor — unchanged.
  //
  // Read via pipeline (service) client — same context that writes it.
  // [BOEK-011] Cast: column added by migration-sync-watermark.sql; remove the
  // cast after `npx supabase gen types` regenerates database.types.ts.
  const wmPipeline = createPipelineClient()
  const { data: wmRow } = await (wmPipeline
    .from('email_connections') as ReturnType<typeof wmPipeline.from>)
    .select('last_synced_email_at')
    .eq('id', tokens.connectionId)
    .maybeSingle()
  const watermarkIso: string | null =
    (wmRow as { last_synced_email_at?: string | null } | null)
      ?.last_synced_email_at ?? null

  const WATERMARK_OVERLAP_MS = 24 * 60 * 60 * 1000 // 24h — cheap, bulletproof
  // [BACKFILL] An explicit re-scan window (fromMs) bypasses the watermark clamp entirely:
  // the whole point is to reach emails the incremental mark has already passed. PHASE-0
  // dedup (byte-hash + message-id + semantic) still guarantees nothing is imported twice,
  // so a re-scan only ever fills gaps. Absent ⇒ the normal incremental/floor window.
  const syncAfterMs =
    opts?.fromMs != null
      ? opts.fromMs
      : watermarkIso
        ? Math.max(floorMs, new Date(watermarkIso).getTime() - WATERMARK_OVERLAP_MS)
        : floorMs

  console.log('[BOEK-011] Sync window', {
    mode: opts?.fromMs != null ? 'backfill (explicit)' : watermarkIso ? 'incremental (watermark)' : 'full (floor)',
    watermark: watermarkIso,
    fetchFrom: new Date(syncAfterMs).toISOString(),
  })

  // [BOEK-011] Refresh access_token before every sync — they expire after 1h.
  // refreshAccessToken reads from Vault, hits the provider, writes back to Vault.
  // On failure (revoked grant, expired refresh_token, network) → null → abort.
  const accessToken = await refreshAccessToken(userId)
  if (!accessToken) {
    console.error('[BOEK-011] Could not obtain a fresh access_token', { userId })
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, errors: 1, remaining: 0, skipped: 0, couldNotRead: 0, balance: { fetched: 0, imported: 0, skipped: 0, couldNotRead: 0, duplicate: 0, pending: 0, balanced: true } }
  }

  // [H3] The per-message "already done" skip set was removed — it was prefix-matched on
  // messageId and so stranded pending attachments on partially-imported multi-attachment
  // emails (see the note at the Outlook filter). Correctness now rests entirely on the
  // per-attachment dedup (knownKeys, built in PHASE 0) which skips already-stored
  // attachments cheaply while every in-window message is still fetched.

  // Fetch attachments after registration date
  // [BOEK-011 throttle×watermark] fetchComplete = the provider listing reached
  // its natural end AND every attachment fetch succeeded. When false, the
  // watermark is HELD this round (see the advance block after PHASE 2) —
  // otherwise a throttled/truncated listing would let the mark jump past
  // never-fetched older mail, losing it from every future window.
  let attachments: GmailAttachment[] = []
  let fetchComplete = false
  let messageIndex: Array<{ messageId: string; date: string }> = []
  try {
    if (tokens.provider === 'gmail') {
      const r = await fetchGmailAttachments(accessToken, syncAfterMs)
      attachments = r.attachments
      fetchComplete = r.complete
      messageIndex = r.messageIndex
    } else if (tokens.provider === 'outlook') {
      // [BOEK-011] Outlook via Microsoft Graph — same GmailAttachment shape,
      // so the save loop below is unchanged and provider-agnostic.
      const r = await fetchOutlookAttachments(accessToken, syncAfterMs, undefined, tokens.email)
      attachments = r.attachments
      fetchComplete = r.complete
      messageIndex = r.messageIndex
    }
  } catch (error) {
    console.error('[BOEK-011] Fetch failed:', error)
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, errors: 1, remaining: 0, skipped: 0, couldNotRead: 0, balance: { fetched: 0, imported: 0, skipped: 0, couldNotRead: 0, duplicate: 0, pending: 0, balanced: true } }
  }

  let verified = 0
  let saved = 0
  let errors = 0
  // [BOEK-011] Non-invoice attachments registered this run. Counts as PROGRESS
  // for the client's auto-continue loop: a batch of pure logos saves 0 invoices
  // but still moves the backlog forward (those attachments won't be re-scanned).
  let skipped = 0
  // [BOEK-TRUST] Attachments recognised as already-imported this run (byte-hash,
  // message-id, or semantic dedup). Tracked so the balance summary can show
  // duplicates as an accounted-for bucket rather than a silent gap.
  let duplicate = 0
  // [BOEK-SAFECORE] Rule 1 — count of invoices HELD in 'processing' for an
  // arithmetic problem (subset of `saved`; they exist but aren't shared yet).
  let held = 0
  // [COULD-NOT-READ] Attachments we could NOT read (API reject / unsupported /
  // unparseable) — kept in bestanden for the owner, NOT asserted "not an invoice".
  let couldNotRead = 0

  // [BOEK-011] resolveImportTarget owned by BOEK-033 — places file in correct folder
  const { resolveImportTarget } = await import('@/lib/bestanden')

  // [BOEK-011] Two-phase processing to optimize duration without race conditions.
  //
  // PHASE 1 — AI classification in parallel (the slow part: ~2s × N).
  // PHASE 2 — Save loop runs sequentially over the classified results.
  // Sequential PHASE 2 is critical: dedup queries the DB after every insert, so
  // two attachments with the same content would both pass dedup if processed
  // in parallel ("nothing exists yet"). Keep PHASE 2 sequential, keep correctness.
  //
  // [BOEK-011 PERF] Concurrency for PHASE 1 only (classification = read-only, no
  // DB writes) — raising it does NOT touch the sequential save loop, so dedup is
  // unaffected. 5 in flight (was 3): a backfill of ~70 attachments drops from
  // ~24 to ~15 waves. Guarded by fetchWithRetry in ai.ts (retries 429/5xx), so a
  // brief rate-limit blip self-heals instead of failing an invoice. Tunable via
  // AI_CONCURRENCY if a specific account's tier wants higher/lower; clamped to a
  // sane 1–10 so a typo can't fire hundreds of parallel calls.
  const AI_CONCURRENCY = (() => {
    const raw = Number(process.env.AI_CONCURRENCY)
    if (Number.isFinite(raw) && raw >= 1 && raw <= 10) return Math.round(raw)
    return 5
  })()

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
  // [BOEK-011] Batch cap — max NEW classifications per sync.
  // Raised 25→40: with AI_CONCURRENCY=5 a 40-attachment batch is ~32s
  // (16s classify + ~16s sequential save), comfortably under the 5-minute
  // function ceiling, and it halves the number of sync rounds a backfill needs.
  // Not higher: PHASE 2 save is sequential (linear in batch size), and a smaller
  // batch means more save checkpoints — if a run is interrupted (network,
  // credit), less work is re-done. PHASE 0 skips everything already saved, so
  // pressing sync again continues where the last run stopped (oldest-first, so
  // chronology is preserved across batches). Tunable via SYNC_BATCH_MAX env.
  const SYNC_BATCH_MAX = (() => {
    const raw = Number(process.env.SYNC_BATCH_MAX)
    if (Number.isFinite(raw) && raw >= 1 && raw <= 100) return Math.round(raw)
    return 40
  })()
  const freshAttachments = freshAll.slice(0, SYNC_BATCH_MAX)
  const remainingAfterBatch = freshAll.length - freshAttachments.length

  console.log('[BOEK-011] Sync scope', {
    fetched: attachments.length,
    alreadyImported: knownKeys.size,
    newTotal: freshAll.length,
    thisBatch: freshAttachments.length,
    remainingForNextSync: remainingAfterBatch,
  })

  // PHASE 1 — classify only NEW attachments in parallel (AI_CONCURRENCY in flight)
  const classified: Classified[] = await mapConcurrent(
    freshAttachments,
    AI_CONCURRENCY,
    async (attachment) => {
      try {
        const classification = await classifyAttachment(
          attachment.data,
          attachment.mimeType,
          attachment.filename,
          receiverName,
          { receiverKvk, receiverBtw, receiverIban }
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

  // [BOEK-011 watermark] Attachments that finished PHASE 2 COMPLETELY this run:
  // saved as invoice, registered as non-invoice, or recognised as a duplicate.
  // classifyFailed and save/processing errors are deliberately NOT in this set —
  // the watermark must not advance past them (they need a re-fetch to retry).
  const completedKeys = new Set<string>()

  // PHASE 2 — save loop, sequential by design (dedup correctness)
  for (const { attachment, classification, classifyFailed } of classified) {
    const wmKey = `${attachment.messageId}:${attachment.filename}`
    try {
      // Transient classification failure (rate limit / network) → skip WITHOUT
      // registering; the next sync retries it. A real invoice must never be
      // permanently skipped because of one bad network moment.
      // [watermark] NOT complete — the mark stops before this email.
      if (classifyFailed) {
        errors++
        continue
      }

      // [COULD-NOT-READ] We did not manage to READ this file (API reject / unsupported
      // type / unparseable JSON → verifyInvoiceFromPdf's confidence-0 FALLBACK). That is
      // NOT proof it isn't an invoice, so it must NOT be registered as a permanent
      // 'not an invoice' skip (which discards a possibly-real invoice forever, unseen).
      // Mirror the intake fix: keep the file owner-visible in bestanden, count it so the
      // owner is told, and register it with reason 'could_not_read' (still stops the
      // costly per-sync re-send, but is honest about WHY).
      if (!classification.isInvoice && !((classification.confidence ?? 0) > 0)) {
        try {
          const buf = Buffer.from(attachment.data, 'base64')
          const hash = computeContentHash(buf)
          const { data: dupDoc } = await supabase
            .from('documents').select('id')
            .eq('user_id', userId).eq('content_hash', hash).limit(1).maybeSingle()
          if (!dupDoc) {
            const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
            const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
            const { error: upErr } = await supabase.storage
              .from('documents').upload(storagePath, buf, { contentType: attachment.mimeType, upsert: false })
            if (!upErr) {
              const folderId = await resolveImportTarget(userId, null, 'facturen', 'pipeline')
              const { error: docErr } = await supabase.from('documents').insert({
                user_id: userId,
                file_name: attachment.filename,
                file_url: storagePath,
                file_size: buf.length,
                file_type: attachment.mimeType,
                doc_type: 'overig',
                folder_id: folderId,
                source: 'email',
                ai_processed: false,          // we did NOT read it — never claim we did
                ai_doc_type: 'could_not_read',
                content_hash: hash,
              })
              if (docErr) await supabase.storage.from('documents').remove([storagePath])
            }
          }
        } catch (e) {
          console.error('[BOEK-011] could-not-read save failed', e)
        }
        const skipPipeline = createPipelineClient()
        await skipPipeline
          .from('email_skipped_attachments')
          .upsert(
            {
              user_id: userId,
              source_message_id: `${attachment.messageId}:${attachment.filename}`,
              filename: attachment.filename,
              reason: 'could_not_read',
            },
            { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
          )
        couldNotRead++
        completedKeys.add(wmKey) // handled (kept + registered) = complete
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
              // [STATEMENT-SKIP] Claude's specific Dutch reason when available
              // (e.g. "rekeningoverzicht — samenvatting van bestaande facturen")
              // so the registry tells WHAT was skipped, not just that it was.
              // Capped defensively; falls back to the old blanket value.
              reason: (classification.reason || 'not_invoice').slice(0, 200),
            },
            { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
          )
        skipped++
        completedKeys.add(wmKey) // [watermark] registered = complete
        continue
      }

      // [M1] Hard byte ceiling on untrusted inbound attachments (mirrors the manual
      // upload's 10 MB cap). The candidate filter already drops known-oversized files
      // before fetch; this catches the provider-unknown (size===0) case once the real
      // bytes are in hand — BEFORE any Storage upload / dedup / insert. Registered as
      // a skip so the watermark advances and it is never re-fetched.
      const approxBytes = Math.floor((attachment.data.length * 3) / 4)
      if (approxBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
        await supabase
          .from('email_skipped_attachments')
          .upsert(
            {
              user_id: userId,
              source_message_id: `${attachment.messageId}:${attachment.filename}`,
              filename: attachment.filename,
              reason: 'te groot — overgeslagen (max 10MB)',
            },
            { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
          )
        skipped++
        completedKeys.add(wmKey)
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
        duplicate++
        completedKeys.add(wmKey) // [watermark] duplicate = already complete
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

      if (existingByMessage && existingByMessage.length > 0) {
        duplicate++
        completedKeys.add(wmKey) // [watermark] duplicate = already complete
        continue
      }

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

      // [SUPPLIER-DEDUP] Resolve the canonical supplier BEFORE the duplicate check, so Check B
      // can key on supplier IDENTITY (supplier_id) rather than the STORED name string. Since the
      // insert now stores the supplier's canonical name, comparing a re-arrived invoice's raw
      // vendor read against that canonical name (vendorsAreDifferent / ilike) would wrongly read
      // as a NEW vendor and let the duplicate through — a double-book for exactly the multi-
      // spelling suppliers this registry unifies (the "Silifke≡Hocaoglu" gap named above). By
      // resolving first, two invoices that map to the same supplier_id are recognised as the same
      // vendor regardless of spelling. Best-effort (null on any error) → falls back to the raw
      // name + the pre-existing name comparison, exactly as before. Reused at the insert below.
      const rawVendorName = classification.vendor || extractSenderName(attachment.from)
      const supplier = await resolveSupplierForImport(supabase, userId, {
        name: classification.vendor,
        iban: classification.vendorIban ?? null,
        kvk: classification.vendorKvk ?? null,
        btw: classification.vendorBtw ?? null,
      })

      if (typeof classification.totalIncBtw === 'number') {
        const numberIsReal = !isPlaceholderInvoiceNumber(classification.invoiceNumber)

        // Real date (AI-extracted), used as an extra filter when available.
        const hasRealDate =
          typeof classification.invoiceDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(classification.invoiceDate)
        const realDateIso = hasRealDate
          ? normalizeToIso(classification.invoiceDate as string)
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
            .select('id, source_message_id, invoice_date, client_name, invoice_number, supplier_id')
            .eq('receiver_id', userId)
            .eq('direction', 'incoming')
            .eq('total_inc_btw', classification.totalIncBtw)

          if (tier.kind === 'number') {
            // [DEDUP-NUMBER-NORM] Do NOT filter invoice_number in-query. An exact `.eq`
            // missed a re-generated PDF whose number renders "26 / 3958" vs the stored
            // "26/3958" and booked the same bill TWICE. We fetch on total(+date) and
            // compare the number WHITESPACE-NORMALIZED in code (below), so a spacing/case
            // variant is still caught as the duplicate it is.
            // [TRUST-DEDUP] Vendor is compared in CODE (below), NOT with a DB `ilike`.
            // An `ilike` with no wildcards is exact-apart-from-case, so a re-arrival of
            // the SAME invoice under a slightly different vendor string ("Atapack B.V."
            // vs "Atapack", extra spaces, OCR variance) slipped past the filter and the
            // cost was booked TWICE. For a DUPLICATE blocker, a stricter key = fewer
            // blocks = the dangerous direction. So we fetch candidates on number+total
            // (+date) and use vendorsAreDifferent() to only DECLINE the match when both
            // vendors are reliable AND genuinely different — keeping the guard against
            // two real vendors sharing a number+total, without the false-negative.
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
            // [SUPPLIER-DEDUP] When we resolved a canonical supplier, key the vendor tier on the
            // supplier_id — the reliable identity — instead of the stored name (which is now the
            // canonical spelling and would miss a raw re-read variant). Fall back to the literal
            // ilike on client_name for legacy rows with no supplier_id.
            // [L2] Escape LIKE wildcards so the match is literal (as the comment
            // above intends) — a parsed vendor with `%`/`_` must not act as a wildcard.
            if (supplier?.id) {
              contentQuery = contentQuery.eq('supplier_id', supplier.id)
            } else {
              contentQuery = contentQuery.ilike('client_name', escapeLikeValue((classification.vendor ?? '').trim()))
            }
          }

          // Date filter: applied when we have a real date. For the vendor tier
          // it's especially valuable (tightens a looser key). For the number
          // tier it's an extra precision filter (number already anchors).
          if (realDateIso) {
            contentQuery = contentQuery.eq('invoice_date', realDateIso)
          }

          // Number tier: fetch SEVERAL candidates (number+total+date can legitimately
          // repeat across different vendors) and pick the first that isn't a genuinely
          // different vendor. Vendor tier already constrains the vendor in-query → 1 row.
          // [DEDUP-WINDOW] Number tier compares the number normalized in code (no in-query
          // .eq), so order deterministically and use a wide cap — the match must never fall
          // outside the window for a shop with many same-total invoices. Vendor tier stays 1.
          const { data: existingByContent } = await contentQuery
            .order('id', { ascending: false })
            .limit(tier.kind === 'number' ? 200 : 1)

          const original =
            tier.kind === 'number'
              ? (existingByContent ?? []).find(
                  (c) =>
                    normalizeInvoiceNumber(c.invoice_number) ===
                      normalizeInvoiceNumber(classification.invoiceNumber as string) &&
                    // [SUPPLIER-DEDUP] Same canonical supplier (by id) → same vendor, dedup even
                    // when the printed name differs. Otherwise fall back to the name comparison
                    // (legacy rows without supplier_id, or when this invoice didn't resolve one).
                    (supplier?.id && c.supplier_id === supplier.id
                      ? true
                      : !vendorsAreDifferent(classification.vendor, c.client_name)),
                ) ?? null
              : (existingByContent && existingByContent.length > 0 ? existingByContent[0] : null)

          if (original) {

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
            duplicate++
            completedKeys.add(wmKey) // [watermark] duplicate = already complete
            continue
          }
        }
      }

      // [DATE-GATE] Honest date: null when the AI could not read one — do NOT
      // fall back to the e-mail's received date. A substituted date looks
      // confident and misfiles the expense's quarter; the verify queue forces
      // the human to enter the real date before confirming.
      // [DATE-ISO-SAFE / I6] Tolerant + never-throw (a DD-MM-YYYY here used to throw and
      // stick the whole message in a re-fetch loop forever). Invalid → null → verify queue.
      const invoiceDate = normalizeToIso(classification.invoiceDate)

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
          const { data: doc, error: docErr } = await supabase
            .from('documents')
            .insert({
              user_id: userId,
              file_name: attachment.filename,
              file_url: storagePath,
              file_size: fileBuffer.length,
              file_type: attachment.mimeType,
              doc_type: 'factuur',
              folder_id: folderId,
              year: invoiceDate ? new Date(invoiceDate).getFullYear() : null,
              source: 'email',
              ai_processed: true,
              ai_doc_type: 'invoice',
              content_hash: contentHash,         // [BRIDGE-EXTRACT] byte-hash for cross-path dedup
            })
            .select('id')
            .single()

          if (docErr || !doc) {
            // [R7] The documents insert failed. Don't leave an orphan storage object nor an
            // invoice claiming a pdf_url whose documents row doesn't exist (unreachable in
            // the closing package). Remove the file; the invoice still saves (the sync
            // deliberately never loses extracted invoice data), but without a broken link.
            console.error('[BOEK-011] Document insert failed:', docErr?.message)
            await supabase.storage.from('documents').remove([storagePath])
            documentId = null
            pdfUrl = null
          } else {
            documentId = doc.id
            pdfUrl = storagePath
          }
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
      // [BRIDGE-CREDITNOTA-SIGN] A creditnota takes the sign-inverted branch
      // (amounts must be NEGATIVE + consistent); normal invoices keep the
      // exact original gate.
      const verdict = evaluateArithmetic(classification, {
        isCreditNote: classification.isCreditNote === true,
      })

      // Merge, don't overwrite: keep the AI's fieldConfidence, add _safecore
      // only when held. When there's nothing at all, keep null (parity with the
      // pre-SAFECORE behaviour for clean invoices — no empty {} churn).
      const aiConfidence = classification.fieldConfidence ?? null
      let fieldConfidenceValue: Record<string, unknown> | null = aiConfidence
      // [REMINDER] A payment reminder is a real single invoice but the original was very
      // likely already booked — flag it so the verify queue warns "controleer of de factuur
      // al geboekt is" and it is never bulk-confirmed as a second cost.
      const isReminder = classification.isReminder === true
      // [SAFECORE-GAP] _safecore also carries the dedup note (un-dedupable) and the reminder
      // flag so the audit/human-review trail records WHY this invoice needs a human look.
      if (!verdict.ok || dedupNote || isReminder) {
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
        if (isReminder) {
          safecore.reminder = true
          if (classification.reminderOfInvoiceNumber) {
            safecore.reminder_of = classification.reminderOfInvoiceNumber
          }
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
      //
      // [AUTO-ADVANCE] A confident, clean, ordinary email invoice may skip the manual verify tap
      // and land as 'received' (booked, UNPAID, reversible, tagged _auto_verified) — the same bar
      // and safety contract as the intake path (see auto-advance.ts). Never when the reader was
      // 'uncertain'; statements are already filtered out above (is_invoice=false); _safecore
      // (arithmetic / reminder / dedup) flows into the health check and holds anything doubtful.
      // The near-certain bank/cash links are closed by the hourly reconcile cron.
      const autoAdv = !classification.uncertain
        ? shouldAutoAdvanceInvoice({
            is_invoice: classification.isInvoice,
            is_statement: classification.isStatement,
            is_reminder: classification.isReminder,
            is_credit_note: classification.isCreditNote,
            document_kind: classification.documentKind ?? null,
            confidence: classification.confidence,
            invoice_type: classification.isCreditNote === true ? 'creditnota' : 'factuur',
            // Raw gross only — never auto-book a total derived from the 'amount' fallback (that
            // path also bypasses the dedup gate, which keys on totalIncBtw).
            totalIncBtw: typeof classification.totalIncBtw === 'number' ? classification.totalIncBtw : null,
            health: {
              total_ex_btw: classification.totalExBtw ?? 0,
              btw_amount: classification.btwAmount ?? 0,
              total_inc_btw: classification.totalIncBtw ?? classification.amount ?? 0,
              invoice_date: invoiceDate,
              invoice_number: classification.invoiceNumber ?? null,
              invoice_type: classification.isCreditNote === true ? 'creditnota' : 'factuur',
              field_confidence: fieldConfidenceValue,
            },
          })
        : { advance: false, reason: 'uncertain' }
      if (autoAdv.advance) {
        fieldConfidenceValue = {
          ...(fieldConfidenceValue ?? {}),
          _auto_verified: { at: new Date().toISOString(), reason: autoAdv.reason },
        }
      }
      const invoiceStatus = autoAdv.advance ? 'received' : 'processing'

      const insertPipeline = createPipelineClient()

      // [SUPPLIER-REGISTRY] `supplier` + `rawVendorName` were resolved BEFORE the dedup block
      // above (so Check B could key on supplier_id). Reuse them here: store supplier_id + the
      // canonical name, falling back to the raw name when no supplier was resolved.
      const { data: insertedInvoice, error: dbError } = await insertPipeline
        .from('invoices')
        .insert({
          sender_id: null,
          receiver_id: userId,
          direction: 'incoming',
          status: invoiceStatus,
          source: 'email',
          supplier_id: supplier?.id ?? null,
          client_name: supplier?.name || rawVendorName,
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
          // [BRIDGE-CREDITNOTA-SIGN] mark the type so every surface (queue
          // badge, bridge, quarterly) can tell a creditnota from a factuur.
          // Amounts below stay NEGATIVE as extracted — matching the outgoing
          // creditnota route [BOEK-031] (one sign convention in the table).
          invoice_type: classification.isCreditNote === true ? 'creditnota' : 'factuur',
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
        // [BOEK-TRUST] A unique-constraint violation on the dedup index is NOT
        // a failure — it's the DB catching a duplicate the app-level checks
        // (Check A/B/semantic) missed, e.g. the same invoice arriving as both
        // "Invoice-….pdf" and "Receipt-….pdf" within one run. The original is
        // safely stored; this copy is correctly rejected. Counting it as an
        // error would (a) inflate the error count and (b) risk HOLDING the
        // watermark over a message that is actually fully accounted for. So we
        // treat it as a duplicate: count it, mark complete, let the mark advance.
        // Postgres unique-violation = SQLSTATE 23505; also match the message as
        // a fallback since Supabase surfaces it in .message.
        const isDuplicateKey =
          (dbError as { code?: string }).code === '23505' ||
          /duplicate key value violates unique constraint/i.test(dbError.message)

        if (isDuplicateKey) {
          duplicate++
          completedKeys.add(wmKey) // [watermark] DB-level duplicate = complete
          console.log('[BOEK-011] DB dedup caught duplicate (not an error)', {
            messageId: attachment.messageId,
            filename: attachment.filename,
          })
        } else {
          console.error('[BOEK-011] Save error:', dbError.message)
          // [R7] Roll back the orphan document + storage object. Otherwise its content_hash
          // makes the NEXT sync's byte-hash Check 0 treat this attachment as "already
          // imported" → the watermark advances past the email and the incoming invoice is
          // PERMANENTLY, silently lost (never reaches Crediteuren / voorbelasting / aangifte
          // / the closing package). Mirrors the intake + email-upload rollback. Best-effort;
          // the watermark still holds so the email is re-fetched and retried cleanly.
          if (documentId) {
            await insertPipeline.from('documents').delete().eq('id', documentId)
          }
          if (pdfUrl) {
            await supabase.storage.from('documents').remove([pdfUrl])
          }
          errors++
          // [watermark] NOT complete — a genuine save failure; the mark stops
          // here so the next sync re-fetches and retries this email.
        }
      } else {
        saved++
        completedKeys.add(wmKey) // [watermark] saved = complete

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
      // [watermark] NOT complete — unknown failure; the mark stops here.
    }
  }

  // ── [BOEK-011] Advance the high-water mark ──────────────────────────────────
  //
  // Classic watermark walk: over ALL fetched attachments sorted by email date
  // (oldest first), advance the candidate as long as every attachment is
  // COMPLETE — either known before this run (PHASE 0: already an invoice or in
  // the skip registry) or completed in this run's PHASE 2. Stop at the FIRST
  // incomplete one (classifyFailed, save error, or beyond the batch cap).
  //
  // This single rule handles every case from the double-check:
  //   · batch cap: items beyond the cap are incomplete → mark stops at the
  //     batch boundary; the next sync fetches from there and continues.
  //   · transient failure: the failed email blocks the mark → it is re-fetched
  //     and retried next sync instead of being skipped forever.
  //   · all-already-known repeat sync: every attachment is in knownKeys → the
  //     mark jumps to the newest fetched email → the NEXT fetch window shrinks.
  //   · multiple attachments in one email: they share a receivedDateTime; the
  //     mark passes the email only when ALL of them are complete (any
  //     incomplete one breaks the walk at that date).
  //
  // The update is guarded (only forward, never backward) and non-fatal — a
  // failed watermark write just means the next sync re-fetches a bit more,
  // which PHASE 0 absorbs.
  {
    // [BOEK-011 throttle×watermark] HOLD the mark when the fetch didn't cover
    // the whole window (throttled pagination, MAX_PAGES cut, or a failed
    // attachment fetch). Advancing over a partially-listed range would push
    // never-fetched older mail outside every future window — permanent loss.
    // Progress already saved (invoices / skip registry) is untouched; only the
    // window refuses to shrink until one fully-covered pass succeeds.
    if (opts?.holdWatermark) {
      // [BACKFILL] A re-scan is additive — it must never move the incremental mark (which
      // tracks the newest fully-processed email for the daily window). Leave it untouched.
      console.log('[BACKFILL] Watermark held — re-scan pass does not touch the incremental mark')
    } else if (!fetchComplete) {
      console.log(
        '[BOEK-011] Watermark held — fetch incomplete (throttle/cap); window unchanged this round'
      )
    } else {
    // [BOEK-011] Walk the FULL message timeline (messageIndex), not just
    // fetched attachments. messageIndex lists every message (id + date) that was
    // LISTED this round, so the timeline is complete even for a message whose
    // attachment parts were all filtered out (logos/signatures) and contributes
    // nothing to `attachments`.
    //
    // Per-message completeness:
    //   · has fetched attachments → complete iff all are known/completed
    //     (a previously-imported attachment is in knownKeys; one imported this run
    //      is in completedKeys; a failed one is in neither → incomplete → held)
    //   · NO fetched attachments → complete. We only reach this walk when
    //     fetchComplete===true (every attachment fetch succeeded), so a listed
    //     message contributing zero attachments means its parts were filtered
    //     out before Claude (logo/signature/too-small) — there is no invoice to
    //     wait for. Treating it as incomplete was a BUG: such a message (e.g. an
    //     email whose only attachment is a signature image) permanently blocked
    //     the walk, freezing the watermark at that timestamp every sync.
    //     [Fixed 2026-07-09 after the mark stuck at 2026-07-08.]
    //
    // Walk by TIMESTAMP GROUP (emails sharing a receivedDateTime advance
    // together, all-or-nothing) and stop at the first incomplete group.
    const attsByMsg = new Map<string, GmailAttachment[]>()
    for (const a of attachments) {
      const arr = attsByMsg.get(a.messageId) ?? []
      arr.push(a)
      attsByMsg.set(a.messageId, arr)
    }

    const messageComplete = (messageId: string): boolean => {
      // [H3] No doneMessageIds short-circuit: now that every in-window message is re-fetched,
      // completeness is judged PURELY per-attachment. A previously-done message that carries
      // a newly-failed attachment this run must read as incomplete so the watermark holds and
      // it is retried — the old short-circuit would have advanced past it and lost that file.
      const atts = attsByMsg.get(messageId)
      // No fetched attachments for this listed message → its parts were filtered
      // out (not a failed fetch — we're inside fetchComplete===true). Nothing to
      // wait for → complete. (This is the fix for the frozen-watermark bug.)
      if (!atts || atts.length === 0) return true
      for (const a of atts) {
        const key = `${a.messageId}:${a.filename}`
        if (!(knownKeys.has(key) || completedKeys.has(key))) return false
      }
      return true
    }

    const sortedMsgs = [...messageIndex].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    let candidateIso: string | null = null
    let i = 0
    while (i < sortedMsgs.length) {
      const t = new Date(sortedMsgs[i].date).getTime()
      let j = i
      let groupComplete = true
      while (j < sortedMsgs.length && new Date(sortedMsgs[j].date).getTime() === t) {
        if (!messageComplete(sortedMsgs[j].messageId)) groupComplete = false
        j++
      }
      if (!groupComplete) break
      if (Number.isFinite(t)) candidateIso = new Date(t).toISOString()
      i = j
    }

    if (candidateIso) {
      const advances =
        !watermarkIso || new Date(candidateIso) > new Date(watermarkIso)
      if (advances) {
        // [BOEK-011] Cast: column from migration-sync-watermark.sql; remove
        // after type regeneration. Guarded server-side too (or-filter) so two
        // overlapping syncs can never move the mark backwards.
        const { error: wmErr } = await (wmPipeline
          .from('email_connections') as ReturnType<typeof wmPipeline.from>)
          .update({ last_synced_email_at: candidateIso } as Record<string, unknown>)
          .eq('id', tokens.connectionId)
          .or(`last_synced_email_at.is.null,last_synced_email_at.lt.${candidateIso}`)
        if (wmErr) {
          console.error('[BOEK-011] Watermark update failed (non-fatal)', wmErr)
        } else {
          console.log('[BOEK-011] Watermark advanced', {
            from: watermarkIso,
            to: candidateIso,
          })
        }
      }
    } else if (attachments.length > 0) {
      console.log(
        '[BOEK-011] Watermark held — oldest fetched email not yet complete (transient failure or batch boundary)'
      )
    }
    }
  }

  // [BOEK-011 + BOEK-SECURITY Phase 2.5] Notify the user about imported invoices.
  // After Phase 2.5 cleanup, notifications has no INSERT policy for the
  // authenticated context — any user-client insert returns 403. All notification
  // writes must go through service_role (createPipelineClient). NOTE: since the
  // cron refactor, `supabase` above is ALSO the service-role pipeline (every read
  // in this function is explicitly scoped by the passed userId), so this whole
  // function is session-independent and callable from the scheduled cron.
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

  // [BOEK-TRUST] Balance reconciliation for "did everything arrive?".
  //
  // This run's freshly-processed attachments (freshAttachments) each end in
  // exactly one bucket: saved | skipped | duplicate | errors. `balanced` is true
  // when those buckets sum to what we processed — proving nothing fell through
  // unaccounted. It's a PER-SYNC, observed statement (honest about what we saw),
  // not an invented absolute inbox total that could be wrong and erode trust.
  //
  //   fetched(this batch) = imported + skipped + duplicate + errors
  //   pending             = remainingAfterBatch (deferred to the next sync)
  //
  // knownKeys (already-imported before this run) are intentionally NOT in the
  // batch math — they were reconciled in the sync that first imported them.
  const processedThisBatch = freshAttachments.length
  // couldNotRead is its own accounted-for bucket (kept in bestanden, registered) — it
  // must be in the sum or a real, fully-handled attachment would read as an unaccounted gap.
  const bucketed = saved + skipped + duplicate + errors + couldNotRead
  const balanced = bucketed === processedThisBatch

  if (!balanced) {
    // Not fatal — surfaced so a real accounting gap is visible, never hidden.
    console.warn('[BOEK-TRUST] Balance mismatch', {
      processedThisBatch,
      imported: saved,
      skipped,
      duplicate,
      errors,
      bucketed,
      gap: processedThisBatch - bucketed,
    })
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
    couldNotRead,
    balance: {
      fetched: processedThisBatch,
      imported: saved,
      skipped,
      duplicate,
      couldNotRead,
      pending: remainingAfterBatch,
      balanced,
    },
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