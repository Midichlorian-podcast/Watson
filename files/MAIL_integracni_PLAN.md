# MAIL / IDENTITA / PŘÍSTUPY / ADMIN — INTEGRAČNÍ PLÁN

> **Co to je:** systematický plán, jak vetkat mailovou vrstvu (spec
> `WATSON_MAIL_KONSOLIDOVANY_SPEC.md`) do existujícího Watson core. Plán pro **Claude Code**.
> Design track viz [`design/BRIEF_mail.md`](../design/BRIEF_mail.md).
>
> **Přednost dokumentů:** `MASTER §11/§12` a invarianty `R1–R9` (CLAUDE.md) **přebíjejí**
> mailový spec všude, kde se liší. Mailový spec je autoritativní pro *mailovou doménu*.
> Tento plán je autoritativní pro *způsob integrace* (slaďuje obojí s realitou kódu).
>
> **Stav:** v1 (návrh). Architektonická volba potvrzena uživatelem 2026-06-29.

---

## 0. Shrnutí na jednu obrazovku

1. **Mail NENÍ druhá appka přilepená později.** Jeho *základy* (linkování entit, identita/atributy
   osob, admin vrstva, zobecněný write-path, permission-aware sync) se musí dostat do **mladého
   schématu teď** — jinak platíme bolestivou migraci. *Samotný mail* (schránky, IMAP/SMTP, thread
   workspace) se staví **až po Watson core MVP** jako program M1–M3 (riziko S4: MVP je už tak velké).
2. **Architektura = „záměr specu přes house-style kódu"** (volba A): zůstávají **explicitní tabulky
   per typ**, přidáme **polymorfní `entity_links`** (stejný vzor, jaký už používá audit log).
   **Žádná generická `entities` tabulka.** Sféra = **`workspaces.isPersonal`** (R8), ne nový enum.
3. **Mail je strukturálně jen týmová sféra:** schránky visí na **týmu**, granty týmu drží přístup;
   osobní workspace nemá tým → schránku strukturálně nenese. `mail_threads.workspace_id` → FK na
   ne-osobní workspace (+ CHECK). Tím je „zamčené pravidlo sfér" zaručené strukturou, ne hlídačem.
4. **Maximální recyklace:** Better Auth, `memberships`, `audit_events`, R2 (těla/přílohy),
   PowerSync membership-buckety, BullMQ/Redis — **vše už ve stacku.** Mail Sync Service je *jediná*
   nová izolovaná služba.

---

## 1. Výchozí stav (ověřeno v kódu, ne dle README)

README tvrdí „Krok 1 hotovo". **Realita:**

| Krok (CLAUDE.md) | Stav | Soubory |
|---|---|---|
| 1 scaffold | ✅ hotovo | `apps/{web,api,desktop}`, `packages/{shared,db,ui,i18n}` |
| 2 schéma + migrace | ✅ z velké části | `packages/db/src/schema/{auth,workspace,task,collab,system,enums}.ts`, migrace `0000_salty_thanos.sql`; invarianty v `packages/shared/src/invariants.ts` |
| 3 auth/workspaces/role | 🟡 schéma ano, runtime neověřeno | Better Auth tabulky + `workspaces/memberships/projects/project_members` |
| 4 sync vert. průřez | 🟡 rozjeto | `powersync/sync-config.yaml` (bucket `user_projects`, zatím jen `tasks`); write-path `apps/api/src/powersync.ts` **natvrdo jen `tasks`** |
| 5–10 | ⬜ ne | — |

**Co kód NEMÁ a spec předpokládá:** generická `entities`/`entity_links`, `sphere` enum,
`workspace_id` na tasku (task scope-uje přes `project_id`), mail tabulky, admin konzole,
Mail Sync Service. **Co už má a využijeme:** polymorfní odkaz `audit_events.(entity, entity_id)`,
`workspaces.isPersonal` (= osobní sféra, R8), `memberships.role` (admin/manager/member/guest),
`ai_policies` per workspace, `actorType` user|ai, `ownerScope`, kalendářové tokeny v DB (precedent
pro citlivé credentials — který ale u mailu **odmítneme**, viz §5).

