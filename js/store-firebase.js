// ARTUR – úložiště Firebase (Authentication + Firestore).
// V cloudu jsou jen šifrovaná data, seznam oprávněných e-mailů, role a veřejné klíče.
const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}`;

export async function createFirebaseStore(config) {
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const authMod = await import(`${base}/firebase-auth.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const app = initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fs.getFirestore(app);
  const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp, writeBatch } = fs;

  const snapList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lower = (e) => (e || '').trim().toLowerCase();

  return {
    kind: 'firebase',
    onAuth(cb) {
      return authMod.onAuthStateChanged(auth, (u) => cb(u ? { email: lower(u.email), name: u.displayName || '', verified: u.emailVerified } : null));
    },
    async signIn() {
      const p = new authMod.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      await authMod.signInWithPopup(auth, p);
    },
    async signOut() { await authMod.signOut(auth); },

    async isAllowed(email) {
      try { return (await getDoc(doc(db, 'allowed', lower(email)))).exists(); } catch { return false; }
    },
    async listAllowed() { return snapList(await getDocs(collection(db, 'allowed'))); },
    async setAllowed(email, data) { await setDoc(doc(db, 'allowed', lower(email)), { ...data, updatedAt: serverTimestamp() }, { merge: true }); },
    async removeAllowed(email) { await deleteDoc(doc(db, 'allowed', lower(email))); },

    async getUser(email) { const s = await getDoc(doc(db, 'users', lower(email))); return s.exists() ? s.data() : null; },
    async putUser(email, data) { await setDoc(doc(db, 'users', lower(email)), { ...data, updatedAt: serverTimestamp() }, { merge: true }); },

    async listMySubjects(email) {
      return snapList(await getDocs(query(collection(db, 'subjects'), where('memberEmails', 'array-contains', lower(email)))));
    },
    async getSubject(sid) { const s = await getDoc(doc(db, 'subjects', sid)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async createSubject(data) {
      const ref = doc(collection(db, 'subjects'));
      await setDoc(ref, { ...data, createdAt: serverTimestamp() });
      return ref.id;
    },
    async updateSubject(sid, patch) { await updateDoc(doc(db, 'subjects', sid), { ...patch, updatedAt: serverTimestamp() }); },

    async getKey(sid, email) { const s = await getDoc(doc(db, 'subjects', sid, 'keys', lower(email))); return s.exists() ? s.data() : null; },
    async listKeys(sid) { return snapList(await getDocs(collection(db, 'subjects', sid, 'keys'))); },
    async putKey(sid, email, data) { await setDoc(doc(db, 'subjects', sid, 'keys', lower(email)), { ...data, updatedAt: serverTimestamp() }); },
    async deleteKey(sid, email) { await deleteDoc(doc(db, 'subjects', sid, 'keys', lower(email))); },

    async listDocs(sid) { return snapList(await getDocs(collection(db, 'subjects', sid, 'docs'))); },
    async putDoc(sid, id, data) { await setDoc(doc(db, 'subjects', sid, 'docs', id), { ...data, updatedAt: serverTimestamp() }); },

    async putDocs(sid, items, onProgress) {
      for (let i = 0; i < items.length; i += 200) {
        const chunk = items.slice(i, i + 200);
        try {
          const b = writeBatch(db);
          for (const it of chunk) b.set(doc(db, 'subjects', sid, 'docs', it.id), { ...it.data, updatedAt: serverTimestamp() });
          await b.commit();
        } catch (e) {
          // Záložní cesta: po jednom (např. při limitu pravidel na dávku).
          console.warn('Dávkový zápis selhal, zapisuji po jednom:', e.message);
          for (const it of chunk) await setDoc(doc(db, 'subjects', sid, 'docs', it.id), { ...it.data, updatedAt: serverTimestamp() });
        }
        onProgress?.(Math.min(i + 200, items.length), items.length);
      }
    },
    async addAudit(sid, entry) { await addDoc(collection(db, 'subjects', sid, 'audit'), { ...entry, at: serverTimestamp() }); },
    async listAudit(sid, n = 50) {
      const rows = snapList(await getDocs(query(collection(db, 'subjects', sid, 'audit'), orderBy('at', 'desc'), limit(n))));
      return rows.map((r) => ({ ...r, at: r.at?.toDate ? r.at.toDate().toISOString() : r.at }));
    },
  };
}
