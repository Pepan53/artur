// ARTUR – šifrování v prohlížeči (WebCrypto).
// Model:
//  - Každý uživatel má pár klíčů RSA-OAEP 3072. Veřejný klíč je v cloudu čitelně,
//    soukromý klíč je v cloudu jen zašifrovaný klíčem odvozeným z jeho šifrovacího hesla.
//  - Každý subjekt (IČO) má náhodný datový klíč AES-256-GCM (DEK). V cloudu je jen
//    zabalený veřejným klíčem každého oprávněného člena.
//  - Záchranný klíč subjektu = DEK zapsaný jako text; uloží se do složky FAKTUR a do trezoru.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const PBKDF2_ITERATIONS = 600000;

export const b64 = {
  from(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  to(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

// ---------- heslo uživatele ----------
async function passwordKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function fingerprint(publicJwk) {
  const h = await subtle.digest('SHA-256', enc.encode(publicJwk.n + '.' + publicJwk.e));
  return b64.from(h).slice(0, 16);
}

/** Vytvoří nový pár klíčů uživatele a vrátí data k uložení + odemčené klíče. */
export async function createUserKeys(password) {
  const pair = await subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['wrapKey', 'unwrapKey'],
  );
  const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const pk = await passwordKey(password, salt, PBKDF2_ITERATIONS);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, pk, pkcs8);
  const privateKey = await importPrivate(pkcs8);
  return {
    stored: {
      publicKey: { kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, alg: publicJwk.alg },
      fp: await fingerprint(publicJwk),
      encPrivateKey: { salt: b64.from(salt), iv: b64.from(iv), ct: b64.from(ct), iter: PBKDF2_ITERATIONS, alg: 'PBKDF2-SHA256/AES-GCM' },
    },
    privateKey,
  };
}

async function importPrivate(pkcs8) {
  return subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey']);
}

/** Odemkne soukromý klíč uživatele heslem. Při špatném hesle vyhodí chybu. */
export async function unlockUserKeys(stored, password) {
  const e = stored.encPrivateKey;
  const pk = await passwordKey(password, b64.to(e.salt), e.iter);
  let pkcs8;
  try {
    pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(e.iv) }, pk, b64.to(e.ct));
  } catch {
    throw new Error('Nesprávné šifrovací heslo.');
  }
  return importPrivate(pkcs8);
}

/** Změna hesla: přešifruje stávající soukromý klíč (klíče subjektů zůstávají platné). */
export async function rewrapPrivateKey(stored, oldPassword, newPassword) {
  const e = stored.encPrivateKey;
  const oldKey = await passwordKey(oldPassword, b64.to(e.salt), e.iter);
  let pkcs8;
  try {
    pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(e.iv) }, oldKey, b64.to(e.ct));
  } catch {
    throw new Error('Původní heslo není správné.');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const nk = await passwordKey(newPassword, salt, PBKDF2_ITERATIONS);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, nk, pkcs8);
  return { ...stored, encPrivateKey: { salt: b64.from(salt), iv: b64.from(iv), ct: b64.from(ct), iter: PBKDF2_ITERATIONS, alg: e.alg } };
}

// ---------- klíč subjektu ----------
export async function newSubjectKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapForUser(dek, publicJwk) {
  const pub = await subtle.importKey('jwk', { ...publicJwk, ext: true }, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
  const wrapped = await subtle.wrapKey('raw', dek, pub, { name: 'RSA-OAEP' });
  return { wrapped: b64.from(wrapped), fp: await fingerprint(publicJwk) };
}

export async function unwrapForMe(wrappedB64, privateKey) {
  return subtle.unwrapKey('raw', b64.to(wrappedB64), privateKey, { name: 'RSA-OAEP' },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ---------- šifrování dat ----------
/** Zašifruje objekt; aad váže šifrový text na konkrétní místo (subjekt/dokument). */
export async function sealJson(dek, obj, aad) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, dek, enc.encode(JSON.stringify(obj)));
  return { v: 1, iv: b64.from(iv), ct: b64.from(ct) };
}

export async function openJson(dek, sealed, aad) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(sealed.iv), additionalData: enc.encode(aad) }, dek, b64.to(sealed.ct));
  return JSON.parse(dec.decode(pt));
}

export async function makeKeyCheck(dek, sid) {
  return sealJson(dek, { artur: 'ok' }, 'keycheck:' + sid);
}

export async function verifyKeyCheck(dek, check, sid) {
  try {
    const r = await openJson(dek, check, 'keycheck:' + sid);
    return r && r.artur === 'ok';
  } catch {
    return false;
  }
}

// ---------- záchranný klíč ----------
// 32 bajtů klíče + 2 bajty kontrolního součtu, Crockford Base32, skupiny po 4 znacích.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(str) {
  const clean = str.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('Záchranný klíč obsahuje neplatný znak: ' + ch);
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export async function exportRecoveryKey(dek) {
  const raw = new Uint8Array(await subtle.exportKey('raw', dek));
  const sum = new Uint8Array(await subtle.digest('SHA-256', raw)).slice(0, 2);
  const all = new Uint8Array(34); all.set(raw); all.set(sum, 32);
  const s = base32(all); // 55 znaků
  return s.match(/.{1,5}/g).join('-');
}

export async function importRecoveryKey(text) {
  const body = text.trim().replace(/^ARTUR[-\s:]*/i, '');
  const all = unbase32(body);
  if (all.length < 34) throw new Error('Záchranný klíč je neúplný.');
  const raw = all.slice(0, 32);
  const sum = new Uint8Array(await subtle.digest('SHA-256', raw)).slice(0, 2);
  if (sum[0] !== all[32] || sum[1] !== all[33]) throw new Error('Záchranný klíč obsahuje překlep (nesedí kontrolní součet).');
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export function checkPasswordStrength(pw) {
  if (!pw || pw.length < 12) return 'Heslo musí mít aspoň 12 znaků.';
  if (/^(.)\1+$/.test(pw)) return 'Heslo nesmí být jeden opakovaný znak.';
  return null;
}
