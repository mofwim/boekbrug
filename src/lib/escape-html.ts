// src/lib/escape-html.ts
// [M2] Escaping for anything user-controlled that lands in an HTML e-mail body.
//
// WHY IT LIVES ON ITS OWN
// It was a module-private function in email.ts, which is where all 40-odd senders are. That was
// fine until a customer-facing body needed to become a PURE function so it could be tested — and
// offerte-send.ts cannot import from email.ts, because email.ts already imports offerteSubject()
// from there. The escaper is the shared piece, so the escaper moves out. Nothing about its
// behaviour changes; email.ts imports the same function it used to declare.
//
// Duplicating it instead would have been the wrong fix twice over: two escapers drift, and this
// one is the boundary where a customer's name stops being markup.

/**
 * Escape a string that is interpolated into an HTML e-mail body.
 *
 * Client names, invoice numbers, message text and accountant names all reach third parties, so a
 * name like `<b>…` or an injected link must render as literal text, never as markup. Scripts are
 * already stripped by mail clients (no XSS), but this closes phishing / spoofing / hidden-text
 * injection.
 *
 * Subjects are plain-text headers and are deliberately NOT passed through this — escaping there
 * would put a literal `&amp;` in the subject line a person reads.
 */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
