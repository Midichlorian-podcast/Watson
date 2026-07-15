# Watson: produktový audit, konkurenční srovnání a návrh rozvoje

**Datum:** 15. 7. 2026

**Auditovaný stav:** commit `b061cbf` a aktuální pracovní stav repozitáře

**Rozsah:** úkoly, projekty, týmová spolupráce, kalendář a plánování, mail, meetings, Postupy, cíle, reporting, Velín, zaměstnanecké funkce, AI, offline/sync, mobil, přístupnost, bezpečnost a provoz

---

## 1. Verdikt v jedné minutě

Watson má **nadprůměrně silnou produktovou vizi a neobvykle široký záběr**, ale současný produkt je mezi prototypem a interním pilotem. Největší problém není nedostatek funkcí. Je to rozdíl mezi tím, co navigace a obrazovky slibují, a tím, co je skutečně bezpečné, propojené a každodenně spolehlivé.

### Celkové hodnocení

| Oblast | Dnešní stav | Potenciál | Stručný verdikt |
|---|---:|---:|---|
| Vize a odlišení | 8,5/10 | 9/10 | Silná myšlenka operačního systému pro práci, ne jen task manageru |
| Šíře funkcí | 8/10 | 9/10 | Watson pokrývá více oblastí než většina mladých produktů |
| Produktová soudržnost | 5/10 | 9/10 | Moduly existují vedle sebe, ale ještě netvoří jeden přirozený pracovní tok |
| Úkoly a osobní produktivita | 5,5/10 | 8,5/10 | Dobré základy a český Quick Add, chybí filtry, šablony a dokonale hladký denní provoz |
| Projekty a týmová práce | 4,5/10 | 8/10 | Široké, ale proti Asaně/ClickUp/monday.com příliš mělké |
| Kalendář a plánování času | 3/10 | 8/10 | Zobrazení existuje, plánovací inteligence téměř ne |
| Mail | 1/10 | 8,5/10 | Dnes demonstrace rozhraní, ne důvěryhodný mailový klient |
| Meetings | 3,5/10 | 9/10 | Správná smyčka návrh → schválení, chybí kvalitní capture a meeting memory |
| Postupy a předávání práce | 5/10 | 9/10 | Jeden z nejzajímavějších diferenciátorů Watsonu |
| Cíle, reporty a Velín | 4,5/10 | 8,5/10 | Zajímavý management cockpit, zatím bez dostatečné datové hloubky |
| Integrace | 1,5/10 | 8/10 | Pro praktické nasazení zásadně nedostatečné |
| Desktop UX | 5/10 | 8,5/10 | Funkční základ, ale hodně složitosti a nekonzistence |
| Mobilní UX | 3/10 | 8/10 | Použitelné spíše nouzově než jako každodenní pracovní nástroj |
| Přístupnost | 2/10 | 8/10 | Před veřejným nasazením vyžaduje samostatnou opravu |
| Důvěryhodnost dat a produkční připravenost | 2/10 | 9/10 | Největší stopka před reálným nasazením |

**Současný produkt jako celek: 4,2/10.**

**Potenciál po soustředěném dotažení: 8,5/10.**

**Veřejné produkční nasazení v dnešním stavu: stop-ship.** Interní pilot má smysl až po splnění P0 gate v oblasti izolace dat, oprávnění, synchronizace a obnovy.

To není verdikt, že je produkt špatný. Znamená to, že Watson je dnes **velmi dobrý produktový koncept s několika skutečně originálními mechanismy**, ale zatím ne konzistentní alternativa k zavedeným nástrojům.

### Nejdůležitější strategické doporučení

Nesnažit se vyhrát počtem checkboxů nad ClickUpem. Watson by měl vlastnit tuto kategorii:

> **Operační systém pro menší české a evropské týmy, ve kterém se mail, schůzky, rozhodnutí, úkoly, předání práce a cíle propojí do jednoho dohledatelného toku — offline, srozumitelně a s AI pod kontrolou člověka.**

Nejsilnější „wow“ nemá být samostatná AI funkce. Má to být moment, kdy uživatel otevře projekt a na jedné časové ose vidí, **z jakého mailu nebo schůzky vzniklo rozhodnutí, kdo jej převzal, co blokuje další krok a jaký cíl se tím posune**.

---

## 2. Jak audit vznikl a co znamenají stavy

Audit kombinuje:

- inventuru rout, navigace, obrazovek, komponent, datového modelu a interní produktové dokumentace;
- kontrolu aktuálního běhu aplikace v reálném prohlížeči;
- kontrolu desktopového a úzkého viewportu;
- oddělení reálných, částečných a demonstračních funkcí;
- srovnání s aktuálními oficiálními materiály konkurentů;
- posouzení každodenního uživatelského toku, ne jen existence obrazovky.

Při živém průchodu byla dostupná přihlášená mobilní plocha a navigace, ale synchronizační vývojové prostředí se během auditu měnilo a část relace nebyla stabilní. Proto není hodnocení založené pouze na screenshotu; opírá se také o implementaci a již zdokumentované runtime testy.

### Legenda

- ✅ **Reálné:** hlavní tok existuje a dává uživateli užitek.
- 🟡 **Částečné:** základ existuje, ale chybí hloubka, návaznost nebo spolehlivost.
- 🧪 **Demo:** rozhraní existuje, ale není za ním plnohodnotná služba.
- ❌ **Chybí:** schopnost není implementovaná v použitelné podobě.
- ⚠️ **Rizikové:** existuje, ale není vhodné jí bez dalšího ověření důvěřovat v produkci.

U formulace „Watson je lepší“ rozlišuji **dnešní reálnou výhodu** a **potenciální produktovou výhodu**. Demo funkce se nepočítá jako konkurenční výhoda jen proto, že má hotovou obrazovku.

---

## 3. Konkurenční mapa

Watson ve skutečnosti nekonkuruje jedné aplikaci. Každý modul vstupuje do jiné vyspělé kategorie.

| Oblast Watsonu | Hlavní benchmark | Co uživatel očekává jako standard |
|---|---|---|
| Osobní úkoly | Todoist, Things, TickTick | Bleskové zadání, filtry, recurrence, připomínky, nulové tření |
| Týmové projekty | Asana, ClickUp, monday.com, Linear | Vlastní pole, závislosti, timeline, workload, formuláře, automatizace |
| Dokumenty a knowledge | Notion, Confluence, Coda | Propojené dokumenty, databáze, šablony, vyhledávání, oprávnění |
| Osobní plánování | Motion, Reclaim, Akiflow, Sunsama | Time blocking, pracovní doba, kapacita, automatické přeplánování |
| Osobní mail | Gmail, Spark, Superhuman, Notion Mail | Spolehlivý provider, search, labels, rules, snooze, offline, bezpečnost |
| Týmový mail | Front, Missive, Spark for Teams | Přiřazení, interní komentáře, shared drafts, SLA, audit, analytika |
| Meetings | Notion AI Meeting Notes, Otter, Fireflies, Granola, Fathom | Capture, transcript, mluvčí, shrnutí, úkoly, hledání napříč schůzkami |
| Workflow/SOP | Process Street, Pipefy | Formuláře, podmínky, schvalování, SLA, verze, evidence, audit |
| HR/Employee hub | Personio, Factorial | Self-service, dokumenty, žádosti, onboarding, oprávnění, audit |
| Cíle a portfolio | Asana Goals, monday.com, ClickUp Goals | Vazba na práci, predikce, health, kapacita, drill-down |

Nejbližší konkurent **celému Watsonu** je ClickUp. To je zároveň varování: ClickUp už nabízí úkoly, dokumenty, chat, whiteboard, formuláře, kalendář, notetaker, automatizace, cíle a rozsáhlé integrace. Watson jej nemůže dohnat horizontálním kopírováním. Musí být **výrazně jednodušší a výrazně lepší v propojení provozní práce**.

---

## 4. Detailní srovnání: úkoly a osobní produktivita

### 4.1 Zachycení a struktura úkolů

