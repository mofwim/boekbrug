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
// [BOEK-SAFECORE] jsonb column type for invoices.field_confidence — mirrors the
// audit.ts pattern (derive the Json type from generated types, cast at write).
import type { Database } from '@/types/database.types'
type InvoiceFieldConfidence =
  Database['public']['Tables']['invoices']['Insert']['field_confidence']

// ─── Vault-backed token helpers ─────────────────────────────────────────────

/**
 * [BOEK-011 + BOEK-SECURITY] Read tokens for a user from Vault.
 * Returns null when no connection exists or Vault read fails.
 * The caller decides what "null" means (e.g. "reconnect Gmail").
 */
export async function getEmailTokens(
  userId: string,
  provider: 'gmail' | 'outlook' = 'gmail'
): Promise<{
  accessToken: string
  refreshToken: string
  provider: 'gmail' | 'outlook'
  email: string
  connectionId: string
} | null> {
  const supabase = createPipelineClient()

  const { data: conn, error } = await supabase
    .from('email_connections')
    .select('id, provider, email, access_token_secret_id, refresh_token_secret_id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

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
      p_secret_id: (existing?.access_token_secret_id ?? null) as unknown as string,      p_value: accessToken,
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
      p_secret_id: (existing?.refresh_token_secret_id ?? null) as unknown as string,      p_value: refreshToken,
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

// ─── AI Classification ────────────────────────────────────────────────────────

export interface AttachmentClassification {
  isInvoice: boolean
  confidence: number
  vendor?: string
  amount?: number          // total incl. BTW
  invoiceDate?: string
  invoiceNumber?: string
  // [BOEK-011] full BTW breakdown — extracted in the same Claude call
  totalExBtw?: number
  btwAmount?: number
  totalIncBtw?: number
  btwRate?: number
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
    totalExBtw: result.total_ex_btw,
    btwAmount: result.btw_amount,
    totalIncBtw: result.total_inc_btw,
    btwRate: result.btw_rate,
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

// ─── [BOEK-SAFECORE] Rule 1 — arithmetic safety (no silent arithmetic error) ──
//
// The automated email path was the LEAST guarded path: it wrote status='received'
// directly (→ shared → straight to the accountant) with NO arithmetic check at
// all. The TRAIL 2/3 checks lived only in the manual confirm route, which the
// email path never touches. That is the inversion this fixes: the path with NO
// human review (users don't review AI imports in practice) now gets the MOST
// machine checks, not zero.
//
// Behaviour: a confirmed arithmetic problem does NOT pass silently to the final
// state. The invoice is HELD in 'processing' (the existing verify-queue buffer,
// excluded from `shared`) instead of 'received', with a clear reason. A human
// then reviews it via the confirm route, where Pillar ⑤ (the eye confirms)
// takes over. No new enum, no migration — just 'processing' instead of
// 'received' when the math is impossible or inconsistent.
//
// 🔴 HONEST LIMIT (named, not hidden): this catches arithmetic that is
// impossible (NaN/∞/≤0, out-of-range date) or internally inconsistent
// (excl+BTW≠incl, illegal rate). It does NOT catch a value that is internally
// consistent but factually wrong (AI read 1.250 instead of 1.350 — all sums
// agree, but the source number is wrong). That class is undetectable by
// arithmetic alone and is explicitly out of scope here.

interface ArithmeticVerdict {
  ok: boolean
  // Human-readable Dutch reason (for field_confidence._safecore + audit).
  reason?: string
  // Machine flags for the audit trail / future UI.
  flags?: string[]
}

/**
 * [BOEK-SAFECORE] Pure arithmetic gate for an AI-classified incoming invoice.
 * No DB, no side effects — just a verdict on the numbers.
 *
 * Structural (impossible values) → blocked:
 *   - any of ex/btw/incl is NaN, ±Infinity, or < 0
 *   - invoice year outside 2020–2030 (a plausible business range)
 * Consistency (internally wrong) → blocked:
 *   - |ex + btw − incl| > 0.02  (Excl/Incl mix-ups, dropped lines)
 *   - rate ∉ {0, 9, 21}  (legal NL BTW rates; computed, since btw_rate is
 *     not stored — Math.round((btw/ex)*100), guarded against ex=0)
 *
 * Note: a zero/empty invoice (all three 0) is treated as a structural problem
 * (incl ≤ 0) — an incoming invoice with no amount is not a valid financial
 * record and must not reach the accountant unreviewed.
 */
function evaluateArithmetic(c: AttachmentClassification): ArithmeticVerdict {
  const flags: string[] = []
  const reasons: string[] = []

  const ex = c.totalExBtw ?? 0
  const btw = c.btwAmount ?? 0
  const incl = c.totalIncBtw ?? c.amount ?? 0

  // ── Structural: impossible numbers ──
  const finiteNonNeg = (v: number) => Number.isFinite(v) && v >= 0
  if (!finiteNonNeg(ex) || !finiteNonNeg(btw) || !finiteNonNeg(incl)) {
    flags.push('non_finite_or_negative')
    reasons.push('ongeldige bedragen (NaN/∞/negatief)')
  }

  // incl must be a real positive total — a 0/blank invoice is not bookable.
  if (Number.isFinite(incl) && incl <= 0) {
    flags.push('non_positive_total')
    reasons.push('totaalbedrag ontbreekt of is 0')
  }

  // ── Structural: date sanity (year 2020–2030) ──
  if (typeof c.invoiceDate === 'string' && c.invoiceDate.trim()) {
    const d = new Date(c.invoiceDate)
    const year = d.getFullYear()
    if (Number.isNaN(d.getTime()) || year < 2020 || year > 2030) {
      flags.push('date_out_of_range')
      reasons.push('factuurdatum buiten geldig bereik (2020–2030)')
    }
  }

  // ── Consistency checks only run when the numbers are at least finite. ──
  // (No point checking ex+btw=incl when one of them is already NaN/∞.)
  if (finiteNonNeg(ex) && finiteNonNeg(btw) && finiteNonNeg(incl) && incl > 0) {
    // excl + BTW must equal incl (tolerance 0.02 for rounding)
    if (Math.abs(ex + btw - incl) > 0.02) {
      flags.push('sum_mismatch')
      reasons.push('excl + BTW ≠ totaal')
    }
    // Legal BTW rate: computed (btw_rate is NOT stored). Guard division by zero;
    // when ex=0 we can't derive a rate, so we skip the rate check (the sum check
    // above already covers ex=0 cases meaningfully).
    if (ex > 0) {
      const rate = Math.round((btw / ex) * 100)
      if (rate !== 0 && rate !== 9 && rate !== 21) {
        flags.push('illegal_btw_rate')
        reasons.push(`ongeldig BTW-tarief (${rate}%)`)
      }
    }
  }

  if (flags.length === 0) return { ok: true }
  return { ok: false, reason: reasons.join('; '), flags }
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

  const syncAfterMs = profile?.created_at
    ? new Date(profile.created_at).getTime()
    : Date.now() // fallback: now — fetches nothing from the past

  // [BOEK-011] Refresh access_token before every sync — they expire after 1h.
  // refreshAccessToken reads from Vault, hits the provider, writes back to Vault.
  // On failure (revoked grant, expired refresh_token, network) → null → abort.
  const accessToken = await refreshAccessToken(userId)
  if (!accessToken) {
    console.error('[BOEK-011] Could not obtain a fresh access_token', { userId })
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, errors: 1 }
  }

  // Fetch attachments after registration date
  let attachments: GmailAttachment[] = []
  try {
    if (tokens.provider === 'gmail') {
      attachments = await fetchGmailAttachments(accessToken, syncAfterMs)
    }
    // Outlook: same pattern — add fetchOutlookAttachments when needed
  } catch (error) {
    console.error('[BOEK-011] Fetch failed:', error)
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, errors: 1 }
  }

  let verified = 0
  let saved = 0
  let errors = 0
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

  // PHASE 1 — classify all attachments in parallel (max 3 in flight)
  const classified: Classified[] = await mapConcurrent(
    attachments,
    3,
    async (attachment) => {
      try {
        const classification = await classifyAttachment(
          attachment.data,
          attachment.mimeType,
          attachment.filename,
          receiverName
        )
        return { attachment, classification }
      } catch (err) {
        console.error('[BOEK-011] Classification error', { filename: attachment.filename, err })
        // Return a "not an invoice" placeholder — sequential phase will skip it
        return {
          attachment,
          classification: { isInvoice: false } as Awaited<ReturnType<typeof classifyAttachment>>,
        }
      }
    }
  )

  // PHASE 2 — save loop, sequential by design (dedup correctness)
  for (const { attachment, classification } of classified) {
    try {
      // Not an invoice → discard, no trace in DB
      if (!classification.isInvoice) continue
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
      // KEY = invoice_number + total_inc_btw  (+ invoice_date ONLY when both
      // sides have a REAL extracted date). This is deliberately WIDE, not
      // precise: the asymmetry of harm decides it —
      //   · false POSITIVE (flag a non-duplicate) → lands in the verify queue,
      //     a human dismisses it, no money lost.
      //   · false NEGATIVE (miss a real duplicate) → the user pays twice, real
      //     money lost.
      // For idempotency we bias toward catching MORE. So vendor name is NOT in
      // the key — a duplicate must be caught even when the vendor name differs.
      //
      // 🔴 KNOWN LIMIT (named, not hidden): this catches duplicates by
      // number+amount(+date). It does NOT use vendor identity, and there is no
      // stored vendor KvK/BTW to anchor it. The "same vendor, different name"
      // problem (Silifke ≡ OZ&ER) is a SEPARATE concern, closed later by
      // BRIDGE-ALIAS. We do NOT claim full idempotency here.
      //
      // Cross-path: NOT restricted to source='email' anymore — a manual upload
      // of the same invoice followed by an email copy (or vice-versa) is also a
      // duplicate. Scoped to receiver_id + direction='incoming'.
      if (
        classification.invoiceNumber &&
        typeof classification.totalIncBtw === 'number'
      ) {
        // Only constrain on date when THIS invoice has a real extracted date.
        // When the date is a fallback (attachment date), constraining would
        // narrow the catch — exactly what we don't want. So: real date → use
        // it as an extra filter; no real date → match on number+total only
        // (wider catch). invoiceDate here is the AI-extracted value, NOT the
        // fallback computed later for storage.
        const hasRealDate =
          typeof classification.invoiceDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(classification.invoiceDate)
        const realDateIso = hasRealDate
          ? new Date(classification.invoiceDate as string).toISOString().split('T')[0]
          : null

        let contentQuery = supabase
          .from('invoices')
          .select('id, source_message_id, invoice_date, client_name')
          .eq('receiver_id', userId)
          .eq('direction', 'incoming')
          .eq('invoice_number', classification.invoiceNumber)
          .eq('total_inc_btw', classification.totalIncBtw)

        // Add the date filter ONLY when we have a real date on the incoming one.
        // (A stored invoice with a NULL date will simply not match this filter,
        // which is acceptable — number+total alone already flags it via the
        // no-date branch on the NEXT arrival; we never widen by dropping the
        // filter retroactively.)
        if (realDateIso) {
          contentQuery = contentQuery.eq('invoice_date', realDateIso)
        }

        const { data: existingByContent } = await contentQuery.limit(1)

        if (existingByContent && existingByContent.length > 0) {
          const original = existingByContent[0]

          // [BOEK-SAFECORE] Audit the blocked duplicate — truth in the log,
          // silence in the UI (we don't over-claim "all duplicates caught").
          // entityId = the ORIGINAL invoice (the duplicate is never created);
          // newValue carries the REJECTED candidate's identity. Mirrors the
          // existing 'document.duplicate_blocked' pattern. Non-fatal.
          await logAuditAction({
            userId,
            action: 'invoice.duplicated',
            entityType: 'invoice',
            entityId: original.id,
            newValue: {
              reason: 'semantic_duplicate_blocked',
              invoice_number: classification.invoiceNumber,
              total_inc_btw: classification.totalIncBtw,
              rejected_vendor: classification.vendor ?? null,
              rejected_message_id: dedupKey,
              original_message_id: original.source_message_id ?? null,
              date_matched: Boolean(realDateIso),
            },
          })

          console.log('[BOEK-SAFECORE] Skipping semantic duplicate', {
            invoiceNumber: classification.invoiceNumber,
            totalIncBtw: classification.totalIncBtw,
            dateMatched: Boolean(realDateIso),
            existingMessageId: original.source_message_id,
            newMessageId: dedupKey,
          })
          continue
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
      if (!verdict.ok) {
        fieldConfidenceValue = {
          ...(aiConfidence ?? {}),
          _safecore: {
            arithmetic_ok: false,
            reason: verdict.reason,
            flags: verdict.flags,
            held_at: new Date().toISOString(),
          },
        }
      }

      // Held in 'processing' on failure; normal 'received' on success.
      const invoiceStatus = verdict.ok ? 'received' : 'processing'

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
          invoice_number: classification.invoiceNumber || `EMAIL-${Date.now()}`,
          total_ex_btw: classification.totalExBtw ?? 0,
          btw_amount: classification.btwAmount ?? 0,
          total_inc_btw: classification.totalIncBtw ?? classification.amount ?? 0,
          pdf_url: pdfUrl,
          document_id: documentId,
          source_message_id: dedupKey,
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
    // [BOEK-SAFECORE] Honest copy: when some invoices are HELD for review, say
    // so — don't tell the user to confirm payment on an invoice we've flagged
    // as arithmetically wrong. We don't over-claim ("all checked"); we state
    // the concrete situation only.
    const cleanCount = saved - held
    let body: string
    if (held > 0 && cleanCount > 0) {
      body =
        `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je Gmail gehaald. ` +
        `${held} ${held === 1 ? 'factuur staat' : 'facturen staan'} klaar ter controle ` +
        `(mogelijk een rekenfout). Bevestig de rest.`
    } else if (held > 0 && cleanCount === 0) {
      body =
        `BoekBrug heeft ${held} ${held === 1 ? 'factuur' : 'facturen'} uit je Gmail gehaald die ` +
        `${held === 1 ? 'controle nodig heeft' : 'controle nodig hebben'} (mogelijk een rekenfout).`
    } else {
      body = `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je Gmail gehaald. Bevestig betalingsstatus.`
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