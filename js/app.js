// ARTUR – aplikace (etapa 0: přihlášení, role, šifrování, subjekty, klíče).
import { firebaseConfig, ADMIN_EMAILS, IDLE_LOCK_MINUTES, APP_VERSION, isDemo } from './config.js?v=0.5.4';
import { currentTheme, toggleTheme } from './theme.js?v=0.5.4';
import * as C from './crypto.js?v=0.5.4';
import { aresLookup, parseAccount, ibanFromAccount, formatIban, icoValid } from './czech.js?v=0.5.4';
import { viewFaktury, viewFaktura, viewAdresar, viewZakaznik, viewImport } from './views-fakturace.js?v=0.5.4';
import { viewSablony, viewSablona, viewMesic } from './views-opakovani.js?v=0.5.4';
import { viewBanka } from './views-banka.js?v=0.5.4';
import { VYCHOZI_PREDMET, VYCHOZI_TEXT } from './mail.js?v=0.5.4';

const ROLE_LABEL = { vlastnik: 'Vlastník', ucetni: 'Účetní', ctenar: 'Čtenář' };
const ROLES = ['vlastnik', 'ucetni', 'ctenar'];

const state = {
  store: null,
  auth: null,          // { email }
  user: null,          // uložený profil (veřejný klíč, zašifrovaný soukromý klíč)
  privateKey: null,    // odemčený soukromý klíč – jen v paměti
  subjects: [],        // [{ id, meta, dek, data, access }]
  current: null,       // id vybraného subjektu
  view: 'prehled',
  detailId: null,
  ui: {},
  flash: null,
  idleTimer: null,
};

const $app = () => document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => !!state.auth && ADMIN_EMAILS.includes(state.auth.email);
const lower = (e) => (e || '').trim().toLowerCase();
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString('cs-CZ'); };
const subjectById = (id) => state.subjects.find((s) => s.id === id);
const cur = () => subjectById(state.current);
const myRole = (s) => s?.meta?.members?.[state.auth?.email];
const subjectName = (s) => s?.data?.nazev || s?.meta?.label || s?.id;

function flash(msg, kind = 'ok') { state.flash = { msg, kind }; }

async function audit(sid, action, detail = '') {
  try {
    const dek = subjectById(sid)?.dek;
    const entry = { by: state.auth.email, action };
    if (detail && dek) entry.enc = await C.sealJson(dek, { detail }, 'audit:' + sid);
    else if (detail) entry.detail = '';
    await state.store.addAudit(sid, entry);
  } catch (e) { console.warn('audit', e); }
}

function download(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- start
export async function start() {
  document.getElementById('version').textContent = APP_VERSION;
  try {
    if (isDemo()) {
      const { createDemoStore } = await import('./store-demo.js?v=0.5.4');
      state.store = createDemoStore();
      document.body.classList.add('demo');
    } else {
      const { createFirebaseStore } = await import('./store-firebase.js?v=0.5.4');
      state.store = await createFirebaseStore(firebaseConfig);
    }
  } catch (e) {
    renderFatal('Nepodařilo se spustit úložiště: ' + e.message);
    return;
  }
  state.store.onAuth(onAuthChange);
  checkNewVersion();
  setInterval(checkNewVersion, 10 * 60000);
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));
}

async function checkNewVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (!version || version === APP_VERSION || document.getElementById('new-version')) return;
    const bar = document.createElement('div');
    bar.id = 'new-version';
    bar.className = 'new-version';
    bar.innerHTML = `Je k dispozici nová verze ARTURa ${esc(version)}. <button class="small primary">Načíst znovu</button>`;
    bar.querySelector('button').onclick = () => { location.href = location.pathname + '?v=' + encodeURIComponent(version); };
    document.body.prepend(bar);
  } catch { /* offline – nevadí */ }
}

function resetIdle() {
  clearTimeout(state.idleTimer);
  if (!state.privateKey) return;
  state.idleTimer = setTimeout(() => lock('Aplikace se zamkla po ' + IDLE_LOCK_MINUTES + ' minutách nečinnosti.'), IDLE_LOCK_MINUTES * 60000);
}

function lock(msg) {
  state.privateKey = null;
  state.subjects = [];
  if (msg) flash(msg, 'info');
  render();
}

async function onAuthChange(auth) {
  state.auth = auth ? { email: lower(auth.email), name: auth.name } : null;
  state.user = null; state.privateKey = null; state.subjects = []; state.current = null;
  if (!auth) return render();
  if (!auth.verified) { state.denied = 'E-mail účtu není ověřený.'; return render(); }
  const ok = ADMIN_EMAILS.includes(state.auth.email) || (await state.store.isAllowed(state.auth.email));
  state.denied = ok ? null : `Účet ${state.auth.email} nemá do ARTURa přístup. Požádejte administrátora o přidání.`;
  if (ok) state.user = await state.store.getUser(state.auth.email);
  render();
}

// ---------------------------------------------------------------- render
function render() {
  const root = $app();
  if (!state.auth) return renderLogin(root);
  if (state.denied) return renderDenied(root);
  if (!state.user || state.resetting) return renderSetupPassword(root);
  if (!state.privateKey) return renderUnlock(root);
  renderMain(root);
}

function flashHtml() {
  if (!state.flash) return '';
  const f = state.flash; state.flash = null;
  return `<div class="flash ${f.kind}" role="status">${esc(f.msg)}</div>`;
}

function renderFatal(msg) { $app().innerHTML = `<div class="card narrow"><h1>ARTUR</h1><p class="err">${esc(msg)}</p></div>`; }

