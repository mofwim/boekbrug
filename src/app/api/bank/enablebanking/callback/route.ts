// src/app/api/bank/enablebanking/callback/route.ts
// [ENABLEBANKING] The owner comes back from his bank.
//
// GET /api/bank/enablebanking/callback?code=<auth code>&state=<our nonce>[&error=...]
//   → 303 to /dashboard/bank with a Dutch result in the query string.
//
// ── Why this route trusts almost nothing ───────────────────────────────────────────────────────
//
// This URL is a REDIRECT TARGET. It arrives in the owner's browser, which means anyone can
// construct a request to it with any query string they like. So:
//
//   · `state` is a 256-bit nonce we generated and stored ourselves. It is a LOOKUP KEY, never a
//     claim. There is no user id in this URL, and adding one would be the whole vulnerability:
//     "finish this connection into account X" must not be something a visitor can ask for.
//   · Whether the consent actually succeeded is decided by EXCHANGING the code with Enable
//     Banking, never by believing a `success=true` in the query string. A forged callback with a
//     valid-looking state but no usable code gets nothing.
//   · No session is required. The owner may well finish the bank flow on his phone while the
//     session lives on his laptop, and the row itself carries the owner — it was written by us
//     before he ever left. Requiring a session here would break a normal, honest journey; it would
//     not add safety, because the nonce is what authorises the lookup.
//
// The response is a redirect rather than JSON because a human lands here, not a script.

import { NextRequest, NextResponse } from "next/server";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  createEnableBankingClient,
  dutchEnableBankingError,
  EnableBankingError,
  isEnableBankingConfigured,
} from "@/lib/enablebanking-client";
import {
  attachSession,
  findBankConnectionByReference,
  saveConnectionAccounts,
  setConnectionStatus,
} from "@/lib/enablebanking-connection";

export const dynamic = "force-dynamic";

/** Everything the owner is told lands in the query string of /dashboard/bank. */
function back(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL("/dashboard/bank", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 303: the browser must follow with a GET, whatever it used to get here.
  return NextResponse.redirect(url, 303);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;
  const reference = params.get("state");

  if (!reference) {
    return back(origin, { bank: "fout", reden: "De koppeling kon niet worden herkend." });
  }

  const connection = await findBankConnectionByReference(reference);
  if (!connection) {
    // An unknown nonce is either a stale link or someone poking at the endpoint. Same neutral
    // answer for both — nothing here confirms whether a reference exists.
    return back(origin, {
      bank: "fout",
      reden: "Deze koppellink is verlopen. Probeer opnieuw te koppelen.",
    });
  }

  // The bank appends its own error when the owner cancelled or it refused. There is no code to
  // exchange in that case, so this is the most honest thing we can tell him.
  const upstreamError = params.get("error");
  const code = params.get("code");

  if (!code) {
    const reden = upstreamError
      ? "Je bank heeft de koppeling niet afgerond. Probeer het opnieuw."
      : "De bank gaf geen bevestiging terug. Probeer het opnieuw.";
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: upstreamError ? `bank: ${upstreamError}`.slice(0, 200) : "geen autorisatiecode",
    });
    return back(origin, { bank: "fout", reden });
  }

  if (!isEnableBankingConfigured()) {
    return back(origin, { bank: "fout", reden: dutchEnableBankingError("NOT_CONFIGURED") });
  }

  let session;
  try {
    const client = createEnableBankingClient();
    session = await client.createSession(code);
  } catch (err) {
    const errCode = err instanceof EnableBankingError ? err.code : null;
    console.warn("[ENABLEBANKING] exchanging the authorisation code failed", {
      connectionId: connection.id,
      code: errCode ?? "UNKNOWN",
    });
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: errCode ?? "sessie aanmaken mislukt",
    });
    return back(origin, {
      bank: "fout",
      reden: errCode ? dutchEnableBankingError(errCode) : "Koppelen bij je bank is mislukt.",
    });
  }

  const accounts = (session.accounts ?? []).filter((a) => typeof a?.uid === "string" && a.uid);
  if (accounts.length === 0) {
    // A session with no accounts is a consent that unlocked nothing — usually the owner ticked no
    // account at his bank. Say that, rather than leaving a "linked" card that never syncs.
    await attachSession({
      connectionId: connection.id,
      sessionId: session.session_id,
      accessValidUntil: session.access?.valid_until ?? null,
    });
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: "geen rekeningen geselecteerd",
    });
    return back(origin, {
      bank: "fout",
      reden: "Er is geen rekening geselecteerd bij je bank. Probeer opnieuw te koppelen.",
    });
  }

  await attachSession({
    connectionId: connection.id,
    sessionId: session.session_id,
    accessValidUntil: session.access?.valid_until ?? null,
  });

  const stored = await saveConnectionAccounts({
    userId: connection.userId,
    connectionId: connection.id,
    accounts: accounts.map((a) => ({
      accountId: a.uid,
      iban: a.account_id?.iban ?? null,
      ownerName: a.name ?? null,
      currency: a.currency ?? null,
      // The session's own view of the account. Not invented: an account the bank has not finished
      // preparing reports its state here, and the sync reads it rather than assuming READY.
      status: session.status ?? null,
    })),
  });

  if (stored === 0) {
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: "rekeningen opslaan mislukt",
    });
    return back(origin, { bank: "fout", reden: "De rekeningen konden niet worden opgeslagen." });
  }

  await setConnectionStatus({
    connectionId: connection.id,
    status: "linked",
    lastError: null,
    connectedAt: new Date().toISOString(),
  });

  await logAuditAction({
    userId: connection.userId,
    action: "bank.connected",
    entityType: "bank_connection",
    entityId: connection.id,
    newValue: { aspspName: connection.aspspName, accounts: stored },
    ipAddress: getClientIP(req),
  });

  return back(origin, { bank: "gekoppeld", rekeningen: String(stored) });
}
