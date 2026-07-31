// src/app/dashboard/vragen/loading.tsx
// [INSTANT] Shown the moment this route is tapped, while the server renders it.
// Next wraps page.tsx in a Suspense boundary with this as the fallback, so the
// screen answers immediately instead of holding the previous page frozen.
// The container width matches vragen's own so nothing shifts sideways when the
// real content lands. See docs/MOTION_SYSTEM.md and docs/UX_REVIEW_2026.md.

import { SkeletonPage, SkeletonLine, SkeletonList } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={240} h={14} />
      <SkeletonList rows={4} rowHeight={88} />
    </SkeletonPage>
  )
}
