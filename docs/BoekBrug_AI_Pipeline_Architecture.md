# BoekBrug — AI Pipeline & Error Detection Architecture
*Single source of truth for AI Pipeline, DB Design, and Error Handling*
*Last updated: May 2026*

---

## المبدأ الأساسي

```
كل ما يدخل التطبيق → يمر من Pipeline واحد
Pipeline لا يقرر → يقترح فقط
الإنسان يؤكد → النظام ينفذ
```

---

## النظام الأول — AI Pipeline Architecture

### طبقات النظام — 4 طبقات

```
┌─────────────────────────────────────┐
│      LAYER 1 — INGESTION            │
│      كيف يدخل الملف/البيانات        │
├─────────────────────────────────────┤
│      LAYER 2 — PROCESSING           │
│      AI يقرأ ويصنف ويستخرج         │
├─────────────────────────────────────┤
│      LAYER 3 — MATCHING             │
│      AI يطابق ويربط ببعضها          │
├─────────────────────────────────────┤
│      LAYER 4 — PRESENTATION         │
│      العميل يرى ويؤكد               │
└─────────────────────────────────────┘
```

---

### LAYER 1 — INGESTION

```
4 مصادر:

A. Gmail/Outlook OAuth
   → Background sync كل ساعة
   → PDF attachments فقط
   → يتجاهل: إعلانات، رسائل شخصية

B. Upload يدوي
   → واجهة Bestanden
   → Onboarding
   → Drag & drop

C. CAMT / Bank file
   → XML parsing مباشر
   → لا AI — parsing فقط

D. إنشاء فاتورة من التطبيق
   → يدخل مباشرة لـ invoices table
   → لا processing مطلوب
```

---

### LAYER 2 — PROCESSING

#### STEP 2A — Classification
```typescript
Input:  filename + mimeType + أول صفحة كـ base64
Output: {
  type: 'invoice_incoming' | 'invoice_outgoing' |
        'bank_statement' | 'receipt' | 'quote' |
        'reminder' | 'ad' | 'unknown'
  confidence: 0-1
}

Rule: confidence < 0.6  → type = 'unknown'
Rule: type = 'unknown'  → يسأل العميل
Rule: confidence >= 0.75 → يتابع تلقائياً
```

#### STEP 2B — Extraction
```typescript
// يعمل فقط إذا confidence >= 0.6
Input:  الملف كاملاً كـ base64
Output: {
  vendor_name: string
  vendor_kvk?: string       // يُتحقق: 8 أرقام
  vendor_btw?: string       // يُتحقق: NL\d{9}B\d{2}
  vendor_iban?: string
  invoice_number?: string
  invoice_date?: string     // يُحوَّل لـ ISO
  due_date?: string
  amount_ex_btw: number     // يجب موجب
  btw_amount: number
  amount_inc_btw: number
  currency: 'EUR'           // غير EUR → flag
  line_items?: { description, amount }[]
}

Rule: أي حقل لا يمر validation → null (لا تخمّن)
Rule: عملة غير EUR → flag للمراجعة
Rule: تاريخ خارج 2020-2030 → null
```

#### STEP 2C — Deduplication
```typescript
Hash = MD5(vendor_name + invoice_number + amount + date)

إذا Hash موجود في DB → تجاهل الملف
إذا لا → تابع

// Fuzzy matching أيضاً:
// نفس vendor + amount + date حتى لو invoice_number مختلف
```

---

### LAYER 3 — MATCHING

#### STEP 3A — Invoice ↔ Bank Transaction
```typescript
Score Algorithm:
  if amounts match exactly → +50
  if amounts match ±5%    → +30
  if vendor name similar  → +25  // Levenshtein 80%
  if date within 30 days  → +15
  if reference matches    → +10

Score >= 70  → matched: true  → يعلّم مدفوعة تلقائياً
Score 40-69  → matched: possible → يقترح على العميل
Score < 40   → matched: false → "Niet gevonden"

حالات خاصة:
- دفعة لفواتير متعددة → اقترح المطابقة الجماعية
- دفع على دفعات → status: 'partial'
- refund (مبلغ سالب) → لا تطابق مع فواتير عادية
```

