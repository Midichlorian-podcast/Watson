# MASTER — Základní stavební kámen aplikace

> Jeden dokument, který popisuje celou appku i řešení. U **každé funkce** je *Vzor* (kdo to umí a jak) a *Naše řešení* (jak to převzít a přizpůsobit). Slouží jako stavební kámen pro náš nový Todoist-like program. Sjednocuje všechna dosavadní rozhodnutí, architekturu, datový model a AI pravidla. Doprovodné soubory: `funkcni_specifikace_v2_build_ready.md`, `AI_chovani_spec.md`, `porovnani_todoist_notion_asana.md`.

---

## 0. Účel, platformy, jak číst

- **Co stavíme:** vlastní, plnohodnotný, offline-first task/projekt/kalendář nástroj pro tým, obecný jako Todoist (uživatel si tvoří týmy a projekty). Robustní, na míru, s vlastními daty.
- **Platformy:** **telefon, tablet, počítač** — jeden responzivní web jako PWA (instalovatelný, offline), desktop přes Tauri; nativní mobil až ve v3. Vše ze stejného kódu.
- **Jak číst:** „Vzor" = odkud řešení bereme. „Naše řešení" = jak to uděláme u nás. `MVP/v2/v3` = fáze. Tvrdá pravidla a rozhodnutí jsou závazná.

---

## 1. Vize, rozsah, principy

**Vize:** náhrada Todoistu „se vším všudy" — úkoly + projekty + kalendář + týmová spolupráce + AI asistence, offline-first, česky, s vlastními daty.

**Principy:** (1) offline-first, ne bonus; (2) jednoduchost à la Todoist navzdory bohatosti; (3) česky first včetně AI; (4) barvy jako samostatné velké téma; (5) AI transparentní asistent (nikdy potají); (6) klávesnice a rychlost; (7) **univerzální stavba** — žádné natvrdo zadané kontexty, vše si tvoří uživatel.

---

## 2. Zamčená rozhodnutí (z dotazníků)

