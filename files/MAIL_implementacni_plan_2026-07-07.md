# MAIL — IMPLEMENTAČNÍ PLÁN (kód, 2026-07-07)

> Navazuje na `MAIL_integracni_PLAN.md` (strategie, architektura A — potvrzeno) a
> `MAIL_handoff_pro_design.md`. Tenhle dokument je **konkrétní, kódová dekompozice**: Drizzle tabulky,
> záznamy do write-path registru, sync buckety, struktura služeb, API a pořadí úkolů. Přednost:
> `MASTER §11/§12` + `R1–R9` přebíjejí mailový spec; architektura = **Varianta A** (explicitní tabulky
> + polymorfní `entity_links`, sféra = `workspaces.isPersonal`, mail = jen týmová sféra).

---

## 0. Výchozí realita (ověřeno v kódu 2026-07-07)

**Už hotové a využitelné (na tom stavíme):**
- **Generalizovaný write-path** `apps/api/src/powersync.ts` → registr `TABLES` (přidat tabulku = přidat
  záznam; row-level R5 kontrola, role, `ownerCol`, `appendOnly`). *Zobecnění A7 z plánu je HOTOVÉ.*
- **Rollback UX (S3)** — connector po 403/permanentní chybě op zahodí + `watson:write-rejected` toast.
  *Blokátor „změna přístupu odmítne offline zápis" je vyřešený.*
- **Polymorfní vzor** `audit_events.(entity, entity_id)` — přesně house-style pro `entity_links`.
- **Sféry** `workspaces.isPersonal` (R8); **role** `memberships.role` (admin/manager/member/guest);
  `ai_policies` per workspace; `calendar_connections` (precedent pro credentials — u mailu ODMÍTneme).
- **Vstupní bod UI** — „Schránka" v navigaci (dnes inbox-triage úkolů).

**Ještě NEEXISTUJE (staví tento plán):** `entity_links`, `person_identity`, `person_areas`,
`app_admins`, všechny `mail_*`, Mail Sync Service, bucket `user_mailboxes`.

---

## BLOK I — levné základy (TEĎ, aditivně, bez stavby mailu)

Cíl: dostat do mladého schématu věci, které se později bolestivě migrují. Žádná mailová logika.

### I.1 Schéma (Drizzle, nová migrace `packages/db/src/schema/graph.ts` + `mail_identity.ts`)

```ts
// entity_links — polymorfní hrany (mail_thread↔task, projekt↔konverzace, „z mailu úkol")
entity_links {
  id uuid pk
  from_type varchar(64) · from_id uuid        // 'task'|'project'|'mail_thread'|'note'
  to_type   varchar(64) · to_id   uuid
  relation  enum(derived_from|references|belongs_to|mentions)
  workspace_id uuid fk → workspaces (NOT NULL; denormalizace pro sync-bucketing a izolaci sfér)
  created_by uuid fk → users · created_at
  index (from_type, from_id) · index (to_type, to_id) · index (workspace_id)
  // app vrstva hlídá, že link nekříží hranici sfér (osobní↔týmová)
}

// person_identity — zobrazené jméno + podpis per prostor/tým (spec §4.1, §3.3)
person_identity {
  id uuid pk · user_id fk · scope enum(workspace|team) · ref_id uuid
  display_name varchar(200) · signature_md text · language varchar(8)
  unique (user_id, scope, ref_id)
}

// person_areas — oblasti odpovědnosti pro kompetenční směrování (spec §7)
person_areas {
  id uuid pk · user_id fk · workspace_id fk
  key varchar(64) · label varchar(200) · routing enum(owner|awareness)
  // embedding vector NULL — až M3 (pgvector), teď vynechat
  index (workspace_id)
}

// app_admins — super-admin (app-wide, 2–3 lidé) NAD workspace-adminem
app_admins { user_id fk pk · granted_by fk · created_at }
```
+ nové pg enumy do `enums.ts`: `entityRelationEnum`, `identityScopeEnum`, `personRoutingEnum`.

### I.2 Write-path registr (`apps/api/src/powersync.ts` → `TABLES`)
- `entity_links`: `creatorCol: "created_by"`, `workspaceVia: { kind:"column", col:"workspace_id" }`.
  *(membership přes memberships — stejně jako `goals`.)*
