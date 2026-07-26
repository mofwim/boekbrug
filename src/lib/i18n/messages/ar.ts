// src/lib/i18n/messages/ar.ts
// [I18N] Arabic catalog (RTL). Deep-partial of the Dutch source; missing keys
// fall back to Dutch.

import type { PartialMessages } from './types'

export const ar: PartialMessages = {
  common: {
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    search: 'بحث',
    back: 'رجوع',
    next: 'التالي',
    close: 'إغلاق',
    confirm: 'تأكيد',
    loading: 'جارٍ التحميل…',
    yes: 'نعم',
    no: 'لا',
    download: 'تنزيل',
    export: 'تصدير',
    required: 'مطلوب',
    saved: 'تم الحفظ',
    somethingWrong: 'حدث خطأ ما',
  },
  nav: {
    today: 'اليوم',
    invoices: 'الفواتير',
    clients: 'العملاء',
    bank: 'البنك',
    cash: 'الكاس',
    files: 'الملفات',
    result: 'النتيجة',
    settings: 'الإعدادات',
    incoming: 'الفواتير الواردة',
    quarter: 'ملخّص الربع',
    messages: 'الرسائل',
  },
  invoiceStatus: {
    concept: 'مسودّة',
    sent: 'مُرسَلة',
    paid: 'مدفوعة',
    overdue: 'متأخّرة',
  },
  greeting: {
    hello: 'مرحباً {name}',
  },
}
