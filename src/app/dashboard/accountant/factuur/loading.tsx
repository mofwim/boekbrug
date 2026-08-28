// src/app/dashboard/accountant/factuur/loading.tsx
// [INSTANT] See the note in ../loading.tsx. A form, not a list: a few fields and a wide block,
// so what appears while the server answers has the shape of what arrives.

import { SkeletonPage, SkeletonLine, SkeletonCard } from '@/components/ui/PageSkeleton'
import { COLUMN } from '@/lib/design/tokens'

export default function Loading() {
  return (
    <SkeletonPage maxWidth={COLUMN.work}>
      <SkeletonLine w={220} h={14} />
      <SkeletonCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SkeletonLine w="60%" h={12} />
          <SkeletonLine w="100%" h={38} radius={8} />
          <SkeletonLine w="45%" h={12} />
          <SkeletonLine w="100%" h={38} radius={8} />
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonLine w="100%" h={80} radius={8} />
      </SkeletonCard>
    </SkeletonPage>
  )
}