| Funkce | Watson | Benchmark | V čem je Watson lepší | Kde zaostává | Doporučení |
|---|---|---|---|---|---|
| Rychlé přidání | ✅ | Todoist, Akiflow | Český kontext a vazba na vlastní pracovní strukturu | Musí být dostupné konzistentně ze všech modulů a mobilu | Jedna globální capture lišta pro úkol, mail, poznámku a meeting follow-up |
| Přirozený jazyk | ✅ | Todoist | Čeština je praktická lokální výhoda | Benchmarky mají roky vyladěných edge cases | Zobrazovat živý parse preview a jedním klikem opravit datum, projekt či osobu |
| Plánované datum vs. deadline | ✅ | Todoist, Asana | Datový model je bohatší než Todoist, který stále nemá pravé start dates | Uživatel ne vždy rozumí významu jednotlivých dat | V UI jasně rozlišit „Začít“, „Udělám“, „Nejpozději“; nabídnout jednoduchý režim se skrytím pokročilých dat |
| Doba trvání | ✅ | Todoist, Motion | Dobrá základna pro budoucí kapacitní plánování | Doba se zatím nepromítá do skutečného kalendáře a kapacity | Přidat součet dne, varování přetížení a time-block návrh |
| Vícedenní úkol | ✅ | Asana, monday.com | Užitečné pro provozní práci | Bez timeline a vizualizace dopadu je hodnota omezená | Zobrazit rozsah na timeline a v kalendáři; hlídat konflikt s deadline |
| Opakování | ✅ | Todoist, TickTick | Základ existuje | Chybí výjimky, historie série, snadné „jen tentokrát“ a složitější pracovní kalendář | Zavést správu série, výjimky, posun při dokončení a náhled dalších výskytů |
| Připomínky | 🟡 | Todoist, Gmail, Things | Propojení s pracovním kontextem | Benchmarky mají lokální, polohové a vícekanálové připomínky | Přidat více připomínek, working-hours pravidla a follow-up připomínky |
| Priority | ✅ | Todoist, ClickUp | Oddělené barvy mohou nést jiný význam než priorita | Chybí vysvětlení, proč je věc prioritní | Zavést „Proč teď?“ a audit ručního/automatického zvýšení priority |
| Podúkoly | ✅ | Todoist, Asana, ClickUp | Dostatečný základ | ClickUp a Asana mají silnější hierarchii, dependencies a souhrny | Přidat progres rodiče, blokování a převod podúkolu na samostatný úkol/projekt |
| Více řešitelů | ✅ | ClickUp | Režimy `single`, `shared_any`, `shared_all` jsou opravdu zajímavá výhoda | Mentální model je složitý a potřebuje jasné vysvětlení | V detailu úkolu zobrazit podmínku dokončení lidskou větou a stav každého řešitele |
| Stav „čekám na“ | ❌/🟡 | Akiflow, Superhuman, Asana | Watson má data pro osoby a návaznosti | Chybí jednotná čekárna a automatický follow-up | Přidat Waiting Room: kdo dluží mně, komu dlužím já, kdy urgovat |
| Komentáře | ✅ | Asana, ClickUp | Mohou být součástí širší aktivity | Bez vláken, rozhodnutí a kontextu z mailu/meetingu jsou obyčejné | Přidat vlákna, označení „rozhodnutí“, reakce a deep link na zdroj |
| Aktivita úkolu | 🟡 | Asana, ClickUp | Potenciál cross-module historie | Dnes není úplným důvěryhodným auditem změn | Vytvořit jednotnou časovou osu s actor/time/before/after/source |
| Přílohy | 🟡 | Asana, ClickUp, Notion | Koncepčně mohou být propojené s dalšími moduly | Reálná práce se soubory, preview, limity a oprávnění nejsou dotažené | Objektové úložiště, skenování, verze, preview, explicitní sdílení a offline fronta |
| Hromadné akce | 🟡 | Todoist, Asana | Základ existuje | U rizikových akcí chybí preview dopadu a silné undo | Bulk preview: „změní se 43 úkolů, 7 lidí dostane notifikaci“ + undo |

### 4.2 Zobrazení a osobní organizace

| Funkce | Watson | Benchmark | V čem je Watson lepší | Kde zaostává | Doporučení |
|---|---|---|---|---|---|
| Dnes / Vše / Zásobník / Nadcházející | ✅ | Todoist | Dobré pokrytí základního dne | Dnes není dostatečně rozhodovací a časově realistické | Proměnit Dnes na „Můj den“: top 3, časová kapacita, čekání, kolize a rychlý shutdown |
| List | ✅ | Všichni | Bez zásadního odlišení | Potřebuje hustotu, klávesnici a konzistenci | Přidat compact/comfortable mód, inline edit a stabilní klávesové ovládání |
| Board | ✅ | Trello, Asana, ClickUp | Součást jednoho pracovního modelu | Chybí sofistikované swimlanes, WIP a pravidla | Swimlane podle osoby/projektu, WIP limit, bulk drag, automatické akce po přesunu |
| Kalendářní pohled | 🟡 | Todoist, Asana, Google Calendar | Stejná data jako úkoly | Není plnohodnotným plánovačem času | Dvoustranná synchronizace, drag-to-time-block, pracovní doba, konflikty |
| Oblíbené | ✅ | Todoist, Notion | Dobrá orientační pomůcka | Není náhradou za skutečné saved views | Oblíbené sjednotit pro pohledy, projekty, filtry a osoby |
| Vlastní filtry | ❌/🟡 | Todoist, ClickUp, Notion | — | Velká mezera pro pokročilejšího uživatele | No-code filter builder + textový dotaz; uložit, sdílet a připnout |
| Saved views | ❌ | Todoist, Asana, ClickUp, Notion | — | Bez nich každý tým opakuje stejnou filtraci | Ukládat filtr, group, sort, columns, density a výchozí zobrazení |
| Vlastní pole | ❌/🟡 | Asana, ClickUp, monday.com, Notion | Watson má účelovější core model | Bez polí nejde přizpůsobit obchod, provoz, HR nebo obsah | Zavést typovaná pole až po stabilizaci core; nepovolit nekontrolovaný chaos |
| Šablony | 🟡 | Todoist, Asana, Notion, ClickUp | Postupy mohou být chytřejší než obyčejná kopie | Chybí katalog, verze a bezpečná aktualizace instancí | Versioned Templates s changelogem a volitelnou migrací existujících instancí |
| Formuláře pro příjem práce | ❌ | Asana, monday.com, ClickUp, Pipefy | — | Praktická mezera pro požadavky od lidí mimo tým | Form builder → validace → routing → potvrzení → sledování stavu žadatelem |
| Import | ❌/🟡 | ClickUp, Notion, Asana | — | Bariéra adopce | Wizard pro Todoist/Asana/CSV/mail, dry-run, mapování, rollback |
| Export a obnova | 🟡/⚠️ | Zavedené produkty | Lokální/offline koncept může být výhoda | Uživatel potřebuje prokazatelnou obnovu, ne jen exportní tlačítko | Samoobslužný export, restore wizard, pravidelný test obnovy a protokol výsledku |

### Shrnutí proti Todoistu

Watson má šanci být lepší v **českém zadávání, práci s více typy dat, více řešiteli a propojení na týmový provoz**. Todoist je ale výrazně lepší v rychlosti, mentální jednoduchosti, filtrech, připomínkách, stabilitě a v tom, že uživatel přesně ví, co se stane.

Nejvyšší priorita proto není další typ úkolu. Je to dosáhnout toho, aby zadání, změna, dokončení, recurrence a synchronizace působily stejně samozřejmě jako v Todoistu.

---

## 5. Detailní srovnání: projekty a týmová práce

| Funkce | Watson | Benchmark | Výhoda Watsonu | Mezera | Doporučení |
|---|---|---|---|---|---|
| Projekty, sekce, stavy | ✅ | Asana, ClickUp, monday.com | Solidní společný základ | Méně přizpůsobení a lifecycle nástrojů | Project presets: jednoduchý, kanban, termínový, provozní |
| Osobní a týmové workspaces | ✅ | Asana, ClickUp | Dobrý základ pro role | Je třeba dokázat úplnou izolaci dat a konzistenci oprávnění | Jedna autorizační vrstva, kontraktní testy a role preview |
| Role a členství | 🟡/⚠️ | Asana, monday.com Enterprise | Koncepčně postačuje pro malý tým | Audit a enforcement musí být bez výjimek | Matice schopností, server-side enforcement, audit změn členství |
| Hosté a externisté | ❌/🟡 | Asana, ClickUp, Notion | — | Důležité pro klienty a dodavatele | Guest role s omezením na konkrétní projekt/položku a expirací přístupu |
| Statusy a workflow | ✅ | ClickUp, monday.com | Watson může nabídnout smysluplné přednastavené workflow | Chybí guardrails, automatizace a stavové metriky | Přechodová pravidla, povinná pole, SLA, event hooks |
| Timeline/Gantt | ❌ | Asana, ClickUp, monday.com | — | Zásadní mezera pro plánování projektu | Nejprve jednoduchá timeline nad date ranges, poté dependencies a critical path |
| Závislosti | ❌/🟡 | Asana, ClickUp, monday.com | Postupy mají sekvenční logiku | Není obecná síť blokuje/je blokováno | Typovaná vazba, upozornění na změnu, cyklická validace, dopad na termín |
| Milníky | ❌/🟡 | Asana, ClickUp, monday.com | Cíle lze propojit | Bez milníků se špatně čte plán | Speciální milestone entita s health a vazbou na cíl |
| Workload a kapacita | ❌ | Asana, ClickUp, monday.com | Duration data je dobrý základ | Chybí pracovní doba, dovolené a přehled přetížení | Týdenní kapacita, role, dostupnost, neplánovaná rezerva a what-if preview |
| Portfolio | 🟡 | Asana, monday.com | Velín má zajímavější operační ambici | Chybí spolehlivý roll-up, health a dependency map | Portfolio health s explicitním zdrojem signálu, trendem a drill-down |
| Cíle navázané na práci | 🟡 | Asana Goals, ClickUp Goals | Jeden systém může propojit operativu a strategii | Hodnota je omezená bez důvěryhodných aktualizací | Automatické návrhy progresu, ruční schválení, confidence a stale indicator |
| Dashboardy/reporty | 🟡 | Asana, monday.com, ClickUp | Český management cockpit může být srozumitelnější | Méně widgetů, segmentace a exportu; riziko dekorativních KPI | Každá metrika musí mít definici, refresh time a klikací zdrojová data |
| Automatizace | ❌/🟡 | ClickUp, monday.com, Asana | Watson může automatizovat napříč mailem, meetingem a úkolem | Chybí produkční rules engine | Trigger–condition–action, dry-run, audit, rate limit, undo/compensation |
| Dokumenty/knowledge | ❌ | Notion, ClickUp Docs, Confluence | Potenciální propojení na Postupy | Velká obsahová mezera | Lehký Knowledge modul, ne kopie Notionu: rozhodnutí, SOP, brief, meeting prep |
| Interní chat | ❌ | ClickUp Chat, Teams, Slack | — | Může působit jako mezera, ale není strategicky nutný | Nestavět plný chat; použít kontextová vlákna u práce a integraci se Slack/Teams |
| Audit log | 🟡/⚠️ | Asana Enterprise, ClickUp Enterprise | Cross-module audit může být diferenciátor | Musí být neměnný, úplný a exportovatelný | Organizace → actor → action → object → before/after → source/IP/device |

