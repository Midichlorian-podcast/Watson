# Mail moduly — Feasibility & koherence audit (2026-07-08)

> Audit briefu `design/BRIEF_mail_moduly_2026-07-08.md` proti **reálnému kódu** (ne README) a proti
> zamčeným plánům (`MAIL_integracni_PLAN.md`, `MAIL_implementacni_plan_2026-07-07.md`, `CLAUDE.md`).
> Verdikty: ✅ proveditelné · 🟡 proveditelné s výhradami · 🔴 problém k rozhodnutí.

## Zjištěná realita kódu (ověřeno)
- **Blok I NENÍ postavený:** chybí `entity_links`, `person_areas`, `person_identity`, `app_admins`.
- **Žádná realtime/presence infrastruktura** (WS/SSE/LISTEN-NOTIFY) — sync je **jen PowerSync** (durable CRUD).
- **BullMQ/Redis NEJSOU ve stacku** — připomínky = `setInterval` 30s sken DB (`apps/api/src/push.ts`).
- **AI vůbec nenapojená** (žádný `@anthropic`, prázdný klíč).
- **`audit_events` má 0 zápisů** (tabulka existuje, nikdo do ní nepíše). `task_activity` se píše klientem
  a **nesynchronizuje se** na klienty (čte se přes GET API).
