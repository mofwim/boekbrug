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

  // ─── [KADER] De naam van het scherm, in de balk die om ELK scherm heen staat ────────────────
  //
  // DashboardChrome hield deze namen als kale Nederlandse tekst, met een goede reden erbij: het is
  // de eerste-verf-naam, en een scherm dat zijn eigen titel aanmeldt wint ervan. Alleen geldt dat
  // laatste niet voor elk scherm — en waar het niet geldt, staat de naam er niet even, maar altijd.
  // Een Arabische eigenaar las dus een vertaald scherm in een Nederlandse lijst, op elke pagina.
  //
  // De namen staan hier in dezelfde volgorde als in dat bestand, zodat de twee naast elkaar te
  // lezen zijn. Ze blijven bewust KORT: het is een balk, geen zin.
  'chrome.vandaag': { nl: 'Vandaag', ar: 'اليوم', en: 'Today' },
  'chrome.brug': { nl: 'Brug', ar: 'الجسر', en: 'Bridge' },
  'chrome.kas': { nl: 'Kas', ar: 'الصندوق', en: 'Cash' },
  'chrome.aangifte': { nl: 'Aangifte', ar: 'الإقرار الضريبي', en: 'Tax return' },
  'chrome.dagomzet': { nl: 'Dagomzet', ar: 'إيراد اليوم', en: 'Daily turnover' },
  'chrome.uploaden': { nl: 'Uploaden', ar: 'رفع ملف', en: 'Upload' },
  'chrome.artikelen': { nl: 'Artikelen', ar: 'المنتجات', en: 'Items' },
  'chrome.jaaroverzicht': { nl: 'Jaaroverzicht', ar: 'ملخّص السنة', en: 'Year overview' },
  'chrome.kluis': { nl: 'Kluis', ar: 'الخزنة', en: 'Vault' },
  'chrome.logboek': { nl: 'Logboek', ar: 'سجل النشاط', en: 'Activity log' },
  'chrome.beveiliging': { nl: 'Beveiliging', ar: 'الأمان', en: 'Security' },
  // De vragen die de BOEKHOUDER aan de ondernemer stelt — vandaar "van je boekhouder".
  'chrome.vragen': { nl: 'Vragen van je boekhouder', ar: 'أسئلة من محاسبك', en: 'Questions from your accountant' },
  'chrome.klaar': { nl: 'Ben ik klaar?', ar: 'هل أنا جاهز؟', en: 'Am I ready?' },
  'chrome.kwartaaloverzicht': { nl: 'Kwartaaloverzicht', ar: 'ملخّص الربع', en: 'Quarter overview' },
  'chrome.waarheid': { nl: 'Waarheid', ar: 'الحقيقة', en: 'Truth' },
  'chrome.bank': { nl: 'Bank', ar: 'البنك', en: 'Bank' },
  'chrome.categoriseren': { nl: 'Wat is dit?', ar: 'ما هذا؟', en: 'What is this?' },
  'chrome.instellingen': { nl: 'Instellingen', ar: 'الإعدادات', en: 'Settings' },
  'chrome.facturering': { nl: 'Facturering', ar: 'إعداد الفواتير', en: 'Invoicing' },
  'chrome.berichten': { nl: 'Berichten', ar: 'الرسائل', en: 'Messages' },
  'chrome.werkplek': { nl: 'Mijn werkplek', ar: 'مساحة عملي', en: 'My workspace' },
  'chrome.klantenBeheren': { nl: 'Klanten beheren', ar: 'إدارة العملاء', en: 'Manage clients' },
  'chrome.agenda': { nl: 'Aangifte & status', ar: 'الإقرار والحالة', en: 'Return & status' },
  'chrome.voorbeeld': { nl: 'Voorbeeldklant', ar: 'عميل تجريبي', en: 'Example client' },
  'chrome.factuurNamens': { nl: 'Factuur namens klant', ar: 'فاتورة نيابةً عن عميل', en: 'Invoice on behalf of a client' },
  'chrome.openstaand': { nl: 'Openstaande facturen', ar: 'الفواتير غير المسدَّدة', en: 'Outstanding invoices' },
  'chrome.opvragen': { nl: 'Stukken opvragen', ar: 'طلب المستندات', en: 'Request documents' },
  'chrome.bevestigen': { nl: 'Bevestigen', ar: 'التأكيد', en: 'Confirm' },
  // "Mijn", omdat de boekhouder hiernaast ook de facturen van zijn KLANTEN ziet.
  'chrome.mijnFacturen': { nl: 'Mijn facturen', ar: 'فواتيري', en: 'My invoices' },
  'chrome.mijnKlanten': { nl: 'Mijn klanten', ar: 'عملائي', en: 'My clients' },
  'chrome.inkoopfacturen': { nl: 'Inkoopfacturen', ar: 'فواتير المشتريات', en: 'Purchase invoices' },
  'chrome.inkomend': { nl: 'Inkomend', ar: 'الوارد', en: 'Incoming' },
  'chrome.nieuweFactuur': { nl: 'Nieuwe factuur', ar: 'فاتورة جديدة', en: 'New invoice' },
  'chrome.factuurBewerken': { nl: 'Factuur bewerken', ar: 'تعديل الفاتورة', en: 'Edit invoice' },
  'chrome.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'chrome.klant': { nl: 'Klant', ar: 'عميل', en: 'Client' },
  'chrome.gesprek': { nl: 'Gesprek', ar: 'محادثة', en: 'Conversation' },
  'chrome.kwartaal': { nl: 'Kwartaal', ar: 'الربع', en: 'Quarter' },

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
  // [NUMMER-VOORUITBLIK] De kop draagt het verwachte nummer zodra het bekend is — de eigenaar moet
  // bij BINNENKOMST weten welk nummer dit document straks krijgt, niet halverwege het formulier.
  // "(verwacht)" reist mee in de kop zelf: een kaal getal daar zou als toezegging lezen, en het
  // nummer valt pas definitief bij verzending.
  'nieuw.titel.factuurMetNummer': {
    nl: 'Nieuwe factuur · {nummer} (verwacht)',
    ar: 'فاتورة جديدة · {nummer} (متوقّع)',
    en: 'New invoice · {nummer} (expected)',
  },
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
  // [REGEL-KORTING] De korting die bij één regel hoort, naast de korting op de hele factuur.
  'nieuw.regelKorting': { nl: 'Korting op deze regel', ar: 'خصم على هذا البند', en: 'Discount on this line' },
  'nieuw.regelKorting.weg': { nl: 'Korting weghalen', ar: 'إزالة الخصم', en: 'Remove discount' },
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
  // [OFFERTE-VERSTUREN-NIEUW] De hoofdknop op het opstelscherm: opslaan én meteen als offerte naar
  // de klant mailen, langs de deur die geen nummer kán slaan (/api/invoice/[id]/send-offerte).
  'nieuw.actie.offerteVersturen': { nl: 'Offerte versturen', ar: 'إرسال عرض السعر', en: 'Send quote' },
  'nieuw.offerte.verstuurdTitel': { nl: 'Offerte verstuurd', ar: 'أُرسل عرض السعر', en: 'Quote sent' },
  'nieuw.offerte.naarDetail': { nl: 'Naar de offerte', ar: 'إلى عرض السعر', en: 'To the quote' },
  'nieuw.actie.concept': { nl: 'Opslaan als concept', ar: 'حفظ كمسودة', en: 'Save as draft' },
  'nieuw.actie.bezig': { nl: 'Bezig...', ar: 'جارٍ العمل...', en: 'Working...' },
  'nieuw.actie.laden': { nl: 'Laden...', ar: 'جارٍ التحميل...', en: 'Loading...' },
  'nieuw.actie.versturenBezig': { nl: 'Versturen...', ar: 'جارٍ الإرسال...', en: 'Sending...' },
  'nieuw.actie.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  // [PDF-VOORBEELD] Het document zien vóór het onomkeerbaar is. "Bekijk" en niet "Download": de
  // ondernemer wil kijken, niet een bestand in zijn map. De browser opent zijn eigen viewer.
  // [NUMMER-VOORUITBLIK] Welk nummer deze factuur straks krijgt. Een VERWACHTING, geen belofte:
  // het nummer wordt pas bij verzending toegekend, atomair, uit de doorlopende reeks (art. 35 Wet
  // OB). Verstuurt iemand anders in de tussentijd een factuur, of wijzigt de ondernemer zijn
  // sjabloon in Instellingen, dan is het een ander nummer — en de zin zegt dat, in plaats van een
  // getal te tonen dat als vaststaand leest.
  'nieuw.nummer.volgende': { nl: 'Volgend factuurnummer', ar: 'رقم الفاتورة التالي', en: 'Next invoice number' },
  'nieuw.nummer.verwacht': {
    nl: 'Verwacht — het nummer wordt definitief bij verzending.',
    ar: 'متوقّع — يُخصَّص الرقم نهائياً عند الإرسال.',
    en: 'Expected — the number becomes final on sending.',
  },
  'nieuw.pdf.knop': { nl: 'PDF', ar: 'PDF', en: 'PDF' },
  'nieuw.actie.pdfBekijken': { nl: 'Bekijk als PDF', ar: 'عرض كـ PDF', en: 'View as PDF' },
  'nieuw.actie.pdfBezig': { nl: 'PDF maken...', ar: 'جارٍ إنشاء PDF...', en: 'Building PDF...' },
  // [NO-SILENT-EMPTY] Een knop die stil niets doet is erger dan een knop die zegt dat het misging.
  'nieuw.actie.pdfMislukt': {
    nl: 'Voorbeeld lukt niet',
    ar: 'تعذّر إنشاء المعاينة',
    en: 'Preview unavailable',
  },
  // Het voorbeeld draagt nog geen nummer, en dat mag niet als een fout lezen: het nummer wordt
  // pas bij verzending toegekend, uit de doorlopende reeks (art. 35 Wet OB).
  'nieuw.pdf.nogGeenNummer': { nl: 'CONCEPT', ar: 'مسودة', en: 'DRAFT' },

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
  // ── [RUST] De regel die het herhaalpaneel samenvat ───────────────────────────────────────
  // Het paneel eronder is het antwoord op "wat staat er aan en hoe zet ik het uit", en het stond
  // uitgeklapt boven de facturenlijst — met per serie een klant, een cadans en twee knoppen. Dat
  // is een beheerscherm boven een lijst, en de lijst is waarvoor je hier komt.
  //
  // Wat NIET mag verdwijnen is dat er iets loopt: dit is de enige functie in de app die uit
  // zichzelf facturen maakt, en het bestand hierboven legt vast dat zoiets nooit moeilijker uit te
  // zetten mag zijn dan het aan te zetten was. Vandaar de telling in de regel zelf, en één tik naar
  // dezelfde knoppen — niet twee.
  //
  // Loopt er niets meer, dan zegt de regel dát; "0 lopen" laten lezen als rust terwijl er drie
  // gepauzeerde series klaarstaan is precies de stilte die dit paneel moest wegnemen.
  'lijst.herhaal.lopen': { nl: '{n} herhalingen lopen', ar: '{n} تكرارات شغّالة', en: '{n} recurring series are running' },
  'lijst.herhaal.loopt': { nl: '1 herhaling loopt', ar: 'تكرار واحد شغّال', en: '1 recurring series is running' },
  'lijst.herhaal.stil': { nl: '{n} herhalingen staan stil', ar: '{n} تكرارات متوقّفة', en: '{n} recurring series are paused' },
  'lijst.herhaal.stilEen': { nl: '1 herhaling staat stil', ar: 'تكرار واحد متوقّف', en: '1 recurring series is paused' },
  'lijst.herhaal.toon': { nl: 'Toon en beheer ze', ar: 'اعرضها وأدِرها', en: 'Show and manage them' },
  'lijst.herhaal.verberg': { nl: 'Verberg ze weer', ar: 'أخفِها', en: 'Hide them again' },
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
  'start.tegel.kas': { nl: 'Kas', ar: 'الصندوق', en: 'Cash drawer' },
  'start.cijfers': { nl: 'Cijfers & aangifte', ar: 'الأرقام والإقرار', en: 'Figures & filing' },
  'start.conceptBtw': { nl: 'Concept BTW-aangifte', ar: 'مسودة إقرار BTW', en: 'Draft BTW return' },
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
  'waarheid.factuur.enkel': { nl: 'factuur', ar: 'فاتورة', en: 'invoice' },
  'waarheid.factuur.meer': { nl: 'facturen', ar: 'فواتير', en: 'invoices' },
  'waarheid.inkoop.enkel': { nl: 'inkoopfactuur', ar: 'فاتورة شراء', en: 'purchase invoice' },
  'waarheid.inkoop.meer': { nl: 'inkoopfacturen', ar: 'فواتير شراء', en: 'purchase invoices' },
  'waarheid.overDatum': { nl: '{n} over datum', ar: '{n} متأخرة', en: '{n} overdue' },
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

  // [STATIEGELD-GAT] De knop die het gevonden verschil in het bedrag excl. btw zet. Het WOORD komt
  // van de factuur zelf ({woord}: statiegeld, emballage, fust…) — de eigenaar herkent zijn eigen
  // papier sneller aan het woord dat erop staat dan aan het onze.
  'ink.statiegeld.meetellen': {
    nl: '{bedrag} {woord} meetellen in het bedrag excl. btw',
    ar: 'احتساب {bedrag} ({woord}) ضمن المبلغ بدون ضريبة',
    en: 'Count {bedrag} {woord} into the amount excl. VAT',
  },
  // [LEVERANCIER-VASTLEGGEN] Eén keer opschrijven wie deze leverancier is, in plaats van elke
  // maand dezelfde misgelezen naam verbeteren. De zinnen noemen het GEVOLG ("dan herkent de app
  // hem"), want dat is wat de eigenaar ervan merkt — niet het mechanisme eronder.
  'lev.knop': { nl: 'Leverancier', ar: 'المورّد', en: 'Supplier' },
  'lev.titel': { nl: 'Wie is deze leverancier?', ar: 'مَن هذا المورّد؟', en: 'Who is this supplier?' },
  'lev.uitleg': {
    nl: 'Wat je hier vastlegt, gebruikt de app ook bij de volgende factuur van dit bedrijf — dan hoeft er niets meer geraden te worden.',
    ar: 'ما تُثبِّته هنا يستخدمه التطبيق أيضاً مع الفاتورة التالية من هذه الشركة — فلا يبقى شيء للتخمين.',
    en: 'What you set here is what the app uses on the next invoice from this company — nothing left to guess.',
  },
  'lev.naam': { nl: 'Naam van het bedrijf', ar: 'اسم الشركة', en: 'Company name' },
  'lev.naam.hint': {
    nl: 'Zoals het bedrijf zichzelf noemt — meestal onderaan de factuur, bij de KVK- en btw-gegevens.',
    ar: 'كما تُسمّي الشركة نفسها — غالباً أسفل الفاتورة، عند بيانات KVK والضريبة.',
    en: 'As the company calls itself — usually at the foot of the invoice, beside the KVK and VAT details.',
  },
  'lev.iban': { nl: 'Rekeningnummer (IBAN)', ar: 'رقم الحساب (IBAN)', en: 'Account number (IBAN)' },
  'lev.iban.hint': {
    nl: 'Hiermee controleert de app of een volgende factuur ineens een ander rekeningnummer draagt. Leeg laten mag.',
    ar: 'به يفحص التطبيق ما إذا كانت فاتورة تالية تحمل رقم حساب مختلفاً فجأة. يمكن تركه فارغاً.',
    en: 'This is what the app compares a later invoice against when the account number suddenly differs. May be left empty.',
  },
  'lev.kvk': { nl: 'KVK-nummer', ar: 'رقم KVK', en: 'KVK number' },
  'lev.kvk.hint': { nl: '8 cijfers. Leeg laten mag.', ar: '٨ أرقام. يمكن تركه فارغاً.', en: '8 digits. May be left empty.' },
  'lev.btw': { nl: 'Btw-nummer', ar: 'رقم الضريبة', en: 'VAT number' },
  'lev.btw.hint': {
    nl: 'Staat verplicht op een factuur (art. 35a). Leeg laten mag.',
    ar: 'إلزامي على الفاتورة (المادة 35a). يمكن تركه فارغاً.',
    en: 'Legally required on an invoice (art. 35a). May be left empty.',
  },
  'lev.opslaan': { nl: 'Vastleggen', ar: 'تثبيت', en: 'Save' },
  'lev.bezig': { nl: 'Bezig met opslaan...', ar: 'جارٍ الحفظ...', en: 'Saving...' },
  'lev.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'lev.opgeslagen': { nl: 'Leverancier vastgelegd', ar: 'تم تثبيت المورّد', en: 'Supplier saved' },
  'lev.fout.opslaan': {
    nl: 'De leverancier kon niet worden opgeslagen. Probeer het zo meteen opnieuw.',
    ar: 'تعذّر حفظ المورّد. حاول مرة أخرى بعد قليل.',
    en: 'The supplier could not be saved. Try again in a moment.',
  },
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
  // [CIRKEL] De factuur bestaat al in de app — hij wacht alleen op controle.
  'bank.inWachtrij': { nl: 'Factuur {number} staat al in je controlewachtrij — niet opnieuw uploaden.', ar: 'الفاتورة {number} موجودة أصلاً في قائمة المراجعة — لا ترفعها مجدداً.', en: 'Invoice {number} is already in your review queue — no need to upload it again.' },
  'bank.inWachtrijZonderNummer': { nl: 'Deze betaling lijkt te horen bij een factuur die al in je controlewachtrij staat — niet opnieuw uploaden.', ar: 'يبدو أن هذه الدفعة تعود لفاتورة موجودة أصلاً في قائمة المراجعة — لا ترفعها مجدداً.', en: 'This payment appears to belong to an invoice already in your review queue — no need to upload it again.' },
  'bank.verifieerEerst': { nl: 'Verifieer de factuur', ar: 'راجع الفاتورة', en: 'Verify the invoice' },
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
  // [KAS-SPOOR] Wat dit kwartaal WEL hield en niet meer houdt. Een kasboeking wordt hard verwijderd,
  // dus het auditspoor is de enige plek waar de beweging nog bestaat. De zin zegt er meteen bij dat
  // deze regels NIET in de saldi zitten — anders is de eerste vraag van iedere lezer of het
  // eindsaldo hierboven ze meerekent.
  'kas.verwijderd.titel': {
    nl: 'Verwijderd uit dit kwartaal',
    ar: 'محذوف من هذا الربع',
    en: 'Removed from this quarter',
  },
  'kas.verwijderd.uitleg': {
    nl: 'Deze kasboekingen zijn verwijderd. Ze zitten niet in de saldi hierboven — ze staan hier omdat een kasboek waaruit regels ongemerkt verdwijnen niet te controleren is.',
    ar: 'هذه القيود النقدية محذوفة. وهي ليست ضمن الأرصدة أعلاه — تظهر هنا لأن دفتر نقد تختفي منه سطور بلا أثر لا يمكن التحقّق منه.',
    en: 'These cash entries were removed. They are not included in the balances above — they are listed here because a cash book whose lines can vanish unnoticed cannot be checked.',
  },
  'kas.verwijderd.op': {
    nl: 'verwijderd op {datum}',
    ar: 'حُذف بتاريخ {datum}',
    en: 'removed on {datum}',
  },
  'kas.verwijderd.onbekend': {
    nl: 'We konden niet volledig nalezen wat er uit dit kwartaal is verwijderd. Wat hieronder staat kan dus onvolledig zijn.',
    ar: 'لم نتمكّن من قراءة كل ما حُذف من هذا الربع. لذا قد تكون القائمة أدناه ناقصة.',
    en: 'We could not fully read what was removed from this quarter, so the list below may be incomplete.',
  },
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

  // ── [OFFERTE-OPVOLGING] Offertes die verlopen ────────────────────────────────
  'vandaag.offertes': { nl: 'Offertes die aandacht vragen', ar: 'عروض أسعار تحتاج انتباهك', en: 'Quotes needing attention' },
  'vandaag.offertesUitleg': {
    nl: 'Geaccepteerd of bijna verlopen',
    ar: 'مقبولة أو توشك أن تنتهي',
    en: 'Accepted, or about to lapse',
  },
  'vandaag.offerteEen': { nl: '1 offerte', ar: 'عرض سعر واحد', en: '1 quote' },
  'vandaag.offerteMeer': { nl: '{n} offertes', ar: '{n} عرض سعر', en: '{n} quotes' },
  'vandaag.offerteAkkoord': {
    nl: 'Akkoord — maak er een factuur van',
    ar: 'تمت الموافقة — حوّله إلى فاتورة',
    en: 'Accepted — turn it into an invoice',
  },
  'vandaag.offerteVandaag': { nl: 'Verloopt vandaag', ar: 'ينتهي اليوم', en: 'Lapses today' },
  'vandaag.offerteMorgen': { nl: 'Verloopt morgen', ar: 'ينتهي غداً', en: 'Lapses tomorrow' },
  'vandaag.offerteOver': { nl: 'Verloopt over {n} dagen', ar: 'ينتهي بعد {n} أيام', en: 'Lapses in {n} days' },
  'vandaag.offerteVerlopenEen': { nl: 'Gisteren verlopen', ar: 'انتهى أمس', en: 'Lapsed yesterday' },
  'vandaag.offerteVerlopenMeer': { nl: '{n} dagen verlopen', ar: 'انتهى منذ {n} يوماً', en: 'Lapsed {n} days ago' },
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
  // [ZELF-EERST] De autopiloot-schakelaar. De uitleg zegt eerst wat AAN doet en dan wat UIT
  // geeft, omdat uit-zetten hier geen verlies is maar een leerstand: alles eerst zelf zien.
  'inst.autoBoeken': { nl: 'Duidelijke facturen automatisch inboeken', ar: 'قيد الفواتير الواضحة تلقائياً', en: 'Book clear invoices automatically' },
  'inst.autoBoekenUitleg': { nl: 'Aan: een foutloos gelezen factuur wordt vanzelf geboekt (nooit betaald) en is altijd terug te draaien. Uit: álles wacht eerst op jouw controle — handig zolang je het lezen nog niet vertrouwt.', ar: 'مفعّل: الفاتورة المقروءة بلا أخطاء تُقيَّد تلقائياً (لا تُدفع أبداً) ويمكن التراجع دائماً. متوقّف: كل شيء ينتظر تدقيقك أولاً — مفيد ما دمت لم تثق بالقراءة بعد.', en: 'On: a flawlessly read invoice is booked automatically (never paid) and can always be undone. Off: everything waits for your check first — useful while you don\'t trust the reading yet.' },
  'inst.ochtendMail': { nl: 'Ochtendmail over je administratie', ar: 'بريد الصباح عن إدارتك', en: 'Morning mail about your administration' },
  'inst.ochtendMailUitleg': { nl: 'Eén mail per ochtend, en alleen op dagen dat er iets gebeurde: betalingen die binnenkwamen en nieuwe inkomende facturen.', ar: 'بريد واحد كل صباح، وفقط في الأيام التي حدث فيها شيء: دفعات وصلت وفواتير واردة جديدة.', en: 'One mail each morning, and only on days something happened: payments that came in and new incoming invoices.' },
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

  // ─── [BLAD-GEBAAR] Whose gesture is it — the sheet's, or the document's? ─────────────────────
  //
  // An embedded PDF viewer is its own scroll container: the moment the finger is over it, it takes
  // the gesture and the sheet stops moving. The panel already keeps its two exits outside the
  // scroller so they stay reachable, but that only stopped the wall from HIDING them — it is still
  // a wall, and it appears the moment the document finishes loading.
  //
  // So the document does not take the gesture until it is asked to. These two sentences are the
  // asking, and they are on screen rather than implied: a preview that ignores a tap for reasons
  // the owner cannot see is its own small betrayal.
  'dsh.gebaar.ontgrendel': { nl: 'Tik om in het document te bladeren', ar: 'انقر للتنقّل داخل المستند', en: 'Tap to page through the document' },
  'dsh.gebaar.vergrendel': { nl: 'Klaar met bladeren', ar: 'انتهيت من التصفّح', en: 'Done paging' },

  // ─── [NAAM-BIJ-BINNENKOMST] Renaming at the moment the file arrives ──────────────────────────
  //
  // Bestanden has had a rename for a long time; what it did not have was a rename at the ONE
  // moment the name is guaranteed to be useless — a phone camera files IMG_20260819_211723.jpg,
  // and the owner is looking straight at it. Finding it again later means recognising that string
  // among the others.
  'int.naam.aria': { nl: 'Nieuwe bestandsnaam', ar: 'اسم ملف جديد', en: 'New file name' },
  'int.naam.mislukt': {
    nl: 'De naam is niet opgeslagen — het bestand staat nog onder de oude naam in je bestanden.',
    ar: 'لم يُحفظ الاسم — لا يزال الملف بالاسم القديم في ملفاتك.',
    en: 'The name was not saved — the file is still under its old name in your files.',
  },
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
  // [BESTANDEN-WIJS] Niet "bekijk" maar "waar staat het" — dat is de andere vraag na een upload,
  // en de enige die het scherm tot nu toe met dode tekst beantwoordde.
  'up.wijsInBestanden': {
    nl: 'Toon in Bestanden',
    ar: 'أظهره في الملفات',
    en: 'Show in Files',
  },
  'up.bekijkBestanden': { nl: 'Bekijk in Bestanden', ar: 'اعرض في الملفات', en: 'View in Files' },
  'up.naarVerifieren': { nl: 'Naar Te verifiëren', ar: 'إلى «بانتظار التدقيق»', en: 'To the verify queue' },
  'up.mogelijkheden': { nl: 'Bekijk de mogelijkheden', ar: 'اطّلع على الإمكانات', en: 'See what it can do' },

  // ─── [KLANTEN] Het klantenbestand ───────────────────────────────────────────────────────────

  'kl.zoek': { nl: 'Zoek op naam, e-mail, KVK, IBAN...', ar: 'ابحث بالاسم أو البريد أو KVK أو IBAN...', en: 'Search by name, e-mail, KVK, IBAN...' },
  'kl.zoek.aria': { nl: 'Klanten zoeken', ar: 'البحث في العملاء', en: 'Search clients' },
  'kl.bekijk': { nl: 'Bekijk', ar: 'عرض', en: 'View' },
  'kl.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  'kl.verwijderd': { nl: 'Klant verwijderd', ar: 'حُذف العميل', en: 'Client deleted' },
  'kl.verwijderenMislukt': { nl: 'Verwijderen lukte niet — de klant staat er nog. Probeer het opnieuw.', ar: 'لم ينجح الحذف — العميل ما يزال موجودًا. حاول مرة أخرى.', en: 'Deleting failed — the client is still there. Try again.' },
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
  'kw.laadFout': { nl: 'We konden dit kwartaal nu niet ophalen — dit zegt niets over je cijfers zelf.', ar: 'تعذّر جلب هذا الربع الآن — هذا لا يقول شيئًا عن أرقامك نفسها.', en: 'We could not load this quarter right now — this says nothing about your figures themselves.' },
  'kw.klantenLaadFout': { nl: 'We konden je klantenlijst nu niet ophalen — dit zegt niets over je koppelingen zelf.', ar: 'تعذّر جلب قائمة عملائك الآن — هذا لا يقول شيئًا عن ارتباطاتك نفسها.', en: 'We could not load your client list right now — this says nothing about your links themselves.' },
  'kw.opnieuw': { nl: 'Opnieuw proberen', ar: 'حاول مرة أخرى', en: 'Try again' },
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
  'vk.laadFout': { nl: 'We konden je facturen nu niet ophalen — de bedragen hieronder kunnen onvolledig zijn. Ververs de pagina om het opnieuw te proberen.', ar: 'تعذّر جلب فواتيرك الآن — قد تكون المبالغ أدناه ناقصة. حدّث الصفحة للمحاولة مجددًا.', en: 'We could not load your invoices right now — the amounts below may be incomplete. Refresh the page to try again.' },
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
  'ublx.peppol.knop': { nl: 'Peppol-versie', ar: 'نسخة Peppol', en: 'Peppol version' },
  'ublx.peppol.tip': { nl: 'Dezelfde factuur als Peppol BIS 3.0-bestand (vereist het BTW-nummer van de klant)', ar: 'الفاتورة نفسها كملف Peppol BIS 3.0 (يتطلب رقم BTW الخاص بالعميل)', en: 'The same invoice as a Peppol BIS 3.0 file (requires the client BTW number)' },
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
  // [BETER-EXEMPLAAR] Een beter exemplaar van HETZELFDE papier — niet een herziene factuur.
  'dsh.vervangBestand': {
    nl: 'Beter exemplaar',
    ar: 'نسخة أفضل',
    en: 'Better copy',
  },
  'dsh.vervang.vraag': {
    nl: 'Bestand vervangen door een beter exemplaar?',
    ar: 'استبدال الملف بنسخة أفضل؟',
    en: 'Replace the file with a better copy?',
  },
  'dsh.vervang.uitleg': {
    nl: 'Alleen als dit hetzelfde papier is — bijvoorbeeld een scherpe pdf in plaats van je snelle foto. De bedragen blijven staan zoals ze zijn; het bestand wordt niet gelezen. Het oude bestand blijft bewaard in Mijn bestanden. Heeft de leverancier de factuur opnieuw uitgegeven met ANDERE bedragen? Gebruik dan "Deze vervangt factuur X" — dat zijn twee documenten.',
    ar: 'فقط إذا كان هذا هو الورق نفسه — مثلاً ملف pdf واضح بدل صورتك السريعة. تبقى المبالغ كما هي؛ لا يُقرأ الملف. يبقى الملف القديم محفوظاً في «ملفاتي». هل أعاد المورّد إصدار الفاتورة بمبالغ مختلفة؟ استخدم عندئذٍ «هذه تحلّ محل الفاتورة X» — فتلك وثيقتان.',
    en: 'Only if this is the same paper — a sharp pdf instead of your quick photo, say. The amounts stay exactly as they are; the file is not read. The old file is kept in Mijn bestanden. Did the supplier reissue the invoice with DIFFERENT amounts? Use "Deze vervangt factuur X" instead — those are two documents.',
  },
  'dsh.vervang.gelukt': {
    nl: 'Bestand vervangen. Het oude staat nog in Mijn bestanden.',
    ar: 'استُبدل الملف. لا يزال القديم في «ملفاتي».',
    en: 'File replaced. The old one is still in Mijn bestanden.',
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
  'corr.vervaldatum': { nl: 'Vervaldatum', ar: 'تاريخ الاستحقاق', en: 'Due date' },
  'corr.iban': { nl: 'IBAN van de leverancier', ar: 'IBAN المورّد', en: "Supplier's IBAN" },
  'corr.kenmerk': { nl: 'Betaalkenmerk', ar: 'مرجع الدفع', en: 'Payment reference' },
  'corr.splitUitleg': { nl: 'BTW-specificatie zoals op de factuur — één regel per tarief. Laat alles leeg om de specificatie te wissen.', ar: 'تفصيلة BTW كما على الفاتورة — سطر لكل نسبة. اترك الكل فارغًا لمسح التفصيلة.', en: 'BTW specification as printed — one row per rate. Leave everything empty to clear it.' },
  'corr.grondslag': { nl: 'Grondslag', ar: 'الأساس', en: 'Base' },
  'corr.btwBedrag': { nl: 'BTW-bedrag', ar: 'مبلغ BTW', en: 'BTW amount' },
  // [BTW-TARIEF] Eén tik in plaats van hoofdrekenen. Het TARIEF wordt gevraagd, nooit geraden:
  // uit een bedrag exclusief valt geen tarief af te leiden, en een geraden btw is een geraden
  // voorbelasting. Elke zin een eigen sleutel — een getal is een parameter, een woord niet.
  'corr.tarief.vraag': {
    nl: 'Btw ontbreekt. Welk tarief staat er op de factuur?',
    en: 'The VAT is missing. Which rate does the invoice show?',
    ar: 'مبلغ الضريبة ناقص. ما النسبة المذكورة في الفاتورة؟',
  },
  'corr.tarief.knop': {
    nl: '{tarief}% — btw wordt {btw}',
    en: '{tarief}% — VAT becomes {btw}',
    ar: '{tarief}٪ — تصبح الضريبة {btw}',
  },
  'corr.tarief.uitleg': {
    nl: 'Wij rekenen het tarief niet zelf uit: hetzelfde bedrag kan 9% of 21% dragen, en een geraden btw is een geraden voorbelasting. Klopt het niet? Tik het bedrag gewoon over.',
    en: 'We do not work the rate out ourselves: the same amount can carry 9% or 21%, and a guessed VAT is a guessed input tax. Not right? Just type the amount over it.',
    ar: 'لا نحسب النسبة من تلقائنا: المبلغ نفسه قد يحمل ٩٪ أو ٢١٪، وضريبة مخمَّنة تعني ضريبة مدخلات مخمَّنة. غير صحيح؟ اكتب المبلغ فوقه ببساطة.',
  },
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
  // [STATIEGELD-GAT] De knop op de correctie-modal. Kort, want de zin eronder (uit statiegeld.ts)
  // noemt het bedrag, het woord van de factuur en wat het bedrag excl. btw wordt.
  // [BETAALNOTITIE] Een eigen tekst ACHTER het kenmerk, voor deze ene betaling.
  'notitie.label': {
    nl: 'Eigen tekst erbij (optioneel)',
    ar: 'نص خاص بك (اختياري)',
    en: 'Add your own text (optional)',
  },
  'notitie.voorbeeld': {
    nl: 'Bijv. termijn 1 van 2',
    ar: 'مثال: القسط 1 من 2',
    en: 'e.g. termijn 1 van 2',
  },
  'notitie.ruimte': {
    nl: 'Komt achter het kenmerk te staan. Nog {n} tekens ruimte.',
    ar: 'يُكتب بعد المرجع. يتبقّى {n} حرفاً.',
    en: 'Goes after the reference. {n} characters left.',
  },
  // [KENMERK-VAN-WIE] Waar het kenmerk vandaan komt, en waarom het geen invulveld is. GEVRAAGD
  // naar aanleiding van het termijnbetalen: "kan ik er 'eerste deel' bij schrijven?"
  'kenmerk.vanLeverancier': {
    nl: 'Dit kenmerk staat op de factuur van de leverancier — daarmee vindt hij jouw betaling terug. Verander het niet zelf.',
    ar: 'هذا المرجع مكتوب على فاتورة المورّد — به يتعرّف على دفعتك. لا تغيّره بنفسك.',
    en: "This reference comes from the supplier's invoice — it is how they find your payment. Do not change it yourself.",
  },
  'kenmerk.corrigeer': {
    nl: 'Staat het er verkeerd? Corrigeer het op de factuur',
    ar: 'هل هو مكتوب خطأً؟ صحّحه على الفاتورة',
    en: 'Wrong on the invoice? Correct it there',
  },
  'kenmerk.naBetaling': {
    nl: 'Deze factuur staat niet meer op te betalen, dus het kenmerk kan hier niet meer worden gecorrigeerd.',
    ar: 'لم تعد هذه الفاتورة قيد الدفع، لذا لا يمكن تصحيح المرجع هنا.',
    en: 'This invoice is no longer awaiting payment, so the reference can no longer be corrected here.',
  },
  // [DEEL-BETALEN] Een factuur in termijnen betalen. GEMELD op Enka Horeca B.V. (€ 3.819,82):
  // "ik wil deze betalen, maar voorlopig maar een deel."
  'deel.label': {
    nl: 'Hoeveel betaal je nu?',
    ar: 'كم ستدفع الآن؟',
    en: 'How much are you paying now?',
  },
  'deel.rest': {
    nl: 'Daarna blijft {bedrag} openstaan. Zodra je bank de betaling doorgeeft, rekent de app het bij op deze factuur.',
    ar: 'بعدها يبقى {bedrag} مستحقاً. حالما يُبلّغ بنكك عن الدفعة، يحتسبها التطبيق على هذه الفاتورة.',
    en: 'After that {bedrag} stays open. As soon as your bank reports the payment, the app books it against this invoice.',
  },
  'deel.alles': {
    nl: 'Hiermee is de factuur helemaal betaald.',
    ar: 'بهذا تُدفع الفاتورة بالكامل.',
    en: 'This pays the invoice in full.',
  },
  'corr.statiegeld.meetellen': {
    nl: 'Statiegeld meetellen in het bedrag excl. btw',
    ar: 'احتساب التأمين (statiegeld) ضمن المبلغ بدون ضريبة',
    en: 'Count the deposit into the amount excl. VAT',
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
  'verd.geboekt.titel': { nl: 'Deze bankregel is al geboekt', ar: 'سطر البنك هذا محجوز بالفعل', en: 'This bank line is already booked' },
  'verd.geboekt.titelGenegeerd': { nl: 'Deze bankregel is genegeerd', ar: 'تم تجاهل سطر البنك هذا', en: 'This bank line was ignored' },
  'verd.geboekt.uitleg': { nl: 'Dit is er op geboekt — elke koppeling draai je op de factuur met één tik terug.', ar: 'هذا ما حُجز عليه — يمكنك التراجع عن أي ربط من الفاتورة بنقرة واحدة.', en: 'This is what was booked on it — undo any link from the invoice with one tap.' },
  'verd.geboekt.genegeerdUitleg': { nl: 'Je hebt deze regel eerder als "geen factuur" gemarkeerd. Terughalen kan vanuit de banklijst.', ar: 'سبق أن علّمت هذا السطر كـ«ليس فاتورة». يمكن استرجاعه من قائمة البنك.', en: 'You previously marked this line as "not an invoice". You can restore it from the bank list.' },
  'verd.geboekt.zonderNummer': { nl: 'Factuur zonder nummer', ar: 'فاتورة بلا رقم', en: 'Invoice without a number' },
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

  // [MOLLIE] Instellingenkaart: iDEAL-betaallinks via het eigen Mollie-account van de eigenaar.
  'mollie.titel': { nl: 'iDEAL-betalingen (Mollie)', ar: 'مدفوعات iDEAL ‏(Mollie)', en: 'iDEAL payments (Mollie)' },
  'mollie.uitleg': { nl: 'Koppel je eigen Mollie-account en je klanten krijgen een "Betaal met iDEAL"-knop op de betaalpagina van elke factuur. Het geld gaat rechtstreeks naar jouw Mollie-account; een betaalde factuur wordt automatisch als betaald gemarkeerd.', ar: 'اربط حساب Mollie الخاص بك ليحصل عملاؤك على زر «ادفع عبر iDEAL» في صفحة الدفع لكل فاتورة. يذهب المال مباشرة إلى حساب Mollie الخاص بك، وتُعلَّم الفاتورة المدفوعة تلقائياً كمدفوعة.', en: 'Connect your own Mollie account and your customers get a "Pay with iDEAL" button on every invoice payment page. The money goes straight to your Mollie account; a paid invoice is marked paid automatically.' },
  'mollie.sleutel': { nl: 'Mollie API-sleutel', ar: 'مفتاح Mollie API', en: 'Mollie API key' },
  'mollie.sleutelHint': { nl: 'Te vinden in je Mollie-dashboard onder Developers → API-sleutels (live_…).', ar: 'تجده في لوحة Mollie تحت Developers ← API-keys ‏(live_…).', en: 'Found in your Mollie dashboard under Developers → API keys (live_…).' },
  'mollie.koppel': { nl: 'Koppelen', ar: 'اربط', en: 'Connect' },
  'mollie.bezig': { nl: 'Bezig…', ar: 'جارٍ…', en: 'Working…' },
  'mollie.gekoppeld': { nl: 'Gekoppeld sinds {date}. Klanten zien de iDEAL-knop op de betaalpagina.', ar: 'مرتبط منذ {date}. يرى العملاء زر iDEAL في صفحة الدفع.', en: 'Connected since {date}. Customers see the iDEAL button on the payment page.' },
  'mollie.ontkoppel': { nl: 'Ontkoppelen', ar: 'افصل', en: 'Disconnect' },
  'mollie.mislukt': { nl: 'Koppelen is niet gelukt.', ar: 'لم ينجح الربط.', en: 'Connecting failed.' },

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
  // [AFHANDELEN-STIL] Wat er gebeurde toen er niets gebeurde. De knop kon alleen iets zeggen als de
  // server iets boekte ÉN de teller op nul stond; boekte hij nul, dan bleef het scherm precies
  // staan zoals het stond — met "1 zekere betaling klaar" erboven. De ondernemer tikt dan opnieuw.
  //
  // Waarom de server kan weigeren wat dit scherm zeker noemt: hij weet dingen die de pagina niet
  // ziet — een factuur die de boekhouder heeft vastgezet, een kwartaal dat al is ingediend, een
  // betaling die intussen ergens anders is geboekt. Daarom noemt deze zin geen reden die hij niet
  // kent, en wijst hij naar wat er wél kan.
  'bank.auto.geenGeboekt': {
    nl: 'Er is niets automatisch geboekt. Deze betalingen staan hieronder klaar — koppel ze met één tik, dan zie je per regel welke factuur erbij hoort.',
    ar: 'لم يُقيَّد شيء تلقائياً. هذه الدفعات جاهزة بالأسفل — اربطها بلمسة واحدة، وسترى مع كل سطر الفاتورة التي تخصّه.',
    en: 'Nothing was booked automatically. These payments are waiting below — link them with one tap and you will see which invoice each one belongs to.',
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
  // [HERSTEL] Deze zin zei tot nu toe dat een verstuurde factuur NOOIT meer te wijzigen is en dat
  // een creditnota de enige weg is. Dat is niet meer waar en het was de duurste soort onwaarheid:
  // hij stuurt de ondernemer naar een creditnota — een tweede document, in zijn nummerreeks, in
  // zijn aangifte — voor een tikfout die hij gewoon had mogen herstellen.
  //
  // Wat WEL vastligt is het NUMMER (art. 35 Wet OB, doorlopende reeks zonder gaten). De factuur
  // zelf is bewerkbaar zolang sentEditBlockers geen grendel vindt: niets betaald, geen bank- of
  // kaskoppeling, geen creditnota, niet verwerkt door de boekhouder, kwartaal niet ingediend.
  // Onbekend telt daar als grendel, dus de zin belooft niets wat de server kan weigeren.
  'bewerk.modal.waarschuwing': {
    nl: 'Het factuurnummer ligt na verzending vast en is niet meer te wijzigen. De factuur zelf kun je nog corrigeren zolang hij niet betaald of verwerkt is — je klant krijgt dan automatisch de gecorrigeerde versie.',
    ar: 'رقم الفاتورة يثبت عند الإرسال ولا يمكن تغييره. أما الفاتورة نفسها فيمكنك تصحيحها ما دامت غير مدفوعة وغير مُرحَّلة — وعندها يستلم عميلك النسخة المصحّحة تلقائياً.',
    en: 'The invoice number is fixed on sending and cannot be changed. The invoice itself can still be corrected while it is unpaid and not yet booked — your customer then automatically receives the corrected version.',
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
  // ── [DEEL-CREDIT] Een factuur kan in DELEN worden gecrediteerd ────────────────
  'detail.deelsGecrediteerd': {
    nl: 'Deels gecrediteerd: {credited} terug, {open} staat nog open.',
    ar: 'مُقيَّد جزئياً: أُعيد {credited}، وما زال {open} مفتوحاً.',
    en: 'Partly credited: {credited} returned, {open} still open.',
  },
  'detail.credit.alles': { nl: 'Hele factuur', ar: 'الفاتورة كاملة', en: 'Whole invoice' },
  'detail.credit.deel': { nl: 'Een deel', ar: 'جزء منها', en: 'Part of it' },
  'detail.credit.aantal': { nl: 'Aantal om te crediteren', ar: 'الكمية المراد تقييدها', en: 'Quantity to credit' },
  'detail.credit.van': { nl: 'van {max}', ar: 'من {max}', en: 'of {max}' },
  'detail.credit.alGecrediteerd': { nl: 'Al gecrediteerd', ar: 'المُقيَّد سابقاً', en: 'Already credited' },
  'detail.credit.nogMogelijk': { nl: 'Nog mogelijk', ar: 'المتبقي الممكن', en: 'Still possible' },
  'detail.credit.kiesRegel': {
    nl: 'Kies minstens één regel om te crediteren.',
    ar: 'اختر بنداً واحداً على الأقل لتقييده.',
    en: 'Choose at least one line to credit.',
  },
  'detail.credit.teVeel': {
    nl: 'Dat is meer dan er nog van deze factuur gecrediteerd kan worden ({max}).',
    ar: 'هذا أكثر مما يمكن تقييده من هذه الفاتورة ({max}).',
    en: 'That is more than can still be credited on this invoice ({max}).',
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
  // ── [OFFERTE-AKKOORD] Wat de klant antwoordde ────────────────────────────────
  // ── [FACTUUR-BIJLAGE] Een eigen bestand met de factuurmail mee ───────────────
  'bijlage.meesturen': { nl: 'Een bestand meesturen (optioneel)', ar: 'إرفاق ملف (اختياري)', en: 'Send a file along (optional)' },
  'bijlage.zoekHint': { nl: 'Zoek in je bestanden…', ar: 'ابحث في ملفاتك…', en: 'Search your files…' },
  'bijlage.zoeken': { nl: 'Zoeken…', ar: 'جارٍ البحث…', en: 'Searching…' },
  'bijlage.weghalen': { nl: 'Weghalen', ar: 'إزالة', en: 'Remove' },
  // De bijlage die AL op deze factuur staat. Zonder deze regels toont het scherm een leeg
  // keuzeveld terwijl er wel degelijk een bestand meegaat — en dan verstuurt de ondernemer iets
  // anders dan hij denkt.
  'bijlage.staatOpFactuur': {
    nl: 'Gaat mee met deze factuur',
    ar: 'يُرسَل مع هذه الفاتورة',
    en: 'Goes along with this invoice',
  },
  'bijlage.inPrullenbak': {
    nl: 'Dit bestand staat in de prullenbak. Zet het terug of haal de bijlage weg — anders lukt versturen niet.',
    ar: 'هذا الملف في سلة المهملات. أعِده أو أزِل المرفق — وإلا فلن ينجح الإرسال.',
    en: 'This file is in the bin. Restore it or remove the attachment — otherwise sending will fail.',
  },
  'detail.offerte.akkoord': { nl: 'De klant gaat akkoord', ar: 'وافق العميل', en: 'The customer accepted' },
  'detail.offerte.afgewezen': { nl: 'De klant gaat niet akkoord', ar: 'لم يوافق العميل', en: 'The customer declined' },
  'detail.offerte.doorOp': { nl: 'Door {naam}, op {datum}', ar: 'بواسطة {naam}، بتاريخ {datum}', en: 'By {naam}, on {datum}' },
  'detail.offerte.op': { nl: 'Op {datum}', ar: 'بتاريخ {datum}', en: 'On {datum}' },
  // [AKKOORD-VERLOPEN] Het akkoord kwam ná de geldigheidsdatum. Alleen gemeld, nooit geweigerd:
  // het antwoord is geldig, en of de prijs van toen nog geldt is een beslissing van de ondernemer.
  // Zonder deze regel leest het scherm als een gewoon akkoord en wordt er omgezet tegen een prijs
  // die maanden geleden is ingetrokken.
  'detail.offerte.naVervaldatum': {
    nl: 'Let op: dit akkoord kwam ná de geldigheidsdatum van {datum}. Controleer of je prijs nog klopt voordat je de factuur maakt.',
    ar: 'تنبيه: وصلت هذه الموافقة بعد تاريخ سريان العرض ({datum}). تأكّد أن سعرك ما زال صالحاً قبل إصدار الفاتورة.',
    en: 'Note: this acceptance arrived after the quote expired on {datum}. Check that your price still holds before you invoice it.',
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
  // ── [RUST] De regel die twee panelen vervangt ────────────────────────────────────────────
  // Dit scherm heet Inkoopfacturen en zijn werk is de LIJST. De scan-melding en de
  // auto-verwerkt-nudge stonden er allebei uitgeklapt boven, samen goed voor een half scherm
  // advies vóór de eerste factuur. Ze zijn niet fout — ze zijn alleen niet het antwoord op de
  // vraag waarmee je dit scherm opent.
  //
  // Een telling is genoeg om te beslissen of je gaat kijken; de panelen zelf staan één tik weg.
  // Bewust KORT: geen werkwoord, geen uitroep, geen kleur die om aandacht vraagt.
  //
  // Wat NIET meevouwt, en dat is de hele grens: alles wat zegt dat dit scherm onvolledig is
  // ([NO-SILENT-EMPTY]) of dat je hier geld twee keer kunt uitgeven ([AUTO-INCASSO]) blijft
  // staan. Dat is geen advies maar een waarschuwing, en een waarschuwing die je moet openklappen
  // is er geen.
  'ink.advies.kloppenNiet': {
    nl: '{n} kloppen niet',
    ar: '{n} غير صحيحة',
    en: '{n} are wrong',
  },
  'ink.advies.kloptNietEen': {
    nl: '1 klopt niet',
    ar: 'واحدة غير صحيحة',
    en: '1 is wrong',
  },
  // [SCAN-WHOLE-BOOK] Dezelfde telling, maar eerlijk begrensd. Zonder deze twee zou de
  // samengevouwen regel '3 kloppen niet' zeggen terwijl er alleen in DEZE lijst is gekeken — een
  // bounded read gepresenteerd als een compleet antwoord, precies de fout waarvoor het paneel
  // eronder zijn eigen zin heeft. Wat opengeklapt waar moest zijn, moet dichtgeklapt ook waar zijn.
  'ink.advies.kloppenNietLijst': {
    nl: '{n} kloppen niet in deze lijst',
    ar: '{n} غير صحيحة في هذه القائمة',
    en: '{n} in this list are wrong',
  },
  'ink.advies.kloptNietEenLijst': {
    nl: '1 klopt niet in deze lijst',
    ar: 'واحدة غير صحيحة في هذه القائمة',
    en: '1 in this list is wrong',
  },
  'ink.advies.autoVerwerkt': {
    nl: '{n} automatisch verwerkt',
    ar: '{n} عولجت تلقائياً',
    en: '{n} processed automatically',
  },
  'ink.advies.autoVerwerktEen': {
    nl: '1 automatisch verwerkt',
    ar: 'واحدة عولجت تلقائياً',
    en: '1 processed automatically',
  },
  'ink.advies.open': {
    nl: 'Toon wat hierachter zit',
    ar: 'اعرض التفاصيل',
    en: 'Show what is behind this',
  },
  'ink.advies.dicht': {
    nl: 'Verberg dit weer',
    ar: 'أخفِ هذا',
    en: 'Hide this again',
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
  'ink.bankWachtEen': {
    nl: '1 factuur heeft een gevonden bankkoppeling die op je keuze wacht →',
    ar: 'فاتورة واحدة لها مطابقة بنكية معثور عليها تنتظر قرارك ←',
    en: '1 invoice has a found bank match awaiting your choice →',
  },
  'ink.bankWacht': {
    nl: '{count} facturen hebben een gevonden bankkoppeling die op je keuze wacht →',
    ar: '{count} فواتير لها مطابقات بنكية معثور عليها تنتظر قرارك ←',
    en: '{count} invoices have a found bank match awaiting your choice →',
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
  // ─── [CREDIT-AFHANDELEN] Closing a creditnota — the RIGHT question, where "Heb je
  // betaald?" is hidden on purpose ([CREDIT-NOT-PAYABLE]). Nothing is paid here: the money came
  // BACK (refunded, in cash, or netted off by the supplier), and this only records that it did.
  'ink.credit.afhandelenKnop': {
    nl: 'Verrekend of terugontvangen?',
    en: 'Netted off or received back?',
    ar: 'تمت المقاصّة أو استرددته؟',
  },
  'ink.credit.afhandelenVraag': {
    nl: 'Creditnota afhandelen?',
    en: 'Close this credit note?',
    ar: 'إغلاق الإشعار الدائن؟',
  },
  // The two method buttons say "Bank" and "Contant"; here is what they MEAN on a credit — the
  // direction is reversed, so the body has to carry it: this is how the money came back, not how
  // it went out. "Verrekend met een andere factuur" books as Bank: no cash moved, and the drawer
  // must not claim it did.
  'ink.credit.afhandelenUitleg': {
    nl: 'Creditnota {number} wordt afgesloten: het bedrag is terugontvangen of verrekend. Kies Bank als het is teruggestort of verrekend met een andere factuur; Contant als je het contant terugkreeg — dan komt het in het kasboek als geld IN de la.',
    en: 'Credit note {number} is closed: the amount was received back or netted off. Choose Bank if it was refunded or netted against another invoice; Contant if you received it in cash — it then enters the cash book as money INTO the drawer.',
    ar: 'سيُغلق الإشعار الدائن {number}: المبلغ استُردّ أو تمت مقاصّته. اختر Bank إذا أُعيد إلى حسابك أو قوصّ مع فاتورة أخرى؛ وContant إذا استلمته نقداً — فيُقيَّد عندها في دفتر الصندوق كمال داخل إلى الدرج.',
  },
  'ink.credit.jaAfhandelen': {
    nl: 'Ja, afgehandeld',
    en: 'Yes, settled',
    ar: 'نعم، انتهى',
  },

  'ink.creditKiesJa': {
    nl: 'Kies je “ja”, dan worden de bedragen als minbedrag opgeslagen: hij gaat van je openstaande saldo af en zijn btw wordt afgetrokken in plaats van opgeteld. Kijk op de factuur — staat er “Creditnota” of “Creditfactuur” bovenaan, of een minbedrag onderaan, dan is het er een.',
    ar: 'إن اخترت «نعم» فستُحفظ المبالغ كمبلغ سالب: تُخصم من رصيدك المفتوح وتُطرح ضريبتها بدلاً من أن تُضاف. انظر إلى الفاتورة — إن وُجد "Creditnota" أو "Creditfactuur" في الأعلى، أو مبلغ سالب في الأسفل، فهي إشعار دائن.',
    en: 'If you choose “yes”, the amounts are stored as a minus amount: it comes off your outstanding balance and its btw is deducted instead of added. Look at the invoice — if it says “Creditnota” or “Creditfactuur” at the top, or a minus amount at the bottom, it is one.',
  },
  // [CREDIT-AL-VERWERKT] De eerste zin is nieuw, en hij is de reden dat deze melding een vraag
  // opriep: hij vertelde alleen wat er nog GAAT gebeuren (terugstorting, of verrekening met een
  // volgende factuur) en niet wat NU al waar is — de creditnota staat met een minbedrag in de
  // boeken en is dus al van "nog te betalen" af. Gemeten: € 820,29 en € -51,80 samen geven
  // € 768,49, want openAmountSigned() draait het teken om bij total_inc_btw < 0.
  //
  // Zonder die zin las de rij als iets dat nog een handeling nodig had, en de eigenaar zocht naar
  // een knop "verwerkt" die er niet is — en er ook niet hoort te zijn, want er valt niets te
  // verwerken. De zin die de zusterkey (ink.creditGeenBetaling) wél had, staat nu hier ook.
  // [CREDIT-AFHANDELEN] Second rewrite of this sentence, and the history is the argument. First
  // it only described the FUTURE, and the owner went looking for a "processed" button. Then
  // (#256) it said "er is niets te bevestigen" — true for the BOOKS (the minus is already off
  // the balance) but it left the row itself unclosable, and the very next report was "how do I
  // close it?". Both fixes answered the accounting question; the owner was asking a WORKFLOW
  // question. Now it says both facts: the books are already right, and the button underneath is
  // how the row itself is closed once the money actually came back.
  'ink.creditKomtToe': {
    nl: 'Dit is geld dat jóu toekomt — je hoeft niets te betalen: hij staat al met een minbedrag in je boeken en is dus al van "nog te betalen" af. Komt de terugstorting op je bankafschrift binnen, dan herkennen we die. Al terugontvangen of door je leverancier verrekend? Sluit hem dan af met "Verrekend of terugontvangen?" hieronder.',
    ar: 'هذا مال مستحق لك أنت — لا تحتاج لدفع شيء: فهو مقيّد أصلاً بمبلغ سالب في دفاترك، أي أنه خُصم بالفعل من «ما زال مستحقاً». إن وصل الاسترداد في كشفك البنكي فسنتعرّف عليه. وإن كنت قد استرددته فعلاً أو قاصّه مورّدك، فأغلقه بزر «تمت المقاصّة أو استرددته؟» أدناه.',
    en: 'This is money owed to YOU — you do not have to pay anything: it already stands as a negative amount in your books, so it has already come off "still to pay". If the refund arrives on your bank statement, we recognise it. Already received back, or netted off by your supplier? Then close it with "Netted off or received back?" below.',
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
  'ink.skipped.kap': {
    nl: 'Dit zijn de {n} nieuwste van {totaal} overgeslagen bijlagen.',
    ar: 'هذه أحدث {n} من أصل {totaal} مرفقًا متخطًّى.',
    en: 'These are the {n} newest of {totaal} skipped attachments.',
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
  'ink.result.naarBank': {
    nl: 'Naar de bankpagina',
    ar: 'إلى صفحة البنك',
    en: 'To the bank page',
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
  'ink.wachtrijOnbekend': {
    nl: 'We konden niet zien wat er klaarstaat',
    ar: 'تعذّر علينا رؤية ما هو في الانتظار',
    en: 'We could not see what is waiting',
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
  // [KAS-LOON] Contant uitbetaald loon. Een eigen categorie en niet 'Kost', omdat de twee in de
  // boeking verschillen: loon draagt NOOIT btw (financial-result boekt salaris rate-free by
  // construction), terwijl een kost met bon en tarief voorbelasting oplevert. Wie een loon als kost
  // moet boeken, verstopt bovendien een loonverplichting in een algemeen kostentotaal.
  'kas.cat.salaris': {
    nl: 'Loon',
    ar: 'أجر',
    en: 'Wages',
  },
  // [KAS-LOON] Wat deze app WEL en NIET doet met een contant loon. De boeking legt de kasbeweging
  // en de kostenpost vast; de loonaangifte is een aparte verplichting die hier niet gebeurt. Dat
  // hoort er te staan op het moment dat de eigenaar 'Loon' kiest, niet in een handleiding: iemand
  // die zijn loon net heeft geboekt mag niet denken dat hij klaar is.
  'kas.loon.uitleg': {
    nl: 'Loon draagt geen btw, dus hier komt geen tarief bij. Let op: dit legt alleen de kasuitgave vast — de loonaangifte en loonheffingen regel je apart.',
    ar: 'الأجر لا يحمل ضريبة قيمة مضافة، فلا تُضاف نسبة هنا. تنبيه: هذا يسجّل الحركة النقدية فقط — إقرار الأجور واستقطاعاتها تتولّاها بشكل منفصل.',
    en: 'Wages carry no VAT, so no rate is added here. Note: this records the cash payment only — the payroll return and payroll taxes are handled separately.',
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
  // [KAS-NEGATIEF-NU] The same dip, in the quarter that is still open. Deliberately a DIFFERENT
  // sentence from kas.negatief.blokkeert: that one is about a quarter whose aangifte the app is
  // refusing right now, and saying it here would be false — nothing is being blocked yet. What is
  // true is that this is the moment it is cheap to fix, while the days are still fresh enough to
  // remember and no filing has been built on them.
  'kas.negatief.nogNietIngediend': {
    nl: 'Dit kwartaal is nog niet ingediend. Los je dit nu op, dan blokkeert het je aangifte straks niet — en de dagen liggen nog vers genoeg om ze na te lopen.',
    ar: 'لم يُقدَّم هذا الربع بعد. إن أصلحته الآن فلن يحجب إقرارك لاحقاً — والأيام لا تزال قريبة بما يكفي لتتبّعها.',
    en: 'This quarter has not been filed yet. Fix it now and it will not block your return later — and the days are still fresh enough to retrace.',
  },
  // [KAS-BRUG] De vierde reden, en in een winkel de gewoonste: er is contant geld van de bank
  // gehaald en de opname is nooit in het kasboek geschreven. De app ZIET die opname al — hij staat
  // geclassificeerd op het bankafschrift dat ze zelf heeft ingelezen. Een poort die een aangifte
  // weigert om een getal, terwijl de waarschijnlijkste onschuldige verklaring voor dat getal in haar
  // eigen database ligt, beschuldigt iemand met het bewijs op zak.
  'kas.brug.titel': {
    nl: 'Je hebt contant geld van de bank gehaald dat niet in je kasboek staat',
    ar: 'سحبت نقداً من البنك ولا يظهر في دفتر النقد',
    en: 'You took cash out of the bank that is not in your cash book',
  },
  'kas.brug.uitleg': {
    nl: 'Dit staat wél op je bankafschrift. Hoort dit geld in de kassa? Boek het dan als opname — dan klopt je kassaldo weer, en meestal is dit precies wat er ontbrak.',
    ar: 'هذا موجود في كشف حسابك البنكي. هل يخصّ هذا المال الكاسة؟ إذاً قيّده كسحب — فيعود رصيدك صحيحاً، وغالباً هذا بالضبط ما كان ناقصاً.',
    en: 'It is on your bank statement. Did this money go into the till? Book it as a withdrawal — your cash balance adds up again, and this is usually exactly what was missing.',
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
  // [BULK-PDF] Meerdere facturen in één keer meenemen.
  'lijst.downloadPdf': {
    nl: 'Download pdf',
    ar: 'تنزيل PDF',
    en: 'Download pdf',
  },
  'lijst.download.mislukt': {
    nl: 'Downloaden lukte niet. Probeer het zo meteen opnieuw.',
    ar: 'لم ينجح التنزيل. أعد المحاولة بعد قليل.',
    en: 'The download did not work. Try again in a moment.',
  },
  'lijst.download.deels': {
    nl: 'Van deze facturen zat geen document in de download: {namen}.',
    ar: 'لم تُدرج مستندات هذه الفواتير في التنزيل: {namen}.',
    en: 'No document was included for these invoices: {namen}.',
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
  // [DEEL-CREDIT] Een creditnota voor een DEEL van de factuur. Niet 'Gecrediteerd' — die belooft
  // dat er niets meer openstaat en dat er niet meer wordt aangemaand, en hier is allebei onwaar.
  // Het bedrag staat in de chip zelf: de ondernemer moet kunnen zien waarom het totaal boven de
  // regel niet meer is wat iemand hem schuldig is.
  // [KAS-DUBBELE-KOST] Dezelfde aankoop twee keer in de boeken: een met de hand getypte kasuitgave
  // naast de inkoopfactuur die er al staat. De zin noemt het BEDRAG en niet alleen het feit — de
  // ondernemer moet kunnen beslissen zonder eerst zelf te rekenen.
  'kas.dubbel.titel': {
    nl: 'Deze uitgave staat mogelijk twee keer in je boeken',
    ar: 'قد تكون هذه المصروفات مسجَّلة مرتين في دفاترك',
    en: 'This expense may be in your books twice',
    tr: 'Bu gider defterlerinizde iki kez yer alıyor olabilir',
  },
  'kas.dubbel.uitleg': {
    nl: 'Je hebt deze kosten met de hand in het kasboek gezet én er staat een inkoopfactuur met hetzelfde bedrag. Dan wordt dezelfde aankoop twee keer als kosten afgetrokken.',
    ar: 'أدخلتَ هذه التكلفة يدوياً في دفتر الصندوق، وتوجد أيضاً فاتورة شراء بنفس المبلغ. عندها تُخصَم نفس المشتريات كتكلفة مرتين.',
    en: 'You typed this cost into the cash book by hand, and there is a purchase invoice for the same amount. The same purchase is then deducted as a cost twice.',
    tr: 'Bu gideri kasa defterine elle girdiniz ve aynı tutarda bir alış faturası da var. Aynı alım o zaman iki kez gider olarak düşülüyor.',
  },
  'kas.dubbel.regel': {
    nl: '{datum} · {bedrag} contant · factuur {nummer} van {leverancier}',
    ar: '{datum} · {bedrag} نقداً · الفاتورة {nummer} من {leverancier}',
    en: '{datum} · {bedrag} cash · invoice {nummer} from {leverancier}',
    tr: '{datum} · {bedrag} nakit · {leverancier} firmasından {nummer} numaralı fatura',
  },
  'kas.dubbel.kosten': {
    nl: '{bedrag} dubbel als kosten',
    ar: '{bedrag} مكرَّرة كتكلفة',
    en: '{bedrag} deducted twice',
    tr: '{bedrag} iki kez gider yazıldı',
  },
  'kas.dubbel.btw': {
    nl: '+ {bedrag} btw dubbel teruggevraagd',
    ar: '+ {bedrag} ضريبة مسترَدّة مرتين',
    en: '+ {bedrag} btw reclaimed twice',
    tr: '+ {bedrag} KDV iki kez geri istendi',
  },
  'kas.dubbel.kasDubbel': {
    nl: 'De factuur is óók op contant gezet, dus je kassaldo staat {bedrag} te laag.',
    ar: 'الفاتورة مُعلَّمة أيضاً كمدفوعة نقداً، فرصيد الصندوق أقل بمقدار {bedrag}.',
    en: 'The invoice is marked paid in cash as well, so your drawer balance is {bedrag} too low.',
    tr: 'Fatura da nakit ödendi olarak işaretli, bu yüzden kasa bakiyeniz {bedrag} düşük görünüyor.',
  },
  // Wat de ondernemer eraan doet. Bewust GEEN knop die het zelf oplost: welke van de twee regels
  // de juiste is, is een vraag over papier dat hij heeft en wij niet.
  'kas.dubbel.watNu': {
    nl: 'Klopt het dat dit dezelfde aankoop is? Verwijder dan de kasregel — de factuur blijft staan en houdt de btw aftrekbaar. Zijn het echt twee aankopen, dan hoef je niets te doen.',
    ar: 'هل هذه فعلاً نفس المشتريات؟ إذاً احذف سطر الصندوق — تبقى الفاتورة وتحفظ حق خصم الضريبة. أما إن كانتا عمليتَي شراء مختلفتين فلا حاجة لأي إجراء.',
    en: 'Is this really the same purchase? Then remove the cash line — the invoice stays and keeps the BTW deductible. If they are genuinely two purchases, nothing needs doing.',
    tr: 'Bu gerçekten aynı alım mı? Öyleyse kasa satırını silin — fatura kalır ve KDV indirilebilir olmayı sürdürür. Gerçekten iki ayrı alımsa bir şey yapmanıza gerek yok.',
  },
  'kas.dubbel.naarFactuur': {
    nl: 'Bekijk de factuur',
    ar: 'عرض الفاتورة',
    en: 'View the invoice',
    tr: 'Faturayı görüntüle',
  },
  // Het paneel toont een handvol regels en zegt eerlijk hoeveel er nog meer zijn. Een lijst van
  // driehonderd amberkleurige regels wordt niet gelezen maar weggescrold, en dan heeft de melding
  // precies het tegenovergestelde gedaan van wat ze moest doen.
  'kas.dubbel.meer': {
    nl: '+ nog {aantal} andere kasregels met dezelfde vraag.',
    ar: '+ {aantal} سطر صندوق آخر عليها نفس السؤال.',
    en: '+ {aantal} more cash lines with the same question.',
    tr: '+ aynı soruyu taşıyan {aantal} kasa satırı daha.',
  },
  'kas.dubbel.nietGecontroleerd': {
    nl: 'We konden niet nakijken of er kosten dubbel in je boeken staan. Probeer het later opnieuw.',
    ar: 'تعذّر التحقق مما إذا كانت هناك تكاليف مكرَّرة في دفاترك. حاول لاحقاً.',
    en: 'We could not check whether any costs are in your books twice. Try again later.',
    tr: 'Defterlerinizde giderlerin iki kez yer alıp almadığını kontrol edemedik. Daha sonra tekrar deneyin.',
  },
  'lijst.deelsGecrediteerd': {
    nl: 'Deels gecrediteerd · {bedrag} terug',
    ar: 'إشعار دائن جزئي · {bedrag} مُعادة',
    en: 'Partly credited · {bedrag} returned',
    tr: 'Kısmen alacaklandırıldı · {bedrag} iade',
  },
  'lijst.deelsGecrediteerd.uitleg': {
    nl: 'Er is voor {bedrag} gecrediteerd op deze factuur. De rest staat nog open en wordt gewoon aangemaand.',
    ar: 'صدر إشعار دائن بمبلغ {bedrag} على هذه الفاتورة. الباقي ما زال مستحقاً وتُرسَل له التذكيرات كالمعتاد.',
    en: 'A creditnota of {bedrag} was made against this invoice. The rest is still owed and is still chased.',
    tr: 'Bu fatura için {bedrag} tutarında alacak dekontu düzenlendi. Kalanı hâlâ açık ve takip ediliyor.',
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
  // [HERSTEL] Dezelfde correctie als bewerk.modal.waarschuwing — twee schermen versturen een
  // factuur, en ze mogen niet iets anders beweren over hetzelfde document.
  'lijst.send.waarschuwing': {
    nl: 'Het factuurnummer ligt na verzending vast en is niet meer te wijzigen. De factuur zelf kun je nog corrigeren zolang hij niet betaald of verwerkt is — je klant krijgt dan automatisch de gecorrigeerde versie.',
    ar: 'رقم الفاتورة يثبت عند الإرسال ولا يمكن تغييره. أما الفاتورة نفسها فيمكنك تصحيحها ما دامت غير مدفوعة وغير مُرحَّلة — وعندها يستلم عميلك النسخة المصحّحة تلقائياً.',
    en: 'The invoice number is fixed on sending and cannot be changed. The invoice itself can still be corrected while it is unpaid and not yet booked — your customer then automatically receives the corrected version.',
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
  'aang.correcties': {
    nl: 'Correcties uit eerdere kwartalen',
    ar: 'تصحيحات من أرباع سابقة',
    en: 'Corrections from earlier quarters',
  },
  'aang.correcties.uitleg': {
    nl: 'Deze kwartalen zijn al ingediend en daarna gewijzigd. Omdat het verschil per kwartaal €1.000 of minder is, mag je het in deze aangifte verwerken — tel het bij de betreffende rubriek op. Wij vullen niets voor je in.',
    ar: 'هذه الأرباع قُدِّمت بالفعل ثم تغيّرت. وبما أن الفرق في كل ربع €1.000 أو أقل، يجوز لك معالجته في هذا الـaangifte — أضِفه إلى البند المعني. نحن لا نملأ شيئاً نيابةً عنك.',
    en: 'These quarters have been filed and have changed since. Because the difference per quarter is €1,000 or less, you may process it in this return — add it to the relevant rubriek. We fill in nothing for you.',
  },
  'aang.correcties.meer': {
    nl: 'meer te betalen',
    ar: 'مبلغ إضافي مستحق',
    en: 'more to pay',
  },
  'aang.correcties.minder': {
    nl: 'minder te betalen',
    ar: 'مبلغ أقل مستحق',
    en: 'less to pay',
  },
  'aang.correcties.eerderVerwerkt': {
    nl: 'eerder al {amount} verwerkt',
    ar: 'سبق معالجة {amount}',
    en: '{amount} already processed earlier',
  },
  'aang.correcties.verwerkt': {
    nl: 'Verwerkt',
    ar: 'تمت المعالجة',
    en: 'Processed',
  },
  'aang.correcties.bezig': {
    nl: 'Bezig…',
    ar: 'جارٍ…',
    en: 'Working…',
  },
  'aang.correcties.onbekend': {
    nl: 'We konden niet van alle eerdere kwartalen nagaan of er nog iets te verrekenen is. Kijk op de Waarheid-pagina voordat je deze aangifte indient.',
    ar: 'تعذّر علينا التحقّق من كل الأرباع السابقة إن كان لا يزال هناك ما يُسوّى. راجع صفحة Waarheid قبل تقديم هذا الـaangifte.',
    en: 'We could not check every earlier quarter for anything still to settle. Look at the Waarheid page before you file this return.',
  },
  'aang.correcties.mislukt': {
    nl: 'Vastleggen mislukt — er is niets gewijzigd. Probeer het zo meteen opnieuw.',
    ar: 'فشل التسجيل — لم يتغيّر شيء. حاول مرة أخرى بعد قليل.',
    en: 'Could not record it — nothing was changed. Try again in a moment.',
  },
  'aang.correcties.geenVerbinding': {
    nl: 'Geen verbinding — er is niets gewijzigd.',
    ar: 'لا يوجد اتصال — لم يتغيّر شيء.',
    en: 'No connection — nothing was changed.',
  },
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

  // ─── [BETAALBEWIJS] Under every "Betaald", how we know ──────────────────────────────────────
  //
  // A payment PROVEN by a bank line and a payment the owner ticked by hand are different facts.
  // The first is corroborated by a third party; the second is a memory. Rendering both as the same
  // word borrows the bank's authority for the tick — and when the tick was a mistake, nothing on
  // the screen ever says so.
  //
  // The direction is not decoration. Money leaves for a purchase invoice and ARRIVES for a sales
  // one, so "afgeschreven naar Kiwi Food Market" under an invoice Kiwi paid describes the owner
  // paying their own customer. Own keys per direction, per rule 1 of this file.

  'betaal.onbekend': {
    nl: 'We konden niet nakijken waar deze betaling vandaan komt.',
    ar: 'تعذّر التحقق من مصدر هذه الدفعة.',
    en: 'We could not check where this payment came from.',
  },
  // Honest, and rare. "Betaald" with nothing recording how is the one case where the app has a
  // status and no evidence at all — saying so is what keeps the other two worth believing.
  'betaal.geen': {
    nl: 'Als betaald gemarkeerd, maar er is geen betaling aan gekoppeld.',
    ar: 'مُعلَّمة كمدفوعة، لكن لا توجد دفعة مرتبطة بها.',
    en: 'Marked as paid, but no payment is linked to it.',
  },

  'betaal.hand': {
    nl: '{bedrag} door jou afgevinkt op {datum} — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت بتاريخ {datum} — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you on {datum} — no bank line is linked to it.',
  },
  'betaal.hand.zonderDatum': {
    nl: '{bedrag} door jou afgevinkt — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you — no bank line is linked to it.',
  },
  'betaal.hand.kas': {
    nl: '{bedrag} door jou contant afgevinkt op {datum} — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت نقداً بتاريخ {datum} — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you as cash on {datum} — no bank line is linked to it.',
  },
  'betaal.hand.kas.zonderDatum': {
    nl: '{bedrag} door jou contant afgevinkt — er is geen bankregel aan gekoppeld.',
    ar: '{bedrag} علّمتها أنت نقداً — لا يوجد سطر بنكي مرتبط بها.',
    en: '{bedrag} ticked off by you as cash — no bank line is linked to it.',
  },

  // Money OUT — a bill the owner paid.
  'betaal.bank.inkoop': {
    nl: '{bedrag} afgeschreven op {datum} naar {naam}',
    ar: 'خُصم {bedrag} في {datum} إلى {naam}',
    en: '{bedrag} debited on {datum} to {naam}',
  },
  'betaal.bank.inkoop.zonderNaam': {
    nl: '{bedrag} afgeschreven op {datum}',
    ar: 'خُصم {bedrag} في {datum}',
    en: '{bedrag} debited on {datum}',
  },
  'betaal.bank.inkoop.zonderDatum': {
    nl: '{bedrag} afgeschreven naar {naam}',
    ar: 'خُصم {bedrag} إلى {naam}',
    en: '{bedrag} debited to {naam}',
  },
  'betaal.bank.inkoop.kaal': {
    nl: '{bedrag} afgeschreven',
    ar: 'خُصم {bedrag}',
    en: '{bedrag} debited',
  },
  // Money IN — an invoice the owner issued and a customer settled.
  'betaal.bank.verkoop': {
    nl: '{bedrag} bijgeschreven op {datum} van {naam}',
    ar: 'وصل {bedrag} في {datum} من {naam}',
    en: '{bedrag} credited on {datum} from {naam}',
  },
  'betaal.bank.verkoop.zonderNaam': {
    nl: '{bedrag} bijgeschreven op {datum}',
    ar: 'وصل {bedrag} في {datum}',
    en: '{bedrag} credited on {datum}',
  },
  'betaal.bank.verkoop.zonderDatum': {
    nl: '{bedrag} bijgeschreven van {naam}',
    ar: 'وصل {bedrag} من {naam}',
    en: '{bedrag} credited from {naam}',
  },
  'betaal.bank.verkoop.kaal': {
    nl: '{bedrag} bijgeschreven',
    ar: 'وصل {bedrag}',
    en: '{bedrag} credited',
  },

  // The bank's own text, quoted verbatim — it is the string the owner RECOGNISES, and recognition
  // is the whole mechanism here. A tidied version is a string they have never seen.
  // ─── [BINNENGEKOMEN-BEWIJS] Money in that belongs to no invoice ──────────────────────────────
  //
  // The mirror of the openstaand panel, asked of the MONEY. Readiness already counts unexplained
  // receipts, and a count cannot tell three payments of € 5 from three of € 5.000 — the first is
  // tidiness, the second is turnover that was never invoiced (art. 52 AWR). So the SUM is named,
  // and so is the day the most recent one arrived: old is a tidy-up, this week is a gap.

  'binnen.scope.een': {
    nl: '1 ontvangen betaling nagekeken tegen {facturen}.',
    ar: 'رُوجعت دفعة واردة واحدة مقابل {facturen}.',
    en: '1 received payment checked against {facturen}.',
  },
  'binnen.scope.meer': {
    nl: '{count} ontvangen betalingen nagekeken tegen {facturen}.',
    ar: 'رُوجعت {count} دفعة واردة مقابل {facturen}.',
    en: '{count} received payments checked against {facturen}.',
  },
  'binnen.tegen.geen': { nl: 'geen openstaande verkoopfacturen', ar: 'لا فواتير مبيعات مفتوحة', en: 'no open sales invoices' },
  'binnen.tegen.een': { nl: '1 openstaande verkoopfactuur', ar: 'فاتورة مبيعات مفتوحة واحدة', en: '1 open sales invoice' },
  'binnen.tegen.meer': { nl: '{count} openstaande verkoopfacturen', ar: '{count} فاتورة مبيعات مفتوحة', en: '{count} open sales invoices' },

  // Money already in, on an invoice the app still calls open — the same finding as the panel
  // above, said from the other side, and the one the owner can act on in a click.
  'binnen.herkend.een': {
    nl: '1 daarvan lijkt bij een factuur te horen die nog openstaat.',
    ar: 'واحدة منها يبدو أنها تخصّ فاتورة ما زالت مفتوحة.',
    en: '1 of them appears to belong to an invoice that is still open.',
  },
  'binnen.herkend.meer': {
    nl: '{count} daarvan lijken bij facturen te horen die nog openstaan.',
    ar: '{count} منها يبدو أنها تخصّ فواتير ما زالت مفتوحة.',
    en: '{count} of them appear to belong to invoices that are still open.',
  },

  // The figure the app never showed. Never an accusation — a payment with no invoice can be a
  // deposit, a private transfer or a refund, and the owner is the only one who knows which.
  'binnen.onbekend.een': {
    nl: '1 betaling van {bedrag} hoort bij geen enkele factuur in je boeken (laatste op {datum}).',
    ar: 'دفعة واحدة بمبلغ {bedrag} لا تخصّ أي فاتورة في دفاترك (آخرها في {datum}).',
    en: '1 payment of {bedrag} belongs to no invoice in your books (most recent on {datum}).',
  },
  'binnen.onbekend.meer': {
    nl: '{count} betalingen van samen {bedrag} horen bij geen enkele factuur in je boeken (laatste op {datum}).',
    ar: '{count} دفعات بمجموع {bedrag} لا تخصّ أي فاتورة في دفاترك (آخرها في {datum}).',
    en: '{count} payments totalling {bedrag} belong to no invoice in your books (most recent on {datum}).',
  },
  'binnen.onbekend.watNu': {
    nl: 'Koppel ze bij Bank, of maak er een factuur voor als er omzet in zit.',
    ar: 'اربطها في صفحة Bank، أو أصدر لها فاتورة إن كانت إيراداً.',
    en: 'Link them under Bank, or invoice them if they are turnover.',
  },

  // ─── [DUBBEL-BEWIJS] The no-double-pay check, saying what it did ─────────────────────────────
  //
  // The check answers "have you already paid this?" and had exactly two answers on screen: a
  // warning, or an ordinary pay dialog. "We could not look" rendered as the second one — the same
  // pixels as a completed search that found nothing. Four separate paths reached it: the invoice
  // unreadable, the paid set unreadable, no amount on the document, no vendor to anchor on.
  //
  // These sentences give the check its third answer, and give the other two the SEARCH behind
  // them. Whole sentences per case rather than a noun parameter: 'rekening'/'rekeningen' is a
  // Dutch plural, and a language with a dual or with suffix harmony cannot be served by swapping
  // the noun into a slot.

  'dubbel.zoek.geen': {
    nl: 'Nagekeken: je hebt deze leverancier de afgelopen {dagen} dagen niet eerder dit bedrag betaald.',
    ar: 'تم التحقّق: لم تدفع لهذا المورّد هذا المبلغ خلال آخر {dagen} يوماً.',
    en: 'Checked: you have not paid this supplier this amount in the past {dagen} days.',
  },
  'dubbel.zoek.een': {
    nl: 'Nagekeken tegen 1 rekening die je deze leverancier de afgelopen {dagen} dagen voor hetzelfde bedrag betaalde.',
    ar: 'تمّت المقارنة مع فاتورة واحدة دفعتها لهذا المورّد بالمبلغ نفسه خلال آخر {dagen} يوماً.',
    en: 'Checked against 1 invoice you paid this supplier for the same amount in the past {dagen} days.',
  },
  'dubbel.zoek.meer': {
    nl: 'Nagekeken tegen {count} rekeningen die je deze leverancier de afgelopen {dagen} dagen voor hetzelfde bedrag betaalde.',
    ar: 'تمّت المقارنة مع {count} فواتير دفعتها لهذا المورّد بالمبلغ نفسه خلال آخر {dagen} يوماً.',
    en: 'Checked against {count} invoices you paid this supplier for the same amount in the past {dagen} days.',
  },
  'dubbel.zoek.grens': {
    nl: 'We hebben de {count} meest recente bekeken. Betaalde je deze leverancier vaker dit bedrag, dan zitten de oudste er niet bij.',
    ar: 'راجعنا أحدث {count} منها. إن كنت قد دفعت لهذا المورّد هذا المبلغ أكثر من ذلك، فالأقدم ليست ضمنها.',
    en: 'We looked at the {count} most recent. If you paid this supplier this amount more often than that, the oldest are not included.',
  },
  'dubbel.anker.iban': {
    nl: 'De leverancier is herkend aan het IBAN, dus aan een rekeningnummer dat maar op één manier geschreven kan worden.',
    ar: 'جرى التعرّف على المورّد عبر الـiban، أي عبر رقم حساب لا يُكتب إلا بصورة واحدة.',
    en: 'The supplier was identified by iban — an account number that can only be written one way.',
  },
  'dubbel.anker.naam': {
    nl: 'De leverancier is herkend aan de naam, niet aan een IBAN. Staat die naam op de twee rekeningen net anders geschreven, dan ziet deze controle ze niet als dezelfde leverancier.',
    ar: 'جرى التعرّف على المورّد بالاسم لا بالـiban. فإن كُتب الاسم على الفاتورتين بصيغتين مختلفتين قليلاً، فلن يعتبرهما هذا الفحص مورّداً واحداً.',
    en: 'The supplier was identified by name, not by iban. If that name is written even slightly differently on the two invoices, this check does not see them as the same supplier.',
  },

  'dubbel.onbekend.factuur': {
    nl: 'We konden deze rekening zelf niet lezen, dus we hebben niet kunnen nakijken of je hem al betaald hebt.',
    ar: 'لم نتمكّن من قراءة هذه الفاتورة نفسها، فلم نستطع التحقّق ممّا إذا كنت قد دفعتها من قبل.',
    en: 'We could not read this invoice itself, so we could not check whether you have already paid it.',
  },
  'dubbel.onbekend.eerder': {
    nl: 'We konden je eerder betaalde rekeningen niet lezen, dus we hebben niet kunnen nakijken of je deze al betaald hebt.',
    ar: 'لم نتمكّن من قراءة فواتيرك المدفوعة سابقاً، فلم نستطع التحقّق ممّا إذا كنت قد دفعت هذه من قبل.',
    en: 'We could not read your previously paid invoices, so we could not check whether you have already paid this one.',
  },
  'dubbel.onbekend.bedrag': {
    nl: 'Op deze rekening staat geen bruikbaar bedrag. Zonder bedrag kunnen we niet nakijken of je hem al betaald hebt.',
    ar: 'لا يحمل هذا المستند مبلغاً صالحاً للاستعمال. وبلا مبلغ لا يمكننا التحقّق ممّا إذا كنت قد دفعته من قبل.',
    en: 'This invoice carries no usable amount. Without one we cannot check whether you have already paid it.',
  },
  'dubbel.onbekend.leverancier': {
    nl: 'Op deze rekening staat geen leverancier en geen IBAN. Zonder een van die twee kunnen we niet nakijken of je hem al betaald hebt.',
    ar: 'لا يحمل هذا المستند اسم مورّد ولا iban. وبدون أحدهما لا يمكننا التحقّق ممّا إذا كنت قد دفعته من قبل.',
    en: 'This invoice carries neither a supplier nor an iban. Without one of the two we cannot check whether you have already paid it.',
  },
  // Covers every way the SCREEN failed to get an answer — a dropped connection, an expired
  // session, a request the route refused. Deliberately does not name which: the owner's next step
  // is the same in all of them, and guessing wrong about the cause is worse than not saying.
  'dubbel.onbekend.netwerk': {
    nl: 'De controle op dubbel betalen is niet uitgevoerd.',
    ar: 'لم يُنفَّذ فحص الدفع المزدوج.',
    en: 'The double-payment check did not run.',
  },
  'dubbel.onbekend.watNu': {
    nl: 'Kijk zelf even na of je deze rekening al betaald hebt voordat je hem afvinkt.',
    ar: 'تحقّق بنفسك ممّا إذا كنت قد دفعت هذه الفاتورة قبل أن تعلّمها كمدفوعة.',
    en: 'Check for yourself whether you have already paid this invoice before ticking it off.',
  },

  // ─── [DUBBEL-BUNDEL] The same three answers, for a whole set at once ─────────────────────────
  //
  // executeBundlePay marked N supplier invoices paid through /api/invoice/pay-toggle and never
  // called the duplicate check at all. The path that pays the MOST invoices in one tap — and where
  // the owner is reviewing five documents instead of one — had no check, and the dialog said
  // nothing about not having one.
  //
  // Precedence in these sentences is deliberate: a real twin outranks an unchecked row, but an
  // unchecked row is never absorbed into a "we checked them all" count. That absorption is the
  // whole defect, one level up.

  'dubbel.bundel.alarm.een': {
    nl: 'Eén van deze rekeningen lijkt je al betaald te hebben: {nummers}.',
    ar: 'يبدو أنك دفعت إحدى هذه الفواتير من قبل: {nummers}.',
    en: 'One of these invoices looks like one you have already paid: {nummers}.',
  },
  'dubbel.bundel.alarm.meer': {
    nl: '{count} van deze rekeningen lijk je al betaald te hebben: {nummers}.',
    ar: 'يبدو أنك دفعت {count} من هذه الفواتير من قبل: {nummers}.',
    en: '{count} of these invoices look like ones you have already paid: {nummers}.',
  },
  // The same alarm for a set whose documents carry no readable number. It cannot name them, and
  // says so rather than printing a sentence that trails off into nothing.
  'dubbel.bundel.alarm.geenNummer': {
    nl: '{count} van deze rekeningen lijk je al betaald te hebben. We kunnen ze hier niet bij nummer noemen.',
    ar: 'يبدو أنك دفعت {count} من هذه الفواتير من قبل. لا يمكننا تسميتها هنا بالأرقام.',
    en: '{count} of these invoices look like ones you have already paid. We cannot name them by number here.',
  },
  'dubbel.bundel.onbekend.een': {
    nl: 'Van 1 rekening konden we niet nakijken of je hem al betaald hebt.',
    ar: 'هناك فاتورة واحدة لم نتمكّن من التحقّق ممّا إذا كنت قد دفعتها.',
    en: 'For 1 invoice we could not check whether you have already paid it.',
  },
  'dubbel.bundel.onbekend.meer': {
    nl: 'Van {count} rekeningen konden we niet nakijken of je ze al betaald hebt.',
    ar: 'هناك {count} فواتير لم نتمكّن من التحقّق ممّا إذا كنت قد دفعتها.',
    en: 'For {count} invoices we could not check whether you have already paid them.',
  },
  'dubbel.bundel.schoon': {
    nl: 'Alle {count} nagekeken: geen ervan lijkt al betaald.',
    ar: 'تم التحقّق من {count} جميعها: لا يبدو أن أياً منها مدفوع من قبل.',
    en: 'All {count} checked: none of them looks already paid.',
  },
  'dubbel.bundel.grens': {
    nl: 'We hebben er {count} van de {totaal} nagekeken. Over de rest zeggen we niets, want daar hebben we niet naar gekeken.',
    ar: 'راجعنا {count} من أصل {totaal}. ولا نقول شيئاً عن البقية لأننا لم نطّلع عليها.',
    en: 'We checked {count} of the {totaal}. We say nothing about the rest, because we did not look at them.',
  },
  // The sweep is still running. Its own state on purpose: the owner can tap confirm at any moment,
  // including before the answers land, and a blank space there is the same silence as before —
  // just briefer. It also covers a fetch that never settles, where a blank would be permanent.
  'dubbel.bundel.bezig': {
    nl: 'We kijken nog na of je een van deze rekeningen al betaald hebt.',
    ar: 'ما زلنا نتحقّق ممّا إذا كنت قد دفعت إحدى هذه الفواتير من قبل.',
    en: 'We are still checking whether you have already paid any of these invoices.',
  },
  'dubbel.bundel.watNu': {
    nl: 'Kijk die eerst na voordat je de hele set afvinkt.',
    ar: 'راجع تلك أولاً قبل أن تعلّم المجموعة كلها كمدفوعة.',
    en: 'Check those first before ticking off the whole set.',
  },

  // ─── [CREDIT-BEWIJS] Which credit notes produced "Deels gecrediteerd · € 250" ────────────────
  //
  // Same shape as the instalments above, and the same reason: the chip states a conclusion the
  // owner can only check by going and finding the credit notes. Unlike a bank line, these are
  // documents THEY sent, each with a number on it — so naming them is not evidence the app has to
  // gather, only evidence it was already holding and never showed.

  'credit.samen.een': {
    nl: '{bedrag} teruggegeven met 1 creditnota:',
    ar: 'أُعيد {bedrag} بإشعار دائن واحد:',
    en: '{bedrag} credited back with 1 credit note:',
  },
  'credit.samen.meer': {
    nl: '{bedrag} teruggegeven met {count} creditnota\u2019s:',
    ar: 'أُعيد {bedrag} بـ{count} إشعارات دائنة:',
    en: '{bedrag} credited back with {count} credit notes:',
  },
  'credit.regel': {
    nl: '{nummer} · {datum} — {bedrag}',
    ar: '{nummer} · {datum} — {bedrag}',
    en: '{nummer} · {datum} — {bedrag}',
  },
  'credit.regel.zonderDatum': { nl: '{nummer} — {bedrag}', ar: '{nummer} — {bedrag}', en: '{nummer} — {bedrag}' },
  // A creditnota still in concept has no number yet, and that is the truth rather than a gap:
  // the number falls when it is sent (Art. 35).
  'credit.regel.zonderNummer': {
    nl: 'Concept — nog geen nummer · {bedrag}',
    ar: 'مسودة — بلا رقم بعد · {bedrag}',
    en: 'Draft — no number yet · {bedrag}',
  },

  // [NO-SILENT-EMPTY] The credit read did not answer. Every amount on the list may then be too
  // high, and the withdrawn-invoice chips are missing — so the screen says so rather than letting
  // an invoice the owner formally withdrew look completely chaseable.
  'credit.leesFout': {
    nl: 'We konden niet nakijken welke facturen je hebt gecrediteerd. De bedragen hieronder kunnen te hoog staan.',
    ar: 'تعذّر التحقق من الفواتير التي أصدرت لها إشعارات دائنة. قد تكون المبالغ أدناه أعلى من الواقع.',
    en: 'We could not check which invoices you have credited. The amounts below may be too high.',
  },

  // ─── [DEELBETALING-BEWIJS] The arithmetic behind "nog € X open", written out ─────────────────
  //
  // A partly settled invoice is where a conclusion is hardest to check by hand: the row says
  // "Deels betaald · nog € 460", and the owner has no way to see WHICH instalments produced that
  // without opening their bank and adding up. So the instalments are named, each with its own
  // evidence, and the sum is stated beside the invoice total.

  'deel.samen.meer': {
    nl: '{betaald} van {totaal} voldaan, in {count} betalingen:',
    ar: 'سُدِّد {betaald} من {totaal}، على {count} دفعات:',
    en: '{betaald} of {totaal} settled, in {count} payments:',
  },
  // No key for "one instalment": every payment sentence now carries its own amount, bank and hand
  // alike. A wrapper that prefixed the figure produced it twice on a bank line ("€ 500,00 —
  // € 500,00 bijgeschreven…") and read as two dashes on a hand-recorded one.

  // [NO-SILENT-EMPTY] invoices.amount_paid is a CACHED SUM of the very rows listed above. When the
  // two disagree the screen is showing a remainder no instalment supports, and it may not quietly
  // believe one side: it says both figures and leaves the judgement where it belongs.
  'deel.verschil': {
    nl: 'Let op: de app rekent met {geboekt} betaald, maar de vastgelegde betalingen tellen op tot {geteld}. Laat dit nakijken voordat je hierop afgaat.',
    ar: 'تنبيه: التطبيق يحسب {geboekt} مدفوعاً، بينما مجموع الدفعات المسجَّلة {geteld}. راجع هذا قبل الاعتماد عليه.',
    en: 'Note: the app is working with {geboekt} paid, but the recorded payments add up to {geteld}. Have this checked before relying on it.',
  },
  // The sum could not be checked at all — a legacy link with no amount anywhere. Never silence:
  // an unverifiable total that reads like a verified one is the whole failure mode here.
  'deel.verschil.onmeetbaar': {
    nl: 'Eén van deze betalingen heeft geen vastgelegd bedrag, dus het openstaande saldo is hier niet na te rekenen.',
    ar: 'إحدى هذه الدفعات بلا مبلغ مسجَّل، لذا لا يمكن التحقق من الرصيد المتبقي هنا.',
    en: 'One of these payments has no recorded amount, so the outstanding balance cannot be verified here.',
  },

  // The one case where no figure may be printed: a legacy link with no amount of its own AND no
  // bank row to read one from. "€ 0,00 afgeschreven" would be a number nobody wrote down.
  'betaal.bank.bedragOnbekend': {
    nl: 'Er is een bankbetaling aan deze factuur gekoppeld; het bedrag is hier niet vastgelegd.',
    ar: 'هناك دفعة بنكية مرتبطة بهذه الفاتورة؛ المبلغ غير مسجَّل هنا.',
    en: 'A bank payment is linked to this invoice; the amount is not recorded here.',
  },
  'betaal.bank.omschrijving': { nl: '{regel} — “{tekst}”', ar: '{regel} — «{tekst}»', en: '{regel} — “{tekst}”' },
  'betaal.bank.meer.een': {
    nl: '{regel} (+ 1 andere betaling)',
    ar: '{regel} (+ دفعة أخرى)',
    en: '{regel} (+ 1 other payment)',
  },
  'betaal.bank.meer.meer': {
    nl: '{regel} (+ {count} andere betalingen)',
    ar: '{regel} (+ {count} دفعات أخرى)',
    en: '{regel} (+ {count} other payments)',
  },
  'betaal.bank.deelsHand': {
    nl: '{regel} Een deel is door jou zelf afgevinkt.',
    ar: '{regel} جزء منها علّمته أنت بنفسك.',
    en: '{regel} Part of it was ticked off by you.',
  },

  // ─── [OPENSTAAND-BEWIJS] The panel that states the SEARCH, not the conclusion ───────────────
  //
  // Rule 1 of this file, applied literally: the noun is never a parameter. "inkoopfactuur" and
  // "verkoopfactuur" get their own keys per sentence, because Arabic agreement and Turkish suffix
  // harmony both hang off the noun — and because the two panels are read by the same person in the
  // same session, so they may never collapse into one sentence about two different piles of money.
  //
  // The counted phrases ARE parameters, and that is the exception the rule allows: each is a
  // complete noun phrase built from its own key, carrying its own number and its own agreement, so
  // the frame around it never has to inflect.

  'bewijs.geenOpen.inkoop': {
    nl: 'Er staan geen inkoopfacturen open om na te kijken.',
    ar: 'لا توجد فواتير شراء مفتوحة للمراجعة.',
    en: 'There are no open purchase invoices to check.',
  },
  'bewijs.geenOpen.verkoop': {
    nl: 'Er staan geen verkoopfacturen open om na te kijken.',
    ar: 'لا توجد فواتير مبيعات مفتوحة للمراجعة.',
    en: 'There are no open sales invoices to check.',
  },

  'bewijs.aantal.inkoop.een': {
    nl: '1 openstaande inkoopfactuur',
    ar: 'فاتورة شراء مفتوحة واحدة',
    en: '1 open purchase invoice',
  },
  'bewijs.aantal.inkoop.meer': {
    nl: '{count} openstaande inkoopfacturen',
    ar: '{count} فاتورة شراء مفتوحة',
    en: '{count} open purchase invoices',
  },
  'bewijs.aantal.verkoop.een': {
    nl: '1 openstaande verkoopfactuur',
    ar: 'فاتورة مبيعات مفتوحة واحدة',
    en: '1 open sales invoice',
  },
  'bewijs.aantal.verkoop.meer': {
    nl: '{count} openstaande verkoopfacturen',
    ar: '{count} فاتورة مبيعات مفتوحة',
    en: '{count} open sales invoices',
  },

  // No bank data is NOT a clean bill of health, and this sentence may never be shortened into one.
  'bewijs.geenBank': {
    nl: '{facturen} — nog niet vergeleken met je bank. Er staan geen banktransacties klaar om tegen te houden; importeer je bankafschrift.',
    ar: '{facturen} — لم تُقارَن بعد بحسابك البنكي. لا توجد حركات بنكية جاهزة للمقارنة؛ استورد كشف حسابك.',
    en: '{facturen} — not yet compared with your bank. There are no bank transactions to hold them against; import your bank statement.',
  },

  'bewijs.scope.een': {
    nl: '{facturen} vergeleken met 1 banktransactie{tot}.',
    ar: '{facturen} قُورنت بحركة بنكية واحدة{tot}.',
    en: '{facturen} compared with 1 bank transaction{tot}.',
  },
  'bewijs.scope.meer': {
    nl: '{facturen} vergeleken met {tx} banktransacties{tot}.',
    ar: '{facturen} قُورنت بـ{tx} حركة بنكية{tot}.',
    en: '{facturen} compared with {tx} bank transactions{tot}.',
  },
  // The horizon — where the app stops knowing. The single most trust-building clause on the panel
  // and the cheapest, so it is its own key and never silently dropped by a translation.
  'bewijs.scope.tot': { nl: ' t/m {datum}', ar: ' حتى {datum}', en: ' through {datum}' },

  'bewijs.niets': {
    nl: '{scope} Geen betaling gevonden die bij een van deze facturen past.',
    ar: '{scope} لم نجد أي دفعة تطابق واحدة من هذه الفواتير.',
    en: '{scope} No payment found that matches any of these invoices.',
  },
  'bewijs.raak.een': {
    nl: '{scope} Bij 1 factuur vonden we tóch een betaling die erbij lijkt te passen.',
    ar: '{scope} ومع ذلك وجدنا لدى فاتورة واحدة دفعة يبدو أنها تخصّها.',
    en: '{scope} For 1 invoice we did find a payment that appears to match it.',
  },
  'bewijs.raak.meer': {
    nl: '{scope} Bij {count} facturen vonden we tóch een betaling die erbij lijkt te passen.',
    ar: '{scope} ومع ذلك وجدنا لدى {count} فواتير دفعات يبدو أنها تخصّها.',
    en: '{scope} For {count} invoices we did find a payment that appears to match them.',
  },

  // On a purchase invoice the owner looks for money that LEFT; on a sales invoice for money that
  // ARRIVED. One wrong preposition here is a sentence read twice and believed half.
  'bewijs.hit.inkoop': {
    nl: '{bedrag} op {datum} aan {naam}',
    ar: '{bedrag} في {datum} إلى {naam}',
    en: '{bedrag} on {datum} to {naam}',
  },
  'bewijs.hit.verkoop': {
    nl: '{bedrag} op {datum} van {naam}',
    ar: '{bedrag} في {datum} من {naam}',
    en: '{bedrag} on {datum} from {naam}',
  },
  'bewijs.hit.zonderNaam': { nl: '{bedrag} op {datum}', ar: '{bedrag} في {datum}', en: '{bedrag} on {datum}' },
  // The bank's own text, quoted verbatim: it is the string the owner recognises, and a tidied
  // version of it is a string they have never seen.
  'bewijs.hit.omschrijving': { nl: '{regel} — “{tekst}”', ar: '{regel} — «{tekst}»', en: '{regel} — “{tekst}”' },

  'bewijs.regel.open': { nl: '{bedrag} open', ar: '{bedrag} مستحقة', en: '{bedrag} outstanding' },
  'bewijs.regel.factuur': { nl: 'Factuur', ar: 'فاتورة', en: 'Invoice' },
  // A question, never a verdict: both numbers come from a reading, and picking a winner is the
  // overconfidence that produces the wrong number in the first place.
  'bewijs.vraag.inkoop': {
    nl: 'In je bank staat {bewijs}. Klopt het dat deze factuur nog openstaat?',
    ar: 'في حسابك البنكي: {bewijs}. هل صحيح أن هذه الفاتورة ما زالت غير مدفوعة؟',
    en: 'Your bank shows {bewijs}. Is it correct that this invoice is still outstanding?',
  },
  'bewijs.vraag.verkoop': {
    nl: 'In je bank staat {bewijs}. Klopt het dat deze klant nog niet betaald heeft?',
    ar: 'في حسابك البنكي: {bewijs}. هل صحيح أن هذا العميل لم يدفع بعد؟',
    en: 'Your bank shows {bewijs}. Is it correct that this customer has not paid yet?',
  },

  // [NO-SILENT-EMPTY] A proof that could not run may never read as one that found nothing.
  'bewijs.leesFout': {
    nl: 'We konden je openstaande facturen nu niet met je bank vergelijken. Deze lijst klopt met wat er in de app staat, maar is niet tegen je bankafschriften gehouden.',
    ar: 'تعذّرت مقارنة فواتيرك المفتوحة بحسابك البنكي الآن. هذه القائمة مطابقة لما في التطبيق، لكنها لم تُقارَن بكشوف حسابك.',
    en: 'We could not compare your open invoices with your bank just now. This list matches what is in the app, but has not been held against your bank statements.',
  },

  // A bounded check presented as a complete one is exactly the false reassurance this panel
  // exists to remove. Three whole sentences, never a fragment glued to a conjunction.
  'bewijs.beperkt.facturen': {
    nl: 'Niet alles is meegenomen: {count} facturen vielen buiten deze controle.',
    ar: 'لم يُشمل كل شيء: {count} فاتورة خارج نطاق هذا الفحص.',
    en: 'Not everything was included: {count} invoices fell outside this check.',
  },
  'bewijs.beperkt.transacties': {
    nl: 'Niet alles is meegenomen: {count} banktransacties vielen buiten deze controle.',
    ar: 'لم يُشمل كل شيء: {count} حركة بنكية خارج نطاق هذا الفحص.',
    en: 'Not everything was included: {count} bank transactions fell outside this check.',
  },
  // [HERINNER-BEWIJS] The most expensive mistake this product can make, stated to the owner
  // before it is made. A reminder — and on the last tier a statutory aanmaning naming
  // incassokosten — sent to a customer who already paid is not a wrong number on a screen; it is
  // the owner's relationship with the person who pays them. Never a verdict: the app says what it
  // saw and leaves the decision where it belongs.
  // The way past the block. Named as the action it is, not as a dismissal — the owner is not
  // waving a warning away, they are telling the app something it could not know.
  'vk.herinnerToch': { nl: 'Toch herinneren', ar: 'أرسل التذكير على أي حال', en: 'Remind anyway' },
  'bewijs.herinner.geblokkeerd': {
    nl: 'Nog niet verstuurd: in je bank staat {bewijs}. Koppel die betaling bij Bank, of verstuur de herinnering toch als het om iets anders gaat.',
    ar: 'لم تُرسل بعد: في حسابك البنكي {bewijs}. اربط هذه الدفعة في صفحة Bank، أو أرسل التذكير على أي حال إن كانت تخصّ شيئاً آخر.',
    en: 'Not sent yet: your bank shows {bewijs}. Link that payment under Bank, or send the reminder anyway if it is about something else.',
  },
  // [NO-SILENT-EMPTY] The check itself did not run. The reminder still goes out — the owner
  // pressed the button and the app has no ground to refuse — but it may not pretend it looked.
  'bewijs.herinner.nietGecontroleerd': {
    nl: 'Verstuurd. We konden deze factuur niet met je bank vergelijken, dus is niet gecontroleerd of er al betaald is.',
    ar: 'أُرسل. تعذّرت مقارنة هذه الفاتورة بحسابك البنكي، لذلك لم يُتحقق ممّا إذا كانت مدفوعة.',
    en: 'Sent. We could not compare this invoice with your bank, so whether it was already paid has not been checked.',
  },

  'bewijs.beperkt.beide': {
    nl: 'Niet alles is meegenomen: {facturen} facturen en {transacties} banktransacties vielen buiten deze controle.',
    ar: 'لم يُشمل كل شيء: {facturen} فاتورة و{transacties} حركة بنكية خارج نطاق هذا الفحص.',
    en: 'Not everything was included: {facturen} invoices and {transacties} bank transactions fell outside this check.',
  },

  // ─── [BTW-RESERVERING] The money in the account that is already the tax office's ────────────
  //
  // Every sentence here is about money the owner believes they have. They are deliberately short
  // and without an exclamation mark: the figures do the work, and an alarmed tone on a screen you
  // open every morning is one you learn to ignore inside a week.
  //
  // [TAAL] Where a sentence points at a screen or a button, it names the Dutch word that is
  // actually there — otherwise the reader goes looking for something that is nowhere in the app.

  'btwres.heading': { nl: 'Voor de Belastingdienst', ar: 'لمصلحة الضرائب', en: 'For the tax office' },
  'btwres.reserved': { nl: 'Al van de Belastingdienst', ar: 'مستحق لمصلحة الضرائب', en: 'Already the tax office’s' },
  'btwres.free': { nl: 'Blijft voor jou over', ar: 'يبقى لك', en: 'Left for you' },
  'btwres.short': { nl: 'Je komt tekort', ar: 'لديك عجز', en: 'You are short' },
  'btwres.refundExpected': {
    nl: 'Daarnaast verwacht je € {amount} terug. Dat staat er nog niet op.',
    ar: 'كما تتوقع استرداد € {amount}. لم يصل بعد.',
    en: 'You also expect € {amount} back. It is not in your account yet.',
  },
  'btwres.deadline': {
    nl: '{quarter} moet binnen zijn op {date}',
    ar: '{quarter} يجب تقديمه قبل {date}',
    en: '{quarter} is due on {date}',
  },
  'btwres.deadlineDays': {
    nl: '{quarter} — nog {days} dagen',
    ar: '{quarter} — بقي {days} يوماً',
    en: '{quarter} — {days} days left',
  },
  'btwres.deadlineToday': {
    nl: '{quarter} moet vandaag binnen zijn',
    ar: '{quarter} يجب تقديمه اليوم',
    en: '{quarter} is due today',
  },
  'btwres.deadlinePassed': {
    nl: '{quarter} — de datum is voorbij',
    ar: '{quarter} — انقضى الموعد',
    en: '{quarter} — the date has passed',
  },
  'btwres.toReturn': { nl: 'Naar de aangifte', ar: 'إلى الإقرار', en: 'Go to the VAT return' },

  // The caveats. One per note code in btw-reservation.ts — the Record type makes a missing one a
  // build error, and the gate catches a code quietly dropped while its sentence stays behind.
  'btwres.note.balanceUnknown': {
    nl: 'We kennen je banksaldo niet, dus we kunnen niet zeggen wat er overblijft. Wat je moet betalen weten we wel.',
    ar: 'لا نعرف رصيد حسابك، لذلك لا يمكننا قول ما سيتبقى. أما ما عليك دفعه فنعرفه.',
    en: 'We do not know your bank balance, so we cannot say what is left. What you owe, we do know.',
  },
  'btwres.note.balanceIncomplete': {
    nl: 'Van minstens één rekening kennen we het saldo niet, dus het bedrag hierboven is aan de lage kant.',
    ar: 'لا نعرف رصيد حساب واحد على الأقل، لذا فالمبلغ أعلاه أقل من الحقيقي.',
    en: 'We do not know the balance of at least one account, so the figure above is on the low side.',
  },
  'btwres.note.balanceStale': {
    nl: 'Je saldo komt van je laatste afschrift ({date}) — niet van vandaag.',
    ar: 'رصيدك مأخوذ من آخر كشف حساب ({date}) — وليس من اليوم.',
    en: 'Your balance comes from your latest statement ({date}), not from today.',
  },
  'btwres.note.quarterRunning': {
    nl: 'Dit kwartaal loopt nog. Het bedrag verandert met elke factuur die je stuurt of ontvangt.',
    ar: 'هذا الربع ما زال جارياً. يتغيّر المبلغ مع كل فاتورة ترسلها أو تستلمها.',
    en: 'This quarter is still running. The amount changes with every invoice you send or receive.',
  },
  'btwres.note.purchasesUnverified': {
    nl: 'Er staan nog inkoopfacturen in de wachtrij. Hun btw is nog niet afgetrokken, dus we houden te veel apart.',
    ar: 'ما زالت هناك فواتير شراء في قائمة الانتظار. لم تُخصم ضريبتها بعد، لذا نحجز أكثر من اللازم.',
    en: 'Purchase invoices are still in the queue. Their VAT is not deducted yet, so we set aside too much.',
  },
  'btwres.note.refundSeparate': {
    nl: 'Een teruggaaf tellen we niet mee als geld dat je kunt uitgeven — die is nog niet gestort.',
    ar: 'لا نحتسب الاسترداد كمال يمكنك إنفاقه — فهو لم يُحوَّل بعد.',
    en: 'We do not count a refund as money you can spend — it has not been paid out yet.',
  },
  'btwres.note.returnOverdue': {
    nl: 'Van een kwartaal is de datum voorbij zonder aangifte. Dat bedrag staat dus zeker nog open.',
    ar: 'انقضى موعد أحد الأرباع دون تقديم إقرار. لذا فذلك المبلغ ما زال مستحقاً بالتأكيد.',
    en: 'One quarter’s date has passed without a return. That amount is certainly still outstanding.',
  },
  'btwres.note.uncomputed': {
    nl: 'Van {quarters} konden we het bedrag niet uitrekenen. Dat zit dus niet in het totaal.',
    ar: 'لم نتمكن من حساب مبلغ {quarters}. لذا فهو غير مدرج في المجموع.',
    en: 'We could not calculate the amount for {quarters}. It is not in the total.',
  },
  'btwres.period': {
    nl: 'Gerekend vanaf {quarter}.',
    ar: 'محسوب اعتباراً من {quarter}.',
    en: 'Counted from {quarter}.',
  },

  // ─── [LOGBOEK] What happened in this administration, in words ───────────────────────────────
  //
  // 89 kinds of event were already being recorded — from 60 files, into audit_logs — and a
  // migration was written so the owner may read the ones about their OWN books even when their
  // bookkeeper performed them. Nothing ever rendered a single line of it.
  //
  // These sentences are what turns a row into something a person can check. Short, because a
  // logboek is scanned and not read; second person where the owner acted, neutral where the app
  // or someone else did. An action with no sentence here fails the [LOGBOEK] gate rather than
  // reaching the screen as 'invoice.status_changed'.
  'log.invoice.created': { nl: 'Factuur aangemaakt', en: 'Invoice created', ar: 'أُنشئت فاتورة' },
  'log.invoice.updated': { nl: 'Factuur gewijzigd', en: 'Invoice changed', ar: 'عُدّلت فاتورة' },
  'log.invoice.deleted': { nl: 'Factuur verwijderd', en: 'Invoice deleted', ar: 'حُذفت فاتورة' },
  'log.invoice.duplicated': { nl: 'Factuur gedupliceerd', en: 'Invoice duplicated', ar: 'نُسخت فاتورة' },
  'log.invoice.corrected': { nl: 'Verstuurde factuur gecorrigeerd — de klant kreeg het nieuwe document', en: 'Sent invoice corrected — the customer received the new document', ar: 'صُحّحت فاتورة مُرسَلة — واستلم الزبون المستند الجديد' },
  'log.invoice.dedup_override': { nl: 'Toch toegevoegd, ondanks een mogelijke dubbele', en: 'Added anyway, despite a possible duplicate', ar: 'أُضيفت رغم احتمال التكرار' },
  'log.invoice.status_changed': { nl: 'Status van een factuur gewijzigd', en: 'Invoice status changed', ar: 'تغيّرت حالة فاتورة' },
  'log.offerte.sent': { nl: 'Offerte naar de klant gemaild', en: 'Quote e-mailed to the customer', ar: 'أُرسل عرض سعر إلى الزبون' },
  'log.offerte.answered': { nl: 'De klant heeft op je offerte geantwoord', en: 'The customer answered your quote', ar: 'ردّ الزبون على عرض السعر' },
  'log.invoice.auto_verified': { nl: 'Inkoopfactuur automatisch bevestigd', en: 'Purchase invoice confirmed automatically', ar: 'تأكّدت فاتورة شراء تلقائياً' },
  'log.invoice.auto_paid': { nl: 'Kassabon automatisch afgeboekt — de bon vermeldde de betaalwijze', en: 'Receipt settled automatically — the paper stated the payment method', ar: 'سُوّي إيصال تلقائياً — الورقة ذكرت طريقة الدفع' },
  'log.invoice.reread_from_document': { nl: 'Bestand opnieuw gelezen', en: 'File read again', ar: 'أُعيدت قراءة ملف' },
  'log.invoice.reimported': { nl: 'Factuur opnieuw ingelezen', en: 'Invoice re-imported', ar: 'أُعيد استيراد فاتورة' },
  'log.bank.auto_confirmed': { nl: 'Bankregel automatisch aan een factuur gekoppeld', en: 'Bank line matched to an invoice automatically', ar: 'رُبط سطر بنكي بفاتورة تلقائياً' },
  'log.bank.auto_confirmed_batch': { nl: 'Eén bankbetaling automatisch over meerdere facturen verdeeld', en: 'One bank payment split across several invoices automatically', ar: 'وُزّعت دفعة بنكية على عدة فواتير تلقائياً' },
  'log.bank.confirmed': { nl: 'Bankregel aan een factuur gekoppeld', en: 'Bank line matched to an invoice', ar: 'رُبط سطر بنكي بفاتورة' },
  'log.bank.partial_payment': { nl: 'Deelbetaling geboekt', en: 'Partial payment booked', ar: 'قُيّدت دفعة جزئية' },
  'log.bank.payment_allocated': { nl: 'Eén betaling zelf over facturen verdeeld', en: 'One payment allocated across invoices by hand', ar: 'وُزّعت دفعة يدوياً على فواتير' },
  'log.bank.overpayment_residue': { nl: 'Er is meer betaald dan er openstond — het overschot is niet geboekt', en: 'More was paid than was owed — the excess was not booked', ar: 'دُفع أكثر من المستحق — ولم يُقيَّد الفائض' },
  'log.invoice.partial_payment': { nl: 'Deelbetaling met de hand geboekt', en: 'Partial payment recorded by hand', ar: 'قُيّدت دفعة جزئية يدوياً' },
  'log.bank.unlinked': { nl: 'Koppeling tussen bank en factuur ongedaan gemaakt', en: 'Bank-to-invoice match undone', ar: 'أُلغي ربط بين البنك وفاتورة' },
  'log.bank.match_checked': { nl: 'Automatische koppeling nagekeken en akkoord bevonden', en: 'Automatic match reviewed and accepted', ar: 'روجع ربط تلقائي وقُبل' },
  'log.invoice.document_attached': { nl: 'Origineel document aan een factuur gehangen', en: 'Original document attached to an invoice', ar: 'أُرفق مستند أصلي بفاتورة' },
  'log.invoice.document_replaced': { nl: 'Document van een factuur vervangen door een beter exemplaar (het oude blijft bewaard)', en: 'An invoice document was replaced by a better copy (the old one is kept)', ar: 'استُبدل مستند فاتورة بنسخة أفضل (تُحفظ القديمة)' },
  'log.accountant.invoice_question': { nl: 'Je boekhouder heeft een vraag gesteld over een factuur', en: 'Your bookkeeper asked a question about an invoice', ar: 'طرح محاسبك سؤالاً عن فاتورة' },
  'log.bank.ignored': { nl: 'Bankregel opzijgezet', en: 'Bank line set aside', ar: 'نُحّي سطر بنكي جانباً' },
  'log.bank.restored': { nl: 'Bankregel teruggehaald', en: 'Bank line taken back', ar: 'أُعيد سطر بنكي' },
  'log.bank.rematch_restored': { nl: 'Opnieuw proberen heeft opzijgezette bankregels teruggehaald', en: 'A re-match pass took set-aside bank lines back', ar: 'أعادت محاولة المطابقة سطوراً بنكية منحّاة' },
  'log.bank.overapplied': { nl: 'Er is meer aan deze bankregel gekoppeld dan hij groot is', en: 'More was matched to this bank line than it holds', ar: 'رُبط بهذا السطر البنكي أكثر من قيمته' },
  'log.creditnota.created': { nl: 'Creditnota aangemaakt', en: 'Credit note created', ar: 'أُنشئ إشعار دائن' },
  'log.invoice.archived': { nl: 'Factuur uit de boeken gehaald (bewaard, terug te halen)', en: 'Invoice removed from the books (kept, reversible)', ar: 'أُخرجت فاتورة من الدفاتر (محفوظة وقابلة للإرجاع)' },
  'log.invoice.restored': { nl: 'Factuur teruggezet in de boeken', en: 'Invoice put back in the books', ar: 'أُعيدت فاتورة إلى الدفاتر' },
  'log.invoice.payment_moved': { nl: 'Betaling verplaatst naar een andere factuur', en: 'Payment moved to another invoice', ar: 'نُقلت دفعة إلى فاتورة أخرى' },
  'log.invoice.duplicate_dismissed': { nl: 'Dubbelmelding weggeklikt', en: 'Duplicate warning dismissed', ar: 'أُغلق تنبيه تكرار' },
  'log.invoice.multi_invoice_dismissed': { nl: 'Melding over meerdere facturen in één bestand weggeklikt', en: 'Multi-invoice warning dismissed', ar: 'أُغلق تنبيه تعدّد الفواتير في ملف' },
  'log.invoice.superseded': { nl: 'Factuur vervangen door een nieuwe', en: 'Invoice replaced by a new one', ar: 'استُبدلت فاتورة بأخرى' },
  'log.invoice.numbering_configured': { nl: 'Factuurnummering ingesteld', en: 'Invoice numbering configured', ar: 'ضُبط ترقيم الفواتير' },
  'log.invoice.numbering_change_blocked': { nl: 'Wijziging van de nummering geweigerd — de reeks moet doorlopen', en: 'Numbering change refused — the series must stay unbroken', ar: 'رُفض تغيير الترقيم — يجب أن تبقى السلسلة متصلة' },
  'log.invoice.arithmetic_blocked': { nl: 'Factuur geweigerd omdat de bedragen niet klopten', en: 'Invoice refused because the amounts did not add up', ar: 'رُفضت فاتورة لأن المبالغ لم تتطابق' },
  'log.cash.entry_added': { nl: 'Kasregel toegevoegd', en: 'Cash entry added', ar: 'أُضيف قيد نقدي' },
  'log.cash.entry_removed': { nl: 'Kasregel verwijderd', en: 'Cash entry removed', ar: 'حُذف قيد نقدي' },
  'log.cash.opening_balance_set': { nl: 'Beginsaldo van de kas ingesteld', en: 'Cash opening balance set', ar: 'ضُبط الرصيد الافتتاحي للصندوق' },
  'log.turnover.auto_imported': { nl: 'Dagomzet ingelezen', en: 'Daily turnover imported', ar: 'استُورد إيراد يومي' },
  // [KASBOEK-LEZEN] "Gelezen", niet "ingelezen": er is niets geboekt, en het logboek mag dat niet
  // suggereren. Een regel die als import leest, wordt later gelezen als bewijs dat de bedragen in
  // de administratie staan — precies wat hier NIET is gebeurd.
  // [IB-JAAR] Het jaaroverzicht voor de inkomstenbelasting — schermchroom; de inhoudelijke
  // zinnen (uren, kanttekeningen, niet-bijgehouden) komen als data van de server, in het
  // Nederlands, zoals elke administratieve waarheid hier.
  'jaar.titel': { nl: 'Jaaroverzicht voor de IB-aangifte', en: 'Year overview for the income tax return', ar: 'ملخص السنة لإقرار ضريبة الدخل' },
  'jaar.intro': { nl: 'Je jaar, geordend zoals de aangifte inkomstenbelasting erom vraagt. Dit rekent geen belasting uit — het zet je cijfers klaar om over te nemen, en zegt eerlijk wat er nog mist.', en: 'Your year, arranged the way the income tax return asks for it. It computes no tax — it lays out your figures to copy over, and says honestly what is still missing.', ar: 'سنتك مرتبة كما يطلبها إقرار ضريبة الدخل. لا يحسب ضريبة — يجهّز أرقامك للنقل ويقول بصدق ما الناقص.' },
  'jaar.wv.titel': { nl: 'Winst-en-verliesrekening', en: 'Profit and loss', ar: 'حساب الأرباح والخسائر' },
  'jaar.wv.opbrengsten': { nl: 'Opbrengsten', en: 'Revenue', ar: 'الإيرادات' },
  'jaar.wv.kosten': { nl: 'Kosten', en: 'Costs', ar: 'التكاليف' },
  'jaar.wv.saldo': { nl: 'Saldo (winst)', en: 'Balance (profit)', ar: 'الرصيد (الربح)' },
  'jaar.uren.titel': { nl: 'Urencriterium', en: 'Hours criterion', ar: 'معيار الساعات' },
  'jaar.mist.titel': { nl: 'Wat hier niet in zit', en: 'What is not in here', ar: 'ما ليس مشمولاً هنا' },
  'jaar.mist.intro': { nl: 'Deze administratie houdt het volgende niet bij — neem het mee vóór je cijfers overneemt:', en: 'This administration does not track the following — account for it before copying figures:', ar: 'هذه الإدارة لا تتتبع التالي — خذه بالحسبان قبل نقل الأرقام:' },
  'jaar.kanttekeningen.titel': { nl: 'Kanttekeningen', en: 'Caveats', ar: 'ملاحظات' },
  'jaar.laden': { nl: 'Jaar doorrekenen…', en: 'Computing the year…', ar: 'جارٍ احتساب السنة…' },
  'jaar.fout': { nl: 'We konden het jaar nu niet doorrekenen. Probeer het zo opnieuw.', en: 'We could not compute the year right now. Try again shortly.', ar: 'تعذّر احتساب السنة الآن. حاول بعد قليل.' },
  'jaar.xaf.link': { nl: 'Download auditbestand (XAF) voor de boekhouder', en: 'Download audit file (XAF) for your accountant', ar: 'نزّل ملف التدقيق (XAF) للمحاسب' },

  'log.kasboek.imported_read_only': { nl: 'Kasboek gelezen (niets geboekt)', en: 'Cash book read (nothing booked)', ar: 'قُرئ دفتر النقد (لم يُقيَّد شيء)' },
  'log.kasboek.gap_booked': { nl: 'Ontbrekende kasuitgaven uit het kasboek geboekt', en: 'Missing cash payments booked from the cash book', ar: 'قُيّدت مصروفات نقدية ناقصة من دفتر النقد' },
  'log.turnover.day_removed': { nl: 'Dagomzet van een dag verwijderd', en: 'A day of turnover removed', ar: 'حُذف إيراد يوم' },
  'log.article.seeded_from_vak': { nl: 'Prijslijst gevuld vanuit een vak-sjabloon', en: 'Price list filled from a trade template', ar: 'مُلئت قائمة الأسعار من قالب مهنة' },
  'log.turnover.day_entered': { nl: 'Dagomzet zelf ingevuld', en: 'Daily turnover entered by hand', ar: 'أُدخل إيراد اليوم يدوياً' },
  'log.till.ticket_rung': { nl: 'Verkoop aangeslagen op de kassa', en: 'Sale rung up on the till', ar: 'سُجّلت عملية بيع على الكاسة' },
  'log.till.ticket_voided': { nl: 'Kassabon teruggedraaid', en: 'Till ticket voided', ar: 'أُلغيت فاتورة كاسة' },
  'log.ledger.auto_imported': { nl: 'Kasstaat ingelezen', en: 'Till ledger imported', ar: 'استُورد كشف صندوق' },
  'log.btw.filed': { nl: 'BTW-aangifte als ingediend gemarkeerd', en: 'VAT return marked as filed', ar: 'وُسم الإقرار الضريبي كمُقدَّم' },
  'log.btw.filed_despite_warnings': { nl: 'BTW-aangifte ingediend ondanks waarschuwingen', en: 'VAT return filed despite warnings', ar: 'قُدّم الإقرار رغم التحذيرات' },
  'log.btw.filing_unlocked': { nl: 'Een ingediend kwartaal weer opengezet', en: 'A filed quarter re-opened', ar: 'أُعيد فتح ربع مُقدَّم' },
  // [SUPPLETIE-VERREKEND] Added by another session in the same week as the logboek itself, which
  // is exactly the collision AGENTS.md describes: both branches merged cleanly and the COMBINATION
  // was broken — an action with no sentence reaches the logboek as a bare identifier.
  'log.btw.correction_carried': {
    nl: 'Een correctie in een latere aangifte verwerkt',
    en: 'A correction processed in a later VAT return',
    ar: 'عولج تصحيح ضمن إقرار لاحق',
  },
  'log.accountant.client_invited': { nl: 'Klant uitgenodigd', en: 'Client invited', ar: 'دُعي عميل' },
  'log.accountant.client_linked': { nl: 'Koppeling met een boekhouder tot stand gekomen', en: 'Link with a bookkeeper established', ar: 'تمّ ربط مع محاسب' },
  'log.accountant.client_unlinked': { nl: 'Koppeling met een boekhouder verbroken', en: 'Link with a bookkeeper ended', ar: 'أُنهي الربط مع محاسب' },
  'log.accountant.invoice_status_set': { nl: 'Je boekhouder heeft de status van een factuur gezet', en: 'Your bookkeeper set an invoice\'s status', ar: 'ضبط محاسبك حالة فاتورة' },
  'log.accountant.invoice_mandate_granted': { nl: 'Machtiging aan je boekhouder gegeven', en: 'Mandate granted to your bookkeeper', ar: 'مُنح تفويض لمحاسبك' },
  'log.accountant.invoice_mandate_revoked': { nl: 'Machtiging van je boekhouder ingetrokken', en: 'Mandate withdrawn from your bookkeeper', ar: 'سُحب تفويض محاسبك' },
  'log.accountant.documents_requested': { nl: 'Je boekhouder heeft stukken opgevraagd', en: 'Your bookkeeper requested documents', ar: 'طلب محاسبك مستندات' },
  'log.accountant.invoice_confirmed': { nl: 'Je boekhouder heeft een factuur bevestigd', en: 'Your bookkeeper confirmed an invoice', ar: 'أكّد محاسبك فاتورة' },
  'log.accountant.mandate_requested': { nl: 'Je boekhouder heeft om een machtiging gevraagd', en: 'Your bookkeeper asked for a mandate', ar: 'طلب محاسبك تفويضاً' },
  'log.invoice.reminder_sent': { nl: 'Herinnering naar je klant gestuurd', en: 'Reminder sent to your customer', ar: 'أُرسل تذكير إلى زبونك' },
  'log.member.invited': { nl: 'Medewerker uitgenodigd', en: 'Team member invited', ar: 'دُعي موظف' },
  'log.member.joined': { nl: 'Medewerker toegetreden', en: 'Team member joined', ar: 'انضمّ موظف' },
  'log.member.revoked': { nl: 'Toegang van een medewerker ingetrokken', en: 'Team member\'s access withdrawn', ar: 'سُحب وصول موظف' },
  'log.retention.warning_sent': { nl: 'Waarschuwing over de bewaartermijn verstuurd', en: 'Retention warning sent', ar: 'أُرسل تحذير بشأن مدة الحفظ' },
  'log.accountant.package_downloaded': { nl: 'Je boekhouder heeft het kwartaalpakket gedownload', en: 'Your bookkeeper downloaded the quarterly package', ar: 'نزّل محاسبك حزمة الربع' },
  'log.accountant.export_downloaded': { nl: 'Je boekhouder heeft een export gedownload', en: 'Your bookkeeper downloaded an export', ar: 'نزّل محاسبك تصديراً' },
  'log.supplier.auto_incasso_on': { nl: 'Leverancier gemarkeerd als automatische incasso', en: 'Supplier marked as direct debit', ar: 'وُسم مورّد بالاستقطاع التلقائي' },
  'log.supplier.auto_incasso_off': { nl: 'Automatische incasso bij een leverancier uitgezet', en: 'Direct debit switched off for a supplier', ar: 'أُوقف الاستقطاع التلقائي لمورّد' },
  'log.document.uploaded': { nl: 'Bestand geüpload', en: 'File uploaded', ar: 'رُفع ملف' },
  'log.document.duplicate_blocked': { nl: 'Dubbel bestand geweigerd', en: 'Duplicate file refused', ar: 'رُفض ملف مكرر' },
  'log.document.deleted': { nl: 'Bestand verwijderd', en: 'File deleted', ar: 'حُذف ملف' },
  'log.document.bulk_deleted': { nl: 'Meerdere bestanden verwijderd', en: 'Several files deleted', ar: 'حُذفت عدة ملفات' },
  'log.document.restored': { nl: 'Bestand teruggezet', en: 'File restored', ar: 'أُعيد ملف' },
  'log.article.bulk_deleted': { nl: 'Meerdere artikelen verwijderd', en: 'Several articles deleted', ar: 'حُذفت عدة أصناف' },
  'log.folder.created': { nl: 'Map aangemaakt', en: 'Folder created', ar: 'أُنشئ مجلد' },
  'log.folder.deleted': { nl: 'Map verwijderd', en: 'Folder deleted', ar: 'حُذف مجلد' },
  'log.folder.renamed': { nl: 'Map hernoemd', en: 'Folder renamed', ar: 'أُعيدت تسمية مجلد' },
  'log.user.password_changed': { nl: 'Wachtwoord gewijzigd', en: 'Password changed', ar: 'غُيّرت كلمة المرور' },
  'log.user.email_changed': { nl: 'E-mailadres gewijzigd', en: 'E-mail address changed', ar: 'غُيّر البريد الإلكتروني' },
  'log.user.account_deletion_requested': { nl: 'Verwijdering van het account aangevraagd', en: 'Account deletion requested', ar: 'طُلب حذف الحساب' },
  'log.user.data_purged': { nl: 'Gegevens definitief verwijderd', en: 'Data permanently deleted', ar: 'حُذفت البيانات نهائياً' },
  'log.email.connection_created': { nl: 'Mailbox gekoppeld', en: 'Mailbox connected', ar: 'رُبط بريد' },
  'log.email.connection_revoked': { nl: 'Mailbox ontkoppeld', en: 'Mailbox disconnected', ar: 'فُصل بريد' },
  'log.email.sender_rule_created': { nl: 'Regel voor een afzender aangemaakt', en: 'Sender rule created', ar: 'أُنشئت قاعدة لمُرسِل' },
  'log.email.sender_rule_deleted': { nl: 'Regel voor een afzender verwijderd', en: 'Sender rule deleted', ar: 'حُذفت قاعدة مُرسِل' },
  'log.snelstart.connected': { nl: 'SnelStart gekoppeld', en: 'SnelStart connected', ar: 'رُبط SnelStart' },
  'log.snelstart.disconnected': { nl: 'SnelStart ontkoppeld', en: 'SnelStart disconnected', ar: 'فُصل SnelStart' },
  'log.snelstart.pushed': { nl: 'Naar SnelStart doorgezet', en: 'Pushed to SnelStart', ar: 'أُرسل إلى SnelStart' },
  'log.snelstart.hold_acknowledged': { nl: 'Blokkade bij SnelStart afgehandeld', en: 'SnelStart hold acknowledged', ar: 'عولج توقّف في SnelStart' },
  'log.bank.connect_started': { nl: 'Bankkoppeling gestart', en: 'Bank connection started', ar: 'بدأ ربط البنك' },
  'log.bank.connected': { nl: 'Bank gekoppeld', en: 'Bank connected', ar: 'رُبط البنك' },
  'log.bank.disconnected': { nl: 'Bank ontkoppeld', en: 'Bank disconnected', ar: 'فُصل البنك' },

  // [LOGBOEK] The screen's own words. `log.onbekend` is the one that matters most: an action with
  // no sentence is still SHOWN, phrased neutrally and carrying its raw name — an audit trail that
  // hides what it cannot phrase is not an audit trail.
  'log.titel': { nl: 'Logboek', en: 'Activity log', ar: 'دفتر الأحداث' },
  'log.uitleg': {
    nl: 'Alles wat er in jouw administratie is gebeurd — ook wat je boekhouder deed.',
    en: 'Everything that happened in your administration — including what your bookkeeper did.',
    ar: 'كل ما جرى في إدارتك — بما في ذلك ما فعله محاسبك.',
  },
  'log.leeg': {
    nl: 'Er is nog niets gebeurd om te tonen.',
    en: 'Nothing has happened yet.',
    ar: 'لم يحدث شيء بعد.',
  },
  'log.mislukt': {
    nl: 'We konden je logboek niet lezen. Dit is geen “er is niets gebeurd”.',
    en: 'We could not read your log. This is not “nothing happened”.',
    ar: 'تعذّرت قراءة دفترك. هذا ليس «لم يحدث شيء».',
  },
  'log.onbekend': { nl: 'Handeling vastgelegd', en: 'Action recorded', ar: 'سُجّل إجراء' },
  'log.doorAnder': { nl: 'door iemand anders', en: 'by someone else', ar: 'بواسطة شخص آخر' },
  'log.meer': { nl: 'Meer laden', en: 'Load more', ar: 'تحميل المزيد' },
  'log.filter.alles': { nl: 'Alles', en: 'Everything', ar: 'الكل' },
  'log.filter.geld': { nl: 'Geld', en: 'Money', ar: 'المال' },
  'log.filter.document': { nl: 'Documenten', en: 'Documents', ar: 'المستندات' },
  'log.filter.toegang': { nl: 'Toegang', en: 'Access', ar: 'الوصول' },
  'log.spoorOnvolledig': {
    nl: 'Je boekhouder is gekoppeld, maar je ziet hier nog geen handelingen van hem. Er ontbreekt een instelling in de database.',
    en: 'Your bookkeeper is linked, but none of their actions appear here yet. A database setting is missing.',
    ar: 'محاسبك مرتبط، لكن لا تظهر أي من إجراءاته هنا بعد. ينقص إعداد في قاعدة البيانات.',
  },

  // ─── [2FA] Verificatie in twee stappen ──────────────────────────────────────────────────────
  //
  // The wording carries one thing the generic version of this feature does not: WHY it is heavier
  // here than on an ordinary account. A mandated bookkeeper and an invited medewerker both issue
  // invoices in the owner's unbroken number series, under the owner's BTW number — so a stolen
  // password is not access to a dashboard, it is the authority to make documents that cannot be
  // withdrawn. And the lockout sentence is not fine print: losing the phone means losing the way
  // into records the Belastingdienst can ask for, so it is said BEFORE the switch, not after.

  // ── [DOORLOPEND] Loopt de factuurnummering door? ───────────────────────────────────
  //
  // Artikel 35 Wet OB vraagt een doorlopende reeks. Een gat is meestal geen fraude en geen bug: het
  // nummer wordt vóór de factuur toegekend, dus een verzending die halverwege strandt verbrandt er
  // één. Dat mág — de Belastingdienst accepteert een gat dat je kunt UITLEGGEN. Wat niet mag is een
  // gat dat niemand heeft gezien. Vandaar de toon hieronder: benoemen, niet alarmeren.
  'doorlopend.klopt': {
    nl: 'Je factuurnummering loopt door, zonder gaten.',
    en: 'Your invoice numbering runs unbroken, with no gaps.',
    ar: 'ترقيم فواتيرك متصل، بلا فجوات.',
  },
  'doorlopend.halfGecontroleerd': {
    nl: 'Het einde van de reeks konden we nu niet nakijken.',
    en: 'We could not check the end of the series just now.',
    ar: 'لم نتمكن الآن من فحص نهاية السلسلة.',
  },
  'doorlopend.nietGelezen': {
    nl: 'We konden je nummering nu niet nakijken. Dat betekent niet dat er iets mis is.',
    en: 'We could not check your numbering just now. That does not mean anything is wrong.',
    ar: 'تعذّر علينا فحص ترقيمك الآن. هذا لا يعني أن هناك خطأ.',
  },
  'doorlopend.gatenTitel': {
    nl: 'Er ontbreken nummers in je reeks',
    en: 'Numbers are missing from your series',
    ar: 'تنقص أرقام من سلسلتك',
  },
  'doorlopend.reeks.factuur': { nl: 'Facturen', en: 'Invoices', ar: 'الفواتير' },
  'doorlopend.reeks.creditnota': { nl: 'Creditnota\'s', en: 'Credit notes', ar: 'الإشعارات الدائنة' },
  'doorlopend.ontbreekt': {
    nl: '— nummer {nummers} is nooit uitgereikt.',
    en: '— number {nummers} was never issued.',
    ar: '— الرقم {nummers} لم يُصدر قط.',
  },
  'doorlopend.eindeReeks': {
    nl: '— {aantal} aan het eind van de reeks: de teller staat hoger dan je hoogste factuur.',
    en: '— {aantal} at the end of the series: the counter stands higher than your highest invoice.',
    ar: '— {aantal} في نهاية السلسلة: العدّاد أعلى من أعلى فاتورة لديك.',
  },
  'doorlopend.dubbel': {
    nl: '— nummer {nummers} komt twee keer voor. Dit hoort niet te kunnen; laat het ons weten.',
    en: '— number {nummers} appears twice. This should not be possible; please tell us.',
    ar: '— الرقم {nummers} يتكرر مرتين. هذا لا يُفترض أن يحدث؛ أخبرنا به.',
  },
  'doorlopend.onleesbaar': {
    nl: 'Deze nummers passen niet in je huidige opmaak, dus die konden we niet meetellen: {nummers}. Meestal is dat overgenomen historie uit een vorig pakket.',
    en: 'These numbers do not fit your current format, so we could not include them: {nummers}. Usually that is history carried over from a previous package.',
    ar: 'هذه الأرقام لا تطابق تنسيقك الحالي فلم نستطع احتسابها: {nummers}. غالباً ما تكون سجلات منقولة من برنامج سابق.',
  },
  'doorlopend.watNu': {
    nl: 'Een verbrand nummer kun je niet opnieuw gebruiken, en dat hoeft ook niet: de Belastingdienst accepteert een gat dat je kunt uitleggen. Schrijf op wat er gebeurde en houd het bij je administratie — dan weet je het vóór je boekhouder ernaar vraagt.',
    en: 'A burned number cannot be reused, and it does not need to be: the tax office accepts a gap you can explain. Write down what happened and keep it with your records — then you know before your bookkeeper asks.',
    ar: 'الرقم المحروق لا يمكن إعادة استخدامه، ولا حاجة لذلك: مصلحة الضرائب تقبل فجوة يمكنك تفسيرها. دوِّن ما حدث واحفظه مع سجلاتك — عندها تعرفه قبل أن يسألك محاسبك.',
  },
  // ── [GELD-INVARIANT] Kloppen de boeken met zichzelf ────────────────────────────────
  //
  // Alleen de OMLIJSTING staat hier. De bevindingen zelf komen als zin uit money-invariants.ts,
  // omdat ze bedragen en factuurnummers bevatten die per geval verschillen — precies zoals het
  // klaar-scherm de zinnen van readiness.ts rendert. Wat hier staat is wat het scherm zegt als er
  // NIETS te melden valt, en dat is de helft die er het meest toe doet: een controle die alleen
  // spreekt als ze iets vindt, bewijst nooit dat ze gedraaid heeft.
  // Geen titelsleutel: het paneel zwijgt op één regel als alles klopt, precies als het
  // nummeringspaneel ernaast. Een kop boven een regel die zegt dat er niets aan de hand is, maakt
  // van die regel een blok — en een blok ter grootte van een waarschuwing is hoe mensen leren over
  // die plek heen te lezen. De kop bestaat alleen in het waarschuwingsvak, hieronder.
  'geld.klopt': {
    nl: 'Elke factuur klopt met de betalingen die eraan hangen. Geen enkel verschil gevonden.',
    en: 'Every invoice agrees with the payments attached to it. No difference found.',
    ar: 'كل فاتورة تتطابق مع المدفوعات المرتبطة بها. لم يُعثر على أي فرق.',
  },
  'geld.ladeNietGecontroleerd': {
    nl: 'De kaslade konden we nu niet nakijken.',
    en: 'We could not check the cash drawer just now.',
    ar: 'لم نتمكن الآن من فحص درج النقد.',
  },
  'geld.nietGelezen': {
    nl: 'We konden je boeken nu niet nakijken. Dat betekent niet dat er iets mis is.',
    en: 'We could not check your books just now. That does not mean anything is wrong.',
    ar: 'تعذّر علينا فحص دفاترك الآن. هذا لا يعني أن هناك خطأ.',
  },
  'geld.verschillenTitel': {
    nl: 'Twee bronnen zijn het oneens',
    en: 'Two sources disagree',
    ar: 'مصدران غير متفقين',
  },
  'geld.watNu': {
    nl: 'We herstellen dit niet automatisch: bij een verschil moet er één bron gekozen worden, en fout kiezen schrijft een onwaar bedrag over een waar bedrag heen. Kijk het na, of leg het voor aan je boekhouder.',
    en: 'We do not repair this automatically: a difference means one source has to be chosen, and choosing wrong writes a false amount over a true one. Check it, or put it to your bookkeeper.',
    ar: 'لا نصلح هذا تلقائياً: الفرق يعني وجوب اختيار مصدر واحد، والاختيار الخاطئ يكتب مبلغاً غير صحيح فوق مبلغ صحيح. راجعه، أو اعرضه على محاسبك.',
  },
  // ── [BEVEILIGING] Wie kan bij deze administratie ───────────────────────────────────
  //
  // Dit scherm beantwoordt de enige vraag die een zzp'er niet zelf kan controleren als hij zijn
  // boeken aan een app geeft: leest er iemand anders mee. Elke zin hieronder is dus een uitspraak
  // over ZIJN gegevens en niet over ons — en waar we het niet zeker weten, staat dat er.
  'bev.titel': { nl: 'Beveiliging & toegang', en: 'Security & access', ar: 'الأمان والوصول' },
  'bev.uitleg': {
    nl: 'Wat er op dit moment waar is over deze administratie: wie erbij kan, hoe hij op slot zit, en wat er van elke handeling is vastgelegd.',
    en: 'What is true about this administration right now: who can open it, how it is locked, and what has been recorded of every action.',
    ar: 'ما هو صحيح الآن عن هذه الإدارة: من يستطيع فتحها، وكيف هي مُقفلة، وما الذي سُجِّل من كل إجراء.',
  },
  'bev.wie.titel': { nl: 'Wie kan bij deze administratie', en: 'Who can open this administration', ar: 'من يستطيع الوصول إلى هذه الإدارة' },
  'bev.wie.alleenJij': {
    nl: 'Alleen jij. Er is verder niemand aan deze administratie gekoppeld.',
    en: 'Only you. Nobody else is linked to this administration.',
    ar: 'أنت فقط. لا أحد آخر مرتبط بهذه الإدارة.',
  },
  'bev.wie.aantal': {
    nl: '{aantal} mensen kunnen bij deze administratie.',
    en: '{aantal} people can open this administration.',
    ar: '{aantal} أشخاص يمكنهم الوصول إلى هذه الإدارة.',
  },
  // De hele reden dat dit scherm bestaat, staat in deze zin: liever "we weten het niet zeker" dan
  // een geruststelling die we niet kunnen waarmaken.
  'bev.wie.onvolledig': {
    nl: 'We konden niet alles uitlezen, dus deze lijst is misschien niet compleet. Wat er staat klopt; wat er niet staat weten we nu niet zeker.',
    en: 'We could not read everything, so this list may be incomplete. What is here is correct; what is missing we cannot be sure about right now.',
    ar: 'تعذّر علينا قراءة كل شيء، لذا قد تكون هذه القائمة ناقصة. ما هو مذكور صحيح؛ وما هو غائب لا نستطيع تأكيده الآن.',
  },
  'bev.rol.eigenaar': { nl: 'Jij — eigenaar', en: 'You — owner', ar: 'أنت — المالك' },
  'bev.rol.boekhouder': { nl: 'Boekhouder', en: 'Bookkeeper', ar: 'المحاسب' },
  'bev.rol.medewerker': { nl: 'Medewerker', en: 'Employee', ar: 'موظف' },
  'bev.naamOnbekend': { nl: 'Naam niet gelezen', en: 'Name not read', ar: 'تعذّرت قراءة الاسم' },
  'bev.sinds': { nl: 'Sinds {datum}', en: 'Since {datum}', ar: 'منذ {datum}' },
  'bev.beheren': { nl: 'Toegang beheren', en: 'Manage access', ar: 'إدارة الوصول' },
  'bev.hint.titel': {
    nl: 'Je administratie hangt aan één wachtwoord',
    en: 'Your administration hangs on one password',
    ar: 'إدارتك معلَّقة على كلمة مرور واحدة',
  },
  'bev.apparaten.titel': { nl: 'Andere apparaten', en: 'Other devices', ar: 'الأجهزة الأخرى' },
  // De eerlijke helft staat in de zin zelf: wat we NIET kunnen tonen, staat er vóór wat we wel kunnen.
  'bev.apparaten.uitleg': {
    nl: 'We kunnen je niet laten zien op welke apparaten je bent ingelogd — die lijst geeft de inlogdienst niet vrij, en een lijst die we zelf zouden verzinnen klopt juist niet in het geval waarvoor je hem nodig hebt. Wat we wél kunnen: alle andere sessies in één keer uitloggen. Vermoed je dat iemand je wachtwoord heeft, doe dan dit én zet verificatie in twee stappen aan.',
    en: 'We cannot show you which devices you are signed in on — the auth service does not hand that list out, and a list we made up ourselves would be wrong in exactly the case you need it for. What we can do: sign every other session out at once. If you suspect someone has your password, do this and switch on two-step verification.',
    ar: 'لا نستطيع أن نُريك على أي الأجهزة أنت مسجَّل الدخول — خدمة الدخول لا تُتيح تلك القائمة، وقائمة نختلقها نحن ستكون خاطئة تحديداً في الحالة التي تحتاجها من أجلها. ما نستطيعه: إنهاء كل الجلسات الأخرى دفعة واحدة. إن كنت تشك أن أحداً يملك كلمة مرورك، فافعل هذا وفعِّل التحقق بخطوتين.',
  },
  'bev.apparaten.knop': { nl: 'Log alle andere apparaten uit', en: 'Sign out every other device', ar: 'إنهاء الجلسات على كل الأجهزة الأخرى' },
  'bev.apparaten.gelukt': {
    nl: 'Alle andere sessies zijn uitgelogd. Dit apparaat blijft ingelogd.',
    en: 'Every other session has been signed out. This device stays signed in.',
    ar: 'أُنهيت كل الجلسات الأخرى. هذا الجهاز يبقى مسجَّلاً.',
  },
  'bev.apparaten.mislukt': {
    nl: 'Het is niet gelukt, en we weten niet of er iets is uitgelogd. Probeer het zo meteen opnieuw.',
    en: 'It did not work, and we do not know whether anything was signed out. Try again in a moment.',
    ar: 'لم تنجح العملية، ولا نعرف إن أُنهيت أي جلسة. أعد المحاولة بعد قليل.',
  },
  'bev.log.titel': { nl: 'Wat er is vastgelegd', en: 'What has been recorded', ar: 'ما الذي سُجِّل' },
  'bev.log.uitleg': {
    nl: 'Elke handeling in deze administratie wordt vastgelegd — ook die van je boekhouder, en ook die van ons. Je kunt het zelf teruglezen.',
    en: 'Every action in this administration is recorded — your bookkeeper\'s too, and ours. You can read it back yourself.',
    ar: 'كل إجراء في هذه الإدارة يُسجَّل — بما في ذلك إجراءات محاسبك وإجراءاتنا. ويمكنك مراجعته بنفسك.',
  },
  'bev.log.aantal': {
    nl: '{aantal} handelingen vastgelegd',
    en: '{aantal} actions recorded',
    ar: '{aantal} إجراءً مُسجَّلاً',
  },
  'bev.log.onbekend': {
    nl: 'We konden het aantal nu niet lezen. Het logboek zelf staat er wel.',
    en: 'We could not read the number just now. The logbook itself is still there.',
    ar: 'تعذّرت قراءة العدد الآن. أما السجل نفسه فموجود.',
  },
  'bev.log.bekijken': { nl: 'Logboek openen', en: 'Open the logbook', ar: 'فتح السجل' },
  'mfa.titel': { nl: 'Verificatie in twee stappen', en: 'Two-step verification', ar: 'التحقق بخطوتين' },
  'mfa.staatAan': { nl: 'Staat aan', en: 'Switched on', ar: 'مُفعَّل' },
  'mfa.staatUit': { nl: 'Staat uit', en: 'Switched off', ar: 'غير مُفعَّل' },
  'mfa.waarom': {
    nl: 'Wie jouw wachtwoord heeft, kan facturen uitreiken op jouw naam en in jouw doorlopende nummerreeks. Die kun je daarna niet meer intrekken. Een tweede stap sluit dat af.',
    en: 'Anyone with your password can issue invoices in your name and in your unbroken number series. Those cannot be withdrawn afterwards. A second step closes that off.',
    ar: 'من يملك كلمة مرورك يستطيع إصدار فواتير باسمك وفي سلسلة أرقامك المتصلة. ولا يمكن سحبها بعد ذلك. الخطوة الثانية تُغلق هذا الباب.',
  },
  'mfa.aanzetten': { nl: 'Aanzetten', en: 'Switch on', ar: 'تفعيل' },
  'mfa.uitzetten': { nl: 'Uitzetten', en: 'Switch off', ar: 'إيقاف' },
  'mfa.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'mfa.scan.uitleg': {
    nl: 'Scan deze code met je authenticator-app (bijvoorbeeld Google Authenticator, 1Password of Bitwarden).',
    en: 'Scan this code with your authenticator app (Google Authenticator, 1Password or Bitwarden, for example).',
    ar: 'امسح هذا الرمز بتطبيق المصادقة لديك (مثل Google Authenticator أو 1Password أو Bitwarden).',
  },
  'mfa.scan.handmatig': {
    nl: 'Kun je niet scannen? Typ deze sleutel over in je app:',
    en: 'Cannot scan? Type this key into your app instead:',
    ar: 'لا يمكنك المسح؟ اكتب هذا المفتاح في تطبيقك:',
  },
  'mfa.code.label': { nl: 'Code uit je app', en: 'Code from your app', ar: 'الرمز من تطبيقك' },
  'mfa.bevestig': { nl: 'Bevestigen', en: 'Confirm', ar: 'تأكيد' },
  'mfa.verifieer': { nl: 'Verifiëren', en: 'Verify', ar: 'تحقّق' },
  'mfa.verificatie.uitleg': {
    nl: 'Vul de zescijferige code in die je authenticator-app nu toont.',
    en: 'Enter the six-digit code your authenticator app is showing now.',
    ar: 'أدخل الرمز المكوّن من ستة أرقام الذي يعرضه تطبيقك الآن.',
  },
  'mfa.fout.ongeldig': {
    nl: 'Die code klopt niet. Codes verlopen na een halve minuut — probeer de nieuwste uit je app.',
    en: 'That code is not right. Codes expire after half a minute — try the newest one in your app.',
    ar: 'هذا الرمز غير صحيح. الرموز تنتهي خلال نصف دقيقة — جرّب أحدث رمز في تطبيقك.',
  },
  'mfa.fout.mislukt': {
    nl: 'We konden je code nu niet controleren. Dit betekent niet dat de code fout is — probeer het zo meteen opnieuw.',
    en: 'We could not check your code just now. That does not mean the code is wrong — try again in a moment.',
    ar: 'تعذّر التحقق من رمزك الآن. هذا لا يعني أن الرمز خاطئ — أعد المحاولة بعد قليل.',
  },
  'mfa.fout.aanzetten': {
    nl: 'Het aanzetten is niet gelukt. Er is niets veranderd: je logt in zoals altijd.',
    en: 'Switching it on did not work. Nothing changed: you sign in as before.',
    ar: 'لم ينجح التفعيل. لم يتغيّر شيء: تسجّل الدخول كالمعتاد.',
  },
  'mfa.gelukt': {
    nl: 'Verificatie in twee stappen staat nu aan. Vanaf je volgende aanmelding vragen we ook om een code.',
    en: 'Two-step verification is on. From your next sign-in we will also ask for a code.',
    ar: 'التحقق بخطوتين مُفعَّل الآن. سنطلب رمزاً أيضاً عند تسجيل دخولك التالي.',
  },
  'mfa.uit.gelukt': {
    nl: 'Verificatie in twee stappen staat uit. Je logt weer in met alleen je wachtwoord.',
    en: 'Two-step verification is off. You sign in with your password alone again.',
    ar: 'التحقق بخطوتين مُوقَف. ستسجّل الدخول بكلمة المرور وحدها.',
  },
  'mfa.waarschuwing.telefoon': {
    nl: 'Raak je je telefoon kwijt, dan raak je ook de toegang tot je administratie kwijt. Bewaar de sleutel hierboven ergens veilig, of voeg straks een tweede apparaat toe.',
    en: 'If you lose your phone, you lose access to your administration too. Keep the key above somewhere safe, or add a second device afterwards.',
    ar: 'إن فقدت هاتفك فقدت الوصول إلى إدارتك أيضاً. احفظ المفتاح أعلاه في مكان آمن، أو أضف جهازاً ثانياً لاحقاً.',
  },
  'mfa.waarschuwing.sessies': {
    nl: 'Andere apparaten waarop je nu bent ingelogd, worden uitgelogd.',
    en: 'Other devices you are signed in on will be signed out.',
    ar: 'ستُسجَّل الأجهزة الأخرى المسجَّلة حالياً خارج الحساب.',
  },
  'mfa.kwijt.titel': { nl: 'Je telefoon kwijt?', en: 'Lost your phone?', ar: 'فقدت هاتفك؟' },
  'mfa.kwijt.uitleg': {
    nl: 'Heb je een tweede apparaat toegevoegd, gebruik dan de code daarvan. Zo niet, mail dan naar support@boekbrug.nl vanaf het e-mailadres van je account — we zetten de tweede stap dan uit na controle.',
    en: 'If you added a second device, use the code from that one. If not, e-mail support@boekbrug.nl from your account address and we will switch the second step off after checking.',
    ar: 'إن أضفت جهازاً ثانياً فاستخدم رمزه. وإن لم تفعل، راسل support@boekbrug.nl من بريد حسابك وسنُوقف الخطوة الثانية بعد التحقق.',
  },
  'mfa.herstel.titel': { nl: 'Eerst de tweede stap', en: 'The second step first', ar: 'الخطوة الثانية أولاً' },
  'mfa.herstel.uitleg': {
    nl: 'Op dit account staat verificatie in twee stappen aan. Zonder deze controle zou iemand die bij je e-mail kan via een herstellink een nieuw wachtwoord kiezen en zo binnenkomen. Voer eerst de code uit je app in; daarna kun je hier je wachtwoord wijzigen.',
    en: 'This account has two-step verification switched on. Without this check, anyone who reaches your e-mail could pick a new password through a reset link and walk in. Enter the code from your app first; after that you can change your password here.',
    ar: 'هذا الحساب مُفعَّل عليه التحقق بخطوتين. بدون هذا الفحص يستطيع من يصل إلى بريدك أن يختار كلمة مرور جديدة عبر رابط الاستعادة ويدخل. أدخل الرمز من تطبيقك أولاً، ثم يمكنك تغيير كلمة المرور هنا.',
  },
  'mfa.uitloggen': { nl: 'Uitloggen', en: 'Sign out', ar: 'تسجيل الخروج' },
  'mfa.nietsTeVerifieren': {
    nl: 'Op dit account staat geen verificatie in twee stappen aan, dus er is hier niets te bevestigen.',
    en: 'This account has no two-step verification switched on, so there is nothing to confirm here.',
    ar: 'لا يوجد تحقق بخطوتين مُفعَّل على هذا الحساب، فليس هنا ما يُؤكَّد.',
  },
  'mfa.verder': { nl: 'Verder', en: 'Continue', ar: 'متابعة' },
  'mfa.fout.lezen': {
    nl: 'We konden dit nu niet lezen. Probeer het zo meteen opnieuw.',
    en: 'We could not read this just now. Try again in a moment.',
    ar: 'تعذّرت قراءة هذا الآن. أعد المحاولة بعد قليل.',
  },
  'mfa.apparaten': { nl: 'Apparaten', en: 'Devices', ar: 'الأجهزة' },
  'mfa.apparaatToevoegen': { nl: 'Tweede apparaat toevoegen', en: 'Add a second device', ar: 'إضافة جهاز ثانٍ' },
  'mfa.apparaatVerwijderen': { nl: 'Verwijderen', en: 'Remove', ar: 'إزالة' },
  'mfa.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ…' },

  // ─── [PRIJS-MODUS] Typ je de catalogusprijs inclusief of exclusief btw? ─────────────────────
  //
  // De factuurschermen boden deze keuze al; de catalogus niet. Wie all-in werkt — horeca, retail,
  // een vast tarief "€ 50 all-in" — moest de btw er dus zelf uit rekenen vóór hij een artikel
  // opsloeg, en die deling met de hand is precies waar de centen weglekken.
  //
  // De knop zegt WELKE prijs er in het veld staat, niet wat de app ermee doet. Opgeslagen wordt
  // altijd de prijs excl. btw — zie de kop van price-mode.ts.

  'art.prijsIncl': { nl: 'Prijs (incl. BTW)', en: 'Price (incl. BTW)', ar: 'السعر (شامل الضريبة)' },
  'art.modus.excl': { nl: 'Excl. btw', en: 'Excl. btw', ar: 'دون الضريبة' },
  'art.modus.incl': { nl: 'Incl. btw', en: 'Incl. btw', ar: 'شامل الضريبة' },
  'art.modus.aria': {
    nl: 'Staat er in het prijsveld een bedrag inclusief of exclusief btw?',
    en: 'Is the price field an amount including or excluding btw?',
    ar: 'هل المبلغ في حقل السعر شامل الضريبة أم دونها؟',
  },
  // De tegenprijs, onder het veld. Wie all-in typt wil de ex-prijs zien die op de factuur belandt,
  // en andersom — dat is het getal waar hij zijn marge tegen afzet.
  'art.tegenprijs.excl': {
    nl: 'Excl. btw: {bedrag}',
    en: 'Excl. btw: {bedrag}',
    ar: 'دون الضريبة: {bedrag}',
  },
  'art.tegenprijs.incl': {
    nl: 'Incl. btw: {bedrag}',
    en: 'Incl. btw: {bedrag}',
    ar: 'شامل الضريبة: {bedrag}',
  },

  // ─── [KASSA] The counter of a shop without a till ────────────────────────────────────────────
  //
  // Two rules from the head of this file do real work in this block, so they are worth pointing at
  // before anyone adds a key here.
  //
  // A NOUN INSIDE A SENTENCE IS NOT A PARAMETER. "Pin", "Contant" and "Overig" are payment methods
  // that appear both as button labels AND inside sentences ("… is contant betaald"). Every such
  // sentence gets its own key per method rather than one template with {method} substituted, which
  // would break Arabic agreement and Turkish suffix harmony on a screen an owner uses all day.
  //
  // A SENTENCE THAT POINTS AT A BUTTON NAMES THE BUTTON AS IT IS WRITTEN. The conflict notices are
  // written server-side in Dutch (till-day.ts) because they name concrete screens — Kas, Dagomzet —
  // whose navigation labels are still Dutch in every language. Translating the sentence without
  // the label would send the owner hunting for a word that is nowhere in his interface.

  'kassa.titel': { nl: 'Kassa', en: 'Till', ar: 'الكاسة' },
  // The home card. Its sub-line says what the screen DOES, not what it is — a shop owner scanning
  // his home screen is deciding where to tap, not reading a glossary.
  'start.kassa': { nl: 'Kassa', en: 'Till', ar: 'الكاسة' },
  'start.kassa.sub': {
    nl: 'Sla je verkopen aan — met het juiste btw-tarief',
    en: 'Ring up your sales — at the right btw rate',
    ar: 'سجّل مبيعاتك — بنسبة الـ btw الصحيحة',
  },
  'kassa.uitleg': {
    nl: 'Sla hier aan wat je verkoopt. Aan het eind van de dag staat je omzet met het juiste btw-tarief in je boekhouding — zonder kassabon en zonder overtypen.',
    en: 'Ring up what you sell here. At the end of the day your revenue is in your books at the right btw rate — no till receipt, no retyping.',
    ar: 'سجّل هنا ما تبيعه. في آخر اليوم تكون إيراداتك في دفاترك بنسبة الـ btw الصحيحة — بلا إيصال كاسة وبلا إعادة إدخال.',
  },
  'kassa.dagtotaal': { nl: 'Vandaag aangeslagen', en: 'Rung up today', ar: 'المسجَّل اليوم' },
  'kassa.prijslijst': { nl: 'Prijslijst', en: 'Price list', ar: 'قائمة الأسعار' },
  'kassa.prijslijstLeeg': {
    nl: 'Je prijslijst is nog leeg. Zet je diensten er één keer in, dan sla je ze daarna met één tik aan.',
    en: 'Your price list is still empty. Add your services once, then ring them up with a single tap.',
    ar: 'قائمة أسعارك ما زالت فارغة. أدخل خدماتك مرة واحدة، ثم سجّلها بنقرة واحدة.',
  },
  'kassa.prijslijstBeheren': { nl: 'Prijslijst beheren', en: 'Manage price list', ar: 'إدارة قائمة الأسعار' },
  'kassa.bon': { nl: 'Bon', en: 'Ticket', ar: 'الفاتورة' },
  'kassa.bonLeeg': {
    nl: 'Tik hierboven een dienst aan, of vul een vrij bedrag in.',
    en: 'Tap a service above, or enter a free amount.',
    ar: 'انقر خدمة في الأعلى، أو أدخل مبلغاً حراً.',
  },
  'kassa.vrijBedrag': { nl: 'Vrij bedrag', en: 'Free amount', ar: 'مبلغ حر' },
  'kassa.omschrijving': { nl: 'Omschrijving', en: 'Description', ar: 'الوصف' },
  'kassa.bedrag': { nl: 'Bedrag', en: 'Amount', ar: 'المبلغ' },
  'kassa.tarief': { nl: 'Btw-tarief', en: 'Btw rate', ar: 'نسبة الـ btw' },
  'kassa.toevoegen': { nl: 'Op de bon', en: 'Add to ticket', ar: 'أضف إلى الفاتورة' },
  'kassa.regelWeg': { nl: 'Regel weghalen', en: 'Remove line', ar: 'إزالة السطر' },
  'kassa.meer': { nl: 'Eentje erbij', en: 'One more', ar: 'واحد إضافي' },
  'kassa.minder': { nl: 'Eentje eraf', en: 'One fewer', ar: 'واحد أقل' },
  'kassa.totaal': { nl: 'Totaal', en: 'Total', ar: 'الإجمالي' },
  'kassa.hoeBetaald': { nl: 'Hoe is er betaald?', en: 'How was it paid?', ar: 'كيف تم الدفع؟' },
  'kassa.pin': { nl: 'Pin', en: 'Card', ar: 'بطاقة (Pin)' },
  'kassa.contant': { nl: 'Contant', en: 'Cash', ar: 'نقداً' },
  'kassa.overig': { nl: 'Overig', en: 'Other', ar: 'أخرى' },
  'kassa.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ…' },
  'kassa.verkopenVandaag': { nl: 'Aangeslagen vandaag', en: 'Rung up today', ar: 'المسجَّل اليوم' },
  'kassa.geenVerkopen': {
    nl: 'Nog niets aangeslagen vandaag.',
    en: 'Nothing rung up today yet.',
    ar: 'لم يُسجَّل شيء اليوم بعد.',
  },
  'kassa.terugdraaien': { nl: 'Terugdraaien', en: 'Void', ar: 'إلغاء' },
  'kassa.terugdraaienVraag': {
    nl: 'Deze bon helemaal terugdraaien?',
    en: 'Void this whole ticket?',
    ar: 'إلغاء هذه الفاتورة بالكامل؟',
  },
  // One sentence per payment method — a noun inside a sentence is not a parameter.
  'kassa.betaaldPin': { nl: 'Met pin betaald', en: 'Paid by card', ar: 'مدفوعة بالبطاقة' },
  'kassa.betaaldContant': { nl: 'Contant betaald', en: 'Paid in cash', ar: 'مدفوعة نقداً' },
  'kassa.betaaldOverig': { nl: 'Anders betaald', en: 'Paid another way', ar: 'مدفوعة بطريقة أخرى' },
  'kassa.splitPin': { nl: 'Pin', en: 'Card', ar: 'بطاقة' },
  'kassa.splitContant': { nl: 'Contant', en: 'Cash', ar: 'نقداً' },
  'kassa.splitOverig': { nl: 'Overig', en: 'Other', ar: 'أخرى' },
  'kassa.waaromTarief': {
    nl: 'Het btw-tarief hoort bij de dienst, niet bij de betaling. Daarom staat het op de prijslijst en hoef je het hier niet elke keer te kiezen.',
    en: 'The btw rate belongs to the service, not to the payment. That is why it lives on the price list and you do not choose it every time here.',
    ar: 'نسبة الـ btw تتبع الخدمة لا طريقة الدفع. لذلك تُحفظ في قائمة الأسعار ولا تختارها هنا في كل مرة.',
  },
  'kassa.fout.laden': {
    nl: 'Kon de verkopen van vandaag niet laden.',
    en: 'Could not load today’s sales.',
    ar: 'تعذّر تحميل مبيعات اليوم.',
  },
  'kassa.fout.opslaan': {
    nl: 'Kon de verkoop niet opslaan.',
    en: 'Could not save the sale.',
    ar: 'تعذّر حفظ عملية البيع.',
  },

  // ─── [VAK-BRUG] Filling an empty price list from the owner's trade ───────────────────────────
  // The counter tab. Short because a nav label has ~9 characters before it wraps on a 320px screen.
  // [VAK-BRUG] The trade question, on the company step of the wizard.
  'onb.vak': { nl: 'Wat voor werk doe je?', en: 'What kind of work do you do?', ar: 'ما نوع عملك؟', tr: 'Ne iş yapıyorsun?' },
  'onb.vak.leeg': { nl: 'Kies je vak (mag je overslaan)', en: 'Pick your trade (you may skip this)', ar: 'اختر مهنتك (يمكنك التخطّي)', tr: 'Mesleğini seç (atlayabilirsin)' },
  'onb.vak.uitleg': {
    nl: 'Hiermee zet de app je prijslijst alvast klaar, met het btw-tarief dat bij jouw werk hoort. Je kunt alles later aanpassen.',
    en: 'This lets the app prepare your price list, with the btw rate that belongs to your work. You can change everything later.',
    ar: 'بهذا يجهّز التطبيق قائمة أسعارك، بنسبة الـ btw التي تخصّ عملك. ويمكنك تعديل كل شيء لاحقاً.',
  },

  // ─── [VOERTUIG] The cars a garage works on ───────────────────────────────────────────────────
  // [TAAL] 'APK' and 'kenteken' are Dutch domain terms with no English equivalent in this context —
  // AGENTS.md names both explicitly. They stay as they are in every language, exactly like btw.
  'vtg.titel': { nl: 'Voertuigen', en: 'Vehicles', ar: 'المركبات', tr: 'Araçlar' },
  'vtg.uitleg': {
    nl: 'Leg vast welke auto’s je onder handen hebt. De APK-datum zet ze vanzelf bovenaan zodra die in zicht komt — dat is je reden om de klant te bellen.',
    en: 'Record which cars you work on. The APK date moves them to the top by itself as it comes into view — that is your reason to call the customer.',
    ar: 'سجّل السيارات التي تعمل عليها. تاريخ الـ APK يرفعها إلى الأعلى تلقائياً عند اقترابه — وهو سببك للاتصال بالزبون.',
  },
  'vtg.kenteken': { nl: 'Kenteken', en: 'Kenteken', ar: 'رقم اللوحة (kenteken)', tr: 'Plaka (kenteken)' },
  'vtg.auto': { nl: 'Merk en model', en: 'Make and model', ar: 'الماركة والموديل' },
  'vtg.klant': { nl: 'Klant', en: 'Customer', ar: 'الزبون' },
  'vtg.telefoon': { nl: 'Telefoon', en: 'Phone', ar: 'الهاتف' },
  'vtg.apk': { nl: 'APK verloopt op', en: 'APK expires on', ar: 'ينتهي الـ APK في' },
  'vtg.notitie': { nl: 'Notitie', en: 'Note', ar: 'ملاحظة' },
  'vtg.opslaan': { nl: 'Voertuig vastleggen', en: 'Record the vehicle', ar: 'تثبيت المركبة' },
  'vtg.toevoegen': { nl: 'Voertuig toevoegen', en: 'Add a vehicle', ar: 'إضافة مركبة' },
  'vtg.leeg': {
    nl: 'Nog geen voertuigen. Voeg de eerste auto toe die je onder handen hebt.',
    en: 'No vehicles yet. Add the first car you are working on.',
    ar: 'لا مركبات بعد. أضف أول سيارة تعمل عليها.',
  },
  'vtg.verwijderen': { nl: 'Verwijderen', en: 'Remove', ar: 'إزالة' },
  'vtg.verwijderenVraag': { nl: 'Dit voertuig verwijderen?', en: 'Remove this vehicle?', ar: 'إزالة هذه المركبة؟' },
  // One whole sentence per state — never one template with the state substituted in.
  'vtg.status.expired': { nl: 'APK is verlopen', en: 'The APK has expired', ar: 'انتهى الـ APK' },
  'vtg.status.due': { nl: 'APK verloopt binnenkort', en: 'The APK expires soon', ar: 'ينتهي الـ APK قريباً' },
  'vtg.status.soon': { nl: 'APK komt in zicht', en: 'The APK is coming up', ar: 'يقترب موعد الـ APK' },
  'vtg.status.ok': { nl: 'APK is nog geldig', en: 'The APK is still valid', ar: 'الـ APK ما زال سارياً' },
  'vtg.status.unknown': {
    nl: 'APK-datum niet bekend — vul hem in om deze auto op tijd terug te zien',
    en: 'APK date unknown — fill it in to see this car back in time',
    ar: 'تاريخ الـ APK غير معروف — أدخله لترى هذه السيارة في وقتها',
  },
  'vtg.bellen': { nl: 'Deze wil je bellen', en: 'These are worth calling', ar: 'هؤلاء تستحقّ الاتصال' },
  'vtg.fout.laden': { nl: 'Kon de voertuigen niet laden.', en: 'Could not load the vehicles.', ar: 'تعذّر تحميل المركبات.' },
  'vtg.fout.opslaan': { nl: 'Kon het voertuig niet opslaan.', en: 'Could not save the vehicle.', ar: 'تعذّر حفظ المركبة.' },

  'nav.kassa': { nl: 'Kassa', en: 'Till', ar: 'الكاسة', tr: 'Kasa' },

  'vak.titel': { nl: 'Begin met de regels van jouw vak', en: 'Start from your trade’s lines', ar: 'ابدأ من بنود مهنتك' },
  'vak.uitleg': {
    nl: 'Kies je vak, vul in wat jij rekent, en je prijslijst staat er. Het btw-tarief staat er al bij — dat is het stukje waar het vaakst iets misgaat.',
    en: 'Pick your trade, fill in what you charge, and your price list is there. The btw rate is already set — that is the part that most often goes wrong.',
    ar: 'اختر مهنتك، واملأ ما تتقاضاه، فتجهز قائمة أسعارك. نسبة الـ btw مضبوطة سلفاً — وهي الجزء الذي يُخطئ فيه الناس أكثر.',
  },
  'vak.kies': { nl: 'Wat is je vak?', en: 'What is your trade?', ar: 'ما مهنتك؟' },
  'vak.prijsKop': { nl: 'Wat reken jij?', en: 'What do you charge?', ar: 'كم تتقاضى؟' },
  'vak.prijsUitleg': {
    nl: 'Laat leeg wat je niet aanbiedt — die regel wordt niet gemaakt. Je kunt alles later nog aanpassen.',
    en: 'Leave blank what you do not offer — that line is not created. You can change everything later.',
    ar: 'اترك ما لا تقدّمه فارغاً — لن يُنشأ ذلك السطر. ويمكنك تعديل كل شيء لاحقاً.',
  },
  'vak.opslaan': { nl: 'Prijslijst maken', en: 'Create the price list', ar: 'أنشئ قائمة الأسعار' },
  'vak.klaar': { nl: 'Je prijslijst staat er. Op de Kassa sla je hem nu met één tik aan.', en: 'Your price list is there. On the Kassa you now ring it up with one tap.', ar: 'قائمة أسعارك جاهزة. تسجّلها الآن على الكاسة بنقرة واحدة.' },
  'vak.letOpKop': { nl: 'Let op bij dit vak', en: 'Watch out in this trade', ar: 'انتبه في هذه المهنة' },
  'vak.fout.opslaan': { nl: 'Kon de prijslijst niet maken.', en: 'Could not create the price list.', ar: 'تعذّر إنشاء قائمة الأسعار.' },
  'vak.fout.leeg': { nl: 'Vul minstens één prijs in.', en: 'Fill in at least one price.', ar: 'املأ سعراً واحداً على الأقل.' },

  // ─── [KASSA] A whole day typed by hand, on the Dagomzet screen ───────────────────────────────
  'dzh.titel': { nl: 'Dag zelf invullen', en: 'Enter a day yourself', ar: 'أدخل اليوم بنفسك' },
  'dzh.uitleg': {
    nl: 'Geen kassa-rapport? Vul dan zelf in wat je die dag hebt omgezet. Het btw-tarief is het enige dat je nergens anders kwijt kunt — zonder tarief blokkeert je btw-aangifte.',
    en: 'No till report? Then enter what you took that day yourself. The btw rate is the one thing you cannot record anywhere else — without it your btw return is blocked.',
    ar: 'لا يوجد تقرير كاسة؟ أدخل بنفسك ما حقّقته ذلك اليوم. نسبة الـ btw هي الشيء الوحيد الذي لا يمكن تسجيله في مكان آخر — وبدونها يُحجب إقرار الـ btw.',
  },
  'dzh.datum': { nl: 'Welke dag', en: 'Which day', ar: 'أي يوم' },
  'dzh.omzetKop': { nl: 'Omzet, inclusief btw', en: 'Revenue, including btw', ar: 'الإيراد شاملاً الـ btw' },
  'dzh.omzet21': { nl: 'Tegen 21%', en: 'At 21%', ar: 'بنسبة 21%' },
  'dzh.omzet9': { nl: 'Tegen 9%', en: 'At 9%', ar: 'بنسبة 9%' },
  'dzh.omzet0': { nl: 'Tegen 0%', en: 'At 0%', ar: 'بنسبة 0%' },
  'dzh.betaaldKop': { nl: 'Hoe er betaald is', en: 'How it was paid', ar: 'كيف تم الدفع' },
  'dzh.totaalOmzet': { nl: 'Omzet bij elkaar', en: 'Revenue together', ar: 'مجموع الإيراد' },
  'dzh.totaalBetaald': { nl: 'Betaald bij elkaar', en: 'Paid together', ar: 'مجموع المدفوع' },
  'dzh.moetGelijk': {
    nl: 'Deze twee moeten gelijk zijn — ze beschrijven dezelfde dag.',
    en: 'These two must match — they describe the same day.',
    ar: 'يجب أن يتساوى الرقمان — فهما يصفان اليوم نفسه.',
  },
  'dzh.opslaan': { nl: 'Dag vastleggen', en: 'Record the day', ar: 'تثبيت اليوم' },
  'dzh.klaar': {
    nl: 'De dag staat in je omzet, met het btw-tarief erbij.',
    en: 'The day is in your revenue, with its btw rate.',
    ar: 'اليوم مُسجَّل في إيرادك، ومعه نسبة الـ btw.',
  },
  'dzh.fout.opslaan': {
    nl: 'Kon de dagomzet niet opslaan.',
    en: 'Could not save the day’s revenue.',
    ar: 'تعذّر حفظ إيراد اليوم.',
  },

  // ─── [BEWIJS-BEANTWOORDEN] Het antwoord op de vraag die het bewijspaneel stelt ───────────────
  //
  // Het paneel vroeg "Klopt het dat deze factuur nog openstaat?" en bood niets om dat mee te
  // beantwoorden. Wie het één keer had nagekeken, kreeg dezelfde vraag elke keer opnieuw. Een
  // vraag zonder antwoord leert de ondernemer om over het paneel heen te lezen — en dit paneel is
  // juist de ene plek in de app die zijn werk laat zien.
  //
  // De knop zegt het ANTWOORD, niet de handeling. "Sluiten" laat in het midden wat er is
  // vastgesteld; "Ja, staat nog open" is wat de ondernemer heeft nagekeken, en dat is ook precies
  // waarvoor de vraag hem bedankt door hem niet meer te stellen.

  'bewijs.ack.knop': {
    nl: 'Ja, staat nog open',
    en: 'Yes, still open',
    ar: 'نعم، ما زالت مستحقّة',
  },
  'bewijs.bank.knop': {
    nl: 'Bekijk in bank',
    en: 'View in bank',
    ar: 'اعرض في البنك',
  },
  'bewijs.ack.knopAria': {
    nl: 'Deze vraag is beantwoord — niet meer tonen',
    en: 'This question is answered — stop showing it',
    ar: 'أُجيب عن هذا السؤال — لا تعرضه مرة أخرى',
  },
  // Wat er is weggelegd, staat er. Dat een rij WEG is mag nooit zelf ook verdwijnen.
  'bewijs.ack.verborgen.een': {
    nl: '1 eerdere vraag heb je al beantwoord.',
    en: 'You already answered 1 earlier question.',
    ar: 'أجبت بالفعل عن سؤال واحد سابق.',
  },
  'bewijs.ack.verborgen.meer': {
    nl: '{count} eerdere vragen heb je al beantwoord.',
    en: 'You already answered {count} earlier questions.',
    ar: 'أجبت بالفعل عن {count} أسئلة سابقة.',
  },
  'bewijs.ack.toonWeer': {
    nl: 'Toon ze weer',
    en: 'Show them again',
    ar: 'أظهرها مجدداً',
  },
  // Waarom een beantwoorde vraag tóch terug kan komen. Zonder deze zin lijkt hij weg te zijn
  // gebleven en dan is een nieuwe betaling die er wél bij past een verrassing.
  'bewijs.ack.uitleg': {
    nl: 'Komt er later een andere betaling die bij deze factuur past, dan vragen we het opnieuw.',
    en: 'If a different payment turns up later that fits this invoice, we will ask again.',
    ar: 'إن ظهرت لاحقاً دفعة أخرى تطابق هذه الفاتورة، فسنسأل من جديد.',
  },

  // ─── [UREN] De gewerkte uren, en wat ervan nog te factureren valt ────────────────────────────
  //
  // Elke zin hier gaat over geld dat nog niet gefactureerd is, en dat is de reden dat dit scherm
  // bestaat: overtikken uit een schrift lekt maar één kant op. Waar een bedrag onvolledig is,
  // zegt de tekst dat — een totaal dat stil een uur zonder tarief weglaat is een getal dat de
  // ondernemer niet kan narekenen tegen de lijst ernaast.

  // [URENCRITERIUM] Het urencriterium terwijl er nog iets aan te doen is. Elke stand heeft een
  // EIGEN zin: "Een {woord} haal je niet" werkt in het Nederlands en breekt Arabische congruentie
  // en Turkse klinkerharmonie. Getallen zijn wél parameters — die verbuigen niet.
  'uren.criterium.titel': { nl: 'Urencriterium', en: 'Hour criterion', ar: 'معيار الساعات' },
  'uren.criterium.voortgang': {
    nl: '{uren} van de 1.225 uur geregistreerd in {jaar}',
    en: '{uren} of the 1,225 hours registered in {jaar}',
    ar: 'تم تسجيل {uren} من أصل 1.225 ساعة في {jaar}',
  },
  'uren.criterium.onbekend': {
    nl: 'We konden je uren nu niet lezen — het urencriterium is niet beoordeeld.',
    en: 'We could not read your hours just now — the hour criterion has not been assessed.',
    ar: 'تعذّرت قراءة ساعاتك الآن — لم يُقيَّم معيار الساعات.',
  },
  'uren.criterium.gehaald': {
    nl: 'Je hebt het urencriterium gehaald. Blijf je uren gewoon bijhouden — de Belastingdienst mag erom vragen.',
    en: 'You have met the hour criterion. Keep registering your hours — the Belastingdienst may ask to see them.',
    ar: 'لقد استوفيت معيار الساعات. واصل تسجيل ساعاتك — قد تطلبها مصلحة الضرائب.',
  },
  'uren.criterium.tevroeg': {
    nl: 'Het jaar is nog te jong om te zeggen waar dit uitkomt. Vanaf hier is dat gemiddeld {perweek} uur per week.',
    en: 'The year is too young to say where this lands. From here that is {perweek} hours a week on average.',
    ar: 'ما زال العام في بدايته لتحديد النتيجة. من الآن فصاعداً يعني ذلك {perweek} ساعة أسبوعياً في المتوسط.',
  },
  'uren.criterium.opkoers': {
    nl: 'Op dit tempo kom je dit jaar uit op ongeveer {verwacht} uur. Dat is boven de 1.225.',
    en: 'At this pace you will reach about {verwacht} hours this year. That is above the 1,225.',
    ar: 'بهذه الوتيرة ستصل إلى نحو {verwacht} ساعة هذا العام، أي فوق 1.225.',
  },
  'uren.criterium.achter': {
    nl: 'Op dit tempo kom je uit op ongeveer {verwacht} uur — onder de 1.225. Je hebt nog {resterend} uur te gaan in {dagen} dagen: gemiddeld {perweek} uur per week.',
    en: 'At this pace you will reach about {verwacht} hours — below the 1,225. You have {resterend} hours to go in {dagen} days: {perweek} hours a week on average.',
    ar: 'بهذه الوتيرة ستصل إلى نحو {verwacht} ساعة — أي أقل من 1.225. أمامك {resterend} ساعة خلال {dagen} يوماً: بمعدل {perweek} ساعة أسبوعياً.',
  },
  'uren.criterium.kritiek': {
    nl: 'Je hebt nog {resterend} uur te gaan in {dagen} dagen. Dat is gemiddeld {perweek} uur per week — meer dan een volle werkweek. Houd er rekening mee dat de zelfstandigenaftrek dit jaar kan vervallen.',
    en: 'You have {resterend} hours to go in {dagen} days. That is {perweek} hours a week — more than a full working week. Take into account that the zelfstandigenaftrek may lapse this year.',
    ar: 'أمامك {resterend} ساعة خلال {dagen} يوماً، أي {perweek} ساعة أسبوعياً — أكثر من أسبوع عمل كامل. ضع في حسبانك أن خصم العمل الحر قد يسقط هذا العام.',
  },
  'uren.criterium.onhaalbaar': {
    nl: 'Er zijn niet genoeg dagen meer over om dit jaar aan 1.225 uur te komen. Bespreek met je boekhouder wat dat betekent voor de zelfstandigenaftrek.',
    en: 'There are not enough days left to reach 1,225 hours this year. Discuss with your accountant what that means for the zelfstandigenaftrek.',
    ar: 'لم تعد الأيام المتبقية كافية لبلوغ 1.225 ساعة هذا العام. ناقش مع محاسبك أثر ذلك على خصم العمل الحر.',
  },
  'uren.criterium.afgeslotengehaald': {
    nl: 'In {jaar} haalde je het urencriterium op basis van je registratie.',
    en: 'In {jaar} you met the hour criterion based on your registration.',
    ar: 'في {jaar} استوفيت معيار الساعات بناءً على تسجيلك.',
  },
  'uren.criterium.afgeslotengemist': {
    nl: 'In {jaar} bleef je registratie onder de 1.225 uur. Werkte je meer, dan telt alleen wat je alsnog vastlegt.',
    en: 'In {jaar} your registration stayed below 1,225 hours. If you worked more, only what you still record counts.',
    ar: 'في {jaar} بقي تسجيلك دون 1.225 ساعة. إن كنت قد عملت أكثر، فلا يُحتسب إلا ما تُوثّقه.',
  },
  // De twee dingen die ondernemers het vaakst verkeerd aannemen. Ze staan er ALTIJD bij, ook als
  // het criterium gehaald is: wie het dit jaar haalde neemt volgend jaar dezelfde aanname mee.
  'uren.criterium.tellenmee': {
    nl: 'Ook uren die je niet factureert tellen mee: administratie, offertes, acquisitie, reistijd en scholing. Dit scherm is gemaakt om te factureren, dus die uren vergeet je makkelijk.',
    en: 'Hours you do not invoice count too: administration, quotes, acquisition, travel and training. This screen is built for invoicing, so those hours are easy to forget.',
    ar: 'تُحتسب أيضاً الساعات غير المفوترة: الإدارة وعروض الأسعار واستقطاب العملاء ووقت التنقل والتدريب. صُمِّمت هذه الشاشة للفوترة، لذا يسهل نسيان تلك الساعات.',
  },
  'uren.criterium.geendeeljaar': {
    nl: 'Startte je dit jaar? Dan geldt dezelfde 1.225 uur — er wordt niet naar rato gerekend.',
    en: 'Did you start this year? The same 1,225 hours apply — there is no pro-rata.',
    ar: 'هل بدأت هذا العام؟ ينطبق العدد نفسه 1.225 ساعة — لا يوجد احتساب تناسبي.',
  },
  'uren.titel': { nl: 'Uren', en: 'Hours', ar: 'الساعات' },
  'uren.subtitel': {
    nl: 'Schrijf op wat je gewerkt hebt. Wat er nog niet op een factuur staat, zet je hier in één keer om.',
    en: 'Write down what you worked. Whatever is not on an invoice yet, you turn into one here.',
    ar: 'سجّل ما عملته. وما لم يُدرَج بعد في فاتورة، تحوّله من هنا دفعة واحدة.',
  },
  'uren.nieuw': { nl: 'Uur toevoegen', en: 'Add hours', ar: 'إضافة ساعات' },
  'uren.leeg.titel': { nl: 'Nog geen uren', en: 'No hours yet', ar: 'لا ساعات بعد' },
  'uren.leeg.uitleg': {
    nl: 'Zodra je hier uren opschrijft, zie je per klant wat er nog te factureren valt — en maak je daar met één knop een factuur van.',
    en: 'Once you write hours here, you see per customer what is still to be invoiced — and turn it into an invoice with one button.',
    ar: 'ما إن تسجّل ساعات هنا، ترى لكل عميل ما لم يُفوتَر بعد — وتحوّله إلى فاتورة بزر واحد.',
  },

  // ── De velden ──
  'uren.veld.datum': { nl: 'Datum', en: 'Date', ar: 'التاريخ' },
  'uren.veld.klant': { nl: 'Klant', en: 'Customer', ar: 'العميل' },
  'uren.veld.omschrijving': { nl: 'Wat heb je gedaan?', en: 'What did you do?', ar: 'ماذا أنجزت؟' },
  // Dit veld wordt de factuurregel. Dat hier zeggen scheelt een omschrijving als "werk" waar de
  // klant later niets aan heeft — en de klant is degene die hem moet kunnen narekenen.
  'uren.veld.omschrijvingHint': {
    nl: 'Dit komt zo op de factuurregel te staan.',
    en: 'This becomes the invoice line.',
    ar: 'سيظهر هذا في سطر الفاتورة.',
  },
  'uren.veld.uren': { nl: 'Uren', en: 'Hours', ar: 'الساعات' },
  'uren.veld.tarief': { nl: 'Uurtarief', en: 'Hourly rate', ar: 'أجر الساعة' },
  'uren.veld.tariefHint': {
    nl: 'Excl. btw. Laat leeg als je het nog niet weet — het uur blijft dan gewoon staan.',
    en: 'Excl. btw. Leave it empty if you do not know yet — the hours stay recorded.',
    ar: 'دون ضريبة القيمة المضافة. اتركه فارغاً إن لم تعرفه بعد — تبقى الساعات مسجّلة.',
  },
  'uren.veld.geenKlant': { nl: 'Geen klant', en: 'No customer', ar: 'بدون عميل' },
  'uren.opslaan': { nl: 'Opslaan', en: 'Save', ar: 'حفظ' },
  'uren.annuleren': { nl: 'Annuleren', en: 'Cancel', ar: 'إلغاء' },
  'uren.bewerken': { nl: 'Aanpassen', en: 'Edit', ar: 'تعديل' },
  'uren.verwijderen': { nl: 'Verwijderen', en: 'Remove', ar: 'حذف' },
  'uren.bezig': { nl: 'Bezig…', en: 'Working…', ar: 'جارٍ…' },

  // ── Wat er nog te factureren valt ──
  'uren.teFactureren': { nl: 'Nog te factureren', en: 'Still to invoice', ar: 'لم يُفوتَر بعد' },
  'uren.gefactureerd': { nl: 'Al gefactureerd', en: 'Already invoiced', ar: 'مُفوتَر بالفعل' },
  'uren.maakFactuur': { nl: 'Maak factuur', en: 'Create invoice', ar: 'إنشاء فاتورة' },
  'uren.urenKort': { nl: 'uur', en: 'h', ar: 'ساعة' },
  // Een uur dat op een factuur staat is geen invoerveld meer — zie de kop van /api/uren.
  'uren.staatOpFactuur': {
    nl: 'Staat op een factuur',
    en: 'On an invoice',
    ar: 'مُدرَجة في فاتورة',
  },
  'uren.staatOpFactuurUitleg': {
    nl: 'Dit uur staat op een factuur en kan niet meer worden aangepast. Gooi je dat concept weg, dan komt het uur weer vrij.',
    en: 'These hours are on an invoice and can no longer be changed. Delete that draft and they become available again.',
    ar: 'هذه الساعات مُدرَجة في فاتورة ولم يعد بالإمكان تعديلها. احذف تلك المسودة لتعود متاحة.',
  },

  // ── Waar een bedrag onvolledig is, staat het er ──
  'uren.zonderTarief.een': {
    nl: 'Bij 1 uur staat nog geen tarief — dat uur zit niet in dit bedrag en gaat niet mee op de factuur.',
    en: '1 entry has no rate yet — it is not in this amount and will not go on the invoice.',
    ar: 'سجلٌّ واحد بلا أجر بعد — غير محتسب في هذا المبلغ ولن يُدرَج في الفاتورة.',
  },
  'uren.zonderTarief.meer': {
    nl: 'Bij {n} uren staat nog geen tarief — die zitten niet in dit bedrag en gaan niet mee op de factuur.',
    en: '{n} entries have no rate yet — they are not in this amount and will not go on the invoice.',
    ar: '{n} سجلات بلا أجر بعد — غير محتسبة في هذا المبلغ ولن تُدرَج في الفاتورة.',
  },
  'uren.geenTarief': { nl: 'Geen tarief', en: 'No rate', ar: 'بلا أجر' },

  // ── Wat er misging ──
  'uren.fout.laden': {
    nl: 'De uren konden niet worden geladen. Dit is een storing, geen lege lijst — probeer het zo opnieuw.',
    en: 'The hours could not be loaded. This is a failure, not an empty list — try again in a moment.',
    ar: 'تعذّر تحميل الساعات. هذا عطل وليس قائمة فارغة — أعد المحاولة بعد قليل.',
  },
  'uren.fout.opslaan': {
    nl: 'Dit uur is niet opgeslagen. Er is niets veranderd.',
    en: 'These hours were not saved. Nothing changed.',
    ar: 'لم تُحفَظ هذه الساعات. لم يتغيّر شيء.',
  },
  'uren.fout.factuur': {
    nl: 'De factuur is niet gemaakt en je uren staan er nog. Ververs de pagina en probeer het opnieuw.',
    en: 'The invoice was not created and your hours are still there. Refresh the page and try again.',
    ar: 'لم تُنشأ الفاتورة وساعاتك ما زالت موجودة. حدّث الصفحة وأعد المحاولة.',
  },
  'uren.verwijderen.vraag': {
    nl: 'Dit uur weggooien?',
    en: 'Remove these hours?',
    ar: 'حذف هذه الساعات؟',
  },
  'uren.verwijderen.uitleg': {
    nl: 'Het verdwijnt uit je urenlijst. Werk dat je wel gedaan hebt, kun je daarna niet meer factureren.',
    en: 'It disappears from your hours. Work you did do cannot be invoiced afterwards.',
    ar: 'ستختفي من قائمة ساعاتك. ولن تتمكّن بعدها من فوترة عمل أنجزته فعلاً.',
  },


  // ─── [UITNODIGING] De pagina waar een uitnodiging een koppeling wordt ───────────────────────
  //
  // De genodigde is meestal een KLANT van een kantoor — iemand die BoekBrug nog nooit zag en er
  // via de mail van zijn boekhouder binnenkomt. De eerste kantoren lezen Arabisch, dus dit is
  // een van de weinige publieke pagina's waar de vertaling er vanaf dag één toe doet.
  // Het kantoor-overzicht van wat er uitstaat (KlantenBeheer).
  'bh.klant.uitn.kop': { nl: 'Uitgenodigd — wacht op reactie ({count})', ar: 'دعوات بانتظار الرد ({count})', en: 'Invited — awaiting reply ({count})' },
  'bh.klant.uitn.verloopt': { nl: 'Link nog {dagen} dagen geldig', ar: 'الرابط صالح {dagen} أيام بعد', en: 'Link valid for {dagen} more days' },
  'bh.klant.uitn.intrekken': { nl: 'Intrekken', ar: 'سحب الدعوة', en: 'Withdraw' },
  // Stap 5 van de wizard, voor wie al gekoppeld binnenkwam (via de uitnodiging van zijn kantoor).
  'onb.kantoor.titel': { nl: 'Je boekhouder staat al klaar', ar: 'محاسبك جاهز بالفعل', en: 'Your accountant is already set' },
  'onb.kantoor.uitleg': { nl: 'Je bent gekoppeld aan {naam}. Alles wat je verstuurt, ontvangt of als betaald markeert, kan hij aan het eind van het kwartaal in één keer ophalen — je concepten blijven van jou alleen.', ar: 'أنت مرتبط بـ {naam}. كل ما ترسله أو تستقبله أو تعلّمه كمدفوع يمكنه جمعه دفعة واحدة في نهاية الربع — ومسوّداتك تبقى لك وحدك.', en: 'You are linked to {naam}. Everything you send, receive or mark as paid can be collected in one go at quarter end — your drafts stay yours alone.' },
  // ─── [PROEFDOSSIER] Het voorbeelddossier — de bewijsplek vóór de eerste klant ───────────────
  'bh.home.klanten.eerste.voorbeeld': { nl: 'Eerst zien hoe een gevuld klantdossier eruitziet →', ar: 'شاهد أولاً كيف يبدو ملف عميل ممتلئ ←', en: 'First see what a filled client file looks like →' },
  'bh.demo.banner.titel': { nl: 'Voorbeeld — fictieve cijfers', ar: 'مثال — أرقام خيالية', en: 'Example — fictional figures' },
  'bh.demo.banner.uitleg': { nl: 'Dit is hoe een klantdossier eruitziet als het gevuld is. Niets hierin is echt, en niets hierin wordt opgeslagen — het bestaat alleen om te laten zien wat je klanten straks aanleveren.', ar: 'هكذا يبدو ملف العميل عندما يمتلئ. لا شيء هنا حقيقي، ولا شيء يُحفظ — وُجد فقط ليُريك ما سيسلّمه عملاؤك قريباً.', en: 'This is what a client file looks like when it is filled. Nothing in it is real and nothing is stored — it exists only to show what your clients will deliver.' },
  'bh.demo.gereedheid': { nl: '{verwerkt} van {totaal} inkoopfacturen verwerkt · Bank ✓ · {vragen} vraag open', ar: '{verwerkt} من {totaal} فواتير مشتريات معالجة · البنك ✓ · {vragen} سؤال مفتوح', en: '{verwerkt} of {totaal} purchase invoices processed · Bank ✓ · {vragen} question open' },
  'bh.demo.tegel.omzet': { nl: 'Omzet (excl. btw)', ar: 'الإيراد (بدون الضريبة)', en: 'Revenue (excl. VAT)' },
  'bh.demo.tegel.kosten': { nl: 'Kosten (excl. btw)', ar: 'التكاليف (بدون الضريبة)', en: 'Costs (excl. VAT)' },
  'bh.demo.tegel.saldo': { nl: 'BTW-saldo (te betalen)', ar: 'رصيد الضريبة (مستحق الدفع)', en: 'VAT balance (payable)' },
  'bh.demo.verkoop.kop': { nl: 'Verkoop', ar: 'المبيعات', en: 'Sales' },
  'bh.demo.inkoop.kop': { nl: 'Inkoop', ar: 'المشتريات', en: 'Purchases' },
  'bh.demo.chip.verwerkt': { nl: '✓ Verwerkt', ar: '✓ معالجة', en: '✓ Processed' },
  'bh.demo.chip.vraag': { nl: '? Vraag', ar: '؟ سؤال', en: '? Question' },
  'bh.demo.vraag.teltNietMee': { nl: 'Telt nergens in mee tot de klant antwoordt — geen gok in je voorbelasting.', ar: 'لا تُحتسب في أي شيء حتى يجيب العميل — لا تخمين في ضريبتك المستردة.', en: 'Counts nowhere until the client answers — no guess in your input VAT.' },
  'bh.demo.eerlijk.kop': { nl: 'Wat wij niet zeker weten, staat als vraag — niet als gok', ar: 'ما لا نعرفه يقيناً يبقى سؤالاً — لا تخميناً', en: 'What we are not sure of stands as a question — not a guess' },
  'bh.demo.eerlijk.tekst': { nl: 'Kijk naar de tegels: de factuur met de open vraag telt niet mee in de kosten en niet in de voorbelasting. Het dossier dat je ophaalt klopt — of het zegt precies waar het nog niet klopt.', ar: 'انظر إلى الأرقام: الفاتورة ذات السؤال المفتوح لا تُحتسب في التكاليف ولا في الضريبة المستردة. الملف الذي تستلمه صحيح — أو يقول بدقة أين لم يصح بعد.', en: 'Look at the tiles: the invoice with the open question is counted in neither costs nor input VAT. The file you collect is correct — or it says exactly where it is not yet.' },
  'bh.demo.pakket.tekst': { nl: 'Aan het eind van het kwartaal haal je alles in één keer op: de PDF\'s, een CSV en het XAF 3.2-auditbestand — te importeren in je eigen pakket.', ar: 'في نهاية الربع تجمع كل شيء دفعة واحدة: ملفات PDF وملف CSV وملف تدقيق XAF 3.2 — قابلة للاستيراد في برنامجك.', en: 'At quarter end you collect everything in one go: the PDFs, a CSV and the XAF 3.2 audit file — importable into your own package.' },
  'bh.demo.cta': { nl: 'Nodig je eerste klant uit', ar: 'ادعُ عميلك الأول', en: 'Invite your first client' },

  'uitn.laden': { nl: 'Laden…', ar: 'جارٍ التحميل…', en: 'Loading…' },
  'uitn.titel': { nl: 'Je bent uitgenodigd', ar: 'تمت دعوتك', en: 'You are invited' },
  // Twee richtingen, twee zinnen — zie de kop van invite/accept/page.tsx.
  'uitn.vanKantoor': { nl: '{naam} nodigt je uit om via BoekBrug samen te werken. Jij houdt je administratie bij; je boekhouder haalt op wat hij nodig heeft.', ar: '{naam} يدعوك للعمل معاً عبر BoekBrug. أنت تتابع إدارتك، ومحاسبك يحصل على ما يحتاجه.', en: '{naam} invites you to work together through BoekBrug. You keep your administration; your accountant picks up what they need.' },
  'uitn.vanOndernemer': { nl: '{naam} wil je toevoegen als boekhouder via BoekBrug.', ar: '{naam} يريد إضافتك محاسباً له عبر BoekBrug.', en: '{naam} wants to add you as their accountant on BoekBrug.' },
  'uitn.ingelogdAls': { nl: 'Ingelogd als {email}', ar: 'مسجّل الدخول كـ {email}', en: 'Signed in as {email}' },
  'uitn.accepteren': { nl: 'Uitnodiging accepteren', ar: 'قبول الدعوة', en: 'Accept invitation' },
  'uitn.weigeren': { nl: 'Weigeren', ar: 'رفض', en: 'Decline' },
  'uitn.eerstAccount': { nl: 'Maak een account aan (of log in) om de uitnodiging te accepteren.', ar: 'أنشئ حساباً (أو سجّل الدخول) لقبول الدعوة.', en: 'Create an account (or sign in) to accept the invitation.' },
  'uitn.registreren': { nl: 'Account aanmaken', ar: 'إنشاء حساب', en: 'Create account' },
  'uitn.inloggen': { nl: 'Inloggen', ar: 'تسجيل الدخول', en: 'Sign in' },
  'uitn.klaar.titel': { nl: 'Uitnodiging geaccepteerd!', ar: 'تم قبول الدعوة!', en: 'Invitation accepted!' },
  'uitn.klaar.uitleg': { nl: 'Je wordt doorgestuurd naar je dashboard…', ar: 'يتم تحويلك إلى لوحتك…', en: 'Taking you to your dashboard…' },
  'uitn.geweigerd.titel': { nl: 'Uitnodiging geweigerd', ar: 'تم رفض الدعوة', en: 'Invitation declined' },
  'uitn.geweigerd.uitleg': { nl: 'Er is niets gekoppeld. Je kunt dit venster sluiten.', ar: 'لم يُربط أي شيء. يمكنك إغلاق هذه النافذة.', en: 'Nothing was linked. You can close this window.' },
  'uitn.fout.titel': { nl: 'Dat lukte niet', ar: 'لم ينجح ذلك', en: 'That did not work' },
  'uitn.fout.ongeldig': { nl: 'Deze uitnodiging is verlopen of al gebruikt. Vraag je boekhouder om een nieuwe.', ar: 'هذه الدعوة منتهية أو استُخدمت من قبل. اطلب من محاسبك دعوة جديدة.', en: 'This invitation has expired or was already used. Ask your accountant for a new one.' },

  // ═══ [BOEKHOUDER] De schermen van de boekhouder ═══════════════════════════════════════════════
  //
  // Deze module was met opzet alleen Nederlands, en die keuze stond met redenen in AGENTS.md: de
  // boekhouder is een Nederlandse beroepsbeoefenaar, en de taalkeuze van de EIGENAAR zegt niets
  // over hem. Het slot van die alinea was ook de uitweg: "wordt een niet-Nederlandse boekhouder
  // ooit een echt publiek, dan is dat eerst een productbeslissing en pas daarna een vertaling."
  //
  // Dat publiek is er. De boekhouder heeft bovendien zijn EIGEN profiel en dus zijn eigen taal —
  // de bezwaren in die alinea gingen over de taal van de eigenaar, en die raakt deze schermen
  // nog steeds niet.
  //
  // Wat NIET meevertaalt en hier dus ook niet in staat: de administratie zelf. Bedragen, data,
  // factuurnummers, statuswaarden uit de database, de factuur, de e-factuur en het auditbestand
  // blijven wat ze waren. Een vertaalde knop boven een Nederlands document vertaalt het document
  // niet — en dat is precies goed.

  // ─── [BOEKHOUDER] Boekhouder · de dagelijkse startpagina (AccountantHome) ───────────────────
  'bh.home.groet.ochtend': { nl: 'Goedemorgen', en: 'Good morning', ar: 'صباح الخير' },
  'bh.home.groet.middag': { nl: 'Goedemiddag', en: 'Good afternoon', ar: 'طاب يومك' },
  'bh.home.groet.avond': { nl: 'Goedenavond', en: 'Good evening', ar: 'مساء الخير' },
  'bh.home.groet.hallo': { nl: 'Hallo', en: 'Hello', ar: 'مرحبًا' },
  'bh.home.groet.daar': { nl: 'daar', en: 'there', ar: 'أهلًا' },
  'bh.home.aangifte.titel': { nl: 'Aangifte & status', en: 'Return & status', ar: 'الإقرار والحالة' },
  'bh.home.aangifte.uitleg': { nl: 'BTW-deadline, klaar-status en herinneren per klant', en: 'VAT deadline, readiness and reminders per client', ar: 'موعد إقرار الضريبة وحالة الجاهزية والتذكير لكل عميل' },
  'bh.home.werkvoorraad.onvolledig': { nl: 'We konden je werkvoorraad nu niet volledig lezen — de blokken hieronder kunnen onvolledig zijn. Ververs de pagina om het opnieuw te proberen.', en: 'We could not fully read your work queue right now — the blocks below may be incomplete. Refresh the page to try again.', ar: 'لم نتمكن من قراءة قائمة أعمالك بالكامل الآن — قد تكون الكتل أدناه ناقصة. حدّث الصفحة للمحاولة مرة أخرى.' },
  'bh.home.werkvoorraad.kop': { nl: 'Wat er op jou ligt', en: 'What is waiting for you', ar: 'ما ينتظرك' },
  'bh.home.bevestigen.label': { nl: 'Te bevestigen', en: 'To confirm', ar: 'بانتظار التأكيد' },
  'bh.home.geenMachtiging': { nl: 'Nog niemand machtigde je hiervoor', en: 'Nobody has authorised you for this yet', ar: 'لم يفوّضك أحد بذلك بعد' },
  'bh.home.bevestigen.niets': { nl: 'Niets houdt een kwartaal tegen', en: 'Nothing is holding up a quarter', ar: 'لا شيء يعطّل ربعًا' },
  'bh.home.bevestigen.blokkeert': { nl: 'Houdt een kwartaal tegen', en: 'Holds up a quarter', ar: 'يعطّل ربعًا' },
  'bh.home.telaat.label': { nl: 'Te laat', en: 'Overdue', ar: 'متأخر' },
  'bh.home.telaat.niets': { nl: 'Niets te laat', en: 'Nothing overdue', ar: 'لا شيء متأخر' },
  'bh.home.telaat.een': { nl: '{aantal} factuur · oudste {dagen} dagen', en: '{aantal} invoice · oldest {dagen} days', ar: '{aantal} فاتورة · الأقدم {dagen} يومًا' },
  'bh.home.telaat.meer': { nl: '{aantal} facturen · oudste {dagen} dagen', en: '{aantal} invoices · oldest {dagen} days', ar: '{aantal} فواتير · الأقدم {dagen} يومًا' },
  'bh.home.overzicht.kop': { nl: 'Overzicht', en: 'Overview', ar: 'نظرة عامة' },
  'bh.home.overzicht.klanten': { nl: 'Klanten', en: 'Clients', ar: 'العملاء' },
  'bh.home.overzicht.openVraag': { nl: 'Open vraag', en: 'Open question', ar: 'سؤال مفتوح' },
  'bh.home.overzicht.zonderBank': { nl: 'Zonder bank', en: 'No bank', ar: 'بلا بنك' },
  'bh.home.todo.onleesbaar.titel': { nl: 'We konden je takenlijst nu niet ophalen', en: 'We could not fetch your to-do list right now', ar: 'لم نتمكن من جلب قائمة مهامك الآن' },
  'bh.home.todo.onleesbaar.uitleg': { nl: 'Dit betekent niet dat er niets te doen is — alleen dat wij het even niet konden lezen.', en: 'This does not mean there is nothing to do — only that we could not read it just now.', ar: 'هذا لا يعني أنه لا يوجد ما تفعله — بل أننا لم نتمكن من قراءتها الآن.' },
  'bh.home.todo.kop': { nl: 'Te doen', en: 'To do', ar: 'المهام' },
  'bh.home.klanten.kop': { nl: 'Mijn klanten', en: 'My clients', ar: 'عملائي' },
  'bh.home.klanten.nieuw': { nl: '+ Klant', en: '+ Client', ar: '+ عميل' },
  'bh.home.klanten.zoekPlaceholder': { nl: 'Zoek klant op naam of e-mail…', en: 'Search a client by name or e-mail…', ar: 'ابحث عن عميل بالاسم أو البريد…' },
  'bh.home.klanten.zoekLabel': { nl: 'Klanten zoeken', en: 'Search clients', ar: 'البحث في العملاء' },
  'bh.home.klanten.wissen': { nl: 'Wissen', en: 'Clear', ar: 'مسح' },
  'bh.home.klanten.onleesbaar.titel': { nl: 'We konden je klantenlijst nu niet ophalen', en: 'We could not fetch your client list right now', ar: 'لم نتمكن من جلب قائمة عملائك الآن' },
  'bh.home.klanten.onleesbaar.uitleg': { nl: 'Dit zegt niets over je klanten — alleen dat wij ze even niet konden lezen. Ververs de pagina; blijft dit staan, laat het ons weten.', en: 'This says nothing about your clients — only that we could not read them just now. Refresh the page; if it stays, let us know.', ar: 'هذا لا يقول شيئًا عن عملائك — بل أننا لم نتمكن من قراءتهم الآن. حدّث الصفحة؛ وإن استمر ذلك، فأعلمنا.' },
  'bh.home.klanten.eerste.titel': { nl: 'Voeg je eerste klant toe', en: 'Add your first client', ar: 'أضف عميلك الأول' },
  'bh.home.klanten.eerste.uitleg': { nl: 'Nodig een klant uit of koppel een bestaande', en: 'Invite a client or link an existing one', ar: 'ادعُ عميلًا أو اربط عميلًا موجودًا' },
  'bh.home.klanten.geenResultaat': { nl: 'Geen klanten gevonden voor “{zoekterm}”', en: 'No clients found for “{zoekterm}”', ar: 'لا عملاء مطابقون لـ ”{zoekterm}“' },
  'bh.home.werkplek.kop': { nl: 'Werkplek', en: 'Workspace', ar: 'مساحة العمل' },
  'bh.home.tegel.beheren': { nl: 'Beheren', en: 'Manage', ar: 'الإدارة' },
  'bh.home.tegel.kwartaal': { nl: 'Kwartaal', en: 'Quarter', ar: 'الربع' },
  'bh.home.tegel.brug': { nl: 'Brug', en: 'Bridge', ar: 'الجسر' },
  'bh.home.tegel.mijnFacturen': { nl: 'Mijn facturen', en: 'My invoices', ar: 'فواتيري' },
  'bh.home.tegel.factureren': { nl: 'Factureren', en: 'Invoicing', ar: 'إصدار فاتورة' },
  'bh.home.tegel.openstaand': { nl: 'Openstaand', en: 'Outstanding', ar: 'المستحق' },
  'bh.home.tegel.opvragen': { nl: 'Opvragen', en: 'Request', ar: 'طلب المستندات' },
  'bh.home.tegel.bevestigen': { nl: 'Bevestigen', en: 'Confirm', ar: 'التأكيد' },
  'bh.home.tegel.bestanden': { nl: 'Bestanden', en: 'Files', ar: 'الملفات' },
  'bh.home.tegel.instellingen': { nl: 'Instellingen', en: 'Settings', ar: 'الإعدادات' },
  'bh.home.verder.kop': { nl: 'Ga verder waar je gebleven bent', en: 'Continue where you left off', ar: 'تابع من حيث توقفت' },
  'bh.home.ai.eyebrow': { nl: 'AI Assistent', en: 'AI assistant', ar: 'مساعد الذكاء الاصطناعي' },
  'bh.home.ai.titel': { nl: 'Samen werken met AI ✨', en: 'Working together with AI ✨', ar: 'العمل مع الذكاء الاصطناعي ✨' },
  'bh.home.ai.uitleg': { nl: 'Schrijf wat je wilt doen — de AI stelt het voor je op.', en: 'Write what you want to do — the AI drafts it for you.', ar: 'اكتب ما تريد فعله — والذكاء الاصطناعي يصوغه لك.' },
  'bh.home.ai.placeholder': { nl: 'bijv. bereid BTW aangifte voor klant Jansen BV...', en: 'e.g. prepare the VAT return for client Jansen BV...', ar: 'مثال: جهّز إقرار الضريبة للعميل Jansen BV...' },
  'bh.home.ai.bezig': { nl: 'AI werkt...', en: 'AI is working...', ar: 'الذكاء الاصطناعي يعمل...' },
  'bh.home.ai.genereer': { nl: 'Genereer ✨', en: 'Generate ✨', ar: 'أنشئ ✨' },
  'bh.home.ai.onderwerp': { nl: 'Onderwerp: {onderwerp}', en: 'Subject: {onderwerp}', ar: 'الموضوع: {onderwerp}' },
  'bh.home.ai.kopieren': { nl: 'Kopiëren', en: 'Copy', ar: 'نسخ' },
  'bh.home.ai.opnieuw': { nl: 'Opnieuw', en: 'Again', ar: 'من جديد' },
  'bh.home.ai.teVeel': { nl: 'Even te veel aanvragen', en: 'A few too many requests', ar: 'طلبات كثيرة الآن' },
  'bh.home.ai.mislukt': { nl: 'Het lukte niet', en: 'It did not work', ar: 'لم ينجح الأمر' },
  'bh.home.ai.probeerStraks': { nl: 'Probeer het zo opnieuw.', en: 'Try again shortly.', ar: 'أعد المحاولة بعد قليل.' },
  'bh.home.ai.geenVerbinding': { nl: 'Geen verbinding', en: 'No connection', ar: 'لا اتصال' },
  'bh.home.ai.checkInternet': { nl: 'Controleer je internet en probeer opnieuw.', en: 'Check your internet and try again.', ar: 'تحقق من اتصالك بالإنترنت وحاول مرة أخرى.' },

  // ─── [BOEKHOUDER] Boekhouder · aangifte & status (AccountantWerkboard) ──────────────────────
  'bh.werk.vernieuwen': { nl: 'Vernieuwen', ar: 'تحديث', en: 'Refresh' },
  'bh.werk.hero.btwAangifte': { nl: 'BTW-aangifte {kwartaal}', ar: 'إقرار ضريبة القيمة المضافة {kwartaal}', en: 'VAT return {kwartaal}' },
  'bh.werk.hero.uiterlijk': { nl: 'Uiterlijk {datum}', ar: 'في موعد أقصاه {datum}', en: 'No later than {datum}' },
  'bh.werk.countdown.verlopenEen': { nl: '{n} dag verlopen', ar: 'تأخّر {n} يوم', en: '{n} day overdue' },
  'bh.werk.countdown.verlopenMeer': { nl: '{n} dagen verlopen', ar: 'تأخّر {n} أيام', en: '{n} days overdue' },
  'bh.werk.countdown.vandaag': { nl: 'Deadline is vandaag', ar: 'الموعد النهائي اليوم', en: 'Deadline is today' },
  'bh.werk.countdown.nogEen': { nl: 'Nog {n} dag', ar: 'بقي {n} يوم', en: '{n} day left' },
  'bh.werk.countdown.nogMeer': { nl: 'Nog {n} dagen', ar: 'بقي {n} أيام', en: '{n} days left' },
  'bh.werk.jaar.vorig': { nl: 'Vorig jaar', ar: 'السنة السابقة', en: 'Previous year' },
  'bh.werk.jaar.volgend': { nl: 'Volgend jaar', ar: 'السنة التالية', en: 'Next year' },
  'bh.werk.telling.klaar': { nl: 'Klaar', ar: 'جاهز', en: 'Ready' },
  'bh.werk.telling.bijna': { nl: 'Bijna', ar: 'تقريبًا', en: 'Almost' },
  'bh.werk.telling.nogNiet': { nl: 'Nog niet', ar: 'ليس بعد', en: 'Not yet' },
  'bh.werk.status.ready': { nl: 'Klaar', ar: 'جاهز', en: 'Ready' },
  'bh.werk.status.almost': { nl: 'Bijna klaar', ar: 'شبه جاهز', en: 'Almost ready' },
  'bh.werk.status.attention': { nl: 'Nog niet', ar: 'ليس بعد', en: 'Not yet' },
  'bh.werk.filter.alle': { nl: 'Alle klanten', ar: 'كل العملاء', en: 'All clients' },
  'bh.werk.filter.actie': { nl: 'Actie nodig', ar: 'يتطلب إجراء', en: 'Action needed' },
  'bh.werk.zoek.placeholder': { nl: 'Zoek klant…', ar: 'ابحث عن عميل…', en: 'Search client…' },
  'bh.werk.zoek.aria': { nl: 'Klanten zoeken', ar: 'البحث في العملاء', en: 'Search clients' },
  'bh.werk.zoek.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'bh.werk.csv': { nl: 'Alle klanten (CSV)', ar: 'كل العملاء (CSV)', en: 'All clients (CSV)' },
  'bh.werk.leeg.geenKlanten': { nl: 'Nog geen klanten gekoppeld', ar: 'لا يوجد عملاء مرتبطون بعد', en: 'No clients linked yet' },
  'bh.werk.leeg.geenTreffer': { nl: 'Geen klanten gevonden voor “{zoekterm}”', ar: 'لا عملاء مطابقون لـ “{zoekterm}”', en: 'No clients found for “{zoekterm}”' },
  'bh.werk.leeg.allemaalKlaar': { nl: 'Alle klanten zijn klaar 🎉', ar: 'كل العملاء جاهزون 🎉', en: 'All clients are ready 🎉' },
  'bh.werk.rij.controleren': { nl: 'Controleren…', ar: 'جارٍ الفحص…', en: 'Checking…' },
  'bh.werk.rij.koppelingVerbroken': { nl: 'Koppeling verbroken', ar: 'انقطع الربط', en: 'Link disconnected' },
  'bh.werk.rij.statusOnbekend': { nl: 'Kon status niet laden', ar: 'تعذّر تحميل الحالة', en: 'Could not load status' },
  'bh.werk.rij.compleet': { nl: '{score}% compleet', ar: '{score}% مكتمل', en: '{score}% complete' },
  'bh.werk.rij.ontbreekt': { nl: '{n} ontbreekt', ar: 'ينقص {n}', en: '{n} missing' },
  'bh.werk.rij.nakijken': { nl: '{n} nakijken', ar: '{n} للمراجعة', en: '{n} to check' },
  'bh.werk.herinner': { nl: 'Herinner', ar: 'تذكير', en: 'Remind' },
  'bh.werk.versturen': { nl: 'Versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'bh.werk.verstuurd': { nl: 'Verstuurd', ar: 'أُرسل', en: 'Sent' },
  'bh.werk.mislukt': { nl: 'Mislukt · opnieuw', ar: 'فشل · أعد المحاولة', en: 'Failed · retry' },
  'bh.werk.meer': { nl: '+{n} meer', ar: '+{n} أخرى', en: '+{n} more' },
  'bh.werk.pakket': { nl: 'Pakket', ar: 'الحزمة', en: 'Package' },
  'bh.werk.jaarKnop': { nl: 'Jaar', ar: 'السنة', en: 'Year' },
  'bh.werk.verstuurHerinnering': { nl: 'Verstuur herinnering', ar: 'أرسل التذكير', en: 'Send reminder' },
  'bh.werk.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bh.werk.melding': { nl: 'De klant krijgt dit als melding in de app (geen e-mail).', ar: 'يصل هذا إلى العميل كإشعار داخل التطبيق (وليس بريدًا إلكترونيًا).', en: 'The client receives this as an in-app notification (no e-mail).' },
  'bh.werk.voetnoot': { nl: 'Zelfde score en verdict als de klant ziet op “Ben ik klaar?”. “Herinner” stuurt een melding in de app naar de klant — je bevestigt per klant.', ar: 'نفس النتيجة والحكم اللذين يراهما العميل في “هل أنا جاهز؟”. زر “تذكير” يرسل إشعارًا داخل التطبيق إلى العميل — وأنت تؤكّد لكل عميل على حدة.', en: 'The same score and verdict the client sees on “Am I ready?”. “Remind” sends an in-app notification to the client — you confirm per client.' },

  // ─── [BOEKHOUDER] Boekhouder · factureren namens een klant (AccountantFactuur) ──────────────
  'bh.fact.titel': { nl: 'Factureren namens een klant', ar: 'إصدار فاتورة نيابةً عن عميل', en: 'Invoicing on behalf of a client' },
  'bh.fact.ondertitel': { nl: 'De factuur gaat uit op naam van je klant, niet op die van jou.', ar: 'تصدر الفاتورة باسم عميلك، لا باسمك أنت.', en: 'The invoice goes out in the name of your client, not in yours.' },
  'bh.fact.geenMachtiging': { nl: 'Nog geen enkele klant heeft je hiervoor gemachtigd.', ar: 'لم يفوّضك أي عميل بذلك حتى الآن.', en: 'No client has authorised you for this yet.' },
  'bh.fact.geenMachtigingUitleg': { nl: 'Facturen maken namens iemand is iets anders dan zijn administratie inzien. Je klant zet het zelf aan bij Instellingen → Mijn boekhouder. Hij kan het daar ook weer uitzetten, wanneer hij wil.', ar: 'إصدار فواتير نيابةً عن شخص شيء آخر غير الاطّلاع على إدارته. عميلك يفعّل ذلك بنفسه في Instellingen → Mijn boekhouder، ويمكنه إيقافه هناك متى شاء.', en: 'Issuing invoices on behalf of someone is not the same as viewing their administratie. Your client switches it on themselves under Instellingen → Mijn boekhouder. They can switch it off there again, whenever they want.' },
  'bh.fact.geenMachtigingWet': { nl: 'De factuur komt daarna op zijn naam, in zijn nummerreeks en onder zijn BTW-nummer — hij blijft er zelf verantwoordelijk voor (art. 35a Wet OB). Daarom vraagt de app het hem, en niet jou.', ar: 'بعد ذلك تصدر الفاتورة باسمه، ضمن سلسلة أرقامه وتحت رقم BTW الخاص به — وتبقى مسؤوليته هو (المادة 35a من Wet OB). لذلك يطلب التطبيق الإذن منه، لا منك.', en: 'The invoice then goes out in their name, in their number series and under their BTW number — they stay responsible for it themselves (art. 35a Wet OB). That is why the app asks them, and not you.' },
  'bh.fact.namensLabel': { nl: 'Namens welke klant?', ar: 'نيابةً عن أي عميل؟', en: 'On behalf of which client?' },
  'bh.fact.kiesKlantOptie': { nl: 'Kies een klant…', ar: 'اختر عميلاً…', en: 'Choose a client…' },
  'bh.fact.mandaat': { nl: 'Deze factuur komt op naam van {naam}, met zijn nummerreeks. Hij krijgt bericht zodra hij verstuurd is, en kan de machtiging op elk moment zelf intrekken.', ar: 'تصدر هذه الفاتورة باسم {naam}، ضمن سلسلة أرقامه. يصله إشعار فور إرسالها، ويمكنه سحب التفويض بنفسه في أي وقت.', en: 'This invoice goes out in the name of {naam}, in their number series. They are notified as soon as it is sent, and can withdraw the mandate themselves at any time.' },
  'bh.fact.mandaatBtw': { nl: 'Deze factuur komt op naam van {naam}, met zijn nummerreeks en BTW-nummer {btw}. Hij krijgt bericht zodra hij verstuurd is, en kan de machtiging op elk moment zelf intrekken.', ar: 'تصدر هذه الفاتورة باسم {naam}، ضمن سلسلة أرقامه وتحت رقم BTW‏ {btw}. يصله إشعار فور إرسالها، ويمكنه سحب التفويض بنفسه في أي وقت.', en: 'This invoice goes out in the name of {naam}, in their number series and under BTW number {btw}. They are notified as soon as it is sent, and can withdraw the mandate themselves at any time.' },
  'bh.fact.aanWie': { nl: 'Aan wie stuurt {naam} deze factuur?', ar: 'إلى من يرسل {naam} هذه الفاتورة؟', en: 'Who is {naam} sending this invoice to?' },
  'bh.fact.jeKlant': { nl: 'je klant', ar: 'عميلك', en: 'your client' },
  'bh.fact.labelNaam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'bh.fact.labelEmail': { nl: 'E-mailadres', ar: 'البريد الإلكتروني', en: 'E-mail address' },
  'bh.fact.labelAdres': { nl: 'Adres', ar: 'العنوان', en: 'Address' },
  'bh.fact.labelPostcode': { nl: 'Postcode', ar: 'الرمز البريدي', en: 'Postcode' },
  'bh.fact.labelPlaats': { nl: 'Plaats', ar: 'المدينة', en: 'City' },
  'bh.fact.labelBtw': { nl: 'BTW-nummer (optioneel)', ar: 'رقم BTW (اختياري)', en: 'BTW number (optional)' },
  'bh.fact.labelDatum': { nl: 'Factuurdatum', ar: 'تاريخ الفاتورة', en: 'Invoice date' },
  'bh.fact.watGeleverd': { nl: 'Wat is er geleverd?', ar: 'ما الذي تم تسليمه؟', en: 'What was delivered?' },
  'bh.fact.phOmschrijving': { nl: 'Omschrijving', ar: 'الوصف', en: 'Description' },
  'bh.fact.ariaOmschrijving': { nl: 'Omschrijving regel {n}', ar: 'وصف السطر {n}', en: 'Description, line {n}' },
  'bh.fact.phAantal': { nl: 'Aantal', ar: 'الكمية', en: 'Quantity' },
  'bh.fact.ariaAantal': { nl: 'Aantal regel {n}', ar: 'كمية السطر {n}', en: 'Quantity, line {n}' },
  'bh.fact.ariaEenheid': { nl: 'Eenheid regel {n}', ar: 'وحدة السطر {n}', en: 'Unit, line {n}' },
  'bh.fact.phPrijs': { nl: 'Prijs', ar: 'السعر', en: 'Price' },
  'bh.fact.ariaPrijs': { nl: 'Prijs regel {n}', ar: 'سعر السطر {n}', en: 'Price, line {n}' },
  'bh.fact.ariaBtw': { nl: 'BTW regel {n}', ar: 'BTW السطر {n}', en: 'BTW, line {n}' },
  'bh.fact.btwTarief': { nl: '{tarief}% BTW', ar: '{tarief}% BTW', en: '{tarief}% BTW' },
  'bh.fact.regelErbij': { nl: '+ Regel erbij', ar: '+ سطر إضافي', en: '+ Add a line' },
  'bh.fact.subtotaal': { nl: 'Subtotaal', ar: 'المجموع الفرعي', en: 'Subtotal' },
  'bh.fact.btw': { nl: 'BTW', ar: 'BTW', en: 'BTW' },
  'bh.fact.totaal': { nl: 'Totaal', ar: 'الإجمالي', en: 'Total' },
  'bh.fact.bezig': { nl: 'Bezig met versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'bh.fact.verstuurNamens': { nl: 'Verstuur namens {naam}', ar: 'أرسل نيابةً عن {naam}', en: 'Send on behalf of {naam}' },
  'bh.fact.kiesEerst': { nl: 'Kies eerst een klant', ar: 'اختر عميلاً أولاً', en: 'Choose a client first' },
  'bh.fact.nummerWaarschuwing': { nl: 'Versturen geeft het factuurnummer uit. Dat kan niet ongedaan gemaakt worden — een uitgegeven nummer blijft uitgegeven (art. 35 Wet OB). Corrigeren gaat met een creditnota.', ar: 'الإرسال يصدر رقم الفاتورة. لا يمكن التراجع عن ذلك — الرقم الصادر يبقى صادراً (المادة 35 من Wet OB). التصحيح يتم عبر creditnota.', en: 'Sending issues the invoice number. That cannot be undone — an issued number stays issued (art. 35 Wet OB). You correct it with a creditnota.' },
  'bh.fact.foutKiesKlant': { nl: 'Kies eerst voor welke klant je factureert.', ar: 'اختر أولاً العميل الذي تصدر الفاتورة نيابةً عنه.', en: 'First choose which client you are invoicing for.' },
  'bh.fact.foutOntvanger': { nl: 'Vul in aan wie de factuur gericht is.', ar: 'أدخل الجهة التي توجَّه إليها الفاتورة.', en: 'Fill in who the invoice is addressed to.' },
  'bh.fact.foutRegel': { nl: 'Vul minstens één regel in met een omschrijving en een bedrag.', ar: 'أدخل سطراً واحداً على الأقل مع وصف ومبلغ.', en: 'Fill in at least one line with a description and an amount.' },
  'bh.fact.foutConcept': { nl: 'Het concept kon niet worden aangemaakt.', ar: 'تعذّر إنشاء المسودة.', en: 'The draft could not be created.' },
  'bh.fact.foutVersturen': { nl: 'Het concept staat klaar, maar versturen lukte niet. Probeer het opnieuw vanaf de factuur zelf.', ar: 'المسودة جاهزة، لكن الإرسال لم ينجح. حاول مرة أخرى من الفاتورة نفسها.', en: 'The draft is ready, but sending failed. Try again from the invoice itself.' },
  'bh.fact.foutOnbekend': { nl: 'Er ging iets mis. Probeer het opnieuw.', ar: 'حدث خطأ ما. حاول مرة أخرى.', en: 'Something went wrong. Try again.' },

  // ─── [BOEKHOUDER] Boekhouder · inkoopfacturen bevestigen (AccountantBevestigen) ─────────────
  'bh.bev.titel': { nl: 'Bevestigen', ar: 'التأكيد', en: 'Confirm' },
  'bh.bev.subtitel': { nl: 'Deze stukken houden een kwartaal tegen — bevestig wat klopt.', ar: 'هذه المستندات تعطّل ربعًا كاملًا — أكّد ما هو صحيح.', en: 'These documents are holding up a quarter — confirm what is correct.' },
  'bh.bev.leeg': { nl: 'Er staat niets te wachten. Bij je gemachtigde klanten is elke inkoopfactuur bevestigd.', ar: 'لا شيء في الانتظار. لدى العملاء الذين فوّضوك، كل فاتورة شراء مؤكدة.', en: 'Nothing is waiting. At the clients who authorised you, every purchase invoice is confirmed.' },
  'bh.bev.uitleg': { nl: 'Je bevestigt de lezing, je verandert er niets aan. Klopt een bedrag niet, bevestig dan niet en vraag het na bij je klant. Bij elke bevestiging komt jouw naam te staan en krijgt hij bericht — de verantwoordelijkheid blijft bij hem (art. 52 AWR).', ar: 'أنت تؤكد القراءة، ولا تغيّر فيها شيئًا. إن كان مبلغ غير صحيح فلا تؤكد، واسأل عميلك عنه. مع كل تأكيد يُسجَّل اسمك ويصل عميلك إشعار — والمسؤولية تبقى عليه (art. 52 AWR).', en: 'You confirm the reading, you change nothing about it. If an amount is wrong, do not confirm and ask your client. Every confirmation records your name and notifies him — the responsibility stays with him (art. 52 AWR).' },
  'bh.bev.wacht.een': { nl: 'stuk wacht op bevestiging', ar: 'مستند بانتظار التأكيد', en: 'document waiting for confirmation' },
  'bh.bev.wacht.meer': { nl: 'stukken wachten op bevestiging', ar: 'مستندات بانتظار التأكيد', en: 'documents waiting for confirmation' },
  'bh.bev.actie.bevestigen': { nl: 'Bevestigen', ar: 'تأكيد', en: 'Confirm' },
  'bh.bev.actie.bevestigd': { nl: 'Bevestigd', ar: 'تم التأكيد', en: 'Confirmed' },
  'bh.bev.actie.bezig': { nl: 'Bezig…', ar: 'جارٍ…', en: 'Working…' },
  'bh.bev.actie.annuleren': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },
  'bh.bev.geenMandaat.kop': { nl: 'Nog geen enkele klant heeft je gemachtigd om zijn inkoopfacturen te bevestigen.', ar: 'لم يفوّضك أي عميل بعد لتأكيد فواتير مشترياته.', en: 'No client has authorised you to confirm their purchase invoices yet.' },
  'bh.bev.geenMandaat.anders': { nl: 'Dit is een andere machtiging dan die om te factureren — een klant kan er één geven en de ander niet.', ar: 'هذا تفويض مختلف عن تفويض إصدار الفواتير — قد يمنح العميل أحدهما دون الآخر.', en: 'This is a different authorisation from the one for invoicing — a client can grant one and not the other.' },
  'bh.bev.geenMandaat.zetAan': { nl: 'Hij zet het zelf aan bij', ar: 'وهو يفعّله بنفسه من', en: 'He turns it on himself under' },
  'bh.bev.geenMandaat.plek': { nl: 'Instellingen → Jouw boekhouder', ar: 'Instellingen → Jouw boekhouder', en: 'Instellingen → Jouw boekhouder' },
  'bh.bev.geenMandaat.waarom': { nl: 'Waarom het uitmaakt: zolang een inkoopfactuur onbevestigd is, valt hij buiten het kwartaalpakket en blijft het kwartaal op "niet klaar" staan. Zonder deze machtiging kan alleen je klant dat slot openen.', ar: 'لماذا يهم ذلك: ما دامت فاتورة الشراء غير مؤكدة، فإنها تبقى خارج ملف الربع ويظل الربع على "niet klaar". وبدون هذا التفويض لا يستطيع فتح هذا القفل سوى عميلك.', en: 'Why it matters: as long as a purchase invoice is unconfirmed it falls outside the quarter package and the quarter stays on "niet klaar". Without this authorisation only your client can open that lock.' },
  'bh.bev.sel.een': { nl: '1 factuur geselecteerd', ar: 'تم تحديد فاتورة واحدة', en: '1 invoice selected' },
  'bh.bev.sel.meer': { nl: '{aantal} facturen geselecteerd', ar: 'تم تحديد {aantal} فاتورة', en: '{aantal} invoices selected' },
  'bh.bev.sel.wis': { nl: 'Wis selectie', ar: 'مسح التحديد', en: 'Clear selection' },
  'bh.bev.rij.selecteer': { nl: 'Selecteer {leverancier} voor bevestigen', ar: 'حدّد {leverancier} للتأكيد', en: 'Select {leverancier} for confirmation' },
  'bh.bev.rij.factuur': { nl: 'factuur', ar: 'فاتورة', en: 'invoice' },
  'bh.bev.rij.onbekendeLeverancier': { nl: 'Onbekende leverancier', ar: 'مورّد غير معروف', en: 'Unknown supplier' },
  'bh.bev.rij.zonderNummer': { nl: 'zonder nummer', ar: 'بدون رقم', en: 'without number' },
  'bh.bev.rij.datumOnbekend': { nl: 'datum onbekend', ar: 'تاريخ غير معروف', en: 'date unknown' },
  'bh.bev.rij.waarvanBtw': { nl: 'waarvan {bedrag} btw', ar: 'منها {bedrag} btw', en: 'of which {bedrag} btw' },
  'bh.bev.rij.twijfels': { nl: 'Dit konden wij niet zeker lezen: {twijfels}. Controleer het aan het document zelf voor je bevestigt.', ar: 'لم نتمكن من قراءة هذا بثقة: {twijfels}. تحقّق منه في المستند نفسه قبل أن تؤكد.', en: 'We could not read this with certainty: {twijfels}. Check it against the document itself before you confirm.' },
  'bh.bev.rij.vraagVerstuurd': { nl: 'Vraag verstuurd', ar: 'تم إرسال السؤال', en: 'Question sent' },
  'bh.bev.rij.kloptNiet': { nl: 'Klopt niet — vraag stellen', ar: 'غير صحيح — اطرح سؤالًا', en: 'Not correct — ask a question' },
  'bh.bev.bulk.titelEen': { nl: '1 factuur bevestigen ({bedrag})?', ar: 'تأكيد فاتورة واحدة ({bedrag})؟', en: 'Confirm 1 invoice ({bedrag})?' },
  'bh.bev.bulk.titelMeer': { nl: '{aantal} facturen bevestigen ({bedrag})?', ar: 'تأكيد {aantal} فاتورة ({bedrag})؟', en: 'Confirm {aantal} invoices ({bedrag})?' },
  'bh.bev.bulk.titelMeerKlanten': { nl: '{aantal} facturen bevestigen bij {klanten} klanten ({bedrag})?', ar: 'تأكيد {aantal} فاتورة لدى {klanten} عملاء ({bedrag})؟', en: 'Confirm {aantal} invoices at {klanten} clients ({bedrag})?' },
  'bh.bev.bulk.blijftEen': { nl: '1 factuur blijft staan: daar kon de lezer niet alles zeker lezen. Die bevestig je één voor één, nadat je het document zelf hebt bekeken.', ar: 'تبقى فاتورة واحدة كما هي: لم يستطع القارئ قراءة كل شيء فيها بثقة. أكّدها على حدة بعد أن تطّلع على المستند بنفسك.', en: '1 invoice stays put: the reader could not read everything there with certainty. You confirm those one by one, after looking at the document yourself.' },
  'bh.bev.bulk.blijftMeer': { nl: '{aantal} facturen blijven staan: daar kon de lezer niet alles zeker lezen. Die bevestig je één voor één, nadat je het document zelf hebt bekeken.', ar: 'تبقى {aantal} فاتورة كما هي: لم يستطع القارئ قراءة كل شيء فيها بثقة. أكّدها واحدة تلو الأخرى بعد أن تطّلع على المستند بنفسك.', en: '{aantal} invoices stay put: the reader could not read everything there with certainty. You confirm those one by one, after looking at the document yourself.' },
  'bh.bev.bulk.lezing': { nl: 'Je bevestigt de lezing — je verandert er niets aan. Bij elke bevestiging komt jouw naam te staan en krijgt je klant bericht; de verantwoordelijkheid blijft bij hem (art. 52 AWR).', ar: 'أنت تؤكد القراءة — ولا تغيّر فيها شيئًا. مع كل تأكيد يُسجَّل اسمك ويصل عميلك إشعار؛ والمسؤولية تبقى عليه (art. 52 AWR).', en: 'You confirm the reading — you change nothing about it. Every confirmation records your name and notifies your client; the responsibility stays with him (art. 52 AWR).' },
  'bh.bev.bulk.klanten': { nl: 'Deze facturen horen bij {klanten} verschillende klanten.', ar: 'هذه الفواتير تخص {klanten} عملاء مختلفين.', en: 'These invoices belong to {klanten} different clients.' },
  'bh.bev.bulk.ja': { nl: 'Ja, bevestigen', ar: 'نعم، أكّد', en: 'Yes, confirm' },
  'bh.bev.bulk.resultEen': { nl: '1 factuur bevestigd.', ar: 'تم تأكيد فاتورة واحدة.', en: '1 invoice confirmed.' },
  'bh.bev.bulk.resultMeer': { nl: '{aantal} facturen bevestigd.', ar: 'تم تأكيد {aantal} فاتورة.', en: '{aantal} invoices confirmed.' },
  'bh.bev.bulk.resultGeenEen': { nl: 'De factuur kon niet worden bevestigd — hij staat er nog.', ar: 'تعذّر تأكيد الفاتورة — ما زالت في القائمة.', en: 'The invoice could not be confirmed — it is still there.' },
  'bh.bev.bulk.resultGeenMeer': { nl: 'Geen van de {aantal} facturen kon worden bevestigd — ze staan er nog.', ar: 'تعذّر تأكيد أي من الفواتير الـ {aantal} — ما زالت في القائمة.', en: 'None of the {aantal} invoices could be confirmed — they are still there.' },
  'bh.bev.bulk.resultDeels': { nl: '{gelukt} bevestigd, {mislukt} niet — die staan er nog en kun je apart proberen.', ar: 'تم تأكيد {gelukt}، وتعذّر {mislukt} — ما زالت في القائمة ويمكنك تجربتها على حدة.', en: '{gelukt} confirmed, {mislukt} not — those are still there and you can try them separately.' },
  'bh.bev.vraag.kop': { nl: 'Vraag over deze factuur', ar: 'سؤال عن هذه الفاتورة', en: 'Question about this invoice' },
  'bh.bev.vraag.factuurnummer': { nl: 'factuur {nummer}', ar: 'فاتورة {nummer}', en: 'invoice {nummer}' },
  'bh.bev.vraag.gaatNaar': { nl: 'gaat naar {klant}', ar: 'تُرسل إلى {klant}', en: 'goes to {klant}' },
  'bh.bev.vraag.placeholder': { nl: 'Bijvoorbeeld: is dit zakelijk of privé? Of: klopt het btw-bedrag hier?', ar: 'مثلًا: هل هذا مصروف تجاري أم خاص؟ أو: هل مبلغ btw هنا صحيح؟', en: 'For example: is this business or private? Or: is the btw amount here correct?' },
  'bh.bev.vraag.melding': { nl: 'je klant krijgt een melding en kan hier antwoorden', ar: 'يصل عميلك إشعار ويمكنه الرد هنا', en: 'your client gets a notification and can answer here' },
  'bh.bev.vraag.versturen': { nl: 'Vraag versturen', ar: 'إرسال السؤال', en: 'Send question' },
  'bh.bev.vraag.mislukt': { nl: 'De vraag kon niet worden verstuurd.', ar: 'تعذّر إرسال السؤال.', en: 'The question could not be sent.' },
  'bh.bev.fout.bevestigen': { nl: 'Bevestigen mislukt.', ar: 'فشل التأكيد.', en: 'Confirmation failed.' },
  'bh.bev.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },

  // ─── [BOEKHOUDER] Boekhouder · openstaand + machtiging vragen (AccountantDebiteuren, VraagMachtiging) 
  'bh.deb.titel': { nl: 'Openstaande facturen', ar: 'الفواتير المستحقة', en: 'Outstanding invoices' },
  'bh.deb.ondertitel': { nl: 'Oudste schuld bovenaan — niet het grootste bedrag.', ar: 'الأقدم في الأعلى — وليس الأكبر مبلغًا.', en: 'Oldest debt at the top — not the largest amount.' },
  'bh.deb.dagen.vandaag': { nl: 'vandaag vervallen', ar: 'تستحق اليوم', en: 'due today' },
  'bh.deb.dagen.een': { nl: '1 dag te laat', ar: 'متأخرة يومًا واحدًا', en: '1 day overdue' },
  'bh.deb.dagen.dagen': { nl: '{dagen} dagen te laat', ar: 'متأخرة {dagen} يومًا', en: '{dagen} days overdue' },
  'bh.deb.dagen.maanden': { nl: '{maanden} maanden te laat', ar: 'متأخرة {maanden} أشهر', en: '{maanden} months overdue' },
  'bh.deb.geenMandaat.kop': { nl: 'Nog geen enkele klant heeft je gemachtigd om namens hem te herinneren.', ar: 'لم يمنحك أي عميل بعد تفويضًا بإرسال تذكيرات نيابةً عنه.', en: 'No client has authorised you to send reminders on their behalf yet.' },
  'bh.deb.geenMandaat.uitleg1': { nl: 'Meekijken in een administratie is iets anders dan mailen naar de klanten van je klant. Je klant zet het zelf aan bij', ar: 'الاطّلاع على دفاتر عميلك شيء، ومراسلة عملاء عميلك شيء آخر. يفعّل عميلك ذلك بنفسه من', en: 'Looking into an administration is not the same as e-mailing your client\'s customers. Your client turns it on themselves under' },
  'bh.deb.geenMandaat.uitleg2': { nl: ', met dezelfde machtiging waarmee je ook namens hem kunt factureren.', ar: '، بالتفويض نفسه الذي يتيح لك أيضًا إصدار الفواتير نيابةً عنه.', en: ', with the same mandate that also lets you invoice on their behalf.' },
  'bh.deb.leeg.allesBetaald': { nl: 'Niets te laat. Bij geen van je gemachtigde klanten staat een vervallen factuur open.', ar: 'لا شيء متأخر. لا توجد فاتورة متأخرة لدى أي من عملائك المفوِّضين.', en: 'Nothing overdue. None of the clients who authorised you has an overdue invoice open.' },
  'bh.deb.totaal.enkelEnkel': { nl: 'te laat · {facturen} factuur bij {klanten} klant', ar: 'متأخرة · {facturen} فاتورة لدى {klanten} عميل', en: 'overdue · {facturen} invoice at {klanten} client' },
  'bh.deb.totaal.enkelMeer': { nl: 'te laat · {facturen} factuur bij {klanten} klanten', ar: 'متأخرة · {facturen} فاتورة لدى {klanten} عملاء', en: 'overdue · {facturen} invoice at {klanten} clients' },
  'bh.deb.totaal.meerEnkel': { nl: 'te laat · {facturen} facturen bij {klanten} klant', ar: 'متأخرة · {facturen} فواتير لدى {klanten} عميل', en: 'overdue · {facturen} invoices at {klanten} client' },
  'bh.deb.totaal.meerMeer': { nl: 'te laat · {facturen} facturen bij {klanten} klanten', ar: 'متأخرة · {facturen} فواتير لدى {klanten} عملاء', en: 'overdue · {facturen} invoices at {klanten} clients' },
  'bh.deb.totaal.geenHerinnerbaar': { nl: 'Vandaag kun je er geen enkele herinneren — per factuur staat hieronder waarom.', ar: 'لا يمكنك إرسال تذكير لأي منها اليوم — السبب مذكور أسفل كل فاتورة.', en: 'You cannot remind any of them today — the reason is below each invoice.' },
  'bh.deb.totaal.herinnerbaarEen': { nl: '{aantal} kan vandaag een herinnering krijgen.', ar: 'يمكن إرسال تذكير اليوم لـ {aantal} منها.', en: '{aantal} can get a reminder today.' },
  'bh.deb.totaal.herinnerbaarMeer': { nl: '{aantal} kunnen vandaag een herinnering krijgen.', ar: 'يمكن إرسال تذكير اليوم لـ {aantal} منها.', en: '{aantal} can get a reminder today.' },
  'bh.deb.totaal.namensKlant': { nl: 'De mail gaat uit op naam van je klant, en hij krijgt van elke herinnering bericht.', ar: 'يُرسَل البريد باسم عميلك، ويصله إشعار بكل تذكير.', en: 'The e-mail goes out in your client\'s name, and they are notified of every reminder.' },
  'bh.deb.groep.oudste': { nl: 'oudste:', ar: 'الأقدم:', en: 'oldest:' },
  'bh.deb.rij.onbekendeAfnemer': { nl: 'Onbekende afnemer', ar: 'عميل غير معروف', en: 'Unknown customer' },
  'bh.deb.rij.herinneringEen': { nl: '{aantal} herinnering verstuurd', ar: 'أُرسل {aantal} تذكير', en: '{aantal} reminder sent' },
  'bh.deb.rij.herinneringMeer': { nl: '{aantal} herinneringen verstuurd', ar: 'أُرسلت {aantal} تذكيرات', en: '{aantal} reminders sent' },
  'bh.deb.knop.herinner': { nl: 'Herinner', ar: 'ذكِّر', en: 'Remind' },
  'bh.deb.knop.bezig': { nl: 'Bezig…', ar: 'جارٍ…', en: 'Working…' },
  'bh.deb.status.verstuurd': { nl: 'Herinnering verstuurd', ar: 'تم إرسال التذكير', en: 'Reminder sent' },
  'bh.deb.fout.herinneringMislukt': { nl: 'De herinnering kon niet worden verstuurd.', ar: 'تعذّر إرسال التذكير.', en: 'The reminder could not be sent.' },
  'bh.deb.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'bh.deb.voet': { nl: 'Na drie herinneringen stopt deze knop. Wat daarna komt — een aanmaning of incasso — heeft gevolgen die de ondernemer zelf moet willen (art. 6:96 BW), en is dus geen knop hier.', ar: 'يتوقف هذا الزر بعد ثلاثة تذكيرات. وما يليه — إنذار أو تحصيل — له تبعات يجب أن يريدها صاحب العمل بنفسه (المادة 6:96 من القانون المدني الهولندي)، ولذلك ليس زرًّا هنا.', en: 'After three reminders this button stops. What comes next — a formal demand or debt collection — has consequences the entrepreneur has to want themselves (art. 6:96 BW), so it is not a button here.' },
  'bh.macht.kop': { nl: 'Vraag het je klant', ar: 'اطلب ذلك من عميلك', en: 'Ask your client' },
  'bh.macht.uitleg': { nl: 'Hij krijgt een bericht met wat je vraagt, wat je daarmee wél en niet kunt, en een link naar de knop. Beslissen doet hij zelf.', ar: 'يصله إشعار بما تطلبه، وبما يتيحه لك وما لا يتيحه، ورابط إلى الزر. والقرار قراره وحده.', en: 'They get a message with what you are asking for, what it does and does not let you do, and a link to the button. They decide themselves.' },
  'bh.macht.kiesLabel': { nl: 'Klant om te vragen', ar: 'العميل المراد سؤاله', en: 'Client to ask' },
  'bh.macht.kiesPlaceholder': { nl: 'Kies een klant…', ar: 'اختر عميلًا…', en: 'Choose a client…' },
  'bh.macht.knop.vraag': { nl: 'Vraag toestemming', ar: 'اطلب الإذن', en: 'Ask for permission' },
  'bh.macht.knop.gevraagd': { nl: 'Gevraagd', ar: 'تم الطلب', en: 'Asked' },
  'bh.macht.knop.bezig': { nl: 'Bezig…', ar: 'جارٍ…', en: 'Working…' },
  'bh.macht.gevraagdMelding': { nl: 'Gevraagd. Zodra hij het aanzet, staat deze pagina vol.', ar: 'تم الطلب. وبمجرد أن يفعّله، ستمتلئ هذه الصفحة.', en: 'Asked. As soon as they turn it on, this page fills up.' },
  'bh.macht.fout.mislukt': { nl: 'Vragen mislukt.', ar: 'تعذّر إرسال الطلب.', en: 'The request failed.' },
  'bh.macht.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },
  'bh.macht.voet': { nl: 'Eén keer vragen is vragen. Wil je sneller antwoord, bel dan even — daar is geen knop voor, en dat is met opzet.', ar: 'الطلب مرة واحدة يكفي. وإن أردت ردًّا أسرع فاتصل به — لا يوجد زر لذلك، وهذا مقصود.', en: 'Asking once is asking. If you want a faster answer, give them a call — there is no button for that, and that is deliberate.' },

  // ─── [BOEKHOUDER] Boekhouder · stukken opvragen (AccountantOpvragen) ────────────────────────
  'bh.opvr.titel': { nl: 'Stukken opvragen', ar: 'طلب المستندات', en: 'Request documents' },
  'bh.opvr.intro': { nl: 'Eén bericht met precies wat er nog mist — in zijn inbox en in zijn mail.', ar: 'رسالة واحدة تحتوي بالضبط على ما ينقص — في صندوق الوارد لديه وفي بريده الإلكتروني.', en: 'One message with exactly what is still missing — in their inbox and in their e-mail.' },
  'bh.opvr.geenKlanten': { nl: 'Je hebt nog geen gekoppelde klanten. Nodig er een uit bij', ar: 'ليس لديك عملاء مرتبطون بعد. ادعُ عميلاً من', en: 'You have no linked clients yet. Invite one from' },
  'bh.opvr.klant': { nl: 'Klant', ar: 'العميل', en: 'Client' },
  'bh.opvr.kiesKlant': { nl: 'Kies een klant…', ar: 'اختر عميلاً…', en: 'Choose a client…' },
  'bh.opvr.kwartaal': { nl: 'Kwartaal', ar: 'الربع', en: 'Quarter' },
  'bh.opvr.mistIn': { nl: 'Wat BoekBrug mist in {kwartaal}', ar: 'ما تفتقده BoekBrug في {kwartaal}', en: 'What BoekBrug is missing in {kwartaal}' },
  'bh.opvr.laden': { nl: 'Bezig met lezen…', ar: 'جارٍ القراءة…', en: 'Reading…' },
  'bh.opvr.geenGaten': { nl: 'BoekBrug ziet geen gaten in dit kwartaal. Dat betekent niet dat het compleet is — een bon die nooit is geüpload is voor ons onzichtbaar. Je kunt hieronder alsnog zelf iets vragen.', ar: 'لا ترى BoekBrug أي نواقص في هذا الربع. هذا لا يعني أنه مكتمل — إيصال لم يُرفَع قط لا يمكننا رؤيته. ويمكنك مع ذلك أن تطلب شيئاً بنفسك أدناه.', en: 'BoekBrug sees no gaps in this quarter. That does not mean it is complete — a receipt that was never uploaded is invisible to us. You can still ask for something yourself below.' },
  'bh.opvr.vinkUitleg': { nl: 'Haal weg wat je al weet — een bon die onderweg is, of een gat dat jouw eigen werk is. Meer dan {max} punten in één bericht leest niemand.', ar: 'أزل ما تعرفه مسبقاً — إيصال في الطريق، أو نقص هو من عملك أنت. لا أحد يقرأ أكثر من {max} نقاط في رسالة واحدة.', en: 'Remove what you already know about — a receipt on its way, or a gap that is your own work. Nobody reads more than {max} points in one message.' },
  'bh.opvr.eigenZin': { nl: 'Je eigen zin erbij (optioneel)', ar: 'جملة من عندك (اختياري)', en: 'Your own sentence (optional)' },
  'bh.opvr.voorbeeldKop': { nl: 'Dit krijgt {naam} te zien', ar: 'هذا ما سيراه {naam}', en: 'This is what {naam} will see' },
  'bh.opvr.jeKlant': { nl: 'je klant', ar: 'عميلك', en: 'your client' },
  'bh.opvr.verstuurd': { nl: 'Verstuurd. Het staat in zijn inbox en is per mail gegaan.', ar: 'تم الإرسال. الرسالة في صندوق الوارد لديه وأُرسلت أيضاً بالبريد الإلكتروني.', en: 'Sent. It is in their inbox and has gone out by e-mail.' },
  'bh.opvr.bezig': { nl: 'Bezig met versturen…', ar: 'جارٍ الإرسال…', en: 'Sending…' },
  'bh.opvr.verstuurNaar': { nl: 'Verstuur naar {naam}', ar: 'أرسل إلى {naam}', en: 'Send to {naam}' },
  'bh.opvr.voet': { nl: 'Het bericht staat op jouw naam en komt in dezelfde inbox als je gewone berichten. Hij kan er direct op antwoorden.', ar: 'تُرسَل الرسالة باسمك وتصل إلى صندوق الوارد نفسه الذي تصل إليه رسائلك العادية. ويمكنه الرد عليها مباشرة.', en: 'The message goes out in your name and lands in the same inbox as your ordinary messages. They can reply to it directly.' },
  'bh.opvr.fout.lezen': { nl: 'Kon het kwartaal niet lezen.', ar: 'تعذّرت قراءة بيانات الربع.', en: 'Could not read the quarter.' },
  'bh.opvr.fout.versturen': { nl: 'Versturen mislukt.', ar: 'فشل الإرسال.', en: 'Sending failed.' },
  'bh.opvr.fout.algemeen': { nl: 'Er ging iets mis.', ar: 'حدث خطأ ما.', en: 'Something went wrong.' },

  // ─── [BOEKHOUDER] Boekhouder · klanten beheren (KlantenBeheer) ──────────────────────────────
  'bh.klant.invite.title': { nl: 'Klant uitnodigen', ar: 'دعوة عميل', en: 'Invite client' },
  'bh.klant.invite.intro': { nl: 'Vul het e-mailadres van je klant in. Ze ontvangen een uitnodiging om BoekBrug te gebruiken.', ar: 'أدخل عنوان البريد الإلكتروني لعميلك. سيتلقّى دعوة لاستخدام BoekBrug.', en: 'Enter your client\'s e-mail address. They will receive an invitation to use BoekBrug.' },
  'bh.klant.invite.sending': { nl: 'Versturen...', ar: 'جارٍ الإرسال...', en: 'Sending...' },
  'bh.klant.invite.send': { nl: 'Nodig uit', ar: 'أرسل دعوة', en: 'Invite' },
  'bh.klant.invite.sent': { nl: '✓ Uitnodiging verstuurd.', ar: '✓ تم إرسال الدعوة.', en: '✓ Invitation sent.' },
  'bh.klant.invite.failed': { nl: 'Versturen mislukt.', ar: 'فشل الإرسال.', en: 'Sending failed.' },
  'bh.klant.error.network': { nl: 'Netwerkfout. Probeer het opnieuw.', ar: 'خطأ في الشبكة. حاول مرة أخرى.', en: 'Network error. Please try again.' },
  'bh.klant.error.networkShort': { nl: 'Netwerkfout.', ar: 'خطأ في الشبكة.', en: 'Network error.' },
  'bh.klant.bulk.toggle': { nl: 'Meerdere klanten tegelijk uitnodigen', ar: 'دعوة عدة عملاء دفعة واحدة', en: 'Invite several clients at once' },
  'bh.klant.bulk.intro': { nl: 'Plak een lijst e-mailadressen (één per regel, of gescheiden door komma\'s). Elk adres krijgt dezelfde uitnodiging als hierboven; per adres zie je of het lukte.', ar: 'الصق قائمة عناوين بريد إلكتروني (عنوان في كل سطر، أو مفصولة بفواصل). كل عنوان يتلقّى نفس الدعوة أعلاه؛ وسترى لكل عنوان ما إذا نجح الإرسال.', en: 'Paste a list of e-mail addresses (one per line, or separated by commas). Each address gets the same invitation as above; per address you see whether it worked.' },
  'bh.klant.bulk.sending': { nl: 'Versturen... ({count})', ar: 'جارٍ الإرسال... ({count})', en: 'Sending... ({count})' },
  'bh.klant.bulk.send': { nl: 'Verstuur alle uitnodigingen', ar: 'إرسال جميع الدعوات', en: 'Send all invitations' },
  'bh.klant.bulk.overflow': { nl: 'Je plakte meer dan 200 adressen: de eerste 200 zijn verstuurd, de laatste {count} niet. Plak die morgen opnieuw — de daglimiet is 200 uitnodigingen.', ar: 'لصقت أكثر من 200 عنوان: تم إرسال أول 200، أما آخر {count} فلم تُرسل. الصقها غدًا من جديد — الحد اليومي هو 200 دعوة.', en: 'You pasted more than 200 addresses: the first 200 were sent, the last {count} were not. Paste those again tomorrow — the daily limit is 200 invitations.' },
  'bh.klant.bulk.sentCount': { nl: '{count} verstuurd', ar: '{count} مُرسَلة', en: '{count} sent' },
  'bh.klant.bulk.failedCount': { nl: '{count} niet verstuurd', ar: '{count} لم تُرسَل', en: '{count} not sent' },
  'bh.klant.bulk.busy': { nl: 'bezig…', ar: 'جارٍ العمل…', en: 'working…' },
  'bh.klant.list.title': { nl: 'Gekoppelde klanten', ar: 'العملاء المرتبطون', en: 'Linked clients' },
  'bh.klant.search.placeholder': { nl: 'Zoek klant op naam of e-mail…', ar: 'ابحث عن عميل بالاسم أو البريد الإلكتروني…', en: 'Search a client by name or e-mail…' },
  'bh.klant.search.aria': { nl: 'Klanten zoeken', ar: 'البحث عن العملاء', en: 'Search clients' },
  'bh.klant.search.clear': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'bh.klant.unreadable.line1': { nl: 'We konden je klantenlijst nu niet ophalen.', ar: 'تعذّر علينا جلب قائمة عملائك الآن.', en: 'We could not fetch your client list right now.' },
  'bh.klant.unreadable.line2': { nl: 'Dit zegt niets over je koppelingen — alleen dat wij ze even niet konden lezen.', ar: 'هذا لا يقول شيئًا عن ارتباطاتك — بل فقط أننا لم نتمكّن من قراءتها الآن.', en: 'This says nothing about your links — only that we could not read them just now.' },
  'bh.klant.list.empty': { nl: 'Nog geen klanten gekoppeld', ar: 'لا يوجد عملاء مرتبطون بعد', en: 'No clients linked yet' },
  'bh.klant.list.noMatch': { nl: 'Geen klanten gevonden voor “{query}”', ar: 'لم يُعثر على عملاء لـ “{query}”', en: 'No clients found for “{query}”' },
  'bh.klant.readiness.none': { nl: 'Geen facturen dit kwartaal', ar: 'لا فواتير هذا الربع', en: 'No invoices this quarter' },
  'bh.klant.readiness.processed': { nl: '{done}/{total} verwerkt · Bank {bank}', ar: '{done}/{total} مُعالَجة · البنك {bank}', en: '{done}/{total} processed · Bank {bank}' },
  'bh.klant.openQuestions': { nl: '{count} vraag', ar: '{count} سؤال', en: '{count} question' },
  'bh.klant.unlink.action': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Unlink' },
  'bh.klant.unlink.title': { nl: 'Klant ontkoppelen', ar: 'إلغاء ربط العميل', en: 'Unlink client' },
  'bh.klant.unlink.confirm': { nl: 'Weet je zeker dat je {name} wilt ontkoppelen? Je verliest toegang tot hun gegevens.', ar: 'هل أنت متأكد أنك تريد إلغاء الربط مع {name}؟ ستفقد الوصول إلى بياناتهم.', en: 'Are you sure you want to unlink {name}? You will lose access to their data.' },
  'bh.klant.unlink.busy': { nl: 'Verwijderen...', ar: 'جارٍ الحذف...', en: 'Removing...' },
  'bh.klant.unlink.failed': { nl: 'Verwijderen mislukt.', ar: 'فشل الحذف.', en: 'Removing failed.' },
  'bh.klant.cancel': { nl: 'Annuleren', ar: 'إلغاء', en: 'Cancel' },

  // ─── [BOEKHOUDER] Boekhouder · het kwartaal en de gegevens van een klant ────────────────────
  'bh.kwt.actie.verwerkt': { nl: 'Verwerkt', ar: 'مُعالَجة', en: 'Processed' },
  'bh.kwt.actie.inBehandeling': { nl: 'In behandeling', ar: 'قيد المعالجة', en: 'In progress' },
  'bh.kwt.actie.vraag': { nl: 'Vraag', ar: 'سؤال', en: 'Question' },
  'bh.kwt.sectie.debiteuren': { nl: 'Debiteuren', ar: 'الذمم المدينة', en: 'Receivables' },
  'bh.kwt.sectie.debiteurenSub': { nl: 'verzonden — nog te ontvangen', ar: 'مُرسَلة — لم تُحصَّل بعد', en: 'sent — not yet received' },
  'bh.kwt.sectie.crediteuren': { nl: 'Crediteuren', ar: 'الذمم الدائنة', en: 'Payables' },
  'bh.kwt.sectie.crediteurenSub': { nl: 'ontvangen — nog te betalen', ar: 'واردة — لم تُدفع بعد', en: 'received — not yet paid' },
  'bh.kwt.sectie.voldaan': { nl: 'Voldaan', ar: 'مسدَّدة', en: 'Settled' },
  'bh.kwt.sectie.voldaanSub': { nl: 'betaald', ar: 'مدفوعة', en: 'paid' },
  'bh.kwt.kop': { nl: 'Q{q} {jaar}', ar: 'الربع {q} {jaar}', en: 'Q{q} {jaar}' },
  'bh.kwt.kop.metKlant': { nl: 'Q{q} {jaar} — {klant}', ar: 'الربع {q} {jaar} — {klant}', en: 'Q{q} {jaar} — {klant}' },
  'bh.kwt.sorteerOudste': { nl: 'Oudste ↑', ar: 'الأقدم ↑', en: 'Oldest ↑' },
  'bh.kwt.sorteerNieuwste': { nl: 'Nieuwste ↓', ar: 'الأحدث ↓', en: 'Newest ↓' },
  'bh.kwt.laden': { nl: 'Laden...', ar: 'جارٍ التحميل...', en: 'Loading...' },
  'bh.kwt.documenten': { nl: 'Documenten — bekijk in Brug', ar: 'المستندات — اعرضها في الجسر', en: 'Documents — view in Bridge' },
  'bh.kwt.pakketBezig': { nl: 'Kwartaalpakket genereren…', ar: 'جارٍ إنشاء حزمة الربع…', en: 'Generating quarter package…' },
  'bh.kwt.pakketDownload': { nl: 'Download kwartaalpakket (ZIP)', ar: 'تنزيل حزمة الربع (ZIP)', en: 'Download quarter package (ZIP)' },
  'bh.kwt.pakketMislukt': { nl: 'Pakket genereren mislukt — probeer opnieuw.', ar: 'تعذّر إنشاء الحزمة — حاول مرة أخرى.', en: 'Could not generate the package — please try again.' },
  'bh.kwt.omzet': { nl: 'Omzet (excl. BTW)', ar: 'الإيراد (بدون ضريبة)', en: 'Turnover (excl. VAT)' },
  'bh.kwt.kosten': { nl: 'Kosten (excl. BTW)', ar: 'التكاليف (بدون ضريبة)', en: 'Costs (excl. VAT)' },
  'bh.kwt.btwSaldo': { nl: 'BTW te betalen (5g)', ar: 'ضريبة مستحقة (5g)', en: 'VAT to pay (5g)' },
  'bh.kwt.facturen': { nl: 'Facturen', ar: 'الفواتير', en: 'Invoices' },
  'bh.kwt.zoekPlaceholder': { nl: 'Zoek op factuurnummer, klant of bedrag…', ar: 'ابحث برقم الفاتورة أو العميل أو المبلغ…', en: 'Search by invoice number, client or amount…' },
  'bh.kwt.zoekAria': { nl: 'Facturen zoeken', ar: 'البحث في الفواتير', en: 'Search invoices' },
  'bh.kwt.wissen': { nl: 'Wissen', ar: 'مسح', en: 'Clear' },
  'bh.kwt.leesfout': { nl: 'We konden de facturen van dit kwartaal nu niet ophalen — dit zegt niets over de administratie zelf.', ar: 'تعذّر علينا جلب فواتير هذا الربع الآن — وهذا لا يقول شيئًا عن الدفاتر نفسها.', en: 'We could not load the invoices for this quarter right now — this says nothing about the books themselves.' },
  'bh.kwt.opnieuw': { nl: 'Opnieuw proberen', ar: 'إعادة المحاولة', en: 'Try again' },
  'bh.kwt.geenFacturen': { nl: 'Geen facturen in Q{q} {jaar}', ar: 'لا فواتير في الربع {q} {jaar}', en: 'No invoices in Q{q} {jaar}' },
  'bh.kwt.geenGevonden': { nl: 'Geen facturen gevonden voor “{zoek}”', ar: 'لا توجد فواتير مطابقة لـ«{zoek}»', en: 'No invoices found for “{zoek}”' },
  'bh.kwt.uitgaand': { nl: 'Uitg.', ar: 'صادرة', en: 'Out' },
  'bh.kwt.inkomend': { nl: 'Ink.', ar: 'واردة', en: 'In' },
  'bh.kwt.verlopen': { nl: 'Verlopen', ar: 'متأخرة', en: 'Overdue' },
  'bh.kwt.creditnota': { nl: 'Creditnota', ar: 'إشعار دائن', en: 'Credit note' },
  'bh.kwt.betaaldOp': { nl: 'betaald {datum}', ar: 'دُفعت في {datum}', en: 'paid {datum}' },
  'bh.kwt.statusLabel': { nl: 'Status', ar: 'الحالة', en: 'Status' },
  'bh.kwt.statusNietOpgeslagen': { nl: 'Status niet opgeslagen — probeer het opnieuw.', ar: 'لم يتم حفظ الحالة — حاول مرة أخرى.', en: 'Status not saved — please try again.' },
  'bh.kwt.nietVerwerkt': { nl: 'Niet verwerkt', ar: 'غير مُعالَجة', en: 'Not processed' },
  'bh.kwt.aan': { nl: 'Aan', ar: 'إلى', en: 'To' },
  'bh.kwt.vervangt': { nl: 'Vervangt', ar: 'يحلّ محلّ', en: 'Replaces' },
  'bh.kwt.exclBtw': { nl: 'Excl. BTW', ar: 'بدون ضريبة', en: 'Excl. VAT' },
  'bh.kwt.btwTarief': { nl: 'BTW {tarief}%', ar: 'ضريبة {tarief}%', en: 'VAT {tarief}%' },
  'bh.kwt.inclBtw': { nl: 'Incl. BTW', ar: 'شامل الضريبة', en: 'Incl. VAT' },
  'bh.kwt.openen': { nl: 'Openen', ar: 'فتح', en: 'Open' },
  'bh.kwt.vraag.titel': { nl: 'Vraag aan de klant', ar: 'سؤال إلى العميل', en: 'Question for the client' },
  'bh.kwt.vraag.uitleg': { nl: 'Je klant krijgt dit te zien bij factuur {nummer}{partij}. Laat je het leeg, dan melden we alleen dát je een vraag hebt.', ar: 'سيرى عميلك هذا عند الفاتورة {nummer}{partij}. إن تركته فارغًا، فسنُعلمه فقط بأن لديك سؤالًا.', en: 'Your client sees this with invoice {nummer}{partij}. Leave it empty and we only tell them you have a question.' },
  'bh.kwt.vraag.uitlegZonderNummer': { nl: 'Je klant krijgt dit te zien bij een factuur{partij}. Laat je het leeg, dan melden we alleen dát je een vraag hebt.', ar: 'سيرى عميلك هذا عند إحدى الفواتير{partij}. إن تركته فارغًا، فسنُعلمه فقط بأن لديك سؤالًا.', en: 'Your client sees this with one of their invoices{partij}. Leave it empty and we only tell them you have a question.' },
  'bh.kwt.vraag.placeholder': { nl: 'Waar gaat deze factuur over?', ar: 'عمّ تدور هذه الفاتورة؟', en: 'What is this invoice about?' },
  'bh.kwt.vraag.versturen': { nl: 'Vraag versturen', ar: 'إرسال السؤال', en: 'Send question' },
  'bh.det.laden': { nl: 'Laden...', ar: 'جارٍ التحميل...', en: 'Loading...' },
  'bh.det.ontkoppelTitel': { nl: 'Klant ontkoppelen?', ar: 'إلغاء ربط العميل؟', en: 'Unlink client?' },
  'bh.det.ontkoppelUitleg': { nl: 'Je verliest daarmee de toegang tot de administratie van {naam}. De klant houdt alles zelf; jullie kunnen later opnieuw koppelen.', ar: 'ستفقد بذلك الوصول إلى دفاتر {naam}. يحتفظ العميل بكل شيء بنفسه، ويمكنكما الربط من جديد لاحقًا.', en: 'You lose your access to the books of {naam}. The client keeps everything; you can link again later.' },
  'bh.det.ontkoppelUitlegAnoniem': { nl: 'Je verliest daarmee de toegang tot de administratie van deze klant. De klant houdt alles zelf; jullie kunnen later opnieuw koppelen.', ar: 'ستفقد بذلك الوصول إلى دفاتر هذا العميل. يحتفظ العميل بكل شيء بنفسه، ويمكنكما الربط من جديد لاحقًا.', en: 'You lose your access to the books of this client. The client keeps everything; you can link again later.' },
  'bh.det.ontkoppelen': { nl: 'Ontkoppelen', ar: 'إلغاء الربط', en: 'Unlink' },
  'bh.det.ontkoppelMislukt': { nl: 'Ontkoppelen mislukt', ar: 'تعذّر إلغاء الربط', en: 'Unlinking failed' },
  'bh.det.klantgegevens': { nl: 'Klantgegevens', ar: 'بيانات العميل', en: 'Client details' },
  'bh.det.naam': { nl: 'Naam', ar: 'الاسم', en: 'Name' },
  'bh.det.email': { nl: 'E-mail', ar: 'البريد الإلكتروني', en: 'E-mail' },
  'bh.det.stuurEmail': { nl: 'Stuur e-mail', ar: 'إرسال بريد إلكتروني', en: 'Send e-mail' },
  'bh.det.stuurBericht': { nl: 'Stuur bericht', ar: 'إرسال رسالة', en: 'Send message' },
  'bh.det.werkplek': { nl: 'Working Place', ar: 'مساحة العمل', en: 'Working Place' },
  'bh.det.kiesKwartaal': { nl: 'Selecteer een kwartaal', ar: 'اختر ربعًا', en: 'Select a quarter' },
  'bh.det.huidig': { nl: 'huidig', ar: 'الحالي', en: 'current' },
  'bh.det.factuurOpstellen': { nl: 'Factuur opstellen voor deze klant', ar: 'إنشاء فاتورة لهذا العميل', en: 'Create an invoice for this client' },

} satisfies Record<string, Message>

export type MessageKey = keyof typeof MESSAGES