#### STEP 3B — Receipt ↔ Category
```typescript
Output: {
  category: 'fuel' | 'office' | 'equipment' |
            'subscription' | 'travel' | 'other'
  btw_eligible: boolean
  btw_rate: 0 | 9 | 21
}

Rules:
  Shell, BP, Esso        → fuel
  Aldi, Lidl, AH         → office/other
  KPN, Vodafone, T-Mobile → subscription

Rule: نفس المتجر → احفظ اختيار العميل → طبّقه تلقائياً
Rule: BTW breakdown من الـ bon مباشرة → لا تفترض rate موحد
```

#### STEP 3C — Document → Folder
```typescript
invoice_incoming + april 2026 → 2026/Q2/april/Facturen
bank_statement + Q2           → 2026/Q2/Bank
receipt + mei 2026            → 2026/Q2/mei/Kosten
unknown                       → Hoofdmap
```

---

### LAYER 4 — PRESENTATION

```
LEVEL 1 — تلقائي (confidence >= 0.85 + matched: high):
  → يحفظ، يصنف، يضع في مكانه
  → إشعار بسيط: "3 facturen verwerkt"

LEVEL 2 — يقترح (confidence 0.6-0.84 أو matched: medium):
  ┌──────────────────────────────────┐
  │ 📄 Factuur van Shell — € 87,50   │
  │ AI: waarschijnlijk brandstof     │
  │ [✓ Klopt]  [✗ Aanpassen]        │
  └──────────────────────────────────┘

LEVEL 3 — يسأل (confidence < 0.6 أو unknown):
  "Wat is dit document?"
  [ Factuur ] [ Bon ] [ Bankafschrift ] [ Anders ]
```

---

### تدفق البيانات الكامل

```
ملف يدخل
    ↓
INGESTION → source_type يُحدد
    ↓
CLASSIFICATION → type + confidence
    ↓
confidence < 0.6? → LEVEL 3 (يسأل)
    ↓
EXTRACTION → بيانات كاملة + validation
    ↓
DEDUPLICATION → موجود قبل؟ → تجاهل
    ↓
MATCHING → مع البنك؟
    ↓
confidence: high   → AUTO
confidence: medium → LEVEL 2
confidence: false  → LEVEL 3
    ↓
FOLDER PLACEMENT → يُحفظ في مكانه
    ↓
NOTIFICATION → العميل يُعلَم
    ↓
ACCOUNTANT → فقط ما أكده العميل
```

---

### قواعد لا تُكسر أبداً

```
١. AI لا يحذف أبداً
٢. AI لا يرسل للمحاسب بدون تأكيد العميل
٣. AI لا يغير مبالغ أبداً
٤. كل action يُسجَّل في audit_logs + pipeline_events
٥. Fallback دائماً: إذا فشل AI → يُحفظ في Hoofdmap
٦. لا تكرار: deduplication قبل أي حفظ
٧. Error handling: AI يفشل → التطبيق لا يتوقف
٨. Pipeline يستخدم service_role دائماً — لا user token
```

---

## النظام الثاني — Database Architecture

### الجداول الجديدة المطلوبة

#### pipeline_events
```sql
CREATE TABLE public.pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,

  source text NOT NULL CHECK (source IN (
    'gmail', 'outlook', 'upload', 'camt', 'created'
  )),
  stage text NOT NULL CHECK (stage IN (
    'classify', 'extract', 'deduplicate',
    'match', 'place', 'notify'
  )),

  ai_input jsonb,
  ai_output jsonb,
  confidence numeric CHECK (confidence BETWEEN 0 AND 1),

  action_taken text CHECK (action_taken IN (
    'auto', 'suggested', 'asked', 'skipped', 'failed'
  )),

  user_confirmed boolean,
  user_confirmed_at timestamp,
  user_dismissed boolean DEFAULT false,
  was_correct boolean,
  error_message text,
  created_at timestamp DEFAULT now()
);
```

