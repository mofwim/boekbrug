// src/lib/recon-confirm-client.ts
// [BANK-RECON-CONFIRM] Client helper: turn the "Betaling gevonden" chip into a REAL one-tap
// confirm instead of a navigation. The reconciliation payload already carries the matched bank
// line's id (bank-reconciliation.pendingMatch.transactionId), so the invoice screen can book the
// payment through the SAME fully-guarded confirm route the bank page uses — no detour.
// Returns 'ok' when the payment was booked, 'fallback' when there was no match id to act on (the
// caller should then navigate to /dashboard/bank), or 'error' on a failed write.

export type ReconConfirmResult = "ok" | "fallback" | "error";

export async function confirmReconPayment(
  transactionId: string | null | undefined,
  invoiceId: string,
): Promise<ReconConfirmResult> {
  if (!transactionId) return "fallback";
  try {
    const res = await fetch("/api/bank/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId, invoiceId }),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
