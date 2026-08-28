// src/app/netto-inkomen-zzp/opengraph-image.tsx
// [OG-TOOL] Share card for this tool. The design and the copy live in src/lib/og-tool-image.tsx —
// see its header for why each tool gets its own card instead of the generic site one.
//
// `alt` is a plain string on purpose. Next reads these exports statically; when it was
// `toolBySlug(...)?.title` the whole file was skipped without an error and the route 404'd,
// which looks exactly like a build that worked.

import { toolOgImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-tool-image'

export const alt = 'Netto inkomen ZZP — BoekBrug'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return toolOgImage('/netto-inkomen-zzp')
}