### Shrnutí proti Asaně, ClickUpu a monday.com

- **Proti Asaně** Watson zaostává v řízení portfolia, cílech, formulářích, automatizaci, dependencies a workloadu. Může vyhrát v jednodušším provozním předání práce a českém prostředí.
- **Proti ClickUpu** Watson výrazně zaostává šíří hotových detailů, views, customizací, dokumentů, integrací a automatizací. Měl by vyhrát menší složitostí a silnějším end-to-end příběhem.
- **Proti monday.com** chybí vizuální konfigurovatelnost, formuláře, dashboardy, automatizace a portfolio. Watson může být méně „stavebnice“ a více hotový pracovní systém.
- **Proti Notionu** Watson nemá flexibilní knowledge/database vrstvu. Neměl by Notion kopírovat; měl by nabídnout účelové dokumenty pevně napojené na rozhodnutí a exekuci.

---

## 6. Detailní srovnání: kalendář a plánování času

| Funkce | Watson | Benchmark | Mezera | Návrh |
|---|---|---|---|---|
| Kalendářní zobrazení úkolů | 🟡 | Todoist, Asana | Zobrazuje data, ale neřeší reálný čas | Umožnit plánovat úkol do časového bloku a vrátit jej zpět do backlogu |
| Externí kalendáře | ❌/🟡 | Google Calendar, Reclaim, Akiflow | Chybí důvěryhodná dvousměrná synchronizace | Google/Microsoft OAuth, mapping, privacy, konflikt a unlink recovery |
| Time blocking | ❌ | Akiflow, Sunsama, Motion | Uživatel neví, jestli se práce vejde | Drag úkolu do kalendáře, duration, split, buffer, přesun nedokončeného |
| Automatické plánování | ❌ | Motion, Reclaim | Významná příležitost | Nejdřív „navrhni plán“, ne autonomní přepis; ukázat důvod a dopad |
| Pracovní doba a lokace | ❌ | Google Calendar, Reclaim | Bez toho nelze rozumně plánovat ani notifikovat | Týdenní rozvrh, časová zóna, svátky, dovolená, focus hours, quiet hours |
| Přetížení dne | ❌/🟡 | Motion, Reclaim | Duration se nepromítá do reality | Kapacitní proužek: plánováno 7 h / dostupné 5 h, s návrhem řešení |
| Focus time | ❌ | Google Calendar, Reclaim | Chybí ochrana času | Focus block s auto-decline pravidlem a potlačením notifikací |
| Habits/rutiny | 🟡 přes recurrence | Reclaim, Akiflow | Opakovaný úkol není totéž jako flexibilní návyk | Volitelný modul rutin, které lze během týdne automaticky přesunout |
| Booking odkazy | ❌ | Google Calendar, Reclaim, Calendly | Praktická mezera pro meetingy | Dostupnost, buffery, typy schůzek, formulář, napojení na projekt/kontakt |
| Denní plánovací rituál | ❌ | Akiflow, Sunsama | Watsonův Dnes je více seznam než rituál | Ráno: vyber top 3 a rozvrhni. Večer: dokonči, přesuň, deleguj, reflektuj |

### Doporučený princip

Watson nemá automaticky hýbat lidem s kalendářem bez vysvětlení. Jeho silná verze je **human-in-the-loop planner**:

1. spočítá dostupnou kapacitu;
2. upozorní na konflikt nebo nereálný deadline;
3. navrhne konkrétní přesuny;
4. ukáže dopad na lidi a cíle;
5. změny provede až po schválení.

To je důvěryhodnější než „AI vám přeuspořádala celý den“ a dobře odpovídá charakteru Watsonu.

---

## 7. Detailní srovnání: mailový klient

### Kritický verdikt

Současný Mail je **produktový prototyp**. Seed data, lokální stav a hotově vypadající obrazovky nejsou ekvivalent Gmailu, Sparku ani týmového inboxu. Dokud neexistuje provider sync, serverová schránka, bezpečná správa tokenů, skutečné odesílání, robustní search a recovery, musí být v UI jasně označen jako demo.

| Funkce | Watson | Benchmark | Kde konkurence vede | Doporučení |
|---|---|---|---|---|
| Připojení účtu/provider sync | 🧪 | Gmail, Spark, Superhuman | Skutečný mailbox, sync cursor, delta, retry, quota | Začít jedním providerem; OAuth vault, webhook/polling, idempotence, observabilita |
| Více účtů a unified inbox | 🧪 | Spark, Missive, Superhuman | Vyspělá identity, oddělení účtů a sjednocené pohledy | Až po stabilním single-account M1; vždy zobrazit, z jakého účtu se odesílá |
| Inbox triage | 🧪/🟡 | Spark, Superhuman, Notion Mail | Split inbox, priority sender, newsletters, gatekeeper | Konfigurovatelné pohledy, VIP, newsletter/notifikace, explainable priority |
| Search | ❌/🧪 | Gmail, Superhuman, Missive | Gmail operátory a desítky let indexace | Serverový full-text index, operátory, chips, scope account/folder/date/person/attachment |
| Labels/folders/categories | 🧪 | Gmail, Spark | Stabilní provider mapping a uživatelská pravidla | Nejdřív zachovat provider semantics, potom Watson views nad nimi |
| Compose/reply/forward | 🧪 | Gmail, Spark, Superhuman | Deliverability, threading, drafts, signatures, attachments | Standardy MIME/threading, autosave server draft, attachment progress, identity guard |
| Undo send | ❌/🧪 | Gmail, Missive | Spolehlivé odložené odeslání | Outbox s countdown, zrušení a audit |
| Send later | 🧪 | Gmail, Spark, Superhuman | Časová zóna, recovery a serverový scheduler | Durable job, explicitní timezone, edit/cancel, failure notification |
| Snooze | 🧪/🟡 | Gmail, Spark, Missive | Zralé workflow návratu do inboxu | Snooze s working-hours, reason, team visibility a historií |
| Follow-up reminder | ❌/🟡 | Spark, Superhuman | Hlídání nezodpovězeného mailu | „Pokud neodpoví do…“; návrh follow-upu; vazba na Waiting Room |
| Rules/filters | 🧪 | Gmail, Front, Missive | Serverové event-driven rules | Sdílený automation engine s dry-run, testem na historických datech a auditem |
| AI psaní | 🧪 | Superhuman, Spark, Gmail | Kontext vláken, tone, personalizace | AI draft pouze jako návrh; cite source context, maskovat citlivá data, nikdy samo neodesílat |
| AI shrnutí | 🧪 | Superhuman, Front, Spark | Skutečný obsah a cross-thread kontext | Shrnutí s odkazy na konkrétní zprávy a zvýrazněnou nejistotou |
| Převod mailu na úkol | 🟡/🧪 | Gmail Tasks, Missive, Spark | Konkurence umí základ | Tady může Watson vyhrát: zachovat obousměrný deep link, autora, citaci a stav follow-upu |
| Shared inbox | 🧪 | Front, Missive, Spark Teams | Routing, ownership, SLA, analytics | Samostatná týmová doména, ne přidaný badge k osobnímu mailu |
| Přiřazení konverzace | 🧪 | Front, Missive | Atomické přiřazení, collision handling | Owner + watchers + deadline + audit + stav čekání |
| Interní komentáře | 🧪 | Front, Missive | Kontextová spolupráce bez přeposílání | Vlákna, mention, rozhodnutí, oprávnění a notifikace |
| Shared drafts/delegation | 🧪 | Spark, Front, Missive | Společné psaní a schvalování | Lock/collaboration model, review request, approval a audit odeslání |
| Kontakty a firmy | ❌/🧪 | Gmail Contacts, Front, Missive | Historie vztahu, CRM kontext | Contact sidebar: osoba, firma, projekty, otevřené úkoly, meetings, last touch |
| SLA a workload | ❌ | Front, Missive | Týmové fronty, first-response a resolution metriky | Až ve fázi shared inbox; SLA policies, business hours, breach prediction |
| Spam/phishing/security | ❌/🧪 | Gmail | Obrovská bezpečnostní a reputační infrastruktura | Nekopírovat Gmail spam engine; respektovat provider výsledky, přidat link/identity warning |
| Confidential/encryption | 🧪 | Gmail, enterprise mail | UI bez kryptografického a právního základu je riziko | Neuvádět jako hotové; threat model, key management, DLP, retention, právní review |
| Offline mail | 🧪 | Gmail, Spark | Cache, outbox, conflict a attachment policy | Explicitní offline vault, limit cache, encrypted-at-rest, outbox/recovery centrum |
| Klávesové ovládání | 🟡 | Gmail, Superhuman | Superhuman je extrémně rychlý a konzistentní | Command bar, discoverability, konflikt zkratek, plná ovladatelnost bez myši |
| Přístupnost | ⚠️ | Gmail | Gmail má screen-reader režimy a dlouhodobě laděnou klávesnici | Semantika mail listu/threadu, focus management, announcements a reálné testy |

