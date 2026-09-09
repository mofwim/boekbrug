// src/lib/duplicate-sentence.ts
// [MELDING-WEG] [TAAL] Where a duplicate already is, as a catalogue sentence.
// Run: npx tsx --test src/lib/duplicate-sentence.test.ts
//
// Three routes answer a byte-identical upload with 409 and one shape: `existing`, carrying the
// file's id, its folder and — since this module — `folder_path`, the breadcrumb of folder names.
// They also send `error`, a finished Dutch sentence: "Dit bestand staat al in: 2026 / Q3 / juli /
// Facturen". Both upload screens printed that sentence as it came, so an owner reading Arabic met
// one line of Dutch in a list that was otherwise theirs.
//
// The folder names stay what they are: they are the owner's own folders, stored values, and a
// stored value is not translated (AGENTS.md). The sentence AROUND them is the app's, so it comes
// from the catalogue like every other sentence on those screens.
//
// Two duplicate answers deliberately keep the server's sentence, and this module says so by
// returning null for them:
//   · an ARCHIVED duplicate — the invoice sits in Genegeerd, and the sentence names it and the way
//     back (archivedDuplicateMessage);
//   · a SEMANTIC duplicate — a different file that looks like an invoice already in the books
//     (canForce / original_id). The server's sentence says what matched, and `existing`, when it
//     is there at all, is the matched invoice's document, not this file's twin. "Dit bestand staat
//     al in …" would be false there: this file is NOT in the books, its look-alike is.
// Translating those two is a separate, larger step.

import type { MessageKey } from "./i18n/messages";

export interface DuplicateWhere {
  key: MessageKey;
  params?: Record<string, string>;
}

export function duplicateWhere(data: unknown): DuplicateWhere | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.archived) return null;
  if (d.canForce || d.original_id) return null;
  const existing = d.existing;
  if (!existing || typeof existing !== "object") return null;
  const raw = (existing as Record<string, unknown>).folder_path;
  const path = (Array.isArray(raw) ? raw : []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return path.length > 0
    ? { key: "up.staatAlIn", params: { path: path.join(" / ") } }
    : { key: "up.alToegevoegdZin" };
}
