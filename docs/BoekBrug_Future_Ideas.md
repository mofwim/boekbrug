# BoekBrug — أفكار مستقبلية
*ليس بناء، فقط تسجيل لما يأتي لاحقاً*

## مرحلة v2.0+

### Sticky Notes للمحاسب
ملاحظات عائمة تظل مع المحاسب في كل صفحات التطبيق.
مفيدة للتذكير السريع عن العملاء، deadlines، طلبات معلّقة.

**تفاصيل تقنية مناقشة:**
- DB: accountant_notes table
- UI: floating widget في DashboardHeader (accountant only)
- ميزات: pin, color, ربط بعميل
- نموذج مشابه: Windows Sticky Notes / Apple Stickies

**متى:** بعد v1.2 — عند أول محاسب تجريبي يطلبها

---

### طبقة المحادثة — `De Vraag`
تحويل `vraag_text` (سؤال واحد بلا جواب) إلى thread ملتصق بكائن مالي.
الرؤية الكاملة ومسار التطور في ست مراحل: **`docs/BoekBrug_Conversation_Layer_Vision.md`**

---

### [أفكار أخرى تأتي مستقبلاً]

## مرحلة v2.5 (شهر 6-9) — Bank Connections (PSD2)
ربط بنكي مباشر عبر Aggregator (Tink/Yapily/Salt Edge).
يحوّل التطبيق من "tool" إلى "نظام مالي كامل".
يرفع pricing من €15 → €30-50.
prerequisite: BOEK-016 (manual) + 100+ active users.

## مرحلة v3.0 (شهر 12-15) — Digipoort
ربط مباشر مع Belastingdienst.
السبب: ينقل BoekBrug لفئة Exact/Twinfield.
prerequisites: 
- PKIoverheid certificate (€200-400/year)
- Logius certification (1-3 months)
- 50+ active accountants
- €5,000+ MRR
زمن البناء: 3-4 أشهر تطوير + اختبار.