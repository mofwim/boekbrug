// app/dashboard/documents/page.tsx
// [DOCS-DISABLE-OLD] Deprecated documents page — access disabled, no code/data deleted.
// The old documents file-system shared via the documents.shared flag, but the
// accountant RLS reads folder membership only -> its shares could silently never
// reach the accountant. We do NOT delete; we redirect each role to its live system:
//   - client (no clientId)      -> /dashboard/bestanden
//   - accountant (?clientId=...) -> /dashboard/brug  (brug shows ALL linked clients'
//                                   invoices + shared documents; it does not read
//                                   clientId, so we drop it rather than pass it.)

import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ clientId?: string }>;
}

export default async function DocumentsPage({ searchParams }: Props) {
  const { clientId } = await searchParams;

  // [DOCS-DISABLE-OLD] Accountant came here to view a client's files. The live
  // accountant system (brug) lists every linked client's invoices AND shared
  // documents in one tree, selecting clients itself (no clientId param), so we
  // send them to brug without forwarding clientId.
  if (clientId) {
    redirect("/dashboard/brug");
  }

  // [DOCS-DISABLE-OLD] Client (owner) -> live files system.
  redirect("/dashboard/bestanden");
}