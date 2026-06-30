// app/dashboard/documents/page.tsx
// [DOCS-DISABLE-OLD] Deprecated documents page — access disabled, no code/data deleted.
// The old documents file-system shared via the documents.shared flag, but the
// accountant RLS reads folder membership only -> its shares could silently never
// reach the accountant. We do NOT delete; we redirect each role to its live system:
//   - client (no clientId)      -> /dashboard/bestanden
//   - accountant (?clientId=...) -> /dashboard/brug (clientId passed through; brug
//                                   ignores it harmlessly if it selects clients another way)

import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ clientId?: string }>;
}

export default async function DocumentsPage({ searchParams }: Props) {
  const { clientId } = await searchParams;

  // [DOCS-DISABLE-OLD] Accountant came here to view a specific client's files.
  // Send them to the live accountant system (brug), forwarding clientId so brug
  // can pre-select the client if it accepts that param.
  if (clientId) {
    redirect(`/dashboard/brug?clientId=${encodeURIComponent(clientId)}`);
  }

  // [DOCS-DISABLE-OLD] Client (owner) -> live files system.
  redirect("/dashboard/bestanden");
}