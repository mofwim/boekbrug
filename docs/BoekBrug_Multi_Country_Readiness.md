# BoekBrug — Multi-Country Readiness
*مرجع للمستقبل — قرارات اليوم التي تفتح أبواب الغد*
*May 2026*

---

## المبدأ

> **تطبيق ممتاز في هولندا = أساس قوي للعالم.**
> **تطبيق متوسط في ٥ بلدان = فشل في الجميع.**

هذه الوثيقة **ليست خطة توسع**. هي قائمة قرارات صغيرة نتخذها اليوم — بتكلفة قليلة جداً — لكنها توفّر شهور عمل عندما نقرّر التوسع فعلياً.

**القاعدة:** لا نبني للمستقبل. نتجنّب فقط ما يصعب إصلاحه لاحقاً.

---

## التوقيت — متى نفكر فعلاً في multi-country

```
المرحلة الحالية (٠ عميل):           هولندا فقط — لا تفكير في غيرها
أول ١٠٠ عميل هولندي:                 هولندا فقط
١٠٠ - ١٠٠٠ عميل هولندي:              يجوز دراسة البلد التالي نظرياً
١٠٠٠+ عميل، عميل واحد فعلي من بلد آخر:  ابدأ البناء — مع عميل حقيقي
```

السبب: التوسع بلا عملاء = تخمين. التوسع مع عميل واحد فعلي = تعلّم.

---

## القرارات الخمسة — تنفّذ تدريجياً

### القرار ١ — `src/lib/locale.ts` كمصدر واحد للثوابت 🟢

**الجهد:** ساعة واحدة — مع أول refactor كبير

**اليوم — الكود مبعثر:**

```typescript
// في invoice/new
const btwRate = 0.21

// في quarterly.ts
const dateFormat = 'nl-NL'

// في export.ts
const currency = '€'
```

**الحل — ملف واحد:**

```typescript
// src/lib/locale.ts

export const DEFAULT_COUNTRY = 'NL'

export const COUNTRY_CONFIG = {
  NL: {
    code: 'NL',
    name: 'Nederland',
    vat_rates: [0, 9, 21],
    standard_vat: 21,
    currency: 'EUR',
    currency_symbol: '€',
    date_locale: 'nl-NL',
    number_locale: 'nl-NL',
    business_id_label: 'KVK',
    vat_id_label: 'BTW-nummer',
    vat_id_pattern: /^NL\d{9}B\d{2}$/,
    business_id_pattern: /^\d{8}$/,
    tax_authority: 'Belastingdienst',
    retention_years: 7,
  },
  // مستقبلاً — لا تضف الآن:
  // BE: { ... }
  // DE: { ... }
} as const

export type CountryCode = keyof typeof COUNTRY_CONFIG

export const ACTIVE_COUNTRY = COUNTRY_CONFIG.NL // ثابت الآن
```

**استخدامه:**

```typescript
import { ACTIVE_COUNTRY } from '@/lib/locale'

// بدل: const btwRate = 0.21
const btwRate = ACTIVE_COUNTRY.standard_vat / 100

// بدل: 'KVK nummer'
<label>{ACTIVE_COUNTRY.business_id_label} nummer</label>

// بدل: /^\d{8}$/
const kvkValid = ACTIVE_COUNTRY.business_id_pattern.test(value)
```

**الفائدة:** يوم نضيف بلداً = تعديل ملف واحد، لا ٤٠٠.

---

### القرار ٢ — `country_code` على الجداول الأساسية 🟢

**الجهد:** ١٠ دقائق — migration بسيط

**الجداول المعنية:**

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS country_code text DEFAULT 'NL';

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS country_code text DEFAULT 'NL';

-- اختياري — لكن مفيد:
ALTER TABLE accountant_clients
  ADD COLUMN IF NOT EXISTS country_code text DEFAULT 'NL';
```

**لماذا الآن:**

تكلفته الآن: صفر — جدول صغير، migration ثوانٍ.
تكلفته بعد ١٠٠٠ مستخدم: migration على جدول حي = خطر قفل، خطر تطبيق متوقف، خطر بيانات تالفة.

**ملاحظة قانونية:**

كل سجل مالي يحفظ بلده. لو مستخدم انتقل من NL إلى BE لاحقاً — الفواتير القديمة تبقى `country_code = 'NL'` لأنها صدرت في هولندا. هذا صحيح قانونياً.

---

### القرار ٣ — i18n Setup (بـ NL فقط الآن) 🟡

**الجهد:** يومان — قبل أول عميل (BOEK-022)

**اليوم — النصوص مبعثرة في الكود:**

```tsx
<h1>Mijn facturen</h1>
<button>Versturen</button>
<p>Bedankt voor je betaling</p>
```

**الحل — i18n من اليوم، حتى لو هولندي فقط:**

```bash
npm install next-intl
```

```typescript
// src/locales/nl.json
{
  "invoices": {
    "title": "Mijn facturen",
    "send": "Versturen",
    "thanks_payment": "Bedankt voor je betaling"
  }
}

