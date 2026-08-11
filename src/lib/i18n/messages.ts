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
