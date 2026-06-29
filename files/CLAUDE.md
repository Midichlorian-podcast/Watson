# CLAUDE.md — Watson

> Vstupní instrukce pro Claude Code. Čti první. Sváže celou specifikaci, datový model, AI pravidla, identitu a postup stavby. **Obsahuje finální opravy po auditu (sekce „Revize").**
>
> **⚑ Zdroj pravdy produktu/designu = Claude Design handoff (`design/handoff_watson/`).** Kde se liší od starších rozhodnutí v tomto dokumentu, **platí handoff** (rozhodnuto uživatelem 2026-06-29). Srovnání rozdílů + fázování: `files/RECONCILIACE_design_vs_kod.md`.

## Co stavíš
**Watson** — vlastní, **offline-first**, real-time **týmový nástroj** (úkoly + projekty + kalendář + spolupráce + AI asistent), **obecný jako Todoist** (uživatel si sám tvoří týmy/workspaces a projekty). Pro **telefon, tablet i počítač** (PWA + Tauri desktop; nativní mobil až v3). Jazyky **CZ + EN** od začátku. Persona produktu i AI: **bystrý, diskrétní, vřelý asistent** („tvůj Watson").

C�l kvality: **kvalita > rychlost.** Tým 15–30 lidí (z velké části ne-vývojáři). Tři oblasti drž jako tvrdou laťku MVP: **spolehlivý offline sync, kvalita PWA na mobilu/tabletu, spolehlivost opakování a připomínek.**

## Mapa dokumentů (čti v tomto pořadí)
1. **`MASTER_zakladni_stavebni_kamen.md`** — kompletní popis, per-funkce řešení (vzor+naše), datový model, fázování, rizika. **Sekce 11 a 12 = závazná zpřesnění a finální opravy (mají přednost).**
2. **`funkcni_specifikace_v2_build_ready.md`** — anotovaná spec s „pointami".
3. **`AI_chovani_spec.md`** — pravidla chování AI (úrovně, mantinely).
4. **`REVIZE_nejasnosti_a_rizika.md`** — audit (rozpory/rizika) a jejich řešení.
5. **Identita** — `identita_watson.html` + sekce *Identita* níže.
6. **`porovnani_todoist_notion_asana.md`** — kde dorovnáváme/zaostáváme.
7. **`POSTUP_kvalitni_appka.md`** — jak dojít k hezké appce + kdy zapojit Claude Design.

## Technologický stack (závazný default)
TypeScript **monorepo** (pnpm + Turborepo):
- `apps/web` — React + Vite + **PWA**, Tailwind, TanStack Query/Router, **i18next (CZ default, EN plně)**.
- `apps/desktop` — **Tauri**. `apps/api` — **Hono** (AI, integrace, webhooky, workery).
- `packages/db` — **Postgres + Drizzle**. `packages/shared` — **Zod**. `packages/ui`, `packages/i18n`.

Sync: **Postgres + PowerSync** (offline-first, real-time). **Text (popisy/komentáře) = Markdown přes PowerSync (LWW) — v MVP BEZ CRDT.** Yjs až s kolaborativními docs (v2). Auth: **Better Auth** (e-mail+heslo, Google, Apple, magic link, **2FA dobrovolné**). AI: **Anthropic Claude API** (server-side). Úložiště: **S3/R2**. Notifikace: **Web Push + Resend**. Fronta: **BullMQ + Redis**. Hosting: **managed (Supabase/Neon + Fly), region EU**; self-host cesta zachovat.

## Identita (design tokeny + hlas)
- **Barvy:** Navy `#17283F` · Brass `#C68A3E` (akcent; pro **text** tmavší `#A8722E` kvůli kontrastu) · Paper `#F5F4F0` · Ink `#16161A` · Success `#2E9C6E` · Po termínu `#C2473C` · Line `#E7E5DF`.
- **Typografie:** **Montserrat** (display/UI) · **Inter** (text) · mono pro čas/čísla.
- **Logo:** monogram **W** v ukotvené dlaždici + brass „tečka přítomnosti"; wordmark `Watson` Montserrat 800.
- **Uživatelský barevný systém** projektů/štítků (kurátorské palety + vlastní hex) je **oddělený od brand palety** a **nikdy vázaný na prioritu**.
- **Hlas Watsona:** stručně; **navrhuje, neimponuje**; vždy **potvrdí, co udělal**; nikdy nestraší; **transparentní**; respektuje tiché hodiny; stejně klidný v CZ i EN.

## Inženýrské konvence
TS strict (žádné `any` bez komentáře) · **Zod** validace sdílená FE↔BE · **i18n od začátku** (0 hardcoded řetězců; CZ default, EN plně) · migrace přes Drizzle · **server = autorita** (oprávnění **row-level**) · testy = každé akceptační kritérium · feature flags · **bez `localStorage`** pro doménová data (vše přes sync engine) · **stav striktně po fázích** (MVP→v2→v3).

## Tvrdá pravidla (invarianty) — NIKDY neporušit
- **R1** Úkoly max **3 úrovně**; checklist = lehká položka.
- **R2** `assignment_mode`: `single` / `shared_any` (kdokoli → hotovo) / `shared_all` (každý zvlášť; rodič odvozeně až všichni). **Při více přiřazených se VŽDY ptej na režim**; pro **neinteraktivní cesty (automatizace/AI/hromadně) je výchozí `shared_all`**.
- **R3** Dokončení všech **podúkolů rodiče NEdokončí** (ruční). V kódu odděl „dokončení dle spoluřešitelů (R2)" od „roll-up podúkolů (R3)".
- **R4** Opakování **výchozí od termínu**; volba „od dokončení" per úkol; při změně nabídni `tento / tento a další / celá řada`; při dalším výskytu **reset všech per-osoba dokončení**.
- **R5** Oprávnění **row-level server-side**; host jen pozvané; restricted skryté nečlenům; **bohatší PŘEDNASTAVENÉ role** (BEZ plně vlastních rolí).
- **R6 (REVIDOVÁNO — Claude Design)** **Barva = priorita** na kartě: **levý okraj** P1 červená / P2 žlutá / P3 modrá / P4 šedá. **Tělo karty** = výchozí barva projektu **nebo** per-uživatelská barva úkolu (týž úkol může každý vidět v jiné barvě). Priorita smí mít i nebarevný odznak P1–P4 jako doplněk. Plné pravidlo barev: `design/handoff_watson/README.md`. (Původní „barva ≠ priorita" nahrazeno.)
- **R7** **Štítky globální pro tým, ale skryté hostům.**
- **R8** Každý uživatel má **osobní prostor**; quick add bez projektu → **osobní inbox** (`#projekt` přesměruje).
- **R9 (stav/dokončení)** Zaškrtnutí úkolu a stav „Hotovo" (`is_done`) se **nastavují navzájem** (provázané).

### Offline rozsah
**Offline = jádro CRUD a čtení.** Online-only: **AI, Google kalendář, notifikace, přílohy/hlasovky.** **Quick add offline** = lokální parser (`#`, `@`, `p1–p4`, datum); AI doplní po připojení; výsledek **potvrzuješ náhledem** před uložením.

### AI pravidla (z `AI_chovani_spec.md`)
**Žádné „auto tiše".** `Navrhnout` → `AISuggestion` ke schválení; `Auto+info` → provede + upozorní + **vždy undo**. **Mantinely vždy (server-side):** AI nikdy nemaže úkoly, nepíše externím, nemění oprávnění/role. **Tiché hodiny per workspace.** AI akce procházejí **stejnou notifikační/quiet bránou** (respektují ztlumení). **Audit** všeho. Konfigurace **per workspace** (admin/manager). Vypnuté: C2 (přehodnocení priorit), D2 (auto-přiřazení).

## Pořadí stavby (MVP)
1. **Scaffold monorepa.**
2. **Schéma + migrace** (MASTER §4 + §11/§12).
3. **Auth** (4 metody + 2FA) + **workspaces / přednastavené role / membership**.
4. **SYNC vertikální průřez** (PowerSync): jeden entitní typ end-to-end → **ověř offline zápis + real-time mezi 2 klienty co nejdřív** (největší riziko — první!).
5. **Úkoly:** 3 vrstvy + checklisty + **2 režimy přiřazení (R2)** + statusy (provázané s dokončením, R9) + priority (odznak) + **barevný systém** + **globální štítky (skryté hostům)**.
6. **Pohledy** List/Board/Calendar (grouping volitelný per projekt) + **filtry** + fulltext (permission-aware) + hromadné akce.
7. **Quick add** — **lokální parser offline + AI online, s náhledem k potvrzení**.
8. **Google Calendar (MVP jednodušší):** **jeden sdílený kalendář na projekt** v **týmovém Google účtu**; Watson→Google (úkoly s termínem) + čtení událostí do pohledu. **Plná obousměrnost + konflikty až v2.**
9. **Připomínky** (offset per uživatel) + **digest** (per uživatel) + **komentáře/@mentions** (Markdown) + **základní přílohy** (online; **bez verzování a hlasovek — v2**).
10. **PWA** (offline CRUD) + **tablet split-view** + **CZ/EN** + **audit log** + **zálohy/export** → **MVP**.

## Vzhled a kvalita (kdy Claude Design) — proložit stavbou
Princip: **odděl „funguje" od „vypadá dobře"; konzistence dělá 80 % krásy.** Detaily v `POSTUP_kvalitni_appka.md`.
- **Krok 1–4 holé.** Sync (krok 4) postav ošklivý, jen ať technicky šlape. **Paralelně** spusť **Claude Design** a nech ho z identity Watsona udělat **design systém + 5 obrazovek** (Dnes, seznam, detail, board, kalendář) + komponenty (karta úkolu, chip, checkbox, prioritní odznak).
- **Po kroku 4 = Design lock.** Z Designu vytáhni **`tokens.css` / Tailwind téma**. **Od kroku 5 staví Claude Code všechno JEN z těchto tokenů a komponent** — žádné ad-hoc barvy/odsazení.
- **Kroky 5–10:** každou obrazovku stav proti návrhu z Designu.
- **Po každé fázi „design pass":** screenshoty reálné appky → Claude Design navrhne vylepšení → zpět do kódu přes tokeny.
- **Detaily (prázdné stavy, loading, mikrointerakce, dark mode) až na konec.** Pravidla: reálná česká data, mobile-first, jedna akcentová barva (brass), vzdušnost, testovat na reálném telefonu brzy.

## Definition of Done (MVP) — testovatelné
Přihlášení 4 metodami + 2FA · workspace/projekt, pozvání člena i hosta s právy, restricted neviditelný nečlenům · **quick add offline lokálně rozloží + AI online doplní + náhled k potvrzení** · oba režimy přiřazení (R2), neinteraktivně `shared_all` · zaškrtnutí ↔ stav „Hotovo" provázané (R9) · **offline změna se dosynchronizuje, 2 klienti real-time bez ztráty dat** · úkol s termínem se objeví ve sdíleném Google kalendáři projektu, události se načtou do pohledu · List/Board/Calendar + filtr + fulltext (permission-aware) + hromadná akce + připomínka + komentář s @zmínkou + **základní příloha** · PWA instalovatelná a offline · **tablet split-view** · UI kompletně CZ i EN · audit log + export.

## Fáze v2 / v3
- **v2:** **plná obousměrná editace kalendáře + konflikty** · **verzování příloh** · **hlasovky** · **kolaborativní docs (Yjs/CRDT)** · závislosti · milníky · šablony+auto-datování · vlastní pole (Text/Číslo/Výběr/Datum/Zaškrtávátko/Odkaz/Osoba) · task types · Gantt · **workload (dle počtu úkolů)** · table · time-blocking · Apple CalDAV · command palette · denní rituál · eskalace · schvalování · proofing · feed · chat · **automatizace (builder + presety)** · formuláře · **dashboardy (6 widgetů)** · **OKR** · **jednoduché docs/poznámky u úkolů** · **granularita notifikací** · AI (filtry CZ, sumarizace, rozpad, chytrý digest, auto-scheduling Suggest) · API/webhooky · desktop (Tauri) · dark mode · opakování „od dokončení".
- **v3:** AI agenti · vícekrokové workflow · portfolio · booking · databáze+relace · nativní mobil · floating/fixed TZ · **Lucky OS** (až bude jeho API) · e-mail→úkol.
- **Mimo rozsah:** SSO/SCIM · whiteboard · **vlastní role** (jen přednastavené) · **iDoklad** · **time tracking**.

## Otevřené / provozní (neblokuje stavbu)
- **Lucky OS** — čeká na API (vaše appka, zatím nehotová).
- **E-mail→úkol** — později (přeposílání / Gmail / Graph / IMAP; Spark nemá API).
- **Nativní mobil** — v3 (zatím PWA prvotřídní).
- **Team Google Workspace účet** — potřeba pro vlastnictví sdílených kalendářů projektů.