---

## 2. Zamčená architektonická rozhodnutí tohoto plánu

Stojí na volbě **A** + na `MASTER §11/§12` + `R1–R9` + rizicích z `REVIZE`.

- **A1 — Explicitní tabulky + `entity_links`.** Linkování (`mail_thread ↔ task`, „udělej z mailu
  úkol", `projekt ↔ konverzace`) řeší jedna polymorfní hranová tabulka. Bohaté tabulky zůstávají.
- **A2 — Sféra = `workspaces.isPersonal`.** Nezavádíme `sphere` enum. „Osobní projekt" = projekt
  v osobním workspace. Invarianty specu se mapují strukturálně:
  - *osobní sféra nenese schránku* → schránka je grant na **tým**; osobní workspace nemá tým.
  - *mail = jen týmová sféra* → `mail_*` FK na ne-osobní workspace (+ CHECK `is_personal = false`).
- **A3 — Mail Sync Service izolovaná** (vlastní deploy, jediná u vaultu). Ale **bez přestavby
  monorepa** dle skici spec §11 — `apps/api` zůstává `apps/api`; přidáme `services/mail-sync`
  (nebo `apps/mail-sync`) jako nový balík. Zamčený stack z CLAUDE.md > skica.
- **A4 — Žebřík oprávnění ke schránce = PŘEDNASTAVENÉ granty, ne vlastní role** (R5/§12). Úrovně
  vlastník/plný agent/scoped agent/per-thread delegát/interní spolupracovník jsou *typy grantu*,
  ne user-definované role. (Vlastní role se bijí s PowerSync sync pravidly — viz REVIZE S3/H3.)
- **A5 — Mail je online-only** (jako AI/kalendář/notifikace). **Neotvírá** §12 rozhodnutí
  „offline = jen core CRUD". Lokálně se synchronizuje jen *permission-aware cache* threadů.
- **A6 — AI u mailu nikdy neodesílá externě.** Hard guardrail z `AI_chovani_spec.md §2`
  (AI nepíše externím) platí doslova: AI generuje **draft**, člověk odesílá. Žádné auto-send.
- **A7 — Zobecnění write-pathu uděláme JEDNOU.** `apps/api/src/powersync.ts` (dnes `if table !==
  "tasks"`) → **registr handlerů per tabulka** s row-level kontrolou. Sdílené s funkcí „Postup"
  (viz `fazovane_ukoly_PLAN.md §5.3`) i s MVP (assignments, checklist_items). Nesmí se dělat 2×.

---

## 3. Datový model — co přibude (Drizzle, house-style)

Vše v idiomu kódu: `uuid` PK (client-side gen, offline), `pgEnum` z `@watson/shared`,
`workspaceId` FK, `created/updatedAt`. Zaváděno **aditivně** (nové migrace), nic se nepřepisuje.

### 3.0 Teď (levné okno — fold do Kroku 2–4)
```
entity_links                         -- polymorfní hrany (vzor jako audit_events)
  id uuid pk
  from_type varchar(64) · from_id uuid          -- 'task' | 'project' | 'mail_thread' | 'note' …
  to_type   varchar(64) · to_id   uuid
  relation  enum(derived_from|references|belongs_to|mentions)   -- spec §15: zatím stačí, rozšiřitelné
  workspace_id uuid fk NULL          -- denormalizace pro sync-bucketing a izolaci
  created_by uuid fk · created_at
  -- index (from_type,from_id) a (to_type,to_id); app-vrstva hlídá, že link nekříží hranici sfér

person_areas                         -- „oblasti odpovědnosti" pro kompetenční směrování (spec §7)
  id uuid pk · user_id fk · workspace_id fk
  key varchar · label varchar · routing enum(owner|awareness) · embedding vector NULL
  -- scoped per workspace (R: identita per workspace/tým, spec §3.3)

person_identity                      -- podpis + zobrazené jméno per workspace/tým (spec §4.1, §3.3)
  id uuid pk · user_id fk · scope enum(workspace|team) · ref_id uuid
  display_name varchar · signature_md text · language varchar

app_admins                           -- super-admin (app-wide, 2–3 lidé) — nad workspace úrovní
  user_id fk pk · granted_by fk · created_at
  -- workspace-admin = stávající memberships.role='admin'; tohle je NOVÁ app-level vrstva
```
> Pozn.: `mail_thread` se zatím jen **rezervuje jako řetězec typu** v `entity_links` a v konvencích;
> mailové tabulky níže přijdou až ve fázi M1 (aditivní migrace), **nemusí existovat teď.**

### 3.1 Fáze M1+ (mailové tabulky)
```
mail_accounts            -- připojená schránka (spravuje super-admin)
  id uuid pk · workspace_id fk(NOT personal) · address · provider enum(gmail|m365|imap)
  vault_ref varchar       -- ODKAZ do token vaultu (NE token sám — viz §5) · status · token_health · last_sync_at

mailbox_grants           -- žebřík oprávnění (A4), default přes TÝM, výjimka přes OSOBU
  id uuid pk · account_id fk
  grantee_type enum(team|user) · grantee_id uuid
  level enum(owner|full_agent|scoped_agent|thread_delegate|internal_collaborator)
  scope_filter jsonb NULL  -- pro scoped_agent (label/oblast) · expires_at NULL · created_by

mail_threads             -- 1:1 konvence s entity (type='mail_thread'); VŽDY týmová sféra
  id uuid pk · account_id fk · workspace_id fk(NOT personal)
  subject · participants jsonb · imap_uid · folder_map jsonb · last_message_at
  state enum(new|open|waiting_internal|sent|done)   -- spec §14.6, provázáno s task stavem (R9-analog)
  -- syrová těla NE zde

mail_messages            -- metadata zpráv; TĚLA/PŘÍLOHY v R2 (jen klíče zde)
  id uuid pk · thread_id fk · direction enum(in|out) · from · to jsonb
  body_r2_key varchar · sent_by_user_id fk NULL   -- atribuce reálného odesílatele i u sdílené From
  created_at

thread_chat              -- interní chat k threadu (@mention, neviditelný odesílateli; spec §6.3)
  id uuid pk · thread_id fk · author_id fk · body_md text · created_at
```
**Strukturální invarianty (CHECK/FK + test):** `mail_*.workspace_id` → workspace s `is_personal=false`;
grant `team` jen na ne-osobní workspace; `entity_link` nesmí spojit entitu osobní a týmové sféry.

---

## 4. Effective access + permission-aware sync (jediný bod, co se MUSÍ udělat vědomě)

- **Effective access = (granty z týmů) ∪ (osobní granty)** — jeden výpočet, jeden zdroj pravdy
  (spec §5). Dotaz: členství uživatele v týmech → `mailbox_grants(team)` ∪ `mailbox_grants(user)`.
- **Sync pravidla (rozšíření `powersync/sync-config.yaml`):** vedle `user_projects` přidat
  **`user_mailboxes`** bucket — parametr = effective `account_id` + scope; data = thready/zprávy/chat
  dle úrovně grantu. **Scoped agent** → jen thready dle `scope_filter`. **Per-thread delegát** →
  právě jeden thread. „Co nevidíš, v UI neexistuje" (spec §14.4) — hranice na úrovni dat, ne CSS.
- **Rollback UX (riziko S3, zatím nenavržené!):** offline/optimistický zápis, na který klient po
  změně grantu nemá právo, server **odmítne** → klient **vrátí + vysvětlí**. Navrhnout společně se
  zobecněním write-pathu (A7). Platí pro mail i pro celé MVP.
- **Revocation = remote purge (spec ⚑, k potvrzení):** *doporučuji minimální podobu do M1* —
  zrušení grantu smaže lokální cache schránky/threadu při příštím připojení zařízení; plný okamžitý
  wipe později.

---

## 5. Mail Sync Service (izolace = provozní i bezpečnostní)

- **Samostatná služba** (`services/mail-sync`): vlastní deploy/škálování/restart; výpadek mailu
  neshodí Watson; **jediná sahá na token vault.** Task kód k vaultu nikdy nesahá.
- **Token vault ≠ DB sloupec.** Pozn.: kalendář dnes ukládá tokeny do `calendar_connections` v DB.
  Pro mail to **nereplikujeme** — credentials do **šifrovaného vaultu** (klíče pod naší kontrolou,
  EU), v DB jen `vault_ref`. (Spec §9.1, §10.1.)
- **Dvouvrstvý sync:** vrstva 1 (IMAP/SMTP/Graph ⇄ sdílená DB) = Mail Sync Service; vrstva 2
  (DB ⇄ zařízení) = PowerSync permission-aware.
- **Auth/push:** OAuth/XOAUTH2 (Gmail/M365 — u M365 **Graph REST**, spec §15 doporučení), login/app-
  password pro vlastní IMAP. Push = provider webhooky + IDLE fallback. Fronty BullMQ/Redis (už ve
  stacku). Těla/přílohy → R2 (už ve stacku). **Před stavbou ověřit aktuální stav basic-auth
  (Gmail/M365 2025–26).**

---

## 6. Jak to vetkat do pořadí stavby (revidovaná roadmapa)

**Princip:** *teď jen levné základy; mail jako program po MVP; design běží paralelně.*

### Blok I — TEĎ (do Kroků 2–4, než se MVP rozjede do hloubky)
Fold „Fáze 0" specu — **bez stavby mailu**:
1. **Schéma+ (rozšíření Kroku 2):** `entity_links`, `person_areas`, `person_identity`, `app_admins`
   (§3.0). Rezervovat typ `mail_thread`. Dokumentovat mapování sféry (A2). Aditivní migrace.
2. **Auth/admin (Krok 3):** super-admin vrstva (`app_admins`, 2–3 lidé) nad workspace-adminem
   (stávající role). Skeleton admin konzole (read-only přehledy).
3. **Sync (Krok 4 — největší riziko, dělá se stejně):** zobecnit write-path na **registr handlerů
   per tabulka** (A7) + navrhnout **rollback UX (S3)** + nachystat tvar `user_mailboxes` bucketu
   (i kdyby zatím prázdný). „Field-level ownership" a „jeden viditelný stav" (thread↔task) = tady.

### Blok II — Watson core MVP (Kroky 5–10) BEZE ZMĚNY
Tasky, pohledy, quick-add, kalendář, připomínky, PWA → **MVP ship.** Mail se nestaví (S4).
Mezitím **design lock** + Claude Design dotahuje mailové obrazovky (Blok IV).

### Blok III — MAIL program (po MVP) — mapuje fáze specu §12
- **M1 (= spec Fáze 1) Osobní/jádro mailu + bezpečnost:** Mail Sync Service, připojení účtů
  (super-admin), sjednocená schránka, čtení/psaní, identita From/jméno/podpis, lokální search,
  per-schránka AI vypínač, connection-health dashboard, onboarding wizard, command palette/zkratky/
  swipe, tmavý režim, revocation-purge (min.). *Pozn.: „osobní mail" ze specu = jednouživatelské
  ovládání sdílené schránky; mail zůstává týmová sféra (A2).*
- **M2 (= Fáze 2) Týmový režim a dispečink:** žebřík oprávnění (A4), Assign/Share/Ask, thread
  workspace (vlajková obrazovka), collision detection, „udělej z mailu úkol" (`entity_link`),
  projekt↔konverzace, dispečink (přiřazené/nepřiřazené, nízká jistota AI, hromadné akce),
  send-as-team round-robin+SLA, schvalovací krok, one-click odpovědi, náhled odkazů.
- **M3 (= Fáze 3) Automatizace a hloubková AI:** kompetenční směrování (AI routing do úkolů, aditivní,
  dedup per thread, „proč" + feedback), awareness→denní digest, rules v př_jazyce, follow-up detekce,
  unified search (Ask AI), návrh odpovědi z R2/Drive (RAG), audit&analytics per schránka, snooze/mute,
  ranní briefing.
- **Backlog:** šablony s proměnnými z grafu, handoff s kontextem, inline překlad, multikanál.

### Blok IV — Design track (paralelně od teď) → `design/BRIEF_mail.md`
App shell už má **„Schránka"** (s počítadlem) — vstupní bod existuje. Design dotahuje: sjednocená
schránka, **thread workspace** (4 vrstvy), Lidé & Týmy, Access matrix, Administrace, připojení
schránky, kompetenční směrování. Vizuálně oddělit osobní vs. týmovou sféru a guest pohled.

---

## 7. Bezpečnost & GDPR — checklist (spec §10) ↔ náš stack
1. Credential nik/y neopustí vault → odebrání člověka = zrušení grantu (bez změny hesla). *(§5)*
2. Least privilege; scoped/delegát granty expirují / ruší se na „done" (`mailbox_grants.expires_at`).
3. Každé odeslání atribuované osobě i u sdílené From (`mail_messages.sent_by_user_id`) → `audit_events`.
4. Workspace = tvrdá GDPR hranice (už v modelu; mail FK na ne-osobní workspace).
5. Syrová těla/přílohy v R2; DB drží metadata + linky.
6. AI subprocesor vypínatelný per schránka (`ai_policies` rozšířit o per-account); DPA; informovat.
7. Sdílené inboxy = zpracování dat třetích osob → role processor, DPA mezi entitami.
8. Read receipts opt-in, default vyp.  9. Permission-aware sync (per-thread delegát = 1 thread).
10. M365 sdílené schránky: SMTP AUTH + send-as v Exchange (vědomě).

---

## 8. Otevřené otázky — návrhy rozhodnutí (spec §15 + navíc)
| # | Otázka | Doporučení |
|---|---|---|
| 1 | M365 protokol | **Graph REST** (ne syrový IMAP). |
| 2 | Kolik super-adminů | **2–3** (`app_admins`), nikdy 1 (bus-faktor). |
| 3 | Smí vlastník týmu udělit grant sám? | Jen v rámci schránek, které workspace-admin pro tým „odemkl". |
| 4 | Relation typy v `entity_links` | `derived_from/references/belongs_to/mentions` stačí; enum rozšiřitelný. |
| 5 | mail-quick v MVP? | **Později** (po M2). |
| 6 | Osobní účet napříč workspace | Identita per workspace/tým (`person_identity`) — jiné jméno/podpis. |
| 7 | ⚑ Revocation = remote purge | **Minimální podoba do M1** (potvrdit). |
| 8 | Názvy (mail modul / produkt) | K doplnění. ⚠️ „Watson" koliduje s IBM (REVIZE N5) — problém jen při veřejném launchi. |
| 9 | Sféra: potvrdit mapování A2 | `isPersonal` místo `sphere` enumu — potvrzeno volbou A. |

---

## 9. Rizika a jak je krotíme
- **S4 (MVP moc velké):** mail je **mimo MVP** (Blok III). Teď jen levné, jinak-bolestivé základy.
- **S3 (offline rollback):** navrhnout společně se zobecněním write-pathu (Blok I/3) — blokátor pro
  jakoukoli změnu přístupů.
- **S5 (provoz solo+AI):** Mail Sync Service = největší nová provozní zátěž (vault, IMAP kvóty,
  webhooky). Monitoring + fallback (necháváme původní schránku funkční) povinné.
- **Konflikt s house-style:** `entity_links` kopíruje vzor auditu → žádné cizí paradigma; PowerSync
  bucketing zůstává per-tabulka, ne polymorfní.

---
*Další krok po schválení tohoto plánu: rozpracovat Blok I jako konkrétní úkoly (migrace `entity_links`
+ identita osob + app_admins; PoC zobecnění write-pathu + rollback UX) a paralelně předat
`design/BRIEF_mail.md` do Claude Design.*
