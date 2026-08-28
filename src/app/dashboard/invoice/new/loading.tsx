// src/app/dashboard/invoice/new/loading.tsx
// [INSTANT] The most consequential screen the owner opens, and it had no loading state: the FAB
// was tapped and the previous page sat frozen while the server assembled clients, articles and
// the next invoice number. A form-shaped skeleton, so nothing jumps when the real fields land.

import { SkeletonPage, SkeletonLine, SkeletonCard } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={180} h={16} />
      <SkeletonCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonLine w="40%" h={12} />
          <SkeletonLine w="100%" h={38} radius={8} />
          <SkeletonLine w="55%" h={12} />
          <SkeletonLine w="100%" h={38} radius={8} />
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonLine w="30%" h={12} />
          <SkeletonLine w="100%" h={56} radius={8} />
          <SkeletonLine w="100%" h={56} radius={8} />
        </div>
      </SkeletonCard>
    </SkeletonPage>
  )
}
