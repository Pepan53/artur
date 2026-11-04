// E2E (demo): výchozí subjekt v Přehledu → po přihlášení se otevřou jeho faktury.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8765/index.html?demo=1';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const ok = (c, m) => { if (!c) throw new Error('SELHALO: ' + m); console.log('  ✓', m); };
  const nav = async (l) => { if (!(await page.isVisible(`nav.side button:has-text("${l}")`))) await page.click('#nav-nastaveni'); await page.click(`nav.side button:has-text("${l}")`); await page.waitForTimeout(300); };
  const PW = 'Josef-heslo-2026!';
  await page.goto(URL);
  await page.fill('input[name=email]', 'josef.dvorak@postme.cz'); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300);
  await page.fill('input[name=p1]', PW); await page.fill('input[name=p2]', PW); await page.click('button.primary'); await page.waitForSelector('header.top');
  for (const [ico, nazev, ucet] of [['09474595', 'POSTME s.r.o.', '732627175/5500'], ['49033727', 'Josef Dvořák', '2112621062/2700']]) {
    await nav('Nový subjekt'); await page.fill('#f-new input[name=ico]', ico); await page.fill('#f-new input[name=label]', nazev); await page.click('#f-new button.primary'); await page.waitForTimeout(400);
    await page.fill('input[name=acc_cislo]', ucet); await page.click('#f-subj button.primary');
    await page.waitForSelector('#rk-code'); const k = (await page.textContent('#rk-code')).trim().split('-');
    await page.fill('input[name=g1]', k[1]); await page.fill('input[name=g2]', k[k.length - 2]); await page.click('button:has-text("Potvrzuji")'); await page.waitForTimeout(300);
  }
  await nav('Přehled');
  ok((await page.$$('[data-vychozi]')).length === 2, 'sloupec Výchozí se zaškrtávátky');
  await page.check('[data-vychozi] >> nth=1'); await page.waitForTimeout(400);
  await page.check('[data-vychozi] >> nth=0'); await page.waitForTimeout(400);
  ok((await page.$$('[data-vychozi]:checked')).length === 1, 'zaškrtnutý je vždy nejvýš jeden');
  const vybrany = await page.$eval('[data-vychozi]:checked', (e) => e.closest('tr').querySelector('button').textContent);
  await page.screenshot({ path: '/tmp/shots/50-vychozi.png' });
  await page.click('#btn-out'); await page.waitForSelector('input[name=email]');
  await page.fill('input[name=email]', 'josef.dvorak@postme.cz'); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300);
  await page.fill('input[name=pw]', PW); await page.click('button:has-text("Odemknout")'); await page.waitForSelector('header.top', { timeout: 15000 }); await page.waitForTimeout(500);
  ok((await page.textContent('nav.side button.active')).trim() === 'Faktury', 'po přihlášení se otevřou Faktury');
  ok((await page.$eval('#sel-subject', (s) => s.selectedOptions[0].textContent)).includes(vybrany), `vybraný subjekt je výchozí (${vybrany})`);
  await nav('Přehled'); await page.uncheck('[data-vychozi]:checked'); await page.waitForTimeout(400);
  await page.click('#btn-out'); await page.waitForSelector('input[name=email]');
  await page.fill('input[name=email]', 'josef.dvorak@postme.cz'); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300);
  await page.fill('input[name=pw]', PW); await page.click('button:has-text("Odemknout")'); await page.waitForSelector('header.top', { timeout: 15000 }); await page.waitForTimeout(500);
  ok((await page.textContent('nav.side button.active')).trim() === 'Přehled', 'bez výchozího subjektu se otevře Přehled');
  ok(errors.length === 0, 'žádné chyby v konzoli ' + errors.join(' | '));
  await browser.close(); console.log('\nE2E VYCHOZI OK');
})().catch((e) => { console.error(e); process.exit(1); });
