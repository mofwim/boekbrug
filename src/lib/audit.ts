// src/lib/audit.ts
// [BOEK-SECURITY-2] Audit logging helper — v2 — May 2026
// [BOEK-FOUNDATION-TYPES] Use Supabase Json type for jsonb columns — May 2026
// [BRIDGE-EXTRACT] + 'document.duplicate_blocked' added to AuditAction union — Jun 2026
// [BOEK-SAFECORE] + 'invoice.arithmetic_blocked' added to AuditAction union — Jun 2026
// =====================================================
// التغييرات في v2:
//   + أُضيف 'invoice.duplicated' للـ AuditAction union
//   + أُضيف 'creditnota.created' (بدلاً من invoice.creditnota_created)
//     للاتساق مع الـ ٤٠ historical rows في DB
//   + Json type cast للـ jsonb columns
// =====================================================
// يسجّل critical actions في audit_logs (GDPR compliance)
// كل writes تمر عبر service_role
// Non-fatal: لو الـ audit log فشل، العملية الأساسية تستمر
// =====================================================

import { createPipelineClient } from '@/lib/supabase-pipeline'
import type { Database } from '@/types/database.types'

// [BOEK-FOUNDATION-TYPES] Json type matches Supabase jsonb column type
type Json = Database['public']['Tables']['audit_logs']['Row']['old_value']

// ── Types ─────────────────────────────────────────────

/**
 * Discrete action codes — lowercase dot-notation.
 * Group prefix indicates domain (invoice., accountant., document., user., email.)
 *
 * NOTE: Some actions match the existing 40 historical audit rows for consistency:
 *   - 'invoice.duplicated', 'invoice.updated', 'invoice.deleted'
 *   - 'creditnota.created' (NOT 'invoice.creditnota_created')
 */
export type AuditAction =
  // Level 1 — Financial (critical)
  | 'invoice.created'
  | 'invoice.updated'
  | 'invoice.deleted'
  | 'invoice.duplicated'              // ← v2: matches historical data
  | 'invoice.dedup_override'          // ← [INTAKE-FORCE] owner added despite a semantic-duplicate match ("toch toevoegen")
  | 'invoice.status_changed'
  | 'creditnota.created'              // ← v2: matches historical data
  | 'invoice.numbering_configured'     // ← [FACTUUR-B] start point set/changed
  | 'invoice.numbering_change_blocked' // ← [FACTUUR-B] locked change refused (Art. 35)
  | 'invoice.arithmetic_blocked'       // ← [BOEK-SAFECORE] auto-import held in 'processing': excl+BTW≠incl, illegal rate, or NaN/∞/≤0/bad-date
  // Level 2 — Accountant relationships
  | 'accountant.client_invited'
  | 'accountant.client_linked'
  | 'accountant.client_unlinked'
  | 'accountant.invoice_status_set'
  // Level 3 — Files
  | 'document.uploaded'
  | 'document.duplicate_blocked'      // ← [BRIDGE-EXTRACT] byte-hash dedup: re-upload of identical file refused
  | 'document.deleted'
  | 'document.bulk_deleted'
  | 'document.restored'
  | 'folder.created'
  | 'folder.deleted'
  | 'folder.renamed'
  // Level 4 — Security / account
  | 'user.password_changed'
  | 'user.email_changed'
  | 'user.account_deletion_requested'
  | 'email.connection_created'
  | 'email.connection_revoked'

export interface AuditParams {
  /** Profile ID للمستخدم الذي فعل الـ action */
  userId: string
  /** نوع العملية (انظر AuditAction) */
  action: AuditAction
  /**
   * اسم الـ entity — string حر، لكن استخدم singular للاتساق مع historical data:
   *   'invoice', 'document', 'folder', 'profile', 'accountant_client', 'email_connection'
   */
  entityType: string
  /** ID الـ row المتأثر (اختياري) */
  entityId?: string
  /** القيمة قبل التغيير (للـ updates) — tokens تُحذف تلقائياً */
  oldValue?: Record<string, unknown>
  /** القيمة بعد التغيير — tokens تُحذف تلقائياً */
  newValue?: Record<string, unknown>
  /** IP العميل (من req headers — استخدم getClientIP) */
  ipAddress?: string
}

// ── PII Sanitization ──────────────────────────────────

/**
 * Fields that MUST NEVER be logged in audit trails.
 * Tokens, secrets, passwords, etc.
 */
const FORBIDDEN_FIELDS = new Set([
  'access_token',
  'refresh_token',
  'access_token_secret_id',
  'refresh_token_secret_id',
  'password',
  'password_hash',
  'token',
  'secret',
  'api_key',
])

/**
 * Strips forbidden fields from an object before logging.
 * Also caps total JSON size at 10KB per record.
 * [BOEK-FOUNDATION-TYPES] Returns Json type compatible with jsonb columns
 */
function sanitizeForAudit(
  obj: Record<string, unknown> | undefined
): Json | undefined {
  if (!obj) return undefined

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_FIELDS.has(key)) continue
    cleaned[key] = value
  }

  // حد الحجم — 10KB أكثر من كافٍ، يمنع DoS عبر large jsonb
  const json = JSON.stringify(cleaned)
  if (json.length > 10_000) {
    return { _truncated: true, _size: json.length, _preview: json.slice(0, 1_000) } as Json
  }

  // [BOEK-FOUNDATION-TYPES] Safe cast — sanitized content is JSON-compatible
  return cleaned as Json
}

// ── Main function ─────────────────────────────────────

/**
 * Records an audit log entry. NON-FATAL — failures are logged but do not throw.
 *
 * Uses service_role via createPipelineClient — bypasses RLS.
 * After BOEK-SECURITY-2 migration, this is the ONLY way to write audit_logs.
 *
 * @example
 *   await logAuditAction({
 *     userId: user.id,
 *     action: 'invoice.created',
 *     entityType: 'invoice',           // singular — matches historical data
 *     entityId: invoice.id,
 *     newValue: invoice,
 *     ipAddress: getClientIP(req),
 *   })
 */
export async function logAuditAction(params: AuditParams): Promise<void> {
  try {
    const supabase = createPipelineClient()

    const { error } = await supabase.from('audit_logs').insert({
      user_id:     params.userId,
      action:      params.action,
      entity_type: params.entityType,
      entity_id:   params.entityId,
      old_value:   sanitizeForAudit(params.oldValue),
      new_value:   sanitizeForAudit(params.newValue),
      ip_address:  params.ipAddress,
    })

    if (error) {
      console.error('[BOEK-SECURITY-2] Audit log failed', {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        error: error.message,
      })
    }
  } catch (err) {
    // Catch-all — audit يجب ألا يكسر العملية الأساسية أبداً
    console.error('[BOEK-SECURITY-2] Audit log threw', { params, err })
  }
}

// ── IP extraction helper ──────────────────────────────

/**
 * Extracts client IP from Next.js request headers.
 * Works with Vercel + standard reverse proxies.
 * Returns undefined if no IP available (tests, server-side calls, etc.)
 *
 * Accepts NextRequest, Request, or any object with headers.get(name).
 */
export function getClientIP(req: Request): string | undefined {
  // Vercel + reverse proxies → x-forwarded-for
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    // قد يكون قائمة بـ commas — أول واحد هو الـ client الفعلي
    return forwarded.split(',')[0]?.trim() || undefined
  }

  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  return undefined
}