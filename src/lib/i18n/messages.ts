// src/lib/i18n/messages.ts
// [TAAL] The message catalogue. Pure data. Run: npx tsx --test src/lib/i18n/messages.test.ts
//
// Dutch is the SOURCE. Every message is written in Dutch first, because that is the language the
// product's legal strings are correct in, and it is the fallback when a translation is missing —
// so a gap always leaves something true on the screen rather than a key or a blank.
//
// ── TWO RULES THAT KEEP A TRANSLATION FROM DOING HARM ───────────────────────────────────────────
//
// 1. A NOUN INSIDE A SENTENCE IS NOT A PARAMETER. The Dutch copy used to build "Een verstuurde
//    {woord} pas je niet meer aan" by substituting "factuur" or "creditnota". That works in Dutch
//    and breaks everywhere else: Arabic agreement, Turkish suffix harmony and even English
//    articles all depend on the noun. So the document type gets its OWN key per sentence. It costs
//    a few more entries and removes an entire class of mistranslation.
//
// 2. A SENTENCE THAT POINTS AT A BUTTON MUST NAME THE BUTTON AS IT IS WRITTEN. "Facturen" and
//    "Verzonden" are on the screen in Dutch today. An Arabic sentence that translates them sends
//    the owner looking for a word that is nowhere in the interface. So the Arabic keeps the Dutch
//    label and explains around it. When those labels are themselves translated, these strings
//    change with them — and the test below is what will find them.
//
// ── WHAT IS NOT IN HERE, AND WILL NOT BE ────────────────────────────────────────────────────────
//
// The invoice PDF, the e-mail to the customer and the e-factuur XML. Those are read by a Dutch
// customer, an accountant and the Belastingdienst — never by the owner's language setting. They
// stay Dutch in every language. Translating them would change what the documents ARE.
//
// ── TURKISH ─────────────────────────────────────────────────────────────────────────────────────
//
// Deliberately absent for now, and that is a decision, not an oversight. There are 53 Turkish
// blog articles, so the audience is real — but this copy talks about a number that becomes legally
// permanent, and unreviewed Turkish on that subject is worse than Dutch the owner already
// tolerates. The fallback exists exactly for this: `tr` reads Dutch until a Turkish speaker writes
// these lines. Nothing else has to change when they do.

import type { Locale } from './locale'

/** Dutch is required; the rest may be absent and then fall back to it. */
export type Message = { nl: string } & Partial<Record<Locale, string>>

