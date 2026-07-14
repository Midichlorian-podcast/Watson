# Meets — propojený systém porad (plán) — 2026-07-13

Zdroj: multi-agent workflow (4× průzkum kódu → 3 architektonické přístupy → adversariální syntéza).
Kontext: modul „Meets" (dnes jen přepis→AI úkoly) se má stát PROPOJENÝM systémem porad.

## Doporučení: Meeting = speciální ÚKOL (`tasks.kind='meeting'`) jako kotva/hub

Hybrid A(+výběr z B). Porada JE reálný úkol → termín, přiřazení, kalendář, Watson, oznámení, podúkoly
fungují **zadarmo** z existující infry. Vyhrál nad „first-class entitou" (L efort, riziko dvou zdrojů
pravdy termínu) i „staged-flow / chains" (overkill, reflow) hlavně **efortem a respektem k invariantům**:
splní všech 5 priorit s JEDINÝM pravým novým synced sloupcem.

## Datový model (rozšíř existující > nové tabulky)

1. **`tasks.kind` varchar(12) NOT NULL default `'task'`** (enum `task|meeting`) — jediný pravý nový synced
   sloupec. Odliší poradu ve všech seznamech, umožní filtr „Porady" a přehled dle termínů
   (`SELECT * FROM tasks WHERE kind='meeting'`). Plná 5-místní migrace (Drizzle+index, generate/migrate,
   AppSchema, powersync TABLES+S7, sync-config beze změny — jede v tasks bucketu) + docker restart.
2. **`tasks.meeting_id` varchar(120) nullable** — backpointer hub-tasku (i akčních tasků) na `meetings.id`,
   dle vzoru `mail_th`/`mail_label` (varchar, ne FK — meetings se neSyncuje). Klik z úkolu otevře přepis přes REST.
3. **Termín schůzky = existující `tasks.start_date` s ČASEM + `duration_min`** — JEDINÝ zdroj pravdy termínu.
   Calendar vykreslí časový pruh místo all-day chipu. ŽÁDNÝ `scheduled_at` na meetings (vyhne se rozjezdu 2 zdrojů).
4. **`meetings` (server-only, jen ROZŠÍŘIT — neSyncuje se): `+hub_task_id`, `+series_id`, `+prev_meeting_id`**
   (uuid, nullable). Status new→scheduled→transcribed→extracted→committed. transcript+extraction zůstávají.
   Migrace jen Drizzle, žádný docker restart.