### Jaký mail má Watson stavět

Nedoporučuji stavět další univerzální Gmail. Doporučuji **execution inbox**:

- běžné čtení a odesílání musí být spolehlivé;
- hlavní odlišení je převod konverzace na dohledatelné rozhodnutí, úkol, čekání, meeting nebo postup;
- každý převedený objekt zachová zdroj a obousměrný odkaz;
- týmové schránky přidají vlastníka, SLA, interní diskusi a audit;
- AI navrhuje, ale uživatel schvaluje;
- bezpečnostní a delivery operace jsou serverové a pozorovatelné.

### Doporučené fáze Mailu

1. **M0 – Transparentní demo:** viditelný štítek, žádné tvrzení o reálném odeslání či šifrování.
2. **M1 – Osobní Gmail účet:** OAuth, sync, read/thread/search, labels, compose, reply, attachments, drafts, send, retry, reconnect.
3. **M2 – Execution inbox:** snooze, follow-up, mail → úkol/meeting/projekt, contact sidebar, saved views.
4. **M3 – Týmový inbox:** assignment, watchers, comments, shared drafts, SLA, analytics, audit.
5. **M4 – Explainable AI:** triage, summary, proposed replies and actions, vše se zdrojem a schválením.

---

## 8. Detailní srovnání: Meetings

| Funkce | Watson | Benchmark | Výhoda Watsonu | Mezera | Doporučení |
|---|---|---|---|---|---|
| Meeting Hub | 🟡 | Notion, Otter, Fireflies | Samostatný modul a vazba na práci | Potřebuje kalendář, série, účastníky a stav | Domovská stránka dnes/nadcházející/minulé/čeká na review |
| Záznam/capture | ❌/🟡 | Otter, Fireflies, Fathom | — | Chybí spolehlivý audio/video capture | Začít importem nahrávky a desktop audio capture; řešit consent a jurisdikci |
| Živý přepis | ❌/🟡 | Otter, Fireflies | — | Velká UX a infrastrukturní mezera | Streaming STT, indikace kvality, možnost opravy, EU processing |
| Rozpoznání mluvčích | ❌/🟡 | Otter, Fireflies | — | Bez něj jsou rozhodnutí méně důvěryhodná | Speaker diarization + ruční oprava + učení pouze se souhlasem |
| AI shrnutí | 🟡 | Všichni | Watson může shrnutí rovnou zasadit do projektu | Chybí citace a spolehlivé zdroje | Každý bod shrnutí odkazuje na timestamp a řečníka |
| Návrh úkolů | ✅/🟡 | Motion, Otter, Fireflies, Granola | Human review místo slepé autonomie je správná filozofie | Je třeba ownership, deduplikace a provenance | Review queue: návrh, citace, řešitel, termín, confidence, merge/ignore |
| Rozhodnutí | 🟡 | Granola, Notion | Potenciál samostatné decision entity | Rozhodnutí se snadno ztratí mezi poznámkami | Decision log s ownerem, datem, platností a superseded vazbou |
| Příprava schůzky | ❌/🟡 | Notion, Granola | Watson zná otevřené úkoly a minulé závazky | Dnes z toho nevytváří automatický brief | Před schůzkou navrhnout agendu z Waiting Room, blokací a minulých úkolů |
| Follow-up | ❌/🟡 | Fathom, Otter, Granola | Může být propojený s Watson Mailem | Chybí kompletní smyčka | Po review vytvořit návrh mailu s rozhodnutími, úkoly a odkazy |
| Série schůzek | ❌/🟡 | Notion, Granola | — | Každý meeting zůstává izolovaný | Series memory: minulá rozhodnutí, carry-over, trend závazků |
| Hledání napříč meetings | ❌ | Otter, Fireflies, Granola | Work graph může překonat prostý transcript search | Chybí index a citované odpovědi | „Kdy jsme rozhodli X?“ → odpověď + meeting + timestamp + související úkol |
| Talk-time/meeting analytics | ❌ | Fireflies | — | Může být užitečné, ale snadno sklouzne k employee surveillance | Pouze týmové a opt-in metriky; žádné skryté hodnocení lidí |
| Integrace Zoom/Meet/Teams | ❌/🟡 | Otter, Fireflies, Fathom | — | Kritická adopční mezera | Kalendář + bot/API konektory až po právním a bezpečnostním základu |

### Cílová „meeting loop“

1. Watson před schůzkou vytvoří brief z posledních rozhodnutí a otevřených závazků.
2. Během schůzky zachytí audio/přepis se souhlasem.
3. Po schůzce navrhne shrnutí, rozhodnutí a úkoly s citacemi.
4. Člověk návrhy schválí nebo upraví.
5. Schválené akce se propíší do projektu, Waiting Room a Mail follow-upu.
6. Příští schůzka začne tím, co zůstalo nesplněné.

Tato uzavřená smyčka je silnější než samostatný AI notetaker.

---

## 9. Detailní srovnání: Postupy a provozní workflow

Postupy jsou jedna z největších příležitostí Watsonu. Sekvenční předání a různé podmínky dokončení jsou blíže reálnému provozu než obyčejný checklist. Proti Process Street a Pipefy ale zatím chybí vrstva řízení procesu.

| Funkce | Watson | Benchmark | Hodnocení | Doporučení |
|---|---|---|---|---|
| Sekvenční kroky a handoff | ✅/🟡 | Process Street, Pipefy | Silný základ a reálný diferenciátor | Zviditelnit „kdo je na tahu“, očekávaný čas a historii předání |
| Manuální brány | ✅/🟡 | Process Street approvals | Dobrý začátek | Přidat více schvalovatelů, any/all/quorum, substituci a eskalaci |
| Podmíněné větvení | ❌/🟡 | Process Street, Pipefy | Výrazná mezera | If/else nad typovanými poli, vizuální preview cesty, testovací instance |
| Formuláře a sběr dat | ❌ | Process Street, Pipefy | Bez nich je postup jen sada úkolů | Typovaná pole, validace, přílohy, podpis a předvyplnění z kontextu |
| Role assignments | 🟡 | Process Street | Pevná osoba nestačí pro opakovatelnost | Přiřazení podle role, týmu, manažera, rotace nebo vytížení |
| SLA a časovače | ❌/🟡 | Pipefy, Front | Chybí predikce zpoždění | Business-hours timer, warning, breach, escalation a pause reason |
| Důkaz dokončení | ❌/🟡 | Process Street | Pro auditní provoz důležité | Povinná příloha, formulář, podpis, odkaz či kontrola před dokončením |
| Verze workflow | ❌/🟡 | Process Street | Kritické pro změny za běhu | Published draft, changelog, nové vs. běžící instance, migrace s preview |
| Veřejný request portál | ❌ | Pipefy | Užitečný pro IT/HR/provoz | Externí formulář + ticket status bez přístupu do workspace |
| Procesní analytika | 🟡 | Process Street, Pipefy | Velín může být lepší cockpit | Potřebuje cycle time, bottleneck, rework a SLA trend |
| Automatizace/integrace | ❌/🟡 | Oba | Cross-module potenciál je vysoký | Společný rules engine, webhooky, email, kalendář, Slack/Teams, CRM |

