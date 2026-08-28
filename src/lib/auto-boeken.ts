// src/lib/auto-boeken.ts
// [ZELF-EERST] May the app book a read WITHOUT the owner's tap, for this owner?
//
// ── WHY THIS EXISTS ──
// The auto-advance bar is high and honest — grounding, placement, arithmetic, the 17-reason veto
// list — but it answers the wrong question for a NEW owner. Their question is not "how careful is
// the machine?"; it is "how do I find out?". And the only way anyone learns to trust a reader is
// to check its work for a while. An owner who cannot say "show me everything first" is an owner
// who either trusts blindly or leaves.
//
// So this is a courtesy switch in the owner's hands: OFF means every read — invoice and bon alike
// — waits in the verify queue for their tap, exactly as if the confidence had never been high
// enough. Nothing else about the reading changes: same extraction, same checks, same corrections.
// The app must EARN the autopilot; this is where the owner grants it.
//
// ── THE FAIL MATRIX (this is the part that must not be guessed) ──
//   · Column missing (pre-migration 42703/42P01) → TRUE. The code ships before the migration is
//     hand-applied ([DEPLOY-SAFE]); until the column exists nobody has turned anything off, and
//     answering false here would silently stop all auto-booking at deploy time.
//   · Any OTHER read failure → FALSE. Post-migration an error might be hiding a stated "off", and
//     the two mistakes are not symmetric: wrongly waiting costs the owner one tap on a clean
//     invoice; wrongly auto-booking overrides a choice they made about their own money.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn } from "./pg-missing";

export async function autoBoekenAllowed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("auto_boeken")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      return isMissingColumn(error.message, (error as { code?: string }).code);
    }
    return (data as { auto_boeken?: boolean | null } | null)?.auto_boeken !== false;
  } catch {
    return false;
  }
}
