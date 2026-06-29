# Funkční specifikace v2 — *build-ready* (zadání pro Claude Code)

> Tato verze nahrazuje v1. Cíl: aby podle ní šlo aplikaci **reálně postavit**. U každé oblasti je **Pointa** (proč to existuje a proč takto), zpřesněný **datový model + business pravidla**, **akceptační kritéria** (definition of done) a **inženýrské konvence**. Doprovodný soubor `porovnani_todoist_notion_asana.md` řeší, kde dorovnáme/zaostáváme.

---

## 0. Jak číst tuto spec (pro Claude Code)

- **Stavíme po fázích.** Implementuj striktně v pořadí Fáze 1 → 2 → 3 (§7). Nezačínej funkce z vyšší fáze, dokud není hotová definition of done té nižší.
- **Defaulty jsou závazné.** Kde je uvedeno „**Default:**", použij to bez doptávání. Kde je „**ROZHODNUTÍ:**", je to otevřené (§11) — ale je u toho default, kterým lze pokračovat, aby stavba nebyla blokovaná.
- **Pointa = důvod.** Sekce „Pointa" vysvětlují záměr; když se rozhoduješ v detailu, řiď se pointou, ne doslovným zněním.
- **Business pravidla jsou nepřekročitelná.** Pravidla v §5 a §6 (dokončování úkolů, opakování, oprávnění, barvy) musí platit přesně — jsou to invarianty, ne návrhy.

### Inženýrské konvence (platí všude)
- **TypeScript strict** end-to-end; žádné `any` bez komentáře proč.
- **Monorepo** (pnpm + Turborepo). Struktura v §12.
- **Sdílené typy a schéma** v `packages/*`, ne kopírované mezi FE/BE.
- **Validace** vstupů přes **Zod**; stejné schéma sdílet FE↔BE.
- **i18n od začátku** (i18next): žádné natvrdo zadané řetězce v UI; klíče `oblast.vec`. Výchozí jazyk **cs**, plně i **en**.
- **Migrace DB** verzované (Drizzle); nikdy neměnit schéma ručně.
- **Server je autorita.** Oprávnění a citlivá logika se vynucují na serveru / v sync vrstvě (row-level), nikdy jen v UI.
- **Testy:** unit pro business pravidla (§5/§6), integrační pro sync a kalendář. Každé akceptační kritérium = aspoň jeden test.
- **Feature flags** pro rozpracované věci, ať jde MVP nasadit průběžně.

---

## 1. Vize a rozsah

Vlastní náhrada Todoistu „se vším všudy": **úkoly + projekty + kalendář + týmová spolupráce**, offline-first, s maximální synchronizací a obousměrným kalendářem.

**Core kontexty (prioritní):** Shuffle (Café, Food Truck, Store, Care, Talk Studios) · T-Group Dance Studio (+ externí **Lucky OS**) · Midichlorian.
**Nepovinné (mohou být jako workspace, ne jako jádro):** Ježci Jihlava, Club Vision.

**Pointa:** Rozsah je obrovský; proto musí být jasné, co je jádro (na čem appka stojí a co se testuje první) a co je „smí být". Bez tohoto ohraničení se MVP rozplyne.

---

## 2. Produktové principy

1. **Offline-first, ne offline-jako-bonus.** *Pointa:* tohle je hlavní důvod, proč to stavíme sami a hlavní technické riziko; každé čtení/zápis lokálně, sync na pozadí.
2. **Jednoduchost à la Todoist.** *Pointa:* bohatost funkcí nesmí zničit rychlost a čistotu UI; statusy/typy se nepřekombinovávají (výslovné přání).
3. **Česky first, včetně AI.** *Pointa:* parsování české věty a české filtry jsou konkurenční výhoda — Todoist české filtry neumí.
4. **Barvy = samostatné velké téma.** *Pointa:* uživatelům Todoistu chybí grafické možnosti; barva je oddělená od priority a je first-class už v MVP (§5.4).
5. **AI jako asistent, eskaluje v čase.** *Pointa:* autopilot odrazuje; začínáme „navrhni → schválím", autonomie až po zralém jádru.
6. **Klávesnice a rychlost.** *Pointa:* power-use; command bar, hromadné akce, zkratky.