### Kde může Watson vyčnívat

Process Street umí workflow, ale nemá přirozeně celý pracovní kontext Watsonu. Watson může ukázat, že krok postupu vznikl z konkrétního mailu, byl diskutován na schůzce, blokuje projekt a ovlivňuje cíl. To je směr, ve kterém má smysl investovat.

---

## 10. Cíle, reporty, Velín a zaměstnanecká oblast

### 10.1 Cíle, reporty a Velín

| Funkce | Watson | Benchmark | Mezera | Doporučení |
|---|---|---|---|---|
| Cíle | 🟡 | Asana Goals, ClickUp Goals | Chybí predikce, confidence a automatický roll-up | Progres odvozovat z milníků a práce, ale změnu nabídnout ke schválení |
| Reporty | 🟡 | Asana, monday.com, ClickUp | Hrozí dekorativní dashboard bez důvěry v data | Definice metriky, datum aktualizace, zdroj, drill-down, export |
| Velín | 🟡 | Asana portfolio, monday.com dashboards | Originální ambice, zatím není dost akční | Z každé karty musí vést konkrétní rozhodnutí: přeplánovat, přidělit, eskalovat |
| Radar dopadů | 🟡/koncept | Work management + BI | Potenciálně silné „wow“ | U každého rizika vysvětlit výpočet, nejistotu a dotčené objekty |
| What-if simulace | ❌ | Motion/monday.com částečně | Trh to většinou nedělá dobře | Přesunout deadline/osobu v sandboxu a ukázat kapacitu, kolize, cíle a SLA |
| Portfolio health | ❌/🟡 | Asana, monday.com | Chybí konzistentní health model | Signály: termín, scope, blokace, aktivita, kapacita, meeting commitments; žádná black-box známka |

Velín by neměl být „dashboard pro dashboard“. Má být **rozhodovací centrum**. Pokud karta pouze informuje, ale nenabídne další bezpečný krok a nevysvětlí zdroj, je to reporting, ne Velín.

### 10.2 Zaměstnanecká oblast

| Funkce | Watson | Benchmark | Mezera | Doporučení |
|---|---|---|---|---|
| Lidé/členství | 🟡 | Personio, Factorial | Základ pracovního vztahu není totéž jako HRIS | Udržet jednoduchý people directory a role; nestavět plný HRIS v první fázi |
| Employee self-service | 🧪/❌ | Personio, Factorial | Chybí reálný portál | „Moje údaje, dokumenty, žádosti, úkoly, onboarding“ jako zjednodušený povrch |
| Dokumenty a podpisy | ❌/🧪 | Personio, Factorial | Právní, bezpečnostní a retention náročnost | Řešit přes integraci nebo omezený secure document vault |
| Dovolená/absence | ❌/🟡 | Personio, Factorial | Nutné pro kapacitu, ale HR workflow je komplexní | Nejprve read-only dostupnost z HR/kalendáře; potom jednoduchá žádost a schválení |
| Onboarding/offboarding | 🟡 přes Postupy | Personio, Process Street | Tady je přirozený fit Watsonu | Šablona postupu, role-based úkoly, důkazy, deadline, revoke checklist, audit |
| Výkon lidí/monitoring | ❌ | HR platformy | Citlivá a riziková oblast | Nestavět individuální skryté skóre. Měřit tok práce a systémové překážky, ne „produktivitu člověka“ |

Watson má dobrou příležitost být **provozní employee hub**, nikoli mzdový/legální HR systém. Personio nebo Factorial mohou zůstat systémem záznamu; Watson bude systémem provedení onboardingů, žádostí a handoffů.

---

## 11. AI, vyhledávání, offline a platforma

| Schopnost | Watson | Benchmark | Hodnocení a návrh |
|---|---|---|---|
| Watson příkazy/assistant | 🟡 | ClickUp Brain, Notion AI, Superhuman Ask AI | Nesmí být jen chat. Má rozumět objektům, ukázat plán akce a čekat na potvrzení změn |
| AI návrhy z meetingu | 🟡 | Otter, Fireflies, Motion | Správný princip human review; doplnit citace, confidence, deduplikaci a provenance |
| AI pro mail | 🧪 | Superhuman, Spark, Gmail | Teprve po reálném mail backendu; defaultně vypnuto pro citlivý obsah |
| AI Suggestion Center | ❌ | Částečně Reclaim/Motion | Jedna fronta pro všechny návrhy: přeplánovat, vytvořit, sloučit, urgovat, aktualizovat cíl |
| Globální vyhledávání | 🟡 | Notion, ClickUp, Gmail | Musí prohledat všechny objekty, respektovat ACL a vracet deep link, snippet a zdroj |
| Cross-module otázky | ❌/🟡 | Granola, Superhuman Ask AI | Velká příležitost: odpověď pouze s citacemi na mail, meeting, rozhodnutí a úkol |
| Offline-first | 🟡/⚠️ | Většina konkurence omezeně | Potenciální diferenciátor, ale jen když je sync důvěryhodný a srozumitelný |
| Outbox a recovery | 🟡/vývoj | Gmail offline, lokální aplikace | Jedno centrum: čeká, posílá, selhalo, konflikt, vyřešit, exportovat diagnostiku |
| Konflikty | ⚠️ | Collaborative SaaS | Silent overwrite je nepřípustný; version check + diff + Conflict Inbox |
| Notifikace | 🟡 | Asana, Todoist, Front | Chybí governance pozornosti; přidat digest, quiet hours, relevance a per-object watch |
| PWA | ✅/🟡 | Web produkty | Dobrá distribuce, ale není náhradou za kvalitní mobilní UX a background sync |
| Mobilní aplikace | 🟡 | Todoist, Gmail, Asana | Dnešní navigace a hustota jsou slabé; mobile-first Můj den, inbox a quick capture |
| Přístupnost | ⚠️ | Gmail, Asana | Zavést semantický dialog/menu/list, focus management, kontrast, reduced motion a test s VoiceOver/NVDA |
| i18n čeština/angličtina | ✅/🟡 | Globální produkty | Čeština je výhoda; hlídat úplnost, pluralizaci, časové zóny a formáty |
| Integrace | ❌/🟡 | ClickUp 1000+, Asana 200+ | Nehonit počet. Priorita: Google/Microsoft, Slack/Teams, Drive, Zoom/Meet, HR a webhooks |
| API/webhooky | ❌/🟡 | Asana, ClickUp, monday.com | Nutné pro ekosystém; versioning, scopes, idempotence, audit a rate limits |
| Bezpečnost a tajemství | ⚠️ | Gmail/enterprise SaaS | Centralizovaný vault, rotace, least privilege, DPA, retention a incident response |
| Backup/restore | ⚠️ | Produkční SaaS | Definované RPO/RTO nestačí; je nutný automatický backup a pravidelný restore drill |
| Observabilita | ⚠️ | Produkční SaaS | Sentry/telemetrie, job metrics, sync health, provider health, trace ID a alerting |

### Zásady pro Watson AI

1. **Návrh před akcí.** AI nesmí sama posílat maily, mazat data, měnit práva nebo hromadně přeplánovat lidi.
2. **Zdroj před sebejistotou.** Každé shrnutí, rozhodnutí a doporučení má odkaz na původní větu nebo data.
3. **Undo a audit.** Každá schválená mutace musí být dohledatelná a pokud možno vratná.
4. **Viditelný scope.** Uživatel ví, která data model dostal a kterému provideru byla odeslána.
5. **Default off pro citlivé domény.** Mail, transcript a HR informace vyžadují explicitní politiku organizace.
6. **Rozpočet a routing.** Levný model pro klasifikaci, silnější pro komplexní návrhy; limity na uživatele a organizaci.

---

## 12. V čem Watson už dnes nebo koncepčně vyčnívá

### 1. Český Quick Add

Přirozené zadávání v češtině je skutečná lokální výhoda. Pokud bude parse preview, opravy a recurrence opravdu spolehlivé, může být Watson pro českého uživatele rychlejší než globální konkurence.

### 2. Bohatší časový model úkolu

Oddělení plánovaného data, deadline, duration a vícedenního rozsahu dává Watsonu lepší základ pro realistické plánování než jednodušší osobní todo aplikace.

### 3. Více způsobů společného dokončení

Režimy „stačí jeden“, „splní kterýkoli“ a „musí všichni“ řeší reálné týmové situace lépe než obyčejný seznam assignees.

### 4. Postupy a explicitní handoff

Většina task managerů umí checklist. Watson může umět skutečné předání odpovědnosti, brány, důkaz a návaznost na provoz.

### 5. Potenciální work graph

Jednotné propojení mailu, meetingu, rozhodnutí, úkolu, projektu, postupu a cíle je největší strategická výhoda. Zatím je to spíše potenciál než plně doručená schopnost.

### 6. Human-approved AI

