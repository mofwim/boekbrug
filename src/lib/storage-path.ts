// src/lib/storage-path.ts
// [SEC-STORAGE-PATH] Who does a storage path belong to? Pure; no I/O.
// Run: npx tsx src/lib/storage-path.test.ts
//
// THE BUG THIS EXISTS TO PREVENT.
// Several routes proved that the caller may read an invoice ROW, and then handed that row's
// `pdf_url` to the service-role client to sign or download. Those are two different claims. The
// row check says "you may see this record"; it says nothing about WHERE the record points. And
// `pdf_url` is ordinary text on a row the caller is allowed to UPDATE (invoices_receiver_update)
// or INSERT (invoices_zzp_insert) — so a caller could put another tenant's storage key on their
// own invoice and have the server sign it for them. The service-role client bypasses the bucket
// policy that would otherwise have caught it.
//
// The rule, therefore: NEVER sign or download a path the caller could have written unless the
// path's own owner segment is the party the authorization actually covered.
//
// Every file this app writes is keyed `<owner-uuid>/<folder>/<name>`:
//   `${user.id}/incoming/${Date.now()}-${safeName}`   (intake, upload, bank attach, e-mail)
//   `${user.id}/facturen/${invoiceNumber}.pdf`        (invoice send, creditnota)
// so the first segment IS the owner, and checking it costs one string compare.

/** 8-4-4-4-12 hex, the shape Supabase user ids come in. Anything else is not an owner segment. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize a stored value to a relative storage path. Older rows may hold a full signed or public
 * URL instead of a key; newer ones hold the raw key. Returns the input unchanged when the shape is
 * not recognised — the CALLER must then refuse it, which is what pathBelongsToOwner does.
 */
export function toStoragePath(stored: string | null | undefined): string {
  const s = String(stored ?? "");
  if (!s.startsWith("http")) return s;
  const signMarker = "/object/sign/documents/";
  const publicMarker = "/object/public/documents/";
  let idx = s.indexOf(signMarker);
  if (idx !== -1) {
    idx += signMarker.length;
  } else {
    idx = s.indexOf(publicMarker);
    if (idx === -1) return s; // unknown shape — returned as-is, and therefore refused below
    idx += publicMarker.length;
  }
  try {
    return decodeURIComponent(s.slice(idx).split("?")[0]);
  } catch {
    // A malformed %-escape must not throw inside an auth check.
    return s.slice(idx).split("?")[0];
  }
}

/**
 * The uuid a storage key belongs to, or null when the key has no usable owner segment. Refuses
 * traversal (`..`), absolute keys and anything whose first segment is not a uuid — a path we
 * cannot attribute is a path we must not sign.
 */
export function storagePathOwner(path: string | null | undefined): string | null {
  const p = String(path ?? "").trim();
  if (!p || p.startsWith("http") || p.startsWith("/")) return null;
  if (p.includes("..")) return null;          // no climbing out of the owner's folder
  if (p.includes("\\")) return null;          // no backslash tricks on the key
  const first = p.split("/")[0];
  return UUID_RE.test(first) ? first.toLowerCase() : null;
}

/**
 * May this path be signed/downloaded on behalf of `ownerId`?
 *
 * True only when the key's own first segment IS that owner. Everything else is false, including a
 * missing owner, an unrecognised URL shape and a legacy key with no uuid prefix — all of which
 * are exactly the cases where we cannot prove whose bytes they are. Fails CLOSED on purpose: a
 * refused download is a support question, a wrong one is another tenant's invoice.
 */
export function pathBelongsToOwner(path: string | null | undefined, ownerId: string | null | undefined): boolean {
  const owner = String(ownerId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(owner)) return false;
  return storagePathOwner(path) === owner;
}

/**
 * Normalise a stored value AND attribute it in one call: the storage key when it provably belongs
 * to `ownerId`, otherwise null.
 *
 * This exists because the two-step form (`const p = toStoragePath(x); if (pathBelongsToOwner(p, o))`)
 * is two expressions that can drift apart, and drift is how a fifth caller ends up normalising
 * without checking — the exact shape that left the closing package and the GDPR export handing a
 * service-role download whatever text sat in the row. One call cannot be half-applied.
 *
 * Null is the refusal, and every caller must treat it as one. Skipping the file is correct: an
 * absent attachment is a support question, the wrong one is another tenant's invoice.
 */
export function ownedStoragePath(
  stored: string | null | undefined,
  ownerId: string | null | undefined,
): string | null {
  const path = toStoragePath(stored);
  return pathBelongsToOwner(path, ownerId) ? path : null;
}
