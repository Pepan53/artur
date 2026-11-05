// ARTUR – výpis z účtu Raiffeisenbank v PDF → stejná struktura jako parseGpc (výpisy s pohyby).
// Text se čte z PDF v prohlížeči (pdf.js), nic se nikam neposílá.
import { round2 } from './invoices.js?v=0.6.1';

const num = (s) => Number(String(s).replace(/\s| /g, '').replace(',', '.').replace(/CZK|EUR|USD/g, ''));
const dmy = (s) => { const m = String(s).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const stripZeros = (s) => String(s || '').replace(/^0+/, '');
const DATUM = /^\d{1,2}\.\s*\d{1,2}\.\s*\d{4}$/;

/** Seskupí textové položky stránky do řádků (podle y), v řádku seřadí podle x. */
function radky(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!it.str.trim()) continue;
    const r = rows.find((x) => Math.abs(x.y - it.y) <= 2.5);
    if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map((i) => i.str.trim()).join(' '); }
  return rows;
}

/**
 * pages: [[{str, x, y, w}]] – textové položky každé stránky (souřadnice PDF, y roste nahoru).
 * Vrací [výpis] ve tvaru parseGpc: { ucet, nazev, datumPredchozi, zustatekPredchozi, zustatek, obratDebet, obratKredit, cislo, datum, pohyby, kontrola, v_poradku }.
 */
