# Handoff: Watson — týmová aplikace na úkoly, projekty, postupy a cíle

## Přehled
Watson je plně responzivní aplikace pro správu úkolů, projektů, kalendáře, postupů (štafetové workflow), týmů a cílů — pro jednotlivce i více týmů (multi‑workspace). Cílem je překonat Todoist/Asanu/Notion přehledností, rychlostí (klávesnice) a chytrým zadáváním v přirozené češtině.

## O souborech v balíku
Soubor `WatsonApp.dc.html` je **designová reference vytvořená v HTML** (interaktivní prototyp ukazující zamýšlený vzhled a chování) — **není to produkční kód k přímému zkopírování**. Úkol je **znovu vytvořit tento design v cílovém prostředí** (React/Vue/…) podle zavedených vzorů a knihoven daného projektu. Pokud prostředí ještě neexistuje, zvolte vhodný framework (doporučení: React + TypeScript) a implementujte tam.

Technická poznámka: prototyp je „Design Component" (`.dc.html`) — celá logika je jedna třída `class Component` (stav + metody) a šablona s `{{ }}` výrazy. Logiku (parser, kalendář, postupy, cíle) lze číst jako referenční JS a přepsat do produkčních komponent + stavového úložiště.

## Fidelita
**High‑fidelity.** Finální barvy, typografie, rozestupy a interakce. UI rekreujte pixel‑přesně pomocí knihoven cílového kódu; přesné hodnoty tokenů níže.

## Obrazovky / pohledy
Levý **sidebar** (tmavě navy `--sidebar`) lze sbalit na ikony. Sekce menu:
- **Hledat** — fulltext přes úkoly, projekty, lidi, postupy, cíle.
- **Schránka** — nezařazené úkoly (triage: přiřaď projekt + termín).
- **Dnes** — dashboard: zpožděné (sbalitelné), dnešní úkoly, Watson pruh (asistent), „Tvůj další krok v postupech".
- **Nadcházející** — agregace napříč prostory; přepínač Seznam / Nástěnka / Kalendář.
- **Úkoly** — seznam seskupený po projektech; přepínač Seznam / Nástěnka / Kalendář.
- **Projekty** — karty projektů; klik otevře detail (viz níže).
- **Cíle** — měřitelné cíle (týmové / projektové / osobní), záložky podle scope.
- **Reporty** — Přehled (grafy, cíle týmu) + Lidé (operativní karty členů).
- **Postupy** — štafetová workflow (viz níže).
- **Nastavení** (ozubené kolo dole) — profil, vzhled, hustota, **Tým a role** (admin členů, oprávnění Vlastník/Admin/Člen/Host).
- Pod tím **Oblíbené** (Priorita 1, Přiřazeno mně) a **Pracovní prostory** (Moje projekty + jednotlivé týmy — multi‑team).

Hlavní **header** (jednotný na všech obrazovkách): vlevo titul + počty, vpravo akce v pevném pořadí — lupa (Hledat), zvonek (oznámení), přepínač motivu (slunce/měsíc), Watson, **+ Úkol**. Na seznamech navíc **Filtr ▾**, **Seřadit ▾** + směr ↑/↓, přepínač zobrazení, zámek výchozího zobrazení (per‑uživatel).

### Detail úkolu (pravý panel)
Klik na úkol otevře pravý panel: název, projekt (barevná tečka), prioritní orámování, termín/čas, deadline, trvání, opakování (↻), přiřazení (avatary; „každý zvlášť" N/M nebo „stačí kdokoli"), podúkoly (checkbox), barva, příloha, „Zařadit do postupu", a menu ⋯ (duplikovat, kopírovat odkaz, smazat). V panelu lze ↑/↓ přepínat na předchozí/další úkol v seznamu.

### Detail projektu (pravý panel)
Název (editovatelný), **Barva** (10 + výchozí), **Typ projektu** (Průběžný / Cílový / Periodický), **Vlastník**, **Stav** (Aktivní/Pozastavený/Archiv/Hotovo), u cílových: **Termín dodání** + **Definice hotového**, **Členové**, statistiky (otevřené/hotovo/celkem), „Zobrazit úkoly projektu". Nastavení zobrazení je **per‑uživatel** (každý si projekt zobrazí po svém).

## Interakce a chování

