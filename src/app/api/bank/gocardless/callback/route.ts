// src/app/api/bank/gocardless/callback/route.ts
// [GOCARDLESS] The owner comes back from his bank.
//
// GET /api/bank/gocardless/callback?ref=<our nonce>[&error=...]
//   → 303 to /dashboard/bank with a Dutch result in the query string.
//
// ── Why this route trusts almost nothing ─────────────────────────────────────────────────────
//
// This URL is a REDIRECT TARGET. It arrives in the owner's browser, which means anyone can
// construct a request to it with any query string they like. So:
//
//   · The only thing read from the URL is `ref` — a 256-bit nonce we generated and stored
//     ourselves. It is a lookup key, never a claim. There is no user id in this URL, and adding
//     one would be the whole vulnerability: "finish this connection into account X" must not be
//     something a visitor can ask for.
//   · Whether the consent actually succeeded is decided by ASKING GOCARDLESS (GET the
//     requisition), never by believing a `success=true` in the query string.
//   · No session is required. The owner may well finish the bank flow on his phone while the
//     session lives on his laptop, and the row itself carries the owner — it was written by us
//     before he ever left. Requiring a session here would break a normal, honest journey; it
//     would not add safety, because the nonce is what authorises the lookup.
//
// The response is a redirect rather than JSON because a human lands here, not a script.

import { NextRequest, NextResponse } from "next/server";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  createGoCardlessClient,
  dutchGoCardlessError,
  GoCardlessError,
  isGoCardlessConfigured,
  REQUISITION_STATUS,
  requisitionNeedsReconnect,
} from "@/lib/gocardless-client";
import {
  findBankConnectionByReference,
  saveConnectionAccounts,
  setConnectionStatus,
} from "@/lib/gocardless-connection";

export const dynamic = "force-dynamic";

const STATUS_LINKED = REQUISITION_STATUS.LINKED;
const STATUS_REJECTED = REQUISITION_STATUS.REJECTED;