5. **`entity_links` (bez změny schématu — reuse):** (a) hub→meetings `belongs_to`; (b) hub→akční úkoly
   `derived_from` (dohledatelnost „odkud úkol vzešel"). Příprava/akce primárně přes `parent_id` (reálné podúkoly).
6. **`reminders` (existuje, synced, nenapojený): napojit na `hub.start_date`** → pokryje mezeru, že NotifCenter
   dnes hlásí až PO termínu. Přidat větev „nadcházející porada dnes/zítra".
7. **`attachments` (collab.ts — MRTVÁ): Fáze 2/4.** V1 přílohy = odkazy (url) v comments (0 infra). Reálné
   soubory = oživit do 5 míst + blob storage/upload + outbox pro offline.

## Životní cyklus jedné porady (co je propojené s čím)

1. **Příprava** — vznikne hub-task `kind='meeting'` se `start_date`+čas; přípravné kroky = **podúkoly**
   (`parent_id=hub`) přiřazené účastníkům; přílohy = odkazy v comments. Vazby: hub↔meetings(`meeting_id`),
   hub↔příprava(`parent_id`).
2. **Schůzka (termín)** — `start_date`+čas+`duration_min` → automaticky Dnes/Nadcházející/Kalendář(pruh)/oznámení.
3. **Přepis** — do `meetings.transcript` (sidecar); AI extrakce přes stávající `POST /api/meetings/extract`
   (Claude tool-use, přepis jako DATA, anti-injection).
4. **Akční body** — extrahované návrhy se po commitu zakládají jako **podúkoly hub-tasku** (`parent_id`) +
   `entity_links.derived_from` zpět na poradu.
5. **Follow-up** — „Naplánovat navazující" → nový hub-task (`series_id`/`prev_meeting_id`) + přenos otevřených akcí.

## Přehled dle termínů (modul Meets)

`SELECT tasks WHERE kind='meeting'` seskupené `dayBucket(start_date)` → **Dnes / Tento týden / Nadcházející /
Proběhlé**. Řádek = název, čas+délka, avatary účastníků (assignments), badge stavu, progres přípravy X/Y podúkolů.
Detail meetu = rozšířený TaskDetail modal se záložkami **Přehled | Příprava | Přepis(REST) | Akční body | Řetěz**.

## Surfacing ve Watsonu (termín se ukáže lidem) — ZADARMO

Hub JE task se `start_date` → Today, Nadchazejici, Calendar (časový pruh z T-času+duration), Nástěnka.
„Příslušným lidem" = účastníci jako **assignments** → sync přes členství v projektu (R5) + chip „Moje".
Radar: „Dnes 14:00 porada, příprava 3/5 hotová". Oznámení: nová větev „nadcházející meet dnes/zítra".

## Top funkce (wow)

1. **Kotva porady** — porada = plnohodnotný úkol, na který se vše váže; nikdy nespadne mimo radar (konkurence
   drží poradu jako oddělený přepis).
2. **Surfacing zadarmo** — termín porady žije ve stejném pozornostním toku jako úkoly, ne v odděleném kalendáři.
3. **Příprava jako přiřazené podúkoly s progresem** — deterministický signál „porada dnes, ale podklady chybí".
4. **Přepis → akční body s dohledatelností** — klik z úkolu otevře přepis, ze kterého vznikl.
5. **Řetěz porad s carryover** — weekly/1:1/sprint review nezačínají od nuly; nedodělky se táhnou; graf porad.

## Fáze stavby

- **Fáze 1 — Kotva + termín (jádro):** migrace `kind`+`meeting_id` (5 míst) + rozšířit meetings; akce „Nový meet"
  (hub-task + sidecar + entity_link); TaskItem odliší poradu; ověřit surfacing.
- **Fáze 2 — Příprava + přehled dle termínů:** rewrite /meets list; účastníci=assignments (R5!); příprava=podúkoly;
  detail meetu (záložky); filtr-chip „Porady" (default skrýt z běžných seznamů/counts/Velína).
- **Fáze 3 — Přepis → akční body + oznámení:** commit zakládá podúkoly hub-tasku; reminders + NotifCenter větev;
  sladit dvojí stav (porada proběhla vs úkol hotov).
- **Fáze 4 — Řetěz + reálné přílohy (volitelné):** navazující meet + carryover; pohled Série; blob attachments.

## Otevřená rozhodnutí (pro uživatele)

1. **Přepis offline?** meetings je server-only → přepis v detailu přes REST, offline nedostupný (termín/příprava/
   akce jsou na hub-tasku a syncují). Stačí online-on-demand, nebo přepis i offline (+1 synced tabulka)?
2. **Přílohy přípravy v1:** jen odkazy v comments (0 infra), nebo rovnou reálné soubory (efort L + offline outbox)?
3. **Znečištění seznamů:** `kind='meeting'` se míchá mezi úkoly. Default skrýt filtrem „Porady", vyhradit projekt
   „Porady", nebo obojí?
4. **Dvojí stav:** status porady vs task completed_at — mapovat na status_id, nebo držet odděleně a oddělit v UI?
5. **Follow-up:** lehké `prev_meeting_id`/`series_id` (Fáze 4), nebo plné chain_steps?
6. **RSVP účastníků** (invited/accepted/declined): lehký per-user overlay, nebo v1 jen assignments + „Moje"?
