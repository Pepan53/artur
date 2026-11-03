// ARTUR – české pomůcky: ARES, bankovní účty, IBAN.

export async function aresLookup(ico) {
  const clean = String(ico || '').replace(/\s/g, '');
  if (!/^\d{8}$/.test(clean)) throw new Error('IČO musí mít 8 číslic.');
  if (!icoValid(clean)) throw new Error('IČO nemá platný kontrolní součet.');
  let res;
  try {
    res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('ARES se nepodařilo kontaktovat. Údaje vyplňte ručně.');
  }
  if (res.status === 404) throw new Error('Subjekt s tímto IČO v ARES není.');
  if (!res.ok) throw new Error('ARES vrátil chybu ' + res.status + '.');
  const j = await res.json();
  const s = j.sidlo || {};
  const cislo = [s.cisloDomovni, s.cisloOrientacni].filter(Boolean).join('/');
  const ulice = [s.nazevUlice || s.nazevCastiObce || s.nazevObce, cislo].filter(Boolean).join(' ');
  return {
    nazev: j.obchodniJmeno || '',
    ico: j.ico || clean,
    dic: j.dic || '',
    ulice,
    psc: s.psc ? String(s.psc).replace(/^(\d{3})(\d{2})$/, '$1 $2') : '',
    obec: s.nazevObce || '',
    textovaAdresa: s.textovaAdresa || '',
  };
}

export function icoValid(ico) {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(ico[i]) * (8 - i);
  const r = sum % 11;
  const c = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return c === Number(ico[7]);
}

function mod11(digits, weights) {
  const d = digits.padStart(weights.length, '0');
  let s = 0;
  for (let i = 0; i < weights.length; i++) s += Number(d[i]) * weights[i];
  return s % 11 === 0;
}

/** Rozloží "19-123457/0800" → {prefix, number, bank}. Vrací null, pokud formát nesedí. */
export function parseAccount(text) {
  const m = String(text || '').replace(/\s/g, '').match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return null;
  const prefix = m[1] || '';
  const number = m[2];
  const bank = m[3];
  const ok = (!prefix || mod11(prefix, [10, 5, 8, 4, 2, 1])) && mod11(number, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]);
  return { prefix, number, bank, valid: ok };
}

export function ibanFromAccount(acc) {
  if (!acc) return '';
  const bban = acc.bank + acc.prefix.padStart(6, '0') + acc.number.padStart(10, '0');
  // CZ = 12 35, kontrolní číslice dle ISO 13616
  const numeric = bban + '123500';
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  return 'CZ' + check + bban;
}

export function formatIban(iban) {
  return (iban || '').replace(/(.{4})/g, '$1 ').trim();
}