export function parseRbPdf(pages) {
  const vsechnyRadky = pages.flatMap((p) => radky(p));
  const txt = (re) => { for (const r of vsechnyRadky) { const m = r.text.match(re); if (m) return m; } return null; };
  if (!txt(/Raiffeisenbank/)) throw new Error('Nejde o výpis z Raiffeisenbank.');
  const ucetM = txt(/Číslo účtu:\s*(?:(\d+)-)?(\d+)\/5500/);
  const obd = txt(/(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\s*-\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/);
  const cisloM = txt(/Pořadové č\. výpisu:\s*(?:za období:\s*)?(\d+)/) || txt(/výpisu:.*?\b(\d{1,3})\b(?!\.)/);
  const castka = (label) => { const m = txt(new RegExp(label + ':\\s*(-?[\\d \\u00a0]+[.,]\\d{2})')); return m ? num(m[1]) : null; };
  if (!ucetM || !obd) throw new Error('Ve výpisu chybí číslo účtu nebo období.');
  const v = {
    ucet: (ucetM[1] ? stripZeros(ucetM[1]) + '-' : '') + stripZeros(ucetM[2]),
    nazev: (txt(/Název účtu:\s*(.+)/) || [])[1]?.trim() || '',
    datumPredchozi: dmy(obd[1]), datum: dmy(obd[2]),
    zustatekPredchozi: castka('Počáteční zůstatek'), zustatek: castka('Konečný zůstatek'),
    obratKredit: castka('Příjmy celkem'), obratDebet: Math.abs(castka('Výdaje celkem') ?? 0),
    cislo: cisloM ? Number(cisloM[1]) : 0, pohyby: [], zdroj: 'pdf',
  };

  let tx = null;
  for (const items of pages) {
    const rows = radky(items);
    const hi = rows.findIndex((r) => /^Datum\b/.test(r.text) && /Částka/.test(r.text));
    if (hi < 0) continue;
    const h = rows[hi].items;
    const colX = (re) => h.find((i) => re.test(i.str))?.x;
    const xKat = colX(/^Kategorie/) ?? 100, xTyp = colX(/^Typ/) ?? 208, xVs = colX(/^VS$/) ?? 362, xPopl = colX(/^Poplatek/) ?? 440;
    const hCastka = h.find((i) => /^Částka/.test(i.str));
    const castkaKonec = hCastka ? hCastka.x + hCastka.w : 557;
    const sloupec = (i) => {
      if (i.x < xKat - 5) return 0; if (i.x < xTyp - 5) return 1; if (i.x < xVs - 5) return 2; if (i.x < xPopl - 5) return 3;
      return i.x + i.w > castkaKonec - 25 ? 5 : 4;
    };
    // řádky pod hlavičkou (3 řádky hlavičky), dokud nezačne patička
    for (const r of rows.slice(hi + 3)) {
      if (/^Zpráva pro klienta|^Vklad na tomto účtu|^Strana \d|^Raiffeisenbank a\.s\./.test(r.text) || r.y < 55) { if (/^Zpráva pro klienta/.test(r.text)) tx = null; continue; }
      const c = ['', '', '', '', '', ''];
      for (const i of r.items) { const k = sloupec(i); c[k] = (c[k] ? c[k] + ' ' : '') + i.str.trim(); }
      if (DATUM.test(c[0]) && /CZK$/.test(c[5]) && c[1]) {
        const a = num(c[5]);
        tx = { ucet: v.ucet, protiucet: '', bankaProti: '', idTransakce: '', castka: round2(Math.abs(a)), kod: a < 0 ? '1' : '2',
          smer: a < 0 ? 'vydej' : 'prijem', storno: false, vs: stripZeros(c[3]), ks: '', ss: '', datum: dmy(c[0]), datumValuty: dmy(c[0]),
          text: '', zprava: '', kategorie: c[1], typ: c[2], poplatek: c[4] ? Math.abs(num(c[4])) : 0, _r: 1 };
        v.pohyby.push(tx);
        continue;
      }
      if (!tx) continue;
      tx._r++;
      if (tx._r === 2) {
        if (DATUM.test(c[0])) tx.datumValuty = dmy(c[0]);
        const pu = c[1].match(/^(?:(\d+)-)?(\d+)\/(\d{4})$/);
        if (pu) { tx.protiucet = (pu[1] ? stripZeros(pu[1]) + '-' : '') + stripZeros(pu[2]) + '/' + pu[3]; tx.bankaProti = pu[3]; }
        tx.ks = stripZeros(c[3]);
        const z = c[2].replace(/\b(VS|KS|SS):\S*/g, '').trim(); if (z) tx.zprava = z;
      } else if (tx._r === 3) {
        if (/^\d+$/.test(c[0])) tx.idTransakce = c[0].padStart(13, '0');
        tx.nazevProti = c[1];
        tx.ss = stripZeros(c[3]);
        if (c[2]) tx.zprava = (tx.zprava ? tx.zprava + ' ' : '') + c[2];
      } else if (c[2] || c[1]) {
        tx.zprava = (tx.zprava ? tx.zprava + ' ' : '') + [c[1], c[2]].filter(Boolean).join(' ');
      }
    }
  }
  for (const p of v.pohyby) { p.text = p.zprava.slice(0, 20); delete p._r; }
  const kred = round2(v.pohyby.filter((p) => p.smer === 'prijem').reduce((s, p) => s + p.castka, 0));
  const deb = round2(v.pohyby.filter((p) => p.smer === 'vydej').reduce((s, p) => s + p.castka + (p.poplatek || 0), 0));
  v.kontrola = {
    kredit: Math.abs(kred - v.obratKredit) < 0.005, debet: Math.abs(deb - v.obratDebet) < 0.005,
    zustatek: Math.abs(round2(v.zustatekPredchozi + v.obratKredit - v.obratDebet) - v.zustatek) < 0.005,
  };
  v.v_poradku = v.kontrola.kredit && v.kontrola.debet && v.kontrola.zustatek && v.pohyby.length > 0;
  return [v];
}

let loading = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Nepodařilo se načíst ' + src)); document.head.appendChild(s); });
}
async function pdfjs() {
  if (!window.pdfjsLib) { loading ||= loadScript('vendor/pdfjs/pdf.min.js'); await loading; }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  return window.pdfjsLib;
}

/** Textové položky všech stránek PDF (v prohlížeči). */
export async function pdfPolozky(buf, lib) {
  const L = lib || (await pdfjs());
  const doc = await L.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.filter((it) => it.str).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })));
  }
  return pages;
}

export async function parsePdfVypis(buf) { return parseRbPdf(await pdfPolozky(buf)); }