function renderLogin(root) {
  const demo = state.store.kind === 'demo';
  root.innerHTML = `
  <div class="card narrow">
    <div class="brand"><span class="logo">A</span><div><h1>ARTUR</h1><p class="muted">Fakturace pro více IČO</p></div></div>
    ${flashHtml()}
    ${demo ? `
      <p class="note">Demo režim: data zůstávají jen v tomto prohlížeči. Přihlášení se simuluje zadáním e-mailu.</p>
      <form id="f-login" class="stack">
        <label>E-mail<input name="email" type="email" required autocomplete="username" list="demo-emails"></label>
        <datalist id="demo-emails">${state.store.demoKnownEmails().map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
        <button class="primary">Přihlásit (demo)</button>
      </form>
      <p><button class="link" id="demo-reset">Vymazat demo data</button></p>`
    : `<button class="primary google" id="btn-google">Přihlásit účtem Google</button>
       <p class="muted small">Přístup mají jen e-maily schválené administrátorem.</p>`}
  </div>`;
  if (demo) {
    root.querySelector('#f-login').onsubmit = async (e) => { e.preventDefault(); await state.store.signIn(new FormData(e.target).get('email')); };
    root.querySelector('#demo-reset').onclick = () => { if (confirm('Opravdu smazat všechna demo data?')) { state.store.demoReset(); location.reload(); } };
  } else {
    root.querySelector('#btn-google').onclick = async () => {
      try { await state.store.signIn(); } catch (e) { flash('Přihlášení se nezdařilo: ' + e.message, 'err'); render(); }
    };
  }
}

function renderDenied(root) {
  root.innerHTML = `<div class="card narrow"><h1>ARTUR</h1><p class="err">${esc(state.denied)}</p>
    <button id="out">Odhlásit</button></div>`;
  root.querySelector('#out').onclick = () => state.store.signOut();
}

function renderSetupPassword(root) {
  const reset = !!state.resetting;
  root.innerHTML = `
  <div class="card narrow">
    <h1>${reset ? 'Nové šifrovací heslo' : 'Nastavte šifrovací heslo'}</h1>
    <p class="muted">${esc(state.auth.email)}</p>
    ${flashHtml()}
    ${reset ? `<p class="warn">Původní heslo bude nahrazeno. K subjektům se vrátíte záchranným klíčem subjektu, nebo vám přístup znovu udělí jiný vlastník.</p>`
      : `<p>Šifrovací heslo chrání vaše data. Je oddělené od účtu Google: kdo získá jen přístup k Google účtu, data nepřečte. Heslo si uložte do správce hesel.</p>`}
    <form id="f-pw" class="stack">
      <label>Šifrovací heslo (aspoň 12 znaků)<input name="p1" type="password" required minlength="12" autocomplete="new-password"></label>
      <label>Heslo znovu<input name="p2" type="password" required minlength="12" autocomplete="new-password"></label>
      <button class="primary">${reset ? 'Nastavit nové heslo' : 'Uložit heslo a vytvořit klíče'}</button>
    </form>
    <p>${reset ? '<button class="link" id="cancel">Zpět</button>' : ''} <button class="link" id="out">Odhlásit</button></p>
  </div>`;
  root.querySelector('#out').onclick = () => state.store.signOut();
  if (reset) root.querySelector('#cancel').onclick = () => { state.resetting = false; render(); };
  root.querySelector('#f-pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p1 = f.get('p1'), p2 = f.get('p2');
    const weak = C.checkPasswordStrength(p1);
    if (weak) { flash(weak, 'err'); return render(); }
    if (p1 !== p2) { flash('Hesla se neshodují.', 'err'); return render(); }
    busy(e.target, 'Vytvářím klíče…');
    const keys = await C.createUserKeys(p1);
    await state.store.putUser(state.auth.email, { ...keys.stored, email: state.auth.email, createdAt: new Date().toISOString() });
    state.user = await state.store.getUser(state.auth.email);
    state.privateKey = keys.privateKey;
    state.resetting = false;
    flash(reset ? 'Nové heslo je nastavené. Obnovte přístup k subjektům záchranným klíčem nebo požádejte jiného vlastníka.' : 'Heslo je nastavené.', 'ok');
    await loadSubjects();
    resetIdle();
    render();
  };
}

function renderUnlock(root) {
  root.innerHTML = `
  <div class="card narrow">
    <div class="brand"><span class="logo">A</span><div><h1>ARTUR</h1><p class="muted">${esc(state.auth.email)}</p></div></div>
    ${flashHtml()}
    <form id="f-unlock" class="stack">
      <label>Šifrovací heslo<input name="pw" type="password" required autofocus autocomplete="current-password"></label>
      <button class="primary">Odemknout</button>
    </form>
    <p class="small"><button class="link" id="forgot">Zapomněl(a) jsem heslo</button> · <button class="link" id="out">Odhlásit</button></p>
  </div>`;
  root.querySelector('#out').onclick = () => state.store.signOut();
  root.querySelector('#forgot').onclick = () => {
    if (confirm('Nastavit nové heslo? Přístup k subjektům pak obnovíte záchranným klíčem nebo vám ho znovu udělí jiný vlastník.')) { state.resetting = true; render(); }
  };
  root.querySelector('#f-unlock').onsubmit = async (e) => {
    e.preventDefault();
    busy(e.target, 'Odemykám…');
    try {
      state.privateKey = await C.unlockUserKeys(state.user, new FormData(e.target).get('pw'));
    } catch (err) { flash(err.message, 'err'); return render(); }
    await loadSubjects();
    resetIdle();
    render();
  };
}

function busy(form, text) {
  const b = form.querySelector('button.primary') || form.querySelector('button');
  if (b) { b.disabled = true; b.textContent = text; }
}

// ---------------------------------------------------------------- data
async function loadSubjects() {
  const metas = await state.store.listMySubjects(state.auth.email);
  const out = [];
  for (const meta of metas) {
    const s = { id: meta.id, meta, dek: null, data: null, access: 'ok' };
    if (meta.status === 'novy') {
      s.access = meta.members[state.auth.email] === 'vlastnik' ? 'dokoncit' : 'ceka-na-zalozeni';
    } else {
      const k = await state.store.getKey(meta.id, state.auth.email).catch(() => null);
      if (!k) s.access = 'ceka';
      else if (k.fp !== state.user.fp) s.access = 'stary-klic';
      else {
        try {
          s.dek = await C.unwrapForMe(k.wrapped, state.privateKey);
          s.data = await C.openJson(s.dek, meta.enc, 'subject:' + meta.id);
        } catch (e) { console.error(e); s.access = 'chyba'; }
      }
    }
    out.push(s);
  }
  out.sort((a, b) => subjectName(a).localeCompare(subjectName(b), 'cs'));
  state.subjects = out;
  if (!subjectById(state.current)) state.current = out.find((s) => s.access === 'ok')?.id || out[0]?.id || null;
}

async function reloadSubject(sid) {
  await loadSubjects();
  state.current = sid;
}

async function saveSubjectData(s, data) {
  const enc = await C.sealJson(s.dek, data, 'subject:' + s.id);
  await state.store.updateSubject(s.id, { enc, label: data.nazev || s.meta.label });
}

// ---------------------------------------------------------------- hlavní obrazovka
const NAV_PARENT = { faktura: 'faktury', zakaznik: 'adresar', sablona: 'sablony' };

const ctx = {
  state,
  render: () => render(),
  flash: (m, k) => flash(m, k),
  toast: (m, k) => toast(m, k),
  audit: (sid, a, d) => audit(sid, a, d),
  download: (n, b) => download(n, b),
  needSubject: (main) => needSubject(main),
  subjectName: (x) => subjectName(x),
  myRole: (x) => myRole(x),
  go: (view, id = null) => { state.view = view; state.detailId = id; render(); window.scrollTo(0, 0); },
};

const NAV = [
  ['prehled', 'Přehled'],
  ['faktury', 'Faktury'],
  ['mesic', 'Měsíční fakturace'],
  ['sablony', 'Opakované faktury'],
  ['banka', 'Banka a úhrady'],
  ['adresar', 'Adresář'],
  ['subjekt', 'Údaje subjektu'],
  ['historie', 'Historie změn'],
];
const NAV_NASTAVENI = [
  ['import', 'Import z vyfakturuj.cz'],
  ['clenove', 'Členové a přístup'],
  ['klice', 'Záchranný klíč a záloha'],
  ['admin-uzivatele', 'Uživatelé aplikace', 'admin'],
  ['ucet', 'Můj účet'],
  ['admin-novy', 'Nový subjekt', 'admin'],
];

function renderMain(root) {
  const s = cur();
  const aktivni = NAV_PARENT[state.view] || state.view;
  const nastaveni = NAV_NASTAVENI.filter(([, , a]) => !a || isAdmin());
  if (nastaveni.some(([k]) => k === aktivni)) state.navNastaveni = true;
  const navBtn = ([k, l], cls = '') => `<button data-view="${k}" class="${cls} ${aktivni === k ? 'active' : ''}">${l}</button>`;
  const navHtml = NAV.map((x) => navBtn(x)).join('')
    + `<button id="nav-nastaveni" class="nav-group ${state.navNastaveni ? 'open' : ''}" aria-expanded="${!!state.navNastaveni}">NASTAVENÍ <span class="caret">${state.navNastaveni ? '▾' : '▸'}</span></button>`
    + (state.navNastaveni ? nastaveni.map((x) => navBtn(x, 'sub')).join('') : '');
  root.innerHTML = `
  <header class="top">
    <div class="brand small"><span class="logo">A</span><strong>ARTUR</strong></div>
    <label class="switch">Subjekt
      <select id="sel-subject">${state.subjects.map((x) => `<option value="${esc(x.id)}" ${x.id === state.current ? 'selected' : ''}>${x.meta?.druh === 'adresar' ? '📒 ' : ''}${esc(subjectName(x))}${x.access !== 'ok' ? ' (bez přístupu)' : ''}</option>`).join('') || '<option>— žádný —</option>'}</select>
    </label>
    <div class="who">${esc(state.auth.email)}${isAdmin() ? ' <span class="tag">admin</span>' : ''} ${s && myRole(s) ? `<span class="tag">${ROLE_LABEL[myRole(s)]}</span>` : ''}</div>
    <button id="btn-lock" title="Zamknout">Zamknout</button>
    <button id="btn-out">Odhlásit</button>
    <button id="btn-theme" class="theme-toggle" title="${currentTheme() === 'dark' ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim'}" aria-label="Světlý / tmavý režim">${currentTheme() === 'dark' ? '☀️' : '🌙'}</button>
  </header>
  <div class="layout">
    <nav class="side">${navHtml}</nav>
    <main id="main">${flashHtml()}</main>
  </div>`;
  root.querySelector('#sel-subject').onchange = (e) => { state.current = e.target.value; render(); };
  root.querySelector('#btn-lock').onclick = () => lock('Aplikace je zamčená.');
  root.querySelector('#btn-out').onclick = () => state.store.signOut();
  root.querySelector('#btn-theme').onclick = () => { toggleTheme(); render(); };
  root.querySelectorAll('nav.side button[data-view]').forEach((b) => (b.onclick = () => { state.view = b.dataset.view; state.detailId = null; render(); }));
  root.querySelector('#nav-nastaveni').onclick = () => { state.navNastaveni = !state.navNastaveni; render(); };
  const main = root.querySelector('#main');
  const views = { faktury: (m) => viewFaktury(m, ctx), faktura: (m) => viewFaktura(m, ctx), adresar: (m) => viewAdresar(m, ctx), zakaznik: (m) => viewZakaznik(m, ctx), import: (m) => viewImport(m, ctx), mesic: (m) => viewMesic(m, ctx), banka: (m) => viewBanka(m, ctx), sablony: (m) => viewSablony(m, ctx), sablona: (m) => viewSablona(m, ctx), prehled: viewPrehled, subjekt: viewSubjekt, clenove: viewClenove, klice: viewKlice, historie: viewHistorie, ucet: viewUcet, 'admin-uzivatele': viewAdminUsers, 'admin-novy': viewAdminNew };
  const BEZ_FAKTUR = ['faktury', 'faktura', 'import', 'mesic', 'sablony', 'sablona', 'banka'];
  if (cur()?.meta?.druh === 'adresar' && BEZ_FAKTUR.includes(state.view)) {
    main.insertAdjacentHTML('beforeend', '<h1>Společný adresář</h1><p>Společný adresář nemá vlastní faktury. Pro fakturaci přepněte nahoře na konkrétní subjekt; adresář je dostupný v sekci Adresář.</p>');
    return;
  }
  (views[state.view] || viewPrehled)(main).catch((e) => { console.error(e); main.insertAdjacentHTML('beforeend', `<p class="err">${esc(e.message)}</p>`); });
}

function needSubject(main, { needAccess = true } = {}) {
  const s = cur();
  if (!s) { main.insertAdjacentHTML('beforeend', '<p>Nemáte přístup k žádnému subjektu.</p>'); return null; }
  if (needAccess && s.access !== 'ok') { main.insertAdjacentHTML('beforeend', accessBox(s)); bindAccessBox(main, s); return null; }
  return s;
}

function accessBox(s) {
  const owner = myRole(s) === 'vlastnik';
  const msg = {
    dokoncit: 'Subjekt čeká na dokončení založení. Jako vlastník ho teď dokončíte – vytvoří se šifrovací klíč a záchranný klíč.',
    'ceka-na-zalozeni': 'Subjekt zatím nedokončil vlastník.',
    ceka: 'Ke klíči subjektu zatím nemáte přístup. Musí vám ho udělit vlastník (Členové a přístup).',
    'stary-klic': 'Váš přístup je vázaný na předchozí heslo. Vlastník vám ho musí udělit znovu, nebo použijte záchranný klíč.',
    chyba: 'Data subjektu se nepodařilo dešifrovat.',
  }[s.access] || '';
  return `<div class="box warn"><h2>${esc(subjectName(s))}</h2><p>${esc(msg)}</p>
    ${s.access === 'dokoncit' ? '<button class="primary" id="btn-finish">Dokončit založení</button>' : ''}
    ${owner && ['stary-klic', 'ceka', 'chyba'].includes(s.access) ? '<button id="btn-recover">Obnovit přístup záchranným klíčem</button>' : ''}</div>`;
}

function bindAccessBox(main, s) {
  const f = main.querySelector('#btn-finish');
  if (f) f.onclick = () => { state.view = 'subjekt'; state.finishing = s.id; render(); };
  const r = main.querySelector('#btn-recover');
  if (r) r.onclick = () => recoverDialog(s);
}

// ---------------------------------------------------------------- Přehled
async function viewPrehled(main) {
  const rows = state.subjects.map((s) => {
    const role = myRole(s);
    const owners = Object.values(s.meta.members).filter((r) => r === 'vlastnik').length;
    const warns = [];
    if (s.access !== 'ok') warns.push({ dokoncit: 'čeká na dokončení', 'ceka-na-zalozeni': 'čeká na vlastníka', ceka: 'čeká na udělení přístupu', 'stary-klic': 'přístup je třeba obnovit', chyba: 'chyba dešifrování' }[s.access]);
    if (s.access === 'ok' && role === 'vlastnik' && !s.meta.recoveryConfirmed) warns.push('záchranný klíč není potvrzen');
    if (s.access === 'ok' && owners < 2 && !s.meta.recoveryConfirmed) warns.push('jediný vlastník – záchranný klíč je nutný');
    return `<tr><td><button class="link" data-open="${esc(s.id)}">${esc(subjectName(s))}</button></td>
      <td>${esc(s.data?.ico || s.meta.icoHint || '')}</td><td>${ROLE_LABEL[role] || ''}</td>
      <td>${Object.keys(s.meta.members).length}</td>
      <td>${warns.length ? warns.map((w) => `<span class="pill warn">${esc(w)}</span>`).join(' ') : '<span class="pill ok">v pořádku</span>'}</td></tr>`;
  }).join('');
  main.insertAdjacentHTML('beforeend', `<h1>Přehled</h1>
    <p class="muted">Faktury a adresář najdete v levém menu. Subjekt přepnete nahoře.</p>
    <table class="grid"><thead><tr><th>Subjekt</th><th>IČO</th><th>Moje role</th><th>Členů</th><th>Stav</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">Zatím žádný subjekt.' + (isAdmin() ? ' Založte ho v sekci Nastavení → „Nový subjekt“.' : '') + '</td></tr>'}</tbody></table>`);
  main.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { state.current = b.dataset.open; state.view = cur().access === 'ok' ? 'subjekt' : 'prehled'; if (cur().access !== 'ok') { render(); const m = document.getElementById('main'); m.insertAdjacentHTML('beforeend', accessBox(cur())); bindAccessBox(m, cur()); } else render(); }));
}

