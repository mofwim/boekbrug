// src/app/dashboard/accountant/voorbeeld/loading.tsx
// [INSTANT] See the note in ../loading.tsx. This is the screen a brand-new accountant opens
// BEFORE their first client — the proof that the product does what it says — so it is the last
// one that may sit blank while a server thinks.

import { SkeletonPage, SkeletonLine, SkeletonStats, SkeletonList } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={260} h={16} />
      <SkeletonStats count={3} />
      <SkeletonList rows={4} />
    </SkeletonPage>
  )
}
