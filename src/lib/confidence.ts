// src/lib/confidence.ts
// [LEVERANCIER-STAAT-IN-HET-LOGO] The one line between "the reader is sure" and "look again — and
// if it is still unsure, ask". A leaf: it imports nothing, so a screen can hold it without pulling
// a reading pipeline into the browser bundle.
//
// This number existed three times: in import-health's verdict, in the verify modal's own
// `const LOW = 0.7`, and in the decision to re-read a PDF through its visual layout. The comment
// beside one of them said "kept identical" — which is a promise a person keeps, not a property the
// code has.
//
// The three answer one question in sequence, and that is why they may not drift apart:
//
//   below this line  →  the app looks at the PAGE again (ai.ts, needsVisualReread)
//   still below it   →  the field gets a ⚠️ and the owner is asked (the queue, import-health)
//
// Two different lines would mean warning about invoices the app had already repaired, or repairing
// invoices it never warned about. Both are worse than either number on its own.

/** A per-field score below this is not trusted. 0–1, as the reader reports it. */
export const LOW_CONFIDENCE = 0.7
