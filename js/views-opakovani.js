// ARTUR – etapa 3: šablony opakovaných faktur, měsíční fakturace, odeslání e-mailem.
import { TYPY, soucet, radkaCelkem, dalsiCislo, vsZCisla, addDays, czk, datum, round2 } from './invoices.js?v=0.6.3';
import { invoicePdfBlob, pdfFileName } from './pdf.js?v=0.6.3';
import { sendMail, fillTemplate, VYCHOZI_PREDMET, VYCHOZI_TEXT, gmailToken, vyjmenuj } from './mail.js?v=0.6.3';
import { esc, today, norm, loadDocs, saveDoc, canWrite, zakaznikText, snapshotOdberatele, polozkaRow, stavPill } from './views-fakturace.js?v=0.6.3';

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
  const konecMesice = `${mesic}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const splatnost = t.splatnostKonec ? konecMesice : addDays(dv, Number(t.splatnostDni ?? s.data.splatnost ?? 14));
  return {
    typ: t.typ || 'faktura', stav: 'koncept', datumVystaveni: dv, obdobiYm: obdobi,
    splatnostDni: Math.round((Date.parse(splatnost) - Date.parse(dv)) / 864e5), datumSplatnosti: splatnost,
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

/** Odešle jeden e-mail s jednou nebo více fakturami a zapíše to do každé z nich. */
export async function odeslatEmail(ctx, s, faktury, { to, predmet, text }) {
  const attachments = [];
  for (const f of faktury) attachments.push({ name: pdfFileName(f, s.data), blob: await invoicePdfBlob(f, s.data) });
  const kopie = s.data.emailKopie !== false ? [ctx.state.auth.email] : [];
  await sendMail(ctx.state.auth.email, { to, bcc: kopie, subject: predmet, text, attachments });
  const at = new Date().toISOString(); const me = ctx.state.auth.email;
  for (const f of faktury) {
    const spolu = faktury.filter((x) => x !== f).map((x) => x.cislo);
    f.odeslano = [...(f.odeslano || []), { at, by: me, to, spolu }];
    f.historie = [...(f.historie || []), { at, by: me, akce: `odesláno e-mailem na ${to.join(', ')}${spolu.length ? ` (v jednom e-mailu s ${spolu.join(', ')})` : ''}` }];
    await saveDoc(ctx, s, 'fa', f);
  }
  await ctx.audit(s.id, 'faktura.odeslana', `${faktury.map((f) => f.cislo).join(', ')} → ${to.join(', ')}`);
}
export const odeslatFakturu = (ctx, s, f, msg) => odeslatEmail(ctx, s, [f], msg);

export function prijemci(s, f) {
  const z = s.zakaznici.find((x) => x.id === f.zakaznikId);
  return (z?.emaily?.length ? z.emaily : (f.odberatel?.email ? [f.odberatel.email] : [])).filter(Boolean);
}

/**
 * Seskupí faktury do e-mailů podle příjemců (stejná sada adres = jeden e-mail).
 * Zákazník s volbou „posílat zvlášť“ dostane vlastní e-mail. Faktury bez e-mailu jsou v `bezEmailu`.
 */
export function emailSkupiny(s, faktury) {
  const skupiny = new Map(); const bezEmailu = [];
  for (const f of [...faktury].sort((a, b) => String(a.cislo).localeCompare(String(b.cislo)))) {
    const to = prijemci(s, f);
    if (!to.length) { bezEmailu.push(f); continue; }
    const z = s.zakaznici.find((x) => x.id === f.zakaznikId);
    const key = z?.samostatne ? 'z:' + (z.id || f.id) : [...new Set(to.map((x) => x.toLowerCase()))].sort().join(',');
    if (!skupiny.has(key)) skupiny.set(key, { key, to, faktury: [], zakaznici: [] });
    const g = skupiny.get(key); g.faktury.push(f);
    if (z && !g.zakaznici.includes(z)) g.zakaznici.push(z);
  }
  return { skupiny: [...skupiny.values()], bezEmailu };
}

/** Předmět a text e-mailu pro skupinu faktur (vlastní text zákazníka má přednost, když je ve skupině jediný). */
export function textSkupiny(s, g, podpis) {
  const z = g.zakaznici.length === 1 ? g.zakaznici[0] : null;
  const extra = {
    osloveni: g.zakaznici.map((x) => x.osloveni).find(Boolean) || '',
    mista: [...new Set(g.zakaznici.flatMap((x) => (x.misto ? [x.misto] : [])))].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true })),
    podpis,
  };
  return {
    predmet: fillTemplate((z?.emailPredmet) || s.data.emailPredmet || VYCHOZI_PREDMET, g.faktury, s.data, extra),
    text: fillTemplate((z?.emailText) || s.data.emailText || VYCHOZI_TEXT, g.faktury, s.data, extra),
  };
}

/** Šablony, ze kterých v daném měsíci ještě nevznikl koncept ani faktura (smazaný koncept se počítá jako vyřízený). */
export function sablonyKVytvoreni(s, mesic, aktivni = s.sablony.filter((t) => !t.smazano && jeKFakturaci(t, mesic))) {
  const hotove = new Set(s.faktury.filter((f) => f.sablonaMesic === mesic).map((f) => f.sablonaId));
  // faktura vystavená jinak (ručně, z vyfakturuj.cz) pro stejného zákazníka ve stejném měsíci na stejnou částku se počítá jako vyřízená
  const jinak = s.faktury.filter((f) => !f.smazano && !f.sablonaId && f.stav !== 'stornovana' && (f.datumVystaveni || '').startsWith(mesic));
  return aktivni.filter((t) => !hotove.has(t.id) && !jinak.some((f) => f.zakaznikId === t.zakaznikId && Math.abs(Number(f.celkem) - soucet(t.polozky)) < 0.005));
}

/** Automatická příprava: koncepty ze šablon, jejichž den vystavení v tomto měsíci už nastal. Vrací počet nových konceptů. */
export async function pripravitMesic(ctx, s, dnes = today()) {
  await loadDocs(ctx, s);
  const mesic = dnes.slice(0, 7);
  const k = sablonyKVytvoreni(s, mesic).filter((t) => konceptZeSablony(s, t, mesic).datumVystaveni <= dnes);
  if (!k.length) return 0;
  await loadDocs(ctx, s, true);
  const znovu = new Set(sablonyKVytvoreni(s, mesic).map((t) => t.id));
  let n = 0;
  for (const t of k) {
    if (!znovu.has(t.id)) continue;
    const f = konceptZeSablony(s, t, mesic);
    f.historie = [{ at: new Date().toISOString(), by: ctx.state.auth.email, akce: `koncept automaticky připraven ze šablony za ${mesicNazev(mesic)}` }];
    await saveDoc(ctx, s, 'fa', f); n++;
  }
  if (n) { await ctx.audit(s.id, 'mesic.koncepty', `${n} konceptů za ${mesic} připraveno automaticky`); await loadDocs(ctx, s, true); }
  return n;
}

/** Co v aktuálním měsíci čeká na schválení: koncepty a e-maily k odeslání. */
export function kSchvaleni(s, mesic) {
  const vMesici = (f) => !f.smazano && (f.sablonaMesic === mesic || (f.datumVystaveni || '').startsWith(mesic));
  const koncepty = s.faktury.filter((f) => vMesici(f) && f.stav === 'koncept').length;
  const neodeslane = s.faktury.filter((f) => vMesici(f) && f.stav !== 'koncept' && f.typ !== 'opravny' && f.stav !== 'stornovana' && f.zdroj !== 'vyfakturuj' && !(f.odeslano || []).length);
  return { mesic, koncepty, emaily: emailSkupiny(s, neodeslane).skupiny.length };
}

/** Má faktura splatnost na poslední den měsíce vystavení (tak to dělá vyfakturuj.cz)? */
export function jeKonecMesice(f) {
  const v = String(f.datumVystaveni || ''); const d = String(f.datumSplatnosti || '');
  if (!v || !d || v.slice(0, 7) !== d.slice(0, 7) || v === d) return false;
  const [y, m] = d.split('-').map(Number);
  return Number(d.slice(8)) === new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Šablony bez „do konce měsíce“, jejichž zákazník má poslední fakturu se splatností do konce měsíce. */
export function sablonyKonecMesice(s) {
  return s.sablony.filter((t) => !t.smazano && !t.splatnostKonec).filter((t) => {
    const f = s.faktury.filter((x) => !x.smazano && x.zakaznikId === t.zakaznikId && x.stav !== 'koncept' && x.typ === 'faktura')
      .sort((a, b) => (b.datumVystaveni || '').localeCompare(a.datumVystaveni || ''))[0];
    return f && jeKonecMesice(f);
  });
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
      <td class="num">${czk(soucet(t.polozky))}</td><td>${PERIODA[t.perioda] || ''}, ${esc(t.den)}. den<br><span class="muted small">${OBDOBI[t.obdobi] || ''} · splatnost ${t.splatnostKonec ? 'do konce měsíce' : (t.splatnostDni ?? s.data.splatnost ?? 14) + ' dní'}</span></td>
      <td>${t.platnostOd ? esc(t.platnostOd) : ''}${t.platnostDo ? ' – ' + esc(t.platnostDo) : ''}</td><td>${t.aktivni ? '<span class="pill ok">aktivní</span>' : '<span class="pill">pozastavená</span>'}</td></tr>`).join('') || '<tr><td colspan="6">Žádné šablony. Zkuste „Navrhnout z posledních faktur“.</td></tr>'}
    </tbody></table>
    <div id="navrh"></div>`);
  main.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => ctx.go('sablona', tr.dataset.id)));
  if (!rw) return;
  const km = sablonyKonecMesice(s);
  if (km.length) {
    main.querySelector('table.grid').insertAdjacentHTML('beforebegin', `<p class="note row space"><span>U ${km.length} ${km.length === 1 ? 'šablony' : 'šablon'} měla poslední faktura splatnost do konce měsíce, šablona ale počítá splatnost ve dnech.</span><button class="small primary" id="btn-konec">Nastavit splatnost do konce měsíce</button></p>`);
    main.querySelector('#btn-konec').onclick = async (e) => {
      e.target.disabled = true; const now = new Date().toISOString(); const me = ctx.state.auth.email;
      for (const t of km) { t.splatnostKonec = true; t.historie = [...(t.historie || []), { at: now, by: me, akce: 'splatnost nastavena do konce měsíce' }]; await saveDoc(ctx, s, 'sab', t); }
      await ctx.audit(s.id, 'sablona.upravena', `${km.length} šablon: splatnost do konce měsíce`);
      await loadDocs(ctx, s, true); ctx.flash(`Splatnost do konce měsíce nastavena u ${km.length} šablon.`); ctx.render();
    };
  }
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
      splatnostDni: f.splatnostDni ?? null, splatnostKonec: jeKonecMesice(f), uvod: f.uvod || '', poznamka: f.poznamka || '', polozky, ucetCislo: f.ucet?.cislo || '',
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
        <label>Splatnost (dní)<input name="splatnostDni" type="number" min="0" max="120" value="${esc(t.splatnostDni ?? '')}" ${t.splatnostKonec ? 'disabled' : ''}></label>
        <label class="inline"><input type="checkbox" name="splatnostKonec" ${t.splatnostKonec ? 'checked' : ''}> do konce měsíce</label>
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
      splatnostDni: (d.get('splatnostDni') ?? '') === '' ? (t.splatnostDni ?? null) : Number(d.get('splatnostDni')), splatnostKonec: d.get('splatnostKonec') === 'on', platnostOd: d.get('platnostOd') || '', platnostDo: d.get('platnostDo') || '', aktivni: d.get('aktivni') === 'on',
      uvod: d.get('uvod').trim(), poznamka: d.get('poznamka').trim(), polozky: readItems() });
  };
  const refresh = () => {
    read();
    form.splatnostDni.disabled = !!t.splatnostKonec;
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
  const kVytvoreni = sablonyKVytvoreni(s, mesic, aktivni);
  const koncepty = s.faktury.filter((f) => !f.smazano && f.stav === 'koncept' && (f.sablonaMesic === mesic || (f.datumVystaveni || '').startsWith(mesic)));
  const vystavene = s.faktury.filter((f) => !f.smazano && f.stav !== 'koncept' && f.typ !== 'opravny' && (f.sablonaMesic === mesic || (f.datumVystaveni || '').startsWith(mesic)))
    .sort((a, b) => String(a.cislo).localeCompare(String(b.cislo)));
  const neodeslane = vystavene.filter((f) => !(f.odeslano || []).length && f.stav !== 'stornovana' && f.zdroj !== 'vyfakturuj');
  const skup = emailSkupiny(s, neodeslane);
  const podpis = ctx.state.user?.podpis || '';
  ctx.state.kSchvaleni ||= {};
  if (mesic === today().slice(0, 7)) ctx.state.kSchvaleni[s.id] = kSchvaleni(s, mesic);
  const sum = (l) => czk(round2(l.reduce((x, f) => x + Number(f.celkem || 0), 0)));
  main.insertAdjacentHTML('beforeend', `
    <div class="head-row"><h1>Měsíční fakturace – ${esc(ctx.subjectName(s))}</h1>
      <div class="mesic-nav"><button id="prev" class="small" title="Předchozí měsíc" aria-label="Předchozí měsíc">◀</button><input type="month" id="mesic" value="${mesic}"><button id="next" class="small" title="Následující měsíc" aria-label="Následující měsíc">▶</button></div></div>
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
    <section class="box"><h2>3. E-maily k odeslání (${skup.skupiny.length})</h2>
      ${skup.skupiny.length ? `<p class="muted small">Faktury se stejnými příjemci jdou v jednom e-mailu. Odešle se z účtu ${esc(ctx.state.auth.email)}${s.data.emailKopie !== false ? ', kopie vám do schránky' : ''}. Text lze před odesláním upravit.</p>
        <div class="maily">${skup.skupiny.map((g, i) => { const tx = textSkupiny(s, g, podpis); return `<div class="mail-card" data-g="${i}">
          <div class="row space"><label class="inline"><input type="checkbox" class="c3" value="${i}" checked> <strong>${esc(g.to.join(', '))}</strong></label><span class="muted small">${g.faktury.length} ${g.faktury.length === 1 ? 'faktura' : g.faktury.length < 5 ? 'faktury' : 'faktur'} · ${sum(g.faktury)}</span></div>
          <div class="small">${g.faktury.map((f) => `<button class="link" data-open="${esc(f.id)}">${esc(f.cislo)}</button> ${esc(f.odberatel?.nazev || '')}`).join('<br>')}</div>
          <details><summary>Předmět: ${esc(tx.predmet)}</summary>
            <label>Komu (oddělte čárkou)<input class="m-to" value="${esc(g.to.join(', '))}"></label>
            <label>Předmět<input class="m-predmet" value="${esc(tx.predmet)}"></label>
            <label>Text<textarea class="m-text" rows="9">${esc(tx.text)}</textarea></label></details>
        </div>`; }).join('')}</div>
        ${rw ? `<button class="primary" id="btn-odeslat">Odeslat vybrané e-maily</button>` : ''}` : `<p>${neodeslane.length ? '' : 'Žádné vystavené faktury k odeslání.'}</p>`}
      ${skup.bezEmailu.length ? `<p class="warn small">Bez e-mailu (doplňte v Adresáři): ${skup.bezEmailu.map((f) => `<button class="link" data-open="${esc(f.id)}">${esc(f.cislo)}</button> ${esc(f.odberatel?.nazev || '')}`).join(', ')}</p>` : ''}
      <p id="progress" class="muted"></p>
    </section>
    <section class="box"><h2>Vystavené v ${esc(mesicNazev(mesic))} (${vystavene.length}${vystavene.length ? ', ' + sum(vystavene) : ''})</h2>
      ${vystavene.length ? `<table class="grid"><thead><tr><th>Číslo</th><th>Odběratel</th><th>E-mail</th><th class="num">Částka</th><th>Stav</th><th>Odesláno</th></tr></thead><tbody>
        ${vystavene.map((f) => { const em = prijemci(s, f); return `<tr><td><button class="link" data-open="${esc(f.id)}">${esc(f.cislo)}</button></td><td>${esc(f.odberatel?.nazev)}</td><td class="small">${esc(em.join(', '))}</td><td class="num">${czk(f.celkem)}</td><td>${stavPill(f)}</td><td class="small">${(f.odeslano || []).length ? esc(new Date(f.odeslano.at(-1).at).toLocaleDateString('cs-CZ')) : ''}</td></tr>`; }).join('')}
      </tbody></table>` : '<p>Zatím nic.</p>'}
    </section>`);
  const setM = (m) => { st.mesic = m; ctx.render(); };
  main.querySelector('#mesic').onchange = (e) => e.target.value && setM(e.target.value);
  main.querySelector('#prev').onclick = () => setM(posunMesic(mesic, -1));
  main.querySelector('#next').onclick = () => setM(posunMesic(mesic, 1));
  main.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => ctx.go('faktura', b.dataset.open)));
  for (const [all, cls] of [['#all1', '.c1'], ['#all2', '.c2']]) { const a = main.querySelector(all); if (a) a.onchange = () => main.querySelectorAll(cls).forEach((c) => (c.checked = a.checked)); }
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
    if (!confirm(`Vystavit ${vybrane.length} faktur na celkem ${sum(vybrane)}?\nČísla se přidělí postupně. Upravit je půjde i po vystavení.`)) return;
    b2.disabled = true;
    await loadDocs(ctx, s, true);
    const cisla = [];
    try {
      // čísla po sobě pro faktury, které půjdou v jednom e-mailu (stejní příjemci), uvnitř podle odběratele
      const klic = (f) => [prijemci(s, f).map((x) => x.toLowerCase()).sort().join(',') || '~', f.odberatel?.nazev || ''].join('|');
      const poradi = ids.map((id) => s.faktury.find((x) => x.id === id)).filter((f) => f && f.stav === 'koncept').sort((a, b) => klic(a).localeCompare(klic(b), 'cs', { numeric: true }));
      for (const f of poradi) { cisla.push(await vystavit(ctx, s, f)); progress.textContent = `Vystaveno ${cisla.length} / ${ids.length}…`; }
    } catch (e) { ctx.toast(e.message, 'err'); }
    await loadDocs(ctx, s, true); ctx.flash(`Vystaveno ${cisla.length} faktur${cisla.length ? ` (${cisla[0]} – ${cisla.at(-1)})` : ''}.`); ctx.render();
  };
  const b3 = main.querySelector('#btn-odeslat');
  if (b3) b3.onclick = async () => {
    const vybrane = checked('.c3').map(Number).map((i) => {
      const card = main.querySelector(`.mail-card[data-g="${i}"]`);
      return { g: skup.skupiny[i], to: card.querySelector('.m-to').value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), predmet: card.querySelector('.m-predmet').value, text: card.querySelector('.m-text').value };
    });
    if (!vybrane.length) return;
    const spatne = vybrane.find((v) => !v.to.length || v.to.some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)));
    if (spatne) return ctx.toast(`Zkontrolujte adresy: ${spatne.to.join(', ') || '(prázdné)'}`, 'err');
    const pocetF = vybrane.reduce((a, v) => a + v.g.faktury.length, 0);
    if (!confirm(`Odeslat ${vybrane.length} e-mailů s ${pocetF} fakturami z účtu ${ctx.state.auth.email}?`)) return;
    b3.disabled = true;
    try { await gmailToken(ctx.state.auth.email); } catch (e) { b3.disabled = false; return ctx.toast(e.message, 'err'); }
    let ok = 0; const chyby = [];
    for (const v of vybrane) {
      try { await odeslatEmail(ctx, s, v.g.faktury, v); ok++; progress.textContent = `Odesílám ${ok} / ${vybrane.length}…`; } catch (e) { chyby.push(`${v.to.join(', ')}: ${e.message}`); }
    }
    await loadDocs(ctx, s, true);
    ctx.flash(`Odesláno ${ok} ${ok === 1 ? 'e-mail' : ok < 5 ? 'e-maily' : 'e-mailů'}.${chyby.length ? ' Chyby: ' + chyby.join('; ') : ''}`, chyby.length ? 'err' : 'ok'); ctx.render();
  };
}

// ---------------------------------------------------------------- odeslání jedné faktury (z detailu)
export function odeslatDialog(box, ctx, s, f) {
  const to = prijemci(s, f);
  const z = s.zakaznici.find((x) => x.id === f.zakaznikId);
  const tx = textSkupiny(s, { to, faktury: [f], zakaznici: z ? [z] : [] }, ctx.state.user?.podpis || '');
  box.innerHTML = `<h2>Odeslat e-mailem</h2>
    <label>Komu (oddělte čárkou)<input name="to" value="${esc(to.join(', '))}"></label>
    <label>Předmět<input name="predmet" value="${esc(tx.predmet)}"></label>
    <label>Text<textarea name="text" rows="9">${esc(tx.text)}</textarea></label>
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
