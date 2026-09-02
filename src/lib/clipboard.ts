// src/lib/clipboard.ts
// [KOPIE-EERLIJK] The one place in this app that writes to the clipboard, and the one place that
// decides whether the write happened.
//
// ── WHY THIS IS A MONEY RULE ──
//
// Five hand-rolled copy helpers had the same shape:
//
//     try { await navigator.clipboard.writeText(value) } catch { /* may be blocked */ }
//     setCopied(label)                                   // ← runs either way
//
// …so a REFUSED write still told the owner "IBAN gekopieerd". That reads like a cosmetic slip. It
// is not, because a clipboard that refuses a write does not become empty — it keeps what was in it
// BEFORE. The three values these helpers copy are the three fields of a bank transfer: the IBAN,
// the amount and the payment reference.
//
// So: open supplier A's payment sheet, copy the IBAN. Open supplier B's, tap copy, and the write is
// refused. The app says "IBAN gekopieerd". The clipboard still holds A's IBAN. The owner pastes it
// into their banking app and pays the wrong supplier — and every screen they looked at told them
// the right thing was on the clipboard.
//
// Refusal is not exotic here. `writeText` rejects when the document is not focused, outside a
// secure context, when permission is denied, and in several in-app WebViews. This app ships to
// Android as a Trusted Web Activity, which is the WebView case.
//
// ── THE RULE ──
//
// Every copy in this app goes through here, and this function returns whether it WORKED. Callers
// branch on the answer; nobody reports a success they were not given. A [KOPIE-EERLIJK] gate keeps
// `navigator.clipboard` out of every other file, so a sixth hand-rolled helper cannot come back.

/**
 * Put `value` on the clipboard. Returns true ONLY when the write resolved.
 *
 * False means: nothing was copied and the clipboard still holds whatever it held before. Tell the
 * user — do not fall through to a success message.
 */
export async function copyToClipboard(value: string | null | undefined): Promise<boolean> {
  const text = (value ?? "").trim();
  // Nothing to copy is not a success. Reporting one would leave the owner pasting the PREVIOUS
  // value, which is the same failure this module exists to prevent.
  if (!text) return false;
  try {
    // Not every context has the API at all (an old WebView, a non-secure origin): reading through
    // it unguarded throws a TypeError, which the catch below would turn into `false` anyway — but
    // the explicit check keeps that outcome a decision rather than an accident.
    const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