---

## 3. Technologický stack (s důvody)

**Default celého stacku (postupuj podle něj, pokud nebude řečeno jinak):**

| Vrstva | Volba (Default) | Pointa (proč) |
|---|---|---|
| Jazyk | TypeScript všude | jeden jazyk → sdílené typy, méně chyb, lépe pro Claude Code |
| Monorepo | pnpm + Turborepo | sdílení schématu/UI mezi web/desktop/api |
| Frontend | React + Vite + PWA, Tailwind, TanStack Query/Router, i18next | instalovatelné, offline, CZ/EN |
| Desktop | Tauri (obaluje web build) | jeden codebase, lehčí než Electron |
| **Sync engine** | **Postgres + PowerSync** *(ROZHODNUTÍ: alt. Triplit)* | offline-first replikace + real-time nad Postgresem; nejtěžší část řeší ověřená knihovna |
| Real-time text (komentáře/docs) | Yjs (CRDT) + PartyKit | bezkonfliktní co-editace |
| Backend/API | Hono (Node/Bun) | tenké endpointy: AI, integrace, webhooky, workery |
| ORM/DB | Postgres + Drizzle | typové schéma + migrace |
| Auth | Better Auth | self-hostovatelné; email+heslo, Google, Apple, magic link, 2FA, týmy |
| Fronta úloh | BullMQ + Redis | digesty, eskalace, calendar sync, AI běhy |
| Soubory | S3-kompatibilní (R2 / MinIO) | přílohy + verze |
| AI | Anthropic Claude API (Sonnet+Haiku) | parsování CZ, filtry, sumarizace, agenti |
| Notifikace | Web Push (VAPID) + e-mail (Resend) + Slack | multikanál |

**Pointa k volbě sync enginu:** Tohle je nejdůležitější technické rozhodnutí. PowerSync/Electric dávají Postgres (vlastnictví dat, zralost) + offline. Triplit je all-in-one (rychlejší start, méně dílů), ale mladší. *Default = PowerSync*; pokud tým chce co nejrychleji MVP a je ochoten obětovat kontrolu, přepni na Triplit — ale rozhodni před Fází 1, protože to prostupuje celý kód.

---

## 4. Architektura (s kontrakty)

### 4.1 Sync jádro (offline-first) — *srdce appky*
- Klient drží **lokální DB** (SQLite/WASM nebo IndexedDB dle enginu). Čtení i zápis nejdřív lokálně → okamžitá odezva; engine replikuje obousměrně s Postgresem inkrementálně a real-time.
- **Offline fronta:** zápisy bez sítě se ukládají a po připojení dosynchronizují.
- **Konflikty:** strukturovaná data = last-write-wins na úrovni pole + serverová autorita; souběžně editovaný text = **CRDT (Yjs)**. *Per-entitu určit strategii a zdokumentovat.*
- **Identita:** klient generuje **UUID** lokálně (umožní offline tvorbu a vztahy mezi ještě nesynchronizovanými objekty).
- **Pointa:** Cílem je, aby appka byla plně použitelná v tramvaji bez signálu a po připojení se „rozplynula" do ostatních klientů bez ztráty dat. Pokud tohle nefunguje, nemá zbytek smysl — proto se to staví a testuje jako úplně první vertikální průřez (§12).

### 4.2 Autentizace a model týmů
- **Better Auth**: email+heslo, Google, Apple, magic link, **2FA (TOTP)**.
- **Workspace = tým/kontext.** Uživatel je členem více workspaců s různou rolí. Hosté = omezený záběr.
- **Pointa:** Kontextů je 8+; oddělené workspaces drží data i oprávnění čistě a umožní hosty (rodiče/klienti) bez rizika, že uvidí cizí věci.

### 4.3 Kalendář (obousměrně)
- **Google (Default, Fáze 1):** OAuth; čtení událostí + zápis úkolů jako událostí; změny přes Google *watch* webhooky, fallback periodický sync worker; **mapovací tabulka úkol↔událost** drží párování a brání duplicitám.
- **Apple iCloud (Fáze 2):** CalDAV obousměrně + read-only ICS odběr jako „klasická" varianta.
- **Pointa:** Kalendář je tvoje výslovná priorita — lidé chtějí vidět tréninky, směny i úkoly na jednom místě. Obousměrnost je náročná (deduplikace, smyčky změn), proto jen Google v MVP a Apple až potom.

