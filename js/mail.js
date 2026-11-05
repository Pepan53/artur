// ARTUR – odeslání faktur e-mailem přes Gmail API (oprávnění gmail.send) z účtu přihlášeného uživatele.
// V demo režimu se e-mail jen uloží do localStorage („artur-demo-outbox“).
import { GOOGLE_CLIENT_ID, isDemo } from './config.js?v=0.6.1';
import { czk, datum } from './invoices.js?v=0.6.1';

let gisLoading = null;
let token = null; // { value, exp }

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res; s.onerror = () => rej(new Error('Nepodařilo se načíst přihlášení Google pro Gmail.'));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/** Získá přístupový token pro odesílání (při prvním použití se zobrazí souhlas Google). */
export async function gmailToken(email) {
  if (isDemo()) return 'demo';
  if (token && token.exp > Date.now() + 60000) return token.value;
  if (!GOOGLE_CLIENT_ID) throw new Error('Odesílání přes Gmail ještě není nastavené (chybí GOOGLE_CLIENT_ID).');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/gmail.send',
      login_hint: email,
      callback: (r) => {
        if (r.error) return reject(new Error('Gmail: ' + (r.error_description || r.error)));
        token = { value: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: (e) => reject(new Error('Gmail: ' + (e.message || e.type || 'přihlášení zrušeno'))),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64utf8 = (str) => b64(new TextEncoder().encode(str));
const encHeader = (str) => (/^[\x20-\x7e]*$/.test(str) ? str : `=?UTF-8?B?${b64utf8(str)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

/** Sestaví zprávu MIME (text + PDF přílohy). */
export async function buildMime({ from, to, cc = [], bcc = [], subject, text, attachment, attachments }) {
  const boundary = 'artur_' + Math.random().toString(36).slice(2);
  const prilohy = attachments || (attachment ? [attachment] : []);
  const casti = [];
  for (const a of prilohy) {
    const pdf = new Uint8Array(await a.blob.arrayBuffer());
    casti.push(`--${boundary}`, `Content-Type: application/pdf; name="${encHeader(a.name)}"`, `Content-Disposition: attachment; filename="${encHeader(a.name)}"`,
      'Content-Transfer-Encoding: base64', '', wrap76(b64(pdf)));
  }
  const lines = [
    from ? `From: ${from}` : null,
    `To: ${to.join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : null,
    bcc.length ? `Bcc: ${bcc.join(', ')}` : null,
    `Subject: ${encHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64utf8(text)),
    ...casti,
    `--${boundary}--`,
    '',
  ].filter((l) => l !== null);
  return lines.join('\r\n');
}

export async function sendMail(email, msg) {
  const mime = await buildMime(msg);
  if (isDemo()) {
    let box = [];
    try { box = JSON.parse(localStorage.getItem('artur-demo-outbox') || '[]'); } catch { /* prázdné */ }
    box.push({ at: new Date().toISOString(), to: msg.to, subject: msg.subject, text: msg.text, attachments: (msg.attachments || [msg.attachment]).map((a) => a.name), size: mime.length });
    localStorage.setItem('artur-demo-outbox', JSON.stringify(box));
    return { id: 'demo-' + box.length };
  }
  const t = await gmailToken(email);
  const raw = b64utf8(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // mime je čisté ASCII kromě hlaviček již zakódovaných → b64utf8 je bezpečné
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
  });
  if (r.status === 401) { token = null; throw new Error('Platnost přihlášení ke Gmailu vypršela, zkuste odeslat znovu.'); }
  if (!r.ok) throw new Error('Gmail odmítl odeslání: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

export const VYCHOZI_PREDMET = '{Faktura} {cislo} – {dodavatel}';
export const VYCHOZI_TEXT = `{osloveni},

v příloze zasíláme {fakturu}:
{seznam_faktur}

Platbu prosím pošlete na účet {ucet}.

Děkujeme a přejeme hezký den.
{podpis}`;

const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
/** Fakturované období faktury (YYYY-MM): ze šablony, jinak předchozí měsíc před vystavením. */
export function obdobiFaktury(f) {
  if (f.obdobiYm) return f.obdobiYm;
  const [y, m] = String(f.datumVystaveni || '').split('-').map(Number);
  if (!y) return '';
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** „A“, „A a B“, „A, B a C“ */
export const vyjmenuj = (l) => (l.length <= 1 ? (l[0] || '') : `${l.slice(0, -1).join(', ')} a ${l.at(-1)}`);

/**
 * Doplní proměnné do předmětu/textu e-mailu pro jednu nebo více faktur.
 * extra: { osloveni, mista: ['Vajgar 571', …], podpis }
 */
export function fillTemplate(tpl, fa, s, extra = {}) {
  const list = Array.isArray(fa) ? fa : [fa];
  const f = list[0] || {};
  const jedna = list.length === 1;
  const celkem = list.reduce((a, x) => a + Number(x.celkem || 0), 0);
  const ob = obdobiFaktury(f); const [oy, om] = ob ? ob.split('-').map(Number) : [];
  const mista = (extra.mista || []).filter(Boolean);
  const vice = mista.length > 1 || mista.some((m) => /,| a /.test(m));
  const podpis = String(extra.podpis || '{dodavatel}').replace(/\{dodavatel\}/g, s.nazev || '');
  const map = {
    cislo: list.map((x) => x.cislo).join(', '), castka: czk(jedna ? f.celkem : celkem), celkem: czk(celkem), pocet: String(list.length),
    splatnost: datum(f.datumSplatnosti), vystaveno: datum(f.datumVystaveni), ucet: f.ucet?.cislo || '', vs: list.map((x) => x.vs).join(', '),
    dodavatel: s.nazev || '', odberatel: vyjmenuj([...new Set(list.map((x) => x.odberatel?.nazev || ''))]),
    faktura: jedna ? 'faktura' : 'faktury', Faktura: jedna ? 'Faktura' : 'Faktury', fakturu: jedna ? 'fakturu' : 'faktury', Fakturu: jedna ? 'Fakturu' : 'Faktury',
    mesic: om ? MESICE[om - 1] : '', rok: oy ? String(oy) : '',
    osloveni: extra.osloveni || 'Dobrý den',
    misto: vyjmenuj(mista), v_domech: mista.length ? `${vice ? 'v domech' : 'v domě'} ${vyjmenuj(mista)}` : '',
    seznam_faktur: list.map((x) => `– ${x.cislo}, ${x.odberatel?.nazev || ''}, ${czk(x.celkem)}, VS ${x.vs}, splatnost ${datum(x.datumSplatnosti)}`).join('\n'),
    podpis,
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/[ \t]+([.,])/g, '$1').replace(/[ \t]{2,}/g, ' ');
}
