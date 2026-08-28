// src/lib/intake-supplier.ts
// [LEVERANCIER-INTAKE] The two steps every incoming invoice takes before it is stored — in the
// one order that is safe — and the flags the first step leaves behind for the health badge.
//
// ── WHY THIS EXISTS ──
//
// Measured in production on 28-08-2026: fifteen incoming invoices carried a vendor IBAN and no
// supplier_id, and for five of them a supplier row with that exact IBAN already existed. The
// information was there and the link was never made.
//
// The cause was not the registry — resolveSupplierForImport keys on the IBAN first and would have
// found all five. It was that three of the five paths that create an incoming invoice never called
// it. The two e-mail paths did; the reader path, the e-invoice path and the read-as-invoice path
// wrote vendor_iban onto the row and stopped there. So an invoice's supplier depended on which
// door it came through, which is not a rule anyone could have stated out loud.
//
// What that costs is not an amount — no total moves — but everything built on top of the supplier:
// the vendor overview, the cadence that notices a monthly bill did not arrive, the bank match that
// keys on supplier, and the IBAN-change check itself, which can only warn about a vendor it has a
// record of.
//
// ── THE ORDER IS THE WHOLE POINT ──
//
// The IBAN check runs BEFORE resolution, never after. Resolution may create a supplier row keyed
// on the IBAN printed on this very invoice, or attach that IBAN to a supplier that had none. Ask
// the question afterwards and the registry answers with the row it just wrote: the forged number
// becomes "the number we know for this vendor", and the one signal standing between the owner and
// a redirected payment is gone. The e-mail path had this right and said so; putting it here means
// a fourth path cannot get it wrong by leaving a line out.
//
// Neither step ever throws to the import. A supplier is enrichment, and an unreachable registry
// must not cost the owner an invoice — but the IBAN check says out loud when it could not run,
// because on that check silence and success look identical to the person paying the bill.

import { detectIbanChange, type IbanCheck } from "@/lib/iban-change";
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/** The vendor as the reader (or the XML) gave it. Every field may be absent. */
export interface IntakeVendor {
  name?: string | null;
  iban?: string | null;
  kvk?: string | null;
  btw?: string | null;
}

export interface IntakeSupplier {
  /** The supplier to store on the invoice, or null when none could (or should) be resolved. */
  supplierId: string | null;
  /** The canonical name to store; null means "keep the name you read off the paper". */
  supplierName: string | null;
  /**
   * Flags to merge into `field_confidence._safecore`, read by classifyImportHealth. Empty when the
   * check ran and found nothing worth saying — which is the common case and not a warning.
   */
  safecore: Record<string, unknown>;
}

/**
 * The flags an IBAN check leaves on the invoice. Pure, so the sentence the owner ends up reading
 * can be tested without a database.
 *
 * `unavailable` is a flag of its own and not a quiet nothing: on this particular check a skipped
 * run and a clean run are indistinguishable to the person about to pay, and fraud is precisely the
 * case where every other number on the invoice adds up.
 */
export function ibanChangeSafecore(check: IbanCheck): Record<string, unknown> {
  if (check.status === "unavailable") return { iban_check_unavailable: true };
  if (!check.change) return {};
  return {
    iban_changed: true,
    iban_changed_from: check.change.from,
    iban_changed_to: check.change.to,
  };
}

/**
 * Check the IBAN, then resolve the supplier. In that order — see the note at the top of this file.
 *
 * Never throws.
 */
export async function resolveSupplierAtIntake(
  supabase: Client,
  userId: string,
  vendor: IntakeVendor,
): Promise<IntakeSupplier> {
  const check = await detectIbanChange(supabase, userId, {
    name: vendor.name ?? null,
    kvk: vendor.kvk ?? null,
    iban: vendor.iban ?? null,
  });
  const safecore = ibanChangeSafecore(check);

  const supplier = await resolveSupplierForImport(supabase, userId, {
    name: vendor.name ?? null,
    iban: vendor.iban ?? null,
    kvk: vendor.kvk ?? null,
    btw: vendor.btw ?? null,
  });

  return {
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? null,
    safecore,
  };
}

/**
 * Merge the flags onto an existing `_safecore`, keeping whatever is already there.
 *
 * Assigning a fresh object over `_safecore` is how a duplicate flag or an arithmetic flag set
 * earlier in the same request disappears — and those flags are the reason an invoice waits for a
 * human instead of booking itself.
 */
export function mergeSafecore(
  fieldConfidence: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(extra).length === 0) return (fieldConfidence._safecore as Record<string, unknown> | undefined) ?? {};
  return {
    ...((fieldConfidence._safecore as Record<string, unknown> | undefined) ?? {}),
    ...extra,
  };
}