### 4.4 AI vrstva
- Tenká služba nad Claude API na **backendu** (klíče nikdy na klientu); asynchronní úlohy přes frontu. Detaily a fázování §10.

### 4.5 Notifikace a workery
- Web Push + e-mail + Slack. Workery: připomínky, **eskalace**, denní digest, calendar sync, AI běhy, automatizační pravidla.

---

## 5. Datový model + business pravidla

Kompaktně entity (Postgres/Drizzle). U netriviálních věcí jsou **pravidla** — ta musí platit přesně.

### Entity (výběr polí)
- **User**(id, name, email, locale, twofa_enabled, …)
- **Workspace**(id, name, context_type, color, is_core)
- **Membership**(user_id, workspace_id, role:`admin|member|guest`)
- **Project**(id, workspace_id, name, color, icon, default_layout, visibility:`team|restricted`)
- **ProjectMember**(project_id, user_id, role:`manager|editor|commenter`)
- **Section**(id, project_id, name, position)
- **Status**(id, scope_project|scope_workspace, name, color, position, is_done)
- **Task**(id, project_id, section_id, **parent_id**, name, description, **priority**:1–4, **color?**, due_date?, start_date?, **deadline?**, duration_min?, **recurrence?**, **assignment_mode**:`single|shared_any|shared_all`, status_id, created_by, **completed_at?**)
- **Assignment**(task_id, user_id, **completed_at?**)
- **ChecklistItem**(id, task_id, text, checked, position)
- **Label**(id, workspace_id, name, color) + **TaskLabel**(task_id, label_id)
- **Reminder**(id, task_id, user_id, type:`time|relative|recurring|location`, when, channel)
- **Comment**(id, task_id, author_id, body_yjs, created_at) + **Mention**(comment_id, user_id)
- **Attachment**(id, task_id?|comment_id?, url, version, mime, size)
- **Filter**(id, owner_scope, name, query)
- **Template**(id, scope, structure_json, anchor_date_rules) — v2
- **CustomField**(def) + **CustomFieldValue**(task_id, field_id, value) — v2
- **TaskType**(id, workspace_id, name, config) — v2
- **Dependency**(task_id, blocks_task_id) — v2
- **Milestone**(id, project_id, name, date) — v2
- **CalendarConnection**(id, user_id, provider, tokens, mapping) + **CalendarLink**(task_id, provider, external_event_id)
- **AutomationRule**(id, workspace_id, trigger, conditions, actions) — v2
- **AuditEvent**(id, workspace_id, actor_id, entity, action, diff_json, ts)
- **AISuggestion**(id, type, entity_ref, payload, status:`pending|accepted|dismissed`)
- **Palette**(id, owner_scope, name, colors[])

### Business pravidla (invarianty)
**R1 — Hierarchie úkolů (A2):** `parent_id` smí mít max hloubku **3** (úkol → podúkol → pod-podúkol). Hlubší zanoření odmítnout (validace). `ChecklistItem` je lehká položka (bez přiřazení/termínu), nezaměňovat s úkolem.

**R2 — Dokončování dle `assignment_mode` (A3):**
- `single`: `Task.completed_at` se nastaví, když dokončí jediný řešitel.
- `shared_any` (jednorázové): dokončení kýmkoli nastaví `Task.completed_at` → hotovo pro všechny.
- `shared_all` (separátní): každý `Assignment.completed_at` se nastavuje zvlášť; **`Task.completed_at` je odvozené — vyplní se teprve, když mají všechny Assignment vyplněné `completed_at`.** UI ukazuje per-osobu stav (např. 3/5). Reopen jednoho člena zruší i případné dokončení úkolu.
- *Pointa:* tohle je tvůj klíčový rozdíl proti Todoistu — „kdokoli to vyřeší" vs. „musí každý". Implementuj jako tři jasné stavy, ne jako hack.

