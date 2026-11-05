import { applyTheme } from './theme.js?v=0.5.14';
import { start } from './app.js?v=0.5.14';

applyTheme();
start().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = 'Chyba při spuštění: ' + e.message;
});