- `person_identity`: `ownerCol: "user_id"` (identitu si edituje jen vlastník), scoping přes ref.
  *(Pozn.: person_identity není project-scoped — přidat variantu kontroly „vlastní řádek".)*
- `person_areas`: `workspaceVia` (member prostoru).
- `app_admins`: **NEzapisovat přes sync** — jen přes chráněný API endpoint (super-admin only).

### I.3 Sync buckety (`powersync/sync-config.yaml`)
- Do `user_workspaces` přidat `entity_links` a `person_areas` (`WHERE workspace_id = bucket.workspace_id`).
- `person_identity`: do `user_own` (`WHERE user_id = bucket.user_id`) — vlastní identity.
- **Restart** `docker restart watson-powersync` po změně.

### I.4 Admin skeleton (API, read-only)
- `app_admins` seed 2–3 lidí (migrace/skript, nikdy 1 — bus-faktor).
- `GET /api/admin/overview` (jen app_admin): přehled prostorů/účtů/health (zatím prázdné karty).

**Definition of done Blok I:** migrace prošly, 3 tabulky se syncují dle role, entity_link jde založit
a přečíst, app_admin endpoint vrací 403 nečlenům. Žádné mailové UI.

---

## M1 — Jádro mailu + bezpečnost (samostatný program, PO stabilizaci jádra)

### M1.1 Mail Sync Service — nová izolovaná služba `services/mail-sync`
- **Proč izolace:** vlastní deploy/restart; výpadek mailu neshodí Watson; **jediná sahá na token vault.**
- **Stack (ze zamčeného):** Node + Hono (health/webhooky) + **BullMQ/Redis** (fronty) + **ImapFlow**
  (IMAP IDLE) / **Microsoft Graph REST** (M365, doporučení #1) / **Gmail API** (OAuth XOAUTH2).
  Těla/přílohy → **R2**. Sdílená Postgres DB (stejná jako Watson) pro `mail_*` metadata.
- **Dvouvrstvý sync:** vrstva 1 (IMAP/Graph ⇄ Postgres) = tato služba; vrstva 2 (Postgres ⇄ zařízení)
  = PowerSync permission-aware.
- **Provoz:** monitoring, retry s backoff, IDLE + webhook push, fallback (původní schránka funkční).

### M1.2 Token vault (NE DB sloupec)
- Credentials do **šifrovaného vaultu** (KMS/age/libsodium sealed, klíč pod naší kontrolou, EU); v DB
  jen `vault_ref`. *(Kalendář dnes tokeny v DB — u mailu vědomě NEreplikujeme; spec §5/§9.1/§10.1.)*
- K vaultu sahá **jen** Mail Sync Service; Watson API/task kód nikdy.

### M1.3 Schéma (`mail.ts`, aditivní)
```ts
mail_accounts {
  id uuid pk · workspace_id fk (CHECK is_personal=false) · address · provider enum(gmail|m365|imap)
  vault_ref varchar · status enum(connected|error|paused) · token_health · last_sync_at · created_by
}
mail_threads {
  id uuid pk · account_id fk · workspace_id fk (CHECK not personal)
  subject · participants jsonb · imap_uid · folder_map jsonb · last_message_at
  state enum(new|open|waiting_internal|sent|done)     // provázáno s task stavem (R9-analog)
  index (account_id) · index (workspace_id, last_message_at)
}
mail_messages {
  id uuid pk · thread_id fk · direction enum(in|out) · from · to jsonb
  body_r2_key varchar · sent_by_user_id fk NULL       // atribuce reálného odesílatele i u sdílené From
  created_at · index (thread_id)
}
thread_chat {                                         // interní chat k threadu (@mention, spec §6.3)
  id uuid pk · thread_id fk · author_id fk · body_md · created_at
}
```
Strukturální invarianty (CHECK/FK + test): `mail_*.workspace_id` → `is_personal=false`; syrová těla
NIKDY v DB (jen R2 klíče).

### M1.4 Permission-aware sync (`user_mailboxes` bucket)
- Parametr = effective `account_id` z členství uživatele; data = thready/zprávy/chat dle grantu.
- V M1 zjednodušeně: uživatel s přístupem k účtu vidí celý účet (jemná úroveň grantů = M2).
- **Revocation = remote purge (min.):** zrušení přístupu smaže lokální cache při příštím připojení.

### M1.5 API (Watson API, ne Mail Sync Service)
- `POST /api/mail/accounts` (jen **app_admin**) — připojení schránky (spustí OAuth flow → vault_ref).
- `GET /api/mail/threads?account=…` — přehled (permission-aware).
- `POST /api/mail/threads/:id/draft` — AI **draft** (Claude, server-side; **A6: AI nikdy neodesílá**).
- `POST /api/mail/threads/:id/send` — odešle **člověk** (zařadí do Mail Sync Service fronty).
- Každé odeslání → `mail_messages.sent_by_user_id` + `audit_events` (atribuce i u sdílené From).

### M1.6 UI (drží tokeny + komponenty stávajícího shellu)
- **Thread workspace** (vlajka, 4 vrstvy): e-mail / composer s AI draftem / interní chat / lišta stavu.
- Sjednocená schránka (rozšíří stávající „Schránka"), připojení účtu (admin), connection-health.
- `From` v composeru **nejde měnit** (svázáno s threadem; jen „odpovídáš jako …").
- Command palette/zkratky/swipe, tmavý režim (už existují).

**Guardraily M1 (nesmí se porušit):** mail jen týmová sféra; „co nevidíš, v UI neexistuje" (hranice na
datech, ne CSS); AI generuje draft, **člověk odesílá**; credentials jen ve vaultu; online-only.

---

## M2 — Týmový režim a dispečink (outline)
- **Žebřík oprávnění** `mailbox_grants` (owner|full_agent|scoped_agent|thread_delegate|internal_collab)
  = **typy grantu, ne vlastní role** (A4); default přes tým, výjimka přes osobu; `scope_filter` jsonb;
  `expires_at`. **Effective access = granty z týmů ∪ osobní granty** (jeden výpočet).
- Rozšířit `user_mailboxes` bucket: scoped_agent → jen thready dle filtru; per-thread delegát → 1 thread.
- **„Udělej z mailu úkol"** = `entity_link(mail_thread → task, derived_from)` — Blok I to už umí.
- Dispečink (přiřazené/nepřiřazené, nízká jistota AI, hromadné akce), collision detection,
  send-as-team (round-robin + SLA), schvalovací krok, one-click odpovědi, náhled odkazů.

## M3 — Automatizace a hloubková AI (outline)
- Kompetenční směrování (AI routing do úkolů — aditivní, dedup per thread, „proč" + feedback;
  `person_areas` + pgvector embedding), awareness → denní digest, pravidla v přirozeném jazyce,
  follow-up detekce, unified search (Ask AI), návrh odpovědi z R2/Drive (RAG), audit&analytics per
  schránka, snooze/mute, ranní briefing.

---

## Bezpečnost & GDPR (checklist ↔ stack)
1. Credential neopustí vault → odebrání člověka = zrušení grantu (bez změny hesla).
2. Least privilege; scoped/delegát granty expirují / ruší se na „done".
3. Každé odeslání atribuované osobě i u sdílené From → `audit_events`.
4. Workspace = tvrdá GDPR hranice (mail FK na ne-osobní workspace).
5. Syrová těla/přílohy v R2; DB drží metadata + linky.
6. AI subprocesor vypínatelný per schránka (`ai_policies` rozšířit o per-account); DPA.
7. Read receipts opt-in, default vyp.  8. Permission-aware sync (delegát = 1 thread).

---

## Sekvence, odhad, rizika
- **Blok I** = malé, dělatelné hned (2 tabulkové migrace + registr + sync + admin skeleton). Levné teď,
  drahá migrace později. **Doporučení: udělat po stabilizaci P0 z auditu, paralelně s designem.**
- **M1** = největší nová práce (Mail Sync Service + vault + OAuth/IMAP/Graph + thread workspace UI).
  **Až PO Watson core MVP stabilizaci** (riziko S4: MVP je už tak velké).
- **Rizika:** S5 (provoz solo+AI — Mail Sync Service = největší nová provozní zátěž: vault, IMAP kvóty,
  webhooky → monitoring povinný); před stavbou ověřit aktuální stav basic-auth Gmail/M365 (2025–26);
  „Watson" název koliduje s IBM (jen při veřejném launchi).

**Otevřené k rozhodnutí:** M365 protokol → Graph REST (doporučeno); počet super-adminů → 2–3;
revocation remote-purge → minimální do M1; mail-quick v MVP → až po M2.