Model „AI navrhne, člověk schválí“ je správný pro týmovou práci. Uživatelé více ocení důvěru a citace než okázalou autonomii.

### 7. Offline-first a evropské zaměření

Lokální dostupnost dat a evropská datová/AI strategie mohou být silné odlišení. Offline však nesmí znamenat neviditelné konflikty; musí být doprovázené nejlepší recovery UX v kategorii.

---

## 13. Kde Watson nejvíce zaostává

Pořadí podle dopadu, ne podle viditelnosti:

1. **Důvěryhodnost dat a produkční bezpečnost.** Uživatel nesmí přemýšlet, zda změna opravdu odešla, komu data patří a jestli je lze obnovit.
2. **Rozdíl mezi demem a reálnou funkcí.** Zejména Mail nesmí vizuálně slibovat něco, co backend neumí.
3. **Každodenní jednoduchost.** Mnoho modulů vytváří pocit šíře, ale běžný uživatel potřebuje především Můj den, Inbox, Search a bezpečný Quick Capture.
4. **Mobil a přístupnost.** Při dnešním stavu se část lidí k hodnotě produktu vůbec nedostane.
5. **Vyhledávání, saved views a filtry.** Bez nich se systém s rostoucím množstvím dat stane nepřehledný.
6. **Integrace.** Bez mailu, kalendáře, videohovorů, souborů a chatů bude Watson vyžadovat ruční přepisování práce.
7. **Hloubka project managementu.** Dependencies, timeline, workload, forms, templates a automation jsou dnes standard.
8. **Skutečné plánování času.** Seznam úkolů bez kapacity a kalendáře vede k nereálnému dni.
9. **Meeting capture a memory.** Samotné AI návrhy bez kvalitního přepisu, citací a historie série nejsou dost.
10. **Progressive disclosure.** Pokročilé funkce se zobrazují dříve, než uživatel chápe základní model.

---

## 14. Návrh nového informačního modelu aplikace

Současná navigace ukazuje téměř všechny schopnosti najednou. Pro běžného uživatele doporučuji tři povrchy:

### Můj den — výchozí režim pro každého

- top 3 výsledky dne;
- časová osa kalendáře a realistická kapacita;
- úkoly, které opravdu vyžadují akci;
- Waiting Room a follow-upy;
- maily k rozhodnutí, ne celý mailbox;
- nadcházející meeting a připravený brief;
- rychlý capture;
- večerní uzavření dne.

### Tým — práce a spolupráce

- projekty, seznamy, boardy a postupy;
- týmový inbox;
- workload a blokace;
- meeting series a rozhodnutí;
- saved views podle role.

### Provoz — management a administrace

- Velín, cíle, portfolio a reporty;
- rizika, kapacita, SLA a what-if;
- uživatelé, oprávnění, audit, integrace a policies.

Moduly se nezruší. Jen se **nevnucují všem uživatelům současně**. Role a onboarding určí, co se objeví v hlavní navigaci; zbytek zůstane v command palette a nabídce Více.

---

## 15. Prioritizovaný seznam nových funkcí

### 15.1 Malé změny: XS–S

| Funkce | Přínos | Náročnost | Priorita |
|---|---|---:|---:|
| „Proč teď?“ u úkolu a upozornění | Uživatel chápe prioritu | XS | P1 |
| Top 3 dne | Snižuje chaos v Dnes | XS | P1 |
| Viditelný „Naposledy synchronizováno“ | Posiluje důvěru | XS | P0 |
| Badge Demo u nereálných modulů | Odstraňuje falešné očekávání | XS | P0 |
| Recent items a rychlý přepínač | Rychlejší orientace | S | P1 |
| Jednotné Undo toast | Bezpečnější hromadné i běžné akce | S | P0 |
| Compact/comfortable density | Lepší desktop i tablet | S | P2 |
| Quick actions na mobilní kartě | Méně otevírání detailu | S | P1 |
| Working-hours aware snooze | Méně nevhodných návratů/notifikací | S | P1 |
| Attachment reminder v mailu | Praktická drobnost, kterou uživatel čeká | S | P2 |
| Večerní shutdown flow | Udržuje systém čistý | S | P2 |
| Označení komentáře jako rozhodnutí | Začátek project memory | S | P1 |
| Copy deep link na každý objekt | Propojení s externími nástroji | S | P1 |
| Empty states s prvním krokem | Jednodušší onboarding | S | P1 |
| Vysvětlení režimu multi-assignee | Snižuje chyby | XS | P1 |

### 15.2 Střední funkce: M

| Funkce | Přínos | Závislosti | Priorita |
|---|---|---|---:|
| Saved views a filter builder | Každodenní orientace a týmové role | Stabilní query model | P1 |
| Waiting Room | Přehled delegací a follow-upů | Stav čekání, reminders | P1 |
| Univerzální search s deep links | Najde práci napříč Watsonem | ACL-safe index | P1 |
| Daily/weekly smart digest | Méně notifikačního hluku | Relevance model, working hours | P1 |
| Versioned templates | Rychlejší adopce a opakovatelnost | Verze, migrace, audit | P1 |
| Intake formuláře | Praktický vstup požadavků | Custom fields, routing | P1 |
| Working hours, svátky, quiet hours | Základ kapacity a plánování | Timezone/date model | P1 |
| Dependency `blocks/blocked by` | Reálné řízení projektu | Datový model, cykly | P1 |
| Meeting templates a series | Konzistentní porady | Meeting ACL, calendar | P1 |
| Contact/company sidebar | Kontext vztahu napříč mailem a meetings | Reálný Mail M1 | P2 |
| Restore wizard | Důvěra a samoobsluha | Ověřený backup | P0 |
| Bulk preview | Prevence škod | Audit a undo | P0 |
| Onboarding podle use case | Rychlejší first value | Šablony, progressive disclosure | P1 |
| Role-based navigation | Jednodušší employee zkušenost | Stabilní permissions | P1 |

### 15.3 Velké funkce: L

| Funkce | Přínos | Riziko / podmínka | Priorita |
|---|---|---|---:|
| Rules/Automation engine | Šetří opakovanou práci napříč moduly | Dry-run, audit, idempotence, rate limits | P1 |
| Timeline + critical path | Řízení termínových projektů | Dependencies a date semantics | P2 |
| Workload + what-if | Předejde přetížení a skluzu | Duration, pracovní doba, absence, kvalitní data | P2 |
| Dvousměrný kalendář + time blocking | Realistický Můj den | OAuth, conflict/recovery, privacy | P1 |
| Secure Mail M1 | Otevře nejsilnější cross-module use case | Samostatný bezpečnostní a provozní program | P1 po P0 |
| Shared Inbox M3 | Silný produkt pro provozní týmy | Mail M1/M2, SLA, role, audit | P2 |
| Meeting capture + transcript | Uzavře meeting loop | Consent, STT, storage, EU/DPA | P2 |
| Universal offline outbox | Důvěryhodná práce bez připojení | Konflikty, retry, observabilita | P0/P1 |
| Knowledge/Decision hub | Dlouhodobá paměť projektu | Search, permissions, work graph | P2 |

### 15.4 Nové moduly: XL

#### A. Work Graph / Paměť práce

Ne samostatná obrazovka navíc, ale datová vrstva spojující:

- mail a konkrétní zprávu;
- meeting a timestamp;
- rozhodnutí a jeho pozdější změnu;
- úkol, projekt, postup a cíl;
- osobu, firmu a tým;
- dokument nebo přílohu.

Uživatel pak může položit otázku „Proč to děláme?“ nebo „Kde se rozhodlo, že termín je pátek?“ a dostane citovanou odpověď.

#### B. AI Suggestion Center

Jedna fronta bezpečných návrhů:

- vytvořit úkol z mailu nebo meetingu;
- spojit duplicity;
- urgovat čekající osobu;
- přeplánovat přetížený den;
- změnit health projektu;
- aktualizovat progres cíle;
- připravit follow-up.

Každý návrh má důvod, zdroj, dopad, confidence a tlačítka schválit/upravit/zamítnout.

#### C. Impact Simulator

Sandbox pro manažerské změny:

- přesun deadline;
- změna řešitele;
- absence člověka;
- přidání urgentní zakázky;
- změna priority;
- zpoždění konkrétního handoffu.

Watson před provedením ukáže dopad na kapacitu, závislosti, SLA, meetings a cíle.

#### D. Knowledge & SOP

Lehký, účelový modul místo kopie Notionu:

- rozhodnutí;
- brief;
- SOP;
- meeting prep;
- incident review;
- klientský nebo projektový přehled;
- vazby na práci a vlastník aktuálnosti.

#### E. Employee Hub

Jednoduchý povrch pro běžného zaměstnance:

- Můj den;
- moje žádosti;
- onboarding/offboarding úkoly;
- dokumenty a potvrzení;
- dovolená/dostupnost;
- kontakty a odpovědnosti;
- pouze minimum administrativní složitosti.

---

