> Generováno multi-agentním auditem (14 modulů × audit + adversariální ověření v kódu), 2026-06-30. ~29 agentů. Doplňuje [RECONCILIACE](RECONCILIACE_design_vs_kod.md).

# Gap Report: Cloud Design vs. současná implementace

**Stav k 30. 6. 2026** — ověřeno per modul z kódu (každá položka má důkaz: `protoRef` v handoffu + `codeEvidence` v repu).
**Metodika:** položka je `done` jen při věrné shodě s prototypem (vizuál + funkce), `partial` = existuje, ale liší se vizuálně nebo funkčně (typicky „vizuál ano, akce ne" nebo „logika ano, fidelita ne"), `missing` = v kódu zcela chybí.

---

## 1) SHRNUTÍ NAHOŘE

### Celkový stav

| Metrika | Hodnota |
|---|---|
| Položek celkem | **517** |
| `done` | **94 (18,2 %)** |
| `partial` | **86 (16,6 %)** |
| `missing` | **337 (65,2 %)** |
| Hotovo nebo rozpracováno (done+partial) | **34,8 %** |
| Vážený postup (done + ½·partial) | **~25,7 %** |

> **Realita bez příkras: necelá pětina aplikace je hotová 1:1 dle Cloud Design. Dvě třetiny položek v kódu vůbec nejsou.** Polovina deklarovaných obrazovek v navigaci jsou prázdné stuby.

### Modul × stav

| Modul | done | partial | missing | total | done % | vážený % |
|---|---:|---:|---:|---:|---:|---:|
| **Nastavení** | 20 | 5 | 6 | 31 | 65 % | 73 % |
| **Shell** | 19 | 8 | 13 | 40 | 48 % | 57 % |
| **Přidat úkol + parser** | 15 | 6 | 17 | 38 | 39 % | 47 % |
| **Projekty** | 8 | 12 | 14 | 34 | 24 % | 41 % |
| **Nadcházející** | 7 | 9 | 21 | 37 | 19 % | 31 % |
| **Detail úkolu** | 7 | 8 | 21 | 36 | 19 % | 31 % |
| **Průřez** | 6 | 9 | 18 | 33 | 18 % | 32 % |
| **Dnes** | 6 | 10 | 29 | 45 | 13 % | 24 % |
| **Kalendář** | 5 | 5 | 24 | 34 | 15 % | 22 % |
| **Úkoly/seznam** | 0 | 11 | 23 | 34 | 0 % | 16 % |
| **Schránka + Hledat** | 0 | 3 | 36 | 39 | 0 % | 4 % |
| **Postupy / štafeta** | 1 | 0 | 43 | 44 | 2 % | 2 % |
| **Cíle** | 0 | 0 | 43 | 43 | 0 % | 0 % |
| **Reporty** | 0 | 0 | 29 | 29 | 0 % | 0 % |
| **CELKEM** | **94** | **86** | **337** | **517** | **18 %** | **26 %** |

---

## 2) KRITICKÉ CHYBĚJÍCÍ CELKY

> Tyto věci **nejsou rozpracované — neexistují**. Jde o celé obrazovky/subsystémy. Bez nich aplikace nesplňuje slíbený rozsah a část navigace vede „doslova nikam".

### 🔴 A. Čtyři celé moduly jsou stub `Placeholder` (jen ikona + „Připravujeme")
Routy existují (`router.tsx`), klikání funguje, ale cílová obrazovka je `apps/web/src/screens/Placeholder.tsx`:

1. **Cíle (Goals) — 0/43.** Nula implementace. Chybí i DB tabulka `goals`, enumy (metric/scope/periodic), 4 výpočetní metriky (completion/ontime/count/project), karty, detail, builder, progress ring, milníky, periodicita, scoping, napojení do Reportů/Hledání/Dnes. Route `/cile` → Placeholder.
2. **Reporty — 0/29.** Nula implementace. Chybí Přehled (3 KPI, týdenní graf, „Podle projektu", Cíle), tab Lidé (roster s vytížením), celý **Member detail panel** (efektivita, staty, role-segment Admin/Člen/Host, úkoly člena, byProj, cíle člena), invite modal. Route `/reporty` → Placeholder.
3. **Postupy / štafeta — 1/44.** Hotová je **jediná položka: nav odkaz + ikona + překlad.** Cílová obrazovka = Placeholder. Chybí: datový model (`chains`/`chain_steps` ani flow sloupce na `tasks`), seznam postupů, detail (časová osa, relay-avatary, rewind, ETA), builder modal, šablony, **celé jádro `_advance`/`_reflow`** (předání štafety, kaskáda termínů), gate sémantika (auto/manual/parallel), flow chip na kartách, panel „Tvůj další krok" na Dnes.
4. **Schránka (inbox triage) — 0/16 vlastní obrazovky.** Route `/schranka` → Placeholder. Chybí triage karty, tlačítka Dnes/Zítra/Příští týden, přiřazení projektu, undo historie, prázdný stav. (Sidebar badge počítá inbox heuristikou přes název projektu „Doručené/Inbox", ne přes `inbox` flag — viz Schránka modul.)

### 🔴 B. Hledat (fulltext + ⌘K) — 0 done
Route `/hledat` → Placeholder. Chybí: vyhledávací stránka s 5 entitními typy (úkoly/projekty/lidé/postupy/cíle), počítadlo s českou pluralizací, **command palette ⌘K**, inline header search (lupa v headeru je vizuální atrapa **bez `onClick`**). Permission-aware scope neexistuje.

### 🔴 C. Úkoly/seznam — 0 done (jediný modul s nulou done, ale s 11 partial)
Modul „existuje", ale **ani jedna položka není 1:1.** Chybí tab **Nástěnka/Board** (komentář v kódu sám přiznává „follow-up #17"), celý **toolbar** (Filtr/Řazení/směr/Dokončené popovery), zámek výchozího zobrazení, seskupení respektující workspace scope. Kalendář je jen měsíční pohled.

### 🔴 D. Průřezové subsystémy, které chybí napříč celou aplikací
- **Globální klávesové zkratky** — žádný `window` keydown handler. Chybí `/`, `q`, **⌘K paleta**, **G-navigace** (g d/n/u…), Esc kaskáda, seznamová navigace (j/k/Space/1-4/⌫), tahák `?`. Existují jen 2 lokální `onKeyDown` na konkrétních inputech.
- **Watson / AI panel** — neexistuje. Header pill „Watson" i „Více →" na Dnes jsou **bez `onClick`**. Žádné AI návrhy/insights (jen prázdné enum konstanty v `shared`).
- **Opakování engine** — parser opakování je hotový a otestovaný (320/320 korpus), ale **jeho výstup se zahazuje**: `INSERT` při vytvoření úkolu sloupec `recurrence` vynechává. Chybí `_recOccur` (projekce výskytů), `makeOcc` (virtuální výskyty), `exceptions` (per-výskyt skip/done), posun řady při dokončení (R4). `CalendarMonth.tsx:16` to v komentáři přiznává.
- **Multi-workspace scoping + přepínač** — frontend nemá pojem „aktivní prostor" (grep `activeWs`/`setActiveWs`/`inWS` = 0). Today/Úkoly/Nadcházející berou všechny tasky bez ws filtru. Sekce „Pracovní prostory" v sidebaru i přepínač prostorů **chybí**.
- **Modal „Přidat úkol"** — neexistuje (grep `addOpen`/`openAdd` = 0). Obě brass tlačítka („+ Přidat úkol", „+ Úkol") jen `navigate({to:'/'})`. Inline `QuickAdd` parser je výborný, ale ukládá jen ~6 z ~20 polí.
- **Mobil** — žádná detekce mobilu (`matchMedia`/`isMobile` = 0), žádná spodní lišta. Sidebar se renderuje vždy.

---

## 3) PER MODUL — všechny partial + missing položky

Formát: **feature** — proč (status) — `protoRef`.

---

### Nastavení — 20 done / 5 partial / 6 missing (nejhotovější modul)

**Co je done (1:1):** sekce Vzhled (nadpis, Tmavý režim řádek+popis+přepínač 42×24 brass, `toggleTheme` na `data-w-theme`+persist, Hustota řádek + statický „Tweaks" badge), sekce Účet (avatar iniciály 40px, Odhlásit s reálným signOut), Tým a role (jen pro tým, roster z reálného API, role badge se šipkou, 4 role taxonomie, **změna role přes PATCH = nad rámec prototypu**, řádek „Pozvat člena" vzhled), Oznámení a Watson (oba řádky + dekorativní přepínače), layout 680px + karty radius 13. Sekce Oznámení přepínače jsou dekorativní ON — **shoda s prototypem** (ten je taky napevno).

**partial:**
- **Karta Účet — řádek „email · pracoviště"** — kód místo lokality vkládá název týmového workspace. `WatsonApp.dc.html ř.907`
- **Hlavička Tým a role — barevná tečka workspace** — tečka natvrdo brass místo barvy dle workspace (proto má 3 různé). `ř.912-916`
- **Řádek člena — sekundární text „pozice · email"** — kód ukazuje jen email, chybí pracovní pozice (`job`); `Member` typ pole nemá. `ř.923`
- **Dropdown změny role** — nabízí jen 3 role (chybí „Vlastník"); u vlastníka se menu vůbec neotevře (proto otevírá vždy). `ř.927-934`
- **Zavření role-menu při kliku mimo** — kosmetická poznámka; fakticky parita s prototypem (ani ten nemá document handler). `ř.928`

**missing:**
- **Panel Tweaks — interaktivní hustota rozhraní** (Vzdušné/Vyvážené/Kompaktní) — mechanismus neexistuje; proto ho vystavuje jen jako DC-editor prop. `ř.40-42`
- **Panel Tweaks — accent „Více barev / Jen brass"** — žádný `data-w-accent` ani atribut na rootu. `ř.77`
- **Avatar/jméno člena klikací → karta člena** — žádný `onClick`, ač `teamNote` text klik slibuje. Member detail v reálné app neexistuje. `ř.920,922`
- **Akce „Pozvat člena" — `onClick`** — řádek má `cursor:pointer`, ale žádný handler → kliknutí nic neudělá. `ř.937`
- **Modal „Přidat člena týmu"** (jméno/email/Pozvat) — celý invite modal neexistuje (grep `memberModal` = 0). `ř.1273-1288`
- **Animace rozbalení role-menu (wPop)** — chybí. `ř.928`

---

### Shell — 19 done / 8 partial / 13 missing

**Co je done:** sidebar kontejner (navy 232px), logo Watson, railtog toggle, 9 nav položek + ikony + badge počítadla, aktivní stav (brass okraj), sekce Oblíbené + P1/Přiřazeno mně markery, footer s reálnou session, collapsed režim 62px + tooltips + collapsed inset shadow, animace šířky, AppLayout kompozice, header kontejner/titul, theme toggle (jediná funkční akce v pravém bloku headeru), jazykový přepínač (nad rámec proto), Watson strip na Dnes.

**partial:**
- **Sync/offline tečka u loga** — kód z dekorativní brass tečky dělá dynamický sync indikátor (rozumné, ne 1:1). `ř.168`
- **Brass „Přidat úkol"** — vzhled 1:1, ale akce jen `navigate({to:'/'})` místo otevření quick-add modalu. `ř.173-176`
- **Header podtitulek „{n} úkolů"** — jen na Dnes (proto na všech workspace obrazovkách); chybí část „· {timeLabel}". `ř.269-272`
- **Header lupa (Hledat)** — vizuál 1:1, ale **bez `onClick`**. `ř.296-298`
- **Header zvonek (oznámení)** — vizuál 1:1, **bez `onClick`**. `ř.300`
- **Header Watson pill** — vizuál 1:1, **bez `onClick`** (neotevírá panel). `ř.305-307`
- **Header brass „+ Úkol"** — vizuál 1:1, akce jen navigace místo openAdd. `ř.308-310`
- **Routing nav cílů** — 7 cílů jsou Placeholder stuby (/hledat, /schranka, /cile, /reporty, /postupy, /oblibene/p1, /oblibene/me). `README ř.16-26`

**missing:**
- **Hover stav nav položky** — `NavRow` neimplementuje hover color shift pro neaktivní text. `ř.181-217`
- **Sekce „Pracovní prostory" — multi-team strom** — celá sekce chybí (nadpis, prostory, projekty). `ř.233`
- **Workspace chevron collapse/expand** — žádná logika rozbalování prostorů. `ř.236`
- **Workspace barevná tečka + název + počet** — nerenderuje se. `ř.237-239`
- **Vnořené projektové řádky pod prostorem** — klikací projekty v sidebaru chybí. `ř.241-247`
- **Persistence sbalení (railCollapsed)** — jen lokální `useState`, neukládá se. `ř.2194`
- **Header view-switcher (Seznam/Nástěnka/Kalendář) + zámek** — na úrovni shellu chybí. `ř.277-289`
- **Header Filtr ▾ / Seřadit ▾ + směr** — v headeru chybí. `README ř.28`
- **Mobilní spodní lišta (5 položek)** — zcela chybí. `ř.962-968`
- **Responzivní desktop↔mobil přepínání** — žádná detekce mobilu. `ř.165,962`
- **Globální klávesové zkratky** (`/`, Q, ⌘K, G+, Esc, ?) — žádný globální handler. `README ř.50-53`
- **Command palette ⌘K** — neexistuje. `README ř.51`
- **Cheat sheet `?`** — neexistuje. `README ř.51`

---

### Přidat úkol + parser — 15 done / 6 partial / 17 missing

**Co je done (silné jádro):** kompletní parser (orchestrátor `parseQuick` se závazným pořadím pravidel, priorita, čas 4 varianty, trvání 6 variant, vícedenní rozsah, datum, `parseRecurrence` větve A-D, holý den v týdnu, #projekt exact, @/+osoba s hranicí slova, čistý název, datové funkce, české číslovky + řadové), **zvýraznění tokenů overlay**, **korpusové testy 320/320 ověřeno spuštěním**.

**partial:**
- **Našeptávač #projekt** — ↓↑Enter + fuzzy + max 6 OK, ale chybí workspace scoping a barevná tečka projektu + akční text. `ř.2390-2402`
- **Našeptávač — Escape** — kód přidá mezeru (mění text) místo prostého skrytí. `ř.2400`
- **Pilulky atributů** — read-only náhled OK, ale osoba se zobrazí jako surový dotaz `@adam` (neresolvuje se), projekt bez barvy; v proto jsou interaktivní (otevírají popovery). `screenshot 18`
- **Náhled k potvrzení** — overlay-zvýraznění existuje v inline baru, ale modální náhled (tečka projektu, pilulky-popovery, Zrušit/Přidat) chybí; proto má víceřádkový textarea, kód jednořádkový input. `ř.1679-1682`
- **Patička modálu** — submit-disabled-bez-názvu OK, ale chybí helper text se syntaxí, varování „úkol potřebuje název", tlačítko Zrušit; placeholder se liší. `ř.1881-1886`
- **submitTask** — uloží jen ~6 z ~20 polí (chybí desc, čas/start/end, trvání, dny/endDate, assignees+mode, color, deadlineLabel, přílohy, recurring+repeat config, inbox/overdue, flow bump, justAdded). `ř.2447-2474`

**missing:**
- **Našeptávač @osoba/+osoba** — DOWNGRADE na missing: `Today.tsx` nepředává `people` → filtr vždy prázdný → dropdown se **nikdy** nezobrazí (mrtvý kód); `applySug` jen vloží text místo přidání osoby. `ř.2392-2393`
- **Modal „Přidat úkol"** — neexistuje (grep `addOpen`=0). `ř.1674-1889`
- **Otevření modálu** (sidebar/header openAdd) — jen `navigate({to:'/'})`. `ř.173/308`
- **Zkratka „q" otevře, Esc zavře** — žádný globální handler. `ř.2220`
- **Pole „+ Přidat popis"** — inline QuickAdd popis nemá. `ř.1700-1705`
- **Interaktivní atribut-pilulky + „Více/Méně"** — pilulky jsou read-only. `ř.1707-1726`
- **Popover Projekt** (hledání + seznam) — chybí. `ř.1730-1744`
- **Popover Termín** (chipy, custom date+time, Více dní stepper) — chybí. `ř.1746-1771`
- **Popover Priorita** (chipy P1-P4) — chybí. `ř.1773-1779`
- **Popover Přiřazení** (osoby, kdokoli/každý zvlášť) — chybí; submit osoby neukládá. `ř.1781-1794`
- **Popover Trvání** — chybí. `ř.1796-1806`
- **Popover Deadline** (date + validace ≥ termín) — chybí. `ř.1808-1815`
- **Popover Opakování** (konec Nikdy/K datu/Po počtu, projekce) — chybí; submit recurrence neukládá. `ř.1817-1852`
- **Popover Barva úkolu** — chybí. `ř.1854-1862`
- **Popover Přílohy** — chybí. `ř.1864-1871`
- **Popover Připojit k Postupu** — chybí. `ř.1873-1876`
- **openAddAt / klik do kalendáře → předvyplněný add** — chybí. `ř.2664`

---

### Projekty — 8 done / 12 partial / 14 missing

**Co je done:** titulek „Projekty", grid auto-fill minmax(290px,1fr), karta (tečka + název, počty REÁLNÉ z tasks, hover, klik→detail), prázdný stav (nad rámec proto), zavření detailu (overlay/X/Zavřít).

**partial:**
- **Hlavička: tečka + název workspace** — tečka natvrdo brass, název = první ne-osobní WS, ne „aktivní". `ř.694-695`
- **Karta: progress bar** — zobrazuje se pro všechny projekty (proto jen non-flow); typ projektu v DB neexistuje. `ř.713-715`
- **Karta: „P % hotovo"** — vždy (nepodmíněno typem), špatný layout řádku. `ř.731-732`
- **Karta: max 6 / scoping na WS** — kód zobrazuje všechny bez limitu a bez WS filtru → možný nesoulad s názvem WS v hlavičce. `ř.3181`
- **Detail panel: slide-in** — šířka 448 vs 420, backdrop opacity jiná, chybí slide animace, přidán 4px barevný okraj. `ř.1222-1223`
- **Detail header: tečka+titulek+X** — titulek font-weight 600 vs 700, ink-3 vs ink-2. `ř.1224-1228`
- **Detail: pole Název** — chybí uppercase label + bordered panel-2 box; text-lg vs 16px. `ř.1230-1231`
- **Detail: sekce Barva** — výchozí dlaždice „✓" místo diagonální čáry. `ř.1232-1236`
- **Detail: sekce Stav** — jen 2 stavy (Aktivní/Archiv); chybí Pozastavený/Hotovo. `ř.1245-1247`
- **Detail: statistiky** — boxy místo holých číslic, font 20 vs 22px. `ř.1258-1263`
- **Detail patička** — „Zavřít" bez panel-2 pozadí. `ř.1265-1267`

**missing:**
- **Karta: badge TYP** (Průběžný/Cílový/Periodický) — sloupec `kind` v DB chybí. `ř.706-708`
- **Karta: stav badge 4 barevné** — jen binární archived; navíc `useProjects` filtruje archived → Archiv badge se nikdy nezobrazí. `ř.705`
- **Karta: termín dodání** — sloupce v DB nejsou. `ř.707`
- **Karta: sparkline (flow)** — chybí. `ř.717`
- **Karta: flow staty (✓/↑/⚠)** — chybí. `ř.718-722`
- **Karta: avatary vlastníka + členů** — jen číselný počet; `owner_id` na projektu chybí. `ř.724-730`
- **Detail: sekce Typ projektu** — celá chybí (DB `kind` neexistuje). `ř.1237-1240`
- **Detail: sekce Vlastník** — chybí (`owner_id` jen na workspaces). `ř.1241-1244`
- **Detail: Termín dodání** — chybí. `ř.1249-1251`
- **Detail: Definice hotového (DoD)** — chybí. `ř.1252-1253`
- **Detail: Členové (toggle avatary)** — jen číselný počet, žádná správa členství. `ř.1255-1257`
- **Nový projekt — funkční vytvoření** — tlačítko trvale `disabled`, žádný handler/modal/insert. `ř.696`
- **Detail: efektivní progres goal/cycle** — záměrné demo-zjednodušení, není vada. `ř.3130-3131`
- **🔑 Datový model: `kind`/`owner_id`/`status` enum/`delivery_date`/`definition_of_done`** — **KOŘENOVÁ PŘÍČINA**: `projects` tyto sloupce nemá → nelze postavit typ, vlastníka, 4-stavový status, termín ani DoD. `logika/03 §3.1`

---

### Nadcházející — 7 done / 9 partial / 21 missing

**Co je done:** skrytí prázdných skupin, rozdělení overdue/today, titulek (z route labelKey), řádek = priorita (inset 3px) + neutrální P-odznak, termín mono (overdue červeně), zaškrtávátko→completed_at (R9), klik→detail, počet u skupiny.

**partial:**
- **Skupiny „Dnes"/„Zítra"** — labely jen „Dnes"/„Zítra" bez dne v týdnu; jde o per-day grupování, ne sémantické buckety. `ř.3048`
- **Sekce „Zpožděné"** — kód má (proto Nadcházející overdue nezobrazuje — patří do Dnes); chybí akce Přeplánovat. `screenshot 02`
- **Horizont projekce ~16 dní** — konstanta sedí, ale slouží jako tvrdé ořezání reálných úkolů, ne okno pro generování výskytů. `ř.2654`
- **Řádek: tečka + název projektu v podřádku** — `TaskItem` nepředává `project` → projekt se nevykreslí; ws tečka chybí úplně. `ř.418,422`
- **Řádek: status pill** — `TaskCard` umí, ale `TaskItem` status nepředá → nikdy se nezobrazí. `screenshot 02`
- **Prázdný stav** — váže na celý dotaz; text `today.empty` je Dnes-specifický; úkoly mimo horizont 16 dní zmizí bez vysvětlení. `groups.length===0`
- **Sidebar badge** — počítá vše s termínem > dnes bez horizontu a bez výskytů → čísla se rozejdou s proto. `ř.3150`
- **Lokalizace názvů skupin** — i18n + CZ/EN formát je, ale pojmenované buckety jako koncept chybí. `ř.3048`

**missing:**
- **Skupina „Víkend"** — kód víkend nesdružuje. `ř.3048/2649`
- **Skupina „Příští týden"** — chybí. `ř.3048/2649`
- **Skupina „Začátkem příštího měsíce"** — chybí; úkoly za 16 dní vypadnou. `ř.3048/2649`
- **Skupina „Později" (custom)** — chybí; úkoly s d>horizon se **tiše zahodí**. `ř.3048/2649`
- **Akce „Přeplánovat zpožděné"** — overdue hlavička bez tlačítka. `ř.320,412`
- **Projekce výskytů opakování** — chybí (SQL bere jen reálné řádky). `listTasks ř.2654`
- **Per-výskyt štítek termínu (occLabel)** — chybí. `ř.2651`
- **Per-výskyt dokončení/přeskočení (exceptions)** — chybí. `ř.2482,2477`
- **Pod-info „{count} úkolů · {timeLabel}"** — jen na Dnes, bez času. `ř.270-273`
- **Přepínač Seznam/Nástěnka/Kalendář** — chybí. `ř.277-282`
- **Zámek výchozího zobrazení** — chybí. `ř.283-287`
- **Workspace chipy (Vše/Moje/Kancelář/Sokol)** — chybí. `ř.3256`
- **Toolbar: Filtr** — chybí. `ř.347`
- **Toolbar: Třídění + směr** — pevné ORDER BY due_date. `ř.377-389`
- **Toolbar: „Dokončené"** — SQL natvrdo `completed_at IS NULL`. `ř.390`
- **Řádek: časový rozsah „09:00–10:30"** — schéma nemá start/end čas. `ř.2902`
- **Řádek: flow chip postupu** — chybí. `ř.423`
- **Řádek: „→ Přišlo na tebe"** — chybí. `ř.424`
- **Řádek: ikona opakování ↻** — chybí. `ř.426`
- **Řádek: podúkoly/připomínky/komentáře ikony** — chybí. `ř.425,427,428`
- **Řádek: avatary přiřazených** — chybí. `screenshot 02`

---

### Detail úkolu + Výskyt — 7 done / 8 partial / 21 missing

**Co je done:** header tečka+název projektu, zavírací X, sekce Popis (editovatelná, aditivní), **Podúkoly R1** (toggle, line-through, přidání, max hloubka 3), start_date editace, barva úkolu R6 (picker), smazat úkol (DELETE).

**partial:**
- **Slide-in panel + backdrop** — chybí wSlide animace, max-w-md vs 444px, jiný backdrop, 4px barevný okraj navíc. `ř.974-976`
- **Toggle dokončení kruhem** — 20px v headeru (ne 22px vedle názvu), ✓ textový znak, success místo brass. `ř.993-996`
- **Název úkolu** — text-lg vs 19px, chybí flex-row s kruhovým checkboxem. `ř.991-996`
- **Odznak Priorita** — kód má editor P1-P4 místo read-only pill v meta řádku. `ř.1011`
- **Odznak Termín** — date input místo read-only pill; chybí čas + overdue červené zvýraznění. `ř.1012`
- **Odznak „↻ Opakuje se"** — zobrazí SUROVÝ recurrence text místo lokalizovaného pill. `ř.1014`
- **Deadline editace** — chybí zřetelné/červené zvýraznění (B2/R6) — jen neutrální input. `task.ts ř.46-47`
- **Patička „Zavřít"** — lze X/backdrop, ale textové tlačítko v patičce chybí (patička neexistuje). `ř.1076`

**missing:**
- **3-tečkové menu (Duplikovat/Kopírovat odkaz/Smazat)** — žádný kebab; jen Smazat jako ikona. `ř.980-989`
- **Banner výskytu řady + „Upravit celou řadu →"** — klient nezná virtuální výskyty. `ř.999-1008`
- **Odznak Stavu (Probíhá/Ke kontrole/Hotovo)** — detail status_id nečte. `ř.1013`
- **Odznak „Připomenutí"** — reminder neexistuje v DB ani UI. `ř.1015`
- **Watson hint banner (W + rada)** — chybí. `ř.1018-1021`
- **Sekce Přiřazení (nadpis)** — `assignments` není v AppSchema. `ř.1038`
- **Režim „každý zvlášť" (per-osoba checkbox)** — neimplementováno (R2). `ř.1039-1049`
- **Režim „stačí kdokoli"** — chybí. `ř.1050-1060`
- **Přepínání režimu single/any/all** — `assignment_mode` se nikde nečte/nezapisuje. `R2`
- **Sekce Komentáře · N** — chybí. `ř.1062`
- **Výpis komentářů** — `comments` tabulka neexistuje. `ř.1063-1068`
- **Vstup „Napsat komentář…"** — chybí. `ř.1069-1071`
- **@mentions** — chybí. `(modul)`
- **Štítky (labels)** — tabulky nejsou v AppSchema. `task.ts ř.109-134`
- **Checklist (R1)** — `checklist_items` chybí v AppSchema. `task.ts ř.93-102`
- **Připomínky** — chybí i v datovém modelu. `ř.1015`
- **Trvání (duration_min)** — detail ignoruje (parsuje se jen v QuickAdd). `B3`
- **Patička „Označit hotovo" (brass full-width)** — patička neexistuje. `ř.1073-1074`
- **Patička „Přeskočit" (výskyt)** — klient nezná exceptions. `ř.1075`
- **Per-výskyt vs řada chování** — mechanismus výskytů neexistuje. `ř.1005`
- **Recurrence „Upravit celou řadu →"** — chybí. `ř.1006`

---

### Průřez — 6 done / 9 partial / 18 missing

**Co je done:** light/dark tokeny (1:1 s README), dark mode přepínač, priorita=barva levého okraje, offline/Synced indikátor (reálný PowerSync, nad rámec proto), error stav zápisu (write-rejected toast, nad rámec proto), parser opakování → strukturované pravidlo (hotový, ale výstup se zahazuje — viz persistence).

**partial:**
- **Globální hustota (data-w-density)** — jen jedna úroveň tokenů, atribut se nesází, Nastavení má jen kosmetický pill. `ř.40-42`
- **Barevný systém projektů (R6)** — paleta 10 sedí, ale barví jen tečku, ne tělo karty (drift proti R6). `ř.75-76`
- **Multi-workspace scoping** — backend má ws+memberships, frontend pojem „aktivní prostor" nemá; úkoly bez ws filtru. `ř.2319-2321`
- **Workspace persona scoping (isPersonal)** — datový rozdíl existuje, používá se jen k výběru názvu týmu; reálný scoping/přepínání chybí. `mail-plan`
- **Watson greet** — strip na Dnes hezký, ale „Více →" bez `onClick`, čistě lokální heuristika, mimo Dnes není. `ř.319-321`
- **Loading stav** — žádný skeleton/gate; undefined→[] padá rovnou do empty (nerozliší „načítá" vs „prázdno"). `ř.157`
- **Empty stavy** — existují, ale sjednoceny na jeden generický `today.empty`; varianty proto chybí. `ř.448-449`
- **Opakování — datový model** — jen `recurrence` text + `recurrence_basis`; chybí strukturovaná pole + `exceptions`. `logika 02 §1.1`
- **Projekce do seznamů/kalendáře (16 dní okno)** — horizont/okno funguje, occurrence projekce ne. `ř.2654,2633`

**missing:**
- **Uživatelská barva úkolu (per-uživatel, [data-tc])** — sloupec `color` na tasku existuje, UI ho nikde nepoužívá. `ř.62-63,118`
- **Štítky globální pro tým, skryté hostům (R7)** — ani schéma, ani UI. `R7`
- **Přepínač prostorů + sekce „Pracovní prostory"** — chybí (jen footer s jedním názvem). `ř.3177`
- **Klávesový handler (_onKey, field-ignore, Esc kaskáda)** — žádný globální listener. `ř.2202-2237`
- **Command palette ⌘K** — neexistuje. `ř.2207`
- **G-navigace (leader G + D/N/U/K/P/C/R/S/I/H)** — chybí. `ř.2216-2217`
- **Seznamová klávesová navigace (j/k/Space/1-4/⌫)** — chybí. `ř.2262-2276`
- **Klávesy v detailu (j/k prev/next, Esc)** — chybí. `ř.2221-2225`
- **Tahák zkratek (?)** — chybí. `ř.1629-1671`
- **Kalendářové klávesy (←/→/D/1/2/3)** — jen tlačítka; navíc jen měsíční pohled. `ř.2228-2235`
- **Watson/AI panel** — neexistuje; header pill bez funkce. `ř.1476-1505`
- **AI návrhy/insights** — jen prázdné enum konstanty. `ř.1486-1494`
- **Projekční engine `_recOccur`** — neexistuje (komentář v `CalendarMonth.tsx:16`). `ř.2640`
- **makeOcc / virtuální výskyt** — chybí. `ř.2646-2652`
- **Exceptions (per-výskyt skip/done/override)** — žádná tabulka ani UI. `ř.2477-2482`
- **Posun řady při dokončení (R4, repeatDoneCount, reset per-osoba)** — toggle jen přepne completed_at. `ř.2482,2643`
- **Detail výskytu (banner + Přeskočit)** — chybí. `ř.999-1006,1075`
- **Persistence opakování při vytvoření** — `INSERT` sloupec recurrence vynechává → opakování se zahodí. `submitTask ř.2447-2474`

---

### Dnes — 6 done / 10 partial / 29 missing

**Co je done:** Watson strip kontejner + tečka+label WATSON, skupina „Zpožděné" (hlavička+count+Přeplánovat), rozdělení overdue/today, due label „po termínu · st", QuickAdd s parserem (umístění inline je ale nad rámec proto layoutu).

**partial (10):** Watson strip text greet (narativní Watson insight chybí), akce „Přeplánovat" (proto vždy, kód jen při overdue>0), „Více →" (pasivní span bez `onClick`), viditelnost stripu (chybí `!isMobile`), skupina „25. června · Dnes · čtvrtek" (dynamicky, ne fixní string), filtrace prázdných skupin (proto filtruje obě, kód renderuje Dnes vždy), „Dokončené" (sbalitelná sekce „Hotovo" místo inline toggle), řádek úkolu základ (chybí ws tečka + celý pravý/druhý řádek), status pill (`Today.tsx` status nikdy nepředá), prázdný stav (jiný text + per-skupina).

**missing (29):** workspace chipy row + „Vše" + per-WS s tečkou + filtrace `dayWf`; celý toolbar (Filtr tlačítko + dropdown Priorita/Stav/Projekt/Osoba + Vymazat; Řazení sortLabel2 + 6 voleb + směr; aktivní filtr chipy + overlay zavírání); „Tvůj další krok v postupech" (nadpis + karta kroku); vyloučení dormantních postupových kroků (waiting); respektování ws/filtrů/řazení/showDone (decL); flow chip; „→ Přišlo na tebe"; podúkoly (0/3); ↻ opakování; reminder; komentáře (2); deadline pill; avatary (assignAny/assignAll „Každý zvlášť · X/Y"); prázdný stav projektového filtru + CTA; header „19 úkolů · 8,8 h" (timeLabel).

---

### Kalendář — 5 done / 5 partial / 24 missing

**Co je done:** měsíční mřížka pondělí-first (dnešek brass, mimo-měsíc ztlumené), barva=priorita na okraji chipu, klik→detail, inline dokončení (zaškrtávátko + stop-propagation), vizuální stav hotového úkolu.

**partial (5):** měsíční buňka max 3 + „+N" (kód „+N" bez `onClick`, nepřepne na den), chip (chybí čas + iniciály přiřazeného), navigace období (jen měsíc, lokální offset, chybí calMode-aware ±7/±1), filtrování search/scope (project-scope částečně přes URL, fulltext q chybí), kalendář jako obrazovka (architektonicky view-tab v Úkolech, ne samostatná routa s toolbarem den/týden/měsíc).

**missing (24):** přepínač Den/Týden/Měsíc + klávesy 1/2/3; denní grid (buildDay); týdenní grid (buildWeek); týden sloupcový seznam + Sloupce/Mřížka; cycleBorder (priorita↔projekt); hustota PPM; now-linka; all-day pás; multi-day pruhy; drag move; resize; drag-create; klik→add v čase; DnD mezi dny v měsíci; DnD do/z all-day; DnD z all-day do gridu; layoutDay (překryvy); „+N" bublina v gridu; **projekce opakování do kalendáře (calTasks/_recOccur)**; navigace kolečkem; postranní panel Plánování; gear menu; auto-scroll na 7:00; per-výskyt drag/resize (dayTimes).

---

### Úkoly/seznam — 0 done / 11 partial / 23 missing

**partial (11):** přepínač zobrazení (jen 2 taby, chybí Nástěnka), vzhled přepínače (2 tlačítka místo segmentovaného pillu), seskupení dle projektů (chybí WS scope, jiné řazení skupin, inbox do „—"), banner filtrovaného projektu (chybí „Upravit projekt"), prázdný stav projektu (generický text), prázdný stav bez filtru (jiný text), řádek úkolu (chybí status/deadline/↻/reminder/subtasky/flow/avatary), termín barevný stav (jen overdue vs ne, proto víc stavů), řazení (pevné SQL, ne 6 režimů), kalendář view (jen měsíc, bez drag), max-width (768/1024 vs 1080px).

**missing (23):** podmínka showViewSwitcher; **zámek výchozího zobrazení** + label „Výchozí:" + persistence; hlavička skupiny „Přeplánovat"; celý toolbar; Filtr popover (tlačítko + Priorita + Stav + Projekt + Osoba + Vymazat); aktivní filtr chipy; Řazení popover (tlačítko + 6 voleb); přepínač směru; „Dokončené" toggle (dokončené natvrdo skryté); overlay zavírání; **celý Board** (4 statusové sloupce + sloupec záhlaví/karty/Přidat + board karta + **DnD mezi sloupci** + zdroj úkolů + pořadí boardOrder).

---

### Schránka + Hledat — 0 done / 3 partial / 36 missing

**partial (3):** sidebar badge Schránky (počítá, ale inbox = projekt jménem „Doručené/Inbox", ne `inbox` flag; bez navazující obrazovky), header search ikon-tlačítko (vizuál OK, **bez `onClick`**), nav položky Hledat/Schránka (navigují, ale na stuby).

**missing (36) — vše níže je Placeholder:**
- **Schránka:** obrazovka, hlavička+počet, vysvětlující odstavec, triage karty, checkbox dokončení, klik→detail, select projektu, tlačítka Dnes/Zítra/Příští týden, divider+kebab, toast „Zařazeno", undo historie, prázdný stav, bez view-switcheru.
- **Hledat:** obrazovka, search pole, počítadlo s pluralizací, úvodní prompt, prázdný stav, sekce Úkoly/Projekty/Lidé/Postupy/Cíle, 5 entit současně, permission-aware scope.
- **Header:** inline rozbalovací search.
- **⌘K paleta:** modal, položky (obrazovky+projekty+lidé+postupy), klávesová navigace, prázdný stav.
- **Zkratky:** `/` fokus, `g i` Schránka, `g h` Hledat, reset search při změně obrazovky.

---

### Postupy / štafeta — 1 done / 0 partial / 43 missing

**Co je done:** **pouze nav položka „Postupy" + ikona + i18n** (`flows`). Cílová obrazovka = Placeholder.

**missing (43) — celý modul:**
- **Datový model** (`chains`/`chain_steps` nebo flow sloupce na tasks: flowId, stepIndex/Total, stepStatus, gate, anchor/offset, gapDays, schedMode, skipWeekend, handedOff, assignMode/role) — ORM ani migrace nemají nic.
- **Obrazovka /postupy** (reálná), hlavička+podtitulek, filtr „Jen kde jsem na řadě", „+ Nový postup", mřížka karet, karta (progress/stuck/„Teď:"/badge Vázne/sort), empty state.
- **Detail panel** (slide-over, progress+ETA, „Uložit jako šablonu", přepínač Řetězec/Kotva, −1d/+1d shift, „Bez víkendů", časová osa s relay-avatary, karty kroků, „aktivace: gate", „Dokončit krok", „Připomenout", **rewind „↩ Vrátit sem"**).
- **Jádro:** `_advance` (předání), **kaskáda termínů**, `_reflow`, gate sémantika (auto/manual/parallel), stavový model kroku, toast vrstva.
- **Builder modal** (název+projekt, kotva + Od začátku/Do termínu, šablony, kroky štafety, per-řádek osoba/role/režim/gate/projekt/priorita, footer, `createFlow`).
- **Integrace:** panel na Dnes, flow chip na kartách, spící kroky filtr, připojení úkolu do postupu, postupy ve Hledání, Enter=dokončit krok.

---

### Cíle — 0 done / 0 / 43 missing

**Celý modul neexistuje.** `/cile` → Placeholder.

**missing (43):** obrazovka; **DB tabulka `goals`**; goal enumy (metric/scope/periodic); záložky scope (Týmové/Projektové/Lidé/Moje); „Nový cíl"; mřížka karet; karta (název/badge/valueLabel/pct/bar; avatar/projekty/perioda); **4 metriky** (completion/ontime/count/project); progres z reálných úkolů (goalTasks); stav+tempo (done/track/risk/over); **detail panel** (název, progress ring, badge+valueLabel+pace, „Jak se měří", target stepper, „Úkoly v hledáčku", 3 dlaždice, periodicita+reset, vlastník, napojené projekty, milníky); **builder modal** (název, 6 šablon, scope segment, metrika segment, „Co se počítá", vlastník/období/termín, opakování segment, footer); workspace scoping; cíle ve Hledání/Reportech/detailu člena; Watson insight na Dnes; zkratka `g c`; editace přes override mapu.

---

### Reporty — 0 done / 0 / 29 missing

**Celý modul neexistuje.** `/reporty` → Placeholder.

**missing (29):** obrazovka; hlavička+workspace; taby Přehled/Lidé; Lidé skrytý pro osobní WS; **Přehled** (3 KPI karty; widget „Dokončeno tento týden" graf; widget „Podle projektu"; widget Cíle); **tab Lidé** (řádek počtu; „Přidat člena"; karty členů s vytížením; avatar navy; badge „X po termínu"); **Member detail panel** (avatar+jméno+role+email; Efektivita %+bar; 3 staty; **role-segment Admin/Člen/Host**; seznam úkolů; prázdný stav; „Podle projektu"; sekce Cíle; patička; overlay/Escape); Member modal „Přidat člena"; `goTo('tym')` alias; vyhledání člena→detail; zkratka `g r`; data-projbar barvy.

---

## 4) PRIORITIZOVANÝ PLÁN UZAVŘENÍ MEZER

Pořadí dle **dopadu** (kolik fundamentu odemkne) × **toho, co je dnes nejvíc rozbité nebo zavádějící**. Odkazy na existující tasky #8–#21 tam, kde sedí.

### P0 — Datové fundamenty (bez nich nelze postavit 3 moduly + půlku detailu)
Tohle je **strop celého projektu** — `missing` ve velkém kvůli chybějícím sloupcům/tabulkám.

1. **Rozšířit schéma `projects`** o `kind`, `owner_id`, `status` enum, `delivery_date`, `definition_of_done` → odemkne ~10 položek modulu Projekty (typ, vlastník, 4-stavový status, termín, DoD, badge na kartě). **(task #~ Projekty enrich)**
2. **Tabulka `goals` + enumy** (metric/scope/periodic/milestones) → odemkne celý modul Cíle. **(#~ Cíle základ)**
3. **Flow datový model** (`chains`/`chain_steps` nebo flow sloupce na `tasks` + `step_status`/`gate` enum) → odemkne modul Postupy. **(#~ Postupy datový model)**
4. **Dotáhnout do AppSchema/PowerSync chybějící tabulky**, které UI potřebuje, ale sync je nemá: `comments`, `labels`/`task_labels`, `checklist_items`, `assignments`, `reminder` → odemkne ~10 položek Detailu úkolu.

### P1 — Odstranit „atrapy" a zavádějící mrtvý kód (vysoký dopad na důvěryhodnost, nízká cena)
Uživatel dnes vidí tlačítka, která vypadají funkčně, ale nedělají nic.

5. **Modal „Přidat úkol"** + napojit sidebar/header brass tlačítka (dnes jen `navigate('/')`) a zkratku `q`. Reuse existujícího parseru. **Zároveň opravit `submitTask`, aby ukládal všech ~20 polí** (dnes ~6) — jinak parser i pilulky lžou. **(#~ Add-task modal)**
6. **Napojit existující header akce bez `onClick`:** lupa→Hledat, Watson pill→panel, zvonek→oznámení, „Více →" na Dnes. (Aspoň navigace, dokud nejsou cílové obrazovky.)
7. **Opravit `TaskItem`/`TaskCard` integraci na seznamech** — předávat `project` a `status`, aby se vykreslila tečka projektu, název v podřádku a status pill (komponenta to umí, jen nedostává data). Dotkne se Dnes, Úkoly, Nadcházející najednou.
8. **Našeptávač osob v QuickAdd** — předat `people` (dnes mrtvý kód) + reálné přidání osoby místo vložení textu.

### P2 — Globální průřezové vrstvy (odemykají UX napříč všemi obrazovkami)
9. **Globální klávesový handler** → `/`, `q`, Esc kaskáda, **G-navigace**, seznamová navigace (j/k/Space/1-4/⌫), tahák `?`. **(#~ Keyboard layer)**
10. **Command palette ⌘K** (na handler navazuje). **(#~ ⌘K palette)**
11. **Multi-workspace scoping + přepínač + sekce „Pracovní prostory" v sidebaru** — frontend pojem „aktivní prostor" + filtrace úkolů/projektů/cílů per WS. **(#~ Workspace scoping)**
12. **Opakování engine** (`_recOccur` + `makeOcc` + `exceptions` + posun řady R4) **a nejdřív opravit persistenci** (INSERT zahazuje `recurrence`). Odemkne Nadcházející buckety, kalendářové výskyty, detail výskytu. **(#~ Recurrence engine, navazuje na fázování plán)**

### P3 — Dostavět chybějící obrazovky (po datových fundamentech)
13. **Hledat + Schránka** (relativně samostatné, střední velikost). Schránka triage je malá; Hledat potřebuje 5-entitní index.
14. **Reporty** (Přehled + Lidé + Member detail) — po `goals` a workspace scopingu.
15. **Postupy** obrazovky + jádro `_advance`/`_reflow` — největší jednotlivý kus, server-authored advance (dle fázování plánu, až po datovém modelu z P0).
16. **Úkoly Board/Nástěnka** (#17 zmíněn v komentáři kódu) + toolbar (Filtr/Řazení/Dokončené) jako sdílená komponenta pro Dnes/Úkoly/Nadcházející.
17. **Kalendář den/týden grid** + drag/resize/drag-create + now-linka (po opakování enginu kvůli výskytům).

### P4 — Fidelity pass + mobil (poslední vrstva leštění)
18. **1:1 vizuální dotažení partial položek** — panely (444px, wSlide animace, backdrop), detail úkolu (kruh 22px vedle názvu, read-only pilulky meta), Projekty detail (labely, panel-2 boxy), barva projektu = **tělo karty** (R6 drift). Sjednotit empty stavy na varianty z prototypu.
19. **Mobil** — detekce viewportu + spodní lišta + responzivní přepínání.
20. **Tweaks panel** (hustota + accent), persistence sbalení sidebaru, hover stavy nav.

---

### Tři věty na závěr, bez příkras
- **Hotová je hlavně „skořápka a vstup":** shell, Nastavení, parser pro přidávání úkolů. To, co dělá produkt produktem (Postupy, Cíle, Reporty, Hledat, Board, kalendářové výskyty, opakování), z velké části **neexistuje** — 65 % položek je `missing`.
- **Největší skrytá past jsou „atrapy":** funkčně vypadající tlačítka bez `onClick` (lupa, Watson, zvonek, +Úkol, Pozvat člena, „Více →") a mrtvý kód (našeptávač osob), plus parser, jehož výstup se při uložení **zahazuje**. To navenek budí dojem většího pokroku, než jaký reálně je.
- **Pořadí prací je dané datovými fundamenty:** dokud `projects`/`goals`/`flows`/sync-tabulky nemají potřebné sloupce, zůstanou tři moduly a polovina detailu úkolu nutně `missing` — proto je P0 odblokování schématu, ne UI.