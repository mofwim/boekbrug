// src/app/api/bank/attach-invoice/route.ts
// [BANK-ATTACH] Attach a document to an UNMATCHED bank transaction (the "Geen
// factuur" tab). The owner uploads the file that belongs to a real payment we
// already see on the statement (a supplier invoice that was never imported, an
// electricity/internet bill, a rent/lease receipt). We:
//   1. read the file with the SAME AI extractor as manual upload (vendor, amount,
//      full BTW breakdown, date, vendor IBAN) — so the owner re-types nothing,
//   2. create the incoming invoice from that extraction (+ the bank amount/date
//      as the source of truth for the money side),
//   3. link the transaction to the new invoice and mark it paid.
//
// This merges two existing flows (api/email/upload + api/bank/confirm) into one
// atomic-ish action. Money discipline is unchanged:
//   - invoice → 'paid' uses the SESSION client so the B.4 verwerkt trigger fires.
//   - bank_transactions → 'matched' uses the pipeline (service_role), user-pinned.
//   - the file/invoice/transaction end up linked three ways and SHARED with the
//     accountant (status 'paid' is included in the `shared` GENERATED column).
//
// Honest by design: the owner is attaching the file for a payment THEY made and
// can SEE on their statement → the invoice is created already-confirmed ('paid'),
// not held in 'processing'. AI prepares the fields; the owner confirms by acting.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { verifyInvoiceFromPdf } from "@/lib/ai";
import { resolveImportTarget } from "@/lib/bestanden";
import { computeContentHash } from "@/lib/content-hash";
import { buildFolderBreadcrumb } from "@/lib/documents";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { gateFairUseForRead } from "@/lib/fair-use-gate";
// [E-FACTUUR-XML] Een Peppol-factuur aan een bankregel hangen — zelfde lezer als elke andere deur.
import { looksLikeInvoiceXmlBytes, E_INVOICE_XML_MIME } from "@/lib/e-invoice";
import { normalizeToIso, findSemanticDuplicate, normalizeInvoiceNumber } from "@/lib/safecore";
import { collectPossibleDuplicate } from "@/lib/possible-duplicate-collect";
import { recordPaymentLinks } from "@/lib/bank-tx-links";
import { readingPromptHint } from "@/lib/reading-memory";
// [DECLARED-INVOICE] Invoice numbers the payment names, whether or not we hold them.
import { undeclaredMissingInvoices } from "@/lib/bank-batch-reconcile";
import { loadReadingMemory } from "@/lib/reading-memory-source";
import { escapeLikeValue } from "@/lib/sanitize";
// [DUP-TRASHED] Gedeelde uitzondering op de byte-hash-poort: een weggegooid bestand mag de
// dedup-sleutel niet levenslang bezet houden. Zelfde module als /api/intake gebruikt.
import { trashedDuplicateCleared } from "@/lib/trashed-dedup";

// Amount agreement tolerance between the AI-read invoice total and the bank
// transaction. Within this → link silently. Outside → still allow, but flag a
// warning so the UI can ask the owner to double-check (AI misread is possible).
const AMOUNT_TOLERANCE = 0.02;

