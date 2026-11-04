// ARTUR – etapa 3: šablony opakovaných faktur, měsíční fakturace, odeslání e-mailem.
import { TYPY, soucet, radkaCelkem, dalsiCislo, vsZCisla, addDays, czk, datum, round2 } from './invoices.js?v=0.5.10';
import { invoicePdfBlob, pdfFileName } from './pdf.js?v=0.5.10';
import { sendMail, fillTemplate, VYCHOZI_PREDMET, VYCHOZI_TEXT, gmailToken } from './mail.js?v=0.5.10';
import { esc, today, norm, loadDocs, saveDoc, canWrite, zakaznikText, snapshotOdberatele, polozkaRow, stavPill } from './views-fakturace.js?v=0.5.10';

export const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MESICE_V = ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu', 'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci'];
const PERIODA = { mesicne: 'měsíčně', ctvrtletne: 'čtvrtletně', rocne: 'ročně' };
const OBDOBI = { predchozi: 'za předchozí měsíc', aktualni: 'za aktuální měsíc' };

export const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
export function posunMesic(ymStr, delta) { const [y, m] = ymStr.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return ym(d.getUTCFullYear(), d.getUTCMonth() + 1); }
const mesicNazev = (ymStr) => { const [y, m] = ymStr.split('-').map(Number); return `${MESICE[m - 1]} ${y}`; };

/** Doplní proměnné v textu položky pro fakturované období. */
export function vyplnText(text, obdobiYm) {
  const [y, m] = obdobiYm.split('-').map(Number);
  return String(text || '')
    .replace(/\{mesic\}/g, MESICE[m - 1]).replace(/\{v_mesici\}/g, MESICE_V[m - 1])
    .replace(/\{rok\}/g, String(y)).replace(/\{mm\}/g, String(m).padStart(2, '0'))
    .replace(/\{obdobi\}/g, `${m}/${y}`)
    .replace(/\{ctvrtleti\}/g, `${Math.ceil(m / 3)}. čtvrtletí`);
}

/** Je šablona v daném měsíci k fakturaci? */
export function jeKFakturaci(t, mesic) {
  if (!t.aktivni) return false;
  if (t.platnostOd && mesic < t.platnostOd) return false;
  if (t.platnostDo && mesic > t.platnostDo) return false;
  const start = t.platnostOd || mesic;
  const [sy, sm] = start.split('-').map(Number); const [y, m] = mesic.split('-').map(Number);
  const diff = (y - sy) * 12 + (m - sm);
  if (t.perioda === 'ctvrtletne') return diff % 3 === 0;
  if (t.perioda === 'rocne') return diff % 12 === 0;
  return true;
}

/** Vytvoří koncept faktury ze šablony pro měsíc vystavení. */
export function konceptZeSablony(s, t, mesic) {
  const z = s.zakaznici.find((x) => x.id === t.zakaznikId);
  const obdobi = t.obdobi === 'predchozi' ? posunMesic(mesic, -1) : mesic;
  const [y, m] = mesic.split('-').map(Number);
  const den = Math.min(Number(t.den || 1), new Date(Date.UTC(y, m, 0)).getUTCDate());
  const dv = `${mesic}-${String(den).padStart(2, '0')}`;
  const ucet = (s.data.ucty || []).find((u) => u.cislo === t.ucetCislo) || (s.data.ucty || []).find((u) => u.vychozi) || (s.data.ucty || [])[0] || null;
  const polozky = (t.polozky || []).map((p) => ({ ...p, popis: vyplnText(p.popis, obdobi) }));
  return {
    typ: t.typ || 'faktura', stav: 'koncept', datumVystaveni: dv, splatnostDni: Number(t.splatnostDni ?? s.data.splatnost ?? 14),
    datumSplatnosti: addDays(dv, Number(t.splatnostDni ?? s.data.splatnost ?? 14)),
    uvod: t.uvod ?? s.data.uvodText ?? '', poznamka: t.poznamka || '', polozky, celkem: soucet(polozky),
    zakaznikId: t.zakaznikId, odberatel: snapshotOdberatele(z), ucetCislo: ucet?.cislo || '', ucet,
    sablonaId: t.id, sablonaMesic: mesic, uhrady: [], historie: [],
  };
}

