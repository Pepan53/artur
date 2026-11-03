# ARTUR – historie verzí

Číslování: HLAVNÍ.ETAPA.OPRAVA. Druhé číslo odpovídá etapě vývoje, třetí opravám a drobnostem v ní.
Každá verze je na GitHubu označená tagem `vX.Y.Z` a její kopie je ve složce FAKTUR\ARTUR-verze.

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
