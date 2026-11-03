// ARTUR – nastavení verze: node tools/release.mjs 0.2.0
// Zapíše verzi do js/config.js a version.json a přidá ?v=<verze> ke všem modulům,
// aby si prohlížeče po vydání načetly nový kód. Záznam v CHANGELOG.md musí existovat.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.error('Použití: node tools/release.mjs X.Y.Z'); process.exit(1); }
const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!log.includes(`## ${v} `)) { console.error(`CHANGELOG.md nemá záznam "## ${v} "`); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
const rw = (f, fn) => { const p = path.join(root, f); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
rw('js/config.js', (s) => s.replace(/export const APP_VERSION = '[^']*';/, `export const APP_VERSION = '${v}';`));
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: v, datum: today }, null, 2) + '\n');
for (const f of fs.readdirSync(path.join(root, 'js')).filter((x) => x.endsWith('.js'))) {
  rw('js/' + f, (s) => s
    .replace(/(from '\.\/[\w/-]+\.js)(\?v=[\w.]+)?'/g, `$1?v=${v}'`)
    .replace(/(import\('\.\/[\w/-]+\.js)(\?v=[\w.]+)?'\)/g, `$1?v=${v}')`));
}
rw('index.html', (s) => s
  .replace(/src="js\/main\.js(\?v=[\w.]+)?"/, `src="js/main.js?v=${v}"`)
  .replace(/href="css\/app\.css(\?v=[\w.]+)?"/, `href="css/app.css?v=${v}"`));
console.log('Verze nastavena:', v);
