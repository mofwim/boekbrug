// lib/documents-utils.ts
// Client-safe helpers — NO server imports
// يُستخدم في Client Components بأمان

/** Derive a doc_type from MIME type */
export function inferDocType(mimeType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "spreadsheet";
  if (mimeType.includes("word") || mimeType.includes("document")) return "document";
  if (mimeType === "text/csv") return "csv";
  if (mimeType.includes("xml")) return "xml";
  if (mimeType === "message/rfc822") return "email";
  if (mimeType === "application/zip") return "archive";
  return "other";
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  image: "Afbeelding",
  spreadsheet: "Spreadsheet",
  document: "Document",
  csv: "CSV",
  xml: "XML",
  email: "E-mail",
  archive: "Archief",
  other: "Overig",
};