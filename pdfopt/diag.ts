// ─────────────────────────────────────────────────────────
// diag.ts — تشخيص الفاتورتين المشكلتين في Phase C
//
// يطبع النص المستخرج الخام + إحصاءات، بلا أي نداء API.
// نشوف: ليش inv26002031 رجع null؟ وليش inv26700951 (creditnota) اختلف؟
//
// التشغيل (من جذر مشروعك، حيث node_modules):
//   npx tsx diag.ts
// (يبحث تلقائياً عن الملفين في المجلد الحالي)
// ─────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';

async function extract(path: string) {
  const bytes = Buffer.from(readFileSync(path).toString('base64'), 'base64');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    pages.push(c.items.map((it: any) => String(it.str)).join(' '));
  }
  return { text: pages.join('\n').trim(), numPages: doc.numPages };
}

async function main() {
  // يلاقي الملفين بأي مسار (يطابق جزء من الاسم)
  const files = readdirSync('.').filter((f) => f.toLowerCase().endsWith('.pdf'));
  const targets = files.filter((f) => f.includes('26002031') || f.includes('26700951'));

  if (targets.length === 0) {
    console.error('❌ لم أجد inv26002031 أو inv26700951 في المجلد الحالي.');
    console.error('   الملفات الموجودة:', files.join(', '));
    process.exit(1);
  }

  for (const f of targets) {
    try {
      const r = await extract(f);
      const chars = r.text.replace(/\s/g, '').length;
      const digits = (r.text.match(/\d/g) || []).length;
      console.log('\n════════════', f, '════════════');
      console.log(`صفحات: ${r.numPages} | حروف: ${chars} | أرقام: ${digits}`);
      console.log(`عبر العتبة (حروف≥100 وأرقام≥20)? ${chars >= 100 && digits >= 20 ? 'نعم → مسار النص' : 'لا → خام'}`);
      console.log('─── النص المستخرج الكامل ───');
      console.log(r.text || '(فارغ تماماً!)');
      console.log('─── نهاية ───');
    } catch (e: any) {
      console.log(`\n${f} → خطأ استخراج: ${e.message}`);
    }
  }
  console.log('\nابعت كل المخرجات كما هي.\n');
}

main().catch((e) => { console.error('خطأ:', e); process.exit(1); });
