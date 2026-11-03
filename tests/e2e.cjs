const { chromium } = require('playwright');
const URL = 'http://localhost:8765/index.html?demo=1';
const SHOT = process.env.SHOT || '/home/claude/artur-app/tests/shots';
require('fs').mkdirSync(SHOT, { recursive: true });
let dialogAnswers = [];
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', async (d) => { const a = dialogAnswers.shift(); if (d.type() === 'prompt') await d.accept(a ?? ''); else await d.accept(); });
  const step = (s) => console.log('▶', s);
  const nav = async (label) => { if (!(await page.isVisible(`nav.side button:has-text(\"${label}\")`))) await page.click('#nav-nastaveni'); await page.click(`nav.side button:has-text(\"${label}\")`); await page.waitForTimeout(150); };
  const login = async (email) => { await page.fill('input[name=email]', email); await page.click('button:has-text("Přihlásit")'); await page.waitForTimeout(300); };
  const logout = async () => { await page.click('#btn-out'); await page.waitForSelector('#f-login'); };
  const setPw = async (pw) => { await page.fill('input[name=p1]', pw); await page.fill('input[name=p2]', pw); await page.click('button.primary'); await page.waitForSelector('header.top', { timeout: 15000 }); };
  const unlock = async (pw) => { await page.fill('input[name=pw]', pw); await page.click('button:has-text("Odemknout")'); await page.waitForSelector('header.top', { timeout: 15000 }); };
  const text = async () => page.textContent('#app');
  const assert = (c, m) => { if (!c) throw new Error('SELHALO: ' + m); console.log('  ✓', m); };
  const saveRk = async () => {
    await page.waitForSelector('#rk-code');
    const key = (await page.textContent('#rk-code')).trim();
    const g = key.split('-');
    await page.fill('input[name=g1]', g[1]); await page.fill('input[name=g2]', g[g.length - 2]);
    await page.click('button:has-text("Potvrzuji")'); await page.waitForTimeout(300);
    return key;
  };
  const newSubject = async (ico, name, members) => {
    await nav('Nový subjekt');
    await page.fill('#f-new input[name=ico]', ico); await page.fill('#f-new input[name=label]', name);
    const rows = page.locator('#mem .row');
    for (let i = 0; i < members.length; i++) {
      if (i > 0) await page.click('#btn-mem-add');
      await rows.nth(i).locator('input').fill(members[i][0]);
      await rows.nth(i).locator('select').selectOption(members[i][1]);
    }
    await page.click('#f-new button.primary'); await page.waitForTimeout(400);
  };

  await page.goto(URL);
  step('Josef – první přihlášení, heslo');
  await login('josef.dvorak@postme.cz'); await setPw('Josef-heslo-2026!');
  assert((await text()).includes('admin'), 'Josef je administrátor');
  step('Josef povoluje uživatele');
  await nav('Uživatelé aplikace');
  for (const [e, n] of [['karolina.dvorakovy@postme.cz', 'Karolína Dvořáková'], ['stepan.dvorak@postme.cz', 'Štěpán Dvořák']]) {
    await page.fill('#f-allow input[name=email]', e); await page.fill('#f-allow input[name=name]', n); await page.click('#f-allow button'); await page.waitForTimeout(200);
  }
  assert((await text()).includes('stepan.dvorak@postme.cz'), 'uživatelé povoleni');
  step('Josef zakládá POSTME s.r.o.');
  await newSubject('09474595', 'POSTME s.r.o.', [['josef.dvorak@postme.cz', 'vlastnik'], ['karolina.dvorakovy@postme.cz', 'ucetni'], ['stepan.dvorak@postme.cz', 'ucetni']]);
  assert((await text()).includes('Dokončení založení'), 'formulář dokončení');
  await page.fill('input[name=ulice]', 'Želeč 53'); await page.fill('input[name=psc]', '391 74'); await page.fill('input[name=obec]', 'Želeč');
  await page.fill('input[name=email]', 'info@postme.cz'); await page.fill('input[name=telefon]', '732627176');
  await page.fill('input[name=acc_cislo]', '732627175/5500');
  assert((await page.textContent('.iban')).includes('CZ47 5500 0000 0007 3262 7175'), 'IBAN dopočítán');
  await page.check('input[name=exportMoney]');
  await page.screenshot({ path: SHOT + '/01-dokonceni-postme.png' });
  await page.click('#f-subj button.primary');
  const rkPostme = await saveRk();
  assert((await text()).includes('Uložení záchranného klíče potvrzeno'), 'záchranný klíč POSTME potvrzen');
  step('Josef zakládá JOSEF DVOŘÁK (jen on)');
  await newSubject('', 'JOSEF DVOŘÁK', [['josef.dvorak@postme.cz', 'vlastnik']]);
  await page.click('#f-subj button.primary'); await saveRk();
  step('Josef zakládá KAROLÍNA DVOŘÁKOVÁ (jen Karolína)');
  await newSubject('', 'KAROLÍNA DVOŘÁKOVÁ', [['karolina.dvorakovy@postme.cz', 'vlastnik']]);
  assert((await text()).includes('vy k němu přístup nemáte'), 'admin nemá přístup ke Karolínině subjektu');
  await nav('Přehled');
  const opts = await page.$$eval('#sel-subject option', (o) => o.map((x) => x.textContent));
  assert(opts.length === 2 && !opts.some((o) => o.includes('KAROLÍNA')), 'Josef vidí 2 subjekty: ' + opts.join(', '));
  await page.screenshot({ path: SHOT + '/02-prehled-josef.png' });
  await logout();

  step('Karolína – první přihlášení');
  await login('karolina.dvorakovy@postme.cz'); await setPw('Karolina-heslo-26');
  let t = await text();
  assert(t.includes('KAROLÍNA DVOŘÁKOVÁ') && t.includes('POSTME'), 'Karolína vidí své 2 subjekty');
  assert(!t.includes('JOSEF DVOŘÁK'), 'Karolína nevidí subjekt JOSEF DVOŘÁK');
  await page.selectOption('#sel-subject', { label: 'KAROLÍNA DVOŘÁKOVÁ (bez přístupu)' });
  await nav('Údaje subjektu');
  await page.click('#btn-finish'); await page.fill('input[name=obec]', 'Želeč');
  await page.click('#f-subj button.primary'); await saveRk();
  assert((await text()).includes('potvrzeno'), 'Karolína dokončila svůj subjekt');
  await page.selectOption('#sel-subject', { label: 'POSTME s.r.o. (bez přístupu)' }); await nav('Údaje subjektu');
  assert((await text()).includes('Ke klíči subjektu zatím nemáte přístup'), 'Karolína čeká na přístup k POSTME');
  await logout();
  step('Štěpán – první přihlášení');
  await login('stepan.dvorak@postme.cz'); await setPw('Stepan-heslo-2026');
  await logout();
  step('Neznámý uživatel');
  await login('cizi@gmail.com');
  assert((await text()).includes('nemá do ARTURa přístup'), 'nepovolený e-mail je odmítnut');
  await page.click('#out'); await page.waitForSelector('#f-login');

  step('Josef uděluje přístup k POSTME');
  await login('josef.dvorak@postme.cz'); await unlock('Josef-heslo-2026!');
  await page.selectOption('#sel-subject', { label: 'POSTME s.r.o.' }); await nav('Členové a přístup');
  await page.screenshot({ path: SHOT + '/03-clenove-pred.png' });
  for (let i = 0; i < 2; i++) { await page.click('[data-grant] >> nth=0'); await page.waitForTimeout(500); }
  t = await text();
  assert((t.match(/má přístup/g) || []).length === 3, 'všichni 3 členové POSTME mají přístup');
  await page.screenshot({ path: SHOT + '/04-clenove-po.png' });
  await logout();

  step('Karolína jako účetní v POSTME');
  await login('karolina.dvorakovy@postme.cz'); await unlock('Karolina-heslo-26');
  await page.selectOption('#sel-subject', { label: 'POSTME s.r.o.' }); await nav('Údaje subjektu');
  assert(await page.inputValue('input[name=ulice]') === 'Želeč 53', 'Karolína dešifrovala údaje POSTME');
  assert(await page.isDisabled('input[name=nazev]'), 'účetní nemůže měnit údaje subjektu');
  await logout();

  step('Josef zapomněl heslo → obnova záchranným klíčem');
  await login('josef.dvorak@postme.cz');
  await page.click('#forgot'); await setPw('Nove-heslo-Josef-1');
  await page.selectOption('#sel-subject', { label: 'POSTME s.r.o. (bez přístupu)' }); await nav('Údaje subjektu');
  assert((await text()).includes('předchozí heslo'), 'po resetu hesla je přístup potřeba obnovit');
  dialogAnswers.push('ARTUR-' + rkPostme.toLowerCase());
  await page.click('#btn-recover'); await page.waitForTimeout(800);
  assert((await text()).includes('Přístup obnoven'), 'přístup obnoven záchranným klíčem');
  await nav('Údaje subjektu');
  assert(await page.inputValue('input[name=ulice]') === 'Želeč 53', 'data POSTME opět čitelná');
  step('Zamčení a historie');
  await nav('Historie změn'); await page.screenshot({ path: SHOT + '/05-historie.png' });
  assert((await text()).includes('Přístup obnoven záchranným klíčem'), 'audit zaznamenal obnovu');
  await page.click('#btn-lock');
  assert(!!(await page.$('#f-unlock')), 'zamčení vyžaduje heslo');

  step('Kontrola úložiště: žádné citlivé údaje čitelně');
  const raw = await page.evaluate(() => localStorage.getItem('artur-demo-db'));
  for (const s of ['Želeč 53', '732627175', 'info@postme.cz', '732627176', 'CZ4755']) assert(!raw.includes(s), `„${s}“ není v úložišti čitelně`);
  step('Mobil');
  await unlock('Nove-heslo-Josef-1');
  await page.setViewportSize({ width: 390, height: 800 }); await nav('Přehled');
  await page.screenshot({ path: SHOT + '/06-mobil.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, 'na mobilu bez vodorovného posunu');
  assert(errors.length === 0, 'žádné chyby v konzoli ' + errors.join(' | '));
  await browser.close();
  console.log('\nE2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
