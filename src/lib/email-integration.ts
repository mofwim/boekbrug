// src/lib/email-integration.ts
// [BOEK-011] Complete incoming invoice pipeline — Gmail + Outlook OAuth + AI verification
// [BOEK-011] v2 — Claude reads actual PDF content — May 2026
// ─────────────────────────────────────────────────────────────────────────────

import { verifyInvoiceFromPdf } from "@/lib/ai";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EmailProvider = "gmail" | "outlook";

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  data: string; // base64
  size: number;
}

export interface RawEmail {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  attachments: EmailAttachment[];
}

export interface VerifiedInvoice {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  filename: string;
  fileData: string; // base64
  mimeType: string;
  vendor: string;
  amount: number;
  invoiceNumber: string;
  invoiceDate: string;
  confidence: number;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
}

// ── OAuth URL builders ────────────────────────────────────────────────────────

/**
 * [BOEK-011] Build Gmail OAuth URL
 * Scopes: read-only Gmail + user email
 */
export function buildGmailOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/gmail`,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * [BOEK-011] Build Outlook OAuth URL
 * Scopes: read-only Mail + user email
 */
export function buildOutlookOAuthUrl(state: string): string {
  const tenantId = "common";
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/outlook`,
    response_type: "code",
    scope: ["Mail.Read", "User.Read", "offline_access"].join(" "),
    state,
  });

  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

export async function exchangeGmailCode(code: string): Promise<OAuthTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/gmail`,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail token exchange failed: ${err}`);
  }

  return res.json();
}

export async function exchangeOutlookCode(code: string): Promise<OAuthTokens> {
  const tenantId = "common";
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/email/callback/outlook`,
        grant_type: "authorization_code",
        scope: "Mail.Read User.Read offline_access",
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Outlook token exchange failed: ${err}`);
  }

  return res.json();
}

// ── Get user email address ────────────────────────────────────────────────────

export async function getGmailUserEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  return data.email as string;
}

export async function getOutlookUserEmail(
  accessToken: string
): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  return data.mail || data.userPrincipalName;
}

// ── Refresh tokens ────────────────────────────────────────────────────────────

export async function refreshGmailToken(
  refreshToken: string
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Gmail refresh failed");
  return data.access_token;
}

export async function refreshOutlookToken(
  refreshToken: string
): Promise<string> {
  const tenantId = "common";
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        grant_type: "refresh_token",
        scope: "Mail.Read User.Read offline_access",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error("Outlook refresh failed");
  return data.access_token;
}

// ── Email fetchers ────────────────────────────────────────────────────────────

/**
 * [BOEK-011] Fetch emails from Gmail AFTER a specific date
 * syncFrom = profile.created_at — never fetch before registration
 */
export async function fetchGmailAttachments(
  accessToken: string,
  syncFrom: Date
): Promise<RawEmail[]> {
  // Convert to Unix timestamp for Gmail query
  const afterTimestamp = Math.floor(syncFrom.getTime() / 1000);

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
      new URLSearchParams({
        q: `has:attachment after:${afterTimestamp}`,
        maxResults: "50",
      }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const listData = await listRes.json();
  if (!listData.messages?.length) return [];

  const emails: RawEmail[] = [];

  // Process max 20 at a time — avoids timeout on Vercel
  for (const msg of listData.messages.slice(0, 20)) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const msgData = await msgRes.json();

      const headers = msgData.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find(
          (h: { name: string; value: string }) =>
            h.name.toLowerCase() === name.toLowerCase()
        )?.value || "";

      const attachments = await extractGmailAttachments(
        accessToken,
        msg.id,
        msgData.payload
      );

      if (attachments.length > 0) {
        emails.push({
          messageId: msg.id,
          subject: getHeader("subject"),
          from: getHeader("from"),
          date: getHeader("date"),
          attachments,
        });
      }
    } catch {
      // Skip individual message errors — never crash the full sync
    }
  }

  return emails;
}

async function extractGmailAttachments(
  accessToken: string,
  messageId: string,
  payload: {
    mimeType?: string;
    filename?: string;
    body?: { attachmentId?: string; size?: number; data?: string };
    parts?: unknown[];
  }
): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];

  const processPart = async (part: {
    mimeType?: string;
    filename?: string;
    body?: { attachmentId?: string; size?: number; data?: string };
    parts?: unknown[];
  }) => {
    const mime = part.mimeType || "";
    const filename = part.filename || "";

    // Only fetch PDF and image attachments
    const isRelevant =
      mime === "application/pdf" ||
      mime.startsWith("image/") ||
      filename.toLowerCase().endsWith(".pdf");

    if (isRelevant && part.body?.attachmentId) {
      const attRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const attData = await attRes.json();

      // Gmail returns base64url — convert to standard base64
      const base64 = (attData.data as string)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      attachments.push({
        filename: filename || "bijlage",
        mimeType: mime,
        data: base64,
        size: part.body.size || 0,
      });
    }

    if (part.parts) {
      for (const subpart of part.parts as typeof part[]) {
        await processPart(subpart);
      }
    }
  };

  await processPart(payload);
  return attachments;
}