- **Hosting:** managed-first — Supabase (Postgres+Auth+Storage) + PowerSync Cloud, workery Fly/Railway, web Vercel, **region EU**; self-host cesta později.
- **Sync engine:** **Postgres + PowerSync** (offline-first, real-time).
- **Staví:** Claude Code + Adam → krokový postup.
- **Stavba:** univerzální/generická (týmy a projekty tvoří uživatel).
- **Branding:** nová vlastní identita (název se řeší samostatně).
- **Tým:** 15–30 interních; externí (rodiče/klienti) zatím 0, architektura připravená.
- **Migrace:** čistý start (import z Todoistu volitelně později).
- **Přihlášení:** všechny 4 (e-mail+heslo, Google, magic link, Apple); **2FA dobrovolné**.
- **Notifikace:** push + e-mail; **digest per uživatel**.
- **Tempo:** **kvalita > rychlost**.
- **Lehký režim hosté:** základ v MVP (role host, restricted, oprávnění), plný portál později.
- **Osobní prostor:** ano, každý uživatel.
- **Podúkoly:** rodič se **nedokončí sám** (ruční).
- **Quick add:** padá do osobního inboxu (`#projekt` přesměruje).
- **Štítky:** **globální** napříč vším (úroveň účtu).
- **Board:** seskupení **volitelné per projekt** (sekce/stav/přiřazený/priorita).
- **Více přiřazených:** při přiřazení se **vždy ptáme** na režim (single / stačí jeden / každý zvlášť).
- **Připomínky:** výchozí offset **per uživatel**.
- **Google Kalendář:** obousměrně; **každý projekt = vlastní Google kalendář**; konflikt → **ptát se**.
- **Role:** přednastavené + **vlastní role** (presety MVP, custom v2), vynucené row-level.
- **Opakování:** výchozí **od termínu**; per úkol volba „od dokončení".
- **Time tracking:** **vyřazen** (odhad délky pro time-blocking zůstává).
- **Popis/komentáře:** **Rich text (WYSIWYG)** ukládaný jako Markdown.
- **„Dnes":** zpožděné úkoly **vlastní rozbalovací sekce**, nemíchat s dnešními.
- **Integrace:** Google Kalendář (jádro, víc později), iDoklad (REST/OAuth2, placený tarif, v2/v3), Spark (bez API → e-mail přeposíláním, odloženo), Lucky OS (vaše app, zatím nehotová → později), e-mail→úkol odloženo.
- **AI:** dle `AI_chovani_spec.md` — Vyvážený, transparentní (žádné „auto tiše"), tvrdé mantinely.

---

## 3. Architektura

- **Sync jádro:** PowerSync nad Postgresem. Klient drží lokální DB (okamžité čtení/zápis), engine replikuje obousměrně a real-time, offline fronta, řešení konfliktů (struktura = LWW na poli + serverová autorita; text = CRDT/Yjs). UUID generované na klientu (offline tvorba). *Vzor:* Todoist command-based incremental sync (sync_token, temp_id mapping) — princip přebíráme, řeší ho za nás PowerSync.
- **Auth:** Better Auth (e-mail+heslo, Google, Apple, magic link, 2FA). Workspace = tým; uživatel ve více workspaces s rolí; hosté omezený záběr.
- **Kalendář:** Google Calendar API v3 (events + freebusy), **watch webhooky** + **sync token** (inkrementálně), per-projekt mapování na samostatný Google kalendář, konflikt → uživatel. Apple CalDAV v2.
- **AI:** služba nad Claude API na backendu (klíče server-side), fronta úloh; chování dle AI spec.
- **Notifikace:** Web Push (VAPID) + e-mail (Resend); workery: připomínky, eskalace, digest, calendar sync, AI běhy, automatizace.
- **Cross-platform:** jeden React/Vite/PWA web (responzivní telefon/tablet/PC), Tauri desktop; nativní mobil v3.

---

## 4. Datový model (entity + tvrdá pravidla)

Hlavní entity: **User, Workspace, Membership(role), Project(color, visibility), ProjectMember(role), Section, Status, Task(parent_id, priority, color, due/start/deadline, duration, recurrence, assignment_mode, status), Assignment(completed_at), ChecklistItem, Label(global), TaskLabel, Reminder, Comment(yjs), Attachment(version), Filter, Template, CustomField/Value, TaskType, Dependency, Milestone, CalendarConnection/CalendarLink(per projekt), AutomationRule, AuditEvent, AISuggestion, AiPolicy(per workspace), Palette.**

**Tvrdá pravidla:**
- **R1 Hierarchie:** max 3 úrovně úkolů; checklist = lehká položka.
- **R2 Dokončování:** `single` / `shared_any` (kdokoli → hotovo) / `shared_all` (každý zvlášť, rodič odvozeně až všichni). U víc přiřazených se **ptáme na režim**.
- **R3 Podúkoly:** dokončení všech podúkolů **nedokončí** rodiče (ruční).
- **R4 Opakování:** výchozí od termínu; volba „od dokončení"; při změně nabídnout `tento / tento a další / celá řada`.
- **R5 Oprávnění:** workspace + projektové role (presety + custom), **row-level server-side**; host jen pozvané; restricted skryté.
- **R6 Barvy ≠ priorita:** barva samostatný atribut + palety; priorita sémantická.
- **R7 Štítky globální:** na úrovni účtu, napříč workspaces.
- **R8 Osobní prostor:** každý uživatel má soukromý workspace.

---

## 5. Funkce — Vzor + Naše řešení

### A. Jádro úkolů
- **[A1] Bohatý úkol** — *Vzor:* Todoist (název, popis, termín, priorita, štítky, přiřazení). *Naše:* totéž + deadline, duration, barva-akcent, `assignment_mode`. *MVP.*
- **[A2] Podúkoly + checklisty** — *Vzor:* Asana (podúkoly), ClickUp (checklisty v úkolu). *Naše:* 3 úrovně zanoření + lehké checklist položky pro SOP. *MVP.*
- **[A3] Více přiřazených** — *Vzor:* ClickUp (úkol více lidem). *Naše:* 3 režimy (single/shared_any/shared_all), při přiřazení se ptáme. *MVP.*
- **[A4] Přiřazení na roli/skupinu** — *Vzor:* týmové appky (přiřazení týmu). *Naše:* `@role` (Trenéři/Baristé) rozfázuje na členy. *v2.*
- **[A5] Vlastní pole** — *Vzor:* Asana (17 typů + vzorce), ClickUp. *Naše:* typovaná pole (text/číslo/výběr/datum/zaškrtávátko/vzorec) — podmnožina nejdřív. *v2.*
- **[A6] Vlastní statusy** — *Vzor:* ClickUp/Monday (statusy per list). *Naše:* jednoduché per projekt (To Do/Probíhá/Kontrola/Hotovo), à la Todoist, nepřekombinovat. *MVP.*
- **[A7] Typy úkolů** — *Vzor:* ClickUp (task types). *Naše:* definovatelné v nastavení (Lekce/Směna/Epizoda). *v2.*
- **[A8] Priority + barevný systém** — *Vzor:* Todoist (P1–P4) pro priority; barvy bere Notion/kalendáře líp. *Naše:* P1–P4 sémanticky (Akutní/Co nejdřív/Neakutní/Budoucnost) **oddělené** od barev; palety na projekt/štítek/status/úkol — first-class (lépe než Todoist). *MVP.*
- **[A9] Štítky** — *Vzor:* Todoist (průřezové štítky). *Naše:* **globální** napříč všemi workspaces. *MVP.*
- **[A10] Závislosti** — *Vzor:* Asana/ClickUp (blocking/blocked-by + šipky v Ganttu). *Naše:* závislost + jednoduchý Gantt. *v2.*
- **[A11] Milníky** — *Vzor:* Asana/Monday (milestone na timeline). *Naše:* milestone entita. *v2.*
- **[A12] Šablony s auto-datováním** — *Vzor:* Asana/ClickUp šablony, posun dat od kotvy. *Naše:* šablona s pravidly datování od kotevního data (Nová epizoda/ples/grant). *v2.*

### B. Datum, čas, opakování
- **[B1] Termín + start** — *Vzor:* Asana (start+due). *Naše:* due+start. *MVP.*
- **[B2] Deadline ≠ pracovní datum** — *Vzor:* Todoist (deadline odlišený). *Naše:* totéž, zřetelně (červeně). *MVP.*
- **[B3] Odhad délky** — *Vzor:* Todoist/ClickUp (estimate), Sunsama/Motion (pro time-block). *Naše:* duration (pro time-blocking, ne tracking). *MVP/v2.*
- **[B4] Opakování this/all** — *Vzor:* Google Calendar (tento/tento a další/všechny), Todoist (every vs every!). *Naše:* prompt this/this+future/all; výchozí od termínu, volba od dokončení. *MVP.*
- **[B5] Floating/fixed TZ** — *Vzor:* Todoist. *Naše:* totéž. *v3.*

### C. Pohledy
- **[C1] List/Board/Calendar** — *Vzor:* Trello/Asana (Board = sloupce drag&drop), univerzální List/Cal. *Naše:* všechny tři, přepínání per projekt. *MVP.*
- **[C2] Timeline/Gantt** — *Vzor:* Asana Timeline, ClickUp Gantt, Monday. *Naše:* Gantt se závislostmi. *v2.*
- **[C3] Workload/kapacita** — *Vzor:* Asana/ClickUp/Monday Workload (úsilí per osoba, přerozdělení). *Naše:* workload dle odhadů délky + nastavitelná kapacita/den. *v2.*
- **[C4] Table/grid** — *Vzor:* ClickUp Table / Notion / Airtable. *Naše:* editovatelná tabulka. *v2.*
- **[C5] Filtry** — *Vzor:* Todoist (dotazovací jazyk `&|!`, datumy, p1–p4). *Naše:* stejný jazyk + AI filtry česky. *MVP (jazyk) / v2 (AI).*

### D. Kalendář a plánování času
- **[D1] Obousměrný Google Kalendář** — *Vzor:* Google Calendar API (events + watch + sync token). *Naše:* per-projekt = vlastní kalendář, obousměrně, konflikt → ptát se. *MVP.*
- **[D2] Time-blocking** — *Vzor:* Sunsama/Motion/Akiflow (táhni úkol do kalendáře jako blok dle délky). *Naše:* drag úkol → blok dle duration. *v2.*
- **[D3] AI auto-scheduling** — *Vzor:* Motion (naplánuje den), Reclaim (brání focus), režimy Suggest/Auto. *Naše:* režim Suggest (dle AI spec „navrhnout"). *v2.*
- **[D4] Denní plánovací rituál** — *Vzor:* Sunsama (ráno/večer). *Naše:* volitelný denní plán. *v2.*
- **[D5] Universal inbox + command bar** — *Vzor:* Akiflow (Cmd+K, jeden inbox), Linear (palette). *Naše:* command bar + sjednocený inbox. *v2.*
- **[D6] Booking linky + buffery + travel** — *Vzor:* Motion/Calendly/Morgen. *Naše:* booking + rezervy + čas na cestu. *v3.*
- **[D7] Týmový/zdrojový kalendář** — *Vzor:* Monday/Asana. *Naše:* vytížení lidí na jednom plátně. *v2.*

### E. Připomínky a notifikace
- **[E1] Připomínky** — *Vzor:* Todoist (čas/relativní/opakované/lokační). *Naše:* totéž; výchozí offset per uživatel. *MVP.*
- **[E2] Eskalace** — *Vzor:* PM nástroje přes automatizace. *Naše:* po termínu → zodpovědný → vedoucí. *v2.*
- **[E3] Inbox + digest** — *Vzor:* Asana Inbox, Todoist; denní digest. *Naše:* notifikační inbox + digest per uživatel. *MVP.*
- **[E4] Víc kanálů** — *Vzor:* univerzální. *Naše:* push + e-mail (Slack/Teams vyřazeny). *MVP.*

### F. Spolupráce a komunikace
- **[F1] Komentáře + @mentions** — *Vzor:* univerzální. *Naše:* totéž (Yjs co-edit). *MVP.*
- **[F2] Přílohy + verze + hlasovky** — *Vzor:* Todoist (hlasovky/přílohy), verze. *Naše:* přílohy + verze + hlasové poznámky. *MVP.*
- **[F3] Schvalování** — *Vzor:* Asana/Monday (approval). *Naše:* sign-off před „hotovo". *v2.*
- **[F4] Proofing** — *Vzor:* Asana (anotace do obrázku/PDF → úkol). *Naše:* komentáře do grafiky → úkol. *v2.*
- **[F5] Chat** — *Vzor:* ClickUp/Monday. *Naše:* vestavěný chat (volitelně; máte Slack). *v2/could.*
- **[F6] Feed aktivity** — *Vzor:* univerzální. *Naše:* živý feed. *MVP/v2.*

### G. Týmy, role, oprávnění
- **[G1] Workspaces** — *Vzor:* ClickUp Spaces/Asana teams/Notion. *Naše:* uživatelsky tvořené workspaces (generické). *MVP.*
- **[G2] Role + oprávnění** — *Vzor:* Todoist (workspace + projektové role), Asana. *Naše:* presety + **vlastní role** (v2), row-level. *MVP/v2.*
- **[G3] Restricted projekty** — *Vzor:* Todoist restricted/Monday private. *Naše:* restricted viditelnost. *MVP.*
- **[G4] Hosté + lehký režim** — *Vzor:* Todoist guests; klientské portály. *Naše:* role host + lehký režim (základ MVP, plný portál později). *MVP základ.*
- **[G5] SSO/SCIM** — *mimo rozsah.*

### H. Automatizace
- **[H1] Pravidla if-this-then-that** — *Vzor:* Asana Rules / Trello Butler / Monday. *Naše:* builder trigger→podmínka→akce. *v2.*
- **[H2] Vícekrokové workflow** — *Vzor:* ClickUp/Asana. *Naše:* řetězce akcí. *v3.*
- **[H3] Formuláře (intake)** — *Vzor:* Asana Forms / Monday WorkForms (větvení). *Naše:* formulář → úkol (přihlášky/objednávky). *v2.*
- **[H4] Plánované akce** — *Vzor:* Trello Butler (scheduled), auto-archivace. *Naše:* plánované/opakované automatizace. *v2.*

### I. Reporting, cíle
- **[I1] Dashboardy** — *Vzor:* ClickUp/Monday (widgety agregující boardy). *Naše:* widget dashboardy. *v2.*
- **[I2] Cíle/OKR** — *Vzor:* Asana Goals/ClickUp (laddering). *Naše:* cíle navázané na úkoly. *v3/could.*
- **[I3] Time tracking** — *vyřazeno.*
- **[I4] Portfolio** — *Vzor:* Asana Portfolios/Monday. *Naše:* cross-workspace přehled. *v3/could.*
- **[I5] Statistiky spolehlivosti** — *Vzor:* (Todoist Karma je gamifikace). *Naše:* manažerské statistiky (throughput, úzká hrdla). *could.*

### J. Dokumenty a znalosti
- **[J1] Docs/wiki** — *Vzor:* ClickUp Docs/Notion/Monday WorkDocs (propojené s úkoly). *Naše:* docs/wiki vázané na úkoly (SOP/playbooky). *v2.*
- **[J2] Databáze + relace** — *Vzor:* Notion (relace/rollupy). *Naše:* relační databáze. *v3.*
- **[J3] Whiteboard** — *Vzor:* ClickUp/Monday/Notion. *Naše:* whiteboard. *v3.*

### K. AI
- **[K1] AI quick add CZ** — *Vzor:* Todoist NL quick add (nově i CZ) + symboly. *Naše:* Claude-parsování české věty + symboly, náhled k potvrzení; **filtry česky** (Todoist neumí). *MVP (quick add) / v2 (filtry).*
- **[K2] AI sumarizace** — *Vzor:* Asana/ClickUp Brain/Monday. *Naše:* souhrny vlákna/standup. *v2.*
- **[K3] AI rozpad úkolu** — *Vzor:* ClickUp/Asana AI. *Naše:* rozpad na podúkoly. *v2.*
- **[K4] AI digest** — *Vzor:* vlastní. *Naše:* ranní „co dnes řešit". *MVP základ / v2 chytrý.*
- **[K5] AI agenti** — *Vzor:* Motion AI Employees/ClickUp Brain agents. *Naše:* agenti dle AI spec (transparentní, přes návrh→akce). *v3.*

### L. Integrace a platforma
- **[L1] Integrace** — *Vzor:* všichni (Google/Slack/…). *Naše:* Google Workspace první, víc později. *MVP/v2.*
- **[L2] E-mail → úkol** — *Vzor:* Todoist (adresa projektu)/Asana. *Naše:* odloženo (přeposílání nebo Gmail/Graph/IMAP). *později.*
- **[L3] API + webhooky** — *Vzor:* Todoist Sync/REST + webhooky. *Naše:* REST + webhooky (AdamOS/iDoklad). *v2.*
- **[L4] Import** — *Vzor:* ClickUp/Notion (one-click importery). *Naše:* volitelně později (čistý start). *později.*

### M. Mobilita a synchronizace
- **[M1] PWA offline** — *Vzor:* instalovatelné PWA. *Naše:* PWA jádro (telefon/tablet). *MVP.*
- **[M2] Nativní appky** — *Vzor:* Todoist/všichni. *Naše:* iOS/Android. *v3.*
- **[M3] Offline-first sync** — *Vzor:* Todoist (command-based). *Naše:* PowerSync local-first + Yjs. *MVP.*
- **[M4] Real-time** — *Vzor:* Monday/Notion. *Naše:* PowerSync real-time + Yjs. *MVP.*

### N. Základy a provoz
- **[N1] Globální hledání** — *Vzor:* Linear/ClickUp Command Center. *Naše:* fulltext + filtry napříč. *MVP.*
- **[N2] Hromadné akce** — *Vzor:* univerzální multi-select. *Naše:* hromadná editace/přesun. *MVP.*
- **[N3] Klávesové zkratky + palette** — *Vzor:* Linear/Superhuman/Todoist. *Naše:* zkratky + command palette. *MVP/v2.*
- **[N4] Tmavý režim** — *Vzor:* univerzální. *Naše:* dark mode. *v2.*
- **[N5] Zálohy + export** — *Vzor:* Todoist (zálohy/export). *Naše:* automatické zálohy + export. *MVP.*
- **[N6] Audit log** — *Vzor:* Asana/enterprise audit. *Naše:* audit s diffem. *MVP.*
- **[N7] 2FA** — *Vzor:* univerzální (TOTP). *Naše:* dobrovolné 2FA. *MVP.*

---

## 6. AI chování (shrnutí)

Vyvážený, transparentní profil (viz `AI_chovani_spec.md`): **nic neběží potají**. `Navrhnout` → návrh ke schválení; `Auto+info` → provede, upozorní, jde vrátit; sensitivní akce vypnuté (C2, D2). Tvrdé mantinely vždy: AI **nikdy** nemaže úkoly, nepíše externím, nemění oprávnění; tiché hodiny (noc+víkend); povinné undo; audit všeho; konfiguruje admin/manager; per workspace.

---

## 7. Cross-platform a responsivita

- **Jeden web (React+Vite), responzivní:** telefon (1 sloupec, spodní navigace, palcem dosažitelné akce, swipe na dokončení/odložení — *vzor* Todoist mobil), tablet (2-sloupcový split: seznam + detail — *vzor* Things/Asana iPad), počítač (sidebar + seznam + detail panel — *vzor* Linear/Todoist desktop).
- **PWA:** instalovatelná, offline, Web Push, app ikona; *vzor:* moderní PWA appky.
- **Desktop:** Tauri obal stejného webu, globální zkratka pro quick add (*vzor:* Todoist desktop), systémové notifikace.
- **Dotyk i klávesnice:** velké touch targety na mobilu; plná klávesová obsluha + command palette na PC.
- **Nativní mobil (v3):** widgety, lepší push, sdílecí rozšíření.

---

## 8. Kde nám to utíká (mapa rizik)

**Vysoká závažnost (kvalitativní laťka MVP):**
- **Zralost offline syncu + konflikty** — Todoist ladí roky; náš bude hrubší, souběžné offline editace pečlivě testovat (ztráta úkolu = ztráta důvěry).
- **Kvalita PWA na telefonu/tabletu** — nativní appky až v3, takže PWA musí být opravdu dobrá pro terénní lidi.
- **Spolehlivost opakování a připomínek.**

**Střední:**
- **Per-projekt Google kalendáře ve velkém** — hodně projektů = hodně kalendářů + watch kanálů + token lifecycle; hlídat limity a deduplikaci smyček.
- **Šíře integrací** (oni stovky, my pár).
- **Reporting/automatizace/formuláře à la Asana** (jen základ ve v2).
- **WYSIWYG + offline CRDT editace** je netriviální kombinace.
- **Vlastní role** přidávají složitost oprávnění.
- **AI infra** — latence a náklady na parsování/digesty.

**Nízká / vědomě vynecháno:**
- Notion-class databáze/relace (v3), SSO/SCIM/compliance (mimo), desítky jazyků (CZ/EN), provozní vyladěnost a uptime track record (nový systém → zálohy/monitoring povinné).

> Princip: investovat do odlišení (čeština/AI, barvy, dva režimy přiřazení, kalendář, vlastní data, plochá cena), mezery jinde přijmout, tři vysoce rizikové oblasti držet jako laťku kvality.

---

## 9. Fázování

- **MVP:** účty (4 metody)+2FA · workspaces/role(presety)/restricted/host-základ · úkoly (3 vrstvy, checklisty, 2 režimy přiřazení, statusy, priority, **barvy**, štítky globální) · due/start/deadline/opakování this-all · List/Board/Calendar · filtry (jazyk) · **Google Cal obousměrně po projektech** · připomínky · inbox+digest · komentáře/@mentions · přílohy/verze/hlasovky · **AI quick add CZ** + základní digest · offline-first sync + real-time · PWA · fulltext · hromadné akce · audit · zálohy/export · i18n CZ/EN · responzivní telefon/tablet/PC.
- **v2:** závislosti · milníky · šablony+auto-datování · custom fields · task types · Gantt · workload · table · time-blocking · Apple kalendář · command bar · denní rituál · eskalace · schvalování · proofing · feed · chat · pravidla · formuláře · dashboardy · docs/wiki · AI (filtry CZ, sumarizace, rozpad, chytrý digest, auto-scheduling Suggest) · API/webhooky · vlastní role · desktop (Tauri) · dark mode · **vlastní role**.
- **v3:** AI agenti · vícekrokové workflow · OKR · portfolio · booking · databáze+relace · whiteboard · nativní mobil · floating/fixed TZ · Lucky OS (až bude) · e-mail→úkol.

---

## 10. Co ještě potřebujeme rozhodnout (→ další dotazník)

Jádro je popsané, ale pro plnou stavbu „se vším" je potřeba dořešit hloubku některých funkcí a finalizaci. Na to navazuje **další dotazník** (`konfigurator_detaily.html`): typy vlastních polí, forma automatizací, priorita dashboard widgetů, rozsah docs/wiki, potřeba whiteboard/OKR/formulářů, základ workloadu, opakování „od dokončení" timing, hlasovky, tablet split-view, rozsah offline, rozsah globálního hledání, priorita zkratek/palette, barevné palety, jazyk při startu, přístupnost, granularita notifikací, a **název + tón identity**.

---

## 11. Zpřesnění z dotazníku detailů (závazné)

> Tato sekce zpřesňuje rozhodnutí výše. **Kde se liší od dřívějších defaultů, má přednost tato sekce.**

**Hloubka funkcí**
- **Vlastní pole (v2):** typy **Text, Číslo, Výběr (dropdown), Datum, Zaškrtávátko, Odkaz/URL, Osoba**. *Vzorce zatím ne* (později).
- **Automatizace (v2):** **obojí** — vizuální builder *i* přednastavené šablony pravidel.
- **Dashboardy (v2):** widgety — **úkoly dle stavu, blížící se termíny, hotovo za období, aktivita týmu, graf priorit, vytížení lidí** (všech 6).
- **Docs/wiki (v2):** **jednoduché poznámky propojené s úkoly** (NE plný Notion). Drží to scope malý.
- **Whiteboard: VYŘAZENO** ze scope.
- **Cíle / OKR: ANO** → zařadit do **v2** (navázané na úkoly).
- **Formuláře pro příjem: možná** → ponechat jako volitelné v2.
- **Workload (v2):** kapacita **podle počtu úkolů** (ne podle hodin — jednodušší; sedí na to, že time tracking je vyřazen).
- **Opakování „od dokončení" (every!):** **v2** (MVP = jen od termínu; přepínač per úkol přidat v2).
- **Hlasové poznámky: možná** → volitelně v2.

**Platforma a UX**
- **Tablet: vlastní rozložení (split-view)** — seznam + detail vedle sebe, ne jen responzivní zmenšenina. *Vzor:* Things/Asana na iPadu. Povyšuje cross-platform požadavek.
- **Offline: VŠE (čtení i zápis)** bez signálu — potvrzuje offline-first jako tvrdou laťku.
- **Globální hledání: napříč vším** (výchozí).
- **Klávesové zkratky + command palette: střední priorita** → základní zkratky v MVP, plná palette v2.
- **Barevné palety: pár kurátorských + vlastní hex.**
- **Jazyk: CZ + EN HNED** (změna oproti dřívějšímu „EN později") → **plná i18n CZ+EN už v MVP**.
- **Přístupnost: solidní základ** (viditelný focus, kontrast, klávesnice; ne formální WCAG audit teď).
- **Notifikace — granularita (v2):** **ztlumit projekt, ztlumit úkol, jen @zmínky, souhrny místo jednotlivých** — vše podporovat.

**Dopady na fázování:** do **MVP** přibývá **plná EN lokalizace** a **tablet split-view**; do **v2** přibývají **OKR**, **dashboard se 6 widgety**, **vlastní pole (7 typů)**, **workload dle počtu úkolů**, **automatizace (builder+presety)**, **jednoduché docs/poznámky**, **granularita notifikací**. **Whiteboard** mizí ze scope úplně.

**Finalizace:** název i tón identity → **navrhuji** (samostatný výstup `identita_navrhy.html`).

---

## 12. Revize — finální rozhodnutí (mají přednost)

> Výsledek auditu (`REVIZE_nejasnosti_a_rizika.md`). **Tato sekce má přednost před vším výše.**

- **CRDT / text [S2]:** v MVP **bez CRDT**. Popisy i komentáře = **prostý Markdown přes PowerSync** (LWW). Yjs až s kolaborativními docs (v2).
- **Stav ↔ dokončení [R-E]:** **provázané** — zaškrtnutí úkolu a přesun do stavu „Hotovo" (`is_done`) se nastavují navzájem.
- **Štítky [R-D]:** **globální pro interní tým, ale skryté hostům.**
- **Výchozí režim přiřazení (automatizace/AI/hromadně) [R-F]:** **`shared_all`** (každý zvlášť). Interaktivně se stále ptáme.
- **Role [H3]:** **bohatší přednastavené role, BEZ plně vlastních rolí** (jednodušší, stabilní vůči sync enginu). *Mění dřívější „custom role ve v2".*
- **Offline soubory [H2]:** úkoly a text offline; **přílohy a hlasovky vyžadují připojení**.
- **Per-projekt kalendář [S1]:** **jeden sdílený Google kalendář na projekt** v **týmovém Google Workspace účtu**, který kalendáře vlastní; členové ho vidí.
- **Kalendář v MVP [S1/B2]:** **jednodušší** — Watson→Google (úkoly s termínem jako události) + čtení událostí do pohledu; **plná obousměrná editace a řešení konfliktů až v2.**
- **Tiché hodiny AI [R-A]:** **per workspace** (kavárna/studio/podcast jinak než „kancelářské" projekty).
- **Quick add offline [R-B]:** **lokální parser** (`#`, `@`, `p1–p4`, datum) funguje offline; AI doplní/upřesní po připojení.
- **Quick add [R-C]:** AI vyplní rozpoznané atributy, uživatel je vidí a **potvrdí před uložením** (náhled).
- **Osekání MVP [S4]:** **verzování příloh a hlasovky → v2** (v MVP jen základní přílohy, online). Tablet split-view a všechny metody přihlášení **zůstávají** v MVP.
- **iDoklad [N2]:** **VYŘAZEN** ze scope.

**Vyřešeno mnou (zapsáno jako pravidla):** opakování × režim přiřazení = při dalším výskytu **reset všech per-osoba dokončení**; **hledání i AI akce procházejí kontrolou oprávnění** a respektují ztlumení/tiché hodiny; **brass** jen akcenty/velké prvky, text v tmavším odstínu (#A8722E)/navy; **MVP jedno časové pásmo** (Europe/Prague); **priorita = nebarevný odznak P1–P4** (nezávislý na barvě); v kódu rozlišit „dokončení dle spoluřešitelů" vs „roll-up podúkolů" — **podúkoly NIKDY nedokončí rodiče**.
