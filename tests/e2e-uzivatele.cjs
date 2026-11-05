// E2E (demo): správa uživatelů aplikace – povolení a úprava jména a poznámky.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8765/index.html?demo=1';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
  const ok = (c, m) => { if (!c) throw new Error('SELHALO: ' + m); console.log('  ✓', m); };
  const nav = async (l) => { if (!(await page.isVisible(`nav.side button:has-text("${l}")`))) await page.click('#nav-nastaveni'); await page.click(`nav.side button:has-text("${l}")`); await page.waitForTimeout(300); };
  await page.goto(URL);
  await page.fill('input[name=email]', 'josef.dvorak@postme.cz'); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300);
  await page.fill('input[name=p1]', 'Josef-heslo-2026!'); await page.fill('input[name=p2]', 'Josef-heslo-2026!'); await page.click('button.primary'); await page.waitForSelector('header.top');
  await nav('Uživatelé aplikace');
  await page.fill('#f-allow [name=email]', 'fakturace@postme.cz'); await page.fill('#f-allow [name=name]', 'Fakturace'); await page.click('#f-allow button'); await page.waitForTimeout(400);
  ok((await page.textContent('main')).includes('fakturace@postme.cz'), 'povolen fakturace@postme.cz');
  await page.click('[data-edit="fakturace@postme.cz"]'); await page.waitForTimeout(200);
  await page.fill('#u-name', 'POSTME – fakturace'); await page.fill('#u-pozn', 'technický účet pro odesílání faktur'); await page.click('#u-save'); await page.waitForTimeout(400);
  const t = await page.textContent('main');
  ok(t.includes('POSTME – fakturace') && t.includes('technický účet pro odesílání faktur') && !(await page.$('#u-name')), 'jméno a poznámka upraveny');
  await page.click('[data-edit="josef.dvorak@postme.cz"]'); await page.fill('#u-name', 'Josef Dvořák'); await page.click('#u-save'); await page.waitForTimeout(400);
  ok((await page.textContent('main')).includes('Josef Dvořák'), 'upravit jde i administrátora');
  ok(errors.length === 0, 'žádné chyby ' + errors.join(' | '));
  await browser.close(); console.log('\nE2E UZIVATELE OK');
})().catch((e) => { console.error(e); process.exit(1); });