### Chytré zadávání úkolu (quick‑add parser, čeština)
Do názvu lze psát a parser to vytáhne do polí a **zvýrazní žlutým rámečkem** přímo v textu (rozpoznaná část zmizí z výsledného názvu, ne z editoru):
- **Priorita**: `p1`–`p4`.
- **Čas**: `14:00`, `v 15`, `od 9 hodin`, slovně `v patnácti hodin`.
- **Trvání**: `90 min`, `1.5 h`, `půl hodiny`, slovně `po dobu šedesáti minut`.
- **Datum**: `3. 7. 2027`; relativně `dnes` / `zítra` / `pozítří`; holý den `pondělí` → nejbližší budoucí, `příští pondělí` → ten další; deadline `!5. 7.`.
- **Vícedenní**: `4 dny`.
- **Opakování** (čeština): `každou středu`, `každé úterý`, `každý den`, `každou druhou středu`, `každé první úterý v měsíci`, `každého 25. v měsíci`, `každý sudý/lichý čtvrtek`, `týdně/měsíčně/ročně`.
- **Projekt**: `#Obchod` → našeptávač projektů (šipky + Enter), bez auto‑přiřazení dokud nevybereš.
- **Osoba**: `@Jméno` nebo `+Jméno` → našeptávač lidí (šipky + Enter), po výběru se token z názvu odstraní a osoba přiřadí.
Úkol nelze vytvořit, pokud po vytažení formulí zůstane **prázdný název**.

### Klávesové zkratky (globální handler, ignoruje psaní v polích)
- Globální: `/` Hledat, `Q` Nový úkol, `⌘/Ctrl+K` paleta (skok na obrazovku/projekt/člověka/postup, šipky+Enter), `G` pak `D/U/K/P/C/R/N/I` přejít na sekci, `⌘Z` / `⌘⇧Z` zpět/vpřed, `Esc` zavřít (kaskáda: tahák→paleta→přidání→postup→detail→projekt→člen→výběr), `?` tahák se zkratkami.
- Seznam: `↑/↓` nebo `j/k` výběr (brass rámeček), `Enter` detail, `Space` odškrtnout, `1–4` priorita, `⌫` smazat (s undo). V detailu `↑/↓` další/předchozí.
- Kalendář: `←/→` období, `D` dnes, `1/2/3` den/týden/měsíc.

