// src/app/dashboard/accountant/bevestigen/loading.tsx
// [INSTANT] See the note in ../loading.tsx: this module shipped without loading states.
// A worklist, so the skeleton is a worklist — the width comes off the ladder, which is what
// keeps the real content from sliding sideways when it lands.

import { SkeletonPage, SkeletonLine, SkeletonList } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={200} h={14} />
      <SkeletonList rows={6} />
    </SkeletonPage>
  )
}
