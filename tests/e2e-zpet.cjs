// E2E (demo): tlačítko Zpět přepíná obrazovky ARTURa a nezamyká ho.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8765/index.html?demo=1';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const ok = (c, m) => { if (!c) throw new Error('SELHALO: ' + m); console.log('  ✓', m); };
  const nav = async (l) => { if (!(await page.isVisible(`nav.side button:has-text("${l}")`))) await page.click('#nav-nastaveni'); await page.click(`nav.side button:has-text("${l}")`); await page.waitForTimeout(300); };
  const aktivni = async () => (await page.textContent('nav.side button.active')).trim();
  await page.goto('about:blank'); await page.goto(URL);
  await page.fill('input[name=email]', 'josef.dvorak@postme.cz'); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300);
  await page.fill('input[name=p1]', 'Josef-heslo-2026!'); await page.fill('input[name=p2]', 'Josef-heslo-2026!'); await page.click('button.primary'); await page.waitForSelector('header.top');
  await nav('Faktury'); await nav('Banka a úhrady'); await nav('Můj účet');
  await page.goBack(); await page.waitForTimeout(400); ok(await aktivni() === 'Banka a úhrady', 'Zpět → Banka a úhrady');
  await page.goBack(); await page.waitForTimeout(400); ok(await aktivni() === 'Faktury', 'Zpět → Faktury');
  await page.goForward(); await page.waitForTimeout(400); ok(await aktivni() === 'Banka a úhrady', 'Vpřed → Banka a úhrady');
  await page.goBack(); await page.goBack(); await page.waitForTimeout(400); ok(await aktivni() === 'Přehled', 'Zpět → Přehled');
  await page.goBack(); await page.waitForTimeout(600);
  ok(page.url().includes('index.html') && !!(await page.$('header.top')) && !(await page.$('#f-unlock')), 'další Zpět stránku neopustí a ARTUR se nezamkne');
  await nav('Faktury'); ok(await aktivni() === 'Faktury', 'po návratu na začátek ARTUR normálně funguje');
  ok(errors.length === 0, 'žádné chyby ' + errors.join(' | '));
  await browser.close(); console.log('\nE2E ZPET OK');
})().catch((e) => { console.error(e); process.exit(1); });
