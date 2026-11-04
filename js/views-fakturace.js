// ARTUR – etapa 1: adresář zákazníků a faktury.
import * as C from './crypto.js?v=0.5.11';
import { aresLookup, icoValid } from './czech.js?v=0.5.11';
import { TYPY, STAVY, soucet, radkaCelkem, uhrazeno, stavPodleUhrad, poSplatnosti, dalsiCislo, vsZCisla, addDays, czk, datum, round2 } from './invoices.js?v=0.5.11';
import { invoicePdfBlob, pdfFileName } from './pdf.js?v=0.5.11';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : C.b64.from(C.randomBytes(12)).replace(/[^a-zA-Z0-9]/g, ''));
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------- data
// Společný adresář = zvláštní subjekt (meta.druh === 'adresar') s vlastním klíčem, sdílený všemi uživateli.
export const jeAdresar = (s) => s?.meta?.druh === 'adresar';
export const sdilenyAdresar = (ctx) => ctx.state.subjects.find((x) => jeAdresar(x) && x.access === 'ok') || null;

async function loadOwn(ctx, s) {
  const rows = await ctx.state.store.listDocs(s.id);
  const zak = []; const fa = []; const sab = []; const bank = []; const vyp = [];
  for (const r of rows) {
    try {
      const obj = await C.openJson(s.dek, r.enc, `doc:${s.id}:${r.id}`);
      obj.id = r.id;
      if (r.t === 'zak') zak.push(obj); else if (r.t === 'fa') fa.push(obj); else if (r.t === 'sab') sab.push(obj); else if (r.t === 'bank') bank.push(obj); else if (r.t === 'vyp') vyp.push(obj);
    } catch (e) { console.error('Nelze dešifrovat dokument', r.id, e); }
  }
  return { zak: zak.sort((a, b) => (a.nazev || '').localeCompare(b.nazev || '', 'cs')), fa, sab, bank, vyp };
}

/** Výpis, ze kterého pohyb pochází (u starších pohybů dohledá podle účtu a období). */
export function vypisInfo(s, t) {
  if (!t) return null;
  if (t.vypis) return t.vypis;
  const v = (s.vypisy || []).find((x) => x.ucet === t.ucet && (x.datumOd || x.datumPredchozi || '') <= t.datum && t.datum <= x.datum);
  return v ? { id: v.id, cislo: v.cislo, rok: v.datum.slice(0, 4), format: v.format || (/\.pdf$/i.test(v.soubor || '') ? 'PDF' : 'GPC') } : null;
}
export const vypisText = (vi) => (vi ? `výpis č. ${vi.cislo}/${vi.rok} (${vi.format})` : '');

export async function loadDocs(ctx, s, force = false) {
  const A = jeAdresar(s) ? null : sdilenyAdresar(ctx);
  if (s.docsLoaded && !force && (!A || A.docsLoaded)) { if (A) s.zakaznici = A.zakaznici; return; }
  const own = await loadOwn(ctx, s);
  s.faktury = own.fa; s.sablony = own.sab; s.banka = own.bank; s.vypisy = own.vyp;
  if (A) {
    if (!A.docsLoaded || force) { const a = await loadOwn(ctx, A); A.zakaznici = a.zak; A.faktury = []; A.sablony = []; A.docsLoaded = true; }
    s.adresar = A;
    s.zakaznici = A.zakaznici;
    s.lokalniZak = own.zak.filter((z) => !z.presunuto);
  } else {
    s.adresar = null;
    s.zakaznici = own.zak;
    s.lokalniZak = [];
  }
  s.docsLoaded = true;
}

/** Uloží zákazníka do společného adresáře (je-li), jinak do subjektu. */
export async function saveZak(ctx, s, z) {
  const cil = s.adresar || s;
  await saveDoc(ctx, cil, 'zak', z);
  return cil;
}

export async function saveDoc(ctx, s, t, obj) {
  const id = obj.id || uid();
  const data = { ...obj }; delete data.id;
  data.zmeneno = new Date().toISOString(); data.zmenil = ctx.state.auth.email;
  const enc = await C.sealJson(s.dek, data, `doc:${s.id}:${id}`);
  await ctx.state.store.putDoc(s.id, id, { t, enc });
  obj.id = id;
  return id;
}

export const canWrite = (ctx, s) => ['vlastnik', 'ucetni'].includes(ctx.myRole(s));

export function zakaznikText(z) { return [z.nazev, z.ico ? `IČO ${z.ico}` : '', z.obec].filter(Boolean).join(' · '); }