**R3 — Opakování „tento / celá řada" (B4):** Při editaci rozvrhu/detailu opakovaného úkolu **vždy** nabídnout scope: `this_occurrence | this_and_future | all`. Podpora opakování od termínu i **od dokončení** (`every!`). Nikdy tiše nepřeskočit výskyty; když je úkol po termínu, ukázat to a nechat uživatele rozhodnout. *Pointa:* opravuje hlavní Todoist footgun (pozdní dokončení posune o rok).

**R4 — Oprávnění:** Workspace role gatuje workspace akce; `ProjectMember` role gatuje akce v projektu; **guest** vidí jen pozvané projekty; **restricted** projekt je neviditelný pro nečleny. Vynucovat **server-side / row-level** v sync vrstvě, ne jen v UI. *Pointa:* hosté (rodiče/klienti) nesmí nikdy zahlédnout cizí data — jinak je celá týmová vrstva nedůvěryhodná.

**R5 — Barvy oddělené od priority (A8):** `priority` (1–4) **nikdy** neimplikuje barvu. Barva je samostatný atribut na Project/Label/Status/Task a řídí se paletami. *Pointa:* přesně to, co Todoistu chybí.

**R6 — Datum vs. deadline (B2):** `due/start_date` = kdy se plánuje pracovat; `deadline` = dokdy musí být hotovo (zobrazit zřetelně, např. červeně). Filtr „po termínu" zohledňuje obojí.

---

## 6. Klíčové funkční detaily (rozpitvané + akceptace)

### 6.1 Quick add v češtině (K1) — signaturní
- Pole, kam uživatel napíše větu: `„Odeslat report zítra 15:00 každý pátek #Café p1 @čekání"`. Parser (Claude) vrátí strukturovaný úkol: datum+čas, opakování, projekt, štítek, priorita.
- **Default chování:** parsování běží přes backend AI endpoint; UI ukáže rozpoznané atributy k potvrzení (chip náhled). Symboly `#` projekt, `@` štítek, `p1–p4`, `!` připomínka, `{}` deadline jako fallback bez AI.
- **Akceptace:** česká věta s datem, opakováním, projektem a prioritou se správně rozloží; uživatel vidí a může opravit rozpoznané hodnoty před uložením.
- *Pointa:* tohle je hlavní „wow" a odlišení; musí fungovat česky spolehlivě.

### 6.2 Barevný systém (A8)
- Barva na Project/Label/Status/Task(akcent); **palety** (kurátorské + vlastní hex) v nastavení; barevné bloky v kalendáři.
- **Akceptace:** uživatel založí vlastní paletu, obarví projekt i štítek, a kalendář to reflektuje; priorita zůstává barevně nezávislá.

### 6.3 Statusy a typy úkolů (A6/A7)
- Statusy: jednoduché per projekt; default sada (To Do/Probíhá/Ke kontrole/Hotovo). Typy úkolů: definovatelné v nastavení, **až v2**, nejsou core.

### 6.4 Hosté a lehký režim (G4)
- Guest = omezený přístup; **lehký režim** ukáže rodiči jen relevantní výřez (dítě: docházka, co přinést, platby). *Pointa:* otevírá appku rodičům/klientům bez zahlcení a bez úniku dat.

### 6.5 Pohledy (C1/C5)
- List, Board (sekce=sloupce, drag&drop), Calendar; uložené filtry jako živé pohledy napříč projekty. Dotazovací jazyk filtrů s operátory `&|!`, závorkami, datumy, `p1–p4`, štítky, přiřazení.

---

## 7. Fázový plán + Definition of Done

> **Princip:** Fáze 1 = sama o sobě denně použitelná appka. Tvoje „v2+" položky jsou ve v2/v3; „nepotřeba" (G5 SSO/SCIM) je mimo rozsah.

### ▶ FÁZE 1 — MVP
**Funkce:** účet (email+heslo, Google, magic link) + 2FA · workspaces (G1) · role/oprávnění (G2) · restricted (G3) · hosté + lehký režim (G4) · úkoly (A1) · 3 vrstvy + checklisty (A2) · **dva režimy přiřazení (A3)** · statusy (A6) · priority (A8) · **barvy v základu (A8)** · štítky (A9) · due+start (B1) · deadline (B2) · opakování this/all (B4) · List/Board/Calendar (C1) · filtry (C5) · **Google Calendar obousměrně (D1)** · připomínky (E1) · inbox+digest (E3) · komentáře+@mentions (F1) · přílohy+verze (F2) · **AI quick add CZ (K1)** · offline-first sync (M3) · real-time (M4) · PWA (M1) · fulltext (N1) · hromadné akce (N2) · audit log (N6) · zálohy/export (N5) · i18n CZ/EN.

