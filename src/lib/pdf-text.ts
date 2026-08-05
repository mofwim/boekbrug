// src/lib/pdf-text.ts
// [PDF-TEXT] Open a PDF once and report its text layer and page count.
//
// It lived as a private helper inside /api/intake, which is where the second reader of a PDF
// invoice — the e-mail sync — could not reach it. That is how the e-mail door ended up running
// none of the checks that read a text layer: not because anyone decided it should not, but because
// the two lines that would have done it were in another file.
//
// Both answers matter, and they are different questions:
//   · `text` feeds detectMultipleInvoices — "does this ONE file carry SEVERAL invoices?" — and the
//     daily-sales report detector on the intake path;
//   · `pages` feeds cannotVerifySingleInvoice — "could that check even RUN?" — because a scanned
//     stack has no text layer, and that is precisely the pile the first check exists for.
//
// Never throws: an unreadable or encrypted PDF answers { text: null, pages: 0 }, which the callers
// read as "no text layer, not a multi-page file". That is the honest shape — the checks downstream
// distinguish "checked and fine" from "could not check" themselves.

/** Read a PDF's merged text layer and page count. Never throws. */
export async function readPdfTextLayer(buffer: Buffer): Promise<{ text: string | null; pages: number }> {
  try {
    const unpdf = await import("unpdf");
    const doc = await unpdf.getDocumentProxy(new Uint8Array(buffer));
    const pages = typeof doc.numPages === "number" ? doc.numPages : 0;
    const { text } = await unpdf.extractText(doc, { mergePages: true });
    const t = (text ?? "").trim();
    return { text: t.length > 0 ? t : null, pages };
  } catch {
    return { text: null, pages: 0 };
  }
}
