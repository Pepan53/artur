import { applyTheme } from './theme.js?v=0.5.7';
import { start } from './app.js?v=0.5.7';

applyTheme();
start().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = 'Chyba při spuštění: ' + e.message;
});
