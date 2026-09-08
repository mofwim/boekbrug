// src/lib/betaalverzoek-share.ts
// [BESTE] The betaalverzoek as a WhatsApp message.
//
// Every package that offers a pay link (Moneybird, Tellow, Mollie's own request page) offers it as
// a WhatsApp message, because that is where a small business and its customer already talk. The
// text below is read by the CUSTOMER, so it is Dutch in every language setting — the same rule as
// the invoice e-mail (AGENTS.md, "never translated"). Pure; the button only opens the URL.
//
// Run: npx tsx --test src/lib/betaalverzoek-share.test.ts

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export interface ShareInput {
  invoiceNumber: string;
  amount: number;
  url: string;
}

/** The Dutch message the customer reads. */
export function whatsappShareText(input: ShareInput): string {
  const number = input.invoiceNumber.trim();
  const head = number ? `Factuur ${number}` : "Factuur";
  return `${head}: ${eur.format(input.amount)}. Betaal veilig via ${input.url}`;
}

/** The wa.me link with the message prefilled — the contact is chosen in WhatsApp itself. */
export function whatsappShareUrl(input: ShareInput): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsappShareText(input))}`;
}
