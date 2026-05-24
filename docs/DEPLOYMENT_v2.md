# BOEK-SECURITY-2 Deployment — v2

## التغييرات في v2

| ملف | تغيير |
|------|-------|
| `1_rate_limit_and_audit_v2.sql` | + DROP "System can insert logs" policy |
| `audit.ts` | + `invoice.duplicated` + `creditnota.created` actions |
| `rate-limit.ts` | لا تغيير |
| `sanitize.ts` | لا تغيير |

## التسلسل (مهم — لا تخالف)

### الخطوة ١ — Supabase Migration

افتح Supabase SQL Editor، شغّل `1_rate_limit_and_audit_v2.sql` بالكامل.

**Expected output:**
- `CREATE TABLE` ✓
- `CREATE INDEX` ×2 ✓
- `ALTER TABLE ... ENABLE RLS` ✓
- `CREATE POLICY rate_limits_select_own` ✓
- `CREATE FUNCTION check_rate_limit` ✓
- `GRANT/REVOKE` ✓
- `CREATE FUNCTION cleanup_old_rate_limits` ✓
- `GRANT/REVOKE` ✓
- `DROP POLICY "System can insert logs"` ✓
- التحقّقات النهائية (٤ queries) ✓

تحقّق من النتائج:
- Check 1: `rate_limits` و `audit_logs` → rls_enabled = TRUE
- Check 2: فقط `Users see own logs` (الـ "System can insert logs" حُذفت)
- Check 3: `check_rate_limit` و `cleanup_old_rate_limits` موجودان
- Check 4: `rate_limit_rows = 0`

### الخطوة ٢ — أضف الـ ٣ helpers للـ repo

ضع الـ ٣ ملفات في:
```
src/lib/audit.ts
src/lib/rate-limit.ts
src/lib/sanitize.ts
```

⚠️ **لا تطبّقها على أي endpoint بعد.** فقط add files + commit + push.

```bash
git add src/lib/audit.ts src/lib/rate-limit.ts src/lib/sanitize.ts
git commit -m "feat(BOEK-SECURITY-2): add rate-limit + audit + sanitize helpers"
git push
```

Vercel deploy تلقائي. تأكّد:
- Build ينجح
- No errors في Vercel logs

### الخطوة ٣ — اختبار صامت (قبل BOEK-031)

بعد الـ deploy، حاول:
1. تعديل فاتورة من التطبيق
2. تحقّق من audit_logs:
   ```sql
   SELECT COUNT(*) FROM audit_logs 
   WHERE action = 'invoice.updated' 
     AND created_at > now() - interval '5 minutes';
   ```

**Expected:** `count = 0` — الـ user client يفشل بـ 403 الآن (silent failure).

هذا التأكيد العملي أن DROP policy عملت.

### الخطوة ٤ — أعطِ signal لـ BOEK-031

أرسل لـ BOEK-031:

```
[BOEK-SECURITY-2] Deployed ✓

Migration applied:
  ✓ rate_limits table created
  ✓ check_rate_limit function created
  ✓ audit_logs "System can insert logs" policy dropped

Helpers added to repo:
  ✓ src/lib/audit.ts
  ✓ src/lib/rate-limit.ts
  ✓ src/lib/sanitize.ts

Tested: invoice.update فشل في تسجيل audit_logs (silent — كما متوقّع)

أنت الآن مفوّض لتنفيذ الـ refactor للـ ٤ ملفات:
  - src/app/api/invoice/[id]/route.ts (PUT + DELETE)
  - src/app/api/invoice/[id]/duplicate/route.ts
  - src/app/api/invoice/creditnota/route.ts

استبدل audit_logs.insert(...) بـ logAuditAction({...}).

Reminders من Tech Lead:
  - entityType = 'invoice' singular (للاتساق مع historical data)
  - JSON.stringify('{...}') bug في DELETE → استخدم object مباشر
  - أضف ipAddress: getClientIP(request) لكل call
  - اقرأ before-values قبل update لتسجيل oldValue
```

### الخطوة ٥ — انتظر BOEK-031 ينشر

بعد deploy، اختبر مرة أخرى:
1. تعديل فاتورة
2. تحقّق:
   ```sql
   SELECT * FROM audit_logs 
   WHERE action = 'invoice.updated' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

**Expected:** row جديد بـ:
- `action = 'invoice.updated'`
- `entity_type = 'invoice'`
- `entity_id = <invoice id>`
- `ip_address` ممتلئ
- `old_value` ممتلئ
- `new_value` ممتلئ

### الخطوة ٦ — تطبيق Rate Limiting (لاحقاً)

بعد BOEK-031 ينتهي، طبّق rate limit على:
- `/api/email/sync` → 10/5min (BOEK-011 territory — مهمة لاحقة)
- `/api/bestanden/classify` → 50/hour (BOEK-033 territory)
- `/api/accountant/invite` → 20/day (BOEK-028 territory)

كل واحدة في محادثتها.

### الخطوة ٧ — تطبيق Search Escape (لاحقاً)

ابحث في الكود:
```powershell
Select-String -Path "src\**\*.ts" -Pattern "ilike\(.*\$\{" -List
```

أي مكان user input يدخل ilike → استخدم `escapeSearchTerm`.

مالكي BOEK-012 و BOEK-033 يطبّقان.

---

## ملاحظات أخيرة

### لو DROP policy فشل
السبب المحتمل: لا توجد policy بهذا الاسم. شغّل:
```sql
SELECT polname FROM pg_policy 
WHERE polrelid = 'public.audit_logs'::regclass;
```
لو الاسم مختلف → عدّل الـ migration.

### لو check_rate_limit موجودة من قبل
الـ `CREATE OR REPLACE FUNCTION` يستبدلها تلقائياً. آمن.

### لو rate_limits موجود من قبل
الـ `CREATE TABLE IF NOT EXISTS` يتخطّى. آمن.

---

*BOEK-SECURITY-2 v2 — Tech Lead approved — May 2026*
