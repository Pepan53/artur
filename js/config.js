// ARTUR – konfigurace.
// 1) Po založení projektu ve Firebase sem vložte "firebaseConfig" z konzole
//    (Project settings → Your apps → Web app). Tyto hodnoty nejsou tajné.
// 2) Administrátor musí být stejný i v souboru firestore.rules.

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

export const ADMIN_EMAILS = ['josef.dvorak@postme.cz'];

// Odhlášení / zamčení po nečinnosti (minuty)
export const IDLE_LOCK_MINUTES = 30;

export const APP_VERSION = '0.1.0 (etapa 0)';

// Demo režim: běží jen v tomto prohlížeči, data v localStorage, bez Google přihlášení.
// Zapne se, když firebaseConfig není vyplněný, nebo parametrem ?demo=1 v adrese.
export function isDemo() {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1') return true;
  return !firebaseConfig.apiKey || !firebaseConfig.projectId;
}