/** Vystaví koncept (přidělí číslo). Volající musí mít aktuální s.faktury. */
async function vystavit(ctx, s, f) {
  f.polozky = (f.polozky || []).filter((p) => p.popis);
  f.celkem = soucet(f.polozky);
  if (!f.polozky.length || f.celkem <= 0) throw new Error(`Koncept pro ${f.odberatel?.nazev} nemá položky nebo kladnou částku.`);
  if (!f.ucet) throw new Error('Doplňte bankovní účet v Údajích subjektu.');
  const cislo = dalsiCislo(s.data, s.faktury, f.typ, Number(f.datumVystaveni.slice(0, 4)));
  f.cislo = cislo; f.vs = vsZCisla(cislo); f.stav = 'vystavena';
  f.vystavil = ctx.state.auth.email; f.vystaveno = new Date().toISOString();
  f.historie = [...(f.historie || []), { at: f.vystaveno, by: ctx.state.auth.email, akce: 'vystavena' }];
  await saveDoc(ctx, s, 'fa', f);
  await ctx.audit(s.id, 'faktura.vystavena', `${cislo} – ${f.odberatel?.nazev} – ${czk(f.celkem)}`);
  return cislo;
}

/** Odešle fakturu e-mailem a zapíše to do faktury. */
export async function odeslatFakturu(ctx, s, f, { to, predmet, text }) {
  const blob = await invoicePdfBlob(f, s.data);
  const kopie = s.data.emailKopie !== false ? [ctx.state.auth.email] : [];
  await sendMail(ctx.state.auth.email, { to, bcc: kopie, subject: predmet, text, attachment: { name: pdfFileName(f, s.data), blob } });
  const at = new Date().toISOString();
  f.odeslano = [...(f.odeslano || []), { at, by: ctx.state.auth.email, to }];
  f.historie = [...(f.historie || []), { at, by: ctx.state.auth.email, akce: `odesláno e-mailem na ${to.join(', ')}` }];
  await saveDoc(ctx, s, 'fa', f);
  await ctx.audit(s.id, 'faktura.odeslana', `${f.cislo} → ${to.join(', ')}`);
}

export function prijemci(s, f) {
  const z = s.zakaznici.find((x) => x.id === f.zakaznikId);
  return (z?.emaily?.length ? z.emaily : (f.odberatel?.email ? [f.odberatel.email] : [])).filter(Boolean);
}

// ---------------------------------------------------------------- ŠABLONY
export async function viewSablony(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const rw = canWrite(ctx, s);
  const list = [...s.sablony].filter((t) => !t.smazano).sort((a, b) => (b.aktivni - a.aktivni) || zakNazev(s, a).localeCompare(zakNazev(s, b), 'cs'));
  main.insertAdjacentHTML('beforeend', `
    <div class="head-row"><h1>Opakované faktury – ${esc(ctx.subjectName(s))}</h1>
      ${rw ? '<div class="row"><button id="btn-navrh">Navrhnout z posledních faktur</button><button class="primary" id="btn-new">+ Nová šablona</button></div>' : ''}</div>
    <p class="muted">Šablona určuje, komu, co a kdy se fakturuje. Koncepty z ní vytvoříte v sekci <strong>Měsíční fakturace</strong> a vystavíte je až po kontrole.</p>
    <table class="grid"><thead><tr><th>Odběratel</th><th>Položky</th><th class="num">Částka</th><th>Opakování</th><th>Platnost</th><th>Stav</th></tr></thead><tbody>
    ${list.map((t) => `<tr class="click${t.aktivni ? '' : ' dim'}" data-id="${esc(t.id)}"><td>${esc(zakNazev(s, t))}</td>
      <td class="small">${esc(vyplnText((t.polozky || []).map((p) => p.popis).join(' · '), posunMesic(ym(new Date().getFullYear(), new Date().getMonth() + 1), t.obdobi === 'predchozi' ? -1 : 0)).slice(0, 110))}</td>
      <td class="num">${czk(soucet(t.polozky))}</td><td>${PERIODA[t.perioda] || ''}, ${esc(t.den)}. den<br><span class="muted small">${OBDOBI[t.obdobi] || ''}</span></td>
      <td>${t.platnostOd ? esc(t.platnostOd) : ''}${t.platnostDo ? ' – ' + esc(t.platnostDo) : ''}</td><td>${t.aktivni ? '<span class="pill ok">aktivní</span>' : '<span class="pill">pozastavená</span>'}</td></tr>`).join('') || '<tr><td colspan="6">Žádné šablony. Zkuste „Navrhnout z posledních faktur“.</td></tr>'}
    </tbody></table>
    <div id="navrh"></div>`);
  main.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => ctx.go('sablona', tr.dataset.id)));
  if (!rw) return;
  main.querySelector('#btn-new').onclick = () => ctx.go('sablona', 'nova');
  main.querySelector('#btn-navrh').onclick = () => navrh(main.querySelector('#navrh'), ctx, s);
}