// في الـ component:
import { useTranslations } from 'next-intl'

const t = useTranslations('invoices')
<h1>{t('title')}</h1>
<button>{t('send')}</button>
```

**الفائدة:**

- إضافة لغة جديدة = ملف JSON واحد (٥ دقائق)
- لا "بحث-استبدل" عبر ٤٠٠ ملف
- المترجم يعمل على JSON، لا على الكود
- المستخدم في profile يختار اللغة → التطبيق يتبع

**اللغات المخطّطة (من Master document):** Nederlands, English, العربية, Türkçe

**RTL للعربية:** `next-intl` يدعمها بـ `dir="rtl"` تلقائياً. تكلفة CSS بسيطة في layout.

**لا تترجم الآن:**

ابنِ بنية الـ i18n، املأها بـ NL فقط. ترجمة عربية/تركية الآن = شهر عمل بدون أي عميل. اتركها للّحظة التي عميل حقيقي يطلبها.

---

### القرار ٤ — `tax_rules` Table بدل Hard-code 🟡

**الجهد:** يومان — عند بناء BOEK-019 (Validation APIs) أو BOEK-018 (AI Layer Unified)

**اليوم — الكود في خطر:**

```typescript
// kabous مستقبلي:
if (country === 'NL' && product === 'food') return 0.09
if (country === 'NL' && product === 'service') return 0.21
if (country === 'NL' && product === 'medical') return 0.09
if (country === 'BE' && product === 'food') return 0.06
// ... ١٠٠ سطر سيتراكم
```

**الحل — Rules Engine في DB:**

```sql
CREATE TABLE public.tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  category text NOT NULL,
  vat_rate numeric NOT NULL,
  description text,
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamp DEFAULT now()
);

-- ملء أولي لهولندا:
INSERT INTO tax_rules (country_code, category, vat_rate, valid_from) VALUES
  ('NL', 'standard',  21, '2019-01-01'),
  ('NL', 'reduced',    9, '2019-01-01'),
  ('NL', 'zero',       0, '2019-01-01'),
  ('NL', 'food',       9, '2019-01-01'),
  ('NL', 'medical',    9, '2019-01-01'),
  ('NL', 'service',   21, '2019-01-01');
```

**الاستخدام:**

```typescript
async function getVatRate(
  country: string,
  category: string,
  date: string
): Promise<number> {
  const { data } = await supabase
    .from('tax_rules')
    .select('vat_rate')
    .eq('country_code', country)
    .eq('category', category)
    .lte('valid_from', date)
    .or(`valid_to.is.null,valid_to.gte.${date}`)
    .single()

  return data?.vat_rate ?? 21 // fallback
}
```

**الفائدة:**

- تغيير قانون ضريبي = INSERT صف، لا deploy جديد
- نسخة تاريخية محفوظة — لو تغيّر BTW من 21 إلى 22 يوماً ما، الفواتير القديمة تستخدم 21 (`valid_from/valid_to`)
- بلد جديد = INSERT صفوف، لا تعديل كود
- المحاسب القانوني يعدّل القواعد بدون مبرمج

**متى نبنيها فعلياً:** عند BOEK-019. ليس الآن.

---

### القرار ٥ — استخدم `Intl` (تفعله بالفعل ✅) 🟢

**الجهد:** صفر — أنت تفعل هذا أصلاً

```typescript
// Master document v4.0 يحدد هذا بوضوح:
const NL_NUMBER = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR'
})

const NL_DATE = new Intl.DateTimeFormat('nl-NL')
```

**مستقبلاً — استبدال بسيط:**

```typescript
// عند multi-country:
const formatNumber = (value: number, profile: Profile) =>
  new Intl.NumberFormat(profile.locale, {
    style: 'currency',
    currency: profile.currency
  }).format(value)
