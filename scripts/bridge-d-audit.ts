// scripts/bridge-d-audit.ts
// [BRIDGE-D] Audit logging for the 6 soft-deleted test-data documents.
// -----------------------------------------------------------------------------
// Run AFTER the SQL soft-delete (BRIDGE-D_soft_delete_test_pollution.sql).
//
// Sequence honored:  snapshot (embedded below, verified pre-change)
//                 -> soft UPDATE (SQL)
//                 -> audit (this script).
//
// Why a TS script and NOT a raw INSERT into audit_logs:
//   logAuditAction() runs PII sanitization (strips tokens/secrets) + a 10KB
//   size cap + a service_role write. A manual INSERT bypasses all of that and
//   breaks audit consistency. So we go through the helper.
//
// The snapshot is hard-coded (the verified pre-change state from BRIDGE-DIAG-01)
// so the audit is faithful and run-order independent: it does not depend on the
// rows still existing or on whether the soft-delete has already run.
//
// Run (Windows -- pwsh or cmd), env loaded from .env.local:
//   npx tsx --env-file=.env.local scripts/bridge-d-audit.ts
//
//   Fallback if your tsx build does not accept --env-file:
//   node --env-file=.env.local --import tsx scripts/bridge-d-audit.ts
//
// Run ONCE. Re-running appends duplicate audit rows (non-fatal, but avoid it).
// -----------------------------------------------------------------------------

import { logAuditAction } from '@/lib/audit'
import { createPipelineClient } from '@/lib/supabase-pipeline'

// Actor recorded on each audit row. Defaults to the OWNER of the documents
// (the test account). If you prefer "actor = admin who ran the cleanup",
// set this to your own profile id instead.
const ACTOR_USER_ID = 'e8edd9c1-18c8-4c6f-b1de-d57747aafdff'

const REASON = 'BRIDGE-D cleanup'

interface DocSnapshot {
  id: string
  file_name: string
  file_url: string
  file_size: number
  file_type: string
  folder_id: string
  year: number
  period: string
  created_at: string
}

// Verified pre-change snapshot (BRIDGE-DIAG-01 verification query output).
const SNAPSHOTS: DocSnapshot[] = [
  {
    id: '45a026eb-59bd-4349-ac10-8251b820978e',
    file_name: 'مشروع المحاسب.docx',
    file_url:
      'e8edd9c1-18c8-4c6f-b1de-d57747aafdff/shared/2026/Q2/20260516______________.docx',
    file_size: 16547,
    file_type:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    folder_id: 'c78ef0cf-0d2c-4414-a04b-44ea2a96ff93',
    year: 2026,
    period: '2026-Q2',
    created_at: '2026-05-15T22:10:53.756952+00:00',
  },
  {
    id: 'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',
    file_name: 'English_Content_Network_Memory_Final_Clean_2.pdf',
    file_url:
      'https://cedrndplmydqcmbszfmp.supabase.co/storage/v1/object/public/documents/e8edd9c1-18c8-4c6f-b1de-d57747aafdff/bank/1778883989970_English_Content_Network_Memory_Final_Clean_2.pdf',
    file_size: 4183,
    file_type: 'application/pdf',
    folder_id: 'c78ef0cf-0d2c-4414-a04b-44ea2a96ff93',
    year: 2026,
    period: '2026-Q2',
    created_at: '2026-05-15T22:26:30.754361+00:00',
  },
  {
    id: '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',
    file_name: 'مهم.docx',
    file_url:
      'e8edd9c1-18c8-4c6f-b1de-d57747aafdff/2026/Q2/20260517_1779022372719____.docx',
    file_size: 157828,
    file_type:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    folder_id: 'c78ef0cf-0d2c-4414-a04b-44ea2a96ff93',
    year: 2026,
    period: '2026-Q2',
    created_at: '2026-05-17T12:52:53.425399+00:00',
  },
  {
    id: 'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',
    file_name: 'مهم.docx',
    file_url:
      'e8edd9c1-18c8-4c6f-b1de-d57747aafdff/2026/Q2/20260517____.docx',
    file_size: 157828,
    file_type:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    folder_id: 'c89af5db-220d-4aed-a19f-3627263ffe72',
    year: 2026,
    period: '2026-Q2',
    created_at: '2026-05-16T22:41:51.131210+00:00',
  },
  {
    id: 'f15a973a-30d1-4404-bff0-6d4eade2c93d',
    file_name: '2026-0285.pdf',
    file_url:
      'e8edd9c1-18c8-4c6f-b1de-d57747aafdff/2026/Q2/20260517_1779023144143_2026-0285.pdf',
    file_size: 3740,
    file_type: 'application/pdf',
    folder_id: 'c89af5db-220d-4aed-a19f-3627263ffe72',
    year: 2026,
    period: '2026-Q2',
    created_at: '2026-05-17T13:05:44.627641+00:00',
  },
  {
    id: '8cdccc7b-86c2-4d74-ac54-eb5c416caa06',
    file_name: 'Kiwi Offerfeest Reserveringen 2026.xlsx',
    file_url:
      'e8edd9c1-18c8-4c6f-b1de-d57747aafdff/2026/Q2/20260517_1779035767926_Kiwi_Offerfeest_Reserveringen_2026.xlsx',
    file_size: 5331,
    file_type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    folder_id: 'c89af5db-220d-4aed-a19f-3627263ffe72',
    year: 2026,
    period: '2026-Q2',
    created_at: '2026-05-17T16:36:08.378507+00:00',
  },
]

async function main(): Promise<void> {
  console.log(
    `[BRIDGE-D] Writing audit for ${SNAPSHOTS.length} soft-deleted documents...`,
  )

  for (const doc of SNAPSHOTS) {
    await logAuditAction({
      userId: ACTOR_USER_ID,
      action: 'document.deleted', // closed AuditAction union member
      entityType: 'document', // singular -- matches historical rows
      entityId: doc.id,
      oldValue: {
        document_id: doc.id,
        file_name: doc.file_name,
        file_url: doc.file_url,
        file_size: doc.file_size,
        file_type: doc.file_type,
        folder_id: doc.folder_id,
        year: doc.year,
        period: doc.period,
        shared: false,
        created_at: doc.created_at,
        reason: REASON,
      },
      newValue: { trashed: true }, // soft delete -> not a hard removal
    })
    console.log(`  ✓ ${doc.id} -- ${doc.file_name}`)
  }

  // Verification: count audit rows now present for these 6 documents.
  const supabase = createPipelineClient()
  const ids = SNAPSHOTS.map((d) => d.id)
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, entity_id, created_at')
    .eq('action', 'document.deleted')
    .in('entity_id', ids)

  if (error) {
    console.error('[BRIDGE-D] verification query failed:', error.message)
  } else {
    console.log(
      `[BRIDGE-D] audit_logs rows for these documents: ${data?.length ?? 0} (expect 6 after a single run).`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[BRIDGE-D] script failed:', err)
    process.exit(1)
  })