/**
 * [BOEK-011] Fetch emails from Outlook AFTER a specific date
 * syncFrom = profile.created_at — never fetch before registration
 */
export async function fetchOutlookAttachments(
  accessToken: string,
  syncFrom: Date
): Promise<RawEmail[]> {
  const since = syncFrom.toISOString();

  const listRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?` +
      new URLSearchParams({
        $filter: `hasAttachments eq true and receivedDateTime ge ${since}`,
        $top: "20",
        $select: "id,subject,from,receivedDateTime",
      }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const listData = await listRes.json();
  if (!listData.value?.length) return [];

  const emails: RawEmail[] = [];

  for (const msg of listData.value) {
    try {
      const attRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const attData = await attRes.json();

      const attachments: EmailAttachment[] = (attData.value || [])
        .filter((att: { contentType?: string; name?: string }) => {
          const ct = att.contentType || "";
          const name = att.name || "";
          return (
            ct === "application/pdf" ||
            ct.startsWith("image/") ||
            name.toLowerCase().endsWith(".pdf")
          );
        })
        .map(
          (att: {
            name?: string;
            contentType?: string;
            contentBytes?: string;
            size?: number;
          }) => ({
            filename: att.name || "bijlage",
            mimeType: att.contentType || "application/octet-stream",
            data: att.contentBytes || "",
            size: att.size || 0,
          })
        );

      if (attachments.length > 0) {
        emails.push({
          messageId: msg.id,
          subject: msg.subject || "",
          from: msg.from?.emailAddress?.address || "",
          date: msg.receivedDateTime || "",
          attachments,
        });
      }
    } catch {
      // Skip individual errors
    }
  }

  return emails;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * [BOEK-011] Check if this messageId was already processed
 * Primary: exact messageId match
 * Secondary: amount + vendor + date within ±1 day
 */
export async function isDuplicate(
  userId: string,
  messageId: string,
  amount?: number,
  vendor?: string,
  date?: string
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();

  // Primary check — exact messageId stored in client_btw_number
  const { data: byMsgId } = await supabase
    .from("invoices")
    .select("id")
    .eq("sender_id", userId)
    .eq("source", "email")
    .ilike("client_btw_number", `msg:${messageId}`)
    .limit(1);

  if (byMsgId && byMsgId.length > 0) return true;

  // Secondary check — amount + vendor + date window
  if (amount && vendor && date) {
    const dateObj = new Date(date);
    const dayBefore = new Date(dateObj.getTime() - 86400 * 1000)
      .toISOString()
      .split("T")[0];
    const dayAfter = new Date(dateObj.getTime() + 86400 * 1000)
      .toISOString()
      .split("T")[0];

    const { data: byMatch } = await supabase
      .from("invoices")
      .select("id")
      .eq("sender_id", userId)
      .eq("source", "email")
      .eq("total_inc_btw", amount)
      .ilike("client_name", `%${vendor.slice(0, 20)}%`)
      .gte("invoice_date", dayBefore)
      .lte("invoice_date", dayAfter)
      .limit(1);

    if (byMatch && byMatch.length > 0) return true;
  }

  return false;
}

// ── Core pipeline: verify attachments by reading actual content ───────────────

/**
 * [BOEK-011] v2 — Real verification pipeline
 *
 * For each attachment:
 * 1. Claude reads the actual PDF or image
 * 2. Claude answers: is this a real invoice? yes/no
 * 3. No  → skip, never saved
 * 4. Yes → check duplicate → add to results
 *
 * syncFrom = profile.created_at — only process files from registration date
 */
export async function verifyEmailAttachments(
  userId: string,
  emails: RawEmail[]
): Promise<VerifiedInvoice[]> {
  const results: VerifiedInvoice[] = [];

  for (const email of emails) {
    for (const attachment of email.attachments) {
      try {
        // Skip files that are too large (> 5MB) — Claude has limits
        if (attachment.size > 5 * 1024 * 1024) {
          console.log(
            `[BOEK-011] Skipping large file: ${attachment.filename} (${Math.round(attachment.size / 1024)}KB)`
          );
          continue;
        }

        // Skip unsupported types early — save API calls
        const supportedTypes = [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
        ];
        if (!supportedTypes.includes(attachment.mimeType)) {
          continue;
        }

        // [BOEK-011] Claude reads the actual file — not just metadata
        const verification = await verifyInvoiceFromPdf(
          attachment.data,
          attachment.mimeType,
          attachment.filename
        );

        // Not an invoice → discard, no trace in DB
        if (!verification.is_invoice) {
          console.log(
            `[BOEK-011] Rejected: ${attachment.filename} — ${verification.reason}`
          );
          continue;
        }

        // Duplicate check
        const dup = await isDuplicate(
          userId,
          email.messageId,
          verification.amount,
          verification.vendor,
          verification.invoice_date
        );

        if (dup) {
          console.log(`[BOEK-011] Duplicate skipped: ${attachment.filename}`);
          continue;
        }

        // Confirmed invoice — add to results
        results.push({
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          date: email.date,
          filename: attachment.filename,
          fileData: attachment.data,
          mimeType: attachment.mimeType,
          vendor: verification.vendor || extractSenderName(email.from),
          amount: verification.amount || 0,
          invoiceNumber: verification.invoice_number || `EMAIL-${Date.now()}`,
          invoiceDate:
            verification.invoice_date ||
            new Date(email.date).toISOString().split("T")[0],
          confidence: verification.confidence,
        });
      } catch (error) {
        // Never crash the pipeline — log and continue
        console.error(
          `[BOEK-011] Error processing ${attachment.filename}:`,
          error
        );
      }
    }
  }

  return results;
}

// ── Save verified invoices to Supabase ────────────────────────────────────────

/**
 * [BOEK-011] Save verified incoming invoices
 * Status = 'received' — waits for user to confirm payment
 * Direction = 'incoming'
 */
export async function saveVerifiedInvoices(
  userId: string,
  invoices: VerifiedInvoice[]
): Promise<{ saved: number; errors: number }> {
  const supabase = await createServerSupabaseClient();
  let saved = 0;
  let errors = 0;

  for (const inv of invoices) {
    try {
      const { error } = await supabase.from("invoices").insert({
        sender_id: userId,
        direction: "incoming",
        status: "received",
        source: "email",
        client_name: inv.vendor,
        client_email: extractEmail(inv.from),
        invoice_date: inv.invoiceDate,
        total_inc_btw: inv.amount,
        total_ex_btw: 0, // unknown until user confirms
        btw_amount: 0,
        invoice_number: inv.invoiceNumber,
        // [BOEK-011] messageId stored for deduplication
        // TODO: replace with dedicated source_message_id column
        client_btw_number: `msg:${inv.messageId}`,
      });

      if (error) {
        console.error("[BOEK-011] Save error:", error.message);
        errors++;
      } else {
        saved++;
      }
    } catch {
      errors++;
    }
  }

  return { saved, errors };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from.trim();
}

function extractSenderName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return extractEmail(from);
}

// ── Main sync entry point ─────────────────────────────────────────────────────

/**
 * [BOEK-011] Full sync for one user
 *
 * Key rule: only fetch emails AFTER profile.created_at
 * Before registration = user's responsibility to upload manually
 *
 * Flow:
 * 1. Get email connection + refresh token
 * 2. Get profile.created_at as sync boundary
 * 3. Fetch emails after that date
 * 4. Claude verifies each attachment (real invoice or not)
 * 5. Save verified invoices to DB
 */
export async function syncUserEmails(userId: string): Promise<{
  provider: EmailProvider;
  fetched: number;
  verified: number;
  saved: number;
  errors: number;
} | null> {
  const supabase = await createServerSupabaseClient();

  // Get email connection
  const { data: connection } = await supabase
    .from("email_connections")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (!connection) return null;

  // [BOEK-011] Get registration date — this is our sync boundary
  // We never fetch emails before the user registered
  const { data: profile } = await supabase
    .from("profiles")
    .select("created_at")
    .eq("id", userId)
    .single();

  const syncFrom = profile?.created_at
    ? new Date(profile.created_at)
    : new Date(); // fallback: now (safe — fetches nothing from the past)

  // Refresh access token
  let accessToken = connection.access_token;
  try {
    if (connection.provider === "gmail") {
      accessToken = await refreshGmailToken(connection.refresh_token);
    } else {
      accessToken = await refreshOutlookToken(connection.refresh_token);
    }

    await supabase
      .from("email_connections")
      .update({ access_token: accessToken })
      .eq("id", connection.id);
  } catch {
    // Use existing token if refresh fails
  }

  // Fetch emails after registration date
  let rawEmails: RawEmail[] = [];
  try {
    if (connection.provider === "gmail") {
      rawEmails = await fetchGmailAttachments(accessToken, syncFrom);
    } else {
      rawEmails = await fetchOutlookAttachments(accessToken, syncFrom);
    }
  } catch (error) {
    console.error("[BOEK-011] Fetch failed:", error);
    return {
      provider: connection.provider,
      fetched: 0,
      verified: 0,
      saved: 0,
      errors: 1,
    };
  }

  const totalAttachments = rawEmails.reduce(
    (sum, e) => sum + e.attachments.length,
    0
  );

  // Claude verifies each attachment — real invoice or not
  const verified = await verifyEmailAttachments(userId, rawEmails);

  // Save confirmed invoices to DB
  const { saved, errors } = await saveVerifiedInvoices(userId, verified);

  return {
    provider: connection.provider,
    fetched: totalAttachments,
    verified: verified.length,
    saved,
    errors,
  };
}