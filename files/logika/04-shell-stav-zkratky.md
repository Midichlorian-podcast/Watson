# 04 — App shell, globální stav, klávesnice, paleta, undo/redo, persistence, motiv/hustota, prostory, hledání, filtry/řazení, datový model úkolu, seed

> **Zdroj:** `design/handoff_watson/WatsonApp.dc.html`, jediná třída `class Component extends DCLogic` (řádky 1895–3265). Čísla řádků v hranatých závorkách odkazují na tento soubor.
> **Účel dokumentu:** přesně zachytit veškerou jemnou logiku prototypu z výše uvedených oblastí, aby se nic neztratilo při čisté implementaci v produkčním kódu.
> **„Dnes" v prototypu = čtvrtek 25. 6. 2026.** Všechny relativní termíny se počítají od tohoto data (`recBase()` = `new Date(2026,5,25)` [2073], `_todayIso()` = 2026‑06‑25).
>
> **Poznámka k implementaci (platí globálně, dle CLAUDE.md):** Prototyp drží **veškerá doménová data v `state.tasks` (in‑memory) + localStorage jen pro UI‑pozici**. V produkci patří doménová data (úkoly, projekty, lidé, cíle, postupy, role) do **stavového storu napojeného na backend/sync engine** (API + auth + reálné role/oprávnění + reálný výpočet metrik). localStorage zůstává jen pro lehké per‑zařízení/per‑uživatel UI preference (viz §6). Historie undo/redo a paleta jsou čistě klientské UI vrstvy.

---

## 1. Globální stav (`state`) — kompletní výčet

Inicializace `state = { … }` [1896–1910]. Níže každé pole, jeho výchozí hodnota a co řídí. **Mnoho polí se nastavuje až v `componentDidMount` z localStorage** (viz §6) — proto je počáteční render „loading" dokud `state.tasks===null`.