## 16. Deset funkcí s největším „to je hustý“ efektem

### 1. Z čehokoli do exekuce

Označím větu v mailu, přepisu nebo poznámce. Watson navrhne úkol, termín, osobu, projekt a follow-up. Po schválení zachová citaci a obousměrný odkaz.

### 2. „Proč teď?“ a „Co se tím pohne?“

U každé důležité věci Watson vysvětlí, proč ji doporučuje právě dnes a které další úkoly, postupy nebo cíle se dokončením odblokují.

### 3. Ranní cockpit

Ne seznam 38 úkolů, ale realistický plán: kalendář, top 3, 5 hodin dostupnosti, dva blokované závazky, jeden mail k rozhodnutí a připravený meeting brief.

### 4. Waiting Room

Jedno místo pro vše, na co čekám od ostatních, a vše, co ostatní čekají ode mě. Watson navrhne zdvořilý follow-up ve správný čas.

### 5. Project Memory

Časová osa projektu spojuje maily, schůzky, rozhodnutí, změny zadání, úkoly a výsledky. Každý fakt je dohledatelný ke zdroji.

### 6. What-if bez následků

Přetáhnu termín o týden nebo odeberu člověka z projektu a Watson před aplikací ukáže přesné kolize, přetížení a ohrožené cíle.

### 7. „Nic se neztratí“ offline

Uživatel vidí všechny čekající změny, selhání a konflikty v lidské podobě. Může je opravit, znovu odeslat nebo exportovat. Důvěra je sama o sobě wow feature.

### 8. Meeting loop

Před poradou připravená agenda z minulých závazků; po poradě citované návrhy rozhodnutí a úkolů; schválený follow-up; příště automatický carry-over.

### 9. Rozhraní podle role

Zaměstnanec vidí jednoduchý den a žádosti. Projektový vedoucí workload a blokace. Management Velín. Je to jeden systém bez stejného chaosu pro všechny.

### 10. Workflow Pulse

Watson pozná, že se handoff pravděpodobně zasekne ještě před překročením termínu: chybí vstup, schvalovatel je mimo kancelář nebo další člověk nemá kapacitu. Ukáže důkaz a navrhne řešení.

---

## 17. Co teď záměrně nestavět

Každá z následujících věcí je lákavá, ale v nejbližší fázi by rozmělňovala produkt:

- plnohodnotný interní chat konkurující Slacku/Teams;
- whiteboard konkurující Miro/Figmě;
- univerzální relační databázový builder konkurující Notionu/Airtable;
- nativní mobilní přepis celé aplikace dříve, než je hotový mobilní informační model;
- plný HRIS, mzdy a právní personální agenda;
- skryté individuální skórování zaměstnanců;
- autonomní AI odesílající maily, měnící přístupy nebo mazající data;
- stovky integrací před dotažením pěti klíčových;
- time tracking, pokud se nestane explicitní strategií produktu;
- další dashboardy bez akce, definice metriky a drill-downu.

---

## 18. Doporučená roadmapa

### Fáze 0: 0–90 dní — důvěryhodné jádro

**Cíl:** Watson může bezpečně používat interní pilot do přibližně 20 lidí.

- per-user a per-workspace izolace dat;
- server-side RBAC a kontraktní testy;
- sync recovery centrum, konflikty, outbox a jasné stavy;
- automatický backup a ověřený restore;
- audit citlivých akcí;
- oprava mobile core flows a navigace;
- focus/dialog/menu/accessibility základ;
- pravdivé označení demo modulů;
- stabilní search základ;
- produkční observabilita a incident checklist.

**Exit gate:** žádná známá cesta ke cizím datům, žádná tichá ztráta změny, úspěšný restore drill, klíčové toky ovladatelné klávesnicí a na mobilu.

### Fáze 1: 3–6 měsíců — nejlepší každodenní práce

- nový Můj den a top 3;
- saved views, filtry a Waiting Room;
- univerzální search;
- working hours, quiet hours a digest;
- versioned templates a formuláře;
- dependencies a jednoduchá timeline;
- role-based navigation a use-case onboarding;
- meeting series, templates a review queue;
- Google/Microsoft kalendář M1 a time blocking.

**Exit gate:** nový uživatel získá první hodnotu do 10 minut a většinu pracovního dne zvládne přes Můj den, capture, search a Waiting Room.

### Fáze 2: 6–12 měsíců — propojený provoz

- Mail M1 a následně execution inbox M2;
- automation engine;
- meeting capture/transcript pilot;
- Work Graph a decision log;
- portfolio health;
- workload a what-if beta;
- Knowledge/SOP minimum;
- klíčové integrace a veřejné webhooky/API.

**Exit gate:** mail nebo meeting lze bezpečně proměnit v dohledatelnou exekuci bez ručního přepisování.

### Fáze 3: 12–18+ měsíců — diferenciace kategorie

- shared inbox a týmový Mail M3;
- AI Suggestion Center;
- Impact Simulator;
- cross-meeting/project memory s citacemi;
- Workflow Pulse a SLA predikce;
- Employee Hub;
- vyspělé portfolio a goal prediction.

Při jednom vývojáři je realistický program na **14–20 měsíců** a je nutné tvrdě držet pořadí. Přidání lidí může urychlit paralelní proudy bezpečnosti, platformy a UX, ale samo nevyřeší produktovou komplexitu.

---

## 19. Metriky, podle kterých poznat zlepšení

### Důvěra

- podíl úspěšně synchronizovaných mutací;
- počet tichých konfliktů: cílově nula;
- čas od selhání k viditelné informaci uživateli;
- úspěšnost pravidelného restore drillu;
- počet bezpečnostních/RBAC regresí.

### Jednoduchost

- čas od registrace k prvnímu smysluplnému úkolu/projektu;
- podíl uživatelů, kteří dokončí onboarding bez pomoci;
- počet akcí pro zadání, přeplánování a delegování úkolu;
- úspěšnost klíčových mobilních toků;
- podíl uživatelů používajících saved views a Můj den.

### Praktická hodnota

- podíl pracovních položek vzniklých capturem z mailu/meetingu;
- počet aktivních Waiting Room follow-upů a jejich resolution rate;
- podíl meeting návrhů, které uživatel schválí nebo upraví;
- snížení ručního přepisování mezi nástroji;
- podíl postupů dokončených bez pozdního handoffu.

### Kvalita AI

- accept/edit/reject rate podle typu návrhu;
- přesnost citace zdroje;
- počet nevratných AI akcí: cílově nula;
- náklady na aktivního uživatele;
- počet incidentů s citlivými daty.

---

## 20. Priorita funkcí v jedné tabulce

| Priorita | Udělat | Důvod |
|---|---|---|
| P0 | Data isolation, RBAC, sync recovery, konflikty, backup/restore, audit, observabilita | Bez toho nelze věřit žádné další funkci |
| P0 | Pravdivě oddělit demo a produkční moduly | Důvěra a právní/produktová transparentnost |
| P0 | Mobile core a accessibility foundation | Část uživatelů je jinak vyloučena |
| P1 | Můj den, saved views, search, Waiting Room | Nejvyšší každodenní užitek |
| P1 | Working hours, time blocking, kalendář M1 | Z úkolů vznikne realistický plán |
| P1 | Templates, forms, dependencies | Dohnání základního týmového standardu |
| P1 | Automation engine se safety vrstvou | Násobí hodnotu všech modulů |
| P1 | Mail M1 po dokončení P0 | Otevře klíčovou diferenciaci |
| P2 | Meeting capture, Work Graph, Knowledge | Vytváří unikátní paměť práce |
| P2 | Workload, portfolio health a what-if | Vyspělá manažerská hodnota |
| P2 | Shared inbox | Silné pro provozní týmy, ale náročné |
| P3 | Employee Hub a pokročilá AI | Až na stabilní platformě a datech |

---

## 21. Konečné doporučení

Watson by měl na čas **zastavit rozšiřování horního menu** a soustředit se na tři věci:

1. **Důvěra:** žádná ztracená data, žádné falešné demo, jasný sync, recovery, oprávnění a audit.
2. **Jednoduchý den:** Můj den, capture, search, Waiting Room, mobil a pracovní kapacita.
3. **Unikátní návaznost:** mail/meeting → citované rozhodnutí → úkol → postup/handoff → cíl.

Pokud Watson pouze doplní custom fields, Gantt, chat a další obecné checkboxy, stane se menší kopií ClickUpu. Pokud však dokonale vyřeší **převod komunikace na dohledatelnou práci a bezpečné předávání odpovědnosti**, může mít vlastní kategorii.

Největší produktové překvapení pro uživatele nebude věta „máme i mail a AI“. Bude to zkušenost:

> „Watson ví, odkud úkol vznikl, proč je důležitý, kdo na koho čeká, co se zpožděním rozbije a nabídne mi bezpečný další krok — bez toho, aby převzal kontrolu.“

---

## 22. Pokrytí současných modulů Watsonu

