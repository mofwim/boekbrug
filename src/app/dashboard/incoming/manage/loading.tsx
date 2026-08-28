// src/app/dashboard/incoming/manage/loading.tsx
// [INSTANT] The pay screen. It reads every open purchase invoice, the paid ones, the bank
// evidence behind each and the whole-book scan before it renders — the longest wait in the app,
// and the one that showed nothing at all. /incoming has had a skeleton since July; its busiest
// child never got one.

import { SkeletonPage, SkeletonLine, SkeletonStats, SkeletonList } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={200} h={14} />
      <SkeletonStats count={2} />
      <SkeletonList rows={6} />
    </SkeletonPage>
  )
}
