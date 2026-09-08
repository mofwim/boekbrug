// src/lib/first-view.ts
// [BESTE] "Bekeken door de klant op …" — the moment a customer first opened the pay or offerte page.
//
// Moneybird, FreshBooks and Xero show it on the invoice; it answers the question behind half of
// all reminders ("did they even see it?"). Written ONCE, by the public page itself, under
// `IS NULL` so a second visit never moves the date. A failed stamp is logged and swallowed: the
// customer is on a public page that must render, and a missing column (a deploy ahead of its
// migration) must not turn into a 503 for them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function stampFirstView(db: any, invoiceId: string): Promise<void> {
  try {
    const { error } = await db
      .from("invoices")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .is("first_viewed_at", null);
    if (error) console.error("[BESTE] first view not stamped", { invoiceId, error: error.message });
  } catch (e) {
    console.error("[BESTE] first view not stamped", { invoiceId, error: e instanceof Error ? e.message : String(e) });
  }
}
