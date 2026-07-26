// src/lib/i18n/messages/nl.ts
// [I18N] The message catalog — Dutch is the SOURCE OF TRUTH. Its shape (the keys)
// is the contract; other locales are deep-partial and fall back to these strings.
//
// This is a SEED of stable, cross-cutting UI strings (common actions, nav labels,
// invoice statuses). Per-screen strings are added area-by-area during rollout, as
// each dashboard area stabilises (docs/i18n-plan.md §6) — deliberately NOT
// extracted now, to avoid touching components the team is actively changing.
//
// Interpolation: use {name} placeholders, e.g. "Hallo {name}".

export const nl = {
  common: {
    save: 'Opslaan',
    cancel: 'Annuleren',
    delete: 'Verwijderen',
    edit: 'Bewerken',
    add: 'Toevoegen',
    search: 'Zoeken',
    back: 'Terug',
    next: 'Volgende',
    close: 'Sluiten',
    confirm: 'Bevestigen',
    loading: 'Laden…',
    yes: 'Ja',
    no: 'Nee',
    download: 'Downloaden',
    export: 'Exporteren',
    required: 'Verplicht',
    saved: 'Opgeslagen',
    somethingWrong: 'Er ging iets mis',
  },
  nav: {
    today: 'Vandaag',
    invoices: 'Facturen',
    clients: 'Klanten',
    bank: 'Bank',
    cash: 'Kas',
    files: 'Bestanden',
    result: 'Resultaat',
    settings: 'Instellingen',
    incoming: 'Inkomende facturen',
    quarter: 'Kwartaaloverzicht',
    messages: 'Berichten',
  },
  invoiceStatus: {
    concept: 'Concept',
    sent: 'Verzonden',
    paid: 'Betaald',
    overdue: 'Verlopen',
  },
  // A tiny demonstration entry with interpolation, so the pattern is proven.
  greeting: {
    hello: 'Hallo {name}',
  },
} as const

export type Messages = typeof nl
