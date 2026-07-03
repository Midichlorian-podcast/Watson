==========================================================================================
MODUL: Nastavení + shell + dark (Nastaveni, Header, Sidebar, tokens.css, Schranka, Hledat, WatsonPanel, CommandPalette, Cheatsheet) — 79%

[CRITICAL] Watson drawer nemá pozadí — třída `bg-panel` neexistuje (Tailwind v4 utility se negeneruje)
EVIDENCE: Prototyp: Watson/detail panely mají `background:var(--panel)` (např. ř. 1150, 1223). Aktuální kód: apps/web/src/components/WatsonPanel.tsx:113 používá `bg-panel`, ale v @theme (apps/web/src/index.css:8–35) je definováno jen `--color-card` a `--color-panel-2` — `--color-panel` chybí, takže Tailwind v4 utilitu `bg-panel` vůbec nevygeneruje a drawer je průhledný (obsah appky prosvítá pod textem panelu) v obou motivech.
FIX: V WatsonPanel.tsx:113 nahradit `bg-panel` za `bg-card` (panel = --w-card), nebo do @theme přidat `--color-panel: var(--w-card);`.

[CRITICAL] Dark režim: `text-navy` texty jsou v tmavém motivu téměř neviditelné (navy #17283f na panelu #171f29)
EVIDENCE: Prototyp používá pro tyto texty `color:var(--ink)` (dark #eceef1, ř. 31/1633 tahák, ř. 268 titulky). Aktuální kód: `--w-navy` není v dark bloku tokens.css (packages/ui/src/tokens.css:98–125) přebarven a mapuje se na text (index.css:9). Postižená místa: Cheatsheet.tsx:69 (titulek taháku), Ukoly.tsx:156 (hlavičky skupin), CalendarMonth.tsx:94 (titulek měsíce), ProjectDetailPanel.tsx:134+339 (název projektu, statistika), Projekty.tsx:383, Cile.tsx:722, Placeholder.tsx:12 — vše #17283f na tmavém pozadí.
FIX: Buď v dark bloku tokens.css přidat `--w-navy: #eceef1` (resp. hodnotu blízkou ink), nebo — čistěji dle prototypu — nahradit `text-navy` u textového obsahu za `text-ink` (navy nechat jen pro plochy typu toast/sidebar, kde je s bílým textem v pořádku).

[MAJOR] Pozvání člena nepřidá člena do rosteru (chybí optimistické přidání z prototypu)
EVIDENCE: Prototyp ř. 2384 `submitMember` po potvrzení ihned přidá člena do `newMembers` → objeví se v seznamu Tým a role (iniciály z jména, role='Pozván(a)'/e-mail). Aktuální kód: apps/web/src/screens/Nastaveni.tsx:517–524 — `onSent` jen zavře modal a ukáže toast „Pozvánka odeslána“; roster (řádek 287, `team?.members`) se nezmění, pozvaný člen nikde nefiguruje.
FIX: Po odeslání přidat pending člena lokálně (stav `invited[]` renderovaný v rosteru s badge „Pozván(a)“), příp. optimisticky zapsat do react-query cache `wsMembers` a po reálné pozvánkové infrastruktuře (Mail M1) nahradit.

[MAJOR] Sidebar počty: „Přiřazeno mně“ počítá i mnou vytvořené úkoly; „Úkoly“ zahrnují Schránku a podúkoly; „Dnes“ zahrnuje podúkoly a spící kroky
EVIDENCE: Prototyp ř. 3150: `mne = T.filter(t=>(t.people||[]).includes('ak')&&!t.done)` (JEN assignments), `seznam = !t.done&&!t.inbox`. Aktuální kód: apps/web/src/layout/Sidebar.tsx:145 `created_by === userId || assigned.has(t.id)`; :143 `/ukoly: tasks.length` (dotaz ř. 103 nefiltruje parent_id ani inbox projekty — badge tak počítá schránkové položky i podúkoly, které Ukoly.tsx:58 skrývá); :135–138 `/` počítá i podúkoly bez termínu a spící kroky postupů, které Today.tsx:62–65 z obrazovky vyřazuje → badge ≠ obsah obrazovky.
FIX: V counts (Sidebar.tsx:123–147): mne = jen assignments; /ukoly = open ∧ !inbox ∧ !parent_id; / a /nadchazejici = vyřadit podúkoly bez vlastního termínu (a ideálně spící kroky přes useFlowSteps). Stejnou úpravu promítnout do Oblibene.tsx:37, aby badge seděl s obrazovkou.

[MAJOR] Klik na název workspace v sidebaru nepřejde na Projekty
EVIDENCE: Prototyp ř. 3177: `onOpen:this.setActiveWs(w.id,'projekty')` — klik na název prostoru aktivuje prostor A naviguje na obrazovku Projekty (ř. 2319). Aktuální kód: apps/web/src/layout/Sidebar.tsx:346–348 volá jen `setActiveWs(ws.id)` (lib/workspace.tsx:56–60 nenaviguje) — uživatel zůstává na aktuální obrazovce.
FIX: V onClick ws tlačítka doplnit `void navigate({ to: "/projekty" })` po `setActiveWs(ws.id)`.

[MAJOR] Klik na projekt v sidebaru otevírá detail projektu místo filtrovaného seznamu Úkolů
EVIDENCE: Prototyp ř. 3177 → `onClick:this.openProj(p.id)`; ř. 2295 `openProj` = screen:'seznam' + projFilter (filtrovaný seznam úkolů projektu, aktivní zvýraznění řádku `data-projrow[data-active]`). Aktuální kód: apps/web/src/layout/Sidebar.tsx:370–373 volá `projectDetail.open(p.id)` → otevře pravý ProjectDetailPanel. Vlastní ⌘K paleta přitom správně naviguje na `/ukoly?projekt=` (CommandPalette.tsx:97). Sidebar navíc nezvýrazňuje aktivní projekt (prototyp `data-projrow[data-active=true]`, ř. 106).
FIX: onClick projektu → `navigate({ to: "/ukoly", search: { projekt: p.id } })` a řádek zvýraznit (rgba(255,255,255,.10) + sidebar-ink), když je `search.projekt === p.id`.

[MAJOR] Hledat / Lidé: neukazuje roli/job a nehledá podle ní
EVIDENCE: Prototyp ř. 3075: `people = PEOPLE.filter(p=>p.name…includes(ql)||(p.role||'')…includes(ql))`, sub = `p.role||'Člen'` (např. „Projektový manažer“ — viz screenshot 19 roster). Aktuální kód: apps/web/src/screens/Hledat.tsx:14 typ Member nemá `job`, :115–123 filtruje jen name/email a sub je vždy `t("search.member")` = „Člen“.
FIX: Do Member typu přidat `job` (API `/members` ho vrací — viz Nastaveni.tsx:20–28), filtrovat i `has(p.job)` a sub = `p.job || t("search.member")`.

[MAJOR] Schránka: select projektů není omezen na aktivní workspace
EVIDENCE: Prototyp ř. 3086–3087: `wsProjs=this.PROJECTS.filter(p=>this.inWS(p))` — nabídka triage selectu jen z projektů AKTIVNÍHO prostoru. Aktuální kód: apps/web/src/screens/Schranka.tsx:38–41 `targetProjects = projects.filter(!INBOX)` — useProjects (lib/projects.ts:8–13) vrací všechny projekty napříč prostory, takže select míchá projekty všech workspace.
FIX: Filtrovat `targetProjects` přes `useWorkspace().activeWs`: `p.workspace_id === activeWs && !INBOX_NAMES.has(p.name)`.

[MINOR] Sidebar: chybí hover stavy na nav položkách, projektech a názvu workspace
EVIDENCE: Prototyp: každý nav řádek má `style-hover="color:var(--sidebar-ink)"` (ř. 179, 183, …), projektové řádky ř. 242, název ws ř. 238, chevron ř. 236. Aktuální kód: apps/web/src/layout/Sidebar.tsx — NavRow (ř. 60–81), ws tlačítko (ř. 346–360) i projektové řádky (ř. 370–399) nemají žádnou hover třídu; hover má jen rail-toggle (ř. 189).
FIX: Přidat `hover:text-[var(--w-sidebar-ink)]` (a u NavRow ponechat aktivní barvu) na Link/buttony v sidebaru.

[MINOR] Header: hover ikon-buttonů je sjednocený, prototyp má per-button hover; v inline hledání chybí zavírací ×
EVIDENCE: Prototyp: lupa hover jen `border-color:var(--brass)` (ř. 298), zvonek a motiv hover jen `color:var(--brass-text)` bez změny borderu (ř. 300–301); inline search má ×-zavírák (ř. 294). Aktuální kód: apps/web/src/layout/Header.tsx:12–13 sdílené `ICON_BTN` s `hover:border-brass hover:text-brass-text` pro všechny tři; inline box (ř. 172–197) nemá × (zavírá jen Esc / toggle lupy).
FIX: Rozdělit hover: lupa `hover:border-brass`, zvonek+motiv `hover:text-brass-text`; do inline hledání přidat × span volající `setSearchOpen(false)`.

[MINOR] Schránka: ikona „⋯“ u položky je horizontální, prototyp má vertikální tečky
EVIDENCE: Prototyp ř. 586: tři tečky svisle (cx=8, cy=3.5/8/12.5). Aktuální kód: apps/web/src/screens/Schranka.tsx:150 používá `Icon name="vice"` = horizontální tečky (packages/ui/src/Icon.tsx:37–38, cy=12, cx=6/12/18).
FIX: Použít inline svislý SVG (jako prototyp) nebo přidat do sady variantu `vice-v` a použít ji v Schránce.

[MINOR] Tahák: řádek „Přejít na…“ ukazuje jen G + D/U/N/P — nesedí s prototypem ani s realitou
EVIDENCE: Prototyp ř. 1642: `G` `D/U/K/P/C`. Realita appky: plná mapa d/u/k/n/p/c/r/s/i/h (apps/web/src/lib/keyboard.tsx:11–25). Aktuální kód: apps/web/src/components/Cheatsheet.tsx:15 `[t("cheat.goto"), ["G", "D/U/N/P"]]` — chybí K/C (a zbytek implementované mapy). Ostatní zkratky taháku ověřeny proti realitě: ⌘Z/⌘⇧Z ✓, j/k+Space+1–4+⌫ (Ukoly.tsx:101–139) ✓, šipky v detailu (TaskDetailPanel.tsx:140–146) ✓, kalendář ←/→ D 1/2/3 (Calendar.tsx:302–311) ✓, ⌘Enter (AddTaskModal.tsx:483–485) ✓.
FIX: Změnit klávesy na `["G", "D/U/K/P/C"]` dle prototypu (příp. `D/U/K/N/P/C/R/S/I/H` dle skutečné mapy).

[MINOR] ⌘K paleta: chybí položka „Kalendář“ a projekty nejsou omezené na aktivní workspace
EVIDENCE: Prototyp ř. 2282: SCN obsahuje ['kalendar','Kalendář'] (11 obrazovek); ř. 2284: projekty filtrované `inWS` (jen aktivní prostor). Aktuální kód: apps/web/src/components/CommandPalette.tsx:70–82 má 10 obrazovek bez Kalendáře; :90 mapuje všechny `projects` bez ws filtru. Brass zvýraznění aktivního řádku ✓ (ř. 200), druhy Přejít/Projekt/Člověk/Postup ✓.
FIX: Přidat screen item „Kalendář“ → `navigate('/ukoly')` + `setView('calendar')` (jako g+k); projekty filtrovat na `workspace_id === activeWs`.

[MINOR] Nastavení „Tým a role“: tečka prostoru je vždy brass místo barvy workspace
EVIDENCE: Prototyp ř. 914: `data-wsdot={{ activeWs }}` s barvou dle prostoru (ř. 105: personal #9a8f80, kancelar #c68a3e, klub #2a6fdb). Aktuální kód: apps/web/src/screens/Nastaveni.tsx:270–278 hardcoduje `background: "var(--w-brass)"`; typ Workspace v Nastaveni.tsx:19 ani nemá `color`, přestože useWorkspaces (lib/workspace.tsx:5–10) ho vrací.
FIX: Číst `color` z aktivního workspace (`activeWorkspace.color`) a použít ho jako background tečky (fallback brass).

[MINOR] Invite modal se liší od prototypu (labely polí, poznámka, šířka, texty)
EVIDENCE: Prototyp ř. 1273–1288: titulek „Přidat člena týmu“ (ř. 1276), uppercase labely „Jméno“/„E-mail“ nad inputy (ř. 1277/1279), footer s border-top a poznámkou „Pošleme pozvánku na zadaný e-mail.“ (ř. 1281–1282), šířka 440 px, padding-top 14vh, tlačítko „Pozvat“. Aktuální kód: apps/web/src/screens/Nastaveni.tsx:595–641 — 400 px, 16vh, žádné labely (jen placeholdery), žádná poznámka ani border-top, titulek „Pozvat člena“, tlačítko „Odeslat pozvánku“.
FIX: Doplnit uppercase labely polí, footer řádek s poznámkou + border-top, šířku 440 px / 14vh a sladit texty s prototypem.

[MINOR] Chybí přepínač pohledů na obrazovce Oblíbené
EVIDENCE: Prototyp ř. 3241 + 3022: `showViewSwitcher = isWorkspace && screen!=='dnes' && screen!=='schranka'`, kde isWorkspace zahrnuje 'oblibene' → Seznam/Nástěnka/Kalendář se ukazuje i na Oblíbené (a viewLock VS ř. 2257 zahrnuje 'oblibene'). Aktuální kód: apps/web/src/layout/Header.tsx:65 `showViewSwitcher = /ukoly || /nadchazejici` — na /oblibene/* se přepínač nezobrazí (Oblibene.tsx renderuje jen seznam).
FIX: Zahrnout `/oblibene` do showViewSwitcher a nechat Oblíbené respektovat useViewMode (board/kalendář nad stejným filtrem).

[MINOR] Ikony sidebaru/headeru mají stroke 2 místo 1.9 z prototypu
EVIDENCE: Prototyp: všechny nav/header ikony `stroke-width="1.9"` (ř. 180, 184, 189, … 298, 300). Aktuální kód: packages/ui/src/Icon.tsx:87 `strokeWidth={2}` pro celou sadu (README připouští rozsah 1.9–2, ale pixel reference sidebaru je 1.9 — ikony jsou o chlup těžší). Header inline SVG (Header.tsx:211, 235) správně 1.9.
FIX: Změnit default `strokeWidth` v Icon.tsx na 1.9 (u `reporty` zůstávají lokální 2.4 přepisy).

[MINOR] Hustota nabízí i „Kompaktní“, kterou README doporučuje vynechat
EVIDENCE: README ř. 111: „Vzdušné … a Vyvážené … — produkčně doporučeny obě; kompaktní raději vynechat.“ Aktuální kód: apps/web/src/screens/Nastaveni.tsx:180–184 nabízí tři volby včetně `kompaktni` (index.css:55 ji definuje). Pozn.: konzumace density ověřena — TaskCard.tsx:104/159 čte --w-row-py/--w-row-font ✓; --w-card-pad není konzumován ani v prototypu (板 karta má fixní 11px 12px, ř. 465) → bez mezery.
FIX: Odebrat volbu „Kompaktní“ ze Segments (ponechat definici v CSS neškodí), nebo vědomě potvrdit jako rozšíření.
==========================================================================================
MODUL: Klávesnice + průřezová logika (lib/keyboard.tsx, undo.ts, listSearch.tsx, viewMode.tsx, occurrences.ts, tasks.ts, toast.tsx, Cheatsheet.tsx) — 72%

[MAJOR] Undo/redo pokrývá jen 2 mutace — prototyp verzuje KAŽDOU změnu tasks
EVIDENCE: Prototyp ř. 2239: componentDidUpdate pushuje do 40-hluboké historie při každé změně this.state.tasks (toggle done, přesuny v kalendáři, board drop, editace, přidání). Aktuální kód: pushColumnUndo/pushUndo volají jen apps/web/src/screens/Ukoly.tsx:116 (priorita 1–4) a deleteTaskWithUndo (Ukoly.tsx:123, TaskDetailPanel.tsx:314). BEZ undo zůstávají: toggleTask/Space+checkbox (lib/tasks.ts:96), drag v kalendáři (components/Calendar.tsx:338), resize trvání (Calendar.tsx:921), drop „na dnes" (Calendar.tsx:1455), board drop status/pořadí (components/Board.tsx:63,79), editace polí detailu (components/TaskDetailPanel.tsx:48), triáž Schránky (screens/Schranka.tsx:54–63), „posunout na dnes" (screens/To
FIX: Obalit zbývající mutace: completed_at přes pushColumnUndo v toggleTask (pozor na větev posunu řady — undo musí vrátit due_date+start_date+recurrence_rule, tj. vlastní pushUndo), due_date/start_date/duration_min u kalendářních dragů, status_id+completed_at u boardu, generický UPDATE detailu (snapshot prev hodnot), INSERT úkolu (undo = DELETE, redo = re-INSERT).

[MAJOR] Zobrazení výskytů ignoruje konec opakování (until/count) i „zobrazit jen další" (showAll)
EVIDENCE: Prototyp ř. 2640 _recOccur: `if(idx>=maxCount) break; if(untilIso&&iso>untilIso) break;` + `if(t.repeatShowAll===false){ …return up.slice(0,1); }`. Aktuální kód: lib/occurrences.ts:48–68 expandOccurrences nemá until/count/showAll vůbec v API a volající je nepředávají (screens/Nadchazejici.tsx:109, components/Calendar.tsx:275), přestože AddTaskModal.tsx:671–674 endKind/until/count/showAll do recurrence_rule ukládá. Úkol „týdně, 3×" nebo „do 31. 7." se v Nadcházejících i kalendáři promítá donekonečna; toggleTask (tasks.ts:74–86) konec respektuje jen při odškrtnutí base.
FIX: Rozšířit ExpandOpts o until?/count?/showAll? (a recurrenceKind nahradit parserem vracejícím celý rule), v expandOccurrences ukončit smyčku na `iso>until` a `idx>=count`, při showAll===false vrátit jen první budoucí výskyt; předat z obou volajících.

[MAJOR] Seznamová klávesová navigace (j/k/Enter/Space/1–4/⌫) funguje jen na Úkolech — chybí na Dnes, Nadcházejících, Schránce a Hledat
EVIDENCE: Prototyp _kbList (ř. 2262–2276) běží pro každý screen s view==='list' (dnes/nadchazejici/seznam/schranka/hledat — _navIds plní aktivní seznam, ř. 3018). Aktuální kód: kbSel handler existuje pouze v screens/Ukoly.tsx:79–131; screens/Today.tsx a Nadchazejici.tsx žádný keydown handler nemají (setNavIds plní jen ↑/↓ v detailu, Today.tsx:89, Nadchazejici.tsx:148). Na výchozí obrazovce Dnes jsou j/k, Space, Enter, 1–4 i ⌫ mrtvé — tahák (sekce „Seznam úkolů") přitom tvrdí opak.
FIX: Vytáhnout handler z Ukoly.tsx do sdíleného hooku (useListKeyboard(navIds, shown)) a použít v Today/Nadchazejici/Schranka/Hledat; u virtuálních výskytů (id@ISO) mapovat Space na toggleTask s parseOccId a ⌫ zakázat/mapovat na skip výskytu.

[MINOR] Klávesy prosakují pod otevřené vrstvy — chybí guardy addOpen/cheatOpen (prototyp je má)
EVIDENCE: Prototyp _kbList ř. 2263 guarduje addOpen||cheatOpen||paletteOpen…; kalendářní větev ř. 2228 guarduje !addOpen. Aktuální kód: Ukoly.tsx:85 guard jen `typing || mod || openId` a Calendar.tsx:301 jen `typing || mod || openId`. S otevřeným tahákem („?", fokus zůstává na body) a aktivním kbSel Space odškrtne a ⌫ smaže úkol pod overlay; s fokusem na tlačítku v AddTaskModalu šipky/1–3 přepínají kalendář pod modalem. Stejně TaskDetailPanel.tsx:140–150 naviguje j/k detail i pod otevřeným tahákem.
FIX: Sdílený check `document.querySelector('[data-esc-layer]')` (vrstvy ho už nesou) na začátku handlerů v Ukoly.tsx, Calendar.tsx a TaskDetailPanel.tsx — při existenci vyšší vrstvy return.

[MINOR] Esc kaskáda: AddTaskModal se zavře společně s vrstvou nad ním; kbSel se nečistí jako poslední
EVIDENCE: Prototyp ř. 2213: Esc zavírá právě JEDNU vrstvu v pořadí cheat→palette→add→flow→detail→projekt→člen→kbSel. Aktuální kód: AddTaskModal.tsx:342 `if (e.key === 'Escape') onClose()` bez kontroly vyšších vrstev — s tahákem otevřeným nad modalem jeden Esc zavře oboje (keyboard.tsx:45–48 zavře cheat, modal se zavře taky). Ukoly.tsx:127 čistí kbSel na Esc souběžně s jinými vrstvami (TaskDetailPanel.tsx:130 to naopak řeší správně přes [data-esc-layer]).
FIX: V AddTaskModal Esc handleru: `if (document.querySelector('[data-esc-layer]:not([data-add-layer]))') return;` resp. kontrola, zda nad modalem je cheat/palette; v Ukoly čistit kbSel jen když neexistuje žádná [data-esc-layer] a není openId.

[MINOR] Dnes nepromítá výskyty opakování (prototyp pro dnes používá listTasks)
EVIDENCE: Prototyp ř. 3018: `const T = (s.screen==='dnes'||s.screen==='nadchazejici') ? this.listTasks() : s.tasks;` — dnešní výskyt řady s prošlým base se na Dnes zobrazí (vedle overdue base). Aktuální kód: screens/Today.tsx expandOccurrences vůbec neimportuje (importy ř. 1–22; expanze jen Nadchazejici.tsx:109 a Calendar.tsx:275) — týdenní úkol s base minulý týden ukáže na Dnes jen overdue řádek, dnešní výskyt chybí.
FIX: V Today.tsx expandovat výskyty s oknem [dnes, dnes] (stejný vzor jako Nadchazejici.tsx:107–125 vč. ovrMap skipped/done) a přidat je do sekce Dnes.

[MINOR] g+u / g+k při zamčeném pohledu přepíší zamčený výchozí pohled
EVIDENCE: Prototyp goTo (ř. ~2257): při viewLock aplikuje lockedView pro seznam/nadchazejici/hledat (dv=lv.view) a lockedView mění jen toggleViewLock (ř. ~2258). Aktuální kód: keyboard.tsx:77–78 g+k → setView('calendar'), g+u → setView('list') a viewMode.tsx:35–38 při locked každý setView přepersistuje watson.lockedView — g+u tak uživateli tiše přepíše zamčenou Nástěnku na Seznam; navíc g+u lock ignoruje (prototyp by otevřel zamčený pohled).
FIX: V keyboard.tsx u g+u/g+k nepřepínat view, když je locked (nechat readLock hodnotu); v viewMode.setView nepersistovat při locked (persist jen v toggleLock), aby lock zůstal snapshotem.

[MINOR] Tahák: řada „Přejít na…" ukazuje jiné klávesy než prototyp
EVIDENCE: Prototyp ř. ~1642: `G` + `D/U/K/P/C`. Aktuální kód: components/Cheatsheet.tsx:15 `[t("cheat.goto"), ["G", "D/U/N/P"]]` — chybí K a C, navíc realita (keyboard.tsx:11–25) podporuje D/U/K/N/P/C/R/S/I/H.
FIX: Sjednotit s prototypem na `D/U/K/P/C` (případně `D/U/K/N/P…` dle plné mapy, ale minimálně vrátit K a C).

[MINOR] Inline hledání „/": nefiltruje Schránku a při už otevřeném poli nefokusuje
EVIDENCE: Prototyp: state.search filtruje všechny list obrazovky (ř. 2600/2731/2797 + list builder ř. 3018) a focusSearch (ř. 2261) input vždy fokusuje+selectne. Aktuální kód: filterByQuery je zapojen jen v Today.tsx:72, Ukoly.tsx:52, Nadchazejici.tsx:90 — screens/Schranka.tsx useListSearch nepoužívá, `/` tam otevře input v headeru (Header.tsx:172–196), který nic nefiltruje; opětovné `/` při otevřeném ale rozostřeném poli nefokusuje (autoFocus jen při mountu, Header.tsx:183).
FIX: Zapojit filterByQuery(…, q) do Schranka.tsx; v Headeru při open→open přechodu (nebo přes ref z setOpen) zavolat input.focus()+select().
==========================================================================================
MODUL: critic — 76%

[MAJOR] Barva úkolu je globální sloupec — spec vyžaduje per-uživatelskou barvu (týž úkol může každý vidět jinak)
EVIDENCE: Prototyp: README.md ř. 108 „úkol je defaultně bílý; barvu vidí jen ten, kdo ji nastavil — per‑uživatel" + files/RECONCILIACE_design_vs_kod.md ř. 22–23 „tělo karty = … per-uživatelská barva úkolu (týž úkol může každý vidět jinak barevný)". Kód: packages/db/src/schema/task.ts:42 — `color` je sdílený sloupec na tasks; apps/web/src/components/TaskDetailPanel.tsx:692–705 — výběr barvy dělá `patch(realId, { color: c })`, tj. globální UPDATE viditelný všem členům projektu; apps/web/src/lib/powersync/AppSchema.ts:8–204 — žádná per-user overlay tabulka neexistuje (jen tasks/assignments/checklist_items/…). Není ve vědomých odkladech.
FIX: Zavést tabulku task_user_colors (task_id, user_id, color) + sync bucket per-user; TaskCard/TaskDetailPanel číst vlastní barvu uživatele (JOIN/mapa), sdílený tasks.color přestat zapisovat. Alternativně minimálně zdokumentovat jako vědomý odklad.

[MAJOR] EN režim je děravý — kalendář, hledání, reporty a brány postupů zůstávají natvrdo česky
EVIDENCE: Jazyk CS/EN v Nastavení je oficiální funkce (rozhodnutí uživatele #3; Nastaveni.tsx:200–213). Kód s natvrdo CZ řetězci mimo i18n: apps/web/src/components/Calendar.tsx:77–79 (MNG/WD/WD2 — použité v range labelu ř. 219, 239 a hlavičkách dní ř. 671, 1019) a ř. 770 „Celý den"; apps/web/src/screens/Hledat.tsx:28 česká pluralizace „výsledek/výsledky/výsledků"; apps/web/src/screens/Reporty.tsx:34 WD_LABELS ["Po","Út"…]; apps/web/src/screens/Postupy.tsx:829–833 GATE_SHORT „Auto →/Souběh ⇉/Ruční ✋" v builderu; packages/ui/src/TaskCard.tsx:128, 209 a CalendarMonth.tsx:205 aria/fallback labely. Kontrast: zbytek appky správně používá Intl s i18n.language (Today.tsx:156–161, Nadchazejici.tsx:32, tasks.ts
FIX: Měsíce/dny generovat přes Intl.DateTimeFormat(i18n.language) (jako Today/Nadcházející), „Celý den", GATE_SHORT, WD_LABELS a aria-labely přesunout do locales, počet výsledků v Hledat řešit i18next pluralizací (count).

[MINOR] Mobil (<880 px): Watson pruh na Dnes a kalendářní gear/Plánování se neschovávají, ač je prototyp na mobilu skrývá
EVIDENCE: Prototyp: WatsonApp.dc.html ř. 3243 `showWatsonStrip: screen==='dnes' && !isMobile`; ř. 3116 `showPlanning = !isMobile && s.calMode!=='month' && s.planOpen`; ř. 3227 `planToggleable:(!isMobile…)`, `showGearBtn:(!isMobile…)`. Kód: apps/web/src/screens/Today.tsx:177–213 renderuje Watson strip bezpodmínečně; apps/web/src/components/Calendar.tsx nemá jediný výskyt isMobile (planningOn ř. 180, gear tlačítko+menu ř. 448–521) — na mobilu panel Plánování ukrajuje šířku už tak úzké mřížky. Jediné adaptivní chování je v AppLayout.tsx (sidebar/MobileTabBar).
FIX: Použít useIsMobile() (lib/useIsMobile.ts) v Today.tsx (skrýt strip) a Calendar.tsx (skrýt gear tlačítko, menu a Plánování panel + planToggleable).

[MINOR] Offline-first PWA ztrácí typografii — Montserrat/Inter jen z Google CDN bez offline cache
EVIDENCE: Prototyp/README: sekce Typografie — „držte tyto tři role a váhy" (README.md ř. 113–114); projekt je offline-first PWA (vite.config.ts:23–50 VitePWA, workbox jen globPatterns lokálních assetů, žádný runtimeCaching). Kód: apps/web/index.html:8–13 načítá fonty výhradně z fonts.googleapis.com/gstatic; packages/ui/src/tokens.css:58–59 padá na system-ui. Po instalaci PWA a startu bez sítě se celá aplikace vykreslí systémovými fonty — display/body role se rozpadnou.
FIX: Self-hostovat woff2 (public/fonts + @font-face v index.css) nebo přidat workbox runtimeCaching CacheFirst pro fonts.googleapis.com/fonts.gstatic.com do vite.config.ts.

[MINOR] Klientské INSERTy úkolů nikdy nenastavují created_by — počty „Přiřazeno mně" se chovají jinak pro nové úkoly než pro seed
EVIDENCE: Kód: žádný z insertů nezapisuje created_by — apps/web/src/components/QuickAdd.tsx:103, AddTaskModal.tsx:680, TaskDetailPanel.tsx:280 (podúkol) a :300–303 (duplikát), Postupy.tsx:859 (kroky postupu). Přitom Sidebar.tsx:100–103 a Oblibene.tsx:37 na created_by staví (`mineSet.has(tk.id) || tk.created_by === meId`). Důsledek: úkoly vytvořené v appce mají created_by NULL → fallback „mnou vytvořené" platí jen pro seed data (nekonzistentní počty) a ztrácí se autor pro budoucí mail/admin vrstvu. Prototyp (ř. 3150 `mne:T.filter(t=>(t.people||[]).includes('ak'))`) počítá jen přiřazené — fallback je sám o sobě odchylka (už reportováno), ale created_by=NULL je samostatná datová díra.
FIX: Do všech INSERT INTO tasks doplnit created_by = session.user.id (useSession) — QuickAdd, AddTaskModal, podúkol i duplikát v TaskDetailPanel, kroky v Postupy builderu.