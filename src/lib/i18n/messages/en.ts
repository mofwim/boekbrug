// src/lib/i18n/messages/en.ts
// [I18N] English catalog. Deep-partial of the Dutch source; missing keys fall
// back to Dutch.

import type { PartialMessages } from './types'

export const en: PartialMessages = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    search: 'Search',
    back: 'Back',
    next: 'Next',
    close: 'Close',
    confirm: 'Confirm',
    loading: 'Loading…',
    yes: 'Yes',
    no: 'No',
    download: 'Download',
    export: 'Export',
    required: 'Required',
    saved: 'Saved',
    somethingWrong: 'Something went wrong',
  },
  nav: {
    today: 'Today',
    invoices: 'Invoices',
    clients: 'Clients',
    bank: 'Bank',
    cash: 'Cash',
    files: 'Files',
    result: 'Result',
    settings: 'Settings',
    incoming: 'Incoming invoices',
    quarter: 'Quarterly overview',
    messages: 'Messages',
  },
  invoiceStatus: {
    concept: 'Draft',
    sent: 'Sent',
    paid: 'Paid',
    overdue: 'Overdue',
  },
  greeting: {
    hello: 'Hello {name}',
  },
}