const zakNazev = (s, t) => s.zakaznici.find((z) => z.id === t.zakaznikId)?.nazev || '?';

/** Najde poslední fakturu každého zákazníka (z posledních 3 měsíců) a navrhne z ní šablonu. */
export function navrhySablon(s, dnes = today()) {
  const od = posunMesic(dnes.slice(0, 7), -3);
  const posledni = new Map();
  for (const f of s.faktury) {
    if (f.smazano || f.typ !== 'faktura' || f.stav === 'koncept' || f.stav === 'stornovana' || !f.zakaznikId) continue;
    if ((f.datumVystaveni || '').slice(0, 7) < od) continue;
    const p = posledni.get(f.zakaznikId);
    if (!p || f.datumVystaveni > p.datumVystaveni) posledni.set(f.zakaznikId, f);
  }
  const maSablonu = new Set(s.sablony.filter((t) => !t.smazano).map((t) => t.zakaznikId));
  const out = [];
  for (const f of posledni.values()) {
    if (maSablonu.has(f.zakaznikId)) continue;
    const mv = f.datumVystaveni.slice(0, 7);
    let obdobi = null;
    const nahrad = (txt) => {
      for (const [kod, ymx] of [['aktualni', mv], ['predchozi', posunMesic(mv, -1)]]) {
        const [y, m] = ymx.split('-').map(Number);
        for (const [tvar, pole] of [['{mesic}', MESICE], ['{v_mesici}', MESICE_V]]) {
          const re = new RegExp(`${pole[m - 1]}\\s+${y}`, 'i');
          if (re.test(txt)) { obdobi ||= kod; return txt.replace(re, `${tvar} {rok}`); }
        }
        const re2 = new RegExp(`\\b${m}\\s*/\\s*${y}\\b`);
        if (re2.test(txt)) { obdobi ||= kod; return txt.replace(re2, '{obdobi}'); }
      }
      return txt;
    };
    const polozky = (f.polozky || []).map((p) => ({ popis: nahrad(p.popis), mnozstvi: p.mnozstvi, jednotka: p.jednotka || '', cena: p.cena, sleva: p.sleva || 0 }));
    out.push({
      zakaznikId: f.zakaznikId, typ: 'faktura', perioda: 'mesicne', den: Number(f.datumVystaveni.slice(8, 10)), obdobi: obdobi || 'predchozi',
      splatnostDni: f.splatnostDni ?? null, uvod: f.uvod || '', poznamka: f.poznamka || '', polozky, ucetCislo: f.ucet?.cislo || '',
      platnostOd: posunMesic(mv, 1), platnostDo: '', aktivni: true, zdrojFaktura: f.cislo, _bezPromenne: !obdobi,
    });
  }
  return out.sort((a, b) => zakNazev(s, a).localeCompare(zakNazev(s, b), 'cs'));
}

