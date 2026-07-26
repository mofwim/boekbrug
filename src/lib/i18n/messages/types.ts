// src/lib/i18n/messages/types.ts
// [I18N] Non-Dutch catalogs are a deep-partial of the Dutch source of truth:
// any key may be omitted and will fall back to Dutch at lookup time.

import type { Messages } from './nl'

// The Dutch source is declared `as const`, so its leaf values are string LITERAL
// types (e.g. "Opslaan"). A translation must keep the same key structure but hold
// a DIFFERENT string, so leaves are widened to `string` here — only the shape of
// the keys is the contract, not the Dutch text.
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : string
}

export type PartialMessages = DeepPartial<Messages>
