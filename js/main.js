import { applyTheme } from './theme.js?v=0.5.8';
import { start } from './app.js?v=0.5.8';

applyTheme();
start().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = 'Chyba při spuštění: ' + e.message;
});
