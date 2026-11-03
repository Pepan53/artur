// ARTUR – etapa 1: adresář zákazníků a faktury.
import * as C from './crypto.js?v=0.2.0';
import { aresLookup, icoValid } from './czech.js?v=0.2.0';
import { TYPY, STAVY, soucet, radkaCelkem, uhrazeno, stavPodleUhrad, poSplatnosti, dalsiCislo, vsZCisla, addDays, czk, datum, round2 } from './invoices.js?v=0.2.0';
import { invoicePdfBlob, pdfFileName } from './pdf.js?v=0.2.0';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : C.b64.from(C.randomBytes(12)).replace(/[^a-zA-Z0-9]/g, ''));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------- data
export async function loadDocs(ctx, s, force = false) {
  if (s.docsLoaded && !force) return;
  const rows = await ctx.state.store.listDocs(s.id);
  const zak = []; const fa = [];
  for (const r of rows) {
    try {
      const obj = await C.openJson(s.dek, r.enc, `doc:${s.id}:${r.id}`);
      obj.id = r.id;
      if (r.t === 'zak') zak.push(obj); else if (r.t === 'fa') fa.push(obj);
    } catch (e) { console.error('Nelze dešifrovat dokument', r.id, e); }
  }
  s.zakaznici = zak.sort((a, b) => (a.nazev || '').localeCompare(b.nazev || '', 'cs'));
  s.faktury = fa;
  s.docsLoaded = true;
}

async function saveDoc(ctx, s, t, obj) {
  const id = obj.id || uid();
  const data = { ...obj }; delete data.id;
  data.zmeneno = new Date().toISOString(); data.zmenil = ctx.state.auth.email;
  const enc = await C.sealJson(s.dek, data, `doc:${s.id}:${id}`);
  await ctx.state.store.putDoc(s.id, id, { t, enc });
  obj.id = id;
  return id;
}

const canWrite = (ctx, s) => ['vlastnik', 'ucetni'].includes(ctx.myRole(s));

function zakaznikText(z) { return [z.nazev, z.ico ? `IČO ${z.ico}` : '', z.obec].filter(Boolean).join(' · '); }

