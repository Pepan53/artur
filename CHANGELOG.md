# ARTUR – historie verzí

Číslování: HLAVNÍ.ETAPA.OPRAVA. Druhé číslo odpovídá etapě vývoje, třetí opravám a drobnostem v ní.
Každá verze je na GitHubu označená tagem `vX.Y.Z` a její kopie je ve složce FAKTUR\ARTUR-verze.

## 0.5.6 (2026-11-04)
- Rozložení pro telefony a skládací telefony (Fold): kompaktní hlavička, menu jako vodorovný posuvný pruh, který zůstává nahoře při posouvání.

## 0.5.5 (2026-11-03)
- Banka a úhrady: tlačítko „Znovu spárovat“ projde dosud nespárované příjmy proti aktuálním fakturám (např. po doplnění faktur importem).
- Oprava: zvýraznění faktur se shodnou částkou v ručním přiřazení (blokovala ho bezpečnostní politika stránky).

## 0.5.4 (2026-11-03)
- Přepínač světlého a tmavého režimu v pravém horním rohu (volba se pamatuje v prohlížeči; bez volby se řídí nastavením systému).

## 0.5.3 (2026-11-03)
- Nová rozbalovací sekce menu NASTAVENÍ: Import z vyfakturuj.cz, Členové a přístup, Záchranný klíč a záloha, Uživatelé aplikace, Můj účet, Nový subjekt (poslední dvě admin položky jen pro admina).

## 0.5.2 (2026-11-03)
- Odesílání faktur e-mailem přes Gmail je zapnuté (nastaven OAuth klient projektu artur-postme).

## 0.5.1 (2026-11-03)
- Import dat úhrad převzatých faktur (soubor ARTUR-uhrady-….json připravený ze seznamu faktur ve vyfakturuj.cz) – pro roky bez výpisů GPC.

## 0.5.0 (2026-11-03)
- Etapa 4: Banka a úhrady – nahrání výpisů GPC z Raiffeisenbank (i více souborů najednou), kontrola obratů a zůstatků, hlídání chybějících výpisů.
- Automatické párování příjmů podle VS včetně splátek (více plateb k jedné faktuře) a úhrad převzatých faktur z vyfakturuj.cz.
- Návrhy ke kontrole (přeplatek, platba bez VS ze známého účtu zákazníka), ruční přiřazení nespárovaných příjmů, označení „není úhrada faktury“.
- ARTUR se učí účty zákazníků z výpisů pro příští párování; opakované nahrání stejného výpisu nic nezdvojí.

## 0.4.1 (2026-11-03)
- Společný adresář pro všechny subjekty: vlastní šifrovací klíč, přístup pro všechny uživatele, faktury zůstávají oddělené podle IČO.
- Převod stávajícího adresáře subjektu do společného (sloučení podle IČO / názvu, přepojení faktur a šablon).
- Import z vyfakturuj.cz ukládá nové zákazníky rovnou do společného adresáře.

## 0.4.0 (2026-11-03)
- Etapa 3: opakované faktury – šablony (měsíčně / čtvrtletně / ročně, den vystavení, fakturace za aktuální nebo předchozí měsíc, platnost od–do).
- Proměnné v položkách: {mesic}, {v_mesici}, {rok}, {mm}, {obdobi}, {ctvrtleti}.
- Návrh šablon z posledních faktur (měsíc v textu se sám nahradí proměnnou).
- Měsíční fakturace: koncepty ze šablon → kontrola → hromadné vystavení → hromadné odeslání e-mailem.
- Odeslání faktury e-mailem přes Gmail z účtu přihlášeného uživatele, nastavitelný předmět a text, kopie odesílateli.
- Úprava vystavených i převzatých faktur se záznamem do historie.
- Sloučení zákazníků (např. stejná firma se špatným IČO) včetně převedení faktur a šablon.
- Opravený migrační soubor umí přepsat dosud neupravené převzaté faktury.

## 0.3.0 (2026-11-03)
- Etapa 2: import faktur a adresáře z vyfakturuj.cz (migrační soubor připravený z PDF exportů).
- Převzaté faktury nesou odkaz na originální PDF (soubor a stranu) a stav „Převzatá (úhrada neověřena)“; faktury z posledních 60 dní jako „Vystavená“.
- Číslování po importu automaticky navazuje na poslední převzaté číslo.
- Opakovaný import přeskočí faktury, které už v ARTURovi jsou.

## 0.2.0 (2026-11-03)
- Etapa 1: adresář zákazníků (ARES, e-maily, splatnost, známé účty, archivace, kontrola duplicitního IČO).
- Faktury: koncept → vystavení, číselné řady (faktura, zálohová, opravný doklad), navázání na poslední číslo z vyfakturuj.cz.
- PDF faktury s QR Platbou (SPD), české písmo, náhled a stažení.
- Ruční úhrady včetně částečných, stavy, filtr neuhrazených a po splatnosti, součty.
- Duplikace faktury, storno opravným dokladem, historie každého dokladu.
- Podrobnosti v historii změn jsou nově šifrované.

## 0.1.1 (2026-11-03)
- Zamykání po nečinnosti prodlouženo na 60 minut.
- Verzování: číslo verze v aplikaci, tento přehled změn, upozornění „Je k dispozici nová verze“.

## 0.1.0 (2026-11-03)
- Etapa 0: přihlášení účtem Google, schvalování uživatelů, šifrovací heslo.
- Subjekty (IČO) s oddělenými klíči, role vlastník / účetní / čtenář, udělování přístupu.
- Záchranný klíč subjektu, obnova přístupu, šifrovaná záloha, historie změn.
- Údaje subjektu s načtením z ARES, bankovní účty s IBAN.