Tato tabulka ověřuje, že doporučení nezůstalo jen u nejviditelnějších oblastí. „Rozhodnutí“ říká, co má být s modulem v cílovém produktu.

| Současný modul/povrch | Dnešní role | Nejbližší benchmark | Rozhodnutí |
|---|---|---|---|
| Přehled | Souhrnná vstupní obrazovka | ClickUp Home, Asana Home | Přestavět na osobní Můj den; management KPI přesunout do Velína |
| Dnes | Dnešní úkoly | Todoist Today, Sunsama | Zachovat a výrazně posílit o top 3, kapacitu, kalendář a čekání |
| Úkoly – Vše | Úplný seznam | Todoist, Asana My Tasks | Zachovat; doplnit saved views, filter builder, columns a density |
| Zásobník | Nezpracované nebo odložené úkoly | Todoist Inbox, Akiflow Inbox | Jasně definovat jako capture inbox; přidat rychlý triage rituál |
| Nadcházející | Budoucí práce | Todoist Upcoming | Zachovat; spojit s kapacitním a kalendářním pohledem |
| Projekty | Týmová práce | Asana, ClickUp, monday.com | Zachovat; doplnit šablony, dependencies, timeline, health a workload |
| Seznamy | Volnější kolekce | Notion databases, Microsoft Lists | Vyjasnit rozdíl proti projektům; pokud nemá unikátní účel, sloučit do saved views/collections |
| Oblíbené | Rychlé odkazy | Todoist Favorites, Notion Favorites | Rozšířit na projekty, views, filtry, osoby a recent items |
| Board | Stavový pohled | Trello, Asana Board | Zachovat jako view, ne samostatný datový model; přidat WIP a swimlanes |
| Kalendář | Datový pohled úkolů | Google Calendar, Motion, Reclaim | Přeměnit z view na skutečné plánování času |
| Schránka | Interní příjem/notifikace | Asana Inbox, ClickUp Inbox | Vyjasnit: všechno, co vyžaduje reakci; oddělit od pasivního notification centra |
| Notifikační centrum | Události a upozornění | Asana Inbox, Slack activity | Sloučit duplicitní signály, přidat watch, digest, quiet hours a relevance |
| Hledat | Globální hledání | Notion, ClickUp, Gmail | Udělat primární navigační nástroj s ACL-safe indexem a deep links |
| Mail | Osobní/týmový mail koncept | Gmail, Spark, Front, Missive | Do M1 jasné demo; potom execution inbox, nikoli obecná kopie Gmailu |
| Meets | Schůzky a AI návrhy | Notion AI Notes, Otter, Granola | Zachovat jako strategický modul; dokončit celou meeting loop |
| Postupy | Sekvence a handoff | Process Street, Pipefy | Investovat; je to jeden z nejsilnějších diferenciátorů |
| Cíle | Strategické cíle | Asana Goals, ClickUp Goals | Zachovat, ale provázat na milníky, práci, confidence a stale state |
| Reporty | Analytické výstupy | Asana, monday.com dashboards | Zachovat pouze metriky s definicí, zdrojem, refreshem a drill-downem |
| Velín | Manažerský/provozní cockpit | Asana Portfolio, monday.com dashboards | Zachovat jako rozhodovací centrum; každá karta musí vést k akci |
| Watson assistant | Příkazy a AI | Notion AI, ClickUp Brain | Změnit z obecného chatu na plánovač bezpečných akcí nad work graphem |
| Quick Add | Globální zachycení | Todoist, Akiflow | Zachovat a udělat všudypřítomné; přidat parse preview a více typů výstupu |
| Command palette | Rychlá navigace/akce | Superhuman, Linear, Notion | Zachovat; sjednotit navigaci, capture, hledání a bezpečné command preview |
| Detail úkolu/projektu | Kontextová editace | Asana, Linear, ClickUp | Sjednotit strukturu, focus management, activity timeline a source links |
| Nastavení | Účet, tým, integrace, policies | Asana/Google Workspace Admin | Rozdělit na osobní, workspace a administraci; skrýt položky bez oprávnění |
| Téma a i18n | Personalizace a CZ/EN | Běžný SaaS standard | Zachovat; doplnit systémový motiv, kontrast, pluralizaci a locale/timezone testy |
| PWA/offline | Lokální dostupnost | Todoist/Gmail offline | Zachovat jako diferenciátor pouze s viditelným outboxem a recovery |
| Mobilní spodní navigace | Mobilní přístup | Todoist, Gmail, Asana | Omezit na Můj den, Inbox, Capture, Search a Více; role-based varianty |

### Moduly, které spolu dnes významově kolidují

- **Přehled vs. Dnes:** běžný uživatel nepotřebuje dvě hlavní domovské obrazovky. Doporučení je sloučit osobní hodnotu do Můj den a management přehled nechat ve Velínu.
- **Schránka vs. Notifikace:** Schránka má být akční fronta; notifikace pouze historie signálů. Jedna událost se nesmí zobrazit jako dva nesouvisející úkoly k vyřízení.
- **Seznamy vs. Projekty:** je nutné říct, zda Seznam znamená lehkou databázi, saved collection nebo projekt bez workflow. Pokud rozdíl uživatel neumí vysvětlit jednou větou, model zjednodušit.
- **Reporty vs. Velín:** Reporty odpovídají na „co se stalo“; Velín na „co mám rozhodnout teď“.
- **Watson assistant vs. Search/Command palette:** Search hledá fakta, palette spouští známé akce, Watson navrhuje složitější plán. Vizuálně mohou sdílet vstup, ale musí ukázat odlišný typ výsledku.

## 23. Oficiální zdroje konkurence

### Produktivita a projekty

- [Todoist – pricing a funkční přehled](https://www.todoist.com/pricing/)
- [Todoist – custom views](https://www.todoist.com/help/articles/customize-views-in-todoist-AoHhBxFdZ)
- [Todoist – start dates](https://www.todoist.com/help/articles/does-todoist-support-start-dates-qhqlgZhk)
- [Asana – product](https://asana.com/product)
- [Asana – project management](https://asana.com/features/project-management)
- [Asana – goals and reporting](https://asana.com/features/goals-reporting)
- [Notion – projects](https://www.notion.com/product/projects)
- [ClickUp – features](https://clickup.com/features)
- [ClickUp – automations](https://clickup.com/features/automations)
- [monday.com – work management](https://monday.com/work)
- [monday.com – project features](https://monday.com/projects/features)

### Mail

- [Gmail – search operators](https://support.google.com/mail/answer/7190?hl=en-eu)
- [Gmail – labels](https://support.google.com/mail/answer/118708?hl=en)
- [Gmail – filters](https://support.google.com/mail/answer/6579?hl=en)
- [Spark – features](https://sparkmailapp.com/features)
- [Spark – shared drafts and delegation](https://sparkmailapp.com/blog/shared-drafts-and-delegations)
- [Superhuman Mail](https://superhuman.com/products/mail)
- [Superhuman AI](https://superhuman.com/products/mail/ai)
- [Front – omnichannel shared inbox](https://front.com/product/omnichannel-support-inbox)
- [Missive – features](https://missiveapp.com/features)
- [Missive – team inboxes](https://missiveapp.com/docs/core-features/team-spaces/team-inboxes/)
- [Notion Mail – introduction](https://www.notion.com/blog/introducing-notion-mail)

### Kalendář a plánování

- [Google Calendar Help](https://support.google.com/calendar/)
- [Google Calendar – focus time](https://support.google.com/calendar/answer/11190973?hl=en_)
- [Reclaim – AI assistant](https://reclaim.ai/features/ai-assistant)
- [Motion – auto-scheduling](https://www.usemotion.com/help/time-management/auto-scheduling)
- [Akiflow – features](https://akiflow.com/features)

### Meetings

- [Notion – AI Meeting Notes](https://www.notion.com/en-US/product/ai-meeting-notes)
- [Otter – Zoom and meeting notes](https://otter.ai/zoom)
- [Fireflies – product](https://fireflies.ai/)
- [Granola – repeatable meeting formats](https://www.granola.ai/blog/meeting-recipes-repeatable-formats)
- [Granola – chatting with meetings](https://docs.granola.ai/help-center/getting-more-from-your-notes/chatting-with-your-meetings)
- [Fathom – product/help](https://help.fathom.video/en/articles/5290881)

### Workflow a HR

- [Process Street – workflows](https://www.process.st/product/workflows/)
- [Process Street – conditional logic](https://www.process.st/help/docs/conditional-logic/)
- [Process Street – approvals](https://www.process.st/approvals/)
- [Pipefy – product](https://www.pipefy.com/product-overview/)
- [Pipefy – forms](https://www.pipefy.com/forms/)
- [Personio – product](https://www.personio.com/)
- [Personio – Core HR](https://www.personio.com/product/core-hr-software/)
- [Factorial – features](https://factorialhr.com/features)