**Definition of Done (testovatelné):**
1. Přihlášení 3 způsoby + 2FA; vznik workspace/projekt; pozvání člena i hosta s různými právy; restricted projekt je pro nečleny neviditelný.
2. Quick add v češtině správně rozloží datum/opakování/projekt/prioritu a nechá potvrdit.
3. Oba režimy přiřazení (`shared_any`, `shared_all`) se chovají dle R2 (per-osoba progres u `shared_all`).
4. Offline změna se po připojení dosynchronizuje; dva klienti vidí změny v real-time bez ztráty dat.
5. Úkol s termínem se objeví v Google Kalendáři; změna v GCal se promítne zpět, bez duplicit.
6. List/Board/Calendar, uložený filtr, fulltext, hromadná akce, připomínka, komentář s @zmínkou a přílohou — vše funkční.
7. PWA jde nainstalovat a funguje offline; audit log zaznamenává změny; export dat funguje.
8. UI je kompletně v CZ i EN.

### ▶ FÁZE 2 — v2
Závislosti (A10) · milníky (A11) · **šablony s auto-datováním (A12)** · custom fields (A5) · task types (A7) · Gantt (C2) · **Workload (C3)** · Table (C4) · **time-blocking (D2)** · zdrojový kalendář (D7) · **Apple CalDAV** · command bar (D5) · denní rituál (D4) · **eskalace (E2)** · multikanál (E4) · schvalování (F3) · proofing (F4) · feed aktivity (F6) · chat (F5) · **pravidla (H1)** · formuláře (H3) · plánované akce (H4) · dashboardy (I1) · **time tracking (I3)** · spolehlivost (I5) · docs/wiki (J1) · **AI: sumarizace (K2), rozpad (K3), digest (K4), auto-scheduling Suggest (D3)** · integrace (L1) · **email→úkol (L2)** · **API/webhooky (L3)** · **import (L4)** · **Lucky OS** · desktop (Tauri) · **dark mode (N4)**.
**DoD (zkráceně):** opakovatelné procesy (šablony+auto-datování), týmové plánování (workload+Gantt), reporting (dashboard+time tracking), automatizace (pravidla+formuláře), Apple kalendář, AI asistence v režimu „navrhni", desktop appka a Lucky OS napojení fungují.

### ▶ FÁZE 3 — v3
**AI agenti (K5)** + auto-scheduling **Auto** + proaktivní priority/termíny · vícekrokové workflow (H2) · OKR (I2) · portfolio (I4) · booking (D6) · databáze s relacemi (J2) · whiteboard (J3) · **nativní iOS/Android (M2)** · floating/fixed TZ doladění (B5).
**Mimo rozsah:** SSO/SCIM (G5).

---

## 8. Integrace (kontrakty + otevřené body)

- **Google Calendar** — obousměrně, Fáze 1 (watch webhooky + mapovací tabulka).
- **Apple iCloud** — CalDAV obousměrně + ICS odběr, Fáze 2.
- **Lucky OS** — napojení kvůli T-Group; **ROZHODNUTÍ/blokující: chybí API a dokumentace Lucky OS.** Bez nich neumíme navrhnout integraci. Určit, co se synchronizuje (úkoly / klienti / rozvrhy) a směr toku.
- **Spark / e-mail → úkol** — unikátní adresa projektu, příchozí parsování, Fáze 2.
- **iDoklad** — fakturace/granty přes API, zvážit v2/v3.
- **Slack** — notifikace, Fáze 2.
- **Vlastní API + webhooky** — pro AdamOS/automatizace, Fáze 2.

---

## 9. Nefunkční požadavky (měřitelně)

