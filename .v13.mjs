import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails=0; const chk=(l,c,e='')=>{if(!c)fails++;console.log((c?'PASS ':'FAIL ')+l+(e?'  → '+e:''));};
const PATHS = ['/', '/btw-berekenen', '/factuur-maken', '/tools', '/prijzen'];
for (const width of [280, 320, 360, 390, 430, 768, 1280]) {
  const p = await b.newPage({ viewport: { width, height: 800 } });
  let bad = [];
  for (const path of PATHS) {
    await p.goto('http://localhost:3121'+path, { waitUntil: 'domcontentloaded' });
    const r = await p.evaluate((w) => {
      const d = document.documentElement;
      const cta = document.querySelector('a[href="/register"]');
      const login = document.querySelector('a[href="/login"]');
      return {
        o: d.scrollWidth - d.clientWidth,
        cta: cta ? cta.getBoundingClientRect().right <= w + 1 : true,
        login: login ? login.getBoundingClientRect().right <= w + 1 : true,
      };
    }, width);
    if (r.o > 1) bad.push(`${path} overflow ${r.o}px`);
    if (!r.cta) bad.push(`${path} CTA clipped`);
    if (!r.login) bad.push(`${path} login clipped`);
  }
  chk(`${String(width).padStart(4)}px — header + ${PATHS.length} public pages`, bad.length === 0, bad.join('; '));
  await p.close();
}
console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
await b.close(); process.exit(fails?1:0);
