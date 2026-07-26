# BoekBrug — أدوات أصحاب العمل الأكثر استخداماً: ماذا نحتاج؟

*تقرير بحثي — يوليو 2026*
*منهجية: بحث السوق أونلاين (منافسون + مقارنات ZZP هولندية 2026) + جرد كامل لكود التطبيق الحالي*

> **الخلاصة في سطر:** BoekBrug يغطي بالفعل معظم "الأساسيات" (فوترة، بنك، بونات AI، BTW، كاش، جسر المحاسب) — بل يتفوق في مسح المستندات بالذكاء الاصطناعي. الفجوات الحقيقية الأكثر طلباً من أصحاب الأعمال هي: **تسجيل الساعات (urenregistratie)**، **تسجيل الكيلومترات داخل التطبيق**، **التذكيرات الآلية للفواتير غير المدفوعة (aanmaningen)**، **الفواتير المتكررة**، و**الدفع الحقيقي (iDEAL/Tikkie) + الربط البنكي المباشر (PSD2)**.

---

## 1. ما هي "عُدّة الأدوات القياسية" التي يتوقعها كل صاحب عمل؟

من مقارنة المنافسين الأكثر استخداماً بين ZZP في هولندا (Moneybird, MoneyMonk, e-Boekhouden, jortt, Informer, Rompslomp)، هذه هي الأدوات التي يعتبرها السوق "يجب أن تكون موجودة":

| # | الأداة | لماذا هي أساسية | مدفوعة عادةً؟ |
|---|--------|------------------|----------------|
| 1 | **Factureren** (فوترة احترافية بالهوية) | جوهر أي برنامج | ✅ الأساس |
| 2 | **Offertes** (عروض أسعار → تتحول لفاتورة) | بداية دورة البيع | ✅ |
| 3 | **Terugkerende facturen** (فواتير متكررة/اشتراكات) | يوفر عمل يدوي شهري | ✅ |
| 4 | **Urenregistratie** (تسجيل الساعات + مؤقت) | حاسم لمن يفوتر بالساعة + شرط الـ urencriterium | ✅ (ميزة MoneyMonk القاتلة) |
| 5 | **Kilometer-/rittenregistratie** (سجل الرحلات) | أكبر خصم ضريبي؛ عنوان بداية/نهاية → مسافة تلقائية | ✅ |
| 6 | **Scan & herken bonnetjes** (مسح البونات) | إدخال المصاريف بالصورة | ✅ |
| 7 | **Bankkoppeling PSD2** (ربط بنكي مباشر مباشر) | يجلب المعاملات تلقائياً — يوفر أكبر وقت | ✅✅ (يرفع السعر) |
| 8 | **BTW-aangifte** (إقرار ضريبة القيمة المضافة) | إلزام ربع سنوي | ✅ |
| 9 | **Peppol / UBL e-factuur** (فوترة إلكترونية عبر الشبكة) | B2G إلزامي الآن، B2B قادم (~2030) | ✅ |
| 10 | **Automatische herinneringen / aanmaningen** (تذكيرات آلية) | تحصيل الفواتير المتأخرة تلقائياً | ✅ |
| 11 | **Automatische incasso** (SEPA) + **iDEAL/Tikkie** | دفع فوري → cashflow أسرع | ✅ |
| 12 | **Rapporten / dashboard** (تقارير حية: ربح، cashflow) | رؤية مالية | ✅ |
| 13 | **Mobiele app** | مسح بونة/فاتورة من الهاتف | ✅ |
| 14 | **Automatisering** (كل ما سبق مؤتمت) | أقل عمل إداري | ✅ |

---

## 2. ماذا لدى BoekBrug الآن؟ (جرد فعلي من الكود)

BoekBrug **قوي بالفعل** ويغطي أكثر مما تغطيه معظم البرامج الأساسية:

