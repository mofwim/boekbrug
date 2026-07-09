// ─────────────────────────────────────────────────────────
// verify_safecore.ts — PDF-OPTIMIZE دبل تشك SAFECORE
//
// السؤال الحاسم: هل مسار النص يعطي نفس الأرقام بالضبط مثل PDF الخام؟
// وهل مصيدة "Nieuwe schuld: 12905.02" تختطف التوتال (928,87)؟
//
// يطبع مخرجات Claude الفعلية لكلا المسارين + مقارنة آلية بالقيم الحقيقية.
// الأمان: المفتاح من البيئة فقط، لا يمسّ الإنتاج، نداء API معزول.
//
// التشغيل (CMD، نفس النافذة):
//   set ANTHROPIC_API_KEY=sk-ant-...الجديد
//   npx tsx verify_safecore.ts
// ─────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

const API_KEY = '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';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2000;

// ── القيم الحقيقية من فاتورة 263414 (من الصورة) — مرجع SAFECORE ──
const TRUTH = {
  vendor: 'BALKIP',
  invoice_number: '263414',
  total_ex_btw: 852.17,
  btw_amount: 76.70,
  total_inc_btw: 928.87,   // ← التوتال الصحيح
  btw_rate: 9,
  vendor_iban: 'NL48INGB0000810658',
  TRAP: 12905.02,          // ← الدين المتراكم — يجب ألا يظهر كأي مبلغ
};

// نفس system prompt الإنتاج (مختصر — القواعد الحرجة للأرقام)
const SYSTEM = `You verify whether a document is a real commercial invoice.
Return ONLY a JSON object with these keys:
{"is_invoice":bool,"vendor":str|null,"invoice_number":str|null,
"total_ex_btw":num|null,"btw_amount":num|null,"total_inc_btw":num|null,
"btw_rate":0|9|21|null,"vendor_iban":str|null}
Rules:
- Dutch number format 1.234,56 → parse as 1234.56 (dot=thousands, comma=decimal).
- total_inc_btw = the final "TOTAAL Incl.BTW" to pay. It is NOT any running
  balance like "Nieuwe schuld" (that is an accumulated debt, ignore it).
- vendor = the SENDER (BALKIP), never the receiver (KIWI FOOD MARKET).
- Never guess. If a value is absent, null.
Return JSON only, no markdown.`;

const PROMPT = `Verify if this is a real invoice and extract the amount breakdown. Return JSON only.`;

if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY غير موجود.'); process.exit(1); }

function cleanBase64(raw: string): string {
  const s = raw.includes(',') ? raw.split(',')[1] : raw;
  const n = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const r = n.length % 4;
  return r === 0 ? n : n + '='.repeat(4 - r);
}

function safeParse(text: string): any {
  const s = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

async function call(body: object): Promise<any> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error('❌', res.status, (await res.text()).slice(0, 200)); return null; }
  const data = await res.json();
  const txt = data.content?.find((c: any) => c.type === 'text')?.text ?? '';
  return { parsed: safeParse(txt), raw: txt };
}

async function extractText(path: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    out += c.items.map((it: any) => it.str).join(' ') + '\n';
  }
  return out.trim();
}

// مقارنة قيمة رقمية مع تسامح صغير
function numMatch(got: any, want: number): boolean {
  return typeof got === 'number' && Math.abs(got - want) < 0.01;
}

function report(label: string, r: any) {
  console.log(`\n─────────── ${label} ───────────`);
  if (!r?.parsed) { console.log('❌ فشل التحليل. الخام:', r?.raw?.slice(0, 200)); return; }
  const p = r.parsed;
  const checks: [string, boolean][] = [
    ['is_invoice = true', p.is_invoice === true],
    [`vendor يحوي BALKIP (${p.vendor})`, String(p.vendor || '').toUpperCase().includes('BALKIP')],
    [`invoice_number = 263414 (${p.invoice_number})`, String(p.invoice_number) === '263414'],
    [`total_ex_btw = 852.17 (${p.total_ex_btw})`, numMatch(p.total_ex_btw, TRUTH.total_ex_btw)],
    [`btw_amount = 76.70 (${p.btw_amount})`, numMatch(p.btw_amount, TRUTH.btw_amount)],
    [`total_inc_btw = 928.87 (${p.total_inc_btw})`, numMatch(p.total_inc_btw, TRUTH.total_inc_btw)],
    [`btw_rate = 9 (${p.btw_rate})`, p.btw_rate === 9],
    [`vendor_iban صحيح (${p.vendor_iban})`, String(p.vendor_iban || '').replace(/\s/g, '') === TRUTH.vendor_iban],
  ];
  for (const [name, ok] of checks) console.log(`  ${ok ? '✓' : '✗ فشل'}  ${name}`);

  // فحص المصيدة: هل 12905.02 ظهر في أي حقل رقمي؟
  const trapHit = [p.total_ex_btw, p.btw_amount, p.total_inc_btw].some((v) => numMatch(v, TRUTH.TRAP));
  console.log(`  ${trapHit ? '🚨 خطر! المصيدة 12905.02 اختطفت حقل مبلغ' : '✓ المصيدة 12905.02 لم تُختطف'}`);
}

async function main() {
  console.log('═══════ PDF-OPTIMIZE — دبل تشك SAFECORE (مخرجات Claude الفعلية) ═══════');

  const pdfB64 = cleanBase64(readFileSync('263414.pdf').toString('base64'));
  console.log('\n① نداء PDF الخام...');
  const raw = await call({
    model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
      { type: 'text', text: PROMPT },
    ]}],
  });

  console.log('② استخراج النص + نداء النص...');
  const text = await extractText('263414.pdf');
  const txt = await call({
    model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM,
    messages: [{ role: 'user', content: `${PROMPT}\n\n--- FACTUUR TEKST ---\n${text}` }],
  });

  report('① PDF خام (المرجع الحالي)', raw);
  report('② نص مستخرج (المقترح)', txt);

  // المقارنة الحاسمة: هل المساران متطابقان؟
  console.log('\n═══════════ الحكم النهائي ═══════════');
  if (raw?.parsed && txt?.parsed) {
    const fields = ['total_ex_btw', 'btw_amount', 'total_inc_btw', 'btw_rate', 'invoice_number'];
    const identical = fields.every((f) => {
      const a = raw.parsed[f], b = txt.parsed[f];
      return typeof a === 'number' ? numMatch(a, b) : String(a) === String(b);
    });
    console.log(identical
      ? '✅ المساران يعطيان نفس الأرقام بالضبط → مسار النص آمن للبناء.'
      : '⚠️  المساران اختلفا! راجع الجدول أعلاه — قد نحتاج نص+صورة للنصية.');
  } else {
    console.log('⚠️  أحد المسارين فشل — راجع أعلاه.');
  }
  console.log('\nابعت كل المخرجات كما هي.\n');
}

main().catch((e) => { console.error('خطأ:', e); process.exit(1); });