#### pending_confirmations
```sql
CREATE TABLE public.pending_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,

  suggested_type text,
  suggested_folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  suggested_match_invoice_id uuid REFERENCES invoices(id),
  suggested_category text,
  suggested_btw_rate numeric,

  level integer CHECK (level IN (2, 3)),
  confidence numeric,

  status text DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'modified', 'dismissed', 'expired'
  )),

  expires_at timestamp DEFAULT (now() + interval '7 days'),
  created_at timestamp DEFAULT now(),
  resolved_at timestamp
);
```

#### processing_queue
```sql
CREATE TABLE public.processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,

  status text DEFAULT 'queued' CHECK (status IN (
    'queued', 'processing', 'done', 'failed', 'retry'
  )),

  priority integer DEFAULT 5,
  -- 1 = عاجل (onboarding) | 5 = عادي | 10 = background

  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  last_error text,
  process_after timestamp DEFAULT now(),
  created_at timestamp DEFAULT now(),
  started_at timestamp,
  completed_at timestamp
);
```

---

### الأعمدة الجديدة على الجداول الموجودة

```sql
-- documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS processing boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamp,
  ADD COLUMN IF NOT EXISTS pipeline_stage text,
  ADD COLUMN IF NOT EXISTS pipeline_error text,
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;

-- invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS partial_amount_paid numeric;

-- Unique constraint
ALTER TABLE public.documents
  ADD CONSTRAINT unique_document_per_user
    UNIQUE (user_id, content_hash)
    DEFERRABLE INITIALLY DEFERRED;
```

---

### Indexes

```sql
CREATE INDEX idx_documents_hash
  ON public.documents(user_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX idx_documents_gmail
  ON public.documents(gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

CREATE INDEX idx_queue_pending
  ON public.processing_queue(status, priority, process_after)
  WHERE status IN ('queued', 'retry');

CREATE INDEX idx_pending_user
  ON public.pending_confirmations(user_id, status, created_at)
  WHERE status = 'pending';

CREATE INDEX idx_pipeline_document
  ON public.pipeline_events(document_id, created_at DESC);

CREATE INDEX idx_bank_transactions_match
  ON public.bank_transactions(user_id, amount, date)
  WHERE status = 'pending';
```

---

### Functions

```sql
-- Atomic lock — منع Race Condition
CREATE OR REPLACE FUNCTION claim_document_for_processing(
  p_document_id uuid
) RETURNS boolean AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.documents
  SET processing = true, processing_started_at = now()
  WHERE id = p_document_id AND processing = false;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$ LANGUAGE plpgsql;

-- Auto-release إذا تجمد
CREATE OR REPLACE FUNCTION release_stuck_documents()
RETURNS void AS $$
BEGIN
  UPDATE public.documents
  SET processing = false, processing_started_at = null
  WHERE processing = true
    AND processing_started_at < now() - interval '10 minutes';
END;
$$ LANGUAGE plpgsql;

-- Cron job كل 10 دقائق
SELECT cron.schedule(
  'release-stuck-documents',
  '*/10 * * * *',
  'SELECT release_stuck_documents()'
);
```

---

### RLS Strategy

```sql
-- قاعدة ذهبية:
-- User requests  → createServerSupabaseClient (مع RLS)
-- Pipeline jobs  → createPipelineClient (service_role — يتجاوز RLS)

-- documents
CREATE POLICY "documents_select_own" ON public.documents
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "documents_insert_own" ON public.documents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "documents_update_own" ON public.documents
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "documents_accountant_select" ON public.documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accountant_clients ac
      WHERE ac.accountant_id = auth.uid()
      AND ac.zzper_id = documents.user_id
    )
    AND folder_id IN (
      SELECT id FROM public.folders
      WHERE folder_type = 'shared' AND user_id = documents.user_id
    )
  );
```

