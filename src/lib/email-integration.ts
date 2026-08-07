// src/lib/email-integration.ts
// [BOEK-011] Gmail API helpers + AI classification for incoming invoice pipeline
// All Claude API calls go through @/lib/ai — this file only handles Gmail + orchestration

// [BOEK-011 + BOEK-SECURITY] OAuth tokens are stored in Supabase Vault,
// never in plaintext columns. The three helpers below are the ONLY way to
// read, write, or delete tokens — never touch access_token / refresh_token
// columns directly (they are NULL since the BOEK-SECURITY migration).
import { randomUUID } from 'node:crypto'
// [OBSERVABILITY] De waarde die de lezer telt — één plek, zie skipped-import.ts.
import { DOC_TYPE_COULD_NOT_READ } from '@/lib/skipped-import'
// [MAILTEKST] De factuur die nooit een bijlage had: het filter en de tekstconversie.
import { htmlToReadableText, bodyLooksLikeInvoice, bodyDocumentName } from '@/lib/email-body-invoice'
import { textToPdf } from '@/lib/text-to-pdf'
// [DOORGESTUURD] Read the attachments out of an e-mail that arrived as an attachment.
import { extractMimeAttachments, mimeHeader, uniqueAttachmentName, type EmbeddedAttachment } from '@/lib/mime-attachments'
import { createPipelineClient } from '@/lib/supabase-pipeline'
// [BRIDGE-EXTRACT] byte-hash dedup — één bestand → één hash → één record
import { computeContentHash } from '@/lib/content-hash'
import { escapeLikeValue } from '@/lib/sanitize'
// [DUP-TRASHED] Gedeelde uitzondering op de byte-hash-poort: een weggegooid bestand mag de
// dedup-sleutel niet levenslang bezet houden. Zelfde module als /api/intake gebruikt.
import { trashedDuplicateCleared } from '@/lib/trashed-dedup'
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
  type PossibleDuplicate,
} from '@/lib/safecore'
import { collectPossibleDuplicate, mergePossibleDuplicate, markDuplicateCheckUnavailable } from '@/lib/possible-duplicate-collect'
// [READING-MEMORY] Feed the reader what the owner keeps correcting at each supplier.
import { readingPromptHint } from '@/lib/reading-memory'
import { loadReadingMemory } from '@/lib/reading-memory-source'
import { shouldAutoAdvanceInvoice } from '@/lib/auto-advance'
// [MULTI-INVOICE] / [ONE-INVOICE-UNVERIFIED] The same two questions /api/intake asks before it
// lets anything auto-book — one file can hold several invoices, and a scanned stack cannot be
// checked at all. Same module, same mergers, so the queue reads identically on both doors.
import { detectMultipleInvoices, cannotVerifySingleInvoice, mergeMultipleInvoices, mergeUnverifiedSingle } from '@/lib/multi-invoice-pdf'
// [PDF-TEXT] The text layer both checks read, shared with the intake door.
import { readPdfTextLayer } from '@/lib/pdf-text'
// [GEGROND] The stored verdict on whether the total is printed on the document.
import { groundingOf } from '@/lib/amount-grounding'
import { placementOf, btwContradictionOf } from '@/lib/document-verify'
import { eInvoiceContradictsRead, looksLikeInvoiceXml, isEInvoiceXmlMime, E_INVOICE_XML_MIME } from '@/lib/e-invoice'
// [EERLIJK-GEBRUIK] De maandteller. Zie de toelichting bij de poort in syncUserEmails: dit was
// de enige betaalde weg naar Anthropic die er niet langs kwam.
import { consumeFairUseUpTo, releaseFairUse } from '@/lib/fair-use-usage'
import { planForUser } from '@/lib/fair-use-gate'
// [BON-EMAIL] The payment question, answered in ONE place for every door. The camera path and this
// one must never disagree about whether a bon was paid — a second copy of that reasoning here is
// how they drifted apart the first time.
import { paymentSuggestion } from '@/lib/intake-router'
// [BON-AUTO] Mag een kassabon zichzelf afboeken? Alleen als het PAPIER de tenderregel afdrukt.
import { planReceiptSettlement } from '@/lib/receipt-auto-settle'
import { resolveSupplierForImport } from '@/lib/supplier-registry'
// [IBAN-WISSEL] Een bekende leverancier met ineens een ander rekeningnummer — de handtekening
// van factuurfraude, en de enige as waarop élke andere poort hier groen geeft.
import { detectIbanChange } from '@/lib/iban-change'
// [AFZENDERREGEL] Adressen waarvan de eigenaar zelf zei "altijd negeren" — toegepast in PHASE 0,
// dus vóór de AI-aanroep, en altijd verantwoord in de skip-registry.
import { normalizeSenderEmail, senderIsBlocked, blockedSenderSkipReason } from '@/lib/sender-rules'
// [HERINNERING-ORIGINEEL] Een herinnering waarvan het origineel al geboekt is, is geen kost.
import { decideReminder } from '@/lib/reminder-original'
import { createNotification } from '@/lib/notifications'
import { looksLikeBankStatementFile, type BankStatementNameKind } from '@/lib/detect-file'

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
import { notifyRow } from './notifications'
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

  // [EMAIL-HEALTH] A successful (re)connect or token refresh means the grant is healthy again —
  // clear any stale needs_reauth flag so the reconnect banner disappears. Cast: post-migration column.
  await supabase
    .from('email_connections')
    .update({ needs_reauth: false })
    .eq('user_id', userId)
    .eq('provider', provider)

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
/**
 * [EMAIL-HEALTH] A connection's OAuth grant is definitively dead (revoked / refresh_token expired).
 * Flip `needs_reauth` so the UI can stop lying "verbonden ✓" and the owner is told the automatic
 * import has stopped. Idempotent + one-time-notify: only the FALSE→TRUE edge fires a notification,
 * so a dead grant polled every 2h doesn't spam. Best-effort — NEVER throws (it runs inside the sync
 * path, which must not abort on a health-flag write). The `needs_reauth` column post-dates the
 * generated types, so writes cast like the sibling last_synced_email_at column already does.
 */
async function markEmailNeedsReauth(
  userId: string,
  provider: 'gmail' | 'outlook',
  reason: string,
): Promise<void> {
  try {
    const supabase = createPipelineClient()
    const { data: row } = await supabase
      .from('email_connections')
      .select('id, email, needs_reauth')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle()
    if (!row?.id) return
    if (row.needs_reauth === true) return // cheap pre-check → skip the write when already flagged
    // Atomic false→true flip: guard the update on needs_reauth=false and notify ONLY when this call
    // actually made the transition. Without this, two concurrent refreshes (manual sync + cron) could
    // both read false and both notify. .select() returns the rows this update changed → 0 = lost the race.
    const { data: flipped } = await supabase
      .from('email_connections')
      .update({ needs_reauth: true })
      .eq('id', row.id)
      .eq('needs_reauth', false)
      .select('id')
    if (!flipped || flipped.length === 0) return // another refresh already flagged + notified
    console.error('[EMAIL-HEALTH] connection needs re-auth', { userId, provider, reason })
    try {
      await createNotification({
        userId,
        title: 'E-mailkoppeling verlopen',
        body: `Je ${provider === 'gmail' ? 'Gmail' : 'Outlook'}-koppeling${row.email ? ` (${row.email})` : ''} is verlopen. Er worden geen facturen meer automatisch ingelezen totdat je opnieuw verbindt.`,
        type: 'status',
        link: '/dashboard/incoming',
      })
    } catch {
      /* notification is best-effort — the flag is the source of truth */
    }
  } catch (err) {
    console.error('[EMAIL-HEALTH] markEmailNeedsReauth failed', { userId, provider, err })
  }
}

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
      // [EMAIL-HEALTH] 400/401 = the grant is definitively dead (invalid_grant / revoked /
      // expired refresh_token) — flag it so the owner is told, not silently stuck. A 429/5xx is
      // transient (rate-limit / provider blip): leave it, the next cron round retries.
      if (response.status === 400 || response.status === 401) {
        await markEmailNeedsReauth(userId, tokens.provider, `refresh_http_${response.status}`)
      }
      return null
    }
    refreshData = await response.json()
  } catch (err) {
    // Network/transport failure is transient — do NOT flag needs_reauth, just retry next round.
    console.error('[BOEK-011] Refresh network error', { userId, err })
    return null
  }

  if (!refreshData.access_token) {
    console.error('[BOEK-011] Refresh returned no access_token', { userId, refreshData })
    // A 200 with no access_token means the provider rejected the grant without an HTTP error —
    // treat it as definitively dead so the connection doesn't rot green.
    await markEmailNeedsReauth(userId, tokens.provider, 'refresh_no_access_token')
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
  /**
   * [MAILTEKST] This "attachment" is the message BODY, rendered to a PDF because the supplier
   * attached nothing. It is a real invoice document either way, but it is never auto-booked: the
   * page was assembled by us from ordinary mail, and "is this a bill at all" is a judgement no
   * mechanical filter should make on its own. Absent on every genuine attachment.
   */
  fromBody?: boolean
}

// [EMAIL→BANK] A machine-readable bank statement (MT940 / CAMT.053 / bank CSV) seen as an
// email attachment. It is NEVER downloaded, parsed, or auto-imported — only its identity is
// carried out of the fetcher so the sync loop can SURFACE it (skip-registry row with an
// actionable "upload it at Bank" reason) instead of dropping it silently. Money data still
// enters ONLY through the reviewed Bank upload flow. Bytes are deliberately absent here.
/**
 * [OVERSLAG-ZICHTBAAR] Een bijlage die de app heeft ZIEN binnenkomen en NIET heeft gelezen.
 *
 * Reist langs precies dezelfde weg als BankStatementRef: gezien tijdens het ophalen, gemeld in de
 * skip-registratie, nooit ingelezen. De bytes worden niet gedownload — bij `oversized` met opzet
 * (dat is de hele reden), bij de rest omdat er geen lezer voor is.
 *
 * Waarom dit bestaat: te groot, te klein en onleesbaar-formaat verdwenen alle drie met exact
 * dezelfde stille weigering als een logo in een handtekening. Het overgeslagen-paneel meldde dan
 * "Niets overgeslagen" over een mail waar wel degelijk een factuur in zat.
 */
/**
 * [ONBEREIKBAAR] Wat één bijlage-ophaal opleverde. Het onderscheid dat hier gemaakt wordt is dat
 * tussen WEER en BLIJVEND, en het gaat over de hele mailbox: bij weer houdt de watermerk-stand
 * stil en probeert de volgende sync het opnieuw; bij een blijvende fout zou datzelfde stilhouden
 * élke nieuwere factuur achter één onbereikbaar bestand opsluiten — en dan valt de import stil
 * zonder dat iemand kan zeggen waarom. Eén bestand luid verliezen is beter dan alle stil.
 */
type AttachmentFetchResult =
  | { kind: 'item'; item: GmailAttachment }
  | { kind: 'transient' }
  | { kind: 'permanent'; filename: string }

/** Eén zin voor beide deuren: dezelfde situatie hoort niet twee verschillende uitleggen te krijgen. */
const UNREACHABLE_ATTACHMENT_REASON =
  'de bijlage stond wel in de mail maar kon niet worden opgehaald — stuur hem opnieuw door, of ' +
  'voeg hem toe bij Uploaden'

export interface SkippedAttachmentRef {
  messageId: string
  filename: string
  /** De Nederlandse reden, zoals de eigenaar hem in het paneel leest. */
  reason: string
  /** Waarom hij afviel — bepaalt of er ook een melding uit gaat. */
  kind: AttachmentSkipKind
}

export interface BankStatementRef {
  messageId: string
  filename: string
  // "certain" = a bank-statement-specific extension; "ambiguous" = a generic .xml/.csv/.txt
  // whose name merely hints (could still be a UBL e-invoice). Drives how tentative the
  // surfaced reason is, so a possible purchase invoice is not flatly called a bankafschrift.
  kind: BankStatementNameKind
}

/**
 * [BIG-MAILBOX] Pick the ceiling of an oldest-anchored listing window so a mailbox with more
 * matching messages than one sync can page still makes progress OLDEST-first, instead of forever
 * re-listing the newest ~cap and freezing the watermark at the floor (the ">cap wall").
 *
 * `list(before)` lists the window [after, before) (before=null ⇒ up to `now`) and reports whether
 * the listing was COMPLETE (reached its natural end) or capped. We first try the full range; when
 * that caps, we binary-search for the LARGEST window [after, ceiling] that lists completely and
 * still contains mail:
 *   · incomplete (still > cap)  → ceiling too high → lower it
 *   · complete but EMPTY        → ceiling below the oldest mail (a gap above the floor) → raise it
 *                                 (this is what a naive "shrink only" would deadlock on)
 *   · complete and NON-EMPTY    → remember it and keep raising to maximise the slice
 * The window is always anchored at `after`, so a non-empty result always contains the OLDEST mail —
 * processing it oldest-first advances the watermark across any empty gap. Only pathological density
 * (> cap within `minWindow` everywhere) finds no slice → we return the full incomplete listing and
 * the caller HOLDS the mark (best effort — never a false "complete" that would skip unlisted mail).
 *
 * Pure except for the injected `list`; unit-tested in email-window.test.ts.
 */
