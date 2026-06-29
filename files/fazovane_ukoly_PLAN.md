# Fázované úkoly („Postup") — plán implementace

> **Co to je:** návrhový a implementační plán nové funkce Watsona — **řetězce úkolů s návazností a předáváním mezi lidmi** (mikroprojekt, ne plnohodnotný projekt). Dokument navazuje na `MASTER_zakladni_stavebni_kamen.md` (§4 datový model, §11/§12 invarianty mají přednost) a `funkcni_specifikace_v2_build_ready.md`. Slouží jako (a) zadání pro **Claude Design** (viz `design/BRIEF_fazovane_ukoly.md`) a (b) build-ready spec pro pozdější kódování.
>
> **Stav:** návrh. Funkce je **v2-class** (staví na hotovém MVP jádru úkolů — krok 5: R2/R9/statusy). Navrhujeme teď, kódíme po uzavření MVP. Nic v MVP neblokuje.

---

## 0. Shrnutí v jednom odstavci

„Postup" je **uspořádaný řetězec úkolů**, kde **dokončení jednoho kroku automaticky aktivuje další** a předá štafetu dalšímu člověku. Každý krok je **plnohodnotný úkol** (využívá vše stávající — přiřazení R2, status/checkbox R9, komentáře, připomínky, prioritu, termín). Řetězec **není projekt** — žije *uvnitř* existujícího projektu jako lehká vrstva nad úkoly. Řetězce jdou vytvářet ručně i ze **šablon** (např. „Plakát na show"), s **auto-datováním od kotvy** (datum akce). Logika posunu je **serverová autorita** a **offline-bezpečná** (idempotentní, konvergentní). Funkce je navržena tak, aby **nesáhla na žádný invariant R1–R9** — je čistě aditivní a odstranitelná.

---

## 1. Produktový koncept

### 1.1 Příklad (kotevní scénář)

**Plakát na show** = řetězec 5 kroků, každý jiný člověk / jiný režim:

| # | Krok | Kdo (typicky) | Režim (R2) | Aktivace |
|---|------|---------------|------------|----------|
| 1 | Udělat návrh plakátu | grafik | `single` | hned (start řetězce) |
| 2 | Poptávka do tisku | produkce | `single` | po dokončení #1 |
| 3 | Zadat do tisku | produkce | `single` | po dokončení #2 |
| 4 | Vyzvednout tisk | kdokoli z týmu | `shared_any` | po dokončení #3 |
| 5 | Pohlídat platbu faktury | účetní | `single` | po dokončení #4 |

Dokud #1 neodklikne grafik, kroky #2–#5 **existují, ale jsou „spící"** (vidět jen v pohledu Postupu, ne v „Dnes"). Po odkliknutí #1 se #2 **rozsvítí** produkci do „Dnes" + přijde upozornění „Přišlo na tebe". A tak dál až k faktuře.

### 1.2 Dvě varianty „návaznosti" (a kterou stavíme)

Uživatel popsal dvě věci: *„zobrazí se úkol někomu jinému"* nebo *„změní se jeho systematika"*.

- **A) Řetězec samostatných úkolů (STAVÍME).** Každé předání = vlastní úkol s vlastní historií, komentáři, dokončením a odpovědnou osobou. Přesně sedí na příklad plakátu. Čisté pro audit, R2/R9 fungují beze změny.
- **B) Jeden úkol, který se „přepíná" mezi lidmi (NEDOPORUČUJEME jako primární).** Tatáž entita by měnila přiřazení/stav skrz fáze. Rozbíjí to historii (kdo co dokončil), kolidovalo by s R9 (jedno `completed_at` pro víc fází) a hůř se reportuje. Lze ji vyjádřit jako řetězec varianty A se sdíleným kontextem; samostatný „stage" model si neschvalujeme.

> **Pointa:** „mikroprojekt = řetězec úkolů" (A) drží invarianty čisté a dává každému předání vlastní stopu. Variantu B vědomě zamítáme.

### 1.3 Terminologie a název