- **Žádná Mail Sync Service, žádné `mail_*` tabulky.** Write-path je jen klient→server (žádná
  server-authored mutace úkolu — plánovaná až pro „Postupy").
- **Využitelné hotové:** generalizovaný write-path registr (row-level R5), rollback/reject cesta,
  polymorfní `audit_events.(entity,entity_id)`, `workspaces.isPersonal` (R8), přednastavené role,
  `ai_policies`, Web Push.

## Verdikty po oblastech
- **A. Osobní sféra „E2E, ani provoz nedešifruje" — 🔴 PROBLÉM.** Server-side stahování (IMAP/Graph) +
  ukládání těl do R2 + PowerSync + server-side triage/hledání se **vylučuje** s „nikdo kromě uživatele
  nedešifruje". Server drží credentials a dostává plaintext → „provoz nikdy" je porušené už při stahování.
  **Rozhodnutí nutné** (viz Top 3 #1). Nešířit slib E2E, dokud stahuje server (GDPR/odpovědnost).
- **B. `CHECK is_personal=false` na `mail_accounts`/`mail_threads` — 🔴 PROTIKLAD** k dvěma sférám.
  Nutno uvolnit CHECK + přidat diskriminátor a **vyjmout** osobní schránky ze všech týmových mechanismů
  (granty, dispečink, chat, AI, admin matice). Pozn.: `is_personal` je na `workspaces` → enforcement přes
  trigger/denormalizaci, ne prostý CHECK. Hranice sfér se posouvá ze „struktury" na „app-logiku + kryptu".
- **C. Systém urgence (P1/P2→úkol, auto-hotovo po odpovědi, SLA, eskalace) — 🟡 s výhradami.** Kusy sedí,
  ale: `entity_links` neexistuje; **není server-authored mutace úkolu** (auto-odškrtnutí musí dělat Mail
  Sync Service); „BullMQ" neexistuje (jede setInterval sken — dá se použít); **SLA v pracovních dnech
  potřebuje pracovní kalendář, který neexistuje**. → je to **M2 práce**, ne plug-in.
- **D. „Dění" feed — 🟡 s výhradami.** `audit_events` je prázdná (nutná instrumentace zápisů);
  `task_activity` se nesynchronizuje. → nový **server-side read-model + instrumentace + nové tabulky**
  (ruční příspěvky, komentáře), ne „UI nad logy". Platí **škálovací strop** (feed roste).
- **E. Collision detection / živá přítomnost — 🔴 chybí infrastruktura.** Žádný realtime kanál. PowerSync
  na to není. → buď hrubě „X má thread otevřený" přes SSE heartbeat na Hono (nový kód), nebo **odložit**,
  nebo přijmout hostovanou službu (Ably/Pusher). Jediná funkce briefu, co nejde postavit na stávajícím syncu.
- **F. M:N schránka↔uživatel + přiřazení dle přístupu — ✅** (přes `mailbox_grants` + effective access;
  precedent `isProjectMember` ve write-pathu). Výhrada: PowerSync bucketing pro `scoped_agent`/per-thread
  delegáta je netriviální (hrubé granty snadné, jemné scoping = ta těžká, nepostavěná část).
- **G. Rozsah & fázování — přerozdělit a bránovat.** Původně velký post-MVP program; brief přidal osobní
  E2E, Dění, urgence-jako-úkoly, celou AI vrstvu. Základy chybí. → viz fázování níže.
- **H. Další (opraveno/označeno):** brief si sám odporoval o sféře (Modul 2 vs guardrail #1) — **opraveno**;
  „From nejde měnit" nepřesné pro novou zprávu (u N schránek se identita **vybírá**) — **opraveno**;
  dispečink úkol = `shared_any`, ale R2 automatika defaultně `shared_all` → **vědomě přepsat**; AI Triage
  „předpřiřadí" musí být `ai_suggestions`, nikdy přímý zápis do `assignments` (D2 je OFF); „reuse
  notifikací" zakrývá, že Resend je nenapojený a připomínky nejsou BullMQ.

## TOP 3 k rozhodnutí PŘED designem
1. **Model soukromí osobní sféry (A+B):** (a) klient-only E2E = samostatná větev, bez server
   triage/hledání/AI (skoro druhá appka); nebo (b) šifrování at-rest (server stáhne, zašifruje klíčem
   uživatele, zahodí plaintext — „uložené maily provoz nepřečte", ne plné E2E); nebo (c) přístup+audit
   (soukromé politikou, ne kryptograficky). **Nedávat designu zámek = E2E, když je model (c).**
2. **Vnitřní rozpor briefu o sféře** — opraveno (Modul 2 sladěn s guardrailem #1).
3. **Dvě funkce potřebují novou infrastrukturu, kterou brief předpokládá jako hotovou:** živá
   přítomnost/collision (žádný realtime) a SLA engine urgence (žádný BullMQ, chybí pracovní kalendář).
   Prerekvizity: instrumentace `entity_links`/`audit_events` + server-authored mutace (Blok I) — nepostavené.

## Doporučené fázování (nezkracuje rozsah, sekvencuje ho)
- **Blok 0 (teď, levné):** `entity_links`, `person_identity`, `person_areas`, `app_admins`; instrumentace
  `audit_events`; rezervace typu `mail_thread`.
- **M1 — týmové jádro mailu (bez AI, bez urgence-úkolů, bez presence):** Mail Sync Service + vault +
  **jeden provider** (Gmail *nebo* Graph), čtení/psaní/odeslání (jen člověk), identita/podpis,
  connection-health, onboarding wizard, jednoduché server-side HEY-třídění. Už tohle je velký kus.
- **M2 — spolupráce & dispečink:** `mailbox_grants` M:N + přiřazení dle přístupu, interní chat, shared
  drafts, email→úkol, **urgence-úkoly + SLA engine** (pracovní kalendář + server-authored dokončení),
  **collision detection** (nová realtime infra — samostatně označeno). Dění start (server read-model).
- **M3 — AI & automatizace:** napojit Anthropic (+ pravděpodobně BullMQ na async AI), draft/sumarizace/
  překlad/Ask, Off/Read/Triage jako návrhy, kompetenční směrování (person_areas + pgvector).
- **Osobní sféra — samostatná, rozhodnutím bránovaná větev** (dle #1); NEbalit do M1.

**Největší riziko:** Mail Sync Service jako 24/7 služba držící credentials pro solo+AI provoz (vault,
refresh tokenů, IMAP kvóty, webhooky) — vše ostatní na ní závisí. Blízko druhé: slib E2E osobní sféry
bez klient-only modelu.