function navrh(box, ctx, s) {
  const list = navrhySablon(s);
  if (!list.length) { box.innerHTML = '<p class="note">Žádné návrhy: všichni zákazníci fakturovaní v posledních 3 měsících už šablonu mají.</p>'; return; }
  box.innerHTML = `<h2>Návrh šablon podle posledních faktur</h2>
    <p class="muted">Měsíc a rok v textu položek jsem nahradil proměnnými, takže se každý měsíc doplní samy. Zrušte zaškrtnutí u zákazníků, kteří se neopakují.</p>
    <table class="grid"><thead><tr><th></th><th>Odběratel</th><th>Položky (vzor)</th><th class="num">Částka</th><th>Den</th><th>Období</th><th>Podle faktury</th></tr></thead><tbody>
    ${list.map((t, i) => `<tr><td><input type="checkbox" data-i="${i}" ${t._bezPromenne ? '' : 'checked'}></td><td>${esc(zakNazev(s, t))}</td>
      <td class="small">${esc(t.polozky.map((p) => p.popis).join(' · '))}${t._bezPromenne ? '<br><span class="warn small">v textu není měsíc – zkontrolujte</span>' : ''}</td>
      <td class="num">${czk(soucet(t.polozky))}</td><td>${t.den}.</td><td>${OBDOBI[t.obdobi]}</td><td>${esc(t.zdrojFaktura)}</td></tr>`).join('')}
    </tbody></table>
    <button class="primary" id="btn-vytvor">Vytvořit vybrané šablony</button>`;
  box.querySelector('#btn-vytvor').onclick = async () => {
    const vybrane = [...box.querySelectorAll('input[data-i]:checked')].map((c) => list[Number(c.dataset.i)]);
    for (const t of vybrane) { delete t._bezPromenne; t.zalozeno = new Date().toISOString(); t.zalozil = ctx.state.auth.email; await saveDoc(ctx, s, 'sab', t); }
    await ctx.audit(s.id, 'sablona.zalozena', `${vybrane.length} šablon z návrhu`);
    await loadDocs(ctx, s, true);
    ctx.flash(`Vytvořeno ${vybrane.length} šablon.`); ctx.go('sablony');
  };
}

