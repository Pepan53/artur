# ARTUR – etapa 0: zprovoznění

ARTUR je webová aplikace bez vlastního serveru:

- kód leží na **GitHub Pages** (zdarma),
- přihlášení zajišťuje **Firebase Authentication** přes účet Google,
- data jsou ve **Firestore** (bezplatný tarif Spark), a to jen v zašifrované podobě.

Šifruje a dešifruje se jen v prohlížeči uživatele.

## Co je hotové v etapě 0

- Přihlášení účtem Google. Dovnitř se dostane jen e-mail, který povolí administrátor.
- Šifrovací heslo každého uživatele. Je oddělené od účtu Google.
- Subjekty (IČO) s oddělenými klíči. Role pro každý subjekt: vlastník, účetní, čtenář.
- Založení subjektu administrátorem. Šifrovací klíč vytvoří až vlastník subjektu, takže administrátor nemusí mít k datům přístup (případ KAROLÍNA DVOŘÁKOVÁ).
- Udělení přístupu členům. Vlastník při něm vidí otisk klíče člena.
- Záchranný klíč subjektu: stažení, tisk, potvrzení opsáním dvou skupin znaků, obnova přístupu.
- Údaje subjektu: načtení z ARES, bankovní účty s výpočtem IBAN a kontrolou čísla účtu, číselná řada, splatnost, příznak exportu do Money S3.
- Historie změn (audit), šifrovaná záloha ve formátu JSON, zamčení po 60 minutách nečinnosti, změna hesla.

## Co je hotové v etapě 1 (verze 0.2.0)

- **Adresář** zákazníků: načtení z ARES, e-maily pro zasílání, vlastní splatnost, známé účty pro párování plateb, archivace.
- **Faktury**: koncept, vystavení s automatickým číslem, zálohové faktury, storno opravným dokladem, duplikace.
- **PDF** s QR Platbou a českou diakritikou.
- **Úhrady** zadané ručně, i částečné. Automatické párování z GPC přijde v etapě 4.
- **Číslování**: v Údajích subjektu vyplňte „Poslední číslo faktury vystavené mimo ARTUR“. Pokud byla poslední faktura z vyfakturuj.cz 20260063, vyplňte 63 a ARTUR pokračuje číslem 20260064.

## Etapa 2 – převod z vyfakturuj.cz (verze 0.3.0)

1. PDF exporty z vyfakturuj.cz jsou ve `FAKTUR\Vyfakturuj.cz\<subjekt>`.
2. Claude z nich připravil migrační soubory `FAKTUR\Migrace\ARTUR-migrace-<subjekt>.json` (čísla, data, odběratelé, položky, částky, odkaz na stranu v originálním PDF).
3. V ARTURovi vyberte subjekt → **Import z vyfakturuj.cz** → zvolte soubor → zkontrolujte náhled → **Importovat**.
4. Číslování pak samo navazuje na poslední převzaté číslo.

Migrační soubory obsahují data čitelně (stejně jako PDF exporty). Po importu je můžete smazat.

## Společný adresář (verze 0.4.1)

1. Administrátor: **Nový subjekt** → zaškrtnout **Společný adresář** (členové se předvyplní ze seznamu uživatelů) → dokončit založení a uložit záchranný klíč do FAKTUR.
2. Každému uživateli v něm udělit přístup (**Členové a přístup** → Udělit přístup). Nového uživatele aplikace je potřeba do společného adresáře přidat také.
3. V každém subjektu otevřít **Adresář** → **Převést do společného adresáře**. Zákazníci se sloučí podle IČO, faktury a šablony se přepojí.

## Verze

Číslo verze je v patičce aplikace a přehled změn v `CHANGELOG.md`. Po nasazení nové verze se v aplikaci objeví lišta „Je k dispozici nová verze“. Kopie každé verze se ukládá do `FAKTUR\ARTUR-verze`. Nová verze se připraví příkazem `node tools/release.mjs X.Y.Z`.

## Demo bez Firebase

Spusťte aplikaci s `?demo=1` na konci adresy, nebo bez vyplněného `js/config.js`. Běží pak jen v prohlížeči a data ukládá do jeho úložiště (localStorage). Hodí se k vyzkoušení. Pro skutečná data demo nepoužívejte.

## Postup zprovoznění (asi 30 minut, jednorázově)

### 1. Firebase projekt
1. Jděte na https://console.firebase.google.com a přihlaste se firemním účtem, ideálně josef.dvorak@postme.cz.
2. Zvolte **Add project** a pojmenujte ho `artur-postme`. Google Analytics vypněte.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable**. Jako support e-mail vyberte svůj účet.
4. **Build → Firestore Database → Create database**:
   - umístění **eur3 (Europe)** nebo **europe-west3 (Frankfurt)**,
   - režim **Production mode**.
5. Ve **Firestore → Rules** smažte obsah, vložte celý soubor `firestore.rules` a klikněte **Publish**. Editor zároveň zkontroluje syntaxi.
6. V **Project settings (ozubené kolo) → General → Your apps** klikněte na ikonu **Web (</>)**:
   - aplikaci pojmenujte `ARTUR`, Firebase Hosting nezaškrtávejte,
   - zkopírujte hodnoty `apiKey`, `authDomain`, `projectId`, `appId`.