- **i18n:** CZ default, EN plně; 0 natvrdo zadaných řetězců.
- **Výkon:** lokální čtení < ~16 ms; optimistické UI; sync na pozadí; aplikace použitelná offline.
- **Bezpečnost:** TLS, šifrování v klidu, 2FA, row-level oprávnění, izolace workspaců, secrets jen server-side.
- **Zálohy/export:** automatické zálohy DB + uživatelský export (N5).
- **Audit:** každá změna → AuditEvent s diffem (N6).
- **Přístupnost:** viditelný focus, reduced-motion, kontrast.
- **PWA/desktop:** instalovatelnost, offline, Web Push; Tauri build ze stejného kódu.

---

## 10. AI vrstva (jak + fázování)

- **Fáze 1:** Quick add CZ (parsování přes Claude, návrh k potvrzení) + jednoduchý denní digest.
- **Fáze 2:** filtry z české věty · sumarizace (úkol/vlákno/standup) · rozpad velkého úkolu na podúkoly · chytrý ranní digest · **auto-scheduling Suggest** (navrhne rozvrh dne, uživatel potvrdí).
- **Fáze 3:** **agenti** — proaktivně připomínají, určují priority, navrhují/posouvají termíny, řeší rutinu. Režimy **Suggest / Auto / Off** (default **Suggest**). Vše přes **`AISuggestion`** (návrh → schválení/zamítnutí), aby AI **nikdy tiše nepřepsala** práci, dokud uživatel nezapne Auto.
- *Pointa:* tvé zadání chce agenty, ale s fallbackem „o vrstvu níž" na asistenci. Architektura `AISuggestion` umožní obojí beze změny modelu — jen se přepíná, zda se návrh aplikuje automaticky.

---

## 11. Otevřená rozhodnutí (s defaulty, ať nic neblokuje)

| # | Rozhodnutí | Default pro pokračování | Dopad |
|---|---|---|---|
| 1 | **Hosting** | managed-first (Supabase/Neon + R2 + Fly), self-host později | nasazení, náklady, vlastnictví dat |
| 2 | **Sync engine** | Postgres + PowerSync | prostupuje celý kód — rozhodnout před Fází 1 |
| 3 | **Lucky OS API** | čekat na dokumentaci; integraci až v2 | T-Group napojení |
| 4 | **Rozsah agentů (v3)** | strop autonomie = jen po schválení, dokud se nepotvrdí jinak | bezpečnost AI |
| 5 | **Název aplikace** | placeholder, vybrat před brandingem | domény, PWA manifest |

---

## 12. Postup stavby (pořadí pro Claude Code)

1. **Scaffold monorepa:** `apps/web`, `apps/desktop` (Tauri), `apps/api` (Hono), `packages/db` (Drizzle), `packages/ui`, `packages/i18n`, `packages/shared` (Zod typy).
2. **Schéma + migrace** (§5).
3. **Auth** (Better Auth) + workspaces/role/membership + 2FA.
4. **Sync vertikální průřez** (PowerSync/Triplit): jeden entitní typ end-to-end → **ověřit offline zápis + real-time mezi 2 klienty co nejdřív** (největší riziko).
5. **Úkoly:** CRUD, 3 vrstvy, checklisty, statusy, priority, **barvy**, štítky, **dva režimy přiřazení (R2)**.
6. **Pohledy** List/Board/Calendar + filtry + fulltext + hromadné akce.
7. **Quick add CZ** (Claude).
8. **Google Calendar obousměrně**.
9. **Připomínky + digest + komentáře/@mentions + přílohy**.
10. **PWA + audit + zálohy/export** → uzavřít **MVP** dle §7 DoD.
11. Iterovat Fázi 2 a 3 po modulech.

> **Riziko:** krok 4 udělej jako úplně první funkční věc. Když zvolený sync engine nevyhoví, je lepší to zjistit den 3 než měsíc 3.

---

## 13. Kde budeme oproti konkurenci zaostávat
Viz samostatný soubor **`porovnani_todoist_notion_asana.md`** — poctivá mapa, kde dorovnáme/předčíme (CZ AI, barvy, dva režimy přiřazení, vlastnictví dat, obousměrný kalendář, plochá cena) a kde reálně zaostaneme (zralost offline syncu, nativní mobil, šíře integrací, reporting/automatizace à la Asana, dokumenty/databáze à la Notion, ekosystém a provozní vyladěnost). Důležité pro očekávání i pro to, kam neinvestovat.