export async function viewSablona(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const id = ctx.state.detailId;
  const nyni = ym(new Date().getFullYear(), new Date().getMonth() + 1);
  const t = id === 'nova'
    ? { typ: 'faktura', perioda: 'mesicne', den: 1, obdobi: 'predchozi', splatnostDni: s.data.splatnost ?? 14, uvod: s.data.uvodText || '', polozky: [{ popis: '', mnozstvi: 1, jednotka: '', cena: 0, sleva: 0 }], platnostOd: nyni, aktivni: true }
    : s.sablony.find((x) => x.id === id);
  if (!t) { main.insertAdjacentHTML('beforeend', '<p>Šablona nenalezena.</p>'); return; }
  const rw = canWrite(ctx, s);
  const zak = s.zakaznici.filter((z) => !z.archiv || z.id === t.zakaznikId);
  main.insertAdjacentHTML('beforeend', `
    <p><button class="link" id="back">← Opakované faktury</button></p>
    <h1>${id === 'nova' ? 'Nová šablona' : 'Šablona – ' + esc(zakNazev(s, t))}</h1>
    <form id="f-sab" class="form2 wide"><fieldset ${rw ? '' : 'disabled'}>
      <div class="row">
        <label class="grow">Odběratel<select name="zakaznikId" required><option value="">— vyberte —</option>${zak.map((z) => `<option value="${esc(z.id)}" ${z.id === t.zakaznikId ? 'selected' : ''}>${esc(zakaznikText(z))}</option>`).join('')}</select></label>
        <label>Typ<select name="typ">${['faktura', 'zalohova'].map((x) => `<option value="${x}" ${t.typ === x ? 'selected' : ''}>${TYPY[x].nazev}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label>Opakování<select name="perioda">${Object.entries(PERIODA).map(([k, l]) => `<option value="${k}" ${t.perioda === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Den vystavení<input name="den" type="number" min="1" max="31" value="${esc(t.den)}"></label>
        <label>Fakturuje se<select name="obdobi">${Object.entries(OBDOBI).map(([k, l]) => `<option value="${k}" ${t.obdobi === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Splatnost (dní)<input name="splatnostDni" type="number" min="0" max="120" value="${esc(t.splatnostDni ?? '')}"></label>
      </div>
      <div class="row">
        <label>Platí od (měsíc)<input name="platnostOd" type="month" value="${esc(t.platnostOd || '')}"></label>
        <label>Platí do (měsíc, nepovinné)<input name="platnostDo" type="month" value="${esc(t.platnostDo || '')}"></label>
        <label class="inline"><input type="checkbox" name="aktivni" ${t.aktivni ? 'checked' : ''}> aktivní</label>
      </div>
      <label>Úvodní text<input name="uvod" value="${esc(t.uvod)}"></label>
      <table class="grid items"><thead><tr><th>Popis (lze použít proměnné)</th><th class="num">Množství</th><th>MJ</th><th class="num">Cena za MJ</th><th class="num">Sleva %</th><th class="num">Celkem</th><th></th></tr></thead>
        <tbody id="items">${(t.polozky || []).map(polozkaRow).join('')}</tbody></table>
      <div class="row space"><button type="button" id="btn-add" class="small">+ položka</button><div class="total">Celkem: <strong id="total">${czk(soucet(t.polozky))}</strong></div></div>
      <p class="muted small">Proměnné: <code>{mesic}</code> (říjen), <code>{v_mesici}</code> (říjnu), <code>{rok}</code>, <code>{mm}</code> (10), <code>{obdobi}</code> (10/2026), <code>{ctvrtleti}</code>. Doplní se podle fakturovaného období.</p>
      <p class="note" id="nahled"></p>
      <label>Poznámka na faktuře<input name="poznamka" value="${esc(t.poznamka)}"></label>
      </fieldset>
      ${rw ? `<div class="row"><button class="primary">Uložit šablonu</button>${id !== 'nova' ? '<button type="button" id="btn-del" class="danger">Smazat šablonu</button>' : ''}</div>` : ''}
    </form>`);
  const form = main.querySelector('#f-sab'); const items = main.querySelector('#items');
  const readItems = () => [...items.querySelectorAll('tr')].map((tr) => ({ popis: tr.querySelector('[name=popis]').value.trim(), mnozstvi: Number(tr.querySelector('[name=mnozstvi]').value || 0), jednotka: tr.querySelector('[name=jednotka]').value.trim(), cena: Number(tr.querySelector('[name=cena]').value || 0), sleva: Number(tr.querySelector('[name=sleva]').value || 0) }));
  const read = () => {
    const d = new FormData(form);
    Object.assign(t, { zakaznikId: d.get('zakaznikId'), typ: d.get('typ'), perioda: d.get('perioda'), den: Math.max(1, Math.min(31, Number(d.get('den') || 1))), obdobi: d.get('obdobi'),
      splatnostDni: d.get('splatnostDni') === '' ? null : Number(d.get('splatnostDni')), platnostOd: d.get('platnostOd') || '', platnostDo: d.get('platnostDo') || '', aktivni: d.get('aktivni') === 'on',
      uvod: d.get('uvod').trim(), poznamka: d.get('poznamka').trim(), polozky: readItems() });
  };
  const refresh = () => {
    read();
    items.querySelectorAll('tr').forEach((tr, i) => { tr.querySelector('.rc').textContent = czk(radkaCelkem(t.polozky[i])); });
    main.querySelector('#total').textContent = czk(soucet(t.polozky));
    let m = t.platnostOd && t.platnostOd > nyni ? t.platnostOd : nyni; let n = 0;
    while (!jeKFakturaci(t, m) && n++ < 24) m = posunMesic(m, 1);
    const k = t.aktivni && jeKFakturaci(t, m) ? konceptZeSablony(s, { ...t, id: t.id }, m) : null;
    main.querySelector('#nahled').innerHTML = k ? `Nejbližší faktura: vystavení <strong>${datum(k.datumVystaveni)}</strong>, splatnost ${datum(k.datumSplatnosti)}<br>${k.polozky.map((p) => esc(p.popis)).join('<br>')}` : 'Šablona je pozastavená nebo mimo platnost.';
  };
  if (rw) {
    form.addEventListener('input', refresh); form.addEventListener('change', refresh);
    items.addEventListener('click', (e) => { if (e.target.dataset.del != null) { read(); t.polozky.splice(Number(e.target.dataset.del), 1); items.innerHTML = t.polozky.map(polozkaRow).join(''); refresh(); } });
    main.querySelector('#btn-add').onclick = () => { read(); t.polozky.push({ popis: '', mnozstvi: 1, jednotka: '', cena: 0, sleva: 0 }); items.innerHTML = t.polozky.map(polozkaRow).join(''); refresh(); };
    const del = main.querySelector('#btn-del');
    if (del) del.onclick = async () => { if (!confirm('Smazat šablonu? Vystavené faktury zůstanou.')) return; t.smazano = true; t.aktivni = false; await saveDoc(ctx, s, 'sab', t); await loadDocs(ctx, s, true); ctx.go('sablony'); };
    form.onsubmit = async (e) => {
      e.preventDefault(); read();
      if (!t.zakaznikId) return ctx.toast('Vyberte odběratele.', 'err');
      t.polozky = t.polozky.filter((p) => p.popis);
      if (!t.polozky.length) return ctx.toast('Doplňte aspoň jednu položku.', 'err');
      t.historie = [...(t.historie || []), { at: new Date().toISOString(), by: ctx.state.auth.email, akce: id === 'nova' ? 'založena' : `upravena (${czk(soucet(t.polozky))})` }];
      await saveDoc(ctx, s, 'sab', t);
      await ctx.audit(s.id, id === 'nova' ? 'sablona.zalozena' : 'sablona.upravena', zakNazev(s, t));
      await loadDocs(ctx, s, true); ctx.flash('Šablona uložena.'); ctx.go('sablony');
    };
  }
  main.querySelector('#back').onclick = () => ctx.go('sablony');
  refresh();
}

// ---------------------------------------------------------------- MĚSÍČNÍ FAKTURACE
export async function viewMesic(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const rw = canWrite(ctx, s);
  const st = ctx.state.ui.mesic ||= { mesic: ym(new Date().getFullYear(), new Date().getMonth() + 1) };
  const mesic = st.mesic;
  const aktivni = s.sablony.filter((t) => !t.smazano && jeKFakturaci(t, mesic));
  const zMesice = s.faktury.filter((f) => !f.smazano && f.sablonaMesic === mesic);
  const hotoveSab = new Set(zMesice.map((f) => f.sablonaId));
  const kVytvoreni = aktivni.filter((t) => !hotoveSab.has(t.id));
  const koncepty = s.faktury.filter((f) => !f.smazano && f.stav === 'koncept' && (f.sablonaMesic === mesic || (f.datumVystaveni || '').startsWith(mesic)));
  const vystavene = s.faktury.filter((f) => !f.smazano && f.stav !== 'koncept' && f.typ !== 'opravny' && (f.sablonaMesic === mesic || (f.datumVystaveni || '').startsWith(mesic)))
    .sort((a, b) => String(a.cislo).localeCompare(String(b.cislo)));
  const neodeslane = vystavene.filter((f) => !(f.odeslano || []).length && f.stav !== 'stornovana' && f.zdroj !== 'vyfakturuj');
  const sum = (l) => czk(round2(l.reduce((x, f) => x + Number(f.celkem || 0), 0)));
  main.insertAdjacentHTML('beforeend', `
    <div class="head-row"><h1>Měsíční fakturace – ${esc(ctx.subjectName(s))}</h1>
      <div class="row"><button id="prev" class="small">◀</button><input type="month" id="mesic" value="${mesic}"><button id="next" class="small">▶</button></div></div>
    <p class="muted">Postup: 1) vytvořte koncepty ze šablon, 2) zkontrolujte je a vystavte, 3) odešlete e-mailem. Nic se nevystaví ani neodešle bez vašeho potvrzení.</p>
    <section class="box"><h2>1. Šablony k fakturaci v ${esc(mesicNazev(mesic))} (${kVytvoreni.length})</h2>
      ${kVytvoreni.length ? `<table class="grid"><thead><tr><th><input type="checkbox" id="all1" checked></th><th>Odběratel</th><th>Položky</th><th class="num">Částka</th><th>Vystavení</th></tr></thead><tbody>
        ${kVytvoreni.map((t) => { const k = konceptZeSablony(s, t, mesic); return `<tr><td><input type="checkbox" class="c1" value="${esc(t.id)}" checked></td><td>${esc(zakNazev(s, t))}</td><td class="small">${esc(k.polozky.map((p) => p.popis).join(' · '))}</td><td class="num">${czk(k.celkem)}</td><td>${datum(k.datumVystaveni)}</td></tr>`; }).join('')}
      </tbody></table>${rw ? '<button class="primary" id="btn-koncepty">Vytvořit koncepty</button>' : ''}` : `<p>${aktivni.length ? 'Všechny koncepty pro tento měsíc už jsou vytvořené.' : 'Žádná aktivní šablona pro tento měsíc. Šablony najdete v sekci Opakované faktury.'}</p>`}
    </section>
    <section class="box"><h2>2. Koncepty ke kontrole a vystavení (${koncepty.length}${koncepty.length ? ', ' + sum(koncepty) : ''})</h2>
      ${koncepty.length ? `<table class="grid"><thead><tr><th><input type="checkbox" id="all2" checked></th><th>Odběratel</th><th>Položky</th><th class="num">Částka</th><th>Vystavení</th><th></th></tr></thead><tbody>
        ${koncepty.map((f) => `<tr><td><input type="checkbox" class="c2" value="${esc(f.id)}" checked></td><td>${esc(f.odberatel?.nazev)}</td><td class="small">${esc((f.polozky || []).map((p) => p.popis).join(' · '))}</td><td class="num">${czk(f.celkem)}</td><td>${datum(f.datumVystaveni)}</td><td><button class="small" data-open="${esc(f.id)}">Upravit</button></td></tr>`).join('')}
      </tbody></table>${rw ? '<button class="primary" id="btn-vystavit">Vystavit vybrané</button>' : ''}` : '<p>Žádné koncepty.</p>'}
    </section>
    <section class="box"><h2>3. Vystavené v ${esc(mesicNazev(mesic))} (${vystavene.length}${vystavene.length ? ', ' + sum(vystavene) : ''})</h2>
      ${vystavene.length ? `<table class="grid"><thead><tr><th>${neodeslane.length ? '<input type="checkbox" id="all3" checked>' : ''}</th><th>Číslo</th><th>Odběratel</th><th>E-mail</th><th class="num">Částka</th><th>Stav</th><th>Odesláno</th></tr></thead><tbody>
        ${vystavene.map((f) => { const em = prijemci(s, f); const can = neodeslane.includes(f); return `<tr><td>${can && em.length ? `<input type="checkbox" class="c3" value="${esc(f.id)}" checked>` : ''}</td><td><button class="link" data-open="${esc(f.id)}">${esc(f.cislo)}</button></td><td>${esc(f.odberatel?.nazev)}</td><td class="small">${em.length ? esc(em.join(', ')) : (can ? '<span class="warn">chybí e-mail</span>' : '')}</td><td class="num">${czk(f.celkem)}</td><td>${stavPill(f)}</td><td class="small">${(f.odeslano || []).length ? esc(new Date(f.odeslano.at(-1).at).toLocaleDateString('cs-CZ')) : ''}</td></tr>`; }).join('')}
      </tbody></table>${rw && neodeslane.some((f) => prijemci(s, f).length) ? '<button class="primary" id="btn-odeslat">Odeslat vybrané e-mailem</button>' : ''}
      ${neodeslane.some((f) => !prijemci(s, f).length) ? '<p class="muted small">U zákazníků bez e-mailu doplňte adresu v Adresáři.</p>' : ''}` : '<p>Zatím nic.</p>'}
      <p id="progress" class="muted"></p>
    </section>`);
  const setM = (m) => { st.mesic = m; ctx.render(); };
  main.querySelector('#mesic').onchange = (e) => e.target.value && setM(e.target.value);
  main.querySelector('#prev').onclick = () => setM(posunMesic(mesic, -1));
  main.querySelector('#next').onclick = () => setM(posunMesic(mesic, 1));
  main.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => ctx.go('faktura', b.dataset.open)));
  for (const [all, cls] of [['#all1', '.c1'], ['#all2', '.c2'], ['#all3', '.c3']]) { const a = main.querySelector(all); if (a) a.onchange = () => main.querySelectorAll(cls).forEach((c) => (c.checked = a.checked)); }
  const checked = (cls) => [...main.querySelectorAll(cls + ':checked')].map((c) => c.value);
  const progress = main.querySelector('#progress');
  const b1 = main.querySelector('#btn-koncepty');
  if (b1) b1.onclick = async () => {
    const ids = checked('.c1'); b1.disabled = true;
    for (const id of ids) { const t = s.sablony.find((x) => x.id === id); const k = konceptZeSablony(s, t, mesic); k.historie = [{ at: new Date().toISOString(), by: ctx.state.auth.email, akce: `koncept ze šablony za ${mesicNazev(mesic)}` }]; await saveDoc(ctx, s, 'fa', k); }
    await ctx.audit(s.id, 'mesic.koncepty', `${ids.length} konceptů za ${mesic}`);
    await loadDocs(ctx, s, true); ctx.flash(`Vytvořeno ${ids.length} konceptů. Zkontrolujte je a vystavte.`); ctx.render();
  };
  const b2 = main.querySelector('#btn-vystavit');
  if (b2) b2.onclick = async () => {
    const ids = checked('.c2'); if (!ids.length) return;
    const vybrane = koncepty.filter((f) => ids.includes(f.id));
    if (!confirm(`Vystavit ${vybrane.length} faktur na celkem ${sum(vybrane)}?\nČísla se přidělí postupně, vystavené faktury už nepůjde upravit.`)) return;
    b2.disabled = true;
    await loadDocs(ctx, s, true);
    const cisla = [];
    try {
      for (const id of ids) { const f = s.faktury.find((x) => x.id === id); if (!f || f.stav !== 'koncept') continue; cisla.push(await vystavit(ctx, s, f)); progress.textContent = `Vystaveno ${cisla.length} / ${ids.length}…`; }
    } catch (e) { ctx.toast(e.message, 'err'); }
    await loadDocs(ctx, s, true); ctx.flash(`Vystaveno ${cisla.length} faktur${cisla.length ? ` (${cisla[0]} – ${cisla.at(-1)})` : ''}.`); ctx.render();
  };
  const b3 = main.querySelector('#btn-odeslat');
  if (b3) b3.onclick = async () => {
    const ids = checked('.c3'); if (!ids.length) return;
    const vybrane = vystavene.filter((f) => ids.includes(f.id));
    if (!confirm(`Odeslat ${vybrane.length} faktur e-mailem z účtu ${ctx.state.auth.email}?`)) return;
    b3.disabled = true;
    try { await gmailToken(ctx.state.auth.email); } catch (e) { b3.disabled = false; return ctx.toast(e.message, 'err'); }
    let ok = 0; const chyby = [];
    for (const f of vybrane) {
      try {
        await odeslatFakturu(ctx, s, f, { to: prijemci(s, f), predmet: fillTemplate(s.data.emailPredmet || VYCHOZI_PREDMET, f, s.data), text: fillTemplate(s.data.emailText || VYCHOZI_TEXT, f, s.data) });
        ok++; progress.textContent = `Odesláno ${ok} / ${vybrane.length}…`;
      } catch (e) { chyby.push(`${f.cislo}: ${e.message}`); }
    }
    await loadDocs(ctx, s, true);
    ctx.flash(`Odesláno ${ok} faktur.${chyby.length ? ' Chyby: ' + chyby.join('; ') : ''}`, chyby.length ? 'err' : 'ok'); ctx.render();
  };
}

// ---------------------------------------------------------------- odeslání jedné faktury (z detailu)
export function odeslatDialog(box, ctx, s, f) {
  const to = prijemci(s, f);
  box.innerHTML = `<h2>Odeslat e-mailem</h2>
    <label>Komu (oddělte čárkou)<input name="to" value="${esc(to.join(', '))}"></label>
    <label>Předmět<input name="predmet" value="${esc(fillTemplate(s.data.emailPredmet || VYCHOZI_PREDMET, f, s.data))}"></label>
    <label>Text<textarea name="text" rows="8">${esc(fillTemplate(s.data.emailText || VYCHOZI_TEXT, f, s.data))}</textarea></label>
    <p class="muted small">Odešle se z účtu ${esc(ctx.state.auth.email)} s fakturou v PDF${s.data.emailKopie !== false ? ', kopie vám do schránky' : ''}.</p>
    <button class="primary" id="btn-send">Odeslat</button>`;
  box.classList.remove('hidden');
  box.querySelector('#btn-send').onclick = async () => {
    const adr = box.querySelector('[name=to]').value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!adr.length || adr.some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))) return ctx.toast('Zkontrolujte e-mailové adresy.', 'err');
    const b = box.querySelector('#btn-send'); b.disabled = true; b.textContent = 'Odesílám…';
    try {
      await odeslatFakturu(ctx, s, f, { to: adr, predmet: box.querySelector('[name=predmet]').value, text: box.querySelector('[name=text]').value });
      await loadDocs(ctx, s, true); ctx.flash(`Faktura ${f.cislo} odeslána na ${adr.join(', ')}.`); ctx.go('faktura', f.id);
    } catch (e) { b.disabled = false; b.textContent = 'Odeslat'; ctx.toast(e.message, 'err'); }
  };
}
