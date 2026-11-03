// ARTUR – etapa 4: výpisy z banky (GPC) a párování úhrad.
import * as C from './crypto.js?v=0.5.4';
import { parseGpc, sparuj, klicPohybu } from './gpc.js?v=0.5.4';
import { STAVY, uhrazeno, stavPodleUhrad, czk, datum, round2 } from './invoices.js?v=0.5.4';
import { esc, loadDocs, canWrite, saveZak } from './views-fakturace.js?v=0.5.4';

const ucetBezBanky = (c) => String(c || '').split('/')[0].replace(/^0+/, '');

/** Zapíše úhradu do faktury (bez uložení). */
function pripisUhradu(f, p, by, zdroj = 'výpis') {
  f.uhrady = [...(f.uhrady || []), { datum: p.datum, castka: p.castka, zdroj, txId: klicPohybu(p), protiucet: p.protiucet || '', by }];
  f.stav = stavPodleUhrad(f);
  f.historie = [...(f.historie || []), { at: new Date().toISOString(), by, akce: `úhrada ${czk(p.castka)} z ${datum(p.datum)} (${zdroj}${p.protiucet ? ', ' + p.protiucet : ''})` }];
}

async function ulozit(ctx, s, polozky) {
  const now = new Date().toISOString(); const me = ctx.state.auth.email;
  const enc = [];
  for (const { id, t, obj } of polozky) {
    const d = { ...obj, zmeneno: now, zmenil: me }; delete d.id;
    enc.push({ id, data: { t, enc: await C.sealJson(s.dek, d, `doc:${s.id}:${id}`) } });
  }
  await ctx.state.store.putDocs(s.id, enc);
}

/** Naučí protiúčet zákazníkovi (pro příští párování bez VS). */
async function naucUcet(ctx, s, f, p) {
  if (!p.protiucet || !f.zakaznikId) return;
  const z = s.zakaznici.find((x) => x.id === f.zakaznikId);
  if (!z || (z.ucty || []).some((u) => ucetBezBanky(u) === ucetBezBanky(p.protiucet))) return;
  z.ucty = [...(z.ucty || []), p.protiucet];
  await saveZak(ctx, s, z);
}