---

### متى تستخدم كل Client

| الموقف | الـ Client | السبب |
|--------|-----------|-------|
| User يرفع ملف | `createServerSupabaseClient` | RLS يحمي |
| Pipeline يقرأ ملف | `createPipelineClient` | يتجاوز RLS |
| Pipeline يكتب في DB | `createPipelineClient` | لا user session |
| Onboarding classify | `createPipelineClient` | Storage access |
| Gmail Sync | `createPipelineClient` | Background job |
| User يقرأ بياناته | `createServerSupabaseClient` | RLS يفلتر |

---

## النظام الثالث — Error Detection System

### المبدأ

```
كل خطأ يجب أن:
١. يُكشف فوراً
٢. يُصنَّف (خطير / متوسط / منخفض)
٣. يُسجَّل في DB
٤. يُبلَّغ عنه (Slack / Dashboard)
٥. لا يوقف التطبيق
```

---

### Error Codes

```typescript
enum ErrorCode {
  // AI
  AI_TIMEOUT           = 'AI_001'
  AI_RATE_LIMIT        = 'AI_002'
  AI_INVALID_RESPONSE  = 'AI_003'
  AI_HALLUCINATION     = 'AI_004'

  // Pipeline
  PIPELINE_CLAIM_FAILED = 'PIPE_001'
  PIPELINE_STAGE_FAILED = 'PIPE_002'
  PIPELINE_TIMEOUT      = 'PIPE_003'
  PIPELINE_MAX_RETRIES  = 'PIPE_004'

  // Storage
  STORAGE_UPLOAD_FAILED   = 'STOR_001'
  STORAGE_READ_FAILED     = 'STOR_002'
  STORAGE_FILE_TOO_LARGE  = 'STOR_003'
  STORAGE_CORRUPTED_FILE  = 'STOR_004'

  // DB
  DB_WRITE_FAILED         = 'DB_001'
  DB_READ_FAILED          = 'DB_002'
  DB_DUPLICATE            = 'DB_003'
  DB_RLS_BLOCKED          = 'DB_004'
  DB_CONSTRAINT_VIOLATION = 'DB_005'

  // Auth
  AUTH_TOKEN_EXPIRED      = 'AUTH_001'
  AUTH_GMAIL_REVOKED      = 'AUTH_003'
  AUTH_INSUFFICIENT_SCOPE = 'AUTH_004'

  // Email
  EMAIL_SYNC_FAILED       = 'EMAIL_001'
  EMAIL_RATE_LIMIT        = 'EMAIL_002'

  // Validation
  VALIDATION_INVALID_KVK  = 'VAL_001'
  VALIDATION_INVALID_BTW  = 'VAL_002'
  VALIDATION_INVALID_IBAN = 'VAL_003'
}

enum ErrorSeverity {
  CRITICAL = 'critical' // يوقف العمل → alert فوري
  HIGH     = 'high'     // يؤثر على user → alert < دقيقة
  MEDIUM   = 'medium'   // يؤثر على feature → daily report
  LOW      = 'low'      // تحسين مطلوب → log فقط
}
```

---

### Error Logger

```typescript
// src/lib/error-logger.ts
// Singleton — يُستخدم في كل مكان

import { errorLogger, logError } from '@/lib/error-logger'

// الاستخدام:
await logError(error, {
  code: ErrorCode.AI_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  userId: 'user-id',
  documentId: 'doc-id',
  extra: { operationName: 'classifyDocument' }
})
```

---

### Safe Wrappers — إلزامية في كل مكان

