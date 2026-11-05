// ARTUR – demo úložiště v localStorage. Slouží k vyzkoušení a testům bez Firebase.
// Napodobuje pravidla z firestore.rules, aby se chyby v oprávněních projevily i v demu.
import { ADMIN_EMAILS } from './config.js?v=0.6.2';

const KEY = 'artur-demo-db';
const SESSION = 'artur-demo-user';
const lower = (e) => (e || '').trim().toLowerCase();
const now = () => new Date().toISOString();

function load() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db) {
    db = { allowed: {}, users: {}, subjects: {}, seq: 1 };
    for (const a of ADMIN_EMAILS) db.allowed[a] = { name: 'Administrátor', addedBy: 'system', updatedAt: now() };
  }
  return db;
}
function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
function deny(msg) { const e = new Error('Odepřeno pravidly: ' + msg); e.code = 'permission-denied'; throw e; }
const clone = (o) => JSON.parse(JSON.stringify(o));

export function createDemoStore() {
  let listeners = [];
  const me = () => lower(sessionStorage.getItem(SESSION) || '');
  const isAdmin = () => ADMIN_EMAILS.includes(me());
  const allowed = (db) => !!me() && !!db.allowed[me()];
  const role = (s) => s && s.members ? s.members[me()] : undefined;
  const emit = () => { const e = me(); listeners.forEach((cb) => cb(e ? { email: e, name: '', verified: true } : null)); };

  return {
    kind: 'demo',
    onAuth(cb) { listeners.push(cb); setTimeout(() => { const e = me(); cb(e ? { email: e, name: '', verified: true } : null); }, 0); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    async signIn(email) { if (!email) throw new Error('Zadejte e-mail.'); sessionStorage.setItem(SESSION, lower(email)); emit(); },
    async signOut() { sessionStorage.removeItem(SESSION); emit(); },

    async isAllowed(email) { const db = load(); return !!db.allowed[lower(email)] && lower(email) === me(); },
    async listAllowed() { const db = load(); if (!isAdmin()) deny('seznam uživatelů smí číst jen administrátor'); return Object.entries(db.allowed).map(([id, v]) => ({ id, ...v })); },
    async setAllowed(email, data) { const db = load(); if (!isAdmin()) deny('jen administrátor'); db.allowed[lower(email)] = { ...(db.allowed[lower(email)] || {}), ...data, updatedAt: now() }; save(db); },
    async removeAllowed(email) { const db = load(); if (!isAdmin()) deny('jen administrátor'); delete db.allowed[lower(email)]; save(db); },

    async getUser(email) { const db = load(); if (!allowed(db)) deny('nepovolený uživatel'); return db.users[lower(email)] ? clone(db.users[lower(email)]) : null; },
    async putUser(email, data) { const db = load(); if (!allowed(db) || lower(email) !== me()) deny('profil smí měnit jen jeho vlastník'); db.users[lower(email)] = { ...(db.users[lower(email)] || {}), ...clone(data), updatedAt: now() }; save(db); },

    async listMySubjects(email) {
      const db = load(); if (!allowed(db) || lower(email) !== me()) deny('nepovolený uživatel');
      return Object.entries(db.subjects).filter(([, s]) => (s.memberEmails || []).includes(me())).map(([id, s]) => { const { keys, docs, audit, ...rest } = s; return { id, ...clone(rest) }; });
    },
    async getSubject(sid) {
      const db = load(); const s = db.subjects[sid]; if (!s) return null;
      if (!allowed(db) || !(s.memberEmails || []).includes(me())) deny('nejste členem subjektu');
      const { keys, docs, audit, ...rest } = s; return { id: sid, ...clone(rest) };
    },
    async createSubject(data) {
      const db = load(); if (!allowed(db) || !isAdmin()) deny('subjekt zakládá jen administrátor');
      if (data.status !== 'novy' || data.enc) deny('nový subjekt musí být ve stavu "novy" a bez dat');
      const id = 'S' + String(db.seq++).padStart(4, '0');
      db.subjects[id] = { ...clone(data), createdAt: now(), keys: {}, docs: {}, audit: [] }; save(db); return id;
    },
    async updateSubject(sid, patch) {
      const db = load(); const s = db.subjects[sid];
      if (!s || !allowed(db) || role(s) !== 'vlastnik') deny('subjekt smí měnit jen vlastník');
      Object.assign(s, clone(patch), { updatedAt: now() });
      const mk = Object.keys(s.members).sort().join(','); const me2 = [...s.memberEmails].sort().join(',');
      if (mk !== me2) deny('memberEmails musí odpovídat members');
      if (!Object.values(s.members).includes('vlastnik')) deny('subjekt musí mít aspoň jednoho vlastníka');
      save(db);
    },

    async getKey(sid, email) {
      const db = load(); const s = db.subjects[sid]; if (!s || !allowed(db)) deny('nepovolený uživatel');
      if (!(lower(email) === me() && role(s)) && role(s) !== 'vlastnik') deny('cizí klíč smí číst jen vlastník');
      return s.keys[lower(email)] ? clone(s.keys[lower(email)]) : null;
    },
    async listKeys(sid) { const db = load(); const s = db.subjects[sid]; if (!s || role(s) !== 'vlastnik') deny('jen vlastník'); return Object.entries(s.keys).map(([id, v]) => ({ id, ...clone(v) })); },
    async putKey(sid, email, data) {
      const db = load(); const s = db.subjects[sid]; if (!s || !allowed(db) || role(s) !== 'vlastnik') deny('klíč smí udělit jen vlastník');
      if (!s.members[lower(email)]) deny('klíč lze dát jen členovi');
      s.keys[lower(email)] = { ...clone(data), updatedAt: now() }; save(db);
    },
    async deleteKey(sid, email) { const db = load(); const s = db.subjects[sid]; if (!s || role(s) !== 'vlastnik') deny('jen vlastník'); delete s.keys[lower(email)]; save(db); },

    async listDocs(sid) { const db = load(); const s = db.subjects[sid]; if (!s || !role(s)) deny('nejste členem'); return Object.entries(s.docs).map(([id, v]) => ({ id, ...clone(v) })); },
    async putDoc(sid, id, data) { const db = load(); const s = db.subjects[sid]; if (!s || !['vlastnik', 'ucetni'].includes(role(s))) deny('zápis smí vlastník nebo účetní'); s.docs[id] = { ...clone(data), updatedAt: now() }; save(db); },

    async putDocs(sid, items, onProgress) {
      const db = load(); const s = db.subjects[sid]; if (!s || !['vlastnik', 'ucetni'].includes(role(s))) deny('zápis smí vlastník nebo účetní');
      for (const it of items) s.docs[it.id] = { ...clone(it.data), updatedAt: now() };
      save(db); onProgress?.(items.length, items.length);
    },
    async addAudit(sid, entry) { const db = load(); const s = db.subjects[sid]; if (!s || !role(s) || entry.by !== me()) deny('audit'); s.audit.push({ ...clone(entry), at: now() }); save(db); },
    async listAudit(sid, n = 50) { const db = load(); const s = db.subjects[sid]; if (!s || !role(s)) deny('nejste členem'); return clone(s.audit).reverse().slice(0, n); },

    demoReset() { localStorage.removeItem(KEY); sessionStorage.removeItem(SESSION); },
    demoKnownEmails() { return Object.keys(load().allowed); },
  };
}