**✅ موجود ومكتمل:**
- **فوترة كاملة** — إنشاء/إرسال/PDF، ترقيم ذري، بنود قابلة لإعادة الاستخدام (Artikelen)، دفعات جزئية، فواتير دائنة (creditnota) — `src/app/dashboard/invoice/*`
- **مسح المستندات بالـ AI** (بونات + فواتير واردة) — **ميزة تفوّق** عبر Claude — `src/lib/ai.ts`, `/api/intake`
- **جلب الفواتير من البريد تلقائياً** (Gmail/Outlook) — ميزة غير شائعة! — `/api/email/*`
- **البنك: رفع + مطابقة + تصنيف** (CSV/MT940/CAMT) مع مطابقة آلية وذاكرة أطراف — `src/app/dashboard/bank/*`
- **Kas** (دفتر النقدية) + **Dagomzet** (تقارير الكاشير Z) — `src/app/dashboard/kas`, `/dagomzet`
- **Concept BTW-aangifte** + تجميد الربع + كشف suppletie + دعم KOR — `/dashboard/aangifte`
- **تقارير حية**: "Je waarheid" (ربح/BTW لحظي) + "Financieel overzicht" — `/dashboard/waarheid`, `/resultaat`
- **UBL 2.1 export** (فاتورة إلكترونية) — `/api/export/ubl`
- **جسر المحاسب** (دعوة + رسائل + حزمة إقفال + جاهزية) — **ميزة تفوّق أساسية** — `/dashboard/brug`, `/klaar`
- **خزنة الامتثال** (حفظ 7 سنوات bewaarplicht) — `/dashboard/kluis`
- **إشعارات + Push** — `/api/push/*`
- **CRM للعملاء** — `/dashboard/klanten`
- **7 أدوات مجانية عامة** (حاسبة الأجرة، صافي الدخل، BTW، الكيلومترات، كشف بنكي→Excel، مولّد فاتورة، ماسح فاتورة AI) — `src/app/tools`

**⚠️ موجود جزئياً:**
- **Offertes** — نموذج البيانات يدعمه (`invoice_type='offerte'` + رابط التحويل) لكن **لا توجد واجهة إنشاء/إرسال مخصّصة واضحة** لعرض السعر
- **الدفع** — يوجد `betaalverzoek` بـ **QR (SEPA/EPC)** فقط — **ليس** iDEAL/Tikkie/Mollie حقيقي — `src/lib/betaalverzoek.ts`
- **e-factuur** — يوجد **تصدير UBL** لكن **لا إرسال/استقبال عبر شبكة Peppol**

---

## 3. تحليل الفجوات — ماذا نحتاج؟ (مرتّب بالأولوية)

### 🔴 P0 — فجوات عالية الطلب، مفقودة تماماً

| الفجوة | الأثر | الجهد | مدفوعة؟ |
|--------|-------|-------|---------|
| **Urenregistratie (تسجيل الساعات + مؤقت)** | ميزة القرار لدى كل من يفوتر بالساعة (وهم الأغلبية بين ZZP)؛ ضرورية لإثبات الـ urencriterium (1225 ساعة) الذي يفتح zelfstandigenaftrek. المنافس MoneyMonk يكسب بها. لدينا مقال blog عنها لكن **لا أداة**. | متوسط (جدول `time_entries` + شاشة + تحويل ساعات→فاتورة، والبنية تحتية للفوترة موجودة) | ✅ نقطة تسعير |
| **Automatische herinneringen / aanmaningen (تذكير آلي للفواتير المتأخرة)** | حالياً "Vandaag" قائمة **يدوية** فقط. المنافسون يرسلون تذكيراً بعد X يوم تلقائياً (jortt: 3 محاولات ثم iDEAL). يحسّن cashflow مباشرة. | متوسط (لدينا cron + Resend + حالة `overdue` جاهزة — نحتاج محرك جدولة + قوالب) | ✅ |
| **Kilometerregistratie داخل التطبيق (سجل رحلات يُحفظ)** | الحاسبة العامة موجودة لكن **لا يُسجَّل** شيء في الحساب. أكبر خصم يضيع لأنه غير موثّق. MoneyMonk يقدّمها كأساس. | صغير-متوسط (جدول `trips` + شاشة إدخال + تغذية النتيجة/الخصم) | ✅ |

### 🟠 P1 — فجوات مهمة، ترفع القيمة والسعر

| الفجوة | الأثر | الجهد | مدفوعة؟ |
|--------|-------|-------|---------|
| **Terugkerende facturen (فواتير متكررة)** | لأصحاب الاشتراكات/العقود الشهرية — توليد وإرسال تلقائي. معيار سوقي. | متوسط | ✅ |
| **iDEAL / Tikkie / Mollie دفع حقيقي** | الـ QR الحالي أقل احتكاكاً من زر "ادفع الآن". دفع فوري = تحصيل أسرع. Tikkie/Mollie/Buckaroo شائعة. | متوسط-كبير (تكامل مزوّد + webhook تسوية) | ✅✅ |
| **Bankkoppeling PSD2 مباشرة (Tink/Yapily/Salt Edge)** | حالياً رفع ملف يدوي فقط. الربط المباشر أكبر موفّر وقت ويبرر €30-50/شهر (مذكور بالفعل كـ roadmap v2.5). | كبير (aggregator + أمان + reauth) | ✅✅ يرفع السعر |
| **إكمال Offertes كتدفق UI كامل** (عرض سعر → قبول → تحويل لفاتورة) | البنية التحتية موجودة؛ ينقص الواجهة وقبول العميل. دورة بيع كاملة. | صغير-متوسط | ✅ |