export async function viewBanka(main, ctx) {
  const s = ctx.needSubject(main); if (!s) return;
  await loadDocs(ctx, s);
  const rw = canWrite(ctx, s);
  const ucty = (s.data.ucty || []).map((u) => ucetBezBanky(u.cislo));
  const tx = s.banka || [];
  const navrhy = tx.filter((t) => t.stav === 'navrh');
  const nesp = tx.filter((t) => t.stav === 'nesparovano').sort((a, b) => b.datum.localeCompare(a.datum));
  const vypisy = [...(s.vypisy || [])].sort((a, b) => b.datum.localeCompare(a.datum));
  const otevrene = s.faktury.filter((f) => !f.smazano && ['vystavena', 'castecne', 'prevzata'].includes(f.stav) && f.typ !== 'opravny')
    .sort((a, b) => (b.datumVystaveni || '').localeCompare(a.datumVystaveni || ''));
  const chybejici = [];
  const byAcc = {};
  for (const v of vypisy) (byAcc[v.ucet + ':' + v.datum.slice(0, 4)] ||= []).push(v.cislo);
  for (const [k, cisla] of Object.entries(byAcc)) { const mx = Math.max(...cisla); for (let i = 1; i <= mx; i++) if (!cisla.includes(i)) chybejici.push(`${k.replace(':', ' / ')} č. ${i}`); }
  main.insertAdjacentHTML('beforeend', `
    <h1>Banka a úhrady – ${esc(ctx.subjectName(s))}</h1>
    ${rw ? `<section class="box"><h2>Nahrát výpisy GPC</h2>
      <p class="muted">Výpisy z internetového bankovnictví RB ve formátu GPC (ABO). Můžete vybrat více souborů najednou. Stejný výpis nahraný znovu nic nezdvojí.</p>
      <input type="file" id="gpc" accept=".gpc,.GPC" multiple>
      <div id="gpc-prev"></div></section>` : ''}
    ${navrhy.length ? `<section class="box warn"><h2>Ke kontrole (${navrhy.length})</h2>
      <table class="grid"><thead><tr><th>Datum</th><th class="num">Částka</th><th>VS / účet</th><th>Navržená faktura</th><th>Proč</th><th></th></tr></thead><tbody>
      ${navrhy.map((t) => { const f = s.faktury.find((x) => x.id === t.fakturaId); return `<tr><td>${datum(t.datum)}</td><td class="num">${czk(t.castka)}</td><td class="small">${esc(t.vs || '–')}<br>${esc(t.protiucet)}</td>
        <td>${f ? `${esc(f.cislo)} – ${esc(f.odberatel?.nazev)}<br><span class="small muted">zbývá ${czk(round2(f.celkem - uhrazeno(f)))}</span>` : '?'}</td><td class="small">${esc(t.duvod)}</td>
        <td>${rw ? `<button class="small primary" data-ok="${esc(t.id)}">Potvrdit</button> <button class="small" data-no="${esc(t.id)}">Odmítnout</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></section>` : ''}
    <section class="box"><h2>Nespárované příjmy (${nesp.length})</h2>
      ${nesp.length ? `<table class="grid"><thead><tr><th>Datum</th><th class="num">Částka</th><th>VS</th><th>Protiúčet / zpráva</th><th>Přiřadit</th></tr></thead><tbody>
      ${nesp.map((t) => `<tr><td>${datum(t.datum)}</td><td class="num">${czk(t.castka)}</td><td>${esc(t.vs)}</td><td class="small">${esc(t.protiucet)}<br>${esc((t.zprava || t.text || '').slice(0, 60))}</td>
        <td>${rw ? `<div class="row"><select data-sel="${esc(t.id)}"><option value="">— faktura —</option>${otevrene.map((f) => `<option value="${esc(f.id)}" ${Math.abs(round2(f.celkem - uhrazeno(f)) - t.castka) < 0.005 ? 'style="font-weight:600"' : ''}>${esc(f.cislo)} · ${esc((f.odberatel?.nazev || '').slice(0, 30))} · zbývá ${czk(round2(f.celkem - uhrazeno(f)))}</option>`).join('')}</select>
          <button class="small primary" data-assign="${esc(t.id)}">Přiřadit</button><button class="small" data-ign="${esc(t.id)}">Není úhrada faktury</button></div>` : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p>Všechny příjmy jsou spárované nebo označené.</p>'}
    </section>
    <section class="box"><h2>Nahrané výpisy (${vypisy.length})</h2>
      ${chybejici.length ? `<p class="warn">Chybí výpisy: ${esc(chybejici.slice(0, 12).join(', '))}${chybejici.length > 12 ? '…' : ''}</p>` : ''}
      ${vypisy.length ? `<table class="grid"><thead><tr><th>Účet</th><th>Č.</th><th>Období</th><th class="num">Příjmy</th><th class="num">Výdaje</th><th class="num">Zůstatek</th><th>Kontrola</th></tr></thead><tbody>
      ${vypisy.map((v) => `<tr><td>${esc(v.ucet)}</td><td>${v.cislo}</td><td>${datum(v.datumOd)} – ${datum(v.datum)}</td><td class="num">${czk(v.obratKredit)}</td><td class="num">${czk(v.obratDebet)}</td><td class="num">${czk(v.zustatek)}</td><td>${v.v_poradku ? '<span class="pill ok">sedí</span>' : '<span class="pill err">nesedí</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<p>Zatím žádné.</p>'}
    </section>`);
  if (!rw) return;

  // --- nahrání výpisů
  const prev = main.querySelector('#gpc-prev');
  main.querySelector('#gpc').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    const vys = [];
    for (const file of files) {
      try { for (const v of parseGpc(await file.arrayBuffer())) vys.push({ ...v, soubor: file.name }); } catch (err) { return ctx.toast(`${file.name}: ${err.message}`, 'err'); }
    }
    const cizi = vys.filter((v) => !ucty.includes(v.ucet));
    if (cizi.length) return ctx.toast(`Výpis účtu ${cizi[0].ucet} nepatří k subjektu ${ctx.subjectName(s)} (účty subjektu: ${ucty.join(', ') || 'žádné – doplňte v Údajích subjektu'}).`, 'err');
    const zname = new Set(tx.map((t) => t.id));
    const nove = vys.flatMap((v) => v.pohyby).filter((p) => !zname.has(klicPohybu(p)));
    const r = sparuj(nove, s.faktury, s.zakaznici);
    const prijmy = nove.filter((p) => p.smer === 'prijem');
    const sum = (l) => czk(round2(l.reduce((a, x) => a + (x.p ? x.p.castka : x.castka), 0)));
    prev.innerHTML = `
      <table class="grid"><thead><tr><th>Soubor</th><th>Výpis</th><th>Období</th><th class="num">Zůstatek</th><th>Kontrola</th></tr></thead><tbody>
      ${vys.map((v) => `<tr><td class="small">${esc(v.soubor)}</td><td>${esc(v.ucet)} č. ${v.cislo}</td><td>${datum(v.datumPredchozi)} – ${datum(v.datum)}</td><td class="num">${czk(v.zustatek)}</td><td>${v.v_poradku ? '<span class="pill ok">obraty a zůstatky sedí</span>' : '<span class="pill err">nesedí – zkontrolujte soubor</span>'}</td></tr>`).join('')}
      </tbody></table>
      <p>Nových pohybů: <strong>${nove.length}</strong> (z toho příjmů ${prijmy.length}), už nahraných ${vys.reduce((a, v) => a + v.pohyby.length, 0) - nove.length}.</p>
      <ul>
        <li>Spárováno automaticky podle VS: <strong>${r.auto.length}</strong> (${sum(r.auto)})${r.auto.some((a) => a.castecna) ? `, z toho ${r.auto.filter((a) => a.castecna).length} částečných úhrad` : ''}</li>
        <li>Ke kontrole: <strong>${r.navrhy.length}</strong></li>
        <li>Nespárované příjmy: <strong>${r.nesparovane.length}</strong> (${sum(r.nesparovane)})</li>
      </ul>
      ${nove.length ? '<button class="primary" id="btn-ulozit">Uložit výpisy a spárovat</button>' : '<p class="note">Žádné nové pohyby.</p>'}
      <p id="gpc-stav" class="muted"></p>`;
    const b = prev.querySelector('#btn-ulozit'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true; const st = prev.querySelector('#gpc-stav'); st.textContent = 'Ukládám…';
      const me = ctx.state.auth.email; const pol = [];
      const zmenene = new Map();
      for (const a of r.auto) { pripisUhradu(a.f, a.p, me); zmenene.set(a.f.id, a.f); }
      const stavTx = new Map();
      for (const a of r.auto) stavTx.set(klicPohybu(a.p), { stav: 'sparovano', fakturaId: a.f.id });
      for (const n of r.navrhy) stavTx.set(klicPohybu(n.p), { stav: 'navrh', fakturaId: n.f.id, duvod: n.duvod });
      for (const p of nove) {
        const id = klicPohybu(p);
        const st2 = stavTx.get(id) || { stav: p.smer === 'prijem' ? (p.storno ? 'storno' : 'nesparovano') : 'vydaj' };
        pol.push({ id, t: 'bank', obj: { ...p, ...st2 } });
      }
      for (const v of vys) {
        const { pohyby, ...hl } = v;
        const id = ['vyp', v.ucet, v.datum, v.cislo].join('_');
        if (!(s.vypisy || []).some((x) => x.id === id)) pol.push({ id, t: 'vyp', obj: { ...hl, datumOd: v.datumPredchozi, pocetPohybu: pohyby.length, nahral: me } });
      }
      for (const f of zmenene.values()) pol.push({ id: f.id, t: 'fa', obj: f });
      try { await ulozit(ctx, s, pol); } catch (err) { b.disabled = false; st.textContent = ''; return ctx.toast('Uložení selhalo: ' + err.message, 'err'); }
      for (const a of r.auto) await naucUcet(ctx, s, a.f, a.p);
      await ctx.audit(s.id, 'banka.import', `${vys.length} výpisů, ${nove.length} pohybů, spárováno ${r.auto.length}, ke kontrole ${r.navrhy.length}, nespárováno ${r.nesparovane.length}`);
      await loadDocs(ctx, s, true);
      ctx.flash(`Výpisy uloženy. Spárováno ${r.auto.length} úhrad, ke kontrole ${r.navrhy.length}, nespárovaných příjmů ${r.nesparovane.length}.`);
      ctx.render();
    };
  };

  // --- potvrzení / odmítnutí / ruční přiřazení / ignorování
  const najdiTx = (id) => tx.find((t) => t.id === id);
  const zmenTx = async (t, zmena, faktura) => {
    const pol = [{ id: t.id, t: 'bank', obj: { ...t, ...zmena } }];
    if (faktura) pol.push({ id: faktura.id, t: 'fa', obj: faktura });
    await ulozit(ctx, s, pol);
  };
  main.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = async () => {
    const t = najdiTx(b.dataset.ok); const f = s.faktury.find((x) => x.id === t.fakturaId); if (!f) return;
    pripisUhradu(f, t, ctx.state.auth.email, 'výpis, potvrzeno'); await zmenTx(t, { stav: 'sparovano' }, f); await naucUcet(ctx, s, f, t);
    await ctx.audit(s.id, 'banka.parovani', `${czk(t.castka)} → ${f.cislo}`); await loadDocs(ctx, s, true); ctx.flash(`Úhrada přiřazena k ${f.cislo}. Stav: ${STAVY[f.stav]}.`); ctx.render();
  }));
  main.querySelectorAll('[data-no]').forEach((b) => (b.onclick = async () => { const t = najdiTx(b.dataset.no); await zmenTx(t, { stav: 'nesparovano', fakturaId: null, duvod: null }); await loadDocs(ctx, s, true); ctx.render(); }));
  main.querySelectorAll('[data-assign]').forEach((b) => (b.onclick = async () => {
    const t = najdiTx(b.dataset.assign); const fid = main.querySelector(`[data-sel="${CSS.escape(t.id)}"]`).value;
    const f = s.faktury.find((x) => x.id === fid); if (!f) return ctx.toast('Vyberte fakturu.', 'err');
    pripisUhradu(f, t, ctx.state.auth.email, 'výpis, ručně'); await zmenTx(t, { stav: 'sparovano', fakturaId: f.id }, f); await naucUcet(ctx, s, f, t);
    await ctx.audit(s.id, 'banka.parovani', `${czk(t.castka)} → ${f.cislo} (ručně)`); await loadDocs(ctx, s, true); ctx.flash(`Úhrada přiřazena k ${f.cislo}. Stav: ${STAVY[f.stav]}.`); ctx.render();
  }));
  main.querySelectorAll('[data-ign]').forEach((b) => (b.onclick = async () => {
    const t = najdiTx(b.dataset.ign); await zmenTx(t, { stav: 'ignorovano' }); await loadDocs(ctx, s, true); ctx.flash('Označeno jako „není úhrada faktury“.'); ctx.render();
  }));
}
