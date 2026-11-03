// ARTUR – konfigurace.
// 1) Po založení projektu ve Firebase sem vložte "firebaseConfig" z konzole
//    (Project settings → Your apps → Web app). Tyto hodnoty nejsou tajné.
// 2) Administrátor musí být stejný i v souboru firestore.rules.

export const firebaseConfig = {
  apiKey: 'AIzaSyCVbxdJPr4zVHjKZkyuyPPH5G7fSodIDFc',
  authDomain: 'artur-postme.firebaseapp.com',
  projectId: 'artur-postme',
  appId: '1:559474197740:web:956e481f37c69389f411c9',
};

// OAuth klient pro odesílání přes Gmail (Google Cloud → APIs & Services → Credentials → Web client).
export const GOOGLE_CLIENT_ID = '';

export const ADMIN_EMAILS = ['josef.dvorak@postme.cz'];

// Odhlášení / zamčení po nečinnosti (minuty)
export const IDLE_LOCK_MINUTES = 60;

export const APP_VERSION = '0.5.1';

// Demo režim: běží jen v tomto prohlížeči, data v localStorage, bez Google přihlášení.
// Zapne se, když firebaseConfig není vyplněný, nebo parametrem ?demo=1 v adrese.
export function isDemo() {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1') return true;
  return !firebaseConfig.apiKey || !firebaseConfig.projectId;
}