### 🟡 P2 — تمايز واستكمال

| الفجوة | الأثر | الجهد |
|--------|-------|-------|
| **Peppol network (إرسال/استقبال e-factuur)** | UBL export موجود؛ Peppol إلزامي B2B قادم (~2030) و B2G الآن. تموضع مبكر. | كبير (Access Point / مزوّد معتمد) |
| **تطبيق موبايل حقيقي / PWA محسّن** (يوجد دليل Android TWA فقط) | المسح من الهاتف أساسي؛ TWA/PWA سريع. | متوسط |
| **حاسبة "belasting reserveren" داخل التطبيق** (كم أدّخر للضريبة) | مذكورة في growth-plan كأداة مجانية جاذبة؛ تربط بالنتيجة الحية. | صغير |
| **Automatische incasso (SEPA machtiging)** | للعملاء المتكررين؛ يكمّل الفواتير المتكررة. | متوسط |
| **Digipoort (تقديم BTW مباشرة للـ Belastingdienst)** | ينقلنا لفئة Exact/Twinfield — لكنه v3.0 (شهادة PKIoverheid، اعتماد Logius). | كبير جداً — لاحقاً |

---

## 4. التوصية التنفيذية

**ابدأ بـ P0 الثلاثة** — فهي الأكثر طلباً، جهدها متوسط، والبنية التحتية (cron، Resend، الفوترة، النتيجة الحية) موجودة بالفعل:

1. **Urenregistratie** — يفتح شريحة "المفوترون بالساعة" بالكامل، وهي الأكبر بين ZZP.
2. **التذكيرات الآلية (aanmaningen)** — تحويل قائمة "Vandaag" اليدوية إلى محرك آلي؛ أثر مباشر على cashflow.
3. **سجل الكيلومترات داخل التطبيق** — الأصغر جهداً، ويحوّل حاسبة موجودة إلى ميزة محفوظة.

هذه الثلاثة تسدّ الفارق الأوضح مقابل MoneyMonk (المنافس الأقرب) وتبرّر خطة **Pro** مدفوعة. بعدها انتقل إلى P1 (الفواتير المتكررة + الدفع الحقيقي + PSD2) الذي يرفع سقف التسعير إلى €30-50/شهر.

**نقاط قوة نحافظ عليها ونسوّق بها:** مسح المستندات بالـ AI، جلب الفواتير من البريد تلقائياً، وجسر المحاسب — هذه الثلاثة **غير شائعة** لدى المنافسين وتميّزنا فعلاً.

---

## 5. المصادر

- [Beste Boekhoudprogramma ZZP 2026 — boekhouder.nl](https://www.boekhouder.nl/beste-boekhoudprogramma-zzp)
- [10 Boekhoudprogramma's voor ZZP (2026) — onderneming.nl](https://www.onderneming.nl/boekhoudprogramma/zzp/)
- [Moneybird vs MoneyMonk — tijdfabryk.nl](https://tijdfabryk.nl/kennisbank/moneybird-of-moneymonk-zzp/)
- [MoneyMonk Peppol — moneymonk.nl](https://www.moneymonk.nl/boekhouden/peppol)
- [Top 10 automatische incasso programma's — jortt.nl](https://www.jortt.nl/beste-boekhoudprogramma/beste-automatische-incasso-programma/)
- [Best invoicing software for self-employed 2026 — tofu.com](https://tofu.com/blog/best-invoicing-software-for-self-employed)
- [E-Invoicing Netherlands 2026 & ViDA roadmap — rtcsuite.com](https://rtcsuite.com/e-invoicing-netherlands/)
- [Netherlands e-invoicing under ViDA — KPMG](https://kpmg.com/us/en/taxnewsflash/news/2026/05/tnf-netherlands-proposed-e-invoicing-and-digital-reporting-framework-under-vida.html)

*جرد التطبيق مبني على قراءة الكود الفعلي في `src/app/dashboard/**`، `src/app/api/**`، `src/lib/**`، و`supabase/migrations/**` (يوليو 2026).*
