// ARTUR – logika faktur: číslování, součty, stavy, QR Platba.

export const TYPY = {
  faktura: { nazev: 'Faktura', radaKlic: 'rada', vychoziRada: '{RRRR}{NNNN}' },
  zalohova: { nazev: 'Zálohová faktura', radaKlic: 'radaZal', vychoziRada: 'ZF{RRRR}{NNNN}' },
  opravny: { nazev: 'Opravný daňový doklad', radaKlic: 'radaOpr', vychoziRada: 'OD{RRRR}{NNNN}' },
};

export const STAVY = {
  koncept: 'Koncept',
  vystavena: 'Vystavená',
  castecne: 'Částečně uhrazená',
  zaplacena: 'Uhrazená',
  stornovana: 'Stornovaná',
  prevzata: 'Převzatá (úhrada neověřena)',
};

export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

export function radkaCelkem(p) {
  const zaklad = round2(Number(p.mnozstvi || 0) * Number(p.cena || 0));
  const sleva = round2(zaklad * Number(p.sleva || 0) / 100);
  return round2(zaklad - sleva);
}

export function soucet(polozky) {
  return round2((polozky || []).reduce((s, p) => s + radkaCelkem(p), 0));
}

export function uhrazeno(f) {
  return round2((f.uhrady || []).reduce((s, u) => s + Number(u.castka || 0), 0));
}

/** Stav podle úhrad (koncept a storno se nemění). */
export function stavPodleUhrad(f) {
  if (f.stav === 'koncept' || f.stav === 'stornovana') return f.stav;
  if (f.stav === 'prevzata' && !(f.uhrady || []).length) return 'prevzata';
  const celkem = round2(f.celkem);
  const u = uhrazeno(f);
  if (celkem <= 0) return 'zaplacena';
  if (u >= celkem - 0.005) return 'zaplacena';
  if (u > 0) return 'castecne';
  return 'vystavena';
}

export function poSplatnosti(f, dnes = new Date().toISOString().slice(0, 10)) {
  return ['vystavena', 'castecne'].includes(f.stav) && f.datumSplatnosti < dnes;
}

/** Sestaví číslo podle masky, např. {RRRR}{NNNN} → 20260001. */
export function formatCislo(maska, rok, poradi) {
  return maska.replace(/\{R{4}\}/g, String(rok)).replace(/\{R{2}\}/g, String(rok).slice(2))
    .replace(/\{(N+)\}/g, (_, n) => String(poradi).padStart(n.length, '0'));
}

/** Z čísla podle masky vytáhne pořadí (nebo null, když číslo masce neodpovídá). */
export function poradiZCisla(maska, rok, cislo) {
  const re = '^' + maska.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\\?\{R{4}\\?\}/g, String(rok)).replace(/\\?\{R{2}\\?\}/g, String(rok).slice(2))
    .replace(/\\?\{N+\\?\}/g, '(\\d+)') + '$';
  const m = String(cislo).match(new RegExp(re));
  return m ? Number(m[1]) : null;
}

/** Další volné číslo v řadě pro daný typ a rok. */
export function dalsiCislo(subjekt, faktury, typ, rok) {
  const maska = subjekt[TYPY[typ].radaKlic] || TYPY[typ].vychoziRada;
  let max = Number((subjekt.posledniCislo || {})[`${typ}:${rok}`] || 0);
  for (const f of faktury) {
    if (f.typ !== typ || !f.cislo) continue;
    const n = poradiZCisla(maska, rok, f.cislo);
    if (n != null && n > max) max = n;
  }
  return formatCislo(maska, rok, max + 1);
}

export function vsZCisla(cislo) {
  const d = String(cislo || '').replace(/\D/g, '');
  return d.slice(-10);
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/** Řetězec QR Platby (formát SPD 1.0, ČBA). */
export function qrPlatba({ iban, castka, vs, splatnost, zprava, prijemce }) {
  const clean = (s, n) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, n);
  const parts = ['SPD', '1.0', 'ACC:' + String(iban).replace(/\s/g, '').toUpperCase(), 'AM:' + round2(castka).toFixed(2), 'CC:CZK'];
  if (splatnost) parts.push('DT:' + splatnost.replace(/-/g, ''));
  if (zprava) parts.push('MSG:' + clean(zprava, 60));
  if (prijemce) parts.push('RN:' + clean(prijemce, 35));
  if (vs) parts.push('X-VS:' + String(vs).replace(/\D/g, '').slice(0, 10));
  return parts.join('*');
}

export const czk = (x) => new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(x || 0)).replace(/ /g, ' ') + ' Kč';
export const datum = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
export const cislo = (x) => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 }).format(Number(x || 0)).replace(/ /g, ' ');

/** Řádky adresy pro fakturu. */
export function adresaRadky(x) {
  return [x.nazev, x.kontakt, x.ulice, [x.psc, x.obec].filter(Boolean).join(' '), x.zeme && x.zeme !== 'Česká republika' ? x.zeme : 'Česká republika'].filter(Boolean);
}
