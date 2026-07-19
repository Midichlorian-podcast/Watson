# Watson F8b — PWA instalace a rychlé zachycení

## Produktový kontrakt

Watson zůstává webovou aplikací. První distribuční vrstva je instalovatelná PWA; samostatný desktop wrapper přijde až po jejím provozním ověření. Nativní mobilní aplikace je mimo schválený scope. Instalace z prohlížeče proto nesmí slibovat App Store build ani vydávat obyčejnou kartu za nativní klient.

Share Target, manifest shortcut i browser bookmarklet vstupují přes `/zachytit` do stejného `AddTaskModal` Quick Capture toku. Nevzniká druhý formulář, druhý task command ani paralelní parser. Po převzetí dat route provede replace na `/`, takže se sdílený text a URL nedrží v historii aplikace.

## Bezpečnost vstupu

- `title` má nejvýše 240 znaků, text 2 000 znaků, URL 2 048 znaků a výsledný kontext 4 096 znaků.
- Řídicí a bidi override znaky jsou odstraněny.
- Zdrojová URL přežije pouze jako `http:` nebo `https:` a nesmí obsahovat username ani password.
- Kontext se renderuje jako React text, ne jako HTML.
- Bookmarklet se v Nastavení pouze kopíruje do schránky. Watson nikdy nevytváří `href="javascript:…"` ani tento kód nespouští ve vlastním originu.
- Web Share Target v1 používá GET kvůli interoperabilitě. Do sdílení proto nepatří tajemství; reverzní proxy nemá logovat query string `/zachytit`. Další verze může přejít na POST až s ověřeným service-worker transportem bez ztráty dat.

## Instalace

Provider zachytí standardní `beforeinstallprompt`, sleduje `appinstalled` a standalone display mode. UI rozlišuje tři pravdivé stavy:

1. instalace je nabídnutá — zobrazí se tlačítko otevírající nativní prompt prohlížeče;
2. Watson už běží jako instalovaná PWA — zobrazí se potvrzený stav;
3. prompt není dostupný — UI pouze poradí použít menu prohlížeče, nevykáže falešný úspěch.

Manifest má stabilní `id` a `scope`, 192/512 PNG ikony, samostatnou maskable ikonu, shortcut pro Můj den a Rychlé zachycení a Share Target.

## Offline model a rozpočet

Denní jádro, capture ingress, CSS, překlady a šifrovaný PowerSync runtime zůstávají v precache. Velké volitelné moduly (Mail, Meets, Employee Hub, Nastavení, Postupy, Znalosti, Velín a Reporty) se po první online návštěvě uloží do omezené runtime cache. Z toho plynou tři poctivé úrovně:

- po úspěšném online přihlášení a odemknutí lokální databáze může otevřená aplikace pokračovat offline;
- volitelný modul je pro tuto relaci připravený offline až po první úspěšné návštěvě dané verze;
- studený start nebo reload bez sítě záměrně není odemčený: Watson neukládá Better Auth session ani serverový klíč lokální databáze jako náhradní offline přihlášení. Uživatel musí nejprve online potvrdit identitu.

Runtime cache drží nejvýše 48 hashovaných assetů a není autoritativním úložištěm dat. Build gate nadále blokuje největší JS nad 350 KiB gzip a offline precache nad 5.5 MiB.

## Ověření a rollback

1. `node scripts/verify-pwa-capture-contract.mjs`
2. `pnpm --filter @watson/web test`
3. `pnpm --filter @watson/web build` a kontrola vygenerovaného manifestu/precache rozpočtu
4. proti produkčnímu preview: `PWA_CAPTURE_WEB=http://localhost:5180 pnpm --filter @watson/api verify:pwa-capture-ui`

Browser důkaz musí v Chromium i WebKitu ověřit manifest, přenos title/text/URL, odstranění query, odmítnutí `javascript:` URL, uložení stejného task commandu do serverové DB, precache capture ingressu, runtime cache navštíveného volitelného modulu, zachycení během odpojené otevřené relace, 390px overflow, 44px cíl a WCAG A/AA.

Při regresi Share Targetu odeber `share_target` a capture shortcut z manifestu, ale ponech globální Quick Capture. Při regresi runtime cache lze bezpečně zvýšit verzi `RUNTIME_ASSETS`; cache obsahuje jen znovu stáhnutelné hashované assety, ne uživatelská data.