### Kalendář (reálná data)
- Úkoly nesou **reálné ISO datum** (`iso`, fallback na červen‑2026 den u starších); zobrazují se na správný den **napříč měsíci/roky** (ne jen červen).
- Pohledy: **Den** (0–24 h, „teď" linka, auto‑scroll na 7:00), **Týden** (přepínač Sloupce/Mřížka; Mřížka: bloky s názvem, překryvy, „+N" při 4+, drag/resize, drag‑create tažením, klik=přidat), **Měsíc** (3 úkoly/den + „+N", bohaté karty: barva projektu, čas/celý den, přiřazený). Celodenní pás nad mřížkou, vícedenní pruhy přes dny.
- **Opakované úkoly se promítají jako jednotlivé výskyty** do budoucích týdnů/měsíců i do seznamů (viz „Opakování a výskyty" níže) — každý výskyt je otevíratelný a samostatně dokončitelný/přeskočitelný.
- Odškrtávání přímo v kalendáři ve všech pohledech.

### Opakování a výskyty (occurrences)
Opakovaný úkol je **jedna „řada"** (základní úkol s `repeat`/`recurring` + konfigurací konce), z níž se počítají **jednotlivé výskyty**:
- **Viditelnost ve všech pohledech**: výskyty se promítají do **Nadcházející** (horizont ~16 dní, aby se „Později" nezahltilo) i do **kalendáře** (den/týden/měsíc podle viditelného rozsahu). Dnes ukazuje jen aktuální výskyt, ne budoucí.
- **Identita výskytu**: virtuální id `úkolId@YYYY-MM-DD`. Každý výskyt je klikací → otevře detail s bannerem „↻ Výskyt řady · <datum>".
- **Per‑výskyt akce přes „výjimky" (`exceptions` na základním úkolu)**: `done` (odškrtnout jen tenhle termín) a `skipped` (vynechat jen tenhle termín). Výjimky se promítají do seznamu i kalendáře zároveň.
- **Konec opakování**: Nikdy / K datu (`repeatUntil`) / Po počtu (`repeatCount`). Volba „jen příští výskyt" vs. „všechny" (`repeatShowAll`).
- **Dokončení základního výskytu** posouvá celou řadu na další termín (`repeatDoneCount`); dokončení budoucího výskytu jen označí ten jeden den.
- **Úprava názvu/priority/osob** se zatím dělá pro **celou řadu** (tlačítko „Upravit celou řadu →" skočí na základní úkol).

Produkční doporučení: výskyty modelovat jako entity odvozené z definice řady + tabulka výjimek (override/skip) klíčovaná datem; per‑výskyt override dalších polí a přesun výskytu tažením v kalendáři jsou přirozená rozšíření.

### Postupy (štafeta)
Řetězec kroků = běžné úkoly s `flowId`, `stepIndex`, `stepStatus` (waiting/now/done). Brány: Auto → / Ruční ✋ / Souběh ⇉ (join). Dokončení kroku předá další osobě (toast „Předáno → X"), spící kroky se nezobrazují v Dnes. Časová osa, avatarová štafeta na spojnicích, detekce úzkého hrdla, „jen kde jsem na řadě", odhad dokončení, kaskádové přeplánování při zpoždění (režim Řetězec vs. Kotva), builder z šablony i z běžícího postupu, plánování od začátku i zpětně od termínu, role místo konkrétních lidí, předání mezi projekty.

### Cíle
Měřitelné, navázané na reálná data v aplikaci: metriky **Dokončení / Včasnost / Počet / Stav projektu**, filtr (projekt/člověk/klíčové slovo), cílová úroveň. Scope: týmový / projektový / osobní (člen). Žádné „magické" neměřitelné hodnoty.

### Stavy a další
- Dokončené úkoly: přeškrtnuté + ztlumené; přepínač zobrazit/skrýt.
- Undo/redo přes historii stavu úkolů.
- Persistence: výchozí zobrazení a nastavení **per‑uživatel**; pozice/obrazovka v `localStorage`.
- Drag & drop na nástěnce i v kalendáři; přeplánování přetažením.

## Stav (state) — hlavní proměnné
`tasks[]` (úkoly i kroky postupů), `screen`, `view` (list/board/calendar), `calMode` (day/week/month), `calCur`/`monthOffset`, `weekView` (list/grid), `theme`, `activeWs` (workspace), `selectedId`/`selectedProject`/`selectedMember`/`selectedFlow`, `addDraft` (koncept nového úkolu vč. parseru), `filterPri/Proj/Status/Person`, `sortBy`/`sortDir`, `kbSel` (klávesový výběr), `paletteOpen`/`paletteQ`, `cheatOpen`, undo zásobník. Cíle, role, šablony postupů.

## Datový model úkolu (klíčová pole)
`id, name, desc, project, priority(1–4), assignees[], assignMode('any'|'all'), iso (YYYY‑MM‑DD) / date (legacy červen‑den), isoEnd/endDate (vícedenní), start/end (minuty od půlnoci), deadline, duration, repeat('none'|daily|weekly|biweekly|monthly|yearly)/repeatRule/repeatLabel, recurring, repeatEndKind('never'|'until'|'count')/repeatUntil/repeatCount/repeatShowAll/repeatDoneCount, exceptions{ 'YYYY-MM-DD': { done, skipped, time, start, end, priority } }, color, subtasks[], col (board), status (probiha|kontrola|hotovo), group(overdue|today|upcoming|inbox)/day (symbolické pro seznamy), done, inbox, flowId/stepIndex/stepTotal/stepStatus/gate, comments`.

## Design tokeny (přesné hodnoty)

### Světlý režim
- Plochy: `--bg #f5f4f0`, `--panel #ffffff`, `--panel-2 #faf9f6`
- Sidebar: `--sidebar #17283f`, ink `#ffffff` / `rgba(255,255,255,.62)`, line `rgba(255,255,255,.10)`
- Text: `--ink #16161a`, `--ink-2 #55554f`, `--ink-3 #8c8a82`, `--line #e7e5df`
- Akcent (brass): `--brass #c68a3e`, `--brass-text #a8722e`, `--brass-soft rgba(198,138,62,.13)`
- Stavy: success `#2e9c6e` (soft `#eaf6f0`, ink `#1c7a52`), overdue `#c2473c` (soft `#fbedea`), avatar navy `#17283f`
- Priority: `--p1 #d8473d` (červená), `--p2 #e0a32e` (žlutá), `--p3 #2a6fdb` (modrá), `--p4 #9aa0a8` (šedá)
- Stíny: `--shadow 0 1px 2px rgba(20,20,30,.04), 0 12px 32px rgba(23,40,63,.08)`; `--shadow-sm 0 1px 2px rgba(20,20,30,.05)`

### Tmavý režim (`[data-w-theme="dark"]`)
`--bg #0e131a`, `--panel #171f29`, `--panel-2 #1e2832`, `--sidebar #0a1019`, `--ink #eceef1` / `#a6aeba` / `#74808d`, `--line #28323e`, `--brass #d6a460` / text `#dcab68`, priority `#e0635a/#e6b557/#5a90e8/#8a93a0`.

### Barvy projektů (tečka, `data-proj`)
q3 `#c68a3e`, provoz `#2e9c6e`, onboarding `#7c5cfc`, obchod `#2a6fdb`, web `#2c9c9c`, osobni `#9a8f80`, marketing `#d4663a`, hr `#b8487e`, finance `#3a7d44`, it `#5b6cc4`, akce `#caa23f`, pravni `#8c6d3f`, klienti `#1f8a8a`, interni `#6b7280`.

### Volitelná barva úkolu (10, světlé pozadí + sytá tečka)
rose `#d8473d`, amber `#e0a32e`, lime `#7aa32e`, green `#2e9c6e`, teal `#1f9a9a`, sky `#2aa3db`, blue `#2a6fdb`, violet `#7c5cfc`, plum `#b8487e`, slate `#6b7280` (úkol je defaultně bílý; barvu vidí jen ten, kdo ji nastavil — per‑uživatel).

### Hustota
Vzdušné (row‑py 15px / font 15px / card 18px) a Vyvážené (11/14/15) — produkčně doporučeny obě; kompaktní raději vynechat.

### Typografie
Tři role přes CSS proměnné — `--w-font-display` (nadpisy, názvy úkolů, váhy 600–800), `--w-font-body` (běžný text), `--w-font-mono` (čísla, časy, počty). V cílovém kódu napojte na zvolené rodiny; držte tyto tři role a váhy.

## Ikony
Jednotná tahová sada (viewBox `0 0 24 24`, stroke 1.9–2, linecap butt, brass akcent `#c68a3e` u vybraných) definovaná v `ICONP` v logice — klíče: projekt, termin, priorita, prirazeni, trvani, deadline, opakovani, barva, priloha, postup, popis, pridat, hotovo, upravit, duplikovat, smazat, odkaz, vice, zavrit, hledat, schranka, dnes, nadchazejici, ukoly, projekty, tym, cile, reporty, nastaveni, zvonek, motiv. Nasazené v sidebaru, headeru, mobilní navigaci i ve formulářích. V produkci přenést jako jednu SVG sadu/komponentu.

## Soubory
- `WatsonApp.dc.html` — kompletní prototyp (logika + šablona + tokeny). Hlavní reference; veškerá logika je v jedné třídě `class Component`.
- `screenshots/` — 20 referenčních snímků každé obrazovky a stavu (viz sekce „Screenshoty").
- `README.md` — tento dokument.

## Screenshoty (`screenshots/`)
Reálné snímky běžícího prototypu — referenční vzhled každé obrazovky a stavu (světlý režim, šířka ~920 px):
- `01-dnes.png` — **Dnes** (dashboard): Watson pruh, „Tvůj další krok v postupech", Zpožděné + dnešní úkoly.
- `02-nadchazejici.png` — **Nadcházející**: skupiny podle dní, vč. promitnutých výskytů opakovaných úkolů.
- `03-ukoly.png` — **Úkoly**: seznam seskupený po projektech, Filtr/Seřadit, přepínač zobrazení.
- `04-kalendar-tyden.png` — **Kalendář / Týden** (mřížka): bloky, celodenní pás, vícedenní pruh.
- `05-kalendar-mesic.png` — **Kalendář / Měsíc**.
- `06-kalendar-den.png` — **Kalendář / Den** (0–24 h, „teď" linka).
- `07-projekty.png` — **Projekty**: karty s typem, termínem, postupem, členy.
- `08-projekt-detail.png` — **Detail projektu** (pravý panel): název, barva, typ, vlastník, stav, termín.
- `09-cile.png` — **Cíle**: měřitelné cíle se záložkami scope (Týmové/Projektové/Lidé).
- `10-reporty-prehled.png` — **Reporty / Přehled**: metriky, graf týdne, podle projektu.
- `11-reporty-lide.png` — **Reporty / Lidé**: operativní karty členů (po termínu, otevřené).
- `12-postupy.png` — **Postupy**: karta běžícího řetězce (progres, „Teď na řadě").
- `13-postup-detail.png` — **Detail postupu**: časová osa kroků, stavy, plánování (Řetězec/Kotva), „Dokončit krok".
- `14-postup-builder.png` — **Builder nového postupu** (kroky, role, plánování).
- `15-detail-ukolu.png` — **Detail úkolu** (pravý panel).
- `16-vyskyt-detail.png` — **Detail výskytu** opakovaného úkolu (banner „↻ Výskyt řady", Označit hotovo / Přeskočit / Upravit celou řadu).
- `17-pridat-ukol.png` — **Přidat úkol**: kompaktní karta s pilulkami (Projekt, Termín, Priorita, Přiřadit, Více).
- `18-pridat-ukol-parser.png` — **Přidat úkol** s rozpoznanými poli z přirozeného textu (p1, čas, trvání, opakování).
- `19-nastaveni.png` — **Nastavení**: vzhled, účet, Tým a role (oprávnění Vlastník/Admin/Člen/Host).
- `20-tmavy-rezim.png` — **Tmavý režim** (Dnes).

## Seed data (demo obsah)
Prototyp jede na seedu (bez backendu). Pro věrnou rekreaci použijte stejná demo data. **Datum „dnes" v prototypu = čtvrtek 25. 6. 2026** — všechny relativní termíny počítejte od něj.

**Prostory (workspaces):** `personal` „Moje projekty" (osobní), `kancelar` „Kancelář Praha" (tým), `klub` „TJ Sokol Praha" (tým). Aktivní prostor filtruje projekty, úkoly, tým, cíle i postupy.

**Lidé** (`id` · iniciály · jméno · role): ak·AK·Adéla Kučerová·Vedoucí provozu (vlastník), tm·TM·Tomáš Marek·Projektový manažer, jd·JD·Jana Dvořáková·Obchod, mb·MB·Martin Beneš·IT a provoz, pn·PN·Petra Nováková·Nábor a HR, lh·LH·Lukáš Horák·Office manager, ep·EP·Eva Pospíšilová·Marketing. Členové prostoru: Kancelář = všech 7; Sokol = PN, EP, JD, LH. E‑maily se generují z diakritiky (`adela.kucerova@firma.cz`).

**Projekty** (`id` · název · typ · vlastník · prostor): q3·Q3 plánování·cílový(do 30. 9.)·tm, provoz·Provoz kanceláře·průběžný·ak, obchod·Obchod·průběžný·jd, onboarding·Onboarding·cílový(15. 7.)·pn, web·Web redesign·cílový(31. 8.)·ak, finance·Finance·periodický·mb, hr·Nábor a HR·průběžný·pn, it·IT a systémy·průběžný·mb, pravni·Právní a smlouvy·cílový·tm, interni·Interní procesy·periodický·ak — vše v prostoru **Kancelář**. V prostoru **Sokol**: akce·Firemní akce·cílový·pn, marketing·Marketing·průběžný·jd, klienti·Klientský servis·průběžný·jd. **Osobní** (prostor personal): osobni, rozvoj, domacnost, zdravi. Typy: **Průběžný** (flow), **Cílový** (goal — termín + definice hotového), **Periodický** (cycle).

Demo obsahuje i běžící **postup** „Plakát na červnovou show" (5 kroků, projekt Firemní akce / Sokol) a měřitelné **cíle** navázané na reálná data.

## Co je vědomě zjednodušené (prototyp)
- Drag & drop v kalendáři mezi měsíci a vícedenní úpravy stále pracují s legacy červen‑číslem dne (zobrazení už je na reálném ISO).
- Persistence je `localStorage` + seed; v produkci nahradit reálným backendem (API, auth, role/oprávnění, reálné notifikace, výpočet metrik cílů).
- Opakování: výskyty jsou viditelné napříč pohledy a per‑výskyt dokončitelné/přeskočitelné přes `exceptions`. Vědomě zatím **neimplementováno**: per‑výskyt override názvu/priority/osob (mění se na celé řadě) a přeplánování jednotlivého výskytu tažením v kalendáři. Horizont seznamů je ~16 dní (kalendář ukazuje dál podle rozsahu).