/** Everything the owner is told lands in the query string of /dashboard/bank. */
function back(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL("/dashboard/bank", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // 303: the browser must follow with a GET, whatever it used to get here.
  return NextResponse.redirect(url, 303);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const reference = req.nextUrl.searchParams.get("ref");

  if (!reference) {
    return back(origin, { bank: "fout", reden: "De koppeling kon niet worden herkend." });
  }

  const connection = await findBankConnectionByReference(reference);
  if (!connection) {
    // An unknown nonce is either a stale link or someone poking at the endpoint. Same neutral
    // answer for both — nothing here confirms whether a reference exists.
    return back(origin, { bank: "fout", reden: "Deze koppellink is verlopen. Probeer opnieuw te koppelen." });
  }

  // GoCardless appends its own error to the redirect when the owner cancelled or the bank
  // refused. It is a HINT, not the verdict: the requisition below is what we act on. But when
  // there is nothing to act on, it is the most honest thing we can tell him.
  const upstreamError = req.nextUrl.searchParams.get("error");

  if (!isGoCardlessConfigured()) {
    return back(origin, { bank: "fout", reden: dutchGoCardlessError("NOT_CONFIGURED") });
  }

  let requisition;
  try {
    const client = createGoCardlessClient();
    requisition = await client.getRequisition(connection.requisitionId);
  } catch (err) {
    const dutch = err instanceof GoCardlessError ? dutchGoCardlessError(err.code) : "Koppelen mislukt.";
    await setConnectionStatus({ connectionId: connection.id, status: "error", lastError: dutch });
    return back(origin, { bank: "fout", reden: dutch });
  }

  // EX (expired), SU (suspended) and ER (error) are all dead ends for THIS consent: retrying the
  // same link can never fix them, only a fresh consent can. They are marked 'expired' so the
  // panel offers "Opnieuw koppelen" rather than a "Ververs" button that would fail forever.
  if (requisitionNeedsReconnect(requisition.status)) {
    const reden =
      requisition.status === REQUISITION_STATUS.SUSPENDED
        ? dutchGoCardlessError("ACCOUNT_SUSPENDED")
        : requisition.status === REQUISITION_STATUS.ERROR
          ? "Het koppelen is bij je bank misgegaan. Probeer opnieuw te koppelen."
          : dutchGoCardlessError("CONSENT_EXPIRED");
    await setConnectionStatus({ connectionId: connection.id, status: "expired", lastError: reden });
    return back(origin, { bank: "fout", reden });
  }

  if (requisition.status !== STATUS_LINKED || requisition.accounts.length === 0) {
    // Cancelled at the bank, credentials refused, or simply not finished. None of these is our
    // failure, and none of them should leave a half-connection sitting on the screen as if it
    // were about to start working.
    const reden =
      requisition.status === STATUS_REJECTED
        ? "Je bank heeft de koppeling afgewezen. Controleer je inloggegevens en probeer het opnieuw."
        : upstreamError
          ? "De koppeling is bij je bank afgebroken. Probeer het opnieuw."
          : "Je bent niet klaar met koppelen bij je bank. Probeer het opnieuw.";
    await setConnectionStatus({ connectionId: connection.id, status: "error", lastError: reden });
    return back(origin, { bank: "fout", reden });
  }

  // Linked. Fetch each account's details so the card can show an IBAN the owner recognises
  // instead of an opaque uuid. Details are best-effort: a failure there must not undo a consent
  // the owner just gave — the account id alone is enough to sync.
  const client = createGoCardlessClient();
  const accounts: Array<{
    accountId: string;
    iban: string | null;
    ownerName: string | null;
    currency: string | null;
    status: string | null;
  }> = [];

  for (const accountId of requisition.accounts) {
    // The account's PROCESSING STATE, asked for rather than assumed. This used to be written as
    // a flat "READY" the moment the details call succeeded — a claim about the bank that nobody
    // had checked, and a false one whenever the bank was still preparing the account (common in
    // the first minutes after consent) or had already put it in ERROR. /accounts/{id}/ is
    // GoCardless's own metadata: it is not subject to the institution's daily budget, so asking
    // costs nothing that matters. Unreadable stays null — never a fabricated status.
    let status: string | null = null;
    try {
      status = (await client.getAccount(accountId)).status;
    } catch (err) {
      console.warn("[GOCARDLESS] account status unavailable", {
        accountId,
        code: err instanceof GoCardlessError ? err.code : "UNKNOWN",
      });
    }

    try {
      const details = await client.getAccountDetails(accountId);
      accounts.push({
        accountId,
        iban: details.iban,
        ownerName: details.ownerName ?? details.name,
        currency: details.currency,
        status,
      });
    } catch (err) {
      // Details are best-effort: a failure here must not undo a consent the owner just gave, and
      // the account id alone is enough to sync. He simply sees no IBAN on the card yet.
      console.warn("[GOCARDLESS] account details unavailable — storing the account anyway", {
        accountId,
        code: err instanceof GoCardlessError ? err.code : "UNKNOWN",
      });
      accounts.push({ accountId, iban: null, ownerName: null, currency: null, status });
    }
  }

  const stored = await saveConnectionAccounts({
    userId: connection.userId,
    connectionId: connection.id,
    accounts,
  });

  if (stored === 0) {
    await setConnectionStatus({
      connectionId: connection.id,
      status: "error",
      lastError: "De rekeningen konden niet worden opgeslagen.",
    });
    return back(origin, { bank: "fout", reden: "De rekeningen konden niet worden opgeslagen. Probeer het opnieuw." });
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
    newValue: { institutionName: connection.institutionName, accounts: stored },
    ipAddress: getClientIP(req),
  });

  // The first pull is NOT started here. This request is a redirect the owner is waiting on, and
  // a first sync can mean a year of history across several accounts — long enough to time out
  // the redirect and leave him staring at a browser error after a successful consent. The bank
  // screen hands control back to /dashboard/bank, which starts the sync from there.
  return back(origin, { bank: "gekoppeld", rekeningen: String(stored) });
}