### 1.1 Navigace / obrazovka
| Pole | Default | Řídí |
|---|---|---|
| `screen` | `'dnes'` | Aktivní obrazovka. Hodnoty: `dnes`, `seznam` (=Úkoly), `nadchazejici`, `schranka`, `oblibene` (Priorita 1 / Přiřazeno mně), `board`, `kalendar`, `projekty`, `cile`, `reporty`, `postupy`, `nastaveni`, `hledat`. Pozn.: `tym` není samostatný screen — `goTo('tym')` přepne na `reporty` + `reportTab:'people'` [2257]. |
| `view` | `'list'` | Přepínač zobrazení uvnitř workspace obrazovek: `list` / `board` / `calendar`. |
| `calMode` | `'week'` | Režim kalendáře: `day` / `week` / `month`. |
| `calCur` | `null` | Aktuální „kurzor" kalendáře (Date) pro den/týden; `null` = odvodí se z dneška. |
| `monthOffset` | `0` | Posun měsíce v měsíčním zobrazení (±). Den/týden používají `calCur`, měsíc používá `monthOffset` [2660]. |
| `weekView` | `'list'` | Týden: `list` (Sloupce) vs. `grid` (Mřížka). |
| `dayWs` | `null` | Filtr prostoru na obrazovkách Dnes/Nadcházející (chip „Vše/Moje/Kancelář/Sokol") [3256]. `null` = vše. |

### 1.2 Výběry / panely (pravé detaily, modály)
| Pole | Default | Řídí |
|---|---|---|
| `selectedId` | `null` | Otevřený detail úkolu (pravý panel). |
| `selectedProject` | `null` | Otevřený detail projektu. |
| `selectedMember` | `null` | Otevřený detail člena (Reporty/Lidé). |
| `selectedFlow` | `null` | Otevřený detail postupu. |
| `selectedGoal` | `null` | Otevřený detail cíle. |
| `addOpen` | `false` | Otevřený modál „Přidat úkol". |
| `watsonOpen` | `false` | Watson panel. |
| `flowModal` | `false` | Builder postupu. |
| `goalModal` | `false` | Modál tvorby cíle. |
| `memberModal` | `false` | Modál pozvání člena. |
| `taskMenu` | (impl. `null`) | Otevřené ⋯ menu v detailu úkolu. |
| `menuOpen` | `null` | Otevřené dropdown menu na toolbaru (`'sort'` / `'filter'` / `'grid'`). |
| `roleMenu` | `null` | Otevřené menu pro změnu role člena (id). |
| `pendingRewind` | `null` | Potvrzování „vrátit krok" v postupu. |

### 1.3 Paleta, tahák, klávesový výběr
| Pole | Default | Řídí |
|---|---|---|
| `paletteOpen` | `false` | Command palette (⌘K) otevřena. |
| `paletteQ` | `''` | Dotaz v paletě. |
| `paletteIdx` | (impl. `0`) | Zvýrazněná položka v paletě (šipky). Není v iniciálním `state` literálu, vzniká za běhu; resetuje se na 0 při otevření/psaní. |
| `cheatOpen` | `false` | Tahák klávesových zkratek (`?`). |
| `kbSel` | `null` | Klávesový výběr řádku v seznamu (brass rámeček). |

> **Pozn. k undo zásobníku:** undo/redo **nejsou v `state`** — jsou to instanční pole `this._hist`, `this._redo`, `this._prevTasks`, `this._undoing` (viz §5). To je vědomé: historie se nemá re‑renderovat.

### 1.4 Hledání / filtry / řazení
| Pole | Default | Řídí |
|---|---|---|
| `search` | `''` | Fulltext dotaz (sdílený header‑search i obrazovka `hledat`). |
| `searchOpen` | `false` | Rozbalené inline search pole v headeru. |
| `filterPri` | `[]` | Filtr priorit (pole čísel 1–4). |
| `filterProj` | `[]` | Filtr projektů (pole id). |
| `filterStatus` | `[]` | Filtr stavů (`probiha`/`kontrola`/`''`(nezahájeno)/`hotovo`). |
| `filterPerson` | `[]` | Filtr osob (id, + speciální `__none__` = nepřiřazené, `__multi__` = ≥2 lidí). |
| `projQ` | `''` | Hledání v dropdownu filtru projektů. |
| `personQ` | `''` | Hledání v dropdownu filtru osob. |
| `sortBy` | `'smart'` | Řazení: `smart`/`due`/`priority`/`name`/`project`/`status`. |
| `sortDir` | `'asc'` | Směr `asc`/`desc`. |
| `showDone` | `false` | Zobrazit dokončené úkoly v seznamech. |

### 1.5 Drag & drop (board/kalendář)
`dragId:null`, `overCol:null`, `overId:null`, `overPos:null` [1900], `boardOrder:null` (pořadí ID na nástěnce; inicializováno z `seed().map(t=>t.id)` [2199]).

### 1.6 Koncept nového úkolu
| Pole | Default | Řídí |
|---|---|---|
| `addDraft` | `null` | Celý koncept přidávaného úkolu vč. parseru. Tvar viz `freshDraft()` [1920] — viz §11. |
| `justAdded` | `null` | ID právě přidaného úkolu pro „flash" animaci (auto‑reset po 1600 ms [2473]). |

### 1.7 Data lokálně přidaná (mimo seed)
| Pole | Default | Řídí |
|---|---|---|
| `tasks` | `null` | **Hlavní datové pole** — úkoly i kroky postupů. `null` = ještě nenačteno. Naplní `seed()` v mountu. |
| `newProjects` | `[]` | Lokálně přidané projekty. |
| `newMembers` | `[]` | Lokálně pozvaní členové. |
| `newGoals` | (impl., přes `setState`) | Lokálně vytvořené cíle (`allGoals()` = `GOALS.concat(state.newGoals||[])` [2322]). |
| `projEdits` | `{}` | Per‑projekt overrides (název/barva/typ/vlastník/stav/termín/dod/členové) — viz `proj(id)` [2243]. |
| `goalEdits` | `{}` | Per‑cíl overrides (current/target/done/milestones/name). |
| `memberRoles` | `{}` | Override oprávnění člena (`permRoleOf` [2306]). |

### 1.8 Cíle / postupy / reporty — pomocný stav
`goalTab:'team'` (záložka scope v Cílech: `team`/`project`/`personal`), `goalDraft:null` (koncept cíle), `flowDraft:null` (koncept postupu), `flowToast:null` (text toastu), `flowMineOnly:false` („jen kde jsem na řadě"), `reportTab:'overview'` (`overview`/`people`).

### 1.9 Prostory (workspaces)
| Pole | Default | Řídí |
|---|---|---|
| `activeWs` | `'kancelar'` | Aktivní prostor — **scopuje projekty, úkoly, tým, cíle i postupy** (viz §7). |
| `wsCollapsed` | `{}` | Sbalení sekcí prostorů v sidebaru (per id). Default sbalení = „není aktivní" (`id!==activeWs`) [2320, 3177]. |

### 1.10 Vzhled / hustota / zámek zobrazení
| Pole | Default | Řídí |
|---|---|---|
| `theme` | `'light'` | `light`/`dark` → atribut `data-w-theme` [3223]. |
| `calDensity` | `'comfortable'` | Hustota **kalendářní mřížky** (`comfortable`/`spacious`, příp. `compact`) → mění `this.PPM` (px/min) [2662]. **Pozor:** toto je to, co ovládá in‑app přepínač „Vyvážené/Vzdušné" v Nastavení [512] — viz §8. |
| `calBorder` | `'priority'` | Čím se barví rámeček bloků v kalendáři: `priority` vs. `project` (`cycleBorder`). |
| `viewLock` | `false` | Zámek výchozího zobrazení (per‑uživatel) — viz §9. |
| `lockedView` | `null` | Uložené `{view, calMode, weekView}` pro zámek. |
| `lockJustSet` | `false` | Krátký label po zamknutí (auto‑reset 2600 ms [2258]). |

### 1.11 Ostatní
`rail:false` (sbalený sidebar na ikony, `toggleRail` [2580]), `vw:1280` (šířka okna; `<880` = mobil [3011], `<880` přepíná layout), `planOpen:false` (panel plánování v kalendáři), `projFilter:null` (filtr seznamu na jeden projekt po kliknutí v sidebaru).

> **Atributy motivu/hustoty na kořenovém `<div>`** [162]: `data-w-theme={{themeAttr}}` `data-w-density={{densityAttr}}` `data-w-accent={{accentAttr}}`.
> - `themeAttr = s.theme` (stav) [3223].
> - `accentAttr = multi ? 'multi' : 'brass'` — `multi` = `(props.accent ?? 'Více barev')==='Více barev'` [3008]. Tj. „brass jednobarevně" vs. „více barev" je **prop**, ne stavový přepínač v UI.
> - `densityAttr` = mapováno z **`props.density`** (`Vzdušné→vzdusne`, `Vyvážené→vyvazene`, `Kompaktní→kompaktni`, default `kompaktni`) [3010]. **DŮLEŽITÉ:** Toto je samostatná globální hustota řádků/karet (CSS proměnné `--row-py/--row-font/--card-pad` [40–42]) řízená **prop**, NIKOLI tlačítkem v UI. In‑app přepínač „Vyvážené/Vzdušné" [512] ovládá pouze `calDensity` (kalendář). V produkci je vhodné obě sjednotit do jedné per‑uživatel preference „hustota" — v prototypu jsou rozdělené (drift, který je třeba vědomě sjednotit).

---

## 2. Klávesový handler (`_onKey`, registrace v `componentDidMount`) [2202–2237]

Listener `window.addEventListener('keydown', this._onKey)` [2237], odregistrace v `componentWillUnmount` [2240]. Pořadí vyhodnocení je **závazné** (větve se vrací `return` po prvním zásahu).

### 2.1 Detekce psaní (field‑ignore)
```
tag = e.target.tagName; typing = tag==='INPUT' || tag==='TEXTAREA' || e.target.isContentEditable;  [2203–2204]
mod = e.metaKey || e.ctrlKey;
```
- `typing` blokuje **všechny** nemodifikované zkratky: po vyhodnocení globálních ⌘ zkratek a Esc je `if(typing) return;` [2214] a `if(mod) return;` [2215]. Tj. v poli fungují jen ⌘Z/⌘⇧Z (ne při psaní — viz níže), ⌘K a Esc.

### 2.2 Pořadí vyhodnocení (shora dolů)
1. **⌘Z / ⌘⇧Z (Undo/Redo)** [2206]: `if(mod && key z/Z)`. Pokud `typing` → `return` (neruší se psaní). Jinak `preventDefault`; `shift` → `redo()`, jinak `undo()`.
2. **⌘K / Ctrl+K (paleta)** [2207]: toggle `paletteOpen`, reset `paletteQ=''`, `paletteIdx=0`; po otevření po 60 ms fokus na `input[data-palette]`. **Funguje i při psaní** (není za `typing` guardem).
3. **Navigace uvnitř otevřené palety** [2208–2212]: jen když `paletteOpen` — `ArrowDown`/`ArrowUp` posun `paletteIdx` (clamp 0..`_palLen-1`), `Enter` spustí `_palItems[idx].run()` a zavře paletu.
4. **Esc kaskáda** [2213] — **přesné pořadí** (každý krok `preventDefault`+`return`, zavře jen nejvyšší vrstvu):
   **`cheatOpen` → `paletteOpen` → `addOpen` → `selectedFlow` → `selectedId` → `selectedProject` → `selectedMember` → `kbSel`.**
   (Pozn.: `selectedGoal` a `selectedMember` modály mají vlastní close handlery; v Esc kaskádě je `selectedMember` zahrnut, `selectedGoal` nikoli — Goal se zavírá jen tlačítkem/`closeGoal`.)
5. `if(typing) return;` [2214] a `if(mod) return;` [2215] — dál už jen „holé" klávesy mimo pole.
6. **`G` then X (go‑to)** [2216–2217]: `G`/`g` nastaví `_gPending=true` s timeoutem **1200 ms** [2217]. Následující klávesa (dokud `_gPending`) se přeloží přes `gmap`:
   `d→dnes, n→nadchazejici, u→seznam (Úkoly), k→kalendar, p→projekty, c→cile, r→reporty, s→postupy, i→schranka, h→hledat` [2216].
   > Pozn.: README/tahák zmiňuje `G D/U/K/P/C/R/N/I`; reálná mapa navíc má `S→postupy` a `H→hledat`. `U→seznam (Úkoly)`, `N→nadchazejici`, `K→kalendar`. (V taháku je jako příklad jen `D/U/K/P/C`.)
7. **`/` (Hledat)** [2218]: `focusSearch()` — otevře inline search a fokusne pole.
8. **`?` (tahák)** [2219]: toggle `cheatOpen`.
9. **`Q`/`q` (Nový úkol)** [2220]: pokud už `addOpen` → nic; jinak `openAdd()`.
10. **Detail úkolu: ↑/↓/j/k = předchozí/další úkol v seznamu** [2221–2225]: jen když `selectedId` a žádný modál; používá `this._navIds` (pořadí ID napříč skupinami) — posune `selectedId`+`kbSel` a zavře `taskMenu`. (Identicky popsáno v taháku „V detailu: další/předchozí".)
11. **Seznam (`_kbList`)** [2226 → 2262–2276]: viz §2.3.
12. **Detail postupu: Enter = dokončit aktuální krok** [2227]: jen když `selectedFlow` a `!addOpen`; najde krok `stepStatus==='now'` daného flow a `toggleDone`.
13. **Kalendář** [2228–2235]: jen když `view==='calendar'` a žádný detail/modál:
   - `←` → `calNav(-1)`, `→` → `calNav(1)` [2229–2230]
   - `d`/`D` → `calToday()` [2231]
   - `1` → `setCal('day')`, `2` → `setCal('week')`, `3` → `setCal('month')` [2232–2234]

### 2.3 Seznamový handler `_kbList(e)` [2262–2276]
Vrací `true` pokud klávesu spotřeboval.
- **Guard:** vrátí `false`, pokud je otevřen jakýkoli detail/modál/paleta/tahák (`addOpen||selectedId||selectedProject||selectedMember||selectedFlow||cheatOpen||paletteOpen`) [2263], nebo pokud `view!=='list'` [2264], nebo `_navIds` prázdné [2265].
- `cur = state.kbSel`, `i = ids.indexOf(cur)`.
- **↓ / j / J** [2267]: posun dolů (`i<0 → 0`, jinak `min(len-1,i+1)`), `kbSel=ids[i]`.
- **↑ / k / K** [2268]: posun nahoru (`max(0,i-1)`), `kbSel=ids[i]`.
- Pokud `i<0` (nic vybráno) a klávesa není šipka → `false` [2269].
- **Enter** [2270]: `selectedId=cur` (otevři detail).
- **Space / Spacebar** [2271]: `toggleDone(cur)`.
- **1/2/3/4** [2272]: `setTaskPriority(cur,+k)` [2277].
- **Backspace / Delete** [2273]: vypočti následníka `ni=ids[i+1]||ids[i-1]||null`, `deleteTask(cur)`, `kbSel=ni`. (Mazání jde do historie → undo přes ⌘Z.)
- **Esc** [2274]: `kbSel=null`.

### 2.4 Kompletní tabulka zkratek (autoritativní — tahák [1639–1667] + handler)
| Kontext | Klávesa | Akce |
|---|---|---|
| Globální | `/` | Hledat (otevře + fokus) |
| Globální | `Q` | Nový úkol |
| Globální | `⌘K` / `Ctrl+K` | Paleta „Skok kamkoli" (toggle) |
| Globální | `G` pak `D` | Dnes |
| Globální | `G` pak `N` | Nadcházející |
| Globální | `G` pak `U` | Úkoly (`seznam`) |
| Globální | `G` pak `K` | Kalendář |
| Globální | `G` pak `P` | Projekty |
| Globální | `G` pak `C` | Cíle |
| Globální | `G` pak `R` | Reporty |
| Globální | `G` pak `S` | Postupy |
| Globální | `G` pak `I` | Schránka |
| Globální | `G` pak `H` | Hledání |
| Globální | `⌘Z` | Zpět (undo) |
| Globální | `⌘⇧Z` | Vpřed (redo) |
| Globální | `Esc` | Zavřít/zrušit (kaskáda — viz 2.2/4) |
| Globální | `?` | Tahák zkratek (toggle) |
| Seznam | `↑` / `↓` / `J` / `K` | Pohyb výběru (brass rámeček) |
| Seznam | `Enter` | Otevřít detail |
| Seznam | `Space` | Odškrtnout |
| Seznam | `1`–`4` | Nastavit prioritu |
| Seznam | `⌫` (Backspace/Delete) | Smazat (s undo) |
| Detail úkolu | `↑` / `↓` / `J` / `K` | Předchozí / další úkol |
| Detail úkolu | `Esc` | Zavřít |
| Detail postupu | `Enter` | Dokončit aktuální krok („Teď na řadě") |
| Kalendář | `←` / `→` | Předchozí / další období |
| Kalendář | `D` | Dnes |
| Kalendář | `1` / `2` / `3` | Den / Týden / Měsíc |
| Paleta | `↑` / `↓` | Pohyb |
| Paleta | `Enter` | Potvrdit (spustí položku) |
| Paleta / Esc | `Esc` | Zavřít |
| Našeptávač (quick‑add) | `↑` / `↓` | Výběr v nabídce |
| Našeptávač | `Enter` | Potvrdit |
| Add modal | `⌘Enter` | Uložit úkol (label v taháku [1666]; submit přes onName/onKeyDown draftu) |

**Implementace:** jeden globální keyboard handler s field‑ignore (`INPUT/TEXTAREA/contentEditable`), s vrstvenou Esc kaskádou ve stejném pořadí. `_gPending` realizovat jako „leader key" stav s timeoutem (1200 ms). `_navIds` = ploché pořadí ID viditelných úkolů (počítané při renderu — v produkci selektorem ze storu). ⌘K a Esc musí fungovat i při fokusu v poli.

---

## 3. Command palette — `buildPalette()` [2279–2294] + `onPaletteQ` [2278]

- **Dotaz:** `q = state.paletteQ.trim().toLowerCase()`.
- **Index (v tomto pořadí), filtruje se `label.includes(q)` (prázdný dotaz = vše):**
  1. **Obrazovky** (`kind:'Přejít'`) — pevný seznam `SCN` [2282]: `dnes→Dnes, nadchazejici→Nadcházející, seznam→Úkoly, kalendar→Kalendář, projekty→Projekty, cile→Cíle, reporty→Reporty, postupy→Postupy, schranka→Schránka, nastaveni→Nastavení, hledat→Hledání`. `run = goTo(id)`.
  2. **Projekty** (`kind:'Projekt'`) — jen z aktivního prostoru: `PROJECTS.filter(inWS)` [2284]; label = `proj(id).name` (s overrides); `run = openProj(id)`.
  3. **Lidé** (`kind:'Člověk'`) — **všech 7** z `PEOPLE` (NEfiltruje se prostorem) [2285]; `run = searchMember(id)` (→ Reporty/Lidé + detail).
  4. **Postupy** (`kind:'Postup'`) — unikátní `flowId` napříč `state.tasks`; label = `flowName`; `run = searchFlow(fid)` [2286–2287].
- **Ořez:** `items = raw.slice(0,14)` (max 14 položek) [2288]. Uloží se do `this._palItems`/`this._palLen` pro klávesovou navigaci.
- **Zvýraznění:** `idx = min(paletteIdx, len-1)`; `active:i===idx` [2290–2292].
- **Navigace:** šipky mění `paletteIdx` (handler [2209–2210]), `Enter`/`onClick` spustí `run()` a zavře paletu. Při psaní `paletteIdx→0` [2278].
- `empty: items.length===0` → prázdný stav.

**Implementace:** index složit ze stejných zdrojů (obrazovky + projekty scopované prostorem + všichni lidé + postupy); v produkci doplnit i úkoly/cíle dle potřeby. Limit 14 a fuzzy/substring match zachovat.

---

## 4. Hledání (fulltext) — dvě cesty

### 4.1 Inline header‑search (`searchOpen`)
- `onSearch` [2475] zapisuje `state.search`. `toggleSearch` [2722] otevře/zavře a **vyčistí** `search`.
- `focusSearch` [2261] (klávesa `/`): `searchOpen=true` + fokus pole (`input[placeholder="Hledat…"]` nebo `placeholder^="Hledat úkoly"`).
- Tento `search` se v seznamech používá jako **prostý filtr názvu** přes `match(t)= !q || t.name.toLowerCase().includes(q)` [3013] aplikovaný na všechny skupiny (`dec`/`decL`).

### 4.2 Obrazovka „Hledání" (`screen==='hledat'`) — multi‑sekce výsledky [3070–3081]
`ql = search.trim().toLowerCase()`. Pokud prázdné → `prompt` (výzva), žádné výsledky. Jinak skupiny (každá max N):
- **Úkoly** (max 8) [3073]: `!t.inbox && t.name.includes(ql)`; sub = název projektu; `onClick=searchTask` (otevře detail).
- **Projekty** (max 6) [3074]: `proj(id).name.includes(ql)`; sub = typ (`Průběžný/Cílový/Periodický projekt`); `onClick=searchProj`. **NEscopuje prostorem** (`this.PROJECTS` celé).
- **Lidé** (max 6) [3075]: match na `name` **nebo** `role`; `onClick=searchMember`.
- **Postupy** (max 6) [3076–3077]: unikátní `flowId`, match na `flowName`; sub = `done/total kroků`; `onClick=searchFlow`.
- **Cíle** (max 6) [3078]: `allGoals()` match na `name`; sub = scope label; `onClick=searchGoal`.
- `total` = součet; `totalLabel` česky skloňuje (`1 výsledek` / `2–4 výsledky` / `výsledků`) [3080]. `empty = ql && total===0`.

**Implementace:** fulltext přes úkoly/projekty/lidi/postupy/cíle, case‑insensitive substring; limity sekcí (8/6/6/6/6). Pozn.: obrazovka „Hledání" prohledává projekty/úkoly **bez** ws‑scope (globálně), zatímco paleta projekty scopuje prostorem — vědomě.

---

## 5. Undo / Redo — historie stavu úkolů

Mechanismus je čistě na instančních polích (ne `state`):
- **Snapshot se ukládá automaticky** v `componentDidUpdate` [2239]: pokud se `state.tasks` změnily (`_prevTasks !== state.tasks`) a neprobíhá undo/redo (`!_undoing`), `_hist.push(_prevTasks)`; **cap 40** (`if(_hist.length>40) _hist.shift()`); a `_redo=[]` (nová akce zahodí redo větev). Pak `_prevTasks = state.tasks`.
- **Ruční push** `_pushHist()` [2655]: `this._hist.push(this.state.tasks)` — volá se před akcemi nad výjimkami opakování (skip/restore/setOccField [2477–2479]) a triage [2317] a posuny postupů [2488]. (Tj. některé akce historii plní explicitně i přes auto‑mechanismus.)
- **`undo()`** [2259]: pop z `_hist` → push current do `_redo` → `_undoing=true`, `_prevTasks=prev`, `setState({tasks:prev, justAdded:null})`, po tiku `_undoing=false`. Toast „Vráceno zpět".
- **`redo()`** [2260]: pop z `_redo` → push current do `_hist` → nastav `tasks=next`. Toast „Znovu provedeno".
- **Co se snapshotuje:** **pouze `state.tasks`** (celé pole úkolů, vč. kroků postupů a jejich `exceptions`). Projektové/cílové/role edits, výběry, atd. **nejsou** součástí undo.

**Implementace:** undo/redo nad doménovou kolekcí úkolů jako stack snapshotů (immutable). V produkci spíš command/patch log nebo snapshot store; zachovat sémantiku „nová akce maže redo", cap historie a fakt, že undo se vztahuje jen na úkoly.

---

## 6. Persistence (localStorage) — co se ukládá

- **Klíč:** `localStorage['watson.app']` (JSON).
- **Helper `persist(extra)`** [2241]: merge do existujícího objektu (`Object.assign(c, extra)`), try/catch.
- **Načtení v `componentDidMount`** [2193–2201]: `saved = JSON.parse(localStorage['watson.app']||'{}')`. Z něj se berou jen tato pole (zbytek = seed/default):
  - `screen` → `sc` (default `dnes`); `view` se **odvodí** z `screen` (`board→board`, `kalendar→calendar`, jinak `list`) [2198].
  - `theme` (default `light`)
  - `activeWs` (default `kancelar`)
  - `rail` (bool)
  - `calDensity` (`spacious` nebo `comfortable`)
  - `calBorder` (default `priority`)
  - `viewLock` (bool) a `lockedView`
- **Co se zapisuje** (volání `persist`): `{screen}` [2257], `{theme}` [2385], `{activeWs}` [2295/2315/2319], `{rail}` [2580], `{calDensity}` [2662], `{viewLock, lockedView}` [2258].
- **NEukládá se:** `tasks` ani žádná doménová data (vždy ze `seed()`), filtry, řazení, výběry, dayWs.

**Implementace (per CLAUDE.md):** localStorage v produkci **nahradit reálným backendem** pro doménová data. Ze stávajícího `watson.app` zůstávají kandidáti na lehkou per‑zařízení/per‑uživatel UI preferenci: poslední obrazovka, motiv, aktivní prostor, sbalený sidebar, hustota kalendáře, zámek výchozího zobrazení. Tyto „výchozí zobrazení a nastavení" jsou v záměru **per‑uživatel** (README §Stavy), ne globální.

---

## 7. Prostory (workspaces) — scoping

- **Definice `WORKSPACES`** [2101–2105]: `personal` „Moje projekty" (kind `personal`, barva `#9a8f80`), `kancelar` „Kancelář Praha" (`team`, `#c68a3e`), `klub` „TJ Sokol Praha" (`team`, `#2a6fdb`).
- **Mapování projekt→prostor** [2106–2107]: `wsOf(p) = p.space==='personal' ? 'personal' : (PROJ_WS[p.id] || 'kancelar')`. `PROJ_WS = { akce:'klub', klienti:'klub', marketing:'klub' }`. Tj. **vše v `kancelar` kromě** tří klubových projektů a osobních (`space:'personal'`).
- **`inWS(p) = wsOf(p)===activeWs`** [2321] — hlavní scope predikát.
- **Členové prostoru** [2133–2134]: `WS_MEMBERS = { kancelar:[ak,tm,jd,mb,pn,lh,ep], klub:[pn,ep,jd,lh] }`. `wsMembers(wsId)` vrací `PEOPLE` filtrované; pro neznámý ws (např. `personal`) → všichni.
- **Cíle→prostor** [2108–2109]: `goalWs(g) = g.scope==='personal' ? 'personal' : (g.ws || GOAL_WS[g.id] || 'kancelar')`.
- **Přepnutí prostoru `setActiveWs(id, screen)`** [2319]: nastaví `activeWs`; zruší `selectedProject`; upraví `goalTab` (personal→`personal`, jinak z personal zpět na `team`); volitelně přepne `screen` (a pokud z `personal` byl `tym`, jde na `dnes`); rozbalí sekci prostoru; `persist({activeWs})`.
- **Sbalení sekcí** `toggleWsCollapse` [2320] / render `wsSections` [3177]: default collapsed = `id!==activeWs`.

**Kde se scope projeví (přesně):**
- Seznam Úkoly: skupiny jen z `PROJECTS.filter(inWS)` [3040–3043].
- Sidebar „Pracovní prostory": sekce per `WORKSPACES`, projekty `wsOf===w.id` [3177].
- Projekty (karty): `PROJECTS.filter(inWS).slice(0,6)` [3181].
- Tým / Reporty‑Lidé: `wsMembers(activeWs)` [3182–3183].
- Cíle (Reporty/Cíle): filtr `goalWs(g)===activeWs` [3187], resp. personal větev.
- Postupy: `flowId` jen z úkolů, jejichž projekt `inWS` [3153].
- Paleta: projekty scopované `inWS` [2284]; lidé NE.
- Dnes/Nadcházející: navíc chip `dayWs` filtr přes `dayWf` [3025].
- Filtr osob v toolbaru se skryje, když `activeWs==='personal'` (`showPersonFilter` [3237]).

**Implementace:** `activeWs` jako globální scope; všechny doménové selektory parametrizovat prostorem. Mapování projekt/cíl→prostor v produkci jako sloupec/relace, ne hardcoded mapa.

---

## 8. Motiv & hustota

### 8.1 Motiv (light/dark)
- `toggleTheme` [2385]: `theme = dark?light:dark`, `setState` + `persist({theme})`.
- Atribut `data-w-theme` na kořeni [162] = `s.theme`. CSS proměnné pro oba režimy [16–39]. Switch v headeru: `switchBg`/`knobMl` odvozené ze `theme` [3224]. (Tokeny jsou v README/CSS; tato vrstva jen přepíná atribut.)

### 8.2 Hustota
- **Globální `data-w-density`** [40–42, 162]: hodnoty `vzdusne` (15/15/18px), `vyvazene` (11/14/15px), `kompaktni` (8/13.5/13px). Řízeno **`props.density`** [3010], default `kompaktni`. **Není** v UI přepínatelné v prototypu.
- **Kalendářní hustota `calDensity`** [2662, 512]: in‑app přepínač „Vyvážené" (`comfortable`) / „Vzdušné" (`spacious`) → nastaví `this.PPM` (px za minutu): `PPMOPT={comfortable:0.62, spacious:0.95}` [1912]; `setDensity` zároveň `persist({calDensity})`. (V handlerech existuje i `compact`, ale UI nabízí jen comfortable/spacious.)

**Implementace:** sjednotit do **jedné per‑uživatel** preference hustoty řídící jak `--row-py/--row-font/--card-pad`, tak měřítko kalendáře (PPM). Doporučeny obě úrovně Vzdušné/Vyvážené (README: kompaktní vynechat).

---

## 9. Zámek výchozího zobrazení (`viewLock`)
- `toggleViewLock` [2258]: zapne/vypne; při zapnutí uloží `lockedView={view, calMode, weekView}`; `persist`; krátký label `lockJustSet` (2600 ms).
- Aplikace v `goTo(s)` [2257]: jen pro „view‑switchovatelné" obrazovky `VS=['nadchazejici','seznam','hledat','oblibene']` — pokud `viewLock && lockedView`, přepíše `view`/`calMode`/`weekView` z `lockedView`.
- `lockLabel` [3240]: čitelný popis zamčeného zobrazení (Seznam/Nástěnka/Kalendář · Den/Týden/Měsíc · Sloupce/Mřížka).

**Implementace:** per‑uživatel „pin výchozího zobrazení" pro seznamové obrazovky; ukládat zvolený `view`+kalendářní podrežim.

---

## 10. Filtry a řazení (seznamy, `view==='list'`)

### 10.1 Pipeline v renderu — `decL(arr)` [3017]
Pořadí transformací (na poli úkolů dané skupiny):
1. `.filter(match)` — fulltext název (`!q || name.includes(q)`) [3013].
2. `.filter(showDone || !t.done)` — skrytí dokončených.
3. `.filter(!filterPri.length || filterPri.includes(t.priority))`.
4. `.filter(!filterProj.length || filterProj.includes(t.project))`.
5. `.filter(!filterStatus.length || filterStatus.includes(t.status||''))`.
6. `.filter(filterPerson)` — pokud prázdné `true`; jinak `filterPerson.some(f → f==='__none__'? people.length===0 : f==='__multi__'? people.length>=2 : people.includes(f))`.
7. `.sort((a,b)=> dir*cmp(a,b))` kde `dir = sortDir==='desc'?-1:1` [3016].
8. `.map(decorate)`.

(`dec(arr)` [3014] = jen `match`+`decorate` bez filtrů/řazení — používá board/kalendář „Dnes/Zpožděné" skupiny [3061].)

### 10.2 Řadicí funkce `sortFns` [3015]
| `sortBy` | Komparátor |
|---|---|
| `smart` (default) | `(a.priority-b.priority) || ((a.start||9999)-(b.start||9999))` — priorita, pak čas začátku |
| `due` | klíč `r(t)=(t.overdue?-100000:0)+(t.date??999)*1000+(t.start??1440)`; po termínu úplně nahoře |
| `priority` | `a.priority-b.priority` |
| `name` | `localeCompare(...,'cs')` |
| `project` | `proj(a.project).name.localeCompare(proj(b.project).name,'cs')` |
| `status` | mapa `{probiha:0,kontrola:1,'':2,nezahajeno:2,hotovo:3}` — rozpracované první |

Cyklení: `cycleSort` [2713] prochází `['smart','due','priority','name','project','status']`; `setSort(by)` [2715] přímo; `toggleSortDir` [2716] přepíná `asc`/`desc`. Labely [3229/3231/3233] (`name` se zobrazuje jako „Abeceda"/„Název" podle místa).

### 10.3 Filtry — ovládání
- `setFilter(key, val)` [2719]: toggle hodnoty v poli `state[key]` (přidej/odeber).
- `setFilterQ(key)` [2721]: zápis do `projQ`/`personQ` (hledání v dropdownu).
- `toggleShowDone` [2714]. `clearFilters` (`hasActiveFilters` = součet délek >0 [3238]).
- **Možnosti filtrů** (render):
  - Priorita: P1–P4 [3234].
  - Projekt: `PROJECTS.filter(inWS)` + hledání `projQ` [3235].
  - Stav: `Probíhá/Ke kontrole/Nezahájeno(''))/Hotovo` [3236].
  - Osoba: `Jen já(ak)`, `Nepřiřazené(__none__)`, `Více lidí(__multi__)`, pak `PEOPLE` bez `ak` [3237]; skryto v `personal` prostoru.
- **Aktivní chipy** `activeFilterChips` [3239] s `onClear` per hodnota.

> Pozn.: existuje i legacy `filterPri` jako **skalár** (header label `filterLabel`/`filterActive` [3229] počítá s `s.filterPri` jako jedním číslem), zatímco pipeline a chipy ho používají jako **pole**. V produkci sjednotit na pole (multi‑select), label generovat z pole.

**Implementace:** filtr/řazení jako čistá transformace nad scopovanou kolekcí; multi‑select pro všechny čtyři filtry; speciální tokeny `__none__`/`__multi__` pro „nepřiřazené/více lidí"; locale‑aware řazení (`cs`).

---

## 11. Datový model úkolu — kompletní výčet polí

Zdroj: `seed()` [2136–2188], `createTask` [2448–2474], `makeOcc`/výjimky [2477–2482], `freshDraft` [1920]. Pole se vyskytují volitelně (objekt je „řídký").

### 11.1 Identita & základ
| Pole | Typ | Význam |
|---|---|---|
| `id` | string | Unikátní ID. Nové: `'n'+Date.now()` (úkol) [2453], `'fp…'/'t…'/'gx…'/'e…'/'a…'/'m…'` v seedu. |
| `name` | string | Název (po vytažení parserem). Pozn.: `createTask` čistí tokeny z názvu [2450]. |
| `desc` | string | Popis. |
| `project` | string | ID projektu (viz `PROJECTS`). |
| `priority` | 1–4 | Priorita = barva levého okraje (P1 červená … P4 šedá). |
| `color` | string\|undef | Volitelná barva úkolu (`rose…slate`, jinak bílá). Per‑uživatel. |

### 11.2 Přiřazení
| Pole | Typ | Význam |
|---|---|---|
| `people` | string[] | **Přiřazené osoby** (v seedu/datech `people`). Pozn.: `freshDraft` používá `assignees`, ale finální úkol má `people` [2454/2456]. |
| `assignMode` | `'any'`\|`'all'` | „stačí kdokoli" vs. „každý zvlášť". Vynuceno na `any` pokud <2 lidí [2455]. |
| `aTotal` | number | Při `all`: počet potřebných (init = `people.length`) [2467]. |
| `aDone` | number | Při `all`: kolik hotovo. |
| `peopleDone` | `{id:bool}` | Při `all`: kdo už splnil. |

### 11.3 Datum / čas / trvání / deadline
| Pole | Typ | Význam |
|---|---|---|
| `iso` | `YYYY-MM-DD` | **Reálné ISO datum** (preferované; napříč měsíci/roky). |
| `date` | number\|null | **Legacy** „červnový den" (22–30). Fallback: `tIso(t)= t.iso ?? (date!=null? '2026-06-'+pad(date) : null)` [2630]. |
| `isoEnd` | `YYYY-MM-DD` | Konec vícedenního (ISO). |
| `endDate` | number | **Legacy** konec vícedenního (červnový den). `tIsoEnd` [2631]. |
| `days` | number | Počet dní vícedenního úkolu. |
| `start` | number | Začátek v **minutách od půlnoci** (např. 540 = 9:00). |
| `end` | number | Konec v minutách. |
| `duration` | number | Trvání (min) — v draftu; do úkolu se promítá jako `end=start+duration` [2462]. |
| `deadline` / `deadlineLabel` | string | Deadline (ISO v draftu) / lidský label „do D. M." [2458]. |
| `dueLabel` | string | Textový popis termínu („dnes", „po termínu · st", „zítra · 13:00", „4 dní"). |
| `reminder` | bool | Připomenutí. |
| `recurring` | bool | Flag „opakovaný" (UI). |

### 11.4 Opakování (řada + výskyty)
| Pole | Typ | Význam |
|---|---|---|
| `repeat` | `'none'`\|`daily`\|`weekly`\|`biweekly`\|`monthly`\|`yearly` | Frekvence. |
| `repeatRule` | object | Strukturované pravidlo (`{kind, weekday, parity, nth, day}`) z parseru. |
| `repeatLabel` | string | Lidský popis („Každou středu", „2. úterý v měsíci"…). |
| `repeatEndKind` | `'never'`\|`'until'`\|`'count'` | Konec opakování. |
| `repeatUntil` | `YYYY-MM-DD` | Konec k datu. |
| `repeatCount` | number | Konec po počtu (default 10). |
| `repeatShowAll` | bool | „všechny výskyty" vs. „jen příští" (false → jen 1 budoucí) [2640]. |
| `repeatDoneCount` | number | Kolikrát dokončen základní výskyt (posouvá řadu) [2482]. |
| `exceptions` | `{ 'YYYY-MM-DD': { done, skipped, time, start, end, priority } }` | **Per‑výskyt výjimky** (override/skip). Klíč = ISO výskytu [2477–2482]. |

Virtuální výskyt: id `baseId@YYYY-MM-DD` (`_occId` [2646]); generuje `_recOccur`/`makeOcc`; promítá se do Nadcházející (horizont **16 dní**, `listTasks` [2654]) i kalendáře (dle rozsahu, `calTasks` [2633–2638]).

### 11.5 Stav / zařazení do seznamů
| Pole | Typ | Význam |
|---|---|---|
| `done` | bool | Dokončeno (přeškrtnuté + ztlumené). |
| `status` | `'probiha'`\|`'kontrola'`\|`'hotovo'`\|`''` | Stav (board sloupce / filtr). |
| `col` | `'todo'`\|`'doing'`\|`'review'`\|`'done'` | Sloupec na nástěnce. |
| `group` | `'overdue'`\|`'today'`\|`'upcoming'`\|`'inbox'`\|`'week'`\|`'done'` | Symbolické zařazení do dashboardu/Nadcházející. |
| `day` | `'zpozdene'`\|`'dnes'`\|`'zitra'`\|`'pristi'`\|`'tyden'`\|`'patek'`\|`'pmonth'`\|`'custom'`\|`'inbox'` | Symbolický „den" pro skupiny seznamu. |
| `inbox` | bool | Nezařazený (Schránka). |
| `overdue` | bool | Po termínu (pro řazení/odznak). |
| `onTime` | bool | Pro cíle „včasnost" (v `done` seedu). |
| `handedOff` | bool | (postup) krok byl právě předán. |
| `subtasks` | `[{name,done}]` | Podúkoly. |
| `subDone`/`subTotal` | number | Souhrn podúkolů. |
| `comments` | number | Počet komentářů. |
| `attachments` | number | Počet příloh (z draftu `attached.length` [2459]). |

### 11.6 Postup (štafeta)
| Pole | Typ | Význam |
|---|---|---|
| `flowId` | string | ID postupu (krok = běžný úkol s `flowId`). |
| `flowName` | string | Název postupu. |
| `stepIndex` | number | Pořadí kroku (1‑based). |
| `stepTotal` | number | Počet kroků. |
| `stepStatus` | `'waiting'`\|`'now'`\|`'done'`\|`'skipped'` | Stav kroku. |
| `gate` | `'auto'`\|`'manual'`\|`'parallel'` | Brána předání (Auto→/Ruční✋/Souběh⇉). |
| `role` | string | Role místo konkrétní osoby. |
| `schedMode` | `'chain'`\|`'anchor'` | Režim plánování (Řetězec/Kotva) [2484]. |
| `flowAnchor` | number | Kotevní den řady. |
| `anchorOffset` | number | Offset kroku od kotvy. |
| `gapDays` | number | Mezera od předchozího kroku (chain). |
| `skipWeekend` | bool | Přeskakovat víkend při reflow. |

### 11.7 Draft (`freshDraft` [1920]) — pole navíc oproti úkolu
`rawName` (surový text v editoru), `hits[]` (zvýrazněné tokeny `{t,kind}`), `assignees[]` (→ `people`), `dateKind` (`dnes`/`zitra`/`pristi`/`pmonth`/`custom`/`none`), `customDate`, `time`, `suggest`/`suggestIdx` (našeptávač), `projOpen`/`projQuery` (výběr projektu), `flowAttach` (zařadit do postupu), `pop` (otevřená pilulka), `more`/`descOpen` (UI). Parser `parseQuick` [1959] je popsán v dokumentu o chytrém zadávání; zde jen pozn., že **žije v této třídě** a plní `addDraft` (priorita `p1‑4`, čas, trvání, datum, vícedenní, opakování `parseRecurrence` [2005], `#projekt`, `@/+osoba`).

> **Validace:** úkol nelze vytvořit s prázdným názvem po vytažení tokenů — `createTask` `if(!raw) return` [2449] a `name` se případně vrací na `raw`.

---

## 12. Seed data (dev seed, bez backendu)

> **Dnes = čtvrtek 25. 6. 2026.** `WEEKDATES` [1913]: Po22 Út23 St24 **Čt25** Pá26 So27 Ne28.

### 12.1 Prostory `WORKSPACES` [2101–2105]
| id | název | kind | barva |
|---|---|---|---|
| `personal` | Moje projekty | personal | #9a8f80 |
| `kancelar` | Kancelář Praha | team | #c68a3e |
| `klub` | TJ Sokol Praha | team | #2a6fdb |

### 12.2 Lidé `PEOPLE` [2124–2132] (7)
| id | ini. | jméno | role |
|---|---|---|---|
| `ak` | AK | Adéla Kučerová | Vedoucí provozu (vlastník) |
| `tm` | TM | Tomáš Marek | Projektový manažer |
| `jd` | JD | Jana Dvořáková | Obchod |
| `mb` | MB | Martin Beneš | IT a provoz |
| `pn` | PN | Petra Nováková | Nábor a HR |
| `lh` | LH | Lukáš Horák | Office manager |
| `ep` | EP | Eva Pospíšilová | Marketing |

Členové prostoru `WS_MEMBERS` [2133]: **kancelar** = všech 7; **klub** = `pn, ep, jd, lh`. E‑mail se generuje z diakritiky (`name → NFD → adela.kucerova@firma.cz`) [3182].
Oprávnění: `ROLE_PERMS=['Vlastník','Admin','Člen','Host']` [2305]; `permRoleOf(id)= memberRoles[id] || (id==='ak'?'Vlastník':'Člen')` [2306].

### 12.3 Projekty `PROJECTS` [2082–2100] (17)
`kind`: `flow`=Průběžný, `goal`=Cílový (termín+definice hotového `dod`), `cycle`=Periodický. `wsOf` viz §7 (klub = akce/marketing/klienti; personal = `space:'personal'`; zbytek kancelar).

| id | název | kind | owner | prostor | dueLabel/dod |
|---|---|---|---|---|---|
| q3 | Q3 plánování | goal | tm | kancelar | 30. 9. · „Plán Q3 schválen vedením" |
| provoz | Provoz kanceláře | flow | ak | kancelar | — |
| obchod | Obchod | flow | jd | kancelar | — |
| onboarding | Onboarding | goal | pn | kancelar | 15. 7. · „Všech 5 nováčků zaškoleno" |
| web | Web redesign | goal | ak | kancelar | 31. 8. · „Nový web spuštěn" |
| marketing | Marketing | flow | jd | **klub** | — |
| hr | Nábor a HR | flow | pn | kancelar | — |
| finance | Finance | cycle | mb | kancelar | 30. 6. · „Měsíční uzávěrka" |
| it | IT a systémy | flow | mb | kancelar | — |
| akce | Firemní akce | goal | pn | **klub** | 12. 9. · „Letní teambuilding" |
| pravni | Právní a smlouvy | goal | tm | kancelar | 18. 7. · „Smlouvy podepsány" |
| klienti | Klientský servis | flow | jd | **klub** | — |
| interni | Interní procesy | cycle | ak | kancelar | 31. 12. · „Roční revize procesů" |
| osobni | Osobní úkoly | flow | ak | **personal** | — |
| rozvoj | Osobní rozvoj | goal | ak | **personal** | 31. 12. · „Certifikace dokončena" |
| domacnost | Domácnost | flow | ak | **personal** | — |
| zdravi | Zdraví & sport | flow | ak | **personal** | — |

> Pozn.: README zmiňuje barvy/typy detailně. Barvy projektů jsou na `PROJECTS[].color` i v CSS `data-proj` [75–76]. Pozn. odchylka README vs. kód: README uvádí osobní projekty „osobni, rozvoj, domacnost, zdravi" — sedí. README název „Osobní úkoly" pro `osobni` (kód: „Osobní úkoly").

### 12.4 Úkoly `seed()` [2137–2187]
~50 úkolů. Klíčové skupiny:
- **Běžící postup `fl1` „Plakát na červnovou show"** (projekt `akce`/klub), 5 kroků [2138–2142]: `fp1` Udělat návrh plakátu (done, tm), `fp2` Poptávka do tisku (**now**, jd+ak, handedOff), `fp3` Zadat do tisku (waiting, jd), `fp4` Vyzvednout tisk (waiting, gate **manual**, nepřiřazeno), `fp5` Pohlídat platbu faktury (waiting, mb). `stepTotal:5`, `gate` auto/manual.
- **Dokončené pro cíle `gx1–gx12`** [2143–2154] (`col:'done', done:true`, `onTime` true/false; faktury/docházky/nábor; osobní `gx11/gx12`).
- **Zpožděné `t14–t16`** [2155–2157] (date 23/24, `group:'overdue'`, `dueLabel:'po termínu · …'`; `t16` se subtasky).
- **Dnešní `t1–t13`, `a1`** [2158–2170, 2180] (date 25, časy `start/end`, různé `assignMode`, podúkoly, barvy, `recurring`).
- **Tento týden `e1–e5`, `a2`, `m1`, `m2`** [2171–2175, 2181, 2183–2184] (`group:'week'`; `m1`/`m2` vícedenní `endDate`+`days`+`color`).
- **Nadcházející `t17–t20`, `a3`** [2176–2179, 2182] (`zitra`/`pristi`).
- **Schránka `t21`, `t22`** [2185–2186] (`inbox:true`, projekt `osobni`).

### 12.5 Cíle `GOALS` [2110–2123] (12) + `GOAL_TEMPLATES` [2323–2330] (6)
`GOALS` g1–g12 s `scope` (`project`/`team`/`personal`/`person`), `metric` (`project`/`count`/`ontime`), `target`, `fProject`/`fPerson`/`fKeyword`, `period`, `dueLabel`/`dueDays`, `elapsed`, příp. `periodic`. `goalWs` mapa [2108]. Šablony cílů (`gtpl1‑6`): count/ontime/project, scope a `periodic`.
`allGoals()` = `GOALS + state.newGoals` [2322]. `goalTasks(g)` filtruje úkoly dle ws + `fProject`/`fPerson`/`fKeyword` [2360]. Tvorba `createGoal` [2345].

### 12.6 Šablony postupů `FLOW_TEMPLATES` [2501–2530] (4) + role `FLOW_ROLES` [2500]
- `plakat` „Plakát na akci" (5 kroků), `podcast` „Nová epizoda podcastu" (5), `ples` „Příprava plesu" (5), `grant` „Žádost o grant" (5). Každý krok `{name, who, offset, priority, gate, mode}`.
- `FLOW_ROLES`: `role:grafik` Grafik, `role:produkce` Produkce, `role:ucetni` Účetní, `role:vedouci` Vedoucí.
- Lze uložit běžící postup jako šablonu `saveFlowAsTemplate` [2495] (přidá do `FLOW_TEMPLATES` za běhu).

**Implementace:** seed použít jen pro dev/storybook režim, aby appka odpovídala 20 screenshotům. V produkci nahradit reálnými daty z API; mapování projekt/cíl→prostor a členství prostoru jako relace.

---

## 13. Drobné, ale snadno ztratitelné detaily
- **`_navIds`** [3066] je ploché pořadí ID napříč viditelnými skupinami — pohání jak klávesovou navigaci v seznamu, tak ↑/↓ v detailu úkolu. Musí se přepočítat při každé změně filtru/řazení/scope.
- **Triage ze schránky** `triageSchedule(id, dayKey)` [2317]: mapuje `dnes→25, zitra→26, pristi→29`, přepočítá `bucketFor` a `dueLabel`, ručně pushne historii. `triageProjectSel` mění projekt přes `<select>`.
- **`bucketFor(date)`** [2531] (legacy den) i **`_bucketISO(iso)`** [2644] (ISO) musí dávat konzistentní `group/day`. ISO varianta je „pravdivá" napříč měsíci.
- **`goTo`** [2257] vždy: zruší `selectedId`, zavře `addOpen`, vyčistí `search` a `projFilter`; pro kalendář nastaví `_needScroll7` (auto‑scroll na 7:00/teď).
- **Mobil:** `isMobile = vw<880` [3011] — přepíná desktop/mobilní navigaci (`deskNav`), skrývá Watson pruh, mění toolbar.
- **Flash nového úkolu:** `justAdded` se po 1600 ms vynuluje [2473]; undo také `justAdded:null`.
- **Toast** (`_flowToast`): používán napříč (undo/redo, triage, postupy, cíle) — jeden globální mechanismus zpráv.

---

### Reference na čísla řádků (rychlý index)
- Stav: 1896–1910 · ICONP: 1921–1953 · parseQuick: 1959–2003 · parseRecurrence: 2005–2048 · seed: 2136–2187 · componentDidMount/keyboard: 2190–2237 · componentDidUpdate(hist+scroll): 2239 · persist: 2241 · goTo/lock/undo/redo/focusSearch: 2257–2261 · _kbList: 2262–2276 · buildPalette: 2279–2294 · openProj: 2295 · setActiveWs/wsCollapse: 2319–2320 · inWS/allGoals: 2321–2322 · createGoal: 2345 · createTask: 2448–2474 · onSearch: 2475 · occurrence akce: 2477–2482 · _advance/_reflow: 2483–2488 · FLOW_TEMPLATES: 2501–2530 · bucketFor: 2531 · setCal/calNav/calToday/setDensity: 2578, 2660–2662 · _pushHist: 2655 · listTasks(horizont 16): 2654 · cycleSort/showDone/sortDir/setFilter: 2713–2721 · toggleSearch: 2722 · PROJECTS/WORKSPACES/PEOPLE/WS_MEMBERS: 2082–2134 · GOALS: 2110–2123 · GOAL_TEMPLATES: 2323–2330 · render filtr/sort/skupiny: 3005–3066 · search obrazovka: 3070–3081 · render bundle: 3223–3263 · tahák (template): 1629–1671.
