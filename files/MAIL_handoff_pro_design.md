# Mail — handoff pro Claude Design (aktuální stav Watsonu)

> **Účel:** stručný, AKTUÁLNÍ obraz stavu appky pro tým, který přidává mailový klient.
> Navazuje na dva existující (a stále platné) dokumenty:
> - **`design/BRIEF_mail.md`** — brief obrazovek pro Claude Design (thread workspace = vlajka).
> - **`files/MAIL_integracni_PLAN.md`** — datový model, fázování, bezpečnost, roadmapa.
>
> Tento soubor je jen „co je HOTOVÉ teď, na co přesně stavíš".

## 1. Watson core je hotový a zauditovaný (na tohle se věší mail)

Aplikace je **1:1 s Cloud Design prototypem** (`design/handoff_watson/`), funkčně kompletní,
technicky zdravá:
- **12 obrazovek**: Dnes, Úkoly, Nadcházející, Oblíbené, Kalendář (den/týden/měsíc), Projekty
  (+detail), Cíle (builder+detail), Reporty (přehled+lidé), Postupy (přehled/detail/builder),
  Schránka, Hledat, Nastavení. Detail úkolu = vycentrovaný modal; podúkoly = reálné vrstvené úkoly.
- **App shell**: levý sidebar (workspaces + projekty + počty), header (view switcher, hledání,
  Watson, +Úkol), mobilní spodní lišta <880px. Světlý + tmavý režim, CS/EN i18n (kompletní parita).
- **Offline-first**: PowerSync (lokální SQLite ⇄ Postgres), optimistické zápisy přes
  **generalizovaný write-path registr** (`apps/api/src/powersync.ts` → `TABLES`).
- **Robustnost (doplněno po auditu)**: globální `ErrorBoundary`, `SyncGate` (spinner při první
  synchronizaci), ošetřené REST zápisy (toast při selhání), per-uživatelská barva úkolu.
- **Audit**: 12 modulů + adversariální ověření, 0 critical, systémové mezery (error handling,
  loading, ErrorBoundary) opravené. Typecheck čistý (6 balíčků), produkční build OK.

**Klíčové pro mail:** shell, tokeny (`--w-*`), komponenty (TaskCard, chipy, modaly, panely) a
sféry (osobní vs. týmový prostor přes `workspaces.isPersonal`) jsou stabilní — mail je **rozšíří**,
nezakládá nový shell.

## 2. Co z mailových základů UŽ existuje (na čem stavět)

| Foundation | Stav | Kde |
| --- | --- | --- |
| **Schránka** v navigaci (s počítadlem) | ✅ hotové | `nav.ts` → `/schranka`; dnes inbox-triage úkolů |
| **Identita osoby** (job_title, locale, timezone) | ✅ sloupce v `users` | `packages/db/src/schema/auth.ts` |
| **Polymorfní odkaz** (vzor entity→entity) | ✅ existuje jako `audit_events.(entity, entity_id)` | `schema/system.ts` |
| **Generalizovaný write-path** (registr tabulek) | ✅ hotové | `apps/api/src/powersync.ts` `TABLES` |
| **Sféry** (osobní/týmová = `isPersonal`) | ✅ hotové | `workspaces.isPersonal` (R8) |
| **Permission-aware sync** (R5 project scoping, Host read-only) | ✅ hotové | `sync-config.yaml` + write-path |

## 3. Co ještě NEEXISTUJE (Blok I „levné základy" + mail program)

- **`entity_links`** (polymorfní from/to) jako univerzální graf — zatím jen `audit_events`.
- **`app_admins`** (super-admin konzole).
- **`person_areas`** (oblasti odpovědnosti pro kompetenční směrování).
- **`mail_*`** tabulky (schránky, thready, zprávy, drafty) + **Mail Sync Service** (izolovaná).

Architektura je **zamčená** (viz plán §2): **Varianta A** — explicitní tabulky per typ + polymorfní
`entity_links` (žádná generická `entities`), sféra = `workspaces.isPersonal` (ne nový enum), mail
strukturálně jen týmová sféra.

## 4. Doporučené pořadí (co dělat po pushnutí)

1. **Claude Design navrhne mailové obrazovky** dle `design/BRIEF_mail.md` — nejdřív **Thread
   workspace** (vlajka: 4 vrstvy — e-mail / composer s AI draftem / interní chat / lišta stavu),
   pak sjednocená schránka, Lidé & Týmy, Access matrix, Admin konzole, Připojení schránky.
   Drží tokeny a komponenty stávajícího shellu.
2. **Blok I základy do schématu** (aditivně, než se mail rozjede): `entity_links`, `app_admins`,
   `person_areas` + jejich write-path/sync záznamy. Levné teď, drahá migrace později.
3. **Mail program M1–M3** (až po designu + Blok I): schránky → thread workspace → směrování.
   Mail je **online-only**; AI **nikdy** neodesílá externě bez potvrzení (guardrail).

## 5. Guardraily (nesmí se porušit)

- Mail jen v **týmové** sféře (schránky visí na týmu; `mail_*.workspace_id` FK na ne-osobní
  workspace). Osobní sféra a Host pohled **bez** mailu/governance.
- Přístup = „co nevidíš, v UI neexistuje" (žádné zašedlé „nemáš přístup").
- Aditivní migrace; po změně `sync-config.yaml` restart `watson-powersync`.
- `From` u composeru nejde měnit (svázáno s threadem); jen viditelné „odpovídáš jako …".
