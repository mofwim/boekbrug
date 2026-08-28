// src/app/dashboard/clients/beheer/loading.tsx
// [INSTANT] The accountant's portfolio — reached from the bottom bar, so it is tapped more than
// any other screen in the module. See src/app/dashboard/accountant/loading.tsx for the why.

import { SkeletonPage, SkeletonLine, SkeletonList } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={180} h={14} />
      <SkeletonList rows={7} />
    </SkeletonPage>
  )
}