- **Produktový název (CZ, UI):** **„Postup"** (proces *i* posun vpřed; sedí na klidný-profesionální tón). Popisně: *řetězec úkolů*. Alternativa s lidskou jiskrou: **„Štafeta"** (metafora předávání kolíku) — k rozhodnutí v designu.
- **Kódové entity (EN, dle stávající konvence Task/Dependency/Milestone):** `Chain`, `ChainStep`, `ChainTemplate`, `ChainTemplateStep`.
- **Krok = úkol.** „Krok Postupu" není nový typ entity v UI — je to úkol s kontextem řetězce.

---

## 2. Soulad s invarianty R1–R9 (klíčová sekce — „neruš systematiku")

Funkce je navržena tak, aby každý invariant **platil beze změny**. Nejde o výjimku z pravidel, ale o vrstvu nad nimi.

| Invariant | Jak se ho Postup dotýká | Řešení (bez narušení) |
|---|---|---|
| **R1** úkoly max 3 úrovně + checklisty | Řetězec **NENÍ hierarchie.** Kroky jsou **sourozenecké úkoly** spojené řazením, ne podúkoly. | Postup modelujeme jako *vedlejší vrstvu* (`chains`/`chain_steps`), **ne** přes `parent_id`. Krok-úkol může mít vlastní podúkoly/checklisty (svůj vnitřní rozpad). Hloubka řetězce ≠ hloubka úkolu. |
| **R2** režimy přiřazení (single/shared_any/shared_all) | Každý krok přiřazujeme jedné/více lidem — přesně to, co uživatel chce. | **Plně přebíráme R2.** Krok = úkol s `assignment_mode`. „Stačí jeden" = `shared_any`, „každý zvlášť" = `shared_all`. Žádná nová logika dokončení. |
| **R3** podúkoly NIKDY nedokončí rodiče | Riziko záměny: „posun řetězce" vs „roll-up podúkolů" (REVIZE N3 varuje před přetížením slova „rodič"). | **Striktně oddělené mechanismy.** Posun řetězce reaguje **jen na vlastní `completed_at` krok-úkolu**, nikdy na jeho podúkoly. V kódu pojmenovat jednoznačně (`advanceChain` vs roll-up). |
| **R4** opakování (default od termínu, reset per-osoba) | Smí být krok opakovaný úkol? Smí se opakovat celý řetězec? | **Krok NESMÍ být opakovaný úkol** (matoucí). Opakování *celého* Postupu (plakát každý měsíc) = budoucí schopnost (naplánovaná instanciace nové instance). V první verzi funkce je řetězec jednorázový. |
| **R5** row-level oprávnění, jen přednastavené role | Předání „někomu jinému" — ten musí úkol vůbec dostat (sync scoping dle členství v projektu). | Řetězec žije v **jednom projektu**; všechny krok-úkoly patří do něj → automaticky scopováno. **Tvrdá podmínka:** přiřazený dalšího kroku **musí být člen projektu** (jinak se mu úkol nesyncne). Viz §6. |
| **R6** barva ≠ priorita | Stav kroku (spící/aktivní/hotovo) nesmí být kódován barvou priority. | Stav kroku zobrazujeme **vlastními indikátory** (odznak „2/5", štítek čeká/teď/hotovo, ikona štafety) — nezávisle na P1–P4 a na uživatelské barvě. |
| **R7** štítky globální, skryté hostům | Postupy = interní procesní vrstva. | Postupy a šablony jsou **interní, hostům skryté** (jako interní štítky). Host nikdy nevidí strukturu řetězce. |
| **R8** osobní inbox | Aktivní krok se má „objevit dalšímu člověku". | Aktivace kroku = úkol naskočí do **„Dnes"/inboxu** přiřazeného (stávající chování) + upozornění. Postup může běžet i v osobním prostoru (sólo proces), ale předání mezi lidmi vyžaduje sdílený projekt. |
| **R9** checkbox ↔ stav „Hotovo" provázané | Co je spouštěč posunu? | Spouštěč = `task.completed_at` přejde z null na hodnotu. Protože R9 provazuje checkbox i přesun do stavu „Hotovo", **oba** způsoby spustí posun konzistentně. |

> **Závěr:** Postup je **aditivní modul**. Tabulka `tasks` zůstává nedotčená (žádné nové sloupce v jádru). Kdyby se funkce vyřadila, smaže se pár tabulek a nic v MVP se nerozbije.

---

## 3. Datový model

Konvence dodrženy: jediný UUID PK `id` (požadavek PowerSync), přirozené klíče přes unique indexy, enumy odvozené z `@watson/shared` (jeden zdroj pravdy), `createdAt()/updatedAt()` helpery, snake_case sloupce / camelCase TS, relativní importy bez `.js`.

### 3.1 Nové enumy (do `packages/shared/src/invariants.ts` → pak `enums.ts`)

```ts
/** Stav běžící instance Postupu. */
export const CHAIN_STATES = ["active", "done", "canceled", "on_hold"] as const;

/** Stav jednoho kroku (serverem autorovaný gating). */
export const CHAIN_STEP_STATES = ["dormant", "active", "done", "skipped"] as const;

/** Jak se krok aktivuje. */
export const CHAIN_GATES = ["after_previous", "with_previous", "manual"] as const;
//  after_previous = rozsvítí se po dokončení předchozího kroku (default, „auto")
//  with_previous  = běží paralelně s předchozím (větvení / souběh)
//  manual         = zůstává spící, dokud ho někdo ručně nespustí

/** Základ pro výpočet termínu kroku při auto-datování. */
export const CHAIN_DUE_BASIS = ["from_anchor", "from_activation", "from_prev_done"] as const;
```

### 3.2 Tabulky (`packages/db/src/schema/chain.ts` — nový soubor)

**`chain_templates`** — znovupoužitelná definice procesu.
```
id, workspace_id (FK workspaces, cascade),
name, description,
anchor_label (varchar, např. „Datum show"; nullable),
created_by (FK users, set null), archived_at (nullable),
created_at, updated_at
```

**`chain_template_steps`** — kroky šablony.
```
id, template_id (FK chain_templates, cascade),
position (int), name, description,
default_assignee_id (FK users, nullable; null = přiřadit při běhu),
default_assignment_mode (assignment_mode enum, default 'single'),
gate (chain_gate enum, default 'after_previous'),
due_offset_days (int, nullable), due_basis (chain_due_basis enum, default 'from_anchor'),
priority (int 1–4, nullable),
checklist_json (text/jsonb, nullable),  -- volitelné šablonové checklist položky
unique(template_id, position)
```

**`chains`** — běžící instance.
```
id,
project_id (FK projects, cascade),         -- KDE řetězec žije (scoping R5)
workspace_id (FK workspaces, cascade),     -- denormalizováno pro sync/audit
template_id (FK chain_templates, set null; nullable = ad-hoc bez šablony),
name, description,
anchor_date (timestamptz, nullable),       -- „datum show" pro auto-datování
state (chain_state enum, default 'active'),
created_by (FK users, set null),
completed_at (timestamptz, nullable),
created_at, updated_at
index(project_id)
```

**`chain_steps`** — kroky běžící instance; každý ukazuje na reálný úkol.
```
id,
chain_id (FK chains, cascade),
task_id  (FK tasks, cascade),              -- skutečný úkol kroku (reuse R2/R9/komentáře…)
project_id (FK projects, cascade),         -- denormalizováno pro sync filtr (= chains.project_id)
position (int),
gate (chain_gate enum, default 'after_previous'),
step_state (chain_step_state enum, default 'dormant'),  -- ZDROJ PRAVDY o gatingu
activated_at (timestamptz, nullable),
created_at
unique(chain_id, position)
unique(task_id)                             -- jeden úkol = max jeden krok
index(project_id)
```

### 3.3 Proč stav kroku NENÍ sloupec v `tasks`

Zvažováno: přidat `chain_step_state` přímo na `tasks` kvůli levnému filtrování pohledů bez joinu. **Zamítnuto** — drží to `tasks` (srdce MVP) čisté a aditivní, vyhne se riziku rozjetí dvou stavových sloupců. Klientská SQLite umí join; pohledy filtrují přes `chain_steps`:

```sql
-- „Dnes" nikdy nezobrazí spící kroky:
SELECT t.* FROM tasks t
LEFT JOIN chain_steps cs ON cs.task_id = t.id
WHERE cs.step_state IS NULL OR cs.step_state IN ('active');
```

> Trade-off: jeden LEFT JOIN navíc v dotazech pohledů. Přijatelné; čistota systematiky vyhrává (kvalita > rychlost).

---

## 4. Engine posunu řetězce (jádro — offline-first)

> Tohle je nejrizikovější část, analogicky k „kroku 4" (sync) — **postavit a otestovat jako první**, ošklivě, mezi 2 klienty (jeden offline).

### 4.1 Materializace předem (klíčové rozhodnutí)

Při založení instance (ze šablony i ad-hoc) server **vytvoří VŠECHNY krok-úkoly hned**:
- Krok 1 (a případní `with_previous` na začátku): `step_state = 'active'` → viditelný, přiřazený, termín nastaven.
- Ostatní kroky: `step_state = 'dormant'` → existují v DB (celý řetězec je vidět v pohledu Postupu = *„co přijde"*), ale **skryté z „Dnes"/List/Board** a obvykle bez tlaku termínu.

> **Proč předem:** „vytvořit úkol až při dokončení" je *zápis*, který by se na dvou offline klientech mohl provést dvakrát (duplicitní další krok) a komplikuje vztahy mezi ještě nesynchronizovanými UUID. S materializací předem je **posun = jen překlopení stavu** `dormant → active` — idempotentní a LWW-bezpečné.

### 4.2 Spouštěč

Posun spouští **dokončení aktivního kroku** = `task.completed_at` přejde `null → hodnota`. To už respektuje R2:
- `single`/`shared_any` → nastaví první/kdokoli;
- `shared_all` → `task.completed_at` je odvozené, naskočí **až když mají všichni přiřazení hotovo**.

Tím se posun **automaticky** chová správně i u „každý zvlášť" (řetězec se pohne až po posledním člověku). R9 zajistí, že checkbox i přesun do stavu „Hotovo" spustí totéž.

### 4.3 Kde běží: serverová autorita

V souladu s konvencí „server = autorita". Dvě vrstvy:

1. **Synchronně v zápisové cestě** (`/api/sync/write`, dnes podporuje jen `tasks` — nutno zobecnit, viz §5.3): když PATCH nastaví `completed_at` na úkolu, který je aktivním krokem, ve **stejné transakci** zavolat `advanceChain(chainId)`.
2. **Worker (BullMQ — už v plánovaném stacku)** pro těžší vedlejší efekty: notifikace s tichými hodinami, fan-out role→členové (až bude A4), zakládání kalendářních událostí. Synchronní část jen překlopí stav + zapíše audit; zbytek reaguje na událost.

```ts
// pseudo — běží v transakci, se zámkem na řádku chains (FOR UPDATE)
async function advanceChain(chainId) {
  const steps = loadSteps(chainId).orderBy('position'); // se zámkem
  for (const step of steps) {
    if (step.step_state !== 'active') continue;
    if (!step.task.completed_at) continue;            // ještě není hotovo (R2)
    if (step.step_state === 'done') continue;          // idempotence
    markDone(step);                                    // active → done
    for (const next of nextStepsByGate(steps, step)) { // after_previous / with_previous
      if (next.step_state !== 'dormant') continue;     // už aktivní/hotovo → no-op
      activate(next);                                  // dormant → active, set activated_at
      computeDueDate(next, chain);                     // §7 auto-datování
      enqueueHandoffNotification(next);               // worker, respektuje tiché hodiny
      audit('chain.step.activated', next);
    }
  }
  if (allDone(steps)) closeChain(chainId);             // state = 'done', completed_at = now
}
```

### 4.4 Idempotence a konvergence

- Posun je **čistá funkce** stavu `(kroky, jejich completed_at)`. `dormant → active` je idempotentní; `activated_at IS NULL` guard brání dvojitým notifikacím.
- Server zpracovává zápisy **sériově per řetězec** (transakce + zámek řádku `chains`). I kdyby dva klienti nahlásili dokončení, výsledek je jediný posun.
- Žádná „create-on-complete" race, protože kroky existují předem.

### 4.5 Offline chování (explicitně dokumentovat)

Pokud dokončující je **offline**, dokončení čeká v jeho upload frontě. Posun nastane **až jeho zápis dorazí na server**. Další osoba uvidí svůj krok teprve po reconnectu dokončujícího. To je **inherentní vlastnost offline-first** (nelze předat úkol na cizí zařízení čistě offline — druhý ho dostane přes sync) a **přijímáme ji**. UI to má komunikovat (krok „čeká na dokončení a sync předchozího").

### 4.6 Znovuotevření / „rewind"

Když se aktivní/hotový krok **od-dokončí** (R9 uncheck) poté, co už další krok běží:
- **Default (doporučeno):** editorovi to **zablokovat s vysvětlením** („krok 2 už běží; pro vrácení použij Rewind"). **Manager** může explicitně „Rewind" → další kroky zpět na `dormant` (+ audit, + notifikace dotčeným).
- Brání chaosu z tichého rozpadu rozběhlého řetězce. → **ROZHODNUTÍ R-CH1** (default: blokovat editorovi, manager rewind).

---

## 5. Dopady na sync / PowerSync

### 5.1 Sync rules (`powersync/sync-config.yaml`)

Přidat do existujícího `user_projects` bucketu (scoping dle členství) data pro `chains` a `chain_steps` (mají `project_id`):
```yaml
data:
  - SELECT * FROM tasks       WHERE project_id = bucket.project_id
  - SELECT * FROM chains      WHERE project_id = bucket.project_id
  - SELECT * FROM chain_steps WHERE project_id = bucket.project_id
```
Šablony scopovat per workspace (nový bucket):
```yaml
  user_workspaces:
    parameters: SELECT workspace_id FROM memberships WHERE user_id = request.user_id()
    data:
      - SELECT * FROM chain_templates      WHERE workspace_id = bucket.workspace_id
      - SELECT * FROM chain_template_steps WHERE template_id IN
          (SELECT id FROM chain_templates WHERE workspace_id = bucket.workspace_id)
```
> Po změně pravidel `docker compose restart powersync` (pravidla se čtou při startu).

### 5.2 Klientské schéma (`apps/web/src/lib/powersync/AppSchema.ts`)

Přidat zrcadla tabulek `chains`, `chain_steps`, `chain_templates`, `chain_template_steps` (text PK přidává PowerSync; SQLite nemá bool/timestamp → text/integer, jak je u `tasks`).

### 5.3 Zobecnění zápisové cesty (`apps/api/src/powersync.ts`)

Dnes je natvrdo `if (body.table !== "tasks")`. Funkce vyžaduje **registr handlerů per tabulka** s row-level kontrolou (R5) a napojením `advanceChain` na PATCH `completed_at` u krok-úkolů. *Pozn.: tuto generalizaci bude MVP stejně potřebovat pro další tabulky (assignments, checklist_items…), takže to není dluh jen této funkce.*

---

## 6. Oprávnění (R5) a viditelnost

- **Kde žije:** řetězec = **jeden projekt**. Všechny krok-úkoly v něm → scoping přes `project_members` (stávající mechanismus).
- **Tvrdá podmínka — přiřazený musí být člen projektu.** Jinak se mu krok nesyncne ani s ním nemůže pracovat.
  - **Default:** při zakládání/editaci řetězce **validovat**, že všichni přiřazení (i u spících kroků) jsou členy projektu; jinak srozumitelná chyba.
  - **Volitelně (opt-in):** „Pozvat při aktivaci" — server při aktivaci kroku přidá přiřazeného jako `project_member` (role `editor`/`commenter`) + audit. → **ROZHODNUTÍ R-CH2.**
- **Kdo smí co:**
  - *Vytvořit/editovat/zrušit/rewind řetězec:* **manager** projektu.
  - *Dokončit svůj krok:* přiřazený (editor) — běžné chování úkolu.
  - *Tvořit/upravovat šablony:* **admin/manager** workspace.
- **Hosté:** Postupy ani šablony **nevidí** (interní procesní vrstva, R7-styl).

---

## 7. Šablony a auto-datování

- **Šablona → instance:** uživatel vybere šablonu („Plakát na show") → zadá **kotvu** (datum show) a potvrdí/upraví přiřazení (s validací členství) → server vytvoří `chain` + materializuje krok-úkoly (krok 1 aktivní, zbytek spící).
- **Auto-datování (A12 koncept):** termín kroku se počítá z `due_offset_days` + `due_basis`:
  - `from_anchor` — relativně ke kotvě (např. „návrh = kotva − 10 dní").
  - `from_activation` — relativně k okamžiku aktivace kroku (např. „vyzvednout do 2 dnů od aktivace").
  - `from_prev_done` — relativně k dokončení předchozího.
- **Náhled k potvrzení:** generované kroky + spočítané termíny ukázat **před uložením** (stejný „potvrdit náhledem" vzor jako quick add).
- **Ad-hoc řetězec:** lze postavit i bez šablony (přidávám kroky ručně). Volitelně „uložit jako šablonu".

---

## 8. Hraniční případy / „problematické věci" (vědomě vyjmenované)

| # | Situace | Doporučené řešení |
|---|---------|-------------------|
| 1 | Dvojí dokončení / offline race | Materializace předem + serverová autorita + idempotentní `advanceChain` (§4). |
| 2 | Přiřazený není člen projektu | Validace při zakládání; opt-in „pozvat při aktivaci" (§6, R-CH2). |
| 3 | Záměna posunu řetězce a roll-upu podúkolů (R3) | Oddělené mechanismy + názvosloví; posun reaguje jen na vlastní `completed_at` (§2, §4.2). |
| 4 | `shared_all` krok | Řetězec se pohne až po dokončení všemi (odvozené `completed_at` to řeší samo). |
| 5 | Opakování (R4) × řetězec | Krok nesmí být opakovaný; opakující se *řetězec* = budoucí schopnost (§2 R4). |
| 6 | Znovuotevření po posunu | Blokovat editorovi, manager „rewind" downstream (§4.6, R-CH1). |
| 7 | Přeskočení kroku | `step_state = 'skipped'` (manager); posun pokračuje, jako by byl hotový. |
| 8 | Zrušení celého řetězce | `chains.state = 'canceled'`; spící kroky → `skipped`/zrušit úkoly; audit. |
| 9 | Editace běžícího řetězce (vložit/smazat/přeřadit krok) | Povolit manageru; přepočítat pozice; neměnit už hotové kroky; audit. |
| 10 | Smazání krok-úkolu vs odebrání z řetězce | FK cascade `chain → chain_steps`, `step.task_id → cascade`. Smazat řetězec (hard) = smaže své vygenerované úkoly; *zrušit* = nechá je, označí. |
| 11 | Větvení / paralelní kroky | `gate = with_previous` (souběh). Plný DAG (AND/OR join víc předchůdců) = pozdější rozšíření. → R-CH3. |
| 12 | Notifikace předání | „Přišlo na tebe" přes stávající notifikační bránu — **respektuje ztlumení a tiché hodiny** (H5). |
| 13 | Termíny při aktivaci/instanci | Auto-datování dle `due_basis` (§7). |
| 14 | Reporting / úzká hrdla | Zaseknutý řetězec (aktivní krok po termínu) = bottleneck — podklad pro dashboardy/spolehlivost (I5) později. |
| 15 | Hosté | Postupy/šablony skryté hostům (§6). |
| 16 | „Dnes"/inbox | Aktivní krok ano; spící skryté (§3.3, §4.1). |
| 17 | AI úhel (volitelně) | AI navrhne řetězec z věty („udělej postup na plakát") → `AISuggestion` → potvrzení. V souladu s AI spec (návrh→schválení). v3. |
| 18 | Krok bez přiřazení | Povolit „nepřiřazeno, kdo vezme" (claim při aktivaci) — alternativa k pevnému přiřazení. → R-CH4. |

---

## 9. Fázování této funkce a pořadí stavby

**Zařazení do roadmapy:** **v2** (staví na MVP krok 5: úkoly/R2/R9/statusy + zobecnění zápisové cesty §5.3). Spojuje tři už plánované v2/v3 bloky do jednoho srozumitelného konceptu: **závislosti (A10), šablony s auto-datováním (A12), automatizace/vícekrokové workflow (H1/H2)**. Doporučení: dělat **jako jednu z prvních v2 funkcí** — má vysokou hodnotu pro reálné procesy týmu (plakát, epizoda, ples, grant).

**Pořadí stavby uvnitř funkce (riziko-first):**
1. **Schéma + migrace** (§3) + enumy do `@watson/shared`.
2. **Engine posunu + zobecnění zápisové cesty** (§4, §5.3) — *ošklivě, ale ověřit mezi 2 klienty (1 offline): jediný posun, žádné duplicity, žádná ztráta dat.* Toto je „krok 4" této funkce.
3. **Instanciace z šablony** + auto-datování (§7).
4. **Pohled instance Postupu + stavy kroků v existujících pohledech** (Dnes/List/Board) — z design tokenů (design lock).
5. **Builder šablon.**
6. **Notifikace předání** („Přišlo na tebe") přes notifikační bránu.
7. **Polish:** rewind, přeskočení, zrušení, editace běžícího řetězce, prázdné/loading/overdue stavy.

---

## 10. Akceptační kritéria (testovatelné)

1. Instanciace 5-krokového řetězce ze šablony: **jen krok 1 aktivní**, zbytek spící a **skrytý z „Dnes"**.
2. Dokončení kroku 1 (dle jeho R2 režimu) → **krok 2 se sám aktivuje**, naskočí přiřazenému #2 do „Dnes" + upozornění; krok 1 je v pohledu Postupu „hotovo".
3. `shared_all` krok: řetězec se pohne **až po dokončení všemi** přiřazenými.
4. **Dva klienti, jeden offline** dokončí krok → po reconnectu **přesně jeden posun**, další krok se objeví druhému; žádný duplicitní krok, žádná ztráta dat.
5. Přiřazení nečlena projektu **zablokováno** se srozumitelnou chybou (nebo pozvání dle R-CH2).
6. Znovuotevření po aktivaci downstream **blokováno**; manager **rewind** vrátí downstream na spící.
7. **Zrušení** řetězce → spící kroky zrušeny/skipnuty, audit zapsán.
8. **Hosté** Postupy nevidí.
9. Auto-datování: termíny kroků spočítány dle `due_basis`; **náhled k potvrzení** před uložením.
10. UI kompletně **CZ i EN**; audit zaznamenává `chain.step.activated/done`, `chain.created/canceled/rewound`.

---

## 11. Co předat do Claude Design

Samostatný brief: **`design/BRIEF_fazovane_ukoly.md`** (zkopírovat do Claude Design). Obsahuje obrazovky (pohled instance Postupu, builder šablon, varianty karty kroku, ošetření „Dnes"/inbox, založení řetězce s náhledem), nové komponenty (progress odznak „2/5", štítky stavu kroku, glyf štafety, ikony gate) a stavy (spící/aktivní/po termínu/hotovo/zrušeno) — vše v identitě Watsona (brass jen akcent, P1–P4 nebarevný odznak, vizuální odlišení R2, mobile-first, reálná česká data).

---

## 12. Otevřená rozhodnutí (s defaulty — neblokují návrh)

| # | Rozhodnutí | Default pro pokračování |
|---|------------|-------------------------|
| **R-CH1** | Znovuotevření po posunu | Blokovat editorovi; manager „rewind" downstream. |
| **R-CH2** | Nečlen jako přiřazený | Validovat (zakázat); opt-in „pozvat při aktivaci". |
| **R-CH3** | Větvení | v1 funkce = lineární + `with_previous` (souběh); plný DAG později. |
| **R-CH4** | Krok bez přiřazení | Povolit „nepřiřazeno, kdo vezme" (claim) vedle pevného přiřazení. |
| **R-CH5** | Název v UI | „Postup" (default) vs „Štafeta" — rozhodnout v designu. |
| **R-CH6** | Opakující se řetězec | Mimo v1 funkce; naplánovaná instanciace později. |