export async function narrowOldestWindow<T>(opts: {
  after: number
  now: number
  minWindow: number
  maxIters: number
  list: (before: number | null) => Promise<{ items: T[]; complete: boolean }>
}): Promise<{ items: T[]; complete: boolean; ceiling: number | null; narrowed: boolean }> {
  const { after, now, minWindow, maxIters, list } = opts
  const first = await list(null)
  if (first.complete) return { items: first.items, complete: true, ceiling: null, narrowed: false }

  let lo = after // [after, lo] is empty / too-small → raise from here
  let hi = now   // [after, hi] is incomplete → lower from here
  let best: { items: T[]; ceiling: number } | null = null
  for (let i = 0; i < maxIters && hi - lo > minWindow; i++) {
    const mid = lo + Math.floor((hi - lo) / 2)
    const probe = await list(mid)
    if (!probe.complete) {
      hi = mid
    } else {
      if (probe.items.length > 0) best = { items: probe.items, ceiling: mid }
      lo = mid // complete (empty or not) → try a larger window
    }
  }
  if (best) return { items: best.items, complete: true, ceiling: best.ceiling, narrowed: true }
  // No complete non-empty slice found (pathological density) → keep the full incomplete listing;
  // the caller holds the watermark, exactly as before this fix.
  return { items: first.items, complete: false, ceiling: null, narrowed: true }
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
  // [BIG-MAILBOX] true when the listing window was narrowed below "now" (a backlog larger than one
  // sync can page) — so mail NEWER than the processed slice is deferred to the next sync. The caller
  // uses it to keep the client auto-continuing instead of stopping between cron cycles.
  windowNarrowed: boolean
  // [EMAIL→BANK] Bank statements seen this fetch (surfaced, never ingested).
  statements: BankStatementRef[]
  // [OVERSIZED-VISIBLE] Attachments skipped for SIZE — surfaced, never downloaded.
  unread: SkippedAttachmentRef[]
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
  // The query (`has:attachment after:… [before:…] in:anywhere -in:sent -in:drafts -in:chats`) is
  // built inside listGmailIds below so the adaptive window can add a `before:` ceiling.

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
  const MAX_PAGES = 40        // 40 × 100 = 4000 messages listable per WINDOW, same ceiling as Outlook
  const MIN_WINDOW_SEC = 60 * 60 // 1h — stop narrowing the window below this (pathological density)
  const MAX_NARROW_ITERS = 20    // hard bound on the halving loop (≈ 40 years → 1h)

  // List UNIQUE message IDs matching the query in (afterDate, beforeSec]. `complete` = the listing
  // reached its natural end; false = it hit MAX_PAGES (the window holds more than one sync can page).
  const listGmailIds = async (
    beforeSec: number | null
  ): Promise<{ ids: Array<{ id: string }>; complete: boolean; pages: number }> => {
    const q =
      `has:attachment after:${afterDate}` +
      (beforeSec != null ? ` before:${beforeSec}` : '') +
      ` in:anywhere -in:sent -in:drafts -in:chats`
    const raw: Array<{ id: string }> = []
    let pageToken: string | null = null
    let page = 0
    let complete = true

    do {
      const url =
        `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
        `?q=${encodeURIComponent(q)}` +
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
        complete = false
        break
      }

      // [BOEK-TRUST] Explicit type — the do/while condition depends on pageToken,
      // which is derived from listData; without an annotation TypeScript reports a
      // circular "implicitly has type any" on the loop variables.
      const listData: { messages?: Array<{ id: string }>; nextPageToken?: string } =
        await listRes.json()
      raw.push(...(listData.messages ?? []))
      pageToken = listData.nextPageToken ?? null
      page++
    } while (pageToken && page < MAX_PAGES)

    if (pageToken && page >= MAX_PAGES) complete = false

    // De-dup by id (defensive; Gmail list is normally unique).
    const seen = new Set<string>()
    const ids: Array<{ id: string }> = []
    for (const m of raw) {
      if (m.id && !seen.has(m.id)) {
        seen.add(m.id)
        ids.push(m)
      }
    }
    return { ids, complete, pages: page }
  }

  // [BIG-MAILBOX] Adaptive oldest-first window (see narrowOldestWindow). Gmail lists NEWEST-first, so
  // when more than MAX_PAGES×PAGE_SIZE messages match, only the newest ~4000 are ever listed and the
  // OLDER tail is never reached — and the oldest-first watermark then freezes at the floor forever.
  const nowSec = Math.floor(Date.now() / 1000)
  const win = await narrowOldestWindow<{ id: string }>({
    after: afterDate,
    now: nowSec,
    minWindow: MIN_WINDOW_SEC,
    maxIters: MAX_NARROW_ITERS,
    list: async (before) => {
      const r = await listGmailIds(before)
      return { items: r.ids, complete: r.complete }
    },
  })
  const messages = win.items
  const listComplete = win.complete
  const windowNarrowed = win.narrowed
  console.log('[BOEK-011] Gmail listing', {
    uniqueMessages: messages.length,
    complete: listComplete,
    windowNarrowed,
    ceiling: win.ceiling != null ? new Date(win.ceiling * 1000).toISOString() : 'now',
  })

  const results: GmailAttachment[] = []
  const statements: BankStatementRef[] = []
  // [OVERSIZED-VISIBLE] Te grote bijlagen: gezien tijdens het ophalen, nooit gedownload.
  const unread: SkippedAttachmentRef[] = []
  let attachmentsOk = true

  // 2. Fetch each message in parallel (max 10 at a time)
  const chunks = chunkArray(messages, 10)
  for (const chunk of chunks) {
    const fetched = await Promise.all(chunk.map(m => fetchMessageAttachments(m.id, accessToken)))
    for (const f of fetched) {
      results.push(...f.items)
      statements.push(...f.statements)
      unread.push(...f.unread)
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

  return { attachments: results, complete: listComplete && attachmentsOk, messageIndex, windowNarrowed, statements, unread }
}

async function fetchMessageAttachments(
  messageId: string,
  accessToken: string
): Promise<{ items: GmailAttachment[]; ok: boolean; statements: BankStatementRef[]; unread: SkippedAttachmentRef[] }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  // [BOEK-011 throttle×watermark] ok:false = this email wasn't fully read; the
  // caller marks the whole fetch incomplete so the watermark holds.
  if (!res.ok) return { items: [], ok: false, statements: [], unread: [] }

  const msg = await res.json()
  const headers: Array<{ name: string; value: string }> = msg.payload?.headers || []

  // [NAN-DATE-GUARD] Case-INsensitive header lookup: RFC 5322 header names are
  // case-insensitive and real senders do emit `date:`/`from:` in lowercase. The
  // old exact match returned '' for those, which fed a NaN timestamp into the
  // watermark walk (hang) and lost the sender fallback.
  const headerVal = (name: string) =>
    headers.find(h => h.name.toLowerCase() === name)?.value || ''
  const subject = headerVal('subject')
  const from = headerVal('from')

  // [WATERMARK-SERVER-TIME] The date this message is FILED under comes from Gmail's own
  // internalDate, not from the `Date:` header.
  //
  // That header is written by whoever sent the mail. The sync watermark walks these dates and
  // stores the newest complete one, and every later sync asks Gmail for mail AFTER it — so one
  // message with a wrong clock moves the mark to wherever its sender said. A marketing e-mail
  // stamped 1 January 2027 does not import one wrong invoice; it stops the mailbox importing
  // ANYTHING for a year and a half, silently, while every sync reports success. It needs no
  // attacker: a misconfigured sending server is enough, and the app cannot tell them apart.
  //
  // internalDate is the timestamp Gmail assigned on receipt, in milliseconds — the exact analogue
  // of receivedDateTime, which the Microsoft path at line ~1266 has always used. The header stays
  // as the fallback for the case where internalDate is absent, and the NaN guard downstream still
  // covers a message with neither.
  const internalMs = Number(msg.internalDate)
  const date = Number.isFinite(internalMs) && internalMs > 0
    ? new Date(internalMs).toISOString()
    : headerVal('date')

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
  // [EMAIL→BANK] Machine-readable bank statements found while walking parts — surfaced,
  // never fetched or ingested (see BankStatementRef). Deduped by filename within a message.
  const statements: BankStatementRef[] = []
  // [OVERSIZED-VISIBLE] Te grote bijlagen: gezien tijdens het ophalen, nooit gedownload.
  const unread: SkippedAttachmentRef[] = []
  const statementSeen = new Set<string>()

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
      if (!mimeType) {
        // [EMAIL→BANK] This attachment is being DROPPED (unreadable MIME — not a pdf/image the
        // classifier can read). If its name looks like a machine-readable bank statement (MT940
        // / CAMT.053 / bank CSV), surface it instead of dropping it silently: the owner learns
        // it arrived (skip-registry row, actionable reason) and can upload it via the reviewed
        // Bank flow. Running INSIDE the null-MIME branch guarantees an importable pdf/image can
        // NEVER be diverted here. Bytes are never fetched; no money is auto-imported.
        const kind = looksLikeBankStatementFile(filename)
        if (kind) {
          if (!statementSeen.has(filename)) {
            statementSeen.add(filename)
            statements.push({ messageId, filename, kind })
          }
          continue
        }
        // [E-FACTUUR-XML] Een .xml kan de factuur ZELF zijn: Peppol/NLCIUS stuurt hem zo, en dat
        // wordt in Nederland verplicht — boven € 800k omzet vanaf 2027, voor iedereen vanaf 2028.
        // De bytes gaan mee; of het echt een e-factuur is, beslist de inhoud verderop en niet de
        // extensie. Parseert hij niet volledig, dan valt hij terug op de melding hieronder.
        if (/\.(?:xml|ubl)$/i.test(filename)) {
          if (p.body?.attachmentId) {
            pending.push({ filename, mimeType: E_INVOICE_XML_MIME, size, attachmentId: p.body.attachmentId })
            continue
          }
          if (p.body?.data) {
            pending.push({ filename, mimeType: E_INVOICE_XML_MIME, size, inlineData: p.body.data })
            continue
          }
        }
        // [OVERSLAG-ZICHTBAAR] Geen afschrift, en ook geen bestand dat wij kunnen openen — een
        // .xlsx, een .heic, een gezipte factuurbundel, een doorgestuurde .eml. Dit was de stilste
        // weg van allemaal: hij viel hier weg zonder één spoor. Wij kunnen het inderdaad niet
        // lezen, maar dat is geen reden om het niet te MELDEN; alleen de eigenaar kan het
        // rechtzetten. Agendaverkeer en handtekeningen blijven stil — zie unreadableFormatReason.
        const unreadableReason = unreadableFormatReason(filename)
        if (unreadableReason) {
          unread.push({ messageId, filename, reason: unreadableReason, kind: 'unreadable-format' })
        }
        continue
      }

      // [BOEK-011 PERF] Same signature/logo pre-filter as Outlook. Gmail's
      // has:attachment already hides most inline images, so this rarely fires
      // here — but keeping both paths identical means consistent behaviour and
      // no surprise if Gmail starts surfacing inline parts.
      // [OVERSLAG-ZICHTBAAR] Eén poort, en zij draagt haar eigen verantwoording. Geeft zij een
      // reden, dan is dit geen ruis maar een bestand dat een factuur kan zijn en dat wij nooit
      // hebben gelezen — meld het. Zwijgt zij, dan is het een logo of een handtekening en blijft
      // het stil, precies zoals het hoort.
      const triage = triageAttachment({ filename, mimeType, size })
      if (!triage.keep) {
        if (triage.reason && triage.kind) {
          unread.push({ messageId, filename, reason: triage.reason, kind: triage.kind })
        }
        continue
      }

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
    pending.map(async (att): Promise<AttachmentFetchResult> => {
      let base64url: string | undefined

      if (att.attachmentId) {
        // Needs a second fetch to get the actual bytes
        try {
          const attRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${att.attachmentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (!attRes.ok) {
            // [ONBEREIKBAAR] Weather or permanence — and the difference is the whole mailbox.
            // Holding the watermark is right for a throttle or a 5xx: the next sync re-lists the
            // same mail and gets the bytes. It is catastrophic for a 404 or a 403, which will fail
            // identically forever: the mark then never advances, and EVERY newer invoice queues
            // behind one attachment nobody can reach — the import goes quiet with no one able to
            // say why. Losing one file loudly beats losing all of them silently.
            const transient = attRes.status === 429 || attRes.status >= 500
            console.error('[ONBEREIKBAAR] Gmail attachment bytes could not be fetched', {
              messageId, filename: att.filename, status: attRes.status, transient,
            })
            return transient ? { kind: 'transient' } : { kind: 'permanent', filename: att.filename }
          }
          const attData = await attRes.json()
          base64url = attData.data as string
        } catch (e) {
          // A network error is weather by definition — nothing was learned about the file.
          console.error('[ONBEREIKBAAR] Gmail attachment fetch threw', {
            messageId, filename: att.filename, error: e instanceof Error ? e.message : String(e),
          })
          return { kind: 'transient' }
        }
      } else {
        base64url = att.inlineData
      }

      // Listed with neither an id nor inline data. Re-asking cannot produce bytes that were never
      // offered, so this is permanent rather than something to hold the mailbox for.
      if (!base64url) return { kind: 'permanent', filename: att.filename }

      // [BOEK-011] base64url → standard base64 — done exactly once, here
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')

      return {
        kind: 'item',
        item: {
          messageId,
          filename: att.filename,
          mimeType: att.mimeType,
          data: base64,
          subject,
          from,
          date,
          size: att.size,
        },
      }
    })
  )

  // [BOEK-011 throttle×watermark] A TRANSIENT failure marks this email incomplete so the watermark
  // holds this round and the next sync tries again.
  // [ONBEREIKBAAR] A PERMANENT one does not hold it — see above — but it is never silent either:
  // it becomes a row in the skipped panel naming the file, so "waar is die factuur gebleven" has an
  // answer instead of an empty list.
  const items: GmailAttachment[] = []
  let allReachable = true
  for (const r of resolved) {
    if (r.kind === 'item') { items.push(r.item); continue }
    if (r.kind === 'transient') { allReachable = false; continue }
    unread.push({
      messageId, filename: r.filename, kind: 'unreachable',
      reason: UNREACHABLE_ATTACHMENT_REASON,
    })
  }
  return { items, ok: allReachable, statements, unread }
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
  // [BIG-MAILBOX] see fetchGmailAttachments — true when a backlog forced a narrowed window.
  windowNarrowed: boolean
  // [EMAIL→BANK] Bank statements seen this fetch (surfaced, never ingested).
  statements: BankStatementRef[]
  // [OVERSIZED-VISIBLE] Attachments skipped for SIZE — surfaced, never downloaded.
  unread: SkippedAttachmentRef[]
}> {
  // Graph wants an ISO 8601 timestamp for the date filter
  const afterIso = new Date(syncAfterMs).toISOString()

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
  const MAX_UNIQUE = 4000    // unique messages listable per WINDOW — the real ceiling
  const MAX_API_CALLS = 200  // safety bound on Graph list calls (folder dupes inflate paging)
  const MIN_WINDOW_MS = 60 * 60 * 1000 // 1h — stop narrowing below this (pathological density)
  const MAX_NARROW_ITERS = 20          // hard bound on the halving loop (≈ 40 years → 1h)

  // List UNIQUE messages in [afterIso, beforeIso). `complete` = the listing reached its natural end;
  // false = it hit the unique/api ceiling (the window holds more than one sync can page).
  const listOutlookMessages = async (
    beforeIso: string | null
  ): Promise<{ messages: OutlookMessage[]; complete: boolean; apiCalls: number }> => {
    const filter =
      `receivedDateTime ge ${afterIso}` +
      (beforeIso != null ? ` and receivedDateTime lt ${beforeIso}` : '')
    const firstUrl =
      `https://graph.microsoft.com/v1.0/me/messages` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$select=id,subject,from,toRecipients,receivedDateTime,hasAttachments` +
      `&$orderby=receivedDateTime desc` +
      `&$top=50`

    const seen = new Set<string>()
    const out: OutlookMessage[] = []
    let nextUrl: string | null = firstUrl
    let apiCalls = 0
    let complete = true

    while (nextUrl && out.length < MAX_UNIQUE && apiCalls < MAX_API_CALLS) {
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
        complete = false
        break
      }

      const listData = await listRes.json()
      // De-duplicate as we page: a folder-view repeat never counts toward MAX_UNIQUE.
      for (const m of ((listData.value || []) as OutlookMessage[])) {
        if (m.id && !seen.has(m.id)) {
          seen.add(m.id)
          out.push(m)
        }
      }
      nextUrl = (listData['@odata.nextLink'] as string | undefined) ?? null
    }

    // Ceiling hit with more pages remaining → this window's older tail wasn't listed.
    if (nextUrl && (out.length >= MAX_UNIQUE || apiCalls >= MAX_API_CALLS)) complete = false
    return { messages: out, complete, apiCalls }
  }

  // [BIG-MAILBOX] Adaptive oldest-first window (see narrowOldestWindow). Graph lists newest-first, so
  // more than MAX_UNIQUE matches would strand the OLDER tail and freeze the oldest-first watermark.
  const nowMs = Date.now()
  const win = await narrowOldestWindow<OutlookMessage>({
    after: syncAfterMs,
    now: nowMs,
    minWindow: MIN_WINDOW_MS,
    maxIters: MAX_NARROW_ITERS,
    list: async (before) => {
      const r = await listOutlookMessages(before != null ? new Date(before).toISOString() : null)
      return { items: r.messages, complete: r.complete }
    },
  })
  const messages = win.items
  const listComplete = win.complete
  const windowNarrowed = win.narrowed
  console.log('[BOEK-011] Outlook listing', {
    uniqueMessages: messages.length,
    complete: listComplete,
    windowNarrowed,
    ceiling: win.ceiling != null ? new Date(win.ceiling).toISOString() : 'now',
  })

  const results: GmailAttachment[] = []
  const statements: BankStatementRef[] = []
  // [OVERSIZED-VISIBLE] Te grote bijlagen: gezien tijdens het ophalen, nooit gedownload.
  const unread: SkippedAttachmentRef[] = []

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
      statements.push(...f.statements)
      unread.push(...f.unread)
      if (!f.ok) attachmentsOk = false
    }
  }

  return { attachments: results, complete: listComplete && attachmentsOk, messageIndex, windowNarrowed, statements, unread }
}

/**
 * [ONBEREIKBAAR] The raw bytes of ONE Graph attachment, and an honest answer when there are none.
 *
 * Used by both paths that need bytes Graph did not inline: a forwarded message (whose MIME is the
 * only way in) and a file attachment large enough that the collection left contentBytes empty.
 * One implementation, so "is this failure worth retrying" cannot be answered two different ways.
 *
 * graphFetch has already waited once on a throttle, so a 429 still standing here is a real one.
 */