// ---------------------------------------------------------------- ADRESÁŘ
export async function viewAdresar(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const st = ctx.state.ui.adresar ||= { q: '', archiv: false };
  const list = s.zakaznici.filter((z) => (st.archiv || !z.archiv) && (!st.q || norm([z.nazev, z.ico, z.obec, (z.emaily || []).join(' ')].join(' ')).includes(norm(st.q))));
  const fakturace = {};
  for (const f of s.faktury) if (f.zakaznikId && f.stav !== 'koncept' && !f.smazano) fakturace[f.zakaznikId] = (fakturace[f.zakaznikId] || 0) + 1;
  main.insertAdjacentHTML('beforeend', `
    <div class="head-row"><h1>Adresář – ${esc(ctx.subjectName(s))}</h1>${canWrite(ctx, s) ? '<button class="primary" id="btn-new-zak">+ Nový zákazník</button>' : ''}</div>
    <div class="row filters"><input id="q" placeholder="Hledat název, IČO, obec, e-mail" value="${esc(st.q)}"><label class="inline"><input type="checkbox" id="archiv" ${st.archiv ? 'checked' : ''}> i archivovaní</label></div>
    <table class="grid"><thead><tr><th>Název</th><th>IČO</th><th>Obec</th><th>E-mail</th><th class="num">Faktur</th></tr></thead><tbody>
    ${list.map((z) => `<tr class="click${z.archiv ? ' dim' : ''}" data-id="${esc(z.id)}"><td>${esc(z.nazev)}${z.archiv ? ' <span class="pill">archiv</span>' : ''}</td><td>${esc(z.ico)}</td><td>${esc(z.obec)}</td><td>${esc((z.emaily || [])[0] || '')}</td><td class="num">${fakturace[z.id] || ''}</td></tr>`).join('') || '<tr><td colspan="5">Žádní zákazníci.</td></tr>'}
    </tbody></table>
    <p class="muted small">${list.length} z ${s.zakaznici.length} zákazníků. Import z vyfakturuj.cz přijde v etapě 2.</p>`);
  const q = main.querySelector('#q');
  q.oninput = () => { st.q = q.value; clearTimeout(st.t); st.t = setTimeout(() => { ctx.render(); const el = document.getElementById('q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
  main.querySelector('#archiv').onchange = (e) => { st.archiv = e.target.checked; ctx.render(); };
  main.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => { ctx.go('zakaznik', tr.dataset.id); }));
  const nb = main.querySelector('#btn-new-zak'); if (nb) nb.onclick = () => ctx.go('zakaznik', 'novy');
}

export async function viewZakaznik(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const id = ctx.state.detailId;
  const z = id === 'novy' ? { emaily: [], ucty: [] } : s.zakaznici.find((x) => x.id === id);
  if (!z) { main.insertAdjacentHTML('beforeend', '<p>Zákazník nenalezen.</p>'); return; }
  const rw = canWrite(ctx, s);
  const fa = s.faktury.filter((f) => f.zakaznikId === z.id && !f.smazano).sort((a, b) => (b.datumVystaveni || '').localeCompare(a.datumVystaveni || ''));
  main.insertAdjacentHTML('beforeend', `
    <p><button class="link" id="back">← Adresář</button></p>
    <h1>${id === 'novy' ? 'Nový zákazník' : esc(z.nazev)}</h1>
    <form id="f-zak" class="form2"><fieldset ${rw ? '' : 'disabled'}>
      <div class="row"><label>IČO<input name="ico" value="${esc(z.ico)}" inputmode="numeric" maxlength="8"></label><button type="button" id="btn-ares">Načíst z ARES</button></div>
      <label>Název / jméno<input name="nazev" required value="${esc(z.nazev)}"></label>
      <div class="row"><label>DIČ<input name="dic" value="${esc(z.dic)}"></label><label class="grow">Kontaktní osoba / 2. řádek<input name="kontakt" value="${esc(z.kontakt)}"></label></div>
      <label>Ulice a číslo<input name="ulice" value="${esc(z.ulice)}"></label>
      <div class="row"><label>PSČ<input name="psc" value="${esc(z.psc)}" maxlength="6"></label><label class="grow">Obec<input name="obec" value="${esc(z.obec)}"></label><label>Země<input name="zeme" value="${esc(z.zeme || 'Česká republika')}"></label></div>
      <label>E-maily pro zasílání faktur (oddělte čárkou)<input name="emaily" value="${esc((z.emaily || []).join(', '))}"></label>
      <div class="row"><label>Splatnost (dní, prázdné = výchozí)<input name="splatnost" type="number" min="0" max="120" value="${esc(z.splatnost ?? '')}"></label></div>
      <label>Známé účty zákazníka (pro párování plateb, oddělte čárkou)<input name="ucty" value="${esc((z.ucty || []).join(', '))}" placeholder="např. 604232339/0800"></label>
      <label>Poznámka<input name="poznamka" value="${esc(z.poznamka)}"></label>
      <label class="inline"><input type="checkbox" name="archiv" ${z.archiv ? 'checked' : ''}> Archivovaný (nenabízí se v nových fakturách)</label>
      </fieldset>
      ${rw ? `<div class="row"><button class="primary">Uložit</button>${id !== 'novy' ? '<button type="button" id="btn-fa-zak">+ Nová faktura pro zákazníka</button>' : ''}</div>` : ''}
    </form>
    ${id !== 'novy' ? `<h2>Faktury zákazníka</h2>${fakturyTable(fa)}` : ''}`);
  main.querySelector('#back').onclick = () => ctx.go('adresar');
  bindFakturyTable(main, ctx);
  const form = main.querySelector('#f-zak');
  main.querySelector('#btn-ares').onclick = async () => {
    try { const r = await aresLookup(form.ico.value); for (const k of ['nazev', 'dic', 'ulice', 'psc', 'obec']) if (r[k]) form[k].value = r[k]; form.ico.value = r.ico; ctx.toast('Načteno z ARES.'); } catch (e) { ctx.toast(e.message, 'err'); }
  };
  const nf = main.querySelector('#btn-fa-zak'); if (nf) nf.onclick = () => { ctx.state.novaProZakaznika = z.id; ctx.go('faktura', 'nova'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const ico = String(f.get('ico') || '').replace(/\s/g, '');
    if (ico && !icoValid(ico)) return ctx.toast('IČO nemá platný kontrolní součet.', 'err');
    if (ico && s.zakaznici.some((x) => x.ico === ico && x.id !== z.id)) return ctx.toast('Zákazník s tímto IČO už v adresáři je.', 'err');
    const list = (v) => String(v || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const obj = {
      ...z, nazev: f.get('nazev').trim(), ico, dic: f.get('dic').trim(), kontakt: f.get('kontakt').trim(), ulice: f.get('ulice').trim(),
      psc: f.get('psc').trim(), obec: f.get('obec').trim(), zeme: f.get('zeme').trim() || 'Česká republika', emaily: list(f.get('emaily')),
      splatnost: f.get('splatnost') === '' ? null : Number(f.get('splatnost')), ucty: list(f.get('ucty')), poznamka: f.get('poznamka').trim(), archiv: f.get('archiv') === 'on',
    };
    if (!obj.zalozeno) { obj.zalozeno = new Date().toISOString(); obj.zalozil = ctx.state.auth.email; }
    await saveDoc(ctx, s, 'zak', obj);
    await ctx.audit(s.id, id === 'novy' ? 'zakaznik.zalozen' : 'zakaznik.upraven', obj.nazev);
    await loadDocs(ctx, s, true);
    ctx.flash(`Uloženo: ${obj.nazev}`);
    ctx.go('zakaznik', obj.id);
  };
}

// ---------------------------------------------------------------- FAKTURY – seznam
function stavPill(f) {
  if (poSplatnosti(f)) return `<span class="pill err">po splatnosti</span>`;
  const cls = { zaplacena: 'ok', koncept: '', stornovana: 'dim', castecne: 'warn', vystavena: 'info' }[f.stav] || '';
  return `<span class="pill ${cls}">${esc(STAVY[f.stav] || f.stav)}</span>`;
}

function fakturyTable(list) {
  return `<table class="grid"><thead><tr><th>Číslo</th><th>Odběratel</th><th>Vystaveno</th><th>Splatnost</th><th class="num">Částka</th><th class="num">Zbývá</th><th>Stav</th></tr></thead><tbody>
  ${list.map((f) => `<tr class="click" data-fa="${esc(f.id)}"><td>${f.stav === 'koncept' ? '<span class="muted">koncept</span>' : esc(f.cislo)}${f.typ !== 'faktura' ? ` <span class="pill">${esc(TYPY[f.typ]?.nazev.split(' ')[0])}</span>` : ''}</td>
    <td>${esc(f.odberatel?.nazev)}</td><td>${datum(f.datumVystaveni)}</td><td>${datum(f.datumSplatnosti)}</td>
    <td class="num">${czk(f.celkem)}</td><td class="num">${['vystavena', 'castecne'].includes(f.stav) ? czk(round2(f.celkem - uhrazeno(f))) : ''}</td><td>${stavPill(f)}</td></tr>`).join('') || '<tr><td colspan="7">Žádné faktury.</td></tr>'}
  </tbody></table>`;
}
function bindFakturyTable(main, ctx) { main.querySelectorAll('tr[data-fa]').forEach((tr) => (tr.onclick = () => ctx.go('faktura', tr.dataset.fa))); }

export async function viewFaktury(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const all = s.faktury.filter((f) => !f.smazano);
  const roky = [...new Set(all.map((f) => (f.datumVystaveni || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const st = ctx.state.ui.faktury ||= { rok: String(new Date().getFullYear()), stav: '', q: '' };
  if (!roky.includes(st.rok)) roky.unshift(st.rok);
  const list = all.filter((f) => (!st.rok || (f.datumVystaveni || '').startsWith(st.rok) || f.stav === 'koncept')
    && (!st.stav || (st.stav === 'po-splatnosti' ? poSplatnosti(f) : st.stav === 'neuhrazene' ? ['vystavena', 'castecne'].includes(f.stav) : f.stav === st.stav))
    && (!st.q || norm([f.cislo, f.odberatel?.nazev, f.odberatel?.ico, ...(f.polozky || []).map((p) => p.popis)].join(' ')).includes(norm(st.q))))
    .sort((a, b) => (a.stav === 'koncept') - (b.stav === 'koncept') || (b.datumVystaveni || '').localeCompare(a.datumVystaveni || '') || String(b.cislo).localeCompare(String(a.cislo)));
  // Stornovaná faktura a její opravný doklad se v součtu vzájemně vyruší.
  const vystavene = list.filter((f) => f.stav !== 'koncept');
  const sum = round2(vystavene.reduce((x, f) => x + Number(f.celkem || 0), 0));
  const zbyva = round2(vystavene.filter((f) => ['vystavena', 'castecne'].includes(f.stav)).reduce((x, f) => x + Math.max(0, f.celkem - uhrazeno(f)), 0));
  main.insertAdjacentHTML('beforeend', `
    <div class="head-row"><h1>Faktury – ${esc(ctx.subjectName(s))}</h1>${canWrite(ctx, s) ? '<button class="primary" id="btn-new-fa">+ Nová faktura</button>' : ''}</div>
    <div class="row filters">
      <select id="f-rok"><option value="">všechny roky</option>${roky.map((r) => `<option ${r === st.rok ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select id="f-stav"><option value="">všechny stavy</option>${[['neuhrazene', 'neuhrazené'], ['po-splatnosti', 'po splatnosti'], ...Object.entries(STAVY)].map(([k, l]) => `<option value="${k}" ${k === st.stav ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input id="q" placeholder="Hledat číslo, odběratele, text položky" value="${esc(st.q)}">
    </div>
    <div class="sums"><div><span class="muted small">Vyfakturováno</span><strong>${czk(sum)}</strong></div><div><span class="muted small">Neuhrazeno</span><strong>${czk(zbyva)}</strong></div><div><span class="muted small">Dokladů</span><strong>${vystavene.length}</strong></div></div>
    ${fakturyTable(list)}`);
  bindFakturyTable(main, ctx);
  main.querySelector('#f-rok').onchange = (e) => { st.rok = e.target.value; ctx.render(); };
  main.querySelector('#f-stav').onchange = (e) => { st.stav = e.target.value; ctx.render(); };
  const q = main.querySelector('#q');
  q.oninput = () => { st.q = q.value; clearTimeout(st.t); st.t = setTimeout(() => { ctx.render(); const el = document.getElementById('q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
  const nb = main.querySelector('#btn-new-fa'); if (nb) nb.onclick = () => ctx.go('faktura', 'nova');
}

// ---------------------------------------------------------------- FAKTURA – editor konceptu
function novyKoncept(ctx, s, zakaznikId) {
  const d = s.data;
  return {
    typ: 'faktura', stav: 'koncept', datumVystaveni: today(), splatnostDni: d.splatnost ?? 14,
    uvod: d.uvodText || '', polozky: [{ popis: '', mnozstvi: 1, jednotka: '', cena: 0, sleva: 0 }],
    zakaznikId: zakaznikId || null, ucetCislo: ((d.ucty || []).find((u) => u.vychozi) || (d.ucty || [])[0] || {}).cislo || '',
    uhrady: [], historie: [],
  };
}

function snapshotOdberatele(z) {
  if (!z) return null;
  return { nazev: z.nazev, ico: z.ico, dic: z.dic, kontakt: z.kontakt, ulice: z.ulice, psc: z.psc, obec: z.obec, zeme: z.zeme, email: (z.emaily || [])[0] || '' };
}

function polozkaRow(p, i) {
  return `<tr data-i="${i}">
    <td><input name="popis" value="${esc(p.popis)}" placeholder="Popis položky"></td>
    <td><input name="mnozstvi" type="number" step="any" value="${esc(p.mnozstvi)}" class="num"></td>
    <td><input name="jednotka" value="${esc(p.jednotka)}" placeholder="ks"></td>
    <td><input name="cena" type="number" step="0.01" value="${esc(p.cena)}" class="num"></td>
    <td><input name="sleva" type="number" step="any" min="0" max="100" value="${esc(p.sleva || 0)}" class="num"></td>
    <td class="num rc">${czk(radkaCelkem(p))}</td>
    <td><button type="button" class="small" data-del="${i}" title="Odebrat">×</button></td></tr>`;
}

export async function viewFaktura(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const id = ctx.state.detailId;
  let f;
  if (id === 'nova') {
    f = ctx.state.draft && ctx.state.draft.sid === s.id ? ctx.state.draft.f : novyKoncept(ctx, s, ctx.state.novaProZakaznika);
    ctx.state.novaProZakaznika = null;
    ctx.state.draft = { sid: s.id, f };
  } else {
    f = s.faktury.find((x) => x.id === id);
  }
  if (!f) { main.insertAdjacentHTML('beforeend', '<p>Faktura nenalezena.</p>'); return; }
  if (f.stav === 'koncept' && canWrite(ctx, s)) return editor(main, ctx, s, f);
  return detail(main, ctx, s, f);
}

function editor(main, ctx, s, f) {
  const zak = s.zakaznici.filter((z) => !z.archiv || z.id === f.zakaznikId);
  const ucty = s.data.ucty || [];
  main.insertAdjacentHTML('beforeend', `
    <p><button class="link" id="back">← Faktury</button></p>
    <h1>${f.id ? 'Koncept faktury' : 'Nová faktura'}</h1>
    <form id="f-fa" class="form2 wide">
      <div class="row">
        <label>Typ dokladu<select name="typ">${['faktura', 'zalohova'].map((t) => `<option value="${t}" ${f.typ === t ? 'selected' : ''}>${TYPY[t].nazev}</option>`).join('')}</select></label>
        <label class="grow">Odběratel<select name="zakaznikId" required><option value="">— vyberte z adresáře —</option>${zak.map((z) => `<option value="${esc(z.id)}" ${z.id === f.zakaznikId ? 'selected' : ''}>${esc(zakaznikText(z))}</option>`).join('')}</select></label>
        <button type="button" id="btn-new-zak2" class="small">+ nový zákazník</button>
      </div>
      <div class="row">
        <label>Datum vystavení<input name="datumVystaveni" type="date" required value="${esc(f.datumVystaveni)}"></label>
        <label>Splatnost (dní)<input name="splatnostDni" type="number" min="0" max="120" value="${esc(f.splatnostDni)}"></label>
        <label>Datum splatnosti<input name="datumSplatnosti" type="date" readonly tabindex="-1" value="${esc(addDays(f.datumVystaveni, f.splatnostDni))}"></label>
        <label>Účet<select name="ucetCislo">${ucty.map((u) => `<option ${u.cislo === f.ucetCislo ? 'selected' : ''}>${esc(u.cislo)}</option>`).join('') || '<option value="">— doplňte v Údajích subjektu —</option>'}</select></label>
      </div>
      <label>Úvodní text (nad položkami)<input name="uvod" value="${esc(f.uvod)}" placeholder="např. Na základě uzavřené smlouvy Vám fakturujeme následující služby:"></label>
      <table class="grid items"><thead><tr><th>Popis</th><th class="num">Množství</th><th>MJ</th><th class="num">Cena za MJ</th><th class="num">Sleva %</th><th class="num">Celkem</th><th></th></tr></thead>
        <tbody id="items">${f.polozky.map(polozkaRow).join('')}</tbody></table>
      <div class="row space"><button type="button" id="btn-add" class="small">+ položka</button><div class="total">Celkem k úhradě: <strong id="total">${czk(soucet(f.polozky))}</strong></div></div>
      <label>Poznámka na faktuře<input name="poznamka" value="${esc(f.poznamka)}"></label>
      <label>Interní poznámka (na faktuře se netiskne)<input name="interni" value="${esc(f.interni)}"></label>
      <div class="row">
        <button type="submit" name="akce" value="ulozit">Uložit koncept</button>
        <button type="button" id="btn-preview">Náhled PDF</button>
        <button type="submit" name="akce" value="vystavit" class="primary">Vystavit fakturu</button>
        ${f.id ? '<button type="button" id="btn-zahodit" class="danger">Zahodit koncept</button>' : ''}
      </div>
      <p class="muted small" id="next-no"></p>
    </form>`);
  const form = main.querySelector('#f-fa');
  const items = main.querySelector('#items');
  const readItems = () => [...items.querySelectorAll('tr')].map((tr) => ({
    popis: tr.querySelector('[name=popis]').value.trim(), mnozstvi: Number(tr.querySelector('[name=mnozstvi]').value || 0),
    jednotka: tr.querySelector('[name=jednotka]').value.trim(), cena: Number(tr.querySelector('[name=cena]').value || 0), sleva: Number(tr.querySelector('[name=sleva]').value || 0),
  }));
  const read = () => {
    const d = new FormData(form);
    f.typ = d.get('typ'); f.zakaznikId = d.get('zakaznikId') || null; f.datumVystaveni = d.get('datumVystaveni');
    f.splatnostDni = Number(d.get('splatnostDni') || 0); f.datumSplatnosti = addDays(f.datumVystaveni, f.splatnostDni);
    f.ucetCislo = d.get('ucetCislo') || ''; f.uvod = d.get('uvod').trim(); f.poznamka = d.get('poznamka').trim(); f.interni = d.get('interni').trim();
    f.polozky = readItems(); f.celkem = soucet(f.polozky);
    const z = s.zakaznici.find((x) => x.id === f.zakaznikId);
    f.odberatel = snapshotOdberatele(z);
    f.ucet = (s.data.ucty || []).find((u) => u.cislo === f.ucetCislo) || null;
    return f;
  };
  const refresh = () => {
    read();
    items.querySelectorAll('tr').forEach((tr, i) => { tr.querySelector('.rc').textContent = czk(radkaCelkem(f.polozky[i])); });
    main.querySelector('#total').textContent = czk(f.celkem);
    form.datumSplatnosti.value = f.datumSplatnosti;
    const rok = Number((f.datumVystaveni || today()).slice(0, 4));
    main.querySelector('#next-no').textContent = `Číslo přidělené při vystavení: ${dalsiCislo(s.data, s.faktury, f.typ, rok)}`;
  };
  form.addEventListener('input', refresh);
  form.zakaznikId.addEventListener('change', () => {
    const z = s.zakaznici.find((x) => x.id === form.zakaznikId.value);
    if (z && z.splatnost != null) form.splatnostDni.value = z.splatnost;
    refresh();
  });
  items.addEventListener('click', (e) => { if (e.target.dataset.del != null) { read(); f.polozky.splice(Number(e.target.dataset.del), 1); if (!f.polozky.length) f.polozky.push({ popis: '', mnozstvi: 1, cena: 0 }); items.innerHTML = f.polozky.map(polozkaRow).join(''); refresh(); } });
  main.querySelector('#btn-add').onclick = () => { read(); f.polozky.push({ popis: '', mnozstvi: 1, jednotka: '', cena: 0, sleva: 0 }); items.innerHTML = f.polozky.map(polozkaRow).join(''); refresh(); items.querySelector('tr:last-child [name=popis]').focus(); };
  main.querySelector('#back').onclick = () => { ctx.state.draft = null; ctx.go('faktury'); };
  main.querySelector('#btn-new-zak2').onclick = () => { read(); ctx.go('zakaznik', 'novy'); };
  main.querySelector('#btn-preview').onclick = async () => { read(); await openPdf(ctx, s, f); };
  const zb = main.querySelector('#btn-zahodit');
  if (zb) zb.onclick = async () => {
    if (!confirm('Zahodit koncept?')) return;
    f.smazano = true; await saveDoc(ctx, s, 'fa', f); await ctx.audit(s.id, 'faktura.koncept-zahozen');
    ctx.state.draft = null; await loadDocs(ctx, s, true); ctx.flash('Koncept zahozen.'); ctx.go('faktury');
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    read();
    const akce = e.submitter?.value || 'ulozit';
    if (!f.zakaznikId) return ctx.toast('Vyberte odběratele.', 'err');
    if (akce === 'vystavit') {
      if (!f.polozky.some((p) => p.popis)) return ctx.toast('Doplňte aspoň jednu položku s popisem.', 'err');
      if (f.polozky.some((p) => !p.popis && radkaCelkem(p) !== 0)) return ctx.toast('Položka s částkou nemá popis.', 'err');
      if (f.celkem <= 0) return ctx.toast('Částka faktury musí být kladná.', 'err');
      if (!f.ucet) return ctx.toast('Doplňte bankovní účet v Údajích subjektu.', 'err');
      f.polozky = f.polozky.filter((p) => p.popis);
      await loadDocs(ctx, s, true);
      const rok = Number(f.datumVystaveni.slice(0, 4));
      const cislo = dalsiCislo(s.data, s.faktury, f.typ, rok);
      if (!confirm(`Vystavit ${TYPY[f.typ].nazev.toLowerCase()} č. ${cislo} pro ${f.odberatel.nazev} na ${czk(f.celkem)}?\nVystavený doklad už nepůjde upravit, jen stornovat.`)) return;
      f.cislo = cislo; f.vs = vsZCisla(cislo); f.stav = 'vystavena';
      f.vystavil = ctx.state.auth.email; f.vystaveno = new Date().toISOString();
      f.historie = [...(f.historie || []), { at: f.vystaveno, by: ctx.state.auth.email, akce: 'vystavena' }];
      await saveDoc(ctx, s, 'fa', f);
      await ctx.audit(s.id, 'faktura.vystavena', `${cislo} – ${f.odberatel.nazev} – ${czk(f.celkem)}`);
      ctx.flash(`Vystavena faktura ${cislo}.`);
    } else {
      f.historie = [...(f.historie || []), ...(f.id ? [] : [{ at: new Date().toISOString(), by: ctx.state.auth.email, akce: 'zalozen koncept' }])];
      await saveDoc(ctx, s, 'fa', f);
      ctx.flash('Koncept uložen.');
    }
    ctx.state.draft = null;
    await loadDocs(ctx, s, true);
    ctx.go('faktura', f.id);
  };
  refresh();
}

// ---------------------------------------------------------------- FAKTURA – detail
function detail(main, ctx, s, f) {
  const rw = canWrite(ctx, s);
  const zbyva = round2(f.celkem - uhrazeno(f));
  const opravny = f.stornovanoDokladem ? s.faktury.find((x) => x.id === f.stornovanoDokladem) : null;
  main.insertAdjacentHTML('beforeend', `
    <p><button class="link" id="back">← Faktury</button></p>
    <div class="head-row"><h1>${esc(TYPY[f.typ]?.nazev)} ${esc(f.cislo || 'koncept')}</h1>${stavPill(f)}</div>
    <div class="cards">
      <div class="box"><span class="muted small">Odběratel</span><p><strong>${esc(f.odberatel?.nazev)}</strong><br>${esc([f.odberatel?.ulice, [f.odberatel?.psc, f.odberatel?.obec].filter(Boolean).join(' ')].filter(Boolean).join(', '))}${f.odberatel?.ico ? '<br>IČO ' + esc(f.odberatel.ico) : ''}</p></div>
      <div class="box"><span class="muted small">Částka</span><p class="bigval">${czk(f.celkem)}</p><p class="small">Uhrazeno ${czk(uhrazeno(f))}${zbyva > 0 && f.stav !== 'stornovana' ? ` · zbývá <strong>${czk(zbyva)}</strong>` : ''}</p></div>
      <div class="box"><span class="muted small">Data</span><p>Vystaveno ${datum(f.datumVystaveni)}<br>Splatnost ${datum(f.datumSplatnosti)}<br>VS ${esc(f.vs)}</p></div>
    </div>
    ${f.opravuje ? `<p class="note">Opravný doklad k faktuře ${esc(f.opravuje)}.</p>` : ''}
    ${opravny ? `<p class="note">Stornováno opravným dokladem <button class="link" data-goto="${esc(opravny.id)}">${esc(opravny.cislo)}</button>.</p>` : ''}
    <div class="row">
      <button class="primary" id="btn-pdf">Stáhnout PDF</button>
      <button id="btn-view">Zobrazit PDF</button>
      ${rw && ['vystavena', 'castecne'].includes(f.stav) ? '<button id="btn-pay">Zaznamenat úhradu</button>' : ''}
      ${rw ? '<button id="btn-dup">Duplikovat</button>' : ''}
      ${rw && ['vystavena', 'castecne', 'zaplacena'].includes(f.stav) && f.typ !== 'opravny' ? '<button id="btn-storno" class="danger">Stornovat</button>' : ''}
    </div>
    <form id="f-pay" class="box hidden">
      <h2>Úhrada</h2>
      <div class="row"><label>Datum<input type="date" name="datum" value="${today()}" required></label><label>Částka<input type="number" step="0.01" name="castka" value="${zbyva > 0 ? zbyva : ''}" required></label><label class="grow">Poznámka<input name="pozn" placeholder="např. hotově"></label><button class="primary">Uložit úhradu</button></div>
    </form>
    <h2>Položky</h2>
    <table class="grid"><thead><tr><th>Popis</th><th class="num">Množství</th><th class="num">Cena za MJ</th><th class="num">Celkem</th></tr></thead><tbody>
      ${(f.polozky || []).map((p) => `<tr><td>${esc(p.popis)}</td><td class="num">${esc(p.mnozstvi)} ${esc(p.jednotka)}</td><td class="num">${czk(p.cena)}</td><td class="num">${czk(radkaCelkem(p))}</td></tr>`).join('')}
    </tbody></table>
    ${f.uhrady?.length ? `<h2>Úhrady</h2><table class="grid"><thead><tr><th>Datum</th><th class="num">Částka</th><th>Zdroj</th><th></th></tr></thead><tbody>
      ${f.uhrady.map((u, i) => `<tr><td>${datum(u.datum)}</td><td class="num">${czk(u.castka)}</td><td>${esc(u.zdroj === 'rucne' ? 'ručně' : u.zdroj)}${u.pozn ? ' – ' + esc(u.pozn) : ''} <span class="muted small">(${esc(u.by || '')})</span></td><td>${rw && u.zdroj === 'rucne' ? `<button class="small danger" data-unpay="${i}">Zrušit</button>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    ${f.interni ? `<p class="muted">Interní poznámka: ${esc(f.interni)}</p>` : ''}
    <h2>Historie</h2>
    <ul class="hist">${(f.historie || []).map((h) => `<li>${esc(new Date(h.at).toLocaleString('cs-CZ'))} – ${esc(h.akce)} <span class="muted">(${esc(h.by)})</span></li>`).join('')}</ul>`);
  main.querySelector('#back').onclick = () => ctx.go('faktury');
  main.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => ctx.go('faktura', b.dataset.goto)));
  main.querySelector('#btn-pdf').onclick = async () => { const blob = await invoicePdfBlob(f, s.data); ctx.download(pdfFileName(f, s.data), blob); };
  main.querySelector('#btn-view').onclick = () => openPdf(ctx, s, f);
  const pay = main.querySelector('#btn-pay');
  if (pay) pay.onclick = () => { main.querySelector('#f-pay').classList.toggle('hidden'); main.querySelector('#f-pay [name=castka]').focus(); };
  main.querySelector('#f-pay').onsubmit = async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const castka = round2(Number(d.get('castka')));
    if (!(castka > 0)) return ctx.toast('Zadejte kladnou částku.', 'err');
    f.uhrady = [...(f.uhrady || []), { datum: d.get('datum'), castka, zdroj: 'rucne', pozn: d.get('pozn').trim(), by: ctx.state.auth.email }];
    f.stav = stavPodleUhrad(f);
    f.historie = [...(f.historie || []), { at: new Date().toISOString(), by: ctx.state.auth.email, akce: `úhrada ${czk(castka)} (${datum(d.get('datum'))})` }];
    await saveDoc(ctx, s, 'fa', f); await ctx.audit(s.id, 'faktura.uhrada', `${f.cislo}: ${czk(castka)}`);
    await loadDocs(ctx, s, true); ctx.flash(`Úhrada zaznamenána. Stav: ${STAVY[f.stav]}.`); ctx.go('faktura', f.id);
  };
  main.querySelectorAll('[data-unpay]').forEach((b) => (b.onclick = async () => {
    const u = f.uhrady[Number(b.dataset.unpay)];
    if (!confirm(`Zrušit úhradu ${czk(u.castka)} z ${datum(u.datum)}?`)) return;
    f.uhrady = f.uhrady.filter((_, i) => i !== Number(b.dataset.unpay));
    f.stav = stavPodleUhrad(f);
    f.historie = [...(f.historie || []), { at: new Date().toISOString(), by: ctx.state.auth.email, akce: `zrušena úhrada ${czk(u.castka)}` }];
    await saveDoc(ctx, s, 'fa', f); await ctx.audit(s.id, 'faktura.uhrada-zrusena', `${f.cislo}: ${czk(u.castka)}`);
    await loadDocs(ctx, s, true); ctx.go('faktura', f.id);
  }));
  const dup = main.querySelector('#btn-dup');
  if (dup) dup.onclick = () => {
    const n = novyKoncept(ctx, s, f.zakaznikId);
    Object.assign(n, { typ: f.typ === 'opravny' ? 'faktura' : f.typ, uvod: f.uvod, poznamka: f.poznamka, ucetCislo: f.ucet?.cislo || n.ucetCislo, polozky: (f.polozky || []).map((p) => ({ ...p, cena: Math.abs(p.cena) })) });
    const zk = s.zakaznici.find((x) => x.id === f.zakaznikId); if (zk && zk.splatnost != null) n.splatnostDni = zk.splatnost;
    ctx.state.draft = { sid: s.id, f: n }; ctx.go('faktura', 'nova');
  };
  const sto = main.querySelector('#btn-storno');
  if (sto) sto.onclick = async () => {
    await loadDocs(ctx, s, true);
    const rok = Number(today().slice(0, 4));
    const cislo = dalsiCislo(s.data, s.faktury, 'opravny', rok);
    if (!confirm(`Stornovat fakturu ${f.cislo}?\nVznikne opravný doklad ${cislo} na ${czk(-f.celkem)} a faktura bude označena jako stornovaná.`)) return;
    const now = new Date().toISOString();
    const od = {
      typ: 'opravny', stav: 'zaplacena', cislo, vs: vsZCisla(cislo), opravuje: f.cislo, opravujeId: f.id, zakaznikId: f.zakaznikId, odberatel: f.odberatel,
      datumVystaveni: today(), datumSplatnosti: today(), splatnostDni: 0, ucet: f.ucet, uvod: `Opravný doklad ke stornu faktury č. ${f.cislo} ze dne ${datum(f.datumVystaveni)}.`,
      polozky: (f.polozky || []).map((p) => ({ ...p, cena: -Math.abs(p.cena) })), uhrady: [], vystavil: ctx.state.auth.email, vystaveno: now,
      historie: [{ at: now, by: ctx.state.auth.email, akce: `vystaven jako storno faktury ${f.cislo}` }],
    };
    od.celkem = soucet(od.polozky);
    await saveDoc(ctx, s, 'fa', od);
    f.stav = 'stornovana'; f.stornovanoDokladem = od.id;
    f.historie = [...(f.historie || []), { at: now, by: ctx.state.auth.email, akce: `stornována dokladem ${cislo}` }];
    await saveDoc(ctx, s, 'fa', f);
    await ctx.audit(s.id, 'faktura.stornovana', `${f.cislo} → ${cislo}`);
    await loadDocs(ctx, s, true); ctx.flash(`Faktura ${f.cislo} stornována dokladem ${cislo}.`); ctx.go('faktura', od.id);
  };
}

async function openPdf(ctx, s, f) {
  const w = window.open('', '_blank');
  try {
    const blob = await invoicePdfBlob(f, s.data);
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else ctx.download(pdfFileName(f, s.data), blob);
  } catch (e) { if (w) w.close(); ctx.toast('PDF se nepodařilo vytvořit: ' + e.message, 'err'); }
}
