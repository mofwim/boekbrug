# BoekBrug — استراتيجية Navigation الموحّدة
*Parent-Child Pattern — قاعدة واحدة لكل التطبيق*
*May 2026*

---

## المشكلة الحالية

كل صفحة بنت زر "رجوع" بطريقتها الخاصة:
- بعضها يستخدم `router.back()` — متغيّر حسب الـ history
- بعضها يستخدم `router.push()` — يضيف صفحات للـ history
- بعضها يستخدم `<Link>` صحيح — يعمل
- بعضها لا يحتوي زر رجوع أصلاً

النتيجة: loops، صفحات ضائعة، تجربة محبطة.

---

## القاعدة الذهبية

> **كل صفحة لها parent واحد محدد.**
> **زر "رجوع" يذهب للـ parent — لا للـ history.**
> **اللوجو يذهب للصفحة الرئيسية حسب الدور.**

---

## شجرة Navigation الكاملة

### مسار ZZP

```
/dashboard (ZzpDashboard)
│
├── /dashboard/invoice/new          → parent: /dashboard
│
├── /dashboard/facturen             → parent: /dashboard
│   └── /dashboard/invoice/[id]     → parent: /dashboard/facturen
│       └── /dashboard/invoice/[id]/edit  → parent: /dashboard/invoice/[id]
│
├── /dashboard/klanten              → parent: /dashboard
│
├── /dashboard/incoming             → parent: /dashboard
│
├── /dashboard/bestanden            → parent: /dashboard
│
├── /dashboard/quarterly            → parent: /dashboard
│
└── /dashboard/settings             → parent: /dashboard
```

### مسار المحاسب

```
/dashboard/accountant (AccountantHome)
│
├── /dashboard/accountant/werkplek         → parent: /dashboard/accountant
│
├── /dashboard/clients/beheer              → parent: /dashboard/accountant
│
├── /dashboard/clients/[id]                → parent: /dashboard/accountant
│   ├── /dashboard/clients/[id]/kwartaal   → parent: /dashboard/clients/[id]
│   └── /dashboard/invoice/new?clientId=[id]  → parent: /dashboard/clients/[id]
│
├── /dashboard/bestanden                   → parent: /dashboard/accountant
│
├── /dashboard/facturen                    → parent: /dashboard/accountant
│
└── /dashboard/settings                    → parent: /dashboard/accountant
```

---

## القواعد التقنية — Implementation

### القاعدة ١ — Logo دائماً يذهب للـ Home

كل `DashboardHeader` (و أي header مخصص):

```tsx
<Link href={isAccountant ? "/dashboard/accountant" : "/dashboard"}>
  <span className="logo">BoekBrug</span>
</Link>
```

النقر على Logo = ضمانة العودة للصفحة الرئيسية من أي مكان.

### القاعدة ٢ — زر "رجوع" يستخدم `<Link>` لا `router.back()`

```tsx
// ✅ صحيح
<Link href="/dashboard/facturen">
  <ArrowLeft /> Terug
</Link>

// ❌ خاطئ — يسبب loops
<button onClick={() => router.back()}>
  Terug
</button>

// ❌ خاطئ — يضيف في history
<button onClick={() => router.push('/dashboard/facturen')}>
  Terug
</button>
```

### القاعدة ٣ — Navigation بعد action تستخدم `router.replace()`

عند حفظ/إرسال/حذف، الانتقال يستخدم `replace` لا `push`:

```tsx
// ✅ صحيح — يستبدل الصفحة الحالية في history
await saveInvoice()
router.replace('/dashboard/invoice/' + id)

// ❌ خاطئ — يضيف، فالـ Back يرجع للصفحة قبل الحفظ
router.push('/dashboard/invoice/' + id)
```

السبب: بعد الحفظ، المستخدم لا يريد "الرجوع" لصفحة التعديل التي حفظ منها — يريد الرجوع لما قبلها.

### القاعدة ٤ — `<Link>` دائماً عبر next/link

```tsx
// ✅
import Link from 'next/link'
<Link href="/path">...</Link>

// ❌ — لا prefetch، لا soft navigation
<a href="/path">...</a>
```

---

## Helper Function — للموحدة

أنشئ `src/lib/navigation.ts`:

```typescript
// BoekBrug — Unified navigation parents
// كل صفحة لها parent — حدّد هنا، استخدم في كل مكان

export function getParentPath(
  currentPath: string,
  role: 'zzper' | 'accountant'
): string {
  // Home لكل دور
  const home = role === 'accountant' ? '/dashboard/accountant' : '/dashboard'

  // مسارات invoice
  if (/^\/dashboard\/invoice\/[^/]+\/edit$/.test(currentPath)) {
    const id = currentPath.split('/')[3]
    return `/dashboard/invoice/${id}`
  }
  if (/^\/dashboard\/invoice\/[^/]+$/.test(currentPath)) {
    return role === 'accountant' ? home : '/dashboard/facturen'
  }
  if (currentPath === '/dashboard/invoice/new') {
    return role === 'accountant' ? home : '/dashboard/facturen'
  }

  // مسارات clients (المحاسب)
  if (/^\/dashboard\/clients\/[^/]+\/kwartaal$/.test(currentPath)) {
    const id = currentPath.split('/')[3]
    return `/dashboard/clients/${id}`
  }
  if (/^\/dashboard\/clients\/[^/]+$/.test(currentPath)) {
    return home
  }
  if (currentPath === '/dashboard/clients/beheer') {
    return home
  }

  // باقي المسارات → home
  return home
}
```

