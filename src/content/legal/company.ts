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
 */
export function fillCompanyIdentity(md: string): string {
  return md
    .replaceAll("[JOUW NAAM/BV]", company.legalName)
    .replaceAll("[JOUW NAAM HIER]", company.legalName)
    .replaceAll("[JOUW NAAM]", company.legalName)
    .replaceAll("[JOUW ADRES IN TILBURG]", company.address)
    .replaceAll("[INVULLEN ZODRA INGESCHREVEN]", company.kvk)
    .replaceAll("[INVULLEN ZODRA TOEGEKEND]", company.btw)
    .replaceAll("[INVULLEN]", company.kvk);
}
