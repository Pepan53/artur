import assert from 'node:assert/strict';
globalThis.location = { search: '' }; globalThis.localStorage = { getItem: () => null };
const O = await import('../js/views-opakovani.js');
assert.equal(O.vyplnText('úklid v měsíci {mesic} {rok}', '2026-10'), 'úklid v měsíci říjen 2026');
assert.equal(O.vyplnText('za {v_mesici} {rok}, {obdobi}, {mm}, {ctvrtleti}', '2026-02'), 'za únoru 2026, 2/2026, 02, 1. čtvrtletí');
assert.equal(O.posunMesic('2026-01', -1), '2025-12');
assert.equal(O.posunMesic('2026-12', 1), '2027-01');
const t = { aktivni: true, perioda: 'ctvrtletne', platnostOd: '2026-01' };
assert.deepEqual(['2026-01', '2026-02', '2026-04', '2026-07'].map((m) => O.jeKFakturaci(t, m)), [true, false, true, true]);
assert.equal(O.jeKFakturaci({ aktivni: true, perioda: 'mesicne', platnostOd: '2026-11', platnostDo: '2027-01' }, '2027-02'), false);
assert.equal(O.jeKFakturaci({ aktivni: false, perioda: 'mesicne' }, '2027-02'), false);
const s = { data: { ucty: [{ cislo: '732627175/5500', vychozi: true }], splatnost: 14 }, zakaznici: [{ id: 'z1', nazev: 'SVJ 571' }, { id: 'z2', nazev: 'PLOTY' }], sablony: [], faktury: [
  { zakaznikId: 'z1', typ: 'faktura', stav: 'prevzata', datumVystaveni: '2026-11-01', splatnostDni: 29, polozky: [{ popis: 'úklidové služby domu Vajgar 571 měsíci říjen 2026', mnozstvi: 1, cena: 2400 }], cislo: '20260200' },
  { zakaznikId: 'z1', typ: 'faktura', stav: 'prevzata', datumVystaveni: '2026-10-01', polozky: [{ popis: 'úklidové služby domu Vajgar 571 měsíci září 2026', mnozstvi: 1, cena: 2400 }], cislo: '20260180' },
  { zakaznikId: 'z2', typ: 'faktura', stav: 'prevzata', datumVystaveni: '2026-11-01', polozky: [{ popis: 'Správa webu za listopad 2026', mnozstvi: 1, cena: 20000 }], cislo: '20260201' },
] };
const n = O.navrhySablon(s, '2026-11-03');
assert.equal(n.length, 2);
const a = n.find((x) => x.zakaznikId === 'z1'); const b = n.find((x) => x.zakaznikId === 'z2');
assert.equal(a.polozky[0].popis, 'úklidové služby domu Vajgar 571 měsíci {mesic} {rok}'); assert.equal(a.obdobi, 'predchozi'); assert.equal(a.den, 1); assert.equal(a.platnostOd, '2026-12');
assert.equal(b.polozky[0].popis, 'Správa webu za {mesic} {rok}'); assert.equal(b.obdobi, 'aktualni');
const k = O.konceptZeSablony(s, { ...a, id: 't1' }, '2026-12');
assert.equal(k.polozky[0].popis, 'úklidové služby domu Vajgar 571 měsíci listopad 2026');
assert.equal(k.datumVystaveni, '2026-12-01'); assert.equal(k.datumSplatnosti, '2026-12-30'); assert.equal(k.celkem, 2400); assert.equal(k.sablonaMesic, '2026-12');
const k2 = O.konceptZeSablony(s, { ...b, id: 't2', den: 31 }, '2027-02');
assert.equal(k2.datumVystaveni, '2027-02-28'); assert.equal(k2.polozky[0].popis, 'Správa webu za únor 2027');
const M = await import('../js/mail.js');
const mime = await M.buildMime({ to: ['a@b.cz'], bcc: ['me@x.cz'], subject: 'Faktura 2026 – Dvořáková', text: 'Dobrý den', attachment: { name: 'Faktura-1-Žlutý.pdf', blob: new Blob([new Uint8Array([37, 80, 68, 70])]) } });
assert.ok(mime.includes('Subject: =?UTF-8?B?')); assert.ok(mime.includes('JVBERg==')); assert.ok(/^[\x00-\x7f]*$/.test(mime), 'MIME je čisté ASCII');
assert.equal(M.fillTemplate('Faktura {cislo} na {castka} do {splatnost} {x}', { cislo: '20260214', celkem: 2400, datumSplatnosti: '2026-12-30' }, { nazev: 'POSTME' }), 'Faktura 20260214 na 2 400,00 Kč do 30.12.2026 {x}');
console.log('OPAKOVÁNÍ: VŠECHNY TESTY OK');

import { jeKonecMesice } from '../js/views-opakovani.js';
assert.equal(jeKonecMesice({ datumVystaveni: '2026-11-01', datumSplatnosti: '2026-11-30' }), true);
assert.equal(jeKonecMesice({ datumVystaveni: '2026-02-01', datumSplatnosti: '2026-02-28' }), true);
assert.equal(jeKonecMesice({ datumVystaveni: '2026-11-01', datumSplatnosti: '2026-11-15' }), false);
assert.equal(jeKonecMesice({ datumVystaveni: '2026-11-01', datumSplatnosti: '2026-12-01' }), false);
console.log('jeKonecMesice OK');
