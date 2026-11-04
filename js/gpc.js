// ARTUR – výpisy GPC (ABO) z Raiffeisenbank a párování plateb s fakturami.
import { round2, uhrazeno } from './invoices.js?v=0.5.9';

const amt = (s) => Number(s) / 100;
const dmy = (s) => `20${s.slice(4, 6)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
const stripZeros = (s) => s.replace(/^0+/, '');

/** Číslo účtu z 16 znaků GPC → "prefix-cislo/banka" (bez banky). */
function ucetZGpc(s) {
  const all = stripZeros(s);
  if (!all) return '';
  const cislo = all.slice(-10).replace(/^0+/, '');
  const prefix = all.length > 10 ? stripZeros(all.slice(0, -10)) : '';
  return (prefix ? prefix + '-' : '') + cislo;
}

/** Načte soubor GPC (ArrayBuffer nebo string). Vrací výpisy s pohyby. */
export function parseGpc(input) {
  const text = typeof input === 'string' ? input : new TextDecoder('windows-1250').decode(input);
  const vypisy = [];
  let v = null; let last = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\s+$/, '');
    if (!l) continue;
    const t = l.slice(0, 3);
    if (t === '074') {
      v = {
        ucet: ucetZGpc(l.slice(3, 19)), nazev: l.slice(19, 39).trim(), datumPredchozi: dmy(l.slice(39, 45)),
        zustatekPredchozi: amt(l.slice(45, 59)) * (l[59] === '-' ? -1 : 1), zustatek: amt(l.slice(60, 74)) * (l[74] === '-' ? -1 : 1),
        obratDebet: amt(l.slice(75, 89)), obratKredit: amt(l.slice(90, 104)), cislo: Number(l.slice(105, 108)), datum: dmy(l.slice(108, 114)), pohyby: [],
      };
      vypisy.push(v);
    } else if (t === '075' && v) {
      const kod = l[60];
      const ksPole = l.slice(71, 81); // 00 + kód banky (4) + KS (4)
      last = {
        ucet: ucetZGpc(l.slice(3, 19)), protiucet: ucetZGpc(l.slice(19, 35)), bankaProti: ksPole.slice(2, 6),
        idTransakce: l.slice(35, 48), castka: amt(l.slice(48, 60)), kod,
        smer: kod === '2' || kod === '4' ? 'prijem' : 'vydej', storno: kod === '4' || kod === '5',
        vs: stripZeros(l.slice(61, 71)), ks: stripZeros(ksPole.slice(6, 10)), ss: stripZeros(l.slice(81, 91)),
        datumValuty: dmy(l.slice(91, 97)), text: l.slice(97, 117).trim(), datum: l.length >= 128 ? dmy(l.slice(122, 128)) : dmy(l.slice(91, 97)), zprava: '',
      };
      if (last.protiucet) last.protiucet += '/' + last.bankaProti;
      v.pohyby.push(last);
    } else if ((t === '076' || t === '078' || t === '079') && last) {
      last.zprava = (last.zprava + ' ' + l.slice(3).trim()).trim();
    }
  }
  for (const vy of vypisy) {
    const kred = round2(vy.pohyby.filter((p) => p.smer === 'prijem').reduce((s, p) => s + (p.storno ? -p.castka : p.castka), 0));
    const deb = round2(vy.pohyby.filter((p) => p.smer === 'vydej').reduce((s, p) => s + (p.storno ? -p.castka : p.castka), 0));
    vy.kontrola = {
      kredit: Math.abs(kred - vy.obratKredit) < 0.005, debet: Math.abs(deb - vy.obratDebet) < 0.005,
      zustatek: Math.abs(round2(vy.zustatekPredchozi + vy.obratKredit - vy.obratDebet) - vy.zustatek) < 0.005,
    };
    vy.v_poradku = vy.kontrola.kredit && vy.kontrola.debet && vy.kontrola.zustatek;
  }
  return vypisy;
}

/** Jednoznačný klíč pohybu (kvůli opakovanému nahrání stejného výpisu). */
export function klicPohybu(p) {
  return ['tx', p.ucet, p.datum, p.idTransakce.trim() || '0', p.castka.toFixed(2), p.vs, p.protiucet].join('_').replace(/[^\w.-]/g, '-');
}

const cislaUctu = (z) => (z?.ucty || []).map((u) => u.replace(/\s/g, '').replace(/^0+/, ''));

/**
 * Navrhne párování příchozích plateb.
 * faktury: všechny faktury subjektu (vystavené, převzaté); zakaznici: adresář.
 * Vrací { auto:[{p,f}], navrhy:[{p,f,duvod}], nesparovane:[p] }. Faktury se nemění.
 */
export function sparuj(pohyby, faktury, zakaznici) {
  const otevrene = faktury.filter((f) => !f.smazano && ['vystavena', 'castecne', 'prevzata'].includes(f.stav) && f.typ !== 'opravny');
  const zbyva = new Map(otevrene.map((f) => [f.id, round2(f.celkem - uhrazeno(f))]));
  const podleVs = new Map();
  for (const f of otevrene) { const k = String(f.vs || '').replace(/^0+/, ''); if (k) { if (!podleVs.has(k)) podleVs.set(k, []); podleVs.get(k).push(f); } }
  const zakPodleUctu = new Map();
  for (const z of zakaznici || []) for (const u of cislaUctu(z)) zakPodleUctu.set(u, z.id);
  const auto = []; const navrhy = []; const nesparovane = [];
  const prijmy = pohyby.filter((p) => p.smer === 'prijem' && !p.storno).sort((a, b) => a.datum.localeCompare(b.datum));
  for (const p of prijmy) {
    const kand = (podleVs.get(p.vs) || []).filter((f) => zbyva.get(f.id) > 0.005);
    if (kand.length) {
      const f = kand.find((x) => Math.abs(zbyva.get(x.id) - p.castka) < 0.005) || kand[0];
      const z = zbyva.get(f.id);
      if (p.castka <= z + 0.005) { auto.push({ p, f, castecna: p.castka < z - 0.005 }); zbyva.set(f.id, round2(z - p.castka)); }
      else { navrhy.push({ p, f, duvod: `přeplatek: přišlo ${p.castka.toFixed(2)}, zbývá ${z.toFixed(2)}` }); }
      continue;
    }
    const zid = p.protiucet ? zakPodleUctu.get(p.protiucet.replace(/^0+/, '')) : null;
    if (zid) {
      const shoda = otevrene.filter((f) => f.zakaznikId === zid && Math.abs(zbyva.get(f.id) - p.castka) < 0.005).sort((a, b) => a.datumSplatnosti.localeCompare(b.datumSplatnosti));
      if (shoda.length) { navrhy.push({ p, f: shoda[0], duvod: p.vs ? `jiný VS (${p.vs}), ale známý účet zákazníka a stejná částka` : 'bez VS, známý účet zákazníka a stejná částka' }); zbyva.set(shoda[0].id, 0); continue; }
    }
    nesparovane.push(p);
  }
  return { auto, navrhy, nesparovane };
}
