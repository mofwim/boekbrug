// src/lib/i18n/messages/tr.ts
// [I18N] Turkish catalog. Deep-partial of the Dutch source; missing keys fall
// back to Dutch.

import type { PartialMessages } from './types'

export const tr: PartialMessages = {
  common: {
    save: 'Kaydet',
    cancel: 'İptal',
    delete: 'Sil',
    edit: 'Düzenle',
    add: 'Ekle',
    search: 'Ara',
    back: 'Geri',
    next: 'İleri',
    close: 'Kapat',
    confirm: 'Onayla',
    loading: 'Yükleniyor…',
    yes: 'Evet',
    no: 'Hayır',
    download: 'İndir',
    export: 'Dışa aktar',
    required: 'Zorunlu',
    saved: 'Kaydedildi',
    somethingWrong: 'Bir şeyler ters gitti',
  },
  nav: {
    today: 'Bugün',
    invoices: 'Faturalar',
    clients: 'Müşteriler',
    bank: 'Banka',
    cash: 'Kasa',
    files: 'Dosyalar',
    result: 'Sonuç',
    settings: 'Ayarlar',
    incoming: 'Gelen faturalar',
    quarter: 'Çeyrek özeti',
    messages: 'Mesajlar',
  },
  invoiceStatus: {
    concept: 'Taslak',
    sent: 'Gönderildi',
    paid: 'Ödendi',
    overdue: 'Gecikmiş',
  },
  greeting: {
    hello: 'Merhaba {name}',
  },
}
