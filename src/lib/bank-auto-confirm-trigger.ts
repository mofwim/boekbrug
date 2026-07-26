// src/lib/bank-auto-confirm-trigger.ts
// [BANK-AUTO-RUN] Client-side helper to fire the bank auto-confirm pass from OTHER screens.
//
// The circle should close wherever the owner is standing — not only on /bank. The moment an
// invoice becomes verified (an incoming invoice moves out of the verify queue to 'received'),
// it becomes matchable; if the bank line that paid it is already sitting 'pending', the app
// should book that link right then, so the owner never has to walk over to /bank to do it.
//
// This just POSTs the existing, authoritative /api/bank/auto-confirm (no body — it books the
// whole safe set) and returns how many it booked. Fire it ONCE per user action (after a single
// verify, or ONCE after a bulk-verify batch — never per invoice, which would re-scan N times).
// Best-effort: any failure returns 0 and never disturbs the verify flow — the /bank load pass
// remains the backstop that catches anything missed here.
export async function triggerBankAutoConfirm(): Promise<number> {
  try {
    const res = await fetch("/api/bank/auto-confirm", { method: "POST" });
    if (!res.ok) return 0;
    const json = await res.json().catch(() => null);
    return typeof json?.count === "number" ? json.count : 0;
  } catch {
    return 0;
  }
}