```

`Intl` مكتبة مبنية في JavaScript — تدعم كل اللغات والعملات والتواريخ بدون مكتبات إضافية. ✅

**ملاحظة:** أبقِ output Dutch دائماً — كما هو في Master document:

> "كل فاتورة تُرسل لعميل: هولندية فقط."

هذا قرار تجاري، لا تقني. واجهة المستخدم تتغير حسب اللغة. مخرجات الفاتورة لا تتغير.

---

## ما لا نفعله — تجنّب هذه الأفخاخ

### ❌ Multi-currency في DB من الآن

لا تضف `currency_code` على كل جدول. كل شيء EUR حالياً. أضف العمود **يوم تحتاجه فعلاً** — Postgres يسمح بـ `ADD COLUMN ... DEFAULT 'EUR'` بدون قفل الجدول.

### ❌ Translations لكل لغة الآن

ابنِ بنية i18n (قرار ٣)، لكن لا تترجم. ترجمة العربية والتركية والإنجليزية الآن = شهر عمل بصفر عميل. اللحظة الصحيحة: عميل حقيقي يطلبها.

### ❌ Compliance لكل بلد الآن

- GDPR = أوروبا كاملة ✓ (مطلوب الآن لهولندا)
- Bewaarplicht 7 سنوات = هولندا فقط
- Mehrwertsteuer = ألمانيا
- Peppol = بلجيكا و EU e-invoicing

بناء كل هذا الآن = ٣ أشهر بدون نتيجة. ابنِ هولندا فقط.

### ❌ "بلجيكا قريبة جداً، فلنبنِها معاً"

فخّ كلاسيكي. بلجيكا تبدو مشابهة (هولندية، يورو، EU) — لكن:
- نظام BTW مختلف
- KBO بدل KVK
- نظام محاسبين مختلف
- e-invoicing قياسي مختلف (Peppol)

**لا تبني أي شيء "ليكون جاهزاً لبلجيكا".** ركّز ١٠٠٪ على هولندا.

### ❌ Multi-tenant architecture

لا نحتاج `tenant_id` على كل جدول. كل user عنده `country_code` يكفي. multi-tenant نمط معماري معقّد يفيد فقط شركات ضخمة (SAP, Salesforce). نحن لسنا هناك.

### ❌ Microservices لـ "scale"

NestJS + Kafka + Kubernetes كانت اقتراحات سابقة رفضناها. Next.js + Supabase يخدم آلاف العملاء بسهولة. التوسع الجغرافي ≠ التوسع المعماري.

---

## ترتيب التنفيذ — جدول زمني واقعي

| الأولوية | المهمة | متى | المالك المقترح |
|---------|--------|-----|-----------------|
| 🟢 الآن | `src/lib/locale.ts` constants | مع أول refactor مناسب | محادثة منفصلة BOEK-LOCALE |
| 🟢 الآن | `country_code` على profiles + invoices | الأسبوع القادم | محادثة DB |
| 🟢 محفوظة | استخدام Intl (موجود) | ✅ تم | - |
| 🟡 قريباً | i18n setup بـ NL فقط | قبل أول عميل (BOEK-022) | محادثة BOEK-022 |
| 🟡 لاحقاً | tax_rules table | عند BOEK-019 | محادثة BOEK-019 |
| 🔵 مؤجل | Multi-currency في DB | عند عميل غير-EUR فعلي | - |
| 🔵 مؤجل | Translations للعربية/التركية/الإنجليزية | عند عميل حقيقي يطلب | - |
| 🔵 مؤجل | Belgium/Germany expansion | بعد ١٠٠٠ عميل هولندي | - |

---

## الخلاصة

```
نبني هولندا ممتازة — ممتازة جداً.
نتجنّب القرارات الصعبة العكس مستقبلاً (٥ قرارات صغيرة).
لا نهدر وقتاً على بلدان لا عميل فيها.

عندما يأتي عميل من بلد آخر — نبني مع عميل حقيقي.
ليس قبل ذلك.
```

---

## القرار النهائي

**لا تغيير في الأولويات الحالية.**

استمر في:
- BOEK-011 إصلاحات
- BOEK-031 navigation loop
- INTEGRATION RLS Phase 2
- BOEK-028 المراحل القادمة

عندما تأتي لحظة طبيعية (refactor، migration، أو ميزة جديدة) — طبّق ما يناسبها من القرارات أعلاه. لا تعمل deploy خاص لها.

---

*BoekBrug Multi-Country Readiness — May 2026*
*خمسة قرارات صغيرة. شهور عمل موفّرة. تطبيق جاهز للعالم — حين يأتي العالم.*
