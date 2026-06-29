# Logika prototypu — Postupy (štafeta) + Cíle + Projekty

> **Účel dokumentu.** Přesná, implementačně použitelná extrakce *veškeré* logiky tří domén z designového prototypu `design/handoff_watson/WatsonApp.dc.html` (jediná třída `class Component`, ~3268 řádků). Cílem je nic neztratit: každé rozhodnutí, vzorec, stav a hraniční případ z prototypu je zde zachycen s odkazem na řádek.
>
> **Zdroj pravdy = prototyp.** Kde se prototyp liší od plánu `files/fazovane_ukoly_PLAN.md`, je to **explicitně označeno** `⚠ ODCHYLKA OD PLÁNU`. Dle rozhodnutí uživatele (2026-06-29, viz `files/CLAUDE.md`) v takovém případě **vyhrává design (prototyp)**, ale rozdíl je vždy vyznačen, aby se rozhodlo vědomě.
>
> **Vědomá zjednodušení prototypu** jsou označena `▼ ZJEDNODUŠENÍ`. Prototyp běží na seedu bez backendu, „dnes" = **čtvrtek 25. 6. 2026**, datum kroků postupu je **legacy číslo dne v červnu 2026** (1–30), ne ISO — viz §1.2.
>
> **Produkční model** (cílový datový model, server-authored advance) je u každé funkce v bloku `■ IMPLEMENTACE`. Vychází z `fazovane_ukoly_PLAN.md` (tabulky `chains`/`chain_steps`, enumy v `@watson/shared`) a invariantů R1–R9.
>
> Odkazy na řádky jsou ve tvaru `L2483` = řádek 2483 v `WatsonApp.dc.html`.

---

## OBSAH