// ---------------------------------------------------------------- Údaje subjektu
function accountRows(list) {
  return (list && list.length ? list : [{ cislo: '', vychozi: true }]).map((a, i) => `
    <div class="row acc">
      <input name="acc_cislo" placeholder="např. 732627175/5500" value="${esc(a.cislo)}">
      <span class="muted small iban">${a.iban ? esc(formatIban(a.iban)) : ''}</span>
      <label class="inline"><input type="radio" name="acc_def" value="${i}" ${a.vychozi ? 'checked' : ''}> výchozí</label>
    </div>`).join('');
}

async function viewSubjekt(main) {
  const s = cur();
  if (!s) return needSubject(main);
  const finishing = s.access === 'dokoncit' && state.finishing === s.id;
  if (s.access !== 'ok' && !finishing) return needSubject(main);
  const canEdit = finishing || myRole(s) === 'vlastnik';
  const d = s.data || { nazev: s.meta.label || '', ico: s.meta.icoHint || '', ucty: [], rada: '{RRRR}{NNNN}', splatnost: 14, platceDph: false, exportMoney: false };
  main.insertAdjacentHTML('beforeend', `
    <h1>${finishing ? 'Dokončení založení: ' : ''}${esc(subjectName(s))}</h1>
    ${finishing ? '<p class="note">Vyplňte údaje dodavatele. Po uložení se vytvoří šifrovací klíč subjektu a zobrazí se záchranný klíč, který si musíte uložit.</p>' : ''}
    ${!canEdit ? '<p class="note">Údaje subjektu může měnit jen vlastník.</p>' : ''}
    <form id="f-subj" class="form2">
      <fieldset ${canEdit ? '' : 'disabled'}>
      <div class="row"><label>IČO<input name="ico" value="${esc(d.ico)}" inputmode="numeric" maxlength="8"></label>
        <button type="button" id="btn-ares">Načíst z ARES</button></div>
      <label>Název / obchodní firma<input name="nazev" required value="${esc(d.nazev)}"></label>
      <label>DIČ<input name="dic" value="${esc(d.dic)}"></label>
      <label>Ulice a číslo<input name="ulice" value="${esc(d.ulice)}"></label>
      <div class="row"><label>PSČ<input name="psc" value="${esc(d.psc)}" maxlength="6"></label><label class="grow">Obec<input name="obec" value="${esc(d.obec)}"></label></div>
      <label>Zápis v rejstříku<input name="zapis" placeholder="např. C 12345 vedená u Krajského soudu v Českých Budějovicích" value="${esc(d.zapis)}"></label>
      <div class="row"><label class="grow">E-mail pro faktury<input name="email" type="email" value="${esc(d.email)}"></label><label>Telefon<input name="telefon" value="${esc(d.telefon)}"></label></div>
      <label>Web<input name="web" value="${esc(d.web)}"></label>
      <h2>Bankovní účty</h2>
      <div id="accs">${accountRows(d.ucty)}</div>
      <button type="button" id="btn-acc-add" class="small">+ další účet</button>
      <h2>Fakturace</h2>
      <div class="row">
        <label>Číselná řada<input name="rada" value="${esc(d.rada || '{RRRR}{NNNN}')}"></label>
        <label>Splatnost (dní)<input name="splatnost" type="number" min="0" max="120" value="${esc(d.splatnost ?? 14)}"></label>
      </div>
      <p class="muted small">{RRRR} = rok, {NNNN} = pořadové číslo. Pokračování řad z vyfakturuj.cz se nastaví při migraci (etapa 2).</p>
      <label>Text v patičce faktury<input name="paticka" value="${esc(d.paticka)}" placeholder="Vystaveno v systému ARTUR"></label>
      <label>Výchozí úvodní text faktury<input name="uvodText" value="${esc(d.uvodText)}" placeholder="např. Na základě uzavřené smlouvy Vám fakturujeme následující služby:"></label>
      <div class="row">
        <label>Řada zálohových faktur<input name="radaZal" value="${esc(d.radaZal || 'ZF{RRRR}{NNNN}')}"></label>
        <label>Řada opravných dokladů<input name="radaOpr" value="${esc(d.radaOpr || 'OD{RRRR}{NNNN}')}"></label>
      </div>
      <label>Poslední číslo faktury vystavené mimo ARTUR v roce ${new Date().getFullYear()} (pořadí, např. 63 pro ${new Date().getFullYear()}0063)<input name="posledniCislo" type="number" min="0" value="${esc((d.posledniCislo || {})['faktura:' + new Date().getFullYear()] ?? '')}"></label>
      <label class="inline"><input type="checkbox" name="exportMoney" ${d.exportMoney ? 'checked' : ''}> Exportovat do Money S3</label>
      <h2>E-mail s fakturou</h2>
      <label>Předmět<input name="emailPredmet" value="${esc(d.emailPredmet || VYCHOZI_PREDMET)}"></label>
      <label>Text e-mailu<textarea name="emailText" rows="8">${esc(d.emailText || VYCHOZI_TEXT)}</textarea></label>
      <p class="muted small">Proměnné: {cislo}, {castka}, {splatnost}, {vystaveno}, {ucet}, {vs}, {dodavatel}, {odberatel}.</p>
      <label class="inline"><input type="checkbox" name="emailKopie" ${d.emailKopie !== false ? 'checked' : ''}> Posílat kopii (skrytě) odesílateli</label>
      <p class="muted small">DPH: neplátce (text „Nejsem plátce DPH“ na faktuře).</p>
      </fieldset>
      ${canEdit ? `<button class="primary">${finishing ? 'Uložit a vytvořit klíč subjektu' : 'Uložit změny'}</button>` : ''}
    </form>`);
  const form = main.querySelector('#f-subj');
  main.querySelector('#btn-ares').onclick = async () => {
    const btn = main.querySelector('#btn-ares'); btn.disabled = true; btn.textContent = 'Načítám…';
    try {
      const r = await aresLookup(form.ico.value);
      for (const k of ['nazev', 'dic', 'ulice', 'psc', 'obec']) if (r[k]) form[k].value = r[k];
      form.ico.value = r.ico;
      toast('Údaje načteny z ARES.');
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false; btn.textContent = 'Načíst z ARES';
  };
  main.querySelector('#btn-acc-add').onclick = () => main.querySelector('#accs').insertAdjacentHTML('beforeend', accountRows([{ cislo: '' }]).replace('checked', ''));
  main.querySelector('#accs').addEventListener('input', (e) => {
    if (e.target.name !== 'acc_cislo') return;
    const a = parseAccount(e.target.value);
    e.target.closest('.acc').querySelector('.iban').textContent = a ? (a.valid ? formatIban(ibanFromAccount(a)) : 'neplatné číslo účtu') : '';
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const ico = String(f.get('ico') || '').replace(/\s/g, '');
    if (ico && !icoValid(ico)) return toast('IČO nemá platný kontrolní součet.', 'err');
    const accInputs = [...form.querySelectorAll('input[name=acc_cislo]')];
    const def = Number(f.get('acc_def') ?? 0);
    const ucty = [];
    for (const [i, inp] of accInputs.entries()) {
      const v = inp.value.trim(); if (!v) continue;
      const a = parseAccount(v);
      if (!a || !a.valid) return toast('Neplatné číslo účtu: ' + v, 'err');
      ucty.push({ cislo: (a.prefix ? a.prefix + '-' : '') + a.number + '/' + a.bank, iban: ibanFromAccount(a), mena: 'CZK', vychozi: i === def });
    }
    if (ucty.length && !ucty.some((u) => u.vychozi)) ucty[0].vychozi = true;
    const data = {
      ...(s.data || {}),
      nazev: f.get('nazev').trim(), ico, dic: f.get('dic').trim(), ulice: f.get('ulice').trim(), psc: f.get('psc').trim(), obec: f.get('obec').trim(),
      zapis: f.get('zapis').trim(), email: f.get('email').trim(), telefon: f.get('telefon').trim(), web: f.get('web').trim(),
      ucty, rada: f.get('rada').trim() || '{RRRR}{NNNN}', splatnost: Number(f.get('splatnost') || 14), paticka: f.get('paticka').trim(), uvodText: f.get('uvodText').trim(),
      emailPredmet: f.get('emailPredmet').trim(), emailText: f.get('emailText'), emailKopie: f.get('emailKopie') === 'on',
      radaZal: f.get('radaZal').trim() || 'ZF{RRRR}{NNNN}', radaOpr: f.get('radaOpr').trim() || 'OD{RRRR}{NNNN}',
      posledniCislo: { ...((s.data || {}).posledniCislo || {}), ['faktura:' + new Date().getFullYear()]: Number(f.get('posledniCislo') || 0) },
      exportMoney: f.get('exportMoney') === 'on', platceDph: false,
    };
    busy(form, 'Ukládám…');
    try {
      if (finishing) await finishSubject(s, data);
      else { await saveSubjectData(s, data); await audit(s.id, 'subjekt.upraven'); await reloadSubject(s.id); flash('Údaje subjektu uloženy.'); render(); }
    } catch (err) { console.error(err); flash('Uložení se nezdařilo: ' + err.message, 'err'); render(); }
  };
}

async function finishSubject(s, data) {
  const dek = await C.newSubjectKey();
  const sid = s.id;
  const mine = await C.wrapForUser(dek, state.user.publicKey);
  await state.store.putKey(sid, state.auth.email, { ...mine, by: state.auth.email });
  const enc = await C.sealJson(dek, data, 'subject:' + sid);
  const keyCheck = await C.makeKeyCheck(dek, sid);
  await state.store.updateSubject(sid, { enc, keyCheck, status: 'aktivni', label: data.nazev, activatedBy: state.auth.email, activatedAt: new Date().toISOString() });
  await audit(sid, 'subjekt.aktivovan', data.nazev);
  state.finishing = null;
  await reloadSubject(sid);
  state.view = 'klice';
  state.showRecoveryFor = sid;
  flash('Subjekt je založený a zašifrovaný. Teď si uložte záchranný klíč.', 'ok');
  render();
}

// ---------------------------------------------------------------- Členové
async function memberStatus(sid, email, keys) {
  const u = await state.store.getUser(email).catch(() => null);
  const k = keys ? keys.find((x) => x.id === email) : null;
  if (!u) return { code: 'neprihlasen', label: 'zatím se nepřihlásil(a)', user: null };
  if (!k) return { code: 'ceka', label: 'čeká na udělení přístupu', user: u };
  if (k.fp !== u.fp) return { code: 'znovu', label: 'změnil(a) heslo – udělit znovu', user: u };
  return { code: 'ok', label: 'má přístup', user: u };
}

async function viewClenove(main) {
  const s = needSubject(main); if (!s) return;
  const owner = myRole(s) === 'vlastnik';
  const keys = owner ? await state.store.listKeys(s.id) : null;
  const members = Object.entries(s.meta.members).sort((a, b) => ROLES.indexOf(a[1]) - ROLES.indexOf(b[1]) || a[0].localeCompare(b[0]));
  const stats = {};
  for (const [e] of members) stats[e] = owner ? await memberStatus(s.id, e, keys) : null;
  main.insertAdjacentHTML('beforeend', `
    <h1>Členové a přístup – ${esc(subjectName(s))}</h1>
    <p class="muted">Přístup k datům má jen člen, kterému vlastník udělí klíč subjektu. Přidaný člen se musí nejdřív přihlásit a nastavit si šifrovací heslo.</p>
    <table class="grid"><thead><tr><th>E-mail</th><th>Role</th>${owner ? '<th>Stav klíče</th><th></th>' : ''}</tr></thead><tbody>
    ${members.map(([e, r]) => `<tr><td>${esc(e)}${e === state.auth.email ? ' <span class="muted">(vy)</span>' : ''}</td>
      <td>${owner && e !== state.auth.email ? `<select data-role="${esc(e)}">${ROLES.map((x) => `<option value="${x}" ${x === r ? 'selected' : ''}>${ROLE_LABEL[x]}</option>`).join('')}</select>` : ROLE_LABEL[r]}</td>
      ${owner ? `<td><span class="pill ${stats[e].code === 'ok' ? 'ok' : 'warn'}">${esc(stats[e].label)}</span></td>
      <td>${['ceka', 'znovu'].includes(stats[e].code) ? `<button class="primary small" data-grant="${esc(e)}">Udělit přístup</button>` : ''}
          ${e !== state.auth.email ? `<button class="small danger" data-remove="${esc(e)}">Odebrat</button>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table>
    ${owner ? `<h2>Přidat člena</h2>
    <form id="f-add" class="row">
      <input name="email" type="email" placeholder="e-mail (účet Google)" required>
      <select name="role">${ROLES.map((x) => `<option value="${x}" ${x === 'ucetni' ? 'selected' : ''}>${ROLE_LABEL[x]}</option>`).join('')}</select>
      <button class="primary">Přidat</button>
    </form>
    <p class="muted small">E-mail musí být zároveň v seznamu Nastavení → „Uživatelé aplikace“ u administrátora, jinak se člen nepřihlásí.</p>` : ''}`);
  if (!owner) return;
  main.querySelectorAll('[data-grant]').forEach((b) => (b.onclick = async () => {
    const e = b.dataset.grant; const u = stats[e].user;
    if (!confirm(`Udělit ${e} přístup k datům subjektu ${subjectName(s)}?\nOtisk klíče uživatele: ${u.fp}`)) return;
    const w = await C.wrapForUser(s.dek, u.publicKey);
    await state.store.putKey(s.id, e, { ...w, by: state.auth.email });
    await audit(s.id, 'pristup.udelen', e);
    flash(`Přístup udělen: ${e}`); await reloadSubject(s.id); render();
  }));
  main.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    const e = b.dataset.remove;
    if (!confirm(`Odebrat ${e} ze subjektu?`)) return;
    const members2 = { ...s.meta.members }; delete members2[e];
    if (!Object.values(members2).includes('vlastnik')) return toast('Subjekt musí mít aspoň jednoho vlastníka.', 'err');
    await state.store.deleteKey(s.id, e).catch(() => {});
    await state.store.updateSubject(s.id, { members: members2, memberEmails: Object.keys(members2) });
    await audit(s.id, 'clen.odebran', e);
    flash(`Odebráno: ${e}. Pro úplné odříznutí přístupu ke starým datům bude v etapě 7 k dispozici výměna klíče subjektu.`, 'info');
    await reloadSubject(s.id); render();
  }));
  main.querySelectorAll('[data-role]').forEach((sel) => (sel.onchange = async () => {
    const e = sel.dataset.role;
    const members2 = { ...s.meta.members, [e]: sel.value };
    await state.store.updateSubject(s.id, { members: members2, memberEmails: Object.keys(members2) });
    await audit(s.id, 'clen.role', `${e}: ${sel.value}`);
    flash(`Role změněna: ${e} → ${ROLE_LABEL[sel.value]}`); await reloadSubject(s.id); render();
  }));
  main.querySelector('#f-add').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target); const e = lower(f.get('email'));
    if (!emailOk(e)) return toast('Neplatný e-mail.', 'err');
    if (s.meta.members[e]) return toast('Už je členem.', 'err');
    const members2 = { ...s.meta.members, [e]: f.get('role') };
    await state.store.updateSubject(s.id, { members: members2, memberEmails: Object.keys(members2) });
    await audit(s.id, 'clen.pridan', `${e}: ${f.get('role')}`);
    flash(`Přidáno: ${e}. Po jeho prvním přihlášení mu udělte přístup.`); await reloadSubject(s.id); render();
  };
}

// ---------------------------------------------------------------- Klíče a záloha
function recoveryFileText(s, key) {
  const d = s.data || {};
  return [
    'ARTUR – ZÁCHRANNÝ KLÍČ SUBJEKTU',
    '================================',
    '',
    `Subjekt:     ${d.nazev || s.meta.label}`,
    `IČO:         ${d.ico || ''}`,
    `ID subjektu: ${s.id}`,
    `Vytvořeno:   ${new Date().toLocaleString('cs-CZ')} (${state.auth.email})`,
    '',
    'Záchranný klíč:',
    '',
    '    ' + key,
    '',
    'K čemu slouží: když vlastník zapomene šifrovací heslo nebo nikdo jiný nemá',
    'k subjektu přístup, tímto klíčem se přístup obnoví (ARTUR → Záchranný klíč',
    'a záloha → Obnovit přístup). Bez hesla i bez tohoto klíče data nikdo nepřečte.',
    '',
    'Uložte: 1) do složky FAKTUR (OneDrive POSTME), 2) do správce hesel / trezoru.',
    'Nesdílejte e-mailem ani chatem.',
    '',
  ].join('\r\n');
}

async function viewKlice(main) {
  const s = cur();
  if (!s) return needSubject(main);
  const owner = myRole(s) === 'vlastnik';
  if (s.access !== 'ok') {
    main.insertAdjacentHTML('beforeend', accessBox(s)); bindAccessBox(main, s); return;
  }
  const conf = s.meta.recoveryConfirmed;
  const showNow = state.showRecoveryFor === s.id;
  main.insertAdjacentHTML('beforeend', `
    <h1>Záchranný klíč a záloha – ${esc(subjectName(s))}</h1>
    ${owner ? `
    <section class="box ${conf ? '' : 'warn'}">
      <h2>Záchranný klíč</h2>
      <p>${conf ? `Uložení potvrdil(a) ${esc(conf.by)} dne ${esc(fmtDate(conf.at))}.` : '<strong>Záchranný klíč zatím nikdo nepotvrdil.</strong> Bez něj by ztráta hesla všech vlastníků znamenala ztrátu dat.'}</p>
      <div id="rk-area">${showNow ? '' : '<button class="primary" id="btn-show-rk">Zobrazit a stáhnout záchranný klíč</button>'}</div>
    </section>` : '<p class="note">Záchranný klíč spravuje vlastník subjektu.</p>'}
    <section class="box">
      <h2>Záloha dat</h2>
      <p>Stáhne šifrovanou zálohu subjektu (JSON). K obnovení je potřeba záchranný klíč. Doporučeno ukládat měsíčně do složky FAKTUR.</p>
      <button id="btn-backup">Stáhnout zálohu</button>
    </section>
    ${owner ? `<section class="box"><h2>Obnovit přístup</h2><p>Použijte, pokud jste si nastavili nové heslo a nikdo jiný vám přístup neudělí.</p>
      <button id="btn-recover2">Obnovit přístup záchranným klíčem</button></section>` : ''}`);
  if (owner) {
    const showRk = async () => {
      const key = await C.exportRecoveryKey(s.dek);
      const area = main.querySelector('#rk-area');
      const groups = key.split('-');
      const ask = [1, groups.length - 2];
      area.innerHTML = `
        <div class="rk"><code id="rk-code">${esc(key)}</code></div>
        <div class="row"><button id="btn-dl-rk" class="primary">Stáhnout soubor</button><button id="btn-copy-rk">Kopírovat</button><button id="btn-print-rk">Vytisknout</button></div>
        <form id="f-rk-confirm" class="stack">
          <p>Pro potvrzení opište ${ask[0] + 1}. a ${ask[1] + 1}. skupinu znaků:</p>
          <div class="row"><input name="g1" placeholder="${ask[0] + 1}. skupina" maxlength="5" required><input name="g2" placeholder="${ask[1] + 1}. skupina" maxlength="5" required></div>
          <button class="primary">Potvrzuji, že je klíč uložený</button>
        </form>`;
      const fname = `ARTUR-klic-${(s.data.ico || s.id)}-${(s.data.nazev || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.txt`;
      area.querySelector('#btn-dl-rk').onclick = () => download(fname, recoveryFileText(s, key));
      area.querySelector('#btn-copy-rk').onclick = async () => { try { await navigator.clipboard.writeText(key); toast('Zkopírováno.'); } catch { toast('Kopírování se nepovedlo.', 'err'); } };
      area.querySelector('#btn-print-rk').onclick = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(`<pre style="font:14px monospace">${esc(recoveryFileText(s, key))}</pre>`); w.document.close(); w.print(); };
      area.querySelector('#f-rk-confirm').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const norm = (x) => String(x || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
        if (norm(f.get('g1')) !== groups[ask[0]] || norm(f.get('g2')) !== groups[ask[1]]) return toast('Skupiny nesouhlasí. Zkontrolujte uložený klíč.', 'err');
        await state.store.updateSubject(s.id, { recoveryConfirmed: { by: state.auth.email, at: new Date().toISOString() } });
        await audit(s.id, 'klic.potvrzen');
        state.showRecoveryFor = null;
        flash('Uložení záchranného klíče potvrzeno.'); await reloadSubject(s.id); render();
      };
    };
    if (showNow) showRk();
    else main.querySelector('#btn-show-rk').onclick = async () => {
      const pw = prompt('Pro zobrazení záchranného klíče zadejte své šifrovací heslo:');
      if (pw == null) return;
      try { await C.unlockUserKeys(state.user, pw); } catch (e) { return toast(e.message, 'err'); }
      showRk();
    };
    main.querySelector('#btn-recover2').onclick = () => recoverDialog(s);
  }
  main.querySelector('#btn-backup').onclick = async () => {
    const docs = await state.store.listDocs(s.id);
    const meta = { ...s.meta }; delete meta.id;
    const payload = { artur: 'zaloha', verze: 1, vytvoreno: new Date().toISOString(), subjektId: s.id, subjekt: meta, dokumenty: docs };
    download(`ARTUR-zaloha-${s.data.ico || s.id}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 1), 'application/json');
    await audit(s.id, 'zaloha.stazena');
  };
}

async function recoverDialog(s) {
  const text = prompt(`Zadejte záchranný klíč subjektu ${subjectName(s)}:`);
  if (!text) return;
  try {
    const dek = await C.importRecoveryKey(text);
    if (!(await C.verifyKeyCheck(dek, s.meta.keyCheck, s.id))) throw new Error('Tento záchranný klíč nepatří k subjektu ' + subjectName(s) + '.');
    const w = await C.wrapForUser(dek, state.user.publicKey);
    await state.store.putKey(s.id, state.auth.email, { ...w, by: state.auth.email, via: 'zachranny-klic' });
    await audit(s.id, 'klic.obnoven', state.auth.email);
    await reloadSubject(s.id);
    flash('Přístup obnoven záchranným klíčem.'); render();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- Historie
async function viewHistorie(main) {
  const s = needSubject(main, { needAccess: false }); if (!s) return;
  const rows = await state.store.listAudit(s.id, 100);
  for (const r of rows) if (r.enc && s.dek) { try { r.detail = (await C.openJson(s.dek, r.enc, 'audit:' + s.id)).detail; } catch { r.detail = '?'; } }
  const L = { 'subjekt.zalozen': 'Subjekt založen', 'subjekt.aktivovan': 'Založení dokončeno, vytvořen klíč', 'subjekt.upraven': 'Údaje subjektu upraveny', 'clen.pridan': 'Člen přidán', 'clen.odebran': 'Člen odebrán', 'clen.role': 'Změna role', 'pristup.udelen': 'Přístup udělen', 'klic.potvrzen': 'Záchranný klíč potvrzen', 'klic.obnoven': 'Přístup obnoven záchranným klíčem', 'zaloha.stazena': 'Záloha stažena', 'zakaznik.zalozen': 'Zákazník založen', 'zakaznik.upraven': 'Zákazník upraven', 'faktura.vystavena': 'Faktura vystavena', 'faktura.uhrada': 'Úhrada zaznamenána', 'faktura.uhrada-zrusena': 'Úhrada zrušena', 'faktura.stornovana': 'Faktura stornována', 'faktura.koncept-zahozen': 'Koncept zahozen', 'migrace.import': 'Import z vyfakturuj.cz', 'faktura.odeslana': 'Faktura odeslána e-mailem', 'faktura.oprava': 'Oprava faktury', 'sablona.zalozena': 'Šablona založena', 'sablona.upravena': 'Šablona upravena', 'mesic.koncepty': 'Koncepty ze šablon', 'zakaznik.slouceno': 'Zákazníci sloučeni', 'adresar.prevod': 'Převod do společného adresáře', 'banka.import': 'Nahrání výpisů', 'banka.parovani': 'Párování úhrady', 'migrace.uhrady': 'Úhrady z vyfakturuj.cz' };
  main.insertAdjacentHTML('beforeend', `<h1>Historie změn – ${esc(subjectName(s))}</h1>
    <table class="grid"><thead><tr><th>Kdy</th><th>Kdo</th><th>Co</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(fmtDate(r.at))}</td><td>${esc(r.by)}</td><td>${esc(L[r.action] || r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="4">Žádné záznamy.</td></tr>'}
    </tbody></table>`);
}

// ---------------------------------------------------------------- Můj účet
async function viewUcet(main) {
  main.insertAdjacentHTML('beforeend', `<h1>Můj účet</h1>
    <p>${esc(state.auth.email)}${isAdmin() ? ' – administrátor' : ''}</p>
    <p class="muted small">Otisk vašeho klíče: <code>${esc(state.user.fp)}</code> (vlastník ho vidí při udělování přístupu)</p>
    <h2>Změna šifrovacího hesla</h2>
    <form id="f-chpw" class="stack narrow-form">
      <label>Současné heslo<input name="old" type="password" required autocomplete="current-password"></label>
      <label>Nové heslo (aspoň 12 znaků)<input name="p1" type="password" required minlength="12" autocomplete="new-password"></label>
      <label>Nové heslo znovu<input name="p2" type="password" required minlength="12" autocomplete="new-password"></label>
      <button class="primary">Změnit heslo</button>
    </form>
    <p class="muted small">Při změně hesla zůstává přístup ke všem subjektům zachován.</p>`);
  main.querySelector('#f-chpw').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const weak = C.checkPasswordStrength(f.get('p1')); if (weak) return toast(weak, 'err');
    if (f.get('p1') !== f.get('p2')) return toast('Nová hesla se neshodují.', 'err');
    busy(e.target, 'Měním…');
    try {
      const stored = await C.rewrapPrivateKey(state.user, f.get('old'), f.get('p1'));
      await state.store.putUser(state.auth.email, { encPrivateKey: stored.encPrivateKey });
      state.user = await state.store.getUser(state.auth.email);
      flash('Heslo změněno.');
    } catch (err) { flash(err.message, 'err'); }
    render();
  };
}

// ---------------------------------------------------------------- Admin: uživatelé
async function viewAdminUsers(main) {
  const list = await state.store.listAllowed();
  list.sort((a, b) => a.id.localeCompare(b.id));
  main.insertAdjacentHTML('beforeend', `<h1>Uživatelé aplikace</h1>
    <p class="muted">Kdo se smí do ARTURa přihlásit. K jednotlivým subjektům je pak přidává jejich vlastník.</p>
    <table class="grid"><thead><tr><th>E-mail</th><th>Jméno</th><th>Šifrovací heslo</th><th></th></tr></thead><tbody>
    ${(await Promise.all(list.map(async (u) => { const p = await state.store.getUser(u.id).catch(() => null);
      return `<tr><td>${esc(u.id)}</td><td>${esc(u.name)}</td><td>${p ? '<span class="pill ok">nastaveno</span>' : '<span class="pill warn">zatím ne</span>'}</td>
      <td>${ADMIN_EMAILS.includes(u.id) ? '<span class="muted small">administrátor</span>' : `<button class="small danger" data-del="${esc(u.id)}">Zakázat přihlášení</button>`}</td></tr>`; }))).join('')}
    </tbody></table>
    <h2>Povolit přihlášení</h2>
    <form id="f-allow" class="row"><input name="email" type="email" placeholder="e-mail (účet Google)" required><input name="name" placeholder="jméno"><button class="primary">Povolit</button></form>`);
  main.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`Zakázat přihlášení ${b.dataset.del}? (Ze subjektů ho odeberte zvlášť u každého subjektu.)`)) return;
    await state.store.removeAllowed(b.dataset.del); flash('Přihlášení zakázáno: ' + b.dataset.del); render();
  }));
  main.querySelector('#f-allow').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const em = lower(f.get('email'));
    if (!emailOk(em)) return toast('Neplatný e-mail.', 'err');
    await state.store.setAllowed(em, { name: f.get('name').trim(), addedBy: state.auth.email });
    flash('Povoleno: ' + em); render();
  };
}