// ---------------------------------------------------------------- ADRESÁŘ
export async function viewAdresar(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const st = ctx.state.ui.adresar ||= { q: '', archiv: false };
  const list = s.zakaznici.filter((z) => (st.archiv || !z.archiv) && (!st.q || norm([z.nazev, z.ico, z.obec, (z.emaily || []).join(' ')].join(' ')).includes(norm(st.q))));
  const fakturace = {};
  for (const f of s.faktury) if (f.zakaznikId && f.stav !== 'koncept' && !f.smazano) fakturace[f.zakaznikId] = (fakturace[f.zakaznikId] || 0) + 1;
  const zapisAdr = canWrite(ctx, s.adresar || s);
  const prevod = s.adresar && s.lokalniZak.length && canWrite(ctx, s) && canWrite(ctx, s.adresar);
  main.insertAdjacentHTML('beforeend', `
    <div class="head-row"><h1>${s.adresar || jeAdresar(s) ? 'Společný adresář' : 'Adresář – ' + esc(ctx.subjectName(s))}</h1>${zapisAdr ? '<button class="primary" id="btn-new-zak">+ Nový zákazník</button>' : ''}</div>
    ${s.adresar || jeAdresar(s) ? '<p class="muted">Adresář je společný pro všechny subjekty. Faktury zůstávají oddělené podle IČO.</p>' : (sdilenyNedostupny(ctx) ? '<p class="note">Společný adresář existuje, ale zatím k němu nemáte přístup – požádejte administrátora o udělení přístupu.</p>' : '')}
    ${prevod ? `<div class="box warn"><p>Tento subjekt má ještě <strong>${s.lokalniZak.length} zákazníků ve vlastním adresáři</strong>. Převedu je do společného adresáře: shodné podle IČO (nebo názvu) sloučím, ostatní přidám a faktury i šablony přepojím.</p><button class="primary" id="btn-prevod">Převést do společného adresáře</button> <span id="prevod-stav" class="muted"></span></div>` : ''}
    <div class="row filters"><input id="q" placeholder="Hledat název, IČO, obec, e-mail" value="${esc(st.q)}"><label class="inline"><input type="checkbox" id="archiv" ${st.archiv ? 'checked' : ''}> i archivovaní</label></div>
    <table class="grid"><thead><tr><th>Název</th><th>IČO</th><th>Obec</th><th>E-mail</th><th class="num">Faktur</th></tr></thead><tbody>
    ${list.map((z) => `<tr class="click${z.archiv ? ' dim' : ''}" data-id="${esc(z.id)}"><td>${esc(z.nazev)}${z.archiv ? ' <span class="pill">archiv</span>' : ''}</td><td>${esc(z.ico)}</td><td>${esc(z.obec)}</td><td>${esc((z.emaily || [])[0] || '')}</td><td class="num">${fakturace[z.id] || ''}</td></tr>`).join('') || '<tr><td colspan="5">Žádní zákazníci.</td></tr>'}
    </tbody></table>
    <p class="muted small">${list.length} z ${s.zakaznici.length} zákazníků. Import z vyfakturuj.cz přijde v etapě 2.</p>`);
  const q = main.querySelector('#q');
  q.oninput = () => { st.q = q.value; clearTimeout(st.t); st.t = setTimeout(() => { ctx.render(); const el = document.getElementById('q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
  main.querySelector('#archiv').onchange = (e) => { st.archiv = e.target.checked; ctx.render(); };
  main.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => { ctx.go('zakaznik', tr.dataset.id); }));
  const pb = main.querySelector('#btn-prevod');
  if (pb) pb.onclick = () => prevestDoSpolecneho(ctx, s, pb, main.querySelector('#prevod-stav'));
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
      ${rw ? `<div class="row"><button class="primary">Uložit</button>${id !== 'novy' ? '<button type="button" id="btn-fa-zak">+ Nová faktura pro zákazníka</button><button type="button" id="btn-merge">Sloučit s jiným zákazníkem</button>' : ''}</div>` : ''}
    <div id="merge-box" class="box hidden"></div>
    </form>
    ${id !== 'novy' ? `<h2>Faktury zákazníka</h2>${fakturyTable(fa)}` : ''}`);
  main.querySelector('#back').onclick = () => ctx.go('adresar');
  bindFakturyTable(main, ctx);
  const form = main.querySelector('#f-zak');
  main.querySelector('#btn-ares').onclick = async () => {
    try { const r = await aresLookup(form.ico.value); for (const k of ['nazev', 'dic', 'ulice', 'psc', 'obec']) if (r[k]) form[k].value = r[k]; form.ico.value = r.ico; ctx.toast('Načteno z ARES.'); } catch (e) { ctx.toast(e.message, 'err'); }
  };
  const nf = main.querySelector('#btn-fa-zak'); if (nf) nf.onclick = () => { ctx.state.novaProZakaznika = z.id; ctx.go('faktura', 'nova'); };
  const mg = main.querySelector('#btn-merge');
  if (mg) mg.onclick = () => {
    const box = main.querySelector('#merge-box'); box.classList.remove('hidden');
    const jini = s.zakaznici.filter((x) => x.id !== z.id && !x.archiv);
    box.innerHTML = `<h2>Sloučit „${esc(z.nazev)}“${z.ico ? ' (IČO ' + esc(z.ico) + ')' : ''} do jiného zákazníka</h2>
      <p class="muted small">Všechny faktury tohoto zákazníka (${fa.length}) dostanou odběratele podle vybraného záznamu, včetně IČO a adresy. Změna se zapíše do historie faktur a tento záznam se archivuje.</p>
      <div class="row"><select id="merge-to">${jini.map((x) => `<option value="${esc(x.id)}" ${norm(x.nazev) === norm(z.nazev) ? 'selected' : ''}>${esc(zakaznikText(x))}</option>`).join('')}</select><button class="primary" id="merge-go">Sloučit</button></div>`;
    box.querySelector('#merge-go').onclick = async () => {
      const cil = s.zakaznici.find((x) => x.id === box.querySelector('#merge-to').value); if (!cil) return;
      if (!confirm(`Převést ${fa.length} faktur ze zákazníka „${z.nazev}“ ${z.ico ? '(IČO ' + z.ico + ') ' : ''}na „${cil.nazev}“ ${cil.ico ? '(IČO ' + cil.ico + ')' : ''}?`)) return;
      const now = new Date().toISOString(); const me = ctx.state.auth.email;
      for (const f of fa) {
        const pred = `${f.odberatel?.nazev || ''}${f.odberatel?.ico ? ' (IČO ' + f.odberatel.ico + ')' : ''}`;
        f.zakaznikId = cil.id; f.odberatel = snapshotOdberatele(cil); f.upraveno = true;
        f.historie = [...(f.historie || []), { at: now, by: me, akce: `odběratel opraven: ${pred} → ${cil.nazev}${cil.ico ? ' (IČO ' + cil.ico + ')' : ''}` }];
        await saveDoc(ctx, s, 'fa', f);
      }
      z.archiv = true; z.poznamka = [z.poznamka, `sloučeno do ${cil.nazev} ${now.slice(0, 10)}`].filter(Boolean).join('; ');
      await saveZak(ctx, s, z);
      for (const t of (s.sablony || []).filter((t) => t.zakaznikId === z.id)) { t.zakaznikId = cil.id; await saveDoc(ctx, s, 'sab', t); }
      await ctx.audit(s.id, 'zakaznik.slouceno', `${z.nazev} ${z.ico || ''} → ${cil.nazev} ${cil.ico || ''}: ${fa.length} faktur`);
      await loadDocs(ctx, s, true); ctx.flash(`Sloučeno: ${fa.length} faktur převedeno na ${cil.nazev}.`); ctx.go('zakaznik', cil.id);
    };
  };
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
    await saveZak(ctx, s, obj);
    await ctx.audit(s.id, id === 'novy' ? 'zakaznik.zalozen' : 'zakaznik.upraven', obj.nazev);
    await loadDocs(ctx, s, true);
    ctx.flash(`Uloženo: ${obj.nazev}`);
    ctx.go('zakaznik', obj.id);
  };
}

// ---------------------------------------------------------------- FAKTURY – seznam
export function stavPill(f) {
  if (poSplatnosti(f)) return `<span class="pill err">po splatnosti</span>`;
  const cls = { zaplacena: 'ok', koncept: '', stornovana: 'dim', castecne: 'warn', vystavena: 'info', prevzata: '' }[f.stav] || '';
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
export function novyKoncept(ctx, s, zakaznikId) {
  const d = s.data;
  return {
    typ: 'faktura', stav: 'koncept', datumVystaveni: today(), splatnostDni: d.splatnost ?? 14,
    uvod: d.uvodText || '', polozky: [{ popis: '', mnozstvi: 1, jednotka: '', cena: 0, sleva: 0 }],
    zakaznikId: zakaznikId || null, ucetCislo: ((d.ucty || []).find((u) => u.vychozi) || (d.ucty || [])[0] || {}).cislo || '',
    uhrady: [], historie: [],
  };
}

export function snapshotOdberatele(z) {
  if (!z) return null;
  return { nazev: z.nazev, ico: z.ico, dic: z.dic, kontakt: z.kontakt, ulice: z.ulice, psc: z.psc, obec: z.obec, zeme: z.zeme, email: (z.emaily || [])[0] || '' };
}

export function polozkaRow(p, i) {
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
    ${f.zdroj === 'vyfakturuj' ? `<p class="note">Převzato z vyfakturuj.cz. Originál: ${esc(f.archiv?.soubor)}, strana ${esc(f.archiv?.strana)}.${f.stav === 'prevzata' ? ' Úhrada zatím nebyla ověřena – doplní se z bankovních výpisů (etapa 4), nebo ji zaznamenejte ručně.' : ''}</p>` : ''}
    ${opravny ? `<p class="note">Stornováno opravným dokladem <button class="link" data-goto="${esc(opravny.id)}">${esc(opravny.cislo)}</button>.</p>` : ''}
    <div class="row">
      <button class="primary" id="btn-pdf">Stáhnout PDF</button>
      <button id="btn-view">Zobrazit PDF</button>
      ${rw && ['vystavena', 'castecne', 'prevzata'].includes(f.stav) ? '<button id="btn-pay">Zaznamenat úhradu</button>' : ''}
      ${rw ? '<button id="btn-dup">Duplikovat</button>' : ''}
      ${rw && f.stav !== 'koncept' ? '<button id="btn-edit-prev">Upravit fakturu</button>' : ''}
      ${rw && !['koncept', 'stornovana'].includes(f.stav) && f.typ !== 'opravny' ? '<button id="btn-mail">Odeslat e-mailem</button>' : ''}
      ${rw && ['vystavena', 'castecne', 'zaplacena'].includes(f.stav) && f.typ !== 'opravny' ? '<button id="btn-storno" class="danger">Stornovat</button>' : ''}
    </div>
    <div id="mail-box" class="box hidden form2"></div>
    <div id="edit-box" class="hidden"></div>
    <form id="f-pay" class="box hidden">
      <h2>Úhrada</h2>
      <div class="row"><label>Datum<input type="date" name="datum" value="${today()}" required></label><label>Částka<input type="number" step="0.01" name="castka" value="${zbyva > 0 ? zbyva : ''}" required></label><label class="grow">Poznámka<input name="pozn" placeholder="např. hotově"></label><button class="primary">Uložit úhradu</button></div>
    </form>
    <h2>Položky</h2>
    <table class="grid"><thead><tr><th>Popis</th><th class="num">Množství</th><th class="num">Cena za MJ</th><th class="num">Celkem</th></tr></thead><tbody>
      ${(f.polozky || []).map((p) => `<tr><td>${esc(p.popis)}</td><td class="num">${esc(p.mnozstvi)} ${esc(p.jednotka)}</td><td class="num">${czk(p.cena)}</td><td class="num">${czk(radkaCelkem(p))}</td></tr>`).join('')}
    </tbody></table>
    ${f.uhrady?.length ? `<h2>Úhrady</h2><table class="grid"><thead><tr><th>Datum</th><th class="num">Částka</th><th>Zdroj</th><th></th></tr></thead><tbody>
      ${f.uhrady.map((u, i) => `<tr><td>${datum(u.datum)}</td><td class="num">${czk(u.castka)}</td><td>${esc(u.zdroj === 'rucne' ? 'ručně' : u.zdroj)}${u.txId ? (() => { const t = (s.banka || []).find((x) => x.id === u.txId); const vt = vypisText(u.vypis || vypisInfo(s, t)); return ` · <button class="link" data-tx="${esc(u.txId)}">${esc(vt || 'pohyb na účtu')}</button>`; })() : ''}${u.pozn ? ' – ' + esc(u.pozn) : ''} <span class="muted small">(${esc(u.by || '')})</span></td><td>${rw && u.zdroj === 'rucne' ? `<button class="small danger" data-unpay="${i}">Zrušit</button>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
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
  main.querySelectorAll('[data-tx]').forEach((b) => (b.onclick = () => { ctx.state.zpetNaFakturu = f.id; ctx.go('banka', b.dataset.tx); }));
  main.querySelectorAll('[data-unpay]').forEach((b) => (b.onclick = async () => {
    const u = f.uhrady[Number(b.dataset.unpay)];
    if (!confirm(`Zrušit úhradu ${czk(u.castka)} z ${datum(u.datum)}?`)) return;
    f.uhrady = f.uhrady.filter((_, i) => i !== Number(b.dataset.unpay));
    f.stav = stavPodleUhrad(f);
    f.historie = [...(f.historie || []), { at: new Date().toISOString(), by: ctx.state.auth.email, akce: `zrušena úhrada ${czk(u.castka)}` }];
    await saveDoc(ctx, s, 'fa', f); await ctx.audit(s.id, 'faktura.uhrada-zrusena', `${f.cislo}: ${czk(u.castka)}`);
    await loadDocs(ctx, s, true); ctx.go('faktura', f.id);
  }));
  const mb = main.querySelector('#btn-mail');
  if (mb) mb.onclick = async () => { const { odeslatDialog } = await import('./views-opakovani.js?v=0.5.11'); odeslatDialog(main.querySelector('#mail-box'), ctx, s, f); };
  const eb = main.querySelector('#btn-edit-prev');
  if (eb) eb.onclick = () => editPrevzata(main.querySelector('#edit-box'), ctx, s, f);
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

// ---------------------------------------------------------------- IMPORT z vyfakturuj.cz (etapa 2)
export async function viewImport(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  if (!canWrite(ctx, s)) { main.insertAdjacentHTML('beforeend', '<h1>Import z vyfakturuj.cz</h1><p>Import může provést vlastník nebo účetní.</p>'); return; }
  main.insertAdjacentHTML('beforeend', `
    <h1>Import z vyfakturuj.cz – ${esc(ctx.subjectName(s))}</h1>
    <p>Vyberte soubor <code>ARTUR-migrace-….json</code> (faktury) nebo <code>ARTUR-uhrady-….json</code> (data úhrad) ze složky <strong>FAKTUR\\Migrace</strong>. Soubor vznikl z PDF exportů vyfakturuj.cz. Data se v prohlížeči zašifrují a teprve pak uloží. Faktury, které už v ARTURovi jsou (stejné číslo), se přeskočí, import lze tedy opakovat.</p>
    <input type="file" id="file" accept=".json,application/json">
    <div id="preview"></div>`);
  const prev = main.querySelector('#preview');
  main.querySelector('#file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return ctx.toast('Soubor není platný JSON.', 'err'); }
    if (data.artur === 'uhrady-vyfakturuj') return nahledUhrad(prev, ctx, s, data);
    if (data.artur !== 'migrace-vyfakturuj') return ctx.toast('Toto není migrační soubor ARTURa.', 'err');
    if (data.subjekt?.ico && s.data.ico && data.subjekt.ico !== s.data.ico) return ctx.toast(`Soubor patří k IČO ${data.subjekt.ico} (${data.subjekt.nazev}), ne k vybranému subjektu.`, 'err');
    if (data.subjekt?.nazev && !data.subjekt.ico && norm(data.subjekt.nazev) !== norm(s.data.nazev)) {
      if (!confirm(`Soubor je pro „${data.subjekt.nazev}“, vybraný subjekt je „${s.data.nazev}“. Pokračovat?`)) return;
    }
    const existCisla = new Set(s.faktury.filter((f) => !f.smazano).map((f) => `${f.typ}:${f.cislo}`));
    const nove = data.faktury.filter((f) => !existCisla.has(`${f.typ}:${f.cislo}`));
    // Opravený migrační soubor: převzaté faktury, které nikdo ručně neupravil a nemají úhrady, lze přepsat.
    const pokey = (f) => `${f.typ}:${f.cislo}`;
    const stare = new Map(s.faktury.filter((f) => !f.smazano && f.zdroj === 'vyfakturuj' && !f.upraveno && !(f.uhrady || []).length).map((f) => [pokey(f), f]));
    const ruzne = (a, b) => JSON.stringify([a.celkem, a.datumVystaveni, a.datumSplatnosti, a.vs, a.odberatel?.nazev, a.odberatel?.ico, (a.polozky || []).map((p) => [p.popis, p.mnozstvi, p.cena])]) !== JSON.stringify([b.celkem, b.datumVystaveni, b.datumSplatnosti, b.vs, b.odberatel?.nazev, b.odberatel?.ico, (b.polozky || []).map((p) => [p.popis, p.mnozstvi, p.cena])]);
    const opravy = data.faktury.filter((f) => stare.has(pokey(f)) && ruzne(stare.get(pokey(f)), f));
    const zakMap = new Map();
    for (const z of s.zakaznici) { if (z.ico) zakMap.set('ico:' + z.ico, z); zakMap.set('n:' + norm(z.nazev), z); }
    const findZak = (z) => (z.ico && zakMap.get('ico:' + z.ico)) || zakMap.get('n:' + norm(z.nazev));
    const noviZak = data.zakaznici.filter((z) => !findZak(z));
    const roky = {};
    for (const f of data.faktury) {
      const r = (f.datumVystaveni || f.cislo).slice(0, 4);
      const x = roky[r] ||= { pocet: 0, soucet: 0, nove: 0, posledni: '' };
      x.pocet++; x.soucet += Number(f.celkem || 0); if (!existCisla.has(`${f.typ}:${f.cislo}`)) x.nove++; if (f.cislo > x.posledni) x.posledni = f.cislo;
    }
    const otevrene = nove.filter((f) => f.stav === 'vystavena').length;
    prev.innerHTML = `
      <h2>Náhled</h2>
      <p>${esc(data.subjekt?.nazev || '')} ${data.subjekt?.ico ? 'IČO ' + esc(data.subjekt.ico) : ''} · připraveno ${esc(new Date(data.vytvoreno).toLocaleString('cs-CZ'))}</p>
      <table class="grid"><thead><tr><th>Rok</th><th class="num">Faktur</th><th class="num">Nových</th><th class="num">Fakturováno</th><th>Poslední číslo</th></tr></thead><tbody>
        ${Object.entries(roky).sort().map(([r, x]) => `<tr><td>${r}</td><td class="num">${x.pocet}</td><td class="num">${x.nove}</td><td class="num">${czk(x.soucet)}</td><td>${esc(x.posledni)}</td></tr>`).join('')}
      </tbody></table>
      <p>Zákazníci: ${data.zakaznici.length} v souboru, z toho <strong>${noviZak.length} nových</strong> do adresáře (ostatní se spárují podle IČO nebo názvu).</p>
      <p>Faktury: <strong>${nove.length} nových</strong>, ${data.faktury.length - nove.length} už v ARTURovi je.
         ${otevrene} faktur z posledních 60 dní se převezme jako <em>Vystavené</em> (čekají na úhradu), ostatní jako <em>Převzaté (úhrada neověřena)</em> – úhrady doplní bankovní výpisy v etapě 4.</p>
      ${opravy.length ? `<p class="note"><strong>${opravy.length} už převzatých faktur má v souboru jiné údaje</strong> (opravený převod). Ručně upravené a uhrazené faktury se nemění.<br><label class="inline"><input type="checkbox" id="prepsat" checked> přepsat je opravenými údaji</label></p>` : ''}
      ${nove.length || noviZak.length || opravy.length ? `<button class="primary" id="btn-import">Importovat ${nove.length} faktur a ${noviZak.length} zákazníků${opravy.length ? ` (+ ${opravy.length} oprav)` : ''}</button>` : '<p class="note">Není co importovat.</p>'}
      <p id="progress" class="muted"></p>`;
    const btn = prev.querySelector('#btn-import');
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true;
      const progress = prev.querySelector('#progress');
      const now = new Date().toISOString(); const me = ctx.state.auth.email;
      const items = [];
      const klicToId = new Map();
      for (const z of data.zakaznici) {
        const ex = findZak(z);
        if (ex) { klicToId.set(z.klic, ex.id); continue; }
        const id = uid();
        const obj = { nazev: z.nazev, ico: z.ico || '', dic: z.dic || '', kontakt: z.kontakt || '', ulice: z.ulice || '', psc: z.psc || '', obec: z.obec || '', zeme: z.zeme || 'Česká republika',
          emaily: z.emaily || [], splatnost: z.splatnost ?? null, ucty: z.ucty || [], poznamka: z.poznamka || '', archiv: false, zalozeno: now, zalozil: me, zdroj: 'vyfakturuj', zmeneno: now, zmenil: me };
        klicToId.set(z.klic, id);
        items.push({ id, t: 'zak', obj });
      }
      for (const f of nove) {
        const id = uid();
        const obj = { ...f, zakaznikId: klicToId.get(f.zakaznikKlic) || null, uhrady: [], historie: [{ at: now, by: me, akce: 'převzato z vyfakturuj.cz' }], vystavil: 'vyfakturuj.cz', zmeneno: now, zmenil: me };
        delete obj.zakaznikKlic;
        items.push({ id, t: 'fa', obj });
      }
      if (opravy.length && prev.querySelector('#prepsat')?.checked) {
        for (const nf of opravy) {
          const old = stare.get(pokey(nf));
          const obj = { ...old, ...nf, zakaznikId: klicToId.get(nf.zakaznikKlic) || old.zakaznikId, historie: [...(old.historie || []), { at: now, by: me, akce: 'údaje opraveny z nového migračního souboru' }], zmeneno: now, zmenil: me };
          delete obj.zakaznikKlic; delete obj.id;
          items.push({ id: old.id, t: 'fa', obj });
        }
      }
      progress.textContent = 'Šifruji…';
      const zakCil = s.adresar || s;
      const enc = []; const encZak = [];
      for (const [i, it] of items.entries()) {
        const cil = it.t === 'zak' ? zakCil : s;
        (cil === s ? enc : encZak).push({ id: it.id, data: { t: it.t, enc: await C.sealJson(cil.dek, it.obj, `doc:${cil.id}:${it.id}`) } });
        if (i % 100 === 0) { progress.textContent = `Šifruji ${i} / ${items.length}…`; await new Promise((r) => setTimeout(r)); }
      }
      try {
        if (encZak.length) await ctx.state.store.putDocs(zakCil.id, encZak);
        await ctx.state.store.putDocs(s.id, enc, (done, total) => { progress.textContent = `Ukládám ${done} / ${total}…`; });
      } catch (err) { console.error(err); progress.textContent = ''; btn.disabled = false; return ctx.toast('Uložení selhalo: ' + err.message + '. Import můžete spustit znovu – uložené faktury se přeskočí.', 'err'); }
      await ctx.audit(s.id, 'migrace.import', `${nove.length} faktur, ${noviZak.length} zákazníků z vyfakturuj.cz${opravy.length ? `, ${opravy.length} oprav` : ''}`);
      await loadDocs(ctx, s, true);
      const rok = new Date().getFullYear();
      ctx.flash(`Import hotov: ${nove.length} faktur, ${noviZak.length} zákazníků. Další číslo faktury: ${dalsiCislo(s.data, s.faktury, 'faktura', rok)}.`);
      ctx.go('faktury');
    };
  };
}

// ---------------------------------------------------------------- úprava vystavené nebo převzaté faktury
function editPrevzata(box, ctx, s, f) {
  const zak = s.zakaznici;
  box.classList.remove('hidden');
  box.innerHTML = `<form id="f-prev" class="box form2 wide">
    <h2>Úprava faktury ${esc(f.cislo)}</h2>
    <p class="muted small">${f.zdroj === 'vyfakturuj' ? `Opravte údaje podle originálu (${esc(f.archiv?.soubor)}, strana ${esc(f.archiv?.strana)}). ` : ''}Číslo faktury zůstává. Každá změna se zapíše do historie faktury. Pokud už faktura odešla zákazníkovi, pošlete mu po opravě nové PDF.</p>
    <div class="row">
      <label class="grow">Odběratel<select name="zakaznikId"><option value="">— ponechat údaje z faktury —</option>${zak.map((z) => `<option value="${esc(z.id)}" ${z.id === f.zakaznikId ? 'selected' : ''}>${esc(zakaznikText(z))}</option>`).join('')}</select></label>
      <label>VS<input name="vs" value="${esc(f.vs)}"></label>
    </div>
    <div class="row">
      <label>Datum vystavení<input type="date" name="datumVystaveni" value="${esc(f.datumVystaveni)}"></label>
      <label>Datum splatnosti<input type="date" name="datumSplatnosti" value="${esc(f.datumSplatnosti)}"></label>
      <label>Stav<select name="stav">${[...(f.zdroj === 'vyfakturuj' ? ['prevzata'] : []), 'vystavena', 'castecne', 'zaplacena', ...(f.stav === 'stornovana' ? ['stornovana'] : [])].map((x) => `<option value="${x}" ${f.stav === x ? 'selected' : ''}>${esc(STAVY[x])}</option>`).join('')}</select></label>
    </div>
    <label>Úvodní text<input name="uvod" value="${esc(f.uvod)}"></label>
    <table class="grid items"><thead><tr><th>Popis</th><th class="num">Množství</th><th>MJ</th><th class="num">Cena za MJ</th><th class="num">Sleva %</th><th class="num">Celkem</th><th></th></tr></thead>
      <tbody id="pitems">${(f.polozky || []).map(polozkaRow).join('')}</tbody></table>
    <div class="row space"><button type="button" id="padd" class="small">+ položka</button><div class="total">Celkem: <strong id="ptotal">${czk(f.celkem)}</strong></div></div>
    <label>Poznámka na faktuře<input name="poznamka" value="${esc(f.poznamka)}"></label>
    <div class="row"><button class="primary">Uložit opravu</button><button type="button" id="pcancel">Zrušit</button></div>
  </form>`;
  const form = box.querySelector('#f-prev'); const items = box.querySelector('#pitems');
  const readItems = () => [...items.querySelectorAll('tr')].map((tr) => ({ popis: tr.querySelector('[name=popis]').value.trim(), mnozstvi: Number(tr.querySelector('[name=mnozstvi]').value || 0), jednotka: tr.querySelector('[name=jednotka]').value.trim(), cena: Number(tr.querySelector('[name=cena]').value || 0), sleva: Number(tr.querySelector('[name=sleva]').value || 0) }));
  const refresh = () => { const p = readItems(); items.querySelectorAll('tr').forEach((tr, i) => { tr.querySelector('.rc').textContent = czk(radkaCelkem(p[i])); }); box.querySelector('#ptotal').textContent = czk(soucet(p)); };
  form.addEventListener('input', refresh);
  items.addEventListener('click', (e) => { if (e.target.dataset.del != null) { const p = readItems(); p.splice(Number(e.target.dataset.del), 1); items.innerHTML = p.map(polozkaRow).join(''); refresh(); } });
  box.querySelector('#padd').onclick = () => { const p = readItems(); p.push({ popis: '', mnozstvi: 1, jednotka: '', cena: 0, sleva: 0 }); items.innerHTML = p.map(polozkaRow).join(''); refresh(); };
  box.querySelector('#pcancel').onclick = () => { box.classList.add('hidden'); box.innerHTML = ''; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const pred = { odberatel: f.odberatel?.nazev, celkem: f.celkem, datum: f.datumVystaveni };
    const zid = d.get('zakaznikId');
    if (zid && zid !== f.zakaznikId) { f.zakaznikId = zid; f.odberatel = snapshotOdberatele(s.zakaznici.find((z) => z.id === zid)); }
    else if (zid) { f.odberatel = snapshotOdberatele(s.zakaznici.find((z) => z.id === zid)); }
    f.vs = d.get('vs').trim(); f.datumVystaveni = d.get('datumVystaveni'); f.datumSplatnosti = d.get('datumSplatnosti');
    f.uvod = d.get('uvod').trim(); f.poznamka = d.get('poznamka').trim();
    f.polozky = readItems().filter((p) => p.popis); f.celkem = soucet(f.polozky);
    f.stav = d.get('stav'); if (f.stav === 'zaplacena' && !(f.uhrady || []).length) f.uhrady = [{ datum: null, castka: f.celkem, zdroj: 'převzato', pozn: 'uhrazeno dle vyfakturuj.cz, datum neznámé', by: ctx.state.auth.email }];
    f.upraveno = true;
    const zmeny = [pred.odberatel !== f.odberatel?.nazev ? `odběratel ${pred.odberatel} → ${f.odberatel?.nazev}` : '', pred.celkem !== f.celkem ? `částka ${czk(pred.celkem)} → ${czk(f.celkem)}` : '', pred.datum !== f.datumVystaveni ? `datum ${datum(pred.datum)} → ${datum(f.datumVystaveni)}` : ''].filter(Boolean).join(', ');
    f.historie = [...(f.historie || []), { at: new Date().toISOString(), by: ctx.state.auth.email, akce: 'oprava faktury' + (zmeny ? ': ' + zmeny : '') }];
    await saveDoc(ctx, s, 'fa', f);
    await ctx.audit(s.id, 'faktura.oprava', `${f.cislo}${zmeny ? ': ' + zmeny : ''}`);
    await loadDocs(ctx, s, true); ctx.flash(`Faktura ${f.cislo} opravena.`); ctx.go('faktura', f.id);
  };
}

function sdilenyNedostupny(ctx) { return ctx.state.subjects.some((x) => jeAdresar(x) && x.access !== 'ok'); }

/** Převede zákazníky subjektu do společného adresáře a přepojí faktury a šablony. */
async function prevestDoSpolecneho(ctx, s, btn, stav) {
  const A = s.adresar;
  if (!confirm(`Převést ${s.lokalniZak.length} zákazníků subjektu ${ctx.subjectName(s)} do společného adresáře?`)) return;
  btn.disabled = true;
  const now = new Date().toISOString(); const me = ctx.state.auth.email;
  const byIco = new Map(); const byName = new Map();
  for (const z of A.zakaznici) { if (z.ico) byIco.set(z.ico, z); byName.set(norm(z.nazev), z); }
  const mapa = new Map(); const zmenyA = new Map(); let sloucenych = 0; let novych = 0;
  for (const z of s.lokalniZak) {
    let cil = (z.ico && byIco.get(z.ico)) || (!z.ico && byName.get(norm(z.nazev))) || null;
    if (cil) {
      sloucenych++;
      const em = [...new Set([...(cil.emaily || []), ...(z.emaily || [])])]; const uc = [...new Set([...(cil.ucty || []), ...(z.ucty || [])])];
      const upd = { ...cil, emaily: em, ucty: uc };
      for (const k of ['dic', 'kontakt', 'ulice', 'psc', 'obec']) if (!upd[k] && z[k]) upd[k] = z[k];
      if (upd.splatnost == null && z.splatnost != null) upd.splatnost = z.splatnost;
      zmenyA.set(cil.id, upd);
    } else {
      novych++;
      cil = { ...z, id: uid(), presunuto: undefined, poznamka: z.poznamka || '' };
      delete cil.presunuto;
      zmenyA.set(cil.id, cil);
      if (cil.ico) byIco.set(cil.ico, cil); byName.set(norm(cil.nazev), cil);
    }
    mapa.set(z.id, cil.id);
  }
  const seal = async (cil, list, t) => Promise.all(list.map(async (o) => { const d = { ...o, zmeneno: now, zmenil: me }; const id = d.id; delete d.id; return { id, data: { t, enc: await C.sealJson(cil.dek, d, `doc:${cil.id}:${id}`) } }; }));
  stav.textContent = 'Ukládám společný adresář…';
  await ctx.state.store.putDocs(A.id, await seal(A, [...zmenyA.values()], 'zak'));
  const fa = s.faktury.filter((f) => mapa.has(f.zakaznikId)).map((f) => ({ ...f, zakaznikId: mapa.get(f.zakaznikId) }));
  const sab = (s.sablony || []).filter((t) => mapa.has(t.zakaznikId)).map((t) => ({ ...t, zakaznikId: mapa.get(t.zakaznikId) }));
  const lok = s.lokalniZak.map((z) => ({ ...z, presunuto: mapa.get(z.id), archiv: true }));
  stav.textContent = `Přepojuji ${fa.length} faktur…`;
  await ctx.state.store.putDocs(s.id, [...await seal(s, fa, 'fa'), ...await seal(s, sab, 'sab'), ...await seal(s, lok, 'zak')], (d, t) => { stav.textContent = `Ukládám ${d} / ${t}…`; });
  await ctx.audit(s.id, 'adresar.prevod', `${s.lokalniZak.length} zákazníků → společný adresář (${novych} nových, ${sloucenych} sloučených), ${fa.length} faktur přepojeno`);
  await ctx.audit(A.id, 'adresar.prevod', `z ${ctx.subjectName(s)}: ${novych} nových, ${sloucenych} sloučených`);
  await loadDocs(ctx, s, true);
  ctx.flash(`Převedeno do společného adresáře: ${novych} nových, ${sloucenych} sloučených se stávajícími. Přepojeno ${fa.length} faktur a ${sab.length} šablon.`);
  ctx.go('adresar');
}

// ---------------------------------------------------------------- úhrady převzatých faktur (ze seznamu ve vyfakturuj.cz)
function nahledUhrad(prev, ctx, s, data) {
  if (data.subjekt?.ico && s.data.ico && data.subjekt.ico !== s.data.ico) return ctx.toast(`Soubor patří k IČO ${data.subjekt.ico}, ne k vybranému subjektu.`, 'err');
  const fa = new Map(s.faktury.filter((f) => !f.smazano && f.typ === 'faktura').map((f) => [f.cislo, f]));
  const plan = []; const chybi = []; const uz = []; const nesedi = [];
  for (const u of data.uhrady || []) {
    const f = fa.get(u.cislo);
    if (!f) { chybi.push(u.cislo); continue; }
    if ((f.uhrady || []).length || ['zaplacena', 'stornovana'].includes(f.stav)) { uz.push(u.cislo); continue; }
    if (u.castka != null && Math.abs(Number(u.castka) - f.celkem) > 0.005) nesedi.push(`${u.cislo} (${czk(u.castka)} × faktura ${czk(f.celkem)})`);
    plan.push({ f, u });
  }
  prev.innerHTML = `<h2>Úhrady převzatých faktur</h2>
    <p>Zdroj: ${esc(data.zdroj || 'vyfakturuj.cz')}. V souboru ${(data.uhrady || []).length} úhrad.</p>
    <ul><li>Zapíše se: <strong>${plan.length}</strong></li>
      <li>Už uhrazené (beze změny): ${uz.length}</li>
      ${chybi.length ? `<li class="warn">Faktura v ARTURovi není: ${esc(chybi.join(', '))} – nejdřív importujte faktury.</li>` : ''}
      ${nesedi.length ? `<li class="warn">Částka nesedí (zapíše se částka z faktury): ${esc(nesedi.join('; '))}</li>` : ''}</ul>
    ${plan.length ? `<button class="primary" id="btn-uhrady">Zapsat ${plan.length} úhrad</button>` : '<p class="note">Není co zapsat.</p>'}`;
  const b = prev.querySelector('#btn-uhrady'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    const now = new Date().toISOString(); const me = ctx.state.auth.email; const enc = [];
    for (const { f, u } of plan) {
      f.uhrady = [{ datum: u.datum, castka: f.celkem, zdroj: 'vyfakturuj.cz', pozn: 'datum úhrady převzato z vyfakturuj.cz', by: me }];
      f.stav = stavPodleUhrad(f);
      f.historie = [...(f.historie || []), { at: now, by: me, akce: `úhrada ${datum(u.datum)} převzata z vyfakturuj.cz` }];
      const d = { ...f, zmeneno: now, zmenil: me }; delete d.id;
      enc.push({ id: f.id, data: { t: 'fa', enc: await C.sealJson(s.dek, d, `doc:${s.id}:${f.id}`) } });
    }
    await ctx.state.store.putDocs(s.id, enc);
    await ctx.audit(s.id, 'migrace.uhrady', `${plan.length} úhrad z vyfakturuj.cz`);
    await loadDocs(ctx, s, true); ctx.flash(`Zapsáno ${plan.length} úhrad převzatých faktur.`); ctx.go('faktury');
  };
}
