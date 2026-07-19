// src/lib/timing-safe.ts
// [SECURITY] Constant-time string comparison for secrets (cron bearer tokens, webhook signatures).
// A plain `a === b` short-circuits on the first differing byte, so the response time leaks how many
// leading bytes a guess got right — enough, over many tries, to recover a secret. We compare in
// time that does not depend on WHERE the strings differ.
import { timingSafeEqual as nodeTimingSafeEqual, createHash } from 'crypto'

/**
 * True iff `a` and `b` are byte-identical, compared in constant time.
 *
 * Both sides are SHA-256'd first so that (1) the buffers handed to crypto.timingSafeEqual are always
 * the same length — it throws on a length mismatch — and (2) the length of the secret does not leak
 * through the comparison either. Hashing is deterministic and adds no measurable branch on content.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  // Same length (32 bytes) by construction, so this never throws.
  return nodeTimingSafeEqual(ha, hb)
}
