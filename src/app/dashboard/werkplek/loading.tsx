// src/app/dashboard/werkplek/loading.tsx
// [INSTANT] Shown the moment this route is tapped, while the server renders it.
// Next wraps page.tsx in a Suspense boundary with this as the fallback, so the
// screen answers immediately instead of holding the previous page frozen.
// The container width matches werkplek's own so nothing shifts sideways when the
// real content lands. See docs/MOTION_SYSTEM.md and docs/UX_REVIEW_2026.md.

import { SkeletonPage, SkeletonCard } from '@/components/ui/PageSkeleton'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={480}>
      <SkeletonCard h={78} />
      <SkeletonCard h={78} />
      <SkeletonCard h={78} />
      <SkeletonCard h={78} />
    </SkeletonPage>
  )
}
