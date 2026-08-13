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
  'nieuw.klant.extra4': { nl: 'Extra regel 4', ar: 'سطر إضافي 4', en: 'Extra line 4' },
  'nieuw.klant.extraUitleg': {
    nl: 'Deze vier regels komen op het document direct onder de klantnaam te staan. Laat ze leeg als je ze niet nodig hebt.',
    ar: 'هذه الأسطر الأربعة تظهر على المستند مباشرة تحت اسم العميل. اتركها فارغة إن لم تحتجها.',
    en: 'These four lines appear on the document directly under the customer name. Leave them empty if you do not need them.',
  },

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
  // [MIN-REGEL] A credit line inside an invoice is ordinary — a return the supplier settles on the
  // next invoice. Once the credits outweigh the deliveries the document gives money back, and that
  // is a creditnota: its own number series and the other side of the aangifte. "Creditnota" stays
  // Dutch in every language — it is the word on the button the owner has to press next.
  'nieuw.fout.creditnota': {
    nl: 'De creditregels zijn samen meer waard dan wat je levert, dus dit is een creditnota en geen factuur. Maak er een creditnota van, of vul de regels aan tot het totaal niet meer negatief is.',
    ar: 'قيمة الأسطر الدائنة معًا أكبر من قيمة ما تسلّمه، فهذا إشعار دائن (creditnota) وليس فاتورة. حوّله إلى إشعار دائن، أو أكمِل الأسطر حتى لا يبقى المجموع بالسالب.',
    en: 'The credit lines together are worth more than what you deliver, so this is a creditnota and not an invoice. Make it a creditnota, or add lines until the total is no longer negative.',
  },

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
  // [HERSTEL] A sent invoice is fully editable while nothing is attached to it — the market
  // rule the owner chose after seeing the legal picture. Saving automatically delivers the
  // corrected version to the customer; the number never changes. The old creditnota+draft
  // orchestration is gone; a manual creditnota remains for the locked cases.
  'bewerk.herstel.uitleg': {
    nl: 'Dit is een verstuurde factuur — het nummer {number} blijft staan. Als je opslaat, ontvangt je klant automatisch de gecorrigeerde factuur per e-mail, met de melding dat de eerdere versie vervalt.',
    ar: 'هذه فاتورة مُرسَلة — الرقم {number} يبقى كما هو. عند الحفظ، يستلم عميلك تلقائياً الفاتورة المصحَّحة بالبريد الإلكتروني، مع تنبيه بأن النسخة السابقة لاغية.',
    en: 'This is a sent invoice — the number {number} stays. When you save, your customer automatically receives the corrected invoice by e-mail, noting that the earlier version is void.',
  },
  'bewerk.herstel.knop': {
    nl: 'Opslaan en gecorrigeerde factuur versturen',
    ar: 'احفظ وأرسل الفاتورة المصحَّحة',
    en: 'Save and send the corrected invoice',
  },
  'bewerk.herstel.bezig': { nl: 'Opslaan en versturen…', ar: 'جارٍ الحفظ والإرسال…', en: 'Saving and sending…' },
  'bewerk.herstel.nietBezorgd': {
    nl: 'De factuur is aangepast, maar de gecorrigeerde versie kon nog niet naar je klant — verstuur hem opnieuw vanaf de factuurpagina.',
    ar: 'عُدّلت الفاتورة، لكن النسخة المصحَّحة لم تصل عميلك بعد — أعد إرسالها من صفحة الفاتورة.',
    en: 'The invoice was updated, but the corrected version could not reach your customer yet — resend it from the invoice page.',
  },
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
  'ink.email.verwijderen': { nl: 'E-mailverbinding verwijderen', ar: 'حذف ربط البريد الإلكتروني', en: 'Remove the e-mail connection' },
  'ink.email.gestopt': { nl: 'Automatisch inlezen is gestopt', ar: 'توقّفت القراءة التلقائية', en: 'Automatic reading has stopped' },
  'ink.email.ouderOphalen': { nl: 'Mis je een factuur? Oudere e-mails opnieuw ophalen…', ar: 'أتنقصك فاتورة؟ أعد جلب الرسائل الأقدم…', en: 'Missing an invoice? Fetch older e-mails again…' },
  // [BIJLAGE-TERUGWEG] The word "niet" is the whole sentence: the backfill can only serve an
  // invoice that is NOT in this list. An earlier split dropped it and inverted the advice.
  'ink.email.misFactuur': { nl: 'Mis je een factuur die hier niet tussen staat?', ar: 'أتنقصك فاتورة لا تظهر هنا؟', en: 'Missing an invoice that is not in this list?' },
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
  // Full sentence with the number as data — the old half-key left ' te beginnen.' hard-coded
  // in the wizard, a split no other word order survives.
  'onb.laatLeeg': { nl: 'Laat leeg om bij {number} te beginnen.', ar: 'اتركه فارغاً للبدء من {number}.', en: 'Leave empty to start at {number}.' },
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
  // One sentence, fields as data. Names the Instellingen screen as its nav label is written
  // per language — the owner must be able to find the word on screen.
  'onb.vulNog': {
    nl: 'Vul nog {fields} in bij Instellingen — dat is wettelijk verplicht op een factuur. Zonder deze gegevens kun je nog geen factuur versturen.',
    ar: 'أكمل إدخال {fields} في «الإعدادات» — فهذه البيانات إلزامية قانوناً على الفاتورة. من دونها لا يمكنك إرسال فواتير بعد.',
    en: 'Still fill in {fields} under Settings — legally required on an invoice. Without these you cannot send invoices yet.',
  },

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

  // ─── [KWARTAAL-KAART] Het kwartaaloverzicht per klant ───────────────────────────────────────

  'kw.inkomsten': { nl: 'Inkomsten incl. BTW', ar: 'الإيرادات شاملة الضريبة', en: 'Income incl. VAT' },
  'kw.uitgaven': { nl: 'Uitgaven incl. BTW', ar: 'المصروفات شاملة الضريبة', en: 'Spending incl. VAT' },
  'kw.teBetalen5g': { nl: 'BTW te betalen (5g)', ar: 'ضريبة مستحقة (5g)', en: 'VAT to pay (5g)' },
  'kw.teBetalen5gKort': { nl: 'Te betalen (5g)', ar: 'مستحق (5g)', en: 'To pay (5g)' },
  'kw.klant': { nl: 'Klant', ar: 'العميل', en: 'Client' },
  'kw.openstaand': { nl: 'Openstaand', ar: 'معلّق', en: 'Outstanding' },
  'kw.nietIngediend': { nl: 'Nog niet als ingediend gemarkeerd', ar: 'لم يُعلَّم كمُقدَّم بعد', en: 'Not yet marked as filed' },
  'kw.btwMet': { nl: 'De BTW is met', ar: 'تغيّرت الضريبة بمقدار', en: 'The VAT changed by' },
  'kw.geenKlanten': { nl: 'Geen klanten gekoppeld', ar: 'لا عملاء مرتبطون', en: 'No clients linked' },
  'kw.nodigUit': { nl: 'Klant uitnodigen', ar: 'ادعُ عميلاً', en: 'Invite a client' },
  'kw.nodigUitUitleg': { nl: 'Nodig een klant uit om kwartaaloverzichten te bekijken', ar: 'ادعُ عميلاً لعرض ملخصات الأرباع', en: 'Invite a client to view quarterly overviews' },
  'kw.dashboard': { nl: 'Dashboard', ar: 'اللوحة', en: 'Dashboard' },

  // ─── [KOP] De vaste kop: meldingen, profielmenu, uitloggen ──────────────────────────────────

  'kop.meldingen': { nl: 'Meldingen', ar: 'التنبيهات', en: 'Notifications' },
  'kop.geenMeldingen': { nl: 'Geen meldingen', ar: 'لا تنبيهات', en: 'No notifications' },
  'kop.allesGelezen': { nl: 'Alles gelezen', ar: 'قُرئ الكل', en: 'All read' },
  'kop.berichten': { nl: 'Berichten', ar: 'الرسائل', en: 'Messages' },
  'kop.profielmenu': { nl: 'Profielmenu', ar: 'قائمة الحساب', en: 'Profile menu' },
  'kop.instellingen': { nl: 'Instellingen', ar: 'الإعدادات', en: 'Settings' },
  'kop.uitloggen': { nl: 'Uitloggen', ar: 'تسجيل الخروج', en: 'Log out' },

  // ─── [ZOEKBALK] ─────────────────────────────────────────────────────────────────────────────

  'zb.zoeken': { nl: 'Zoeken', ar: 'بحث', en: 'Search' },
  'zb.openen': { nl: 'Zoeken openen', ar: 'فتح البحث', en: 'Open search' },
  'zb.recent': { nl: 'Recent', ar: 'الأخيرة', en: 'Recent' },
  'zb.resultaten': { nl: 'Zoekresultaten', ar: 'نتائج البحث', en: 'Search results' },

  // ─── [PLAN] Facturering & eerlijk gebruik ───────────────────────────────────────────────────

  'plan.titel': { nl: 'Plan', ar: 'الخطة', en: 'Plan' },
  'plan.uitleg': { nl: 'Welk plan er voor je geldt, en waar je je btw-facturen vindt.', ar: 'أي خطة تنطبق عليك، وأين تجد فواتير الضريبة الخاصة بك.', en: 'Which plan applies to you, and where your VAT invoices are.' },
  'plan.gebruik': { nl: 'Je gebruik deze maand', ar: 'استهلاكك هذا الشهر', en: 'Your usage this month' },
  'plan.prijsPlus': { nl: 'Prijs van Plus', ar: 'سعر Plus', en: 'The price of Plus' },
  'plan.beleid': { nl: 'Lees het beleid eerlijk gebruik', ar: 'اقرأ سياسة الاستخدام العادل', en: 'Read the fair-use policy' },
  'plan.beleidVolledig': { nl: 'Het volledige beleid', ar: 'السياسة كاملة', en: 'The full policy' },
  'plan.betaald': { nl: 'Bedankt — je betaling is gelukt.', ar: 'شكراً — تم دفعك بنجاح.', en: 'Thank you — your payment went through.' },
  'plan.jeWordt': { nl: 'Je wordt', ar: 'ستصبح', en: 'You become' },

  // ─── [VERPLAATSEN] ──────────────────────────────────────────────────────────────────────────

  'mv.naar': { nl: 'Verplaatsen naar', ar: 'نقل إلى', en: 'Move to' },
  'mv.hier': { nl: 'Hier verplaatsen', ar: 'انقل إلى هنا', en: 'Move here' },
  'mv.hoofdmap': { nl: 'Hoofdmap', ar: 'المجلد الرئيسي', en: 'Root folder' },
  'mv.zoek': { nl: 'Zoek een map…', ar: 'ابحث عن مجلد…', en: 'Search for a folder…' },
  'mv.zoekAria': { nl: 'Mappen zoeken', ar: 'البحث في المجلدات', en: 'Search folders' },
  'mv.geen': { nl: 'Geen mappen gevonden.', ar: 'لم يُعثر على مجلدات.', en: 'No folders found.' },

  // ─── [VERKOOP] Het scherm van de verkoopmedewerker ──────────────────────────────────────────
  // De medewerker die namens de eigenaar factureert kan net zo goed Arabischtalig zijn.

  'vk.jouwFacturen': { nl: 'Jouw facturen', ar: 'فواتيرك', en: 'Your invoices' },
  'vk.maken': { nl: 'Facturen maken', ar: 'إنشاء الفواتير', en: 'Creating invoices' },
  'vk.namens': { nl: 'Je maakt facturen namens', ar: 'تُنشئ الفواتير باسم', en: 'You create invoices on behalf of' },
  'vk.staatOpen': { nl: 'Staat open', ar: 'مستحق', en: 'Outstanding' },
  'vk.teLaat': { nl: 'Te laat', ar: 'متأخر', en: 'Overdue' },
  'vk.geenFacturen': { nl: 'Je hebt nog geen facturen gemaakt. Begin met de knop hierboven.', ar: 'لم تُنشئ فواتير بعد. ابدأ بالزر أعلاه.', en: 'You have not created any invoices yet. Start with the button above.' },

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

  // ── [TAAL] Shared components — a component holds no language of its own ────────────────────
  // InvoiceActions: the action row + delete confirm + betaalverzoek sheet on the detail page.
  'act.bewerken': { nl: 'Bewerken', ar: 'تعديل', en: 'Edit' },
  'act.verwijderen': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'act.betaalverzoek': { nl: 'Betaalverzoek', ar: 'طلب دفع', en: 'Payment request' },
  'act.bezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'act.bvMislukt': { nl: 'Betaalverzoek maken mislukt', ar: 'فشل إنشاء طلب الدفع', en: 'Creating the payment request failed' },
  'act.verwijderenMislukt': { nl: 'Verwijderen mislukt', ar: 'فشل الحذف', en: 'Deleting failed' },
  'act.verwijderTitel': { nl: 'Factuur verwijderen?', ar: 'حذف الفاتورة؟', en: 'Delete this invoice?' },
  'act.verwijderUitleg': {
    nl: 'Je staat op het punt factuur {number} permanent te verwijderen. Dit kan niet ongedaan worden gemaakt.',
    ar: 'أنت على وشك حذف الفاتورة {number} نهائياً. لا يمكن التراجع عن هذا.',
    en: 'You are about to permanently delete invoice {number}. This cannot be undone.',
  },
  'act.verwijderBezig': { nl: 'Verwijderen…', ar: 'جارٍ الحذف…', en: 'Deleting…' },
  'act.verwijderJa': { nl: 'Ja, verwijderen', ar: 'نعم، احذف', en: 'Yes, delete' },
  'act.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'act.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'act.bv.titel': { nl: 'Betaalverzoek voor {number}', ar: 'طلب دفع للفاتورة {number}', en: 'Payment request for {number}' },
  'act.bv.uitleg': {
    nl: 'Deel deze link met je klant. Ze betalen {amount} rechtstreeks vanuit hun eigen bank — met kenmerk {reference}. Zodra de betaling in je bankafschrift binnenkomt, herkent BoekBrug haar automatisch bij deze factuur en bevestig je het afletteren met één tik.',
    ar: 'شارك هذا الرابط مع عميلك. يدفع {amount} مباشرة من بنكه — بالمرجع {reference}. وعندما تصل الدفعة إلى كشف حسابك البنكي، يتعرّف عليها BoekBrug تلقائياً عند هذه الفاتورة وتؤكد المطابقة بلمسة واحدة.',
    en: 'Share this link with your customer. They pay {amount} straight from their own bank — with reference {reference}. As soon as the payment lands in your bank statement, BoekBrug recognises it against this invoice and you confirm the match with one tap.',
  },
  'act.bv.qrAlt': { nl: 'QR naar betaalpagina', ar: 'رمز QR لصفحة الدفع', en: 'QR to the payment page' },
  'act.bv.kopieer': { nl: 'Kopieer link', ar: 'انسخ الرابط', en: 'Copy link' },
  'act.bv.gekopieerd': { nl: 'Gekopieerd', ar: 'تم النسخ', en: 'Copied' },
  'act.bv.disclaimer': {
    nl: 'BoekBrug verwerkt de betaling niet — het geld gaat direct naar je eigen IBAN ({iban}).',
    ar: 'BoekBrug لا يعالج الدفعة — المال يذهب مباشرة إلى IBAN حسابك ({iban}).',
    en: 'BoekBrug does not process the payment — the money goes straight to your own IBAN ({iban}).',
  },

  // UblExportButton
  'ublx.mislukt': { nl: 'UBL exporteren mislukt', ar: 'فشل تصدير UBL', en: 'UBL export failed' },
  'ublx.onbekend': { nl: 'Onbekende fout', ar: 'خطأ غير معروف', en: 'Unknown error' },
  'ublx.bezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'ublx.klaar': { nl: 'Gedownload ✓', ar: 'تم التنزيل ✓', en: 'Downloaded ✓' },
  'ublx.knop': { nl: 'UBL exporteren', ar: 'تصدير UBL', en: 'Export UBL' },
  'ublx.tip': {
    nl: 'Exporteer als UBL 2.1 (e-factuur) voor je boekhoudprogramma',
    ar: 'صدّر بصيغة UBL 2.1 (فاتورة إلكترونية) لبرنامج المحاسبة لديك',
    en: 'Export as UBL 2.1 (e-invoice) for your accounting software',
  },

  // InvoiceReminders: the per-invoice reminder panel.
  'herin.titel': { nl: 'Betalingsherinneringen', ar: 'تذكيرات الدفع', en: 'Payment reminders' },
  'herin.gepauzeerd': {
    nl: 'Automatische herinneringen zijn gepauzeerd voor deze factuur.',
    ar: 'التذكيرات التلقائية موقوفة مؤقتاً لهذه الفاتورة.',
    en: 'Automatic reminders are paused for this invoice.',
  },
  'herin.actief': {
    nl: 'Deze factuur volgt je herinneringsschema (zie Instellingen).',
    ar: 'هذه الفاتورة تتبع جدول التذكيرات الخاص بك (انظر الإعدادات).',
    en: 'This invoice follows your reminder schedule (see Settings).',
  },
  'herin.hervatten': { nl: 'Hervatten', ar: 'استئناف', en: 'Resume' },
  'herin.pauzeren': { nl: 'Pauzeren', ar: 'إيقاف مؤقت', en: 'Pause' },
  'herin.verstuurd': { nl: 'Verstuurd', ar: 'التذكيرات المُرسَلة', en: 'Sent' },
  // [TAAL] Arabic counts its nouns by number band (2 → dual, 3–10 → plural, 11+ → singular
  // accusative), which one {days} slot cannot serve. "بعد {days} يوم" is the app-Arabic
  // convention that stays readable across all bands; the day-word never inflects wrongly.
  'herin.naDagen': {
    nl: 'Herinnering na {days} dagen',
    ar: 'تذكير بعد {days} يوم',
    en: 'Reminder after {days} days',
  },
  'herin.naDag': { nl: 'Herinnering na 1 dag', ar: 'تذكير بعد يوم واحد', en: 'Reminder after 1 day' },
  'herin.mislukt': { nl: ' — mislukt', ar: ' — فشل', en: ' — failed' },

  // InvoiceRow: the bank-reconciliation badges and partial-payment chip.
  'rij.inAfschrift': { nl: 'In bankafschrift', ar: 'في كشف البنك', en: 'In bank statement' },
  'rij.inAfschriftTip': {
    nl: 'Deze betaling staat in je bankafschrift',
    ar: 'هذه الدفعة موجودة في كشف حسابك البنكي',
    en: 'This payment is in your bank statement',
  },
  'rij.betalingGevonden': { nl: 'Betaling gevonden', ar: 'عُثر على دفعة', en: 'Payment found' },
  'rij.mogelijkeBetaling': { nl: 'Mogelijke betaling', ar: 'دفعة محتملة', en: 'Possible payment' },
  'rij.veiligTip': {
    nl: 'Deze betaling staat in je bankafschrift en hoort bij deze factuur — tik om te bevestigen',
    ar: 'هذه الدفعة في كشف حسابك البنكي وتخص هذه الفاتورة — انقر للتأكيد',
    en: 'This payment is in your bank statement and belongs to this invoice — tap to confirm',
  },
  'rij.controleTip': {
    nl: 'Er staat een betaling in je bankafschrift die hierbij zou kunnen horen — controleer het op de Bank-pagina',
    ar: 'توجد دفعة في كشف حسابك البنكي قد تخص هذه الفاتورة — تحقق منها في صفحة البنك',
    en: 'A payment in your bank statement may belong to this invoice — check it on the Bank page',
  },
  'rij.vervangenDoor': { nl: 'Vervangen door {number}', ar: 'استُبدلت بـ {number}', en: 'Replaced by {number}' },
  'rij.deelsOpen': { nl: 'Deels · {amount} open', ar: 'جزئي · {amount} متبقٍ', en: 'Partial · {amount} open' },
  'rij.deelsTip': {
    nl: 'Deelbetaling: {paid} van {total} betaald',
    ar: 'دفعة جزئية: {paid} من أصل {total} مدفوع',
    en: 'Partial payment: {paid} of {total} paid',
  },

  // InvoiceDocumentSheet: the paper + our reading of it, on one screen.
  'dsh.aria': { nl: 'Factuur bekijken', ar: 'عرض الفاتورة', en: 'View invoice' },
  'dsh.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'dsh.onbekendeLeverancier': { nl: 'Onbekende leverancier', ar: 'مورّد غير معروف', en: 'Unknown supplier' },
  'dsh.zonderNummer': { nl: 'zonder nummer', ar: 'بدون رقم', en: 'without a number' },
  'dsh.watGelezen': { nl: 'Wat wij hebben gelezen', ar: 'ما قرأناه نحن', en: 'What we read' },
  'dsh.factuurdatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'dsh.totaalIncl': { nl: 'Totaal incl. btw', ar: 'الإجمالي شامل btw', en: 'Total incl. VAT' },
  'dsh.btw': { nl: 'Btw', ar: 'btw (الضريبة)', en: 'VAT' },
  'dsh.exclBtw': { nl: 'Excl. btw', ar: 'بدون btw', en: 'Excl. VAT' },
  'dsh.laden': { nl: 'Bestand wordt geladen…', ar: 'جارٍ تحميل الملف…', en: 'Loading the file…' },
  'dsh.nietOpenen': { nl: 'Kon het bestand niet openen', ar: 'تعذّر فتح الملف', en: 'Could not open the file' },
  'dsh.nietOpenenVerbinding': {
    nl: 'Kon het bestand niet openen — controleer je verbinding',
    ar: 'تعذّر فتح الملف — تحقق من اتصالك',
    en: 'Could not open the file — check your connection',
  },
  'dsh.kloptNiet': { nl: 'Klopt niet — corrigeren', ar: 'غير صحيح — صحّحه', en: 'Not right — correct it' },
  'dsh.nieuwTabblad': { nl: 'Openen in nieuw tabblad', ar: 'فتح في تبويب جديد', en: 'Open in a new tab' },
  'dsh.factuurAlt': { nl: 'Factuur {number}', ar: 'الفاتورة {number}', en: 'Invoice {number}' },

  // InvoiceCorrectionModal: the ONE editor for a booked purchase invoice.
  'corr.aria': { nl: 'Factuur corrigeren', ar: 'تصحيح الفاتورة', en: 'Correct invoice' },
  'corr.titel': { nl: 'Factuur corrigeren', ar: 'تصحيح الفاتورة', en: 'Correct invoice' },
  'corr.uitleg': {
    nl: 'Neem over wat er op de factuur staat. Wat je hier verbetert, is wat je boekhouder straks ziet.',
    ar: 'انقل ما هو مكتوب على الفاتورة. ما تصحّحه هنا هو ما سيراه محاسبك لاحقاً.',
    en: 'Copy what the invoice itself says. What you correct here is what your accountant will see.',
  },
  'corr.leverancier': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'corr.factuurnummer': { nl: 'Factuurnummer', ar: 'رقم الفاتورة', en: 'Invoice number' },
  'corr.factuurdatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'corr.bedragUitleg': {
    nl: 'Neem het totaal en de BTW over zoals ze onderaan de factuur staan — het bedrag exclusief rekent zichzelf uit.',
    ar: 'انقل الإجمالي ومبلغ btw كما هما مكتوبان أسفل الفاتورة — المبلغ بدون الضريبة يُحسب تلقائياً.',
    en: 'Copy the total and the VAT exactly as printed at the bottom of the invoice — the ex-VAT amount computes itself.',
  },
  'corr.totaalIncl': { nl: 'Totaal (incl. BTW)', ar: 'الإجمالي (شامل btw)', en: 'Total (incl. VAT)' },
  'corr.btw': { nl: 'BTW', ar: 'btw', en: 'VAT' },
  'corr.exclBtw': { nl: 'Bedrag excl. BTW', ar: 'المبلغ بدون btw', en: 'Amount excl. VAT' },
  'corr.creditTitel': { nl: 'Dit is een creditnota', ar: 'هذا إشعار دائن (creditnota)', en: 'This is a credit note' },
  'corr.creditUitleg': {
    nl: ' — geld dat jou toekomt. Vink dit aan als er “Creditnota” op staat of als het totaal onderaan negatief is. De bedragen worden dan als minbedrag opgeslagen: hij gaat van je openstaande saldo af en zijn btw wordt afgetrokken in plaats van opgeteld. Je hoeft zelf geen minteken te typen — staat er al een, dan blijft die staan.',
    ar: ' — مال يعود لك. علّم هذا الخيار إذا كُتب على الوثيقة «Creditnota» أو كان الإجمالي في الأسفل سالباً. تُحفظ المبالغ حينها بالسالب: تُخصم من رصيدك المفتوح وتُطرح ضريبتها بدل أن تُضاف. لا حاجة لكتابة إشارة السالب بنفسك — وإن كانت موجودة فتبقى.',
    en: ' — money owed to you. Tick this when the document says “Creditnota” or the bottom total is negative. The amounts are then stored as negatives: it comes off your open balance and its VAT is subtracted instead of added. You never need to type a minus sign — if one is already there, it stays.',
  },
  'corr.statiegeld': {
    nl: 'Staat er statiegeld, emballage of een retour op de factuur? Dat hoort in het bedrag exclusief mee te tellen, mét zijn teken.',
    ar: 'هل على الفاتورة statiegeld (رهن عبوات) أو مرتجعات؟ يجب أن تُحسب ضمن المبلغ بدون الضريبة، بإشارتها الصحيحة.',
    en: 'Deposit (statiegeld), packaging or a return on the invoice? It belongs inside the ex-VAT amount, with its sign.',
  },
  'corr.nietsGewijzigd': { nl: 'Er is niets gewijzigd.', ar: 'لم يتغيّر شيء.', en: 'Nothing was changed.' },
  'corr.mislukt': {
    nl: 'Corrigeren mislukt — er is niets gewijzigd',
    ar: 'فشل التصحيح — لم يتغيّر شيء',
    en: 'Correction failed — nothing was changed',
  },
  'corr.misluktVerbinding': {
    nl: 'Corrigeren mislukt — controleer je verbinding',
    ar: 'فشل التصحيح — تحقق من اتصالك',
    en: 'Correction failed — check your connection',
  },
  'corr.gecorrigeerd': { nl: 'Factuur gecorrigeerd', ar: 'تم تصحيح الفاتورة', en: 'Invoice corrected' },
  'corr.opslaanBezig': { nl: 'Opslaan…', ar: 'جارٍ الحفظ…', en: 'Saving…' },
  'corr.opslaan': { nl: 'Correctie opslaan', ar: 'حفظ التصحيح', en: 'Save correction' },
  'corr.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },

  // SubPageHeader + DateFieldNL: one aria-label each.
  'nav.terug': { nl: 'Terug', ar: 'رجوع', en: 'Back' },
  'datum.kies': { nl: 'Kies een datum', ar: 'اختر تاريخاً', en: 'Pick a date' },

  // InfiniteList: empty/error/loading/end states of every infinite invoice list.
  'oneind.leeg': { nl: 'Geen facturen gevonden', ar: 'لا توجد فواتير', en: 'No invoices found' },
  'oneind.vernieuwen': { nl: 'Vernieuwen…', ar: 'جارٍ التحديث…', en: 'Refreshing…' },
  'oneind.opnieuw': { nl: 'Opnieuw', ar: 'أعد المحاولة', en: 'Retry' },
  'oneind.opnieuwAria': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'oneind.laden': { nl: 'Laden…', ar: 'جارٍ التحميل…', en: 'Loading…' },
  'oneind.alles': { nl: 'Alle facturen geladen', ar: 'تم تحميل كل الفواتير', en: 'All invoices loaded' },

  // Dashboard error boundary + 404.
  'fout.titel': { nl: 'Er is iets misgegaan', ar: 'حدث خطأ ما', en: 'Something went wrong' },
  'fout.uitleg': {
    nl: 'De pagina kon niet worden geladen. Probeer het opnieuw.',
    ar: 'تعذّر تحميل الصفحة. حاول مرة أخرى.',
    en: 'The page could not be loaded. Please try again.',
  },
  'fout.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'fout.naarDashboard': { nl: 'Naar dashboard', ar: 'إلى لوحة التحكم', en: 'To dashboard' },
  'fout404.titel': { nl: 'Niet gevonden', ar: 'غير موجود', en: 'Not found' },
  'fout404.uitleg': {
    nl: 'Deze factuur, klant of pagina bestaat niet.',
    ar: 'هذه الفاتورة أو هذا العميل أو هذه الصفحة غير موجودة.',
    en: 'This invoice, customer or page does not exist.',
  },

  // ManageSubscriptionButton (settings/facturering).
  'abo.beheer': { nl: 'Beheer abonnement', ar: 'إدارة الاشتراك', en: 'Manage subscription' },
  'abo.bezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'abo.nietOpenen': {
    nl: 'Kon het abonnementenbeheer niet openen.',
    ar: 'تعذّر فتح إدارة الاشتراك.',
    en: 'Could not open subscription management.',
  },
  'abo.geenVerbinding': {
    nl: 'Geen verbinding. Probeer het opnieuw.',
    ar: 'لا يوجد اتصال. حاول مرة أخرى.',
    en: 'No connection. Please try again.',
  },

  // KlantDetailClient: the customer detail screen.
  'kld.nieuweFactuur': { nl: '+ Nieuwe factuur', ar: '+ فاتورة جديدة', en: '+ New invoice' },
  'kld.geenEmail': { nl: 'Geen e-mail', ar: 'لا بريد إلكتروني', en: 'No e-mail' },
  'kld.gefactureerd': { nl: 'Gefactureerd', ar: 'إجمالي الفواتير', en: 'Invoiced' },
  'kld.openstaand': { nl: 'Openstaand', ar: 'المستحق', en: 'Outstanding' },
  'kld.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'kld.gegevens': { nl: 'Gegevens', ar: 'البيانات', en: 'Details' },
  'kld.adres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'kld.notities': { nl: 'Notities', ar: 'ملاحظات', en: 'Notes' },
  'kld.notitiesHint': {
    nl: 'Context over deze klant — afspraken, voorkeuren, betaalgedrag…',
    ar: 'معلومات عن هذا العميل — اتفاقات، تفضيلات، سلوك الدفع…',
    en: 'Context about this customer — agreements, preferences, payment behaviour…',
  },
  'kld.opslaanMislukt': {
    nl: 'Opslaan mislukt — probeer opnieuw.',
    ar: 'فشل الحفظ — حاول مرة أخرى.',
    en: 'Saving failed — please try again.',
  },
  'kld.opslaanBezig': { nl: 'Opslaan…', ar: 'جارٍ الحفظ…', en: 'Saving…' },
  'kld.notitieOpslaan': { nl: 'Notitie opslaan', ar: 'حفظ الملاحظة', en: 'Save note' },
  'kld.geschiedenis': { nl: 'Factuurgeschiedenis', ar: 'سجل الفواتير', en: 'Invoice history' },
  'kld.nogGeen': {
    nl: 'Nog geen facturen voor deze klant.',
    ar: 'لا فواتير لهذا العميل بعد.',
    en: 'No invoices for this customer yet.',
  },
  'kld.concept': { nl: 'Concept', ar: 'مسودة', en: 'Draft' },

  // Messages screen.
  'ber.zoek': { nl: 'Zoek op naam of bericht…', ar: 'ابحث بالاسم أو الرسالة…', en: 'Search by name or message…' },
  'ber.zoekAria': { nl: 'Berichten zoeken', ar: 'البحث في الرسائل', en: 'Search messages' },
  'ber.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'ber.ophaalFout': {
    nl: 'We konden je berichten nu niet ophalen. Probeer het zo meteen opnieuw.',
    ar: 'تعذّر جلب رسائلك الآن. حاول بعد قليل.',
    en: 'We could not fetch your messages right now. Please try again shortly.',
  },
  'ber.ophaalFoutEerlijk': {
    nl: 'We konden je berichten nu niet ophalen. Probeer het zo meteen opnieuw — dit zegt niets over of er berichten voor je zijn.',
    ar: 'تعذّر جلب رسائلك الآن. حاول بعد قليل — هذا لا يعني شيئاً عن وجود رسائل لك أو عدمه.',
    en: 'We could not fetch your messages right now. Try again shortly — this says nothing about whether you have messages.',
  },
  'ber.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'ber.leeg': { nl: 'Nog geen berichten', ar: 'لا رسائل بعد', en: 'No messages yet' },
  'ber.leegHint': {
    nl: 'Stuur een bericht via de pagina van een klant of boekhouder',
    ar: 'أرسل رسالة من صفحة عميل أو محاسب',
    en: 'Send a message from a customer or accountant page',
  },
  'ber.nietsGevonden': {
    nl: 'Geen berichten gevonden voor “{query}”.',
    ar: 'لا رسائل مطابقة لـ «{query}».',
    en: 'No messages found for “{query}”.',
  },
  'ber.onbekend': { nl: 'Onbekend', ar: 'غير معروف', en: 'Unknown' },
  'ber.afgekapt': {
    nl: 'We tonen je meest recente gesprekken — oudere berichten staan er nog, maar passen niet in dit overzicht.',
    ar: 'نعرض أحدث محادثاتك — الرسائل الأقدم ما زالت موجودة لكنها لا تتسع في هذه القائمة.',
    en: 'We show your most recent conversations — older messages still exist, they just do not fit this overview.',
  },

  // FeedbackButton: the "something went wrong" flag on every dashboard page.
  'fb.aria': { nl: 'Er ging iets mis — stuur ons een bericht', ar: 'حدث خطأ — أرسل لنا رسالة', en: 'Something went wrong — send us a message' },
  'fb.titel': { nl: 'Er ging iets mis', ar: 'حدث خطأ', en: 'Something went wrong' },
  'fb.sluit': { nl: 'Sluit', ar: 'إغلاق', en: 'Close' },
  'fb.uitleg': {
    nl: 'Schrijf kort wat er gebeurde. Een schermafbeelding helpt enorm — vaak zegt die meer dan een zin.',
    ar: 'اكتب باختصار ما حدث. لقطة الشاشة تساعد كثيراً — غالباً تقول أكثر من جملة كاملة.',
    en: 'Briefly describe what happened. A screenshot helps enormously — it often says more than a sentence.',
  },
  'fb.padMee': {
    nl: 'Wij sturen automatisch mee dat je op {path} was.',
    ar: 'نرسل تلقائياً معلومة أنك كنت في {path}.',
    en: 'We automatically include that you were on {path}.',
  },
  'fb.voorbeeld': {
    nl: 'Bijvoorbeeld: ik druk op Bevestigen en de regel komt steeds terug.',
    ar: 'مثلاً: أضغط على «تأكيد» ويعود السطر في كل مرة.',
    en: 'For example: I press Confirm and the line keeps coming back.',
  },
  'fb.teGroot': { nl: 'Die afbeelding is te groot (max 5 MB).', ar: 'الصورة كبيرة جداً (الحد 5 MB).', en: 'That image is too large (max 5 MB).' },
  'fb.nietLezen': {
    nl: 'We konden die afbeelding niet lezen. Probeer een andere.',
    ar: 'تعذّرت قراءة هذه الصورة. جرّب صورة أخرى.',
    en: 'We could not read that image. Try another one.',
  },
  'fb.bedankt': { nl: 'Bedankt — je melding is binnen.', ar: 'شكراً — وصلتنا رسالتك.', en: 'Thanks — your report has arrived.' },
  'fb.mislukt': {
    nl: 'Versturen lukte niet. Probeer het zo meteen opnieuw — je bericht is nog niet bij ons.',
    ar: 'فشل الإرسال. حاول بعد قليل — رسالتك لم تصلنا بعد.',
    en: 'Sending failed. Try again shortly — your message has not reached us.',
  },
  'fb.andereAfbeelding': { nl: 'Andere afbeelding', ar: 'صورة أخرى', en: 'Different image' },
  'fb.afbeeldingToevoegen': { nl: 'Afbeelding toevoegen', ar: 'إضافة صورة', en: 'Add image' },
  'fb.versturenBezig': { nl: 'Versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'fb.versturen': { nl: 'Versturen', ar: 'إرسال', en: 'Send' },

  // Verkoop: the honest end of a seller link (access revoked by the employer).
  'vkp.titel': {
    nl: 'Je maakt geen facturen meer voor {bedrijf}',
    ar: 'لم تعد تُنشئ فواتير لـ {bedrijf}',
    en: 'You no longer create invoices for {bedrijf}',
  },
  'vkp.uitlegMetDatum': {
    nl: '{bedrijf} heeft je toegang op {datum} ingetrokken. Dat is een keuze van je werkgever en er is niets misgegaan met je account.',
    ar: 'سحب {bedrijf} صلاحية وصولك بتاريخ {datum}. هذا قرار صاحب العمل ولا يوجد أي خلل في حسابك.',
    en: '{bedrijf} revoked your access on {datum}. That is your employer’s choice and nothing is wrong with your account.',
  },
  'vkp.uitleg': {
    nl: '{bedrijf} heeft je toegang ingetrokken. Dat is een keuze van je werkgever en er is niets misgegaan met je account.',
    ar: 'سحب {bedrijf} صلاحية وصولك. هذا قرار صاحب العمل ولا يوجد أي خلل في حسابك.',
    en: '{bedrijf} revoked your access. That is your employer’s choice and nothing is wrong with your account.',
  },
  'vkp.nietWegKop': { nl: 'Je facturen zijn niet verwijderd.', ar: 'فواتيرك لم تُحذف.', en: 'Your invoices were not deleted.' },
  'vkp.nietWegRest': {
    nl: ' Ze horen bij de boekhouding van {bedrijf} en staan daar gewoon — met de nummers die ze bij het versturen hebben gekregen.',
    ar: ' هي جزء من دفاتر {bedrijf} وما زالت موجودة هناك — بالأرقام التي حصلت عليها عند الإرسال.',
    en: ' They belong to {bedrijf}’s books and are still there — with the numbers they received when sent.',
  },
  'vkp.vraag': {
    nl: 'Klopt dit niet? Vraag het aan {bedrijf} — alleen zij kunnen de toegang terugzetten. Je eigen account blijft van jou en werkt gewoon.',
    ar: 'هل هذا غير صحيح؟ اسأل {bedrijf} — هم وحدهم يستطيعون إعادة الصلاحية. حسابك الشخصي يبقى لك ويعمل كالمعتاد.',
    en: 'Does this seem wrong? Ask {bedrijf} — only they can restore the access. Your own account remains yours and keeps working.',
  },
  'vkp.werkgever': { nl: 'je werkgever', ar: 'صاحب العمل', en: 'your employer' },

  // Kluis: the compliance vault (year cards + the Bewaarkluis offer).
  'kluis.introArchief': {
    nl: 'Je archief, per jaar bij elkaar. De Belastingdienst vraagt je stukken 7 jaar te bewaren — hier staan ze klaar, doorzoekbaar en met één knop per jaar te exporteren.',
    ar: 'أرشيفك مرتّب حسب السنة. تطلب Belastingdienst (مصلحة الضرائب) حفظ مستنداتك 7 سنوات — هنا تجدها جاهزة وقابلة للبحث، وتصدّر كل سنة بزر واحد.',
    en: 'Your archive, gathered per year. The Belastingdienst asks you to keep your records for 7 years — here they sit ready, searchable, exportable per year with one button.',
  },
  'kluis.introBoekhouden': {
    nl: 'Je administratie, per jaar bij elkaar. De Belastingdienst vraagt je stukken 7 jaar te bewaren — hier staan ze klaar, met één knop te exporteren voor je boekhouder.',
    ar: 'دفاترك مرتّبة حسب السنة. تطلب Belastingdienst (مصلحة الضرائب) حفظ مستنداتك 7 سنوات — هنا تجدها جاهزة، وتصدَّر بزر واحد لمحاسبك.',
    en: 'Your administration, gathered per year. The Belastingdienst asks you to keep your records for 7 years — here they sit ready, exportable for your accountant with one button.',
  },
  'kluis.betaaldKop': { nl: 'Bedankt — je Bewaarkluis is geregeld.', ar: 'شكراً — تم تفعيل خزانة الحفظ (Bewaarkluis).', en: 'Thank you — your Bewaarkluis is arranged.' },
  'kluis.betaaldRest': {
    nl: 'Je btw-factuur staat klaar in je e-mail. Je archief blijft staan voor de resterende bewaarjaren, en exporteren blijft altijd werken.',
    ar: 'فاتورة btw في بريدك الإلكتروني. يبقى أرشيفك محفوظاً لسنوات الحفظ المتبقية، والتصدير يعمل دائماً.',
    en: 'Your VAT invoice is in your e-mail. Your archive stays for the remaining retention years, and exporting keeps working.',
  },
  'kluis.welkomKop': { nl: 'Welkom. Breng je administratie binnen.', ar: 'أهلاً بك. أدخِل دفاترك.', en: 'Welcome. Bring in your administration.' },
  'kluis.welkomUitleg': {
    nl: 'Upload je bonnen, facturen en bankafschriften — los of in één keer. Wij zetten ze per jaar en per kwartaal op hun plek, doorzoekbaar, en je kunt elk jaar met één knop als ZIP exporteren.',
    ar: 'ارفع إيصالاتك وفواتيرك وكشوف بنكك — واحدة واحدة أو دفعة واحدة. نضعها في مكانها حسب السنة والربع، قابلة للبحث، وتستطيع تصدير كل سنة كملف ZIP بزر واحد.',
    en: 'Upload your receipts, invoices and bank statements — one by one or all at once. We file them per year and quarter, searchable, and you can export each year as a ZIP with one button.',
  },
  // The arrow is directional and travels WITH the words: in Arabic "forward" points left.
  'kluis.welkomKnop': { nl: 'Bestanden toevoegen →', ar: 'إضافة ملفات ←', en: 'Add files →' },
  'kluis.welkomVoetnoot': {
    nl: 'Alles wat je hier neerzet blijft van jou en is altijd te exporteren. Wij nemen je bewaarplicht niet over — wij zijn je tweede exemplaar, nooit je enige. En de rest van BoekBrug staat gewoon klaar voor als je hem ooit nodig hebt: er is niets afgesloten en niets te ontgrendelen.',
    ar: 'كل ما تضعه هنا يبقى ملكك ويمكن تصديره دائماً. نحن لا نتولى واجب الحفظ عنك — نحن نسختك الثانية، لا الوحيدة أبداً. وبقية BoekBrug جاهزة متى احتجتها: لا شيء مقفل ولا شيء يحتاج فتحاً.',
    en: 'Everything you put here stays yours and can always be exported. We do not take over your retention duty — we are your second copy, never your only one. And the rest of BoekBrug stands ready whenever you need it: nothing is locked and nothing needs unlocking.',
  },
  'kluis.leeg': {
    nl: 'Nog geen stukken in de kluis. Zodra je facturen verstuurt of bankafschriften en bonnen uploadt, verschijnen ze hier — netjes per jaar en kwartaal.',
    ar: 'لا مستندات في الخزانة بعد. حالما ترسل فواتير أو ترفع كشوف بنك وإيصالات، ستظهر هنا — مرتبة حسب السنة والربع.',
    en: 'No records in the vault yet. As soon as you send invoices or upload bank statements and receipts, they appear here — neatly per year and quarter.',
  },
  'kluis.exportMislukt': { nl: 'Export mislukt', ar: 'فشل التصدير', en: 'Export failed' },
  'kluis.bewarenTm': { nl: 'Bewaren t/m {year}', ar: 'الحفظ حتى {year}', en: 'Keep through {year}' },
  'kluis.nogJaar': { nl: ' · nog {years} jaar', ar: ' · السنوات المتبقية: {years}', en: ' · {years} more years' },
  'kluis.ditJaarAf': { nl: ' · dit jaar afloopt', ar: ' · ينتهي هذه السنة', en: ' · ends this year' },
  'kluis.verlopen': {
    nl: 'Bewaarplicht verlopen (sinds {year}) — mag weg',
    ar: 'انتهى واجب الحفظ (منذ {year}) — يمكن حذفه',
    en: 'Retention duty expired (since {year}) — may go',
  },
  'kluis.exporteerJaar': { nl: 'Exporteer jaar', ar: 'تصدير السنة', en: 'Export year' },
  'kluis.bezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'kluis.statUit': { nl: 'Facturen uit', ar: 'فواتير صادرة', en: 'Invoices out' },
  'kluis.statIn': { nl: 'Facturen in', ar: 'فواتير واردة', en: 'Invoices in' },
  'kluis.statAfschriften': { nl: 'Bankafschriften', ar: 'كشوف بنكية', en: 'Bank statements' },
  'kluis.statDocumenten': { nl: 'Documenten', ar: 'مستندات', en: 'Documents' },
  'kluis.qFact': { nl: '{count} fact.', ar: '{count} فاتورة', en: '{count} inv.' },
  'kluis.qGeenAfschr': { nl: '⚠ geen afschr.', ar: '⚠ لا كشوف', en: '⚠ no stmts.' },
  'kluis.qAfschr': { nl: '{count} afschr.', ar: '{count} كشف', en: '{count} stmts.' },
  'kluis.cardKop': { nl: 'Als je ooit stopt', ar: 'إذا توقفت يوماً', en: 'If you ever stop' },
  'kluis.cardUitleg': {
    nl: 'Je bewaarplicht loopt door als je onderneming stopt — en ook als je stopt met BoekBrug. Zeg je op, dan bewaren wij je administratie eerst nog {maanden} maanden kosteloos, en exporteren blijft die hele tijd werken. Wij verwijderen nooit iets zonder je minstens 30 dagen vooraf te mailen.',
    ar: 'واجب الحفظ يستمر حتى لو أغلقت مشروعك — وحتى لو توقفت عن استخدام BoekBrug. إذا ألغيت اشتراكك، نحفظ دفاترك أولاً {maanden} شهراً مجاناً، والتصدير يعمل طوال تلك المدة. لا نحذف شيئاً أبداً دون مراسلتك قبل 30 يوماً على الأقل.',
    en: 'Your retention duty continues when your business stops — and when you stop using BoekBrug. If you cancel, we first keep your administration {maanden} months free of charge, and exporting keeps working the whole time. We never delete anything without e-mailing you at least 30 days ahead.',
  },
  'kluis.cardGeregeldKop': { nl: 'Je Bewaarkluis is geregeld.', ar: 'خزانة الحفظ (Bewaarkluis) مفعّلة.', en: 'Your Bewaarkluis is arranged.' },
  'kluis.cardGeregeldRest': {
    nl: ' Wij bewaren je administratie tot en met {year}. Je hoeft verder niets te doen — en exporteren blijft die hele tijd gewoon werken.',
    ar: ' نحفظ دفاترك حتى نهاية {year}. لا يلزمك فعل أي شيء آخر — والتصدير يعمل طوال تلك المدة.',
    en: ' We keep your administration through {year}. Nothing further is needed — and exporting keeps working the whole time.',
  },
  'kluis.cardVerstreken': {
    nl: 'Je bewaarplicht voor deze administratie is verstreken (t/m {year}). Je hoeft hier niets voor te betalen.',
    ar: 'انتهى واجب الحفظ لهذه الدفاتر (حتى {year}). لا يلزمك دفع أي شيء.',
    en: 'Your retention duty for this administration has expired (through {year}). There is nothing to pay here.',
  },
  'kluis.cardAanbod': {
    nl: 'Wil je dat je stukken daarna online blijven staan — geordend, doorzoekbaar en per jaar te exporteren — dan is daar de Bewaarkluis voor. Je jongste boekjaar is {jaar}, dus je moet nog tot en met {tot} kunnen leveren.',
    ar: 'إن أردت أن تبقى مستنداتك بعد ذلك متاحة على الإنترنت — مرتبة وقابلة للبحث وتُصدَّر حسب السنة — فلهذا وُجدت خزانة الحفظ (Bewaarkluis). أحدث سنة مالية لديك هي {jaar}، أي يجب أن تستطيع التسليم حتى نهاية {tot}.',
    en: 'If you want your records to stay online after that — ordered, searchable, exportable per year — that is what the Bewaarkluis is for. Your latest fiscal year is {jaar}, so you must be able to deliver through {tot}.',
  },
  'kluis.cardStatJaren': { nl: 'Resterende bewaarjaren', ar: 'سنوات الحفظ المتبقية', en: 'Remaining retention years' },
  'kluis.cardStatVooruit': { nl: 'Eenmalig vooruit', ar: 'دفعة واحدة مقدماً', en: 'One-time upfront' },
  'kluis.cardStatVooruitSub': { nl: 'in plaats van {bedrag} per jaar', ar: 'بدل {bedrag} سنوياً', en: 'instead of {bedrag} per year' },
  'kluis.cardStatArchief': { nl: 'Je archief weegt', ar: 'حجم أرشيفك', en: 'Your archive weighs' },
  'kluis.cardStatStukken': { nl: '{count} stukken', ar: '{count} مستند', en: '{count} records' },
  'kluis.cardKnop': { nl: 'Bewaarkluis regelen — {bedrag} eenmalig', ar: 'تفعيل خزانة الحفظ — {bedrag} لمرة واحدة', en: 'Arrange Bewaarkluis — {bedrag} one-time' },
  'kluis.cardFout': { nl: 'Er ging iets mis. Probeer het opnieuw.', ar: 'حدث خطأ ما. حاول مرة أخرى.', en: 'Something went wrong. Please try again.' },
  'kluis.cardGeenVerbinding': {
    nl: 'Geen verbinding. Controleer je internet en probeer opnieuw.',
    ar: 'لا يوجد اتصال. تحقق من الإنترنت وحاول مجدداً.',
    en: 'No connection. Check your internet and try again.',
  },
  'kluis.cardVoetnoot': {
    nl: 'Wij nemen je bewaarplicht niet over — die blijft van jou. Bewaar daarom altijd ook je eigen kopie: wij zijn je tweede exemplaar, nooit je enige. Stoppen wij ooit zelf, dan hoor je dat 90 dagen van tevoren, krijg je je volledige archief toegestuurd en betalen wij het niet-verbruikte deel terug.',
    ar: 'نحن لا نتولى واجب الحفظ عنك — يبقى مسؤوليتك. لذلك احتفظ دائماً بنسختك الخاصة: نحن نسختك الثانية، لا الوحيدة أبداً. وإن توقفنا نحن يوماً، تعرف ذلك قبل 90 يوماً، ويصلك أرشيفك كاملاً، ونعيد لك الجزء غير المستهلك من المبلغ.',
    en: 'We do not take over your retention duty — it stays yours. So always keep your own copy too: we are your second copy, never your only one. Should we ever stop ourselves, you hear it 90 days ahead, receive your full archive, and we refund the unused part.',
  },

  // Verdelen: one payment across several invoices.
  'verd.titel': { nl: 'Betaling verdelen', ar: 'توزيع الدفعة', en: 'Split payment' },
  // [TAAL] Two keys, not a {richting} parameter: the direction noun would break agreement.
  'verd.uitGeld': {
    nl: 'Geld dat wegging — kies welke facturen hiermee betaald zijn.',
    ar: 'مال خرج — اختر أي الفواتير دُفعت به.',
    en: 'Money that went out — choose which invoices it paid.',
  },
  'verd.inGeld': {
    nl: 'Geld dat binnenkwam — kies welke facturen hiermee betaald zijn.',
    ar: 'مال دخل — اختر أي الفواتير دُفعت به.',
    en: 'Money that came in — choose which invoices it paid.',
  },
  'verd.alVerdeeld': {
    nl: 'Deze betaling van {amount} is al helemaal verdeeld over facturen.',
    ar: 'هذه الدفعة البالغة {amount} وُزّعت بالكامل على فواتير.',
    en: 'This payment of {amount} is already fully split across invoices.',
  },
  'verd.alVerdeeldUitleg': {
    nl: 'Er valt hier niets meer toe te wijzen. Klopt de verdeling niet, ontkoppel dan eerst een factuur op de bankpagina — dan komt dat bedrag hier weer vrij.',
    ar: 'لا شيء متبقٍ للتوزيع هنا. إن كان التوزيع خاطئاً، فافصل أولاً فاتورة في صفحة البنك — فيتحرر ذلك المبلغ هنا من جديد.',
    en: 'There is nothing left to assign. If the split is wrong, first unlink an invoice on the bank page — that amount then becomes available here again.',
  },
  'verd.terugBank': { nl: 'Terug naar de bank', ar: 'العودة إلى البنك', en: 'Back to the bank' },
  'verd.onbekendeTegenpartij': { nl: 'Onbekende tegenpartij', ar: 'طرف مقابل غير معروف', en: 'Unknown counterparty' },
  'verd.geenOmschrijving': { nl: 'geen omschrijving', ar: 'بلا وصف', en: 'no description' },
  'verd.nogTeVerdelen': { nl: 'Nog te verdelen', ar: 'المتبقي للتوزيع', en: 'Still to split' },
  'verd.alGekoppeld': {
    nl: '{amount} van deze betaling was al gekoppeld.',
    ar: '{amount} من هذه الدفعة كان مرتبطاً من قبل.',
    en: '{amount} of this payment was already linked.',
  },
  'verd.zoek': { nl: 'Zoek op leverancier of factuurnummer…', ar: 'ابحث بالمورّد أو رقم الفاتورة…', en: 'Search by supplier or invoice number…' },
  'verd.zoekAria': { nl: 'Facturen zoeken', ar: 'البحث في الفواتير', en: 'Search invoices' },
  // [TAAL] Two keys per direction, same agreement argument as above.
  'verd.geenInkoop': {
    nl: 'Er staat geen enkele inkoopfactuur open. Staat de factuur er nog niet in, voeg hem dan eerst toe — deze betaling blijft zolang gewoon staan.',
    ar: 'لا توجد أي فاتورة مشتريات مفتوحة. إن لم تكن الفاتورة مُدخلة بعد فأضفها أولاً — هذه الدفعة تبقى كما هي في الانتظار.',
    en: 'There is no open purchase invoice at all. If the invoice is not in yet, add it first — this payment simply stays put meanwhile.',
  },
  'verd.geenVerkoop': {
    nl: 'Er staat geen enkele verkoopfactuur open. Staat de factuur er nog niet in, voeg hem dan eerst toe — deze betaling blijft zolang gewoon staan.',
    ar: 'لا توجد أي فاتورة مبيعات مفتوحة. إن لم تكن الفاتورة مُدخلة بعد فأضفها أولاً — هذه الدفعة تبقى كما هي في الانتظار.',
    en: 'There is no open sales invoice at all. If the invoice is not in yet, add it first — this payment simply stays put meanwhile.',
  },
  'verd.geenMatch': { nl: 'Geen factuur die daaraan voldoet.', ar: 'لا فاتورة تطابق ذلك.', en: 'No invoice matches that.' },
  'verd.factuurWoord': { nl: 'factuur', ar: 'الفاتورة', en: 'invoice' },
  'verd.kiezenAria': { nl: '{name} kiezen', ar: 'اختيار {name}', en: 'Choose {name}' },
  'verd.credit': { nl: 'creditnota — gaat eraf', ar: 'إشعار دائن — يُخصم', en: 'credit note — comes off' },
  'verd.zonderNummer': { nl: 'zonder nummer', ar: 'بدون رقم', en: 'without a number' },
  'verd.nogOpen': { nl: 'nog open {amount}', ar: 'متبقٍ {amount}', en: '{amount} still open' },
  'verd.bedragAria': { nl: 'Bedrag voor {name}', ar: 'المبلغ لـ {name}', en: 'Amount for {name}' },
  'verd.blijftOpen': { nl: 'blijft {amount} open', ar: 'يبقى {amount} مفتوحاً', en: '{amount} stays open' },
  'verd.nietGeboekt': { nl: 'De verdeling is niet geboekt.', ar: 'لم يُسجَّل التوزيع.', en: 'The split was not booked.' },
  'verd.misgegaan': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'verd.afgeboektEen': { nl: '1 factuur afgeboekt.', ar: 'سُوّيت فاتورة واحدة.', en: '1 invoice settled.' },
  'verd.afgeboekt': { nl: '{count} facturen afgeboekt.', ar: 'سُوّيت {count} فاتورة.', en: '{count} invoices settled.' },
  'verd.bezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'verd.geboekt': { nl: 'Geboekt', ar: 'تم التسجيل', en: 'Booked' },
  'verd.boekEen': { nl: 'Boek 1 factuur', ar: 'سجّل فاتورة واحدة', en: 'Book 1 invoice' },
  'verd.boek': { nl: 'Boek {count} facturen', ar: 'سجّل {count} فاتورة', en: 'Book {count} invoices' },
  'verd.voetnoot': {
    nl: 'Een factuur die maar deels betaald is, blijft voor de rest openstaan — er wordt niets weggeschreven. Wat er van de betaling overblijft blijft ook staan; ontkoppelen kan altijd.',
    ar: 'الفاتورة المدفوعة جزئياً يبقى باقيها مفتوحاً — لا يُشطب شيء. وما يتبقى من الدفعة يبقى أيضاً؛ والفصل ممكن دائماً.',
    en: 'A partially paid invoice stays open for the rest — nothing is written off. Whatever remains of the payment also stays; unlinking is always possible.',
  },

  // BankConnectPanel: the Enable Banking connect card on the bank page.
  'bkc.nogNiet': { nl: 'nog niet', ar: 'ليس بعد', en: 'not yet' },
  'bkc.verlopen': {
    nl: 'De toestemming is verlopen — koppel opnieuw om transacties te blijven ontvangen.',
    ar: 'انتهت صلاحية الإذن — أعد الربط ليستمر وصول المعاملات.',
    en: 'The consent has expired — reconnect to keep receiving transactions.',
  },
  'bkc.verlooptVandaag': { nl: 'De toestemming verloopt vandaag — koppel opnieuw.', ar: 'ينتهي الإذن اليوم — أعد الربط.', en: 'The consent expires today — reconnect.' },
  'bkc.verlooptMorgen': { nl: 'De toestemming verloopt morgen — koppel opnieuw.', ar: 'ينتهي الإذن غداً — أعد الربط.', en: 'The consent expires tomorrow — reconnect.' },
  'bkc.verlooptOver': {
    nl: 'De toestemming verloopt over {days} dagen — koppel opnieuw.',
    ar: 'ينتهي الإذن بعد {days} يوم — أعد الربط.',
    en: 'The consent expires in {days} days — reconnect.',
  },
  'bkc.geldigDagen': {
    nl: 'Toestemming geldig tot en met {days} dagen vanaf nu.',
    ar: 'الإذن صالح لمدة {days} يوماً من الآن.',
    en: 'Consent valid through {days} days from now.',
  },
  'bkc.geldigTot': { nl: 'Toestemming geldig tot {date}.', ar: 'الإذن صالح حتى {date}.', en: 'Consent valid until {date}.' },
  'bkc.laatstOpgehaald': { nl: 'Laatst opgehaald: {time}', ar: 'آخر جلب: {time}', en: 'Last fetched: {time}' },
  'bkc.pending': { nl: 'Nog niet afgerond bij je bank.', ar: 'لم يكتمل بعد لدى بنكك.', en: 'Not yet completed at your bank.' },
  'bkc.expired': { nl: 'De toestemming is verlopen.', ar: 'انتهت صلاحية الإذن.', en: 'The consent has expired.' },
  'bkc.error': { nl: 'Er ging iets mis bij het ophalen.', ar: 'حدث خطأ أثناء الجلب.', en: 'Something went wrong while fetching.' },
  'bkc.revoked': { nl: 'Losgekoppeld.', ar: 'مفصول.', en: 'Disconnected.' },
  'bkc.banklijstFout': { nl: 'De banklijst kon niet geladen worden.', ar: 'تعذّر تحميل قائمة البنوك.', en: 'The bank list could not be loaded.' },
  'bkc.koppelenMislukt': { nl: 'Koppelen mislukt.', ar: 'فشل الربط.', en: 'Connecting failed.' },
  'bkc.ophalenMislukt': { nl: 'Ophalen mislukt.', ar: 'فشل الجلب.', en: 'Fetching failed.' },
  'bkc.metWaarschuwingenEen': {
    nl: '{inserted} nieuwe transacties. Let op: 1 regel kon niet gelezen worden.',
    ar: '{inserted} معاملة جديدة. تنبيه: سطر واحد تعذّرت قراءته.',
    en: '{inserted} new transactions. Note: 1 line could not be read.',
  },
  'bkc.metWaarschuwingen': {
    nl: '{inserted} nieuwe transacties. Let op: {warnings} regels konden niet gelezen worden.',
    ar: '{inserted} معاملة جديدة. تنبيه: {warnings} سطراً تعذّرت قراءتها.',
    en: '{inserted} new transactions. Note: {warnings} lines could not be read.',
  },
  'bkc.teSnel': {
    nl: 'Je bank staat een beperkt aantal opvragingen per dag toe. Morgen halen we automatisch de rest op.',
    ar: 'بنكك يسمح بعدد محدود من الاستعلامات يومياً. غداً نجلب الباقي تلقائياً.',
    en: 'Your bank allows a limited number of requests per day. Tomorrow we fetch the rest automatically.',
  },
  'bkc.opgehaald': { nl: '{inserted} nieuwe transacties opgehaald.', ar: 'جُلبت {inserted} معاملة جديدة.', en: '{inserted} new transactions fetched.' },
  'bkc.geenNieuwe': { nl: 'Geen nieuwe transacties bij je bank.', ar: 'لا معاملات جديدة لدى بنكك.', en: 'No new transactions at your bank.' },
  'bkc.ontkoppelenMislukt': { nl: 'Ontkoppelen mislukt.', ar: 'فشل الفصل.', en: 'Disconnecting failed.' },
  'bkc.ontkoppeld': {
    nl: 'Bank ontkoppeld. Je transacties blijven bewaard.',
    ar: 'فُصل البنك. معاملاتك تبقى محفوظة.',
    en: 'Bank disconnected. Your transactions remain stored.',
  },
  'bkc.koppelKop': { nl: 'Koppel je bank', ar: 'اربط بنكك', en: 'Connect your bank' },
  'bkc.koppelSub': {
    nl: 'Dan komen je transacties automatisch binnen en hoef je geen afschrift meer te uploaden.',
    ar: 'فتصل معاملاتك تلقائياً ولا تحتاج إلى رفع كشوف بعد الآن.',
    en: 'Your transactions then arrive automatically and you no longer upload statements.',
  },
  'bkc.kiesBank': { nl: 'Kies je bank', ar: 'اختر بنكك', en: 'Choose your bank' },
  'bkc.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bkc.leesrechten': {
    nl: 'Je logt straks in bij je eigen bank. BoekBrug krijgt alleen leesrechten op je transacties — nooit de mogelijkheid om geld over te maken.',
    ar: 'ستسجل الدخول لدى بنكك مباشرة. يحصل BoekBrug على صلاحية قراءة معاملاتك فقط — لا إمكانية تحويل أموال أبداً.',
    en: 'You will log in at your own bank. BoekBrug only gets read access to your transactions — never the ability to transfer money.',
  },
  'bkc.bankenLaden': { nl: 'Banken laden…', ar: 'جارٍ تحميل البنوك…', en: 'Loading banks…' },
  'bkc.geenBanken': {
    nl: 'Er zijn nu geen banken beschikbaar. Upload je afschrift zoals je gewend bent.',
    ar: 'لا بنوك متاحة حالياً. ارفع كشفك كما اعتدت.',
    en: 'No banks are available right now. Upload your statement as you are used to.',
  },
  'bkc.rekening': { nl: 'Rekening', ar: 'حساب', en: 'Account' },
  'bkc.bijgewerktTm': { nl: ' · bijgewerkt t/m {date}', ar: ' · محدَّث حتى {date}', en: ' · updated through {date}' },
  'bkc.opnieuwKoppelen': { nl: 'Opnieuw koppelen', ar: 'إعادة الربط', en: 'Reconnect' },
  'bkc.dagLimiet': {
    nl: 'Je bank staat een beperkt aantal opvragingen per dag toe.',
    ar: 'بنكك يسمح بعدد محدود من الاستعلامات يومياً.',
    en: 'Your bank allows a limited number of requests per day.',
  },
  'bkc.bezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'bkc.ververs': { nl: 'Ververs', ar: 'تحديث', en: 'Refresh' },
  'bkc.ontkoppelen': { nl: 'Ontkoppelen', ar: 'فصل', en: 'Disconnect' },
  'bkc.afschriftNodig': {
    nl: 'Je transacties komen nu automatisch binnen. Het originele bankafschrift zelf krijgen we niet van je bank — upload dat per kwartaal alsnog, dan is het pakket voor je boekhouder compleet.',
    ar: 'معاملاتك تصل الآن تلقائياً. لكن كشف الحساب الأصلي نفسه لا يصلنا من بنكك — ارفعه كل ربع سنة، فيكتمل الملف لمحاسبك.',
    en: 'Your transactions now arrive automatically. The original bank statement itself we do not get from your bank — still upload it per quarter, so your accountant’s package is complete.',
  },

  // SnelStartCard: the SnelStart link card on Settings. SnelStart's own menu names
  // (Onderhoud → Maatwerk) stay Dutch in every language — a sentence that points at a
  // button names the button as it is written.
  'ss.uitleg': {
    nl: 'Stuur je gecontroleerde facturen en bonnen rechtstreeks als inkoop- en verkoopboeking naar je SnelStart-administratie. Alleen facturen die je hebt gecontroleerd gaan mee, en elke factuur gaat maar één keer.',
    ar: 'أرسل فواتيرك وإيصالاتك المدقَّقة مباشرة كقيود مشتريات ومبيعات إلى إدارة SnelStart لديك. تذهب الفواتير التي دققتها فقط، وكل فاتورة مرة واحدة لا غير.',
    en: 'Send your checked invoices and receipts straight to your SnelStart administration as purchase and sales bookings. Only invoices you checked go along, and each invoice goes only once.',
  },
  'ss.sleutelOud': {
    nl: 'SnelStart accepteert je maatwerksleutel niet meer. Maak in SnelStart een nieuwe sleutel aan en plak die hieronder.',
    ar: 'لم يعد SnelStart يقبل مفتاحك المخصص. أنشئ مفتاحاً جديداً في SnelStart والصقه أدناه.',
    en: 'SnelStart no longer accepts your custom key. Create a new key in SnelStart and paste it below.',
  },
  'ss.sleutel': { nl: 'Maatwerksleutel', ar: 'المفتاح المخصص (maatwerksleutel)', en: 'Custom key (maatwerksleutel)' },
  'ss.sleutelHint': { nl: 'Plak hier je sleutel uit SnelStart', ar: 'الصق هنا مفتاحك من SnelStart', en: 'Paste your key from SnelStart here' },
  'ss.sleutelWaar': {
    nl: 'In SnelStart: Onderhoud → Maatwerk → maak een koppelsleutel aan. De sleutel geldt voor één administratie en wordt versleuteld bewaard.',
    ar: 'في SnelStart: ‏Onderhoud ← Maatwerk ← أنشئ مفتاح ربط. المفتاح يخص إدارة واحدة ويُحفظ مشفَّراً.',
    en: 'In SnelStart: Onderhoud → Maatwerk → create a link key. The key covers one administration and is stored encrypted.',
  },
  'ss.adminNaam': { nl: 'Naam van de administratie (optioneel)', ar: 'اسم الإدارة (اختياري)', en: 'Administration name (optional)' },
  'ss.adminNaamHint': { nl: 'Bijv. Bakkerij 2026', ar: 'مثلاً: Bakkerij 2026', en: 'E.g. Bakery 2026' },
  'ss.controleren': { nl: 'Controleren…', ar: 'جارٍ التحقق…', en: 'Checking…' },
  'ss.koppelen': { nl: 'Koppelen met SnelStart', ar: 'الربط مع SnelStart', en: 'Connect with SnelStart' },
  'ss.koppelenMislukt': { nl: 'Koppelen mislukt', ar: 'فشل الربط', en: 'Connecting failed' },
  'ss.gekoppeldKies': {
    nl: 'SnelStart is gekoppeld. Kies nu op welke rekeningen geboekt moet worden.',
    ar: 'تم الربط مع SnelStart. اختر الآن الحسابات التي سيُسجَّل عليها.',
    en: 'SnelStart is connected. Now choose which accounts to book onto.',
  },
  'ss.gekoppeld': { nl: '✓ Gekoppeld', ar: '✓ مربوط', en: '✓ Connected' },
  'ss.doorgestuurd': { nl: '{count} doorgestuurd', ar: '{count} أُرسلت', en: '{count} forwarded' },
  'ss.zonderBevestiging': {
    nl: '{count} zonder bevestiging — controleer in SnelStart',
    ar: '{count} بلا تأكيد — تحقق في SnelStart',
    en: '{count} without confirmation — check in SnelStart',
  },
  'ss.mislukt': { nl: '{count} mislukt', ar: '{count} فشلت', en: '{count} failed' },
  'ss.wachtAkkoord': { nl: '{count} wacht op je akkoord', ar: '{count} بانتظار موافقتك', en: '{count} awaiting your approval' },
  'ss.wachtKop': { nl: 'Wacht op je akkoord', ar: 'بانتظار موافقتك', en: 'Awaiting your approval' },
  'ss.wachtUitleg': {
    nl: 'Deze facturen zouden een boeking worden, maar er staat nog een voorbehoud op. Kijk op het papier en stuur ze door als het klopt — daarna kan je boekhouder ze niet meer terugdraaien, dus dit is het moment.',
    ar: 'هذه الفواتير كانت ستصبح قيوداً، لكن ما زال عليها تحفُّظ. انظر إلى الورقة وأرسلها إن كانت صحيحة — بعدها لا يستطيع محاسبك التراجع عنها، فهذه هي اللحظة المناسبة.',
    en: 'These invoices would become bookings, but a reservation still stands. Look at the paper and forward them if it is right — after that your accountant cannot reverse them, so this is the moment.',
  },
  'ss.akkoordBezig': { nl: 'Bezig…', ar: 'جارٍ العمل…', en: 'Working…' },
  'ss.akkoordKnop': { nl: 'Ik weet het, stuur toch door', ar: 'أنا متأكد، أرسلها رغم ذلك', en: 'I know — send it anyway' },
  'ss.akkoordMislukt': { nl: 'Akkoord opslaan mislukt', ar: 'فشل حفظ الموافقة', en: 'Saving the approval failed' },
  'ss.akkoordVast': {
    nl: 'Akkoord vastgelegd — deze factuur gaat mee met de volgende keer doorsturen.',
    ar: 'سُجّلت الموافقة — سترافق هذه الفاتورة الإرسال القادم.',
    en: 'Approval recorded — this invoice goes along with the next forward.',
  },
  'ss.geenVoorbehoud': { nl: 'Er stond geen voorbehoud meer open.', ar: 'لم يعد هناك أي تحفظ مفتوح.', en: 'No reservation remained open.' },
  'ss.geenVerbindingAkkoord': {
    nl: 'Geen verbinding — er is niets vastgelegd.',
    ar: 'لا اتصال — لم يُسجَّل شيء.',
    en: 'No connection — nothing was recorded.',
  },
  'ss.kiesEerst': {
    nl: 'Kies eerst de rekeningen waarop geboekt moet worden.',
    ar: 'اختر أولاً الحسابات التي سيُسجَّل عليها.',
    en: 'First choose the accounts to book onto.',
  },
  'ss.inkoopOp': { nl: 'Inkoop boeken op', ar: 'تسجيل المشتريات على', en: 'Book purchases onto' },
  'ss.verkoopOp': { nl: 'Verkoop boeken op', ar: 'تسجيل المبيعات على', en: 'Book sales onto' },
  'ss.kiesRekening': { nl: 'Kies een rekening…', ar: 'اختر حساباً…', en: 'Choose an account…' },
  'ss.grootboekenMislukt': { nl: 'Grootboeken ophalen mislukt', ar: 'فشل جلب حسابات الأستاذ', en: 'Fetching ledger accounts failed' },
  'ss.opslaanBezig': { nl: 'Opslaan…', ar: 'جارٍ الحفظ…', en: 'Saving…' },
  'ss.rekeningenOpslaan': { nl: 'Rekeningen opslaan', ar: 'حفظ الحسابات', en: 'Save accounts' },
  'ss.opslaanMislukt': { nl: 'Opslaan mislukt', ar: 'فشل الحفظ', en: 'Saving failed' },
  'ss.rekeningenOpgeslagen': { nl: 'Rekeningen opgeslagen.', ar: 'حُفظت الحسابات.', en: 'Accounts saved.' },
  'ss.boekenBezig': { nl: 'Bezig met boeken…', ar: 'جارٍ التسجيل…', en: 'Booking…' },
  'ss.nietsTeVersturen': { nl: 'Niets te versturen', ar: 'لا شيء للإرسال', en: 'Nothing to send' },
  'ss.stuurDoorEen': { nl: 'Stuur 1 factuur door', ar: 'أرسل فاتورة واحدة', en: 'Forward 1 invoice' },
  'ss.stuurDoor': { nl: 'Stuur {count} facturen door', ar: 'أرسل {count} فاتورة', en: 'Forward {count} invoices' },
  'ss.doorsturenMislukt': { nl: 'Doorsturen mislukt', ar: 'فشل الإرسال', en: 'Forwarding failed' },
  'ss.nogTeGaan': { nl: ' Nog {count} te gaan.', ar: ' بقي {count}.', en: ' {count} to go.' },
  'ss.deelsGelukt': { nl: '{pushed} geboekt, {failed} niet gelukt.', ar: 'سُجّلت {pushed}، وفشلت {failed}.', en: '{pushed} booked, {failed} failed.' },
  'ss.geboektEen': { nl: '1 factuur geboekt in SnelStart.', ar: 'سُجّلت فاتورة واحدة في SnelStart.', en: '1 invoice booked in SnelStart.' },
  'ss.geboekt': { nl: '{count} facturen geboekt in SnelStart.', ar: 'سُجّلت {count} فاتورة في SnelStart.', en: '{count} invoices booked in SnelStart.' },
  'ss.ontkoppelen': { nl: 'Ontkoppelen', ar: 'فصل', en: 'Disconnect' },
  'ss.ontkoppeld': { nl: 'De koppeling met SnelStart is verbroken.', ar: 'قُطع الربط مع SnelStart.', en: 'The SnelStart link is disconnected.' },
  'ss.laatstDoorgestuurd': { nl: 'Laatst doorgestuurd op {time}.', ar: 'آخر إرسال في {time}.', en: 'Last forwarded on {time}.' },
  'ss.zonderNummer': { nl: 'Zonder nummer', ar: 'بدون رقم', en: 'Without a number' },

  // Bestanden shared components (tree, cards, upload, preview, bulk bar).
  'bst.uitklappen': { nl: 'Uitklappen', ar: 'توسيع', en: 'Expand' },
  'bst.naamWijzigen': { nl: 'Naam wijzigen', ar: 'إعادة التسمية', en: 'Rename' },
  'bst.verwijderen': { nl: 'Verwijderen', ar: 'حذف', en: 'Delete' },
  'bst.meerOpties': { nl: 'Meer opties', ar: 'خيارات أكثر', en: 'More options' },
  'bst.gedeeldStop': {
    nl: 'Gedeeld met boekhouder — tik om te stoppen',
    ar: 'مُشارَك مع المحاسب — انقر للإيقاف',
    en: 'Shared with your accountant — tap to stop',
  },
  'bst.delen': { nl: 'Delen met boekhouder', ar: 'مشاركة مع المحاسب', en: 'Share with your accountant' },
  'bst.nietDelen': { nl: 'Niet meer delen', ar: 'إيقاف المشاركة', en: 'Stop sharing' },
  'bst.openMap': { nl: 'Open map: {folder}', ar: 'افتح المجلد: {folder}', en: 'Open folder: {folder}' },
  'bst.openMijn': { nl: 'Open in Mijn bestanden', ar: 'افتح في «ملفاتي»', en: 'Open in My files' },
  'bst.mijnBestanden': { nl: 'Mijn bestanden', ar: 'ملفاتي', en: 'My files' },
  'bst.uploadMislukt': { nl: 'Upload mislukt', ar: 'فشل الرفع', en: 'Upload failed' },
  'bst.onbekendeFout': { nl: 'Onbekende fout', ar: 'خطأ غير معروف', en: 'Unknown error' },
  'bst.loslaten': { nl: 'Loslaten om te uploaden', ar: 'أفلت للرفع', en: 'Release to upload' },
  'bst.typenMax': {
    nl: 'Alle bestandstypen — max 50MB · meerdere bestanden tegelijk',
    ar: 'كل أنواع الملفات — الحد الأقصى 50MB · عدة ملفات معاً',
    en: 'All file types — max 50MB · multiple files at once',
  },
  'bst.sleep': {
    nl: 'Sleep bestanden of tik om te uploaden',
    ar: 'اسحب الملفات أو انقر للرفع',
    en: 'Drag files or tap to upload',
  },
  'bst.sluiten': { nl: 'Sluiten', ar: 'إغلاق', en: 'Close' },
  'bst.previewNiet': { nl: 'Preview niet beschikbaar', ar: 'المعاينة غير متاحة', en: 'Preview not available' },
  'bst.geselecteerd': { nl: '{count} geselecteerd', ar: '{count} محدَّد', en: '{count} selected' },
  'bst.selectieWissen': { nl: 'Selectie wissen', ar: 'إلغاء التحديد', en: 'Clear selection' },

  // ─── [PAY-REDEN] Waarom afboeken of terugdraaien niet lukte ─────────────────────────────────
  //
  // One line per code /api/invoice/pay-toggle can refuse with. Three screens ask that route and
  // each used to answer differently — /vandaag showed the bare code, so a shop owner read
  // "invoice_already_paid" on their phone, in Dutch as well as in Arabic. The mapping lives in
  // pay-toggle-reason.ts; these are the words.
  //
  // Each line is a REASON, not an apology: it says what happened and, where the owner can do
  // something, what. "Ververs de pagina" is an instruction; "er ging iets mis" is not, and is used
  // only where nothing better is true.
  'pay.reden.verwerkt': {
    nl: 'Je boekhouder heeft deze factuur al verwerkt',
    ar: 'محاسبك عالج هذه الفاتورة بالفعل',
    en: 'Your accountant has already processed this invoice',
  },
  'pay.reden.alBetaald': {
    nl: 'Deze factuur staat al als betaald',
    ar: 'هذه الفاتورة مُسجَّلة كمدفوعة بالفعل',
    en: 'This invoice is already marked as paid',
  },
  'pay.reden.nietGevonden': {
    nl: 'Deze factuur is niet gevonden',
    ar: 'لم يتم العثور على هذه الفاتورة',
    en: 'This invoice was not found',
  },
  'pay.reden.nietBetaald': {
    nl: 'Er staat geen betaling op deze factuur',
    ar: 'لا توجد دفعة مسجَّلة على هذه الفاتورة',
    en: 'There is no payment on this invoice',
  },
  'pay.reden.nietAfboekbaar': {
    nl: 'Deze factuur kan nu niet als betaald worden gemarkeerd',
    ar: 'لا يمكن تسجيل هذه الفاتورة كمدفوعة الآن',
    en: 'This invoice cannot be marked as paid right now',
  },
  'pay.reden.statusVeranderd': {
    nl: 'De status is inmiddels veranderd — ververs de pagina',
    ar: 'تغيَّرت الحالة في هذه الأثناء — حدِّث الصفحة',
    en: 'The status has changed in the meantime — refresh the page',
  },
  'pay.reden.sessieVerlopen': {
    nl: 'Je sessie is verlopen — log opnieuw in',
    ar: 'انتهت جلستك — سجّل الدخول من جديد',
    en: 'Your session has expired — log in again',
  },
  'pay.reden.bedragOngeldig': {
    nl: 'Het ingevoerde bedrag is niet geldig',
    ar: 'المبلغ المُدخَل غير صالح',
    en: 'The amount entered is not valid',
  },
  'pay.reden.datumOngeldig': {
    nl: 'De betaaldatum kan niet kloppen — controleer het jaartal',
    ar: 'تاريخ الدفع لا يمكن أن يكون صحيحاً — تحقّق من السنة',
    en: 'The payment date cannot be right — check the year',
  },
  'pay.reden.deelKasOnmogelijk': {
    nl: 'Een deelbetaling kan op dit moment alleen via bank worden genoteerd',
    ar: 'الدفعة الجزئية يمكن تسجيلها حالياً عبر البنك فقط',
    en: 'A partial payment can only be recorded by bank at the moment',
  },
  'pay.reden.referentieBotst': {
    nl: 'Deze betaling is met dezelfde referentie al op een andere factuur vastgelegd — ververs de pagina',
    ar: 'هذه الدفعة سُجِّلت بالمرجع نفسه على فاتورة أخرى — حدِّث الصفحة',
    en: 'This payment was already recorded under the same reference on another invoice — refresh the page',
  },
  'pay.reden.leesFout': {
    nl: 'We konden de gekoppelde betalingen niet lezen — er is niets gewijzigd',
    ar: 'تعذّرت قراءة الدفعات المرتبطة — لم يتغيّر شيء',
    en: 'We could not read the linked payments — nothing was changed',
  },
  'pay.reden.terugdraaienMislukt': {
    nl: 'Terugdraaien is niet gelukt — er is niets gewijzigd',
    ar: 'لم ينجح التراجع — لم يتغيّر شيء',
    en: 'Undoing did not succeed — nothing was changed',
  },
  'pay.reden.algemeen': {
    nl: 'Bijwerken is niet gelukt — ververs de pagina',
    ar: 'لم ينجح التحديث — حدِّث الصفحة',
    en: 'Updating did not succeed — refresh the page',
  },

  // ── [TAAL-BLIND] The 472 strings the first scanner could not see — multi-line text
  // nodes and strings inside JSX expressions. Translated in one sweep; the extended gate
  // patterns above the SCREENS list are what keeps this from regrowing.
  'art.alles.bevestig': {
    nl: 'Alles verwijderen',
    ar: 'حذف الكل',
    en: 'Delete everything',
  },
  'art.alles.gebruikt': {
    nl: '{n} van deze artikelen heb je eerder op een factuur gebruikt.',
    ar: 'عدد البنود التي سبق أن استعملتها على فاتورة: {n}.',
    en: 'You have previously used {n} of these articles on an invoice.',
  },
  'art.alles.knop': {
    nl: 'Alle {n} artikelen verwijderen',
    ar: 'حذف كل البنود ({n})',
    en: 'Delete all {n} articles',
  },
  'art.alles.titel': {
    nl: 'Alle {n} artikelen verwijderen?',
    ar: 'هل تريد حذف كل البنود ({n})؟',
    en: 'Delete all {n} articles?',
  },
  'art.alles.uitleg': {
    nl: 'Je facturen veranderen hier niet van — een artikel is een sjabloon, de tekst en het bedrag staan al op de factuur zelf.',
    ar: 'فواتيرك لن تتغيّر — البند مجرد قالب، فالنص والمبلغ محفوظان على الفاتورة نفسها.',
    en: 'Your invoices do not change — an article is a template; the text and the amount are already on the invoice itself.',
  },
  'art.alles.weg': {
    nl: 'De lijst zelf is daarna weg en komt niet terug.',
    ar: 'القائمة نفسها ستُحذف بعد ذلك ولن تعود.',
    en: 'The list itself will then be gone and will not come back.',
  },
  'art.archiveer': {
    nl: 'Archiveer',
    ar: 'أرشفة',
    en: 'Archive',
  },
  'art.bewerken': {
    nl: 'Artikel bewerken',
    ar: 'تعديل البند',
    en: 'Edit article',
  },
  'art.bijgewerkt': {
    nl: 'Artikel bijgewerkt',
    ar: 'حُدِّث البند',
    en: 'Article updated',
  },
  'art.btwLabel': {
    nl: '{rate}% BTW',
    ar: '{rate}% btw',
    en: '{rate}% VAT',
  },
  'art.btwTarief': {
    nl: 'BTW-tarief',
    ar: 'نسبة btw',
    en: 'VAT rate',
  },
  'art.fout.leegmaken': {
    nl: 'Leegmaken mislukt — er is niets verwijderd.',
    ar: 'فشل الإفراغ — لم يُحذف شيء.',
    en: 'Emptying failed — nothing was deleted.',
  },
  'art.fout.leegmakenVerbinding': {
    nl: 'Leegmaken mislukt — controleer je verbinding',
    ar: 'فشل الإفراغ — تحقّق من اتصالك',
    en: 'Emptying failed — check your connection',
  },
  'art.fout.opslaan': {
    nl: 'Kon niet opslaan.',
    ar: 'تعذّر الحفظ.',
    en: 'Could not save.',
  },
  'art.fout.verwijderen': {
    nl: 'Verwijderen mislukt — probeer opnieuw.',
    ar: 'فشل الحذف — حاول مرة أخرى.',
    en: 'Deleting failed — please try again.',
  },
  'art.gearchiveerd': {
    nl: 'gearchiveerd',
    ar: 'مؤرشف',
    en: 'archived',
  },
  'art.geenGevonden': {
    nl: 'Geen artikel gevonden.',
    ar: 'لم يُعثر على بند.',
    en: 'No article found.',
  },
  'art.herstel': {
    nl: 'Herstel',
    ar: 'استعادة',
    en: 'Restore',
  },
  'art.keerGebruikt': {
    nl: '{n}× gebruikt',
    ar: 'عدد مرات الاستعمال: {n}',
    en: 'used {n}×',
  },
  'art.leeg': {
    nl: 'Nog geen artikelen. Voeg je eerste vaste factuurregel toe.',
    ar: 'لا بنود بعد. أضف أول بند فاتورة ثابت لديك.',
    en: 'No articles yet. Add your first standard invoice line.',
  },
  'art.nieuw': {
    nl: '+ Nieuw',
    ar: '+ جديد',
    en: '+ New',
  },
  'art.nieuwArtikel': {
    nl: 'Nieuw artikel',
    ar: 'بند جديد',
    en: 'New article',
  },
  'art.omschrijving': {
    nl: 'Omschrijving *',
    ar: 'الوصف *',
    en: 'Description *',
  },
  'art.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'art.perEenheid': {
    nl: 'per {unit}',
    ar: 'لكل {unit}',
    en: 'per {unit}',
  },
  'art.prijsExcl': {
    nl: 'Prijs (excl. BTW)',
    ar: 'السعر (بدون btw)',
    en: 'Price (excl. VAT)',
  },
  'art.toegevoegd': {
    nl: 'Artikel toegevoegd',
    ar: 'أُضيف البند',
    en: 'Article added',
  },
  'art.verwijderd': {
    nl: 'Artikel verwijderd',
    ar: 'حُذف البند',
    en: 'Article deleted',
  },
  'art.verwijderdEen': {
    nl: '1 artikel verwijderd',
    ar: 'حُذف بند واحد',
    en: '1 article deleted',
  },
  'art.verwijderdMeer': {
    nl: '{n} artikelen verwijderd',
    ar: 'عدد البنود المحذوفة: {n}',
    en: '{n} articles deleted',
  },
  'art.verwijderUitleg': {
    nl: 'Facturen waarop dit artikel al staat, blijven ongewijzigd.',
    ar: 'الفواتير التي يظهر عليها هذا البند تبقى كما هي.',
    en: 'Invoices that already carry this article stay unchanged.',
  },
  'art.verwijderVraag': {
    nl: 'Dit artikel verwijderen?',
    ar: 'هل تريد حذف هذا البند؟',
    en: 'Delete this article?',
  },
  'bank.afschrift.verwijderenUitleg': {
    nl: 'Zorg dat je de juiste versie hebt geüpload. Dit kan niet ongedaan worden gemaakt. Je transacties blijven behouden.',
    ar: 'تأكد أنك رفعت النسخة الصحيحة. لا يمكن التراجع عن هذا. تبقى معاملاتك محفوظة.',
    en: 'Make sure you have uploaded the correct version. This cannot be undone. Your transactions are kept.',
  },
  'bank.alle': {
    nl: 'Alle',
    ar: 'الكل',
    en: 'All',
  },
  'bank.auto.bezig': {
    nl: 'Ik handel {count} zekere betalingen voor je af…',
    ar: 'أُعالج لك {count} دفعة مؤكدة…',
    en: 'Handling {count} certain payments for you…',
  },
  'bank.auto.bezigEen': {
    nl: 'Ik handel 1 zekere betaling voor je af…',
    ar: 'أُعالج لك دفعة مؤكدة واحدة…',
    en: 'Handling 1 certain payment for you…',
  },
  'bank.auto.gedaan': {
    nl: 'Ik heb {count} betalingen automatisch afgehandeld',
    ar: 'عالجت {count} دفعة تلقائياً',
    en: 'I handled {count} payments automatically',
  },
  'bank.auto.gedaanEen': {
    nl: 'Ik heb 1 betaling automatisch afgehandeld',
    ar: 'عالجت دفعة واحدة تلقائياً',
    en: 'I handled 1 payment automatically',
  },
  'bank.auto.klaar': {
    nl: '{count} zekere betalingen klaar om af te handelen',
    ar: '{count} دفعة مؤكدة جاهزة للمعالجة',
    en: '{count} certain payments ready to handle',
  },
  'bank.auto.klaarEen': {
    nl: '1 zekere betaling klaar om af te handelen',
    ar: 'دفعة مؤكدة واحدة جاهزة للمعالجة',
    en: '1 certain payment ready to handle',
  },
  'bank.auto.uitleg': {
    nl: 'Facturen waarvan het nummer én het bedrag exact in je bankafschrift staan handel ik zelf af — koppelen en als betaald markeren. De rest laat ik aan jou, en je kunt elke koppeling later ongedaan maken.',
    ar: 'الفواتير التي يظهر رقمها ومبلغها تماماً في كشف حسابك أعالجها بنفسي — أربطها وأوسمها كمدفوعة. الباقي أتركه لك، ويمكنك التراجع عن أي ربط لاحقاً.',
    en: 'Invoices whose number and amount appear exactly in your bank statement I handle myself — linking and marking as paid. The rest I leave to you, and you can undo any link later.',
  },
  'bank.autoGeboekt': {
    nl: '{count} facturen automatisch gekoppeld ✓ — zie "Bevestigd"',
    ar: 'رُبطت {count} فاتورة تلقائياً ✓ — انظر «مؤكَّد»',
    en: '{count} invoices linked automatically ✓ — see "Confirmed"',
  },
  'bank.autoGeboektEen': {
    nl: '1 factuur automatisch gekoppeld ✓ — zie "Bevestigd"',
    ar: 'رُبطت فاتورة واحدة تلقائياً ✓ — انظر «مؤكَّد»',
    en: '1 invoice linked automatically ✓ — see "Confirmed"',
  },
  'bank.automatischOpRest': {
    nl: '(geen factuurnummer in het afschrift). Even controleren of dit de juiste factuur is.',
    ar: '(لا رقم فاتورة في الكشف). تحقّق سريعاً أن هذه هي الفاتورة الصحيحة.',
    en: '(no invoice number in the statement). Take a moment to check this is the right invoice.',
  },
  'bank.bankGekoppeld': {
    nl: 'Je bank is gekoppeld. We halen je transacties op…',
    ar: 'رُبط بنكك. نجلب معاملاتك الآن…',
    en: 'Your bank is connected. We are fetching your transactions…',
  },
  'bank.bankGekoppeldMeer': {
    nl: 'Je bank is gekoppeld ({count} rekeningen). We halen je transacties op…',
    ar: 'رُبط بنكك (الحسابات: {count}). نجلب معاملاتك الآن…',
    en: 'Your bank is connected ({count} accounts). We are fetching your transactions…',
  },
  'bank.batch.mismatch': {
    nl: 'Samen {total}, maar er is {bank} afgeschreven (verschil {diff}). Controleer welke facturen bij deze betaling horen.',
    ar: 'المجموع {total}، لكن المخصوم {bank} (الفرق {diff}). تحقّق أي فواتير تخص هذه الدفعة.',
    en: 'Together {total}, but {bank} was debited (difference {diff}). Check which invoices belong to this payment.',
  },
  'bank.batch.mismatchEen': {
    nl: '{total}, maar er is {bank} afgeschreven (verschil {diff}). Controleer welke factuur bij deze betaling hoort.',
    ar: '{total}، لكن المخصوم {bank} (الفرق {diff}). تحقّق أي فاتورة تخص هذه الدفعة.',
    en: '{total}, but {bank} was debited (difference {diff}). Check which invoice belongs to this payment.',
  },
  'bank.batch.ontbreekt': {
    nl: '{matched} van {total} facturen staan in je administratie. De factuurnummers staan in je bankafschrift — koppel de ontbrekende.',
    ar: '{matched} من {total} فاتورة موجودة في إدارتك. أرقام الفواتير في كشف حسابك — اربط الناقصة.',
    en: '{matched} of {total} invoices are in your administration. The invoice numbers are in your bank statement — link the missing ones.',
  },
  'bank.batch.ties': {
    nl: 'Samen {amount} — precies gelijk aan de afschrijving. Alle {count} factuurnummers staan in je bankafschrift.',
    ar: 'المجموع {amount} — مساوٍ تماماً للمبلغ المخصوم. كل أرقام الفواتير ({count}) موجودة في كشف حسابك.',
    en: 'Together {amount} — exactly equal to the debit. All {count} invoice numbers are in your bank statement.',
  },
  'bank.batch.tiesEen': {
    nl: '{amount} en het factuurnummer staan in je bankafschrift.',
    ar: '{amount} ورقم الفاتورة موجودان في كشف حسابك.',
    en: '{amount} and the invoice number are in your bank statement.',
  },
  'bank.batchBevestigd': {
    nl: '{count} factuur/facturen bevestigd ✓',
    ar: 'أُكِّدت {count} فاتورة ✓',
    en: '{count} invoice(s) confirmed ✓',
  },
  'bank.batchDeels': {
    nl: '{ok} bevestigd · {failed} mislukt',
    ar: 'أُكِّد {ok} · فشل {failed}',
    en: '{ok} confirmed · {failed} failed',
  },
  'bank.bedragNaam': {
    nl: 'bedrag + naam',
    ar: 'المبلغ + الاسم',
    en: 'amount + name',
  },
  'bank.bestandNietHerkend': {
    nl: 'Bestand opgeslagen, maar het is niet als factuur herkend. Controleer het bij Mijn Bestanden.',
    ar: 'حُفظ الملف، لكنه لم يُتعرَّف عليه كفاتورة. راجعه في «ملفاتي».',
    en: 'File saved, but it was not recognised as an invoice. Check it under My files.',
  },
  'bank.betaaldKoppelingLater': {
    nl: 'Factuur betaald (koppeling volgt later).',
    ar: 'دُفعت الفاتورة (يأتي الربط لاحقاً).',
    en: 'Invoice paid (the link will follow later).',
  },
  'bank.betaaldNietVastgelegd': {
    nl: 'Betaald ✓ — maar deze bankregel is niet volledig vastgelegd. Blijft hij terugkomen, ververs de pagina; lukt dat niet, gebruik Negeren.',
    ar: 'مدفوعة ✓ — لكن بند البنك هذا لم يُسجَّل بالكامل. إن استمر في الظهور فحدّث الصفحة؛ وإن لم ينفع ذلك، استخدم «تجاهل».',
    en: 'Paid ✓ — but this bank line was not fully recorded. If it keeps coming back, refresh the page; if that fails, use Ignore.',
  },
  'bank.betaaldNogEenOpen': {
    nl: 'Factuur betaald ✓ · nog een factuur open',
    ar: 'دُفعت الفاتورة ✓ · ما زالت فاتورة أخرى مفتوحة',
    en: 'Invoice paid ✓ · another invoice still open',
  },
  'bank.bevestigAantal': {
    nl: 'Bevestig betaling ({count})',
    ar: 'أكِّد الدفعة ({count})',
    en: 'Confirm payment ({count})',
  },
  'bank.bevestigdBetaald': {
    nl: 'Bevestigd en gemarkeerd als betaald ✓',
    ar: 'تم التأكيد والوسم كمدفوعة ✓',
    en: 'Confirmed and marked as paid ✓',
  },
  'bank.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ العمل…',
    en: 'Working…',
  },
  'bank.blijftOver': {
    nl: 'blijft over en wordt niet geboekt — controleer of dit de juiste factuur is.',
    ar: 'يبقى فائضاً ولن يُقيَّد — تحقّق أن هذه هي الفاتورة الصحيحة.',
    en: 'is left over and will not be booked — check this is the right invoice.',
  },
  'bank.controleerBedrag': {
    nl: 'Let op: controleer het bedrag.',
    ar: 'انتبه: تحقّق من المبلغ.',
    en: 'Note: check the amount.',
  },
  'bank.deel.alBetaald': {
    nl: 'Er was al {amount} betaald.',
    ar: 'سبق دفع {amount}.',
    en: '{amount} was already paid.',
  },
  'bank.deel.daarnaOpen': {
    nl: 'Daarna staat nog {amount} open.',
    ar: 'يبقى بعدها {amount} مفتوحاً.',
    en: 'After that, {amount} remains open.',
  },
  'bank.deel.geboekt': {
    nl: 'Deelbetaling: {amount} wordt geboekt.',
    ar: 'دفعة جزئية: سيُقيَّد {amount}.',
    en: 'Partial payment: {amount} will be booked.',
  },
  'bank.deel.voltooid': {
    nl: '{paid} al betaald · {remaining} restant — hiermee is de factuur volledig betaald.',
    ar: '{paid} مدفوع مسبقاً · المتبقي {remaining} — بهذا تُدفع الفاتورة بالكامل.',
    en: '{paid} already paid · {remaining} remaining — with this the invoice is fully paid.',
  },
  'bank.deelGeboektBlijft': {
    nl: 'Deelbetaling geboekt · factuur blijft openstaan',
    ar: 'قُيّدت دفعة جزئية · تبقى الفاتورة مفتوحة',
    en: 'Partial payment booked · the invoice stays open',
  },
  'bank.deelGeboektOpen': {
    nl: 'Deelbetaling geboekt · nog {amount} open',
    ar: 'قُيّدت دفعة جزئية · المتبقي {amount}',
    en: 'Partial payment booked · {amount} still open',
  },
  'bank.facturenKoppelen': {
    nl: 'Facturen koppelen ({count})',
    ar: 'ربط فواتير ({count})',
    en: 'Link invoices ({count})',
  },
  'bank.factuurKoppelen': {
    nl: 'Factuur koppelen',
    ar: 'ربط فاتورة',
    en: 'Link an invoice',
  },
  'bank.factuurNummer': {
    nl: 'Factuur {number}',
    ar: 'فاتورة {number}',
    en: 'Invoice {number}',
  },
  'bank.formaat.bewaard': {
    nl: 'Dit bestand is bewaard voor je boekhouder, maar de transacties konden niet worden uitgelezen voor het overzicht.',
    ar: 'حُفظ هذا الملف للمحاسب، لكن تعذّرت قراءة معاملاته للنظرة العامة.',
    en: 'This file was kept for your accountant, but its transactions could not be read for the overview.',
  },
  'bank.formaat.omTeKoppelen': {
    nl: 'om de transacties te koppelen. CSV en PDF kunnen niet worden uitgelezen.',
    ar: 'لربط المعاملات. لا يمكن قراءة CSV وPDF.',
    en: 'to link the transactions. CSV and PDF cannot be read.',
  },
  'bank.formaten': {
    nl: 'CAMT.053 (.xml) of MT940 (.940 / .sta / .txt)',
    ar: 'CAMT.053 (.xml) أو MT940 (.940 / .sta / .txt)',
    en: 'CAMT.053 (.xml) or MT940 (.940 / .sta / .txt)',
  },
  'bank.fout.bedragPastNiet': {
    nl: 'Dat bedrag past niet op deze betaling.',
    ar: 'هذا المبلغ لا يناسب هذه الدفعة.',
    en: 'That amount does not fit this payment.',
  },
  'bank.fout.betalingenOphalen': {
    nl: 'Betalingen ophalen mislukt.',
    ar: 'فشل جلب الدفعات.',
    en: 'Fetching the payments failed.',
  },
  'bank.fout.factuurNietOpgehaald': {
    nl: 'Deze factuur kon niet worden opgehaald.',
    ar: 'تعذّر جلب هذه الفاتورة.',
    en: 'This invoice could not be fetched.',
  },
  'bank.fout.geenBestand': {
    nl: 'Deze factuur heeft geen bestand.',
    ar: 'هذه الفاتورة بلا ملف.',
    en: 'This invoice has no file.',
  },
  'bank.fout.geenTransacties': {
    nl: 'Geen transacties gevonden in dit bestand.',
    ar: 'لم يُعثر على معاملات في هذا الملف.',
    en: 'No transactions found in this file.',
  },
  'bank.fout.koppelen': {
    nl: 'Koppelen mislukt.',
    ar: 'فشل الربط.',
    en: 'Linking failed.',
  },
  'bank.fout.nietCorrigeren': {
    nl: 'Deze factuur kan nu niet worden gecorrigeerd.',
    ar: 'لا يمكن تصحيح هذه الفاتورة الآن.',
    en: 'This invoice cannot be corrected right now.',
  },
  'bank.fout.toevoegenNiets': {
    nl: 'Toevoegen mislukt — er is niets opgeslagen.',
    ar: 'فشلت الإضافة — لم يُحفظ شيء.',
    en: 'Adding failed — nothing was saved.',
  },
  'bank.fout.uploaden': {
    nl: 'Uploaden mislukt.',
    ar: 'فشل الرفع.',
    en: 'Uploading failed.',
  },
  'bank.fout.verplaatsen': {
    nl: 'Verplaatsen mislukt — er is niets gewijzigd.',
    ar: 'فشل النقل — لم يتغيّر شيء.',
    en: 'Moving failed — nothing was changed.',
  },
  'bank.geenFactuurUitleg': {
    nl: 'Leveranciers zonder gevonden factuur. Koppel het bestand, of negeer de transactie als er geen factuur bij hoort (zoals huur of een lening).',
    ar: 'مورّدون بلا فاتورة معثور عليها. اربط الملف، أو تجاهل المعاملة إن لم تكن لها فاتورة (كالإيجار أو قرض).',
    en: 'Suppliers with no invoice found. Link the file, or ignore the transaction if no invoice belongs to it (such as rent or a loan).',
  },
  'bank.geenNummer': {
    nl: '(geen nummer)',
    ar: '(بلا رقم)',
    en: '(no number)',
  },
  'bank.geenTransactiesBank': {
    nl: 'Nog geen transacties bij je bank gevonden.',
    ar: 'لم يُعثر بعد على معاملات لدى بنكك.',
    en: 'No transactions found at your bank yet.',
  },
  'bank.gekoppeldDeels': {
    nl: '{ok}/{total} gekoppeld.',
    ar: 'رُبط {ok}/{total}.',
    en: '{ok}/{total} linked.',
  },
  'bank.gekoppeldEen': {
    nl: 'Factuur gekoppeld ✓',
    ar: 'رُبطت الفاتورة ✓',
    en: 'Invoice linked ✓',
  },
  'bank.gekoppeldMeer': {
    nl: '{count} facturen gekoppeld ✓',
    ar: 'رُبطت {count} فاتورة ✓',
    en: '{count} invoices linked ✓',
  },
  'bank.genegeerdGroot': {
    nl: ', waarvan {count} boven de € 500',
    ar: '، منها {count} فوق € 500',
    en: ', of which {count} above € 500',
  },
  'bank.genegeerdGrootEen': {
    nl: ', waarvan één boven de € 500',
    ar: '، منها واحد فوق € 500',
    en: ', of which one above € 500',
  },
  'bank.genegeerdNaloop': {
    nl: 'Deze staan in geen enkel cijfer en je boekhouder ziet ze niet — loop ze nog even na voordat je het kwartaal afsluit.',
    ar: 'هذه لا تظهر في أي رقم ولا يراها المحاسب — راجعها قبل إقفال الربع.',
    en: 'These appear in no figure and your accountant does not see them — go over them before you close the quarter.',
  },
  'bank.genegeerdSom': {
    nl: '{count} genegeerde regels van samen {total}',
    ar: '{count} من البنود المتجاهَلة بمجموع {total}',
    en: '{count} ignored lines totalling {total}',
  },
  'bank.genegeerdSomEen': {
    nl: '1 genegeerde regel van samen {total}',
    ar: 'بند متجاهَل واحد بمجموع {total}',
    en: '1 ignored line totalling {total}',
  },
  'bank.geselecteerd': {
    nl: '{count} geselecteerd',
    ar: 'المحدَّد: {count}',
    en: '{count} selected',
  },
  'bank.historie.eenIban': {
    nl: 'Eerder één keer van deze tegenrekening, geboekt als {category}.',
    ar: 'سبق مرة واحدة من هذا الحساب المقابل، وقُيّدت كـ{category}.',
    en: 'Seen once before from this counter-account, booked as {category}.',
  },
  'bank.historie.eenNaam': {
    nl: 'Eerder één keer van deze naam, geboekt als {category}.',
    ar: 'سبق مرة واحدة من هذا الاسم، وقُيّدت كـ{category}.',
    en: 'Seen once before from this name, booked as {category}.',
  },
  'bank.historie.meestIban': {
    nl: 'Eerder {count} keer van deze tegenrekening — {topCount}× als {category}, de rest anders.',
    ar: 'سبق {count} مرة من هذا الحساب المقابل — {topCount}× كـ{category}، والباقي مختلف.',
    en: 'Seen {count} times before from this counter-account — {topCount}× as {category}, the rest differently.',
  },
  'bank.historie.meestNaam': {
    nl: 'Eerder {count} keer van deze naam — {topCount}× als {category}, de rest anders.',
    ar: 'سبق {count} مرة من هذا الاسم — {topCount}× كـ{category}، والباقي مختلف.',
    en: 'Seen {count} times before from this name — {topCount}× as {category}, the rest differently.',
  },
  'bank.historie.steedsIban': {
    nl: 'Eerder {count} keer van deze tegenrekening, steeds geboekt als {category}.',
    ar: 'سبق {count} مرة من هذا الحساب المقابل، وقُيّدت كل مرة كـ{category}.',
    en: 'Seen {count} times before from this counter-account, booked as {category} every time.',
  },
  'bank.historie.steedsNaam': {
    nl: 'Eerder {count} keer van deze naam, steeds geboekt als {category}.',
    ar: 'سبق {count} مرة من هذا الاسم، وقُيّدت كل مرة كـ{category}.',
    en: 'Seen {count} times before from this name, booked as {category} every time.',
  },
  'bank.inlezen': {
    nl: 'Bezig met inlezen…',
    ar: 'جارٍ القراءة…',
    en: 'Reading it in…',
  },
  'bank.intro': {
    nl: 'Koppel je bank of upload je bankafschrift. We koppelen transacties aan je facturen — jij bevestigt.',
    ar: 'اربط بنكك أو ارفع كشف حسابك. نربط المعاملات بفواتيرك — وأنت تؤكّد.',
    en: 'Connect your bank or upload your bank statement. We link transactions to your invoices — you confirm.',
  },
  'bank.jaTochKoppelen': {
    nl: 'Ja, toch koppelen',
    ar: 'نعم، اربطها رغم ذلك',
    en: 'Yes, link it anyway',
  },
  'bank.kiesAfschrift': {
    nl: 'Kies bankafschrift',
    ar: 'اختر كشف الحساب',
    en: 'Choose a bank statement',
  },
  'bank.kloptGecontroleerd': {
    nl: 'Klopt, gecontroleerd',
    ar: 'صحيح، تم التحقّق',
    en: 'Correct, checked',
  },
  'bank.koppelingOngedaan': {
    nl: 'Koppeling ongedaan gemaakt.',
    ar: 'أُلغي الربط.',
    en: 'Link undone.',
  },
  'bank.kwartaal': {
    nl: 'Kwartaal:',
    ar: 'الربع:',
    en: 'Quarter:',
  },
  'bank.laatLos': {
    nl: 'Laat los om te uploaden',
    ar: 'أفلِت للرفع',
    en: 'Release to upload',
  },
  'bank.leeg.confirm': {
    nl: 'Niets te bevestigen.',
    ar: 'لا شيء للتأكيد.',
    en: 'Nothing to confirm.',
  },
  'bank.leeg.done': {
    nl: 'Nog niets gekoppeld.',
    ar: 'لم يُربط شيء بعد.',
    en: 'Nothing linked yet.',
  },
  'bank.leeg.geen': {
    nl: 'Nog geen transacties om te koppelen.',
    ar: 'لا معاملات للربط بعد.',
    en: 'No transactions to link yet.',
  },
  'bank.leeg.ignored': {
    nl: 'Niets genegeerd.',
    ar: 'لا شيء متجاهَل.',
    en: 'Nothing ignored.',
  },
  'bank.leeg.klaar': {
    nl: 'Alles afgehandeld.',
    ar: 'كل شيء عولج.',
    en: 'Everything handled.',
  },
  'bank.leeg.none': {
    nl: 'Geen openstaande transacties zonder factuur.',
    ar: 'لا معاملات مفتوحة بلا فاتورة.',
    en: 'No open transactions without an invoice.',
  },
  'bank.leeg.pin': {
    nl: 'Geen pinontvangsten.',
    ar: 'لا مقبوضات نقاط بيع.',
    en: 'No card takings.',
  },
  'bank.lijktDubbel': {
    nl: 'Deze factuur lijkt al eerder gekoppeld te zijn.',
    ar: 'يبدو أن هذه الفاتورة رُبطت من قبل.',
    en: 'This invoice appears to have been linked before.',
  },
  'bank.maximaalGeboekt': {
    nl: 'op deze factuur geboekt.',
    ar: 'على هذه الفاتورة.',
    en: 'will be booked on this invoice.',
  },
  'bank.namenBijgewerkt': {
    nl: '{count} namen bijgewerkt ✓',
    ar: 'الأسماء المحدَّثة: {count} ✓',
    en: '{count} names updated ✓',
  },
  'bank.namenBijgewerktEen': {
    nl: '1 naam bijgewerkt ✓',
    ar: 'حُدّث اسم واحد ✓',
    en: '1 name updated ✓',
  },
  'bank.namenBijwerken': {
    nl: 'Namen bijwerken',
    ar: 'تحديث الأسماء',
    en: 'Update names',
  },
  'bank.namenUpToDate': {
    nl: 'Alle namen waren al up-to-date.',
    ar: 'كل الأسماء كانت محدَّثة بالفعل.',
    en: 'All names were already up to date.',
  },
  'bank.nFacturen': {
    nl: '{count} facturen',
    ar: '{count} فاتورة',
    en: '{count} invoices',
  },
  'bank.nogOpenBedrag': {
    nl: 'nog {amount} open',
    ar: 'المتبقي {amount}',
    en: '{amount} still open',
  },
  'bank.nogOpenLijst': {
    nl: 'Nog open: {numbers}',
    ar: 'ما زال مفتوحاً: {numbers}',
    en: 'Still open: {numbers}',
  },
  'bank.nuAfhandelen': {
    nl: 'Nu afhandelen',
    ar: 'عالِج الآن',
    en: 'Handle now',
  },
  'bank.of': {
    nl: 'of',
    ar: 'أو',
    en: 'or',
  },
  'bank.omschrijvingKop': {
    nl: 'OMSCHRIJVING',
    ar: 'الوصف',
    en: 'DESCRIPTION',
  },
  'bank.ontkoppelen': {
    nl: 'Ontkoppelen',
    ar: 'فكّ الربط',
    en: 'Unlink',
  },
  'bank.opgehaaldAantal': {
    nl: '{count} transacties opgehaald.',
    ar: 'جُلبت {count} معاملة.',
    en: '{count} transactions fetched.',
  },
  'bank.opgehaaldOnleesbaar': {
    nl: '{inserted} transacties opgehaald · {count} regels konden niet gelezen worden.',
    ar: 'جُلبت {inserted} معاملة · تعذّرت قراءة {count} من البنود.',
    en: '{inserted} transactions fetched · {count} lines could not be read.',
  },
  'bank.opgehaaldOnleesbaarEen': {
    nl: '{inserted} transacties opgehaald · 1 regel kon niet gelezen worden.',
    ar: 'جُلبت {inserted} معاملة · تعذّرت قراءة بند واحد.',
    en: '{inserted} transactions fetched · 1 line could not be read.',
  },
  'bank.opnieuwMatchen': {
    nl: 'Opnieuw matchen',
    ar: 'إعادة المطابقة',
    en: 'Match again',
  },
  'bank.overgeslagenDubbel': {
    nl: 'Overgeslagen (mogelijk dubbel).',
    ar: 'تم التخطي (ربما مكررة).',
    en: 'Skipped (possible duplicate).',
  },
  'bank.overslaan': {
    nl: 'Overslaan',
    ar: 'تخطٍّ',
    en: 'Skip',
  },
  'bank.pinUitleg': {
    nl: 'Pinontvangsten via de betaalautomaat (ING DD&C). Deze hebben geen factuur — ze staan hier zodat ze je openstaande werk niet in de weg zitten.',
    ar: 'مقبوضات نقاط البيع عبر جهاز الدفع (ING DD&C). ليست لها فواتير — وُضعت هنا كي لا تعترض عملك المفتوح.',
    en: 'Card takings via the payment terminal (ING DD&C). These have no invoice — they sit here so they do not get in the way of your open work.',
  },
  'bank.proof.bedrag': {
    nl: 'Dit bedrag komt overeen met je bankafschrift',
    ar: 'هذا المبلغ مطابق لكشف حسابك',
    en: 'This amount matches your bank statement',
  },
  'bank.proof.metNummer': {
    nl: 'Dit bedrag en factuurnummer staan in je bankafschrift',
    ar: 'هذا المبلغ ورقم الفاتورة موجودان في كشف حسابك',
    en: 'This amount and invoice number are in your bank statement',
  },
  'bank.redenVraag': {
    nl: 'Waarom heeft deze regel geen factuur nodig? Dit is alleen een aantekening — je boekhouder ziet hem terug bij het kwartaal.',
    ar: 'لماذا لا يحتاج هذا البند إلى فاتورة؟ هذه مجرد ملاحظة — يراها المحاسب عند الربع.',
    en: 'Why does this line need no invoice? This is only a note — your accountant sees it at the quarter.',
  },
  'bank.rematch.alles': {
    nl: 'Alle {count} regels opnieuw bekeken — er was niets nieuws te koppelen.',
    ar: 'أُعيد فحص كل البنود ({count}) — لم يكن هناك جديد للربط.',
    en: 'All {count} lines re-examined — there was nothing new to link.',
  },
  'bank.rematch.ambigu': {
    nl: 'Bij {count} genegeerde regels passen nu wel een factuur, maar niet één duidelijke — die laat ik met rust. Kijk bij "Genegeerd" als je ze zelf wilt koppelen.',
    ar: 'هناك فواتير تناسب الآن {count} من البنود المتجاهَلة، لكن ليست واحدة واضحة — سأتركها كما هي. انظر «مُتجاهَلة» إن أردت ربطها بنفسك.',
    en: '{count} ignored lines now have a fitting invoice, but not one clear one — I am leaving them alone. Look under "Ignored" if you want to link them yourself.',
  },
  'bank.rematch.ambiguEen': {
    nl: 'Bij 1 genegeerde regel past nu wel een factuur, maar niet één duidelijke — die laat ik met rust. Kijk bij "Genegeerd" als je ze zelf wilt koppelen.',
    ar: 'هناك فاتورة تناسب الآن بنداً متجاهَلاً واحداً، لكن ليست واحدة واضحة — سأتركه كما هو. انظر «مُتجاهَلة» إن أردت ربطه بنفسك.',
    en: '1 ignored line now has a fitting invoice, but not one clear one — I am leaving it alone. Look under "Ignored" if you want to link it yourself.',
  },
  'bank.rematch.geboekt': {
    nl: 'betalingen zijn automatisch gekoppeld.',
    ar: 'دفعة رُبطت تلقائياً.',
    en: 'payments were linked automatically.',
  },
  'bank.rematch.geboektEen': {
    nl: 'betaling is automatisch gekoppeld.',
    ar: 'دفعة رُبطت تلقائياً.',
    en: 'payment was linked automatically.',
  },
  'bank.rematch.gekoppeld': {
    nl: '{count} automatisch gekoppeld',
    ar: 'رُبط تلقائياً: {count}',
    en: '{count} linked automatically',
  },
  'bank.rematch.hersteld': {
    nl: 'genegeerde regels staan weer in de lijst.',
    ar: 'بند متجاهَل عاد إلى القائمة.',
    en: 'ignored lines are back in the list.',
  },
  'bank.rematch.hersteldEen': {
    nl: 'genegeerde regel staat weer in de lijst.',
    ar: 'بند متجاهَل عاد إلى القائمة.',
    en: 'ignored line is back in the list.',
  },
  'bank.rematch.niets': {
    nl: 'Alles opnieuw bekeken ({count}) — er was niets nieuws te koppelen.',
    ar: 'أُعيد فحص كل شيء ({count}) — لم يكن هناك جديد للربط.',
    en: 'Everything re-examined ({count}) — there was nothing new to link.',
  },
  'bank.rematch.terug': {
    nl: '{count} regels terug in de lijst',
    ar: 'البنود المعادة إلى القائمة: {count}',
    en: '{count} lines back in the list',
  },
  'bank.rematch.terugEen': {
    nl: '1 regel terug in de lijst',
    ar: 'أُعيد بند واحد إلى القائمة',
    en: '1 line back in the list',
  },
  'bank.rematch.titel': {
    nl: 'Kijkt opnieuw naar alle regels — ook de genegeerde — en koppelt wat inmiddels zeker is',
    ar: 'يعيد النظر في كل البنود — حتى المتجاهَلة — ويربط ما صار مؤكداً',
    en: 'Looks at every line again — including the ignored ones — and links what has become certain',
  },
  'bank.rematch.zwak': {
    nl: 'Niets zeker genoeg om zelf te doen — {count} genegeerde regels hebben wel een mogelijke factuur. Kijk bij "Genegeerd".',
    ar: 'لا شيء مؤكد بما يكفي لأفعله بنفسي — {count} من البنود المتجاهَلة لها فاتورة محتملة. انظر «مُتجاهَلة».',
    en: 'Nothing certain enough to do on its own — {count} ignored lines do have a possible invoice. Look under "Ignored".',
  },
  'bank.rematch.zwakEen': {
    nl: 'Niets zeker genoeg om zelf te doen — 1 genegeerde regel heeft wel een mogelijke factuur. Kijk bij "Genegeerd".',
    ar: 'لا شيء مؤكد بما يكفي لأفعله بنفسي — بند متجاهَل واحد له فاتورة محتملة. انظر «مُتجاهَلة».',
    en: 'Nothing certain enough to do on its own — 1 ignored line does have a possible invoice. Look under "Ignored".',
  },
  'bank.restBlijft': {
    nl: 'De rest blijft op deze betaling staan, zodat je hem koppelt zodra de andere factuur binnen is.',
    ar: 'يبقى الباقي على هذه الدفعة، لتربطه حين تصل الفاتورة الأخرى.',
    en: 'The rest stays on this payment, so you can link it once the other invoice arrives.',
  },
  'bank.saldoSluit': {
    nl: 'Dit afschrift sluit aan, tot op de cent: beginsaldo {opening} plus {count} mutaties komt uit op eindsaldo {closing}. Er ontbreekt geen regel.',
    ar: 'هذا الكشف متطابق حتى السنت: الرصيد الافتتاحي {opening} زائد {count} حركة يساوي الرصيد الختامي {closing}. لا ينقص أي بند.',
    en: 'This statement ties out to the cent: opening balance {opening} plus {count} movements equals closing balance {closing}. No line is missing.',
  },
  'bank.samenDeels': {
    nl: '{ok} gekoppeld · {failed} mislukt — controleer de lijst',
    ar: 'رُبط {ok} · فشل {failed} — راجع القائمة',
    en: '{ok} linked · {failed} failed — check the list',
  },
  'bank.samenGekoppeld': {
    nl: '{count} facturen samen gekoppeld aan deze betaling ✓',
    ar: 'رُبطت {count} فاتورة معاً بهذه الدفعة ✓',
    en: '{count} invoices linked together to this payment ✓',
  },
  'bank.selecteerAlle': {
    nl: 'Selecteer alle ({count})',
    ar: 'حدّد الكل ({count})',
    en: 'Select all ({count})',
  },
  'bank.selectieWissen': {
    nl: 'Selectie wissen',
    ar: 'مسح التحديد',
    en: 'Clear selection',
  },
  'bank.slotsBevestigd': {
    nl: '{done}/{total} bevestigd',
    ar: 'أُكِّد {done}/{total}',
    en: '{done}/{total} confirmed',
  },
  'bank.som.klant': {
    nl: '— zelfde klant, geen nummer in de omschrijving. Controleer en koppel ze samen.',
    ar: '— العميل نفسه، ولا رقم في الوصف. تحقّق واربطها معاً.',
    en: '— same client, no number in the description. Check and link them together.',
  },
  // [CREDIT-VERREKEN] The same recognition, when one of the posten is a creditnota. "De som van
  // 2 facturen" would be wrong twice over: a creditnota is not a factuur, and it is subtracted
  // rather than added — the card prints the arithmetic underneath, and it has to add up.
  'bank.som.kopVerrekend': {
    nl: 'Dit bedrag klopt precies: een factuur met een creditnota eraf',
    ar: 'هذا المبلغ مطابق تماماً: فاتورة مخصوم منها إشعار دائن',
    en: 'This amount matches exactly: an invoice with a credit note deducted',
  },
  'bank.som.kop': {
    nl: 'Dit bedrag is precies de som van {count} openstaande facturen',
    ar: 'هذا المبلغ هو بالضبط مجموع {count} فاتورة مفتوحة',
    en: 'This amount is exactly the sum of {count} open invoices',
  },
  'bank.som.koppel': {
    nl: 'Koppel deze {count} facturen',
    ar: 'اربط هذه الفواتير ({count})',
    en: 'Link these {count} invoices',
  },
  'bank.som.leverancier': {
    nl: '— zelfde leverancier, geen nummer in de omschrijving. Controleer en koppel ze samen.',
    ar: '— المورّد نفسه، ولا رقم في الوصف. تحقّق واربطها معاً.',
    en: '— same supplier, no number in the description. Check and link them together.',
  },
  'bank.tab.bevestigd': {
    nl: 'Bevestigd',
    ar: 'مؤكَّد',
    en: 'Confirmed',
  },
  'bank.tab.geenFactuur': {
    nl: 'Geen factuur',
    ar: 'بلا فاتورة',
    en: 'No invoice',
  },
  'bank.tab.pin': {
    nl: 'Pinontvangsten',
    ar: 'مقبوضات نقاط البيع',
    en: 'Card takings',
  },
  'bank.tab.teBevestigen': {
    nl: 'Te bevestigen',
    ar: 'للتأكيد',
    en: 'To confirm',
  },
  'bank.terugzetten': {
    nl: 'Terugzetten',
    ar: 'إعادة',
    en: 'Put back',
  },
  'bank.tochKoppelenVraag': {
    nl: 'Toch koppelen?',
    ar: 'الربط رغم ذلك؟',
    en: 'Link anyway?',
  },
  'bank.toegevoegdWachtrij': {
    nl: 'Factuur toegevoegd. Bevestig hem eerst in de controlewachtrij, daarna kun je de betaling verdelen.',
    ar: 'أُضيفت الفاتورة. أكِّدها أولاً في قائمة المراجعة، وبعدها يمكنك توزيع الدفعة.',
    en: 'Invoice added. Confirm it in the review queue first, then you can split the payment.',
  },
  'bank.toeTeWijzen': {
    nl: '{applied} van {total} geboekt · nog {open} toe te wijzen',
    ar: 'قُيّد {applied} من {total} · المتبقي للتوزيع {open}',
    en: '{applied} of {total} booked · {open} still to assign',
  },
  'bank.uncat': {
    nl: '{count} banktransacties nog niet gecategoriseerd',
    ar: '{count} معاملة بنكية لم تُصنَّف بعد',
    en: '{count} bank transactions not yet categorised',
  },
  'bank.uncatEen': {
    nl: '1 banktransactie nog niet gecategoriseerd',
    ar: 'معاملة بنكية واحدة لم تُصنَّف بعد',
    en: '1 bank transaction not yet categorised',
  },
  'bank.uncatUitleg': {
    nl: 'Dit geld telt nog niet mee in je winst & verlies en BTW. Geef het een categorie →',
    ar: 'هذا المال لا يُحتسب بعد في ربحك وخسارتك ولا في الضريبة. أعطه تصنيفاً ←',
    en: 'This money does not yet count in your profit & loss and btw. Give it a category →',
  },
  'bank.upload.dubbel': {
    nl: '{count} dubbel overgeslagen',
    ar: 'تم تخطي {count} مكررة',
    en: '{count} duplicates skipped',
  },
  'bank.upload.gelezen': {
    nl: '{parsed} transacties gelezen · {inserted} nieuw',
    ar: 'قُرئت {parsed} معاملة · {inserted} جديدة',
    en: '{parsed} transactions read · {inserted} new',
  },
  'bank.upload.onleesbaar': {
    nl: '{count} regels konden niet gelezen worden en staan niet in je overzicht. Het originele bestand is wél bewaard voor je boekhouder — controleer die regels.',
    ar: 'تعذّرت قراءة {count} من البنود وهي غير موجودة في نظرتك العامة. الملف الأصلي محفوظ للمحاسب — راجع تلك البنود.',
    en: '{count} lines could not be read and are not in your overview. The original file was kept for your accountant — check those lines.',
  },
  'bank.upload.onleesbaarEen': {
    nl: '1 regel kon niet gelezen worden en staat niet in je overzicht. Het originele bestand is wél bewaard voor je boekhouder — controleer die regel.',
    ar: 'تعذّرت قراءة بند واحد وهو غير موجود في نظرتك العامة. الملف الأصلي محفوظ للمحاسب — راجع ذلك البند.',
    en: '1 line could not be read and is not in your overview. The original file was kept for your accountant — check that line.',
  },
  'bank.vergelijkBedrag': {
    nl: 'bedrag',
    ar: 'المبلغ',
    en: 'amount',
  },
  'bank.vergelijkDatum': {
    nl: 'datum',
    ar: 'التاريخ',
    en: 'date',
  },
  'bank.vergelijkEn': {
    nl: 'en',
    ar: 'و',
    en: 'and',
  },
  'bank.vergelijkKies': {
    nl: 'en kies de juiste.',
    ar: 'ثم اختر الصحيحة.',
    en: 'and pick the right one.',
  },
  'bank.vernieuwLijst': {
    nl: 'vernieuw de pagina voor de bijgewerkte lijst',
    ar: 'حدّث الصفحة لرؤية القائمة المحدَّثة',
    en: 'refresh the page for the updated list',
  },
  'bank.verplaats.geenBedrag': {
    nl: 'Van deze betaling is geen bedrag vastgelegd, dus verplaatsen kan niet. Ontkoppel hem en boek hem opnieuw op de juiste factuur.',
    ar: 'لم يُسجَّل مبلغ لهذه الدفعة، لذا لا يمكن نقلها. افكك ربطها وقيّدها من جديد على الفاتورة الصحيحة.',
    en: 'No amount was recorded for this payment, so it cannot be moved. Unlink it and book it again on the right invoice.',
  },
  'bank.verplaats.geenDoel': {
    nl: 'Geen factuur gevonden waar dit bedrag op past. Een factuur kan alleen een betaling ontvangen als hij gecontroleerd is, van dezelfde soort is, en er minstens {amount} op open staat.',
    ar: 'لم يُعثر على فاتورة يناسبها هذا المبلغ. لا تستقبل الفاتورة دفعة إلا إذا كانت مُراجَعة ومن النوع نفسه وعليها {amount} على الأقل مفتوحاً.',
    en: 'No invoice found that this amount fits. An invoice can only receive a payment if it has been checked, is of the same kind, and has at least {amount} still open.',
  },
  'bank.verplaats.kies': {
    nl: 'Kies de factuur waar hij bij hoort — het bedrag, de betaaldatum en de methode gaan ongewijzigd mee.',
    ar: 'اختر الفاتورة التي تخصها — ينتقل المبلغ وتاريخ الدفع والطريقة دون تغيير.',
    en: 'Choose the invoice it belongs to — the amount, payment date and method carry over unchanged.',
  },
  'bank.verplaats.opEenFactuur': {
    nl: 'Deze betaling staat nu op een factuur.',
    ar: 'هذه الدفعة الآن على فاتورة.',
    en: 'This payment is currently on an invoice.',
  },
  'bank.verplaats.opEenFactuurVan': {
    nl: 'Deze betaling staat nu op een factuur van {name}.',
    ar: 'هذه الدفعة الآن على فاتورة من {name}.',
    en: 'This payment is currently on an invoice from {name}.',
  },
  'bank.verplaats.opFactuur': {
    nl: 'Deze betaling staat nu op factuur {number}.',
    ar: 'هذه الدفعة الآن على الفاتورة {number}.',
    en: 'This payment is currently on invoice {number}.',
  },
  'bank.verplaats.opFactuurVan': {
    nl: 'Deze betaling staat nu op factuur {number} van {name}.',
    ar: 'هذه الدفعة الآن على الفاتورة {number} من {name}.',
    en: 'This payment is currently on invoice {number} from {name}.',
  },
  'bank.verplaatstNaarFactuur': {
    nl: 'Betaling verplaatst naar factuur {number}.',
    ar: 'نُقلت الدفعة إلى الفاتورة {number}.',
    en: 'Payment moved to invoice {number}.',
  },
  'bank.verplaatstNaarGekozen': {
    nl: 'Betaling verplaatst naar de gekozen factuur.',
    ar: 'نُقلت الدفعة إلى الفاتورة المختارة.',
    en: 'Payment moved to the chosen invoice.',
  },
  'bank.verwerken': {
    nl: 'Verwerken…',
    ar: 'جارٍ المعالجة…',
    en: 'Processing…',
  },
  'bank.verwerktUitleg': {
    nl: 'De boekhouder heeft factuur {number} verwerkt. Vraag eerst om de verwerking ongedaan te maken voordat je deze koppelt.',
    ar: 'عالج المحاسب الفاتورة {number}. اطلب أولاً التراجع عن المعالجة قبل ربط هذه الدفعة.',
    en: 'The accountant has processed invoice {number}. First ask to undo the processing before you link this one.',
  },
  'bank.vinkAan': {
    nl: 'Vink sterke matches aan',
    ar: 'علّم على المطابقات القوية',
    en: 'Tick the strong matches',
  },
  'bank.voegFacturenToe': {
    nl: 'Voeg die facturen nu toe',
    ar: 'أضف تلك الفواتير الآن',
    en: 'Add those invoices now',
  },
  'bank.voegFactuurToe': {
    nl: 'Voeg die factuur nu toe',
    ar: 'أضف تلك الفاتورة الآن',
    en: 'Add that invoice now',
  },
  'bank.welkDeelFactuur': {
    nl: 'Welk deel hoort op deze factuur?',
    ar: 'أي جزء يخص هذه الفاتورة؟',
    en: 'Which part belongs on this invoice?',
  },
  'bank.welkDeelNummer': {
    nl: 'Welk deel hoort op {number}?',
    ar: 'أي جزء يخص {number}؟',
    en: 'Which part belongs on {number}?',
  },
  'bank.why.amount': {
    nl: 'bedrag komt overeen',
    ar: 'المبلغ مطابق',
    en: 'amount matches',
  },
  'bank.why.counterpart': {
    nl: 'zelfde tegenpartij',
    ar: 'الطرف المقابل نفسه',
    en: 'same counterparty',
  },
  'bank.why.date': {
    nl: 'datum dichtbij',
    ar: 'التاريخ قريب',
    en: 'date close by',
  },
  'bank.why.reference': {
    nl: 'nummer in omschrijving',
    ar: 'الرقم في الوصف',
    en: 'number in the description',
  },
  'bank.zoekLeeg': {
    nl: 'Geen transacties gevonden voor “{query}”.',
    ar: 'لم يُعثر على معاملات لـ«{query}».',
    en: 'No transactions found for “{query}”.',
  },
  'bank.zonderInkoop': {
    nl: '{count} betalingen zonder inkoopfactuur',
    ar: '{count} دفعة بلا فاتورة شراء',
    en: '{count} payments without a purchase invoice',
  },
  'bank.zonderInkoopEen': {
    nl: '1 betaling zonder inkoopfactuur',
    ar: 'دفعة واحدة بلا فاتورة شراء',
    en: '1 payment without a purchase invoice',
  },
  'bank.zonderInkoopUitleg': {
    nl: 'Je hebt betaald, maar we hebben de factuur nog niet. Zonder factuur mis je de BTW-aftrek (voorbelasting) op deze kosten. Voeg de factuur toe, of haal je e-mail opnieuw op — dan koppelen we hem automatisch.',
    ar: 'لقد دفعت، لكن الفاتورة ليست لدينا بعد. بدون فاتورة تخسر خصم الضريبة (voorbelasting) على هذه التكاليف. أضف الفاتورة، أو أعد جلب بريدك — وسنربطها تلقائياً.',
    en: 'You paid, but we do not have the invoice yet. Without the invoice you miss the btw deduction (voorbelasting) on these costs. Add the invoice, or fetch your e-mail again — then we link it automatically.',
  },
  'best.aanbevolenLocatie': {
    nl: 'Aanbevolen locatie:',
    ar: 'الموقع الموصى به:',
    en: 'Recommended location:',
  },
  'best.aanbevolenMap': {
    nl: 'Aanbevolen map',
    ar: 'المجلد الموصى به',
    en: 'Recommended folder',
  },
  // Singular form, only ever rendered when the count IS one — so the number is inlined in
  // every language and no placeholder is needed (Arabic says the word, not the digit).
  'best.aantalBestandEen': {
    nl: '1 bestand',
    ar: 'ملف واحد',
    en: '1 file',
  },
  'best.aantalBestanden': {
    nl: '{n} bestanden',
    ar: 'عدد الملفات: {n}',
    en: '{n} files',
  },
  'best.aflopend': {
    nl: 'Aflopend',
    ar: 'تنازلي',
    en: 'Descending',
  },
  'best.aiGebaseerd': {
    nl: 'Gebaseerd op inhoud van het bestand',
    ar: 'استناداً إلى محتوى الملف',
    en: 'Based on the file’s contents',
  },
  'best.aiSteltVoor': {
    nl: 'AI stelt voor',
    ar: 'اقتراح الذكاء الاصطناعي',
    en: 'AI suggests',
  },
  'best.bekijken': {
    nl: 'Bekijken',
    ar: 'عرض',
    en: 'View',
  },
  'best.berekenen': {
    nl: 'Berekenen…',
    ar: 'جارٍ الحساب…',
    en: 'Calculating…',
  },
  'best.bestandenAantal': {
    nl: 'Bestanden — {n}',
    ar: 'الملفات — {n}',
    en: 'Files — {n}',
  },
  'best.bestandHernoemen': {
    nl: 'Bestand hernoemen',
    ar: 'إعادة تسمية الملف',
    en: 'Rename the file',
  },
  'best.bulkVerwijderen': {
    nl: 'De bestanden gaan naar de prullenbak. Je kunt ze daar terughalen.',
    ar: 'تذهب الملفات إلى سلة المهملات، ويمكنك استعادتها منها.',
    en: 'The files go to the bin. You can retrieve them there.',
  },
  'best.bulkVerwijderenMappen': {
    nl: 'Bestanden gaan naar de prullenbak en kun je terughalen. Geselecteerde mappen worden verwijderd; de bestanden daaruit verhuizen naar je hoofdmap.',
    ar: 'تذهب الملفات إلى سلة المهملات ويمكنك استعادتها. تُحذف المجلدات المحددة؛ وتنتقل ملفاتها إلى مجلدك الرئيسي.',
    en: 'Files go to the bin and can be retrieved. Selected folders are deleted; their files move to your main folder.',
  },
  'best.delenBoekhouder': {
    nl: 'Delen met boekhouder',
    ar: 'مشاركة مع المحاسب',
    en: 'Share with the accountant',
  },
  'best.delenGestopt': {
    nl: 'Delen gestopt',
    ar: 'أُوقفت المشاركة',
    en: 'Sharing stopped',
  },
  'best.downloaden': {
    nl: 'Downloaden',
    ar: 'تنزيل',
    en: 'Download',
  },
  'best.favorieten': {
    nl: 'Favorieten',
    ar: 'المفضّلة',
    en: 'Favourites',
  },
  'best.fout.actie': {
    nl: 'Actie mislukt',
    ar: 'فشل الإجراء',
    en: 'The action failed',
  },
  'best.fout.delen': {
    nl: 'Delen mislukt — probeer opnieuw',
    ar: 'فشلت المشاركة — حاول مرة أخرى',
    en: 'Sharing failed — try again',
  },
  'best.fout.hernoemen': {
    nl: 'Hernoemen mislukt',
    ar: 'فشلت إعادة التسمية',
    en: 'Renaming failed',
  },
  'best.fout.mapAanmaken': {
    nl: 'Map aanmaken mislukt',
    ar: 'فشل إنشاء المجلد',
    en: 'Creating the folder failed',
  },
  'best.fout.mapVerwijderen': {
    nl: 'Map verwijderen mislukt',
    ar: 'فشل حذف المجلد',
    en: 'Deleting the folder failed',
  },
  'best.fout.sommigeAangepast': {
    nl: 'Sommige items niet aangepast — opnieuw geladen',
    ar: 'لم تُعدَّل بعض العناصر — أُعيد التحميل',
    en: 'Some items were not changed — reloaded',
  },
  'best.fout.sommigeGedeeld': {
    nl: 'Sommige bestanden niet gedeeld — opnieuw geladen',
    ar: 'لم تُشارك بعض الملفات — أُعيد التحميل',
    en: 'Some files were not shared — reloaded',
  },
  'best.fout.sommigeVerplaatst': {
    nl: 'Sommige items niet verplaatst — opnieuw geladen',
    ar: 'لم تُنقل بعض العناصر — أُعيد التحميل',
    en: 'Some items were not moved — reloaded',
  },
  'best.fout.sommigeVerwijderd': {
    nl: 'Sommige items niet verwijderd — opnieuw geladen',
    ar: 'لم تُحذف بعض العناصر — أُعيد التحميل',
    en: 'Some items were not deleted — reloaded',
  },
  'best.fout.stoppenDelen': {
    nl: 'Stoppen met delen mislukt',
    ar: 'فشل إيقاف المشاركة',
    en: 'Stopping sharing failed',
  },
  'best.fout.verplaatsen': {
    nl: 'Verplaatsen mislukt',
    ar: 'فشل النقل',
    en: 'Moving failed',
  },
  'best.fout.verplaatstNogHier': {
    nl: 'Verplaatsen mislukt — het bestand staat nog hier',
    ar: 'فشل النقل — الملف ما زال هنا',
    en: 'Moving failed — the file is still here',
  },
  'best.fout.verwijderen': {
    nl: 'Verwijderen mislukt',
    ar: 'فشل الحذف',
    en: 'Deleting failed',
  },
  'best.gebruikt': {
    nl: '{size} gebruikt',
    ar: 'المستخدم: {size}',
    en: '{size} used',
  },
  'best.gedeeldMet': {
    nl: 'Gedeeld met je boekhouder',
    ar: 'شورك مع المحاسب',
    en: 'Shared with your accountant',
  },
  'best.geknipt': {
    nl: '{n} items geknipt — Ctrl+V om te plakken',
    ar: 'عناصر مقصوصة: {n} — Ctrl+V للصق',
    en: '{n} items cut — Ctrl+V to paste',
  },
  'best.geknipt1': {
    nl: '1 item geknipt — Ctrl+V om te plakken',
    ar: 'قُصّ عنصر واحد — Ctrl+V للصق',
    en: '1 item cut — Ctrl+V to paste',
  },
  'best.gekopieerd': {
    nl: '{n} items gekopieerd — Ctrl+V om te plakken',
    ar: 'عناصر منسوخة: {n} — Ctrl+V للصق',
    en: '{n} items copied — Ctrl+V to paste',
  },
  'best.gekopieerd1': {
    nl: '1 item gekopieerd — Ctrl+V om te plakken',
    ar: 'نُسخ عنصر واحد — Ctrl+V للصق',
    en: '1 item copied — Ctrl+V to paste',
  },
  'best.grootte': {
    nl: 'Grootte',
    ar: 'الحجم',
    en: 'Size',
  },
  'best.itemsVerwijderen': {
    nl: '{n} item(s) verwijderen?',
    ar: 'حذف العناصر ({n})؟',
    en: 'Delete {n} item(s)?',
  },
  'best.jaHier': {
    nl: 'Ja, hier plaatsen',
    ar: 'نعم، ضعه هنا',
    en: 'Yes, place it here',
  },
  'best.kiesZelfMap': {
    nl: 'Kies zelf een map',
    ar: 'اختر مجلداً بنفسك',
    en: 'Choose a folder yourself',
  },
  'best.lijstweergave': {
    nl: 'Lijstweergave',
    ar: 'عرض قائمة',
    en: 'List view',
  },
  'best.mapHernoemen': {
    nl: 'Map hernoemen',
    ar: 'إعادة تسمية المجلد',
    en: 'Rename the folder',
  },
  'best.mapnaam': {
    nl: 'Mapnaam...',
    ar: 'اسم المجلد...',
    en: 'Folder name...',
  },
  'best.mapVerwijderenKnop': {
    nl: 'Map verwijderen',
    ar: 'حذف المجلد',
    en: 'Delete the folder',
  },
  'best.mapVerwijderenTitel': {
    nl: 'Map "{name}" verwijderen?',
    ar: 'حذف المجلد "{name}"؟',
    en: 'Delete the folder "{name}"?',
  },
  'best.mapVerwijderenUitleg': {
    nl: 'De bestanden erin blijven bestaan — die verhuizen naar je hoofdmap.',
    ar: 'تبقى الملفات الموجودة فيه — وتنتقل إلى مجلدك الرئيسي.',
    en: 'The files inside remain — they move to your main folder.',
  },
  'best.naarPrullenbakActie': {
    nl: 'Naar prullenbak',
    ar: 'إلى سلة المهملات',
    en: 'To the bin',
  },
  'best.naarPrullenbakEen': {
    nl: 'Bestand naar prullenbak',
    ar: 'نُقل الملف إلى سلة المهملات',
    en: 'File moved to the bin',
  },
  'best.naarPrullenbakMeer': {
    nl: '{n} bestanden naar prullenbak',
    ar: 'ملفات نُقلت إلى سلة المهملات: {n}',
    en: '{n} files moved to the bin',
  },
  'best.nietMeerDelen': {
    nl: 'Niet meer delen',
    ar: 'إيقاف المشاركة',
    en: 'Stop sharing',
  },
  'best.ongedaan': {
    nl: 'Ongedaan maken',
    ar: 'تراجع',
    en: 'Undo',
  },
  'best.oplopend': {
    nl: 'Oplopend',
    ar: 'تصاعدي',
    en: 'Ascending',
  },
  'best.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'best.raster': {
    nl: 'Rasterweergave',
    ar: 'عرض شبكي',
    en: 'Grid view',
  },
  'best.resultatenVoor': {
    nl: '{n} resultaten voor "{query}"',
    ar: 'نتائج البحث عن "{query}": {n}',
    en: '{n} results for "{query}"',
  },
  'best.smart.gedeeldLeeg': {
    nl: 'Bestanden die je met je boekhouder deelt verschijnen hier',
    ar: 'تظهر هنا الملفات التي تشاركها مع المحاسب',
    en: 'Files you share with your accountant appear here',
  },
  'best.smart.recentLeeg': {
    nl: 'Recent geopende of toegevoegde bestanden verschijnen hier',
    ar: 'تظهر هنا الملفات المفتوحة أو المضافة مؤخراً',
    en: 'Recently opened or added files appear here',
  },
  'best.smart.sterLeeg': {
    nl: 'Markeer bestanden met een ster om ze hier terug te vinden',
    ar: 'علّم الملفات بنجمة لتجدها هنا',
    en: 'Star files to find them back here',
  },
  'best.sterMarkeren': {
    nl: 'Markeren met ster',
    ar: 'تعليم بنجمة',
    en: 'Mark with a star',
  },
  'best.sterVerwijderen': {
    nl: 'Ster verwijderen',
    ar: 'إزالة النجمة',
    en: 'Remove the star',
  },
  'best.verplaatsen': {
    nl: 'Verplaatsen',
    ar: 'نقل',
    en: 'Move',
  },
  'best.zoeken': {
    nl: 'Zoeken...',
    ar: 'بحث...',
    en: 'Search...',
  },
  'bewerk.akkoordBetaalOp': {
    nl: 'Bij akkoord betaal je op',
    ar: 'عند الموافقة يتم الدفع على',
    en: 'On acceptance you pay to',
  },
  'bewerk.datum.leverUitleg': {
    nl: 'De datum waarop de levering of dienst is verricht. Vaak dezelfde als de factuurdatum, maar niet altijd — en hij is wettelijk verplicht op de factuur.',
    ar: 'التاريخ الذي تمّ فيه التسليم أو أداء الخدمة. غالباً هو نفس تاريخ الفاتورة، لكن ليس دائماً — وهو إلزامي قانوناً على الفاتورة.',
    en: 'The date the delivery or service was performed. Often the same as the invoice date, but not always — and it is legally required on the invoice.',
  },
  'bewerk.fout.verzenden': {
    nl: 'Verzenden mislukt',
    ar: 'فشل الإرسال',
    en: 'Sending failed',
  },
  'bewerk.modal.bedrag': {
    nl: 'Bedrag:',
    ar: 'المبلغ:',
    en: 'Amount:',
  },
  'bewerk.modal.email': {
    nl: 'E-mail:',
    ar: 'البريد الإلكتروني:',
    en: 'E-mail:',
  },
  'bewerk.modal.nummer': {
    nl: 'Factuurnummer:',
    ar: 'رقم الفاتورة:',
    en: 'Invoice number:',
  },
  'bewerk.modal.nummerBijVerzending': {
    nl: 'Wordt toegekend bij verzending',
    ar: 'يُخصَّص عند الإرسال',
    en: 'Assigned on sending',
  },
  'bewerk.modal.waarschuwing': {
    nl: 'Na verzending kun je deze factuur niet meer wijzigen. Voor correcties maak je een creditnota.',
    ar: 'بعد الإرسال لا يمكنك تعديل هذه الفاتورة. للتصحيح تُنشئ إشعاراً دائناً (creditnota).',
    en: 'After sending you can no longer change this invoice. For corrections you create a credit note.',
  },
  'bewerk.omzettenVersturen': {
    nl: 'Omzetten naar factuur en versturen',
    ar: 'التحويل إلى فاتورة والإرسال',
    en: 'Convert to invoice and send',
  },
  'bewerk.omzetWaarschuwing': {
    nl: 'Let op: hiermee wordt deze offerte een OFFICIËLE FACTUUR. Hij krijgt een factuurnummer uit je reeks, en dat is niet terug te draaien — een factuur corrigeer je met een creditnota. Wil je alleen de offerte bijwerken, gebruik dan "Wijzigingen opslaan".',
    ar: 'انتبه: بهذا يصبح عرض السعر هذا فاتورة رسمية. سيأخذ رقم فاتورة من سلسلتك، ولا يمكن التراجع عن ذلك — الفاتورة تُصحَّح بإشعار دائن (creditnota). إن أردت تحديث عرض السعر فقط، فاستخدم «حفظ التغييرات».',
    en: 'Careful: this turns the quote into an OFFICIAL INVOICE. It gets an invoice number from your sequence, and that cannot be undone — an invoice is corrected with a credit note. If you only want to update the quote, use "Save changes".',
  },
  'bewerk.opslaan': {
    nl: 'Wijzigingen opslaan',
    ar: 'حفظ التغييرات',
    en: 'Save changes',
  },
  'bewerk.opslaanBezig': {
    nl: 'Opslaan...',
    ar: 'جارٍ الحفظ...',
    en: 'Saving...',
  },
  'bewerk.prijsmodus.excl': {
    nl: 'Je typt de prijs zonder btw.',
    ar: 'تكتب السعر بدون btw.',
    en: 'You type the price without VAT.',
  },
  'bewerk.prijsmodus.incl': {
    nl: 'Je typt wat je klant betaalt.',
    ar: 'تكتب ما يدفعه عميلك.',
    en: 'You type what your customer pays.',
  },
  'bewerk.profielOnvolledig': {
    nl: 'KVK, BTW of IBAN ontbreekt — vul dit aan in je profiel voor een geldige factuur',
    ar: 'رقم KVK أو btw أو IBAN ناقص — أكمِله في ملفك الشخصي لتكون الفاتورة صالحة',
    en: 'KVK, VAT or IBAN is missing — complete it in your profile for a valid invoice',
  },
  'bewerk.titel.factuur': {
    nl: 'Factuur bewerken',
    ar: 'تعديل الفاتورة',
    en: 'Edit invoice',
  },
  'bewerk.titel.factuurMetNummer': {
    nl: 'Factuur bewerken · {number}',
    ar: 'تعديل الفاتورة · {number}',
    en: 'Edit invoice · {number}',
  },
  'bewerk.titel.offerte': {
    nl: 'Offerte bewerken',
    ar: 'تعديل عرض السعر',
    en: 'Edit quote',
  },
  'bewerk.vastgelegd': {
    nl: 'Deze factuur is verstuurd en wettelijk vastgelegd — wijzigen kan niet meer. Maak een creditnota aan om te corrigeren.',
    ar: 'هذه الفاتورة أُرسلت وثُبّتت قانونياً — لم يعد التعديل ممكناً. أنشئ إشعاراً دائناً (creditnota) للتصحيح.',
    en: 'This invoice has been sent and is legally recorded — it can no longer be changed. Create a credit note to correct it.',
  },
  'bewerk.verstuurFactuur': {
    nl: 'Verstuur factuur',
    ar: 'إرسال الفاتورة',
    en: 'Send invoice',
  },
  'bewerk.verzendenBezig': {
    nl: 'Verzenden...',
    ar: 'جارٍ الإرسال...',
    en: 'Sending...',
  },
  'brug.alleKanalen': {
    nl: 'Q{quarter} {year} · alle kanalen (kassa, bank, kas, facturen)',
    ar: 'Q{quarter} {year} · كل القنوات (الكاشير، البنك، الصندوق، الفواتير)',
    en: 'Q{quarter} {year} · all channels (till, bank, cash, invoices)',
  },
  'brug.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'brug.btw5a': {
    nl: 'BTW verschuldigd (5a)',
    ar: 'btw المستحق (5a)',
    en: 'BTW due (5a)',
  },
  'brug.btw5b': {
    nl: 'Voorbelasting (5b)',
    ar: 'الضريبة القابلة للخصم (5b)',
    en: 'Input tax (5b)',
  },
  'brug.btw5gBetalen': {
    nl: 'Concept te betalen (5g)',
    ar: 'المبدئي للدفع (5g)',
    en: 'Provisional to pay (5g)',
  },
  'brug.btw5gTerug': {
    nl: 'Concept terug te ontvangen (5g)',
    ar: 'المبدئي المسترد (5g)',
    en: 'Provisional to receive back (5g)',
  },
  'brug.conceptBtwBetalen': {
    nl: 'Concept BTW te betalen',
    ar: 'btw المبدئية للدفع',
    en: 'Provisional BTW to pay',
  },
  'brug.conceptBtwTerug': {
    nl: 'Concept BTW terug te ontvangen',
    ar: 'btw المبدئية المستردة',
    en: 'Provisional BTW to receive back',
  },
  'brug.downloadKwartaal': {
    nl: 'Download kwartaal',
    ar: 'تنزيل الربع',
    en: 'Download quarter',
  },
  'brug.en': {
    nl: 'en',
    ar: 'و',
    en: 'and',
  },
  'brug.evenControleren': {
    nl: 'Even controleren',
    ar: 'تحقّق سريع',
    en: 'Worth checking',
  },
  'brug.fout.nietLaden': {
    nl: 'We konden {parts} niet laden',
    ar: 'تعذّر علينا تحميل {parts}',
    en: 'We could not load {parts}',
  },
  'brug.fout.opslaan': {
    nl: 'Opslaan mislukt.',
    ar: 'فشل الحفظ.',
    en: 'Saving failed.',
  },
  'brug.fout.pakket': {
    nl: 'Het pakket kon niet worden gemaakt. Probeer het opnieuw.',
    ar: 'تعذّر إنشاء الحزمة. حاول مرة أخرى.',
    en: 'The package could not be created. Please try again.',
  },
  'brug.fout.pakketOffline': {
    nl: 'Geen verbinding — het pakket is niet gedownload.',
    ar: 'لا يوجد اتصال — لم تُنزَّل الحزمة.',
    en: 'No connection — the package was not downloaded.',
  },
  'brug.fout.statusOffline': {
    nl: 'Geen verbinding — de status is niet opgeslagen.',
    ar: 'لا يوجد اتصال — لم تُحفَظ الحالة.',
    en: 'No connection — the status was not saved.',
  },
  'brug.fout.vraagOffline': {
    nl: 'Geen verbinding — je vraag is niet verstuurd.',
    ar: 'لا يوجد اتصال — لم يُرسَل سؤالك.',
    en: 'No connection — your question was not sent.',
  },
  'brug.fout.vraagOpnieuw': {
    nl: 'Je vraag is niet verstuurd — probeer het opnieuw.',
    ar: 'لم يُرسَل سؤالك — حاول مرة أخرى.',
    en: 'Your question was not sent — please try again.',
  },
  'brug.inkomend': {
    nl: 'Ink.',
    ar: 'وارد',
    en: 'In',
  },
  'brug.kiesKlantOptie': {
    nl: '— Kies een klant —',
    ar: '— اختر عميلاً —',
    en: '— Choose a client —',
  },
  'brug.klaar.bijna': {
    nl: 'Bijna klaar',
    ar: 'شبه جاهز',
    en: 'Almost ready',
  },
  'brug.klaar.nogNiet': {
    nl: 'Nog niet klaar',
    ar: 'غير جاهز بعد',
    en: 'Not ready yet',
  },
  'brug.klaar.voorVerwerking': {
    nl: 'Klaar voor verwerking',
    ar: 'جاهز للمعالجة',
    en: 'Ready for processing',
  },
  'brug.klantenGekoppeld': {
    nl: '{count} klanten gekoppeld',
    ar: 'العملاء المرتبطون: {count}',
    en: '{count} clients linked',
  },
  'brug.kostenExcl': {
    nl: 'Kosten (excl. BTW)',
    ar: 'التكاليف (بدون btw)',
    en: 'Costs (excl. BTW)',
  },
  'brug.moetGebeuren': {
    nl: 'Wat moet er nog gebeuren',
    ar: 'ما الذي يجب فعله بعد',
    en: 'What still needs to happen',
  },
  'brug.omzetExcl': {
    nl: 'Omzet (excl. BTW)',
    ar: 'الإيرادات (بدون btw)',
    en: 'Turnover (excl. BTW)',
  },
  'brug.omzetZonderTarief': {
    nl: '{amount} omzet (contant of via de bank) heeft nog geen BTW-tarief — die BTW zit niet in 5a.',
    ar: '{amount} من الإيرادات (نقداً أو عبر البنك) بلا نسبة btw بعد — هذه الضريبة ليست ضمن 5a.',
    en: '{amount} of turnover (cash or via the bank) has no BTW rate yet — that BTW is not in 5a.',
  },
  'brug.resultaat': {
    nl: 'Resultaat',
    ar: 'النتيجة',
    en: 'Result',
  },
  'brug.status.inBehandeling': {
    nl: 'In behandeling',
    ar: 'قيد المعالجة',
    en: 'In progress',
  },
  'brug.status.teVerwerken': {
    nl: 'Te verwerken',
    ar: 'بانتظار المعالجة',
    en: 'To process',
  },
  'brug.status.verwerkt': {
    nl: 'Verwerkt',
    ar: 'مُعالَج',
    en: 'Processed',
  },
  'brug.status.vraag': {
    nl: 'Vraag',
    ar: 'سؤال',
    en: 'Question',
  },
  'brug.tab.documenten': {
    nl: 'Documenten',
    ar: 'المستندات',
    en: 'Documents',
  },
  'brug.tab.kwartaal': {
    nl: 'Kwartaal',
    ar: 'الربع',
    en: 'Quarter',
  },
  'brug.tab.overzicht': {
    nl: 'Overzicht',
    ar: 'نظرة عامة',
    en: 'Overview',
  },
  'brug.uitgaand': {
    nl: 'Uitg.',
    ar: 'صادر',
    en: 'Out',
  },
  'brug.vraag.placeholder': {
    nl: 'Waar gaat deze bon over?',
    ar: 'ما موضوع هذا الإيصال؟',
    en: 'What is this receipt about?',
  },
  'brug.vraag.titel': {
    nl: 'Vraag over dit document',
    ar: 'سؤال عن هذا المستند',
    en: 'Question about this document',
  },
  'brug.vraag.uitleg': {
    nl: 'Je klant ziet deze tekst op zijn scherm en kan er direct op antwoorden.',
    ar: 'يرى عميلك هذا النص على شاشته ويمكنه الرد عليه مباشرة.',
    en: 'Your client sees this text on their screen and can reply to it directly.',
  },
  'brug.vraag.versturen': {
    nl: 'Vraag versturen',
    ar: 'إرسال السؤال',
    en: 'Send the question',
  },
  'brug.zoek.geen': {
    nl: 'Geen documenten gevonden voor “{query}”',
    ar: 'لم يُعثر على مستندات لـ «{query}»',
    en: 'No documents found for “{query}”',
  },
  'brug.zoek.resultaat': {
    nl: '1 resultaat in alle mappen',
    ar: 'نتيجة واحدة في كل المجلدات',
    en: '1 result in all folders',
  },
  'brug.zoek.resultaten': {
    nl: '{count} resultaten in alle mappen',
    ar: 'النتائج في كل المجلدات: {count}',
    en: '{count} results in all folders',
  },
  'cat.automatisch': {
    nl: 'automatisch ingevuld',
    ar: 'عُبّئت تلقائياً',
    en: 'filled in automatically',
  },
  'cat.bevestigen': {
    nl: 'Bevestigen',
    ar: 'تأكيد',
    en: 'Confirm',
  },
  'cat.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ العمل…',
    en: 'Working…',
  },
  'cat.doorJou': {
    nl: 'door jou bevestigd',
    ar: 'أكّدتها بنفسك',
    en: 'confirmed by you',
  },
  'cat.eersteGetoond': {
    nl: 'we tonen de eerste {count}',
    ar: 'نعرض أول {count}',
    en: 'showing the first {count}',
  },
  'cat.herkend': {
    nl: 'herkend',
    ar: 'معروفة',
    en: 'recognised',
  },
  'cat.ingevuld': {
    nl: 'ingevulde transacties',
    ar: 'معاملة معبَّأة',
    en: 'filled-in transactions',
  },
  'cat.introReview': {
    nl: 'Controleer wat we al hebben ingevuld en wijzig een verkeerde categorie.',
    ar: 'راجع ما عبّأناه بالفعل وعدّل أي تصنيف خاطئ.',
    en: 'Check what we already filled in and change a wrong category.',
  },
  'cat.introTodo': {
    nl: 'Geef elke banktransactie een plek. We onthouden je keuze per bedrijf.',
    ar: 'أعطِ كل معاملة بنكية مكانها. نتذكّر اختيارك لكل شركة.',
    en: 'Give every bank transaction a place. We remember your choice per company.',
  },
  'cat.lijktOp': {
    nl: 'lijkt op {name}',
    ar: 'تشبه {name}',
    en: 'looks like {name}',
  },
  'cat.lijktOpEerdere': {
    nl: 'lijkt op eerdere',
    ar: 'تشبه سابقاتها',
    en: 'looks like earlier ones',
  },
  'cat.nogTeDoen': {
    nl: 'Nog {count} transacties te doen',
    ar: 'المتبقي: {count} معاملة',
    en: '{count} transactions still to do',
  },
  'cat.nogTeDoenEen': {
    nl: 'Nog 1 transactie te doen',
    ar: 'بقيت معاملة واحدة',
    en: '1 transaction still to do',
  },
  'cat.onbekend': {
    nl: 'Onbekende transactie',
    ar: 'معاملة غير معروفة',
    en: 'Unknown transaction',
  },
  'cat.onthouden': {
    nl: 'onthouden',
    ar: 'محفوظة',
    en: 'remembered',
  },
  'cat.reviewUitleg': {
    nl: 'Tik op een categorie om die te wijzigen en bevestig. Wat de app zelf invulde staat bovenaan.',
    ar: 'انقر على تصنيف لتغييره ثم أكِّد. ما عبّأه التطبيق بنفسه يظهر في الأعلى.',
    en: 'Tap a category to change it and confirm. What the app filled in itself is at the top.',
  },
  'cat.tabReview': {
    nl: 'Ingevuld wijzigen',
    ar: 'تعديل المعبَّأ',
    en: 'Change filled-in',
  },
  'cat.tabTodo': {
    nl: 'Te doen',
    ar: 'للعمل',
    en: 'To do',
  },
  'cat.teDoen': {
    nl: 'transacties te doen',
    ar: 'معاملة متبقية',
    en: 'transactions to do',
  },
  'cat.teDoenEen': {
    nl: 'transactie te doen',
    ar: 'معاملة متبقية',
    en: 'transaction to do',
  },
  'cat.voorstel': {
    nl: 'voorstel',
    ar: 'اقتراح',
    en: 'suggestion',
  },
  'cat.wachtrij': {
    nl: 'Er staan er nog {count} in de wachtrij die nog niet geladen zijn.',
    ar: 'ما زال في قائمة الانتظار {count} لم تُحمَّل بعد.',
    en: 'There are {count} more in the queue that have not been loaded yet.',
  },
  'cat.zekereInvullen': {
    nl: '{count} zekere invullen',
    ar: 'عبّئ المؤكدة ({count})',
    en: 'Fill in {count} certain ones',
  },
  'cat.zekereUitleg': {
    nl: 'We vullen alleen transacties in die we zeker weten (onthouden of duidelijk herkend, zoals belasting, overboekingen en bankkosten). De rest laten we aan jou — we verzinnen niets.',
    ar: 'لا نعبّئ إلا المعاملات المؤكدة لدينا (المحفوظة أو المعروفة بوضوح، كالضرائب والتحويلات ورسوم البنك). الباقي نتركه لك — لا نختلق شيئاً.',
    en: 'We only fill in transactions we are sure of (remembered or clearly recognised, such as tax, transfers and bank fees). The rest we leave to you — we invent nothing.',
  },
  'cat.zoekLeeg': {
    nl: 'Geen transacties gevonden voor “{query}”.',
    ar: 'لم يُعثر على معاملات لـ«{query}».',
    en: 'No transactions found for “{query}”.',
  },
  'cat.zoekLeegEerste': {
    nl: 'Geen transacties gevonden voor “{query}” in de eerste {count}.',
    ar: 'لم يُعثر على معاملات لـ«{query}» ضمن أول {count}.',
    en: 'No transactions found for “{query}” in the first {count}.',
  },
  'detail.aangemaaktDoor': {
    nl: 'Aangemaakt door {name}',
    ar: 'أنشأها {name}',
    en: 'Created by {name}',
  },
  'detail.bekijken': {
    nl: 'Bekijken',
    ar: 'عرض',
    en: 'View',
  },
  'detail.betaal.op': {
    nl: 'Gelieve te betalen op',
    ar: 'يُرجى الدفع على',
    en: 'Please pay to',
  },
  'detail.betaal.ovv': {
    nl: 'o.v.v.',
    ar: 'مع ذكر',
    en: 'quoting',
  },
  'detail.bezorging.email': {
    nl: 'De e-mail kon niet worden afgeleverd. Het factuurnummer is wel definitief.',
    ar: 'تعذّر تسليم البريد الإلكتروني. لكن رقم الفاتورة نهائي.',
    en: 'The e-mail could not be delivered. The invoice number is final, though.',
  },
  'detail.bezorging.pdf': {
    nl: 'De PDF kon niet worden gegenereerd. Het factuurnummer is wel definitief.',
    ar: 'تعذّر توليد ملف PDF. لكن رقم الفاتورة نهائي.',
    en: 'The PDF could not be generated. The invoice number is final, though.',
  },
  'detail.credit.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ العمل…',
    en: 'Working…',
  },
  'detail.credit.klant': {
    nl: 'Klant:',
    ar: 'العميل:',
    en: 'Client:',
  },
  'detail.credit.maken': {
    nl: 'Creditnota maken',
    ar: 'إنشاء إشعار دائن',
    en: 'Create credit note',
  },
  'detail.credit.reden': {
    nl: 'Reden (optioneel)',
    ar: 'السبب (اختياري)',
    en: 'Reason (optional)',
  },
  'detail.credit.titel': {
    nl: 'Creditnota maken voor {number}?',
    ar: 'إنشاء إشعار دائن عن {number}؟',
    en: 'Create a credit note for {number}?',
  },
  'detail.credit.titelZonder': {
    nl: 'Creditnota maken voor deze factuur?',
    ar: 'إنشاء إشعار دائن عن هذه الفاتورة؟',
    en: 'Create a credit note for this invoice?',
  },
  'detail.credit.uitleg': {
    nl: 'We maken automatisch een creditnota met dezelfde regels als negatieve bedragen. De originele factuur blijft staan en wordt gemarkeerd als gecrediteerd. Je hoeft niets over te typen.',
    ar: 'نُنشئ تلقائياً إشعاراً دائناً بنفس البنود بمبالغ سالبة. تبقى الفاتورة الأصلية كما هي وتُعلَّم بأنها عُكست. لا تحتاج إلى إعادة كتابة أي شيء.',
    en: 'We automatically create a credit note with the same lines as negative amounts. The original invoice stays and is marked as credited. You do not have to retype anything.',
  },
  'detail.fout.creditnota': {
    nl: 'Creditnota aanmaken mislukt — probeer opnieuw',
    ar: 'فشل إنشاء الإشعار الدائن — حاول مرة أخرى',
    en: 'Creating the credit note failed — try again',
  },
  'detail.fout.opnieuwVersturen': {
    nl: 'Opnieuw versturen mislukt',
    ar: 'فشلت إعادة الإرسال',
    en: 'Resending failed',
  },
  'detail.fout.origineelPdf': {
    nl: 'Origineel PDF kon niet worden geopend',
    ar: 'تعذّر فتح ملف PDF الأصلي',
    en: 'The original PDF could not be opened',
  },
  'detail.fout.pdfNietGemaakt': {
    nl: 'De factuur kreeg een nummer, maar de PDF kon niet worden gemaakt — de klant heeft niets ontvangen. Verstuur opnieuw.',
    ar: 'أخذت الفاتورة رقماً، لكن تعذّر إنشاء ملف PDF — لم يستلم العميل شيئاً. أعد الإرسال.',
    en: 'The invoice got a number, but the PDF could not be created — the client received nothing. Send again.',
  },
  'detail.gecrediteerdVia': {
    nl: 'Gecrediteerd via {number}',
    ar: 'عُكست عبر الإشعار الدائن {number}',
    en: 'Credited via {number}',
  },
  'detail.kolom.prijs': {
    nl: 'Prijs',
    ar: 'السعر',
    en: 'Price',
  },
  'detail.kwartaal.betaaldIn': {
    nl: 'Betaald in {quarter}.',
    ar: 'دُفعت في {quarter}.',
    en: 'Paid in {quarter}.',
  },
  'detail.kwartaal.uitleg': {
    nl: 'Voor de btw telt deze factuur mee in {quarter} — de kwartaal­aangifte volgt de factuurdatum, niet de betaaldatum. Dit verandert daar niets aan; het laat alleen zien wanneer het geld binnenkwam.',
    ar: 'بالنسبة للضريبة تُحتسب هذه الفاتورة في {quarter} — إقرار الربع يتبع تاريخ الفاتورة، لا تاريخ الدفع. هذا لا يغيّر شيئاً هناك؛ إنما يبيّن متى وصل المال.',
    en: 'For VAT this invoice counts in {quarter} — the quarterly return follows the invoice date, not the payment date. This changes nothing there; it only shows when the money came in.',
  },
  'detail.opnieuwVerzonden': {
    nl: 'De factuur is opnieuw verzonden.',
    ar: 'أُعيد إرسال الفاتورة.',
    en: 'The invoice was sent again.',
  },
  'detail.origineelPdf': {
    nl: 'Origineel PDF',
    ar: 'ملف PDF الأصلي',
    en: 'Original PDF',
  },
  'detail.rij.betaaldOp': {
    nl: 'Betaald op: {value}',
    ar: 'دُفعت في: {value}',
    en: 'Paid on: {value}',
  },
  'detail.rij.datum': {
    nl: 'Datum: {value}',
    ar: 'التاريخ: {value}',
    en: 'Date: {value}',
  },
  'detail.rij.nummer': {
    nl: 'Nummer: {value}',
    ar: 'الرقم: {value}',
    en: 'Number: {value}',
  },
  'detail.rij.vervaldatum': {
    nl: 'Vervaldatum: {value}',
    ar: 'تاريخ الاستحقاق: {value}',
    en: 'Due date: {value}',
  },
  'dq.klant': {
    nl: 'Klant',
    ar: 'عميل',
    en: 'Client',
  },
  'dq.lijstGewist': {
    nl: 'De lijst is gewist.',
    ar: 'مُسحت القائمة.',
    en: 'The list has been cleared.',
  },
  'dq.opstellenMislukt': {
    nl: 'Opstellen mislukt',
    ar: 'فشلت الصياغة',
    en: 'Drafting failed',
  },
  'dq.toevoegenMislukt': {
    nl: 'Toevoegen mislukt',
    ar: 'فشلت الإضافة',
    en: 'Adding failed',
  },
  'dq.verstuurdNaar': {
    nl: '✓ E-mail verstuurd naar {naam}.',
    ar: '✓ أُرسل البريد الإلكتروني إلى {naam}.',
    en: '✓ E-mail sent to {naam}.',
  },
  'dq.verzendenMislukt': {
    nl: 'Verzenden mislukt',
    ar: 'فشل الإرسال',
    en: 'Sending failed',
  },
  'dz.beheerUitleg': {
    nl: 'Staat hier een dag met de verkeerde datum of uit een andere periode? Verwijder hem — dat corrigeert je omzet en BTW-aangifte. Daarna kun je het juiste Z-rapport opnieuw importeren.',
    ar: 'هل هنا يوم بتاريخ خاطئ أو من فترة أخرى؟ احذفه — فهذا يصحّح إيرادك وإقرار الضريبة. بعدها يمكنك استيراد تقرير Z الصحيح من جديد.',
    en: 'Is there a day with the wrong date or from another period? Delete it — that corrects your turnover and VAT return. Afterwards you can import the right Z-report again.',
  },
  'dz.dagenBeheren': {
    nl: 'Geboekte dagen beheren ({n})',
    ar: 'إدارة الأيام المُقيَّدة ({n})',
    en: 'Manage booked days ({n})',
  },
  'dz.fout.iets': {
    nl: 'Er ging iets mis — probeer opnieuw.',
    ar: 'حدث خطأ — حاول مرة أخرى.',
    en: 'Something went wrong — try again.',
  },
  'dz.fout.verwijderenDag': {
    nl: 'Kon de dag niet verwijderen — probeer opnieuw.',
    ar: 'تعذّر حذف اليوم — حاول مرة أخرى.',
    en: 'Could not delete the day — try again.',
  },
  'dz.geenGeboekt': {
    nl: 'Geen kassa-omzet geboekt in {period}.',
    ar: 'لا إيراد كاشير مُقيَّد في {period}.',
    en: 'No till turnover booked in {period}.',
  },
  'dz.geenPinAantallen': {
    nl: 'geen pin-aantallen in de bank',
    ar: 'لا أعداد PIN في البنك',
    en: 'no PIN counts in the bank',
  },
  'dz.gemPinbon': {
    nl: 'Gem. pinbon',
    ar: 'متوسط إيصال PIN',
    en: 'Avg. card receipt',
  },
  'dz.nee': {
    nl: 'Nee',
    ar: 'لا',
    en: 'No',
  },
  'dz.omzetDagen': {
    nl: 'Omzet ({n} dagen)',
    ar: 'الإيراد (الأيام: {n})',
    en: 'Turnover ({n} days)',
  },
  'dz.ongewoonHoog': {
    nl: 'ongewoon hoog',
    ar: 'مرتفع بشكل غير معتاد',
    en: 'unusually high',
  },
  'dz.ongewoonLaag': {
    nl: 'ongewoon laag',
    ar: 'منخفض بشكل غير معتاد',
    en: 'unusually low',
  },
  'dz.pintransacties': {
    nl: '{n} pintransacties',
    ar: 'معاملات PIN: {n}',
    en: '{n} card transactions',
  },
  'dz.tonen': {
    nl: 'Tonen',
    ar: 'إظهار',
    en: 'Show',
  },
  'dz.verwijderDag': {
    nl: 'Verwijder {date}',
    ar: 'حذف {date}',
    en: 'Delete {date}',
  },
  'dzi.aandachtspuntEen': {
    nl: '1 aandachtspunt',
    ar: 'نقطة واحدة تحتاج انتباهاً',
    en: '1 point of attention',
  },
  'dzi.aandachtspunten': {
    nl: '{n} aandachtspunten',
    ar: 'نقاط تحتاج انتباهاً: {n}',
    en: '{n} points of attention',
  },
  'dzi.alsOmzetGeteld': {
    nl: 'als omzet geteld en verandert je resultaat niet.',
    ar: 'يُحتسب كإيراد ولا يغيّر نتيجتك.',
    en: 'counted as turnover and does not change your result.',
  },
  'dzi.anderBestand': {
    nl: 'Ander bestand kiezen ({name})',
    ar: 'اختيار ملف آخر ({name})',
    en: 'Choose another file ({name})',
  },
  'dzi.bezigLezen': {
    nl: 'Bezig met lezen…',
    ar: 'جارٍ القراءة…',
    en: 'Reading…',
  },
  'dzi.btwGedetecteerd': {
    nl: 'BTW gedetecteerd',
    ar: 'btw المكتشفة',
    en: 'VAT detected',
  },
  'dzi.contant': {
    nl: 'contant {amount}',
    ar: 'نقداً {amount}',
    en: 'cash {amount}',
  },
  'dzi.controle': {
    nl: 'controle',
    ar: 'فحصاً',
    en: 'check',
  },
  'dzi.dagenTotaal': {
    nl: '{n} dagen · totaal ontvangen',
    ar: 'الأيام: {n} · إجمالي المقبوض',
    en: '{n} days · total received',
  },
  'dzi.dagTotaal': {
    nl: '{n} dag · totaal ontvangen',
    ar: 'الأيام: {n} · إجمالي المقبوض',
    en: '{n} day · total received',
  },
  'dzi.ditIsEen': {
    nl: 'Dit is een',
    ar: 'يُعَدّ هذا',
    en: 'This is a',
  },
  'dzi.gelezenUit': {
    nl: 'Gelezen uit {name}',
    ar: 'قُرئ من {name}',
    en: 'Read from {name}',
  },
  'dzi.goedkeurenOpslaan': {
    nl: 'Goedkeuren en opslaan',
    ar: 'الموافقة والحفظ',
    en: 'Approve and save',
  },
  'dzi.grootboekUit': {
    nl: 'Grootboek-controle uit {name}',
    ar: 'فحص دفتر الأستاذ من {name}',
    en: 'Ledger check from {name}',
  },
  'dzi.intro1': {
    nl: 'Upload het Z-rapport van de kassa (.xls, .xlsx of .csv). Je ziet eerst precies wat er is gelezen — er wordt niets opgeslagen tot je op',
    ar: 'ارفع تقرير Z من الكاشير (.xls أو .xlsx أو .csv). سترى أولاً ما قُرئ بالضبط — لن يُحفظ شيء حتى تضغط',
    en: 'Upload the till Z-report (.xls, .xlsx or .csv). You first see exactly what was read — nothing is stored until you click',
  },
  'dzi.intro2': {
    nl: ' klikt. Upload je een grootboek-overzicht (OVERZICHT/KASBOEK van de boekhouder), dan wordt dat automatisch herkend en als',
    ar: '. إذا رفعت كشف دفتر أستاذ (OVERZICHT/KASBOEK من المحاسب) فيُتعرَّف عليه تلقائياً ويُحفظ بوصفه',
    en: '. If you upload a ledger overview (the accountant’s OVERZICHT/KASBOEK), it is recognised automatically and kept as a',
  },
  'dzi.intro3': {
    nl: 'op je kassa bewaard — niet als omzet.',
    ar: 'على كاشيرك — لا كإيراد.',
    en: 'on your till — not as turnover.',
  },
  'dzi.kiesZ': {
    nl: 'Kies een Z-rapport',
    ar: 'اختر تقرير Z',
    en: 'Choose a Z-report',
  },
  'dzi.klaarBank': {
    nl: '✓ {n} dagen Bank-grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر أستاذ البنك المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of bank ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarBankEen': {
    nl: '✓ 1 dag Bank-grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر أستاذ البنك كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of bank ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarGrootboek': {
    nl: '✓ {n} dagen Grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر الأستاذ المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarGrootboekEen': {
    nl: '✓ 1 dag Grootboek opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر الأستاذ كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarKas': {
    nl: '✓ {n} dagen Kas-grootboek (contant) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر أستاذ الصندوق (نقداً) المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of cash ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarKasEen': {
    nl: '✓ 1 dag Kas-grootboek (contant) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر أستاذ الصندوق (نقداً) كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of cash ledger saved as a check (does not count as turnover).',
  },
  'dzi.klaarOmzet': {
    nl: '✓ {n} dagen dagomzet opgeslagen.',
    ar: '✓ أيام إيراد اليوم المحفوظة: {n}.',
    en: '✓ {n} days of daily turnover saved.',
  },
  'dzi.klaarOmzetEen': {
    nl: '✓ 1 dag dagomzet opgeslagen.',
    ar: '✓ حُفظ يوم واحد من إيراد اليوم.',
    en: '✓ 1 day of daily turnover saved.',
  },
  'dzi.klaarPin': {
    nl: '✓ {n} dagen PIN-grootboek (kaartbetalingen) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ أيام دفتر أستاذ PIN (مدفوعات البطاقة) المحفوظة كفحص: {n} (لا تُحتسب كإيراد).',
    en: '✓ {n} days of PIN ledger (card payments) saved as a check (does not count as turnover).',
  },
  'dzi.klaarPinEen': {
    nl: '✓ 1 dag PIN-grootboek (kaartbetalingen) opgeslagen als controle (telt niet mee als omzet).',
    ar: '✓ حُفظ يوم واحد من دفتر أستاذ PIN (مدفوعات البطاقة) كفحص (لا يُحتسب كإيراد).',
    en: '✓ 1 day of PIN ledger (card payments) saved as a check (does not count as turnover).',
  },
  'dzi.konGrootboekNietLezen': {
    nl: 'Kon het grootboek niet lezen',
    ar: 'تعذّرت قراءة دفتر الأستاذ',
    en: 'Could not read the ledger',
  },
  'dzi.konNietLezen': {
    nl: 'Kon het bestand niet lezen',
    ar: 'تعذّرت قراءة الملف',
    en: 'Could not read the file',
  },
  'dzi.ledger.bank': {
    nl: 'Bank-grootboek',
    ar: 'دفتر أستاذ البنك',
    en: 'Bank ledger',
  },
  'dzi.ledger.cash': {
    nl: 'Kas-grootboek (contant)',
    ar: 'دفتر أستاذ الصندوق (نقداً)',
    en: 'Cash ledger (cash)',
  },
  'dzi.ledger.other': {
    nl: 'Grootboek',
    ar: 'دفتر الأستاذ',
    en: 'Ledger',
  },
  'dzi.ledger.pin': {
    nl: 'PIN-grootboek (kaartbetalingen)',
    ar: 'دفتر أستاذ PIN (مدفوعات البطاقة)',
    en: 'PIN ledger (card payments)',
  },
  'dzi.netto': {
    nl: 'netto {amount}',
    ar: 'الصافي {amount}',
    en: 'net {amount}',
  },
  'dzi.nietWoord': {
    nl: 'niet',
    ar: 'لا',
    en: 'not',
  },
  'dzi.opslaanControle': {
    nl: 'Opslaan als controle',
    ar: 'حفظ كفحص',
    en: 'Save as a check',
  },
  'dzi.rekening': {
    nl: 'rekening {nr}',
    ar: 'الحساب {nr}',
    en: 'account {nr}',
  },
  'dzi.tegenKassa': {
    nl: 'tegen je kassa (PIN/contant) — het wordt',
    ar: 'لصندوق كاشيرك (PIN/نقداً) — وهو',
    en: 'against your till (PIN/cash) — it is',
  },
  'ink.aangifteIngediend': {
    nl: 'aangifte al ingediend — dit wordt een correctie',
    ar: 'الإقرار (aangifte) قُدّم بالفعل — سيصبح هذا تصحيحاً',
    en: 'aangifte already filed — this becomes a correction',
  },
  'ink.afgeschrevenOp': {
    nl: 'afgeschreven {date}',
    ar: 'خُصمت {date}',
    en: 'collected {date}',
  },
  'ink.alleenBedragEen': {
    nl: '1 koppeling is alleen op bedrag herkend (geen factuurnummer in de omschrijving) — controleer die even.',
    ar: 'رُبط واحد على المبلغ فقط (لا رقم فاتورة في الوصف) — تحقّق منه سريعاً.',
    en: '1 link was recognised on amount only (no invoice number in the description) — give it a quick check.',
  },
  'ink.alleenBedragN': {
    nl: '{n} koppelingen zijn alleen op bedrag herkend (geen factuurnummer in de omschrijving) — controleer die even.',
    ar: 'رُبط {n} على المبلغ فقط (لا رقم فاتورة في الوصف) — تحقّق منها سريعاً.',
    en: '{n} links were recognised on amount only (no invoice number in the description) — give them a quick check.',
  },
  'ink.alleenBedragNaam': {
    nl: 'alleen op bedrag en naam herkend — controleer deze',
    ar: 'تم التعرّف عليها بالمبلغ والاسم فقط — تحقّق منها',
    en: 'recognised on amount and name only — check this one',
  },
  'ink.allePeriodes': {
    nl: 'Alle periodes',
    ar: 'كل الفترات',
    en: 'All periods',
  },
  'ink.anderePeriodes': {
    nl: 'Je hebt er {facturen} in andere periodes.',
    ar: 'لديك {facturen} في فترات أخرى.',
    en: 'You have {facturen} in other periods.',
  },
  'ink.autoIncasso': {
    nl: 'Automatische incasso',
    ar: 'خصم تلقائي',
    en: 'Direct debit',
  },
  'ink.autoNudge': {
    nl: '{n} facturen zijn automatisch verwerkt — bekijk',
    ar: 'عولجت {n} فاتورة تلقائياً — اعرضها',
    en: '{n} invoices were processed automatically — view',
  },
  'ink.autoNudgeEen': {
    nl: '1 factuur is automatisch verwerkt — bekijk',
    ar: 'عولجت فاتورة واحدة تلقائياً — اعرضها',
    en: '1 invoice was processed automatically — view',
  },
  'ink.autoVerifiedUitleg': {
    nl: 'Deze factuur was duidelijk leesbaar en is automatisch geverifieerd. Controleer indien je twijfelt.',
    ar: 'كانت هذه الفاتورة واضحة القراءة وتم التحقق منها تلقائياً. تحقّق إن ساورك شك.',
    en: 'This invoice was clearly legible and was verified automatically. Check it if you are in doubt.',
  },
  'ink.backfill.knop': {
    nl: 'Opnieuw ophalen',
    ar: 'إعادة الجلب',
    en: 'Fetch again',
  },
  'ink.backfill.uitleg': {
    nl: 'Ik scan je e-mail opnieuw vanaf deze datum en importeer wat er nog mist. Al geïmporteerde facturen blijven zoals ze zijn — niets wordt dubbel.',
    ar: 'سأفحص بريدك من جديد اعتباراً من هذا التاريخ وأستورد الناقص. الفواتير المستوردة مسبقاً تبقى كما هي — لا شيء يتكرر.',
    en: 'I scan your e-mail again from this date and import what is still missing. Already imported invoices stay as they are — nothing is duplicated.',
  },
  'ink.bankMatchMislukt': {
    nl: 'Het bankafschrift kon niet worden gematcht — probeer het straks opnieuw.',
    ar: 'تعذّرت مطابقة كشف الحساب البنكي — حاول بعد قليل.',
    en: 'The bank statement could not be matched — try again in a while.',
  },
  'ink.bankregelTerug': {
    nl: 'Stond er een bankregel tegenover, dan komt die terug bij "Te bevestigen" op de Bank-pagina.',
    ar: 'إن كانت تقابلها حركة بنكية، فستعود إلى "Te bevestigen" في صفحة البنك.',
    en: 'If a bank line stood against it, it returns to "Te bevestigen" on the Bank page.',
  },
  'ink.bedrag.btwIs': {
    nl: 'BTW = {bedrag}',
    ar: 'btw = {bedrag}',
    en: 'VAT = {bedrag}',
  },
  'ink.bedrag.exclIs': {
    nl: 'Excl. BTW = {bedrag}',
    ar: 'بدون btw = {bedrag}',
    en: 'Excl. VAT = {bedrag}',
  },
  'ink.bedrag.neemOver': {
    nl: 'Neem {bedrag} over',
    ar: 'اعتمد {bedrag}',
    en: 'Take over {bedrag}',
  },
  'ink.bedrag.staatOp': {
    nl: 'Staat dit bedrag op je factuur?',
    ar: 'هل هذا المبلغ مكتوب على فاتورتك؟',
    en: 'Is this amount on your invoice?',
  },
  'ink.bedrag.welkeKlopt': {
    nl: 'Welke klopt volgens de factuur? Het totaal ({bedrag}) blijft staan.',
    ar: 'أيّها الصحيح حسب الفاتورة؟ الإجمالي ({bedrag}) يبقى كما هو.',
    en: 'Which one matches the invoice? The total ({bedrag}) stays as it is.',
  },
  'ink.bedragenKloppenNiet': {
    nl: 'Bedragen kloppen niet',
    ar: 'المبالغ غير صحيحة',
    en: 'Amounts do not add up',
  },
  'ink.beheren': {
    nl: 'Beheren',
    ar: 'إدارة',
    en: 'Manage',
  },
  'ink.bekijkPdf': {
    nl: 'Bekijk PDF',
    ar: 'اعرض PDF',
    en: 'View PDF',
  },
  'ink.betaaldGemarkeerd': {
    nl: '✓ Factuur gemarkeerd als betaald',
    ar: '✓ عُلّمت الفاتورة كمدفوعة',
    en: '✓ Invoice marked as paid',
  },
  'ink.betaaldIn': {
    nl: 'Betaald in {quarter}',
    ar: 'دُفعت في {quarter}',
    en: 'Paid in {quarter}',
  },
  'ink.betaaldLabel': {
    nl: 'betaald',
    ar: 'مدفوع',
    en: 'paid',
  },
  'ink.betaaldOp': {
    nl: 'betaald {date}',
    ar: 'دُفعت {date}',
    en: 'paid {date}',
  },
  'ink.betaaldOpBank': {
    nl: 'Betaald op {date} — via de bank',
    ar: 'دُفعت في {date} — عبر البنك',
    en: 'Paid on {date} — via the bank',
  },
  'ink.betaaldOpContant': {
    nl: 'Betaald op {date} — contant',
    ar: 'دُفعت في {date} — نقداً',
    en: 'Paid on {date} — in cash',
  },
  'ink.betaaldOpTitel': {
    nl: 'Betaald op {date}',
    ar: 'دُفعت في {date}',
    en: 'Paid on {date}',
  },
  'ink.betaaldUitleg': {
    nl: 'De factuur wordt als betaald gemarkeerd en doorgestuurd naar je boekhouder.',
    ar: 'ستُعلَّم الفاتورة كمدفوعة وتُرسَل إلى المحاسب.',
    en: 'The invoice is marked as paid and forwarded to your accountant.',
  },
  'ink.betaalQr': {
    nl: 'Betaal-QR',
    ar: 'رمز QR للدفع',
    en: 'Payment QR',
  },
  'ink.betalingenOphalenMislukt': {
    nl: 'Betalingen ophalen mislukt — probeer opnieuw',
    ar: 'فشل جلب الدفعات — حاول مرة أخرى',
    en: 'Fetching payments failed — please try again',
  },
  'ink.betalingenTeruggedraaid': {
    nl: '{n} betalingen teruggedraaid ✓',
    ar: 'تم التراجع عن {n} دفعة ✓',
    en: '{n} payments reverted ✓',
  },
  'ink.betalingOngedaan': {
    nl: 'Betaling ongedaan gemaakt',
    ar: 'أُلغي تسجيل الدفعة',
    en: 'Payment undone',
  },
  'ink.betalingTeruggedraaid': {
    nl: 'Betaling teruggedraaid ✓',
    ar: 'تم التراجع عن الدفعة ✓',
    en: 'Payment reverted ✓',
  },
  'ink.betekentNietLeeg': {
    nl: 'Dit betekent niet dat je niets openstaan hebt — we konden het alleen niet lezen. Probeer het zo meteen opnieuw.',
    ar: 'هذا لا يعني أن لا شيء مفتوحاً لديك — تعذّرت علينا قراءته فحسب. أعد المحاولة بعد لحظات.',
    en: 'This does not mean you have nothing outstanding — we simply could not read it. Try again in a moment.',
  },
  'ink.bevestigdTeBetalen': {
    nl: 'Bevestigd · te betalen',
    ar: 'مؤكَّدة · مستحقة الدفع',
    en: 'Confirmed · to pay',
  },
  'ink.bevestigVerifieer': {
    nl: 'Bevestig / verifieer',
    ar: 'أكّد / دقّق',
    en: 'Confirm / verify',
  },
  'ink.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'ink.bezigMatchen': {
    nl: 'Bezig met matchen…',
    ar: 'جارٍ المطابقة…',
    en: 'Matching…',
  },
  'ink.bezigNarekenen': {
    nl: 'Bezig met narekenen…',
    ar: 'جارٍ إعادة الحساب…',
    en: 'Recalculating…',
  },
  'ink.bezigToevoegen': {
    nl: 'Bezig met toevoegen…',
    ar: 'جارٍ الإضافة…',
    en: 'Adding…',
  },
  'ink.bijgewerkt': {
    nl: 'Bijgewerkt',
    ar: 'حُدّث',
    en: 'Updated',
  },
  'ink.bijwerkenMislukt': {
    nl: 'Bijwerken mislukt',
    ar: 'فشل التحديث',
    en: 'Updating failed',
  },
  'ink.boekhouderVerwerkt': {
    nl: 'De boekhouder heeft inkoopfactuur {number} verwerkt. Vraag eerst om de verwerking ongedaan te maken voordat je de betaalstatus wijzigt.',
    ar: 'عالج المحاسب فاتورة المشتريات {number}. اطلب أولاً التراجع عن المعالجة قبل تغيير حالة الدفع.',
    en: 'Your accountant has processed purchase invoice {number}. First ask to undo the processing before you change the payment status.',
  },
  'ink.bonAutoGeboekt': {
    nl: 'Deze bon is automatisch als betaald geboekt ({details}).',
    ar: 'قُيّد هذا الإيصال كمدفوع تلقائياً ({details}).',
    en: 'This receipt was automatically booked as paid ({details}).',
  },
  'ink.bonAutoKlopt': {
    nl: 'Klopt het niet? Zet de betaling hieronder terug — er verandert niets aan de factuur zelf.',
    ar: 'أليس صحيحاً؟ تراجع عن الدفعة أدناه — لن يتغيّر شيء في الفاتورة نفسها.',
    en: 'Not right? Undo the payment below — nothing changes on the invoice itself.',
  },
  'ink.bonAutoStaat': {
    nl: 'Op de bon staat "{evidence}".',
    ar: 'مكتوب على الإيصال "{evidence}".',
    en: 'The receipt says "{evidence}".',
  },
  'ink.bonAutoVermeldt': {
    nl: 'De bon vermeldt de betaalwijze zelf.',
    ar: 'الإيصال يذكر طريقة الدفع بنفسه.',
    en: 'The receipt states the payment method itself.',
  },
  'ink.bron.upload': {
    nl: 'Upload',
    ar: 'رفع',
    en: 'Upload',
  },
  'ink.bronnenNietOpgehaald': {
    nl: 'We konden je {sources} niet ophalen',
    ar: 'تعذّر جلب {sources}',
    en: 'We could not fetch your {sources}',
  },
  'ink.btw': {
    nl: 'BTW',
    ar: 'btw',
    en: 'VAT',
  },
  'ink.btwPct': {
    nl: 'BTW ({rate}%)',
    ar: 'btw ({rate}%)',
    en: 'VAT ({rate}%)',
  },
  'ink.bulk.aandachtEen': {
    nl: '1 factuur heeft aandacht nodig — open hem los om te controleren',
    ar: 'فاتورة واحدة تحتاج انتباهاً — افتحها منفصلة للتحقق',
    en: '1 invoice needs attention — open it on its own to check it',
  },
  'ink.bulk.aandachtMeer': {
    nl: '{n} facturen hebben aandacht nodig — open ze los om te controleren',
    ar: '{n} فاتورة تحتاج انتباهاً — افتحها منفصلة للتحقق',
    en: '{n} invoices need attention — open them on their own to check them',
  },
  'ink.bulk.bevestigEen': {
    nl: 'Bevestig 1 factuur',
    ar: 'أكّد فاتورة واحدة',
    en: 'Confirm 1 invoice',
  },
  'ink.bulk.bevestigMeer': {
    nl: 'Bevestig {n} facturen',
    ar: 'أكّد {n} فاتورة',
    en: 'Confirm {n} invoices',
  },
  'ink.bulk.bevestigUitleg': {
    nl: 'De geselecteerde facturen worden geverifieerd en als Crediteur naar je boekhouder gestuurd. De bedragen worden overgenomen zoals uitgelezen.',
    ar: 'ستُدقَّق الفواتير المحددة وتُرسَل إلى المحاسب كدائن (Crediteur). تُعتمد المبالغ كما قُرئت.',
    en: 'The selected invoices are verified and sent to your accountant as a creditor. The amounts are taken over as read.',
  },
  'ink.bulk.bevestigVraag': {
    nl: '{n} facturen bevestigen?',
    ar: 'هل تريد تأكيد {n} فاتورة؟',
    en: 'Confirm {n} invoices?',
  },
  'ink.bulk.bevestigVraagEen': {
    nl: '1 factuur bevestigen?',
    ar: 'هل تريد تأكيد فاتورة واحدة؟',
    en: 'Confirm 1 invoice?',
  },
  'ink.bulk.deelsMislukt': {
    nl: '{ok} geverifieerd · {mislukt} mislukt',
    ar: 'دُقق {ok} · فشل {mislukt}',
    en: '{ok} verified · {mislukt} failed',
  },
  'ink.bulk.geverifieerdEen': {
    nl: '✓ 1 factuur geverifieerd',
    ar: '✓ دُققت فاتورة واحدة',
    en: '✓ 1 invoice verified',
  },
  'ink.bulk.geverifieerdMeer': {
    nl: '✓ {n} facturen geverifieerd',
    ar: '✓ عدد الفواتير المدققة: {n}',
    en: '✓ {n} invoices verified',
  },
  'ink.bulk.negeerAriaEen': {
    nl: '1 geselecteerde factuur negeren',
    ar: 'تجاهل الفاتورة المحددة',
    en: 'Ignore 1 selected invoice',
  },
  'ink.bulk.negeerAriaMeer': {
    nl: '{n} geselecteerde facturen negeren',
    ar: 'تجاهل الفواتير المحددة ({n})',
    en: 'Ignore {n} selected invoices',
  },
  'ink.bulk.negeerKnop': {
    nl: 'Negeer {n}',
    ar: 'تجاهل {n}',
    en: 'Ignore {n}',
  },
  'ink.bulk.negerenBevestig': {
    nl: 'Ja, negeer {n}',
    ar: 'نعم، تجاهل {n}',
    en: 'Yes, ignore {n}',
  },
  'ink.bulk.negerenUitleg': {
    nl: 'Ze gaan naar Genegeerd en tellen nergens meer mee. Je kunt ze daar terugzetten — of meteen hierna met één tik ongedaan maken.',
    ar: 'ستنتقل إلى المتجاهَل ولن تُحتسب في أي شيء. يمكنك إرجاعها من هناك — أو التراجع مباشرة بعدها بضغطة واحدة.',
    en: 'They go to Ignored and no longer count anywhere. You can restore them there — or undo it right after with one tap.',
  },
  'ink.bulk.negerenVraag': {
    nl: '{n} facturen negeren?',
    ar: 'هل تريد تجاهل {n} فاتورة؟',
    en: 'Ignore {n} invoices?',
  },
  'ink.bulk.negerenVraagEen': {
    nl: '1 factuur negeren?',
    ar: 'هل تريد تجاهل فاتورة واحدة؟',
    en: 'Ignore 1 invoice?',
  },
  'ink.bulk.nietMeerInWachtrij': {
    nl: 'Die facturen staan niet meer in de wachtrij — ververs de pagina',
    ar: 'تلك الفواتير لم تعد في قائمة الانتظار — حدّث الصفحة',
    en: 'Those invoices are no longer in the queue — refresh the page',
  },
  'ink.bulk.overgeslagenNote': {
    nl: '{n} met aandacht overgeslagen',
    ar: 'تُخطّي {n} بحاجة إلى انتباه',
    en: '{n} needing attention skipped',
  },
  'ink.bulk.ververs': {
    nl: 'ververs de pagina',
    ar: 'حدّث الصفحة',
    en: 'refresh the page',
  },
  'ink.bundelBetaald': {
    nl: '{n} inkoopfacturen betaald ✓',
    ar: 'دُفعت {n} فاتورة مشتريات ✓',
    en: '{n} purchase invoices paid ✓',
  },
  'ink.bundelMarkeren': {
    nl: '{n} inkoopfacturen markeren als betaald?',
    ar: 'تعليم {n} فاتورة مشتريات كمدفوعة؟',
    en: 'Mark {n} purchase invoices as paid?',
  },
  'ink.bundelMarkerenUitleg': {
    nl: 'De geselecteerde inkoopfacturen van {name} worden allemaal als betaald gemarkeerd.',
    ar: 'ستُعلَّم كل فواتير المشتريات المحددة من {name} كمدفوعة.',
    en: 'The selected purchase invoices from {name} are all marked as paid.',
  },
  // [CREDIT-VERREKEN] The same confirmation when a creditnota was deducted from the transfer.
  // "Als betaald" about a document that pays YOU reads wrong unless the sentence says what
  // happened to it — and leaving it open is how the same credit gets deducted again next month.
  'ink.bundelMarkerenCredit': {
    nl: 'De geselecteerde inkoopfacturen van {name} worden afgerond. De creditnota’s zijn met deze betaling verrekend en gaan mee dicht — anders zou je ze een tweede keer aftrekken.',
    ar: 'ستُقفل فواتير المشتريات المحددة من {name}. وقد خُصمت الإشعارات الدائنة بهذه الدفعة وتُقفل معها — وإلا لخصمتها مرة ثانية.',
    en: 'The selected purchase invoices from {name} are closed. The credit notes were deducted from this payment and close with it — otherwise you would deduct them a second time.',
  },
  'ink.bundelNietGelukt': {
    nl: '{n} betaald ✓ — niet gelukt · {reasons}',
    ar: 'دُفعت {n} ✓ — لم ينجح · {reasons}',
    en: '{n} paid ✓ — failed · {reasons}',
  },
  'ink.categoriserenMislukt': {
    nl: 'Automatisch categoriseren is niet gelukt — de rest is wel bijgewerkt.',
    ar: 'فشل التصنيف التلقائي — البقية حُدّثت.',
    en: 'Automatic categorising did not work — the rest was updated.',
  },
  'ink.creditKiesJa': {
    nl: 'Kies je “ja”, dan worden de bedragen als minbedrag opgeslagen: hij gaat van je openstaande saldo af en zijn btw wordt afgetrokken in plaats van opgeteld. Kijk op de factuur — staat er “Creditnota” of “Creditfactuur” bovenaan, of een minbedrag onderaan, dan is het er een.',
    ar: 'إن اخترت «نعم» فستُحفظ المبالغ كمبلغ سالب: تُخصم من رصيدك المفتوح وتُطرح ضريبتها بدلاً من أن تُضاف. انظر إلى الفاتورة — إن وُجد "Creditnota" أو "Creditfactuur" في الأعلى، أو مبلغ سالب في الأسفل، فهي إشعار دائن.',
    en: 'If you choose “yes”, the amounts are stored as a minus amount: it comes off your outstanding balance and its btw is deducted instead of added. Look at the invoice — if it says “Creditnota” or “Creditfactuur” at the top, or a minus amount at the bottom, it is one.',
  },
  'ink.creditKomtToe': {
    nl: 'Dit is geld dat jóu toekomt — je hoeft niets te betalen. Krijg je het teruggestort, dan herkennen we dat in je bankafschrift. Verrekent je leverancier het met een volgende factuur, dan gaat het daar vanzelf vanaf.',
    ar: 'هذا مال مستحق لك أنت — لا تحتاج لدفع شيء. إن أُعيد إلى حسابك فسنتعرّف عليه في كشفك البنكي. وإن قاصّه المورّد مع فاتورة قادمة فسيُخصم منها تلقائياً.',
    en: 'This is money owed to YOU — you do not have to pay anything. If it is refunded, we recognise that in your bank statement. If your supplier settles it against a next invoice, it comes off there by itself.',
  },
  'ink.creditnotaUitleg': {
    nl: 'Creditnota — dit bedrag gaat van je openstaande saldo af en verlaagt de btw die je terugvraagt',
    ar: 'إشعار دائن (creditnota) — هذا المبلغ يُخصم من رصيدك المفتوح ويخفّض الضريبة التي تستردها',
    en: 'Credit note — this amount comes off your outstanding balance and lowers the btw you reclaim',
  },
  'ink.creditPositief': {
    nl: 'Creditnota staat positief',
    ar: 'الإشعار الدائن مقيّد موجباً',
    en: 'Credit note stands positive',
  },
  'ink.creditPositiefUitleg': {
    nl: 'Deze creditnota staat met een POSITIEF bedrag in de boeken. Daardoor telt hij mee in \'nog te betalen\' terwijl hij eraf hoort te gaan, en wordt zijn btw opgeteld in plaats van afgetrokken.',
    ar: 'هذا الإشعار الدائن مقيّد بمبلغ موجب في الدفاتر. لذلك يُحتسب ضمن «ما زال مستحقاً» بينما يجب أن يُخصم، وتُضاف ضريبته بدلاً من أن تُطرح.',
    en: 'This credit note stands in the books with a POSITIVE amount. It therefore counts towards \'still to pay\' while it should come off, and its btw is added instead of deducted.',
  },
  'ink.creditUitlegConflict': {
    nl: 'Deze factuur staat als creditnota geboekt, maar met een POSITIEF bedrag. Daardoor telt hij mee in "nog te betalen" terwijl hij eraf hoort te gaan, en wordt zijn btw opgeteld in plaats van afgetrokken.',
    ar: 'هذه الفاتورة مقيّدة كإشعار دائن لكن بمبلغ موجب. لذلك تُحتسب ضمن «ما زال مستحقاً» بينما يجب أن تُخصم، وتُضاف ضريبتها بدلاً من أن تُطرح.',
    en: 'This invoice is booked as a credit note, but with a POSITIVE amount. It therefore counts towards "still to pay" while it should come off, and its btw is added instead of deducted.',
  },
  'ink.creditUitlegGeboekt': {
    nl: 'Dit is een creditnota: geld dat jóu toekomt. Je hoeft hem niet te betalen — hij staat met een minbedrag in de boeken en gaat vanzelf van je openstaande saldo af.',
    ar: 'هذه إشعار دائن: مال مستحق لك أنت. لا تحتاج لدفعها — فهي مقيّدة بمبلغ سالب وتُخصم تلقائياً من رصيدك المفتوح.',
    en: 'This is a credit note: money owed to YOU. You do not have to pay it — it stands in the books with a minus amount and comes off your outstanding balance by itself.',
  },
  'ink.creditUitlegLijkt': {
    nl: 'Deze factuur lijkt een creditnota — geld dat jou toekomt in plaats van geld dat je moet betalen.',
    ar: 'تبدو هذه الفاتورة إشعار دائن — مال مستحق لك لا مال عليك دفعه.',
    en: 'This invoice looks like a credit note — money owed to you instead of money you must pay.',
  },
  'ink.creditVraag': {
    nl: 'Is dit een creditnota?',
    ar: 'هل هذه إشعار دائن؟',
    en: 'Is this a credit note?',
  },
  'ink.datumEerst': {
    nl: 'Vul eerst de factuurdatum in — die bepaalt in welk kwartaal deze factuur telt',
    ar: 'املأ تاريخ الفاتورة أولاً — فهو يحدّد في أي ربع تُحتسب هذه الفاتورة',
    en: 'Fill in the invoice date first — it decides which quarter this invoice counts in',
  },
  'ink.deelbetaling': {
    nl: 'Deelbetaling: € {betaald} van € {totaal} ontvangen',
    ar: 'دفعة جزئية: وصل € {betaald} من € {totaal}',
    en: 'Partial payment: € {betaald} of € {totaal} received',
  },
  'ink.deelbetalingGewist': {
    nl: 'De genoteerde deelbetaling van {amount} op inkoopfactuur {number} wordt gewist. De factuur blijft openstaan, voor het volle bedrag.',
    ar: 'ستُمحى الدفعة الجزئية المسجَّلة بقيمة {amount} على فاتورة المشتريات {number}. تبقى الفاتورة مفتوحة بكامل المبلغ.',
    en: 'The noted instalment of {amount} on purchase invoice {number} will be erased. The invoice stays open, for the full amount.',
  },
  'ink.deelbetalingUitleg': {
    nl: 'Deelbetaling: € {paid} van € {total} betaald — tik om de rest te noteren',
    ar: 'دفعة جزئية: دُفع € {paid} من € {total} — انقر لتسجيل الباقي',
    en: 'Partial payment: € {paid} of € {total} paid — tap to note the rest',
  },
  'ink.deelGenoteerd': {
    nl: '{applied} genoteerd · nog {remaining} open',
    ar: 'سُجّل {applied} · لا يزال مفتوحاً {remaining}',
    en: '{applied} noted · {remaining} still open',
  },
  'ink.deelsBetaaldOpen': {
    nl: 'Deels betaald · € {remaining} open',
    ar: 'مدفوعة جزئياً · المتبقي € {remaining}',
    en: 'Partly paid · € {remaining} open',
  },
  'ink.deelsBijgewerkt': {
    nl: 'Deels bijgewerkt',
    ar: 'حُدّث جزئياً',
    en: 'Partly updated',
  },
  'ink.dezeLeverancier': {
    nl: 'Deze leverancier',
    ar: 'هذا المورّد',
    en: 'This supplier',
  },
  'ink.dezeLeverancierKlein': {
    nl: 'deze leverancier',
    ar: 'هذا المورّد',
    en: 'this supplier',
  },
  'ink.dubbel.foutVerbinding': {
    nl: 'De melding kon niet worden weggehaald. Probeer het opnieuw.',
    ar: 'لم يُزَل التنبيه. حاول مرة أخرى.',
    en: 'The notice was not removed. Please try again.',
  },
  'ink.dubbel.foutWeghalen': {
    nl: 'De melding kon niet worden weggehaald — probeer het opnieuw.',
    ar: 'تعذّرت إزالة التنبيه — حاول مرة أخرى.',
    en: 'The notice could not be removed — please try again.',
  },
  'ink.dubbel.genoteerd': {
    nl: 'Genoteerd — dit zijn twee verschillende facturen',
    ar: 'سُجّل — هاتان فاتورتان مختلفتان',
    en: 'Noted — these are two different invoices',
  },
  'ink.dubbel.metNr': {
    nl: 'Mogelijk dubbel met factuur {nr}.',
    ar: 'قد تكون مكررة مع الفاتورة {nr}.',
    en: 'Possibly a duplicate of invoice {nr}.',
  },
  'ink.dubbel.zonderNr': {
    nl: 'Mogelijk dubbel met de andere factuur.',
    ar: 'قد تكون مكررة مع الفاتورة الأخرى.',
    en: 'Possibly a duplicate of the other invoice.',
  },
  'ink.eenBetalingAan': {
    nl: 'Eén betaling aan {name}',
    ar: 'دفعة واحدة إلى {name}',
    en: 'One payment to {name}',
  },
  'ink.eenOverboeking': {
    nl: 'Eén overboeking van {amount} aan {name}. Scan met je bankapp of kopieer de gegevens — je betaalt in je eigen bank.',
    ar: 'تحويل واحد بقيمة {amount} إلى {name}. امسح بتطبيق بنكك أو انسخ البيانات — الدفع يتم في بنكك أنت.',
    en: 'One transfer of {amount} to {name}. Scan with your banking app or copy the details — you pay inside your own bank.',
  },
  'ink.email.echteFactuur': {
    nl: 'Staat hier een échte factuur tussen? Die bijlage halen wij niet nog een keer op. Open de e-mail van die datum en voeg de factuur zelf toe — uploaden of met een foto.',
    ar: 'هل بين هذه فاتورة حقيقية؟ نحن لا نجلب ذلك المرفق مرة أخرى. افتح رسالة ذلك التاريخ وأضف الفاتورة بنفسك — رفعاً أو بصورة.',
    en: 'Is there a real invoice among these? We do not fetch that attachment again. Open the e-mail of that date and add the invoice yourself — upload it or take a photo.',
  },
  'ink.email.nietTussen': {
    nl: 'Gebruik dan “Oudere e-mails opnieuw ophalen” hierboven.',
    ar: 'فاستخدم «أعد جلب الرسائل الأقدم» أعلاه.',
    en: 'Then use “Fetch older e-mails again” above.',
  },
  'ink.email.verbindProvider': {
    nl: 'Verbind {provider}',
    ar: 'اربط {provider}',
    en: 'Connect {provider}',
  },
  'ink.email.verwijderenBevestig': {
    nl: 'Verbinding verwijderen',
    ar: 'حذف الربط',
    en: 'Remove connection',
  },
  'ink.email.verwijderenUitleg': {
    nl: 'Nieuwe facturen komen dan niet meer automatisch binnen. Facturen die al ingelezen zijn, blijven staan.',
    ar: 'لن تصل الفواتير الجديدة تلقائياً بعد ذلك. الفواتير المقروءة مسبقاً تبقى كما هي.',
    en: 'New invoices then no longer arrive automatically. Invoices already read in stay in place.',
  },
  'ink.email.verwijderenVraag': {
    nl: 'E-mailverbinding verwijderen?',
    ar: 'هل تريد حذف ربط البريد الإلكتروني؟',
    en: 'Remove the e-mail connection?',
  },
  'ink.exclBtw': {
    nl: 'Excl. BTW',
    ar: 'بدون btw',
    en: 'Excl. VAT',
  },
  'ink.facturenBetalen': {
    nl: '{n} facturen betalen',
    ar: 'دفع {n} فاتورة',
    en: 'Pay {n} invoices',
  },
  'ink.factuurBetaald': {
    nl: 'Inkoopfactuur {number} betaald ✓',
    ar: 'دُفعت فاتورة المشتريات {number} ✓',
    en: 'Purchase invoice {number} paid ✓',
  },
  'ink.factuurNr': {
    nl: 'Factuur {number}',
    ar: 'الفاتورة {number}',
    en: 'Invoice {number}',
  },
  'ink.filter.alle': {
    nl: 'Alle',
    ar: 'الكل',
    en: 'All',
  },
  'ink.filter.automatisch': {
    nl: 'Automatisch verwerkt',
    ar: 'عولجت تلقائياً',
    en: 'Processed automatically',
  },
  'ink.filter.teBetalen': {
    nl: 'Te betalen',
    ar: 'مستحقة الدفع',
    en: 'To pay',
  },
  'ink.filter.zonderOrigineel': {
    nl: 'Zonder origineel',
    ar: 'بدون مستند أصلي',
    en: 'Without original',
  },
  'ink.fotoJa': {
    nl: 'Ja, lees de foto\'s terug',
    ar: 'نعم، أعد قراءة الصور',
    en: 'Yes, read the photos back',
  },
  'ink.fotoMax': {
    nl: 'Per keer rekenen we er maximaal 40 na. Er blijven er dan {n} over voor een volgende ronde.',
    ar: 'في كل مرة نعيد حساب 40 كحد أقصى. سيتبقى بعدها {n} لجولة قادمة.',
    en: 'Per run we recheck at most 40. That leaves {n} for a next round.',
  },
  'ink.fotoNarekenen': {
    nl: '{n} foto\'s ook narekenen?',
    ar: 'إعادة حساب {n} صورة أيضاً؟',
    en: 'Recheck {n} photos too?',
  },
  'ink.fotoNarekenenEen': {
    nl: '1 foto ook narekenen?',
    ar: 'إعادة حساب صورة واحدة أيضاً؟',
    en: 'Recheck 1 photo too?',
  },
  'ink.fotoNietsVerandert': {
    nl: 'Er verandert niets aan je facturen — wij rekenen alleen na.',
    ar: 'لن يتغيّر شيء في فواتيرك — نحن نعيد الحساب فقط.',
    en: 'Nothing changes on your invoices — we only recheck.',
  },
  'ink.fotoUitlegScan': {
    nl: 'Deze facturen zijn een foto of scan, dus er is geen tekst om in te zoeken. Wij kunnen ze wél opnieuw laten uitlezen en het bedrag daarmee vergelijken.',
    ar: 'هذه الفواتير صورة أو مسح ضوئي، فلا نص للبحث فيه. لكن يمكننا إعادة استخراجها ومقارنة المبلغ بذلك.',
    en: 'These invoices are a photo or scan, so there is no text to search in. We CAN have them read out again and compare the amount against that.',
  },
  'ink.fotoUitlegTweede': {
    nl: 'Dat is een tweede lezing van de afbeelding — iets zekerder dan niets, en niet hetzelfde als de letterlijke tekstcontrole hierboven.',
    ar: 'هذه قراءة ثانية للصورة — أوثق قليلاً من لا شيء، وليست كالفحص النصي الحرفي أعلاه.',
    en: 'That is a second reading of the image — somewhat surer than nothing, and not the same as the literal text check above.',
  },
  'ink.fout.bevestiging': {
    nl: 'Bevestiging mislukt — factuur staat nog in de wachtrij',
    ar: 'فشل التأكيد — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Confirming failed — the invoice is still in the queue',
  },
  'ink.fout.negeren': {
    nl: 'Negeren mislukt — factuur staat nog in de wachtrij',
    ar: 'فشل التجاهل — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Ignoring failed — the invoice is still in the queue',
  },
  'ink.fout.nogInWachtrij': {
    nl: 'Fout — factuur staat nog in de wachtrij',
    ar: 'خطأ — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Error — the invoice is still in the queue',
  },
  'ink.fout.opnieuw': {
    nl: 'Fout — probeer opnieuw',
    ar: 'خطأ — حاول مرة أخرى',
    en: 'Error — please try again',
  },
  'ink.fout.terugzetten': {
    nl: 'Terugzetten mislukt — probeer opnieuw',
    ar: 'فشل الإرجاع — حاول مرة أخرى',
    en: 'Restoring failed — please try again',
  },
  'ink.fout.verificatie': {
    nl: 'Verificatie mislukt — factuur staat nog in de wachtrij',
    ar: 'فشل التدقيق — الفاتورة ما تزال في قائمة الانتظار',
    en: 'Verification failed — the invoice is still in the queue',
  },
  'ink.gecategoriseerd': {
    nl: '{n} banktransactie(s) automatisch gecategoriseerd — controleer ze op de Bank-pagina.',
    ar: 'صُنّفت {n} حركة بنكية تلقائياً — راجعها في صفحة البنك.',
    en: '{n} bank transaction(s) categorised automatically — check them on the Bank page.',
  },
  'ink.geenBedragOpFactuur': {
    nl: 'Op deze factuur staat geen bedrag, dus er valt niets af te boeken. Vul eerst het factuurbedrag in — dan kun je hem als betaald markeren.',
    ar: 'لا مبلغ على هذه الفاتورة، فلا شيء لتسويته. أدخل مبلغ الفاتورة أولاً — بعدها يمكنك تعليمها كمدفوعة.',
    en: 'This invoice carries no amount, so there is nothing to settle. Fill in the invoice amount first — then you can mark it as paid.',
  },
  'ink.geenBedragVastgelegd': {
    nl: 'Van deze betaling is geen bedrag vastgelegd, dus verplaatsen kan niet. Draai hem terug en boek hem opnieuw op de juiste factuur.',
    ar: 'لم يُسجَّل لهذه الدفعة مبلغ، فلا يمكن نقلها. تراجع عنها ثم قيّدها من جديد على الفاتورة الصحيحة.',
    en: 'No amount was recorded for this payment, so it cannot be moved. Revert it and book it again on the right invoice.',
  },
  'ink.geenDatum': {
    nl: '{n} facturen hebben geen factuurdatum en vallen buiten deze periode.',
    ar: '{n} فاتورة بلا تاريخ فاتورة وتقع خارج هذه الفترة.',
    en: '{n} invoices have no invoice date and fall outside this period.',
  },
  'ink.geenDatumEen': {
    nl: '1 factuur heeft geen factuurdatum en valt buiten deze periode.',
    ar: 'فاتورة واحدة بلا تاريخ فاتورة وتقع خارج هذه الفترة.',
    en: '1 invoice has no invoice date and falls outside this period.',
  },
  'ink.geenGevondenVoor': {
    nl: 'Geen facturen gevonden voor “{query}”.',
    ar: 'لم يُعثر على فواتير لـ«{query}».',
    en: 'No invoices found for “{query}”.',
  },
  'ink.geenIban': {
    nl: 'Geen geldig IBAN gevonden op deze factuur. Open de PDF om het rekeningnummer te bekijken en betaal handmatig in je bankapp.',
    ar: 'لم يُعثر على IBAN صالح في هذه الفاتورة. افتح ملف PDF لرؤية رقم الحساب وادفع يدوياً في تطبيق بنكك.',
    en: 'No valid IBAN found on this invoice. Open the PDF to see the account number and pay manually in your banking app.',
  },
  'ink.geenInPeriode': {
    nl: 'Geen inkoopfacturen in {period}',
    ar: 'لا فواتير مشتريات في {period}',
    en: 'No purchase invoices in {period}',
  },
  'ink.geenNieuweBetalingen': {
    nl: 'Geen nieuwe betalingen herkend in je bankafschrift.',
    ar: 'لم يُتعرَّف على دفعات جديدة في كشفك البنكي.',
    en: 'No new payments recognised in your bank statement.',
  },
  'ink.geenNummer': {
    nl: '(geen nummer)',
    ar: '(بلا رقم)',
    en: '(no number)',
  },
  'ink.geenOpenTransacties': {
    nl: 'Geen open banktransacties om tegen te matchen.',
    ar: 'لا حركات بنكية مفتوحة للمطابقة معها.',
    en: 'No open bank transactions to match against.',
  },
  'ink.geenOrigineel': {
    nl: '{n} facturen hebben geen origineel document, dus daar viel niets naast te leggen. Voeg het origineel toe via de factuur zelf.',
    ar: '{n} فاتورة بلا مستند أصلي، فلم يكن ثمة ما يُقارن به. أضف الأصل من الفاتورة نفسها.',
    en: '{n} invoices have no original document, so there was nothing to compare against. Add the original via the invoice itself.',
  },
  'ink.geenOrigineelEen': {
    nl: '1 factuur heeft geen origineel document, dus daar viel niets naast te leggen. Voeg het origineel toe via de factuur zelf.',
    ar: 'فاتورة واحدة بلا مستند أصلي، فلم يكن ثمة ما يُقارن به. أضف الأصل من الفاتورة نفسها.',
    en: '1 invoice has no original document, so there was nothing to compare against. Add the original via the invoice itself.',
  },
  'ink.geenPassendeFactuur': {
    nl: 'Geen factuur gevonden waar dit bedrag op past. Een factuur kan alleen een betaling ontvangen als hij gecontroleerd is, van dezelfde soort is, en er minstens {amount} op open staat.',
    ar: 'لم يُعثر على فاتورة يناسبها هذا المبلغ. لا تستقبل الفاتورة دفعة إلا إذا كانت مدققة ومن النوع نفسه ومفتوحاً عليها {amount} على الأقل.',
    en: 'No invoice was found this amount fits on. An invoice can only receive a payment if it is verified, of the same kind, and has at least {amount} still open.',
  },
  'ink.geenQr': {
    nl: 'Geen QR mogelijk',
    ar: 'تعذّر إنشاء رمز QR',
    en: 'No QR possible',
  },
  'ink.geenVerbinding': {
    nl: 'geen verbinding',
    ar: 'لا يوجد اتصال',
    en: 'no connection',
  },
  'ink.geenVervaldatum': {
    nl: 'geen vervaldatum',
    ar: 'لا تاريخ استحقاق',
    en: 'no due date',
  },
  'ink.gekopieerd': {
    nl: '{what} gekopieerd ✓',
    ar: 'نُسخ {what} ✓',
    en: '{what} copied ✓',
  },
  'ink.gekoppeld': {
    nl: '{facturen} gekoppeld',
    ar: 'رُبطت {facturen}',
    en: '{facturen} linked',
  },
  'ink.gekoppeld.autoEen': {
    nl: '1 betaling automatisch gekoppeld.',
    ar: 'رُبط دفع واحد تلقائياً.',
    en: '1 payment linked automatically.',
  },
  'ink.gekoppeld.autoMeer': {
    nl: '{n} betalingen automatisch gekoppeld.',
    ar: 'عدد الدفعات المربوطة تلقائياً: {n}.',
    en: '{n} payments linked automatically.',
  },
  'ink.gekoppeld.een': {
    nl: '1 betaling gekoppeld',
    ar: 'رُبط دفع واحد',
    en: '1 payment linked',
  },
  'ink.gekoppeld.meer': {
    nl: '{n} betalingen gekoppeld',
    ar: 'عدد الدفعات المربوطة: {n}',
    en: '{n} payments linked',
  },
  'ink.genegeerdToast': {
    nl: 'Factuur genegeerd',
    ar: 'تم تجاهل الفاتورة',
    en: 'Invoice ignored',
  },
  'ink.geselecteerd': {
    nl: '{n} geselecteerd · {amount}',
    ar: 'المحدد: {n} · {amount}',
    en: '{n} selected · {amount}',
  },
  'ink.geverifieerd': {
    nl: '✓ Factuur geverifieerd',
    ar: '✓ دُققت الفاتورة',
    en: '✓ Invoice verified',
  },
  'ink.geverifieerd.metKoppelingEen': {
    nl: '✓ Geverifieerd · 1 betaling automatisch gekoppeld',
    ar: '✓ دُققت · رُبط دفع واحد تلقائياً',
    en: '✓ Verified · 1 payment linked automatically',
  },
  'ink.geverifieerd.metKoppelingMeer': {
    nl: '✓ Geverifieerd · {n} betalingen automatisch gekoppeld',
    ar: '✓ دُققت · عدد الدفعات المربوطة تلقائياً: {n}',
    en: '✓ Verified · {n} payments linked automatically',
  },
  'ink.gevonden': {
    nl: '{facturen} gevonden',
    ar: 'وُجدت {facturen}',
    en: '{facturen} found',
  },
  'ink.herkendBetaald': {
    nl: '{facturen} herkend in je bankafschrift en op betaald gezet.',
    ar: 'تم التعرّف على {facturen} في كشفك البنكي ووُضعت كمدفوعة.',
    en: '{facturen} recognised in your bank statement and set to paid.',
  },
  'ink.herlees.geenFactuur': {
    nl: 'Dit lijkt geen boekbare factuur',
    ar: 'لا يبدو هذا فاتورة قابلة للتسجيل',
    en: 'This does not look like a bookable invoice',
  },
  'ink.herlees.geenGegevens': {
    nl: 'Bij het opnieuw inlezen vonden we geen factuurgegevens',
    ar: 'عند إعادة القراءة لم نعثر على بيانات فاتورة',
    en: 'On re-reading we found no invoice data',
  },
  'ink.herlees.mislukt': {
    nl: 'Opnieuw inlezen is niet gelukt — probeer het later opnieuw.',
    ar: 'لم تنجح إعادة القراءة — حاول لاحقاً.',
    en: 'Re-reading did not work — try again later.',
  },
  'ink.herlees.naarGenegeerd': {
    nl: 'Hij staat nu bij Genegeerd, met reden “Geen factuur”.\n\nKlopt dat niet? Zet hem daar met één tik terug.',
    ar: 'إنه الآن في المتجاهَل بسبب «ليست فاتورة».\n\nأليس ذلك صحيحاً؟ أرجعه من هناك بضغطة واحدة.',
    en: 'It is now under Ignored, with reason “Not an invoice”.\n\nNot right? Put it back there with one tap.',
  },
  'ink.herlees.nietGewijzigd': {
    nl: 'De opgeslagen gegevens zijn niet gewijzigd — je kunt hem zelf negeren.',
    ar: 'لم تتغيّر البيانات المحفوظة — يمكنك تجاهله بنفسك.',
    en: 'The stored data was not changed — you can ignore it yourself.',
  },
  'ink.herleesAlles.gestopt': {
    nl: 'Opnieuw inlezen gestopt',
    ar: 'توقفت إعادة القراءة',
    en: 'Re-reading stopped',
  },
  'ink.herleesAlles.ingelezen': {
    nl: '{n} opnieuw ingelezen',
    ar: 'أُعيدت قراءة {n}',
    en: '{n} re-read',
  },
  'ink.herleesAlles.klaar': {
    nl: 'Opnieuw inlezen klaar',
    ar: 'انتهت إعادة القراءة',
    en: 'Re-reading done',
  },
  'ink.herleesAlles.knop': {
    nl: '↻ Alles met aandacht opnieuw inlezen ({n})',
    ar: '↻ إعادة قراءة كل ما يحتاج انتباهاً ({n})',
    en: '↻ Re-read everything needing attention ({n})',
  },
  'ink.herleesAlles.modelWeg': {
    nl: 'Het leesmodel is niet beschikbaar op dit account.',
    ar: 'نموذج القراءة غير متاح على هذا الحساب.',
    en: 'The reading model is not available on this account.',
  },
  'ink.herleesAlles.nietGelukt': {
    nl: '{n} niet gelukt — probeer die later los opnieuw',
    ar: 'فشل {n} — حاول معها لاحقاً كلاً على حدة',
    en: '{n} failed — retry those separately later',
  },
  'ink.herleesAlles.nietGeprobeerd': {
    nl: '{n} niet geprobeerd — ze staan onveranderd in de wachtrij',
    ar: 'لم تُجرَّب {n} — ما تزال في قائمة الانتظار دون تغيير',
    en: '{n} not attempted — they sit unchanged in the queue',
  },
  'ink.herleesAlles.nietWeggezet': {
    nl: '{n} bleek geen boekbare factuur, maar kon niet worden weggezet — bekijk die zelf',
    ar: 'تبيّن أن {n} ليست فاتورة قابلة للتسجيل لكن تعذّر نقلها — راجعها بنفسك',
    en: '{n} turned out not to be a bookable invoice but could not be put away — look at those yourself',
  },
  'ink.herleesAlles.overgeslagen': {
    nl: '{n} overgeslagen (al bevestigd)',
    ar: 'تُخطّي {n} (مؤكَّدة مسبقاً)',
    en: '{n} skipped (already confirmed)',
  },
  'ink.herleesAlles.uitleg': {
    nl: 'Elke gemarkeerde factuur wordt opnieuw gelezen. Dat kan even duren — je kunt ondertussen niets anders doen op dit scherm.',
    ar: 'ستُعاد قراءة كل فاتورة معلَّمة. قد يستغرق ذلك وقتاً — لا يمكنك فعل شيء آخر على هذه الشاشة أثناء ذلك.',
    en: 'Every flagged invoice is read again. That can take a while — you cannot do anything else on this screen meanwhile.',
  },
  'ink.herleesAlles.voortgang': {
    nl: 'Opnieuw inlezen… ({n}/{totaal})',
    ar: 'جارٍ إعادة القراءة… ({n}/{totaal})',
    en: 'Re-reading… ({n}/{totaal})',
  },
  'ink.herleesAlles.vraag': {
    nl: '{n} facturen opnieuw inlezen?',
    ar: 'هل تريد إعادة قراءة {n} فاتورة؟',
    en: 'Re-read {n} invoices?',
  },
  'ink.herleesAlles.weggezet': {
    nl: '{n} bleek geen boekbare factuur — verplaatst naar Genegeerd (reden: geen factuur)',
    ar: 'تبيّن أن {n} ليست فاتورة قابلة للتسجيل — نُقلت إلى المتجاهَل (السبب: ليست فاتورة)',
    en: '{n} turned out not to be a bookable invoice — moved to Ignored (reason: not an invoice)',
  },
  'ink.herleesKnop': {
    nl: 'Opnieuw inlezen',
    ar: 'إعادة القراءة',
    en: 'Read again',
  },
  'ink.incassoAanUitlegKort': {
    nl: 'Facturen van deze leverancier krijgen geen betaalknop meer en worden na de vervaldatum vanzelf op betaald gezet.',
    ar: 'لن يكون لفواتير هذا المورّد زر دفع بعد الآن، وستوضع كمدفوعة تلقائياً بعد تاريخ الاستحقاق.',
    en: 'Invoices from this supplier no longer get a pay button and are set to paid by themselves after the due date.',
  },
  'ink.incassoAanVraag': {
    nl: '{name} zelf laten afschrijven?',
    ar: 'السماح لـ{name} بالخصم بنفسه؟',
    en: 'Let {name} collect by itself?',
  },
  'ink.incassoBlijftStaan': {
    nl: 'Wat al op betaald staat, blijft staan — dit draait niets terug.',
    ar: 'ما هو مدفوع يبقى كما هو — هذا لا يتراجع عن شيء.',
    en: 'Whatever is already set to paid stays put — this reverts nothing.',
  },
  'ink.incassoGeenKnop': {
    nl: 'Facturen van deze leverancier krijgen geen betaalknop meer — je zou anders betalen wat de bank al heeft afgeschreven.',
    ar: 'لن يكون لفواتير هذا المورّد زر دفع بعد الآن — وإلا لدفعت ما خصمه البنك بالفعل.',
    en: 'Invoices from this supplier no longer get a pay button — otherwise you would pay what the bank has already collected.',
  },
  'ink.incassoMeteenBetaald': {
    nl: 'Wat de bank al heeft geïncasseerd zetten we meteen op betaald.',
    ar: 'ما خصمه البنك بالفعل نضعه كمدفوع فوراً.',
    en: 'What the bank has already collected we set to paid immediately.',
  },
  'ink.incassoMeteenBetaaldOpen': {
    nl: 'Wat de bank al heeft geïncasseerd zetten we meteen op betaald. Nu staan er {n} facturen van {name} open, samen {amount} — daarvan gaat op betaald wat we in je bankafschrift terugvinden.',
    ar: 'ما خصمه البنك بالفعل نضعه كمدفوع فوراً. حالياً لدى {name} فواتير مفتوحة عددها {n} ومجموعها {amount} — يوضع منها كمدفوع ما نجده في كشفك البنكي.',
    en: 'What the bank has already collected we set to paid immediately. Right now {n} invoices from {name} are open, {amount} together — of those, what we find back in your bank statement is set to paid.',
  },
  'ink.incassoOverzicht': {
    nl: 'Je krijgt daarna een overzicht van precies welke facturen zijn verwerkt en welke niet.',
    ar: 'ستحصل بعدها على ملخص يبيّن بالضبط أي الفواتير عولجت وأيها لم تُعالج.',
    en: 'You then get an overview of exactly which invoices were processed and which were not.',
  },
  'ink.incassoResultAan': {
    nl: 'Je krijgt geen betaalknop meer bij deze leverancier. Nieuwe facturen zetten we na de vervaldatum vanzelf op betaald.',
    ar: 'لن ترى زر دفع لدى هذا المورّد بعد الآن. الفواتير الجديدة نضعها كمدفوعة تلقائياً بعد تاريخ الاستحقاق.',
    en: 'You no longer get a pay button for this supplier. New invoices are set to paid by themselves after the due date.',
  },
  'ink.incassoResultUit': {
    nl: 'Facturen van deze leverancier krijgen weer een betaalknop. Wat al op betaald staat, blijft staan.',
    ar: 'ستعود لفواتير هذا المورّد أزرار الدفع. ما هو مدفوع يبقى كما هو.',
    en: 'Invoices from this supplier get a pay button again. Whatever is already set to paid stays put.',
  },
  'ink.incassoUit': {
    nl: '{name} staat niet meer op automatische incasso',
    ar: '{name} لم يعد على الخصم التلقائي',
    en: '{name} is no longer on direct debit',
  },
  'ink.incassoUitVraag': {
    nl: 'Automatische incasso uitzetten voor {name}?',
    ar: 'إيقاف الخصم التلقائي لـ{name}؟',
    en: 'Turn off direct debit for {name}?',
  },
  'ink.incassoWaarschuwing': {
    nl: 'Facturen die je bank zelf afschrijft staan hieronder daarom gewoon als "te betalen". Betaal ze niet nog een keer.',
    ar: 'لذلك تظهر أدناه الفواتير التي يخصمها بنكك بنفسه كأنها "te betalen". لا تدفعها مرة ثانية.',
    en: 'Invoices your bank collects itself therefore simply stand below as "te betalen". Do not pay them a second time.',
  },
  'ink.incassoWeerKnop': {
    nl: 'Facturen van {name} krijgen weer een betaalknop.',
    ar: 'ستعود لفواتير {name} أزرار الدفع.',
    en: 'Invoices from {name} get a pay button again.',
  },
  'ink.incassoZetAan': {
    nl: 'Zet dit aan als het geld bij deze leverancier vanzelf van je rekening gaat — huur, energie, verzekering. Je hoeft ze dan niet meer zelf af te vinken.',
    ar: 'فعّل هذا إذا كان المال يُخصم من حسابك تلقائياً لدى هذا المورّد — الإيجار، الطاقة، التأمين. لن تحتاج بعدها لتعليمها بنفسك.',
    en: 'Turn this on if money for this supplier leaves your account by itself — rent, energy, insurance. You then no longer have to tick them off yourself.',
  },
  'ink.inclBtw': {
    nl: 'Incl. BTW',
    ar: 'شامل btw',
    en: 'Incl. VAT',
  },
  'ink.inPeriode': {
    nl: '{facturen} in {period}',
    ar: '{facturen} في {period}',
    en: '{facturen} in {period}',
  },
  'ink.instellenMislukt': {
    nl: 'Instellen mislukt — er is niets gewijzigd',
    ar: 'فشل الضبط — لم يتغيّر شيء',
    en: 'Setting up failed — nothing was changed',
  },
  'ink.jaBoekCredit': {
    nl: 'Ja, boek als creditnota',
    ar: 'نعم، قيّدها كإشعار دائن',
    en: 'Yes, book as a credit note',
  },
  'ink.jaDraaiTerug': {
    nl: 'Ja, draai terug',
    ar: 'نعم، تراجع',
    en: 'Yes, revert',
  },
  'ink.jaMarkeerBetaald': {
    nl: 'Ja, markeer als betaald',
    ar: 'نعم، علّمها كمدفوعة',
    en: 'Yes, mark as paid',
  },
  'ink.jaZetAan': {
    nl: 'Ja, zet aan',
    ar: 'نعم، فعّله',
    en: 'Yes, turn on',
  },
  'ink.jaZetUit': {
    nl: 'Ja, zet uit',
    ar: 'نعم، أوقفه',
    en: 'Yes, turn off',
  },
  'ink.kasBijgewerkt': {
    nl: '{n} bijgewerkt',
    ar: 'حُدّث: {n}',
    en: '{n} updated',
  },
  'ink.kasInBalans': {
    nl: 'Kasboek was al in balans met je contant betaalde facturen.',
    ar: 'كان دفتر الصندوق متوازناً بالفعل مع فواتيرك المدفوعة نقداً.',
    en: 'The cash book was already in balance with your cash-paid invoices.',
  },
  'ink.kasMislukt': {
    nl: 'Het kasboek kon niet worden bijgewerkt — probeer het straks opnieuw.',
    ar: 'تعذّر تحديث دفتر الصندوق — حاول بعد قليل.',
    en: 'The cash book could not be updated — try again in a while.',
  },
  'ink.kasregelVervalt': {
    nl: 'De kasboekregel voor deze betaling vervalt daarmee ook.',
    ar: 'وبذلك يُلغى أيضاً قيد دفتر الصندوق لهذه الدفعة.',
    en: 'The cash-book entry for this payment is removed with it.',
  },
  'ink.kasTeruggedraaid': {
    nl: '{n} teruggedraaid',
    ar: 'تم التراجع عن: {n}',
    en: '{n} reversed',
  },
  'ink.kasToegevoegd': {
    nl: '{n} kasboeking toegevoegd',
    ar: 'قيود صندوق أُضيفت: {n}',
    en: '{n} cash entries added',
  },
  'ink.kiesBetaalde': {
    nl: 'Kies betaalde facturen om terug te draaien',
    ar: 'اختر فواتير مدفوعة للتراجع عنها',
    en: 'Choose paid invoices to revert',
  },
  'ink.kiesMinimaal': {
    nl: 'Kies minimaal 2 open inkoopfacturen',
    ar: 'اختر فاتورتي مشتريات مفتوحتين على الأقل',
    en: 'Choose at least 2 open purchase invoices',
  },
  'ink.kloptEentjeNiet': {
    nl: 'Klopt er eentje niet? Open hem en tik op "Betaald" om hem terug te zetten.',
    ar: 'أواحدة منها غير صحيحة؟ افتحها وانقر "Betaald" لإعادتها.',
    en: 'Is one of them wrong? Open it and tap "Betaald" to put it back.',
  },
  'ink.komenTerug': {
    nl: 'Deze facturen komen terug op "Te betalen"',
    ar: 'ستعود هذه الفواتير إلى "Te betalen"',
    en: 'These invoices return to "Te betalen"',
  },
  'ink.kop.aandachtEen': {
    nl: '1 factuur heeft je aandacht nodig',
    ar: 'فاتورة واحدة تحتاج انتباهك',
    en: '1 invoice needs your attention',
  },
  'ink.kop.aandachtMeer': {
    nl: '{n} facturen hebben je aandacht nodig',
    ar: '{n} فاتورة تحتاج انتباهك',
    en: '{n} invoices need your attention',
  },
  'ink.kop.klaarEen': {
    nl: '1 factuur klaar om te bevestigen',
    ar: 'فاتورة واحدة جاهزة للتأكيد',
    en: '1 invoice ready to confirm',
  },
  'ink.kop.klaarMeer': {
    nl: '{n} facturen klaar om te bevestigen',
    ar: '{n} فاتورة جاهزة للتأكيد',
    en: '{n} invoices ready to confirm',
  },
  'ink.kop.klaarNote': {
    nl: '{n} klaar om te bevestigen',
    ar: 'الجاهز للتأكيد: {n}',
    en: '{n} ready to confirm',
  },
  'ink.kopieerLabel': {
    nl: 'Kopieer {label}',
    ar: 'نسخ {label}',
    en: 'Copy {label}',
  },
  'ink.kost.allebei': {
    nl: 'Allebei',
    ar: 'كلاهما',
    en: 'Both',
  },
  'ink.kost.allebei.hint': {
    nl: 'Dient je belaste én je vrijgestelde werk (huur, energie, boekhouder) — de BTW wordt naar verhouding afgetrokken.',
    ar: 'يخدم عملك الخاضع للضريبة وعملك المعفى معاً (الإيجار، الطاقة، المحاسب) — تُخصم الضريبة بالتناسب.',
    en: 'Serves both your taxed and your exempt work (rent, energy, accountant) — the VAT is deducted proportionally.',
  },
  'ink.kost.belast': {
    nl: 'Belast werk',
    ar: 'عمل خاضع للضريبة',
    en: 'Taxed work',
  },
  'ink.kost.belast.hint': {
    nl: 'Alleen voor je BTW-belaste werk — de BTW is volledig aftrekbaar.',
    ar: 'لعملك الخاضع للضريبة فقط — الضريبة قابلة للخصم بالكامل.',
    en: 'Only for your VAT-taxed work — the VAT is fully deductible.',
  },
  'ink.kost.toast.allebei': {
    nl: 'Toegewezen aan allebei — BTW naar verhouding ✓',
    ar: 'خُصّصت لكليهما — الضريبة بالتناسب ✓',
    en: 'Assigned to both — VAT proportionally ✓',
  },
  'ink.kost.toast.belast': {
    nl: 'Toegewezen aan belast werk — BTW volledig aftrekbaar ✓',
    ar: 'خُصّصت للعمل الخاضع للضريبة — الضريبة قابلة للخصم بالكامل ✓',
    en: 'Assigned to taxed work — VAT fully deductible ✓',
  },
  'ink.kost.toast.vrijgesteld': {
    nl: 'Toegewezen aan vrijgesteld werk — geen aftrek ✓',
    ar: 'خُصّصت للعمل المعفى — لا خصم ✓',
    en: 'Assigned to exempt work — no deduction ✓',
  },
  'ink.kost.vrijgesteld': {
    nl: 'Vrijgesteld werk',
    ar: 'عمل معفى',
    en: 'Exempt work',
  },
  'ink.kost.vrijgesteld.hint': {
    nl: 'Alleen voor je vrijgestelde werk — hierop bestaat geen recht op aftrek.',
    ar: 'لعملك المعفى فقط — لا حق في الخصم هنا.',
    en: 'Only for your exempt work — there is no right to deduct here.',
  },
  'ink.kwartaalOnbekend': {
    nl: 'we konden niet nagaan of dit kwartaal al is ingediend',
    ar: 'تعذّر التحقق مما إذا كان هذا الربع قد قُدّم بالفعل',
    en: 'we could not check whether this quarter has already been filed',
  },
  'ink.leegLaten': {
    nl: 'Leeg laten = alles betaald ({amount})',
    ar: 'اتركه فارغاً = دفع الكل ({amount})',
    en: 'Leave empty = everything paid ({amount})',
  },
  'ink.leegtab.confirmed': {
    nl: 'Nog niets bevestigd',
    ar: 'لم يؤكَّد شيء بعد',
    en: 'Nothing confirmed yet',
  },
  'ink.leegtab.confirmedSub': {
    nl: 'Facturen die je verifieert of markeert als betaald verschijnen hier.',
    ar: 'الفواتير التي تدقّقها أو تعلّمها كمدفوعة تظهر هنا.',
    en: 'Invoices you verify or mark as paid appear here.',
  },
  'ink.leegtab.ignored': {
    nl: 'Geen genegeerde facturen',
    ar: 'لا فواتير متجاهَلة',
    en: 'No ignored invoices',
  },
  'ink.leegtab.ignoredSub': {
    nl: 'Facturen die je negeert komen hier terecht.',
    ar: 'الفواتير التي تتجاهلها تصل إلى هنا.',
    en: 'Invoices you ignore end up here.',
  },
  'ink.leegtab.pending': {
    nl: 'Alles bijgewerkt',
    ar: 'كل شيء محدَّث',
    en: 'Everything up to date',
  },
  'ink.leegtab.pendingSub': {
    nl: 'Nieuwe facturen verschijnen hier zodra ze binnenkomen.',
    ar: 'تظهر الفواتير الجديدة هنا حين تصل.',
    en: 'New invoices appear here as they arrive.',
  },
  'ink.lijktCreditnota': {
    nl: 'Lijkt een creditnota',
    ar: 'تبدو إشعار دائن',
    en: 'Looks like a credit note',
  },
  'ink.lijstNietCompleet': {
    nl: 'Deze lijst is daardoor niet compleet — ga er niet van uit dat wat je hier ziet alles is.',
    ar: 'لذلك هذه القائمة غير كاملة — لا تفترض أن ما تراه هنا هو كل شيء.',
    en: 'This list is therefore not complete — do not assume that what you see here is everything.',
  },
  'ink.markeerBetaaldVraag': {
    nl: 'Inkoopfactuur markeren als betaald?',
    ar: 'تعليم فاتورة المشتريات كمدفوعة؟',
    en: 'Mark purchase invoice as paid?',
  },
  'ink.matchenMetBank': {
    nl: 'Matchen met bank & kas',
    ar: 'مطابقة مع البنك والصندوق',
    en: 'Match with bank & cash',
  },
  'ink.matchenUitleg': {
    nl: 'Koppelt je inkoopfacturen aan het bankafschrift en aan de kas, en werkt alles bij wat zeker is',
    ar: 'يربط فواتير مشترياتك بكشف الحساب البنكي وبالصندوق، ويحدّث كل ما هو مؤكد',
    en: 'Links your purchase invoices to the bank statement and the cash book, and updates everything that is certain',
  },
  'ink.meerdereBetalen': {
    nl: 'Meerdere betalen',
    ar: 'دفع عدة فواتير',
    en: 'Pay several',
  },
  'ink.methodeContant': {
    nl: 'contant',
    ar: 'نقداً',
    en: 'in cash',
  },
  'ink.methodePas': {
    nl: 'met de pas',
    ar: 'بالبطاقة',
    en: 'by card',
  },
  'ink.mogelijkBetaaldUitleg': {
    nl: 'Je hebt mogelijk al een factuur van dezelfde leverancier voor hetzelfde bedrag betaald:',
    ar: 'ربما دفعت بالفعل فاتورة من المورّد نفسه وبالمبلغ نفسه:',
    en: 'You may already have paid an invoice from the same supplier for the same amount:',
  },
  'ink.mp.alleenFotos': {
    nl: 'Kies foto\'s of afbeeldingen — de pagina\'s van de factuur.',
    ar: 'اختر صوراً — صفحات الفاتورة.',
    en: 'Pick photos or images — the pages of the invoice.',
  },
  'ink.mp.combineerEen': {
    nl: 'Combineer 1 pagina → één factuur',
    ar: 'ادمج صفحة واحدة ← فاتورة واحدة',
    en: 'Combine 1 page → one invoice',
  },
  'ink.mp.combineerMeer': {
    nl: 'Combineer {n} pagina\'s → één factuur',
    ar: 'ادمج {n} صفحة ← فاتورة واحدة',
    en: 'Combine {n} pages → one invoice',
  },
  'ink.mp.combinerenMislukt': {
    nl: 'Combineren mislukt. Maak duidelijkere foto\'s, of voeg de pagina\'s los toe.',
    ar: 'فشل الدمج. التقط صوراً أوضح، أو أضف الصفحات منفصلة.',
    en: 'Combining failed. Take clearer photos, or add the pages separately.',
  },
  'ink.mp.fotograferen': {
    nl: '📷 Pagina fotograferen',
    ar: '📷 تصوير صفحة',
    en: '📷 Photograph a page',
  },
  'ink.mp.kiezen': {
    nl: '🖼️ Pagina’s kiezen',
    ar: '🖼️ اختيار صفحات',
    en: '🖼️ Pick pages',
  },
  'ink.mp.let': {
    nl: 'Let op: één PDF = één factuur (alle pagina’s samen). Zitten er meerdere verschillende facturen in één PDF? Splits ze niet — voeg elke factuur los toe.',
    ar: 'انتبه: ملف PDF واحد = فاتورة واحدة (كل الصفحات معاً). هل في ملف PDF واحد عدة فواتير مختلفة؟ لا تقسّمه — أضف كل فاتورة منفصلة.',
    en: 'Note: one PDF = one invoice (all pages together). Several different invoices in one PDF? Do not split it — add each invoice separately.',
  },
  'ink.mp.maxPaginas': {
    nl: 'Maximaal {max} pagina\'s per factuur.',
    ar: 'الحد الأقصى للصفحات لكل فاتورة: {max}.',
    en: 'A maximum of {max} pages per invoice.',
  },
  'ink.mp.pagina': {
    nl: 'Pagina {n}',
    ar: 'الصفحة {n}',
    en: 'Page {n}',
  },
  'ink.mp.paginasBewaard': {
    nl: 'De andere pagina\'s blijven bewaard.',
    ar: 'الصفحات الأخرى تبقى محفوظة.',
    en: 'The other pages stay kept.',
  },
  'ink.mp.uitleg': {
    nl: 'Fotografeer of kies elke pagina van dezelfde factuur. We voegen ze samen tot één factuur — geen losse facturen. (Voor verschillende facturen: voeg ze los toe.)',
    ar: 'صوّر أو اختر كل صفحة من الفاتورة نفسها. سندمجها في فاتورة واحدة — لا فواتير منفصلة. (للفواتير المختلفة: أضفها منفصلة.)',
    en: 'Photograph or pick every page of the same invoice. We combine them into one invoice — not separate invoices. (For different invoices: add them separately.)',
  },
  'ink.mp.voegEerstToe': {
    nl: 'Voeg eerst pagina\'s toe',
    ar: 'أضف صفحات أولاً',
    en: 'Add pages first',
  },
  'ink.multi.bevestig': {
    nl: 'Ja, dit is één factuur',
    ar: 'نعم، هذه فاتورة واحدة',
    en: 'Yes, this is one invoice',
  },
  'ink.multi.foutVerbinding': {
    nl: 'De waarschuwing is niet weggehaald. Controleer je verbinding en probeer het opnieuw.',
    ar: 'لم يُزَل التحذير. تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'The warning was not removed. Check your connection and try again.',
  },
  'ink.multi.foutWeghalen': {
    nl: 'De waarschuwing kon niet worden weggehaald — ververs de pagina en probeer het opnieuw.',
    ar: 'تعذّرت إزالة التحذير — حدّث الصفحة وحاول مرة أخرى.',
    en: 'The warning could not be removed — refresh the page and try again.',
  },
  'ink.multi.genoteerd': {
    nl: 'Genoteerd — deze factuur wordt verder op zichzelf beoordeeld',
    ar: 'سُجّل — ستُقيَّم هذه الفاتورة بذاتها من الآن',
    en: 'Noted — this invoice is now judged on its own',
  },
  'ink.multi.nee': {
    nl: 'Nee, dit is één factuur',
    ar: 'لا، هذه فاتورة واحدة',
    en: 'No, this is one invoice',
  },
  'ink.multi.uitleg': {
    nl: 'We konden niet uitsluiten dat er meer facturen in dit bestand zitten. Zeg je dat het er één is, dan halen we die waarschuwing weg en beoordelen we deze factuur verder op zichzelf.\n\nAndere waarschuwingen op deze factuur blijven staan. Zit er tóch een tweede factuur in, voeg die dan los toe — hij staat nu nergens in je boekhouding.',
    ar: 'لم نستطع استبعاد وجود أكثر من فاتورة في هذا الملف. إن قلت إنها واحدة، نزيل ذلك التحذير ونقيّم هذه الفاتورة بذاتها.\n\nالتحذيرات الأخرى على هذه الفاتورة تبقى. وإن كانت فيه فاتورة ثانية فعلاً، أضفها منفصلة — فهي غير موجودة في دفاترك الآن.',
    en: 'We could not rule out that this file holds more invoices. If you say it is one, we remove that warning and judge this invoice on its own.\n\nOther warnings on this invoice remain. If there is a second invoice in it after all, add it separately — it is nowhere in your books right now.',
  },
  'ink.multi.vraag': {
    nl: 'Bevat dit bestand één factuur?',
    ar: 'هل يحتوي هذا الملف على فاتورة واحدة؟',
    en: 'Does this file hold one invoice?',
  },
  'ink.narekenenLezenMislukt': {
    nl: 'Narekenen is niet gelukt — wij konden je facturen nu niet lezen. Probeer het zo nog eens.',
    ar: 'فشلت إعادة الحساب — تعذّرت قراءة فواتيرك الآن. أعد المحاولة بعد قليل.',
    en: 'Recalculating did not work — we could not read your invoices just now. Try again shortly.',
  },
  'ink.narekenenMislukt': {
    nl: 'Narekenen is niet gelukt. Probeer het zo nog eens.',
    ar: 'فشلت إعادة الحساب. أعد المحاولة بعد قليل.',
    en: 'Recalculating did not work. Try again shortly.',
  },
  'ink.narekenenUitleg': {
    nl: 'Leest je facturen terug uit de documenten zelf en zegt of de bedragen er zo op staan. Verandert niets.',
    ar: 'يعيد قراءة فواتيرك من المستندات نفسها ويخبرك إن كانت المبالغ مذكورة فيها هكذا. لا يغيّر شيئاً.',
    en: 'Reads your invoices back from the documents themselves and says whether the amounts are printed there like that. Changes nothing.',
  },
  'ink.neeGewoneFactuur': {
    nl: 'Nee, gewone factuur — doorgaan',
    ar: 'لا، فاتورة عادية — تابع',
    en: 'No, ordinary invoice — continue',
  },
  'ink.neeNogNiet': {
    nl: 'Nee, nog niet betaald',
    ar: 'لا، لم أدفع بعد',
    en: 'No, not paid yet',
  },
  'ink.negeren.bevestig': {
    nl: 'Ja, negeer',
    ar: 'نعم، تجاهل',
    en: 'Yes, ignore',
  },
  'ink.negeren.uitleg': {
    nl: 'De factuur wordt verplaatst naar Genegeerd. Je kunt hem later terugzetten.',
    ar: 'ستُنقل الفاتورة إلى المتجاهَل. يمكنك إرجاعها لاحقاً.',
    en: 'The invoice is moved to Ignored. You can restore it later.',
  },
  'ink.negeren.waarom': {
    nl: 'Waarom? (optioneel)',
    ar: 'لماذا؟ (اختياري)',
    en: 'Why? (optional)',
  },
  'ink.nFacturen': {
    nl: '{n} facturen',
    ar: '{n} فاتورة',
    en: '{n} invoices',
  },
  'ink.nFactuur': {
    nl: '1 factuur',
    ar: 'فاتورة واحدة',
    en: '1 invoice',
  },
  'ink.nietAangeraakt': {
    nl: '{n} facturen met opzet niet aangeraakt',
    ar: '{n} فاتورة تُركت عمداً دون تغيير',
    en: '{n} invoices deliberately left untouched',
  },
  'ink.nietAangeraaktEen': {
    nl: '1 factuur met opzet niet aangeraakt',
    ar: 'فاتورة واحدة تُركت عمداً دون تغيير',
    en: '1 invoice deliberately left untouched',
  },
  'ink.nietGelukt': {
    nl: 'Niet gelukt',
    ar: 'لم ينجح',
    en: 'Did not work',
  },
  'ink.nietsNieuws': {
    nl: 'Niets nieuws gevonden',
    ar: 'لم يوجد جديد',
    en: 'Nothing new found',
  },
  'ink.nietsTeMatchen': {
    nl: 'Niets om te matchen',
    ar: 'لا شيء للمطابقة',
    en: 'Nothing to match',
  },
  'ink.nogDagen': {
    nl: 'nog {n} dagen',
    ar: 'الأيام المتبقية: {n}',
    en: '{n} days left',
  },
  'ink.nogEenDag': {
    nl: 'nog 1 dag',
    ar: 'بقي يوم واحد',
    en: '1 day left',
  },
  'ink.nogInRij': {
    nl: 'Er stonden er nog {n} in de rij. Draai het nog een keer om die ook na te rekenen.',
    ar: 'بقي في قائمة الانتظار {n}. شغّله مرة أخرى لإعادة حسابها أيضاً.',
    en: 'There were {n} more in the queue. Run it again to recheck those too.',
  },
  'ink.nogOpen': {
    nl: 'nog {amount} open',
    ar: 'المتبقي {amount}',
    en: '{amount} still open',
  },
  'ink.nogOpenstaandKies': {
    nl: 'Nog openstaand: {amount} — kies hieronder hoe je dit deel betaalde',
    ar: 'المتبقي: {amount} — اختر أدناه كيف دفعت هذا الجزء',
    en: 'Still open: {amount} — choose below how you paid this part',
  },
  'ink.nogTeBetalen': {
    nl: 'nog te betalen',
    ar: 'ما زال مستحقاً',
    en: 'still to pay',
  },
  'ink.oauth.mislukt': {
    nl: 'Verbinding mislukt — probeer opnieuw',
    ar: 'فشل الربط — حاول مرة أخرى',
    en: 'Connecting failed — please try again',
  },
  'ink.oauth.verbonden': {
    nl: '{provider} succesvol verbonden!',
    ar: 'رُبط {provider} بنجاح!',
    en: '{provider} connected successfully!',
  },
  'ink.omboekenMislukt': {
    nl: 'Omboeken mislukt — er is niets gewijzigd',
    ar: 'فشلت إعادة القيد — لم يتغيّر شيء',
    en: 'Rebooking failed — nothing was changed',
  },
  'ink.onbekendeAfzender': {
    nl: 'Onbekende afzender',
    ar: 'مُرسِل غير معروف',
    en: 'Unknown sender',
  },
  'ink.onbekendeLeverancier': {
    nl: 'Onbekende leverancier',
    ar: 'مورّد غير معروف',
    en: 'Unknown supplier',
  },
  'ink.ongedaanMaken': {
    nl: 'Ongedaan maken',
    ar: 'تراجع',
    en: 'Undo',
  },
  'ink.ongedaanVraag': {
    nl: 'Betaling ongedaan maken?',
    ar: 'التراجع عن الدفعة؟',
    en: 'Undo the payment?',
  },
  'ink.ontbreekt.een': {
    nl: 'Er lijkt een factuur te ontbreken',
    ar: 'يبدو أن ثمة فاتورة ناقصة',
    en: 'An invoice seems to be missing',
  },
  'ink.ontbreekt.meer': {
    nl: 'Er lijken {n} facturen te ontbreken',
    ar: 'يبدو أن ثمة {n} فاتورة ناقصة',
    en: '{n} invoices seem to be missing',
  },
  'ink.onzeker.datum': {
    nl: 'de factuurdatum',
    ar: 'تاريخ الفاتورة',
    en: 'the invoice date',
  },
  'ink.onzeker.leverancier': {
    nl: 'de leverancier',
    ar: 'المورّد',
    en: 'the supplier',
  },
  'ink.onzeker.nummer': {
    nl: 'het factuurnummer',
    ar: 'رقم الفاتورة',
    en: 'the invoice number',
  },
  'ink.onzeker.zin': {
    nl: 'De AI was niet zeker over {velden}. Controleer en pas aan waar nodig.',
    ar: 'لم يكن الذكاء الاصطناعي متأكداً من هذه الحقول: {velden}. تحقّق وعدّل حيث يلزم.',
    en: 'The AI was not sure about {velden}. Check and adjust where needed.',
  },
  'ink.onzekerEen': {
    nl: '1 betaling is gevonden maar te onzeker om zelf te boeken — die bevestig je zelf.',
    ar: 'وُجدت دفعة واحدة لكنها أشد غموضاً من أن تُقيَّد تلقائياً — تؤكدها بنفسك.',
    en: '1 payment was found but too uncertain to book by itself — you confirm that one yourself.',
  },
  'ink.onzekerN': {
    nl: '{n} betalingen zijn gevonden maar te onzeker om zelf te boeken — die bevestig je zelf.',
    ar: 'وُجدت {n} دفعة لكنها أشد غموضاً من أن تُقيَّد تلقائياً — تؤكدها بنفسك.',
    en: '{n} payments were found but too uncertain to book by themselves — you confirm those yourself.',
  },
  'ink.opBetaaldGezetEen': {
    nl: '1 factuur op betaald gezet',
    ar: 'وُضعت فاتورة واحدة كمدفوعة',
    en: '1 invoice set to paid',
  },
  'ink.opBetaaldGezetN': {
    nl: '{n} facturen op betaald gezet',
    ar: 'وُضعت {n} فاتورة كمدفوعة',
    en: '{n} invoices set to paid',
  },
  'ink.opgeslagenIn': {
    nl: 'Opgeslagen in',
    ar: 'محفوظ في',
    en: 'Stored in',
  },
  'ink.opnieuwInlezenKnop': {
    nl: 'Opnieuw inlezen',
    ar: 'إعادة القراءة',
    en: 'Re-read',
  },
  'ink.opnieuwInlezenMislukt': {
    nl: 'Opnieuw inlezen is niet gelukt — probeer het later opnieuw.',
    ar: 'فشلت إعادة القراءة — حاول لاحقاً مرة أخرى.',
    en: 'Re-reading did not work — try again later.',
  },
  'ink.optioneel': {
    nl: '(optioneel)',
    ar: '(اختياري)',
    en: '(optional)',
  },
  'ink.origineel.alAanwezig': {
    nl: 'Deze factuur heeft al een origineel — ververs de pagina.',
    ar: 'لهذه الفاتورة مستند أصلي بالفعل — حدّث الصفحة.',
    en: 'This invoice already has an original — refresh the page.',
  },
  'ink.origineel.bestaatNiet': {
    nl: 'Deze factuur bestaat niet meer.',
    ar: 'هذه الفاتورة لم تعد موجودة.',
    en: 'This invoice no longer exists.',
  },
  'ink.origineel.bestandstype': {
    nl: 'Dit bestandstype kan niet: stuur een PDF of een foto (JPG, PNG).',
    ar: 'نوع الملف هذا غير مقبول: أرسل PDF أو صورة (JPG، PNG).',
    en: 'This file type is not supported: send a PDF or a photo (JPG, PNG).',
  },
  'ink.origineel.mislukt': {
    nl: 'Toevoegen is niet gelukt — probeer het nog een keer.',
    ar: 'فشلت الإضافة — حاول مرة أخرى.',
    en: 'Adding did not work — try once more.',
  },
  'ink.origineel.teGroot': {
    nl: 'Het bestand is te groot (maximaal 20 MB).',
    ar: 'الملف كبير جداً (الحد الأقصى 20 MB).',
    en: 'The file is too large (20 MB at most).',
  },
  'ink.origineelToevoegen': {
    nl: 'Origineel toevoegen',
    ar: 'إضافة المستند الأصلي',
    en: 'Add the original',
  },
  'ink.papier.bank': {
    nl: 'dit is met de bank betaald en wordt tegen je bankregel gelegd.',
    ar: 'هذا مدفوع عبر البنك وسيُطابَق مع سطر البنك لديك.',
    en: 'this was paid by bank and will be matched against your bank line.',
  },
  'ink.papier.bankpas': {
    nl: 'bankpas',
    ar: 'بطاقة بنكية',
    en: 'bank card',
  },
  'ink.papier.contant': {
    nl: 'contant',
    ar: 'نقداً',
    en: 'cash',
  },
  'ink.papier.kas': {
    nl: 'dit is contant betaald en gaat naar je kasboek.',
    ar: 'هذا مدفوع نقداً وسيذهب إلى دفتر النقد.',
    en: 'this was paid in cash and goes to your cash book.',
  },
  'ink.papier.kloptNiet': {
    nl: 'Klopt dat niet? Kies dan het andere.',
    ar: 'أليس ذلك صحيحاً؟ اختر الآخر إذن.',
    en: 'Not right? Then pick the other one.',
  },
  'ink.papier.pas': {
    nl: '(pas ••••{cijfers})',
    ar: '(بطاقة ••••{cijfers})',
    en: '(card ••••{cijfers})',
  },
  'ink.qrMislukt': {
    nl: 'QR kon niet worden gegenereerd',
    ar: 'تعذّر توليد رمز QR',
    en: 'The QR could not be generated',
  },
  'ink.regels.aanbod': {
    nl: 'Je negeerde dit als “geen factuur”. Wil je bijlagen van {email} voortaan overslaan? De e-mails blijven in je mailbox, en je kunt de regel bij Genegeerd weer opheffen.',
    ar: 'تجاهلت هذا كـ«ليست فاتورة». أتريد تخطي مرفقات {email} من الآن؟ تبقى الرسائل في بريدك، ويمكنك إلغاء القاعدة من المتجاهَل.',
    en: 'You ignored this as “not an invoice”. Skip attachments from {email} from now on? The e-mails stay in your mailbox, and you can remove the rule under Ignored.',
  },
  'ink.regels.aanbodBevestig': {
    nl: 'Ja, altijd overslaan',
    ar: 'نعم، تخطَّ دائماً',
    en: 'Yes, always skip',
  },
  'ink.regels.foutLaden': {
    nl: 'Afzenderregels konden niet worden geladen — ververs de pagina',
    ar: 'تعذّر تحميل قواعد المُرسِلين — حدّث الصفحة',
    en: 'Sender rules could not be loaded — refresh the page',
  },
  'ink.regels.foutLezen': {
    nl: 'We konden je regels niet lezen — probeer het zo opnieuw.',
    ar: 'لم نستطع قراءة قواعدك — حاول بعد قليل.',
    en: 'We could not read your rules — try again in a moment.',
  },
  'ink.regels.ingesteld': {
    nl: 'Post van {email} wordt voortaan overgeslagen',
    ar: 'سيُتخطى بريد {email} من الآن',
    en: 'Mail from {email} will be skipped from now on',
  },
  'ink.regels.ingesteldZonder': {
    nl: 'Post van deze afzender wordt voortaan overgeslagen',
    ar: 'سيُتخطى بريد هذا المُرسِل من الآن',
    en: 'Mail from this sender will be skipped from now on',
  },
  'ink.regels.instellenMislukt': {
    nl: 'Regel instellen mislukt — probeer het opnieuw',
    ar: 'فشل ضبط القاعدة — حاول مرة أخرى',
    en: 'Setting the rule failed — please try again',
  },
  'ink.regels.instellenVerbinding': {
    nl: 'Regel instellen mislukt — controleer je verbinding',
    ar: 'فشل ضبط القاعدة — تحقّق من اتصالك',
    en: 'Setting the rule failed — check your connection',
  },
  'ink.regels.opgeheven': {
    nl: 'Post van {email} komt weer binnen',
    ar: 'سيصل بريد {email} من جديد',
    en: 'Mail from {email} arrives again',
  },
  'ink.regels.opheffenMislukt': {
    nl: 'Regel opheffen mislukt — probeer het opnieuw',
    ar: 'فشل إلغاء القاعدة — حاول مرة أخرى',
    en: 'Removing the rule failed — please try again',
  },
  'ink.regels.opheffenVerbinding': {
    nl: 'Regel opheffen mislukt — controleer je verbinding',
    ar: 'فشل إلغاء القاعدة — تحقّق من اتصالك',
    en: 'Removing the rule failed — check your connection',
  },
  'ink.regels.uitleg': {
    nl: 'Bijlagen van deze adressen worden niet geïmporteerd. De e-mails zelf blijven gewoon in je mailbox staan, en wat overgeslagen is zie je terug bij “Overgeslagen bij import”.',
    ar: 'مرفقات هذه العناوين لا تُستورد. الرسائل نفسها تبقى في بريدك، وما تُخطّي تجده في «ما تُخطّي أثناء الاستيراد».',
    en: 'Attachments from these addresses are not imported. The e-mails themselves stay in your mailbox, and what was skipped shows under “Skipped during import”.',
  },
  'ink.rekenBoekenNa': {
    nl: 'Reken mijn boeken na',
    ar: 'أعد حساب دفاتري',
    en: 'Recheck my books',
  },
  'ink.reread.fout': {
    nl: 'Dat lukte niet — probeer het zo meteen opnieuw.',
    ar: 'لم ينجح ذلك — حاول بعد قليل.',
    en: 'That did not work — try again in a moment.',
  },
  'ink.reread.foutVerbinding': {
    nl: 'Dat lukte niet — controleer je verbinding en probeer het opnieuw.',
    ar: 'لم ينجح ذلك — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'That did not work — check your connection and try again.',
  },
  'ink.reread.kap': {
    nl: 'Dit zijn de {n} nieuwste van {totaal}. De rest vind je bij je bestanden.',
    ar: 'هذه أحدث {n} من أصل {totaal}. الباقي تجده في ملفاتك.',
    en: 'These are the {n} newest of {totaal}. The rest is in your files.',
  },
  'ink.reread.klaar': {
    nl: 'Klaar.',
    ar: 'تم.',
    en: 'Done.',
  },
  'ink.reread.knop': {
    nl: 'Lees opnieuw',
    ar: 'أعد القراءة',
    en: 'Read again',
  },
  'ink.reread.uitleg': {
    nl: 'Wij lezen inmiddels meer bestandstypes dan toen deze binnenkwamen. Laat het opnieuw proberen — er verandert niets aan je boekhouding tot je het in de wachtrij bevestigt.',
    ar: 'صرنا نقرأ أنواع ملفات أكثر مما كنا نقرأ حين وصلت هذه. جرّب القراءة مجدداً — لا يتغيّر شيء في دفاترك حتى تؤكّده في قائمة الانتظار.',
    en: 'We now read more file types than when these arrived. Let it try again — nothing in your books changes until you confirm it in the queue.',
  },
  'ink.result.auto': {
    nl: 'Automatisch verwerkt',
    ar: 'عولجت تلقائياً',
    en: 'Processed automatically',
  },
  'ink.result.bank': {
    nl: 'Bankafschrift',
    ar: 'كشف بنكي',
    en: 'Bank statement',
  },
  'ink.result.document': {
    nl: 'In je bestanden',
    ar: 'في ملفاتك',
    en: 'In your files',
  },
  'ink.result.duplicate': {
    nl: 'Al toegevoegd',
    ar: 'أُضيفت مسبقاً',
    en: 'Already added',
  },
  'ink.result.eenToegevoegd': {
    nl: '1 bestand toegevoegd',
    ar: 'أُضيف ملف واحد',
    en: '1 file added',
  },
  'ink.result.error': {
    nl: 'Niet gelukt',
    ar: 'لم ينجح',
    en: 'Did not work',
  },
  'ink.result.gebeurdEen': {
    nl: 'Dit is er met je bestand gebeurd:',
    ar: 'هذا ما حدث لملفك:',
    en: 'This is what happened to your file:',
  },
  'ink.result.gebeurdMeer': {
    nl: 'Dit is er met je bestanden gebeurd:',
    ar: 'هذا ما حدث لملفاتك:',
    en: 'This is what happened to your files:',
  },
  'ink.result.invoice': {
    nl: 'Wacht op je controle',
    ar: 'بانتظار تدقيقك',
    en: 'Awaiting your check',
  },
  'ink.result.ledger': {
    nl: 'Controle-check',
    ar: 'فحص مراجعة',
    en: 'Control check',
  },
  'ink.result.meerToegevoegd': {
    nl: '{n} bestanden toegevoegd',
    ar: 'عدد الملفات المضافة: {n}',
    en: '{n} files added',
  },
  'ink.result.naarInkoop': {
    nl: 'Naar Inkoopfacturen',
    ar: 'إلى فواتير المشتريات',
    en: 'To purchase invoices',
  },
  'ink.result.statement': {
    nl: 'Rekeningoverzicht gecontroleerd',
    ar: 'رُوجع كشف الحساب',
    en: 'Account statement checked',
  },
  'ink.result.turnover': {
    nl: 'Omzet geboekt',
    ar: 'سُجّل الإيراد',
    en: 'Revenue booked',
  },
  'ink.scan.alleenLijst': {
    nl: 'Gecontroleerd: de {n} facturen op dit scherm — je oudere betaalde facturen konden we nu niet nakijken.',
    ar: 'تم الفحص: الفواتير على هذه الشاشة وعددها {n} — تعذّر الآن فحص فواتيرك المدفوعة الأقدم.',
    en: 'Checked: the {n} invoices on this screen — we could not check your older paid invoices just now.',
  },
  'ink.scan.alleenLijstEen': {
    nl: 'Gecontroleerd: de 1 factuur op dit scherm — je oudere betaalde facturen konden we nu niet nakijken.',
    ar: 'تم الفحص: الفاتورة الواحدة على هذه الشاشة — تعذّر الآن فحص فواتيرك المدفوعة الأقدم.',
    en: 'Checked: the 1 invoice on this screen — we could not check your older paid invoices just now.',
  },
  'ink.scan.buitenLijst': {
    nl: '{n} ervan staan niet in deze lijst (al betaald en ouder dan de laatste 200) — zoek ze op factuurnummer of leverancier.',
    ar: '{n} منها ليست في هذه القائمة (مدفوعة وأقدم من آخر 200) — ابحث عنها برقم الفاتورة أو المورّد.',
    en: '{n} of them are not in this list (already paid and older than the most recent 200) — look them up by invoice number or supplier.',
  },
  'ink.scan.buitenLijstEen': {
    nl: 'Eén ervan staat niet in deze lijst (al betaald en ouder dan de laatste 200) — zoek hem op factuurnummer of leverancier.',
    ar: 'واحدة منها ليست في هذه القائمة (مدفوعة وأقدم من آخر 200) — ابحث عنها برقم الفاتورة أو المورّد.',
    en: 'One of them is not in this list (already paid and older than the most recent 200) — look it up by invoice number or supplier.',
  },
  'ink.scan.heelBoek': {
    nl: 'Gecontroleerd: al je {n} bevestigde inkoopfacturen.',
    ar: 'تم الفحص: كل فواتير مشترياتك المؤكَّدة وعددها {n}.',
    en: 'Checked: all {n} of your confirmed purchase invoices.',
  },
  'ink.scan.kloppenNiet': {
    nl: '{n} geboekte facturen kloppen niet',
    ar: '{n} فاتورة مقيّدة غير صحيحة',
    en: '{n} booked invoices are wrong',
  },
  'ink.scan.kloptNietEen': {
    nl: '1 geboekte factuur klopt niet',
    ar: 'فاتورة مقيّدة واحدة غير صحيحة',
    en: '1 booked invoice is wrong',
  },
  'ink.scan.teltMee': {
    nl: 'Deze tellen nu mee in je openstaande saldo en in de btw die je terugvraagt.',
    ar: 'هذه تُحتسب الآن في رصيدك المفتوح وفي الضريبة التي تستردها.',
    en: 'These currently count in your outstanding balance and in the btw you reclaim.',
  },
  'ink.scanBankapp': {
    nl: 'Scan met je bankapp of kopieer de gegevens. Je betaalt in je eigen bank.',
    ar: 'امسح بتطبيق بنكك أو انسخ البيانات. الدفع يتم في بنكك أنت.',
    en: 'Scan with your banking app or copy the details. You pay inside your own bank.',
  },
  'ink.schrijftAf': {
    nl: '{name} schrijft automatisch af',
    ar: '{name} يخصم تلقائياً',
    en: '{name} collects automatically',
  },
  'ink.schrijftVoortaanAf': {
    nl: '{name} schrijft voortaan zelf af',
    ar: '{name} سيخصم بنفسه من الآن فصاعداً',
    en: '{name} now collects by itself',
  },
  'ink.selecteerKlaar': {
    nl: 'Selecteer klaar ({n})',
    ar: 'حدد الجاهزة ({n})',
    en: 'Select ready ({n})',
  },
  'ink.sessieVerlopen': {
    nl: 'Sessie verlopen — log opnieuw in',
    ar: 'انتهت الجلسة — سجّل الدخول من جديد',
    en: 'Session expired — log in again',
  },
  'ink.skipped.fout': {
    nl: 'We konden deze lijst nu niet ophalen. Probeer het zo meteen opnieuw — dit zegt niets over of er iets is overgeslagen.',
    ar: 'لم نستطع جلب هذه القائمة الآن. حاول بعد قليل — هذا لا يقول شيئاً عمّا إذا كان شيء قد تُخطّي.',
    en: 'We could not fetch this list right now. Try again in a moment — this says nothing about whether anything was skipped.',
  },
  'ink.standNietOpgehaald': {
    nl: 'De stand kon niet worden opgehaald — we weten niet of er nog open banktransacties zijn.',
    ar: 'تعذّر جلب الحالة — لا نعرف إن كانت لا تزال هناك حركات بنكية مفتوحة.',
    en: 'The state could not be fetched — we do not know whether open bank transactions remain.',
  },
  'ink.sync.bezig': {
    nl: 'Bezig met importeren… {n} opgeslagen, nog ~{rest} te gaan',
    ar: 'جارٍ الاستيراد… حُفظ {n}، بقي نحو {rest}',
    en: 'Importing… {n} saved, ~{rest} to go',
  },
  'ink.sync.controleren': {
    nl: '{n} geïmporteerd — we controleren nog een paar items',
    ar: 'استُورد {n} — ما زلنا نتحقق من بضعة عناصر',
    en: '{n} imported — we are still checking a few items',
  },
  'ink.sync.deelOpgeslagen': {
    nl: '{n} opgeslagen — de rest kon nu niet verwerkt worden, probeer later opnieuw',
    ar: 'حُفظ {n} — تعذّرت معالجة الباقي الآن، حاول لاحقاً',
    en: '{n} saved — the rest could not be processed now, try again later',
  },
  'ink.sync.foutPrefix': {
    nl: 'Fout:',
    ar: 'خطأ:',
    en: 'Error:',
  },
  'ink.sync.knop': {
    nl: 'Synchroniseer',
    ar: 'زامن',
    en: 'Synchronise',
  },
  'ink.sync.meerKlaar': {
    nl: '{n} opgeslagen — er staan er nog meer klaar, synchroniseer opnieuw',
    ar: 'حُفظ {n} — ثمة المزيد بانتظارك، زامن مرة أخرى',
    en: '{n} saved — more are waiting, synchronise again',
  },
  'ink.sync.mislukt': {
    nl: 'Sync mislukt — probeer opnieuw',
    ar: 'فشلت المزامنة — حاول مرة أخرى',
    en: 'Sync failed — please try again',
  },
  'ink.sync.nietLezenEen': {
    nl: '1 bestand konden we niet lezen — het staat in je bestanden, controleer het even.',
    ar: 'ملف واحد لم نستطع قراءته — إنه في ملفاتك، تحقّق منه.',
    en: '1 file we could not read — it is in your files, take a quick look.',
  },
  'ink.sync.nietLezenMeer': {
    nl: '{n} bestanden konden we niet lezen — ze staan in je bestanden, controleer ze even.',
    ar: 'عدد الملفات التي لم نستطع قراءتها: {n} — إنها في ملفاتك، تحقّق منها.',
    en: '{n} files we could not read — they are in your files, take a quick look.',
  },
  'ink.sync.nietsVerwerkt': {
    nl: 'Er kon nu niets verwerkt worden — probeer het later opnieuw',
    ar: 'تعذّرت المعالجة الآن — حاول لاحقاً',
    en: 'Nothing could be processed right now — try again later',
  },
  'ink.sync.onderbroken': {
    nl: '{n} opgeslagen — verbinding onderbroken, synchroniseer opnieuw voor de rest',
    ar: 'حُفظ {n} — انقطع الاتصال، زامن مرة أخرى للباقي',
    en: '{n} saved — connection interrupted, synchronise again for the rest',
  },
  'ink.sync.opnieuwGeprobeerd': {
    nl: '{n} geïmporteerd. {fouten} worden zo opnieuw geprobeerd.',
    ar: 'استُورد {n}. سيُعاد المحاولة على {fouten} بعد قليل.',
    en: '{n} imported. {fouten} will be retried shortly.',
  },
  'ink.sync.verwerkt': {
    nl: '{n} geïmporteerd. Alles is verwerkt.',
    ar: 'استُورد {n}. عولج كل شيء.',
    en: '{n} imported. Everything processed.',
  },
  'ink.sync.verwerktExtra': {
    nl: '{n} geïmporteerd. Alles is verwerkt ({extra} overgeslagen of al aanwezig).',
    ar: 'استُورد {n}. عولج كل شيء (المتخطى أو الموجود مسبقاً: {extra}).',
    en: '{n} imported. Everything processed ({extra} skipped or already present).',
  },
  'ink.tab.bevestigd': {
    nl: 'Bevestigd',
    ar: 'مؤكَّدة',
    en: 'Confirmed',
  },
  'ink.tab.teBevestigen': {
    nl: 'Te bevestigen',
    ar: 'بانتظار التأكيد',
    en: 'To confirm',
  },
  'ink.teLaat': {
    nl: '{n} dagen te laat',
    ar: 'أيام التأخير: {n}',
    en: '{n} days late',
  },
  'ink.teLaatEen': {
    nl: '1 dag te laat',
    ar: 'متأخرة يوماً واحداً',
    en: '1 day late',
  },
  'ink.telling': {
    nl: '{facturen} · {open} te betalen · {paid} betaald',
    ar: '{facturen} · مستحقة الدفع: {open} · مدفوعة: {paid}',
    en: '{facturen} · {open} to pay · {paid} paid',
  },
  'ink.terugdraaien': {
    nl: 'Terugdraaien',
    ar: 'تراجع',
    en: 'Revert',
  },
  'ink.teruggeplaatst': {
    nl: 'Inkoopfactuur {number} wordt teruggeplaatst naar \'Te betalen\' en elke genoteerde betaling erop wordt gewist.',
    ar: 'ستُعاد فاتورة المشتريات {number} إلى "Te betalen" وستُمحى كل دفعة مسجَّلة عليها.',
    en: 'Purchase invoice {number} is put back to \'Te betalen\' and every noted payment on it is erased.',
  },
  'ink.teruggezetToast': {
    nl: 'Factuur teruggezet',
    ar: 'أُرجعت الفاتورة',
    en: 'Invoice restored',
  },
  'ink.terugNaarWachtrij': {
    nl: 'Opnieuw ingelezen. De factuur staat nu in de controlewachtrij — bevestig daar de nieuwe bedragen.',
    ar: 'أُعيدت قراءتها. الفاتورة الآن في قائمة انتظار التدقيق — أكّد المبالغ الجديدة هناك.',
    en: 'Re-read. The invoice is now in the verification queue — confirm the new amounts there.',
  },
  'ink.terugNietGelukt': {
    nl: '{n} teruggedraaid ✓ — niet gelukt · {reasons}',
    ar: 'تم التراجع عن {n} ✓ — لم ينجح · {reasons}',
    en: '{n} reverted ✓ — failed · {reasons}',
  },
  'ink.teVaakGematcht': {
    nl: 'Te vaak gematcht — probeer het straks opnieuw',
    ar: 'جرت المطابقة مرات كثيرة — حاول بعد قليل',
    en: 'Matched too often — try again in a while',
  },
  'ink.tochAfhandelen': {
    nl: 'Toch afhandelen',
    ar: 'المتابعة رغم ذلك',
    en: 'Handle anyway',
  },
  'ink.tochNietBetaald': {
    nl: 'Toch niet betaald — verifieer',
    ar: 'لم تُدفع في الواقع — دقّق',
    en: 'Not paid after all — verify',
  },
  'ink.toewijzenMigratie': {
    nl: 'Toewijzen kan nog niet — de BTW-vrijstellingsmigratie staat nog niet op de database',
    ar: 'التخصيص غير ممكن بعد — ترحيل الإعفاء الضريبي لم يُطبَّق على قاعدة البيانات بعد',
    en: 'Assigning is not possible yet — the VAT-exemption migration is not on the database yet',
  },
  'ink.toewijzenMislukt': {
    nl: 'Toewijzen mislukt — er is niets gewijzigd',
    ar: 'فشل التخصيص — لم يتغيّر شيء',
    en: 'Assigning failed — nothing was changed',
  },
  'ink.toonAlle': {
    nl: 'Toon alle facturen',
    ar: 'اعرض كل الفواتير',
    en: 'Show all invoices',
  },
  'ink.toonAlleenDeze': {
    nl: 'Toon alleen deze',
    ar: 'اعرض هذه فقط',
    en: 'Show only these',
  },
  'ink.totaalDisclosure': {
    nl: 'Je hebt er {total} in totaal. Deze lijst toont de {open} openstaande en de {paid} meest recente betaalde.',
    ar: 'لديك {total} في المجموع. تعرض هذه القائمة المفتوحة وعددها {open} وأحدث المدفوعة وعددها {paid}.',
    en: 'You have {total} in total. This list shows the {open} outstanding ones and the {paid} most recently paid.',
  },
  'ink.totaalLabel': {
    nl: 'totaal',
    ar: 'الإجمالي',
    en: 'total',
  },
  'ink.uiterlijk': {
    nl: 'uiterlijk {date}',
    ar: 'أقصاه {date}',
    en: 'by {date}',
  },
  'ink.upload.foto': {
    nl: 'Foto maken',
    ar: 'التقاط صورة',
    en: 'Take a photo',
  },
  'ink.upload.kies': {
    nl: 'Kies bestanden of sleep hier naartoe',
    ar: 'اختر ملفات أو اسحبها إلى هنا',
    en: 'Pick files or drag them here',
  },
  'ink.upload.maxBatch': {
    nl: 'Maximaal {max} bestanden per keer. Je koos er {n}.',
    ar: 'الحد الأقصى {max} ملفاً في المرة. اخترت {n}.',
    en: 'A maximum of {max} files at a time. You picked {n}.',
  },
  'ink.upload.mislukt': {
    nl: 'Upload mislukt — probeer opnieuw',
    ar: 'فشل الرفع — حاول مرة أخرى',
    en: 'Upload failed — please try again',
  },
  'ink.upload.misluktOpnieuw': {
    nl: 'Uploaden mislukt — probeer het opnieuw.',
    ar: 'فشل الرفع — حاول مرة أخرى.',
    en: 'Upload failed — please try again.',
  },
  'ink.upload.nietOndersteund': {
    nl: 'Niet ondersteund bestandstype',
    ar: 'نوع ملف غير مدعوم',
    en: 'Unsupported file type',
  },
  'ink.upload.toegevoegdKort': {
    nl: 'Toegevoegd',
    ar: 'أُضيف',
    en: 'Added',
  },
  'ink.upload.types': {
    nl: 'PDF, afbeelding of bankafschrift — meerdere tegelijk (max {max})',
    ar: 'PDF أو صورة أو كشف بنكي — عدة ملفات معاً (بحد أقصى {max})',
    en: 'PDF, image or bank statement — several at once (max {max})',
  },
  'ink.upload.verwerken': {
    nl: 'Verwerken…',
    ar: 'جارٍ المعالجة…',
    en: 'Processing…',
  },
  'ink.upload.voortgang': {
    nl: '{n} van {totaal} verwerkt…',
    ar: 'عولج {n} من {totaal}…',
    en: '{n} of {totaal} processed…',
  },
  'ink.uploadAfschrift': {
    nl: 'Upload een bankafschrift op de Bank-pagina, dan kan de matching zijn werk doen.',
    ar: 'ارفع كشف حساب بنكي في صفحة البنك ليتسنى للمطابقة أداء عملها.',
    en: 'Upload a bank statement on the Bank page, then the matching can do its work.',
  },
  'ink.vandaag': {
    nl: 'vandaag',
    ar: 'اليوم',
    en: 'today',
  },
  'ink.vanTelling': {
    nl: '{shown} van {facturen}',
    ar: '{shown} من {facturen}',
    en: '{shown} of {facturen}',
  },
  'ink.verifieren': {
    nl: 'Verifiëren',
    ar: 'تدقيق',
    en: 'Verify',
  },
  'ink.verplaatsenMislukt': {
    nl: 'Verplaatsen mislukt — er is niets gewijzigd',
    ar: 'فشل النقل — لم يتغيّر شيء',
    en: 'Moving failed — nothing was changed',
  },
  'ink.verplaatstNaarFactuur': {
    nl: '{amount} verplaatst naar factuur {number}',
    ar: 'نُقل {amount} إلى الفاتورة {number}',
    en: '{amount} moved to invoice {number}',
  },
  'ink.verplaatstNaarGekozen': {
    nl: '{amount} verplaatst naar de gekozen factuur',
    ar: 'نُقل {amount} إلى الفاتورة المختارة',
    en: '{amount} moved to the chosen invoice',
  },
  'ink.verplaatsUitleg': {
    nl: 'Van inkoopfactuur {number} naar de factuur waar deze betaling bij hoort. Het bedrag, de betaaldatum en de methode gaan ongewijzigd mee.',
    ar: 'من فاتورة المشتريات {number} إلى الفاتورة التي تخصها هذه الدفعة. ينتقل المبلغ وتاريخ الدفع والطريقة دون تغيير.',
    en: 'From purchase invoice {number} to the invoice this payment belongs to. The amount, the payment date and the method travel along unchanged.',
  },
  'ink.vervalIncasso': {
    nl: 'Vervaldatum {date} — automatische incasso',
    ar: 'تاريخ الاستحقاق {date} — خصم تلقائي',
    en: 'Due date {date} — direct debit',
  },
  'ink.vervalNog': {
    nl: 'Vervaldatum {date} — {left}',
    ar: 'تاريخ الاستحقاق {date} — {left}',
    en: 'Due date {date} — {left}',
  },
  'ink.vervalTeLaat': {
    nl: 'Vervaldatum {date} — {late}',
    ar: 'تاريخ الاستحقاق {date} — {late}',
    en: 'Due date {date} — {late}',
  },
  'ink.vervalVandaag': {
    nl: 'Vervaldatum {date} — vandaag te betalen',
    ar: 'تاريخ الاستحقاق {date} — تُدفع اليوم',
    en: 'Due date {date} — to pay today',
  },
  'ink.vervang.bevestig': {
    nl: 'Ja, vervangen',
    ar: 'نعم، استبدل',
    en: 'Yes, replace',
  },
  'ink.vervang.foutVerbinding': {
    nl: 'Vervangen is niet gelukt. Controleer je verbinding en probeer het opnieuw.',
    ar: 'لم ينجح الاستبدال. تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Replacing did not work. Check your connection and try again.',
  },
  'ink.vervang.genegeerdMetNr': {
    nl: 'Factuur {nr} staat nu bij Genegeerd',
    ar: 'الفاتورة {nr} الآن في المتجاهَل',
    en: 'Invoice {nr} is now under Ignored',
  },
  'ink.vervang.genegeerdZonderNr': {
    nl: 'De oude factuur staat nu bij Genegeerd',
    ar: 'الفاتورة القديمة الآن في المتجاهَل',
    en: 'The old invoice is now under Ignored',
  },
  'ink.vervang.kanNiet': {
    nl: 'Vervangen kan nu niet',
    ar: 'لا يمكن الاستبدال الآن',
    en: 'Replacing is not possible right now',
  },
  'ink.vervang.knopMetNr': {
    nl: 'Deze vervangt factuur {nr}',
    ar: 'هذه تحلّ محل الفاتورة {nr}',
    en: 'This replaces invoice {nr}',
  },
  'ink.vervang.knopZonderNr': {
    nl: 'Deze vervangt de andere factuur',
    ar: 'هذه تحلّ محل الفاتورة الأخرى',
    en: 'This replaces the other invoice',
  },
  'ink.vervang.mislukt': {
    nl: 'Vervangen mislukt — ververs de pagina en probeer het opnieuw.',
    ar: 'فشل الاستبدال — حدّث الصفحة وحاول مرة أخرى.',
    en: 'Replacing failed — refresh the page and try again.',
  },
  'ink.vervang.uitlegMetNr': {
    nl: 'Factuur {nr} verdwijnt uit je lijst en telt niet meer mee in je kosten en voorbelasting. Hij blijft bewaard (7 jaar bewaarplicht) en je kunt hem terugzetten bij Inkomend › Genegeerd.\n\nDeze factuur blijft gewoon in de wachtrij staan — je controleert hem daarna zoals altijd.',
    ar: 'ستختفي الفاتورة {nr} من قائمتك ولن تُحتسب في مصاريفك وضريبة المشتريات. تبقى محفوظة (إلزام حفظ 7 سنوات) ويمكنك إرجاعها من الوارد › المتجاهَل.\n\nهذه الفاتورة تبقى في قائمة الانتظار — تتحقق منها بعدها كالمعتاد.',
    en: 'Invoice {nr} disappears from your list and no longer counts in your costs and input VAT. It stays stored (7-year retention duty) and you can restore it under Incoming › Ignored.\n\nThis invoice simply stays in the queue — you check it afterwards as always.',
  },
  'ink.vervang.uitlegZonderNr': {
    nl: 'De andere factuur verdwijnt uit je lijst en telt niet meer mee in je kosten en voorbelasting. Hij blijft bewaard (7 jaar bewaarplicht) en je kunt hem terugzetten bij Inkomend › Genegeerd.\n\nDeze factuur blijft gewoon in de wachtrij staan — je controleert hem daarna zoals altijd.',
    ar: 'ستختفي الفاتورة الأخرى من قائمتك ولن تُحتسب في مصاريفك وضريبة المشتريات. تبقى محفوظة (إلزام حفظ 7 سنوات) ويمكنك إرجاعها من الوارد › المتجاهَل.\n\nهذه الفاتورة تبقى في قائمة الانتظار — تتحقق منها بعدها كالمعتاد.',
    en: 'The other invoice disappears from your list and no longer counts in your costs and input VAT. It stays stored (7-year retention duty) and you can restore it under Incoming › Ignored.\n\nThis invoice simply stays in the queue — you check it afterwards as always.',
  },
  'ink.vervang.vraagMetNr': {
    nl: 'Vervangt deze factuur {nr}?',
    ar: 'هل تحلّ هذه محل الفاتورة {nr}؟',
    en: 'Does this replace invoice {nr}?',
  },
  'ink.vervang.vraagZonderNr': {
    nl: 'Vervangt deze de andere factuur?',
    ar: 'هل تحلّ هذه محل الفاتورة الأخرى؟',
    en: 'Does this replace the other invoice?',
  },
  'ink.verwijderdGenegeerd': {
    nl: 'Verwijderd — terug te zetten bij Inkomend › Genegeerd',
    ar: 'حُذفت — يمكن استعادتها من Inkomend › Genegeerd',
    en: 'Removed — can be restored under Inkomend › Genegeerd',
  },
  'ink.verwijderFactuur': {
    nl: 'Inkoopfactuur {number} verwijderen',
    ar: 'حذف فاتورة المشتريات {number}',
    en: 'Delete purchase invoice {number}',
  },
  'ink.verzoekGestuurd': {
    nl: 'Je verzoek voor inkoopfactuur {number} is naar de boekhouder gestuurd.',
    ar: 'أُرسل طلبك بخصوص فاتورة المشتريات {number} إلى المحاسب.',
    en: 'Your request about purchase invoice {number} has been sent to your accountant.',
  },
  'ink.volledigBetaald': {
    nl: 'Hiermee is de factuur volledig betaald.',
    ar: 'بهذا تكون الفاتورة مدفوعة بالكامل.',
    en: 'With this the invoice is fully paid.',
  },
  'ink.wordtBetaaldGemarkeerd': {
    nl: 'Inkoopfactuur {number} wordt als betaald gemarkeerd.',
    ar: 'ستُعلَّم فاتورة المشتريات {number} كمدفوعة.',
    en: 'Purchase invoice {number} will be marked as paid.',
  },
  'ink.xqUitleg': {
    nl: 'Voor de btw telt deze factuur mee in {booked} (factuurdatum). De betaling kwam binnen in {paid}.',
    ar: 'لأغراض الضريبة تُحتسب هذه الفاتورة في {booked} (تاريخ الفاتورة). الدفعة وصلت في {paid}.',
    en: 'For btw purposes this invoice counts in {booked} (invoice date). The payment arrived in {paid}.',
  },
  'ink.zoekleeg.confirmed': {
    nl: 'Niets voor “{query}” in bevestigd.',
    ar: 'لا شيء مطابق لـ «{query}» في المؤكَّدة.',
    en: 'Nothing for “{query}” in confirmed.',
  },
  'ink.zoekleeg.ignored': {
    nl: 'Niets voor “{query}” in genegeerd.',
    ar: 'لا شيء مطابق لـ «{query}» في المتجاهَل.',
    en: 'Nothing for “{query}” in ignored.',
  },
  'ink.zoekleeg.pending': {
    nl: 'Niets voor “{query}” in te verwerken.',
    ar: 'لا شيء مطابق لـ «{query}» في «بانتظار المعالجة».',
    en: 'Nothing for “{query}” in the to-process list.',
  },
  'ink.zonderFactuurdatum': {
    nl: 'Zonder factuurdatum',
    ar: 'بدون تاريخ فاتورة',
    en: 'Without invoice date',
  },
  'ink.zonderNummer': {
    nl: 'zonder nummer',
    ar: 'بلا رقم',
    en: 'without number',
  },
  'inkoop.geenVerbinding': {
    nl: 'Geen verbinding',
    ar: 'لا يوجد اتصال',
    en: 'No connection',
  },
  'inst.bedrijfVoorbeeld': {
    nl: 'Jouw Bedrijf BV',
    ar: 'شركتك BV',
    en: 'Your Company BV',
  },
  'inst.boekhouderUitleg': {
    nl: 'Vul het e-mailadres van je boekhouder in. Hij ontvangt een uitnodiging om je facturen te beheren.',
    ar: 'أدخل البريد الإلكتروني لمحاسبك. سيتلقى دعوة لإدارة فواتيرك.',
    en: 'Enter your accountant\'s e-mail address. He will receive an invitation to manage your invoices.',
  },
  'inst.btwMethode': {
    nl: 'BTW-methode',
    ar: 'طريقة btw',
    en: 'BTW method',
  },
  'inst.btwNummer': {
    nl: 'BTW-nummer',
    ar: 'رقم btw',
    en: 'BTW number',
  },
  'inst.controleerVelden': {
    nl: 'Controleer de gemarkeerde velden',
    ar: 'تحقّق من الحقول المحددة',
    en: 'Check the highlighted fields',
  },
  'inst.definitiefVerwijderen': {
    nl: 'Definitief verwijderen',
    ar: 'حذف نهائي',
    en: 'Delete permanently',
  },
  'inst.eersteFactuur': {
    nl: '✓ Eerste factuur:',
    ar: '✓ الفاتورة الأولى:',
    en: '✓ First invoice:',
  },
  'inst.exporteerGegevens': {
    nl: 'Exporteer mijn gegevens',
    ar: 'صدِّر بياناتي',
    en: 'Export my data',
  },
  'inst.exporterenBezig': {
    nl: 'Exporteren...',
    ar: 'جارٍ التصدير...',
    en: 'Exporting...',
  },
  'inst.exportMisluktOpnieuw': {
    nl: 'Export mislukt — probeer opnieuw',
    ar: 'فشل التصدير — حاول مرة أخرى',
    en: 'Export failed — please try again',
  },
  'inst.factuurstelsel': {
    nl: 'Factuurstelsel (standaard)',
    ar: 'نظام الفاتورة (القياسي)',
    en: 'Invoice basis (default)',
  },
  'inst.geldtVanaf': {
    nl: 'Geldt vanaf {date} — eerdere kwartalen worden niet opnieuw berekend.',
    ar: 'يسري اعتباراً من {date} — لا يُعاد حساب الأرباع السابقة.',
    en: 'Applies from {date} — earlier quarters are not recalculated.',
  },
  'inst.gevarenzoneUitleg': {
    nl: 'Exporteer eerst al je gegevens. Daarna kun je je account verwijderen. Je gegevens worden niet direct gewist: facturen en administratie moeten wettelijk 7 jaar bewaard blijven (Bewaarplicht). Je account wordt gedeactiveerd en is daarna niet meer toegankelijk.',
    ar: 'صدِّر جميع بياناتك أولاً. بعدها يمكنك حذف حسابك. لا تُمحى بياناتك فوراً: يُلزم القانون بحفظ الفواتير والإدارة المالية 7 سنوات (Bewaarplicht). يُعطَّل حسابك ولا يعود متاحاً بعد ذلك.',
    en: 'Export all your data first. After that you can delete your account. Your data is not erased immediately: invoices and administration must legally be kept for 7 years (Bewaarplicht). Your account is deactivated and no longer accessible after that.',
  },
  'inst.herinneringenUitleg': {
    nl: 'Staat een verstuurde factuur na de vervaldatum nog open, dan mailt BoekBrug je klant automatisch een vriendelijke herinnering met het openstaande bedrag. Een betaalde factuur wordt nooit herinnerd — jij hoeft niets te doen.',
    ar: 'إذا بقيت فاتورة مرسلة مفتوحة بعد تاريخ الاستحقاق، يرسل BoekBrug تلقائياً إلى عميلك تذكيراً ودّياً بالمبلغ المستحق. الفاتورة المدفوعة لا يُذكَّر بها أبداً — لا تحتاج أن تفعل شيئاً.',
    en: 'If a sent invoice is still open after the due date, BoekBrug automatically e-mails your client a friendly reminder with the outstanding amount. A paid invoice is never reminded — you need to do nothing.',
  },
  'inst.herinnerVoorbeeld': {
    nl: 'Bijv. “14, 30”: een vriendelijke herinnering na 14 dagen, een steviger na 30.',
    ar: 'مثلاً «14, 30»: تذكير ودّي بعد 14 يوماً، وتذكير أشد بعد 30.',
    en: 'E.g. “14, 30”: a friendly reminder after 14 days, a firmer one after 30.',
  },
  'inst.jeBoekhouder': {
    nl: 'Je boekhouder',
    ar: 'المحاسب',
    en: 'Your accountant',
  },
  'inst.kasstelselUitleg': {
    nl: 'BTW telt op de betaaldatum — voor veel winkels/horeca verplicht. Ingaat vanaf het huidige kwartaal; eerdere kwartalen blijven ongewijzigd. Een betaalde factuur zonder betaaldatum blokkeert “klaar” tot je de betaling koppelt.',
    ar: 'تُحتسب الضريبة بتاريخ الدفع — إلزامي لكثير من المتاجر والمطاعم. يسري من الربع الحالي؛ وتبقى الأرباع السابقة دون تغيير. الفاتورة المدفوعة بلا تاريخ دفع تمنع «klaar» حتى تربط الدفعة.',
    en: 'BTW counts on the payment date — mandatory for many shops and hospitality. Takes effect from the current quarter; earlier quarters stay unchanged. A paid invoice without a payment date blocks “klaar” until you link the payment.',
  },
  'inst.korUitleg': {
    nl: 'Onder de KOR breng je geen BTW in rekening. Je concept-aangifte krijgt dan een duidelijke notitie voor je boekhouder — de omzet blijft kloppen, alleen de BTW-afdracht vervalt.',
    ar: 'ضمن نظام KOR لا تُضيف btw على فواتيرك. تحصل مسودة الإقرار عندها على ملاحظة واضحة للمحاسب — يبقى الإيراد صحيحاً، ويسقط فقط سداد الضريبة.',
    en: 'Under the KOR you do not charge BTW. Your draft return then gets a clear note for your accountant — the turnover stays correct, only the BTW remittance is dropped.',
  },
  'inst.kvkNummer': {
    nl: 'KVK-nummer',
    ar: 'رقم KVK',
    en: 'KVK number',
  },
  'inst.machtigen': {
    nl: 'Machtigen',
    ar: 'تفويض',
    en: 'Authorise',
  },
  'inst.mandaatBevestigenTitel': {
    nl: 'Je boekhouder je inkoopfacturen laten bevestigen?',
    ar: 'السماح للمحاسب بتأكيد فواتير مشترياتك؟',
    en: 'Let your accountant confirm your purchase invoices?',
  },
  'inst.mandaatBevestigenUitleg': {
    nl: '{name} mag dan je inkoopfacturen controleren en boeken, zodat je kwartaal kan sluiten zonder dat jij ze stuk voor stuk nakijkt. Hij kan geen bedragen wijzigen — alleen bevestigen wat er staat. Bij elke bevestiging komt zijn naam te staan, je krijgt er bericht van, en je blijft er zelf verantwoordelijk voor.',
    ar: 'سيتمكن {name} حينها من مراجعة فواتير مشترياتك وقيدها، ليُغلق ربع سنتك دون أن تراجعها واحدة واحدة. لا يمكنه تغيير المبالغ — فقط تأكيد ما هو مكتوب. يُسجَّل اسمه مع كل تأكيد، وتصلك رسالة بذلك، وتبقى أنت المسؤول بنفسك.',
    en: '{name} may then check and book your purchase invoices, so your quarter can close without you reviewing them one by one. He cannot change amounts — only confirm what is there. His name is recorded with every confirmation, you are notified of it, and you remain responsible yourself.',
  },
  'inst.mandaatFacturenTitel': {
    nl: 'Je boekhouder laten factureren?',
    ar: 'السماح للمحاسب بإصدار الفواتير؟',
    en: 'Let your accountant invoice?',
  },
  'inst.mandaatFacturenUitleg': {
    nl: '{name} mag dan facturen versturen op jouw naam, met jouw nummerreeks en jouw btw-nummer. Je krijgt van elke factuur bericht, en je blijft er zelf verantwoordelijk voor. Je kunt dit hier op elk moment weer uitzetten.',
    ar: 'سيتمكن {name} حينها من إرسال فواتير باسمك، بتسلسل أرقامك ورقم btw الخاص بك. ستصلك رسالة عن كل فاتورة، وتبقى أنت المسؤول عنها. يمكنك إيقاف هذا هنا في أي وقت.',
    en: '{name} may then send invoices in your name, with your number sequence and your btw number. You are notified of every invoice, and you remain responsible for it yourself. You can switch this off here at any time.',
  },
  'inst.nummeringOpgeslagen': {
    nl: 'Nummering opgeslagen ✓',
    ar: 'حُفظ الترقيم ✓',
    en: 'Numbering saved ✓',
  },
  'inst.nummeringOpslaanKnop': {
    nl: 'Nummering opslaan',
    ar: 'حفظ الترقيم',
    en: 'Save numbering',
  },
  'inst.nummeringPlaceholder': {
    nl: 'bijv. 045-2026',
    ar: 'مثلاً 045-2026',
    en: 'e.g. 045-2026',
  },
  'inst.nummeringUitleg': {
    nl: 'Kom je van een ander programma? Vul je volgende factuurnummer in — bijv.',
    ar: 'قادم من برنامج آخر؟ أدخل رقم فاتورتك التالي — مثلاً',
    en: 'Coming from another program? Enter your next invoice number — e.g.',
  },
  'inst.nummeringVast': {
    nl: '🔒 Je nummering staat vast — er is al een factuur verstuurd. Wijzigen kan niet meer (wettelijk verplicht).',
    ar: '🔒 ترقيمك مثبّت — أُرسلت فاتورة بالفعل. لم يعد التغيير ممكناً (إلزام قانوني).',
    en: '🔒 Your numbering is fixed — an invoice has already been sent. It can no longer be changed (legally required).',
  },
  'inst.ontkoppelenMislukt': {
    nl: 'Ontkoppelen mislukt',
    ar: 'فشل فكّ الربط',
    en: 'Unlinking failed',
  },
  'inst.ontkoppelTitel': {
    nl: 'Koppeling met je boekhouder verwijderen?',
    ar: 'إزالة الربط مع المحاسب؟',
    en: 'Remove the link with your accountant?',
  },
  'inst.ontkoppelUitleg': {
    nl: '{name} kan je administratie daarna niet meer inzien. Je kunt later opnieuw uitnodigen.',
    ar: 'لن يتمكن {name} بعدها من الاطلاع على إدارتك المالية. يمكنك إرسال دعوة جديدة لاحقاً.',
    en: '{name} will no longer be able to see your administration. You can invite again later.',
  },
  'inst.opnieuwExporteren': {
    nl: 'Opnieuw exporteren',
    ar: 'تصدير من جديد',
    en: 'Export again',
  },
  'inst.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'inst.opslaanBezig': {
    nl: 'Opslaan...',
    ar: 'جارٍ الحفظ...',
    en: 'Saving...',
  },
  'inst.opslaanMislukt': {
    nl: 'Opslaan mislukt — probeer opnieuw',
    ar: 'فشل الحفظ — حاول مرة أخرى',
    en: 'Saving failed — please try again',
  },
  'inst.profielOpgeslagen': {
    nl: 'Profiel opgeslagen ✓',
    ar: 'حُفظ الملف الشخصي ✓',
    en: 'Profile saved ✓',
  },
  'inst.rijBevestigenAan': {
    nl: 'Aan. Je boekhouder controleert en boekt je bonnen en inkoopfacturen, zodat je kwartaal kan sluiten zonder dat jij ze stuk voor stuk nakijkt. Hij kan geen bedragen wijzigen — alleen bevestigen wat er staat. Bij elke bevestiging staat zijn naam.',
    ar: 'مفعّل. يراجع المحاسب إيصالاتك وفواتير مشترياتك ويقيدها، ليُغلق ربع سنتك دون أن تراجعها واحدة واحدة. لا يمكنه تغيير المبالغ — فقط تأكيد ما هو مكتوب. ويُسجَّل اسمه مع كل تأكيد.',
    en: 'On. Your accountant checks and books your receipts and purchase invoices, so your quarter can close without you reviewing them one by one. He cannot change amounts — only confirm what is there. His name is recorded with every confirmation.',
  },
  'inst.rijBevestigenTitel': {
    nl: 'Mijn inkoopfacturen bevestigen',
    ar: 'تأكيد فواتير مشترياتي',
    en: 'Confirm my purchase invoices',
  },
  'inst.rijBevestigenUit': {
    nl: 'Uit. Alleen jij bevestigt je inkoopfacturen. Zolang er nog onbevestigde stukken zijn, is je kwartaal niet klaar.',
    ar: 'متوقف. أنت وحدك تؤكد فواتير مشترياتك. وما دامت هناك مستندات غير مؤكدة، فربع سنتك غير جاهز.',
    en: 'Off. Only you confirm your purchase invoices. As long as unconfirmed documents remain, your quarter is not done.',
  },
  'inst.rijFacturenAan': {
    nl: 'Aan. De facturen krijgen jouw nummerreeks en jouw btw-nummer, en je krijgt van elke verstuurde factuur bericht. Je blijft er zelf verantwoordelijk voor.',
    ar: 'مفعّل. تحمل الفواتير تسلسل أرقامك ورقم btw الخاص بك، وتصلك رسالة عن كل فاتورة مرسلة. وتبقى أنت المسؤول عنها.',
    en: 'On. The invoices carry your number sequence and your btw number, and you are notified of every sent invoice. You remain responsible for them yourself.',
  },
  'inst.rijFacturenTitel': {
    nl: 'Facturen versturen namens mij',
    ar: 'إرسال الفواتير نيابةً عني',
    en: 'Send invoices on my behalf',
  },
  'inst.rijFacturenUit': {
    nl: 'Uit. Je boekhouder kan je administratie wel inzien, maar geen facturen op jouw naam versturen.',
    ar: 'متوقف. يستطيع المحاسب الاطلاع على إدارتك المالية، لكن لا يمكنه إرسال فواتير باسمك.',
    en: 'Off. Your accountant can see your administration, but cannot send invoices in your name.',
  },
  'inst.toelichtingKor': {
    nl: 'Voor de KOR en voor btw verlegd hoef je niets in te vullen — die zet de app er zelf op.',
    ar: 'أما نظام KOR و«btw verlegd» فلا تحتاج إلى كتابة شيء لهما — التطبيق يضيفهما بنفسه.',
    en: 'For the KOR and for btw reverse-charged you need not enter anything — the app adds those itself.',
  },
  'inst.toelichtingPlaceholder': {
    nl: 'Bijv. Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).',
    ar: 'مثلاً: Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).',
    en: 'E.g. Vrijgesteld van btw op grond van artikel 11-1-o Wet OB (onderwijs).',
  },
  'inst.toelichtingUitleg': {
    nl: 'Deze zin komt onder het totaal te staan op elke factuur waar geen BTW op zit. Zonder toelichting ziet je klant een factuur zonder BTW en niets dat uitlegt waarom — zijn boekhouder kan hem dan niet plaatsen. Vul de grond in die voor jouw werk geldt, bijvoorbeeld:',
    ar: 'تظهر هذه الجملة تحت المجموع في كل فاتورة لا تحمل btw. من دون توضيح يرى عميلك فاتورة بلا btw ولا شيء يشرح السبب — فلا يستطيع محاسبه قيدها. أدخل الأساس الذي ينطبق على عملك، مثلاً:',
    en: 'This sentence appears under the total on every invoice that carries no BTW. Without a note your client sees an invoice without BTW and nothing explaining why — their accountant then cannot book it. Enter the ground that applies to your work, for example:',
  },
  'inst.uitnodigen': {
    nl: 'Uitnodigen',
    ar: 'دعوة',
    en: 'Invite',
  },
  'inst.uitnodigingMislukt': {
    nl: 'Uitnodiging mislukt',
    ar: 'فشلت الدعوة',
    en: 'Invitation failed',
  },
  'inst.uitnodigingNietVerzonden': {
    nl: 'De uitnodiging is aangemaakt, maar de e-mail kon niet worden verzonden. Controleer het e-mailadres of deel de uitnodigingslink zelf met je boekhouder.',
    ar: 'أُنشئت الدعوة، لكن تعذّر إرسال البريد الإلكتروني. تحقّق من العنوان أو شارك رابط الدعوة بنفسك مع المحاسب.',
    en: 'The invitation was created, but the e-mail could not be sent. Check the address or share the invitation link with your accountant yourself.',
  },
  'inst.uitnodigingVerstuurd': {
    nl: 'Uitnodiging verstuurd naar {email}',
    ar: 'أُرسلت الدعوة إلى {email}',
    en: 'Invitation sent to {email}',
  },
  'inst.verwijderenBezig': {
    nl: 'Verwijderen...',
    ar: 'جارٍ الحذف...',
    en: 'Deleting...',
  },
  'inst.verwijderUitleg': {
    nl: 'Bevestig met je e-mailadres en wachtwoord. Je account wordt gedeactiveerd en is daarna niet meer toegankelijk. Je gegevens blijven wettelijk bewaard (Bewaarplicht ~7 jaar).',
    ar: 'أكِّد ببريدك الإلكتروني وكلمة المرور. سيُعطَّل حسابك ولا يعود متاحاً بعد ذلك. تبقى بياناتك محفوظة بموجب القانون (Bewaarplicht ~7 سنوات).',
    en: 'Confirm with your e-mail address and password. Your account is deactivated and no longer accessible after that. Your data remains stored as legally required (Bewaarplicht ~7 years).',
  },
  'inst.volgende': {
    nl: '· volgende:',
    ar: '· التالية:',
    en: '· next:',
  },
  'inst.volgendeFactuur': {
    nl: 'Je volgende factuur wordt:',
    ar: 'فاتورتك التالية ستكون:',
    en: 'Your next invoice will be:',
  },
  'inst.vrijgesteldUitleg': {
    nl: 'Voor werk dat is vrijgesteld van BTW (art. 11) — zoals zorg, onderwijs of verzekeringsbemiddeling. Je kunt dan per factuurregel "Vrijgesteld" kiezen. Let op: vrijgesteld is NIET hetzelfde als 0%. Bij 0% mag je de BTW op je inkopen gewoon terugvragen, bij een vrijstelling niet — heb je beide soorten omzet, dan wordt de BTW op kosten die allebei dienen naar verhouding afgetrokken.',
    ar: 'للعمل المُعفى من الضريبة (المادة 11) — كالرعاية أو التعليم أو وساطة التأمين. يمكنك حينها اختيار "Vrijgesteld" (مُعفى) لكل بند فاتورة. انتبه: المُعفى ليس مثل 0%. عند 0% يحق لك استرداد الضريبة على مشترياتك، أما مع الإعفاء فلا — وإذا كان لديك النوعان من الإيراد، تُخصم الضريبة على التكاليف المشتركة بالتناسب.',
    en: 'For work that is exempt from BTW (art. 11) — such as care, education or insurance mediation. You can then choose "Vrijgesteld" per invoice line. Note: exempt is NOT the same as 0%. At 0% you can simply reclaim the BTW on your purchases; with an exemption you cannot — if you have both kinds of turnover, the BTW on costs serving both is deducted proportionally.',
  },
  'inst.vulEmail': {
    nl: 'Vul een e-mailadres in',
    ar: 'أدخل بريداً إلكترونياً',
    en: 'Enter an e-mail address',
  },
  'inst.vulEmailWachtwoord': {
    nl: 'Vul je e-mailadres en wachtwoord in',
    ar: 'أدخل بريدك الإلكتروني وكلمة المرور',
    en: 'Enter your e-mail address and password',
  },
  'inst.wijzigenMislukt': {
    nl: 'Wijzigen mislukt',
    ar: 'فشل التغيير',
    en: 'Changing failed',
  },
  'int.alEerder': {
    nl: 'Je hebt dit bestand al eerder toegevoegd:',
    ar: 'أضفت هذا الملف من قبل:',
    en: 'You already added this file before:',
  },
  'int.batchUitleg': {
    nl: 'Je kon doorgaan met fotograferen terwijl deze werden gelezen. Dit is waar ze terecht zijn gekomen.',
    ar: 'كان بإمكانك متابعة التصوير أثناء قراءتها. هذا ما آلت إليه.',
    en: 'You could keep photographing while these were read. This is where they ended up.',
  },
  'int.bestaatAl': {
    nl: 'Deze factuur bestaat al',
    ar: 'هذه الفاتورة موجودة مسبقاً',
    en: 'This invoice already exists',
  },
  'int.bestandBestaatAl': {
    nl: 'Dit bestand is al toegevoegd',
    ar: 'هذا الملف أُضيف مسبقاً',
    en: 'This file was already added',
  },
  'int.bestandStaatIn': {
    nl: 'Dit bestand staat in: {folder}',
    ar: 'هذا الملف في: {folder}',
    en: 'This file is in: {folder}',
  },
  'int.bonFactuur': {
    nl: 'Bon/factuur',
    ar: 'إيصال/فاتورة',
    en: 'Receipt/invoice',
  },
  'int.combineer': {
    nl: 'Combineer {n} pagina\'s → één factuur',
    ar: 'ادمج الصفحات ({n}) ← فاتورة واحدة',
    en: 'Combine {n} pages → one invoice',
  },
  'int.combineerEen': {
    nl: 'Combineer 1 pagina → één factuur',
    ar: 'ادمج صفحة واحدة ← فاتورة واحدة',
    en: 'Combine 1 page → one invoice',
  },
  'int.combinerenMislukt': {
    nl: 'Combineren mislukt — voeg de pagina’s los toe',
    ar: 'فشل الدمج — أضف الصفحات منفردة',
    en: 'Combining failed — add the pages separately',
  },
  'int.dagomzetGeboekt': {
    nl: 'Dagomzet geboekt ✓',
    ar: 'قُيّد إيراد اليوم ✓',
    en: 'Daily turnover booked ✓',
  },
  'int.eenPdfUitleg': {
    nl: 'Eén PDF = één factuur. Meerdere verschillende facturen? Voeg ze los toe.',
    ar: 'ملف PDF واحد = فاتورة واحدة. عدة فواتير مختلفة؟ أضفها منفردة.',
    en: 'One PDF = one invoice. Several different invoices? Add them separately.',
  },
  'int.gebeurd': {
    nl: 'Dit is er met je bestand gebeurd:',
    ar: 'هذا ما حدث لملفك:',
    en: 'This is what happened to your file:',
  },
  'int.ingelezenControle': {
    nl: 'Ingelezen als controle-check',
    ar: 'قُرئ كفحص مراجعة',
    en: 'Read in as a cross-check',
  },
  'int.kop.bestaatAl': {
    nl: 'Dit bestand bestaat al',
    ar: 'هذا الملف موجود مسبقاً',
    en: 'This file already exists',
  },
  'int.kop.nietGelezen': {
    nl: 'Bewaard, maar niet gelezen',
    ar: 'حُفظ، لكنه لم يُقرأ',
    en: 'Saved, but not read',
  },
  'int.kop.toegevoegd': {
    nl: 'Bestand toegevoegd',
    ar: 'أُضيف الملف',
    en: 'File added',
  },
  'int.landed.bank': {
    nl: 'bankafschrift → Bank',
    ar: 'كشف بنكي ← البنك',
    en: 'bank statement → Bank',
  },
  'int.landed.bestand': {
    nl: 'bestand → Mijn bestanden',
    ar: 'ملف ← «ملفاتي»',
    en: 'file → My files',
  },
  'int.landed.bon': {
    nl: 'bon → Inkoopfacturen',
    ar: 'إيصال ← «فواتير المشتريات»',
    en: 'receipt → Purchase invoices',
  },
  'int.landed.controle': {
    nl: 'controle-check → ingelezen',
    ar: 'فحص مراجعة ← قُرئ',
    en: 'cross-check → read in',
  },
  'int.landed.dagomzet': {
    nl: 'dagomzet → Dagomzet',
    ar: 'إيراد يومي ← «إيراد اليوم»',
    en: 'daily turnover → Daily turnover',
  },
  'int.landed.dubbel': {
    nl: 'dubbel — niet toegevoegd',
    ar: 'مكرّر — لم يُضف',
    en: 'duplicate — not added',
  },
  'int.landed.factuur': {
    nl: 'factuur → Inkoopfacturen',
    ar: 'فاتورة ← «فواتير المشتريات»',
    en: 'invoice → Purchase invoices',
  },
  'int.landed.mogelijkDubbel': {
    nl: 'mogelijk dubbel — jouw keuze',
    ar: 'ربما مكرّرة — القرار لك',
    en: 'possibly duplicate — your call',
  },
  'int.landed.overzicht': {
    nl: 'rekeningoverzicht → gecontroleerd',
    ar: 'كشف حساب ← رُوجع',
    en: 'account statement → checked',
  },
  'int.maakFotoUpload': {
    nl: 'Maak een foto of upload — AI sorteert het',
    ar: 'التقط صورة أو ارفع ملفاً — الذكاء الاصطناعي يفرزه',
    en: 'Take a photo or upload — AI sorts it',
  },
  'int.maxPaginas': {
    nl: 'Maximaal {n} pagina’s per factuur',
    ar: 'الحد الأقصى للصفحات في الفاتورة: {n}',
    en: 'At most {n} pages per invoice',
  },
  'int.mpUitleg': {
    nl: 'Fotografeer of kies elke pagina van dezelfde factuur. We voegen ze samen tot één factuur.',
    ar: 'صوّر أو اختر كل صفحة من الفاتورة نفسها. سنجمعها في فاتورة واحدة.',
    en: 'Photograph or choose each page of the same invoice. We merge them into one invoice.',
  },
  'int.nVerwerkt': {
    nl: '{n} verwerkt',
    ar: 'عدد المعالَج: {n}',
    en: '{n} processed',
  },
  'int.opgeslagen': {
    nl: 'Opgeslagen in je bestanden',
    ar: 'حُفظ في ملفاتك',
    en: 'Stored in your files',
  },
  'int.overzichtGecontroleerd': {
    nl: 'Rekeningoverzicht gecontroleerd',
    ar: 'رُوجع كشف الحساب',
    en: 'Account statement checked',
  },
  'int.pagina': {
    nl: 'Pagina {n}',
    ar: 'صفحة {n}',
    en: 'Page {n}',
  },
  'int.paginaFotograferen': {
    nl: 'Pagina fotograferen',
    ar: 'تصوير صفحة',
    en: 'Photograph a page',
  },
  'int.paginasKiezen': {
    nl: 'Pagina\'s kiezen',
    ar: 'اختيار الصفحات',
    en: 'Choose pages',
  },
  'int.sheetUitleg': {
    nl: 'Maak een foto of kies een bestand. De AI herkent en sorteert het automatisch.',
    ar: 'التقط صورة أو اختر ملفاً. يتعرّف عليه الذكاء الاصطناعي ويفرزه تلقائياً.',
    en: 'Take a photo or choose a file. The AI recognises and sorts it automatically.',
  },
  'int.staatGenegeerd': {
    nl: 'Deze factuur staat in Genegeerd',
    ar: 'هذه الفاتورة في «Genegeerd»',
    en: 'This invoice is in Ignored',
  },
  'int.staatIn': {
    nl: 'Het staat in: {folder}',
    ar: 'موجود في: {folder}',
    en: 'It is in: {folder}',
  },
  'int.terugzettenGenegeerd': {
    nl: 'Terugzetten uit Genegeerd',
    ar: 'إعادة من «Genegeerd»',
    en: 'Put back from Ignored',
  },
  'int.terugzettenVervers': {
    nl: 'Terugzetten mislukt — ververs de pagina',
    ar: 'فشلت الإعادة — حدّث الصفحة',
    en: 'Putting back failed — refresh the page',
  },
  'int.toegevoegd': {
    nl: 'Toegevoegd ✓',
    ar: 'أُضيف ✓',
    en: 'Added ✓',
  },
  'int.veiligNietGelezen': {
    nl: 'Het bestand is veilig opgeslagen, maar we konden er niets uit lezen:',
    ar: 'حُفظ الملف بأمان، لكن لم نستطع قراءة شيء منه:',
    en: 'The file is stored safely, but we could not read anything from it:',
  },
  'int.voegEerstToe': {
    nl: 'Voeg eerst pagina\'s toe',
    ar: 'أضف صفحات أولاً',
    en: 'Add pages first',
  },
  'int.wordtGelezen': {
    nl: '{n} wordt gelezen — je kunt gewoon doorgaan',
    ar: 'قيد القراءة: {n} — يمكنك المتابعة كالمعتاد',
    en: '{n} being read — you can just keep going',
  },
  'kas.betalingAutomatisch': {
    nl: 'Automatisch: betaling van een contant betaalde factuur. Maak de betaling op de factuur ongedaan om dit te verwijderen.',
    ar: 'تلقائي: دفع فاتورة مدفوعة نقداً. لحذفه، ألغِ الدفع على الفاتورة نفسها.',
    en: 'Automatic: payment of a cash-paid invoice. Undo the payment on the invoice to remove this.',
  },
  'kas.boekingen': {
    nl: 'BOEKINGEN',
    ar: 'القيود',
    en: 'ENTRIES',
  },
  'kas.btw': {
    nl: 'BTW:',
    ar: 'btw:',
    en: 'VAT:',
  },
  'kas.cat.betaling': {
    nl: 'Factuurbetaling (contant)',
    ar: 'دفع فاتورة (نقداً)',
    en: 'Invoice payment (cash)',
  },
  'kas.cat.kosten': {
    nl: 'Kost',
    ar: 'مصروف',
    en: 'Cost',
  },
  'kas.cat.omzet': {
    nl: 'Omzet',
    ar: 'إيراد',
    en: 'Revenue',
  },
  'kas.cat.opname': {
    nl: 'Opname (van bank)',
    ar: 'سحب (من البنك)',
    en: 'Withdrawal (from the bank)',
  },
  'kas.cat.prive': {
    nl: 'Privé',
    ar: 'خاص',
    en: 'Private',
  },
  'kas.cat.storting': {
    nl: 'Storting (naar bank)',
    ar: 'إيداع (إلى البنك)',
    en: 'Deposit (to the bank)',
  },
  'kas.cat.transfer': {
    nl: 'Naar/van bank',
    ar: 'إلى/من البنك',
    en: 'To/from the bank',
  },
  'kas.downloadXlsx': {
    nl: '⬇︎ Download voor boekhouder (.xlsx)',
    ar: '⬇︎ تنزيل للمحاسب (.xlsx)',
    en: '⬇︎ Download for the accountant (.xlsx)',
  },
  'kas.fout.beginsaldoOpslaan': {
    nl: 'Kon beginsaldo niet opslaan',
    ar: 'تعذّر حفظ الرصيد الافتتاحي',
    en: 'Could not save the opening balance',
  },
  'kas.fout.boekingOpslaan': {
    nl: 'Kon de boeking niet opslaan. Probeer opnieuw.',
    ar: 'تعذّر حفظ القيد. حاول مرة أخرى.',
    en: 'Could not save the entry. Please try again.',
  },
  'kas.fout.boekingVerwijderen': {
    nl: 'Kon de boeking niet verwijderen.',
    ar: 'تعذّر حذف القيد.',
    en: 'Could not delete the entry.',
  },
  'kas.geenGevonden': {
    nl: 'Geen boekingen gevonden voor “{query}”.',
    ar: 'لا قيود مطابقة لـ «{query}».',
    en: 'No entries found for “{query}”.',
  },
  'kas.kasboekKnop': {
    nl: '📗 Kasboek per kwartaal — voor de boekhouder',
    ar: '📗 دفتر النقد لكل ربع — للمحاسب',
    en: '📗 Cash book per quarter — for the accountant',
  },
  'kas.kasboekTitel': {
    nl: 'KASBOEK — KWARTAAL',
    ar: 'دفتر النقد — الربع',
    en: 'CASH BOOK — QUARTER',
  },
  'kas.kasboekUitleg': {
    nl: 'Dit kasboek wordt live berekend uit je dagelijkse contante omzet en je kasboekingen. De omzet is al één keer geteld in je resultaat — dit overzicht toont alleen het kassaldo, dus niets wordt dubbel geboekt.',
    ar: 'يُحسب دفتر النقد هذا مباشرة من إيرادك النقدي اليومي وقيودك النقدية. الإيراد محسوب مرة واحدة في نتيجتك — هذا العرض يُظهر رصيد النقد فقط، فلا يُسجَّل شيء مرتين.',
    en: 'This cash book is computed live from your daily cash takings and your cash entries. The revenue is already counted once in your result — this view shows only the cash balance, so nothing is booked twice.',
  },
  'kas.ledgerLeeg': {
    nl: 'Nog geen kasboekingen. Voeg je eerste contante ontvangst of uitgave toe.',
    ar: 'لا قيود نقدية بعد. أضف أول مقبوض أو مصروف نقدي.',
    en: 'No cash entries yet. Add your first cash receipt or expense.',
  },
  'kas.negatief.blokkeert': {
    nl: 'Zolang dit openstaat, blokkeert de app je BTW-aangifte — juist om te voorkomen dat je iets indient wat niet kan kloppen.',
    ar: 'ما دام هذا معلّقاً يمنع التطبيق تقديم إقرار الضريبة — تحديداً كي لا تقدّم شيئاً لا يمكن أن يكون صحيحاً.',
    en: 'While this is open the app blocks your VAT return — precisely to keep you from filing something that cannot be right.',
  },
  'kas.negatief.reden1': {
    nl: 'het beginsaldo staat te laag (het geld dat al in de kassa lag)',
    ar: 'الرصيد الافتتاحي منخفض جداً (المال الذي كان في الدرج أصلاً)',
    en: 'the opening balance is set too low (the money already in the drawer)',
  },
  'kas.negatief.reden2': {
    nl: 'een contante ontvangst is nog niet geboekt',
    ar: 'ثمة مقبوض نقدي لم يُسجَّل بعد',
    en: 'a cash receipt has not been booked yet',
  },
  'kas.negatief.reden3': {
    nl: 'een uitgave staat op de verkeerde datum — vóór het geld binnenkwam',
    ar: 'ثمة مصروف مسجَّل بتاريخ خاطئ — قبل وصول المال',
    en: 'an expense sits on the wrong date — before the money came in',
  },
  'kas.negatief.titel': {
    nl: 'Je kas stond op {datum} op {bedrag}',
    ar: 'بلغ رصيد النقد لديك بتاريخ {datum} ما قدره {bedrag}',
    en: 'Your cash stood at {bedrag} on {datum}',
  },
  'kas.negatief.uitleg': {
    nl: 'Een kas kan niet onder nul komen — je kunt geen geld uitgeven dat er niet was. Voor de Belastingdienst is dit het duidelijkste signaal dat er iets ontbreekt. Meestal is het één van deze drie:',
    ar: 'لا يمكن للنقد أن ينزل تحت الصفر — لا يمكنك إنفاق مال لم يكن موجوداً. بالنسبة لمصلحة الضرائب هذا أوضح مؤشر على أن شيئاً ناقص. غالباً يكون واحداً من هذه الثلاثة:',
    en: 'A cash drawer cannot go below zero — you cannot spend money that was never there. For the tax office this is the clearest signal something is missing. Usually it is one of these three:',
  },
  'kas.omschrijvingOptioneel': {
    nl: 'Omschrijving (optioneel)',
    ar: 'الوصف (اختياري)',
    en: 'Description (optional)',
  },
  'kas.ontvangstenLabel': {
    nl: 'Kasontvangsten',
    ar: 'مقبوضات نقدية',
    en: 'Cash receipts',
  },
  'kas.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'kas.titelSaldo': {
    nl: 'KAS — SALDO IN KASSA',
    ar: 'النقد — الرصيد في الدرج',
    en: 'CASH — BALANCE IN THE DRAWER',
  },
  'kas.totaalMaand': {
    nl: 'Totaal {maand}',
    ar: 'إجمالي {maand}',
    en: 'Total {maand}',
  },
  'kas.uitgaveLabel': {
    nl: 'Kasuitgave',
    ar: 'مصروف نقدي',
    en: 'Cash expense',
  },
  'kas.upload.bezig': {
    nl: 'Bezig met uploaden…',
    ar: 'جارٍ الرفع…',
    en: 'Uploading…',
  },
  'kas.upload.dubbel': {
    nl: 'Deze bon staat er al — hij is eerder toegevoegd.',
    ar: 'هذا الإيصال موجود مسبقاً — أُضيف من قبل.',
    en: 'This receipt is already there — it was added earlier.',
  },
  'kas.upload.knop': {
    nl: '📄 Bon uploaden',
    ar: '📄 رفع إيصال',
    en: '📄 Upload receipt',
  },
  'kas.upload.misging': {
    nl: 'Er ging iets mis bij het uploaden.',
    ar: 'حدث خطأ أثناء الرفع.',
    en: 'Something went wrong during the upload.',
  },
  'kas.upload.mislukt': {
    nl: 'Uploaden mislukt — probeer het opnieuw.',
    ar: 'فشل الرفع — حاول مرة أخرى.',
    en: 'Upload failed — please try again.',
  },
  'kas.upload.naarBestanden': {
    nl: 'Ga naar Mijn bestanden →',
    ar: 'اذهب إلى ملفاتي ←',
    en: 'Go to My files →',
  },
  'kas.upload.naarVerifieren': {
    nl: 'Ga naar Te verifiëren →',
    ar: 'اذهب إلى «بانتظار التدقيق» ←',
    en: 'Go to the verify queue →',
  },
  'kas.upload.nietLezen': {
    nl: 'We konden dit document niet lezen. Het staat in je bestanden — controleer het, of upload een duidelijkere foto als het een factuur of bon is.',
    ar: 'لم نستطع قراءة هذا المستند. إنه في ملفاتك — تحقّق منه، أو ارفع صورة أوضح إن كان فاتورة أو إيصالاً.',
    en: 'We could not read this document. It is in your files — check it, or upload a clearer photo if it is an invoice or receipt.',
  },
  'kas.upload.toegevoegd': {
    nl: 'Bon toegevoegd. Bevestig ‘contant betaald’ in Te verifiëren — daarna staat de betaling automatisch in je kasboek.',
    ar: 'أُضيف الإيصال. أكّد «مدفوع نقداً» في «بانتظار التدقيق» — بعدها يظهر الدفع تلقائياً في دفتر النقد.',
    en: 'Receipt added. Confirm ‘paid in cash’ in the verify queue — the payment then lands in your cash book automatically.',
  },
  'kas.upload.uitleg': {
    nl: 'Foto of PDF van een bon die je contant hebt betaald. We lezen hem uit en zetten hem klaar als ‘contant betaald’ — jij bevestigt, daarna staat de betaling automatisch in je kasboek en blijft de BTW aftrekbaar.',
    ar: 'صورة أو PDF لإيصال دفعته نقداً. نقرأه ونجهّزه كـ«مدفوع نقداً» — أنت تؤكّد، وبعدها يظهر الدفع تلقائياً في دفتر النقد وتبقى الضريبة قابلة للخصم.',
    en: 'A photo or PDF of a receipt you paid in cash. We read it and stage it as ‘paid in cash’ — you confirm, the payment then lands in your cash book automatically and the VAT stays deductible.',
  },
  'kas.wijzigen': {
    nl: 'wijzigen',
    ar: 'تغيير',
    en: 'change',
  },
  'kl.bewerken': {
    nl: 'Klant bewerken',
    ar: 'تعديل العميل',
    en: 'Edit client',
  },
  'kl.bijgewerkt': {
    nl: 'Klant bijgewerkt',
    ar: 'حُدِّث العميل',
    en: 'Client updated',
  },
  'kl.bijwerken': {
    nl: 'Bijwerken',
    ar: 'تحديث',
    en: 'Update',
  },
  'kl.dezeKlant': {
    nl: 'Deze klant',
    ar: 'هذا العميل',
    en: 'This client',
  },
  'kl.geenGevonden': {
    nl: 'Geen klant gevonden voor "{query}"',
    ar: 'لم يُعثر على عميل مطابق لـ «{query}»',
    en: 'No client found for "{query}"',
  },
  'kl.geenResultaten': {
    nl: 'Geen resultaten',
    ar: 'لا نتائج',
    en: 'No results',
  },
  'kl.leeg': {
    nl: 'Nog geen klanten',
    ar: 'لا عملاء بعد',
    en: 'No clients yet',
  },
  'kl.nieuweKlant': {
    nl: 'Nieuwe klant',
    ar: 'عميل جديد',
    en: 'New client',
  },
  'kl.opslaan': {
    nl: 'Opslaan',
    ar: 'حفظ',
    en: 'Save',
  },
  'kl.opslaanBezig': {
    nl: 'Opslaan...',
    ar: 'جارٍ الحفظ...',
    en: 'Saving...',
  },
  'kl.toegevoegd': {
    nl: 'Klant toegevoegd',
    ar: 'أُضيف العميل',
    en: 'Client added',
  },
  'kl.veld.btw': {
    nl: 'BTW nummer',
    ar: 'رقم btw',
    en: 'VAT number',
  },
  'kl.veld.kvk': {
    nl: 'KVK nummer',
    ar: 'رقم KVK',
    en: 'KVK number',
  },
  'kl.veld.naam': {
    nl: 'Naam *',
    ar: 'الاسم *',
    en: 'Name *',
  },
  'kl.veld.naamHint': {
    nl: 'Bedrijfsnaam of naam',
    ar: 'اسم الشركة أو الاسم',
    en: 'Company name or name',
  },
  'kl.verwijderUitleg': {
    nl: '{name} verdwijnt uit je klantenlijst. Facturen die je al aan deze klant stuurde, blijven staan.',
    ar: 'سيختفي {name} من قائمة عملائك. الفواتير التي سبق أن أرسلتها لهذا العميل تبقى محفوظة.',
    en: '{name} disappears from your client list. Invoices you already sent to this client stay in place.',
  },
  'kl.verwijderVraag': {
    nl: 'Klant verwijderen?',
    ar: 'هل تريد حذف العميل؟',
    en: 'Delete this client?',
  },
  'kl.voegEersteToe': {
    nl: 'Voeg je eerste klant toe',
    ar: 'أضف عميلك الأول',
    en: 'Add your first client',
  },
  'klr.btwTeBetalen': {
    nl: 'Concept BTW te betalen',
    ar: 'مسودة btw مستحقة الدفع',
    en: 'Draft VAT to pay',
  },
  'klr.btwTerug': {
    nl: 'Concept BTW terug te ontvangen',
    ar: 'مسودة btw مستردَّة لك',
    en: 'Draft VAT to receive back',
  },
  'klr.compleet': {
    nl: 'compleet',
    ar: 'مكتمل',
    en: 'complete',
  },
  'klr.download': {
    nl: 'Download voor de boekhouder',
    ar: 'تنزيل للمحاسب',
    en: 'Download for the accountant',
  },
  'klr.fout.pakket': {
    nl: 'Het pakket kon niet worden gemaakt. Probeer het opnieuw.',
    ar: 'تعذّر إنشاء الحزمة. حاول مرة أخرى.',
    en: 'The package could not be created. Please try again.',
  },
  'klr.fout.pakketOffline': {
    nl: 'Geen verbinding — het pakket is niet gedownload.',
    ar: 'لا يوجد اتصال — لم تُنزَّل الحزمة.',
    en: 'No connection — the package was not downloaded.',
  },
  'klr.kwartaalNietBegonnen': {
    nl: 'Dit kwartaal is nog niet begonnen',
    ar: 'هذا الربع لم يبدأ بعد',
    en: 'This quarter has not started yet',
  },
  'klr.nvt': {
    nl: 'n.v.t.',
    ar: 'لا ينطبق',
    en: 'n/a',
  },
  'klr.pakketBezig': {
    nl: 'Pakket maken…',
    ar: 'جارٍ إنشاء الحزمة…',
    en: 'Creating the package…',
  },
  'klr.rubriek.grijs': {
    nl: 'Het grijze label is hoe zwaar het meetelt in je totaalscore.',
    ar: 'التسمية الرمادية تبيّن وزنه في نتيجتك الإجمالية.',
    en: 'The grey label is how heavily it weighs in your total score.',
  },
  'klr.rubriek.kleur': {
    nl: 'Het gekleurde percentage is hoe compleet dit onderdeel is.',
    ar: 'النسبة الملوّنة تبيّن مدى اكتمال هذا الجزء.',
    en: 'The colored percentage is how complete this part is.',
  },
  'klr.status.bijna': {
    nl: 'Bijna klaar',
    ar: 'شبه جاهز',
    en: 'Almost ready',
  },
  'klr.status.klaar': {
    nl: 'Klaar voor de boekhouder',
    ar: 'جاهز للمحاسب',
    en: 'Ready for the accountant',
  },
  'klr.status.nogNiet': {
    nl: 'Nog niet klaar',
    ar: 'ليس جاهزاً بعد',
    en: 'Not ready yet',
  },
  'klr.weegt': {
    nl: 'weegt {n}%',
    ar: 'الوزن: {n}%',
    en: 'weighs {n}%',
  },
  'klr.zipUitleg': {
    nl: 'Eén ZIP: facturen, bonnen, bankafschrift, dagomzet én je concept BTW-aangifte.',
    ar: 'ملف ZIP واحد: الفواتير والإيصالات وكشف البنك وإيراد الأيام ومسودة إقرار btw.',
    en: 'One ZIP: invoices, receipts, bank statement, daily takings and your draft VAT return.',
  },
  'kw.beheerIndiening': {
    nl: 'Beheer je indiening op Waarheid',
    ar: 'أدر تقديمك في «حقيقتك»',
    en: 'Manage your filing on Truth',
  },
  'kw.conceptAangifte': {
    nl: 'Concept BTW-aangifte Q{q} {jaar}',
    ar: 'مسودة إقرار btw للربع Q{q} {jaar}',
    en: 'Draft VAT return Q{q} {jaar}',
  },
  'kw.exportTitel': {
    nl: 'Alleen de facturen (CSV). Voor de volledige BTW-cijfers incl. pin & contant: gebruik het Kwartaalpakket.',
    ar: 'الفواتير فقط (CSV). لأرقام الضريبة الكاملة بما فيها البطاقة والنقد: استخدم حزمة الربع.',
    en: 'Only the invoices (CSV). For the full VAT figures incl. card & cash: use the quarterly package.',
  },
  'kw.gedaald': {
    nl: 'gedaald',
    ar: 'انخفاضاً',
    en: 'fallen',
  },
  'kw.geenDatumEen': {
    nl: '1 geverifieerde factuur heeft geen datum en telt daardoor niet mee in dit kwartaal. Vul de factuurdatum in, anders is je omzet of BTW-aftrek te laag.',
    ar: 'فاتورة مدققة واحدة بلا تاريخ ولذلك لا تُحتسب في هذا الربع. املأ تاريخ الفاتورة وإلا كان إيرادك أو خصم الضريبة منخفضاً.',
    en: '1 verified invoice has no date and therefore does not count in this quarter. Fill in the invoice date, or your revenue or VAT deduction runs too low.',
  },
  'kw.geenDatumEenAcc': {
    nl: '1 geverifieerde factuur heeft geen datum en telt daardoor niet mee in dit kwartaal — vul de factuurdatum in, anders is de omzet of BTW-aftrek te laag.',
    ar: 'فاتورة مدققة واحدة بلا تاريخ ولذلك لا تُحتسب في هذا الربع — املأ تاريخ الفاتورة وإلا كان الإيراد أو خصم الضريبة منخفضاً.',
    en: '1 verified invoice has no date and therefore does not count in this quarter — fill in the invoice date, or the revenue or VAT deduction runs too low.',
  },
  'kw.geenDatumMeer': {
    nl: '{n} geverifieerde facturen hebben geen datum en telt daardoor niet mee in dit kwartaal. Vul de factuurdatum in, anders is je omzet of BTW-aftrek te laag.',
    ar: '{n} فاتورة مدققة بلا تاريخ ولذلك لا تُحتسب في هذا الربع. املأ تاريخ الفاتورة وإلا كان إيرادك أو خصم الضريبة منخفضاً.',
    en: '{n} verified invoices have no date and therefore do not count in this quarter. Fill in the invoice date, or your revenue or VAT deduction runs too low.',
  },
  'kw.geenDatumMeerAcc': {
    nl: '{n} geverifieerde facturen hebben geen datum en telt daardoor niet mee in dit kwartaal — vul de factuurdatum in, anders is de omzet of BTW-aftrek te laag.',
    ar: '{n} فاتورة مدققة بلا تاريخ ولذلك لا تُحتسب في هذا الربع — املأ تاريخ الفاتورة وإلا كان الإيراد أو خصم الضريبة منخفضاً.',
    en: '{n} verified invoices have no date and therefore do not count in this quarter — fill in the invoice date, or the revenue or VAT deduction runs too low.',
  },
  'kw.geenFacturenIn': {
    nl: 'Geen facturen in Q{q} {jaar}',
    ar: 'لا فواتير في الربع Q{q} {jaar}',
    en: 'No invoices in Q{q} {jaar}',
  },
  'kw.gestegen': {
    nl: 'gestegen',
    ar: 'ارتفاعاً',
    en: 'risen',
  },
  'kw.gewijzigdSindsIndiening': {
    nl: 'Let op — dit kwartaal is gewijzigd sinds indiening',
    ar: 'انتبه — تغيّر هذا الربع منذ التقديم',
    en: 'Note — this quarter has changed since filing',
  },
  'kw.inclPin': {
    nl: 'incl. pin & contant',
    ar: 'شاملاً البطاقة والنقد',
    en: 'incl. card & cash',
  },
  'kw.inclUitstaand': {
    nl: 'Incl. uitstaand',
    ar: 'شاملاً المعلّق',
    en: 'Incl. outstanding',
  },
  'kw.indieningOnbekend': {
    nl: 'We konden niet controleren of dit kwartaal al is ingediend. Ververs de pagina.',
    ar: 'لم نستطع التحقق مما إذا كان هذا الربع قد قُدّم. حدّث الصفحة.',
    en: 'We could not check whether this quarter is already filed. Refresh the page.',
  },
  'kw.ingediendOp': {
    nl: '🔒 Ingediend op {datum} · definitief',
    ar: '🔒 قُدّم بتاريخ {datum} · نهائي',
    en: '🔒 Filed on {datum} · final',
  },
  'kw.inkomstenAlles': {
    nl: 'Facturen — inkomsten (betaald én uitstaand)',
    ar: 'الفواتير — إيرادات (المدفوع والمعلّق)',
    en: 'Invoices — income (paid and outstanding)',
  },
  'kw.inkomstenBetaald': {
    nl: 'Facturen — inkomsten (alleen betaald)',
    ar: 'الفواتير — إيرادات (المدفوع فقط)',
    en: 'Invoices — income (paid only)',
  },
  'kw.kwartaalpakket': {
    nl: 'Kwartaalpakket',
    ar: 'حزمة الربع',
    en: 'Quarterly package',
  },
  'kw.markeerIngediend': {
    nl: 'Markeer als ingediend op Waarheid',
    ar: 'علّمه كمقدَّم في «حقيقتك»',
    en: 'Mark as filed on Truth',
  },
  'kw.naVoorbelasting': {
    nl: 'na voorbelasting',
    ar: 'بعد ضريبة المشتريات',
    en: 'after input VAT',
  },
  'kw.omzetExcl': {
    nl: 'Omzet (excl. BTW)',
    ar: 'الإيراد (بدون btw)',
    en: 'Revenue (excl. VAT)',
  },
  'kw.ontvangenBetaald': {
    nl: 'Ontvangen & betaald',
    ar: 'المقبوض والمدفوع',
    en: 'Received & paid',
  },
  'kw.overBedrag': {
    nl: 'over {bedrag}',
    ar: 'على {bedrag}',
    en: 'over {bedrag}',
  },
  'kw.pakketMislukt': {
    nl: 'Pakket genereren mislukt — probeer opnieuw',
    ar: 'فشل إنشاء الحزمة — حاول مرة أخرى',
    en: 'Generating the package failed — please try again',
  },
  'kw.pakketTitel': {
    nl: 'Download alle facturen, bonnen en het bankafschrift als één ZIP voor je boekhouder',
    ar: 'نزّل كل الفواتير والإيصالات وكشف البنك في ملف ZIP واحد للمحاسب',
    en: 'Download all invoices, receipts and the bank statement as one ZIP for your accountant',
  },
  'kw.pakketTitelKlant': {
    nl: 'Download alle facturen, bonnen en het bankafschrift van deze klant als één ZIP',
    ar: 'نزّل كل فواتير هذا العميل وإيصالاته وكشفه البنكي في ملف ZIP واحد',
    en: 'Download all this client’s invoices, receipts and bank statement as one ZIP',
  },
  'kw.pakketVerbinding': {
    nl: 'Pakket genereren mislukt — controleer je verbinding',
    ar: 'فشل إنشاء الحزمة — تحقّق من اتصالك',
    en: 'Generating the package failed — check your connection',
  },
  'kw.periode1': {
    nl: 'Januari – Maart',
    ar: 'يناير – مارس',
    en: 'January – March',
  },
  'kw.periode2': {
    nl: 'April – Juni',
    ar: 'أبريل – يونيو',
    en: 'April – June',
  },
  'kw.periode3': {
    nl: 'Juli – September',
    ar: 'يوليو – سبتمبر',
    en: 'July – September',
  },
  'kw.periode4': {
    nl: 'Oktober – December',
    ar: 'أكتوبر – ديسمبر',
    en: 'October – December',
  },
  'kw.suppletieMeer': {
    nl: 'Meer dan €1.000 — dien een suppletie in.',
    ar: 'أكثر من €1.000 — قدّم إقراراً تصحيحياً (suppletie).',
    en: 'More than €1,000 — file a correction (suppletie).',
  },
  'kw.suppletieNodig': {
    nl: '⚠️ Suppletie nodig',
    ar: '⚠️ يلزم إقرار تصحيحي (suppletie)',
    en: '⚠️ Correction filing needed',
  },
  'kw.suppletieOnder': {
    nl: 'Onder €1.000 — verwerk dit in je volgende aangifte.',
    ar: 'أقل من €1.000 — أدرجه في إقرارك القادم.',
    en: 'Under €1,000 — process this in your next return.',
  },
  'kw.teLaat': {
    nl: '{bedrag} te laat',
    ar: 'متأخر: {bedrag}',
    en: '{bedrag} overdue',
  },
  'kw.uitgavenAlles': {
    nl: 'Facturen — uitgaven (betaald én uitstaand)',
    ar: 'الفواتير — مصروفات (المدفوع والمعلّق)',
    en: 'Invoices — spending (paid and outstanding)',
  },
  'kw.uitgavenBetaald': {
    nl: 'Facturen — uitgaven (alleen betaald)',
    ar: 'الفواتير — مصروفات (المدفوع فقط)',
    en: 'Invoices — spending (paid only)',
  },
  'kw.verschuldigd5a': {
    nl: 'Verschuldigd (5a)',
    ar: 'المستحق (5a)',
    en: 'Due (5a)',
  },
  'kw.verschuldigdTarief': {
    nl: 'Verschuldigd {rate}%',
    ar: 'المستحق {rate}%',
    en: 'Due {rate}%',
  },
  'kw.voorbelasting5b': {
    nl: 'Voorbelasting (5b)',
    ar: 'ضريبة المشتريات (5b)',
    en: 'Input VAT (5b)',
  },
  'kw.zonderTarief': {
    nl: '{bedrag} omzet staat nog zonder BTW-tarief (contante omzet, bankomzet of een niet-gesplitste kassadag) — die BTW zit dus niet in het bedrag hierboven. Ken het tarief toe bij Kas of Dagomzet voor een compleet BTW-cijfer.',
    ar: '{bedrag} من الإيراد ما يزال بلا نسبة btw (إيراد نقدي أو بنكي أو يوم كاشير غير مقسّم) — ضريبته إذن ليست ضمن المبلغ أعلاه. عيّن النسبة في «النقد» أو «إيراد اليوم» لرقم ضريبة مكتمل.',
    en: '{bedrag} of revenue still has no VAT rate (cash revenue, bank revenue or an unsplit till day) — its VAT is therefore not in the amount above. Assign the rate under Cash or Daily takings for a complete VAT figure.',
  },
  'kw.zonderTariefAcc': {
    nl: '{bedrag} omzet staat nog zonder BTW-tarief (contante omzet, bankomzet of een niet-gesplitste kassadag) — die BTW zit dus niet in het bedrag hierboven. Ken het tarief toe bij Kas of Dagomzet.',
    ar: '{bedrag} من الإيراد ما يزال بلا نسبة btw (إيراد نقدي أو بنكي أو يوم كاشير غير مقسّم) — ضريبته إذن ليست ضمن المبلغ أعلاه. عيّن النسبة في «النقد» أو «إيراد اليوم».',
    en: '{bedrag} of revenue still has no VAT rate (cash revenue, bank revenue or an unsplit till day) — its VAT is therefore not in the amount above. Assign the rate under Cash or Daily takings.',
  },
  'lijst.aan': {
    nl: 'Aan',
    ar: 'إلى',
    en: 'To',
  },
  'lijst.aangemaaktDoor': {
    nl: 'Aangemaakt door {name}',
    ar: 'أنشأها {name}',
    en: 'Created by {name}',
  },
  'lijst.betaaldIn': {
    nl: 'Betaald in {quarter}',
    ar: 'دُفعت في {quarter}',
    en: 'Paid in {quarter}',
  },
  'lijst.betaaldVraag': {
    nl: 'Betaald?',
    ar: 'هل دُفعت؟',
    en: 'Paid?',
  },
  'lijst.betaalverzoek': {
    nl: 'Betaalverzoek',
    ar: 'طلب دفع',
    en: 'Payment request',
  },
  'lijst.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ التنفيذ…',
    en: 'Working…',
  },
  'lijst.btw': {
    nl: 'BTW',
    ar: 'btw',
    en: 'BTW',
  },
  'lijst.btwPct': {
    nl: 'BTW ({pct}%)',
    ar: 'btw ({pct}%)',
    en: 'BTW ({pct}%)',
  },
  'lijst.bundel.deel': {
    nl: 'Deel deze link met je klant. Ze betalen {amount} in één overboeking — met kenmerk',
    ar: 'شارك هذا الرابط مع عميلك. يدفع {amount} في تحويل واحد — برقم الإشارة',
    en: 'Share this link with your client. They pay {amount} in one transfer — with reference',
  },
  'lijst.bundel.herkent': {
    nl: 'Zodra de betaling in je bankafschrift binnenkomt, herkent BoekBrug alle facturen tegelijk.',
    ar: 'بمجرد وصول الدفع في كشف حسابك البنكي، يتعرّف BoekBrug على كل الفواتير معاً.',
    en: 'As soon as the payment arrives in your bank statement, BoekBrug recognises all the invoices at once.',
  },
  'lijst.bundel.iban': {
    nl: 'BoekBrug verwerkt de betaling niet — het geld gaat direct naar je eigen IBAN ({iban}).',
    ar: 'لا يعالج BoekBrug الدفع — يذهب المال مباشرة إلى iban الخاص بك ({iban}).',
    en: 'BoekBrug does not process the payment — the money goes straight to your own iban ({iban}).',
  },
  'lijst.bundel.qrAlt': {
    nl: 'QR naar betaalpagina',
    ar: 'رمز QR إلى صفحة الدفع',
    en: 'QR to the payment page',
  },
  'lijst.bundel.titel': {
    nl: 'Betaalverzoek voor {count} facturen',
    ar: 'طلب دفع يشمل {count} فاتورة',
    en: 'Payment request for {count} invoices',
  },
  'lijst.creditnotaVoldaan': {
    nl: 'Creditnota {number} voldaan ✓',
    ar: 'سُدّد إشعار الدائن {number} ✓',
    en: 'Credit note {number} settled ✓',
  },
  'lijst.deelbetaling.uitleg': {
    nl: 'Deelbetaling: {paid} van {total} betaald — tik om de rest te noteren',
    ar: 'دفعة جزئية: دُفع {paid} من {total} — انقر لتسجيل الباقي',
    en: 'Partial payment: {paid} of {total} paid — tap to record the rest',
  },
  'lijst.deelGenoteerd': {
    nl: '{applied} genoteerd · nog {remaining} open',
    ar: 'سُجّل {applied} · لا يزال {remaining} مفتوحاً',
    en: '{applied} recorded · {remaining} still open',
  },
  'lijst.deelsBetaald': {
    nl: 'Deels betaald · {open} open',
    ar: 'مدفوعة جزئياً · المتبقي {open}',
    en: 'Partly paid · {open} open',
  },
  'lijst.dezeKlant': {
    nl: 'deze klant',
    ar: 'هذا العميل',
    en: 'this client',
  },
  'lijst.eenBetaallink': {
    nl: 'Eén betaallink voor {client}',
    ar: 'رابط دفع واحد لـ {client}',
    en: 'One payment link for {client}',
  },
  'lijst.elke.jaar': {
    nl: 'Elk jaar',
    ar: 'كل سنة',
    en: 'Every year',
  },
  'lijst.elke.kwartaal': {
    nl: 'Elk kwartaal',
    ar: 'كل ربع سنة',
    en: 'Every quarter',
  },
  'lijst.elke.maand': {
    nl: 'Elke maand',
    ar: 'كل شهر',
    en: 'Every month',
  },
  'lijst.elke.week': {
    nl: 'Elke week',
    ar: 'كل أسبوع',
    en: 'Every week',
  },
  'lijst.emailNietVerstuurd': {
    nl: 'Factuur {number} kreeg een nummer, maar de e-mail is niet verstuurd — verstuur opnieuw',
    ar: 'حصلت الفاتورة {number} على رقم، لكن البريد الإلكتروني لم يُرسَل — أعد الإرسال',
    en: 'Invoice {number} was given a number, but the e-mail was not sent — send again',
  },
  'lijst.emailNietVerstuurdZonder': {
    nl: 'De e-mail is niet verstuurd — verstuur de factuur opnieuw',
    ar: 'لم يُرسَل البريد الإلكتروني — أعد إرسال الفاتورة',
    en: 'The e-mail was not sent — send the invoice again',
  },
  'lijst.exclBtw': {
    nl: 'Excl. BTW',
    ar: 'بدون btw',
    en: 'Excl. BTW',
  },
  'lijst.factuurBetaald': {
    nl: 'Factuur {number} betaald ✓',
    ar: 'الفاتورة {number} مدفوعة ✓',
    en: 'Invoice {number} paid ✓',
  },
  'lijst.fout.hervatten': {
    nl: 'Hervatten mislukt',
    ar: 'فشل الاستئناف',
    en: 'Resuming failed',
  },
  'lijst.fout.offerteVersturen': {
    nl: 'Versturen lukte niet.',
    ar: 'لم ينجح الإرسال.',
    en: 'Sending did not work.',
  },
  'lijst.fout.pauzeren': {
    nl: 'Pauzeren mislukt',
    ar: 'فشل الإيقاف المؤقت',
    en: 'Pausing failed',
  },
  'lijst.fout.verzenden': {
    nl: 'Verzenden mislukt',
    ar: 'فشل الإرسال',
    en: 'Sending failed',
  },
  'lijst.gearchiveerd': {
    nl: 'GEARCHIVEERD',
    ar: 'مؤرشفة',
    en: 'ARCHIVED',
  },
  'lijst.gecrediteerd.uitleg': {
    nl: 'Er is een creditnota voor deze factuur gemaakt — hij wordt niet meer aangemaand en telt niet mee als openstaand.',
    ar: 'صدر إشعار دائن (creditnota) لهذه الفاتورة — لن تُرسَل لها تذكيرات ولا تُحتسب ضمن المستحق.',
    en: 'A creditnota was made for this invoice — it is no longer chased and no longer counts as outstanding.',
  },
  'lijst.gekopieerd': {
    nl: 'Gekopieerd',
    ar: 'نُسخ',
    en: 'Copied',
  },
  'lijst.geselecteerd': {
    nl: '{count} geselecteerd · {amount}',
    ar: 'المحدد: {count} · {amount}',
    en: '{count} selected · {amount}',
  },
  'lijst.gestart.jaar': {
    nl: 'Herhaalt elk jaar — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل سنة — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every year — the next draft will be ready on {date}',
  },
  'lijst.gestart.kwartaal': {
    nl: 'Herhaalt elk kwartaal — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل ربع سنة — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every quarter — the next draft will be ready on {date}',
  },
  'lijst.gestart.maand': {
    nl: 'Herhaalt elke maand — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل شهر — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every month — the next draft will be ready on {date}',
  },
  'lijst.gestart.week': {
    nl: 'Herhaalt elke week — het volgende concept staat klaar op {date}',
    ar: 'تتكرر كل أسبوع — المسودة التالية تكون جاهزة في {date}',
    en: 'Repeats every week — the next draft will be ready on {date}',
  },
  'lijst.herhaalt.jaar': {
    nl: 'Herhaalt elk jaar',
    ar: 'تتكرر كل سنة',
    en: 'Repeats every year',
  },
  'lijst.herhaalt.kwartaal': {
    nl: 'Herhaalt elk kwartaal',
    ar: 'تتكرر كل ربع سنة',
    en: 'Repeats every quarter',
  },
  'lijst.herhaalt.maand': {
    nl: 'Herhaalt elke maand',
    ar: 'تتكرر كل شهر',
    en: 'Repeats every month',
  },
  'lijst.herhaalt.week': {
    nl: 'Herhaalt elke week',
    ar: 'تتكرر كل أسبوع',
    en: 'Repeats every week',
  },
  'lijst.herhalen.gepauzeerd': {
    nl: 'Herhalen gepauzeerd — er wordt niets meer klaargezet',
    ar: 'أُوقف التكرار مؤقتاً — لن يُجهَّز شيء بعد الآن',
    en: 'Repeating paused — nothing more will be prepared',
  },
  'lijst.herhalen.hervat': {
    nl: 'Herhalen hervat',
    ar: 'استُؤنف التكرار',
    en: 'Repeating resumed',
  },
  'lijst.herhalen.knop': {
    nl: 'Herhalen',
    ar: 'تكرار',
    en: 'Repeat',
  },
  'lijst.herhalen.pauzeLabel': {
    nl: 'Herhalen gepauzeerd',
    ar: 'التكرار متوقف مؤقتاً',
    en: 'Repeating paused',
  },
  'lijst.hervat': {
    nl: 'Hervat',
    ar: 'استئناف',
    en: 'Resume',
  },
  'lijst.hervatten': {
    nl: 'Hervatten',
    ar: 'استئناف',
    en: 'Resume',
  },
  'lijst.inclBtw': {
    nl: 'Incl. BTW',
    ar: 'شامل btw',
    en: 'Incl. BTW',
  },
  'lijst.klaar': {
    nl: 'Klaar',
    ar: 'تم',
    en: 'Done',
  },
  'lijst.kopieerLink': {
    nl: 'Kopieer link',
    ar: 'نسخ الرابط',
    en: 'Copy link',
  },
  'lijst.kwartaal.uitleg': {
    nl: 'De factuur telt voor de btw mee in {booked} (factuurdatum). De betaling kwam binnen in {paid}.',
    ar: 'تُحتسب الفاتورة في الضريبة ضمن {booked} (تاريخ الفاتورة). ووصل الدفع في {paid}.',
    en: 'For btw the invoice counts in {booked} (invoice date). The payment came in in {paid}.',
  },
  'lijst.laden': {
    nl: 'Laden...',
    ar: 'جارٍ التحميل…',
    en: 'Loading...',
  },
  'lijst.minimaalTwee': {
    nl: 'Kies minimaal 2 openstaande facturen',
    ar: 'اختر فاتورتين مستحقتين على الأقل',
    en: 'Choose at least 2 open invoices',
  },
  'lijst.nieuwste': {
    nl: 'Nieuwste',
    ar: 'الأحدث',
    en: 'Newest',
  },
  'lijst.offerte.opnieuw': {
    nl: 'Opnieuw sturen',
    ar: 'إعادة الإرسال',
    en: 'Send again',
  },
  'lijst.offerte.versturen': {
    nl: 'Offerte versturen',
    ar: 'إرسال عرض السعر',
    en: 'Send the quote',
  },
  'lijst.offerteVerstuurd': {
    nl: 'De offerte is verstuurd.',
    ar: 'أُرسل عرض السعر.',
    en: 'The quote has been sent.',
  },
  'lijst.opnieuwVerzonden': {
    nl: 'Factuur {number} opnieuw verzonden ✓',
    ar: 'أُعيد إرسال الفاتورة {number} ✓',
    en: 'Invoice {number} sent again ✓',
  },
  'lijst.opnieuwVerzondenZonder': {
    nl: 'Factuur opnieuw verzonden ✓',
    ar: 'أُعيد إرسال الفاتورة ✓',
    en: 'Invoice sent again ✓',
  },
  'lijst.oudste': {
    nl: 'Oudste',
    ar: 'الأقدم',
    en: 'Oldest',
  },
  'lijst.pauzeer': {
    nl: 'Pauzeer',
    ar: 'إيقاف مؤقت',
    en: 'Pause',
  },
  'lijst.pauzeren': {
    nl: 'Pauzeren',
    ar: 'إيقاف مؤقت',
    en: 'Pause',
  },
  'lijst.pay.body': {
    nl: 'Factuur {number} wordt als betaald gemarkeerd en doorgestuurd naar uw accountant. Weet u het zeker?',
    ar: 'ستوضع علامة مدفوعة على الفاتورة {number} وستُحال إلى محاسبك. هل أنت متأكد؟',
    en: 'Invoice {number} will be marked as paid and forwarded to your accountant. Are you sure?',
  },
  'lijst.pay.creditBody': {
    nl: 'Weet u zeker dat u creditnota {number} als voldaan wilt markeren?',
    ar: 'هل أنت متأكد من وضع علامة مسدَّد على إشعار الدائن {number}؟',
    en: 'Are you sure you want to mark credit note {number} as settled?',
  },
  'lijst.pay.creditOngedaanBody': {
    nl: 'Creditnota {number} wordt teruggeplaatst naar \'Verzonden\'.',
    ar: 'سيُعاد إشعار الدائن {number} إلى «مُرسَلة».',
    en: 'Credit note {number} will be put back to \'Sent\'.',
  },
  'lijst.pay.creditOngedaanTitel': {
    nl: 'Voldaan status ongedaan maken?',
    ar: 'التراجع عن حالة التسديد؟',
    en: 'Undo the settled status?',
  },
  'lijst.pay.creditTitel': {
    nl: 'Creditnota als voldaan markeren?',
    ar: 'وضع علامة مسدَّد على إشعار الدائن؟',
    en: 'Mark the credit note as settled?',
  },
  'lijst.pay.jaBetaald': {
    nl: 'Ja, markeer als betaald',
    ar: 'نعم، ضع علامة مدفوعة',
    en: 'Yes, mark as paid',
  },
  'lijst.pay.jaOngedaan': {
    nl: 'Ja, ongedaan maken',
    ar: 'نعم، تراجَع',
    en: 'Yes, undo',
  },
  'lijst.pay.jaVoldaan': {
    nl: 'Ja, voldaan',
    ar: 'نعم، سُدّدت',
    en: 'Yes, settled',
  },
  'lijst.pay.leegAlles': {
    nl: 'Leeg laten = alles betaald ({amount})',
    ar: 'اتركه فارغاً = دُفع الكل ({amount})',
    en: 'Leave empty = everything paid ({amount})',
  },
  'lijst.pay.nogOpen': {
    nl: 'Nog openstaand: {amount} — kies hieronder hoe je dit deel betaalde',
    ar: 'المتبقي: {amount} — اختر أدناه كيف دُفع هذا الجزء',
    en: 'Still open: {amount} — choose below how this part was paid',
  },
  'lijst.pay.ongedaan': {
    nl: 'Ongedaan maken',
    ar: 'تراجُع',
    en: 'Undo',
  },
  'lijst.pay.ongedaanBody': {
    nl: 'Factuur {number} wordt teruggeplaatst naar \'Verzonden\'.',
    ar: 'ستُعاد الفاتورة {number} إلى «مُرسَلة».',
    en: 'Invoice {number} will be put back to \'Sent\'.',
  },
  'lijst.pay.ongedaanTitel': {
    nl: 'Betaling ongedaan maken?',
    ar: 'التراجع عن الدفع؟',
    en: 'Undo the payment?',
  },
  'lijst.pay.titel': {
    nl: 'Factuur markeren als betaald?',
    ar: 'وضع علامة مدفوعة على الفاتورة؟',
    en: 'Mark the invoice as paid?',
  },
  'lijst.pay.volledig': {
    nl: 'Hiermee is de factuur volledig betaald.',
    ar: 'بهذا تكون الفاتورة مدفوعة بالكامل.',
    en: 'This settles the invoice in full.',
  },
  'lijst.pdfNietGemaakt': {
    nl: 'Factuur {number} kreeg een nummer, maar de PDF kon niet worden gemaakt — verstuur opnieuw',
    ar: 'حصلت الفاتورة {number} على رقم، لكن تعذّر إنشاء ملف PDF — أعد الإرسال',
    en: 'Invoice {number} was given a number, but the PDF could not be created — send again',
  },
  'lijst.pdfNietGemaaktZonder': {
    nl: 'De PDF kon niet worden gemaakt — verstuur de factuur opnieuw',
    ar: 'تعذّر إنشاء ملف PDF — أعد إرسال الفاتورة',
    en: 'The PDF could not be created — send the invoice again',
  },
  'lijst.repeat.actiefBody': {
    nl: 'Het volgende concept voor {client} staat klaar op {date}.',
    ar: 'المسودة التالية لـ {client} تكون جاهزة في {date}.',
    en: 'The next draft for {client} will be ready on {date}.',
  },
  'lijst.repeat.actiefTitel': {
    nl: 'Deze factuur herhaalt',
    ar: 'هذه الفاتورة تتكرر',
    en: 'This invoice repeats',
  },
  'lijst.repeat.blijftStaan': {
    nl: 'Concepten die al klaarstaan blijven staan — stoppen raakt alleen de herhaling zelf.',
    ar: 'المسودات الجاهزة تبقى كما هي — الإيقاف يمس التكرار نفسه فقط.',
    en: 'Drafts already prepared stay put — stopping only affects the repeat itself.',
  },
  'lijst.repeat.pauzeBody': {
    nl: 'Er wordt niets klaargezet voor {client} zolang dit op pauze staat. Het schema blijft bewaard.',
    ar: 'لن يُجهَّز شيء لـ {client} ما دام هذا متوقفاً مؤقتاً. يبقى الجدول محفوظاً.',
    en: 'Nothing will be prepared for {client} while this is paused. The schedule stays saved.',
  },
  'lijst.repeat.pauzeTitel': {
    nl: 'Herhalen staat op pauze',
    ar: 'التكرار متوقف مؤقتاً',
    en: 'Repeating is paused',
  },
  'lijst.repeat.stoppenKan': {
    nl: 'Stoppen kan altijd — het herhalen staat bij deze factuur en raakt de facturen die al klaarstaan nooit.',
    ar: 'يمكنك الإيقاف في أي وقت — التكرار مرتبط بهذه الفاتورة ولا يمس الفواتير الجاهزة أبداً.',
    en: 'You can stop at any time — the repeat belongs to this invoice and never touches invoices already prepared.',
  },
  'lijst.repeat.titel': {
    nl: 'Hoe vaak herhalen?',
    ar: 'كم مرة يتكرر؟',
    en: 'How often should it repeat?',
  },
  'lijst.repeat.uitleg': {
    nl: 'We maken deze factuur voor {client} telkens opnieuw klaar — met dezelfde regels en hetzelfde betaaltermijn. Je krijgt een concept dat je zelf verstuurt.',
    ar: 'نُجهّز هذه الفاتورة لـ {client} من جديد في كل مرة — بالبنود نفسها ومهلة الدفع نفسها. تحصل على مسودة ترسلها بنفسك.',
    en: 'We prepare this invoice for {client} again each time — with the same lines and the same payment term. You get a draft that you send yourself.',
  },
  'lijst.schema.jaar': {
    nl: 'elk jaar · volgende {date}',
    ar: 'كل سنة · التالية في {date}',
    en: 'every year · next {date}',
  },
  'lijst.schema.jaarPauze': {
    nl: 'elk jaar · gepauzeerd',
    ar: 'كل سنة · متوقف مؤقتاً',
    en: 'every year · paused',
  },
  'lijst.schema.kwartaal': {
    nl: 'elk kwartaal · volgende {date}',
    ar: 'كل ربع سنة · التالية في {date}',
    en: 'every quarter · next {date}',
  },
  'lijst.schema.kwartaalPauze': {
    nl: 'elk kwartaal · gepauzeerd',
    ar: 'كل ربع سنة · متوقف مؤقتاً',
    en: 'every quarter · paused',
  },
  'lijst.schema.maand': {
    nl: 'elke maand · volgende {date}',
    ar: 'كل شهر · التالية في {date}',
    en: 'every month · next {date}',
  },
  'lijst.schema.maandPauze': {
    nl: 'elke maand · gepauzeerd',
    ar: 'كل شهر · متوقف مؤقتاً',
    en: 'every month · paused',
  },
  'lijst.schema.week': {
    nl: 'elke week · volgende {date}',
    ar: 'كل أسبوع · التالية في {date}',
    en: 'every week · next {date}',
  },
  'lijst.schema.weekPauze': {
    nl: 'elke week · gepauzeerd',
    ar: 'كل أسبوع · متوقف مؤقتاً',
    en: 'every week · paused',
  },
  'lijst.selecteer': {
    nl: 'Selecteer',
    ar: 'تحديد',
    en: 'Select',
  },
  'lijst.send.bedrag': {
    nl: 'Bedrag',
    ar: 'المبلغ',
    en: 'Amount',
  },
  'lijst.send.bevestig': {
    nl: 'Bevestig de gegevens voordat je de factuur verstuurt.',
    ar: 'تحقق من البيانات قبل إرسال الفاتورة.',
    en: 'Confirm the details before you send the invoice.',
  },
  'lijst.send.email': {
    nl: 'E-mail',
    ar: 'البريد الإلكتروني',
    en: 'E-mail',
  },
  'lijst.send.nummer': {
    nl: 'Factuurnummer',
    ar: 'رقم الفاتورة',
    en: 'Invoice number',
  },
  'lijst.send.nummerVolgt': {
    nl: 'Wordt toegekend bij verzenden',
    ar: 'يُمنح عند الإرسال',
    en: 'Assigned when sending',
  },
  'lijst.send.proForma': {
    nl: 'Deze pro forma wordt omgezet naar een officiële factuur met een nieuw factuurnummer.',
    ar: 'سيُحوَّل هذا العرض المبدئي إلى فاتورة رسمية برقم فاتورة جديد.',
    en: 'This pro forma will be converted into an official invoice with a new invoice number.',
  },
  'lijst.send.titel': {
    nl: 'Versturen naar {name}?',
    ar: 'الإرسال إلى {name}؟',
    en: 'Send to {name}?',
  },
  'lijst.send.waarschuwing': {
    nl: 'Na verzending kun je deze factuur niet meer wijzigen. Voor correcties moet je een creditnota maken.',
    ar: 'بعد الإرسال لا يمكنك تعديل هذه الفاتورة. للتصحيح عليك إنشاء إشعار دائن (creditnota).',
    en: 'After sending you can no longer change this invoice. For corrections you must create a creditnota.',
  },
  'lijst.vervangenDoor': {
    nl: 'Vervangen door {number}',
    ar: 'استُبدلت بـ {number}',
    en: 'Replaced by {number}',
  },
  'lijst.verwerktUitleg': {
    nl: 'De boekhouder heeft factuur {number} verwerkt. Vraag eerst om de verwerking ongedaan te maken voordat je de betaalstatus wijzigt.',
    ar: 'عالج المحاسب الفاتورة {number}. اطلب أولاً التراجع عن المعالجة قبل تغيير حالة الدفع.',
    en: 'Your accountant has processed invoice {number}. First ask to undo the processing before you change the payment status.',
  },
  'lijst.verwijderdTerug': {
    nl: 'Verwijderd — terug te zetten onderaan de lijst',
    ar: 'حُذفت — يمكن إعادتها من أسفل القائمة',
    en: 'Deleted — can be restored at the bottom of the list',
  },
  'lijst.verwijderen.aria': {
    nl: 'Factuur {number} verwijderen',
    ar: 'حذف الفاتورة {number}',
    en: 'Delete invoice {number}',
  },
  'lijst.verzoekGestuurd': {
    nl: 'Je verzoek voor factuur {number} is naar de boekhouder gestuurd.',
    ar: 'أُرسل طلبك بخصوص الفاتورة {number} إلى المحاسب.',
    en: 'Your request for invoice {number} has been sent to your accountant.',
  },
  'lijst.verzonden': {
    nl: 'Factuur {number} verzonden ✓',
    ar: 'أُرسلت الفاتورة {number} ✓',
    en: 'Invoice {number} sent ✓',
  },
  'lijst.verzondenZonder': {
    nl: 'Factuur verzonden ✓',
    ar: 'أُرسلت الفاتورة ✓',
    en: 'Invoice sent ✓',
  },
  'lijst.zelfdeKlant': {
    nl: 'Kies facturen van dezelfde klant',
    ar: 'اختر فواتير من العميل نفسه',
    en: 'Choose invoices from the same client',
  },
  'lijst.zoek.geen': {
    nl: 'Geen facturen gevonden voor “{query}”',
    ar: 'لم يُعثر على فواتير لـ «{query}»',
    en: 'No invoices found for “{query}”',
  },
  'nieuw.banner.offerteUitleg': {
    nl: 'geen factuurnummer. Gebruik “Omzetten naar factuur” als de klant akkoord gaat.',
    ar: 'بلا رقم فاتورة. استخدم «تحويله إلى فاتورة» عند موافقة العميل.',
    en: 'no invoice number. Use “Convert to invoice” once the client agrees.',
  },
  'nieuw.banner.overnemenVraag': {
    nl: 'Wil je hem hier overnemen? Je factuurnummer krijg je van ons — dat loopt door in je eigen reeks.',
    ar: 'هل تريد استيرادها هنا؟ رقم الفاتورة ستحصل عليه منا — وهو يستمر ضمن سلسلتك الخاصة.',
    en: 'Do you want to take it over here? Your invoice number comes from us — it continues in your own sequence.',
  },
  'nieuw.banner.vanOfferteUitleg': {
    nl: 'gegevens zijn vooringevuld. De offerte wordt gearchiveerd na opslaan.',
    ar: 'البيانات معبّأة مسبقاً. يُؤرشف عرض السعر بعد الحفظ.',
    en: 'details are pre-filled. The quote is archived after saving.',
  },
  'nieuw.banner.vervangendUitleg': {
    nl: 'voor {number}. De oude factuur wordt automatisch gearchiveerd.',
    ar: 'عن {number}. تُؤرشف الفاتورة القديمة تلقائياً.',
    en: 'for {number}. The old invoice is archived automatically.',
  },
  'nieuw.betaal.opNaamVan': {
    nl: 'Op naam van',
    ar: 'باسم',
    en: 'In the name of',
  },
  'nieuw.credit.linkNa': {
    nl: '— dan blijft de koppeling behouden.',
    ar: '— هكذا يبقى الربط محفوظاً.',
    en: '— that keeps the link intact.',
  },
  'nieuw.credit.linkTekst': {
    nl: 'vanaf de factuur zelf',
    ar: 'من صفحة الفاتورة نفسها',
    en: 'from the invoice itself',
  },
  'nieuw.credit.linkVoor': {
    nl: 'Staat de originele factuur wél in BoekBrug? Crediteer die dan',
    ar: 'هل الفاتورة الأصلية موجودة في BoekBrug؟ اعكِسها إذن',
    en: 'Is the original invoice in BoekBrug after all? Then credit it',
  },
  'nieuw.credit.uitleg': {
    nl: 'bedragen worden automatisch negatief. Vul het formulier in zoals een gewone factuur. Gebruik dit voor een factuur die niet in BoekBrug staat.',
    ar: 'تصبح المبالغ سالبة تلقائياً. املأ النموذج كفاتورة عادية. استخدم هذا لفاتورة غير موجودة في BoekBrug.',
    en: 'amounts automatically become negative. Fill in the form like a normal invoice. Use this for an invoice that is not in BoekBrug.',
  },
  'nieuw.fout.euBtwLengte': {
    nl: 'Het BTW-nummer {number} heeft niet de lengte die dat EU-land gebruikt. Controleer het bij de klant (of via VIES) — het bepaalt of de BTW verlegd mag worden en of de klant in de ICP-opgaaf komt.',
    ar: 'رقم btw {number} ليس بالطول الذي يستخدمه ذلك البلد الأوروبي. تحقّق منه لدى العميل (أو عبر VIES) — فهو يحدّد إن كان يجوز تحويل الضريبة وإن كان العميل يدخل في بيان ICP-opgaaf.',
    en: 'The VAT number {number} does not have the length that EU country uses. Check it with the client (or via VIES) — it decides whether the VAT may be reverse-charged and whether the client goes on the ICP declaration.',
  },
  'nieuw.fout.verstuurConcept': {
    nl: 'Verzenden mislukt — opgeslagen als concept',
    ar: 'فشل الإرسال — حُفظت كمسودة',
    en: 'Sending failed — saved as a draft',
  },
  'nieuw.gegevens.adresKvk': {
    nl: 'adres/KVK',
    ar: 'العنوان/KVK',
    en: 'address/KVK',
  },
  'nieuw.gegevens.btwGeldig': {
    nl: 'geldig BTW-nummer (NL…B01)',
    ar: 'رقم btw صالح (NL…B01)',
    en: 'valid VAT number (NL…B01)',
  },
  'nieuw.gegevens.btwNummer': {
    nl: 'BTW-nummer',
    ar: 'رقم btw',
    en: 'VAT number',
  },
  'nieuw.gegevens.missen': {
    nl: 'Je gegevens missen: {list}. Een factuur is wettelijk pas volledig met deze gegevens.',
    ar: 'بياناتك ناقصة: {list}. الفاتورة لا تكتمل قانونياً إلا بهذه البيانات.',
    en: 'Your details are missing: {list}. An invoice is only legally complete with these details.',
  },
  'nieuw.klant.euBtwInfo': {
    nl: 'Klant in een ander EU-land. Bij een intracommunautaire prestatie zet je 0% BTW — “Btw verlegd” komt dan automatisch op de factuur, en de klant komt in je ICP-opgaaf.',
    ar: 'العميل في بلد أوروبي آخر. عند خدمة داخل الاتحاد الأوروبي تختار 0% btw — عندها تُطبع «Btw verlegd» تلقائياً على الفاتورة، ويدخل العميل في بيان ICP-opgaaf الخاص بك.',
    en: 'Client in another EU country. For an intra-community supply you set 0% VAT — “Btw verlegd” then appears on the invoice automatically, and the client goes on your ICP declaration.',
  },
  'nieuw.klant.euBtwLengte': {
    nl: 'Deze lengte klopt niet voor dat EU-land — controleer via VIES. Het bepaalt de BTW-verlegging én de ICP-opgaaf.',
    ar: 'هذا الطول غير صحيح لذلك البلد الأوروبي — تحقّق عبر VIES. فهو يحدّد تحويل الضريبة وبيان ICP-opgaaf.',
    en: 'This length is not right for that EU country — check via VIES. It decides the VAT reverse charge and the ICP declaration.',
  },
  'nieuw.korting.hintBedrag': {
    nl: 'bijv. 50,00',
    ar: 'مثلاً 50,00',
    en: 'e.g. 50.00',
  },
  'nieuw.korting.hintPercentage': {
    nl: 'bijv. 10',
    ar: 'مثلاً 10',
    en: 'e.g. 10',
  },
  'nieuw.omzetten.uitleg': {
    nl: 'Controleer de gegevens voor het aanmaken van de factuur. Een nieuw factuurnummer wordt automatisch toegewezen. De offerte wordt gearchiveerd.',
    ar: 'تحقّق من البيانات قبل إنشاء الفاتورة. يُخصَّص رقم فاتورة جديد تلقائياً. وسيُؤرشف عرض السعر.',
    en: 'Check the details before the invoice is created. A new invoice number is assigned automatically. The quote will be archived.',
  },
  'nieuw.prijsmodus.exclKnop': {
    nl: 'excl. btw',
    ar: 'بدون btw',
    en: 'excl. VAT',
  },
  'nieuw.prijsmodus.inclKnop': {
    nl: 'incl. btw',
    ar: 'شامل btw',
    en: 'incl. VAT',
  },
  'nieuw.regel.exclTussen': {
    nl: '({amount} excl.)',
    ar: '({amount} بدون الضريبة)',
    en: '({amount} excl.)',
  },
  'nieuw.regel.toevoegen': {
    nl: 'Regel toevoegen',
    ar: 'إضافة بند',
    en: 'Add a line',
  },
  'nieuw.regel.totaalExcl': {
    nl: 'Totaal excl.',
    ar: 'الإجمالي بدون الضريبة',
    en: 'Total excl.',
  },
  'nieuw.regel.totaalIncl': {
    nl: 'Totaal incl.',
    ar: 'الإجمالي شامل الضريبة',
    en: 'Total incl.',
  },
  'nieuw.termijn.aantalDagen': {
    nl: '{days} dagen',
    ar: '{days} يوماً',
    en: '{days} days',
  },
  'nieuw.termijn.of': {
    nl: 'of',
    ar: 'أو',
    en: 'or',
  },
  'plan.actief': {
    nl: '{name} — actief',
    ar: '{name} — مفعّل',
    en: '{name} — active',
  },
  'plan.betaaldUitleg': {
    nl: 'Het kan een paar seconden duren voordat je plan hieronder bijgewerkt is. Ververs deze pagina als je het nog niet ziet.',
    ar: 'قد يستغرق تحديث خطتك أدناه بضع ثوانٍ. حدّث هذه الصفحة إن لم ترها بعد.',
    en: 'It can take a few seconds before your plan below is updated. Refresh this page if you do not see it yet.',
  },
  'plan.betalingMislukt': {
    nl: 'Betaling mislukt — we proberen het opnieuw, je houdt Plus',
    ar: 'فشل الدفع — سنحاول مرة أخرى، وتحتفظ بـPlus',
    en: 'Payment failed — we will retry, you keep Plus',
  },
  'plan.bijnaGrens': {
    nl: 'Je zit op {pct}% van deze grens. Er gebeurt nu nog niets — dit is alleen zodat je het weet.',
    ar: 'أنت عند {pct}% من هذا الحد. لا يحدث شيء الآن — هذا فقط لتكون على علم.',
    en: 'You are at {pct}% of this limit. Nothing happens yet — this is only so you know.',
  },
  'plan.geenProefperiode': {
    nl: 'en er is geen proefperiode die stilzwijgend overgaat in een abonnement. Kom je boven het eerlijk gebruik, dan pauzeert alleen de handeling die ons geld kost — inzien, doorzoeken en exporteren van je eigen administratie blijven altijd werken.',
    ar: 'ولا توجد فترة تجريبية تتحول بصمت إلى اشتراك. وإذا تجاوزت الاستخدام العادل، يتوقف مؤقتاً فقط الإجراء الذي يكلفنا مالاً — أما الاطلاع على إدارتك المالية والبحث فيها وتصديرها فتبقى تعمل دائماً.',
    en: 'and there is no trial period that silently turns into a subscription. If you go beyond fair use, only the action that costs us money pauses — viewing, searching and exporting your own administration always keep working.',
  },
  'plan.gratis': {
    nl: 'Gratis',
    ar: 'مجاني',
    en: 'Free',
  },
  'plan.looptAf': {
    nl: 'Plus loopt af — je houdt hem tot het einde van de betaalde periode',
    ar: 'ينتهي Plus — تحتفظ به حتى نهاية الفترة المدفوعة',
    en: 'Plus is ending — you keep it until the end of the paid period',
  },
  'plan.maandtellers': {
    nl: 'De maandtellers beginnen op de 1e weer bij nul. Opslag en mailboxen worden gemeten zoals ze nu zijn, niet opgeteld over de maand.',
    ar: 'تعود عدادات الشهر إلى الصفر في اليوم الأول منه. تُقاس المساحة وصناديق البريد كما هي الآن، لا مجموعةً على مدار الشهر.',
    en: 'The monthly counters start again at zero on the 1st. Storage and mailboxes are measured as they are now, not summed over the month.',
  },
  'plan.migratieOntbreekt': {
    nl: 'De abonnementskolommen bestaan nog niet in de database (billing_subscription.sql is nog niet toegepast). Alles werkt, maar een lopend Plus-abonnement kan hier nog niet worden getoond.',
    ar: 'أعمدة الاشتراك غير موجودة بعد في قاعدة البيانات (billing_subscription.sql لم يُطبَّق بعد). كل شيء يعمل، لكن اشتراك Plus الجاري لا يمكن عرضه هنا بعد.',
    en: 'The subscription columns do not exist in the database yet (billing_subscription.sql has not been applied). Everything works, but a running Plus subscription cannot be shown here yet.',
  },
  'plan.nooitAfgeschreven': {
    nl: 'nooit automatisch afgeschreven',
    ar: 'في مأمن من أي خصم تلقائي',
    en: 'exempt from any automatic charge',
  },
  'plan.plusLooptTot': {
    nl: 'Plus loopt tot',
    ar: 'يستمر Plus حتى',
    en: 'Plus runs until',
  },
  'plan.volgendeVerlenging': {
    nl: 'Volgende verlenging',
    ar: 'التجديد التالي',
    en: 'Next renewal',
  },
  'plan.waarschuwenVanaf': {
    nl: 'Wij waarschuwen vanaf {pct}% van een grens, en wat er dan gebeurt staat er per regel bij.',
    ar: 'نحذّرك اعتباراً من {pct}% من أي حد، وما يحدث عندها مذكور عند كل سطر.',
    en: 'We warn from {pct}% of a limit, and what happens then is stated per line.',
  },
  'start.meldingenFout': {
    nl: 'We konden je meldingen nu niet ophalen. Probeer het zo meteen opnieuw — dit zegt niets over of er meldingen voor je zijn.',
    ar: 'لم نستطع جلب إشعاراتك الآن. حاول بعد قليل — هذا لا يقول شيئاً عن وجود إشعارات لك.',
    en: 'We could not fetch your notifications right now. Try again in a moment — this says nothing about whether you have any.',
  },
  'team.eerderUitleg': {
    nl: 'Deze mensen kunnen niets meer. Ze blijven in de lijst staan omdat de facturen die ze maakten nog bestaan en op naam moeten blijven.',
    ar: 'لم يعد بإمكان هؤلاء فعل شيء. يبقون في القائمة لأن الفواتير التي أنشأوها ما زالت موجودة ويجب أن تبقى منسوبة بالاسم.',
    en: 'These people can no longer do anything. They stay in the list because the invoices they created still exist and must remain attributable by name.',
  },
  'team.ingetrokkenOp': {
    nl: '{name} — ingetrokken op {date}',
    ar: '{name} — سُحب في {date}',
    en: '{name} — revoked on {date}',
  },
  'team.intrekkenMislukt': {
    nl: 'Intrekken mislukt',
    ar: 'فشل السحب',
    en: 'Revoking failed',
  },
  'team.introNa': {
    nl: '— niet je bank, niet je omzet, niet je andere facturen.',
    ar: '— لا حسابك البنكي، ولا إيرادك، ولا فواتيرك الأخرى.',
    en: '— not your bank, not your turnover, not your other invoices.',
  },
  'team.introNadruk': {
    nl: 'alleen wat hij zelf aanmaakt',
    ar: 'فقط ما ينشئه بنفسه',
    en: 'only what he creates himself',
  },
  'team.introVoor': {
    nl: 'Iemand die je hier toevoegt kan verkoopfacturen maken en versturen die uitgaan op jouw naam en BTW-nummer, met jouw doorlopende factuurnummers. Hij ziet',
    ar: 'أي شخص تضيفه هنا يمكنه إنشاء وإرسال فواتير مبيعات تصدر باسمك ورقم btw الخاص بك، وبأرقام فواتيرك المتسلسلة. وهو يرى',
    en: 'Someone you add here can create and send sales invoices that go out in your name and BTW number, with your consecutive invoice numbers. He sees',
  },
  'team.laadMislukt': {
    nl: 'Kon het team niet laden',
    ar: 'تعذّر تحميل الفريق',
    en: 'Could not load the team',
  },
  'team.migratieNa': {
    nl: 'moet nog worden toegepast. Zolang dat niet is gebeurd kun je niemand uitnodigen — en verandert er verder niets: je facturen, je bank en je aangifte werken gewoon door.',
    ar: 'لم يُطبَّق بعد. وما دام الأمر كذلك لا يمكنك دعوة أحد — ولا يتغير شيء آخر: فواتيرك وبنكك وإقرارك (aangifte) تعمل كالمعتاد.',
    en: 'still needs to be applied. Until that happens you cannot invite anyone — and nothing else changes: your invoices, your bank and your aangifte keep working as usual.',
  },
  'team.migratieVoor': {
    nl: 'De databasemigratie',
    ar: 'ترحيل قاعدة البيانات',
    en: 'The database migration',
  },
  'team.sinds': {
    nl: 'sinds {date}',
    ar: 'منذ {date}',
    en: 'since {date}',
  },
  'team.uitlegOnderaan': {
    nl: 'Intrekken werkt onmiddellijk: bij zijn volgende klik kan hij niets meer. Facturen die hij al verstuurde blijven staan — die hebben een wettelijk nummer en horen bij je boekhouding.',
    ar: 'السحب فوري: عند نقرته التالية لا يستطيع فعل شيء. الفواتير التي أرسلها تبقى — فلها رقم قانوني وهي جزء من دفاترك.',
    en: 'Revoking works immediately: on his next click he can do nothing more. Invoices he already sent remain — they carry a legal number and belong to your bookkeeping.',
  },
  'team.uitnodigenMislukt': {
    nl: 'Uitnodigen mislukt',
    ar: 'فشلت الدعوة',
    en: 'Inviting failed',
  },
  'team.uitnodigingUitleg': {
    nl: 'Hij krijgt een e-mail met wat hij aanneemt. Accepteren kan alleen met dít adres — een doorgestuurde link werkt niet. De uitnodiging verloopt na 14 dagen.',
    ar: 'يتلقى بريداً إلكترونياً يوضح ما يقبله. القبول ممكن بهذا العنوان فقط — الرابط المُعاد توجيهه لا يعمل. تنتهي صلاحية الدعوة بعد 14 يوماً.',
    en: 'He receives an e-mail explaining what he is accepting. Accepting only works with this exact address — a forwarded link does not work. The invitation expires after 14 days.',
  },
  'team.verloopt': {
    nl: 'verloopt {date}',
    ar: 'تنتهي {date}',
    en: 'expires {date}',
  },
  'up.alleOpnieuw': {
    nl: 'Alle {n} mislukte opnieuw proberen',
    ar: 'إعادة محاولة كل ما فشل ({n})',
    en: 'Retry all {n} failed',
  },
  'up.allesMeerdere': {
    nl: 'meerdere bestanden tegelijk',
    ar: 'عدة ملفات معاً',
    en: 'several files at once',
  },
  'up.allesRest': {
    nl: '; de app leest en sorteert elk bestand automatisch naar de juiste plek.',
    ar: '؛ يقرأ التطبيق كل ملف ويفرزه تلقائياً إلى مكانه الصحيح.',
    en: '; the app reads each file and sorts it to the right place automatically.',
  },
  'up.alToegevoegd': {
    nl: 'Al toegevoegd',
    ar: 'أُضيف مسبقاً',
    en: 'Already added',
  },
  'up.andersAparte': {
    nl: '— anders wordt elke foto een aparte factuur.',
    ar: '— وإلا صارت كل صورة فاتورة مستقلة.',
    en: '— otherwise each photo becomes a separate invoice.',
  },
  'up.autoGeboekt': {
    nl: 'Automatisch geboekt',
    ar: 'قُيّدت تلقائياً',
    en: 'Booked automatically',
  },
  'up.autoGeboektEen': {
    nl: 'Eén factuur was zeker genoeg om zelf te controleren en is meteen geboekt als inkoopfactuur — klaar voor je boekhouder. Er is niets betaald; nakijken kan bij Inkoopfacturen onder “Automatisch verwerkt”.',
    ar: 'فاتورة واحدة كانت مؤكدة بما يكفي للتدقيق الذاتي وقُيّدت فوراً كفاتورة مشتريات — جاهزة للمحاسب. لم يُدفع شيء؛ يمكن مراجعتها في «فواتير المشتريات» ضمن “Automatisch verwerkt”.',
    en: 'One invoice was certain enough to check itself and was booked immediately as a purchase invoice — ready for your accountant. Nothing was paid; you can review it under “Automatisch verwerkt” on Purchase invoices.',
  },
  'up.autoGeboektMeer': {
    nl: '{n} facturen waren zeker genoeg om zelf te controleren en zijn meteen geboekt als inkoopfactuur — klaar voor je boekhouder. Er is niets betaald; nakijken kan bij Inkoopfacturen onder “Automatisch verwerkt”.',
    ar: 'فواتير مؤكدة بما يكفي للتدقيق الذاتي: {n}، وقُيّدت فوراً كفواتير مشتريات — جاهزة للمحاسب. لم يُدفع شيء؛ يمكن مراجعتها في «فواتير المشتريات» ضمن “Automatisch verwerkt”.',
    en: '{n} invoices were certain enough to check themselves and were booked immediately as purchase invoices — ready for your accountant. Nothing was paid; you can review them under “Automatisch verwerkt” on Purchase invoices.',
  },
  'up.bestandenKiezen': {
    nl: 'Bestanden kiezen',
    ar: 'اختيار الملفات',
    en: 'Choose files',
  },
  'up.bezigLezen': {
    nl: 'Bezig met lezen…',
    ar: 'جارٍ القراءة…',
    en: 'Reading…',
  },
  'up.bezigSamenvoegen': {
    nl: 'Bezig met samenvoegen…',
    ar: 'جارٍ الدمج…',
    en: 'Merging…',
  },
  'up.bezigVerkleinen': {
    nl: 'Bezig met verkleinen…',
    ar: 'جارٍ التصغير…',
    en: 'Shrinking…',
  },
  'up.bezigVerwerken': {
    nl: 'Bezig met verwerken… {done}/{total} klaar',
    ar: 'جارٍ المعالجة… اكتمل {done}/{total}',
    en: 'Processing… {done}/{total} done',
  },
  'up.combineer': {
    nl: 'Combineer {n} pagina’s → één factuur',
    ar: 'ادمج الصفحات ({n}) ← فاتورة واحدة',
    en: 'Combine {n} pages → one invoice',
  },
  'up.combineerEen': {
    nl: 'Combineer 1 pagina → één factuur',
    ar: 'ادمج صفحة واحدة ← فاتورة واحدة',
    en: 'Combine 1 page → one invoice',
  },
  'up.combinerenMislukt': {
    nl: 'Combineren mislukt — voeg de pagina’s los toe.',
    ar: 'فشل الدمج — أضف الصفحات منفردة.',
    en: 'Combining failed — add the pages separately.',
  },
  'up.dest.bank': {
    nl: 'Bankafschrift',
    ar: 'كشف بنكي',
    en: 'Bank statement',
  },
  'up.dest.bestand': {
    nl: 'Bestand',
    ar: 'ملف',
    en: 'File',
  },
  'up.dest.bon': {
    nl: 'Bon',
    ar: 'إيصال',
    en: 'Receipt',
  },
  'up.dest.controleCheck': {
    nl: 'Controle-check',
    ar: 'فحص مراجعة',
    en: 'Cross-check',
  },
  'up.dest.factuur': {
    nl: 'Factuur',
    ar: 'فاتورة',
    en: 'Invoice',
  },
  'up.dest.kassaOmzet': {
    nl: 'Kassa-omzet',
    ar: 'إيراد الكاشير',
    en: 'Till turnover',
  },
  'up.dest.overzicht': {
    nl: 'Overzicht gecontroleerd',
    ar: 'رُوجع الكشف',
    en: 'Statement checked',
  },
  'up.eenFactuurStrong': {
    nl: 'één factuur',
    ar: 'فاتورة واحدة',
    en: 'one invoice',
  },
  'up.fotosKiezen': {
    nl: 'Foto’s kiezen',
    ar: 'اختيار الصور',
    en: 'Choose photos',
  },
  'up.fotosMaken': {
    nl: 'Foto’s maken',
    ar: 'التقاط صور',
    en: 'Take photos',
  },
  'up.fout.boekenOpnieuw': {
    nl: 'Boeken is niet gelukt — probeer het zo opnieuw.',
    ar: 'لم ينجح التقييد — أعد المحاولة بعد قليل.',
    en: 'Booking did not work — try again in a moment.',
  },
  'up.fout.boekenVerbinding': {
    nl: 'Boeken is niet gelukt — controleer je verbinding en probeer het opnieuw.',
    ar: 'لم ينجح التقييد — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Booking did not work — check your connection and try again.',
  },
  'up.fout.lezen': {
    nl: 'Lezen mislukt — probeer dit bestand opnieuw.',
    ar: 'فشلت القراءة — أعد محاولة هذا الملف.',
    en: 'Reading failed — try this file again.',
  },
  'up.fout.terugzettenVerbinding': {
    nl: 'Terugzetten mislukt — controleer je verbinding en probeer het opnieuw.',
    ar: 'فشلت الإعادة — تحقّق من اتصالك وحاول مرة أخرى.',
    en: 'Putting back failed — check your connection and try again.',
  },
  'up.fout.terugzettenVervers': {
    nl: 'Terugzetten mislukt — ververs de pagina en probeer het opnieuw.',
    ar: 'فشلت الإعادة — حدّث الصفحة وحاول مرة أخرى.',
    en: 'Putting back failed — refresh the page and try again.',
  },
  'up.inWachtrij': {
    nl: 'In wachtrij…',
    ar: 'في قائمة الانتظار…',
    en: 'Queued…',
  },
  'up.kiesFotos': {
    nl: 'Kies foto’s van de pagina’s.',
    ar: 'اختر صور الصفحات.',
    en: 'Choose photos of the pages.',
  },
  'up.kiesHieronder': {
    nl: 'of kies ze hieronder — PDF, foto’s, bankafschriften (MT940/CAMT) én kassa-/grootboek-bestanden (Excel)',
    ar: 'أو اخترها أدناه — PDF وصور وكشوف بنكية (MT940/CAMT) وملفات الكاشير/دفتر الأستاذ (Excel)',
    en: 'or choose them below — PDF, photos, bank statements (MT940/CAMT) and till/ledger files (Excel)',
  },
  'up.klaar': {
    nl: 'Klaar',
    ar: 'تم',
    en: 'Done',
  },
  'up.klaarAandacht': {
    nl: 'Klaar — met aandachtspunten',
    ar: 'تم — مع نقاط تحتاج انتباهاً',
    en: 'Done — with points of attention',
  },
  'up.klaarVerwerkt': {
    nl: 'Klaar — {n} bestand(en) verwerkt',
    ar: 'تم — الملفات المعالَجة: {n}',
    en: 'Done — {n} file(s) processed',
  },
  'up.klaarVink': {
    nl: 'Klaar ✓',
    ar: 'تم ✓',
    en: 'Done ✓',
  },
  'up.maxPaginas': {
    nl: 'Maximaal {n} pagina’s per factuur.',
    ar: 'الحد الأقصى للصفحات في الفاتورة: {n}.',
    en: 'At most {n} pages per invoice.',
  },
  'up.misluktUitleg': {
    nl: 'Mislukt komt meestal door de limiet van 240 documenten per uur of een tijdelijke leesfout — opnieuw proberen lost het vaak op.',
    ar: 'الفشل يكون غالباً بسبب حدّ 240 مستنداً في الساعة أو خطأ قراءة مؤقت — وإعادة المحاولة تحلّه في الغالب.',
    en: 'Failures are usually the 240-documents-per-hour limit or a temporary read error — retrying often fixes it.',
  },
  'up.naarBank': {
    nl: 'Naar Bank',
    ar: 'إلى البنك',
    en: 'To Bank',
  },
  'up.naarBestanden': {
    nl: 'Naar Bestanden',
    ar: 'إلى «الملفات»',
    en: 'To Files',
  },
  'up.naarDagomzet': {
    nl: 'Naar Dagomzet',
    ar: 'إلى «إيراد اليوم»',
    en: 'To Daily turnover',
  },
  'up.naarInkoop': {
    nl: 'Naar Inkoopfacturen',
    ar: 'إلى «فواتير المشتريات»',
    en: 'To Purchase invoices',
  },
  'up.nAutoGeboekt': {
    nl: '{n} automatisch geboekt',
    ar: 'قُيّد تلقائياً: {n}',
    en: '{n} booked automatically',
  },
  'up.nBankafschrift': {
    nl: '{n} bankafschrift',
    ar: 'كشوف بنكية: {n}',
    en: '{n} bank statement',
  },
  'up.nBestand': {
    nl: '{n} bestand',
    ar: 'ملفات: {n}',
    en: '{n} file',
  },
  'up.nControleCheck': {
    nl: '{n} controle-check',
    ar: 'فحوص مراجعة: {n}',
    en: '{n} cross-check',
  },
  'up.nDubbel': {
    nl: '{n} dubbel',
    ar: 'مكرّر: {n}',
    en: '{n} duplicate',
  },
  'up.nFacturen': {
    nl: '{n} facturen',
    ar: '{n} فاتورة',
    en: '{n} invoices',
  },
  'up.nKassaOmzet': {
    nl: '{n} kassa-omzet',
    ar: 'إيراد كاشير: {n}',
    en: '{n} till turnover',
  },
  'up.nMeerdereFacturen': {
    nl: '{n} bestand(en) met meerdere facturen',
    ar: 'ملفات فيها عدة فواتير: {n}',
    en: '{n} file(s) with several invoices',
  },
  'up.nMislukt': {
    nl: '{n} mislukt',
    ar: 'فشل: {n}',
    en: '{n} failed',
  },
  'up.nNietGelezen': {
    nl: '{n} niet gelezen',
    ar: 'لم يُقرأ: {n}',
    en: '{n} not read',
  },
  'up.nr': {
    nl: 'nr. {n}',
    ar: 'رقم {n}',
    en: 'no. {n}',
  },
  'up.nRekeningoverzicht': {
    nl: '{n} rekeningoverzicht',
    ar: 'كشوف حساب: {n}',
    en: '{n} account statement',
  },
  'up.nTeControleren': {
    nl: '{n} factuur/bon te controleren',
    ar: 'فواتير/إيصالات للتدقيق: {n}',
    en: '{n} invoice/receipt to check',
  },
  'up.opnieuwWachtrij': {
    nl: 'Opnieuw in wachtrij…',
    ar: 'في قائمة الانتظار من جديد…',
    en: 'Queued again…',
  },
  'up.paginaFotograferen': {
    nl: 'Pagina fotograferen',
    ar: 'تصوير صفحة',
    en: 'Photograph a page',
  },
  'up.paginasSamenvoegen': {
    nl: 'Pagina’s samenvoegen',
    ar: 'دمج الصفحات',
    en: 'Merge pages',
  },
  'up.paginaVerwijderen': {
    nl: 'Pagina {n} verwijderen',
    ar: 'حذف الصفحة {n}',
    en: 'Remove page {n}',
  },
  'up.reproc.bezig': {
    nl: 'Bezig met boeken…',
    ar: 'جارٍ التقييد…',
    en: 'Booking…',
  },
  'up.reproc.boek': {
    nl: 'Boek mijn opgeslagen bestanden',
    ar: 'قيّد ملفاتي المحفوظة',
    en: 'Book my stored files',
  },
  'up.reproc.geboekt': {
    nl: '✓ {booked} bestand(en) geboekt — {days} dag(en) kassa-omzet.',
    ar: '✓ الملفات المُقيَّدة: {booked} — أيام إيراد الكاشير: {days}.',
    en: '✓ {booked} file(s) booked — {days} day(s) of till turnover.',
  },
  'up.reproc.geboektLedger': {
    nl: '✓ {booked} bestand(en) geboekt — {days} dag(en) kassa-omzet, {ledgerDays} dag(en) controle-check.',
    ar: '✓ الملفات المُقيَّدة: {booked} — أيام إيراد الكاشير: {days}، أيام فحص المراجعة: {ledgerDays}.',
    en: '✓ {booked} file(s) booked — {days} day(s) of till turnover, {ledgerDays} day(s) of cross-check.',
  },
  'up.reproc.geenNieuwe': {
    nl: 'Geen nieuwe kassa-/grootboek-bestanden gevonden om te boeken.',
    ar: 'لم يُعثر على ملفات كاشير أو دفتر أستاذ جديدة لتقييدها.',
    en: 'No new till/ledger files found to book.',
  },
  'up.reproc.nakijken': {
    nl: '{n} nakijken in Dagomzet',
    ar: 'للمراجعة في «إيراد اليوم»: {n}',
    en: '{n} to review in Daily turnover',
  },
  'up.reproc.uitleg': {
    nl: 'Kassa-, grootboek- en dagomzet-bestanden die al in je bestanden staan maar nog niet geboekt zijn, worden hiermee alsnog verwerkt — zonder opnieuw te uploaden. Veilig om te herhalen (corrigeert, telt nooit dubbel).',
    ar: 'ملفات الكاشير ودفتر الأستاذ وإيراد اليوم الموجودة أصلاً في ملفاتك ولم تُقيَّد بعد تُعالَج بهذا لاحقاً — دون رفعها من جديد. تكراره آمن (يُصحّح ولا يَعُدّ مرتين أبداً).',
    en: 'Till, ledger and daily-turnover files already in your files but not yet booked are processed after all — without re-uploading. Safe to repeat (it corrects, never double-counts).',
  },
  'up.selecteerUitleg': {
    nl: 'Je kunt meerdere foto’s of bestanden in één keer selecteren. Eén PDF = één factuur.',
    ar: 'يمكنك اختيار عدة صور أو ملفات دفعة واحدة. ملف PDF واحد = فاتورة واحدة.',
    en: 'You can select several photos or files at once. One PDF = one invoice.',
  },
  'up.teGrootSplits': {
    nl: 'Bestand te groot ({size} MB) — max {max} MB. Maak er een foto van of splits het document.',
    ar: 'الملف كبير جداً ({size} MB) — الحد الأقصى {max} MB. التقط له صورة أو قسّم المستند.',
    en: 'File too large ({size} MB) — max {max} MB. Take a photo of it or split the document.',
  },
  'up.teGrootVerkleinen': {
    nl: 'Bestand te groot ({size} MB) — max {max} MB. Verkleinen lukte niet ver genoeg.',
    ar: 'الملف كبير جداً ({size} MB) — الحد الأقصى {max} MB. التصغير لم يكفِ.',
    en: 'File too large ({size} MB) — max {max} MB. Shrinking did not get far enough.',
  },
  'up.teruggezet': {
    nl: 'Teruggezet — de factuur staat weer in je controlewachtrij op Inkomend.',
    ar: 'أُعيدت — الفاتورة عادت إلى قائمة التدقيق في «الوارد».',
    en: 'Put back — the invoice is in your review queue on Incoming again.',
  },
  'up.terugzettenGenegeerd': {
    nl: 'Terugzetten uit Genegeerd',
    ar: 'إعادة من «Genegeerd»',
    en: 'Put back from Ignored',
  },
  'up.tochToegevoegdRegel': {
    nl: 'Je hebt dit toch toegevoegd — de uitkomst staat op de nieuwe regel hieronder.',
    ar: 'أضفته رغم ذلك — النتيجة في السطر الجديد أدناه.',
    en: 'You added it anyway — the outcome is on the new row below.',
  },
  'up.unreadEen': {
    nl: 'Eén bestand staat veilig in je bestanden, maar kon niet automatisch gelezen worden — er is dus niets van geboekt. Was het een factuur of bon? Maak er dan een scherpere foto van, of controleer het zelf in Bestanden.',
    ar: 'ملف واحد محفوظ بأمان في ملفاتك، لكن تعذّرت قراءته تلقائياً — فلم يُقيَّد منه شيء. هل كان فاتورة أو إيصالاً؟ التقط له صورة أوضح، أو تحقّق منه بنفسك في «الملفات».',
    en: 'One file is safely in your files, but could not be read automatically — so nothing was booked from it. Was it an invoice or receipt? Take a sharper photo of it, or check it yourself in Files.',
  },
  'up.unreadMeer': {
    nl: '{n} bestanden staan veilig in je bestanden, maar konden niet automatisch gelezen worden — er is dus niets van geboekt. Was het een factuur of bon? Maak er dan een scherpere foto van, of controleer het zelf in Bestanden.',
    ar: 'ملفات محفوظة بأمان في ملفاتك: {n}، لكن تعذّرت قراءتها تلقائياً — فلم يُقيَّد منها شيء. هل كانت فاتورة أو إيصالاً؟ التقط لها صورة أوضح، أو تحقّق منها بنفسك في «الملفات».',
    en: '{n} files are safely in your files, but could not be read automatically — so nothing was booked from them. Was it an invoice or receipt? Take a sharper photo, or check them yourself in Files.',
  },
  'up.verkleind': {
    nl: 'Verkleind van {before} MB naar {after} MB — de kleinere versie staat hieronder.',
    ar: 'صُغّر من {before} MB إلى {after} MB — النسخة الأصغر أدناه.',
    en: 'Shrunk from {before} MB to {after} MB — the smaller version is below.',
  },
  'up.verkleinenLukteNiet': {
    nl: 'Verkleinen lukte niet. Splits het document in delen.',
    ar: 'لم ينجح التصغير. قسّم المستند إلى أجزاء.',
    en: 'Shrinking did not work. Split the document into parts.',
  },
  'up.verkleinenNietGenoeg': {
    nl: 'Verkleinen hielp niet genoeg: {before} MB → {after} MB, nog steeds boven de {max} MB. Splits het document in delen.',
    ar: 'التصغير لم يكفِ: من {before} MB إلى {after} MB، وما زال فوق {max} MB. قسّم المستند إلى أجزاء.',
    en: 'Shrinking did not help enough: {before} MB → {after} MB, still above {max} MB. Split the document into parts.',
  },
  'up.verkleinProbeer': {
    nl: 'Verklein en probeer opnieuw',
    ar: 'صغّر وحاول مرة أخرى',
    en: 'Shrink and try again',
  },
  'up.voegEerstToe': {
    nl: 'Voeg eerst pagina’s toe',
    ar: 'أضف صفحات أولاً',
    en: 'Add pages first',
  },
  'up.volgordeUitleg': {
    nl: 'Voeg de pagina’s in volgorde toe. We maken er één PDF van en lezen die als',
    ar: 'أضف الصفحات بالترتيب. سنجمعها في ملف PDF واحد ونقرأه بوصفه',
    en: 'Add the pages in order. We make one PDF of them and read it as',
  },
  'vandaag.afgeboekt': {
    nl: '✓ Afgeboekt als betaald',
    ar: '✓ سُوّيت كمدفوعة',
    en: '✓ Settled as paid',
  },
  'vandaag.bekijken': {
    nl: 'Bekijken',
    ar: 'عرض',
    en: 'View',
  },
  'vandaag.eenFactuur': {
    nl: '1 factuur',
    ar: 'فاتورة واحدة',
    en: '1 invoice',
  },
  'vandaag.meerFacturen': {
    nl: '{n} facturen',
    ar: '{n} فاتورة',
    en: '{n} invoices',
  },
  'vandaag.onbekendePartij': {
    nl: 'Onbekende partij',
    ar: 'طرف غير معروف',
    en: 'Unknown party',
  },
  'vandaag.telaatEen': {
    nl: '1 dag te laat',
    ar: 'متأخرة يوماً واحداً',
    en: '1 day late',
  },
  'vandaag.telaatMeer': {
    nl: '{n} dagen te laat',
    ar: 'أيام التأخر: {n}',
    en: '{n} days late',
  },
  'vandaag.verificatieEen': {
    nl: '1 factuur wacht op verificatie',
    ar: 'فاتورة واحدة بانتظار التدقيق',
    en: '1 invoice awaits verification',
  },
  'vandaag.verificatieMeer': {
    nl: '{n} facturen wachten op verificatie',
    ar: '{n} فاتورة بانتظار التدقيق',
    en: '{n} invoices await verification',
  },
  'vandaag.vervaltMorgen': {
    nl: 'Vervalt morgen',
    ar: 'تستحق غداً',
    en: 'Due tomorrow',
  },
  'vandaag.vervaltOver': {
    nl: 'Vervalt over {n} dagen',
    ar: 'تستحق بعد {n} من الأيام',
    en: 'Due in {n} days',
  },
  'vandaag.vervaltVandaag': {
    nl: 'Vervalt vandaag',
    ar: 'تستحق اليوم',
    en: 'Due today',
  },
  'vandaag.zonderVervalEen': {
    nl: '1 factuur zonder vervaldatum',
    ar: 'فاتورة واحدة بلا تاريخ استحقاق',
    en: '1 invoice without a due date',
  },
  'vandaag.zonderVervalMeer': {
    nl: '{n} facturen zonder vervaldatum',
    ar: '{n} فاتورة بلا تاريخ استحقاق',
    en: '{n} invoices without a due date',
  },
  'vr.antwoordVersturen': {
    nl: 'Antwoord versturen',
    ar: 'إرسال الجواب',
    en: 'Send answer',
  },
  'vr.blijftStaan': {
    nl: 'De vraag blijft hier staan tot je boekhouder hem zelf afvinkt — wij zetten geen vinkje namens hem.',
    ar: 'يبقى السؤال هنا حتى يشطبه المحاسب بنفسه — نحن لا نضع علامة نيابة عنه.',
    en: 'The question stays here until your accountant ticks it off — we never tick it on their behalf.',
  },
  'vr.datumOnbekend': {
    nl: 'Datum onbekend',
    ar: 'التاريخ غير معروف',
    en: 'Date unknown',
  },
  'vr.fout.betekentNiet': {
    nl: 'Dit betekent niet dat er niets openstaat — we konden de lijst even niet lezen.',
    ar: 'هذا لا يعني أنه لا شيء معلّقاً — لم نستطع قراءة القائمة الآن فحسب.',
    en: 'This does not mean nothing is open — we just could not read the list right now.',
  },
  'vr.fout.versturen': {
    nl: 'Versturen mislukt. Probeer het opnieuw.',
    ar: 'فشل الإرسال. حاول مرة أخرى.',
    en: 'Sending failed. Please try again.',
  },
  'vr.geen.metBoekhouder': {
    nl: 'Er staat op dit moment niets van je boekhouder open. Zodra er een vraag komt, krijg je er bericht van en staat hij hier.',
    ar: 'لا يوجد حالياً شيء معلّق من المحاسب. حين يصل سؤال ستتلقى إشعاراً وسيظهر هنا.',
    en: 'Nothing from your accountant is open right now. As soon as a question arrives you get a notification and it appears here.',
  },
  'vr.geen.zonderBoekhouder': {
    nl: 'Je hebt nog geen boekhouder gekoppeld. Zodra dat gebeurt, komen zijn vragen hier binnen.',
    ar: 'لم تربط محاسباً بعد. حين يحدث ذلك ستصل أسئلته إلى هنا.',
    en: 'You have not linked an accountant yet. Once you do, their questions arrive here.',
  },
  'vr.geenKoppeling': {
    nl: 'Er is op dit moment geen boekhouder aan je account gekoppeld, dus we kunnen je antwoord nergens naartoe sturen.',
    ar: 'لا يوجد حالياً محاسب مرتبط بحسابك، لذا لا يمكننا إرسال جوابك إلى أي جهة.',
    en: 'No accountant is linked to your account right now, so we have nowhere to send your answer.',
  },
  'vr.geenToelichting': {
    nl: 'Je boekhouder heeft dit bestand als vraag gemarkeerd, maar er geen toelichting bij geschreven. Vraag gerust wat hij precies nodig heeft.',
    ar: 'علّم المحاسب هذا الملف كسؤال لكنه لم يكتب توضيحاً. لا تتردد في سؤاله عمّا يحتاجه بالضبط.',
    en: 'Your accountant marked this file as a question but wrote no explanation. Feel free to ask what exactly they need.',
  },
  'vr.gevraagdOp': {
    nl: 'Gevraagd op {datum}',
    ar: 'سُئل بتاريخ {datum}',
    en: 'Asked on {datum}',
  },
  'vr.inPrullenbak': {
    nl: 'ligt in je prullenbak',
    ar: 'موجود في سلة مهملاتك',
    en: 'is in your trash',
  },
  'vr.naam.bestandWeg': {
    nl: 'Een bestand dat we niet meer kunnen tonen',
    ar: 'ملف لم يعد بإمكاننا عرضه',
    en: 'A file we can no longer show',
  },
  'vr.naam.factuurWeg': {
    nl: 'Een factuur die we niet meer kunnen tonen',
    ar: 'فاتورة لم يعد بإمكاننا عرضها',
    en: 'An invoice we can no longer show',
  },
  'vr.naam.naamloos': {
    nl: 'Naamloos bestand',
    ar: 'ملف بلا اسم',
    en: 'Unnamed file',
  },
  'vr.uitleg.metNaam': {
    nl: 'Als {naam} iets mist of niet begrijpt bij een van je bestanden, staat de vraag hier. Je antwoord komt bij hem of haar binnen als bericht — je hoeft er geen app voor te wisselen.',
    ar: 'إذا كان ينقص {naam} شيء أو لم يفهم أحد ملفاتك، فسيظهر السؤال هنا. يصل جوابك إليه كرسالة — دون أن تبدّل التطبيق.',
    en: 'If {naam} is missing something or does not understand one of your files, the question appears here. Your answer reaches them as a message — no need to switch apps.',
  },
  'vr.uitleg.zonderNaam': {
    nl: 'Als je boekhouder iets mist of niet begrijpt bij een van je bestanden, staat de vraag hier. Je antwoord komt bij je boekhouder binnen als bericht — je hoeft er geen app voor te wisselen.',
    ar: 'إذا كان ينقص المحاسب شيء أو لم يفهم أحد ملفاتك، فسيظهر السؤال هنا. يصل جوابك إلى المحاسب كرسالة — دون أن تبدّل التطبيق.',
    en: 'If your accountant is missing something or does not understand one of your files, the question appears here. Your answer reaches your accountant as a message — no need to switch apps.',
  },
  'waarheid.aandachtNodig': {
    nl: 'DIT HEEFT JE AANDACHT NODIG',
    ar: 'هذا يحتاج انتباهك',
    en: 'THIS NEEDS YOUR ATTENTION',
  },
  'waarheid.bankBijgewerkt': {
    nl: 'bank bijgewerkt tot {datum}',
    ar: 'البنك محدَّث حتى {datum}',
    en: 'bank updated up to {datum}',
  },
  'waarheid.geenAllesBij': {
    nl: 'Dit is géén "alles is bij" — we konden je cijfers even niet ophalen.',
    ar: 'هذا ليس «كل شيء محدَّث» — لم نستطع جلب أرقامك الآن.',
    en: 'This is NOT an “all caught up” — we just could not fetch your figures.',
  },
  'waarheid.saldoDeels': {
    nl: 'van één rekening is geen saldo bekend',
    ar: 'رصيد أحد الحسابات غير معروف',
    en: 'one account has no known balance',
  },
  'waarheid.saldoOp': {
    nl: 'saldo op {datum}',
    ar: 'الرصيد بتاريخ {datum}',
    en: 'balance on {datum}',
  },
  'waarheid.waarJeStaat': {
    nl: 'WAAR JE STAAT',
    ar: 'أين تقف',
    en: 'WHERE YOU STAND',
  },
  'wh.anderKwartaal': {
    nl: 'Ander kwartaal',
    ar: 'ربع آخر',
    en: 'Another quarter',
  },
  'wh.btw.aanBd': {
    nl: 'aan de Belastingdienst, over deze periode',
    ar: 'لمصلحة الضرائب، عن هذه الفترة',
    en: 'to the tax office, over this period',
  },
  'wh.btw.eerstTarieven': {
    nl: 'eerst tarieven toekennen',
    ar: 'عيّن النسب أولاً',
    en: 'assign rates first',
  },
  'wh.btw.incompleet': {
    nl: 'Nog niet compleet: {bedrag} omzet heeft geen BTW-tarief, dus dit bedrag is te laag.',
    ar: 'غير مكتمل بعد: {bedrag} من الإيراد بلا نسبة btw، فهذا المبلغ منخفض.',
    en: 'Not complete yet: {bedrag} of revenue has no VAT rate, so this amount is too low.',
  },
  'wh.btw.moetBetalen': {
    nl: 'BTW die je moet betalen',
    ar: 'btw عليك دفعها',
    en: 'VAT you must pay',
  },
  'wh.btw.nogNiet': {
    nl: 'BTW — nog niet te zeggen',
    ar: 'btw — لا يمكن الجزم بعد',
    en: 'VAT — too early to say',
  },
  'wh.btw.terug': {
    nl: 'BTW die je terugkrijgt',
    ar: 'btw تستردها',
    en: 'VAT you get back',
  },
  'wh.btw.vanBd': {
    nl: 'van de Belastingdienst, over deze periode',
    ar: 'من مصلحة الضرائب، عن هذه الفترة',
    en: 'from the tax office, over this period',
  },
  'wh.btw.voorlopig': {
    nl: 'voorlopig',
    ar: 'مؤقتاً',
    en: 'provisional',
  },
  'wh.btw.zonderTariefRest': {
    nl: 'van je omzet heeft nog geen BTW-tarief. Zodra je die tarieven toekent, wordt dit waarschijnlijk een bedrag dat je juist moet betalen. Reken er dus nog niet op.',
    ar: 'من إيرادك ما يزال بلا نسبة btw. حين تعيّن تلك النسب سيصبح هذا على الأرجح مبلغاً عليك دفعه أنت. فلا تعتمد عليه بعد.',
    en: 'of your revenue still has no VAT rate. Once you assign those rates, this will likely become an amount you must pay instead. So do not count on it yet.',
  },
  'wh.chip.afgesloten': {
    nl: 'afgesloten periode',
    ar: 'فترة مقفلة',
    en: 'closed period',
  },
  'wh.chip.ingediend': {
    nl: '🔒 Ingediend · definitief',
    ar: '🔒 مقدَّم · نهائي',
    en: '🔒 Filed · final',
  },
  'wh.chip.looptNog': {
    nl: 'loopt nog',
    ar: 'ما يزال جارياً',
    en: 'still running',
  },
  'wh.chip.onbekend': {
    nl: 'indienstatus onbekend',
    ar: 'حالة التقديم غير معروفة',
    en: 'filing status unknown',
  },
  'wh.div.gewijzigd': {
    nl: 'Let op — dit kwartaal is gewijzigd',
    ar: 'انتبه — تغيّر هذا الربع',
    en: 'Note — this quarter has changed',
  },
  'wh.div.meerBetalen': {
    nl: 'je moet meer betalen',
    ar: 'عليك أن تدفع أكثر',
    en: 'you must pay more',
  },
  'wh.div.meerTerug': {
    nl: 'je krijgt meer terug',
    ar: 'ستسترد أكثر',
    en: 'you get more back',
  },
  'wh.div.onderliggend': {
    nl: 'De cijfers van dit kwartaal zijn veranderd sinds je indiening, maar het BTW-saldo en je resultaat zijn gelijk gebleven. Controleer de onderliggende posten.',
    ar: 'تغيّرت أرقام هذا الربع منذ تقديمك، لكن رصيد الضريبة ونتيجتك بقيا كما هما. راجع البنود الأساسية.',
    en: 'The figures of this quarter changed since your filing, but the VAT balance and your result stayed the same. Check the underlying items.',
  },
  'wh.div.resultaatMet': {
    nl: 'Je resultaat over dit kwartaal is met',
    ar: 'تغيّرت نتيجتك عن هذا الربع بمقدار',
    en: 'Your result for this quarter has by',
  },
  'wh.div.suppletieMeer': {
    nl: 'Dat is meer dan €1.000 — dien een suppletie in bij de Belastingdienst.',
    ar: 'هذا أكثر من €1.000 — قدّم إقراراً تصحيحياً (suppletie) لدى مصلحة الضرائب.',
    en: 'That is more than €1,000 — file a correction (suppletie) with the tax office.',
  },
  'wh.div.suppletieOnder': {
    nl: 'Onder €1.000 mag je dit verwerken in je volgende aangifte.',
    ar: 'أقل من €1.000 يجوز إدراجه في إقرارك القادم.',
    en: 'Under €1,000 you may process this in your next return.',
  },
  'wh.div.terwijlGelijk': {
    nl: 'terwijl de BTW gelijk bleef — er is dus niets te corrigeren bij de Belastingdienst, maar je winst voor de inkomstenbelasting is veranderd.',
    ar: 'بينما بقيت الضريبة كما هي — فلا شيء يُصحَّح لدى مصلحة الضرائب، لكن ربحك لضريبة الدخل تغيّر.',
    en: 'while the VAT stayed the same — so nothing to correct with the tax office, but your profit for income tax has changed.',
  },
  'wh.filed.ingediendOp': {
    nl: 'Ingediend op {datum}',
    ar: 'قُدّم بتاريخ {datum}',
    en: 'Filed on {datum}',
  },
  'wh.filed.looptNog': {
    nl: 'Dit kwartaal loopt nog — je kunt het pas na afloop als ingediend markeren.',
    ar: 'هذا الربع ما يزال جارياً — لا يمكنك تعليمه كمقدَّم إلا بعد انتهائه.',
    en: 'This quarter is still running — you can mark it as filed only after it ends.',
  },
  'wh.filed.markeer': {
    nl: 'Markeer als ingediend bij de Belastingdienst',
    ar: 'علّمه كمقدَّم لدى مصلحة الضرائب',
    en: 'Mark as filed with the tax office',
  },
  'wh.filed.mislukt': {
    nl: 'Markeren als ingediend is niet gelukt — probeer het opnieuw.',
    ar: 'لم ينجح التعليم كمقدَّم — حاول مرة أخرى.',
    en: 'Marking as filed did not work — please try again.',
  },
  'wh.filed.nietGecontroleerd': {
    nl: 'Dit kwartaal is nog niet volledig gecontroleerd.',
    ar: 'هذا الربع لم يُراجَع كاملاً بعد.',
    en: 'This quarter has not been fully checked yet.',
  },
  'wh.filed.ongedaan': {
    nl: 'Indiening ongedaan maken',
    ar: 'التراجع عن التقديم',
    en: 'Undo filing',
  },
  'wh.filed.ongedaanMislukt': {
    nl: 'Indiening ongedaan maken is niet gelukt — probeer het opnieuw.',
    ar: 'لم ينجح التراجع عن التقديم — حاول مرة أخرى.',
    en: 'Undoing the filing did not work — please try again.',
  },
  'wh.filed.opnieuwMislukt': {
    nl: 'Opnieuw indienen is niet gelukt.',
    ar: 'لم تنجح إعادة التقديم.',
    en: 'Re-filing did not work.',
  },
  'wh.filed.tochBevestig': {
    nl: 'Ja, markeer als ingediend',
    ar: 'نعم، علّمه كمقدَّم',
    en: 'Yes, mark as filed',
  },
  'wh.filed.tochVraag': {
    nl: 'Toch als ingediend markeren?',
    ar: 'هل تعلّمه كمقدَّم رغم ذلك؟',
    en: 'Mark as filed anyway?',
  },
  'wh.filed.uitlegLooptNog': {
    nl: 'Dit kwartaal loopt nog. Zodra het is afgelopen kun je het hier als ingediend markeren en leggen we de cijfers vast.',
    ar: 'هذا الربع ما يزال جارياً. حين ينتهي يمكنك تعليمه هنا كمقدَّم فنثبّت الأرقام.',
    en: 'This quarter is still running. Once it has ended you can mark it as filed here and we freeze the figures.',
  },
  'wh.filed.uitlegOnbekend': {
    nl: 'We konden niet controleren of dit kwartaal al is ingediend, dus we laten je het nu niet vastleggen — anders zou je een eerdere indiening kunnen overschrijven. Ververs de pagina.',
    ar: 'لم نستطع التحقق مما إذا كان هذا الربع قد قُدّم، فلن ندعك تثبّته الآن — وإلا لربما استبدلت تقديماً سابقاً. حدّث الصفحة.',
    en: 'We could not check whether this quarter is already filed, so we will not let you freeze it now — you might overwrite an earlier filing. Refresh the page.',
  },
  'wh.filed.uitlegVastleggen': {
    nl: 'Dit legt de cijfers van dit kwartaal vast. Komt er later nog een factuur bij, dan zien we het verschil en zeggen we of een suppletie nodig is.',
    ar: 'هذا يثبّت أرقام هذا الربع. إن أُضيفت فاتورة لاحقاً نرى الفرق ونخبرك إن لزم إقرار تصحيحي.',
    en: 'This freezes this quarter’s figures. If an invoice arrives later, we see the difference and tell you whether a correction is needed.',
  },
  'wh.filed.vervangBevestig': {
    nl: 'Ja, vervang',
    ar: 'نعم، استبدل',
    en: 'Yes, replace',
  },
  'wh.filed.vervangUitleg': {
    nl: 'Dit kwartaal staat al als ingediend. Opnieuw indienen vervangt die vastgelegde cijfers.',
    ar: 'هذا الربع معلَّم كمقدَّم مسبقاً. إعادة التقديم تستبدل الأرقام المثبتة.',
    en: 'This quarter is already marked as filed. Filing again replaces those frozen figures.',
  },
  'wh.filed.vervangVraag': {
    nl: 'Vervang je eerdere indiening?',
    ar: 'هل تريد استبدال تقديمك السابق؟',
    en: 'Replace your earlier filing?',
  },
  'wh.intro': {
    nl: 'Eén doorlopend beeld, live berekend uit je facturen, bank en kas. Kies een periode.',
    ar: 'صورة واحدة متصلة، تُحسب مباشرة من فواتيرك وبنكك ونقدك. اختر فترة.',
    en: 'One continuous picture, computed live from your invoices, bank and cash. Pick a period.',
  },
  'wh.lens.ditJaar': {
    nl: 'Dit jaar',
    ar: 'هذه السنة',
    en: 'This year',
  },
  'wh.lens.ditKwartaal': {
    nl: 'Dit kwartaal',
    ar: 'هذا الربع',
    en: 'This quarter',
  },
  'wh.lens.vorigKwartaal': {
    nl: 'Vorig kwartaal',
    ar: 'الربع الماضي',
    en: 'Last quarter',
  },
  'wh.pin.acquirer': {
    nl: 'Deze commissie stond al op een factuur van de acquirer ({bedrag}) en is daar al als kosten geboekt — hier dus alleen ter controle.',
    ar: 'هذه العمولة كانت مسجلة مسبقاً على فاتورة المشغّل ({bedrag}) ومسجلة هناك كمصروف — فهي هنا للمراجعة فقط.',
    en: 'This commission was already on an acquirer invoice ({bedrag}) and is booked as a cost there — shown here only as a check.',
  },
  'wh.pin.commissieDagen': {
    nl: '{n} dag(en) waar de bank-uitbetaling niet bij de kaartomzet van die dag past. Daar is geen commissie geboekt — de uitbetaling hoort waarschijnlijk (deels) bij een andere dag.',
    ar: 'عدد الأيام التي لا تطابق فيها دفعةُ البنك إيرادَ البطاقات لذلك اليوم: {n}. لم تُسجَّل عمولة هناك — الدفعة تخص على الأرجح (جزئياً) يوماً آخر.',
    en: '{n} day(s) where the bank payout does not fit that day’s card takings. No commission was booked there — the payout probably (partly) belongs to another day.',
  },
  'wh.pin.geboekt': {
    nl: 'Hiervan is {bedrag} als kosten verwerkt in het resultaat hierboven — BTW-vrij (vrijstelling betalingsverkeer).',
    ar: 'منها {bedrag} مُدرج كمصروف في النتيجة أعلاه — معفى من btw (إعفاء خدمات الدفع).',
    en: 'Of this, {bedrag} is processed as a cost in the result above — VAT-free (payment services exemption).',
  },
  'wh.pin.gemeten': {
    nl: 'gemeten commissie',
    ar: 'العمولة المقيسة',
    en: 'measured commission',
  },
  'wh.pin.incompleteDagen': {
    nl: '{n} dag(en) nog niet compleet — upload de terminal-afrekening of het bankafschrift voor een volledige controle.',
    ar: 'عدد الأيام غير المكتملة بعد: {n} — ارفع تسوية الجهاز أو كشف البنك لمراجعة كاملة.',
    en: '{n} day(s) not complete yet — upload the terminal settlement or the bank statement for a full check.',
  },
  'wh.pin.kasUitleg': {
    nl: 'Onder kasstelsel wordt deze commissie niet automatisch als kosten geboekt: ze is aftrekbaar op het moment dat je de factuur van de acquirer betaalt. Boek die factuur, dan telt de commissie in de juiste periode mee.',
    ar: 'في النظام النقدي لا تُسجَّل هذه العمولة تلقائياً كمصروف: فهي قابلة للخصم حين تدفع فاتورة المشغّل (acquirer). سجّل تلك الفاتورة فتُحتسب العمولة في الفترة الصحيحة.',
    en: 'Under the cash scheme this commission is not booked as a cost automatically: it is deductible the moment you pay the acquirer’s invoice. Book that invoice and the commission counts in the right period.',
  },
  'wh.pin.mismatch': {
    nl: '{n} dag(en) waar de kassa-PIN ≠ de terminal-afrekening. Beide zijn bruto, dus dit is een echt verschil (ontbrekende bon of terminalstoring) — geen commissie. Controleer die dagen.',
    ar: 'عدد الأيام التي لا يساوي فيها «pin» الكاشير تسويةَ الجهاز: {n}. كلاهما إجمالي، فهذا فرق حقيقي (إيصال ناقص أو عطل في الجهاز) — لا عمولة. راجع تلك الأيام.',
    en: '{n} day(s) where the till card total ≠ the terminal settlement. Both are gross, so this is a real difference (missing receipt or terminal fault) — not commission. Check those days.',
  },
  'wh.pin.overige': {
    nl: 'De overige {bedrag} stond al op een factuur van de acquirer en is dus niet nog eens geboekt.',
    ar: 'الباقي {bedrag} كان مسجلاً مسبقاً على فاتورة المشغّل فلم يُسجَّل مرة أخرى.',
    en: 'The remaining {bedrag} was already on an acquirer invoice and was therefore not booked again.',
  },
  'wh.pin.sub': {
    nl: 'kassa · terminal · bank moeten hetzelfde zeggen',
    ar: 'الكاشير · الجهاز · البنك يجب أن تقول الشيء نفسه',
    en: 'till · terminal · bank must say the same thing',
  },
  'wh.pin.vanTerminal': {
    nl: 'van de terminal',
    ar: 'من الجهاز',
    en: 'from the terminal',
  },
  'wh.pin.zodra': {
    nl: 'Zodra de bank-uitbetaling én de terminal-afrekening er allebei zijn, boeken we het verschil als betaalkosten.',
    ar: 'حين يتوفر كل من دفعة البنك وتسوية الجهاز، نسجّل الفرق كتكاليف دفع.',
    en: 'Once both the bank payout and the terminal settlement are in, we book the difference as payment costs.',
  },
  'wh.sub.kosten': {
    nl: 'wat je uitgaf',
    ar: 'ما أنفقته',
    en: 'what you spent',
  },
  'wh.sub.omzet': {
    nl: 'wat je verdiende',
    ar: 'ما كسبته',
    en: 'what you earned',
  },
  'wh.sub.resultaat': {
    nl: 'omzet − kosten · je winst',
    ar: 'الإيراد − المصاريف · ربحك',
    en: 'revenue − costs · your profit',
  },
  'wh.sub.verschuldigd': {
    nl: 'verschuldigd',
    ar: 'المستحق',
    en: 'due',
  },
  'wh.sub.voorbelasting': {
    nl: 'voorbelasting',
    ar: 'ضريبة المشتريات',
    en: 'input VAT',
  },
  'wh.todo.bankZonderCategorie': {
    nl: '{delen} aan bankmutaties heeft nog geen categorie. Die tellen niet mee in de cijfers hierboven — pas als je ze codeert, kloppen omzet en kosten.',
    ar: 'حركات بنكية بلا فئة بعد ({delen}). لا تُحتسب في الأرقام أعلاه — لن يصح الإيراد والمصاريف إلا بعد ترميزها.',
    en: '{delen} of bank movements still has no category. They do not count in the figures above — only once you code them do revenue and costs add up.',
  },
  'wh.todo.betaaldatumEen': {
    nl: '1 betaalde factuur mist een betaaldatum. Onder kasstelsel kan die BTW nog niet in de juiste periode worden geplaatst.',
    ar: 'فاتورة مدفوعة واحدة ينقصها تاريخ الدفع. في النظام النقدي لا يمكن وضع ضريبتها في الفترة الصحيحة بعد.',
    en: '1 paid invoice is missing a payment date. Under the cash scheme its VAT cannot yet be placed in the right period.',
  },
  'wh.todo.betaaldatumMeer': {
    nl: '{n} betaalde facturen missen een betaaldatum. Onder kasstelsel kan die BTW nog niet in de juiste periode worden geplaatst.',
    ar: '{n} فاتورة مدفوعة ينقصها تاريخ الدفع. في النظام النقدي لا يمكن وضع ضريبتها في الفترة الصحيحة بعد.',
    en: '{n} paid invoices are missing a payment date. Under the cash scheme that VAT cannot yet be placed in the right period.',
  },
  'wh.todo.categoriseren': {
    nl: 'Categoriseren',
    ar: 'صنّف',
    en: 'Categorise',
  },
  'wh.todo.controleren': {
    nl: 'Controleren',
    ar: 'راجِع',
    en: 'Check',
  },
  'wh.todo.datumInvullen': {
    nl: 'Datum invullen',
    ar: 'املأ التاريخ',
    en: 'Fill in the date',
  },
  'wh.todo.en': {
    nl: 'en',
    ar: 'و',
    en: 'and',
  },
  'wh.todo.eraf': {
    nl: '{bedrag} eraf',
    ar: 'صادر: {bedrag}',
    en: '{bedrag} out',
  },
  'wh.todo.erbij': {
    nl: '{bedrag} erbij',
    ar: 'وارد: {bedrag}',
    en: '{bedrag} in',
  },
  'wh.todo.geenDatumEen': {
    nl: '1 factuur heeft geen datum, dus die telt in geen enkele periode mee.',
    ar: 'فاتورة واحدة بلا تاريخ، فلا تُحتسب في أي فترة.',
    en: '1 invoice has no date, so it counts in no period at all.',
  },
  'wh.todo.geenDatumMeer': {
    nl: '{n} facturen hebben geen datum, dus die tellen in geen enkele periode mee.',
    ar: '{n} فاتورة بلا تاريخ، فلا تُحتسب في أي فترة.',
    en: '{n} invoices have no date, so they count in no period at all.',
  },
  'wh.todo.koppelen': {
    nl: 'Koppelen',
    ar: 'اربط',
    en: 'Link',
  },
  'wh.todo.naarDagomzet': {
    nl: 'Naar Dagomzet',
    ar: 'إلى إيراد اليوم',
    en: 'To Daily takings',
  },
  'wh.todo.naarKas': {
    nl: 'Naar Kas',
    ar: 'إلى النقد',
    en: 'To Cash',
  },
  'wh.todo.ongecontroleerdEen': {
    nl: '1 inkoopfactuur is nog niet gecontroleerd. Het bedrag telt nog niet mee in je kosten en BTW.',
    ar: 'فاتورة مشتريات واحدة لم تُراجَع بعد. مبلغها لا يُحتسب بعد في مصاريفك وضريبتك.',
    en: '1 purchase invoice has not been checked yet. Its amount does not yet count in your costs and VAT.',
  },
  'wh.todo.ongecontroleerdMeer': {
    nl: '{n} inkoopfacturen zijn nog niet gecontroleerd. Die bedragen tellen nog niet mee in je kosten en BTW.',
    ar: '{n} فاتورة مشتريات لم تُراجَع بعد. مبالغها لا تُحتسب بعد في مصاريفك وضريبتك.',
    en: '{n} purchase invoices have not been checked yet. Those amounts do not yet count in your costs and VAT.',
  },
  'wh.todo.zonderTarief': {
    nl: '{bedrag} omzet heeft nog geen BTW-tarief. Daardoor is de BTW hierboven te laag.',
    ar: '{bedrag} من الإيراد ما يزال بلا نسبة btw. لذلك فالضريبة أعلاه منخفضة.',
    en: '{bedrag} of revenue still has no VAT rate. The VAT above is therefore too low.',
  },
  'wh.voet.berekendFactuur': {
    nl: 'Alles hierboven is op factuurstelsel berekend. Bekijk per kwartaal voor de cijfers zoals je ze aangeeft.',
    ar: 'كل ما أعلاه محسوب على نظام الفواتير. اعرض لكل ربع للأرقام كما تقدّمها.',
    en: 'Everything above is computed on the invoice scheme. View per quarter for the figures as you file them.',
  },
  'wh.voet.berekendKas': {
    nl: 'Alles hierboven is op kasstelsel berekend. Bekijk per kwartaal voor de cijfers zoals je ze aangeeft.',
    ar: 'كل ما أعلاه محسوب على النظام النقدي. اعرض لكل ربع للأرقام كما تقدّمها.',
    en: 'Everything above is computed on the cash scheme. View per quarter for the figures as you file them.',
  },
  'wh.voet.factuur': {
    nl: 'Op basis van factuurdatum, niet betaaldatum. Dit is dus je fiscale winst, niet wat er op je rekening staat.',
    ar: 'على أساس تاريخ الفاتورة لا تاريخ الدفع. فهذا ربحك الضريبي، لا ما في حسابك.',
    en: 'Based on the invoice date, not the payment date. So this is your fiscal profit, not what is in your account.',
  },
  'wh.voet.grootboek': {
    nl: 'De controle tegen je PIN-grootboek kon niet worden uitgevoerd — verschillen tussen kassa en grootboek zijn hierboven dus niet meegewogen.',
    ar: 'تعذّرت المراجعة مقابل دفتر «pin» — فروق الكاشير والدفتر إذن غير محسوبة أعلاه.',
    en: 'The check against your card ledger could not run — differences between till and ledger are therefore not weighed in above.',
  },
  'wh.voet.kas': {
    nl: 'Kasstelsel — op basis van betaaldatum: een onbetaalde factuur telt pas mee zodra hij betaald is.',
    ar: 'النظام النقدي — على أساس تاريخ الدفع: الفاتورة غير المدفوعة لا تُحتسب إلا بعد دفعها.',
    en: 'Cash scheme — based on the payment date: an unpaid invoice counts only once it is paid.',
  },
  'wh.voet.overstap': {
    nl: 'Deze periode loopt door je overstap naar het kasstelsel heen.',
    ar: 'تمتد هذه الفترة عبر انتقالك إلى النظام النقدي.',
    en: 'This period spans your switch to the cash scheme.',
  },
  'wh.voet.overstapPer': {
    nl: 'Deze periode loopt door je overstap naar het kasstelsel heen (per {datum}).',
    ar: 'تمتد هذه الفترة عبر انتقالك إلى النظام النقدي (اعتباراً من {datum}).',
    en: 'This period spans your switch to the cash scheme (as of {datum}).',
  },
  'wh.voet.schattingEen': {
    nl: 'Bij 1 betaling is de betaaldatum een schatting (handmatig op betaald gezet) — controleer of de periode klopt.',
    ar: 'في دفعة واحدة تاريخُ الدفع تقديري (عُلّمت كمدفوعة يدوياً) — تحقّق من صحة الفترة.',
    en: 'For 1 payment the payment date is an estimate (marked paid manually) — check that the period is right.',
  },
  'wh.voet.schattingMeer': {
    nl: 'Bij {n} betalingen is de betaaldatum een schatting (handmatig op betaald gezet) — controleer of de periode klopt.',
    ar: 'في {n} دفعة تاريخُ الدفع تقديري (عُلّمت كمدفوعة يدوياً) — تحقّق من صحة الفترة.',
    en: 'For {n} payments the payment date is an estimate (marked paid manually) — check that the period is right.',
  },
  'wp.bestanden.sub': {
    nl: 'Bonnen en documenten',
    ar: 'إيصالات ومستندات',
    en: 'Receipts and documents',
  },
  'wp.brug': {
    nl: 'De Brug',
    ar: 'De Brug (الجسر)',
    en: 'De Brug',
  },
  'wp.brug.sub': {
    nl: 'Zie hoe je facturen en documenten verbonden zijn',
    ar: 'اعرف كيف ترتبط فواتيرك بمستنداتك',
    en: 'See how your invoices and documents are connected',
  },
  'wp.facturen': {
    nl: 'Mijn facturen',
    ar: 'فواتيري',
    en: 'My invoices',
  },
  'wp.facturen.sub': {
    nl: 'Verstuur en beheer',
    ar: 'أرسل وأدر',
    en: 'Send and manage',
  },
  'wp.gegevens': {
    nl: 'Mijn gegevens',
    ar: 'بياناتي',
    en: 'My details',
  },
  'wp.gegevens.sub': {
    nl: 'Bedrijf en account',
    ar: 'الشركة والحساب',
    en: 'Company and account',
  },
  'wp.klanten': {
    nl: 'Mijn klanten',
    ar: 'عملائي',
    en: 'My clients',
  },
  'wp.klanten.sub': {
    nl: 'Klantgegevens en history',
    ar: 'بيانات العملاء وسجلّهم',
    en: 'Client details and history',
  },
  'wp.kluis': {
    nl: 'Compliance-kluis',
    ar: 'خزنة الامتثال',
    en: 'Compliance vault',
  },
  'wp.kluis.sub': {
    nl: '7 jaar bewaren, klaar voor je boekhouder',
    ar: 'حفظ 7 سنوات، جاهز للمحاسب',
    en: 'Kept for 7 years, ready for your accountant',
  },

  // ── [TAAL-BLIND] The 472 strings the first scanner could not see — multi-line text
  // nodes and strings inside JSX expressions. Translated in one sweep; the extended gate
  // patterns above the SCREENS list are what keeps this from regrowing.
  'aang.geenVerbinding': {
    nl: 'Geen verbinding — probeer het zo meteen opnieuw.',
    ar: 'لا يوجد اتصال — حاول مرة أخرى بعد قليل.',
    en: 'No connection — try again in a moment.',
  },
  'aang.ladenMislukt': {
    nl: 'Kon de concept-aangifte niet laden. Probeer het zo meteen opnieuw.',
    ar: 'تعذّر تحميل مسودة الإقرار. حاول مرة أخرى بعد قليل.',
    en: 'Could not load the draft return. Try again in a moment.',
  },
  'aang.ladenMisluktKort': {
    nl: 'Kon de concept-aangifte niet laden.',
    ar: 'تعذّر تحميل مسودة الإقرار.',
    en: 'Could not load the draft return.',
  },
  'aang.sessieVerlopen': {
    nl: 'Je sessie is verlopen — log opnieuw in.',
    ar: 'انتهت جلستك — سجّل الدخول من جديد.',
    en: 'Your session has expired — log in again.',
  },
  'abo.beheerUitleg': {
    nl: 'Betaalgegevens wijzigen, btw-facturen downloaden of opzeggen.',
    ar: 'تغيير بيانات الدفع، أو تنزيل فواتير الضريبة (btw)، أو الإلغاء.',
    en: 'Change payment details, download btw invoices, or cancel.',
  },
  'abo.neem': {
    nl: 'Neem een abonnement',
    ar: 'احصل على اشتراك',
    en: 'Get a subscription',
  },
  'bewerk.betalenOp': {
    nl: 'Betalen op',
    ar: 'يُدفع إلى',
    en: 'Pay to',
  },
  'datum.geenBestaande': {
    nl: 'Dat is geen bestaande datum — gebruik dd-mm-jjjj.',
    ar: 'هذا ليس تاريخًا موجودًا — استخدم dd-mm-jjjj.',
    en: 'That is not an existing date — use dd-mm-jjjj.',
  },
  'lijst.geenBetaalde': {
    nl: 'Geen betaalde facturen',
    ar: 'لا توجد فواتير مدفوعة',
    en: 'No paid invoices',
  },
  'lijst.nogGeen': {
    nl: 'Nog geen facturen',
    ar: 'لا توجد فواتير بعد',
    en: 'No invoices yet',
  },
  'onb.anderProgramma': {
    nl: 'Kom je van een ander programma? Vul je volgende factuurnummer in — wij gaan verder waar jij gebleven bent.',
    ar: 'قادم من برنامج آخر؟ أدخل رقم فاتورتك التالي — ونحن نكمل من حيث توقفت أنت.',
    en: 'Coming from another program? Enter your next invoice number — we pick up where you left off.',
  },
  'onb.nogGeenBoekhouder': {
    nl: 'Nog geen boekhouder? Sla dit gerust over. Je kunt hem later in één klik koppelen, en voor hem is BoekBrug altijd gratis.',
    ar: 'ليس لديك محاسب بعد؟ تجاوز هذه الخطوة بلا تردد. يمكنك ربطه لاحقًا بنقرة واحدة، ويبقى BoekBrug مجانيًا له دائمًا.',
    en: 'No accountant yet? Feel free to skip this. You can connect him later in one click, and for him BoekBrug is always free.',
  },
  'onb.overgenomenUitFactuur': {
    nl: 'We hebben dit overgenomen uit de factuur die je net maakte. Controleer het even en pas aan wat niet klopt.',
    ar: 'أخذنا هذه البيانات من الفاتورة التي أنشأتها للتو. راجعها سريعًا وعدّل ما لا يصح.',
    en: 'We took this from the invoice you just made. Check it briefly and adjust anything that is off.',
  },
  'prul.autoVerwijderd': {
    nl: 'Bestanden in de prullenbak worden na 30 dagen automatisch permanent verwijderd.',
    ar: 'تُحذف الملفات الموجودة في سلة المهملات نهائيًا بشكل تلقائي بعد 30 يومًا.',
    en: 'Files in the bin are automatically deleted permanently after 30 days.',
  },
  'prul.nietOngedaan': {
    nl: 'Dit kan niet ongedaan worden gemaakt. Denk aan de bewaarplicht: de Belastingdienst verwacht dat je administratie zeven jaar bewaard blijft.',
    ar: 'لا يمكن التراجع عن هذا. تذكّر واجب الحفظ: تتوقع مصلحة الضرائب (Belastingdienst) أن تبقى سجلات إدارتك محفوظة سبع سنوات.',
    en: 'This cannot be undone. Mind the retention duty: the Belastingdienst expects your records to be kept for seven years.',
  },
  'prul.verwijderdOp': {
    nl: 'Verwijderd op {date}',
    ar: 'حُذف في {date}',
    en: 'Deleted on {date}',
  },
  'prul.verwijderMislukt': {
    nl: '{count} bestand(en) konden niet worden verwijderd. Ze staan nog in de prullenbak.',
    ar: 'الملفات التي تعذّر حذفها: {count}. ما زالت في سلة المهملات.',
    en: '{count} file(s) could not be deleted. They are still in the bin.',
  },
  'prul.verwijderVraagEen': {
    nl: 'Bestand permanent verwijderen?',
    ar: 'حذف الملف نهائيًا؟',
    en: 'Delete this file permanently?',
  },
  'prul.verwijderVraagMeer': {
    nl: '{count} bestanden permanent verwijderen?',
    ar: 'حذف {count} من الملفات نهائيًا؟',
    en: 'Delete {count} files permanently?',
  },
  'vk.herinnerenMislukt': {
    nl: 'Herinneren lukte niet',
    ar: 'تعذّر إرسال التذكير',
    en: 'Sending the reminder failed',
  },
  'vk.herinnerenMisluktVerbinding': {
    nl: 'Herinneren lukte niet — controleer je verbinding',
    ar: 'تعذّر إرسال التذكير — تحقق من اتصالك',
    en: 'Sending the reminder failed — check your connection',
  },
  'vk.herinneringSturen': {
    nl: 'Herinnering sturen',
    ar: 'إرسال تذكير',
    en: 'Send a reminder',
  },
  'vk.herinneringVerstuurd': {
    nl: 'Herinnering verstuurd ✓',
    ar: 'تم إرسال التذكير ✓',
    en: 'Reminder sent ✓',
  },
  'vk.zonderKlant': {
    nl: 'Zonder klant',
    ar: 'بدون عميل',
    en: 'Without a client',
  },

  // ── [TAAL-REST] The fragments the third scanner pass surfaced: the wizard's error
  // messages (double-quoted, invisible to the single-quote pattern), split sentences around
  // <strong>, template literals with a name in them, and the aangifte's art. 29 paragraphs.
  'onb.sessieVerlopenAfronden': {
    nl: 'Je sessie is verlopen — log opnieuw in om je aanmelding af te ronden.',
    ar: 'انتهت صلاحية جلستك — سجّل الدخول من جديد لإكمال تسجيلك.',
    en: 'Your session has expired — log in again to finish signing up.',
  },
  'onb.afrondenMislukt': {
    nl: 'Afronden mislukt — controleer je verbinding en probeer het opnieuw.',
    ar: 'تعذّر الإكمال — تحقق من اتصالك وحاول مرة أخرى.',
    en: 'Finishing failed — check your connection and try again.',
  },
  'onb.nummeringMislukt': {
    nl: 'Kon de nummering niet opslaan — probeer opnieuw of sla over.',
    ar: 'تعذّر حفظ الترقيم — حاول مجدداً أو تخطَّ هذه الخطوة.',
    en: 'Could not save the numbering — try again or skip.',
  },
  'onb.emailKloptNiet': {
    nl: 'Dit e-mailadres klopt niet — controleer het of laat het leeg.',
    ar: 'هذا البريد الإلكتروني غير صحيح — تحقق منه أو اتركه فارغاً.',
    en: 'This e-mail address is not valid — check it or leave it empty.',
  },
  'onb.teVeelUitnodigingen': {
    nl: 'Te veel uitnodigingen achter elkaar — wacht even, of sla deze stap over.',
    ar: 'دعوات كثيرة متتالية — انتظر قليلاً أو تخطَّ هذه الخطوة.',
    en: 'Too many invitations in a row — wait a moment, or skip this step.',
  },
  'onb.uitnodigingMislukt': {
    nl: 'De uitnodiging kon niet verstuurd worden. Probeer het opnieuw of sla over.',
    ar: 'تعذّر إرسال الدعوة. حاول مجدداً أو تخطَّ الخطوة.',
    en: 'The invitation could not be sent. Try again or skip.',
  },
  'onb.opslaanMislukt': {
    nl: 'Opslaan mislukt — controleer je verbinding en probeer opnieuw.',
    ar: 'تعذّر الحفظ — تحقق من اتصالك وحاول مجدداً.',
    en: 'Saving failed — check your connection and try again.',
  },
  'onb.overslaanMislukt': {
    nl: 'Overslaan mislukt — controleer je verbinding en probeer opnieuw.',
    ar: 'تعذّر التخطي — تحقق من اتصالك وحاول مجدداً.',
    en: 'Skipping failed — check your connection and try again.',
  },
  'onb.sessieVerlopenReset': {
    nl: 'Je sessie is verlopen — log opnieuw in om opnieuw te beginnen.',
    ar: 'انتهت صلاحية جلستك — سجّل الدخول من جديد للبدء من جديد.',
    en: 'Your session has expired — log in again to start over.',
  },
  'onb.resetMislukt': {
    nl: 'Opnieuw beginnen is niet gelukt. Je gegevens staan er nog; probeer het zo opnieuw.',
    ar: 'لم ينجح البدء من جديد. بياناتك ما زالت موجودة؛ حاول بعد قليل.',
    en: 'Starting over did not work. Your data is still there; try again shortly.',
  },
  'onb.resetVerbinding': {
    nl: 'Opnieuw beginnen is niet gelukt — controleer je verbinding.',
    ar: 'لم ينجح البدء من جديد — تحقق من اتصالك.',
    en: 'Starting over did not work — check your connection.',
  },
  'onb.puntAlles': { nl: 'Alle facturen op één plek', ar: 'كل الفواتير في مكان واحد', en: 'All invoices in one place' },
  'onb.puntAI': { nl: 'AI leest je documenten automatisch', ar: 'الذكاء الاصطناعي يقرأ مستنداتك تلقائياً', en: 'AI reads your documents automatically' },
  'onb.puntKwijt': { nl: 'Nooit meer een factuur kwijt', ar: 'لن تفقد فاتورة بعد اليوم', en: 'Never lose an invoice again' },
  'onb.zzpDesc': { nl: 'Ik stuur en ontvang facturen', ar: 'أنا أرسل الفواتير وأستقبلها', en: 'I send and receive invoices' },
  'onb.boekhouderDesc': { nl: 'Ik beheer facturen voor klanten', ar: 'أدير الفواتير لعملائي', en: 'I manage invoices for clients' },
  'onb.klaarAccountant': {
    nl: 'Nodig klanten uit en beheer alles op één plek.',
    ar: 'ادعُ عملاءك وأدر كل شيء من مكان واحد.',
    en: 'Invite clients and manage everything in one place.',
  },
  'onb.klaarNogEen': {
    nl: 'Je kunt meteen aan de slag. Eén ding nog voordat je facturen kunt versturen:',
    ar: 'يمكنك البدء فوراً. أمر واحد متبقٍ قبل أن تتمكن من إرسال الفواتير:',
    en: 'You can get started right away. One more thing before you can send invoices:',
  },
  'onb.klaarIngericht': {
    nl: 'BoekBrug is ingericht en klaar voor gebruik.',
    ar: 'تم إعداد BoekBrug وهو جاهز للاستخدام.',
    en: 'BoekBrug is set up and ready to use.',
  },
  'onb.bijnaKlaar': { nl: 'Bijna klaar, {name}!', ar: 'اقتربت من النهاية يا {name}!', en: 'Almost done, {name}!' },
  'onb.jeBentKlaar': { nl: 'Je bent klaar, {name}!', ar: 'أنت جاهز يا {name}!', en: 'You are all set, {name}!' },
  'onb.eersteWordt': { nl: 'Je eerste factuur wordt:', ar: 'ستكون فاتورتك الأولى:', en: 'Your first invoice will be:' },
  'onb.volgendeNummer': { nl: 'De volgende: {number}', ar: 'والتالية: {number}', en: 'The next one: {number}' },
  'onb.alleenNaamUitleg': {
    nl: 'Alleen de naam is verplicht om verder te gaan. BTW-nummer, adres en IBAN heb je nodig om facturen te versturen — vul ze nu in (dat mag ook later in Instellingen).',
    ar: 'الاسم وحده إلزامي للمتابعة. تحتاج إلى رقم btw والعنوان وiban لإرسال الفواتير — أدخلها الآن (أو لاحقاً في «الإعدادات»).',
    en: 'Only the name is required to continue. You need the VAT number, address and IBAN to send invoices — fill them in now (or later under Settings).',
  },
  // Short field NAMES for the missing-fields list — the label keys are full questions.
  'onb.veldBedrijfsnaam': { nl: 'bedrijfsnaam', ar: 'اسم الشركة', en: 'company name' },
  'onb.veldBtw': { nl: 'BTW-nummer', ar: 'رقم btw', en: 'VAT number' },
  'onb.veldKvk': { nl: 'KvK-nummer', ar: 'رقم KvK', en: 'KvK number' },
  'onb.veldAdres': { nl: 'adres', ar: 'العنوان', en: 'address' },
  'aang.art29.terugbetalenKop': {
    nl: '€{amount} voorbelasting terugbetalen',
    ar: 'يجب إعادة €{amount} من الضريبة المخصومة',
    en: '€{amount} input VAT to repay',
  },
  'aang.art29.openEen': {
    nl: '1 inkoopfactuur staat meer dan een jaar na de vervaldatum open.',
    ar: 'فاتورة شراء واحدة ما زالت مفتوحة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '1 purchase invoice has been open for more than a year past its due date.',
  },
  'aang.art29.openMeer': {
    nl: '{n} inkoopfacturen staan meer dan een jaar na de vervaldatum open.',
    ar: '{n} فاتورة شراء ما زالت مفتوحة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '{n} purchase invoices have been open for more than a year past their due date.',
  },
  'aang.art29.clawbackUitleg': {
    nl: 'De BTW die je hierover in aftrek bracht wordt dan weer verschuldigd (art. 29 lid 7 Wet OB). Heb je ze wél betaald? Koppel de betaling of zet ze op betaald. Dit bedrag zit niet in de rubrieken hierboven.',
    ar: 'الضريبة التي خصمتها عن هذه الفواتير تصبح مستحقة من جديد (المادة 29 فقرة 7 من قانون Wet OB). هل دفعتها فعلاً؟ اربط الدفعة أو علّمها كمدفوعة. هذا المبلغ غير مشمول في البنود أعلاه.',
    en: 'The VAT you deducted on these becomes due again (art. 29(7) Wet OB). Did you actually pay them? Link the payment or mark them as paid. This amount is not included in the boxes above.',
  },
  'aang.art29.terugvragenKop': {
    nl: '€{amount} BTW terug te vragen',
    ar: 'يمكن استرداد €{amount} من الضريبة',
    en: '€{amount} VAT to reclaim',
  },
  'aang.art29.onbetaaldEen': {
    nl: '1 verkoopfactuur staat meer dan een jaar na de vervaldatum onbetaald.',
    ar: 'فاتورة بيع واحدة ما زالت غير مدفوعة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '1 sales invoice has been unpaid for more than a year past its due date.',
  },
  'aang.art29.onbetaaldMeer': {
    nl: '{n} verkoopfacturen staan meer dan een jaar na de vervaldatum onbetaald.',
    ar: '{n} فاتورة بيع ما زالت غير مدفوعة بعد أكثر من سنة من تاريخ الاستحقاق.',
    en: '{n} sales invoices have been unpaid for more than a year past their due date.',
  },
  'aang.art29.terugvraagUitleg': {
    nl: 'De BTW die je hierover afdroeg kun je terugvragen (oninbare vordering, art. 29 Wet OB). Ook dit bedrag zit niet in de rubrieken hierboven — bespreek het tijdvak met je boekhouder.',
    ar: 'الضريبة التي سددتها عن هذه الفواتير يمكنك استردادها (دين معدوم، المادة 29 من قانون Wet OB). هذا المبلغ أيضاً غير مشمول في البنود أعلاه — ناقش الفترة مع المحاسب.',
    en: 'You can reclaim the VAT you paid on these (bad debt, art. 29 Wet OB). This amount is also not included in the boxes above — discuss the period with your accountant.',
  },
  'aang.icp.uitleg1': {
    nl: 'Leveringen aan ondernemers in de EU (rubriek 3b hierboven) moet je óók per BTW-nummer opgeven.',
    ar: 'التوريدات إلى شركات داخل الاتحاد الأوروبي (البند 3b أعلاه) يجب التصريح بها أيضاً لكل رقم btw على حدة.',
    en: 'Supplies to EU businesses (box 3b above) must also be declared per VAT number.',
  },
  'aang.icp.uitleg2': {
    nl: 'Dit is geen onderdeel van de BTW-aangifte en wordt hier niet ingediend.',
    ar: 'هذا ليس جزءاً من إقرار الضريبة ولا يُقدَّم هنا.',
    en: 'This is not part of the VAT return and is not filed here.',
  },
  'aang.berekenen': { nl: 'Berekenen…', ar: 'جارٍ الحساب…', en: 'Calculating…' },
  'lijst.geenMetStatus': {
    nl: 'Geen facturen met status “{status}”',
    ar: 'لا توجد فواتير بالحالة «{status}»',
    en: 'No invoices with status “{status}”',
  },
  'vkp.nogNietVerstuurd': { nl: 'nog niet verstuurd', ar: 'لم تُرسل بعد', en: 'not sent yet' },
  'zoek.kort': { nl: 'Zoeken…', ar: 'بحث…', en: 'Search…' },
  'zoek.uitgebreid': {
    nl: 'Zoeken naar facturen, bedragen, bestanden…',
    ar: 'ابحث عن فواتير أو مبالغ أو ملفات…',
    en: 'Search invoices, amounts, files…',
  },
} satisfies Record<string, Message>

export type MessageKey = keyof typeof MESSAGES