1. [Postupy / štafeta (flows)](#1-postupy--štafeta-flows)
2. [Cíle (goals)](#2-cíle-goals)
3. [Projekty (project model)](#3-projekty-project-model)
4. [Soulad s invarianty R1–R9 (souhrn)](#4-soulad-s-invarianty-r1r9-souhrn)
5. [Odchylky od `fazovane_ukoly_PLAN.md` (souhrn)](#5-odchylky-od-fazovane_ukoly_planmd-souhrn)
6. [Vědomá zjednodušení a mezery (souhrn)](#6-vědomá-zjednodušení-a-mezery-souhrn)

---

# 1. Postupy / štafeta (flows)

## 1.1 Datový model kroku (prototyp)

Krok postupu je **běžný úkol** v poli `tasks[]` s navíc těmito poli (viz seed `L2138–2142`, builder `L2550`):

| pole | typ | význam |
|---|---|---|
| `flowId` | string | identita postupu; všechny kroky téhož postupu sdílejí `flowId` (např. `'fl1'`) |
| `flowName` | string | název postupu (denormalizovaný na každém kroku) — `steps[0].flowName` je „pravda" |
| `stepIndex` | int (1-based) | pořadí kroku v postupu |
| `stepTotal` | int | celkový počet kroků (denormalizovaný) |
| `stepStatus` | enum | **`waiting` / `now` / `done` / `skipped`** — zdroj pravdy o gatingu kroku |
| `gate` | enum | **`auto` / `manual` / `parallel`** — jak se krok aktivuje (viz §1.4) |
| `handedOff` | bool | „právě bylo předáno na tebe" — vizuální příznak po aktivaci |
| `people[]` | string[] | přiřazení (id osob); prázdné = „kdokoli z týmu" |
| `assignMode` | `'any'` / `'all'` | R2 režim: `any`=`shared_any`, `all`=`shared_all` |
| `role` | string? | role-jmenovka místo konkrétní osoby (viz §1.11) |
| `priority` | 1–4 | priorita kroku (krok je plnohodnotný úkol) |
| `date` | int 1–30 / null | **legacy** den v červnu 2026 (NE ISO) — termín kroku |
| `dueLabel` | string | textový termín, počítán `deadlineFmt('2026-06-DD')` |
| `schedMode` | `'chain'` / `'anchor'` | režim přeplánování celého postupu (viz §1.7); denormalizován na každém kroku, čte se `steps[0]` |
| `flowAnchor` | int 1–30 | kotva (den) postupu — společná báze pro výpočet termínů |
| `anchorOffset` | int | offset kroku od kotvy (`date − flowAnchor`) |
| `gapDays` | int | mezera ode dne předchozího kroku (pro režim „Řetězec") |
| `skipWeekend` | bool | přeskakovat víkendy při přepočtu (denormalizováno, čte se `steps[0]`) |
| `remind` | bool | „připomenout, až na mě přijde řada" (jen pro `waiting` kroky aktuálního uživatele) |

> **Pozn. k denormalizaci:** prototyp drží `schedMode`, `flowAnchor`, `skipWeekend`, `flowName`, `stepTotal` na *každém* kroku a čte je z `steps[0]`. V produkci patří `schedMode`/`anchor`/`name`/`skipWeekend` na entitu `chains`, ne na úkol — viz `■ IMPLEMENTACE` v §1.

### Stavový model kroku (`stepStatus`)

```
waiting  → krok existuje, ale je „spící" (nezobrazuje se v Dnes; v pohledu Postupu vidět jako „Čeká")
now      → krok je aktivní, je na řadě, objeví se přiřazenému v Dnes/seznamech
done     → krok dokončen (jeho úkol má done=true)
skipped  → krok přeskočen (počítá se jako „hotový" pro účely posunu) — v prototypu se nastavuje jen rewindem ne, viz §1.9
```

Štítky stavů (UI), z `L1132`/`L2554`/`L2910`:
`{ waiting:'Čeká', now:'Teď na řadě', done:'Hotovo', skipped:'Přeskočeno' }`

> `⚠ ODCHYLKA OD PLÁNU.` Plán (`fazovane_ukoly_PLAN.md §3.1`) používá enum `CHAIN_STEP_STATES = ["dormant","active","done","skipped"]`. Prototyp používá **`waiting`/`now`/`done`/`skipped`**. Mapování: `waiting↔dormant`, `now↔active`. Sémantika je shodná. → V produkci doporučeno použít plánové názvy (`dormant`/`active`), ale **toto mapování zafixovat**.

---

## 1.2 Reprezentace času — legacy „den v červnu" (zásadní upozornění)

`▼ ZJEDNODUŠENÍ.` **Celá logika postupů pracuje s `date` = celé číslo 1–30 = den v červnu 2026**, NE s ISO datem. „Dnes" = **25**. Důsledky:

- `bucketFor(date)` (`L2531`) mapuje den → skupinu v seznamech:
  ```
  date==null  → { group:'inbox',    day:'inbox',    date:null }
  date < 25   → { group:'overdue',  day:'zpozdene', date }      // po termínu
  date === 25 → { group:'today',    day:'dnes',     date }
  date <= 28  → { group:'upcoming', day:'zitra',    date }
  date > 28   → { group:'upcoming', day:'pristi',   date }
  ```
- `_isWknd(d)` (`L2485`): `new Date(2026,5,d).getDay()` ∈ {0,6}. Víkend je tedy konkrétní červnové so/ne.
- `_nextWork(d)` (`L2486`): posune `d` dopředu, dokud není pracovní den (max +6, clamp na 30).
- Všechny termíny se clampují do **1..30** (`Math.max(1,Math.min(30,…))`).

> `■ IMPLEMENTACE.` V produkci je termín kroku reálný `due_date` (timestamptz) na úkolu kroku. „Overdue" = `due_date < now()`. Přeplánovací matematika z §1.7 se přepíše na práci s reálnými daty + auto-datování dle `due_basis`/`due_offset_days` (plán §7). Víkendový skip = posun na nejbližší pracovní den dle kalendáře.

---

## 1.3 Algoritmus posunu (`_advance`) — JÁDRO

Spouštěč i posun jsou v `toggleDone` (`L2482`) a `_advance` (`L2483`).

### 1.3.1 Spouštěč: dokončení aktivního kroku

`toggleDone(id)` při kliknutí na checkbox / „Dokončit krok":
1. Mapuje úkol: `done` se neguje; `status` `hotovo`↔`probiha`; **a pro kroky postupu** (`t.flowId`):
   `stepStatus: t.flowId ? (!t.done ? 'done' : 'now') : t.stepStatus` a `handedOff: false`.
   Tedy: odškrtnutí → `stepStatus='done'`; opětovné zaškrtnutí (un-done) → zpět na `'now'`.
2. Po update zavolá `tasks = this._advance(tasks, tg.flowId)` (`L2482`).
3. V callbacku `setState` zobrazí **toast „Předáno → X"**, kde `X = this._handoffTo` (jméno nově aktivovaného příjemce), pokud `wasFlowDone && this._handoffTo` (`L2482`).

> Idempotence / R9: posun reaguje **jen na `done`** vlastního krok-úkolu. R9 (checkbox ↔ stav „Hotovo") je v prototypu naplněno tím, že `toggleDone` mění `done` i `status` současně.

### 1.3.2 Vlastní `_advance(tasks, flowId)` — krok za krokem (`L2483`)

```
steps = tasks[flowId].sort(by stepIndex)
nowIdx = null
for i in steps:
    st = steps[i]
    if st.stepStatus in (done, skipped): continue
    priorDone = všechny steps[0..i-1] mají stepStatus in (done, skipped)
    if priorDone AND st.stepStatus=='waiting' AND (st.gate=='auto' OR gate==null):
        st.stepStatus = 'now'         // ROZSVÍTÍ se
        st.handedOff  = true
        _handoffTo = jméno první osoby st.people[0]  (nebo 'kdokoli z týmu')
        nowIdx = st.stepIndex
    if NOT priorDone: break            // předchozí ještě běží → konec
    if st not done/skipped AND st.gate=='manual': break   // ruční brána zastaví štafetu
```

**Klíčová pravidla z kódu:**
- Posun jde **lineárně od začátku**; jakmile narazí na nehotový krok, jehož předchůdci NEJSOU všichni hotoví, **přeruší** (`break`).
- **Auto brána (`auto`/null):** krok se rozsvítí (`waiting→now`), jakmile jsou všichni předchůdci hotoví.
- **Ruční brána (`manual`):** i když jsou předchůdci hotoví, krok **zůstane `waiting`** a smyčka se zastaví (`break`). Musí ho někdo posunout ručně (= odškrtnutím předchozího se NErozsvítí; rozsvítí se, až ho uživatel sám dokončí/aktivuje — v prototypu se „aktivuje" tím, že je to teď první nehotový s auto bránou, jinak čeká). *Pozn.: prototyp nemá explicitní „spustit ručně" tlačítko; manual krok se stane `now` jen pokud je dosažen a má `gate!=='manual'` — tj. manual fakticky **drží štafetu**, dokud se gate nezmění nebo se krok ručně nedokončí. Viz §1.4 a `▼ ZJEDNODUŠENÍ`.*
- Aktivace nastaví `handedOff=true` → v UI „Přišlo na tebe".

> **Pouze JEDEN krok `now` v lineárním postupu.** Smyčka rozsvítí první způsobilý `waiting` a dál pokračuje jen přes done/skipped; jakmile rozsvítí `now`, `priorDone` pro další je false → break.

### 1.3.3 `parallel` (souběh) — pozn.

Builder umí nastavit `gate='parallel'` (souběh ⇉, viz §1.4), ale **`_advance` větev pro `parallel` neimplementuje** — v podmínce rozsvícení je jen `gate==='auto'||gate==null`. Tedy `parallel` krok se v běhové logice prototypu chová jako neauto → **fakticky se sám nerozsvítí** (drží jako manual).

> `▼ ZJEDNODUŠENÍ.` Souběh je v prototypu **jen v builderu jako volba a vizuál**, běhová logika ho neumí. Plán to řeší `gate='with_previous'` (§3.1, R-CH3: v1 = lineární + souběh, plný DAG později).

### 1.3.4 Kaskáda po aktivaci (uvnitř `_advance`, jen režim „chain") — `L2483`

Po určení `nowIdx`, pokud `schedMode==='chain'`:
```
nb = nově aktivní krok (stepIndex==nowIdx)
if nb.date != null AND nb.date < 25:          // aktivní krok je „v minulosti" → posuň na dnes
    delta = 25 - nb.date
    nb.date = 25 ; day='dnes' ; group='today' ; overdue=false ; dueLabel=deadlineFmt('2026-06-25')
    tasks = _reflow(tasks, flowId, nowIdx)      // přepočti navazující kroky
    _cascadeMsg = 'Navazující kroky posunuty o N dní'   // toast (deklinace den/dny/dní)
```
Toast kaskády se zobrazí se zpožděním 60 ms (`setTimeout`). Tedy: **když na krok přijde řada až po jeho původním termínu, automaticky se posune na „dnes" a všechny navazující kroky se přepočtou** (přelití zpoždění). Děje se to jen v režimu „Řetězec", ne „Kotva".

---

## 1.4 Brány (gates) — Auto → / Ruční ✋ / Souběh ⇉

Hodnoty `gate`: `'auto'` / `'manual'` / `'parallel'`.

**UI štítky** (builder `L3165`): `{ auto:'Auto →', manual:'Ruční ✋', parallel:'Souběh ⇉' }`
**Detail postupu** „aktivace:" (`L2554`, `gl`): `{ auto:'automaticky', manual:'ručně', parallel:'souběžně' }`
Cyklus v builderu (`cycleFlowStepGate`, `L2545`): `auto → manual → parallel → auto`.

| gate | sémantika (běhová) | sémantika (zamýšlená/plán) |
|---|---|---|
| `auto` (→) | rozsvítí se sám po dokončení všech předchůdců | `after_previous` |
| `manual` (✋) | **zastaví štafetu** — `_advance` udělá `break`; krok čeká na ruční dokončení | `manual` |
| `parallel` (⇉) | jen UI; běhově se nerozsvítí (viz §1.3.3) | `with_previous` (souběh) |

> `⚠ ODCHYLKA OD PLÁNU.` Plánové enumy: `CHAIN_GATES = ["after_previous","with_previous","manual"]`. Mapování: `auto↔after_previous`, `parallel↔with_previous`, `manual↔manual`. Pojmenování sjednotit v produkci na plánové.

---

## 1.5 Spící kroky se neukazují v „Dnes"

Kroky se `stepStatus` ≠ `now` (typicky `waiting`) **mají termín v budoucnu** a tím spadnou do `upcoming`/`pmonth`, nikoli do `today`. Materializace v seedu: krok 1 `done`, krok 2 `now` (day=`dnes`), kroky 3–5 `waiting` (day=`pristi`/`pmonth`) — `L2138–2142`.

Navíc „Tvůj další krok v postupech" (Dnes dashboard, `myFlowSteps` `L3156`) ukazuje **jen kroky `stepStatus==='now'` přiřazené aktuálnímu uživateli** (`(people||[]).includes('ak')`), s informací „pak předáš → X" (`blocking` = příjemce následujícího kroku).

> `■ IMPLEMENTACE.` Plán (§3.3) to řeší serverovým gatingem: pohled „Dnes" filtruje `WHERE cs.step_state IS NULL OR cs.step_state IN ('active')`. Spící (`dormant`) kroky existují v DB (celý řetězec vidět v pohledu Postupu), ale jsou skryté z Dnes/List/Board. Materializace předem — všechny kroky vytvořeny při založení (plán §4.1).

---

## 1.6 Pohled detailu postupu (`flowView`, `L2554`) + karta v přehledu (`flowsOverview`, `L3154`)

### Detail postupu (pravý/hlavní panel, šablona `L1090–1143`)
- **Hlavička:** název (`steps[0].flowName`), progres `done/total` (jen `done`, NE skipped — `L2554`: `done=steps.filter(stepStatus==='done').length`), progress bar `pct = round(done/total*100)` brass.
- **„Teď na řadě: <jméno>"** (`nowName`) — jméno osoby kroku `now` (nebo „kdokoli z týmu").
- **Odhad dokončení (ETA):** `eta = 'cca ' + max(steps.date) + '. 6.'` (`L2554`). `▼ ZJEDNODUŠENÍ` — jen nejpozdější den kroku, žádný výpočet trvání/pracovních dnů.
- **„Uložit jako šablonu"** → `saveFlowAsTemplate` (§1.10).
- **Plánování:** přepínač **Řetězec / Kotva** (`onChain`/`onAnchor`, §1.7), tlačítka **−1 d / +1 d** (`shiftFlow(±1)`, §1.8), chip **Bez víkendů** (`toggleFlowWeekend`).
  - Tooltip Řetězec: „Termíny se počítají z předchozího kroku — zpoždění se přelévá dál."
  - Tooltip Kotva: „Pevné termíny ke kotvě — zpoždění se nepřelévá."
  - Hint Řetězec: „Když se krok zpozdí, navazující se posunou automaticky."
  - Hint Kotva: „Termíny jsou pevné. Zpoždění se nepřelévá — Watson označí ohrožený konec."
- **Časová osa kroků** (`L1116–1142`): číslo kroku (barva dle stavu `data-stepdot`), **avatarová štafeta na spojnici** (`data-relayav`, iniciály *dalšího* příjemce, tooltip „předá → <jméno>"), karta kroku s: název, avatar+jméno přiřazeného, štítek P{priority}, termín (mono), štítek stavu, „aktivace: {gate}", a akce:
  - `now` → tlačítko **„Dokončit krok"** (brass).
  - `done` → **„↩ Vrátit sem"** (rewind, dvoufázové potvrzení „Opravdu vrátit" / „Zrušit"), `canRewind: sk==='done'`.
  - `waiting` + přiřazen aktuálnímu uživateli → chip **„Připomenout"** (`remindStep`), `canRemind: sk==='waiting' && people.includes('ak')`.

### Karta postupu v přehledu „Postupy" (`flowsOverview`, `L3154`)
- `done = steps.filter(stepStatus==='done' || done).length` (zde počítá i `done` flag).
- **Detekce úzkého hrdla (bottleneck):** `stuck = !!(now && (now.overdue || now.group==='overdue'))` — postup „vázne", když je aktivní krok po termínu. Pak je progress bar **červený** (`var(--overdue)`) a štítek `stuckLabel: 'Vázne — aktivní krok po termínu'`.
- `nowWho` = jména všech přiřazených aktivního kroku.
- `mine` = aktivní krok je můj.
- Řazení karet: `flowsSorted` = `(b.stuck-a.stuck) || (b.pct-a.pct)` — **váznoucí nahoře**, pak dle progresu (`L3155`).

### Filtr „jen kde jsem na řadě" (`flowMineOnly`, šablona `L778`)
Chip „Jen kde jsem na řadě" přepíná `flowMineOnly`; filtruje karty na `mine===true`. (Handler `toggleFlowMine`.)

> `■ IMPLEMENTACE.` Bottleneck / spolehlivost → plán hraniční případ #14 (I5): zaseknutý řetězec = podklad pro dashboardy později. ETA i „stuck" počítat serverově z reálných termínů.

---

## 1.7 Přeplánování: režimy „Řetězec" vs „Kotva" (`_reflow`, `L2487`) — MATEMATIKA

`_reflow(tasks, flowId, fromIdx)` přepočítá termíny (`date`) kroků. `mode = steps[0].schedMode || 'chain'`, `skip = !!steps[0].skipWeekend`, `base = fromIdx ?? 0`, `cl(d)=clamp(d,1,30)`.

### Režim „Kotva" (`anchor`)
**Pevné termíny ke kotvě, zpoždění se NEpřelévá:**
```
pro každý krok:  date = clamp( flowAnchor + anchorOffset )
```
Tedy každý krok = kotva + jeho pevný offset. Žádná závislost na předchozím. (Víkendový skip se v anchor větvi NEAPLIKUJE — kód ho má jen v chain větvi.)

### Režim „Řetězec" (`chain`, default)
**Termíny se počítají z předchozího kroku, zpoždění se přelévá:**
```
prev = null
pro každý krok (si = stepIndex):
    if si <= base OR prev == null:
        date = (krok.date != null) ? krok.date : clamp(flowAnchor + anchorOffset)   // kotvící/už hotové kroky drží svůj den
    else:
        date = prev + gapDays           // navazující krok = předchozí + mezera
    date = clamp(date)
    if skip AND si > base: date = _nextWork(date)   // přeskoč víkend
    prev = date
```
Klíč: kroky s `stepIndex <= base` (už proběhlé / kotvící) si **drží svůj den**; každý další se posadí na `prev + gapDays`, takže když se jeden krok posune, **všechny následující se posunou s ním** (kaskáda). `gapDays` se ustaví při založení (rozdíl offsetů sousedů, `L2550`) nebo v `_normFlows` (`L2484`).

### Po přepočtu (obě větve)
Pro každý změněný krok: `bucketFor(date)` → `date/day/group`, `dueLabel=deadlineFmt`, a
`overdue = (date < 25) && stepStatus != 'done' && stepStatus != 'skipped'`.

> `■ IMPLEMENTACE.` Produkční ekvivalent:
> - **Kotva** = auto-datování `due_basis='from_anchor'`, `due_offset_days` per krok; `anchor_date` na `chains`.
> - **Řetězec** = `due_basis='from_prev_done'`/`from_activation` s mezerami; přepočet navazujících při zpoždění (cascade) běží serverově. Plán §7 (auto-datování) + §4.3 (advanceChain v transakci).
> - „Bez víkendů" = business-day kalkulace.

---

## 1.8 Posun celého postupu (`shiftFlow`, `L2488`) a přepínač režimu (`setFlowSched`, `L2489`)

- **`shiftFlow(delta)`** (`±1 d`): posune **každý** krok o `delta` dní (`date+delta`, clamp 1..30), upraví `flowAnchor += delta`, přepočte bucket + `overdue`. Uloží předchozí stav do `_hist` (undo). *Nepoužívá `_reflow`* — posouvá doslova všechny dny.
- **`setFlowSched(mode)`**: nastaví `schedMode` na všech krocích, pak `_reflow(tasks, fid, 0)`. Tj. přepnutí na „Kotva" přepočte termíny pevně ke kotvě; na „Řetězec" je přepočte řetězově.
- **`toggleFlowWeekend()`** (`L2490`): přepne `skipWeekend` na všech krocích, pak `_reflow(…, 0)`.

`_normFlows(tasks)` (`L2484`): při inicializaci dopočítá chybějící `schedMode='chain'`, `flowAnchor` (= den 1. kroku nebo 25), `anchorOffset` (`date−anchor`), `gapDays` (mezera od předchozího). Zajišťuje, že seed bez těchto polí je konzistentní.

---

## 1.9 Rewind / znovuotevření (`rewindStep`, `L2555`; `askRewind`/`cancelRewind`, `L2492–2493`)

Dvoufázové (UI): „↩ Vrátit sem" → `askRewind(id)` nastaví `pendingRewind=id` → zobrazí „Opravdu vrátit" (`rewindStep`) + „Zrušit" (`cancelRewind`).

`rewindStep(id)` (`L2555`): pro krok na `idx = stepIndex`:
```
pro každý krok stejného flowId:
    ti < idx  → beze změny (předchozí kroky zůstanou hotové)
    ti == idx → stepStatus='now', done=false, handedOff=true     // vrácený krok je opět aktivní
    ti  > idx → stepStatus='waiting', done=false, handedOff=false // všechny navazující zpět na spící
```
Tj. „vrátit řetězec sem" = tento krok znovu aktivní, vše za ním zpět do `waiting`.

> `⚠ ODCHYLKA / POZN. K PLÁNU.` Prototyp **rewind nijak neomezuje rolí** — kdokoli může vrátit hotový krok (tlačítko je u každého `done` kroku). Plán (R-CH1, §4.6) chce: **editorovi to zablokovat**, rewind smí jen **manager**, s auditem a notifikací. **V produkci platí plán** (server-side oprávnění), prototyp je v tomhle volnější (chybí role).
>
> Pozn.: `skipped` stav existuje v UI štítcích, ale **prototyp ho nikde nenastavuje** (přeskočení kroku není ve flowView jako akce). Plán ho používá (manager skip, hraniční případ #7). `▼ ZJEDNODUŠENÍ` — přeskočení kroku v prototypu chybí.

---

## 1.10 Builder postupu

### A) Z šablony i prázdně — modal „Nový postup" (`openFlowModal`, `L2532`; `createFlow`, `L2546`; šablona `L1511–1599`)

**Draft (`flowDraft`):** `{ name, project, anchor, schedFrom:'start'|'deadline', steps:[], tpl }`. Výchozí projekt = první v aktivním workspace.

**Šablony** (`FLOW_TEMPLATES`, `L2501–2530`) — 4 vestavěné: **Plakát na akci**, **Nová epizoda podcastu**, **Příprava plesu**, **Žádost o grant**. Každý krok šablony: `{ name, who, offset, priority, gate, mode }`. Výběr šablony (`pickFlowTemplate`, `L2534`) zkopíruje kroky do draftu; „Začít prázdně" (`flowBlank`, `L2535`) = jeden prázdný krok.

**Editace kroků** (šablona `L1563–1589`):
- název (`setFlowStepField(i,'name')`), pořadí ↑/↓ (`moveFlowStep`), smazat ×, přidat krok (`addFlowStep` — offset = předchozí+1).
- **Lidé** (avatary, toggle `setFlowStepWho`) — vybráním role/osoby se přepíná (klik na vybraného = zruší, `who=null`).
- **Role** (chips `FLOW_ROLES` `L2500`: Grafik, Produkce, Účetní, Vedoucí; `who='role:grafik'` apod.) — „člověk se dosadí při založení".
- **Režim R2** (`toggleFlowStepMode`): „Stačí kdokoli" (`any`) ↔ „Každý zvlášť" (`all`).
- **Brána** (`cycleFlowStepGate`): Auto → / Ruční ✋ / Souběh ⇉.
- **Projekt kroku** (select `setFlowStepField(i,'project')`) — **předání mezi projekty** (viz §1.12).
- **Offset** „kotva + N" (`onOffset`) → živě počítá `dateLabel = (anchor+offset)+'. 6.'`.
- **Priorita** P1–P4.

**Plánování od začátku vs zpětně od termínu** (`setFlowSchedFrom`, `L2538`):
- `schedFrom='start'`: `anchor` = den startu (default 25); „První krok začne v tento den." `anchorLabel='Kotva — den (červen)'`.
- `schedFrom='deadline'`: `anchor` = 30 default; „Poslední krok padne na tento den; ostatní se spočítají pozpátku." Při zakládání: `_maxOff = max(offset)`; **`anchor_eff = clamp(anchor − maxOff)`** → z deadline se odečte největší offset, takže poslední krok dosedne na zadaný termín. (`createFlow` `L2548`, náhled `L3161`.)

**`createFlow`** (`L2546`): guard `name && steps.length` (jinak zavře). Pro každý krok vytvoří úkol (`L2549–2552`):
```
date = clamp(anchor_eff + offset)
isRole = who startsWith 'role:'  → roleName z FLOW_ROLES, people=[]
else people = [who]  (nebo [] když prázdné)
úkol = { id:'fl<ts>_<i>', name||'Krok i', project: step.project||draft.project, priority,
         group/day/date (bucketFor), assignMode:mode, people, role,
         flowId, flowName, stepIndex:i+1, stepTotal:total,
         stepStatus: i===0 ? 'now' : 'waiting',           // POUZE 1. krok aktivní
         gate, handedOff:(i===0),
         anchorOffset:offset, gapDays:(i? offset−offset[i-1] : 0), flowAnchor:anchor_eff,
         schedMode:'chain', skipWeekend, dueLabel }
if mode==='all' && people.length: úkol.aTotal=people.length; peopleDone={}; aDone=0   // R2 shared_all příprava
```
Vloží kroky na začátek `tasks` a `boardOrder`, přepne na obrazovku `postupy`, otevře nový postup. Uloží do `_hist` (undo).

**Validace vytvoření:** `canCreate = name.trim() && steps.length>0` (`L3175`). Footer: „N kroků · štafeta se rozjede od 1. kroku".

### B) Z běžícího postupu — uložit jako šablonu (`saveFlowAsTemplate`, `L2495`)

Z aktuálního postupu vytvoří šablonu: `base = steps[0].date||1`; každý krok → `{ name, who:people[0], mode:assignMode, gate, offset:(date−base), priority }`. Přidá na začátek `FLOW_TEMPLATES`, toast „Uloženo jako šablona: <label>". Tím lze **běžící postup zachovat jako šablonu** pro příště.

> `■ IMPLEMENTACE.` Produkce: tabulky `chain_templates` + `chain_template_steps` (plán §3.2), instanciace ze šablony se zadáním kotvy + validací členství + **náhledem k potvrzení** (plán §7). Auto-datování přes `due_offset_days`+`due_basis`. „Uložit běžící jako šablonu" = export `chain` → `chain_template`. Role → člen se dosadí při běhu (`default_assignee_id NULL` = přiřadit při běhu).

---

## 1.11 Role místo konkrétních lidí

V builderu lze místo osoby přiřadit **roli** (`FLOW_ROLES`, `who='role:*'`). V `createFlow` se role uloží do `task.role` (jméno), `people` zůstane prázdné. V detailu (`flowView`, `L2554`): když není osoba ale je role → `whoInitials='◇'`, `whoName='Role: '+role`. Tooltip v builderu: „Přiřadit roli — člověk se dosadí při založení".

> `▼ ZJEDNODUŠENÍ.` Prototyp roli jen zobrazí jako jmenovku; **nedosazuje** konkrétního člověka (žádný fan-out role→členové). Plán: fan-out role→členové = budoucí (A4), poznámka u §4.3.

---

## 1.12 Předání mezi projekty (handoff between projects)

Každý krok má vlastní `project` (builder select `L1577`, tooltip „Projekt kroku — předání mezi projekty"). `createFlow` použije `step.project || draft.project`. Tedy **jednotlivé kroky téhož postupu mohou žít v různých projektech** — štafeta může „přejít" z projektu do projektu.

> `⚠ ODCHYLKA OD PLÁNU.` Plán (§6) říká: **řetězec žije v jednom projektu** (kvůli scopingu R5 — všechny krok-úkoly v jednom projektu → automaticky scopováno přes `project_members`). Prototyp povoluje **per-krok projekt** (handoff mezi projekty). To je **bohatší** než plán a koliduje s plánovým scopingem.
> **Rozhodnutí k zaznamenání:** design vyhrává (per-krok projekt zachovat jako cíl), ALE produkčně to vyžaduje: (a) `chain_steps.project_id` per krok (ne jen denormalizace `chains.project_id`), (b) sync scoping přes projekt *každého kroku* zvlášť, (c) tvrdou podmínku členství přiřazeného v projektu *toho kroku*. → Otevřené rozhodnutí navíc oproti R-CH1..R-CH6.

---

## 1.13 Klávesnice a další interakce postupů

- V detailu postupu **Enter** = dokončit aktuální `now` krok (`L2227`): najde `stepStatus==='now'` a zavolá `toggleDone`.
- **Připomenutí** (`remindStep`, `L2496`): toggle `remind` na kroku; jen pro `waiting` kroky aktuálního uživatele.
- **Připojení existujícího úkolu do postupu** (`flowAttach`, `L2471`): při vytváření běžného úkolu lze zvolit „Zařadit do postupu" → úkol se přidá jako nový poslední krok (`stepIndex=maxIdx+1`, `stepStatus = allDone ? 'now' : 'waiting'`, `gate='auto'`). Pokud je celý postup hotový, nový krok se rovnou rozsvítí (`handedOff=true`).
- Otevření postupu: `openFlow(fid)` (`L2498`), zavření `closeFlow` (`L2499`). Z palety/hledání: `searchFlow`.
- Karta úkolu nese **flow chip** (`L423`, `L2910`): glyf štafety, název, „tečkový" progres (`stepDotsNode`), `stepLabel = stepIndex/stepTotal`, štítek stavu; klik otevře postup.

---

## 1.14 Mapování stavů a undo

- **Undo zásobník** `_hist`: plní ho `shiftFlow`, `setFlowSched`, `toggleFlowWeekend`, `createFlow`, `triageSchedule` (push `state.tasks` před změnou).
- `_flowToast(msg)` = jednotný toast (Předáno → X / Posunuto na … / kaskáda / šablona uložena / cíl …).

---

# 2. Cíle (goals)

## 2.1 Datový model cíle (prototyp)

Seed `GOALS` (`L2110–2122`), nové `newGoals`. Pole:

| pole | význam |
|---|---|
| `id`, `name` | identita, název |
| `scope` | **`team` / `project` / `personal`** (+ v UI „person" pro lidský scope; viz níže) |
| `metric` | **`completion` / `ontime` / `count` / `project`** |
| `owner` | id vlastníka |
| `fProject` | filtr: projekt |
| `fPerson` | filtr: osoba |
| `fKeyword` | filtr: klíčové slovo (v názvu úkolu) |
| `target` | cílová úroveň (číslo nebo %) |
| `period` | textové období (např. „Q3 2026") |
| `dueLabel`, `dueDays` | termín (text + dní; `dueDays<0` = po termínu) |
| `elapsed` | % uplynulého času (pro „tempo") |
| `periodic` | `none`/`week`/`month`/`quarter`/`year` (resetovatelnost) |
| `ws` | workspace (jinak z `GOAL_WS`) |
| `projects[]` | (pro project metric) více projektů |
| `milestones[]` | (volitelné) milníky `{l, done}` |

**Scope×metric vazba** (`setGoalScope`, `L2337`): `scope==='project'` → `metric='project'`; jinak default `metric='count'`. Záložky scope: tým → `team`/`project`/`person`; osobní WS → jen `personal` (`GTABS`, `L3194`).

> `⚠ ODCHYLKA OD PLÁNU.` Cíle (OKR) jsou v `files/CLAUDE.md` zařazené do **v2** („OKR", „dashboardy"). `fazovane_ukoly_PLAN.md` cíle neřeší vůbec (je jen o postupech). Prototyp ale **cíle plně specifikuje** — produkční model cílů (tabulky) je tedy nový a vychází z této extrakce, ne z existujícího plánu.

---

## 2.2 Filtr a množina úkolů cíle (`goalTasks`, `L2360`)

```
goalTasks(g):
    ws = goalWs(g)
    T.filter(t =>
        wsOf(proj(t.project)) === ws            // jen aktivní workspace cíle
        && (!g.fProject || t.project === g.fProject)
        && (!g.fPerson  || t.people.includes(g.fPerson))
        && (!g.fKeyword || t.name.toLowerCase().includes(g.fKeyword.toLowerCase()))
    )
```
`goalFilterLabel` (`L2361`): textové shrnutí filtru („projekt X · jméno · „klíč"" nebo „celý prostor").

`taskOnTime(t)` (`L2359`): `t.done && (t.onTime ?? hash(t.id)%100 >= 22)` — `▼ ZJEDNODUŠENÍ`: bez reálného `completed_at` se „včasnost" odvozuje z hashe id (~78 % včas). V produkci = `completed_at <= due_date`.

---

## 2.3 Výpočet pokroku (`goalProgress`, `L2362–2367`) — PŘESNÉ VZORCE

`metric = g.metric || 'completion'`. Vrací `{ pct, real, target, met, label, sub, matchCount, metric }`. `pct` je vždy `min(100, …)`.

### 2.3.1 `project` — Stav projektu (`L2363`)
```
ids = g.fProject ? [g.fProject] : (g.projects || [])
w = 0, p = 0
pro pid in ids:
    c = projComputed(pid)         // viz §3.4 (efektivní pct/total projektu)
    w += c.total
    p += c.pct * c.total          // vážený průměr pct podle počtu úkolů
real = w ? round(p / w) : 0       // vážené % napříč projekty
tgt  = g.target || 100
pct  = min(100, round(real / (tgt||100) * 100))
met  = real >= tgt
label = real + ' % projektu' ;  sub = 'cíl ' + tgt + ' %'
matchCount = ids.length
```
**= vážený průměr „stavu" napojených projektů** (váha = počet úkolů projektu), normovaný na cílovou úroveň. Ručně se nezadává.

### 2.3.2 `count` — Počet hotových (`L2365`)
```
ts = goalTasks(g) ; done = ts.filter(done).length
tgt = g.target || 1
pct  = min(100, round(done / tgt * 100))
real = done ;  met = done >= tgt
label = done + ' / ' + tgt + ' hotových'
sub   = total + ' úkolů v hledáčku'   // total = ts.length
```
**= počet dokončených úkolů odpovídajících filtru proti cílovému počtu.**

### 2.3.3 `ontime` — Včasnost (`L2366`)
```
ts = goalTasks(g) ; done = ts.filter(done).length
onT = ts.filter(taskOnTime).length
real = done ? round(onT / done * 100) : 0
tgt  = g.target || 90
pct  = min(100, round(real / (tgt||90) * 100))
met  = done > 0 && real >= tgt
label = real + ' % včas'
sub   = onT + ' z ' + done + ' úkolů včas'
```
**= podíl včas dokončených z dokončených úkolů**, proti cílovému %.

### 2.3.4 `completion` — Dokončení (default, `L2367`)
```
ts = goalTasks(g) ; total = ts.length ; done = ts.filter(done).length
real = total ? round(done / total * 100) : 0
tgt  = g.target || 100
pct  = min(100, round(real / (tgt||100) * 100))
met  = total > 0 && real >= tgt
label = done + ' / ' + total + ' hotovo'
sub   = real + ' % dokončeno'
```
**= podíl hotových ze všech úkolů odpovídajících filtru**, proti cílovému %.

**Štítky metrik** (`METLABEL`, `L2357`): `completion:'Dokončení úkolů'`, `ontime:'Včasnost'`, `count:'Počet hotových'`, `project:'Stav projektu'`.
**Nápověda** (`METHELP`, `L2358`) — viz citace v `IMPLEMENTACE` níže (verbatim texty pro UI).

> Verbatim `METHELP`:
> - completion: „Podíl hotových úkolů ze všech, které cíli odpovídají. Plní se sám, jak úkoly odškrtáváte."
> - ontime: „Podíl úkolů dokončených včas (do termínu) z hotových. Počítá se z reálných úkolů."
> - count: „Počet dokončených úkolů, které cíli odpovídají, proti cílovému počtu."
> - project: „Postup napojeného projektu — průměr jeho úkolů. Ručně se nezadává."

---

## 2.4 Stav cíle a tempo (`goalStatus`, `L2368`; `GSTAT`, `L2369`)

```
goalStatus(pct, elapsed, overdue, done):
    if pct >= 100 || done   → 'done'    (Splněno, zelená)
    if overdue              → 'over'    (Po termínu, červená)     overdue = dueDays != null && dueDays < 0
    if pct < elapsed - 12   → 'risk'    (Ohrožený, brass)         tj. zaostává >12 b. za uplynulým časem
    else                    → 'track'   (Na cestě, modrá)
```
`GSTAT` mapuje na `[label, bg, ink, dotColor]`. „Tempo" text (`paceText`, `L3204`): u risk „Zaostává — X % hotovo, ale uplynulo Y % času.", u track „V tempu — postup drží krok s časem.".

> `■ IMPLEMENTACE.` Práh „risk" = `pct < elapsed − 12`. `elapsed` (% uplynulého času období) se v produkci počítá z reálných dat období (start..due vs now). „Splněno" může nastat i ručním `done` (binární cíl).

---

## 2.5 Cíl detail, úprava, reset období

- **`patchGoal(obj)`** (`L2335`): merge do `goalDraft` (jen koncept v modalu).
- **`createGoal`** (`L2345`): guard `name.trim()`. Sestaví cíl: `metric`, `target = parseInt||default` (count→10, project→100, jinak 90). Pokud `scope==='person'` a chybí `fPerson`, dosadí `owner`. Záložku odvodí z WS/scope. Toast „Cíl vytvořen".
- **Editace existujícího** přes `goalEdits` (override mapa): `goalMerged(g)` (`L2353`) přepíše `name`/`target` z editů. `adjGoalTarget(id,dir)` (`L2352`): krok `count`→±5 (max 100000), jinak ±1 (max 100). `onGoalName`, `toggleMilestone`, `setGoalDone`, `adjGoalCurrent`/`onGoalCurrent` (pro `measure==='number'`).
- **Reset období** (`resetGoalPeriod`, `L2346`): u periodických cílů vynuluje `current`/`milestones`/`done`; toast „Cíl obnoven na další období". UI tlačítko jen když `periodic && periodic!=='none'` (`PERIODIC_LABEL`, `L2331`).
- **Šablony cílů** (`GOAL_TEMPLATES`, `L2323–2330`): 6 vestavěných (odbavit úkoly Q, včas ≥90 %, faktury včas /klíč „faktur"/, docházky /„docház"/, týdenní penzum, dokončit projekt). `pickGoalTemplate` (`L2344`) předvyplní draft.
- **Detail** (`goalDetail`, `L3204`): ring (`ringNode`, `L2371`), badge stavu, hodnoty, **vzorek reálných úkolů** (`sampleTasks` — prvních 6 z `goalTasks`, každý se stavem otevřený/včas/pozdě), období, termín, milníky, periodicita.
- **Řádek cíle** v seznamech/reportech: `goalRowNode` (`L2370`) — název, label, pct, bar barvy stavu.
- **Watson insight** (Dnes): pokud existuje risk/over cíl → upozornění „Cíl „X" je ohrožený — P % hotovo, ale uplynulo E % času." (`L3122–3123`).

> Pole `measure` (`number`/`milestone`/`binary`/`rollup`) se v `resetGoalPeriod`/`goalDetail` čte, ale **seed ho nemá** — `▼ ZJEDNODUŠENÍ`/náznak rozšíření (ručně zadávané metriky). Hlavní cesta je 4 automatické metriky z §2.3.

> `■ IMPLEMENTACE.` Produkce — nová tabulka `goals` (workspace_id, scope, metric enum, owner, f_project/f_person/f_keyword, target, period, due, periodic enum, milestones jsonb) + výpočet `goalProgress` **serverově z reálných úkolů** (žádné hashe; `ontime` = `completed_at <= due_date`). „project" metric = vážený průměr stavu napojených projektů. Reset periodických cílů = job dle `periodic`.

---

# 3. Projekty (project model)

## 3.1 Datový model projektu (prototyp)

`PROJECTS` (`L2082–2099`), override přes `projEdits` (`proj(id)`, `L2243`). Pole:

| pole | význam |
|---|---|
| `id`, `name` | identita |
| `color` | hex barva projektu (tečka) |
| `kind` | **`flow` / `goal` / `cycle`** = typ projektu (viz §3.2) |
| `owner` | id vlastníka |
| `status` | **`active` / `paused` / `archive` / `done`** |
| `dueLabel`, `dueDays` | (jen goal/cycle) termín dodání + dní |
| `dod` | (jen goal/cycle) „definice hotového" |
| `fav` | oblíbený |
| `space` | `'personal'` pro osobní projekty |

`projMembers(id)` (`L2245`): override z `projEdits.members`, jinak odvozeno z `people` úkolů projektu. `toggleProjMember` (`L2380`).

## 3.2 Typy projektu: Průběžný / Cílový / Periodický (`flow` / `goal` / `cycle`)

Štítky (3 místa, shodně): `{ flow:'Průběžný', goal:'Cílový', cycle:'Periodický' }` (`STKIND` `L3179`, projDetail `L3132–3133`, KIND `L3072`).
Plný název v hledání (`L3072`): `flow:'Průběžný projekt'`, `goal:'Cílový projekt'`, `cycle:'Periodický projekt'`.

| kind | sémantika | termín+DoD? | progres |
|---|---|---|---|
| `flow` (Průběžný) | nikdy „nekončí", běžící agenda | NE | reálné `done/total` |
| `goal` (Cílový) | má cíl: **Termín dodání + Definice hotového** | ANO | viz `projComputed` níže |
| `cycle` (Periodický) | opakující se cyklus (uzávěrka, revize) | ANO (např. měsíční) | jako goal |

**Pole goal/cycle v detailu** (`showGoalFields = kind==='goal' || kind==='cycle'`, `L3132`): **Termín dodání** (`dueLabel`) a **Definice hotového** (`dod`) — šablona `L1249–1254`.

## 3.3 Detail projektu (pravý panel, `projDetail`, `L3129–3140`; šablona `L1220–1268`)

Editovatelné per `projEdits` (override, ne mutace seedu):
- **Název** (`onProjName`).
- **Barva** — výchozí + 10 (rose…slate; `setProjColor`, `L2374`). `colorNone` = výchozí (dědí barvu z `PROJECTS`).
- **Typ projektu** — segment flow/goal/cycle (`setProjKind`, `L2375`).
- **Vlastník** — avatary všech lidí (`setProjOwner`, `L2376`).
- **Stav** — segment Aktivní/Pozastavený/Archiv/Hotovo (`setProjStatus`, `L2377`).
- **(goal/cycle)** Termín dodání (`onProjDue`) + Definice hotového (`onProjDod`).
- **Členové** — toggle avatary (`toggleProjMember`).
- **Statistiky:** otevřené / hotovo / celkem (efektivní — viz §3.4).
- „Zobrazit úkoly projektu" → `goTo('seznam')`.

**Stav badge** (`STSTAT`, `L3180`): `active`['Aktivní', success-soft], `paused`['Pozastavený', panel-2], `archive`['Archiv', panel-2], `done`['Hotovo', success-soft].

## 3.4 Efektivní progres projektu (`projComputed`, `L2356`) a karta (`projektyView`, `L3181`)

```
projComputed(pid):
    pt = úkoly projektu ; done = hotové ; open = otevřené
    kind = proj(pid).kind || 'flow'
    h = hash(pid)
    doneEff = (kind != 'flow' && done==0 && open) ? round(open * (0.4 + (h%5)*0.11)) : done
    total = open + doneEff
    pct = total ? round(doneEff/total*100) : 0
    return { pct, total, doneEff, open }
```
> `▼ ZJEDNODUŠENÍ.` Pro **goal/cycle** projekty bez reálně hotových úkolů se „hotovo" **nasimuluje** z hashe (40–84 % otevřených), aby karty/cíle vypadaly živě. Pro `flow` se bere reálné `done`. V produkci = jen reálná data.

**Karta projektu** (`projektyView`, `L3181`): barva, typ (`typeLabel`), efektivní open/done/total + pct bar (brass), „týden hotovo"/„přidáno"/„po termínu" (z hashe — demo), sparkline (`tepNode`), stav badge (jen když ≠ active), termín dodání („do X · zbývá N dní", červeně když `dueDays<0`) jen goal/cycle, vlastník, první 4 členové. Zobrazeno max 6 projektů (`.slice(0,6)`).

## 3.5 Per-uživatel zobrazení projektu (per-user view settings)

`▼ ZJEDNODUŠENÍ / NÁZNAK.` README („Detail projektu") i `files/CLAUDE.md` (R6) říkají: **nastavení zobrazení projektu je per-uživatel** (barva úkolu, výchozí pohled). V prototypu:
- **Barva úkolu** je per-uživatel (README: „barvu vidí jen ten, kdo ji nastavil"; `data-tc` na kartě), barva *projektu* je sdílená.
- **Výchozí pohled / zámek zobrazení** je per-uživatel přes `navView`/persist (`localStorage`), ne na úrovni projektu samostatně řešeno v prototypu.
- Plné „každý si projekt zobrazí po svém" (per-user view) je **zamýšlené, ne plně implementované** v prototypu — `projEdits` je globální (sdílené úpravy projektu), per-user override pohledu chybí.

> `■ IMPLEMENTACE.` Produkce: `projects.type` (enum `flow`/`goal`/`cycle`), `status` enum, `owner_id`, `delivery_date`, `definition_of_done`, barva. Per-user view = separátní tabulka `project_view_settings (user_id, project_id, default_view, …)`. Členství přes existující `project_members` (R5). Statistiky počítat z reálných úkolů (žádné hashe).

---

# 4. Soulad s invarianty R1–R9 (souhrn)

| Invariant | Jak se domén dotýká (dle prototypu) | Stav |
|---|---|---|
| **R1** (max 3 úrovně) | Krok postupu = **sourozenecký úkol** s `flowId`, NE podúkol → hloubka řetězce ≠ hloubka úkolu. | ✅ OK (plán §2: modelovat jako vrstvu `chains`/`chain_steps`, ne `parent_id`). |
| **R2** (assignment_mode) | Krok má `assignMode` `any`/`all`; builder umí „Stačí kdokoli"/„Každý zvlášť"; `createFlow` připraví `aTotal/peopleDone` pro `all`. | ✅ OK. Posun u `shared_all` musí čekat na všechny (plán §4.2 — odvozené `completed_at`). Prototyp posouvá na `done` jednoho úkolu; produkce musí respektovat odvození. |
| **R3** (podúkoly nedokončí rodiče) | `_advance` reaguje **jen na `done` krok-úkolu**, ne na jeho podúkoly. | ✅ OK — oddělit `advanceChain` od roll-up (plán §2/§4.2). |
| **R4** (opakování) | `listTasks` (`L2654`) **vynechává kroky postupů z projekce výskytů** (`if(t.flowId) return`). Krok není opakovaný. | ✅ OK (plán: krok NESMÍ být opakovaný; opakující se řetězec = později). |
| **R5** (row-level oprávnění) | Prototyp nemá server/role pro postupy; rewind/edit nejsou omezené. **Per-krok projekt** komplikuje scoping (§1.12). | ⚠ Produkce musí doplnit: manager-only create/edit/rewind, členství přiřazeného v projektu kroku. |
| **R6** (barva = priorita) | Stav kroku (waiting/now/done) má **vlastní indikátory** (číslo, štítek, tečky, glyf štafety), NE barvu priority. Cíl/projekt stav = vlastní badge. | ✅ OK. |
| **R7** (štítky/skryté hostům) | Postupy = interní procesní vrstva; prototyp hosty neřeší. | ⚠ Produkce: postupy/šablony skrýt hostům (plán §6). |
| **R8** (osobní inbox) | Postup může běžet i v osobním prostoru; aktivní krok naskočí přiřazenému do Dnes. | ✅ OK. |
| **R9** (checkbox ↔ stav) | `toggleDone` mění `done` i `status` současně; posun spouští `done`. | ✅ OK (plán §4.2 — spouštěč `completed_at` null→hodnota). |

---

# 5. Odchylky od `fazovane_ukoly_PLAN.md` (souhrn)

> Design (prototyp) vyhrává; každou odchylku produkčně vědomě potvrdit.

1. **Názvy stavů kroku.** Prototyp `waiting`/`now`; plán `dormant`/`active`. → Sjednotit na plánové (`dormant`/`active`), zachovat sémantiku. (§1.1)
2. **Názvy bran.** Prototyp `auto`/`manual`/`parallel`; plán `after_previous`/`manual`/`with_previous`. → Plánové názvy. (§1.4)
3. **Předání mezi projekty (per-krok `project`).** Prototyp povoluje různý projekt na každém kroku; plán fixuje **jeden projekt na řetězec** (scoping R5). → **Nejvýznamnější rozdíl.** Design je bohatší; produkce musí rozšířit scoping na projekt každého kroku + validaci členství per krok. (§1.12)
4. **Rewind bez role.** Prototyp dovolí rewind komukoli, kdykoli, bez auditu; plán = manager-only + audit + notifikace (R-CH1). → Plán. (§1.9)
5. **Souběh (`parallel`) běhově neimplementován.** Prototyp ho má jen v builderu/vizuálu; plán = `with_previous` jako podporovaný v1. → Produkce doplní běhovou aktivaci souběžných kroků. (§1.3.3)
6. **Přeskočení kroku (`skipped`) chybí jako akce.** Štítek existuje, akce ne; plán = manager skip (hraniční #7). → Doplnit. (§1.9)
7. **Kaskáda jen „na dnes" + legacy dny.** Prototyp posouvá zpožděný aktivní krok na den 25 a přepočítává navazující dle `gapDays`; plán = auto-datování `due_basis` na reálných datech. → Přepsat na reálná data. (§1.3.4, §1.7)
8. **Materializace.** Prototyp vytvoří všechny kroky v `createFlow` hned (krok 1 `now`, zbytek `waiting`) — **shoduje se** s plánem „materializace předem" (§4.1). ✅ (žádný rozpor, jen potvrzení.)
9. **Cíle a typy projektu** plán neřeší vůbec (je jen o postupech). Prototyp je plně specifikuje → nový produkční model dle této extrakce (§2, §3). (Cíle jsou ve `files/CLAUDE.md` v2/OKR.)

---

# 6. Vědomá zjednodušení a mezery (souhrn)

**Zjednodušení (prototyp, `▼`):**
- Čas = legacy „den v červnu 2026" (1–30), ne ISO; „dnes"=25. (§1.2)
- ETA postupu = jen nejpozdější den kroku (`'cca DD. 6.'`), bez výpočtu trvání. (§1.6)
- „Včasnost" úkolů (`taskOnTime`) odvozena z hashe id, ne z `completed_at`. (§2.2)
- Efektivní progres goal/cycle projektů a „report" čísla nasimulovány z hashe, když chybí reálná data. (§3.4)
- Role na kroku se jen zobrazí, nedosadí konkrétního člověka (žádný fan-out). (§1.11)
- `parallel` brána a `skipped` stav: jen UI, bez běhové logiky. (§1.3.3, §1.9)
- `measure` (number/milestone/binary/rollup) cílů je naznačeno, ale seed jede na 4 automatických metrikách. (§2.5)
- Per-user view projektu: zamýšleno, `projEdits` je ale globální. (§3.5)
- Persistence = `localStorage`+seed; žádný server/oprávnění/notifikace.

**Mezery k doplnění v produkci:**
- Server-authored advance v transakci se zámkem řádku (idempotence, offline race) — plán §4.3–4.5.
- Oprávnění R5 pro postupy (manager create/edit/rewind/skip/cancel; přiřazený = člen projektu kroku).
- Notifikace předání „Přišlo na tebe" přes quiet-hours bránu (plán §6, H5).
- Skrytí postupů/šablon hostům (R7).
- Zrušení celého řetězce (`state='canceled'`, spící → skipped) — plán hraniční #8 (prototyp neumí).
- Editace běžícího řetězce (vložit/smazat/přeřadit krok s přepočtem) na úrovni instance — plán #9.
- Reálné auto-datování `due_basis`/`due_offset_days` + náhled k potvrzení (plán §7).
- Cíle: serverový výpočet metrik z reálných úkolů; reset periodických jako job.

---

## Příloha A — klíčové řádky (rychlá navigace v `WatsonApp.dc.html`)

| oblast | metoda / data | řádek |
|---|---|---|
| Seed kroků postupu (fl1) | `tasks` flow seed | L2138–2142 |
| Spouštěč posunu + toast „Předáno → X" | `toggleDone` | L2482 |
| **Algoritmus posunu + kaskáda** | `_advance` | L2483 |
| Normalizace flow polí | `_normFlows` | L2484 |
| Víkend helpery | `_isWknd` / `_nextWork` | L2485–2486 |
| **Přeplánování Řetězec/Kotva** | `_reflow` | L2487 |
| Posun celého postupu | `shiftFlow` | L2488 |
| Přepínač režimu plánování | `setFlowSched` | L2489 |
| Toggle „bez víkendů" | `toggleFlowWeekend` | L2490 |
| Rewind kroku | `rewindStep` | L2555 |
| Připomenutí kroku | `remindStep` | L2496 |
| Uložit běžící jako šablonu | `saveFlowAsTemplate` | L2495 |
| Šablony postupů | `FLOW_TEMPLATES` / `FLOW_ROLES` | L2500–2530 |
| Bucket dle dne | `bucketFor` | L2531 |
| Builder: open / picků / kroky | `openFlowModal`…`cycleFlowStepGate` | L2532–2545 |
| **Builder: vytvoření** | `createFlow` | L2546–2553 |
| Detail postupu (data) | `flowView` | L2554 |
| Připojit úkol do postupu | (v `addTask`) `flowAttach` | L2471 |
| Karta postupu / bottleneck | `flowsOverview` / `flowsSorted` | L3154–3155 |
| „Tvůj další krok" | `myFlowSteps` | L3156 |
| Builder data (gate/mode/projekt kroku) | `flowModalData` | L3157–3176 |
| **Cíl: pokrok (4 metriky)** | `goalProgress` | L2362–2367 |
| Cíl: úkoly filtru | `goalTasks` | L2360 |
| Cíl: stav/tempo | `goalStatus` / `GSTAT` | L2368–2369 |
| Cíl: patch/create/edit | `patchGoal`/`createGoal`/`goalMerged` | L2335/L2345/L2353 |
| Cíl: šablony | `GOAL_TEMPLATES` | L2323–2330 |
| Cíl: detail (data) | `goalDetail` | L3204 |
| Cíl: seed | `GOALS` | L2110–2122 |
| **Projekt: model** | `PROJECTS` | L2082–2099 |
| Projekt: efektivní progres | `projComputed` | L2356 |
| Projekt: edit handlery | `projEdit`/`setProj*` | L2372–2380 |
| Projekt: detail (data) | `projDetail` | L3129–3140 |
| Projekt: karta | `projektyView` / `STKIND` / `STSTAT` | L3179–3181 |
| Šablony (UI) postupu | flow modal | L1511–1599 |
| Detail postupu (UI) | flow detail panel | L1090–1143 |
| Detail projektu (UI) | project detail panel | L1220–1268 |
