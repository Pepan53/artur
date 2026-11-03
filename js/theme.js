// ARTUR – světlý / tmavý režim. Bez volby se řídí nastavením systému.
const KEY = 'artur-theme';

function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }

export function currentTheme() {
  const t = stored();
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme() {
  const t = stored();
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch { /* bez úložiště jen pro tuto relaci */ }
  document.documentElement.dataset.theme = next;
  return next;
}