### 2. Konfigurace
Otevřete `js/config.js` a doplňte zkopírované hodnoty do `firebaseConfig`. Tyto hodnoty nejsou tajné. Ochranu dat zajišťují pravidla Firestore a šifrování.

### 3. GitHub Pages
1. Na https://github.com vytvořte účet nebo organizaci firmy, např. `postme-cz`.
2. Vytvořte repozitář `artur`. Kvůli bezplatným GitHub Pages musí být **veřejný**. V repozitáři je jen kód, žádná data ani klíče.
3. Nahrajte do repozitáře **obsah složky `ARTUR-aplikace`** (Add file → Upload files). Musí obsahovat i soubor `.nojekyll`.
4. Nastavte **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
5. Za minutu bude aplikace na adrese `https://<účet>.github.io/artur/`.

### 4. Povolení domény pro přihlášení
Ve Firebase otevřete **Authentication → Settings → Authorized domains → Add domain** a přidejte `<účet>.github.io`.

### 5. První spuštění
1. Otevřete adresu aplikace a přihlaste se jako **josef.dvorak@postme.cz**. Administrátor se dostane dovnitř vždy.
2. Nastavte šifrovací heslo (aspoň 12 znaků) a uložte si ho do správce hesel.
3. **Uživatelé aplikace**: povolte `karolina.dvorakovy@postme.cz` a `stepan.dvorak@postme.cz`.
4. **Nový subjekt** – POSTME s.r.o.:
   - IČO `09474595`,
   - členové: vy jako vlastník, Karolína a Štěpán jako účetní.
   - Po založení vyplňte údaje (účet `732627175/5500`), uložte a **stáhněte a potvrďte záchranný klíč**. Soubor `ARTUR-klic-….txt` dejte do složky FAKTUR a do trezoru.
5. **Nový subjekt** – JOSEF DVOŘÁK: jediný člen jste vy jako vlastník. Dokončete ho a uložte záchranný klíč.
6. **Nový subjekt** – KAROLÍNA DVOŘÁKOVÁ: jediný člen je Karolína jako vlastník. Vy k němu přístup mít nebudete. Dokončí ho Karolína po svém přihlášení a záchranný klíč si uloží ona.
7. Karolína a Štěpán se přihlásí a nastaví si šifrovací heslo. Pak jim v POSTME v sekci **Členové a přístup** klikněte na **Udělit přístup**.

## Aktuální nasazení

- Aplikace: https://pepan53.github.io/artur/ (repozitář Pepan53/artur, větev main)
- Firebase: projekt `artur-postme` (účet fakturace@postme.cz), Firestore v `eur3`
- Klíč API je v Google Cloudu omezen na `https://pepan53.github.io/*` a `https://artur-postme.firebaseapp.com/*`. Pokud se změní adresa aplikace, je potřeba omezení upravit (APIs & Services → Credentials).

## Jak funguje ochrana dat

| Co je v cloudu | V jaké podobě |
|---|---|
| Údaje subjektů, později zákazníci a faktury | zašifrované AES-256-GCM klíčem subjektu |
| Klíč subjektu | zabalený veřejným klíčem každého člena (RSA-OAEP 3072) |
| Soukromý klíč uživatele | zašifrovaný jeho heslem (PBKDF2-SHA256, 600 000 iterací) |
| Čitelně | e-maily, role, název a IČO subjektu (veřejné údaje z ARES), časy změn |

**Ztráta dat nehrozí, pokud existuje aspoň jedna z kopií klíče subjektu:**
- heslo kteréhokoli vlastníka,
- záchranný klíč ve složce FAKTUR,
- záchranný klíč v trezoru.

Zapomenuté heslo se řeší tlačítkem „Zapomněl(a) jsem heslo“. Po nastavení nového hesla vlastník obnoví přístup záchranným klíčem, nebo mu ho znovu udělí jiný vlastník.

## Testy
- `tests/crypto.test.mjs`: šifrování, záchranný klíč, IBAN a IČO (`node tests/crypto.test.mjs`).
- `tests/invoices.test.mjs`: číslování, součty, stavy, QR Platba.
- `tests/e2e-import.cjs`: import migračního souboru, číslování, opakovaný import, kontrola IČO.
- `tests/e2e-adresar.cjs`: společný adresář, převod, sdílení mezi subjekty a uživateli.
- `tests/e2e-opakovani.cjs`: šablony, měsíční fakturace, odeslání, opravy, slučování.
- `tests/e2e-faktury.cjs`: adresář, faktury, PDF, úhrady, storno a role v prohlížeči.
- `tests/e2e.cjs`: průchod v prohlížeči (Playwright) v demo režimu. Pokrývá 3 uživatele, 3 subjekty, role, udělení přístupu, zapomenuté heslo, obnovu záchranným klíčem, kontrolu, že v úložišti nejsou citlivé údaje čitelně, a zobrazení na mobilu.
- Pravidla Firestore zatím testovaná nejsou, protože emulátor nebyl v této chvíli dostupný. Syntaxi zkontroluje editor pravidel při publikování. Chování ověříme při prvním spuštění podle bodu 5.
