// src/lib/bank-category-text.ts
// [TAAL] The owner-facing name of a bank category, as a catalogue key per category.
//
// bank-categories.ts carries the vocabulary with a Dutch label per entry, and the categorise
// screen renders that label directly — which is right in Dutch and a permanent gap in every other
// language. This module is the translated half: one literal key per category, so the [TAAL] gate
// can prove each declared key is rendered, and a screen in Arabic names the category in Arabic.
// The bank screen itself is left as it was; the supplier editor and list read from here.

import type { BankCategory } from './bank-categories'
import type { MessageKey } from './i18n/messages'

export const BANK_CATEGORY_KEY: Record<BankCategory, MessageKey> = {
  omzet: 'bankcat.omzet',
  pos_income: 'bankcat.pos_income',
  kosten: 'bankcat.kosten',
  fee: 'bankcat.fee',
  prive: 'bankcat.prive',
  transfer: 'bankcat.transfer',
  tax: 'bankcat.tax',
}
