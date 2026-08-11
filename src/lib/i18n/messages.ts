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

  // ─── [DETAIL] De factuurdetailpagina, en het bewerkscherm ───────────────────────────────────
  // Beide hergebruiken de nieuw.*-sleutels voor alles wat het maakscherm ook toont; hier staan
  // alleen de zinnen die alleen dáár bestaan.

  'detail.klaar': { nl: 'Klaar om te verzenden?', ar: 'جاهزة للإرسال؟', en: 'Ready to send?' },
  'detail.bevestig': { nl: 'Bevestig de gegevens voordat je de factuur verstuurt.', ar: 'تحقّق من البيانات قبل إرسال الفاتورة.', en: 'Confirm the details before you send the invoice.' },
  'detail.definitief': { nl: 'De factuur krijgt een definitief nummer.', ar: 'ستأخذ الفاتورة رقماً نهائياً.', en: 'The invoice will get a permanent number.' },
  'detail.bezorgingMislukt': { nl: 'De factuur is uitgegeven, maar de bezorging is mislukt', ar: 'صدرت الفاتورة، لكن التسليم فشل', en: 'The invoice was issued, but delivery failed' },
  'detail.geannuleerd': { nl: 'Deze factuur is geannuleerd door een creditnota', ar: 'أُلغيت هذه الفاتورة بإشعار دائن', en: 'This invoice was cancelled by a credit note' },
  'detail.foutIn': { nl: 'Fout in deze factuur?', ar: 'خطأ في هذه الفاتورة؟', en: 'A mistake in this invoice?' },
  'detail.nooitVerwijderen': { nl: 'Verzonden facturen mogen nooit worden verwijderd.', ar: 'الفواتير المُرسَلة لا يجوز حذفها أبداً.', en: 'Sent invoices may never be deleted.' },
  'detail.teCrediteren': { nl: 'Te crediteren:', ar: 'المبلغ المراد عكسه:', en: 'To credit:' },
  'detail.creditReden': { nl: 'bijv. verkeerd bedrag, geannuleerde opdracht', ar: 'مثلاً: مبلغ خاطئ، أو مهمة أُلغيت', en: 'e.g. wrong amount, cancelled job' },
  'detail.onbekendeFout': { nl: 'Onbekende fout — probeer opnieuw', ar: 'خطأ غير معروف — حاول مرة أخرى', en: 'Unknown error — please try again' },

  'bewerk.versturenNaar': { nl: 'Versturen naar {name}?', ar: 'إرسال إلى {name}؟', en: 'Send to {name}?' },
  'bewerk.geldigTot': { nl: 'Deze offerte is geldig tot', ar: 'عرض السعر هذا صالح حتى', en: 'This quote is valid until' },
  'bewerk.jouwGegevens': { nl: 'Jouw gegevens', ar: 'بياناتك', en: 'Your details' },
  'bewerk.klantgegevens': { nl: 'Klantgegevens', ar: 'بيانات العميل', en: 'Client details' },
  'bewerk.omschrijvingDienst': { nl: 'Omschrijving dienst', ar: 'وصف الخدمة', en: 'Service description' },
  'bewerk.vulRegels': { nl: 'Vul alle factuurregels correct in', ar: 'املأ جميع بنود الفاتورة بشكل صحيح', en: 'Fill in all invoice lines correctly' },
  'bewerk.vulVerplicht': { nl: 'Vul alle verplichte velden in (*)', ar: 'املأ جميع الحقول الإلزامية (*)', en: 'Fill in all required fields (*)' },

  // ─── [INKOMEND] De inkomende facturen — waar de AI leest en de mens bevestigt ───────────────

  'ink.zoek': { nl: 'Zoek op leverancier, factuurnummer of bedrag…', ar: 'ابحث بالمورّد أو رقم الفاتورة أو المبلغ…', en: 'Search by supplier, invoice number or amount…' },
  'ink.zoek.aria': { nl: 'Inkomende facturen zoeken', ar: 'البحث في الفواتير الواردة', en: 'Search incoming invoices' },
  'ink.zoek.wissen': { nl: 'Zoekopdracht wissen', ar: 'مسح البحث', en: 'Clear the search' },
  'ink.leeg': { nl: 'Geen facturen gevonden', ar: 'لم يُعثر على فواتير', en: 'No invoices found' },
  'ink.allesVerwerkt': { nl: 'Alles verwerkt', ar: 'كل شيء عولج', en: 'Everything processed' },
  'ink.aandacht': { nl: 'Aandacht nodig', ar: 'يحتاج انتباهاً', en: 'Needs attention' },
  'ink.evenControleren': { nl: 'Even controleren', ar: 'تحقّق سريع', en: 'A quick check' },
  'ink.klaarBevestigen': { nl: 'Klaar om te bevestigen', ar: 'جاهزة للتأكيد', en: 'Ready to confirm' },
  'ink.bevestigd': { nl: 'Bevestigde inkoopfacturen', ar: 'فواتير المشتريات المؤكَّدة', en: 'Confirmed purchase invoices' },
  'ink.beheer': { nl: 'Beheer', ar: 'إدارة', en: 'Manage' },
  'ink.selecteer': { nl: 'Selecteer', ar: 'تحديد', en: 'Select' },
  'ink.klaar': { nl: 'Klaar', ar: 'تم', en: 'Done' },
  'ink.sluit': { nl: 'Sluit', ar: 'إغلاق', en: 'Close' },
  'ink.meldingSluiten': { nl: 'Melding sluiten', ar: 'إغلاق التنبيه', en: 'Close the notice' },
  'ink.toevoegen': { nl: 'Toevoegen', ar: 'إضافة', en: 'Add' },
  'ink.bewerken': { nl: 'Bewerken', ar: 'تعديل', en: 'Edit' },
  'ink.negeer': { nl: 'Negeer', ar: 'تجاهل', en: 'Ignore' },
  'ink.annuleer': { nl: 'Annuleer', ar: 'ألغِ', en: 'Cancel' },
  'ink.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'ink.opheffen': { nl: 'Opheffen', ar: 'إلغاء التجاهل', en: 'Undo' },

  'ink.factuurBevestigen': { nl: 'Factuur bevestigen', ar: 'تأكيد الفاتورة', en: 'Confirm the invoice' },
  'ink.controleerBedragen': { nl: 'Controleer de bedragen. AI heeft ze automatisch uitgelezen.', ar: 'تحقّق من المبالغ — قرأها الذكاء الاصطناعي تلقائياً.', en: 'Check the amounts. AI read them automatically.' },
  'ink.afzender': { nl: 'Afzender', ar: 'المُرسِل', en: 'Sender' },
  'ink.bron': { nl: 'Bron', ar: 'المصدر', en: 'Source' },
  'ink.factuurnummer': { nl: 'Factuurnummer', ar: 'رقم الفاتورة', en: 'Invoice number' },
  'ink.bedragExcl': { nl: 'Bedrag excl. BTW', ar: 'المبلغ بدون ضريبة', en: 'Amount excl. VAT' },
  'ink.totaal': { nl: 'Totaal', ar: 'الإجمالي', en: 'Total' },
  'ink.totaalUitleg': { nl: 'Totaalbedrag inclusief BTW — zoals het onderaan de factuur staat', ar: 'الإجمالي شامل الضريبة — كما هو مذكور أسفل الفاتورة', en: 'Total including VAT — as printed at the bottom of the invoice' },
  'ink.datumOntbreekt': { nl: 'Factuurdatum ontbreekt — verplicht om te bevestigen.', ar: 'تاريخ الفاتورة ناقص — وهو إلزامي للتأكيد.', en: 'The invoice date is missing — required to confirm.' },
  'ink.isCreditnota': { nl: 'Dit is een creditnota', ar: 'هذه إشعار دائن', en: 'This is a credit note' },
  'ink.creditnota': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },
  'ink.hoeBetaald': { nl: 'Hoe is deze factuur betaald?', ar: 'كيف دُفعت هذه الفاتورة؟', en: 'How was this invoice paid?' },
  'ink.markeerBetaald': { nl: 'Markeer als betaald', ar: 'علّمها كمدفوعة', en: 'Mark as paid' },
  'ink.betaaldBedrag': { nl: 'Betaald bedrag', ar: 'المبلغ المدفوع', en: 'Amount paid' },
  'ink.betaaldatum': { nl: 'Betaaldatum', ar: 'تاريخ الدفع', en: 'Payment date' },
  'ink.anderRekening': { nl: 'Ander rekeningnummer', ar: 'رقم حساب آخر', en: 'A different account number' },
  'ink.bonVermeldt': { nl: 'De bon vermeldt', ar: 'الإيصال يذكر', en: 'The receipt states' },
  'ink.kassabon': { nl: 'Kassabon — waarschijnlijk al betaald. Controleer en bevestig.', ar: 'إيصال كاشير — على الأغلب مدفوع مسبقاً. تحقّق وأكّد.', en: 'A till receipt — probably already paid. Check and confirm.' },
  'ink.bekijkControles': { nl: 'Bekijk factuur en controles', ar: 'اعرض الفاتورة والفحوصات', en: 'View the invoice and its checks' },
  'ink.naarControle': { nl: 'Naar controle', ar: 'إلى الفحص', en: 'To review' },
  'ink.terugzetten': { nl: 'Terugzetten naar wachtrij', ar: 'إعادتها إلى قائمة الانتظار', en: 'Put back in the queue' },

  'ink.meerderePaginas': { nl: 'Factuur met meerdere pagina&apos;s', ar: 'فاتورة من عدة صفحات', en: 'A multi-page invoice' },
  'ink.eenFactuurMeerPaginas': { nl: 'Eén factuur, meerdere pagina&apos;s', ar: 'فاتورة واحدة، عدة صفحات', en: 'One invoice, several pages' },
  'ink.neeAndere': { nl: 'Nee, andere factuur', ar: 'لا، فاتورة أخرى', en: 'No, a different invoice' },
  'ink.verwijderPagina': { nl: 'Verwijder pagina', ar: 'احذف الصفحة', en: 'Remove the page' },

  'ink.negeren.titel': { nl: 'Factuur negeren?', ar: 'تجاهل الفاتورة؟', en: 'Ignore this invoice?' },
  'ink.negeren.altijd': { nl: 'Altijd overslaan?', ar: 'تخطّيها دائماً؟', en: 'Always skip?' },
  'ink.negeren.bezig': { nl: 'Bezig met negeren…', ar: 'جارٍ التجاهل…', en: 'Ignoring…' },
  'ink.afzendersOverslaan': { nl: 'Afzenders die je overslaat', ar: 'المُرسِلون الذين تتخطّاهم', en: 'Senders you skip' },
  'ink.overgeslagen': { nl: 'Overgeslagen bij import', ar: 'ما تُخطّي أثناء الاستيراد', en: 'Skipped during import' },
  'ink.overgeslagenBekijk': { nl: 'Bekijk wat is overgeslagen bij het importeren', ar: 'اعرض ما تُخطّي أثناء الاستيراد', en: 'See what was skipped during import' },
  'ink.nietsOvergeslagen': { nl: 'Niets overgeslagen — alles wat binnenkwam is verwerkt.', ar: 'لم يُتخطَّ شيء — كل ما وصل عولج.', en: 'Nothing skipped — everything that arrived was processed.' },
  // De vaste overslaan-redenen. De vierde tak — een door AI geschreven Nederlandse reden uit de
  // database — blijft staan zoals hij is opgeslagen: opgeslagen tekst is data, geen catalogus.
  'ink.reden.onleesbaar': { nl: 'kon niet gelezen worden — staat in je bestanden', ar: 'تعذّرت قراءتها — موجودة في ملفاتك', en: 'could not be read — it is in your files' },
  'ink.reden.geenFactuur': { nl: 'leek geen factuur', ar: 'لا تبدو فاتورة', en: 'did not look like an invoice' },
  'ink.reden.geenBijlage': { nl: 'e-mail zonder leesbare bijlage', ar: 'رسالة بلا مرفق قابل للقراءة', en: 'an e-mail without a readable attachment' },
  'ink.nietsCorrigeren': { nl: 'Niets om te corrigeren', ar: 'لا شيء للتصحيح', en: 'Nothing to correct' },
  'ink.vakerCorrigeert': { nl: 'Wat je hier vaker corrigeert', ar: 'ما تصحّحه هنا كثيراً', en: 'What you correct here often' },

  'ink.email.verbind': { nl: 'Verbind je e-mail', ar: 'اربط بريدك الإلكتروني', en: 'Connect your e-mail' },
  'ink.email.automatisch': { nl: 'Facturen komen automatisch binnen — je hoeft niets meer door te sturen.', ar: 'تصل الفواتير تلقائياً — لن تحتاج إلى إعادة توجيه شيء.', en: 'Invoices arrive automatically — nothing to forward any more.' },
  'ink.email.verwijderen': { nl: 'E-mailverbinding verwijderen', ar: 'إزالة ربط البريد الإلكتروني', en: 'Remove the e-mail connection' },
  'ink.email.gestopt': { nl: 'Automatisch inlezen is gestopt', ar: 'توقّفت القراءة التلقائية', en: 'Automatic reading has stopped' },
  'ink.email.ouderOphalen': { nl: 'Mis je een factuur? Oudere e-mails opnieuw ophalen…', ar: 'أتنقصك فاتورة؟ أعد جلب الرسائل الأقدم…', en: 'Missing an invoice? Fetch older e-mails again…' },
  'ink.email.misFactuur': { nl: 'Mis je een factuur die hier', ar: 'أتنقصك فاتورة كان يجب أن تظهر هنا', en: 'Missing an invoice that should be here' },
  'ink.ophalenVanaf': { nl: 'Ophalen vanaf', ar: 'الجلب اعتباراً من', en: 'Fetch from' },
  'ink.opnieuwInlezen': { nl: 'Alle facturen die aandacht nodig hebben opnieuw inlezen', ar: 'أعد قراءة كل الفواتير التي تحتاج انتباهاً', en: 'Re-read every invoice that needs attention' },
  'ink.opnieuwBezig': { nl: 'Bezig met opnieuw inlezen…', ar: 'جارٍ إعادة القراءة…', en: 'Re-reading…' },
  'ink.verifierenBezig': { nl: 'Bezig met verifiëren…', ar: 'جارٍ التدقيق…', en: 'Verifying…' },
  'ink.bekijkBestanden': { nl: 'Bekijk in bestanden', ar: 'اعرض في الملفات', en: 'View in files' },

  // ─── [INKOOP] Het beheer van bevestigde inkoopfacturen ──────────────────────────────────────
  // Hergebruikt ink.* waar dezelfde woorden al bestaan; hier alleen wat uniek is voor dit scherm.

  'inkoop.leeg': { nl: 'Geen inkoopfacturen', ar: 'لا فواتير مشتريات', en: 'No purchase invoices' },
  'inkoop.leeg.sub': { nl: 'Bevestigde inkoopfacturen verschijnen hier', ar: 'تظهر هنا فواتير المشتريات المؤكَّدة', en: 'Confirmed purchase invoices appear here' },
  'inkoop.leverancier': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'inkoop.naam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'inkoop.bedrag': { nl: 'Bedrag', ar: 'المبلغ', en: 'Amount' },
  'inkoop.methode': { nl: 'Methode', ar: 'الطريقة', en: 'Method' },
  'inkoop.kenmerk': { nl: 'Kenmerk', ar: 'المرجع', en: 'Reference' },
  'inkoop.factuurdatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'inkoop.vervaldatum': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'inkoop.sorteren': { nl: 'Sorteren', ar: 'ترتيب', en: 'Sort' },
  'inkoop.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'inkoop.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'inkoop.duidelijk': { nl: 'Duidelijk', ar: 'مفهوم', en: 'Got it' },
  'inkoop.allePeriodes': { nl: 'Toon alle periodes', ar: 'اعرض كل الفترات', en: 'Show all periods' },
  'inkoop.opnieuwProberen': { nl: 'Opnieuw proberen', ar: 'حاول مرة أخرى', en: 'Try again' },
  'inkoop.verwerkt': { nl: 'Verwerkt', ar: 'معالَجة', en: 'Processed' },
  'inkoop.voorbereid': { nl: 'Voorbereid', ar: 'مُجهَّزة', en: 'Prepared' },
  'inkoop.automatisch': { nl: 'Automatisch', ar: 'تلقائي', en: 'Automatic' },

  'inkoop.betalen': { nl: 'Betalen', ar: 'ادفع', en: 'Pay' },
  'inkoop.hebJeBetaald': { nl: 'Heb je betaald?', ar: 'هل دفعت؟', en: 'Did you pay?' },
  'inkoop.betalingVerstuurd': { nl: 'Heb je de betaling verstuurd?', ar: 'هل أرسلت الدفعة؟', en: 'Did you send the payment?' },
  'inkoop.jaBetaald': { nl: 'Ja, ik heb betaald', ar: 'نعم، دفعت', en: 'Yes, I paid' },
  'inkoop.nogNiet': { nl: 'Nog niet', ar: 'ليس بعد', en: 'Not yet' },
  'inkoop.tochBetaald': { nl: 'Toch markeren als betaald', ar: 'علّمها كمدفوعة رغم ذلك', en: 'Mark as paid anyway' },
  'inkoop.opBetaald': { nl: 'Op betaald gezet', ar: 'وُضعت كمدفوعة', en: 'Marked as paid' },
  'inkoop.genoteerd': { nl: 'Genoteerd — factuur blijft open als te betalen', ar: 'سُجّل — تبقى الفاتورة مفتوحة كمستحقة للدفع', en: 'Noted — the invoice stays open as payable' },
  'inkoop.mogelijkBetaald': { nl: 'Mogelijk al betaald', ar: 'ربما دُفعت مسبقاً', en: 'Possibly already paid' },
  'inkoop.bonAfgerekend': { nl: 'Bon · al afgerekend', ar: 'إيصال · مدفوع مسبقاً', en: 'Receipt · already settled' },
  'inkoop.waarvoorKost': { nl: 'Waarvoor is deze kost?', ar: 'علامَ هذه الكلفة؟', en: 'What is this cost for?' },
  'inkoop.incassoIngesteld': { nl: 'Automatische incasso ingesteld', ar: 'ضُبط الخصم التلقائي', en: 'Direct debit set up' },
  'inkoop.geboektCredit': { nl: 'Geboekt als creditnota — gaat van je openstaande saldo af', ar: 'قُيّدت كإشعار دائن — تُخصم من رصيدك المفتوح', en: 'Booked as a credit note — comes off your outstanding balance' },
  'inkoop.cijfersLeverancier': { nl: 'Cijfers van de leverancier', ar: 'أرقام المورّد', en: "The supplier's figures" },
  // De belangrijkste geruststelling op dit scherm: deze cijfers zijn niet GELEZEN maar exact wat
  // de leverancier zelf heeft opgestuurd. De zin draagt het waarom, dus hij verhuist als geheel.
  'inkoop.eFactuurUitleg': {
    nl: 'De bedragen op deze factuur komen uit de e-factuur die de leverancier zelf heeft meegestuurd ({syntax}). Er is niets van een pagina gelezen en niets geïnterpreteerd — dit is exact wat de leverancier heeft opgegeven. Deze hoef je niet na te kijken.',
    ar: 'مبالغ هذه الفاتورة مأخوذة من الفاتورة الإلكترونية التي أرفقها المورّد بنفسه ({syntax}). لم يُقرأ شيء من صفحة ولم يُفسَّر شيء — هذا بالضبط ما صرّح به المورّد. لا تحتاج لمراجعتها.',
    en: 'The amounts on this invoice come from the e-invoice the supplier attached themselves ({syntax}). Nothing was read off a page and nothing was interpreted — this is exactly what the supplier stated. You do not need to check it.',
  },
  'inkoop.bedragenCorrigeren': { nl: 'Bedragen corrigeren', ar: 'تصحيح المبالغ', en: 'Correct the amounts' },
  'inkoop.bekijkBetaalde': { nl: 'Bekijk de betaalde factuur', ar: 'اعرض الفاتورة المدفوعة', en: 'View the paid invoice' },
  'inkoop.bekijkBank': { nl: 'Bekijk op de Bank-pagina', ar: 'اعرضها في صفحة البنك', en: 'View on the Bank page' },
  'inkoop.betalingVerplaatsen': { nl: 'Betaling verplaatsen', ar: 'نقل الدفعة', en: 'Move the payment' },
  'inkoop.meerdereAnnuleren': { nl: 'Meerdere annuleren', ar: 'إلغاء عدة عناصر', en: 'Cancel several' },
  'inkoop.dubbeleVerwijderen': { nl: 'Deze dubbele verwijderen', ar: 'احذف هذه المكرّرة', en: 'Remove this duplicate' },
  'inkoop.dubbeleVerwijderd': { nl: 'Dubbele factuur verwijderd', ar: 'حُذفت الفاتورة المكرّرة', en: 'Duplicate invoice removed' },
  'inkoop.origineelToegevoegd': { nl: 'Origineel toegevoegd. De boekhouder kan de factuur nu controleren.', ar: 'أُضيف الأصل. يستطيع المحاسب الآن تدقيق الفاتورة.', en: 'Original added. The accountant can now check the invoice.' },
  'inkoop.opnieuwIngelezen': { nl: 'Opnieuw ingelezen.', ar: 'أُعيدت قراءتها.', en: 'Re-read.' },

  // Fouten en offline — elke zin zegt wat er NIET is gebeurd.
  'inkoop.fout.nietOpenen': { nl: 'Deze factuur konden we hier niet openen — zoek hem op in de lijst', ar: 'تعذّر فتح هذه الفاتورة هنا — ابحث عنها في القائمة', en: 'Could not open this invoice here — find it in the list' },
  'inkoop.fout.ophalen': { nl: 'We konden je inkoopfacturen niet ophalen', ar: 'تعذّر جلب فواتير مشترياتك', en: 'Could not fetch your purchase invoices' },
  'inkoop.fout.incassoOphalen': { nl: 'We konden je automatische incasso&apos;s niet ophalen', ar: 'تعذّر جلب خصومك التلقائية', en: 'Could not fetch your direct debits' },
  'inkoop.fout.onvolledig': { nl: 'Dit telt alleen op wat we konden ophalen — er ontbreken facturen.', ar: 'هذا يجمع فقط ما استطعنا جلبه — ثمة فواتير ناقصة.', en: 'This only adds up what we could fetch — invoices are missing.' },
  'inkoop.fout.geenBoeking': { nl: 'Van deze betaling is geen boeking gevonden om te verplaatsen', ar: 'لم يُعثر لهذه الدفعة على قيد لنقله', en: 'No booking was found for this payment to move' },
  'inkoop.fout.nietsOpen': { nl: 'Er stond nog niets open dat al afgeschreven was.', ar: 'لم يكن ثمة شيء مفتوح خُصم مسبقاً.', en: 'Nothing open had already been debited.' },
  'inkoop.fout.matchen': { nl: 'Matchen mislukt — probeer het opnieuw', ar: 'فشلت المطابقة — حاول مرة أخرى', en: 'Matching failed — please try again' },
  'inkoop.fout.instellen': { nl: 'Instellen mislukt — controleer je verbinding', ar: 'فشل الضبط — تحقّق من اتصالك', en: 'Setting up failed — check your connection' },
  'inkoop.fout.narekenen': { nl: 'Narekenen is niet gelukt — controleer je verbinding.', ar: 'فشلت إعادة الحساب — تحقّق من اتصالك.', en: 'Recalculating failed — check your connection.' },
  'inkoop.fout.opnieuwInlezen': { nl: 'Opnieuw inlezen is niet gelukt — controleer je verbinding.', ar: 'فشلت إعادة القراءة — تحقّق من اتصالك.', en: 'Re-reading failed — check your connection.' },
  'inkoop.fout.toevoegen': { nl: 'Toevoegen is niet gelukt — controleer je verbinding.', ar: 'فشلت الإضافة — تحقّق من اتصالك.', en: 'Adding failed — check your connection.' },
  'inkoop.fout.offlineNiets': { nl: 'Geen verbinding — er is niets gewijzigd', ar: 'لا يوجد اتصال — لم يتغيّر شيء', en: 'No connection — nothing was changed' },
  'inkoop.fout.offline': { nl: 'Geen verbinding — probeer opnieuw', ar: 'لا يوجد اتصال — حاول مرة أخرى', en: 'No connection — please try again' },

  // ─── [BANK] Het bankscherm — waar afschriften binnenkomen en betalingen boeken ──────────────

  'bank.zoek': { nl: 'Zoek op naam, omschrijving, IBAN, bedrag of datum', ar: 'ابحث بالاسم أو الوصف أو IBAN أو المبلغ أو التاريخ', en: 'Search by name, description, IBAN, amount or date' },
  'bank.zoek.aria': { nl: 'Transacties zoeken', ar: 'البحث في المعاملات', en: 'Search transactions' },
  'bank.zoek.wissen': { nl: 'Wis zoekopdracht', ar: 'مسح البحث', en: 'Clear the search' },
  'bank.upload.sleep': { nl: 'Sleep je bestand hierheen of klik om te kiezen', ar: 'اسحب ملفك إلى هنا أو انقر للاختيار', en: 'Drag your file here or click to choose' },
  'bank.upload.als': { nl: 'Upload je afschrift als', ar: 'ارفع كشفك بصيغة', en: 'Upload your statement as' },
  'bank.afschriften': { nl: 'Geüploade afschriften', ar: 'الكشوف المرفوعة', en: 'Uploaded statements' },
  'bank.afschrift.verwijderen': { nl: 'Bankafschrift verwijderen', ar: 'حذف كشف الحساب', en: 'Delete the bank statement' },
  'bank.afschrift.verwijderenVraag': { nl: 'Bankafschrift verwijderen?', ar: 'حذف كشف الحساب؟', en: 'Delete this bank statement?' },
  'bank.afschrift.verwijderenZeker': { nl: 'Weet je zeker dat je dit bankafschrift wilt verwijderen?', ar: 'هل أنت متأكد من حذف كشف الحساب هذا؟', en: 'Are you sure you want to delete this bank statement?' },
  'bank.afschrift.verwijderd': { nl: 'Bankafschrift verwijderd ✓', ar: 'حُذف كشف الحساب ✓', en: 'Bank statement deleted ✓' },
  'bank.rustig': { nl: 'Alleen wat jouw aandacht nodig heeft is overgebleven.', ar: 'لم يبقَ إلا ما يحتاج انتباهك.', en: 'Only what needs your attention remains.' },
  'bank.categorie': { nl: 'Geef deze regels een categorie', ar: 'أعطِ هذه البنود تصنيفاً', en: 'Give these lines a category' },

  'bank.koppelen': { nl: 'Koppelen', ar: 'ربط', en: 'Link' },
  'bank.bevestig': { nl: 'Bevestig', ar: 'أكِّد', en: 'Confirm' },
  'bank.bevestigBetaling': { nl: 'Bevestig betaling', ar: 'أكِّد الدفعة', en: 'Confirm the payment' },
  'bank.alBevestigd': { nl: 'Al bevestigd ✓', ar: 'مؤكَّدة مسبقاً ✓', en: 'Already confirmed ✓' },
  'bank.selecteerBevestigen': { nl: 'Selecteer voor bevestigen', ar: 'حدّد للتأكيد', en: 'Select to confirm' },
  'bank.bekijkFactuur': { nl: 'Bekijk factuur', ar: 'اعرض الفاتورة', en: 'View the invoice' },
  'bank.andereFactuur': { nl: 'Andere factuur', ar: 'فاتورة أخرى', en: 'A different invoice' },
  'bank.details': { nl: 'Details', ar: 'التفاصيل', en: 'Details' },
  'bank.begrepen': { nl: 'Begrepen', ar: 'فهمت', en: 'Got it' },
  'bank.negeren': { nl: 'Negeren', ar: 'تجاهل', en: 'Ignore' },
  'bank.genegeerd': { nl: 'Genegeerd', ar: 'مُتجاهَلة', en: 'Ignored' },
  'bank.genegeerdWeg': { nl: 'Genegeerd — staat niet in de actieve lijst.', ar: 'تُجوهلت — ليست في القائمة النشطة.', en: 'Ignored — not in the active list.' },
  'bank.transactieGenegeerd': { nl: 'Transactie genegeerd', ar: 'تُجوهلت المعاملة', en: 'Transaction ignored' },
  'bank.zonderReden': { nl: 'Zonder reden', ar: 'بلا سبب', en: 'No reason' },
  'bank.geenNummerVerbergen': { nl: 'Geen factuurnummer — verbergen', ar: 'لا رقم فاتورة — إخفاء', en: 'No invoice number — hide it' },
  'bank.geenFactuurVerberg': { nl: 'Dit nummer is geen factuur, verberg het', ar: 'هذا الرقم ليس فاتورة، أخفِه', en: 'This number is not an invoice, hide it' },
  'bank.gecontroleerd': { nl: 'Gecontroleerd — de melding is weg.', ar: 'تم التحقّق — زال التنبيه.', en: 'Checked — the notice is gone.' },
  'bank.teruggezet': { nl: 'Teruggezet', ar: 'أُعيدت', en: 'Put back' },

  'bank.verdelen': { nl: 'Verdelen over facturen', ar: 'توزيعها على الفواتير', en: 'Split across invoices' },
  'bank.meerFacturen': { nl: 'Deze betaling hoort bij meer dan één factuur', ar: 'هذه الدفعة تخص أكثر من فاتورة', en: 'This payment belongs to more than one invoice' },
  'bank.deelBoeken': { nl: 'Alleen dit deel boeken', ar: 'قيّد هذا الجزء فقط', en: 'Book only this part' },
  'bank.helesBedrag': { nl: 'Toch het hele bedrag op deze factuur', ar: 'المبلغ كاملاً على هذه الفاتورة رغم ذلك', en: 'The whole amount on this invoice anyway' },
  'bank.periodeDekt': { nl: 'De periode die deze betaling dekt', ar: 'الفترة التي تغطّيها هذه الدفعة', en: 'The period this payment covers' },
  'bank.betalingVerplaatsen': { nl: 'Betaling verplaatsen', ar: 'نقل الدفعة', en: 'Move the payment' },
  'bank.vergelijk': { nl: 'Meerdere facturen passen bij deze betaling. Vergelijk', ar: 'عدة فواتير تطابق هذه الدفعة. قارن', en: 'Several invoices match this payment. Compare' },
  'bank.automatischOp': { nl: 'Automatisch gekoppeld op', ar: 'رُبطت تلقائياً بتاريخ', en: 'Automatically linked on' },
  'bank.gegevensCorrigeren': { nl: 'Gegevens corrigeren', ar: 'تصحيح البيانات', en: 'Correct the details' },
  'bank.toevoegenOfOphalen': { nl: 'Factuur toevoegen of e-mail opnieuw ophalen', ar: 'أضف فاتورة أو أعد جلب البريد', en: 'Add an invoice or re-fetch the e-mail' },
  'bank.toegevoegdGeboekt': { nl: 'Factuur toegevoegd en geboekt — je kunt de betaling nu verdelen.', ar: 'أُضيفت الفاتورة وقُيّدت — يمكنك الآن توزيع الدفعة.', en: 'Invoice added and booked — you can now split the payment.' },
  'bank.maximaal': { nl: 'Er wordt maximaal', ar: 'سيُقيَّد كحدّ أقصى', en: 'At most' },

  'bank.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'bank.fout.bevestigen': { nl: 'Bevestigen mislukt.', ar: 'فشل التأكيد.', en: 'Confirming failed.' },
  'bank.fout.bijwerken': { nl: 'Bijwerken mislukt.', ar: 'فشل التحديث.', en: 'Updating failed.' },
  'bank.fout.matchen': { nl: 'Matchen mislukt.', ar: 'فشلت المطابقة.', en: 'Matching failed.' },
  'bank.fout.negeren': { nl: 'Negeren mislukt.', ar: 'فشل التجاهل.', en: 'Ignoring failed.' },
  'bank.fout.ontkoppelen': { nl: 'Ontkoppelen mislukt.', ar: 'فشل فكّ الربط.', en: 'Unlinking failed.' },
  'bank.fout.ophalen': { nl: 'Ophalen mislukt.', ar: 'فشل الجلب.', en: 'Fetching failed.' },
  'bank.fout.opslaan': { nl: 'Kon niet opslaan. Probeer het nog een keer.', ar: 'تعذّر الحفظ. حاول مرة أخرى.', en: 'Could not save. Please try again.' },
  'bank.fout.terugzetten': { nl: 'Terugzetten mislukt.', ar: 'فشلت الإعادة.', en: 'Putting back failed.' },
  'bank.fout.opnieuw': { nl: 'Opnieuw proberen is niet gelukt.', ar: 'لم تنجح إعادة المحاولة.', en: 'Retrying did not work.' },
  'bank.fout.automatisch': { nl: 'Automatisch afhandelen mislukt.', ar: 'فشلت المعالجة التلقائية.', en: 'Automatic handling failed.' },
  'bank.fout.factuurOpenen': { nl: 'Kon de factuur niet openen.', ar: 'تعذّر فتح الفاتورة.', en: 'Could not open the invoice.' },
  'bank.fout.factuurOphalen': { nl: 'Deze factuur kon niet worden opgehaald — controleer je verbinding.', ar: 'تعذّر جلب هذه الفاتورة — تحقّق من اتصالك.', en: 'This invoice could not be fetched — check your connection.' },
  'bank.fout.geenFactuur': { nl: 'Geen factuur gevonden voor deze transactie.', ar: 'لم يُعثر على فاتورة لهذه المعاملة.', en: 'No invoice found for this transaction.' },
  'bank.fout.geenBoeking': { nl: 'Geen geboekte betaling gevonden op deze regel.', ar: 'لا قيد دفع على هذا البند.', en: 'No booked payment found on this line.' },
  'bank.fout.geenNummers': { nl: 'Geen factuurnummers meer. Is dit geen factuur? Gebruik Negeren.', ar: 'لم تعد ثمة أرقام فواتير. أليست فاتورة؟ استخدم «تجاهل».', en: 'No invoice numbers left. Not an invoice? Use Ignore.' },
  'bank.fout.alToegewezen': { nl: 'Deze betaling is al volledig toegewezen aan facturen.', ar: 'هذه الدفعة وُزّعت بالكامل على فواتير.', en: 'This payment is already fully assigned to invoices.' },
  'bank.fout.groep': { nl: 'Ontkoppelen van een groepsbetaling kan hier nog niet.', ar: 'فكّ ربط دفعة جماعية غير ممكن هنا بعد.', en: 'Unlinking a group payment is not possible here yet.' },
  'bank.fout.verwerkt': { nl: 'De boekhouder heeft deze factuur al verwerkt — vraag eerst om dat ongedaan te maken.', ar: 'المحاسب عالج هذه الفاتورة مسبقاً — اطلب أولاً التراجع عن ذلك.', en: 'The accountant already processed this invoice — first ask to undo that.' },
  'bank.fout.netGedaan': { nl: 'Even wachten — je hebt dit net al gedaan.', ar: 'انتظر قليلاً — فعلت هذا للتو.', en: 'One moment — you just did this.' },
  'bank.fout.bedragNul': { nl: 'Vul een bedrag groter dan nul in.', ar: 'أدخل مبلغاً أكبر من صفر.', en: 'Enter an amount above zero.' },
  'bank.fout.offlineNiets': { nl: 'Geen verbinding — er is niets gewijzigd.', ar: 'لا يوجد اتصال — لم يتغيّر شيء.', en: 'No connection — nothing was changed.' },
  'bank.fout.offline': { nl: 'Geen verbinding — probeer opnieuw.', ar: 'لا يوجد اتصال — حاول مرة أخرى.', en: 'No connection — please try again.' },
  'bank.fout.toevoegen': { nl: 'Toevoegen mislukt — controleer je verbinding.', ar: 'فشلت الإضافة — تحقّق من اتصالك.', en: 'Adding failed — check your connection.' },
  'bank.fout.nietUitgelezen': { nl: 'Transacties niet uitgelezen', ar: 'لم تُقرأ المعاملات', en: 'Transactions not read' },
  'bank.waarschuwing.sluitNiet': { nl: '⚠️ Bankafschrift sluit niet aan — mogelijk ontbreekt een transactie. Zie de melding.', ar: '⚠️ كشف الحساب غير متطابق — قد تنقص معاملة. انظر التنبيه.', en: '⚠️ The statement does not reconcile — a transaction may be missing. See the notice.' },
  'bank.waarschuwing.gat': { nl: '⚠️ Er ontbreekt een stuk bankgeschiedenis — zie de melding.', ar: '⚠️ ثمة فجوة في تاريخ الحساب — انظر التنبيه.', en: '⚠️ A stretch of bank history is missing — see the notice.' },

  // ─── [KAS] Het kasboek ──────────────────────────────────────────────────────────────────────

  'kas.zoek': { nl: 'Zoek in boekingen (omschrijving, categorie, bedrag)…', ar: 'ابحث في القيود (الوصف، التصنيف، المبلغ)…', en: 'Search entries (description, category, amount)…' },
  'kas.zoek.aria': { nl: 'Kasboekingen zoeken', ar: 'البحث في قيود الصندوق', en: 'Search cash entries' },
  'kas.leeg': { nl: 'Geen kasbewegingen in dit kwartaal.', ar: 'لا حركات نقدية في هذا الربع.', en: 'No cash movements this quarter.' },
  'kas.ontvangen': { nl: 'Ontvangen', ar: 'المقبوض', en: 'Received' },
  'kas.uitgegeven': { nl: 'Uitgegeven', ar: 'المصروف', en: 'Spent' },
  'kas.datum': { nl: 'Datum', ar: 'التاريخ', en: 'Date' },
  'kas.beginsaldo': { nl: 'Beginsaldo kwartaal', ar: 'الرصيد الافتتاحي للربع', en: 'Opening balance for the quarter' },
  'kas.eindsaldo': { nl: 'Eindsaldo kwartaal', ar: 'الرصيد الختامي للربع', en: 'Closing balance for the quarter' },
  'kas.beginsaldoKort': { nl: 'Beginsaldo kas:', ar: 'الرصيد الافتتاحي للصندوق:', en: 'Opening cash balance:' },
  'kas.beginsaldoEuro': { nl: 'Beginsaldo kas €', ar: 'الرصيد الافتتاحي للصندوق €', en: 'Opening cash balance €' },
  'kas.beginsaldoNegatief': { nl: 'Beginsaldo moet 0 of hoger zijn', ar: 'يجب أن يكون الرصيد الافتتاحي 0 أو أكثر', en: 'The opening balance must be 0 or higher' },
  'kas.vorigKwartaal': { nl: 'Vorig kwartaal', ar: 'الربع السابق', en: 'Previous quarter' },
  'kas.volgendKwartaal': { nl: 'Volgend kwartaal', ar: 'الربع التالي', en: 'Next quarter' },
  'kas.contantToevoegen': { nl: 'Contant betaalde factuur toevoegen', ar: 'أضف فاتورة دُفعت نقداً', en: 'Add a cash-paid invoice' },
  'kas.negatiefSaldo': { nl: 'Negatief saldo — je hebt meer uitgaven dan ontvangsten geboekt.', ar: 'رصيد سالب — قيّدت مصروفات أكثر من المقبوضات.', en: 'Negative balance — you booked more spending than receipts.' },
  'kas.fout.laden': { nl: 'Kon het kasboek niet laden.', ar: 'تعذّر تحميل دفتر الصندوق.', en: 'Could not load the cash book.' },
  'kas.fout.saldo': { nl: 'We konden je kassaldo niet laden', ar: 'تعذّر تحميل رصيد صندوقك', en: 'Could not load your cash balance' },
  'kas.fout.controle': { nl: 'We konden je kasboek nu niet controleren', ar: 'تعذّر فحص دفتر صندوقك الآن', en: 'Could not check your cash book right now' },
  'kas.fout.verwijderd': { nl: 'Geen verbinding — de boeking is niet verwijderd.', ar: 'لا يوجد اتصال — لم يُحذف القيد.', en: 'No connection — the entry was not deleted.' },
  'kas.fout.verbinding': { nl: 'Verbinding mislukt', ar: 'فشل الاتصال', en: 'Connection failed' },
  'kas.fout.bedragNul': { nl: 'Vul een bedrag groter dan 0 in.', ar: 'أدخل مبلغاً أكبر من 0.', en: 'Enter an amount above 0.' },
  // Drie zinnen met nadruk middenin. De <strong> is opgeofferd (zie nieuw.bevestig.uitleg):
  // opmaak middenin een zin knipt hem stuk voor vertalers, en het woord draagt de nadruk zelf.
  'kas.fout.saldoNiet': { nl: 'Het bedrag hieronder is daarom NIET je echte saldo. Probeer het opnieuw.', ar: 'المبلغ أدناه ليس إذاً رصيدك الحقيقي. حاول مرة أخرى.', en: 'The amount below is therefore NOT your real balance. Try again.' },
  'kas.fout.controleNiet': { nl: 'De controle op een negatief kassaldo is daarom NIET uitgevoerd — dit betekent niet dat er niets aan de hand is. Open het kasboek hieronder om het opnieuw te proberen.', ar: 'لم يُجرَ إذاً فحص الرصيد السالب — وهذا لا يعني أن كل شيء سليم. افتح دفتر الصندوق أدناه لإعادة المحاولة.', en: 'The negative-balance check therefore did NOT run — which does not mean nothing is wrong. Open the cash book below to try again.' },
  'kas.fout.ladenNietLeeg': { nl: 'Kon de boekingen niet laden. Dit is NIET hetzelfde als een lege kas — probeer het opnieuw.', ar: 'تعذّر تحميل القيود. هذا ليس كصندوق فارغ — حاول مرة أخرى.', en: 'Could not load the entries. That is NOT the same as an empty till — try again.' },
  'kas.opnieuw': { nl: 'Opnieuw', ar: 'أعد المحاولة', en: 'Again' },

  // ─── [VANDAAG] De takenlijst van vandaag ────────────────────────────────────────────────────

  'vandaag.aandacht': { nl: 'Dit heeft vandaag je aandacht nodig.', ar: 'هذا ما يحتاج انتباهك اليوم.', en: 'This needs your attention today.' },
  'vandaag.nietsNodig': { nl: 'Niets dat nu je aandacht nodig heeft', ar: 'لا شيء يحتاج انتباهك الآن', en: 'Nothing needs your attention right now' },
  'vandaag.geenVervallen': { nl: 'Geen facturen die binnen 3 dagen vervallen of te laat zijn.', ar: 'لا فواتير تستحق خلال 3 أيام أو متأخرة.', en: 'No invoices due within 3 days or overdue.' },
  'vandaag.teBetalen': { nl: 'Te betalen', ar: 'مستحقة للدفع', en: 'To pay' },
  'vandaag.jijBetalen': { nl: 'Facturen die jij moet betalen', ar: 'فواتير عليك دفعها', en: 'Invoices you need to pay' },
  'vandaag.onbetaald': { nl: 'Verstuurde facturen die nog niet betaald zijn', ar: 'فواتير مُرسَلة لم تُدفع بعد', en: 'Sent invoices not yet paid' },
  'vandaag.controleerKosten': { nl: 'Controleer ze zodat de kosten en BTW-aftrek in je boeken komen.', ar: 'دقّقها لتدخل التكاليف وخصم الضريبة في دفاترك.', en: 'Check them so the costs and VAT deduction reach your books.' },
  'vandaag.geenBetaallijst': { nl: 'Deze staan op geen betaallijst — controleer of betaal ze.', ar: 'ليست على أي قائمة دفع — دقّقها أو ادفعها.', en: 'These are on no payment list — check or pay them.' },
  'vandaag.alBetaald': { nl: 'Al betaald?', ar: 'مدفوعة مسبقاً؟', en: 'Already paid?' },
  'vandaag.deelbetaling': { nl: 'Deelbetaling of andere datum', ar: 'دفعة جزئية أو تاريخ آخر', en: 'Partial payment or a different date' },
  'vandaag.herinner': { nl: 'Herinner je klant', ar: 'ذكِّر عميلك', en: 'Remind your client' },
  'vandaag.verbergen': { nl: 'Verbergen', ar: 'إخفاء', en: 'Hide' },
  'vandaag.verbergenVandaag': { nl: 'Verbergen voor vandaag', ar: 'إخفاء لليوم', en: 'Hide for today' },
  'vandaag.betaaldRestant': { nl: 'Betaald met — vandaag, het restant van', ar: 'دُفعت بـ — اليوم، المتبقّي من', en: 'Paid with — today, the remainder of' },
  'vandaag.betaaldHeel': { nl: 'Betaald met — vandaag, het hele bedrag van', ar: 'دُفعت بـ — اليوم، المبلغ الكامل وقدره', en: 'Paid with — today, the full amount of' },
  'vandaag.betaaldOpen': { nl: 'Betaald met — vandaag, wat er nog openstaat:', ar: 'دُفعت بـ — اليوم، ما بقي مستحقاً:', en: 'Paid with — today, what is still outstanding:' },
  'vandaag.fout.ophalen': { nl: 'Er ging iets mis bij het ophalen. Dit betekent NIET dat je niets hoeft te doen — probeer het opnieuw.', ar: 'حدث خطأ أثناء الجلب. هذا لا يعني أنه ليس عليك فعل شيء — حاول مرة أخرى.', en: 'Something went wrong while fetching. That does NOT mean there is nothing to do — try again.' },
  'vandaag.fout.taken': { nl: 'We konden je taken niet laden', ar: 'تعذّر تحميل مهامك', en: 'Could not load your tasks' },

  // ─── [INSTELLINGEN] Het instellingenscherm ──────────────────────────────────────────────────

  'inst.profiel': { nl: 'Jouw profiel', ar: 'ملفك الشخصي', en: 'Your profile' },
  // Een voorbeeldNAAM is geen formaat (anders dan een postcode): hij mag meebewegen met de
  // taal, want zijn enige werk is tonen waar je naam hoort.
  'inst.naamVoorbeeld': { nl: 'Jan de Vries', ar: 'أحمد الحسن', en: 'Jan de Vries' },
  'inst.volledigeNaam': { nl: 'Volledige naam', ar: 'الاسم الكامل', en: 'Full name' },
  'inst.bedrijfsnaam': { nl: 'Bedrijfsnaam', ar: 'اسم الشركة', en: 'Company name' },
  'inst.adres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'inst.postcode': { nl: 'Postcode', ar: 'الرمز البريدي', en: 'Postcode' },
  'inst.stad': { nl: 'Stad', ar: 'المدينة', en: 'City' },
  'inst.stadInvullen': { nl: 'Vul je stad in', ar: 'أدخل مدينتك', en: 'Enter your city' },
  'inst.wachtwoord': { nl: 'Wachtwoord', ar: 'كلمة المرور', en: 'Password' },
  'inst.facturering': { nl: 'Facturering', ar: 'الفوترة', en: 'Billing' },
  'inst.plan': { nl: 'Je plan en je btw-facturen', ar: 'خطتك وفواتير الضريبة الخاصة بك', en: 'Your plan and your VAT invoices' },
  'inst.nummering': { nl: 'Factuurnummering', ar: 'ترقيم الفواتير', en: 'Invoice numbering' },
  'inst.kor': { nl: 'Ik gebruik de kleineondernemersregeling (KOR)', ar: 'أستخدم نظام صغار المنشآت (KOR)', en: 'I use the small-business scheme (KOR)' },
  'inst.vrijgesteld': { nl: 'Ik heb (deels) vrijgestelde omzet', ar: 'لدي إيراد مُعفى (جزئياً)', en: 'I have (partly) exempt turnover' },
  'inst.kasstelsel': { nl: 'Kasstelsel', ar: 'نظام القبض النقدي', en: 'Cash accounting' },
  'inst.factuurstelsel.uitleg': { nl: 'BTW telt op de factuurdatum. De meeste ondernemers gebruiken dit.', ar: 'تُحتسب الضريبة بتاريخ الفاتورة. معظم أصحاب الأعمال يستخدمون هذا.', en: 'VAT counts on the invoice date. Most businesses use this.' },
  'inst.toelichting': { nl: 'Toelichting op je factuur bij 0% of vrijgesteld', ar: 'التوضيح على فاتورتك عند 0% أو الإعفاء', en: 'The note on your invoice at 0% or exempt' },
  'inst.toelichtingVoorbeeld': { nl: 'Vrijgesteld van btw op grond van artikel 11-1-g Wet OB (zorg).', ar: 'مُعفى من الضريبة بموجب المادة 11-1-g من قانون ضريبة المبيعات (رعاية).', en: 'Exempt from VAT under article 11-1-g Wet OB (care).' },
  'inst.herinneringen': { nl: 'Stuur automatisch betalingsherinneringen', ar: 'أرسل تذكيرات دفع تلقائياً', en: 'Send payment reminders automatically' },
  'inst.herinnerNa': { nl: 'Herinner na (dagen na vervaldatum)', ar: 'ذكِّر بعد (أيام من تاريخ الاستحقاق)', en: 'Remind after (days past due)' },
  'inst.boekhouder': { nl: 'Jouw boekhouder', ar: 'محاسبك', en: 'Your accountant' },
  'inst.boekhouderKoppelen': { nl: 'Boekhouder koppelen', ar: 'ربط محاسب', en: 'Link an accountant' },
  'inst.ontkoppelen': { nl: 'Ontkoppelen', ar: 'فكّ الربط', en: 'Unlink' },
  'inst.team': { nl: 'Team', ar: 'الفريق', en: 'Team' },
  'inst.gevarenzone': { nl: 'Gevarenzone', ar: 'منطقة الخطر', en: 'Danger zone' },
  'inst.accountVerwijderen': { nl: 'Account verwijderen', ar: 'حذف الحساب', en: 'Delete account' },
  'inst.eerstExporteren': { nl: 'Verwijderen is pas mogelijk nadat je je gegevens hebt geëxporteerd.', ar: 'الحذف ممكن فقط بعد تصدير بياناتك.', en: 'Deleting is only possible after you have exported your data.' },

  // ─── [WAARHEID] Het cijferscherm — omzet, kosten, winst, live ───────────────────────────────

  'wh.omzet': { nl: 'Omzet', ar: 'الإيراد', en: 'Turnover' },
  'wh.kosten': { nl: 'Kosten', ar: 'التكاليف', en: 'Costs' },
  'wh.overhouden': { nl: 'Wat je overhoudt', ar: 'ما يتبقّى لك', en: 'What you keep' },
  'wh.overOmzet': { nl: 'Over je omzet', ar: 'على إيرادك', en: 'On your turnover' },
  'wh.overInkopen': { nl: 'Over je inkopen', ar: 'على مشترياتك', en: 'On your purchases' },
  'wh.vorigJaar': { nl: 'Vorig jaar', ar: 'السنة الماضية', en: 'Previous year' },
  'wh.volgendJaar': { nl: 'Volgend jaar', ar: 'السنة التالية', en: 'Next year' },
  'wh.berekenen': { nl: 'Bezig met berekenen…', ar: 'جارٍ الحساب…', en: 'Calculating…' },
  'wh.naarAangifte': { nl: 'Naar de BTW-aangifte van deze periode', ar: 'إلى إقرار الضريبة لهذه الفترة', en: "To this period's VAT return" },
  'wh.nogTeDoen': { nl: 'Nog te doen voor een compleet beeld', ar: 'ما بقي لاكتمال الصورة', en: 'Still to do for a complete picture' },
  'wh.teLaag': { nl: 'Tot dan zijn de bedragen hierboven te laag.', ar: 'حتى ذلك الحين المبالغ أعلاه أقل من الحقيقة.', en: 'Until then, the amounts above are too low.' },
  'wh.pinGecontroleerd': { nl: 'Pinbetalingen gecontroleerd', ar: 'مدفوعات البطاقة مُدقَّقة', en: 'Card payments checked' },
  'wh.afrekeningen': { nl: 'Afrekeningen ontvangen', ar: 'كشوف التسوية مستلَمة', en: 'Settlements received' },
  'wh.kostenAutomaat': { nl: 'Kosten van de betaalautomaat', ar: 'تكاليف جهاز الدفع', en: 'Card-terminal costs' },
  'wh.geldTerugMaar': { nl: 'Dit lijkt geld terug, maar', ar: 'يبدو هذا استرداداً، لكن', en: 'This looks like money back, but' },
  'wh.sindsIndiening': { nl: 'Sinds je indiening is de BTW met', ar: 'منذ تقديمك تغيّرت الضريبة بمقدار', en: 'Since your filing, the VAT changed by' },
  'wh.fout.laden': { nl: 'Kon je waarheid niet laden', ar: 'تعذّر تحميل حقيقتك', en: 'Could not load your truth' },

  // ─── [BESTANDEN] De bestandenbrowser ────────────────────────────────────────────────────────

  'best.mijn': { nl: 'Mijn bestanden', ar: 'ملفاتي', en: 'My files' },
  'best.mappen': { nl: 'Mappen', ar: 'المجلدات', en: 'Folders' },
  'best.mappenTonen': { nl: 'Mappen tonen', ar: 'إظهار المجلدات', en: 'Show folders' },
  'best.nieuw': { nl: 'Nieuw', ar: 'جديد', en: 'New' },
  'best.nieuweMap': { nl: 'Nieuwe map', ar: 'مجلد جديد', en: 'New folder' },
  'best.uploaden': { nl: 'Bestand uploaden', ar: 'رفع ملف', en: 'Upload a file' },
  'best.uploadenSleep': { nl: 'Bestand uploaden (of sleep een bestand hierheen)', ar: 'ارفع ملفاً (أو اسحبه إلى هنا)', en: 'Upload a file (or drag one here)' },
  'best.gedeeld': { nl: 'Gedeeld', ar: 'مُشارَك', en: 'Shared' },
  'best.prullenbak': { nl: 'Prullenbak', ar: 'سلة المهملات', en: 'Bin' },
  'best.terug': { nl: 'Terug', ar: 'رجوع', en: 'Back' },
  'best.uitklappen': { nl: 'Uitklappen', ar: 'توسيع', en: 'Expand' },
  'best.naamWijzigen': { nl: 'Naam wijzigen', ar: 'إعادة التسمية', en: 'Rename' },
  'best.leeg': { nl: 'Deze map is leeg', ar: 'هذا المجلد فارغ', en: 'This folder is empty' },
  'best.nogNiets': { nl: 'Nog niets hier', ar: 'لا شيء هنا بعد', en: 'Nothing here yet' },
  'best.nietsGevonden': { nl: 'Niets gevonden', ar: 'لم يُعثر على شيء', en: 'Nothing found' },
  'best.uploadOfMap': { nl: 'Upload een bestand of maak een nieuwe map aan', ar: 'ارفع ملفاً أو أنشئ مجلداً جديداً', en: 'Upload a file or create a new folder' },

  // ─── [ZOEKEN] Zoeken door de hele app ───────────────────────────────────────────────────────

  'zoek.alles': { nl: 'Zoek in de hele app — facturen, bestanden, klanten…', ar: 'ابحث في التطبيق كله — فواتير وملفات وعملاء…', en: 'Search the whole app — invoices, files, clients…' },
  'zoek.aria': { nl: 'Zoeken in de hele app', ar: 'البحث في التطبيق كله', en: 'Search the whole app' },
  'zoek.begin': { nl: 'Begin met typen om overal in de app te zoeken.', ar: 'ابدأ الكتابة للبحث في كل التطبيق.', en: 'Start typing to search everywhere in the app.' },
  'zoek.sub': { nl: 'Facturen, bestanden en klanten — op naam, nummer of bedrag.', ar: 'فواتير وملفات وعملاء — بالاسم أو الرقم أو المبلغ.', en: 'Invoices, files and clients — by name, number or amount.' },
  'zoek.geenResultaten': { nl: 'Geen resultaten voor', ar: 'لا نتائج لـ', en: 'No results for' },
  'zoek.probeerAnders': { nl: 'Probeer een andere naam, factuurnummer of bedrag.', ar: 'جرّب اسماً أو رقم فاتورة أو مبلغاً آخر.', en: 'Try a different name, invoice number or amount.' },
  'zoek.mislukt': { nl: 'Zoeken mislukt', ar: 'فشل البحث', en: 'Search failed' },
  'zoek.verbinding': { nl: 'Controleer je verbinding en probeer het opnieuw.', ar: 'تحقّق من اتصالك وحاول مرة أخرى.', en: 'Check your connection and try again.' },
  'zoek.cat.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'zoek.cat.bestanden': { nl: 'Bestanden', ar: 'الملفات', en: 'Files' },
  'zoek.cat.klanten': { nl: 'Klanten', ar: 'العملاء', en: 'Clients' },
  'zoek.cat.bank': { nl: 'Bankmutaties', ar: 'حركات البنك', en: 'Bank transactions' },
  'zoek.cat.kas': { nl: 'Kasboekingen', ar: 'قيود الصندوق', en: 'Cash entries' },

  // ─── [UPLOAD] De uploadhub ──────────────────────────────────────────────────────────────────

  'up.sleep': { nl: 'Sleep bestanden hierheen', ar: 'اسحب الملفات إلى هنا', en: 'Drag files here' },
  'up.alles': { nl: 'Facturen, bonnen én bankafschriften — alles op één plek. Kies of sleep', ar: 'فواتير وإيصالات وكشوف بنكية — كل شيء في مكان واحد. اختر أو اسحب', en: 'Invoices, receipts and bank statements — all in one place. Choose or drag' },
  'up.eerder': { nl: 'Al eerder geüpload?', ar: 'رُفع سابقاً؟', en: 'Uploaded before?' },
  'up.tochToevoegen': { nl: 'Toch toevoegen — dit is een ander bestand', ar: 'أضِفه رغم ذلك — هذا ملف مختلف', en: 'Add it anyway — this is a different file' },
  'up.nietGelezen': { nl: 'Niet gelezen', ar: 'لم يُقرأ', en: 'Not read' },
  'up.opruimen': { nl: 'Lijst opruimen', ar: 'تنظيف القائمة', en: 'Clear the list' },
  'up.meerderePaginas': { nl: 'Factuur met meerdere pagina’s?', ar: 'فاتورة من عدة صفحات؟', en: 'A multi-page invoice?' },
  'up.paginasSamen': { nl: 'Hoort een papieren factuur bij elkaar? Voeg de pagina’s hier samen tot', ar: 'أوراق فاتورة واحدة؟ اجمع الصفحات هنا في', en: 'Pages of one paper invoice? Merge them here into' },
  'up.eenFactuur': { nl: 'Eén factuur, meerdere pagina’s', ar: 'فاتورة واحدة، عدة صفحات', en: 'One invoice, several pages' },
  'up.bekijkBestand': { nl: 'Bekijk bestand', ar: 'اعرض الملف', en: 'View the file' },
  'up.bekijkBestanden': { nl: 'Bekijk in Bestanden', ar: 'اعرض في الملفات', en: 'View in Files' },
  'up.naarVerifieren': { nl: 'Naar Te verifiëren', ar: 'إلى «بانتظار التدقيق»', en: 'To the verify queue' },
  'up.mogelijkheden': { nl: 'Bekijk de mogelijkheden', ar: 'اطّلع على الإمكانات', en: 'See what it can do' },

  // ─── [KLANTEN] Het klantenbestand ───────────────────────────────────────────────────────────

  'kl.zoek': { nl: 'Zoek op naam, e-mail, KVK, IBAN...', ar: 'ابحث بالاسم أو البريد أو KVK أو IBAN...', en: 'Search by name, e-mail, KVK, IBAN...' },
  'kl.zoek.aria': { nl: 'Klanten zoeken', ar: 'البحث في العملاء', en: 'Search clients' },
  'kl.bekijk': { nl: 'Bekijk', ar: 'عرض', en: 'View' },
  'kl.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'kl.verwijderd': { nl: 'Klant verwijderd', ar: 'حُذف العميل', en: 'Client deleted' },
  'kl.naamVerplicht': { nl: 'Naam is verplicht', ar: 'الاسم إلزامي', en: 'A name is required' },

  // ─── [BRUG] De brug — het documentenoverzicht per klant/kwartaal ────────────────────────────

  'brug.zoek': { nl: 'Zoek op factuurnummer, leverancier of bedrag…', ar: 'ابحث برقم الفاتورة أو المورّد أو المبلغ…', en: 'Search by invoice number, supplier or amount…' },
  'brug.zoek.aria': { nl: 'Documenten zoeken', ar: 'البحث في المستندات', en: 'Search documents' },
  'brug.leeg': { nl: 'Niets hier', ar: 'لا شيء هنا', en: 'Nothing here' },
  'brug.kiesKlant': { nl: 'Kies een klant om te beginnen', ar: 'اختر عميلاً للبدء', en: 'Choose a client to begin' },
  'brug.alles': { nl: 'Alles', ar: 'الكل', en: 'All' },
  'brug.archief': { nl: 'Toon archief', ar: 'إظهار الأرشيف', en: 'Show archive' },
  'brug.openBestanden': { nl: 'Open in Mijn bestanden', ar: 'افتح في ملفاتي', en: 'Open in My files' },
  'brug.cijfersLaden': { nl: 'Cijfers laden…', ar: 'جارٍ تحميل الأرقام…', en: 'Loading figures…' },
  'brug.overzichtLaden': { nl: 'Overzicht laden…', ar: 'جارٍ تحميل النظرة العامة…', en: 'Loading overview…' },
  'brug.fout.cijfers': { nl: 'Cijfers konden niet geladen worden', ar: 'تعذّر تحميل الأرقام', en: 'The figures could not be loaded' },
  'brug.fout.overzicht': { nl: 'Overzicht kon niet geladen worden', ar: 'تعذّر تحميل النظرة العامة', en: 'The overview could not be loaded' },
  'brug.fout.nietCompleet': { nl: 'Wat je hieronder ziet is daarom NIET compleet — een lege map betekent hier niet dat er niets is. Probeer het opnieuw.', ar: 'ما تراه أدناه ليس إذاً كاملاً — المجلد الفارغ هنا لا يعني ألا شيء فيه. حاول مرة أخرى.', en: 'What you see below is therefore NOT complete — an empty folder here does not mean there is nothing. Try again.' },
  'brug.sluitAan': { nl: 'Niets openstaand — alles sluit aan.', ar: 'لا شيء معلّق — كل شيء متطابق.', en: 'Nothing outstanding — everything reconciles.' },

  // ─── [DAGOMZET] De omzetinzichten ───────────────────────────────────────────────────────────

  'dz.geboekt': { nl: 'Geboekte omzet', ar: 'الإيراد المُقيَّد', en: 'Booked turnover' },
  'dz.gemiddeld': { nl: 'Gemiddeld per dag', ar: 'المتوسط اليومي', en: 'Average per day' },
  'dz.drukste': { nl: 'Drukste dag', ar: 'أكثر الأيام ازدحاماً', en: 'Busiest day' },
  'dz.opvallend': { nl: 'Opvallende dagen', ar: 'أيام لافتة', en: 'Notable days' },
  'dz.perMaand': { nl: 'Omzet per maand', ar: 'الإيراد الشهري', en: 'Turnover per month' },
  'dz.betaalwijzen': { nl: 'Betaalwijzen', ar: 'طرق الدفع', en: 'Payment methods' },
  'dz.btwVerdeling': { nl: 'BTW-verdeling (aandeel van de netto-omzet)', ar: 'توزيع الضريبة (حصة من صافي الإيراد)', en: 'VAT split (share of net turnover)' },
  'dz.overig': { nl: 'Overig', ar: 'أخرى', en: 'Other' },
  'dz.zeker': { nl: 'Zeker weten?', ar: 'متأكد؟', en: 'Are you sure?' },
  'dz.fout.nietLeeg': { nl: 'Dit is NIET hetzelfde als “nog geen omzet geboekt”. Probeer het opnieuw.', ar: 'هذا ليس كـ“لا إيراد مُقيَّد بعد”. حاول مرة أخرى.', en: 'That is NOT the same as “no turnover booked yet”. Try again.' },
  'dz.fout.laden': { nl: 'We konden je geboekte omzet niet laden', ar: 'تعذّر تحميل إيرادك المُقيَّد', en: 'Could not load your booked turnover' },

  // ─── [ARTIKELEN] De artikelcatalogus ────────────────────────────────────────────────────────

  'art.zoek': { nl: 'Zoek op code, omschrijving of bedrag…', ar: 'ابحث بالرمز أو الوصف أو المبلغ…', en: 'Search by code, description or amount…' },
  'art.zoek.aria': { nl: 'Artikelen zoeken', ar: 'البحث في الأصناف', en: 'Search articles' },
  'art.uitleg': { nl: 'Je vaste factuurregels — één keer opslaan, steeds hergebruiken.', ar: 'بنودك الثابتة — احفظها مرة واستعملها دائماً.', en: 'Your standard invoice lines — save once, reuse always.' },
  // Een voorbeeldomschrijving is als de voorbeeldnaam: hij mag met de taal mee.
  'art.voorbeeld': { nl: 'Transport tafel', ar: 'نقل طاولة', en: 'Table transport' },
  'art.code': { nl: 'Code', ar: 'الرمز', en: 'Code' },
  'art.eenheid': { nl: 'Eenheid', ar: 'الوحدة', en: 'Unit' },
  'art.bewerk': { nl: 'Bewerk', ar: 'عدّل', en: 'Edit' },
  'art.verwijder': { nl: 'Verwijder', ar: 'احذف', en: 'Delete' },
  'art.prijsNegatief': { nl: 'Prijs moet 0 of hoger zijn.', ar: 'يجب أن يكون السعر 0 أو أكثر.', en: 'The price must be 0 or higher.' },

  // ─── [KLAAR] Ben ik klaar? — de kwartaalscore ───────────────────────────────────────────────

  'klr.titel': { nl: 'Ben ik klaar?', ar: 'هل أنا جاهز؟', en: 'Am I ready?' },
  'klr.watNog': { nl: 'Wat moet er nog gebeuren', ar: 'ما الذي بقي فعله', en: 'What still needs doing' },
  'klr.waarop': { nl: 'Waar de score op gebaseerd is', ar: 'علامَ تُبنى النتيجة', en: 'What the score is based on' },
  'klr.evenControleren': { nl: 'Even controleren', ar: 'تحقّق سريع', en: 'A quick check' },
  'klr.conceptAangifte': { nl: 'Bekijk de concept-aangifte', ar: 'اعرض مسودة الإقرار', en: 'View the draft return' },
  'klr.fout.zegtNiets': { nl: 'Dit zegt NIETS over of je klaar bent — we konden het alleen niet controleren.', ar: 'هذا لا يقول شيئاً عن جاهزيتك — لم نستطع الفحص فحسب.', en: 'This says NOTHING about whether you are ready — we just could not check.' },
  'klr.fout.status': { nl: 'Kon de status niet laden', ar: 'تعذّر تحميل الحالة', en: 'Could not load the status' },

  // ─── [ONBOARDING] De eerste drie minuten van elke eigenaar ──────────────────────────────────
  // Dit is het scherm waar de Arabische ondernemer uit de blogfunnel als eerste landt na de
  // registratie. De belofte "in 3 minuten" moet in zijn eigen taal staan, of hij is weg.

  'onb.wie': { nl: 'Wie ben jij?', ar: 'مَن أنت؟', en: 'Who are you?' },
  'onb.aanpassen': { nl: 'We passen BoekBrug aan op jouw situatie.', ar: 'نكيّف BoekBrug حسب وضعك.', en: 'We adapt BoekBrug to your situation.' },
  'onb.zzp': { nl: "Ik ben ZZP'er", ar: 'أنا صاحب عمل مستقل', en: 'I am self-employed' },
  'onb.boekhouder': { nl: 'Ik ben boekhouder', ar: 'أنا محاسب', en: 'I am an accountant' },
  'onb.drieMinuten': { nl: 'Laten we je account in 3 minuten instellen.', ar: 'لنجهّز حسابك في 3 دقائق.', en: "Let's set up your account in 3 minutes." },
  'onb.jouwBedrijf': { nl: 'Jouw bedrijf', ar: 'شركتك', en: 'Your business' },
  'onb.jouwKantoor': { nl: 'Jouw kantoor', ar: 'مكتبك', en: 'Your office' },
  'onb.bedrijfsnaam': { nl: 'Wat is je bedrijfsnaam?', ar: 'ما اسم شركتك؟', en: 'What is your company name?' },
  'onb.kantoornaam': { nl: 'Naam van je kantoor', ar: 'اسم مكتبك', en: 'The name of your office' },
  'onb.kvk': { nl: 'Wat is je KVK-nummer? (optioneel)', ar: 'ما رقم KVK الخاص بك؟ (اختياري)', en: 'What is your KVK number? (optional)' },
  'onb.kvkKantoor': { nl: 'KVK-nummer van je kantoor (optioneel)', ar: 'رقم KVK لمكتبك (اختياري)', en: "Your office's KVK number (optional)" },
  'onb.btw': { nl: 'Wat is je BTW-nummer? (nodig om facturen te versturen)', ar: 'ما رقم ضريبة القيمة المضافة؟ (مطلوب لإرسال الفواتير)', en: 'What is your VAT number? (needed to send invoices)' },
  'onb.iban': { nl: 'Wat is je IBAN? (voor betaalverzoeken)', ar: 'ما هو IBAN الخاص بك؟ (لطلبات الدفع)', en: 'What is your IBAN? (for payment requests)' },
  'onb.adres': { nl: 'Wat is je adres? (nodig om facturen te versturen)', ar: 'ما عنوانك؟ (مطلوب لإرسال الفواتير)', en: 'What is your address? (needed to send invoices)' },
  'onb.alleenNaam': { nl: 'Alleen de naam is nodig — de rest kun je later aanpassen.', ar: 'الاسم وحده يكفي — الباقي يمكن تعديله لاحقاً.', en: 'Only the name is needed — the rest can be changed later.' },
  'onb.naamVerplicht': { nl: 'Vul je bedrijfsnaam in om verder te gaan.', ar: 'أدخل اسم شركتك للمتابعة.', en: 'Enter your company name to continue.' },
  'onb.kantoorVerplicht': { nl: 'Vul de naam van je kantoor in om verder te gaan.', ar: 'أدخل اسم مكتبك للمتابعة.', en: "Enter your office's name to continue." },
  'onb.nummer': { nl: 'Met welk factuurnummer wil je beginnen?', ar: 'بأي رقم فاتورة تريد البدء؟', en: 'Which invoice number do you want to start with?' },
  'onb.volgendNummer': { nl: 'Je volgende factuurnummer', ar: 'رقم فاتورتك التالي', en: 'Your next invoice number' },
  'onb.laatLeeg': { nl: 'Laat leeg om bij', ar: 'اتركه فارغاً للبدء من', en: 'Leave empty to start at' },
  'onb.gmail': { nl: 'Wil je je Gmail koppelen?', ar: 'أتريد ربط Gmail؟', en: 'Do you want to connect your Gmail?' },
  'onb.gmailJa': { nl: 'Ja, koppel mijn Gmail', ar: 'نعم، اربط Gmail', en: 'Yes, connect my Gmail' },
  'onb.gmailOpen': { nl: 'Gmail openen…', ar: 'جارٍ فتح Gmail…', en: 'Opening Gmail…' },
  'onb.gmailGelukt': { nl: 'Gmail succesvol gekoppeld!', ar: 'رُبط Gmail بنجاح!', en: 'Gmail connected!' },
  'onb.importeren': { nl: 'We importeren automatisch je facturen.', ar: 'نستورد فواتيرك تلقائياً.', en: 'We import your invoices automatically.' },
  'onb.importerenNiks': { nl: 'We importeren automatisch je facturen. Jij hoeft niets te doen.', ar: 'نستورد فواتيرك تلقائياً. لا شيء عليك فعله.', en: 'We import your invoices automatically. Nothing for you to do.' },
  'onb.importerenAchtergrond': { nl: 'We importeren je facturen automatisch op de achtergrond.', ar: 'نستورد فواتيرك تلقائياً في الخلفية.', en: 'We import your invoices automatically in the background.' },
  'onb.eersteKlant': { nl: 'Voeg je eerste klant toe', ar: 'أضف عميلك الأول', en: 'Add your first client' },
  'onb.klantEmail': { nl: 'E-mailadres klant', ar: 'البريد الإلكتروني للعميل', en: "Client's e-mail address" },
  'onb.boekhouderEmail': { nl: 'E-mailadres boekhouder', ar: 'البريد الإلكتروني للمحاسب', en: "Accountant's e-mail address" },
  'onb.hebBoekhouder': { nl: 'Heb je een boekhouder?', ar: 'ألديك محاسب؟', en: 'Do you have an accountant?' },
  'onb.klantMail': { nl: 'Je klant ontvangt een e-mail om zijn account aan te maken.', ar: 'سيصل عميلك بريد لإنشاء حسابه.', en: 'Your client gets an e-mail to create their account.' },
  'onb.slaOver': { nl: 'Sla over', ar: 'تخطَّ', en: 'Skip' },
  'onb.slaOverLater': { nl: 'Tik op &ldquo;Sla over&rdquo; om dit later in te stellen', ar: 'اضغط «تخطَّ» لضبط هذا لاحقاً', en: 'Tap “Skip” to set this up later' },
  'onb.volgende': { nl: 'Volgende', ar: 'التالي', en: 'Next' },
  'onb.naarDashboard': { nl: 'Ga naar mijn dashboard', ar: 'اذهب إلى لوحتي', en: 'Go to my dashboard' },
  'onb.autoVerder': { nl: 'Of wacht even, je gaat automatisch verder…', ar: 'أو انتظر قليلاً وستنتقل تلقائياً…', en: 'Or wait a moment — you continue automatically…' },
  'onb.opnieuw': { nl: 'Opnieuw beginnen', ar: 'ابدأ من جديد', en: 'Start over' },
  'onb.opnieuwVraag': { nl: 'Opnieuw beginnen?', ar: 'البدء من جديد؟', en: 'Start over?' },
  'onb.opnieuwUitleg': { nl: 'Je ingevoerde gegevens worden gewist. Gmail blijft gekoppeld.', ar: 'ستُمسح بياناتك المُدخلة. يبقى Gmail مربوطاً.', en: 'Your entered details are cleared. Gmail stays connected.' },
  'onb.vulNog': { nl: 'Vul nog je', ar: 'أكمل بعد', en: 'Still fill in your' },
  'onb.instellingen': { nl: 'Instellingen', ar: 'الإعدادات', en: 'Settings' },

  // ─── [INTAKE] De bon/factuur-knop op het startscherm ────────────────────────────────────────

  'int.toevoegen': { nl: 'Bon of factuur toevoegen', ar: 'أضف إيصالاً أو فاتورة', en: 'Add a receipt or invoice' },
  'int.fotograferen': { nl: 'Bon of factuur fotograferen', ar: 'صوّر إيصالاً أو فاتورة', en: 'Photograph a receipt or invoice' },
  'int.fotoMaken': { nl: 'Foto maken', ar: 'التقط صورة', en: 'Take a photo' },
  'int.bestand': { nl: 'Bestand uploaden', ar: 'ارفع ملفاً', en: 'Upload a file' },
  'int.pdfBeeld': { nl: 'PDF, afbeelding of bankafschrift', ar: 'PDF أو صورة أو كشف بنكي', en: 'PDF, image or bank statement' },
  'int.watToegevoegd': { nl: 'Wat is er toegevoegd', ar: 'ما الذي أُضيف', en: 'What was added' },
  'int.drieBezig': { nl: 'Even wachten — er worden er al drie verwerkt.', ar: 'انتظر قليلاً — ثلاثة قيد المعالجة بالفعل.', en: 'One moment — three are already being processed.' },
  'int.bestaande': { nl: 'Bekijk de bestaande factuur', ar: 'اعرض الفاتورة الموجودة', en: 'View the existing invoice' },
  'int.tochAndere': { nl: 'Toch toevoegen — dit is een andere factuur', ar: 'أضِفها رغم ذلك — هذه فاتورة أخرى', en: 'Add it anyway — this is a different invoice' },
  'int.paginasSamen': { nl: 'Meerdere pagina&apos;s → samen één factuur', ar: 'عدة صفحات ← فاتورة واحدة معاً', en: 'Several pages → one invoice together' },
  'int.kiesFotos': { nl: 'Kies foto’s van de pagina’s', ar: 'اختر صور الصفحات', en: 'Choose photos of the pages' },
  'int.teruggezet': { nl: 'Teruggezet — staat weer in je controlewachtrij ✓', ar: 'أُعيدت — عادت إلى قائمة التدقيق ✓', en: 'Put back — in your review queue again ✓' },
  'int.fout.terugzetten': { nl: 'Terugzetten mislukt — controleer je verbinding', ar: 'فشلت الإعادة — تحقّق من اتصالك', en: 'Putting back failed — check your connection' },
  'int.fout.toevoegen': { nl: 'Toevoegen mislukt — probeer opnieuw', ar: 'فشلت الإضافة — حاول مرة أخرى', en: 'Adding failed — please try again' },
  'int.terug': { nl: 'Terug', ar: 'رجوع', en: 'Back' },

  // ─── [DAGOMZET-IMPORT] Het inlezen van omzetbestanden ───────────────────────────────────────

  'dzi.goedkeuren': { nl: 'Goedkeuren', ar: 'موافقة', en: 'Approve' },
  'dzi.afwijzen': { nl: 'Afwijzen', ar: 'رفض', en: 'Reject' },
  'dzi.dagen': { nl: 'Dagen', ar: 'الأيام', en: 'Days' },
  'dzi.uitgaven': { nl: 'Uitgaven', ar: 'المصروفات', en: 'Spending' },
  'dzi.omzetIncl': { nl: 'Omzet incl.', ar: 'الإيراد شاملاً', en: 'Turnover incl.' },
  'dzi.totaleOmzet': { nl: 'Totale omzet (incl.)', ar: 'إجمالي الإيراد (شاملاً)', en: 'Total turnover (incl.)' },
  'dzi.geenDagen': { nl: 'Geen dagen met omzet gevonden in dit bestand.', ar: 'لم يُعثر في هذا الملف على أيام ذات إيراد.', en: 'No days with turnover found in this file.' },
  'dzi.fout.bestand': { nl: 'Er ging iets mis bij het lezen van het bestand', ar: 'حدث خطأ أثناء قراءة الملف', en: 'Something went wrong reading the file' },
  'dzi.fout.grootboek': { nl: 'Er ging iets mis bij het lezen van het grootboek', ar: 'حدث خطأ أثناء قراءة دفتر الأستاذ', en: 'Something went wrong reading the ledger' },
  'dzi.fout.opslaan': { nl: 'Opslaan mislukt', ar: 'فشل الحفظ', en: 'Saving failed' },

  // ─── [CATEGORISEREN] Banktransacties een categorie geven ────────────────────────────────────

  'cat.zoek': { nl: 'Zoek op tegenpartij, omschrijving of bedrag…', ar: 'ابحث بالطرف الآخر أو الوصف أو المبلغ…', en: 'Search by counterparty, description or amount…' },
  'cat.klaar': { nl: 'Alles is gecategoriseerd', ar: 'كل شيء مصنَّف', en: 'Everything is categorised' },
  'cat.geenAandacht': { nl: 'Geen transacties die nog aandacht nodig hebben.', ar: 'لا معاملات تحتاج انتباهاً بعد.', en: 'No transactions still needing attention.' },
  'cat.nogNiets': { nl: 'Nog niets ingevuld', ar: 'لا شيء مُدخل بعد', en: 'Nothing filled in yet' },
  'cat.zodra': { nl: 'Zodra je transacties een categorie geeft, kun je ze hier wijzigen.', ar: 'حين تعطي معاملاتك تصنيفاً، تستطيع تعديلها هنا.', en: 'Once you categorise transactions, you can change them here.' },
  'cat.vernieuw': { nl: 'Vernieuw de pagina om de volgende te zien.', ar: 'حدّث الصفحة لرؤية التالية.', en: 'Refresh the page to see the next one.' },
  'cat.fout.laden': { nl: 'We konden de banktransacties niet laden. Probeer het opnieuw.', ar: 'تعذّر تحميل معاملات البنك. حاول مرة أخرى.', en: 'Could not load the bank transactions. Try again.' },
  'cat.fout.opslaan': { nl: 'Deze transactie kon niet worden opgeslagen. Probeer het opnieuw.', ar: 'تعذّر حفظ هذه المعاملة. حاول مرة أخرى.', en: 'This transaction could not be saved. Try again.' },
  'cat.fout.automatisch': { nl: 'De automatische verwerking is niet gelukt. Probeer het opnieuw.', ar: 'لم تنجح المعالجة التلقائية. حاول مرة أخرى.', en: 'Automatic processing did not work. Try again.' },

  // ─── [VRAGEN] Vragen van je boekhouder ──────────────────────────────────────────────────────

  'vr.geen': { nl: 'Geen openstaande vragen', ar: 'لا أسئلة معلّقة', en: 'No open questions' },
  'vr.jouwAntwoord': { nl: 'Jouw antwoord', ar: 'جوابك', en: 'Your answer' },
  'vr.voorbeeld': { nl: 'Bijvoorbeeld: die bon zit in de map van juni, ik stuur hem vandaag.', ar: 'مثلاً: ذلك الإيصال في مجلد يونيو، سأرسله اليوم.', en: 'For example: that receipt is in the June folder, I will send it today.' },
  'vr.verstuurd': { nl: 'Je antwoord is verstuurd', ar: 'أُرسل جوابك', en: 'Your answer was sent' },
  'vr.misBon': { nl: 'Mist er een bon?', ar: 'أينقص إيصال؟', en: 'Missing a receipt?' },
  'vr.voegToe': { nl: 'Voeg hem toe — de app sorteert hem', ar: 'أضِفه — والتطبيق يرتّبه', en: 'Add it — the app sorts it' },
  'vr.fout.ophalen': { nl: 'Kon je vragen niet ophalen', ar: 'تعذّر جلب أسئلتك', en: 'Could not fetch your questions' },

  // ─── [TEAM] Wie mag er factureren ───────────────────────────────────────────────────────────

  'team.titel': { nl: 'Team', ar: 'الفريق', en: 'Team' },
  'team.email': { nl: 'E-mailadres van de medewerker', ar: 'البريد الإلكتروني للموظف', en: "The employee's e-mail address" },
  'team.magFactureren': { nl: 'Mag facturen maken', ar: 'يحق له إنشاء فواتير', en: 'May create invoices' },
  'team.niemand': { nl: 'Niemand. Alleen jij maakt facturen voor je bedrijf.', ar: 'لا أحد. أنت وحدك تُنشئ فواتير شركتك.', en: 'Nobody. Only you create invoices for your business.' },
  'team.nietGeaccepteerd': { nl: 'Nog niet geaccepteerd', ar: 'لم يُقبل بعد', en: 'Not yet accepted' },
  'team.intrekken': { nl: 'Intrekken', ar: 'سحب', en: 'Revoke' },
  'team.eerder': { nl: 'Eerder', ar: 'سابقاً', en: 'Previously' },
  'team.nietAan': { nl: 'De teamfunctie staat nog niet aan.', ar: 'ميزة الفريق ليست مفعّلة بعد.', en: 'The team feature is not on yet.' },

  // ─── [PRULLENBAK] ───────────────────────────────────────────────────────────────────────────

  'prul.titel': { nl: 'Prullenbak', ar: 'سلة المهملات', en: 'Bin' },
  'prul.leeg': { nl: 'Prullenbak is leeg', ar: 'سلة المهملات فارغة', en: 'The bin is empty' },
  'prul.verschijnen': { nl: 'Verwijderde bestanden verschijnen hier', ar: 'تظهر هنا الملفات المحذوفة', en: 'Deleted files appear here' },
  'prul.herstellen': { nl: 'Herstellen', ar: 'استعادة', en: 'Restore' },
  'prul.permanent': { nl: 'Permanent verwijderen', ar: 'حذف نهائي', en: 'Delete permanently' },
  'prul.legen': { nl: 'Prullenbak legen', ar: 'إفراغ السلة', en: 'Empty the bin' },
  'prul.selectieWissen': { nl: 'Selectie wissen', ar: 'مسح التحديد', en: 'Clear the selection' },

  // ─── [AANGIFTE] De concept-aangifte ─────────────────────────────────────────────────────────
  // De RUBRIEKnamen zelf (5a, 3b) zijn Belastingdienst-terminologie en blijven letterlijk; de
  // zinnen eromheen bewegen mee.

  'aang.rubriek': { nl: 'Rubriek', ar: 'البند', en: 'Section' },
  'aang.omzet': { nl: 'Omzet', ar: 'الإيراد', en: 'Turnover' },
  'aang.5a': { nl: '5a · Verschuldigde omzetbelasting', ar: '5a · ضريبة المبيعات المستحقة', en: '5a · VAT owed' },
  'aang.totaal3b': { nl: 'Totaal · gelijk aan 3b', ar: 'الإجمالي · يساوي 3b', en: 'Total · equals 3b' },
  'aang.icp': { nl: 'ICP-opgaaf · aparte aangifte', ar: 'إقرار ICP · تصريح منفصل', en: 'ICP statement · separate filing' },
  'aang.waarop': { nl: 'Waar dit op gebaseerd is', ar: 'علامَ يُبنى هذا', en: 'What this is based on' },
  'aang.verschil': { nl: 'Bekijk het verschil op Waarheid', ar: 'اعرض الفرق في «حقيقتك»', en: 'View the difference on Truth' },
  'aang.jeHebt': { nl: 'Je hebt', ar: 'لديك', en: 'You have' },

  // ─── [CONCEPTEN] De wachtrij met klaargezette e-mails ───────────────────────────────────────

  'dq.onderwerp': { nl: 'Onderwerp', ar: 'الموضوع', en: 'Subject' },
  'dq.onderwerpPh': { nl: 'Onderwerp van de e-mail…', ar: 'موضوع الرسالة…', en: 'Subject of the e-mail…' },
  'dq.bericht': { nl: 'Bericht', ar: 'الرسالة', en: 'Message' },
  'dq.berichtPh': { nl: "Schrijf hier je bericht, of gebruik 'AI opstellen'…", ar: "اكتب رسالتك هنا، أو استخدم «صياغة بالذكاء الاصطناعي»…", en: "Write your message here, or use 'AI draft'…" },
  'dq.kiesKlant': { nl: 'Kies een klant…', ar: 'اختر عميلاً…', en: 'Choose a client…' },
  'dq.puntToevoegen': { nl: 'Punt toevoegen…', ar: 'أضف بنداً…', en: 'Add a point…' },
  'dq.geenPunten': { nl: 'Nog geen openstaande punten voor deze klant.', ar: 'لا بنود معلّقة لهذا العميل بعد.', en: 'No open points for this client yet.' },
  'dq.nietGevonden': { nl: 'Niet gevonden', ar: 'لم يُعثر عليه', en: 'Not found' },
  'dq.netwerkfout': { nl: 'Netwerkfout. Probeer het opnieuw.', ar: 'خطأ في الشبكة. حاول مرة أخرى.', en: 'Network error. Try again.' },

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
