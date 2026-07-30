import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails=0; const chk=(l,c,e='')=>{if(!c)fails++;console.log((c?'PASS ':'FAIL ')+l+(e?'  '+e:''));};
const paths = ['/','/btw-berekenen','/factuur-maken','/tools','/blog','/prijzen','/uurtarief-berekenen'];
for (const width of [320, 360, 390, 430, 768, 1280]) {
  const p = await b.newPage({ viewport: { width, height: 800 } });
  let worst = 0, worstPath = '';
  for (const path of paths) {
    await p.goto('http://localhost:3114'+path, { waitUntil: 'domcontentloaded' });
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > worst) { worst = o; worstPath = path; }
  }
  chk(`no horizontal overflow at ${width}px`, worst <= 1, worst ? `${worst}px on ${worstPath}` : '');
  await p.close();
}
// CTA must remain visible and tappable on a phone
const p = await b.newPage({ viewport: { width: 360, height: 800 } });
await p.goto('http://localhost:3114/btw-berekenen', { waitUntil: 'networkidle' });
const cta = await p.$eval('a[href="/register"]', e => { const r=e.getBoundingClientRect();
  return { right: Math.round(r.right), h: Math.round(r.height), visible: r.right <= 360 && r.width > 0 }; });
chk('signup CTA fully on screen at 360px', cta.visible, JSON.stringify(cta));
chk('signup CTA is tall enough to tap', cta.h >= 36, `${cta.h}px`);
const login = await p.$eval('a[href="/login"]', e => e.getBoundingClientRect().right <= 360);
chk('Inloggen still reachable at 360px', login);
// and the wide links come back on desktop
const d = await b.newPage({ viewport: { width: 1280, height: 800 } });
await d.goto('http://localhost:3114/btw-berekenen', { waitUntil: 'networkidle' });
chk('browsing links return on desktop', await d.$eval('a[href="/tools"]', e => getComputedStyle(e).display !== 'none'));
console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
await b.close(); process.exit(fails?1:0);
