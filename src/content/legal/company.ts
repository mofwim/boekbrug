// src/content/legal/company.ts
// [LEGAL-IDENTITY] The operator's legal identity shown in the Terms + Privacy statement. Sourced
// from environment variables so the real values live in the deployment (Vercel project settings),
// never hard-coded — and NEVER fabricated in the repo. Set these before go-live:
//   NEXT_PUBLIC_COMPANY_LEGAL_NAME · NEXT_PUBLIC_COMPANY_KVK · NEXT_PUBLIC_COMPANY_BTW ·
//   NEXT_PUBLIC_COMPANY_ADDRESS · NEXT_PUBLIC_COMPANY_CITY
// The fallbacks are deliberately PROVISIONAL ("(volgt)") so an unset value is obviously incomplete —
// it can never read as a real-but-false KVK/BTW/name/address on a legal document.
const env = (k: string): string | null => {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
};

export const company = {
  legalName: env("NEXT_PUBLIC_COMPANY_LEGAL_NAME") ?? "BoekBrug",
  kvk: env("NEXT_PUBLIC_COMPANY_KVK") ?? "(volgt)",
  btw: env("NEXT_PUBLIC_COMPANY_BTW") ?? "(volgt)",
  address: env("NEXT_PUBLIC_COMPANY_ADDRESS") ?? "(adres volgt)",
  city: env("NEXT_PUBLIC_COMPANY_CITY") ?? "Tilburg",
} as const;

/**
 * Fill the legal-identity placeholders in a legal markdown document from the configured company
 * identity. Pure string substitution over the known placeholder tokens; a token that isn't present
 * is a no-op, so it is safe to run on any of the legal docs.
 *
 * [PLAATS-VOLGT-DE-CONFIG] `[JOUW PLAATS]` came last, and it replaced two hard-coded "Tilburg"s in
 * the Terms: the vestigingsplaats in §1 and — the one that actually bites — the forum clause
 * ("bevoegde rechter te ..."). `city` was already configurable and already honoured on /steun, so
 * setting NEXT_PUBLIC_COMPANY_CITY to anything else produced a Terms document that named the wrong
 * place of establishment AND sent a dispute to a court in a district the operator has no seat in.
 * A forum clause pointing at the wrong rechtbank is precisely the clause a counterparty gets to
 * ignore, so the city is read from one place now instead of two.
 *
 * The check that keeps this honest is company.test.ts: it scans the RENDERED documents for any
 * surviving ALL-CAPS `[...]` token, so a placeholder added to the markdown without a matching
 * replacement here — or added to a document that never calls this function at all, as
 * cookiebeleid.ts does not — fails the build instead of shipping to a legal page.
 */
export function fillCompanyIdentity(md: string): string {
  return md
    .replaceAll("[JOUW NAAM/BV]", company.legalName)
    .replaceAll("[JOUW NAAM HIER]", company.legalName)
    .replaceAll("[JOUW NAAM]", company.legalName)
    .replaceAll("[JOUW ADRES IN TILBURG]", company.address)
    .replaceAll("[JOUW PLAATS]", company.city)
    .replaceAll("[INVULLEN ZODRA INGESCHREVEN]", company.kvk)
    .replaceAll("[INVULLEN ZODRA TOEGEKEND]", company.btw)
    .replaceAll("[INVULLEN]", company.kvk);
}
