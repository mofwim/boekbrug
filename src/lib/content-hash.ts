// src/lib/content-hash.ts
// [BRIDGE-EXTRACT] Layer 1 — content-addressed byte-hash for dedup
// =====================================================
// Principe: één bestand → één hash → één record → alleen verwijzingen.
//
// De hash wordt berekend over de RUWE bytes van het bestand — niet over
// AI-geëxtraheerde tekst. Identieke bytes → identieke hash, deterministisch.
// Dat is wat de byte-hash betrouwbaar maakt waar de oude content_hash
// (MD5 van AI-velden) faalde: Atapack vs Atapacks gaf verschillende tekst,
// dus verschillende hash, dus een ontsnapte duplicaat. Bytes liegen niet.
//
// Server-only — Node 'crypto'. Nooit importeren in een Client Component.
// =====================================================

import { createHash } from 'crypto'

/**
 * Bereken de content-hash van een bestand uit zijn ruwe bytes.
 *
 * SHA-256 over de buffer. Geserialiseerd als lowercase hex.
 * Hetzelfde bestand levert altijd dezelfde hash op, ongeacht via welk
 * uploadpad (e-mail, handmatige factuur, Mijn bestanden) het binnenkomt.
 * Daarom dedupliceren we cross-path op (user_id, content_hash) in documents.
 *
 * @param input  Bestandsinhoud als Buffer, Uint8Array, of ArrayBuffer.
 * @returns       64-teken lowercase hex SHA-256 hash.
 */
export function computeContentHash(
  input: Buffer | Uint8Array | ArrayBuffer
): string {
  let buf: Buffer
  if (Buffer.isBuffer(input)) {
    buf = input
  } else if (input instanceof ArrayBuffer) {
    buf = Buffer.from(input)
  } else {
    // Uint8Array (of view) — kopieer de exacte bytes
    buf = Buffer.from(input)
  }
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Convenience: bereken de hash rechtstreeks uit een web File/Blob.
 * Leest de bytes via arrayBuffer(). Gebruikt op het Mijn-bestanden-pad,
 * waar uploadDocument() een File ontvangt in plaats van een Buffer.
 */
export async function computeContentHashFromFile(file: Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  return computeContentHash(arrayBuffer)
}