استخدامه:

```tsx
import { getParentPath } from '@/lib/navigation'

const pathname = usePathname()
const parent = getParentPath(pathname, profile.role)

<Link href={parent}>← Terug</Link>
```

ميزة هذا: **كل قرار navigation في ملف واحد**. تغيير parent لأي صفحة = سطر واحد.

---

## استثناءات مقصودة

### استثناء ١ — صفحات Modal/Dialog

إذا فُتحت صفحة كـ dialog فوق صفحة أخرى (نادر في Next.js)، زر "إغلاق" يستخدم `router.back()` لأنها فعلاً overlay.

### استثناء ٢ — Onboarding Wizard

الـ wizard متعدد الخطوات — `Volgende/Vorige` تتنقل بين steps داخل نفس الصفحة، لا بين URLs. لا تنطبق عليها هذه القواعد.

### استثناء ٣ — Forms مع تأكيد قبل المغادرة

إذا المستخدم في form بدون حفظ، عند الضغط على "رجوع" أو Logo — يظهر confirmation:
```
"Je hebt niet-opgeslagen wijzigingen.
 Weet je zeker dat je wilt vertrekken?"
[Annuleren]  [Vertrekken]
```

هذا يُبنى مع كل form منفصلاً — ليس مسؤولية navigation strategy.

---

## خريطة التطبيق — كل ملف يحتاج تعديل

### الأولوية ١ — يكسر الـ Loop الحالي

| ملف | المالك | التغيير المطلوب |
|------|--------|------------------|
| `src/app/dashboard/invoice/[id]/page.tsx` | BOEK-031 | زر Terug = `<Link href="/dashboard/facturen">` |
| `src/app/dashboard/invoice/[id]/edit/page.tsx` | BOEK-031 | زر Terug = `<Link href="/dashboard/invoice/[id]">` + Save يستخدم `router.replace()` |

### الأولوية ٢ — مشاكل محتملة

| ملف | المالك | التغيير المطلوب |
|------|--------|------------------|
| `src/app/dashboard/invoice/new/page.tsx` | BOEK-031 | Save → `router.replace('/dashboard/invoice/[id]')` |
| `src/app/dashboard/clients/[id]/kwartaal/page.tsx` | BOEK-028 | زر Terug = `<Link href="/dashboard/clients/[id]">` |
| `src/app/dashboard/clients/[id]/page.tsx` | BOEK-028 | زر Terug = `<Link href="/dashboard/accountant">` |
| `src/app/dashboard/clients/beheer/page.tsx` | BOEK-028 | زر Terug = `<Link href="/dashboard/accountant">` |

### الأولوية ٣ — Logo Universal

| ملف | المالك | التغيير المطلوب |
|------|--------|------------------|
| `src/app/dashboard/_shared/index.tsx` | INTEGRATION | Logo = `<Link>` ديناميكي حسب الدور |

### الأولوية ٤ — Headers خاصة

| صفحة | لها header خاص؟ | يجب أن تستخدم DashboardHeader |
|------|------------------|--------------------------------|
| `/dashboard/bestanden` | نعم (BOEK-033) | يبقى — يحتاج logo في header الخاص |
| `/dashboard/incoming` | ربما (BOEK-011) | يبقى — يحتاج logo في header الخاص |

---

## خطة التنفيذ — مرحلتان

### المرحلة ١ — كسر الـ Loop (عاجل)

محادثة BOEK-031 تنفذ:
1. تصحيح `/invoice/[id]/page.tsx`
2. تصحيح `/invoice/[id]/edit/page.tsx`
3. تصحيح `/invoice/new/page.tsx`

**يكسر الـ loop في يومين.**

### المرحلة ٢ — تعميم الاستراتيجية

محادثة جديدة `NAVIGATION-STRATEGY`:
1. تنشئ `src/lib/navigation.ts` (helper function)
2. تطبّقها على كل صفحة في الخريطة أعلاه
3. تنسّق مع BOEK-028 و INTEGRATION للتعديلات في ملكيتهما

**أسبوع لكل التطبيق.**

---

## القاعدة النهائية — لكل المحادثات المستقبلية

> **عند بناء أي صفحة جديدة:**
> 1. حدّد parent الصفحة في `src/lib/navigation.ts`
> 2. استخدم `<Link href={parent}>` لزر الرجوع
> 3. استخدم `router.replace()` بعد actions (save, send, delete)
> 4. لا تستخدم `router.back()` أبداً

---

*BoekBrug Navigation Strategy — May 2026*
*قاعدة واحدة. تطبيق متماسك. لا loops.*
