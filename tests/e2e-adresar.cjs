// E2E společný adresář (demo): založení, převod adresáře subjektu, sdílení mezi subjekty, druhý uživatel.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:8765/index.html?demo=1';
const DIR = process.env.MIG || '/tmp/mig';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const ok = (c, m) => { if (!c) throw new Error('SELHALO: ' + m); console.log('  ✓', m); };
  const nav = async (l) => { if (!(await page.isVisible(`nav.side button:has-text(\"${l}\")`))) await page.click('#nav-nastaveni'); await page.click(`nav.side button:has-text(\"${l}\")`); await page.waitForTimeout(300); };
  const text = () => page.textContent('#app');
  const login = async (e) => { await page.fill('input[name=email]', e); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300); };
  const setPw = async (pw) => { await page.fill('input[name=p1]', pw); await page.fill('input[name=p2]', pw); await page.click('button.primary'); await page.waitForSelector('header.top'); };
  const unlock = async (pw) => { await page.fill('input[name=pw]', pw); await page.click('button:has-text("Odemknout")'); await page.waitForSelector('header.top'); };
  const logout = async () => { await page.click('#btn-out'); await page.waitForSelector('#f-login'); };
  const finish = async () => {
    await page.click('#f-subj button.primary'); await page.waitForSelector('#rk-code'); const k = (await page.textContent('#rk-code')).trim().split('-');
    await page.fill('input[name=g1]', k[1]); await page.fill('input[name=g2]', k[k.length - 2]); await page.click('button:has-text("Potvrzuji")'); await page.waitForTimeout(300);
  };
  const choose = async (label) => { const v = await page.$eval('#sel-subject', (s, l) => [...s.options].find((o) => o.text.includes(l)).value, label); await page.selectOption('#sel-subject', v); await page.waitForTimeout(300); };
  await page.goto(URL);
  await login('josef.dvorak@postme.cz'); await setPw('Josef-heslo-2026!');
  await nav('Uživatelé aplikace'); await page.fill('#f-allow input[name=email]', 'karolina.dvorakova@postme.cz'); await page.click('#f-allow button'); await page.waitForTimeout(200);
  await nav('Nový subjekt'); await page.fill('#f-new input[name=label]', 'Karolína Dvořáková'); await page.click('#f-new button.primary'); await page.waitForTimeout(400);
  await page.fill('input[name=acc_cislo]', '732627175/5500'); await finish();
  await nav('Import z vyfakturuj.cz'); await page.setInputFiles('#file', DIR + '/karolina.json'); await page.waitForTimeout(500); await page.click('#btn-import'); await page.waitForSelector('text=Import hotov');

  console.log('▶ Založení společného adresáře');
  await nav('Nový subjekt'); await page.check('#chk-adresar'); await page.waitForTimeout(300);
  ok((await page.$$('#mem .row')).length === 2, 'členové předvyplněni: admin + Karolína');
  await page.click('#f-new button.primary'); await page.waitForTimeout(400); await finish();
  await nav('Nový subjekt'); ok(await page.isDisabled('#chk-adresar'), 'druhý společný adresář nejde založit');
  await choose('Společný adresář'); await nav('Faktury'); ok((await text()).includes('nemá vlastní faktury'), 'společný adresář nemá faktury');

  console.log('▶ Převod adresáře subjektu');
  await choose('Karolína Dvořáková'); await nav('Adresář');
  ok((await text()).includes('7 zákazníků ve vlastním adresáři'), 'nabídka převodu 7 zákazníků');
  await page.click('#btn-prevod'); await page.waitForTimeout(1500);
  ok((await text()).includes('Převedeno do společného adresáře: 7 nových') && (await text()).includes('Přepojeno 259 faktur'), 'převedeno 7 zákazníků, přepojeno 259 faktur');
  ok((await page.$$('tr[data-id]')).length === 7 && !(await page.$('#btn-prevod')), 'adresář ukazuje 7 společných zákazníků, převod hotov');
  await page.click('tr[data-id] >> nth=0'); await page.waitForTimeout(300);
  ok((await page.$$('tr[data-fa]')).length > 0, 'zákazník má po převodu své faktury');

  console.log('▶ Sdílení mezi subjekty');
  await nav('Nový subjekt'); await page.fill('#f-new input[name=ico]', '09474595'); await page.fill('#f-new input[name=label]', 'POSTME s.r.o.'); await page.click('#f-new button.primary'); await page.waitForTimeout(400);
  await page.fill('input[name=acc_cislo]', '732627175/5500'); await finish();
  await choose('POSTME s.r.o.'); await nav('Adresář');
  ok((await page.$$('tr[data-id]')).length === 7 && (await text()).includes('Společný adresář'), 'POSTME vidí stejných 7 zákazníků');
  await page.click('#btn-new-zak'); await page.fill('#f-zak input[name=nazev]', 'Nový odběratel POSTME'); await page.fill('#f-zak input[name=ico]', '04787625'); await page.click('#f-zak button.primary'); await page.waitForTimeout(500);
  await choose('Karolína Dvořáková'); await nav('Adresář');
  ok((await text()).includes('Nový odběratel POSTME'), 'zákazník založený v POSTME je vidět i u Karolíny');
  await nav('Faktury'); await page.click('#btn-new-fa');
  ok((await page.$$('select[name=zakaznikId] option')).length === 9, 'v nové faktuře se nabízí všech 8 společných zákazníků');
  await page.click('#back');
  await logout();

  console.log('▶ Karolína');
  await login('karolina.dvorakova@postme.cz'); await setPw('Karolina-heslo-26'); await logout();
  await login('josef.dvorak@postme.cz'); await unlock('Josef-heslo-2026!');
  await choose('Společný adresář'); await nav('Členové a přístup'); await page.click('[data-grant]'); await page.waitForTimeout(500); await logout();
  await login('karolina.dvorakova@postme.cz'); await unlock('Karolina-heslo-26');
  const opts = await page.$$eval('#sel-subject option', (o) => o.map((x) => x.text));
  ok(opts.length === 1 && opts[0].includes('Společný adresář'), 'Karolína vidí jen společný adresář (POSTME ani svůj subjekt tu nemá): ' + opts.join(', '));
  await nav('Adresář'); ok((await page.$$('tr[data-id]')).length === 8, 'Karolína vidí 8 zákazníků společného adresáře');
  const raw = await page.evaluate(() => localStorage.getItem('artur-demo-db'));
  ok(!raw.includes('Nový odběratel') && !raw.includes('Stavební bytové'), 'společný adresář je v úložišti šifrovaný');
  ok(errors.length === 0, 'žádné chyby v konzoli ' + errors.join(' | '));
  await browser.close(); console.log('\nE2E SPOLEČNÝ ADRESÁŘ OK');
})().catch((e) => { console.error(e); process.exit(1); });
