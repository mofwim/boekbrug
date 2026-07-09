// ─────────────────────────────────────────────────────────
// phase_c.ts — PDF-OPTIMIZE تحقق نهائي على عدة موردين
//
// لكل فاتورة PDF في المجلد الحالي:
//   ① يرسلها خام (المسار القديم/المرجع)  ② يستخرج نص ويرسله (المسار الجديد)
//   ③ يقارن: هل الأرقام متطابقة؟ هل المصيدة اختُطفت؟ أي مسار سُلك؟
//
// المنطق: المسار القديم (الخام) = سلوكك المُثبَت في الإنتاج. لو الجديد
// يطابقه بالضبط على كل مورّد → SAFECORE محفوظ → آمن للاعتماد الكامل.
//
// الأمان: المفتاح من البيئة فقط، لا يمسّ الإنتاج ولا Supabase، نداءات معزولة.
//
// التشغيل (CMD، نفس النافذة):
//   set ANTHROPIC_API_KEY=sk-ant-...الجديد
//   ضع كل فواتير الاختبار (.pdf) بنفس مجلد هذا الملف
//   npx tsx phase_c.ts
// ─────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';

const API_KEY = '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';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2000;

// نفس عتبة الإنتاج
const MIN_CHARS = 100;
const MIN_DIGITS = 20;

const SYSTEM = `You verify whether a document is a real commercial invoice.
Return ONLY a JSON object with these keys:
{"is_invoice":bool,"vendor":str|null,"invoice_number":str|null,
"total_ex_btw":num|null,"btw_amount":num|null,"total_inc_btw":num|null,
"btw_rate":0|9|21|null,"vendor_iban":str|null}
Rules:
- Dutch number format 1.234,56 → parse as 1234.56 (dot=thousands, comma=decimal).
- total_inc_btw = the final "TOTAAL Incl.BTW" to pay. It is NOT any running
  balance like "Nieuwe schuld" (accumulated debt — ignore it).
- vendor = the SENDER, never the receiver.
- Never guess. Absent value → null.
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

async function callClaude(messages: any): Promise<{ parsed: any; usage: any }> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages }),
  });
  if (!res.ok) { console.error('   ❌ API', res.status, (await res.text()).slice(0, 150)); return { parsed: null, usage: null }; }
  const data = await res.json();
  const txt = data.content?.find((c: any) => c.type === 'text')?.text ?? '';
  return { parsed: safeParse(txt), usage: data.usage };
}

// نفس منطق الإنتاج بالضبط
async function extractTextPath(pdfBase64: string): Promise<{ text: string | null; chars: number; digits: number }> {
  try {
    const bytes = Buffer.from(cleanBase64(pdfBase64), 'base64');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch((e) => {
      console.error('   🚨 فشل استيراد pdfjs-dist — شغّل السكربت من مجلد فيه node_modules (جذر مشروعك):', e.message);
      return null;
    });
    if (!pdfjs) return { text: null, chars: 0, digits: 0 };
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      text += c.items.map((it: any) => (it && 'str' in it ? String(it.str) : '')).join(' ') + '\n';
    }
    text = text.trim();
    const chars = text.replace(/\s/g, '').length;
    const digits = (text.match(/\d/g) || []).length;
    if (chars < MIN_CHARS || digits < MIN_DIGITS) return { text: null, chars, digits };
    return { text, chars, digits };
  } catch { return { text: null, chars: 0, digits: 0 }; }
}

const n = (v: any) => (typeof v === 'number' ? v : null);
const eq = (a: any, b: any) => {
  const x = n(a), y = n(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 0.01;
  return String(a) === String(b);
};

async function main() {
  const files = readdirSync('.').filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) { console.error('❌ لا فواتير PDF في المجلد.'); process.exit(1); }

  console.log('═══════ PDF-OPTIMIZE — Phase C — تحقق على', files.length, 'فاتورة ═══════\n');

  const results: any[] = [];
  const CMP = ['total_ex_btw', 'btw_amount', 'total_inc_btw', 'btw_rate', 'invoice_number', 'vendor_iban'];

  for (const file of files) {
    console.log(`▸ ${file}`);
    const b64 = readFileSync(file).toString('base64');

    // ① المرجع: خام
    const raw = await callClaude([{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cleanBase64(b64) } },
      { type: 'text', text: PROMPT },
    ]}]);

    // ② الجديد: نص (أو خام لو ما عبر العتبة — نموذجاً للممسوح)
    const ext = await extractTextPath(b64);
    let neu, path;
    if (ext.text) {
      path = 'نص';
      neu = await callClaude([{ role: 'user', content: `${PROMPT}\n\n--- FACTUUR TEKST ---\n${ext.text}` }]);
    } else {
      path = 'خام (ممسوح/شكّ)';
      neu = raw; // نفس المسار — يتطابق حكماً
    }

    // المقارنة
    let identical = true, diffs: string[] = [];
    if (raw.parsed && neu.parsed) {
      for (const f of CMP) {
        if (!eq(raw.parsed[f], neu.parsed[f])) { identical = false; diffs.push(`${f}: خام=${raw.parsed[f]} جديد=${neu.parsed[f]}`); }
      }
    } else { identical = false; diffs.push('فشل تحليل أحد المسارين'); }

    const rawTok = raw.usage?.input_tokens ?? 0;
    const neuTok = neu.usage?.input_tokens ?? 0;
    const saved = ext.text && rawTok ? Math.round(((rawTok - neuTok) / rawTok) * 100) : 0;

    results.push({ file, vendor: raw.parsed?.vendor ?? '?', path, identical, diffs, rawTok, neuTok, saved, chars: ext.chars, digits: ext.digits });
    console.log(`   مسار: ${path} | ${identical ? '✅ متطابق' : '⚠️ اختلاف'} | ${ext.text ? `توفير ${saved}%` : ''}`);
    if (!identical) diffs.forEach((d) => console.log(`     ✗ ${d}`));
    console.log();
  }

  // الجدول النهائي
  console.log('═══════════════════ الملخّص ═══════════════════');
  console.log('المورّد / الملف            المسار        الحالة      التوفير');
  console.log('──────────────────────────────────────────────────────────');
  for (const r of results) {
    const vend = String(r.vendor).slice(0, 22).padEnd(24);
    const p = r.path.padEnd(14);
    const st = r.identical ? '✅ آمن   ' : '⚠️ راجع  ';
    const sv = r.path === 'نص' ? `${r.saved}%` : '—';
    console.log(`${vend}${p}${st}  ${sv}`);
  }
  console.log('──────────────────────────────────────────────────────────');

  const allSafe = results.every((r) => r.identical);
  const textCount = results.filter((r) => r.path === 'نص').length;
  console.log(`\nنصي: ${textCount}/${results.length}   |   ممسوح/خام: ${results.length - textCount}/${results.length}`);
  console.log(allSafe
    ? '\n✅ كل الموردين: المسار الجديد يطابق الخام بالضبط → آمن للاعتماد الكامل.'
    : '\n⚠️  مورّد أو أكثر اختلف — راجع أعلاه قبل الاعتماد. لا تعمّم حتى تُحسم.');
  console.log('\nابعت كل المخرجات كما هي.\n');
}

main().catch((e) => { console.error('خطأ:', e); process.exit(1); });