export async function POST(req: NextRequest) {
  // 1. Auth — session client (RLS). The owner acts on their own data.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [COST] Per-user ceiling — this route runs an AI/OCR vision call (verifyInvoiceFromPdf).
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/bank/attach-invoice", ...RATE_LIMITS.AI_OCR });
  if (!rl.allowed) return rateLimitResponse(rl);

  // [FAIR-USE-TE-VROEG] Het maandhek stond hiér, en dat was te vroeg. gateFairUse VERBRUIKT
  // meteen (fair-use-gate.ts → consumeFairUse); teruggeven gebeurt alleen via gate.release().
  // Tussen deze plek en de enige betaalde handeling van de route (verifyInvoiceFromPdf, ver
  // hieronder) liggen ACHT weigeringen: geen bestand, geen transactie, verkeerd bestandstype,
  // te groot, transactie niet gevonden / al verwerkt, verkeerde richting, en het byte-hash
  // duplicaat. Elk daarvan kostte de eigenaar een document van zijn maandtegoed voor een
  // handeling die ons NIETS kostte — en het duplicaat-antwoord is juist het antwoord dat je
  // hier het vaakst krijgt, want dit scherm is waar je een bestand aan een bankregel hangt.
  //
  // /eerlijk-gebruik §3 belooft letterlijk "mislukte pogingen komen nooit op jouw rekening".
  // Het hek is daarom verplaatst naar vlak vóór de AI-call, precies zoals /api/intake het doet
  // (intake/route.ts:378 — daar zit geen enkele uitgang tussen hek en call). Alles wat NA de
  // call misgaat telt wél: die leesbeurt is echt gemaakt en heeft echt geld gekost.

  // 2. Read form: the file + the target transaction id.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ongeldig formulier" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const transactionId = (formData.get("transactionId") as string | null)?.trim();
  // [BANK-ATTACH] Direction the owner is linking: 'incoming' (expense → debit) or
  // 'outgoing' (income/refund → credit). The UI sends it based on the tx sign.
  // Default to 'incoming' (the common case) if absent.
  const direction =
    (formData.get("direction") as string | null) === "outgoing" ? "outgoing" : "incoming";
  // [BANK-ATTACH-DEDUP] Owner override — "toch toevoegen" after a semantic-duplicate warning.
  const force = (formData.get("force") as string | null) === "true";
  if (!file) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }
  if (!transactionId) {
    return NextResponse.json({ error: "Geen transactie opgegeven" }, { status: 400 });
  }

  // [E-FACTUUR-XML] A supplier's Peppol/UBL invoice may be attached to a bank line like any other
  // document — and it is the most exact one this app can read. Admitted on the NAME/type here
  // because the bytes are not in hand yet (the size guard below must run first, on untrusted
  // input), and CONFIRMED on the content once they are: a .xml that turns out not to be an invoice
  // is refused with the same sentence as before.
  const baseType = (file.type || "").toLowerCase().split(";")[0].trim();
  const maybeEInvoice =
    baseType === "application/xml" || baseType === "text/xml" ||
    file.name.toLowerCase().endsWith(".xml");
  const okType =
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    maybeEInvoice ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!okType) {
    return NextResponse.json({ error: "Alleen PDF of afbeelding toegestaan" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Bestand te groot — max 10MB" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // 3. The transaction must exist, belong to the user, and still be pending.
  //    (Same ownership/state discipline as api/bank/confirm.)
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, user_id, amount, date, reference, description")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }
  if (tx.status !== "pending") {
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }

  // Direction must match the transaction sign: a debit (money out) is an expense
  // (incoming invoice); a credit (money in) is income/refund (outgoing invoice).
  // Both are now supported — income also has documents worth linking (a supplier
  // refund, a B2B sale). Guard only against a mismatch (wrong direction for sign).
  const txIsCredit = (tx.amount ?? 0) >= 0;
  const expectedDirection = txIsCredit ? "outgoing" : "incoming";
  if (direction !== expectedDirection) {
    return NextResponse.json(
      { error: "direction_mismatch", detail: "Richting komt niet overeen met de transactie." },
      { status: 422 }
    );
  }

  // 4. Read bytes + byte-hash dedup (same gate as manual upload).
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");
  const contentHash = computeContentHash(buffer);

  // [E-FACTUUR-XML] Now the bytes are in hand, the name-based admission above is settled on the
  // CONTENT. A .xml that is not an invoice gets the same refusal it always got — the widened guard
  // let it reach this line, it does not let it through the door.
  const isEInvoice = maybeEInvoice && looksLikeInvoiceXmlBytes(buffer);
  if (maybeEInvoice && !isEInvoice) {
    return NextResponse.json({ error: "Alleen PDF of afbeelding toegestaan" }, { status: 400 });
  }
  // The reader picks its branch by media type, and a .xml arrives with whatever the client felt
  // like sending — often nothing at all. Hand it the type the content actually is.
  const readerMime = isEInvoice ? E_INVOICE_XML_MIME : file.type;

  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, file_name, folder_id, trashed")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  // [DUP-TRASHED] Een weggegooid bestand is hier geen duplicaat maar een doodlopende weg — en op
  // dit scherm extra hinderlijk, want de eigenaar probeert juist bewijs aan een bankregel te hangen.
  if (existingDoc && !(await trashedDuplicateCleared(supabase, user.id, existingDoc))) {
    const folderPath = await buildFolderBreadcrumb(supabase, user.id, existingDoc.folder_id ?? null);
    await logAuditAction({
      userId: user.id,
      action: "document.duplicate_blocked",
      entityType: "document",
      entityId: existingDoc.id,
      newValue: { file_name: file.name, content_hash: contentHash, path: "bank_attach" },
      ipAddress: getClientIP(req),
    });
    const where = folderPath.length
      ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
      : "Dit bestand is al toegevoegd";
    return NextResponse.json({ error: where, duplicate: true }, { status: 409 });
  }

  // 5. Who are WE (receiver) — so the AI never returns us as the vendor.
  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const receiverName = me?.company_name || me?.full_name || null;

  // [FAIR-USE] Het tweede hek: de gepubliceerde maandgrens. Het hek daarboven (checkRateLimit)
  // gaat over snelheid, dit over hoeveel er gratis in een maand past. Faalt open, en een
  // weigering pauzeert alleen dit ene automatische uitlezen — de bankregel blijft gewoon staan
  // in "Geen factuur", dus er gaat niets verloren.
  //
  // Het staat hier en niet bovenaan: dit is de laatste regel vóór de enige handeling die ons
  // per stuk geld kost. Alles wat de route eerder kan weigeren (leeg formulier, verkeerd
  // bestandstype, te groot bestand, een al-verwerkte transactie, een byte-hash duplicaat) is
  // dan al geweigerd zonder iemands maandtegoed aan te raken. Zie [FAIR-USE-TE-VROEG] boven.
  // [E-FACTUUR-GRATIS] An e-invoice is read mechanically — no model, no cost — so it may not spend
  // a document from the month's allowance.
  const gate = await gateFairUseForRead({
    client: supabase, userId: user.id, metric: "aiDocuments", costsAiCall: !isEInvoice,
  });
  if (!gate.allowed) return gate.response!;

  // 6. AI extraction. We do NOT hard-reject a non-invoice here: a rent/lease
  //    receipt or a bank confirmation is a legitimate expense document even if
  //    the AI isn't confident it's a "factuur". We still store it and link it;
  //    BTW simply stays 0 when the AI can't find it (correct for rent).
  // [FAIR-USE] Ingepakt zodat een mislukte leesbeurt de gebruiker geen document van zijn
  // maandtegoed kost — dezelfde belofte als op de andere vijf AI-routes.
  let verification: Awaited<ReturnType<typeof verifyInvoiceFromPdf>>;
  try {
    verification = await verifyInvoiceFromPdf(base64, readerMime, file.name, receiverName, {
      // [READING-MEMORY] Fields only, never amounts — see readingPromptHint. This path books
      // straight to 'paid', so a better first read is worth more here than anywhere else.
      readingHint: readingPromptHint(await loadReadingMemory(supabase, user.id)),
    });
  } catch (aiErr) {
    await gate.release();
    throw aiErr;
  }

  // [DECLARED-INVOICE] Does this payment name MORE invoices than the one being attached?
  //
  // Everything below assumes one bank line = one invoice, and on that assumption it is sound: when
  // the read total disagrees with the bank amount it trusts the bank, because the money that moved
  // is the truth. On a line that pays TWO invoices that reasoning inverts. Attaching an €800
  // invoice to a €2.265,41 line would create an €2.265,41 invoice — a total nobody ever billed —
  // mark it paid, and consume the line, leaving the other named invoice with its money gone.
  //
  // Same guard, same helper and same escape hatch as /api/bank/confirm, so the two doors onto this
  // bank line cannot disagree about what the payment says.
  if (!force) {
    const named = undeclaredMissingInvoices(
      { reference: tx.reference, description: tx.description },
      [verification.invoice_number],
    );
    if (named.length > 0) {
      await gate.release();
      return NextResponse.json(
        {
          error: "declared_invoice_missing",
          code: "declared_invoice_missing",
          missingNumbers: named,
          canForce: true,
          detail:
            `Deze betaling noemt ook ${named.length === 1 ? "factuur" : "facturen"} ${named.join(", ")}. ` +
            `Als we deze factuur nu aan de hele betaling koppelen, gaat het bedrag van ${named.length === 1 ? "die andere" : "die andere facturen"} ` +
            `mee op — voeg ${named.length === 1 ? "hem" : "ze"} eerst toe, en verdeel de betaling daarna.`,
        },
        { status: 409 },
      );
    }
  }

  // Money side: the BANK is the source of truth for the paid amount/date.
  const bankAmount = Math.abs(tx.amount ?? 0);
  // [DATE-ISO-SAFE / I6] Tolerant + never-throw for either source (a DD-MM-YYYY threw a 500).
  const invoiceDate =
    normalizeToIso(tx.date) ??
    normalizeToIso(verification.invoice_date) ??
    new Date().toISOString().split("T")[0];

  // Prefer the AI total when it agrees with the bank; otherwise trust the bank
  // amount (what actually moved) and flag a warning for the owner to verify.
  const aiTotal = verification.total_inc_btw ?? verification.amount ?? null;
  const amountAgrees =
    aiTotal != null && Math.abs(aiTotal - bankAmount) <= AMOUNT_TOLERANCE;
  const totalIncBtw = amountAgrees ? aiTotal! : bankAmount;
  // Keep the AI's BTW split only if the totals agree (otherwise it's unreliable).
  // [SILENT-LOSS FIX] The NET (total_ex_btw) must NEVER fall to 0 while a real bank payment
  // moved: the engine books cost/revenue from total_ex_btw (financial-result.ts), and this row
  // is created 'paid' with its bank line simultaneously carrying invoice_id (excluded from the
  // bank leg). If the AI gives no split (a rent/receipt with no separable BTW — the exact case
  // the comment above allows) or the totals disagree, we book the FULL GROSS as net cost with
  // €0 BTW (the engine's "no voorbelasting without a document" rule) so the cost is counted, not
  // silently dropped from kosten/resultaat. BTW alone stays 0 when the AI can't find it.
  const totalExBtw = amountAgrees ? (verification.total_ex_btw ?? totalIncBtw) : totalIncBtw;
  // BTW may only be non-zero when we actually KEPT the AI's split. On any gross fallback (ex ?? gross,
  // or the disagree branch) it stays 0 — so total_ex_btw can never end up = gross WHILE btw != 0 (an
  // over-stated deductible base). [ADV-REVIEW residual: btw gated on the split being present.]
  const btwAmount = amountAgrees && verification.total_ex_btw != null ? (verification.btw_amount ?? 0) : 0;
  const amountWarning = aiTotal != null && !amountAgrees;

  // [OUTGOING-BTW TRUTH] A bank CREDIT is booked as omzet from total_ex_btw. The gross-as-net fallback
  // above is SAFE only for an incoming COST (understating our own VAT reclaim to 0 is conservative).
  // For an OUTGOING sale it is NOT: booking the gross at a silent 0% either FABRICATES revenue (a
  // supplier refund is not a sale) or HIDES the output VAT owed — it lands in rubriek 1e where no
  // readiness check or alert catches it (adversarial review, CONFIRMED). So we never auto-book an
  // outgoing document whose BTW we can't trust: only proceed with a reliable split, otherwise refuse
  // and let the owner add the sale/creditnota manually with the correct rate. No file/insert yet →
  // nothing to roll back. The bank credit stays visible in "Geen factuur" so it is never lost.
  if (
    direction === "outgoing" &&
    !(amountAgrees && verification.total_ex_btw != null && verification.btw_amount != null)
  ) {
    return NextResponse.json(
      {
        error:
          "We konden de BTW op deze inkomende betaling niet betrouwbaar aflezen. Voeg de verkoopfactuur of creditnota handmatig toe met het juiste BTW-tarief, zodat omzet en BTW kloppen.",
        needs_manual_btw: true,
        amountWarning,
      },
      { status: 422 },
    );
  }

  // 6b. [BANK-ATTACH-DEDUP] Semantic duplicate gate — the SAME invoice as a different file.
  //     Byte-hash (step 4) only catches the identical file. The real double-book risk here:
  //     an invoice already imported by email sits in the verify queue as 'processing' (the
  //     bank matcher EXCLUDES processing, so its payment shows in "Geen factuur"); the owner
  //     photographs that same bill and attaches it → a SECOND, auto-'paid' invoice, so the
  //     cost + voorbelasting are booked twice. Run the same graded key the intake/email paths
  //     use (real number → number+total(+date); reliable vendor → vendor+total+date) BEFORE
  //     any storage/insert, keyed on the AI-read fields against invoices in THIS direction.
  //     A `force` escape lets the owner add it anyway (genuinely two bills, same total).
  //
  // [DEDUP-READ-HONEST] And the gate FAILS CLOSED. Every probe below now throws on a failed read
  // instead of answering "nothing found", because on this route the two answers have opposite
  // consequences: this is the one ingestion path that books straight to 'paid' with no verify queue
  // to hold anything back, so a duplicate that slips through is a cost and a voorbelasting claimed
  // twice — silently, and only discoverable by reading the books line by line.
  //
  // Refusing costs the owner one retry. `force` is untouched: an owner who has looked and knows it
  // is a different bill can still add it, which is what makes refusing here affordable.
  if (!force) {
    try {
    const findMatch = async (q: { tier: string; total: number; invoiceNumber?: string; vendor?: string; dateIso?: string | null }) => {
      let query = pipeline
        .from("invoices")
        .select("id, invoice_number, client_name, status")
        .eq("direction", direction)
        .eq(direction === "outgoing" ? "sender_id" : "receiver_id", user.id)
        .eq("total_inc_btw", q.total);
      // [LIKE-ESCAPE] escapeLikeValue, as the three sibling ingestion paths already do. A raw
      // value here is a PATTERN, not a string: a vendor written "A_B" or "50% Korting" turns `_`
      // and `%` into wildcards and matches a DIFFERENT supplier's invoice — and this is the
      // duplicate gate, so the wrong match silently blocks a legitimate bill as "already added".
      if (q.tier === "vendor" && q.vendor) query = query.ilike("client_name", escapeLikeValue(q.vendor));
      if (q.dateIso) query = query.eq("invoice_date", q.dateIso);
      // [DEDUP-READ-HONEST] A dropped error here defeats the whole gate: supabase-js answers a
      // failed read with { data: null, error }, so `data ?? []` turned "we could not look" into
      // "there is no duplicate" — and this route books straight to 'paid', so the cost and the
      // voorbelasting are then claimed twice. Throw; the gate below refuses rather than guesses.
      const { data, error } = await query.order("id", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const hit =
        q.tier === "number" && q.invoiceNumber
          ? rows.find((r) => normalizeInvoiceNumber(r.invoice_number) === normalizeInvoiceNumber(q.invoiceNumber))
          : rows[0];
      return hit ? { id: hit.id, invoice_number: hit.invoice_number, client_name: hit.client_name } : null;
    };
    // Probe TWICE so an OCR-total drift between the two reads of the same bill can't hide a
    // duplicate: first the photo's OCR total, then the BANK amount (the money that actually
    // moved — usually equal to the stored invoice total, so it catches the case where this
    // photo read a cent differently than the email import did). Either hit blocks the re-book.
    const ocrTotal = verification.total_inc_btw ?? verification.amount ?? bankAmount;
    let dup = await findSemanticDuplicate(
      { invoiceNumber: verification.invoice_number, vendor: verification.vendor, totalIncBtw: ocrTotal, invoiceDate: verification.invoice_date },
      findMatch
    );
    if ((!dup.duplicate || !dup.match) && Math.abs(bankAmount - ocrTotal) > AMOUNT_TOLERANCE && bankAmount > 0) {
      dup = await findSemanticDuplicate(
        { invoiceNumber: verification.invoice_number, vendor: verification.vendor, totalIncBtw: bankAmount, invoiceDate: verification.invoice_date },
        findMatch
      );
    }
    if (dup.duplicate && dup.match) {
      return NextResponse.json(
        {
          error: "Deze factuur lijkt al in de app te staan.",
          duplicate: true,
          semantic: true,
          match: { id: dup.match.id, invoice_number: dup.match.invoice_number, vendor: dup.match.client_name },
          detail:
            "Als dit dezelfde factuur is, koppel de bestaande factuur aan deze betaling in plaats van hem opnieuw toe te voegen. Weet je zeker dat het een andere factuur is? Dan kun je hem alsnog toevoegen.",
        },
        { status: 409 }
      );
    }

    // [DEDUP-SOFT] The hard gate above only catches an exact number (or vendor+total+date) match with
    // an EXACT total. But attach books straight to 'paid' with NO verify queue to hold an uncertain
    // match — so a re-arrival the hard key can't prove (a placeholder/OCR invoice-number drift, or
    // sub-cent float noise the exact-equality fetch misses) would double-book the cost + voorbelasting
    // SILENTLY. Run the same soft detector the other three ingestion paths use, over a cent-band fetch,
    // and WARN (overridable via `force`) instead of auto-booking a possible duplicate. Uncertain ⇒ warn,
    // never a hard block: the owner can confirm it is genuinely a different bill.
    const possibleDup = await collectPossibleDuplicate(
      { invoiceNumber: verification.invoice_number, vendor: verification.vendor, totalIncBtw, invoiceDate },
      async (total) => {
        // [DEDUP-READ-HONEST] Same rule as the hard gate above — a failed read is not an empty set.
        const { data, error } = await pipeline
          .from("invoices")
          .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
          .eq(direction === "outgoing" ? "sender_id" : "receiver_id", user.id)
          .eq("direction", direction)
          .gte("total_inc_btw", total - 0.005)
          .lte("total_inc_btw", total + 0.005)
          .order("id", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
      // [DEDUP-CORRECTED] Same number, ANY amount — a corrected re-issue is precisely the case the
      // amount-anchored fetch above cannot return, and the hard key cannot see either.
      async (invoiceNumber) => {
        // [DEDUP-READ-HONEST] Same rule again.
        const { data, error } = await pipeline
          .from("invoices")
          .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
          .eq(direction === "outgoing" ? "sender_id" : "receiver_id", user.id)
          .eq("direction", direction)
          .ilike("invoice_number", escapeLikeValue(invoiceNumber))
          .order("id", { ascending: false })
          .limit(50);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    );
    if (possibleDup) {
      return NextResponse.json(
        {
          error: "Deze factuur lijkt mogelijk al in de app te staan.",
          duplicate: true,
          semantic: true,
          possible: true,
          canForce: true,
          match: { id: possibleDup.match.id, invoice_number: possibleDup.match.invoice_number, vendor: possibleDup.match.client_name },
          reason: possibleDup.reason,
          detail: `Mogelijk dubbel${possibleDup.match.invoice_number ? ` met factuur ${possibleDup.match.invoice_number}` : ""} (${possibleDup.reason}). Weet je zeker dat dit een andere factuur is? Dan kun je hem alsnog toevoegen.`,
        },
        { status: 409 }
      );
    }
    } catch (e) {
      // Nothing has been written yet — the storage upload and the insert both come after this
      // block — so refusing here leaves no half-attached invoice behind.
      console.error("[DEDUP-READ-HONEST] duplicate check failed — refusing to book", {
        userId: user.id,
        error: e instanceof Error ? e.message : String(e),
      });
      return NextResponse.json(
        {
          error: "We konden nu niet nakijken of deze factuur al in de app staat. Er is niets toegevoegd — probeer het zo meteen opnieuw.",
          code: "dedup_unavailable",
          // The owner's deliberate way past a check that cannot run, same door as a rejected match.
          canForce: true,
        },
        { status: 503 },
      );
    }
  }

  // 7. Store the file in Storage + documents (same shape as manual upload).
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: "Opslaan van bestand mislukt" }, { status: 500 });
  }

  const folderId = await resolveImportTarget(
    user.id,
    verification.invoice_date ?? invoiceDate,
    "facturen",
    "user"
  );
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      file_name: file.name,
      file_url: storagePath,
      file_size: file.size,
      file_type: file.type,
      doc_type: "factuur",
      folder_id: folderId,
      year: new Date(invoiceDate).getFullYear(),
      source: "upload",
      ai_processed: true,
      ai_doc_type: "invoice",
      content_hash: contentHash,
    })
    .select("id")
    .single();
  // [R7] Capture the documents-insert error. The closing package resolves an incoming
  // invoice's evidence via document_id → documents.file_url; a null document_id would
  // make this (auto-PAID) invoice's file unreachable there. Roll back the stored file
  // and stop rather than create an evidence-less paid invoice.
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath]);
    // [DEDUP-ATOMIC] A concurrent double-submit (or a retry) that raced PAST the byte-hash SELECT
    // above trips the (user_id, content_hash) UNIQUE index here (23505). Treat it exactly like the
    // SELECT-found duplicate: the other request already created the document + its (auto-PAID)
    // invoice, so we must NOT create a second — that would double-count the cost + voorbelasting.
    // Return the same 409 duplicate, never a 500 that would invite another retry.
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, folder_id").eq("user_id", user.id).eq("content_hash", contentHash).limit(1).maybeSingle();
      const folderPath = dup ? await buildFolderBreadcrumb(supabase, user.id, dup.folder_id ?? null) : [];
      const where = folderPath.length ? `Dit bestand staat al in: ${folderPath.join(" / ")}` : "Dit bestand is al toegevoegd";
      return NextResponse.json({ error: where, duplicate: true }, { status: 409 });
    }
    return NextResponse.json({ error: "Opslaan van de factuur mislukt — probeer het opnieuw." }, { status: 500 });
  }
  const documentId = doc.id;

  // 8. Create the invoice — already 'paid' (the owner attached the file for a
  //    payment they SEE on the statement). Direction-aware:
  //      incoming (expense): receiver_id = user, sender_id = null  (vendor bill)
  //      outgoing (income) : sender_id = user, receiver_id = null  (a sale/refund)
  //    service_role required (incoming RLS expects sender_id = auth.uid(), which
  //    is null here). payment_method 'bank' + marked_paid_at mirror api/bank/confirm.
  const isOutgoing = direction === "outgoing";
  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: isOutgoing ? user.id : null,
      receiver_id: isOutgoing ? null : user.id,
      direction,
      status: "paid", // attached to a real, visible bank payment
      payment_method: "bank",
      marked_paid_at: new Date().toISOString(),
      // [PARTIAL-PAY] The MONEY side of 'paid', written here rather than left to a reversal.
      //
      // status said paid and amount_paid stayed at its 0 default, and the two are read by
      // different things. recompute_invoice_amount_paid re-derives amount_paid from Σ
      // amount_applied — but it runs on UNLINK, so until someone undid this attachment the row
      // claimed to be settled and showed nothing settled. Every reader that asks "what does this
      // invoice still owe" answers with the full total: payment-plan.ts's openOf (total − paid),
      // the money invariants, and any screen offering it up to be paid AGAIN out of a second bank
      // line. The one that matters most is the last: this invoice exists because a payment was
      // already seen on the statement.
      //
      // Set to the invoice's own total, which is exactly what this route writes on the link row a
      // few dozen lines down — same number, same reason, and now they agree from the first moment
      // instead of only after a reversal.
      amount_paid: Math.abs(totalIncBtw),
      payment_date: normalizeToIso(tx.date) ?? invoiceDate,
      source: "upload",
      client_name: verification.vendor || (isOutgoing ? "Onbekende klant" : "Onbekende afzender"),
      invoice_date: invoiceDate,
      invoice_number: verification.invoice_number || `UPLOAD-${Date.now()}`,
      total_ex_btw: totalExBtw,
      btw_amount: btwAmount,
      total_inc_btw: totalIncBtw,
      pdf_url: storagePath,
      document_id: documentId,
      vendor_iban: verification.vendor_iban ?? null,
      payment_reference: verification.payment_reference ?? null,
      field_confidence: verification.field_confidence ?? null,
    })
    .select("id")
    .single();

  if (dbError || !invoice) {
    // [R7/M4] Roll back the document row + stored file so the evidence isn't orphaned —
    // its content_hash would otherwise make byte-hash dedup BLOCK a re-upload (409).
    await pipeline.from("documents").delete().eq("id", documentId);
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json({ error: dbError?.message || "Aanmaken factuur mislukt" }, { status: 500 });
  }

  // 9. Link document → invoice (bidirectional).
  await pipeline.from("documents").update({ invoice_id: invoice.id }).eq("id", documentId);

  // 10. [BANK-ATTACH-MULTI] Do NOT mark the transaction 'matched' here. One
  //     payment can cover SEVERAL invoices (a supplier groups them); marking it
  //     matched after the FIRST file would hide the transaction while other
  //     invoices are still unlinked — and lose them (the Oz+Er bug: paid 3,
  //     linked 1, all disappeared). Instead the transaction STAYS 'pending'
  //     (visible in "Geen factuur") and the owner dismisses it with "Negeren"
  //     once they've attached everything they have for it. We only record the
  //     latest linked invoice_id as a soft reference; status is untouched.
  //
  //     This is deliberate: matching is a LIGHT tool here, not a reconciliation
  //     engine. We don't compute whether the linked invoices' total "covers" the
  //     transaction (that would reintroduce amount-matching we chose not to
  //     build). The owner decides when the transaction is dealt with.
  const { data: linkedRows, error: linkErr } = await pipeline
    .from("bank_transactions")
    .update({ invoice_id: invoice.id })
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending") // never touch an already-settled row
    .select("id");

  // [DOUBLE-COUNT GUARD] The engine excludes a bank line from the kosten/omzet leg ONLY when its
  // invoice_id column is set (financial-result.ts:345). If this write errored OR matched 0 rows (the
  // tx is no longer 'pending' — e.g. a concurrent settle, which the .eq filter drops WITHOUT an
  // error), the still-categorized bank line stays counted. Leaving the freshly-'paid' invoice — now
  // carrying the FULL gross cost, not the old €0 — in place would DOUBLE-COUNT the money. So we do
  // NOT return ok: roll the invoice + document + file back (as the dbError path above does) and ask
  // the owner to retry, so nothing is ever half-booked. (Adversarial review, CONFIRMED double-count.)
  if (linkErr || !linkedRows || linkedRows.length === 0) {
    console.error(
      "[BANK-ATTACH] transaction link failed:",
      linkErr?.message ?? "0 rows matched (transaction not pending)",
    );
    await pipeline.from("invoices").delete().eq("id", invoice.id);
    await pipeline.from("documents").delete().eq("id", documentId);
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json(
      {
        error: "Koppelen aan de banktransactie is niet gelukt — probeer het opnieuw.",
        link_failed: true,
      },
      { status: 409 },
    );
  }

  // [BANK-TX-INVOICES] Record THIS invoice in the reversal index. Attach supports several invoices
  // on one pending tx, but tx.invoice_id only ever holds the LAST one — so without the join row a
  // later unlink would restore only the last-attached invoice, stranding the earlier ones paid with
  // no bank line. Recording every attached invoice here makes the whole set reversible by id.
  // [PARTIAL-PAY] Write the applied amount with it: recompute_invoice_amount_paid re-derives
  // invoices.amount_paid as SUM(amount_applied) over the surviving links on every unlink/undo, so a
  // link with a NULL amount makes this invoice — created 'paid' by this very payment — recompute to
  // amount_paid 0 and re-open at its full total. The invoice is created fully settled by this
  // transaction, so the applied amount is its own total.
  await recordPaymentLinks(pipeline, user.id, transactionId, [invoice.id], {
    [invoice.id]: Math.abs(totalIncBtw),
  });

  // 11. Notification (non-blocking) — service_role by rule.
  try {
    await pipeline.from("notifications").insert({
      user_id: user.id,
      title: "Factuur gekoppeld",
      body: `Een bestand is gekoppeld aan een banktransactie en opgeslagen als betaalde ${isOutgoing ? "verkoopfactuur" : "inkoopfactuur"} (${verification.vendor || "onbekend"}).`,
      type: "payment",
      // [NOTIF-DEADEND] This route CREATES a paid invoice out of a bank line — the one
      // row the owner is most likely to want to check — and the bell announcing it had
      // no link. Point at the new invoice, by direction.
      link: isOutgoing
        ? `/dashboard/invoice/${invoice.id}`
        : `/dashboard/incoming/manage?focus=${invoice.id}`,
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({
    ok: true,
    invoice_id: invoice.id,
    vendor: verification.vendor ?? null,
    amountWarning, // UI can prompt "controleer het bedrag" when AI total disagreed
  });
}