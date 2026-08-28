// src/app/dashboard/accountant/loading.tsx
// [INSTANT] The accountant's home answers the tap immediately.
//
// Every /dashboard/accountant/* route is a force-dynamic server component that fetches its
// overview, its todo feed and its work queues before a byte leaves — and not one of them had a
// loading state, so each tap held the PREVIOUS screen frozen until the server was done. That is
// the disease docs/UX_REVIEW_2026.md diagnosed across forty screens and cured everywhere except
// the module that was written after it.
//
// This file covers the subtree; the busier routes carry their own shape beside it.
// maxWidth is COLUMN.hub because AccountantHome is a hub — see the ladder in tokens.ts.

import { SkeletonPage, SkeletonLine, SkeletonStats, SkeletonList } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.hub}>
      <SkeletonLine w={220} h={16} />
      <SkeletonStats count={2} />
      <SkeletonList rows={5} />
    </SkeletonPage>
  )
}
