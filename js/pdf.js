// ARTUR – PDF faktury (pdfmake, písmo Roboto s českou diakritikou, QR Platba).
import { TYPY, radkaCelkem, czk, datum, cislo, qrPlatba, adresaRadky, vsZCisla } from './invoices.js?v=0.5.9';

let loading = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Nepodařilo se načíst ' + src));
    document.head.appendChild(s);
  });
}
export function loadPdfMake() {
  if (window.pdfMake?.vfs) return Promise.resolve(window.pdfMake);
  if (!loading) loading = loadScript('vendor/pdfmake.min.js').then(() => loadScript('vendor/vfs_fonts.js')).then(() => window.pdfMake);
  return loading;
}

/** Definice dokumentu pro pdfmake. f = faktura, s = údaje dodavatele (subjekt). */
export function invoiceDoc(f, s) {
  const typ = TYPY[f.typ] || TYPY.faktura;
  const ucet = f.ucet || (s.ucty || []).find((u) => u.vychozi) || (s.ucty || [])[0] || {};
  const odb = f.odberatel || {};
  const vs = f.vs || vsZCisla(f.cislo);
  const muted = '#5d6b7a';
  const line = '#d9e0e8';
  const dodavatel = [
    ...adresaRadky(s),
    s.ico ? 'IČO: ' + s.ico : null,
    s.dic ? 'DIČ: ' + s.dic : null,
    ucet.iban ? 'IBAN: ' + ucet.iban : null,
    s.telefon ? 'Telefon: ' + s.telefon : null,
    s.email ? 'E-mail: ' + s.email : null,
  ].filter(Boolean);
  const odberatel = [
    ...adresaRadky(odb),
    odb.ico ? 'IČO: ' + odb.ico : null,
    odb.dic ? 'DIČ: ' + odb.dic : null,
    odb.email ? 'E-mail: ' + odb.email : null,
  ].filter(Boolean);
  const showQty = (f.polozky || []).some((p) => Number(p.mnozstvi) !== 1 || p.jednotka || Number(p.sleva));
  const head = showQty
    ? [{ text: 'Popis', style: 'th' }, { text: 'Množství', style: 'th', alignment: 'right' }, { text: 'Cena za MJ', style: 'th', alignment: 'right' }, { text: 'Celkem', style: 'th', alignment: 'right' }]
    : [{ text: 'Popis', style: 'th' }, { text: 'Celkem', style: 'th', alignment: 'right' }];
  const rows = (f.polozky || []).map((p) => showQty
    ? [p.popis || '', { text: `${cislo(p.mnozstvi)} ${p.jednotka || ''}`.trim() + (Number(p.sleva) ? `\nsleva ${cislo(p.sleva)} %` : ''), alignment: 'right' }, { text: czk(p.cena), alignment: 'right' }, { text: czk(radkaCelkem(p)), alignment: 'right' }]
    : [p.popis || '', { text: czk(radkaCelkem(p)), alignment: 'right' }]);
  const qr = f.celkem > 0 && ucet.iban && f.typ !== 'opravny'
    ? qrPlatba({ iban: ucet.iban, castka: f.celkem, vs, splatnost: f.datumSplatnosti, zprava: `${typ.nazev} ${f.cislo}`, prijemce: s.nazev })
    : null;
  const nadpis = f.stav === 'koncept' ? `${typ.nazev} – KONCEPT` : `${typ.nazev} č. ${f.cislo}`;
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    info: { title: `${typ.nazev} ${f.cislo || ''}`.trim(), author: s.nazev, creator: 'ARTUR' },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.15 },
    styles: {
      h1: { fontSize: 17, bold: true },
      label: { fontSize: 8, color: muted, bold: true, characterSpacing: 0.4 },
      big: { fontSize: 13, bold: true },
      th: { fontSize: 8, color: muted, bold: true },
    },
    footer: (page, pages) => ({
      margin: [40, 20, 40, 0],
      columns: [
        { text: [s.zapis ? s.zapis + '\n' : '', s.paticka || 'Vystaveno v systému ARTUR'].join(''), fontSize: 7.5, color: muted },
        { text: `Strana ${page}/${pages}`, alignment: 'right', fontSize: 7.5, color: muted, width: 80 },
      ],
    }),
    content: [
      { columns: [{ text: '' }, { stack: [{ text: nadpis, style: 'h1', alignment: 'right' }, { text: 'Neplátce DPH', alignment: 'right', color: muted, margin: [0, 2, 0, 0] }], width: 300 }] },
      f.opravuje ? { text: `Opravuje doklad č. ${f.opravuje}`, alignment: 'right', color: muted, margin: [0, 2, 0, 0] } : {},
      {
        margin: [0, 24, 0, 0],
        columns: [
          { stack: [{ text: 'DODAVATEL', style: 'label', margin: [0, 0, 0, 4] }, { text: dodavatel[0], bold: true }, ...dodavatel.slice(1).map((t) => ({ text: t }))] },
          { stack: [{ text: 'ODBĚRATEL', style: 'label', margin: [0, 0, 0, 4] }, { text: odberatel[0] || '', bold: true }, ...odberatel.slice(1).map((t) => ({ text: t }))] },
        ],
        columnGap: 30,
      },
      {
        margin: [0, 22, 0, 0],
        table: {
          widths: ['*', '*', '*'],
          body: [
            [{ text: 'ČÍSLO ÚČTU', style: 'label' }, { text: 'VARIABILNÍ SYMBOL', style: 'label' }, { text: f.typ === 'opravny' ? 'ČÁSTKA' : 'CELKEM K ÚHRADĚ', style: 'label' }],
            [{ text: ucet.cislo || '', style: 'big' }, { text: vs, style: 'big' }, { text: czk(f.celkem), style: 'big' }],
            [{ text: 'DATUM VYSTAVENÍ', style: 'label', margin: [0, 8, 0, 0] }, { text: 'DATUM SPLATNOSTI', style: 'label', margin: [0, 8, 0, 0] }, { text: 'ZPŮSOB PLATBY', style: 'label', margin: [0, 8, 0, 0] }],
            [datum(f.datumVystaveni), datum(f.datumSplatnosti), 'Bankovní převod'],
          ],
        },
        layout: { hLineWidth: (i) => (i === 0 || i === 4 ? 0.8 : 0), vLineWidth: () => 0, hLineColor: () => line, paddingTop: () => 6, paddingBottom: () => 2 },
      },
      f.uvod ? { text: f.uvod, margin: [0, 18, 0, 0] } : {},
      {
        margin: [0, 14, 0, 0],
        table: { headerRows: 1, widths: showQty ? ['*', 70, 80, 80] : ['*', 90], body: [head, ...rows] },
        layout: { hLineWidth: (i, node) => (i === 1 || i === node.table.body.length ? 0.8 : 0), vLineWidth: () => 0, hLineColor: () => line, paddingTop: () => 5, paddingBottom: () => 5 },
      },
      {
        margin: [0, 14, 0, 0],
        columns: [
          qr ? { stack: [{ qr, fit: 105, eccLevel: 'M' }, { text: 'QR Platba', fontSize: 7.5, color: muted, margin: [0, 3, 0, 0] }], width: 130 } : { text: '', width: 130 },
          { text: [{ text: (f.typ === 'opravny' ? 'Celkem: ' : 'Celkem k úhradě: ') }, { text: czk(f.celkem), bold: true }], alignment: 'right', fontSize: 13, margin: [0, 4, 0, 0] },
        ],
      },
      f.poznamka ? { text: f.poznamka, margin: [0, 16, 0, 0], color: muted } : {},
    ],
  };
}

export async function invoicePdfBlob(f, s) {
  const pm = await loadPdfMake();
  return new Promise((res, rej) => {
    try { pm.createPdf(invoiceDoc(f, s)).getBlob(res); } catch (e) { rej(e); }
  });
}

export function pdfFileName(f, s) {
  const typ = (TYPY[f.typ] || TYPY.faktura).nazev.split(' ')[0];
  const firma = (s.nazev || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  return `${typ}-${f.cislo || 'koncept'}-${firma}.pdf`;
}
