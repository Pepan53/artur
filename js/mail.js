// ARTUR – odeslání faktur e-mailem přes Gmail API (oprávnění gmail.send) z účtu přihlášeného uživatele.
// V demo režimu se e-mail jen uloží do localStorage („artur-demo-outbox“).
import { GOOGLE_CLIENT_ID, isDemo } from './config.js?v=0.4.1';
import { czk, datum } from './invoices.js?v=0.4.1';

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

/** Sestaví zprávu MIME (text + PDF příloha). */
export async function buildMime({ from, to, cc = [], bcc = [], subject, text, attachment }) {
  const boundary = 'artur_' + Math.random().toString(36).slice(2);
  const pdf = new Uint8Array(await attachment.blob.arrayBuffer());
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
    `--${boundary}`,
    `Content-Type: application/pdf; name="${encHeader(attachment.name)}"`,
    `Content-Disposition: attachment; filename="${encHeader(attachment.name)}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(pdf)),
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
    box.push({ at: new Date().toISOString(), to: msg.to, subject: msg.subject, text: msg.text, attachment: msg.attachment.name, size: mime.length });
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

export const VYCHOZI_PREDMET = 'Faktura {cislo} – {dodavatel}';
export const VYCHOZI_TEXT = `Dobrý den,

v příloze zasíláme fakturu č. {cislo} na částku {castka} se splatností {splatnost}.
Platbu prosím pošlete na účet {ucet}, variabilní symbol {vs}.

Děkujeme a přejeme hezký den.
{dodavatel}`;

export function fillTemplate(tpl, f, s) {
  const map = { cislo: f.cislo, castka: czk(f.celkem), splatnost: datum(f.datumSplatnosti), vystaveno: datum(f.datumVystaveni), ucet: f.ucet?.cislo || '', vs: f.vs, dodavatel: s.nazev, odberatel: f.odberatel?.nazev || '' };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}
