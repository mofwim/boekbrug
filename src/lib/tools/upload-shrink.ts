// src/lib/tools/upload-shrink.ts
// [SIZE-SHRINK] Should this failed upload be offered a shrink?
//
// One line of logic, pulled out of UploadClient so it can be tested. The
// component itself needs a Supabase session to render, which CI has not got —
// so the decision inside it was covered by nothing, and it is the part with an
// actual judgement in it. Getting it wrong shows a button that cannot help
// (worse than no button) or hides one that could.

/** The intake cap. Kept as an argument so the caller stays the source of truth. */
export function shouldOfferShrink(file: { type?: string; name?: string; size: number }, maxBytes: number): boolean {
  if (file.size <= maxBytes) return false;

  // Only a PDF. An image has already been through normalizeImageForUpload by
  // the time this is asked, so it is as small as it can responsibly be — the
  // compressor would take a second and hand back the same bytes.
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
}