export const MESSAGES = {
  // ─── [STATUS] The word for an invoice's state. One definition, seven former ones ────────────

  'status.draft': { nl: 'Concept', ar: 'مسودة', en: 'Draft' },
  'status.sent': { nl: 'Verzonden', ar: 'مُرسَلة', en: 'Sent' },
  'status.paid': { nl: 'Betaald', ar: 'مدفوعة', en: 'Paid' },
  'status.overdue': { nl: 'Verlopen', ar: 'متأخرة', en: 'Overdue' },
  // 'Te betalen', not 'Ontvangen'. Eleven copies of these labels disagreed about four statuses,
  // and this is the only one where the disagreement was about MEANING rather than wording:
  // "Ontvangen" describes the document, "Te betalen" describes what the owner has to do about it.
  // The second is the useful one on a screen full of incoming bills, and it matches the amber chip
  // — see the note in invoice-status.ts about why an unpaid bill may not look settled.
  'status.received': { nl: 'Te betalen', ar: 'مستحقة للدفع', en: 'To pay' },
  // 'Te verifiëren' over 'In behandeling': it names what is actually waiting — a human still has
  // to check this reading — where "in behandeling" could mean anything is happening.
  'status.processing': { nl: 'Te verifiëren', ar: 'بانتظار التدقيق', en: 'To verify' },
  'status.processed': { nl: 'Verwerkt', ar: 'مُعالَجة', en: 'Processed' },
  'status.unclear': { nl: 'Onduidelijk', ar: 'غير واضحة', en: 'Unclear' },
  'status.credit': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },

  // 'Alles' is a FILTER, not a status — it is the absence of one, so it has no entry above.
  'filter.all': { nl: 'Alles', ar: 'الكل', en: 'All' },
  'filter.offerte': { nl: 'Offerte', ar: 'عرض سعر', en: 'Quote' },
  // Not a status: the OPPOSITE direction. Money coming to you instead of leaving.
  'chip.toReceive': { nl: 'Te ontvangen', ar: 'مستحقة لك', en: 'To receive' },

  // ─── [NAV] The bar the owner sees on every screen ────────────────────────────────────────────

  'nav.aria': { nl: 'Hoofdnavigatie', ar: 'التنقّل الرئيسي', en: 'Main navigation' },
  'nav.start': { nl: 'Start', ar: 'البداية', en: 'Start' },
  'nav.invoices': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'nav.incoming': { nl: 'Inkomend', ar: 'الوارد', en: 'Incoming' },
  'nav.files': { nl: 'Bestanden', ar: 'الملفات', en: 'Files' },
  'nav.clients': { nl: 'Klanten', ar: 'العملاء', en: 'Clients' },
  'nav.quarter': { nl: 'Kwartaal', ar: 'الربع', en: 'Quarter' },

  // ─── [NIEUW] Het scherm waar een factuur gemaakt wordt ──────────────────────────────────────
  //
  // De meest gebruikte schermvulling van de app, en de eerste hele PAGINA in de catalogus. De
  // volgorde volgt het scherm van boven naar beneden, zodat een vertaler de zinnen in context
  // leest in plaats van als een alfabetische lijst.
  //
  // Wat hier NIET in staat: de placeholder-voorbeelden die een NEDERLANDS formaat tonen —
  // 'NL123456789B01', '1234 AB', 'Straatnaam 1', 'Amsterdam'. Dat zijn geen woorden maar het
  // formaat waarin de Belastingdienst en PostNL het willen zien; een Arabisch voorbeeld zou de
  // ondernemer een postcode laten typen die hier niet bestaat.

  'nieuw.titel.factuur': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'nieuw.titel.offerte': { nl: 'Nieuwe offerte', ar: 'عرض سعر جديد', en: 'New quote' },
  'nieuw.type': { nl: 'Type document', ar: 'نوع المستند', en: 'Document type' },
  'nieuw.type.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'nieuw.type.offerte': { nl: 'Offerte', ar: 'عرض سعر', en: 'Quote' },
  'nieuw.type.creditnota': { nl: 'Losse creditnota', ar: 'إشعار دائن مستقل', en: 'Standalone credit note' },

  'nieuw.klant.aan': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'nieuw.klant.van': { nl: 'Van', ar: 'من', en: 'From' },
  'nieuw.klant.zoek': { nl: 'Zoek of typ klantnaam...', ar: 'ابحث أو اكتب اسم العميل...', en: 'Search or type a client name...' },
  'nieuw.klant.bedrijf': { nl: 'Bedrijfsnaam', ar: 'اسم الشركة', en: 'Company name' },
  'nieuw.klant.email': { nl: 'E-mailadres', ar: 'البريد الإلكتروني', en: 'E-mail address' },
  'nieuw.klant.adres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'nieuw.klant.postcode': { nl: 'Postcode', ar: 'الرمز البريدي', en: 'Postcode' },
  'nieuw.klant.stad': { nl: 'Stad', ar: 'المدينة', en: 'City' },
  'nieuw.klant.btw': { nl: 'BTW-nummer klant', ar: 'رقم ضريبة القيمة المضافة للعميل', en: "Client's VAT number" },
  'nieuw.klant.btwFormaat': { nl: 'Verwacht formaat: NL123456789B01', ar: 'الصيغة المتوقّعة: NL123456789B01', en: 'Expected format: NL123456789B01' },
  // Het PO-nummer blijft een Nederlands voorbeeldformaat — zie de kop van dit blok.
  'nieuw.klant.extraHint': { nl: 'Afdeling of PO-2026-114', ar: 'القسم أو PO-2026-114', en: 'Department or PO-2026-114' },
  'nieuw.klant.extra1': { nl: 'Extra regel 1', ar: 'سطر إضافي 1', en: 'Extra line 1' },
  'nieuw.klant.extra2': { nl: 'Extra regel 2', ar: 'سطر إضافي 2', en: 'Extra line 2' },
  'nieuw.klant.extra3': { nl: 'Extra regel 3', ar: 'سطر إضافي 3', en: 'Extra line 3' },

  'nieuw.datums': { nl: 'Datums', ar: 'التواريخ', en: 'Dates' },
  'nieuw.datum.factuur': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'nieuw.datum.offerte': { nl: 'Offertedatum', ar: 'تاريخ عرض السعر', en: 'Quote date' },
  'nieuw.datum.verval': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'nieuw.datum.geldig': { nl: 'Geldig tot', ar: 'صالح حتى', en: 'Valid until' },
  'nieuw.datum.lever': { nl: 'Leverdatum', ar: 'تاريخ التسليم', en: 'Delivery date' },
  // Art. 35a lid 1 sub f — waarom dit veld verplicht is op een factuur.
  'nieuw.datum.leverUitleg': {
    nl: 'Leverdatum = datum waarop de levering of dienst is verricht.',
    ar: 'تاريخ التسليم = اليوم الذي تمّ فيه تسليم البضاعة أو أداء الخدمة.',
    en: 'Delivery date = the day the goods or service were actually delivered.',
  },
  'nieuw.termijn': { nl: 'Betalingstermijn in dagen', ar: 'مهلة السداد بالأيام', en: 'Payment term in days' },
  'nieuw.termijn.kort': { nl: 'Betalingstermijn:', ar: 'مهلة السداد:', en: 'Payment term:' },
  'nieuw.termijn.dagen': { nl: 'dagen', ar: 'يوماً', en: 'days' },

  'nieuw.regels.factuur': { nl: 'Factuurregels', ar: 'بنود الفاتورة', en: 'Invoice lines' },
  'nieuw.regels.offerte': { nl: 'Offerteregels', ar: 'بنود عرض السعر', en: 'Quote lines' },
  'nieuw.regel.omschrijving': { nl: 'Omschrijving', ar: 'الوصف', en: 'Description' },
  'nieuw.regel.aantal': { nl: 'Aantal', ar: 'الكمية', en: 'Quantity' },
  'nieuw.regel.artikelcode': { nl: 'Artikelcode', ar: 'رمز الصنف', en: 'Article code' },
  'nieuw.regel.codeHint': { nl: 'Omschrijving of code (bijv. 22)', ar: 'الوصف أو الرمز (مثلاً 22)', en: 'Description or code (e.g. 22)' },
  'nieuw.regel.codeVoorbeeld': { nl: 'code (bijv. 22)', ar: 'رمز (مثلاً 22)', en: 'code (e.g. 22)' },
  'nieuw.regel.prijsExcl': { nl: 'Prijs excl. (€)', ar: 'السعر بدون ضريبة (€)', en: 'Price excl. (€)' },
  'nieuw.regel.prijsIncl': { nl: 'Prijs incl. (€)', ar: 'السعر شامل الضريبة (€)', en: 'Price incl. (€)' },
  'nieuw.regel.vrijgesteld': { nl: 'Vrijgesteld', ar: 'مُعفى', en: 'Exempt' },

  'nieuw.prijsmodus': { nl: 'Prijzen invoeren', ar: 'إدخال الأسعار', en: 'Entering prices' },
  'nieuw.prijsmodus.aria': { nl: 'Prijzen invoeren inclusief of exclusief btw', ar: 'إدخال الأسعار شاملةً الضريبة أو بدونها', en: 'Enter prices including or excluding VAT' },
  'nieuw.prijsmodus.excl': { nl: 'Je typt de prijs zonder btw; wij tellen de btw erbij.', ar: 'تكتب السعر بدون ضريبة، ونحن نضيف الضريبة إليه.', en: 'You type the price without VAT; we add the VAT.' },
  'nieuw.prijsmodus.incl': { nl: 'Je typt wat je klant betaalt; wij rekenen de btw eruit.', ar: 'تكتب ما يدفعه العميل، ونحن نستخرج الضريبة منه.', en: 'You type what your customer pays; we work the VAT back out.' },

  'nieuw.korting': { nl: 'Korting', ar: 'خصم', en: 'Discount' },
  'nieuw.korting.percentage': { nl: 'Kortingspercentage', ar: 'نسبة الخصم', en: 'Discount percentage' },
  'nieuw.korting.bedrag': { nl: 'Kortingsbedrag', ar: 'مبلغ الخصم', en: 'Discount amount' },
  'nieuw.korting.foutPercentage': { nl: 'Vul een percentage tussen 0 en 100 in.', ar: 'أدخل نسبة بين 0 و100.', en: 'Enter a percentage between 0 and 100.' },
  'nieuw.korting.foutBedrag': { nl: 'Vul een bedrag boven 0 in.', ar: 'أدخل مبلغاً أكبر من 0.', en: 'Enter an amount above 0.' },

  'nieuw.totaal.subtotaal': { nl: 'Subtotaal excl. BTW', ar: 'المجموع الفرعي بدون ضريبة', en: 'Subtotal excl. VAT' },
  'nieuw.totaal.naKorting': { nl: 'Na korting excl. BTW', ar: 'بعد الخصم، بدون ضريبة', en: 'After discount, excl. VAT' },
  'nieuw.totaal.incl': { nl: 'Totaal incl. BTW', ar: 'الإجمالي شامل الضريبة', en: 'Total incl. VAT' },

  'nieuw.betaalinfo': { nl: 'Betalingsinformatie', ar: 'معلومات الدفع', en: 'Payment details' },
  'nieuw.betaalkenmerk': { nl: 'Betalingskenmerk', ar: 'مرجع الدفع', en: 'Payment reference' },
  'nieuw.betaalkenmerk.hint': { nl: 'Kostenplaats of contractnummer', ar: 'مركز التكلفة أو رقم العقد', en: 'Cost centre or contract number' },

  'nieuw.actie.versturen': { nl: 'Opslaan en versturen', ar: 'حفظ وإرسال', en: 'Save and send' },
  'nieuw.actie.offerteOpslaan': { nl: 'Offerte opslaan', ar: 'حفظ عرض السعر', en: 'Save quote' },
  'nieuw.actie.concept': { nl: 'Opslaan als concept', ar: 'حفظ كمسودة', en: 'Save as draft' },
  'nieuw.actie.bezig': { nl: 'Bezig...', ar: 'جارٍ العمل...', en: 'Working...' },
  'nieuw.actie.laden': { nl: 'Laden...', ar: 'جارٍ التحميل...', en: 'Loading...' },
  'nieuw.actie.versturenBezig': { nl: 'Versturen...', ar: 'جارٍ الإرسال...', en: 'Sending...' },
  'nieuw.actie.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },

  'nieuw.bevestig.titel': { nl: 'Factuur versturen?', ar: 'إرسال الفاتورة؟', en: 'Send the invoice?' },
  // Art. 35 Wet OB, gezegd vóórdat het gebeurt. De <strong> om "definitief nummer" is opgeofferd:
  // een zin met opmaak middenin is in elke taal een andere zin, en dat is precies de reden dat
  // vertalers hem stukgeknipt terugkrijgen. De nadruk zit nu in de woorden zelf.
  'nieuw.bevestig.uitleg': {
    nl: 'Bij verzenden krijgt de factuur een definitief nummer en wordt de PDF per e-mail bezorgd. Dit kan niet ongedaan worden gemaakt.',
    ar: 'عند الإرسال تأخذ الفاتورة رقماً نهائياً ويُسلَّم ملف PDF بالبريد الإلكتروني. ولا يمكن التراجع عن ذلك.',
    en: 'On sending, the invoice gets a permanent number and the PDF is delivered by e-mail. This cannot be undone.',
  },
  'nieuw.bevestig.ja': { nl: 'Ja, verstuur', ar: 'نعم، أرسِل', en: 'Yes, send it' },
  'nieuw.bevestig.aan': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'nieuw.bevestig.email': { nl: 'E-mail', ar: 'البريد الإلكتروني', en: 'E-mail' },
  'nieuw.bevestig.bedrag': { nl: 'Bedrag', ar: 'المبلغ', en: 'Amount' },

  'nieuw.fout.velden': { nl: 'Vul de rood gemarkeerde velden in', ar: 'املأ الحقول المُعلَّمة بالأحمر', en: 'Fill in the fields marked red' },
  'nieuw.fout.btwKlant': { nl: 'Het BTW-nummer van de klant lijkt onjuist (verwacht: NL123456789B01)', ar: 'رقم ضريبة القيمة المضافة للعميل يبدو غير صحيح (المتوقّع: NL123456789B01)', en: "The client's VAT number looks wrong (expected: NL123456789B01)" },
  'nieuw.fout.aanmaken': { nl: 'Aanmaken mislukt — probeer opnieuw', ar: 'فشل الإنشاء — حاول مرة أخرى', en: 'Could not create it — please try again' },
  'nieuw.fout.versturen': { nl: 'Verzenden mislukt — de factuur is opgeslagen als concept', ar: 'فشل الإرسال — حُفظت الفاتورة كمسودة', en: 'Sending failed — the invoice was saved as a draft' },
  'nieuw.fout.omzetten': { nl: 'Omzetten mislukt', ar: 'فشل التحويل', en: 'Conversion failed' },
  'nieuw.fout.catalogus': { nl: 'Opslaan in de catalogus lukte niet.', ar: 'تعذّر الحفظ في الكتالوج.', en: 'Could not save it to the catalogue.' },

  'nieuw.banner.vanOfferte': { nl: 'Factuur op basis van offerte', ar: 'فاتورة مبنيّة على عرض سعر', en: 'Invoice based on a quote' },
  'nieuw.banner.vervangend': { nl: 'Vervangende factuur', ar: 'فاتورة بديلة', en: 'Replacement invoice' },
  'nieuw.banner.gevonden': { nl: 'We vonden de factuur die je eerder maakte', ar: 'وجدنا الفاتورة التي أنشأتها سابقاً', en: 'We found the invoice you made earlier' },
  'nieuw.banner.overnemen': { nl: 'Overnemen', ar: 'استيرادها', en: 'Use it' },
  'nieuw.banner.opnieuw': { nl: 'Nee, opnieuw beginnen', ar: 'لا، ابدأ من جديد', en: 'No, start over' },

  'nieuw.omzetten': { nl: 'Omzetten naar factuur', ar: 'تحويله إلى فاتورة', en: 'Convert to invoice' },
  'nieuw.omzetten.zeker': { nl: 'Weet u het zeker?', ar: 'هل أنت متأكد؟', en: 'Are you sure?' },
  'nieuw.omzetten.ja': { nl: 'Ja, maak factuur aan', ar: 'نعم، أنشئ الفاتورة', en: 'Yes, create the invoice' },

  'nieuw.eenheid.aangepast': { nl: 'Aangepast', ar: 'مخصّص', en: 'Custom' },
  'nieuw.eenheid.bewaar': { nl: 'Bewaar', ar: 'احفظ', en: 'Save' },
  'nieuw.eenheid.annuleer': { nl: 'Annuleer', ar: 'ألغِ', en: 'Cancel' },
  'nieuw.catalogus.in': { nl: 'In catalogus', ar: 'في الكتالوج', en: 'In the catalogue' },
  'nieuw.catalogus.bewaar': { nl: 'Bewaar in catalogus', ar: 'احفظ في الكتالوج', en: 'Save to catalogue' },
  'nieuw.catalogus.aanvullen': { nl: 'Aanvullen', ar: 'أضف للكتالوج', en: 'Add to catalogue' },

  // [VERTAAL] De ondernemer typt de omschrijving in zijn eigen taal en de knop zet hem om naar
  // het Nederlands — want de KLANT leest die regel op de factuur. Dat is precies de scheiding uit
  // de kop van dit bestand: het scherm volgt de ondernemer, het document blijft Nederlands.
  'nieuw.vertaal': { nl: 'Vertaal', ar: 'ترجم', en: 'Translate' },
  'nieuw.vertaal.doel': { nl: 'voor professioneel Nederlands', ar: 'لتصبح هولندية احترافية', en: 'for professional Dutch' },
  'nieuw.vertaal.uitleg': { nl: 'Schrijf in uw eigen taal — druk op', ar: 'اكتب بلغتك — ثم اضغط', en: 'Write in your own language — then press' },

  // ─── [LIJST] Het facturenoverzicht — het scherm dat de ondernemer het vaakst opent ──────────

  'lijst.zoek': { nl: 'Zoek op factuurnummer, klant of bedrag…', ar: 'ابحث برقم الفاتورة أو العميل أو المبلغ…', en: 'Search by invoice number, client or amount…' },
  'lijst.zoek.aria': { nl: 'Facturen zoeken', ar: 'البحث في الفواتير', en: 'Search invoices' },
  'lijst.zoek.wissen': { nl: 'Zoekopdracht wissen', ar: 'مسح البحث', en: 'Clear the search' },
  'lijst.zoek.ouder': { nl: 'Zoeken in oudere facturen…', ar: 'جارٍ البحث في الفواتير الأقدم…', en: 'Searching older invoices…' },

  'lijst.leeg': { nl: 'Geen facturen', ar: 'لا توجد فواتير', en: 'No invoices' },
  'lijst.leeg.eerste': { nl: 'Maak je eerste factuur aan', ar: 'أنشئ فاتورتك الأولى', en: 'Create your first invoice' },
  'lijst.nieuw': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'lijst.maak': { nl: 'Maak factuur aan', ar: 'أنشئ الفاتورة', en: 'Create the invoice' },
  'lijst.vernieuwen': { nl: 'Vernieuwen', ar: 'تحديث', en: 'Refresh' },
  'lijst.openen': { nl: 'Openen', ar: 'فتح', en: 'Open' },
  'lijst.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'lijst.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'lijst.verwijderen': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'lijst.versturen': { nl: 'Versturen', ar: 'إرسال', en: 'Send' },
  'lijst.opnieuwVersturen': { nl: 'Opnieuw versturen', ar: 'إعادة الإرسال', en: 'Send again' },
  'lijst.omzetten': { nl: 'Omzetten naar factuur', ar: 'تحويله إلى فاتورة', en: 'Convert to invoice' },

  'lijst.betaald': { nl: 'Betaald', ar: 'مدفوعة', en: 'Paid' },
  'lijst.betaaldBedrag': { nl: 'Betaald bedrag', ar: 'المبلغ المدفوع', en: 'Amount paid' },
  'lijst.betaaldatum': { nl: 'Betaaldatum', ar: 'تاريخ الدفع', en: 'Payment date' },
  'lijst.vervaldatum': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'lijst.contant': { nl: 'Contant', ar: 'نقداً', en: 'Cash' },
  'lijst.bank': { nl: 'Bank', ar: 'بنك', en: 'Bank' },
  'lijst.gecrediteerd': { nl: 'Gecrediteerd', ar: 'صدر بها إشعار دائن', en: 'Credited' },
  'lijst.teruggezet': { nl: 'Teruggezet', ar: 'أُعيدت', en: 'Reverted' },
  'lijst.verwijderd': { nl: 'Verwijderd', ar: 'حُذفت', en: 'Deleted' },
  'lijst.betalingBevestigd': { nl: 'Betaling bevestigd ✓', ar: 'تم تأكيد الدفع ✓', en: 'Payment confirmed ✓' },
  'lijst.verwerkt': { nl: 'Factuur is verwerkt', ar: 'تمت معالجة الفاتورة', en: 'The invoice has been processed' },

  'lijst.herhalen': { nl: 'Terugkerende facturen', ar: 'الفواتير المتكرّرة', en: 'Recurring invoices' },
  'lijst.herhalen.stop': { nl: 'Stoppen met herhalen', ar: 'إيقاف التكرار', en: 'Stop repeating' },
  'lijst.herhalen.stopKort': { nl: 'Stop', ar: 'إيقاف', en: 'Stop' },
  'lijst.herhalen.uitleg': { nl: 'De app zet het concept klaar; versturen blijft aan jou.', ar: 'يُجهّز التطبيق المسودة، ويبقى الإرسال بيدك.', en: 'The app prepares the draft; sending stays with you.' },
  'lijst.herhalen.gestopt': { nl: 'Herhalen gestopt — klaarstaande concepten blijven staan', ar: 'أُوقف التكرار — وتبقى المسودات الجاهزة كما هي', en: 'Repeating stopped — drafts already prepared stay put' },

  'lijst.boekhouder.geen': { nl: 'Geen boekhouder gekoppeld', ar: 'لا يوجد محاسب مرتبط', en: 'No accountant linked' },
  'lijst.boekhouder.stuur': { nl: 'Stuur verzoek naar boekhouder', ar: 'أرسل طلباً إلى المحاسب', en: 'Send a request to your accountant' },

  // ── Wat er misging. Elke zin zegt WAT er niet gebeurde en wat de ondernemer nu weet. ──
  'lijst.fout.versturen': { nl: 'Versturen mislukt', ar: 'فشل الإرسال', en: 'Sending failed' },
  'lijst.fout.versturenStraks': { nl: 'Versturen lukte niet. Probeer het zo meteen opnieuw.', ar: 'لم ينجح الإرسال. أعد المحاولة بعد قليل.', en: 'Sending did not work. Try again in a moment.' },
  'lijst.fout.verbinding': { nl: 'Verzenden mislukt — controleer je verbinding', ar: 'فشل الإرسال — تحقّق من اتصالك', en: 'Sending failed — check your connection' },
  'lijst.fout.verwijderen': { nl: 'Verwijderen mislukt — probeer opnieuw', ar: 'فشل الحذف — حاول مرة أخرى', en: 'Deleting failed — please try again' },
  'lijst.fout.verwijderenOffline': { nl: 'Geen verbinding — verwijderen niet gelukt', ar: 'لا يوجد اتصال — لم ينجح الحذف', en: 'No connection — the delete did not go through' },
  // De betaling is het gevoeligste geval: de ondernemer moet weten WAAR hij kan nakijken of hij
  // toch is opgeslagen, want een dubbele bevestiging boekt hem twee keer.
  'lijst.fout.betalingOffline': { nl: 'Geen verbinding — controleer of de betaling is opgeslagen', ar: 'لا يوجد اتصال — تحقّق مما إذا كان الدفع قد حُفظ', en: 'No connection — check whether the payment was saved' },
  'lijst.fout.bevestigen': { nl: 'Bevestigen mislukt — probeer het op de Bank-pagina', ar: 'فشل التأكيد — جرّب من صفحة البنك', en: 'Confirming failed — try it on the Bank page' },
  'lijst.fout.betaalverzoek': { nl: 'Betaalverzoek maken mislukt', ar: 'فشل إنشاء طلب الدفع', en: 'Could not create the payment request' },
  'lijst.fout.herhalen': { nl: 'Herhalen instellen mislukt', ar: 'فشل ضبط التكرار', en: 'Could not set up the repeat' },
  'lijst.fout.stoppen': { nl: 'Stoppen mislukt', ar: 'فشل الإيقاف', en: 'Could not stop it' },
  'lijst.fout.verwijderenVervers': { nl: 'Verwijderen mislukt — ververs de pagina', ar: 'فشل الحذف — حدّث الصفحة', en: 'Deleting failed — refresh the page' },
  'lijst.onbekendeKlant': { nl: 'Onbekende klant', ar: 'عميل غير معروف', en: 'Unknown client' },
  // "Voldaan!" is de KNOP (zet op betaald), "✓ Voldaan" de TOESTAND. Twee sleutels, want in het
  // Arabisch is een gebiedende wijs een ander woord dan een voltooid deelwoord.
  'lijst.voldaan': { nl: 'Voldaan', ar: 'مسدَّدة', en: 'Settled' },
  'lijst.voldaanActie': { nl: 'Voldaan!', ar: 'سُدّدت!', en: 'Settled!' },
  'lijst.fout.nietGevonden': { nl: 'Factuur niet gevonden', ar: 'لم يُعثر على الفاتورة', en: 'Invoice not found' },
  'lijst.fout.klantEmail': { nl: 'Klant e-mail ontbreekt', ar: 'بريد العميل الإلكتروني ناقص', en: "The client's e-mail is missing" },
  'lijst.fout.klantNaam': { nl: 'Klant naam ontbreekt', ar: 'اسم العميل ناقص', en: "The client's name is missing" },

  // ─── [START] Het startscherm — de eerste indruk na inloggen ─────────────────────────────────

  'start.toevoegen': { nl: 'Toevoegen', ar: 'إضافة', en: 'Add' },
  'start.administratie': { nl: 'Mijn administratie', ar: 'إدارتي', en: 'My records' },
  'start.meer': { nl: 'Meer', ar: 'المزيد', en: 'More' },
  'start.tegel.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'start.tegel.inkomend': { nl: 'Inkomend', ar: 'الوارد', en: 'Incoming' },
  'start.tegel.inkoop': { nl: 'Inkoopfacturen', ar: 'فواتير المشتريات', en: 'Purchase invoices' },
  'start.tegel.bank': { nl: 'Bank', ar: 'البنك', en: 'Bank' },
  'start.tegel.dagomzet': { nl: 'Dagomzet', ar: 'إيراد اليوم', en: 'Daily turnover' },
  'start.tegel.artikelen': { nl: 'Artikelen', ar: 'الأصناف', en: 'Articles' },
  'start.tegel.team': { nl: 'Team', ar: 'الفريق', en: 'Team' },
  'start.tegel.werkplek': { nl: 'Mijn werkplek', ar: 'مكتبي', en: 'My workspace' },
  'start.nieuweFactuur': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'start.allesUploaden': { nl: 'Alles uploaden', ar: 'رفع الكل', en: 'Upload everything' },
  // "Je waarheid" is de merknaam van het cijferscherm: wat er werkelijk in je zaak gebeurt.
  // Vertaald als betekenis, niet als merk — een onvertaalde naam op de belangrijkste kaart zou
  // precies de kaart onleesbaar laten die het vertrouwen moet dragen.
  'start.waarheid': { nl: 'Je waarheid', ar: 'حقيقتك', en: 'Your truth' },
  'start.waarheid.sub': { nl: 'Status van je kwartaal — en klaar voor de boekhouder', ar: 'وضع ربعك — وجاهز للمحاسب', en: 'Where your quarter stands — ready for the accountant' },
  'start.klaar': { nl: 'Ben ik klaar?', ar: 'هل أنا جاهز؟', en: 'Am I ready?' },
  'start.vraag': { nl: 'Bekijk de vraag en antwoord hier', ar: 'اطّلع على السؤال والجواب هنا', en: 'See the question and answer here' },

  'start.allesUploaden.sub': { nl: 'Meerdere bestanden tegelijk — de app sorteert', ar: 'عدة ملفات دفعة واحدة — والتطبيق يرتّبها', en: 'Several files at once — the app sorts them' },
  'start.waarheid.kaartSub': { nl: 'Omzet, winst en BTW — live, elke periode', ar: 'الإيراد والربح والضريبة — مباشرةً، لكل فترة', en: 'Turnover, profit and VAT — live, any period' },
  'start.werkplek.sub': { nl: 'Klanten, bestanden en gegevens', ar: 'العملاء والملفات والبيانات', en: 'Clients, files and details' },
  'start.team.sub': { nl: 'Wie mag er facturen maken voor je bedrijf', ar: 'مَن يحق له إصدار فواتير باسم شركتك', en: 'Who may create invoices for your business' },

  // ─── [WAARHEID-KAART] Het dagoverzicht op het startscherm ───────────────────────────────────

  'waarheid.bank': { nl: 'Bank — op de rekening', ar: 'البنك — في الحساب', en: 'Bank — on the account' },
  'waarheid.kas': { nl: 'Kas — in kassa', ar: 'الصندوق — في الدرج', en: 'Cash — in the till' },
  'waarheid.teBetalen': { nl: 'Te betalen', ar: 'مستحقة للدفع', en: 'To pay' },
  'waarheid.teOntvangen': { nl: 'Te ontvangen', ar: 'مستحقة لك', en: 'To receive' },
  'waarheid.creditnota': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },
  'waarheid.allesBij': { nl: 'Alles is bij', ar: 'كل شيء محدَّث', en: 'Everything is up to date' },
  'waarheid.nietsOpen': { nl: 'Niets openstaand — geen facturen te betalen of te ontvangen.', ar: 'لا شيء معلّق — لا فواتير للدفع أو التحصيل.', en: 'Nothing outstanding — no invoices to pay or receive.' },
  'waarheid.allesBekijken': { nl: 'Alles bekijken', ar: 'عرض الكل', en: 'View all' },
  'waarheid.nietsTeBetalen': { nl: 'Niets te betalen', ar: 'لا شيء للدفع', en: 'Nothing to pay' },
  'waarheid.nietsOpenKort': { nl: 'Niets openstaand', ar: 'لا شيء معلّق', en: 'Nothing outstanding' },
  'waarheid.alleBekijken': { nl: 'Alle {n} bekijken', ar: 'عرض الكل ({n})', en: 'View all {n}' },
  // Meerdere rekeningen: het aantal in de kop, zodat het totaal eronder verklaard is.
  'waarheid.bankMeerdere': { nl: 'Bank — {n} rekeningen', ar: 'البنك — {n} حسابات', en: 'Bank — {n} accounts' },
  'waarheid.laadfout': { nl: 'Kon je overzicht niet laden', ar: 'تعذّر تحميل نظرتك العامة', en: 'Could not load your overview' },
  'waarheid.opnieuw': { nl: 'Opnieuw proberen', ar: 'حاول مرة أخرى', en: 'Try again' },

  // ─── [VERSTUURD] The confirmation after an invoice actually goes out ─────────────────────────

  'sent.factuur.title': {
    nl: 'Factuur verstuurd',
    ar: 'تم إرسال الفاتورة',
    en: 'Invoice sent',
  },
  'sent.creditnota.title': {
    nl: 'Creditnota verstuurd',
    ar: 'تم إرسال الإشعار الدائن',
    en: 'Credit note sent',
  },

  'sent.factuur.lead': {
    nl: 'Factuur {number} is onderweg naar {name}.',
    ar: 'الفاتورة {number} في طريقها إلى {name}.',
    en: 'Invoice {number} is on its way to {name}.',
  },
  'sent.creditnota.lead': {
    nl: 'Creditnota {number} is onderweg naar {name}.',
    ar: 'الإشعار الدائن {number} في طريقه إلى {name}.',
    en: 'Credit note {number} is on its way to {name}.',
  },
  'sent.factuur.leadNoName': {
    nl: 'Factuur {number} is verstuurd.',
    ar: 'تم إرسال الفاتورة {number}.',
    en: 'Invoice {number} has been sent.',
  },
  'sent.creditnota.leadNoName': {
    nl: 'Creditnota {number} is verstuurd.',
    ar: 'تم إرسال الإشعار الدائن {number}.',
    en: 'Credit note {number} has been sent.',
  },

  // Art. 35 Wet OB. The one thing on this panel the owner cannot undo, so it is stated before the
  // reassurance — in every language.
  'sent.factuur.fixed': {
    nl: 'Nummer {number} ligt vast. Een verstuurde factuur pas je niet meer aan — een fout corrigeer je met een creditnota.',
    ar: 'الرقم {number} صار نهائياً. الفاتورة المُرسَلة لا تُعدَّل — الخطأ يُصحَّح بإشعار دائن.',
    en: 'Number {number} is now permanent. A sent invoice is never edited — a mistake is corrected with a credit note.',
  },
  'sent.creditnota.fixed': {
    nl: 'Nummer {number} ligt vast. Een verstuurde creditnota pas je niet meer aan.',
    ar: 'الرقم {number} صار نهائياً. الإشعار الدائن المُرسَل لا يُعدَّل.',
    en: 'Number {number} is now permanent. A sent credit note is never edited.',
  },
  // Only reachable for a factuur: converting is what an offerte does, and it becomes a factuur.
  'sent.factuur.fixedConverted': {
    nl: 'Je offerte is nu factuur {number}. Dat nummer ligt vast: een verstuurde factuur pas je niet meer aan — een fout corrigeer je met een creditnota.',
    ar: 'عرض السعر صار الآن الفاتورة {number}. هذا الرقم نهائي: الفاتورة المُرسَلة لا تُعدَّل — الخطأ يُصحَّح بإشعار دائن.',
    en: 'Your quote is now invoice {number}. That number is permanent: a sent invoice is never edited — a mistake is corrected with a credit note.',
  },

  'sent.factuur.numberLabel': { nl: 'Factuurnummer', ar: 'رقم الفاتورة', en: 'Invoice number' },
  'sent.creditnota.numberLabel': { nl: 'Creditnotanummer', ar: 'رقم الإشعار الدائن', en: 'Credit note number' },
  'sent.row.to': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'sent.row.sentTo': { nl: 'Verstuurd naar', ar: 'أُرسلت إلى', en: 'Sent to' },
  'sent.row.amount': { nl: 'Bedrag', ar: 'المبلغ', en: 'Amount' },

  'sent.check.heading': {
    nl: 'Zo controleer je het zelf',
    ar: 'كيف تتحقّق بنفسك',
    en: 'How to check it yourself',
  },
  // Rule 2 in the header, now applied properly. This sentence used to spell "Facturen" and
  // "Verzonden" literally in every language, because those words were Dutch on the screen and
  // an owner told to look for a translated word would have found nothing.
  //
  // The tab and the status are translated now, so the literals would be the wrong half of the
  // rule — pointing at labels that no longer exist. They are PARAMETERS instead, filled from
  // nav.invoices and status.sent, so this sentence names whatever the screen actually says and
  // cannot drift from it again in any language.
  'sent.factuur.checkList': {
    nl: 'De factuur staat nu bij {tab} met de status {status}.',
    ar: 'الفاتورة الآن ضمن قائمة {tab} بالحالة {status}.',
    en: 'The invoice is now under {tab} with the status {status}.',
  },
  'sent.creditnota.checkList': {
    nl: 'De creditnota staat nu bij {tab} met de status {status}.',
    ar: 'الإشعار الدائن الآن ضمن قائمة {tab} بالحالة {status}.',
    en: 'The credit note is now under {tab} with the status {status}.',
  },
  'sent.check.pdf': {
    nl: 'Open hem om de PDF te bekijken — dat is hetzelfde bestand dat de klant heeft gekregen.',
    ar: 'افتحه لتعاين ملف PDF — وهو نفس الملف الذي وصل العميل.',
    en: 'Open it to view the PDF — that is the same file the customer received.',
  },
  'sent.check.reply': {
    nl: 'Antwoordt de klant op deze mail, dan komt dat binnen op {email}.',
    ar: 'إذا ردّ العميل على هذه الرسالة، فسيصل الرد إلى {email}.',
    en: 'If the customer replies to this e-mail, it arrives at {email}.',
  },
  // The honest limit that makes the three lines above worth trusting.
  'sent.check.failed': {
    nl: 'Was het versturen mislukt, dan had je dit scherm niet gezien maar een herstelscherm.',
    ar: 'ولو فشل الإرسال لما ظهرت لك هذه الشاشة بل شاشة إصلاح.',
    en: 'Had the send failed, you would be looking at a recovery screen instead of this one.',
  },

  'sent.action.view': { nl: 'Bekijk de factuur', ar: 'عرض الفاتورة', en: 'View the invoice' },
  'sent.action.new': { nl: 'Nog een factuur maken', ar: 'إنشاء فاتورة أخرى', en: 'Create another invoice' },
} satisfies Record<string, Message>

export type MessageKey = keyof typeof MESSAGES