```typescript
// src/lib/safe.ts

// ١. AI Call
const result = await safeAICall(
  () => classifyDocument(content, fileName),
  { type: 'unknown', confidence: 0 }, // fallback
  { timeoutMs: 30000, userId, documentId }
)

// ٢. DB Write
const data = await safeDBWrite(
  () => supabase.from('documents').update({...}).eq('id', id),
  { userId, documentId, operationName: 'save classification' }
)

// ٣. Pipeline Stage
const result = await safePipelineStage(
  'classify',
  () => runClassification(),
  fallbackValue,
  { userId, documentId }
)

// ٤. File Operation
const file = await safeFileOperation(
  () => supabase.storage.from('documents').download(path),
  { userId, fileName, operationName: 'download for AI' }
)
```

---

### error_logs Table

```sql
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN (
    'critical', 'high', 'medium', 'low'
  )),
  message text NOT NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  context jsonb,
  stack_trace text,
  environment text DEFAULT 'production',
  app_version text,
  resolved boolean DEFAULT false,
  resolved_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX idx_error_logs_severity
  ON public.error_logs(severity, created_at DESC)
  WHERE resolved = false;

CREATE INDEX idx_error_logs_code
  ON public.error_logs(error_code, created_at DESC);
```

---

### Health Check

```
GET /api/health

Response:
{
  database: true/false,
  storage: true/false,
  ai: true/false,
  queue_depth: 0,
  recent_errors: 0,  // critical + high في آخر ساعة
  timestamp: "..."
}

Status 200 = healthy
Status 503 = unhealthy
```

---

### جدول الأخطاء حسب الخطورة

| الخطأ | الخطورة | الحماية |
|-------|---------|---------|
| AI Hallucination | 🔴 عالية | Validation بعد كل extraction |
| Race condition | 🔴 عالية | `claim_document_for_processing()` atomic |
| Token expired | 🟡 متوسطة | Auto-refresh + notify العميل |
| AI Timeout | 🟡 متوسطة | `safeAICall` + 30s timeout + fallback |
| RLS Block | 🟡 متوسطة | `safeDBWrite` + كشف PGRST301 |
| Pipeline يتجمد | 🟡 متوسطة | `release_stuck_documents` cron |
| Corrupted file | 🟢 منخفضة | File signature check قبل processing |
| Offline upload | 🟢 منخفضة | Retry 3 مرات + رسالة واضحة |

---

### Environment Variables المطلوبة

```env
SUPABASE_SERVICE_ROLE_KEY=...      # للـ Pipeline فقط
SLACK_ERROR_WEBHOOK=https://...    # للـ alerts
ADMIN_SECRET_KEY=...               # للـ error dashboard
NEXT_PUBLIC_APP_VERSION=1.2.0
```

---

## ملخص — الملفات المطلوب إنشاؤها

```
src/lib/
├── errors.ts          ← Error classes + codes
├── error-logger.ts    ← Logger singleton
├── safe.ts            ← Safe wrappers (AI, DB, File)
├── pipeline.ts        ← Pipeline orchestrator
├── supabase-pipeline.ts ← service_role client
└── validations.ts     ← KVK, BTW, IBAN, amounts

src/app/api/
├── health/route.ts    ← Health check
└── admin/errors/route.ts ← Error dashboard
```

---

## Golden Rules — لا تُكسر أبداً

```
١. كل AI call → safeAICall (timeout + fallback)
٢. كل DB write → safeDBWrite (error detection)
٣. كل Pipeline stage → safePipelineStage (isolation)
٤. Pipeline دائماً → service_role client
٥. User requests دائماً → server client (مع RLS)
٦. لا null يذهب للـ DB → validation قبل كل insert
٧. لا duplicate → content_hash check أولاً
٨. لا silent failure → كل خطأ يُسجَّل
٩. لا infinite hang → timeout على كل عملية
١٠. لا data loss → soft delete فقط، لا hard delete
```

---

*BoekBrug AI Pipeline Architecture — May 2026*
*قرار معماري — لا يُعدَّل إلا بقرار واعٍ*