async function fetchGraphAttachmentValue(
  messageId: string,
  attachmentId: string,
  accessToken: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; transient: boolean; status: number }> {
  let res: Response
  try {
    res = await graphFetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments/${attachmentId}/$value`,
      accessToken,
    )
  } catch {
    // A network error taught us nothing about the file — weather, by definition.
    return { ok: false, transient: true, status: 0 }
  }
  if (!res.ok) {
    // 429/5xx is weather. Anything else (404 gone, 403 scope, 400 unsupported) fails identically
    // forever, and holding the watermark for it buries every newer invoice behind one file.
    return { ok: false, transient: res.status === 429 || res.status >= 500, status: res.status }
  }
  try {
    return { ok: true, bytes: Buffer.from(await res.arrayBuffer()) }
  } catch {
    return { ok: false, transient: true, status: res.status }
  }
}

/**
 * [DOORGESTUURD] Read the attachments out of an e-mail that arrived as an attachment.
 *
 * Returns what was found, anything the owner must be told about, and whether the failure — if there
 * was one — is worth retrying. That last distinction is the whole safety of this function:
 *
 *   · TRANSIENT (throttled, 5xx, network) → hold the watermark and try again next sync. Saying
 *     anything to the owner now would be guessing about a message nobody has read yet.
 *   · PERMANENT (404, 403, an item type with no MIME form) → holding the watermark would freeze
 *     every NEWER invoice behind a message that will never succeed. So it does not hold: it
 *     reports, and the sync moves on.
 */
async function readEmbeddedMessageAttachments(
  messageId: string,
  att: { id?: string; name?: string; contentType?: string; size?: number },
  accessToken: string,
  takenNames: Set<string>,
): Promise<{
  items: EmbeddedAttachment[]
  from: string | null
  unread: SkippedAttachmentRef[]
  transient: boolean
}> {
  const none = { items: [] as EmbeddedAttachment[], from: null, unread: [] as SkippedAttachmentRef[], transient: false }
  const filename = att.name || 'doorgestuurd bericht'

  // An item attachment is not always a message — a contact card or a calendar item comes through
  // the same door. Only a message has a MIME form worth asking for, and only a message can be
  // hiding an invoice. Graph stamps an attached mail 'message/rfc822'; an empty contentType is
  // treated as a maybe (it costs one call), anything else is genuine mail furniture and stays
  // silent, exactly as it did before.
  const contentType = (att.contentType || '').toLowerCase().trim()
  const looksLikeMessage = contentType === '' || contentType.startsWith('message/')
  if (!looksLikeMessage || !att.id) return none

  // Refuse before downloading. The size is the provider's own number, so nothing is transferred.
  if ((att.size ?? 0) > MAX_EMBEDDED_MESSAGE_BYTES) {
    return {
      ...none,
      unread: [{
        messageId, filename, kind: 'oversized',
        reason: 'een doorgestuurd bericht dat te groot is om automatisch te openen — stuur de ' +
          'bijlage los door, of voeg hem toe bij Uploaden',
      }],
    }
  }

  const value = await fetchGraphAttachmentValue(messageId, att.id, accessToken)
  if (!value.ok) {
    console.error('[DOORGESTUURD] could not read an embedded message', {
      messageId, filename, status: value.status, transient: value.transient,
    })
    if (value.transient) return { ...none, transient: true }
    return {
      ...none,
      unread: [{
        messageId, filename, kind: 'unreadable-format',
        reason: 'een doorgestuurd bericht dat wij niet konden openen — stuur de bijlage los door, ' +
          'of voeg hem toe bij Uploaden',
      }],
    }
  }

  const raw = value.bytes
  // normalizeAttachmentMime is INJECTED, never reimplemented: "which types can we read" must have
  // exactly one answer, or a file is dropped by one door and accounted for by the other.
  const found = extractMimeAttachments(raw, { normalizeMime: normalizeAttachmentMime })
  const items = found.map((f) => ({ ...f, filename: uniqueAttachmentName(f.filename, takenNames) }))

  // Nothing readable inside. Say so only when the paper really was a message: a mis-guessed
  // contact card would otherwise put a line in the panel about something that was never an
  // invoice, and a panel full of those is a panel nobody opens.
  const unread: SkippedAttachmentRef[] =
    items.length === 0 && contentType.startsWith('message/')
      ? [{
          messageId, filename, kind: 'unreadable-format',
          reason: 'een doorgestuurd bericht zonder bijlage die wij konden lezen — zat de factuur ' +
            'in de tekst van de mail, stuur hem dan als PDF door',
        }]
      : []

  return { items, from: mimeHeader(raw, 'from'), unread, transient: false }
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
): Promise<{ items: GmailAttachment[]; ok: boolean; statements: BankStatementRef[]; unread: SkippedAttachmentRef[] }> {
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
    return { items: [], ok: false, statements: [], unread: [] }
  }

  const attData = await attRes.json()
  const attachments: Array<{
    '@odata.type'?: string
    // [DOORGESTUURD] The attachment's own id — needed to ask Graph for the raw MIME of an
    // embedded message, which is the only way its bytes are reachable at all.
    id?: string
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
  // [EMAIL→BANK] Bank statements seen on this message — surfaced, never fetched/ingested.
  const statements: BankStatementRef[] = []
  // [OVERSIZED-VISIBLE] Te grote bijlagen: gezien tijdens het ophalen, nooit gedownload.
  const unread: SkippedAttachmentRef[] = []
  const statementSeen = new Set<string>()
  // [DOORGESTUURD] Flipped when a TRANSIENT failure means this message was not fully read. It
  // travels out as `ok`, which holds the watermark so the next sync tries again — the same
  // contract a failed file-byte fetch already has.
  let ok = true

  // [DOORGESTUURD] Names already claimed by this message, so two forwarded originals that both
  // call their invoice "factuur.pdf" do not collapse into one dedup key — see uniqueAttachmentName.
  const takenNames = new Set<string>()
  for (const a of attachments) if (a.name) takenNames.add(a.name)

  for (const att of attachments) {
    // [DOORGESTUURD] An e-mail forwarded as an attachment. Graph returns it as an itemAttachment
    // with NO contentBytes, and the line below dropped it on that basis — so for an Outlook user
    // the most ordinary way an invoice reaches a bookkeeper produced nothing at all: no row, no
    // file, no notification, not even a skip-registry entry. Gmail never had this hole; its payload
    // nests the forwarded message's parts and the walk above descends into them.
    //
    // Graph will hand over the embedded item's raw MIME, so this fetches that and reads the
    // attachments out of it. Every one of them then goes through the SAME gate as any other
    // attachment — no shortcut, no second rulebook.
    if (att['@odata.type'] === '#microsoft.graph.itemAttachment') {
      const embedded = await readEmbeddedMessageAttachments(message.id, att, accessToken, takenNames)
      if (embedded.transient) {
        // A throttle or a server error: hold the watermark and let the next sync try again, exactly
        // as a failed file fetch does. Never a skip row — nothing is known yet.
        ok = false
        continue
      }
      for (const found of embedded.items) {
        // The SAME gate as any other attachment, and it is not decoration: a forwarded mail carries
        // the original's signature logos too, and its PDF can be over the ceiling. Skipping the
        // gate here would let a 3 KB logo cost an AI call and a 15 MB file past a limit every other
        // door enforces — a second rulebook for one door, which is how doors drift apart.
        const triage = triageAttachment({
          filename: found.filename, mimeType: found.mimeType, size: found.size,
        })
        if (!triage.keep) {
          if (triage.reason && triage.kind) {
            unread.push({
              messageId: message.id, filename: found.filename,
              reason: triage.reason, kind: triage.kind,
            })
          }
          continue
        }
        out.push({
          messageId: message.id,
          filename: found.filename,
          mimeType: found.mimeType,
          data: found.base64,
          subject: message.subject || '',
          // The SENDER of the forwarded message, not the person who forwarded it. The outer mail is
          // often from the owner's own address; attributing the supplier's invoice to that puts the
          // wrong e-mail on the crediteur and makes a sender rule for the real supplier miss.
          from: embedded.from || from,
          // The OUTER date on purpose: this is when the mail entered the mailbox, which is what the
          // watermark walk and the import ordering are built on. The invoice's own date comes off
          // the document.
          date: message.receivedDateTime || new Date().toISOString(),
          size: found.size,
        })
      }
      unread.push(...embedded.unread)
      continue
    }

    // Only file attachments carry contentBytes.
    if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue

    const rawMime = att.contentType || ''
    const filename = att.name || ''
    if (!filename) continue

    // [H2] Same mislabelled-MIME recovery as Gmail — a real PDF/image sent with a generic
    // content-type is normalised by extension instead of being dropped unseen.
    const mimeType = normalizeAttachmentMime(rawMime, filename)
    if (!mimeType) {
      // [EMAIL→BANK] Being dropped (unreadable MIME). Surface a machine-readable bank statement
      // (MT940 / CAMT.053 / bank CSV) instead of losing it silently. Inside the null-MIME branch
      // so an importable pdf/image can never be diverted; bytes are never used, no auto-import.
      const kind = looksLikeBankStatementFile(filename)
      if (kind) {
        if (!statementSeen.has(filename)) {
          statementSeen.add(filename)
          statements.push({ messageId: message.id, filename, kind })
        }
        continue
      }
      // [E-FACTUUR-XML] Zie de Gmail-tak: een .xml kan de factuur zelf zijn (Peppol/NLCIUS).
      // Alleen wanneer de INHOUD er ook naar uitziet — hier zijn de bytes al binnen, dus die
      // vraag kost niets en een CAMT-afschrift dat de naamtest overleefde valt er alsnog af.
      if (/\.(?:xml|ubl)$/i.test(filename) && att.contentBytes) {
        const xml = Buffer.from(att.contentBytes, 'base64').toString('utf8')
        if (looksLikeInvoiceXml(xml)) {
          out.push({
            messageId: message.id, filename, mimeType: E_INVOICE_XML_MIME,
            data: att.contentBytes, subject: message.subject || '', from,
            date: message.receivedDateTime || new Date().toISOString(), size: att.size || 0,
          })
          continue
        }
      }
      // [OVERSLAG-ZICHTBAAR] Zie de Gmail-tak: een formaat waar wij geen lezer voor hebben wordt
      // gemeld in plaats van weggegooid; agendaverkeer en handtekeningen blijven stil.
      const unreadableReason = unreadableFormatReason(filename)
      if (unreadableReason) {
        unread.push({
          messageId: message.id, filename, reason: unreadableReason, kind: 'unreadable-format',
        })
      }
      continue
    }

    // [BOEK-011 PERF] Drop signature/logo images before they cost a Claude call.
    // Conservative: PDFs always pass, only tiny/chrome-named images are dropped.
    // [OVERSLAG-ZICHTBAAR] Zie de Gmail-tak: één poort, en zij draagt haar eigen verantwoording.
    const triage = triageAttachment({ filename, mimeType, size: att.size || 0 })
    if (!triage.keep) {
      if (triage.reason && triage.kind) {
        unread.push({ messageId: message.id, filename, reason: triage.reason, kind: triage.kind })
      }
      continue
    }

    // [ONBEREIKBAAR] Graph does not always inline the bytes: a large attachment comes back with
    // its name, type and size, and contentBytes empty. This used to be `if (!att.contentBytes)
    // continue` at the very top of the loop — a purchase invoice listed in full and dropped for
    // the one field the provider chose not to send, leaving nothing anywhere in the app.
    //
    // The bytes are one call away, and it is the same call the forwarded-message path makes. It
    // sits HERE, below every filter, on purpose: fetching before them would download the logos and
    // the oversized files we are about to refuse — the pre-filter exists precisely to avoid that.
    let contentBytes = att.contentBytes
    if (!contentBytes) {
      if (!att.id) {
        unread.push({
          messageId: message.id, filename,
          kind: 'unreachable', reason: UNREACHABLE_ATTACHMENT_REASON,
        })
        continue
      }
      const value = await fetchGraphAttachmentValue(message.id, att.id, accessToken)
      if (!value.ok) {
        // Weather holds the watermark; permanence reports and lets the mail move on. Holding for a
        // 404 would freeze every newer invoice behind one file nobody can reach.
        if (value.transient) { ok = false; continue }
        unread.push({
          messageId: message.id, filename,
          kind: 'unreachable', reason: UNREACHABLE_ATTACHMENT_REASON,
        })
        continue
      }
      contentBytes = value.bytes.toString('base64')
    }

    out.push({
      messageId: message.id,
      filename,
      mimeType,
      data: contentBytes, // already standard base64 — no conversion needed
      subject: message.subject || '',
      from,
      date: message.receivedDateTime || new Date().toISOString(),
      size: att.size || 0,
    })
  }

  return { items: out, ok, statements, unread }
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
  // [BON-EMAIL] The payment signals. The reader has always produced them — ai.ts asks for them by
  // name — and this mapper dropped all five, so the sync could not tell a kassabon from a bill and
  // booked money already spent as money still owed. paymentSuggestion() reads them; see its header.
  isPaid?: boolean
  paidMethod?: 'bank' | 'kas' | 'pin' | null
  paidDate?: string | null
  paidEvidence?: string | null
  paidCardLast4?: string | null
  // [BRIDGE-EXTRACT] per-field AI confidence (vendor/number/date)
  fieldConfidence?: {
    vendor?: number
    invoice_number?: number
    invoice_date?: number
    amount?: number
    // [BTW-SUM-FIX] Note left by the extractor when the BTW had to be derived from excl + total
    // because the mixed-rate summary block could not be summed. Carried through to
    // field_confidence so import-health can ask the owner to confirm the figure.
    _btw_derived?: { read: number | null; used: number | null }
    // [BTW-SPLIT] / [PRINTED-TOTAL] The evidence a mixed-rate invoice needs, from the same reader
    // call. Declared here because the value is spread into field_confidence further down: without
    // these keys the type says they are gone while at runtime they are not, and the next person to
    // read this block would have no way to know the checklist depends on them.
    _btw_rows?: { rate: number; base: number; btw: number }[]
    _total_printed?: number | null
    _total_derived?: 'total' | 'excl'
    /**
     * [E-FACTUUR-XML] The supplier's own structured figures, when the document carried them.
     * Declared rather than cast in: a type that hides a key the database already holds pushes
     * every caller into a cast, and a cast is where validation stops happening.
     */
    _einvoice?: Record<string, unknown>
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
  // [REREAD-STRONG] Optional read-strategy override. The automatic sync passes nothing (default
  // model, flattened-text path). The manual "Opnieuw inlezen" passes preferRawPdf so a stuck complex
  // invoice is re-read on the real page layout instead of flattened text (same model as the sync).
  // [RECEIVER-IDENTITY] receiverKvk/Btw/Iban = OUR own legal numbers, so the AI can tell ours from
  // the vendor's and never return ours as the vendor.
  opts?: {
    model?: string; preferRawPdf?: boolean
    receiverKvk?: string | null; receiverBtw?: string | null; receiverIban?: string | null
    // [READING-MEMORY] Rendered once by the caller — see the sync run and the re-read route.
    readingHint?: string | null
  }
): Promise<AttachmentClassification> {
  // [E-FACTUUR-XML] A Peppol invoice arriving as XML is read by verifyInvoiceFromPdf itself, with
  // no model involved. It used to be intercepted HERE, which made the e-mail sync the only door
  // that could read one: the same file uploaded by hand was filed as "a format we cannot read".
  // One reader, both doors — so there is nothing left to do at this one.
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
    readingHint: opts?.readingHint,
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
    // [BON-EMAIL] Verbatim from the same Claude call the camera path uses — including the printed
    // tender line, which outranks the model's own opinion about whether it was settled.
    isPaid: result.is_paid,
    paidMethod: result.paid_method ?? null,
    paidDate: result.paid_date ?? null,
    paidEvidence: result.paid_evidence ?? null,
    paidCardLast4: result.paid_card_last4 ?? null,
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

/**
 * [DOORGESTUURD] How much raw MIME we are willing to pull down for ONE embedded message.
 *
 * Not simply the 10 MB attachment ceiling: MIME carries binaries as base64, which is four bytes on
 * the wire for every three of file. A forwarded mail holding a 9 MB PDF is about 12 MB of MIME, and
 * measuring the envelope against the file's limit would refuse an attachment that fits. So the
 * ceiling is the attachment ceiling grown by that ratio, plus room for headers and a covering note.
 * Every extracted file is still measured on its OWN decoded size by the ordinary gate.
 */
const MAX_EMBEDDED_MESSAGE_BYTES = Math.ceil((MAX_EMAIL_ATTACHMENT_BYTES * 4) / 3) + 256 * 1024

// [H2] A real supplier invoice often arrives with a CORRECT filename but a WRONG or
// generic MIME type — many mail servers stamp attachments application/octet-stream (or an
// empty type). The old MIME gate then dropped a genuine `factuur.pdf` silently. Trust the
// filename extension in that case and return the media type verifyInvoiceFromPdf can read
// (application/pdf or an image/*), or null when it is a type we cannot classify — the
// caller then leaves it for the could-not-read / skip path rather than losing it unseen.
export function normalizeAttachmentMime(mimeType: string, filename: string): string | null {
  const mt = (mimeType || "").toLowerCase()
  if (mt === "application/pdf") return "application/pdf"
  if (mt.startsWith("image/")) {
    // [SECURITY] Block SVG: an SVG is XML that can embed <script>, so storing one and later serving
    // it inline (a signed Storage URL the browser opens) is a stored-XSS vector — and Claude can't
    // read it as an invoice anyway. Match the BASE type (strip any `;charset=`/`;name=` parameters)
    // and every svg spelling, so `image/svg+xml; charset=utf-8` can't slip past. Other image/*
    // (incl. heic/tiff/bmp) are binary rasters: not script-capable, and an unreadable one still
    // reaches the visible could-not-read path, so the broad passthrough is preserved for them.
    const base = mt.split(";")[0].trim()
    if (base.startsWith("image/svg")) return null
    return mt
  }
  // Wrong/generic MIME → infer from the extension. Only the types the classifier reads.
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "")
  if (ext === "pdf") return "application/pdf"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  // [SECURITY] Never infer svg from a spoofed/generic MIME + .svg name either.
  return null
}

/**
 * [OVERSLAG-ZICHTBAAR] Waarom is deze bijlage NIET meegenomen — en moet de eigenaar dat weten?
 *
 * Elke weigering hieronder valt in precies één van twee bakken, en het verschil is het hele punt:
 *
 *   · RUIS — "dit is een handtekening, een logo, een tracking-pixel, een agenda-uitnodiging".
 *     Daar hoort niemand iets van te horen. Er elke keer een regel over schrijven maakt het
 *     overgeslagen-paneel onleesbaar, en een paneel dat niemand meer opent meldt niets meer.
 *   · EEN BESTAND DAT EEN FACTUUR KAN ZIJN — te groot, te klein, of een formaat waar hier geen
 *     lezer voor is. Wij hebben het nooit gelezen; het kan de grootste inkoopfactuur van het
 *     kwartaal zijn geweest. Dat MOET de eigenaar horen, want alleen hij kan het rechtzetten.
 *
 * De tweede bak verdween tot nu toe met exact dezelfde stille `false` als een logo, waarna het
 * overgeslagen-paneel — de enige plek waar de app toegeeft dat er iets binnenkwam dat zij niet las
 * — "Niets overgeslagen" meldde. Dat is de zin die een ondernemer laat ophouden met zoeken.
 */
export type AttachmentSkipKind =
  /** Boven de 10 MB: nooit opgehaald, nooit bekeken. */
  | 'oversized'
  /** Een afbeelding die te klein is voor leesbare tekst, maar geen herkenbare e-mailruis. */
  | 'too-small'
  /** Een bestandstype waar in deze app geen lezer voor bestaat (.xlsx, .docx, .zip, .eml …). */
  | 'unreadable-format'
  /**
   * [ONBEREIKBAAR] De provider liet de bijlage zien maar gaf de bytes niet — en zal dat blijven
   * doen (404/403). Anders dan de rest is dit geen oordeel OVER het bestand: wij hebben het nooit
   * gezien. Precies daarom moet het gemeld worden en niet stil de wachtrij blokkeren.
   */
  | 'unreachable'

export interface AttachmentTriage {
  /** Ophalen en door de classificatie halen. */
  keep: boolean
  /** Nederlands, voor de eigenaar. null ⇒ met opzet stil: dit is e-mailruis. */
  reason: string | null
  /** null wanneer er niets te melden valt. */
  kind: AttachmentSkipKind | null
}

/** Alles wat wél binnenkwam maar niet gelezen is, reist hier langs. */
const KEEP: AttachmentTriage = { keep: true, reason: null, kind: null }
const SILENT: AttachmentTriage = { keep: false, reason: null, kind: null }

/**
 * Automatisch gegenereerde namen van mailprogramma's — e-mailruis, en niets anders.
 *
 * 🔴 VERANKERD, geen substring. Elk patroon matcht de HELE bestandsnaam (^…$), zodat de factuur
 * van "Iconic Foods" niet op de 'icon'-regel sneuvelt en "banner-print-invoice.png" niet op
 * 'banner'. Alleen bestanden waarvan de hele naam het ruispatroon ís, vallen af.
 */
const CHROME_EXACT_PATTERNS = [
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

/** De naam zonder extensie, kleingeletterd — waar de ruispatronen op matchen. */
function attachmentBaseName(filename: string): string {
  return filename.toLowerCase().trim().replace(/\.[a-z0-9]{1,5}$/i, '')
}

function looksLikeMailChrome(filename: string): boolean {
  const base = attachmentBaseName(filename)
  return CHROME_EXACT_PATTERNS.some((re) => re.test(base))
}

/**
 * Onder deze grens kán er geen leesbaar document in zitten — in geen enkel formaat. Een
 * tracking-pixel is 43 bytes, een JPEG-kop alleen al zo'n 600. Hier zwijgen wij dus, en dat is
 * geen smaak maar natuurkunde: wie hierover een regel schrijft, schrijft over niets.
 */
const SILENT_IMAGE_BYTES = 2 * 1024

/**
 * Boven SILENT_IMAGE_BYTES en hieronder: te klein om te vertrouwen, te groot om te negeren.
 *
 * 12 KB, met opzet heel laag. Een leesbare bonfoto van één pagina — ook een gecomprimeerde
 * thermische of zwart-witscan — zit daar comfortabel boven. Liever een grensgeval van 15 KB naar
 * Claude dan een echte kleine bon weggooien. En wat hier wél afvalt, wordt vanaf nu GEMELD in
 * plaats van weggegooid: een bon van 8 KB is zeldzaam, maar hij bestaat, en dan is het paneel het
 * enige spoor dat hij er ooit was.
 */
const TINY_IMAGE_BYTES = 12 * 1024

/**
 * De ENIGE poort. `isLikelyInvoiceCandidate` en `attachmentSkipReason` leiden hier allebei van af,
 * zodat het besluit en de verantwoording ervan nooit uit elkaar kunnen lopen.
 */
export function triageAttachment(att: {
  filename: string
  mimeType: string
  size: number
}): AttachmentTriage {
  // [M1] Bovengrens eerst — geldt voor PDF's en afbeeldingen gelijk. Een door de provider gemelde
  // omvang boven de grens valt af VÓÓRDAT wij de bytes ophalen (geen download, geen Storage, geen
  // AI). size===0 betekent "onbekend" en wordt verderop op de echte bytelengte afgevangen.
  if (att.size > MAX_EMAIL_ATTACHMENT_BYTES) {
    return {
      keep: false,
      kind: 'oversized',
      // De boodschap noemt de uitweg die er echt is. "Voeg hem handmatig toe" zou de eigenaar
      // tegen dezelfde 10 MB-muur bij Uploaden sturen.
      reason: 'te groot om automatisch te lezen (max 10 MB) — splits de PDF of maak er een foto van',
    }
  }

  // PDF's gaan altijd door — het sterkste factuursignaal, nooit op omvang of naam gefilterd.
  if (att.mimeType === 'application/pdf') return KEEP

  // Niet-afbeelding, niet-PDF hoort hier niet te komen (de fetchers filteren al op MIME); als het
  // toch gebeurt, is het geen factuur die wij kunnen lezen.
  if (!att.mimeType.startsWith('image/')) return SILENT

  // Vanaf hier: een afbeelding.
  //
  // ── DE VOLGORDE IS DE HELE TRUC ──
  // De naamregel staat nu VÓÓR de omvangregel, en dat verandert geen enkele import: beide
  // weigeren, dus de verzameling bestanden die doorgaat is bit voor bit dezelfde. Wat het wél
  // verandert is de VERANTWOORDING. Andersom viel elk logo van 3 KB op de omvangregel, en zou het
  // melden van die regel het paneel volgooien met veertig handtekeningen — waarna niemand er meer
  // naar kijkt en de ene echte bon ertussen onvindbaar is. Ruis eerst wegnemen, dán melden wat
  // overblijft.
  if (looksLikeMailChrome(att.filename)) return SILENT

  // (size===0 = "onbekend" bij de provider → NIET op omvang filteren → gaat door.)
  if (att.size > 0 && att.size < SILENT_IMAGE_BYTES) return SILENT
  if (att.size > 0 && att.size < TINY_IMAGE_BYTES) {
    return {
      keep: false,
      kind: 'too-small',
      reason: 'te klein om te kunnen lezen (kleiner dan 12 KB) — is dit toch een bon, voeg hem dan toe bij Uploaden',
    }
  }

  // Twijfel → houden. Een grotere, normaal genoemde afbeelding kan een gefotografeerde factuur
  // zijn; Claude mag het oordelen. Liever een verspilde AI-aanroep dan een verloren factuur.
  return KEEP
}

/**
 * Bestandstypen die als bijlage horen bij e-mail zelf, niet bij de boekhouding. Hierover zwijgen
 * wij, want een regel per agenda-uitnodiging is precies hoe het paneel onbruikbaar wordt.
 *
 * `.svg` staat er met opzet bij: normalizeAttachmentMime weigert die om veiligheidsredenen
 * (script-in-XML), en vrijwel elke handtekening bevat er één.
 */
const SILENT_MAIL_FORMATS = new Set([
  'ics', 'ical', 'vcf', 'vcard',        // agenda-uitnodigingen en contactkaarten
  'p7s', 'p7m', 'pgp', 'asc', 'sig',    // handtekening- en versleutelingsenveloppen
  'dat',                                 // winmail.dat — de TNEF-verpakking van Outlook
  'svg',                                 // handtekeninglogo's; wordt bewust geweigerd
  'txt',                                 // de tekstversie van de mail, door sommige clients bijgevoegd
  'mso',                                 // oledata.mso en familie
])

/**
 * [OVERSLAG-ZICHTBAAR] Een bijlage die de app niet eens kán openen — moet de eigenaar dat horen?
 *
 * Deze weg werd het stilst van allemaal afgelopen: een `factuur.xlsx`, een `bon.heic`, een
 * gezipte factuurbundel of een doorgestuurde `.eml` valt bij normalizeAttachmentMime op `null` en
 * verdween dan zonder enig spoor. Wij kunnen die bestanden inderdaad niet lezen — maar "niet
 * kunnen lezen" en "niet melden" zijn twee verschillende dingen, en alleen de eigenaar kan er iets
 * aan doen.
 *
 * Standaard dus MELDEN, en alleen zwijgen over wat aantoonbaar bij de mail hoort. Die kant op, en
 * niet andersom: een lijst van "wat is een factuur" raadt altijd verkeerd, een lijst van "wat is
 * agendaverkeer" is eindig en te controleren.
 *
 * Retourneert de Nederlandse reden, of null wanneer er niets te melden valt.
 */
export function unreadableFormatReason(filename: string): string | null {
  const name = (filename || '').toLowerCase().trim()
  if (!name) return null
  // Automatisch gegenereerde namen zijn ruis, ongeacht de extensie (ATT00001.txt, image001.svg).
  if (looksLikeMailChrome(name)) return null
  const ext = name.match(/\.([a-z0-9]{1,5})$/)?.[1] ?? ''
  // Zonder extensie valt er niets zinnigs over te zeggen; een regel "onbekend bestand" helpt
  // niemand vooruit.
  if (!ext) return null
  if (SILENT_MAIL_FORMATS.has(ext)) return null
  return `.${ext} kunnen wij niet automatisch lezen — is dit een factuur, bewaar hem dan als PDF ` +
    'of maak er een foto van en voeg die toe bij Uploaden'
}

/**
 * De reden waarom deze bijlage niet is meegenomen, of null wanneer er niets te melden valt.
 * Afgeleid van triageAttachment — één poort, één waarheid.
 */
export function attachmentSkipReason(att: {
  filename: string
  mimeType: string
  size: number
}): string | null {
  return triageAttachment(att).reason
}

/** Doorlaten of niet. Afgeleid van triageAttachment — zie daar voor de redenen. */
export function isLikelyInvoiceCandidate(att: {
  filename: string
  mimeType: string
  size: number
}): boolean {
  return triageAttachment(att).keep
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
  // [AUTO-ADVANCE-HONESTY] Subset of `saved` that the app verified AND booked itself
  // (status 'received'). These are NOT in the verify queue — they are on Inkoopfacturen.
  // Every caller that reports "X geïmporteerd" must read this, or it tells the owner to
  // go confirm invoices that no longer need confirming.
  autoAdvanced: number
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
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, autoAdvanced: 0, errors: 1, remaining: 0, skipped: 0, couldNotRead: 0, balance: { fetched: 0, imported: 0, skipped: 0, couldNotRead: 0, duplicate: 0, pending: 0, balanced: true } }
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
  // [BIG-MAILBOX] true when the provider narrowed its window because the backlog is larger than one
  // sync can page — i.e. mail newer than this run's slice is still waiting. Surfaced in `remaining`
  // so the client's auto-continue keeps going instead of stopping between cron cycles.
  let windowNarrowed = false
  // [EMAIL→BANK] Bank statements seen this fetch. Handled OUTSIDE the invoice balance math
  // (they were never invoice candidates): recorded in the skip registry so the owner is told
  // to upload them at Bank, never auto-ingested. See the statement-surface block after fetch.
  let statements: BankStatementRef[] = []
  // [OVERSIZED-VISIBLE] Bijlagen die op OMVANG zijn geweigerd. Net als de afschriften hierboven
  // buiten de facturen-balansrekening gehouden: ze zijn nooit een kandidaat geweest.
  let unread: SkippedAttachmentRef[] = []
  try {
    if (tokens.provider === 'gmail') {
      const r = await fetchGmailAttachments(accessToken, syncAfterMs)
      attachments = r.attachments
      fetchComplete = r.complete
      messageIndex = r.messageIndex
      windowNarrowed = r.windowNarrowed
      statements = r.statements
      unread = r.unread
    } else if (tokens.provider === 'outlook') {
      // [BOEK-011] Outlook via Microsoft Graph — same GmailAttachment shape,
      // so the save loop below is unchanged and provider-agnostic.
      const r = await fetchOutlookAttachments(accessToken, syncAfterMs, undefined, tokens.email)
      attachments = r.attachments
      fetchComplete = r.complete
      messageIndex = r.messageIndex
      windowNarrowed = r.windowNarrowed
      statements = r.statements
      unread = r.unread
    }
  } catch (error) {
    console.error('[BOEK-011] Fetch failed:', error)
    return { provider: tokens.provider, fetched: 0, verified: 0, saved: 0, autoAdvanced: 0, errors: 1, remaining: 0, skipped: 0, couldNotRead: 0, balance: { fetched: 0, imported: 0, skipped: 0, couldNotRead: 0, duplicate: 0, pending: 0, balanced: true } }
  }

  // [MAILTEKST] The invoices that never had an attachment. A separate, bounded pass appended to
  // the same list, so everything downstream — dedup, classifier, health gates, queue, storage —
  // treats them exactly like any other attachment and needs no new case.
  //
  // Deliberately OUTSIDE the watermark walk: these messages are not added to messageIndex, so the
  // guarantee that no ATTACHMENT is skipped cannot be weakened by anything that happens here. A
  // failure in this pass leaves the main import precisely as it was.
  //
  // Appended AFTER the fetch-failure return above, so a broken attachment fetch is still reported
  // as a broken fetch rather than being papered over by whatever the body scan found.
  let bodyScanned = 0
  let bodyCapped = false
  if (accessToken) {
    const body = await fetchBodyOnlyInvoices(tokens.provider, accessToken, syncAfterMs, tokens.email ?? null)
    bodyScanned = body.scanned
    bodyCapped = body.capped
    if (body.items.length > 0) {
      console.log('[MAILTEKST] body-only invoice candidates', {
        scanned: body.scanned, candidates: body.items.length, capped: body.capped,
      })
      attachments = [...attachments, ...body.items]
    }
  }

  // [EMAIL→BANK] Surface any machine-readable bank statements (MT940 / CAMT.053 / bank CSV)
  // seen in this fetch. These are NOT invoices and are NEVER auto-imported — booking bank
  // money stays a reviewed, explicit action on the Bank page (locked constraint #4: money
  // moves only on explicit human action). Dropping them silently (the prior behaviour) meant
  // the owner never learned the statement arrived. So we record each in the skip registry —
  // it then appears in "Overgeslagen bij import" with an actionable reason — and notify ONCE
  // per newly-seen statement so it isn't a passive list the owner must remember to open.
  //
  // Deliberately OUTSIDE the invoice balance math below: a statement was never an invoice
  // candidate (it never entered `attachments`), so it must not inflate `fetched` or the
  // balanced() reconciliation. The upsert is idempotent (unique user+message key), so a
  // re-sync of the same email neither duplicates the row nor re-notifies.
  // [OVERSLAG-ZICHTBAAR] Bijlagen die wij hebben ZIEN binnenkomen en NIET hebben gelezen: te groot
  // (nooit opgehaald), te klein om te vertrouwen, of een formaat waar hier geen lezer voor is.
  // Alle drie verdwenen met exact dezelfde stille weigering als een logo of een handtekening,
  // waardoor het overgeslagen-paneel — de enige plek waar de app toegeeft dat er iets binnenkwam
  // dat zij niet las — "Niets overgeslagen" meldde. Dat is de zin die een ondernemer laat ophouden
  // met zoeken, en het kan de grootste inkoopfactuur van het kwartaal zijn geweest.
  //
  // Zelfde behandeling als de bankafschriften hierboven: idempotente upsert in de skip-registratie,
  // buiten de facturen-balansrekening (ze waren nooit een kandidaat). De bytes blijven ongelezen.
  if (unread.length > 0) {
    const unreadSeen = new Set<string>()
    for (const ov of unread) {
      const key = `${ov.messageId}:${ov.filename}`
      if (unreadSeen.has(key)) continue
      unreadSeen.add(key)
      try {
        const { data: inserted } = await supabase
          .from('email_skipped_attachments')
          .upsert(
            { user_id: userId, source_message_id: key, filename: ov.filename, reason: ov.reason.slice(0, 200) },
            { onConflict: 'user_id,source_message_id', ignoreDuplicates: true },
          )
          .select('id')
        // Eén melding per nieuw bestand, en alleen voor een te grote PDF: een 15 MB brochure of
        // productfoto hoort niet te piepen, een te grote factuur wel. De registratieregel komt er
        // hoe dan ook, dus in het paneel staat álles — de melding is alleen de duw.
        //
        // [OVERSLAG-ZICHTBAAR] Op `kind`, niet op de tekst van de reden. Sinds er ook te kleine
        // afbeeldingen en onleesbare formaten in deze lijst zitten, zou "meld elke PDF" een .pdf
        // van 8 KB aankondigen als "groter dan 10 MB" — een melding die liegt is erger dan geen.
        if (inserted && inserted.length > 0 && ov.kind === 'oversized' && /\.pdf$/i.test(ov.filename)) {
          await createNotification({
            userId,
            title: 'Bijlage te groot om te lezen',
            body: `"${ov.filename}" is groter dan 10 MB en is daarom niet automatisch ingelezen. Splits de PDF, of maak er een foto van en voeg die toe bij Uploaden.`,
            type: 'status',
            link: '/dashboard/upload',
          })
        }
      } catch (e) {
        // Non-fataal: het melden van een overgeslagen bijlage mag de facturen-sync nooit breken.
        console.error('[OVERSLAG-ZICHTBAAR] skip surface failed (non-fatal)', {
          key,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  if (statements.length > 0) {
    const surfacedSeen = new Set<string>()
    for (const st of statements) {
      const key = `${st.messageId}:${st.filename}`
      if (surfacedSeen.has(key)) continue
      surfacedSeen.add(key)
      // Honesty by confidence tier: a bank-statement-specific extension (.sta/.camt/…) is named
      // plainly; a generic .xml/.csv whose name merely hints stays tentative — it could be a UBL
      // e-invoice with real voorbelasting, so we must not flatly call it a bankafschrift.
      const reason =
        st.kind === 'certain'
          ? 'bankafschrift ontvangen — upload het bij Bank om je transacties te importeren'
          : 'mogelijk bankafschrift of e-factuur — als het een afschrift is, upload het bij Bank'
      const notifBody =
        st.kind === 'certain'
          ? `"${st.filename}" lijkt een bankafschrift. Bankgegevens worden niet automatisch uit e-mail geïmporteerd — upload het bestand bij Bank om je transacties veilig in te lezen.`
          : `"${st.filename}" lijkt een bankafschrift of e-factuur, maar kon niet automatisch worden gelezen. Controleer het: is het een afschrift, upload het dan bij Bank.`
      try {
        const { data: inserted } = await supabase
          .from('email_skipped_attachments')
          .upsert(
            {
              user_id: userId,
              source_message_id: key,
              filename: st.filename,
              reason,
            },
            { onConflict: 'user_id,source_message_id', ignoreDuplicates: true },
          )
          .select('id')
        // Notify only when the row was NEWLY inserted (ignoreDuplicates returns [] on conflict),
        // so the owner is nudged exactly once per statement — never nagged on every sync.
        if (inserted && inserted.length > 0) {
          await createNotification({
            userId,
            title: st.kind === 'certain' ? 'Bankafschrift ontvangen via e-mail' : 'Mogelijk bankafschrift via e-mail',
            body: notifBody,
            type: 'status',
            link: '/dashboard/bank',
          })
        }
      } catch (e) {
        // Non-fatal: surfacing a statement must never break the invoice sync. Logged so a
        // persistent failure is visible rather than a silent swallow.
        console.error('[EMAIL→BANK] statement surface failed (non-fatal)', {
          key,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
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
  // [BANK-LINK] Count of invoices that auto-advanced straight to 'received' this run.
  // Only a 'received' invoice is matchable by the bank engine (EXCLUDED_STATUSES bars
  // 'processing'), so we only bother running the linker post-loop when this is > 0.
  let autoAdvanced = 0
  // [BON-AUTO] Heeft deze run minstens één kassabon CONTANT afgeboekt? Een 'kas'-betaling is een
  // gedateerde regel in het kasboek, en die moet worden bijgewerkt — maar één keer na afloop, niet
  // per bon: reconcileCashSettlements loopt de hele administratie langs, dus per factuur aanroepen
  // is dezelfde uitkomst tegen n keer de kosten.
  let cashSettledThisRun = false

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
    // [MODEL-OUTAGE] configOutage = an APP-WIDE model/config error (invalid CLAUDE_MODEL → 404,
    // auth/permission), always an outage-hold. transientError = a capacity/network error (529/5xx/
    // 429/network) which is an outage-hold ONLY when the whole batch is failing (decided post-map) —
    // a lone transient failure still poison-pills so one stuck file can't freeze the watermark.
    // (This supersedes main's single `modelError` field — configOutage uses the identical regex and
    // transientError adds the capacity-outage case, so no case main handled is lost.)
    configOutage?: boolean
    transientError?: boolean
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

  // [AFZENDERREGEL] De eigen regels van de eigenaar: adressen waarvan hij zelf heeft gezegd
  // "altijd negeren". Hier, in PHASE 0, dus VÓÓR de AI-aanroep — dat is het hele punt: die post
  // hoeft niet gelezen te worden en de wachtrij hoeft er niet mee vol te lopen.
  //
  // Eén query per sync. Faalt hij (tabel bestaat nog niet, netwerk), dan is de set leeg en
  // importeert alles gewoon zoals voorheen: een kapotte regel mag nooit post tegenhouden.
  const blockedSenders = new Set<string>()
  try {
    const { data: ruleRows } = await supabase
      .from('email_sender_rules')
      .select('sender_email')
      .eq('user_id', userId)
      .eq('action', 'ignore')
      .limit(500)
    for (const r of (ruleRows ?? []) as Array<{ sender_email: string | null }>) {
      const e = normalizeSenderEmail(r.sender_email)
      if (e) blockedSenders.add(e)
    }
  } catch {
    // Geen regels toepasbaar → alles importeert. De veilige kant.
  }

  // [HERINNERING-ORIGINEEL] De factuurnummers die deze gebruiker al heeft, genormaliseerd — de
  // verzameling waartegen een herinnering wordt nagekeken. LUI geladen: verreweg de meeste syncs
  // bevatten geen enkele herinnering, en dan hoort er ook geen query te draaien. Eén keer per sync
  // en daarna gecached; de set groeit tijdens de sync mee, zodat een origineel en zijn herinnering
  // in dezelfde batch elkaar nog steeds vinden.
  const knownNumbers = new Set<string>()
  let knownNumbersLoaded = false
  const knownInvoiceNumbers = async (): Promise<Set<string>> => {
    if (knownNumbersLoaded) return knownNumbers
    const set = knownNumbers
    try {
      // Alleen facturen die ECHT tellen. Een genegeerde factuur mag een herinnering niet
      // wegdrukken: als de eigenaar het origineel heeft weggezet, is de herinnering misschien
      // juist het stuk dat hij wél wil houden.
      const { data } = await supabase
        .from('invoices')
        .select('invoice_number')
        .eq('receiver_id', userId)
        .eq('direction', 'incoming')
        .in('status', ['processing', 'received', 'paid'])
        .not('invoice_number', 'is', null)
        .order('invoice_date', { ascending: false })
        .limit(5000)
      for (const r of (data ?? []) as Array<{ invoice_number: string | null }>) {
        const key = normalizeInvoiceNumber(r.invoice_number)
        if (key) set.add(key)
      }
    } catch {
      // Kan de lijst niet gelezen worden, dan blijft de set leeg → elke herinnering wordt
      // geïmporteerd-met-vlag. De veilige kant: liever een extra rij in de wachtrij dan een
      // weggegooid bewijsstuk.
    }
    knownNumbersLoaded = true
    return set
  }

  const notKnown = attachments.filter((a) => !knownKeys.has(`${a.messageId}:${a.filename}`))

  // [AFZENDERREGEL] Overslaan is nooit ONZICHTBAAR. Elke overgeslagen bijlage krijgt een rij in
  // dezelfde skip-registry die al elke niet-geïmporteerde bijlage verantwoordt, met de reden en
  // met de regel erin genoemd — zodat "waar is die bijlage gebleven" altijd te beantwoorden is,
  // en de eigenaar ziet wélke regel het deed. Het bestand zelf blijft gewoon in de mailbox staan.
  const blockedBySender = blockedSenders.size
    ? notKnown.filter((a) => senderIsBlocked(a.from, blockedSenders))
    : []
  if (blockedBySender.length > 0) {
    try {
      const skipPipeline = createPipelineClient()
      await skipPipeline.from('email_skipped_attachments').upsert(
        blockedBySender.map((a) => ({
          user_id: userId,
          source_message_id: `${a.messageId}:${a.filename}`,
          filename: a.filename,
          reason: blockedSenderSkipReason(normalizeSenderEmail(a.from) ?? a.from),
        })),
        { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
      )
    } catch (e) {
      // De registratie is de verantwoording, niet de blokkade zelf. Mislukt hij, dan wordt de
      // bijlage nog steeds overgeslagen — maar we laten het niet in stilte gebeuren.
      console.error('[AFZENDERREGEL] kon overgeslagen bijlage niet registreren', e)
    }
  }
  const blockedKeys = new Set(blockedBySender.map((a) => `${a.messageId}:${a.filename}`))

  const freshAll = notKnown
    .filter((a) => !blockedKeys.has(`${a.messageId}:${a.filename}`))
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
  const batchCandidates = freshAll.slice(0, SYNC_BATCH_MAX)

  // ── [EERLIJK-GEBRUIK] De maandteller telt eindelijk ook hier mee ────────────────────────
  //
  // Dit is het open punt dat /api/cron/email-sync in zijn eigen commentaar opschreef, en het
  // was groter dan het daar klonk. Vijf routes gaan langs gateFairUse — intake, email/upload,
  // email/reimport, eft/import, bank/attach-invoice — en DEZE weg niet, terwijl dit verreweg
  // de duurste van allemaal is: tot SYNC_BATCH_MAX classificaties per ronde, vijf ronden per
  // run, twaalf runs per dag.
  //
  // Het gevolg was niet "een gebruiker kwam er soms overheen", maar dat de grens van 50
  // documenten per maand gold voor wie handmatig uploadt en NIET voor wie zijn mailbox
  // koppelt — de weg die wij zelf aanraden. De grens stond dus wel op /eerlijk-gebruik en in
  // de voorwaarden §5, maar de belangrijkste deur zat er niet achter. Een gepubliceerde grens
  // die de drukste weg niet raakt is geen grens; het is een tekst.
  //
  // ── WAAROM "TOT ZOVER" EN NIET ALLES-OF-NIETS ──
  // consumeFairUseUpTo() reserveert wat er nog past. Passen er nog drie binnen de grens, dan
  // leest de app er drie en blijft de rest staan — precies wat onExceed belooft: "Nieuwe
  // documenten worden nog wel bewaard, maar niet meer automatisch gelezen." Ze vallen in
  // remainingAfterBatch, dus de balans hieronder blijft kloppen, ze verdwijnen niet uit het
  // watermerk, en volgende maand loopt de sync er gewoon overheen.
  //
  // Plus en boekhouder kennen hier geen grens (limitForPlan → 0): die worden geteld, niet
  // begrensd. Regel 2 uit fair-use.ts blijft ook hier staan — er wordt niets verwijderd en
  // niets ontoegankelijk; alleen het LEZEN pauzeert, en de bijlage zelf blijft gewoon komen.
  //
  // Faalt OPEN. Een onbereikbare teller mag nooit iemands post tegenhouden; de bodem onder de
  // kosten is en blijft de globale dagzekering in ai-budget.ts.
  //
  // En net als bij readingHint hieronder: alleen vragen als er iets te vragen valt. De meeste
  // syncs vinden geen nieuwe post, en deze cron draait voor elke gekoppelde mailbox de hele
  // dag door — een profielquery per gebruiker per sync, twaalf keer per dag, voor een antwoord
  // dat niemand gebruikt, is precies de query die je niet wilt toevoegen.
  //
  // [E-FACTUUR-XML] …en de teller heet 'aiDocuments' omdat hij AI-lezingen telt. Een e-factuur XML
  // kost er geen: de leverancier stuurt de bedragen zelf mee en die worden mechanisch gelezen,
  // zonder model en zonder kosten. Die meetellen zou de eigenaar laten betalen voor iets gratis —
  // en erger, echte facturen uit de maandgrens duwen die wél gelezen moeten worden. Ze gaan er dus
  // altijd doorheen, ook wanneer de grens bereikt is; de volgorde van de rest blijft gelijk.
  const aiCandidates = batchCandidates.filter((a) => !isEInvoiceXmlMime(a.mimeType))
  const fairUsePlan = aiCandidates.length > 0 ? await planForUser(supabase, userId) : 'free'
  const fairUse = await consumeFairUseUpTo({
    userId,
    metric: 'aiDocuments',
    plan: fairUsePlan,
    wanted: aiCandidates.length,
  })
  if (fairUse.granted < aiCandidates.length) {
    console.warn('[EERLIJK-GEBRUIK] maandgrens bereikt — rest van de batch wordt bewaard, niet gelezen', {
      userId,
      wanted: aiCandidates.length,
      granted: fairUse.granted,
      plan: fairUsePlan,
      freeOfCharge: batchCandidates.length - aiCandidates.length,
    })
  }

  // Oudste eerst, precies zoals hierboven: loop de batch in volgorde af, houd elke e-factuur XML
  // (gratis) en elke AI-lezing tot het toegekende aantal op is. Een simpele slice() zou een XML
  // meetellen als plek en dus alsnog een echte factuur wegdrukken.
  let aiBudget = fairUse.granted
  const freshAttachments = batchCandidates.filter((a) => {
    if (isEInvoiceXmlMime(a.mimeType)) return true
    if (aiBudget <= 0) return false
    aiBudget--
    return true
  })
  const remainingAfterBatch = freshAll.length - freshAttachments.length

  // [POISON-PILL] Consecutive-failure guard for the watermark. The mark walks messages oldest-first
  // and stops at the first with an attachment that didn't finish this run — correct for a genuine
  // transient failure, but an attachment that fails EVERY sync (a non-transient error mis-read as
  // transient, a file that always times out, a persistent save/DB error) would block the walk
  // forever, freezing the mark and starving every newer invoice behind the batch cap. We count
  // consecutive failures per attachment and GIVE UP after SYNC_MAX_ATTEMPTS: keep it owner-visible
  // and register a terminal skip so the mark can pass. Completed attachments' counters are cleared
  // after PHASE 2, so a finally-successful flaky file never carries a stale count.
  const SYNC_MAX_ATTEMPTS = (() => {
    const raw = Number(process.env.SYNC_MAX_ATTEMPTS)
    if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return Math.round(raw)
    return 6
  })()
  // [POISON-PILL] Minimum REAL time between two counted failures. The counter is time-gated, not
  // per-sync: a burst of rapid re-syncs (manual retries, the client's auto-continue backlog drain,
  // a frequent cron) within this window counts as ONE attempt, so a short transient Claude/rate-
  // limit episode can never burn all the attempts and give up on a real invoice. Only a failure
  // that PERSISTS across many hours (a genuine poison pill) reaches SYNC_MAX_ATTEMPTS. With the
  // defaults (6 × 30 min) a give-up needs ~2.5 h of continuous failure.
  const SYNC_MIN_RETRY_MS = (() => {
    const raw = Number(process.env.SYNC_MIN_RETRY_MINUTES)
    const mins = Number.isFinite(raw) && raw >= 0 && raw <= 1440 ? Math.round(raw) : 30
    return mins * 60_000
  })()

  // count = consecutive counted failures; atMs = when the last one was counted (the time gate).
  const attemptState = new Map<string, { count: number; atMs: number }>()
  {
    const batchKeys = freshAttachments.map((a) => `${a.messageId}:${a.filename}`)
    for (const chunk of chunkArray(batchKeys, 100)) {
      const { data } = await supabase
        .from('email_failed_attempts')
        .select('source_message_id, attempt_count, updated_at')
        .eq('user_id', userId)
        .in('source_message_id', chunk)
      for (const r of (data ?? []) as Array<{ source_message_id: string; attempt_count: number; updated_at: string }>) {
        attemptState.set(r.source_message_id, { count: r.attempt_count, atMs: new Date(r.updated_at).getTime() })
      }
    }
  }

  // Keep an unreadable/failed attachment owner-visible: store the bytes as a could_not_read document
  // (deduped by content hash) and register a skip with `reason`. Shared by the confidence-0 "could
  // not read" branch and the poison-pill give-up. Never throws.
  const saveUnreadableAttachment = async (att: GmailAttachment, reason: string): Promise<void> => {
    try {
      const buf = Buffer.from(att.data, 'base64')
      const hash = computeContentHash(buf)
      const { data: dupDoc } = await supabase
        .from('documents').select('id, trashed')
        .eq('user_id', userId).eq('content_hash', hash).limit(1).maybeSingle()
      // [DUP-TRASHED] Ook het onleesbare-bijlage-pad: botst het op een weggegooide rij, dan is er
      // niets meer om naar te verwijzen en hoort de bijlage gewoon opnieuw bewaard te worden.
      if (!dupDoc || (await trashedDuplicateCleared(supabase, userId, dupDoc))) {
        const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
        const { error: upErr } = await supabase.storage
          .from('documents').upload(storagePath, buf, { contentType: att.mimeType, upsert: false })
        if (!upErr) {
          const folderId = await resolveImportTarget(userId, null, 'facturen', 'pipeline')
          const { error: docErr } = await supabase.from('documents').insert({
            user_id: userId,
            file_name: att.filename,
            file_url: storagePath,
            file_size: buf.length,
            file_type: att.mimeType,
            doc_type: 'overig',
            folder_id: folderId,
            source: 'email',
            ai_processed: false,          // we did NOT read it — never claim we did
            // [OBSERVABILITY] The shared constant, not the string. skipped-import.ts exists because
            // the WRITER and the READER of this column once used different values, and a kept file
            // then counted as nothing: the panel said "Niets overgeslagen" over an unread invoice.
            // That file promises "een test die faalt zodra iemand er één verplaatst" — and this
            // writer was still typing the literal, so the promise held for every door but this one.
            ai_doc_type: DOC_TYPE_COULD_NOT_READ,
            content_hash: hash,
          })
          if (docErr) await supabase.storage.from('documents').remove([storagePath])
        }
      }
    } catch (e) {
      console.error('[BOEK-011] could-not-read save failed', e)
    }
    // NB: the skip upsert is inside its OWN try/catch — this function must NEVER throw (its callers
    // run inside the PHASE-2 try/catch, and a throw here would double-count the attempt and abort
    // the whole sync before the watermark advance).
    try {
      await supabase
        .from('email_skipped_attachments')
        .upsert(
          {
            user_id: userId,
            source_message_id: `${att.messageId}:${att.filename}`,
            filename: att.filename,
            reason,
          },
          { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
        )
    } catch (e) {
      console.error('[BOEK-011] skip-registry upsert failed (non-fatal)', e)
    }
  }

  // Record ONE failed processing attempt for an attachment. Returns true when it has now EXHAUSTED
  // its retries and was given up (kept owner-visible + terminal skip), so the caller lets the mark
  // pass; false while it should still be retried (the mark holds, unchanged behaviour). Never throws.
  const recordFailedAttempt = async (att: GmailAttachment, lastError: string): Promise<boolean> => {
    const key = `${att.messageId}:${att.filename}`
    const prev = attemptState.get(key)
    const nowMs = Date.now()
    // [POISON-PILL] Time gate: within SYNC_MIN_RETRY_MS of the last COUNTED failure, do NOT count
    // again — hold the mark and retry next sync, exactly like a plain transient failure. This is
    // what keeps a burst of rapid re-syncs during a short outage from exhausting the attempts on a
    // real invoice; only a failure that keeps recurring across the window advances the counter.
    if (prev && nowMs - prev.atMs < SYNC_MIN_RETRY_MS) return false
    const next = (prev?.count ?? 0) + 1
    attemptState.set(key, { count: next, atMs: nowMs })
    try {
      await supabase
        .from('email_failed_attempts')
        .upsert(
          {
            user_id: userId,
            source_message_id: key,
            attempt_count: next,
            last_error: lastError.slice(0, 500),
            updated_at: new Date(nowMs).toISOString(),
          },
          { onConflict: 'user_id,source_message_id' }
        )
    } catch (e) {
      console.error('[POISON-PILL] attempt upsert failed (non-fatal)', e)
    }
    if (next < SYNC_MAX_ATTEMPTS) return false
    console.warn('[POISON-PILL] giving up on attachment after repeated failures', { key, attempts: next })
    await saveUnreadableAttachment(att, 'repeatedly_failed')
    return true
  }

  console.log('[BOEK-011] Sync scope', {
    fetched: attachments.length,
    alreadyImported: knownKeys.size,
    newTotal: freshAll.length,
    thisBatch: freshAttachments.length,
    remainingForNextSync: remainingAfterBatch,
  })

  // [READING-MEMORY] Loaded here, and only here.
  //
  // ONCE per run, not per attachment: PHASE 1 classifies in parallel below, so a per-file load would
  // fire the same query for every attachment in the batch. And only when there IS something to
  // classify — most syncs find no new mail, and this cron runs for every connected owner all day,
  // so a load next to the profile read (where it started) was a query per owner per sync forever,
  // for a value nothing would use.
  //
  // Fields only, never amounts — see readingPromptHint. Null for almost every owner, and null when
  // the audit read fails, in which case the reader behaves exactly as it did before this existed.
  const readingHint = freshAttachments.length > 0
    ? readingPromptHint(await loadReadingMemory(supabase, userId))
    : null

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
          { receiverKvk, receiverBtw, receiverIban, readingHint }
        )
        return { attachment, classification, classifyFailed: false }
      } catch (err) {
        console.error('[BOEK-011] Classification error', { filename: attachment.filename, err })
        // [BOEK-011] Transient failure (rate limit, network) — NOT a verdict.
        // classifyFailed=true tells PHASE 2 to skip WITHOUT registering in the
        // skip registry, so the attachment is retried on the next sync. Only a
        // genuine Claude "not an invoice" verdict may be registered permanently.
        // [MODEL-OUTAGE] Distinguish an APP-WIDE model/config error (invalid model id → 404
        // not_found, auth/permission) from a per-file transient. A model outage is not this file's
        // fault, so it must never be counted toward the poison-pill give-up (which would bury real
        // invoices as 'could_not_read'). It just holds the watermark until the model is fixed.
        // [MODEL-CONFIG] De `msg`-variabele die hier stond is weg: het uitpakken van de fouttekst
        // gebeurt nu in ai-model.ts, bij het oordeel zelf, zodat beide lezers exact dezelfde
        // ontleding gebruiken.
        // [MODEL-OUTAGE] Two kinds of "not this file's fault" failure must HOLD the watermark and
        // never poison-pill a real invoice:
        //   (a) a CONFIG outage — invalid CLAUDE_MODEL id (404 not_found), auth/permission.
        //   (b) a CAPACITY / transient outage — Anthropic 529 overloaded, 5xx, 429, network. A 5xx/
        //       overloaded is the SERVER's state, never a verdict on this attachment, so a sustained
        //       outage (e.g. ~3h overloaded) must not, after the retry budget, bury every real
        //       invoice fetched during it as 'could_not_read'. isTransientAiError (shared with the
        //       reader) recognises exactly these. A genuinely unreadable file does NOT throw one of
        //       these — it returns a low-confidence FALLBACK (the could_not_read path below) — so the
        //       poison-pill still protects the watermark against a truly stuck single file.
        const { isTransientAiError } = await import('@/lib/ai')
        // A CONFIG outage (invalid CLAUDE_MODEL → 404, auth/permission) is inherently app-wide, so it
        // is ALWAYS an outage-hold. A TRANSIENT/CAPACITY error (529/5xx/429/network) is only an
        // outage when the WHOLE batch is failing — a single file that deterministically produces a
        // transient-looking error (e.g. a large PDF that always times out) must still poison-pill so
        // it can't freeze the watermark forever. That batch-wide decision is made AFTER this map.
        // [MODEL-CONFIG] Hetzelfde oordeel als voorheen, maar nu uit ai-model.ts — dezelfde
        // herkenning die de herleesroute gebruikt om terug te vallen op het basismodel. De test
        // [IJKPUNT] in ai-model.test.ts houdt dit oordeel letterlijk gelijk aan de regexp die
        // hier stond, zodat de watermerk-hold van deze lezer niet stilletjes kan verschuiven.
        const { isAiConfigError } = await import('@/lib/ai-model')
        const configOutage = isAiConfigError(err)
        const transientError = isTransientAiError(err)
        return {
          attachment,
          classification: { isInvoice: false } as Awaited<ReturnType<typeof classifyAttachment>>,
          classifyFailed: true,
          configOutage,
          transientError,
        }
      }
    }
  )

  // [BOEK-011 watermark] Attachments that finished PHASE 2 COMPLETELY this run:
  // saved as invoice, registered as non-invoice, or recognised as a duplicate.
  // classifyFailed and save/processing errors are deliberately NOT in this set —
  // the watermark must not advance past them (they need a re-fetch to retry).
  const completedKeys = new Set<string>()

  // [MODEL-OUTAGE] Decide, batch-wide, whether a TRANSIENT classify failure is a real outage or a
  // single stuck file. A config outage anywhere ⇒ app-wide outage. Otherwise a transient error is an
  // outage only when EVERY attachment this run failed (≥2, so nothing classified successfully) —
  // proof the service is down, not that one file is bad. If some attachments succeeded, the service
  // is up, so a transient failure on another file is that-file-specific and must still poison-pill
  // (else a single deterministically-timing-out PDF would freeze the watermark forever, re-opening
  // the exact bug the poison-pill prevents).
  const classifiedTotal = classified.length
  const classifiedFailed = classified.filter((c) => c.classifyFailed).length
  const configOutageAny = classified.some((c) => c.configOutage)

  // [EERLIJK-GEBRUIK] Teruggeven wat niet gelezen ís. Dit maakt de zin op /eerlijk-gebruik
  // waar: "Een bestand dat wij niet konden lezen telt ook niet mee — mislukte pogingen komen
  // nooit op jouw rekening." De reservering hierboven gebeurde vóór PHASE 1, want anders zou
  // een gebruiker over zijn grens heen kunnen lezen; wat daar strandde hoort er weer af.
  //
  // Let op het verschil met een LAGE-VERTROUWEN lezing: die is wél een lezing (de app heeft
  // ervoor betaald en er komt een antwoord uit, ook al is het "kon ik niet lezen"), en die
  // blijft dus staan. Alleen classifyFailed — een storing, een modeluitval, een netwerkfout —
  // is een poging die nooit een lezing werd.
  //
  // Nooit blokkerend: mislukt de teruggave zelf, dan staat er één document te veel op de
  // teller en dat is een kleiner onrecht dan een sync die hierop blijft hangen.
  if (classifiedFailed > 0) {
    await releaseFairUse({
      userId,
      metric: 'aiDocuments',
      amount: classifiedFailed,
      period: fairUse.period,
    })
  }
  const transientOutage = classifiedTotal >= 2 && classifiedFailed === classifiedTotal
  const outageActive = configOutageAny || transientOutage

  // PHASE 2 — save loop, sequential by design (dedup correctness)
  for (const { attachment, classification, classifyFailed, configOutage, transientError } of classified) {
    const wmKey = `${attachment.messageId}:${attachment.filename}`
    // An outage-hold when: a config outage (always), or a transient error DURING a batch-wide outage.
    // A lone transient failure (some files succeeded) is NOT an outage → it takes the poison-pill path.
    const outageHold = configOutage || (transientError && outageActive)
    try {
      // [MODEL-OUTAGE] An app-wide model/config failure (invalid CLAUDE_MODEL → 404, auth) is not
      // this file's fault. NEVER count it toward the poison-pill give-up and NEVER register it as
      // could_not_read — just leave the watermark held so the invoice is re-read once the model is
      // fixed. Otherwise a misconfigured model for a few hours would permanently bury every real
      // invoice fetched during the outage (exactly what a bad model id did to the HVO invoices).
      if (classifyFailed && outageHold) {
        errors++
        continue
      }
      // Transient classification failure (rate limit / network) → skip WITHOUT
      // registering; the next sync retries it. A real invoice must never be
      // permanently skipped because of one bad network moment.
      // [watermark] NOT complete — the mark stops before this email … UNLESS this attachment has
      // failed on SYNC_MAX_ATTEMPTS consecutive syncs (poison pill), in which case we give up so it
      // stops blocking every newer invoice: it's kept owner-visible + registered terminal and the
      // mark is allowed to pass (completedKeys).
      if (classifyFailed) {
        const gaveUp = await recordFailedAttempt(attachment, 'classify_failed')
        if (gaveUp) {
          couldNotRead++
          completedKeys.add(wmKey)
        } else {
          errors++
        }
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
        await saveUnreadableAttachment(attachment, 'could_not_read')
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

      // [DEDUP-READ-HONEST] Declared HERE, above the first gate that can fail, not halfway down
      // beside the semantic probes. It used to sit below them, so the two HARD gates — the ones
      // that run first and catch the most — had no way to report a failed read even in principle.
      let dedupCheckFailed = false
      // [EVIDENCE-KEEP] The byte-hash unique index refused this document because the same bytes are
      // already stored. Carried to the safecore block so the row says so on the card.
      let hashCollision = false

      // [DEDUP-READ-HONEST] supabase-js answers a failed read with { data: null, error }, and this
      // gate reads its answer as "this file is new". On the manual doors a human is standing there;
      // on the SYNC nobody is, and this is the door most invoices actually arrive through. A read
      // that could not run therefore imported the identical file a second time — same cost, same
      // voorbelasting, counted twice — with nothing anywhere saying so.
      //
      // It does not refuse the attachment: refusing would lose an invoice, and on an unattended
      // path a lost invoice is the more expensive mistake (the [DUP-TRASHED] note above weighs the
      // same way). It flags instead, with the marker a real look-alike gets — needs-review, held
      // out of "Selecteer klaar" and out of auto-advance — so nothing is booked as a second cost
      // without a human having looked.
      const { data: existingByHash, error: hashErr } = await supabase
        .from('documents')
        .select('id, trashed')
        .eq('user_id', userId)
        .eq('content_hash', contentHash)
        .limit(1)
        .maybeSingle()
      if (hashErr) {
        console.error('[DEDUP-READ-HONEST] email sync byte-hash probe failed — importing flagged', {
          userId, filename: attachment.filename, error: hashErr.message,
        })
        dedupCheckFailed = true
      }

      // [DUP-TRASHED] Hier weegt de uitzondering het zwaarst van alle vier de poorten. Op de andere
      // drie STAAT er iemand: hij ziet "dit bestand staat al in …", snapt er niets van en meldt het.
      // Hier kijkt niemand. Gooit de eigenaar een factuur weg en stuurt de leverancier hem opnieuw,
      // dan werd die tweede aankomst stil als duplicaat geteld en overgeslagen — precies het
      // "ontbrekende factuur"-geval dat deze app bestaat om te voorkomen, en het enige waar geen
      // scherm ooit iets over zegt.
      if (existingByHash && !(await trashedDuplicateCleared(supabase, userId, existingByHash))) {
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

      // [DEDUP-READ-HONEST] Same rule as Check 0. A failed read here is softened by the
      // (receiver_id, source_message_id) uniqueness index — the insert would be refused — but it is
      // still an unrun check, and the row that reaches the queue must say so rather than look clean.
      const { data: existingByMessage, error: messageErr } = await supabase
        .from('invoices')
        .select('id')
        .eq('receiver_id', userId)
        .eq('source', 'email')
        .eq('source_message_id', dedupKey)
        .limit(1)
      if (messageErr) {
        console.error('[DEDUP-READ-HONEST] email sync message-key probe failed — importing flagged', {
          userId, filename: attachment.filename, error: messageErr.message,
        })
        dedupCheckFailed = true
      }

      if (existingByMessage && existingByMessage.length > 0) {
        // [SAMENAME-VISIBLE] Reaching here means: same messageId:filename as an
        // already-imported invoice, YET the byte-hash gate (Check 0) just passed
        // — i.e. DIFFERENT bytes. That is a SECOND, DISTINCT invoice sharing a
        // filename with the first in one email (e.g. two attachments both named
        // "factuur.pdf"). The old code counted it as a duplicate and dropped it
        // with no trace: no skip row, no audit, invisible to the owner. The
        // (receiver_id, source_message_id) uniqueness means it cannot be inserted
        // under this key here, but it must NOT vanish — surface it in the skip
        // registry with an actionable reason so the owner can add it by hand.
        try {
          const skipPipeline = createPipelineClient()
          await skipPipeline
            .from('email_skipped_attachments')
            .upsert(
              {
                user_id: userId,
                // Distinct key so this row can't collide with a genuine
                // not-an-invoice skip of the SAME attachment name.
                source_message_id: `${dedupKey}:samename:${contentHash.slice(0, 16)}`,
                filename: attachment.filename,
                reason: 'tweede bijlage met dezelfde bestandsnaam in deze e-mail — niet automatisch geïmporteerd; open de e-mail om deze factuur handmatig toe te voegen',
              },
              { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
            )
          await logAuditAction({
            userId,
            action: 'document.duplicate_blocked',
            entityType: 'document',
            entityId: existingByMessage[0].id,
            newValue: { file_name: attachment.filename, reason: 'same_filename_distinct_bytes', path: 'email' },
          })
        } catch (e) {
          console.error('[SAMENAME-VISIBLE] could not register same-name attachment', e)
        }
        skipped++
        completedKeys.add(wmKey) // [watermark] handled (registered) = complete
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
      // [DEDUP-SOFT] A POSSIBLE (not confident) duplicate found AFTER the hard dedup passes —
      // flagged so the verify queue shows "mogelijk dubbel met X" and it can never auto-advance as
      // a second cost. Never blocks the import. Reset per attachment.
      let possibleDup: PossibleDuplicate | null = null
      // [DEDUP-READ-HONEST] Did a duplicate probe fail to RUN? This is the automatic path — nobody
      // is watching it happen — so a silently skipped check is the one most likely to go unnoticed.
      // The invoice still imports (a database hiccup may not stop the mail sync), but it arrives
      // carrying the same soft flag a real look-alike gets: needs-review, held out of auto-advance
      // and out of "Selecteer klaar", reason on the card.

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

      // [IBAN-WISSEL] Kennen we deze leverancier al onder een ANDER rekeningnummer? Dit moet
      // VÓÓR resolveSupplierForImport, want die kan zo meteen een rij aanmaken of bijwerken met
      // precies het IBAN dat we hier verdacht vinden — dan zouden we de vraag met onszelf
      // beantwoorden. Eén indexed query op een sleutel die niet meeverandert (KVK / naamsleutel).
      const ibanChange = await detectIbanChange(supabase, userId, {
        name: classification.vendor,
        kvk: classification.vendorKvk ?? null,
        iban: classification.vendorIban ?? null,
      })

      const supplier = await resolveSupplierForImport(supabase, userId, {
        name: classification.vendor,
        iban: classification.vendorIban ?? null,
        kvk: classification.vendorKvk ?? null,
        btw: classification.vendorBtw ?? null,
      })

      // [SUPPLIER-LEARN] Enrich a MISSING vendor IBAN from what we already learned about this
      // supplier — a PRIOR invoice taught the registry its IBAN. Pure identity: it NEVER overwrites
      // a read (only fills a blank), and it directly feeds the bank certain-tier auto-match
      // (IBAN + amount), so a later invoice whose IBAN the reader couldn't find still auto-
      // reconciles against the bank instead of waiting for a manual confirm. One query, only when
      // the read left vendor_iban blank.
      let learnedVendorIban: string | null = null
      if (supplier?.id && !classification.vendorIban) {
        const { data: sup } = await supabase.from('suppliers').select('iban').eq('id', supplier.id).maybeSingle()
        learnedVendorIban = sup?.iban ?? null
      }

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
        } else if (isReliableVendor(classification.vendor) && realDateIso) {
          // Placeholder number + reliable vendor + a REAL invoice date → vendor+total+date is
          // specific enough to catch a re-arrival of the SAME bill.
          tier = { kind: 'vendor' }
        } else if (isReliableVendor(classification.vendor)) {
          // [DEDUP-RECURRING] Reliable vendor but NO date read → vendor+total ALONE is too weak:
          // a monthly RECURRING invoice (subscription, rent, SaaS) has the same vendor and the same
          // amount every month, and if the AI read its number as a placeholder and couldn't read the
          // date, this key would match it against LAST MONTH's invoice and silently drop it as a
          // "duplicate" — exactly the "last month's invoices weren't imported" symptom. Without a
          // date we cannot tell a re-arrival from next month's bill, so we do NOT dedup: hold it for
          // human review (same safe stance as the un-dedupable branch below).
          tier = {
            kind: 'none',
            reason:
              'betrouwbare afzender maar geen factuurdatum — duplicaatcontrole te onzeker (kan een terugkerende factuur van hetzelfde bedrag zijn)',
          }
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

        // [DEDUP-SOFT] Reached here without a `continue` → NOT a confident duplicate. Is it a
        // POSSIBLE one? (same amount + date, or same amount + vendor a few days apart, that the
        // hard key can't prove). Flag it — never block — so the verify queue shows "mogelijk
        // dubbel met X" and it is held out of auto-advance (a possible dup can never silently book
        // a second cost). Best-effort: a query error degrades to no flag.
        possibleDup = await collectPossibleDuplicate(
          {
            invoiceNumber: classification.invoiceNumber,
            vendor: classification.vendor,
            totalIncBtw: classification.totalIncBtw,
            invoiceDate: classification.invoiceDate,
          },
          async (total) => {
            // [DEDUP-READ-HONEST] A dropped error turned "we could not look" into "there is no
            // duplicate" — the one answer that lets a second copy of a bill into the books, cost
            // and voorbelasting counted twice. Same rule as the other three ingestion paths.
            const { data, error: dedupErr } = await supabase
              .from('invoices')
              .select('id, invoice_number, client_name, invoice_date, total_inc_btw')
              .eq('receiver_id', userId)
              .eq('direction', 'incoming')
              // A cent-wide band, not exact float equality: a legacy row stored as 42.9999… must
              // still be fetched for the cent-precise in-code compare (assessPossibleDuplicate).
              .gte('total_inc_btw', total - 0.005)
              .lte('total_inc_btw', total + 0.005)
              .order('id', { ascending: false })
              .limit(200)
            if (dedupErr) dedupCheckFailed = true
            return data ?? []
          },
          // [DEDUP-CORRECTED] Invoices already held under THIS number, at ANY amount. A supplier
          // who re-sends the same number with a corrected total is invisible to the by-total query
          // above — and to the hard key — so without this both copies import as two costs. ilike
          // without wildcards is an exact case-insensitive match; the pure assessor re-checks with
          // full normalization before flagging.
          async (invoiceNumber) => {
            // [DEDUP-READ-HONEST] Same rule.
            const { data, error: dedupErr } = await supabase
              .from('invoices')
              .select('id, invoice_number, client_name, invoice_date, total_inc_btw')
              .eq('receiver_id', userId)
              .eq('direction', 'incoming')
              .ilike('invoice_number', escapeLikeValue(invoiceNumber))
              .order('id', { ascending: false })
              .limit(50)
            if (dedupErr) dedupCheckFailed = true
            return data ?? []
          },
          // [DEDUP-SOFT] Best-effort BY NAME. This invoice lands in the verify queue, and the
          // callbacks above already record a failed read in dedupCheckFailed →
          // markDuplicateCheckUnavailable, so the human still sees "we konden de dubbelcheck niet
          // uitvoeren". Leaving this off would abort the message mid-sync over one soft probe.
          { bestEffort: true },
        )
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

          // [EVIDENCE-KEEP] A 23505 here is not a failure at all — it is the (user_id, content_hash)
          // unique index saying THESE EXACT BYTES ARE ALREADY STORED. It is reachable when Check 0's
          // read could not run, and when two syncs overlap on the same attachment.
          //
          // The generic branch below then did the one thing that must not happen: it deleted the
          // storage object, set documentId/pdfUrl to null, and saved the invoice anyway. That is an
          // invoice in the books with NO REACHABLE PAPER — the closing package resolves the PDF via
          // invoices.document_id, so the accountant receives a cost with no document behind it, and
          // /api/intake calls exactly this state unacceptable in its own [R1] note while this door
          // produced it. Two doors, opposite decisions, same failure.
          //
          // The file is not missing; it is stored under the row that already holds the hash. So
          // point at that row instead. Removing the copy we just uploaded is right — it is
          // byte-identical to the one the existing document already references.
          const isHashCollision =
            !!docErr && ((docErr as { code?: string }).code === '23505' ||
              /duplicate key value violates unique constraint/i.test(docErr.message))
          let recovered: { id: string; file_url: string | null } | null = null
          if (isHashCollision) {
            const { data: held, error: heldErr } = await supabase
              .from('documents')
              .select('id, file_url')
              .eq('user_id', userId)
              .eq('content_hash', contentHash)
              .limit(1)
              .maybeSingle()
            if (!heldErr && held) recovered = held as { id: string; file_url: string | null }
            // The collision itself is evidence that this bill may already be in the books — a
            // stronger statement than "we could not check". It must reach a human either way.
            hashCollision = true
          }

          if (recovered) {
            await supabase.storage.from('documents').remove([storagePath])
            documentId = recovered.id
            pdfUrl = recovered.file_url
          } else if (docErr || !doc) {
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

      // [HERINNERING-ORIGINEEL] Gaat deze herinnering over een factuur die AL in de boeken staat?
      // Dan is het geen tweede kost en heeft de eigenaar er niets aan in zijn wachtrij: overslaan,
      // mét een rij in de skip-registry zodat "waar is die herinnering gebleven" te beantwoorden
      // blijft. Staat het origineel er NIET, dan importeren we hem juist wél (gevlagd): een
      // Nederlandse betalingsherinnering herhaalt de hele factuur, en als de originele mail in de
      // spam belandde is dit het enige bewijs van een aftrekbare kost.
      {
        const reminderDecision = decideReminder(
          {
            isReminder: classification.isReminder,
            reminderOfInvoiceNumber: classification.reminderOfInvoiceNumber,
          },
          await knownInvoiceNumbers()
        )
        if (reminderDecision.action === 'skip') {
          try {
            const skipPipeline = createPipelineClient()
            await skipPipeline.from('email_skipped_attachments').upsert(
              {
                user_id: userId,
                source_message_id: `${attachment.messageId}:${attachment.filename}`,
                filename: attachment.filename,
                reason: reminderDecision.reason,
              },
              { onConflict: 'user_id,source_message_id', ignoreDuplicates: true }
            )
          } catch (e) {
            console.error('[HERINNERING-ORIGINEEL] kon overgeslagen herinnering niet registreren', e)
          }
          await logAuditAction({
            userId,
            action: 'invoice.duplicated',
            entityType: 'invoice',
            entityId: reminderDecision.originalNumber,
            newValue: {
              reason: 'reminder_original_already_booked',
              original_invoice_number: reminderDecision.originalNumber,
              path: 'email',
            },
          })
          skipped++
          completedKeys.add(wmKey)
          continue
        }
      }

      // Merge, don't overwrite: keep the AI's fieldConfidence, add _safecore
      // only when held. When there's nothing at all, keep null (parity with the
      // pre-SAFECORE behaviour for clean invoices — no empty {} churn).
      const aiConfidence = classification.fieldConfidence ?? null
      let fieldConfidenceValue: Record<string, unknown> | null = aiConfidence
      // [BON-EMAIL] One call, one answer, shared with /api/intake. It stands HERE, outside the
      // _safecore block below, because that block only runs for PROBLEM rows — a clean kassabon
      // would have skipped it and gone back to being booked as a bill, which is the bug.
      // `bonKind` is kept separate from pay.suggestPaid because they say different things: the KIND
      // decides whether the invoice-number axis applies (a bon carries no factuurnummer), and the
      // SUGGESTION decides what the pay button offers. A bon the reader called unpaid is still a bon.
      const bonKind = classification.documentKind ?? null
      const pay = paymentSuggestion({
        is_invoice: classification.isInvoice,
        document_kind: bonKind === 'receipt' || bonKind === 'other' ? bonKind : 'invoice',
        is_paid: classification.isPaid,
        paid_method: classification.paidMethod ?? null,
        paid_date: classification.paidDate ?? null,
        paid_evidence: classification.paidEvidence ?? null,
        paid_card_last4: classification.paidCardLast4 ?? null,
        confidence: classification.confidence,
      })
      // [REMINDER] A payment reminder is a real single invoice but the original was very
      // likely already booked — flag it so the verify queue warns "controleer of de factuur
      // al geboekt is" and it is never bulk-confirmed as a second cost.
      const isReminder = classification.isReminder === true
      // [SAFECORE-GAP] _safecore also carries the dedup note (un-dedupable) and the reminder
      // flag so the audit/human-review trail records WHY this invoice needs a human look.
      if (!verdict.ok || dedupNote || isReminder || possibleDup || ibanChange) {
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
        // [DEDUP-SOFT] Carry the possible-duplicate flag → classifyImportHealth turns it into a
        // "mogelijk dubbel met X" needs-review warning that also blocks auto-advance.
        // [SUPERSEDE] Through mergePossibleDuplicate — the ONE file that knows which keys carry a
        // duplicate signal. These three lines used to be a hand-copy of it, and that broke the
        // moment a fourth key arrived (possible_duplicate_id, the id behind the "Deze vervangt
        // factuur X" button): upload and intake got it via the helper, the EMAIL SYNC did not —
        // and that is the path most invoices actually arrive on. The warning would show and the
        // button would not, with nothing on screen to explain why.
        if (possibleDup) {
          const merged = mergePossibleDuplicate({ _safecore: safecore }, possibleDup) as {
            _safecore?: Record<string, unknown>
          }
          Object.assign(safecore, merged._safecore ?? {})
        }
        // [DEDUP-READ-HONEST] A probe that could not RUN is not a clean result. Never applied over
        // a real find — markDuplicateCheckUnavailable keeps a named look-alike, which is the more
        // useful sentence.
        if (dedupCheckFailed) {
          Object.assign(safecore, (markDuplicateCheckUnavailable({ _safecore: safecore }) as { _safecore: Record<string, unknown> })._safecore)
        }
        // [EVIDENCE-KEEP] Stronger than "we could not check": the database refused a second copy of
        // these exact bytes, so this bill is very likely already booked. Written last and only over
        // an unnamed reason, so a probe that DID name a look-alike keeps the more useful sentence.
        if (hashCollision && !safecore.possible_duplicate_of) {
          safecore.possible_duplicate = true
          // Dutch: printed on the card. See the language rule in AGENTS.md.
          safecore.possible_duplicate_reason =
            'ditzelfde bestand staat al in je administratie — controleer of deze factuur niet dubbel geboekt is'
        }
        // [IBAN-WISSEL] Beide nummers mee, zodat de wachtrij ze naast elkaar kan tonen — dat
        // vergelijken IS de controle die de eigenaar moet doen. → needs-review + geen auto-boeking.
        if (ibanChange.status === 'unavailable') {
          // [IBAN-CHECK-HONEST] De controle kon niet draaien. Dat is iets anders dan "geen wissel",
          // en het verschil is duur: bij factuurfraude is het gewijzigde rekeningnummer het enige
          // signaal, dus een stil overgeslagen controle laat de eigenaar naar de rekening van de
          // fraudeur betalen zonder dat iets dat ooit heeft gezegd.
          safecore.iban_check_unavailable = true
        } else if (ibanChange.change) {
          safecore.iban_changed = true
          safecore.iban_changed_from = ibanChange.change.from
          safecore.iban_changed_to = ibanChange.change.to
        }
        fieldConfidenceValue = {
          ...(aiConfidence ?? {}),
          _safecore: safecore,
        }
      }

      // [BON-EMAIL] The same markers /api/intake writes, from the same shared decision, so a bon
      // that arrives by e-mail behaves on screen exactly like one photographed at the counter:
      // "Markeer als betaald" offered up front, the method pre-filled when the paper named one,
      // and the invoice-number axis relaxed (a kassabon carries no factuurnummer and does not need
      // one — see isKassabon in import-health.ts). Outside the block above on purpose: a clean bon
      // has no _safecore to write and must still be recognisable as a bon.
      //
      // Still only a SUGGESTION. Nothing here writes status='paid' — the human confirms, exactly as
      // on the camera path.
      if (bonKind === 'receipt' || pay.suggestPaid) {
        const fc: Record<string, unknown> = { ...(fieldConfidenceValue ?? {}) }
        if (bonKind === 'receipt') fc._intake_kind = 'receipt'
        if (pay.suggestPaid) {
          fc._intake_suggest = 'paid'
          if (pay.paidMethod) fc._intake_paid_method = pay.paidMethod
          if (pay.paidDate) fc._intake_paid_date = pay.paidDate
          if (pay.paidEvidence) fc._intake_paid_evidence = pay.paidEvidence
          if (pay.paidCardLast4) fc._intake_paid_card4 = pay.paidCardLast4
          // Only when the PAPER said how. Otherwise the screen asks instead of asserting.
          if (pay.paidMethodZeker) fc._intake_paid_method_zeker = true
        }
        fieldConfidenceValue = fc
      }

      // [MULTI-INVOICE] / [ONE-INVOICE-UNVERIFIED] The two checks the e-mail door never ran.
      //
      // /api/intake asks both of these before it lets anything auto-book, and its comments say
      // why: one file can carry SEVERAL invoices, exactly one of them gets read, and the others
      // exist nowhere — no row, no file, no notification. This door asked neither. Not by a
      // decision: the text layer they read was extracted by a helper private to the intake route
      // (now @/lib/pdf-text), so the question could not be asked from here at all.
      //
      // What that cost is specific. A wholesaler who e-mails one PDF holding three invoices got
      // one of them booked as 'received' and tagged _auto_verified — an automatic booking with no
      // human anywhere near it — while the other two were simply absent: missing cost, missing
      // voorbelasting, and two supplier bills nobody knows are owed. The e-mail door is the one
      // where that pattern is MOST common, since suppliers batch by mail rather than by camera.
      //
      // Both signals go through the same mergers /api/intake uses, so the queue shows the same
      // reason and the "nee, dit is één factuur" answer clears them the same way. Only for a PDF:
      // an image is one page by definition and cannotVerifySingleInvoice says so itself.
      if (classification.isInvoice) {
        const isPdf = (attachment.mimeType ?? '').includes('pdf') ||
          (attachment.filename ?? '').toLowerCase().endsWith('.pdf')
        if (isPdf) {
          const { text: pdfText, pages: pdfPages } = await readPdfTextLayer(fileBuffer)
          const multi = detectMultipleInvoices(pdfText)
          if (multi) {
            fieldConfidenceValue = mergeMultipleInvoices(fieldConfidenceValue, multi) as Record<string, unknown>
          } else {
            // The other half, and the reason it is not enough to run the check above: a scanned
            // stack has no text layer, so detectMultipleInvoices looks at nothing and returns
            // null — and null was being read as "one invoice, all fine". A check that could not
            // run is not a check that passed.
            const unverified = cannotVerifySingleInvoice({ pages: pdfPages, hasTextLayer: !!pdfText })
            if (unverified) {
              fieldConfidenceValue = mergeUnverifiedSingle(
                fieldConfidenceValue, unverified, pdfPages,
              ) as Record<string, unknown>
            }
          }
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
      // [BON-AUTO] Mag deze bon zichzelf afboeken? Een kassabon bestáát omdat er aan de kassa is
      // betaald. Wat de soort NIET zegt is HOE, en dat verschil beweegt de kaslade wel of niet —
      // dus alleen wanneer het papier de tenderregel afdrukt. Zie receipt-auto-settle.ts. Dezelfde
      // beslissing als aan de camera-deur, uit hetzelfde bestand: een automatisering op één deur
      // is geen automatisering, het is een verschil dat niemand kan uitleggen.
      const settlePlan = planReceiptSettlement({
        documentKind: bonKind,
        suggestion: {
          suggestPaid: pay.suggestPaid,
          paidMethod: pay.paidMethod,
          paidMethodZeker: pay.paidMethodZeker,
          paidDate: pay.paidDate,
        },
        invoiceDate,
        totalIncBtw: typeof classification.totalIncBtw === 'number' ? classification.totalIncBtw : null,
        today: new Date().toISOString().slice(0, 10),
      })

      // [BON-EMAIL] A paid suggestion is never auto-booked. Auto-advance lands an invoice as
      // 'received' — booked and UNPAID — which is the one status a settled bon must not get: it
      // would stand in "nog te betalen" for money already gone, be dunned for it, and be payable a
      // second time. Same gate, same reason, as /api/intake's `!decision.suggestPaid`.
      // [BON-AUTO] …with the one hole that objection allows: a bon that is SETTLED in the same
      // breath never passes through 'received' as a debt, so the reason to hold it is gone. The
      // safety bar itself does not move — grounding, placement, the printed BTW split, the
      // arithmetic, the dedup and the health classifier all still decide whether the READ may be
      // trusted; settling only decides which status a trusted read lands in.
      // [MAILTEKST] A body-rendered invoice never books itself. Every other door starts from a
      // file somebody deliberately attached; this one starts from ordinary mail, where almost
      // everything carrying a euro amount is not a bill. The mechanical filter is strict, but "is
      // this a purchase invoice at all" is the one question it cannot settle — and getting it wrong
      // creates a cost that never existed, with a voorbelasting claim on it.
      const autoAdv = attachment.fromBody === true
        ? { advance: false, reason: 'from_email_body' }
        : !classification.uncertain && (!pay.suggestPaid || settlePlan.settle)
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
            // [BTW-GATE] Pass the explicit rate so a genuine 0%-BTW email invoice can auto-book
            // (the gate holds a zero-BTW invoice UNLESS btwRate === 0). Without it the email path
            // sent undefined → every zero-BTW invoice was held for manual review, unlike intake.
            btwRate: classification.btwRate ?? null,
            // [GEGROND] What the document's own text says about the total the reader reported —
            // the only signal here that does not come from the reader. Both auto-booking doors
            // must ask it: a gate on one door is not a gate.
            totalGrounding: groundingOf(classification.fieldConfidence),
            // [DOCCHECK] And WHERE that total sits — the check that tells a real total from a subtotal.
            totalPlacement: placementOf(classification.fieldConfidence),
            // [DOCCHECK-SPLIT] And whether the paper prints a DIFFERENT btw split than the one read.
            btwContradictsDocument: btwContradictionOf(classification.fieldConfidence),
            // [E-FACTUUR] And the supplier's own structured figures, when the PDF carries them.
            eInvoiceContradicts: eInvoiceContradictsRead(classification.fieldConfidence),
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
      // [MAILTEKST] Where this document came from, on the row. The queue prints a line about it,
      // and the accountant can see that the "document" is a rendering of an e-mail rather than the
      // supplier's own PDF — which changes how much weight it carries in a dispute.
      if (attachment.fromBody === true) {
        fieldConfidenceValue = { ...(fieldConfidenceValue ?? {}), _mailtekst: true }
      }

      // [BON-AUTO] Both halves must hold: the READ is trustworthy (autoAdv) and the PAYMENT is
      // proven by the paper (settlePlan). Either one alone books something nobody checked.
      const willSettle = autoAdv.advance && settlePlan.settle
      if (willSettle) {
        // The basis, on the row, in the paper's own words — so "waarom staat deze bon op betaald?"
        // is answerable a year later without re-reading the document.
        fieldConfidenceValue = {
          ...(fieldConfidenceValue ?? {}),
          _auto_paid: {
            at: new Date().toISOString(),
            method: settlePlan.method,
            date: settlePlan.payDate,
            reason: settlePlan.reason,
            evidence: pay.paidEvidence ?? null,
          },
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
          vendor_iban: classification.vendorIban ?? learnedVendorIban ?? null,
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
          // [watermark] NOT complete — a genuine save failure; the mark stops here so the next
          // sync re-fetches and retries this email … unless this attachment has now failed
          // SYNC_MAX_ATTEMPTS times (poison pill), in which case we give up and let the mark pass.
          {
            const gaveUp = await recordFailedAttempt(attachment, `save_error: ${dbError.message}`)
            if (gaveUp) {
              couldNotRead++
              completedKeys.add(wmKey)
            } else {
              errors++
            }
          }
        }
      } else {
        saved++
        completedKeys.add(wmKey) // [watermark] saved = complete
        // [HERINNERING-ORIGINEEL] Dit nummer hoort nu bij "wat we al hebben". Zonder deze regel
        // zou een origineel en zijn herinnering die in DEZELFDE batch aankomen elkaar missen: de
        // set is aan het begin van de sync geladen, dus het net-geïmporteerde origineel zat er nog
        // niet in en de herinnering zou als tweede kost in de wachtrij landen. Alleen bijwerken als
        // de set al geladen is — anders zou dit de luie query juist uitlokken.
        if (knownNumbersLoaded) {
          const savedKey = normalizeInvoiceNumber(classification.invoiceNumber)
          if (savedKey) knownNumbers.add(savedKey)
        }
        // [BANK-LINK] Remember that a matchable ('received') invoice landed this run, so we can
        // run the safe bank linker ONCE after the loop (not per-invoice — the engine scans the
        // whole statement each call). Only auto-advanced invoices are eligible: a held/processing
        // one is barred by EXCLUDED_STATUSES anyway.
        if (autoAdv.advance && verdict.ok) autoAdvanced++

        // [BON-AUTO] The bon pays itself off. Through apply_manual_payment — the SAME audited,
        // atomic, row-locking call the manual "Markeer als betaald" button makes — and not by
        // writing status='paid' onto the insert above. That shortcut looks equivalent and is not:
        // the RPC also writes the bank_tx_invoices instalment row that keeps
        // amount_paid = SUM(amount_applied) true, and without it recompute_invoice_amount_paid
        // would reset amount_paid to zero on an invoice that says it is paid. Reusing the ordinary
        // booking also means the ordinary UNDO button reverses it.
        //
        // AFTER the insert on purpose: a failure here leaves the bon as 'received' — booked,
        // unpaid, one tap from correct — which is exactly where it stood before this existed. The
        // failure direction is the old behaviour, never a half-booking.
        if (willSettle && insertedInvoice?.id && settlePlan.method && settlePlan.payDate) {
          const { error: settleErr } = await insertPipeline.rpc('apply_manual_payment', {
            p_user_id: userId,
            p_invoice_id: insertedInvoice.id,
            p_amount: null,                   // null = the whole remaining balance
            p_pay_date: settlePlan.payDate,
            p_method: settlePlan.method,
            p_payable_statuses: ['received'], // it was just inserted as 'received'
            p_client_key: randomUUID(),
          })
          if (settleErr) {
            // [NO-SILENT-EMPTY] Never swallowed. The invoice is correct either way, but an owner
            // who was told "automatisch afgehandeld" and finds it in "nog te betalen" needs the
            // trail to say which half ran.
            console.error('[BON-AUTO] receipt settlement failed — left as received (unpaid)', {
              invoiceId: insertedInvoice.id, error: settleErr.message,
            })
          } else {
            // A 'kas' booking is a dated kasboek movement; one reconcile after the loop closes
            // them all, so the drawer is never a pass behind.
            if (settlePlan.method === 'kas') cashSettledThisRun = true
            await logAuditAction({
              userId,
              action: 'invoice.auto_paid',
              entityType: 'invoice',
              entityId: insertedInvoice.id,
              oldValue: { status: 'received' },
              newValue: {
                status: 'paid', method: settlePlan.method, payment_date: settlePlan.payDate,
                reason: settlePlan.reason, evidence: pay.paidEvidence ?? null,
                source: 'email_receipt_auto_settle',
              },
            }).catch(() => {})
          }
        }

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
      // [watermark] NOT complete — unknown failure; the mark stops here … unless this attachment
      // has now failed SYNC_MAX_ATTEMPTS times (poison pill), in which case we give up and let the
      // mark pass so it stops blocking every newer invoice.
      const msg = error instanceof Error ? error.message : String(error)
      const gaveUp = await recordFailedAttempt(attachment, msg)
      if (gaveUp) {
        couldNotRead++
        completedKeys.add(wmKey)
      } else {
        errors++
      }
    }
  }

  // [POISON-PILL] Clear the failure counter for every attachment that completed this run (saved,
  // duplicate, terminal skip, or given up) — a flaky file that finally succeeded must not carry a
  // stale count toward a future give-up. Failed-this-round attachments keep their (just-incremented)
  // count so the next sync sees it.
  if (completedKeys.size > 0) {
    for (const chunk of chunkArray([...completedKeys], 100)) {
      await supabase
        .from('email_failed_attempts')
        .delete()
        .eq('user_id', userId)
        .in('source_message_id', chunk)
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

    // [NAN-DATE-GUARD] A message whose date didn't parse (missing/malformed
    // Date header) can NEVER enter the walk: its timestamp is NaN, and since
    // NaN === NaN is false the group loop below would not advance → the sync
    // would spin forever (observed as a 300s timeout on every sync, and a hung
    // cron run starving every mailbox after this one). Rule, conservative:
    //  · every dateless message complete → they don't constrain the timeline;
    //    walk the dated messages normally.
    //  · any dateless message incomplete → HOLD the watermark entirely (the
    //    same all-or-nothing rule an incomplete timestamp group gets), so its
    //    attachments are retried next sync and nothing is lost.
    const datelessMsgs = messageIndex.filter(
      (m) => !Number.isFinite(new Date(m.date).getTime())
    )
    const datelessIncomplete = datelessMsgs.some(
      (m) => !messageComplete(m.messageId)
    )
    if (datelessMsgs.length > 0) {
      console.log('[NAN-DATE-GUARD] Messages with unparseable dates in window', {
        count: datelessMsgs.length,
        incomplete: datelessIncomplete,
      })
    }

    // [WATERMARK-SERVER-TIME] Second belt, and deliberately provider-INDEPENDENT: a message dated
    // in the future is not walked at all.
    //
    // Using Gmail's internalDate removes the sender's control over the Gmail side, and Microsoft
    // has always used receivedDateTime. This guard is what protects the mailbox when a provider
    // returns something odd anyway, and when a future path adds a third provider that has not read
    // this comment. The cost of being wrong here is not one lost invoice: the watermark is the
    // point every later sync starts from, so one bad timestamp stops the import for as long as that
    // date is away — silently, while every run reports success.
    //
    // A small tolerance because clocks disagree: a message legitimately received seconds ago can
    // carry a timestamp a moment ahead of ours. A day is far beyond that and far below the harm.
    const futureFloorMs = Date.now() + 24 * 60 * 60 * 1000
    const futureDated = messageIndex.filter((m) => {
      const t = new Date(m.date).getTime()
      return Number.isFinite(t) && t > futureFloorMs
    })
    if (futureDated.length > 0) {
      console.warn('[WATERMARK-SERVER-TIME] messages dated in the future are excluded from the watermark walk', {
        count: futureDated.length,
        newest: futureDated.map((m) => m.date).sort().slice(-1)[0],
      })
    }

    const sortedMsgs = messageIndex
      .filter((m) => {
        const t = new Date(m.date).getTime()
        return Number.isFinite(t) && t <= futureFloorMs
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    let candidateIso: string | null = null
    if (!datelessIncomplete) {
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

  // [BANK-LINK] Close the circle immediately for invoices that auto-advanced to 'received' this
  // run. Their payment may already be sitting in an imported bank statement (this is exactly the
  // gap where invoice 26703066 showed "24 dagen te laat" while its €771,72 batch afschrijving sat
  // matched-but-unlinked). Run the SAME safe engine the daily cron runs — it books ONLY provably
  // exact reference+amount / iban+amount / exact-batch matches — so there is no risk of a wrong
  // link, just an earlier one. Best-effort and non-fatal: a failure defers to the cron / /bank page.
  if (autoAdvanced > 0) {
    try {
      const { runBankAutoConfirm } = await import('@/lib/bank-auto-confirm')
      await runBankAutoConfirm({ payClient: supabase, pipeline: createPipelineClient(), userId })
    } catch (e) {
      console.error('[BANK-LINK] post-import auto-confirm failed (non-fatal)', e)
    }
  }

  // [BON-AUTO] En de kaslade. Een contant afgeboekte bon is geld dat de la uit is; zonder deze pas
  // staat de betaling wel op de factuur maar niet in het kasboek, en dan klopt het kassaldo dat de
  // boekhouder leest niet met de facturen eronder. Eén keer per run, na alle bonnen.
  if (cashSettledThisRun) {
    try {
      const { reconcileCashSettlements } = await import('@/lib/cash-settle')
      await reconcileCashSettlements(createPipelineClient(), userId)
    } catch (e) {
      console.error('[BON-AUTO] kasboek reconcile after auto-settle failed (non-fatal)', e)
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
    // [BEL-BEREIKT-NIEMAND] Geen eigen client meer: notifyRow maakt de service_role-client zelf,
    // zodat niemand hier per ongeluk een anon-client kan doorgeven (notifications heeft geen INSERT-policy).
    // [BOEK-011] Provider-aware copy — Outlook users shouldn't read "Gmail".
    const providerLabel = tokens.provider === 'outlook' ? 'Outlook' : 'Gmail'
    // [BOEK-SAFECORE] Honest copy: when some invoices are HELD for review, say
    // so — don't tell the user to confirm payment on an invoice we've flagged
    // as arithmetically wrong. We don't over-claim ("all checked"); we state
    // the concrete situation only.
    //
    // [AUTO-ADVANCE-HONESTY] …and never tell the owner to confirm invoices the app
    // ALREADY confirmed. `autoAdvanced` landed as 'received' (booked, unpaid) and is
    // therefore NOT in the verify queue — it lives on Inkoopfacturen. The old copy
    // said "Bevestig ze in Inkomend" for every imported invoice and always linked
    // there, so a sync that auto-booked everything sent the owner to an empty queue
    // looking for work that was already done. Split the two groups; link to whichever
    // one actually needs them (the queue when anything waits, else the booked list).
    const queued = Math.max(0, saved - autoAdvanced) // still awaiting a confirming tap
    const heldNote =
      held > 0
        ? ` ${held} ${held === 1 ? 'daarvan heeft' : 'daarvan hebben'} extra aandacht nodig (mogelijk een rekenfout).`
        : ''
    let body: string
    if (autoAdvanced > 0 && queued === 0) {
      // Everything was clean and confident: nothing to confirm at all.
      body =
        `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald en ` +
        `${saved === 1 ? 'hem' : 'ze'} automatisch gecontroleerd en geboekt — klaar voor je boekhouder. ` +
        `Je hoeft niets te bevestigen; nakijken kan bij Inkoopfacturen.`
    } else if (autoAdvanced > 0) {
      body =
        `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald. ` +
        `${autoAdvanced} ${autoAdvanced === 1 ? 'is' : 'zijn'} automatisch geboekt (staan bij Inkoopfacturen); ` +
        `${queued} ${queued === 1 ? 'wacht' : 'wachten'} op je bevestiging in Inkomend.${heldNote}`
    } else if (held > 0 && held < saved) {
      body =
        `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald. ` +
        `${held} ${held === 1 ? 'factuur staat' : 'facturen staan'} klaar ter controle ` +
        `(mogelijk een rekenfout). Bevestig de rest.`
    } else if (held > 0) {
      body =
        `BoekBrug heeft ${held} ${held === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald die ` +
        `${held === 1 ? 'controle nodig heeft' : 'controle nodig hebben'} (mogelijk een rekenfout).`
    } else {
      body = `BoekBrug heeft ${saved} ${saved === 1 ? 'factuur' : 'facturen'} uit je ${providerLabel} gehaald. Bevestig ze in Inkomend.`
    }

    const notified = await notifyRow({
      user_id: userId,
      title: `${saved} nieuwe ${saved === 1 ? 'factuur' : 'facturen'} geïmporteerd`,
      body,
      type: 'invoice',
      read: false,
      // [AUTO-ADVANCE-HONESTY] Land the owner where the work (or the result) is.
      link: queued === 0 && autoAdvanced > 0
        ? '/dashboard/incoming/manage?filter=auto'
        : '/dashboard/incoming',
    })
    if (!notified) {
      console.error('[BOEK-011] Failed to write notification')
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
    // [AUTO-ADVANCE-HONESTY] Of `saved`, how many the app verified AND booked itself
    // ('received'). These are NOT in the verify queue, so a caller that says
    // "X geïmporteerd — bevestig ze" without this number is telling the owner to go
    // find work that no longer exists. Every sync UI reads it (see the incoming page).
    autoAdvanced,
    errors,
    // [BOEK-011] New attachments beyond this batch's cap — the client uses
    // this to auto-continue syncing until the backlog is drained, showing
    // progress instead of silently importing a fraction.
    // [BIG-MAILBOX] When the listing window was narrowed (backlog > one sync can page), mail newer
    // than this slice is deferred and not counted in remainingAfterBatch. Report at least 1 so the
    // client keeps auto-continuing across slice boundaries instead of stopping until the next cron;
    // the no-progress guard still stops it if a round genuinely advances nothing.
    remaining: windowNarrowed ? Math.max(remainingAfterBatch, 1) : remainingAfterBatch,
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
// ─── [MAILTEKST] The invoice that never had an attachment ─────────────────────
//
// Both listings above ask for mail WITH an attachment — Gmail through `has:attachment`, Outlook by
// dropping `!hasAttachments`. A hosting bill, a phone subscription or a parking app that lays the
// invoice out in the message body was therefore never even seen: not skipped, not reported, not
// counted. The cost never entered the books and the voorbelasting was never claimed, every month,
// for as long as the subscription runs.
//
// This is a SEPARATE, bounded pass, and separate on purpose. It never touches messageIndex, so the
// watermark walk that guarantees no attachment is skipped cannot be corrupted by it: a failure here
// leaves the main import exactly as it was. It has no watermark of its own either — it re-scans the
// same window each sync and lets the existing `${messageId}:${filename}` dedup decide what is new,
// which is self-healing and needs no migration.
//
// Every candidate is filtered MECHANICALLY first (see email-body-invoice.ts), then rendered to a
// PDF and pushed through the ordinary pipeline as an attachment — same dedup, same classifier, same
// health gates, same queue. Nothing here is ever booked automatically; see the auto-advance refusal.

/** How many messages one run will look at. This is a supplement, not the main path. */
const MAX_BODY_SCAN = 60

/** The words that make Gmail's own index do the first filtering, for free. */
const BODY_SEARCH_WORDS = ['factuur', 'invoice', 'faktuur', 'nota', 'rekening', 'rechnung']

/**
 * Body-only invoice candidates, already rendered as PDFs and shaped like any other attachment.
 *
 * Best-effort throughout: every failure returns what was gathered so far rather than throwing, so
 * this can never take down the sync it is a supplement to.
 */
export async function fetchBodyOnlyInvoices(
  provider: EmailProvider,
  accessToken: string,
  syncAfterMs: number,
  ownEmail: string | null,
): Promise<{ items: GmailAttachment[]; scanned: number; capped: boolean }> {
  try {
    return provider === 'gmail'
      ? await fetchGmailBodyInvoices(accessToken, syncAfterMs)
      : await fetchOutlookBodyInvoices(accessToken, syncAfterMs, ownEmail)
  } catch (e) {
    console.error('[MAILTEKST] body scan failed (non-fatal — the attachment import is unaffected)', {
      provider, error: e instanceof Error ? e.message : String(e),
    })
    return { items: [], scanned: 0, capped: false }
  }
}

/** The text of a message body, HTML preferred (that is where the table with the amounts is). */
function gmailBodyText(payload: unknown): string {
  let html = ''
  let plain = ''
  const walk = (part: unknown, depth: number) => {
    if (depth > 8 || !part || typeof part !== 'object') return
    const p = part as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }
    if (p.parts) { for (const child of p.parts) walk(child, depth + 1); return }
    const data = p.body?.data
    if (!data) return
    const decoded = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    if (p.mimeType === 'text/html' && !html) html = decoded
    else if (p.mimeType === 'text/plain' && !plain) plain = decoded
  }
  walk(payload, 0)
  return htmlToReadableText(html || plain)
}

async function fetchGmailBodyInvoices(
  accessToken: string,
  syncAfterMs: number,
): Promise<{ items: GmailAttachment[]; scanned: number; capped: boolean }> {
  const afterDate = new Date(syncAfterMs).toISOString().slice(0, 10).replace(/-/g, '/')
  // Gmail's own index does the first pass, at no cost to us: only mail WITHOUT an attachment that
  // mentions an invoice word anywhere in it. Everything expensive happens after this.
  const q =
    `-has:attachment after:${afterDate} in:anywhere -in:sent -in:drafts -in:chats ` +
    `{${BODY_SEARCH_WORDS.join(' ')}}`
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${MAX_BODY_SCAN}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!listRes.ok) {
    console.error('[MAILTEKST] Gmail body listing failed', { status: listRes.status })
    return { items: [], scanned: 0, capped: false }
  }
  const listed = (await listRes.json()) as { messages?: Array<{ id: string }>; nextPageToken?: string }
  const ids = (listed.messages ?? []).slice(0, MAX_BODY_SCAN)

  const items: GmailAttachment[] = []
  for (const { id } of ids) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!res.ok) continue
    const msg = (await res.json()) as {
      payload?: { headers?: Array<{ name: string; value: string }> }
      internalDate?: string
    }
    const headers = msg.payload?.headers ?? []
    const header = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value ?? ''
    const subject = header('subject')
    const text = gmailBodyText(msg.payload)
    const built = await buildBodyAttachment({
      messageId: id, subject, from: header('from'), text,
      date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
    })
    if (built) items.push(built)
  }
  return { items, scanned: ids.length, capped: !!listed.nextPageToken }
}

async function fetchOutlookBodyInvoices(
  accessToken: string,
  syncAfterMs: number,
  ownEmail: string | null,
): Promise<{ items: GmailAttachment[]; scanned: number; capped: boolean }> {
  // Graph cannot full-text search and filter by date in one call, so the first pass is on the
  // SUBJECT. That is a real limitation and it is written down rather than hidden: a body-only
  // invoice titled "Your monthly statement" is not reached by this pass. It is still a great deal
  // better than the previous answer, which was that no body invoice was reached at all.
  const since = new Date(syncAfterMs).toISOString()
  const subjectFilter = BODY_SEARCH_WORDS.map((w) => `contains(subject,'${w}')`).join(' or ')
  const filter = `receivedDateTime ge ${since} and hasAttachments eq false and (${subjectFilter})`
  const url =
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,subject,from,receivedDateTime,body&$top=${MAX_BODY_SCAN}`
  const res = await graphFetch(url, accessToken)
  if (!res.ok) {
    console.error('[MAILTEKST] Outlook body listing failed', { status: res.status })
    return { items: [], scanned: 0, capped: false }
  }
  const data = (await res.json()) as {
    value?: Array<{
      id: string; subject?: string; receivedDateTime?: string
      from?: { emailAddress?: { name?: string; address?: string } }
      body?: { contentType?: string; content?: string }
    }>
    '@odata.nextLink'?: string
  }
  const messages = data.value ?? []
  const items: GmailAttachment[] = []
  for (const m of messages) {
    const addr = m.from?.emailAddress?.address ?? ''
    // Mail the owner sent themselves is not a purchase invoice.
    if (ownEmail && addr && addr.toLowerCase() === ownEmail.toLowerCase()) continue
    const name = m.from?.emailAddress?.name ?? ''
    const built = await buildBodyAttachment({
      messageId: m.id,
      subject: m.subject ?? '',
      from: name && addr ? `${name} <${addr}>` : (addr || name),
      text: htmlToReadableText(m.body?.content ?? ''),
      date: m.receivedDateTime || new Date().toISOString(),
    })
    if (built) items.push(built)
  }
  return { items, scanned: messages.length, capped: !!data['@odata.nextLink'] }
}

/**
 * One candidate: filtered, rendered, and shaped like any other attachment.
 *
 * Returns null for everything the mechanical filter refuses — which is the overwhelming majority of
 * mail, and the reason this path is affordable at all. Nothing is sent anywhere before that filter
 * has run.
 */
async function buildBodyAttachment(m: {
  messageId: string; subject: string; from: string; text: string; date: string
}): Promise<GmailAttachment | null> {
  const verdict = bodyLooksLikeInvoice(m.text, m.subject)
  if (!verdict.candidate) return null
  const pdf = await textToPdf(m.text, { subject: m.subject, from: m.from, date: m.date.slice(0, 10) })
  if (!pdf) return null
  return {
    messageId: m.messageId,
    filename: bodyDocumentName(m.subject),
    mimeType: 'application/pdf',
    data: pdf.toString('base64'),
    subject: m.subject,
    from: m.from,
    date: m.date,
    size: pdf.length,
    fromBody: true,
  }
}