// ---------------------------------------------------------------- Admin: nový subjekt
async function viewAdminNew(main) {
  main.insertAdjacentHTML('beforeend', `<h1>Nový subjekt (IČO)</h1>
    <p class="muted">Založíte subjekt a určíte jeho členy. Šifrovací klíč vytvoří až vlastník při dokončení založení – pokud sebe neuvedete, k datům subjektu přístup mít nebudete.</p>
    <form id="f-new" class="form2">
      <div class="row"><label>IČO<input name="ico" inputmode="numeric" maxlength="8"></label><button type="button" id="btn-ares2">Načíst název z ARES</button></div>
      <label>Název subjektu<input name="label" required></label>
      <label class="inline"><input type="checkbox" name="adresar" id="chk-adresar" ${state.subjects.some((x) => x.meta?.druh === 'adresar') ? 'disabled' : ''}> Společný adresář pro všechny subjekty (místo IČO)${state.subjects.some((x) => x.meta?.druh === 'adresar') ? ' – už existuje' : ''}</label>
      <h2>Členové</h2>
      <div id="mem">${memberRow(state.auth.email, 'vlastnik')}</div>
      <button type="button" id="btn-mem-add" class="small">+ další člen</button>
      <button class="primary">Založit subjekt</button>
    </form>`);
  const form = main.querySelector('#f-new');
  main.querySelector('#chk-adresar').onchange = async (e) => {
    if (!e.target.checked) return;
    form.label.value = 'Společný adresář'; form.ico.value = '';
    const users = (await state.store.listAllowed()).map((u) => u.id).filter((x) => x !== state.auth.email).sort();
    main.querySelector('#mem').innerHTML = memberRow(state.auth.email, 'vlastnik') + users.map((u) => memberRow(u, 'ucetni')).join('');
  };
  main.querySelector('#btn-mem-add').onclick = () => main.querySelector('#mem').insertAdjacentHTML('beforeend', memberRow('', 'ucetni'));
  main.querySelector('#mem').addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('.row').remove(); });
  main.querySelector('#btn-ares2').onclick = async () => {
    try { const r = await aresLookup(form.ico.value); form.label.value = r.nazev; form.ico.value = r.ico; toast('Načteno z ARES.'); } catch (e) { toast(e.message, 'err'); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ico = form.ico.value.replace(/\s/g, '');
    if (ico && !icoValid(ico)) return toast('IČO nemá platný kontrolní součet.', 'err');
    const members = {};
    for (const row of form.querySelectorAll('#mem .row')) {
      const em = lower(row.querySelector('input').value); const r = row.querySelector('select').value;
      if (!em) continue; if (!emailOk(em)) return toast('Neplatný e-mail: ' + em, 'err'); members[em] = r;
    }
    if (!Object.values(members).includes('vlastnik')) return toast('Subjekt musí mít aspoň jednoho vlastníka.', 'err');
    const label = form.label.value.trim();
    busy(form, 'Zakládám…');
    const druh = form.adresar.checked ? { druh: 'adresar' } : {};
    const sid = await state.store.createSubject({ status: 'novy', label, icoHint: ico, members, memberEmails: Object.keys(members), createdBy: state.auth.email, ...druh });
    for (const em of Object.keys(members)) if (!(await state.store.listAllowed()).some((u) => u.id === em)) await state.store.setAllowed(em, { name: '', addedBy: state.auth.email });
    if (members[state.auth.email]) await audit(sid, 'subjekt.zalozen', label);
    await loadSubjects();
    if (members[state.auth.email]) { state.current = sid; state.view = members[state.auth.email] === 'vlastnik' ? 'subjekt' : 'prehled'; state.finishing = members[state.auth.email] === 'vlastnik' ? sid : null; }
    else state.view = 'prehled';
    flash(members[state.auth.email] ? `Subjekt ${label} založen.` : `Subjekt ${label} založen. Dokončí ho vlastník při svém přihlášení; vy k němu přístup nemáte.`);
    render();
  };
}

function memberRow(email, role) {
  return `<div class="row"><input type="email" placeholder="e-mail" value="${esc(email)}"><select>${ROLES.map((x) => `<option value="${x}" ${x === role ? 'selected' : ''}>${ROLE_LABEL[x]}</option>`).join('')}</select><button type="button" class="small" data-rm>×</button></div>`;
}

// ---------------------------------------------------------------- drobnosti
function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}
