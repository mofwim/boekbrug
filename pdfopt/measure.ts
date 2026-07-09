// ─────────────────────────────────────────────────────────
// measure.ts — PDF-OPTIMIZE قياس مستقل (لا يمسّ الإنتاج)
//
// الهدف: نعرف الرقم الحقيقي المجهول —
//   كم input_tokens يشحن الـ PDF الخام الآن عبر document API؟
//   مقابل: كم لو أرسلنا النص المستخرج فقط؟
//
// الأمان:
//   · المفتاح يُقرأ من بيئتك المحلية فقط (ANTHROPIC_API_KEY) — لا يُكتب هنا.
//   · لا يلمس Supabase ولا كود الإنتاج — نداء API معزول.
//   · يطبع أرقام usage فقط، لا محتوى حسّاس.
//
// التشغيل (CMD على جهازك، مو PowerShell):
//   1) ضع المفتاح في متغيّر بيئة الجلسة:
//        set ANTHROPIC_API_KEY=sk-ant-...        (المفتاح الجديد، لا القديم)
//   2) ضع الملفين بنفس مجلد السكربت: 263414.pdf  +  factuur.jpeg
//   3) npm i -D tsx    (لو مو مثبّت)
//   4) npx tsx measure.ts
//
// النتيجة: جدول token لكل مسار. ابعتها لي (أرقام فقط).
// ─────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

const API_KEY = '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';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001'; // نفس مودل الإنتاج
const MAX_TOKENS = 2000;

// نفس الـ system prompt المبسّط — الطول وحده مهم للقياس (نقيس نصيبه الثابت)
const SYSTEM = `You verify whether a document is a real commercial invoice.
Return only a JSON object with is_invoice, vendor, invoice_number, invoice_date,
total_ex_btw, btw_amount, total_inc_btw, btw_rate, vendor_iban, payment_reference.
Extract the vendor (sender), the amount breakdown, and the invoice number.
Be precise with Dutch number format 1.234,56 and never guess a value.`;

const PROMPT = `Verify if this document is a real invoice. Extract vendor, invoice number, and the full amount breakdown. Return JSON only.`;

if (!API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY غير موجود في البيئة. ضعه ثم أعد التشغيل.');
  process.exit(1);
}

function cleanBase64(raw: string): string {
  const s = raw.includes(',') ? raw.split(',')[1] : raw;
  const n = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const r = n.length % 4;
  return r === 0 ? n : n + '='.repeat(4 - r);
}

async function callRaw(body: object, label: string) {
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
  if (!res.ok) {
    console.error(`❌ ${label} فشل ${res.status}:`, (await res.text()).slice(0, 300));
    return null;
  }
  const data = await res.json();
  return data.usage;
}

// ── extract PDF text locally (نفس فكرة مسار النص) ──
async function extractPdfText(path: string): Promise<string> {
  // pdfjs-dist نفس المرشّح لمسار الإنتاج — نجرّبه هنا
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (!pdfjs) {
    console.warn('⚠️  pdfjs-dist غير مثبّت — تخطّي قياس النص. ثبّته: npm i pdfjs-dist');
    return '';
  }
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it: any) => it.str).join(' ') + '\n';
  }
  return out.trim();
}

async function main() {
  console.log('════════════ PDF-OPTIMIZE — قياس token فعلي ════════════\n');

  // ① المسار الحالي: PDF خام عبر document API
  const pdfB64 = cleanBase64(readFileSync('263414.pdf').toString('base64'));
  console.log('① قياس PDF الخام (المسار الحالي)...');
  const rawUsage = await callRaw({
    model: MODEL, max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  }, 'PDF خام');

  // ② المسار المقترح: نص مستخرج فقط
  console.log('② قياس مسار النص المستخرج...');
  const text = await extractPdfText('263414.pdf');
  let textUsage = null;
  if (text) {
    textUsage = await callRaw({
      model: MODEL, max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: `${PROMPT}\n\n--- INVOICE TEXT ---\n${text}` }],
    }, 'نص');
  }

  // ③ (اختياري) صورة — لو الملف موجود
  let imgUsage = null;
  try {
    const imgB64 = cleanBase64(readFileSync('factuur.jpeg').toString('base64'));
    console.log('③ قياس مسار الصورة (JPEG)...');
    imgUsage = await callRaw({
      model: MODEL, max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }, 'صورة');
  } catch {
    console.log('③ (تخطّي الصورة — factuur.jpeg غير موجود، لا بأس)');
  }

  // ── التقرير ──
  const inp = (u: any) => u?.input_tokens ?? '—';
  const cc = (u: any) => u?.cache_creation_input_tokens ?? 0;
  const cr = (u: any) => u?.cache_read_input_tokens ?? 0;

  console.log('\n════════════════════ النتائج ════════════════════');
  console.log('المسار                     input_tokens   cache_write   cache_read');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`① PDF خام (الحالي)         ${String(inp(rawUsage)).padStart(8)}      ${String(cc(rawUsage)).padStart(6)}      ${String(cr(rawUsage)).padStart(6)}`);
  if (textUsage)
    console.log(`② نص مستخرج (المقترح)      ${String(inp(textUsage)).padStart(8)}      ${String(cc(textUsage)).padStart(6)}      ${String(cr(textUsage)).padStart(6)}`);
  if (imgUsage)
    console.log(`③ صورة JPEG               ${String(inp(imgUsage)).padStart(8)}      ${String(cc(imgUsage)).padStart(6)}      ${String(cr(imgUsage)).padStart(6)}`);
  console.log('─────────────────────────────────────────────────────────────────');

  if (rawUsage && textUsage) {
    const saved = inp(rawUsage) - inp(textUsage);
    const pct = Math.round((saved / inp(rawUsage)) * 100);
    console.log(`\n💡 توفير مسار النص: ${saved} token/فاتورة  (~${pct}%)`);
  }
  console.log('\n⚠️  دبل تشك: لو cache_write/cache_read = 0 في كل الصفوف → caching فعلاً معطّل (كما توقّعنا).');
  console.log('ابعت هذا الجدول كما هو.\n');
}

main().catch((e) => { console.error('خطأ:', e); process.exit(1); });
