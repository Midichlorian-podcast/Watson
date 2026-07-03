# AUDIT v3 — ověřovací re-audit (2026-07-03)

Po uzavření mezer z AUDIT_GAPS_v2. Respektuje rozhodnutí uživatele (modal detail,
podúkoly=reálné úkoly, jazyk v Nastavení). 8/10 modulů (settings-shell + keyboard-logic doběhnou zvlášť).

| Modul | % | critical | major | minor |
|---|---|---|---|---|
| Parita podúkolů (+ zbývající odchylky po ověření aktuálního  | 70 % | 1 | 6 | 2 |
| Přidat úkol (AddTaskModal.tsx, QuickAdd.tsx, lib/quickadd/) | 87 % | 0 | 2 | 6 |
| Anatomie řádku úkolu (packages/ui/src/TaskCard.tsx + TaskIte | 85 % | 0 | 2 | 6 |
| Dnes + Úkoly + Nadcházející (Today.tsx, Ukoly.tsx, Nadchazej | 68 % | 0 | 8 | 9 |
| Kalendář (Calendar.tsx + CalendarMonth.tsx) | 78 % | 1 | 4 | 11 |
| Detail úkolu (apps/web/src/components/TaskDetailPanel.tsx +  | 82 % | 0 | 4 | 7 |
| Postupy | 87 % | 0 | 1 | 6 |
| Projekty + Cíle + Reporty | 72 % | 1 | 6 | 8 |


## Parita podúkolů (+ zbývající odchylky po ověření aktuálního kódu) — 70 %

### [CRITICAL] Smazání úkolu osiří vnuky (hloubka 3) a podřízená data dětí
- **Evidence:** R1 povoluje hloubku 3 (addSub s depth<3, apps/web/src/components/TaskDetailPanel.tsx:277-284), ale deleteTaskWithUndo maže jen `WHERE id = ? OR parent_id = ?` (apps/web/src/lib/undo.ts:82 a :96) — vnuci zůstanou v DB s visícím parent_id a dál se vykreslují v Dnes/Úkoly (SELECT * bez filtru, Today.tsx:42, Ukoly.tsx:41). Snapshot/DELETE assignments/comments/checklist/chain_steps běží jen pro task_id rodiče (undo.ts:87-95) — přiřazení a komentáře smazaných DĚTÍ se nemažou ani neobnovují; reminders a task_occurrence_overrides se nečistí vůbec.
- **Fix:** V deleteTaskWithUndo posbírat potomky rekurzivním CTE (WITH RECURSIVE des AS (SELECT id FROM tasks WHERE id=? UNION ALL SELECT t.id FROM tasks t JOIN des ON t.parent_id=des.id)), snapshotovat a mazat tasks + assignments/comments/checklist_items/chain_steps/reminders/task_occurrence_overrides pro VŠECHNA tato id; undo = re-insert všeho.

### [MAJOR] Podúkoly se v seznamech zdvojují s rodičem — chybí pravidlo zobrazení
- **Evidence:** Prototyp podúkoly zobrazuje JEN uvnitř detailu (WatsonApp.dc.html ř. 1028-1036) a na řádku rodiče jen ⚏ subDone/subTotal (ř. 2157, 2926). Implementace je renderuje jako plnohodnotné řádky vedle rodiče: apps/web/src/screens/Today.tsx:70-79 (podúkol BEZ termínu spadne do skupiny Dnes přes `d === null || d === tdy`), Ukoly.tsx:41-65 (flat v projektových skupinách vedle rodiče s ⚏ — obsah 2x), Board.tsx:34-50 (karta za každý podúkol). Nový podúkol založený z detailu se tak okamžitě objeví v Dnes jako samostatný úkol.
- **Fix:** Doporučené pravidlo: (a) Úkoly + Nástěnka — řádky s parent_id skrýt (reprezentuje je ⚏ rodiče a vrstvený detail), případně odsazeně vnořit pod rodiče; (b) datumové pohledy Dnes/Nadcházející/Kalendář — podúkol zobrazit JEN má-li vlastní due_date (nikdy v beztermínové skupině Dnes), s prefixem rodiče (Rodič › Podúkol), aby řádek dával kontext a nezdvojoval obsah.

### [MAJOR] Tři různá počítadla téže obrazovky: header vs. sidebar vs. seznam
- **Evidence:** Header subtitle počítá jen top-level (`parent_id IS NULL`, apps/web/src/layout/Header.tsx:34), sidebar badge počítá VŠECHNY vč. podúkolů (Sidebar.tsx:103 + 135-145, filtr parent_id má jen /schranka na ř. 133), a vlastní seznamy Dnes/Úkoly renderují i podúkoly (Today.tsx:42, Ukoly.tsx:41). S 1 rodičem + 3 podúkoly ukáže header 1, sidebar 4 a seznam 4 řádky. Prototyp měl jediný zdroj (tasks[], ř. 3090-3092).
- **Fix:** Zavést sdílenou utilitu viditelnosti (dle pravidla z předchozí mezery) a Header i Sidebar počítat ze STEJNÉ množiny, jakou obrazovka renderuje.

### [MAJOR] Duplikace nekopíruje podúkoly ani přiřazené osoby
- **Evidence:** Prototyp duplicateTask (WatsonApp.dc.html ř. 2557) kopíruje celý objekt vč. subtasks[] a people[]. Implementace kopíruje jediný řádek tasks (apps/web/src/components/TaskDetailPanel.tsx:294-307) — duplikát rodiče ztratí všechny podúkoly (⚏ 2/5 → nic) i assignments; kopie podúkolu správně zůstane sourozencem (parent_id se přenáší), ale jeho vlastní děti se také ztratí.
- **Fix:** Duplikovat rekurzivně: posbírat potomky CTE, INSERT s novými id + přemapovaným parent_id, a zkopírovat assignments (task_id → nové id) pro každý duplikovaný řádek.

### [MAJOR] Podúkol nelze vybavit časem/trváním/opakováním — hlavní úkol ano
- **Evidence:** Hlavní úkol získá start_date/duration_min/recurrence při založení parserem (QuickAdd.tsx:101, AddTaskModal.tsx:679). Podúkol vzniká holým INSERT (name, priority 4 — TaskDetailPanel.tsx:277-284) a rozbalená editace v detailu nabízí jen P1-4/termín/deadline/barvu (TaskDetailPanel.tsx:583-660) — čas, trvání ani opakování doplnit nejde (platí i pro hlavní úkoly po založení). Podúkol se proto v kalendáři Den/Týden nikdy neobjeví jako časový blok a v Dnes nemá rozsah 09:00–10:30 (rowDue, tasks.ts:159-163).
- **Fix:** Do editace v detailu (editOpen) přidat pole čas + trvání (min) a volitelně editor opakování; nebo input addSub protáhnout stejným quick-add parserem jako QuickAdd, aby 'zítra 9:00 60 min' fungovalo i u podúkolu.

### [MAJOR] „Kopírovat odkaz" generuje mrtvou URL (pro úkoly i podúkoly)
- **Evidence:** copyLink dává do schránky `/ukoly?ukol=<id>` (TaskDetailPanel.tsx:308-312), ale router pro /ukoly validuje jen `projekt` (router.tsx:22-24) a Ukoly.tsx čte pouze search.projekt (Ukoly.tsx:32-33) — parametr `ukol` se zahodí a detail se po otevření odkazu neotevře. Prototyp ř. 984 „Kopírovat odkaz" předpokládá funkční deep-link.
- **Fix:** Přidat `ukol` do validateSearch ukolyRoute a v Ukoly.tsx useEffect: pokud search.ukol, zavolat taskDetail.open(ukol) (funguje i pro podúkoly a virtuální výskyty id@ISO) a parametr z URL vyčistit.

### [MAJOR] Checkbox výskytu opakování v kalendáři je no-op
- **Evidence:** README ř. 58-59 + 65: každý výskyt je „samostatně dokončitelný/přeskočitelný" a „odškrtávání přímo v kalendáři ve všech pohledech". CalCheck ale virtuální výskyty blokuje: `if (!isVirtual(tk)) void toggleTask(tk);` (Calendar.tsx:116) — klik na kroužek výskytu neudělá nic, přestože toggleTask virtuální id umí (parseOccId → setOccurrenceOverride, tasks.ts:56-61).
- **Fix:** Guard odstranit a volat toggleTask(tk) i pro virtuální řádky — per-výskyt done se zapíše do task_occurrence_overrides a promítne do seznamu i kalendáře.

### [MINOR] Zaškrtnutí podúkolu v detailu rodiče obchází toggleTask
- **Evidence:** Řádek podúkolu v detailu přepíná completed_at přímým patch (TaskDetailPanel.tsx:751-759), zatímco TENTÝŽ podúkol v seznamu jde přes toggleTask (TaskItem.tsx:77; Ukoly Space ř. 110) vč. advance postupu, posunu opakované řady a occurrence logiky (tasks.ts:54-101). Chování jednoho úkolu se liší podle místa kliknutí.
- **Fix:** V řádku podúkolu volat toggleTask(s) místo patch — jednotná sémantika R9/advance napříč UI.

### [MINOR] Opakování na podúkolu neposouvá řadu (guard !parent_id)
- **Evidence:** toggleTask posouvá opakovanou řadu jen pro top-level: `if (nowDone && kind && due && !task.parent_id)` (tasks.ts:65) — podúkol s recurrence_rule se při dokončení natrvalo odškrtne místo posunu na další výskyt. UI dnes recurrence na podúkolu nevytvoří (addSub bez parseru), ale duplikace/sync ji přenést může. Chain krok jako podúkol posouzen: builder zakládá kroky top-level (Postupy.tsx:859), advance je na parent_id nezávislý (chainAdvance.ts:125) — tam žádná akce netřeba.
- **Fix:** Guard `!task.parent_id` odstranit (opakování má fungovat shodně), nebo rozhodnutí explicitně zdokumentovat a recurrence_rule při vzniku podúkolu čistit.


## Přidat úkol (AddTaskModal.tsx, QuickAdd.tsx, lib/quickadd/) — 87 %

### [MAJOR] Modal dovolí uložit úkol s prázdným vyčištěným názvem — fallback na rawName s tokeny
- **Evidence:** Prototyp ř. 2985: cantSubmit = (d.name||'').trim().length===0 || deadlineBad; submitTask ř. 2449: const raw=(d.name||'').trim(); if(!raw) return; (d.name = cleanName po vytažení tokenů). README ř. 48: „Úkol nelze vytvořit, pokud po vytažení formulí zůstane prázdný název." — Aktuální kód apps/web/src/components/AddTaskModal.tsx:640: cantSubmit = draft.name.trim().length === 0 && draft.rawName.trim().length === 0; a :654: const name = draft.name.trim() || draft.rawName.trim(). Napíšu-li jen „zítra p1", zobrazí se varování needsName, ale tlačítko Přidat úkol zůstane aktivní a vytvoří úkol pojmenovaný „zítra p1".
- **Fix:** V AddTaskModal.tsx:640 změnit na cantSubmit = draft.name.trim().length === 0 a v submit() (ř. 654) použít jen draft.name.trim() bez fallbacku na rawName — varování needsName pak koresponduje s disabled tlačítkem jako v prototypu.

### [MAJOR] QuickAdd (Dnes): výběr v našeptávači vkládá label místo odstranění tokenu + aplikace — víceslovná jména nechávají v názvu zbytky, osoba se nepřiřadí, dny se neuloží
- **Evidence:** Prototyp ř. 2401–2402 (pickSuggest/pickProject): token se z textu vyřízne a osoba/projekt se nastaví do draftu; README ř. 47: „po výběru se token z názvu odstraní a osoba přiřadí". — Aktuální kód apps/web/src/components/QuickAdd.tsx:81–87 (applySug) naopak vloží celý label do textu: setRaw(base + '@' + item.label + ' '). Regex parseru [@+](\p{L}+) (lib/quickadd/parse.ts:193) pak z „@Jana Dvořáková" odstraní jen „@Jana" → v názvu úkolu zůstane „Dvořáková"; u „#Q3 plánování" matchne jen „#Q" (číslice není \p{L}) → v názvu zůstane „3 plánování" a projectId se nenastaví. Submit (QuickAdd.tsx:100–115) navíc nevytváří žádné assignments řádky pro osoby a INSERT nemá sloupec days (parsed.days se zahodí, ačkoli pilulka „N dní" se zobrazí).
- **Fix:** V applySug replikovat prototyp: odříznout token z raw (lastIndexOf), reparse a uložit výběr do lokálního stavu (selectedProjectId / assignees); při submitu vložit assignments řádky a přidat days do INSERT. Případně QuickAdd nahradit otevřením AddTaskModal, který už flow dělá správně.

### [MINOR] Esc při otevřeném našeptávači mutuje text (přidá mezeru) místo pouhého zavření nabídky
- **Evidence:** Prototyp ř. 2400: else if(e.key==='Escape'){ e.preventDefault(); this.patchDraft({ suggest:null }); } — text zůstává beze změny. — Aktuální kód apps/web/src/components/AddTaskModal.tsx:476–481: patch({ rawName: draft.rawName + ' ' }) (viditelná mezera navíc; po smazání znaku se nabídka zase objeví). Stejný hack v QuickAdd.tsx:138–140: setRaw(raw + ' ').
- **Fix:** Zavést stavový příznak suggestDismissed (reset při další změně rawName) a v Esc větvi jen zavřít nabídku bez zásahu do textu; suggest useMemo podmínit !suggestDismissed.

### [MINOR] Prostý Enter (bez našeptávače) odesílá úkol — prototyp vyhrazuje uložení pro ⌘Enter
- **Evidence:** Prototyp ř. 2396: onNameKey při prázdném suggest hned returnuje (Enter = default chování textarey, žádný submit); tahák ř. 1666: „Uložit úkol ⌘ Enter". — Aktuální kód apps/web/src/components/AddTaskModal.tsx:483–487: if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey || !suggest) void submit(); } — plain Enter bez nabídky rovnou submituje.
- **Fix:** Ponechat submit jen pro e.metaKey/e.ctrlKey (⌘/Ctrl+Enter dle taháku); pokud má plain-Enter-submit zůstat jako vědomé UX vylepšení, doplnit do rozhodnutí uživatele — dle prototypu to odchylka je.

### [MINOR] Výběr projektu v popoveru zavře celý panel a nevyčistí projQuery
- **Evidence:** Prototyp ř. 2410: setDraftProject = { project:id, projOpen:false, projQuery:'' } — sdílený pop (draft.pop='projekt') zůstává otevřený (řádek 1737 volá jen p.onClick), vyhledávací dotaz se vyčistí. — Aktuální kód apps/web/src/components/AddTaskModal.tsx:964: onClick={() => patch({ project: p.id, pop: "" })} — panel se zavře a draft.projQuery zůstane vyplněný (při dalším otevření je seznam stále vyfiltrovaný starým dotazem).
- **Fix:** Změnit na patch({ project: p.id, projQuery: "" }) a panel nechat otevřený (nebo aspoň při zavření vždy resetovat projQuery).

### [MINOR] needsName ignoruje dateKind 'none' — u „Bez termínu" s prázdným názvem se varování nezobrazí
- **Evidence:** Prototyp ř. 2983: needsName = prázdný název && (repeat!=='none' || (d.dateKind && d.dateKind!=='dnes' && d.dateKind!=='inbox') || time || duration>0 || assignees.length>0) — 'none' (Bez termínu) varování spouští. — Aktuální kód apps/web/src/components/AddTaskModal.tsx:636: (draft.dateKind !== "dnes" && draft.dateKind !== "none") — volba „Bez termínu" je z podmínky vyloučena.
- **Fix:** V podmínce needsName vyloučit jen výchozí 'dnes': draft.dateKind !== "dnes" (DateKind 'inbox' v implementaci neexistuje).

### [MINOR] Tučné tokeny v nápovědě footeru nemají barvu ink-2
- **Evidence:** Prototyp ř. 1883: <b style="color:var(--ink-2);">#projekt</b> … — tokeny jsou tmavší než okolní ink-3 text. — Aktuální kód: packages/i18n/src/locales/cs.json klíč addmodal.hint obsahuje holé <b> a AddTaskModal.tsx:1552–1557 rendruje span s color ink-3 přes dangerouslySetInnerHTML → <b> zdědí ink-3 (jen tučnost, bez kontrastu). Pro srovnání colorHintB v barva-popoveru (AddTaskModal.tsx:1416) barvu správně nastavuje.
- **Fix:** Doplnit pravidlo (např. scoped třídou na footer span) b { color: var(--w-ink-2) } nebo vložit style do <b> přímo v locale stringu.

### [MINOR] assignMode se neresetuje na 'any' při poklesu přiřazených pod 2
- **Evidence:** Prototyp ř. 2414 (toggleAssignee): assignMode = assignees.length>=2 ? d.assignMode : 'any' — po odebrání druhé osoby se režim vrací na „Stačí kdokoli". — Aktuální kód apps/web/src/components/AddTaskModal.tsx:1147–1151 jen přepne pole assignees; po sekvenci 2 lidé → „Každý zvlášť" → odebrat → přidat jiného zůstane UI na „Každý zvlášť" (do DB se při <2 správně uloží 'single', jde o stav UI).
- **Fix:** Při toggle přiřazení doplnit: patch({ assignees, assignMode: assignees.length >= 2 ? draft.assignMode : "any" }).


## Anatomie řádku úkolu (packages/ui/src/TaskCard.tsx + TaskItem/rowMeta/rowDue) — 85 %

### [MAJOR] Workspace tečka (wsdot) v podřádku se nikde nerenderuje
- **Evidence:** Prototyp ř. 422: `<span data-wsdot="{{ t.wsId }}" style="width:6px; height:6px; border-radius:2px"></span>` před názvem projektu v KAŽDÉM řádku (barvy CSS ř. 105: personal #9a8f80, kancelar #c68a3e, klub #2a6fdb); decorate ř. 2906 `wsId:this.wsOf(p)`. TaskCard prop wsColor existuje (packages/ui/src/TaskCard.tsx:167–172) a TaskItem ji propouští (apps/web/src/components/TaskItem.tsx:49), ale ŽÁDNÁ obrazovka ji nepředává — Today.tsx:129–135, Ukoly.tsx:170+191, Nadchazejici.tsx:196–201, Oblibene.tsx:69–74 volají TaskItem bez wsColor → čtvereček chybí ve všech seznamech.
- **Fix:** V obrazovkách sestavit mapu project_id → workspace.color (workspaces mají color v apps/web/src/lib/workspace.tsx:9, projekty mají workspace_id) a předávat `wsColor` do TaskItem; ideálně to udělat jednou v RowMetaProvider/useProjects, ať se to neduplikuje ve 4 screenech.

### [MAJOR] R9: zaškrtnutí nesváže stav — done řádek nese zastaralou pilulku „Probíhá"
- **Evidence:** Prototyp toggleDone ř. 2482: `status: !t.done?'hotovo':(t.status==='hotovo'?'probiha':t.status)` — dokončení nastaví status Hotovo (zelená pilulka), odškrtnutí vrátí na Probíhá; u opakovaného posunu též `status: hotovo→probiha`. Aktuální kód apps/web/src/lib/tasks.ts:96–99 (toggleTask) mění JEN completed_at (docstring ř. 50 R9 slibuje, ale neimplementuje); status_id se synchronizuje pouze při drag-dropu na Nástěnce (Board.tsx:63). rowMeta.tsx:112–118 čte pilulku čistě ze status_id → úkol se stavem „Probíhá" dokončený checkboxem dál ukazuje zelenou „Probíhá" místo „Hotovo".
- **Fix:** V toggleTask po UPDATE completed_at nastavit i status_id: při dokončení na status projektu s is_done=1, při odškrtnutí z is_done stavu na první ne-done stav (stejná logika jako Board.dropTo); u opakovaného posunu řady demotovat is_done→ne-done.

### [MINOR] Hover checkboxu na brass nikdy nenastane (inline styl přebíjí třídu)
- **Evidence:** Prototyp ř. 417: nedokončený checkbox `border:2px solid var(--line)` + `style-hover="border-color:var(--brass)"`. TaskCard.tsx:119–125: třída `hover:border-brass`, ale zároveň inline `style={{ border: done ? "none" : "2px solid var(--w-line)" }}` — inline deklarace border-color vždy vyhraje nad CSS třídou (bez !important), takže hover brass se nikdy neprojeví.
- **Fix:** Nenastavovat barvu inline: inline nechat jen borderWidth/borderStyle (nebo třídy `border-2 border-line hover:border-brass`) a inline border úplně odstranit pro nedokončený stav.

### [MINOR] Flash nově přidaného úkolu (wFlash) úplně chybí
- **Evidence:** Prototyp CSS ř. 152–153: `@keyframes wFlash {0%{background:var(--brass-soft)}…}` + `[data-flash="true"]{animation:wFlash 1.6s ease}`; decorate ř. 2906 `flash:this.state.justAdded===t.id`; submitTask ř. 2472–2473 nastaví justAdded a po 1600 ms smaže. V aplikaci `justAdded`/flash neexistuje (grep v apps/web/src prázdný kromě kbSel), TaskCard nemá flash prop.
- **Fix:** Po vložení úkolu (QuickAdd/AddTaskModal) uložit id do stavu justAdded (timeout 1600 ms), předat `flash` do TaskCard a přidat wFlash keyframes do index.css + `animation` na root div řádku.

### [MINOR] „Každý zvlášť · N/M" pilulka a avatary: mezera 12 px místo 6 px
- **Evidence:** Prototyp ř. 436: assignAll obaluje pilulku i avatary wrapperem `<span style="display:flex; gap:6px; flex:none">`. TaskCard.tsx:335–369 renderuje pilulku a avatar skupinu jako samostatné děti řádku s row gap 12 px → mezera je 2× větší.
- **Fix:** V TaskCard při assignAll obalit pilulku + avatary do jednoho `<span className="flex items-center shrink-0" style={{gap:6}}>`.

### [MINOR] FlowChip drobné odchylky: title bez „Otevřít Postup:", tečky cap 8, stav skipped stylován jako waiting
- **Evidence:** Prototyp ř. 423: `title="Otevřít Postup: {{ f.flowName }} · krok {{ t.stepLabel }}"`; decorate ř. 2910 kreslí tečky pro VŠECHNY kroky (`Array.from({length:t.stepTotal||1})`); CSS ř. 121–123 stylují jen now/waiting/done — skipped chip má základní vzhled (border var(--line), ink-3, bez pozadí a opacity). TaskCard.tsx:406 `title={`${flow.name} · krok …`}` (bez prefixu), :428 `Math.min(flow.total, 8)` (cap), :393–398 default větev (panel-2 + opacity .85 = waiting) spolkne i state 'skipped'.
- **Fix:** Doplnit prefix do title, odstranit cap 8 (nebo zdůvodnit), a pro state==='skipped' vrátit základní styl `{background:'transparent', border:'1px solid var(--w-line)', color:'var(--w-ink-3)'}` bez opacity.

### [MINOR] Dnešní úkoly bez času ukazují „dnes"; prototyp nechává pravou stranu prázdnou
- **Evidence:** Prototyp DAYMETA ř. 1915 `dnes: {…, due:null}` + decorate ř. 2902–2903 (`dueLabel = t.dueLabel || timeLabel`) → dnešní úkol bez start času a bez seed labelu má hasDue=false, tj. žádný text (seedy t12, a1). Impl tasks.ts:159–164 vrací pro dnešek bez času vždy `{label: t("today.todayLower")}` = „dnes". (Pozn.: seed fp2 ř. 2139 má výjimečně dueLabel:'dnes' — prototyp je zde nekonzistentní; pokud je „dnes" vědomá volba, ignorovat.)
- **Fix:** Buď v rowDue vracet undefined pro dnešek bez času (1:1 s decorate), nebo rozhodnutí zdokumentovat jako záměrné rozšíření.

### [MINOR] Tint barvy řádku v tmavém režimu slabší než prototyp (12 % vs. 17 %)
- **Evidence:** Prototyp CSS ř. 62–63: dark tinty `rgba(<barva>,.17)` (17% krytí nad kartou); světlé pastely ř. 60–61 odpovídají ~12% mixu. TaskCard.tsx:55 používá jednotné `color-mix(in srgb, hex 12%, var(--w-card))` pro oba režimy → v dark modu je podbarvení znatelně bledší (12 % místo 17 %).
- **Fix:** Rozlišit režim: v dark použít `color-mix(in srgb, ${hex} 17%, var(--w-card))` — např. přes CSS proměnnou `--w-tint-mix: 12%` / dark `17%` v tokens.css a `color-mix(in srgb, ${hex} var(--w-tint-mix), var(--w-card))`.


## Dnes + Úkoly + Nadcházející (Today.tsx, Ukoly.tsx, Nadchazejici.tsx, TasksToolbar.tsx, WorkspaceChips.tsx, Header.tsx) — 68 %

### [MAJOR] Toolbar: chybí split-button řazení, ikony a ▾ — celkově jiný vzhled chipů
- **Evidence:** Prototyp ř. 377–383: split-button — levá část ‚⫿ {sortLabel2} ▾' s border-radius:8px 0 0 8px, pravá část samostatný segment se šipkovým SVG + textem ‚Vzestupně/Sestupně' (border-radius:0 8px 8px 0, border-left:none). Ř. 350: chip ‚Filtr' má SVG trychtýř + ▾, radius 8px, padding 6px 11px; ř. 390 ‚Dokončené' má SVG fajfku. Screenshoty 01/02/03 potvrzují. Aktuální kód apps/web/src/components/TasksToolbar.tsx:92–99 — všechny chipy pill (borderRadius 999, padding 4px 11px) bez ikon a ▾; ř. 144–151 jeden pill ‚Řazení · Chytré'; ř. 177–185 samostatný pill jen ‚↑/↓' bez textu Vzestupně/Sestupně.
- **Fix:** Přestavět TasksToolbar 1:1: Filtr chip (radius 8, funnel SVG, ▾), split-button řazení (levý segment ikona + label + ▾, pravý segment šipka + ‚Vzestupně/Sestupně', spojené rohy 8/0/0/8 a 0/8/8/0), Dokončené chip s fajfkou; sort menu položky zvýrazňovat brass-soft (data-rowsel) místo ✓.

### [MAJOR] Filtr menu má jen Prioritu — chybí dimenze Stav, Projekt a Osoba (s hledáním) + ‚Vymazat filtry'; v řazení chybí Projekt a Stav
- **Evidence:** Prototyp ř. 352–374: popover 230px se 4 sekcemi (Priorita / Stav / Projekt s inputem ‚Hledat projekt…' / Osoba s inputem ‚Hledat člověka…') + odkaz ‚Vymazat filtry' (ř. 373); sortOptions ř. 3233 má 6 položek vč. Projekt a Stav. Aktuální kód TasksToolbar.tsx:114–139 — popover jen chipy P1–P4; SORTS ř. 78–83 jen smart/due/priority/name. Pozn.: files/RECONCILIACE_design_vs_kod.md §24 to odkládá do #40 — je to ale stále zbývající mezera vůči prototypu, ne z uživatelova seznamu výjimek.
- **Fix:** Doplnit sekce Stav (dle statuses), Projekt a Osoba s vyhledávacím inputem (max-height 96px, overflow:auto) a odkaz ‚Vymazat filtry'; do sort menu přidat Projekt a Stav vč. komparátorů (prototyp ř. 3015).

### [MAJOR] Dnes neprojektuje výskyty opakování — opakovaný úkol s minulým base datem se ukáže ve Zpožděných místo dnešního výskytu
- **Evidence:** Prototyp ř. 3018: pro screen ‚dnes' je zdroj T = listTasks() (ř. 2654 — expanze výskytů, výjimky skipped/done); README ř. 63: ‚Dnes ukazuje jen aktuální výskyt, ne budoucí'. Aktuální kód apps/web/src/screens/Today.tsx:42–82 — SELECT * FROM tasks bez expandOccurrences (Nadchazejici.tsx:107–126 engine používá), skupiny počítá jen z base due_date → týdenní úkol založený minulý týden visí trvale ve ‚Zpožděné' a dnešní výskyt v ‚Dnes' chybí.
- **Fix:** V Today použít stejný occurrence engine jako Nadcházející: pro recurring úkoly vygenerovat dnešní výskyt (occId + override done/skipped), base s minulým datem u recurring nezařazovat do Zpožděných.

### [MAJOR] Inbox (Schránka) úkoly prosakují do Dnes, Úkolů i do počtů v headeru
- **Evidence:** Prototyp: seznam filtruje !t.inbox (ř. 3034 a 3042), Dnes bere jen group overdue/today (inbox úkoly mají group:'inbox', ř. 1918) — inbox žije jen ve Schránce. Aktuální kód: Today.tsx:42–44 a Ukoly.tsx:41–49 SELECT * FROM tasks bez vyloučení inbox projektů (detekce INBOX_NAMES existuje jen v Schranka.tsx:11,34 a Hledat.tsx:13); Today.tsx:76–78 navíc řadí úkoly bez data (d===null) do skupiny Dnes → každý nezatříděný úkol ze Schránky se objeví v Dnes i v Úkolech. Header.tsx:29–50 je počítá do podtitulu také.
- **Fix:** Sdílet detekci inbox projektů (vytáhnout INBOX_NAMES/flag do lib) a vyloučit inbox úkoly z Dnes, Úkolů i z podtitulových počtů; úkoly bez data nezařazovat automaticky do skupiny Dnes (prototyp je v Dnes nemá).

### [MAJOR] Klávesová navigace kbsel (j/k/↑↓/Enter/Space/1–4/⌫) chybí v Dnes a Nadcházejícím
- **Evidence:** Prototyp: data-kbsel na řádku je univerzální (ř. 415, CSS ř. 72 box-shadow brass ring), kbSel handler pracuje nad _navIds aktuální obrazovky — tedy i dnes/nadchazejici (ř. 3066: _navIds se plní ze groups každé obrazovky). Aktuální kód: handler + KbRow jen v Ukoly.tsx:79–131 a 205–215; Today.tsx a Nadchazejici.tsx mají pouze setNavIds pro ↑/↓ v detailu (Today.tsx:85–88, Nadchazejici.tsx:147–149), žádný kbSel stav ani zvýraznění.
- **Fix:** Vytáhnout kb-navigační hook z Ukoly.tsx (useListKeyboard(navIds, shown)) do lib a zapojit ho vč. KbRow ringu v Today i Nadchazejici (guard: jen list view, ne při psaní/otevřeném detailu).

### [MAJOR] Board karty: chybí prioritní barevný okraj karty (nedrift pravidlo barva=priorita), avatary, ⚑ deadline, ↻ label a ‚+ Přidat' patička sloupce
- **Evidence:** Prototyp ř. 465 data-pcard + CSS ř. 57: border-color karty = barva priority (P1 červená…), P pill neutrální (CSS ř. 52–54: border line, text ink-2, P1 ink); ř. 472–475: dueLabel s data-due (overdue červeně), ‚↻ {repeatLabel}', ‚⚑ {deadlineLabel}', avatary vpravo (margin-left:auto); ř. 480–482 tlačítko ‚+ Přidat' na konci sloupce; done karta opacity .55 (CSS ř. 114). Aktuální kód apps/web/src/components/Board.tsx:156–197 — border vždy var(--w-line), P pill má naopak barevný text var(--w-p{n}), termín vždy ink-3 bez overdue barvy, ↻ bez labelu, žádné avatary, deadline ani ‚+ Přidat', done jen line-through.
- **Fix:** Na kartě: borderColor = var(--w-p{priority}) pro nedokončené, P pill neutralizovat dle data-pri, přidat overdue barvu termínu, ⚑ deadline, popisek opakování, avatarovou skupinu vpravo, opacity .55 pro done a footer ‚+ Přidat' (otevře AddTask s předvyplněným statusem).

### [MAJOR] ‚Tvůj další krok v postupech' neodpovídá: chybí hlavička sekce, zobrazí se jen 1 krok místo seznamu, chybí ‚pak předáš → {osoba}' a krok X/Y vpravo, jiný vzhled
- **Evidence:** Prototyp ř. 395–407 + 3156: hlavička ‚Tvůj další krok v postupech' se swap ikonou, sc-for přes VŠECHNY mé aktivní kroky, řádek background:var(--brass-soft) s brass tečkou, podtitulek ‚{flowName} · pak předáš → {jméno dalšího}', vpravo mono ‚{stepIndex}/{stepTotal}'. Screenshot 01 potvrzuje. Aktuální kód Today.tsx:91–102 (myNextStep vrací jen první nalezený krok, bez výpočtu následníka) a ř. 189–216 (bez hlavičky, bg-card + brass border místo brass-soft, podtitulek ‚{chain} · krok 2/5', vpravo ‚→' místo 2/5).
- **Fix:** Renderovat sekci s hlavičkou + ikonou a mapovat všechny mé aktivní kroky; do podtitulku doplnit ‚pak předáš → {assignee dalšího kroku / kdokoli z týmu}'; vizuál řádku brass-soft, step counter mono vpravo.

### [MAJOR] Chip ‚Dokončené' chybí na Dnes i Nadcházejícím; Dnes má místo toho ne-prototypovou sekci ‚Hotovo' se všemi dokončenými, Nadcházející dokončené nezobrazí vůbec
- **Evidence:** Prototyp ř. 390: toggle ‚Dokončené' je součást toolbaru na všech workspace seznamech (screenshoty 01 a 02 ho ukazují na Dnes i Nadcházejícím); dokončené se pak ukážou uvnitř skupin (decL, ř. 3017). Aktuální kód: Today.tsx:220 a Nadchazejici.tsx:165,174 předávají hideDone; Nadchazejici.tsx:60 navíc SELECT … WHERE completed_at IS NULL → dokončené nejsou dosažitelné; Today.tsx:249–267 přidává vlastní sbalitelnou sekci ‚Hotovo' (g.done = VŠECHNY dokončené bez omezení na dnešek, ř. 80), která v prototypu není.
- **Fix:** Odstranit hideDone na obou obrazovkách, napojit showDone do filtrování skupin (done řádky inline v sekcích) a zrušit vlastní sekci ‚Hotovo'; v Nadcházejícím přestat filtrovat completed_at v SQL a řídit to přes toolbar.

### [MINOR] Šířka obsahu seznamů: Úkoly a Nadcházející max-w-3xl (768px) místo 1080px + jiný padding
- **Evidence:** Prototyp ř. 333: list kontejner max-width:1080px; margin:0 auto; padding:10px 22px 90px (screenshoty 02/03 ukazují široké řádky). Aktuální kód Ukoly.tsx:135 (max-w-3xl / max-w-[1080px] jen pro board+kalendář) a Nadchazejici.tsx:172 (max-w-3xl px-5 py-7); Today.tsx:178 má správně 1080/22px.
- **Fix:** Sjednotit na max-w-[1080px] + padding 10px 22px 90px pro list pohled Úkolů i Nadcházejícího.

### [MINOR] QuickAdd inline na Dnes v prototypu není + přehozené pořadí prvků (toolbar má být hned pod ws chipy)
- **Evidence:** Prototyp Dnes (ř. 314–450, screenshot 01): žádný inline add — přidávání jen přes modal (ř. 308) a ‚+ Přidat úkol' v sidebaru; pořadí bloků: ws chipy (ř. 342) → toolbar (ř. 347) → sekce postupu (ř. 395) → skupiny. Aktuální kód Today.tsx:183–186 vkládá QuickAdd mezi chipy a krok postupu; toolbar je až za sekcí postupu (ř. 219–221).
- **Fix:** Pokud QuickAdd inline není vědomé rozhodnutí uživatele, odstranit ho z Dnes (nechat modal); minimálně srovnat pořadí: chipy → toolbar → ‚Tvůj další krok' → skupiny.

### [MINOR] Hlavička filtrovaného projektu v Úkolech: chybí ‚Upravit projekt', jiná typografie a karta místo řádku, chybí ← u ‚Všechny úkoly'
- **Evidence:** Prototyp ř. 335–340: plochý řádek — tečka 11px, název font-display 800 18px ink, odkaz ‚Upravit projekt' (openProjDetail), vpravo brass ‚← Všechny úkoly'. Aktuální kód Ukoly.tsx:138–151: rámovaná karta (border, bg-card, px-4 py-3), název text-lg text-navy, ‚Upravit projekt' zcela chybí, odkaz bez šipky a bez brass barvy.
- **Fix:** Předělat na plochý řádek dle prototypu a doplnit ‚Upravit projekt' → otevření ProjectDetailPanel.

### [MINOR] Inline hledání v headeru: chybí × pro zavření a lupa se při otevřeném hledání neskrývá
- **Evidence:** Prototyp ř. 294: uvnitř search boxu je × (toggleSearch, hover ink); ř. 297–299: tlačítko s lupou se renderuje jen když je hledání zavřené (sc-if searchClosed). Aktuální kód Header.tsx:172–197 box bez ×, ř. 198–219 lupa zůstává viditelná vždy (jen toggluje).
- **Fix:** Přidat × span do boxu (zavře + vymaže q) a lupu podmínit !searchOpen na workspace obrazovkách.

### [MINOR] View switcher + zámek chybí na Oblíbených (Priorita 1 / Přiřazeno mně)
- **Evidence:** Prototyp ř. 3241: showViewSwitcher = isWorkspace && screen!=='dnes' && screen!=='schranka', kde isWorkspace zahrnuje ‚oblibene' (ř. 3022). Aktuální kód Header.tsx:65: jen path /ukoly a /nadchazejici; Oblibene.tsx je čistý seznam bez view módu.
- **Fix:** Zahrnout /oblibene do showViewSwitcher a napojit Oblibene na useViewMode (list/board/calendar).

### [MINOR] Prázdné stavy: jiný text i vzhled; u filtrovaného projektu chybí CTA ‚+ Přidat úkol'
- **Evidence:** Prototyp ř. 448–449: bez rámečku, ‚Nic tu není — čistý stůl. 🙂' (padding 80px 20px); projektový prázdný stav ‚V tomto projektu zatím nejsou žádné úkoly.' + brass tlačítko ‚+ Přidat úkol'. Aktuální kód: dashed rámeček s textem ‚Na dnešek nemáš nic. Hezký klid.' všude (Today.tsx:240, Ukoly.tsx:161–165, Nadchazejici.tsx:175–179, i mimo Dnes), projektová varianta bez CTA.
- **Fix:** Sjednotit texty s prototypem (obecný ‚Nic tu není — čistý stůl. 🙂', projektový s CTA otevírajícím AddTask s předvyplněným projektem) a odstranit dashed rámeček.

### [MINOR] V řádcích chybí čtvereček barvy workspace před názvem projektu (screens nepředávají wsColor)
- **Evidence:** Prototyp ř. 422: span data-wsdot 6×6 radius 2 před projName. TaskCard prop wsColor existuje a renderuje se (packages/ui/src/TaskCard.tsx:167–171), ale Today.tsx:126–136, Ukoly.tsx:170/191 ani Nadchazejici.tsx:195–202 ho nepředávají → čtvereček se nikdy nezobrazí.
- **Fix:** Doplnit lookup workspace barvy projektu (projekt.workspace_id → workspaces.color) a předat wsColor do TaskItem/TaskCard na všech třech obrazovkách.

### [MINOR] Horizont projekce výskytů 40 dní místo ~16 → bucket ‚Později' se zahltí
- **Evidence:** README ř. 63: ‚výskyty se promítají do Nadcházející (horizont ~16 dní, aby se Později nezahltilo)'; prototyp listTasks(days) default 16 (ř. 2654). Aktuální kód Nadchazejici.tsx:24: HORIZON_DAYS = 40 (cap 40 výskytů).
- **Fix:** Snížit HORIZON_DAYS na 16 (příp. konstantu sdílet s Dnes po doplnění projekce).

### [MINOR] Skupiny v Úkolech se řadí podle pořadí úkolů (mění se s řazením) místo stabilního pořadí projektů; počet ve skupině je po filtrech
- **Evidence:** Prototyp ř. 3040–3043: groups iterují PROJECTS (pořadí prostorů/sidebaru), count = počet aktivních úkolů projektu před decL filtry. Aktuální kód Ukoly.tsx:56–65: Map plněná v pořadí seřazeného seznamu úkolů → při řazení ‚Abeceda' se přeskupí i sekce; count ř. 184 = jen vyfiltrované.
- **Fix:** Iterovat projects (ORDER BY name už je v useProjects) a k nim přiřazovat úkoly; count počítat z nefiltrovaného scoped.


## Kalendář (Calendar.tsx + CalendarMonth.tsx) — 78 %

### [CRITICAL] colAt nezapočítává 46px gutter → drag přes dny commitne špatný den
- **Evidence:** Prototyp ř. 2691: weekGridEl je pozicován left:46px (ř. 2856), takže `(e.clientX-gr.left)/(gr.width/7)` počítá jen nad 7 sloupci. Implementace apps/web/src/components/Calendar.tsx:843–849: `weekGridRef` (ř. 1197) obaluje i hodinovou osu šířky 46px (ř. 1199), ale colAt dělí celou šířku vč. gutteru: `idx = floor(((clientX - r.left) / r.width) * isos.length)`. Reálný sloupec i začíná na left+46+i*(w-46)/7, bucket ale na i*w/7 → v pravé ~třetině pondělního sloupce vyjde úterý; commit v onUp (ř. 919 `onMove(cur.id, cur.iso, cur.s)`) zapíše špatné due_date. Pozn.: `minAt` (ř. 850–855) je mrtvý kód a navíc scrollTop připočítává dvakrát.
- **Fix:** V colAt odečíst gutter: `const x = clientX - r.left - 46; const cw = (r.width - 46) / isos.length; idx = clamp(floor(x / cw))`. Smazat nepoužívaný `minAt` (nebo opravit odstraněním scrollTop, pokud se má použít).

### [MAJOR] Výskyt opakování nejde odškrtnout přímo v kalendáři (checkbox je no-op)
- **Evidence:** Prototyp: calCheck → toggleDone i pro occurrence id (ř. 2762 + README ř. 58–59 „každý výskyt samostatně dokončitelný… odškrtávání přímo v kalendáři ve všech pohledech"). Implementace Calendar.tsx:116 `if (!isVirtual(tk)) void toggleTask(tk);` a CalendarMonth.tsx:203 `if (!tk.id.includes("@")) void toggleTask(tk);` — klik na checkbox virtuálního výskytu neudělá NIC, přestože lib/tasks.ts:56–61 (toggleTask) occ id plně podporuje přes setOccurrenceOverride.
- **Fix:** Odstranit guard a volat `void toggleTask(tk)` vždy (toggleTask sám rozliší occ id → per-výskyt override). Totéž v CalendarMonth inline checkboxu.

### [MAJOR] Klik na výskyt otevře base úkol místo detailu výskytu (banner „↻ Výskyt řady")
- **Evidence:** Prototyp: openTask(occurrence id) → detail s bannerem výskytu (README ř. 64, screenshot 16). Implementace ořízne id na base: Calendar.tsx:554 a 568 `open(baseId(tk))`, CalendarMonth.tsx:188 `open(tk.id.split("@")[0])` — přitom TaskDetailPanel.tsx:123–124 occ id podporuje (parseOccId, banner ř. 417, Označit hotovo/Přeskočit ř. 248–257). Uživatel z kalendáře nikdy nedostane per-výskyt akce.
- **Fix:** Předávat plné id: `open(tk.id)` ve všech třech místech (TimeGrid onOpen, WeekColumns onOpen, month chip).

### [MAJOR] Měsíc: vícedenní úkol se kreslí jen v den startu, ne přes celý rozsah
- **Evidence:** Prototyp ř. 2874: buňka filtruje `this._hit(t, cellIso)` (start ≤ den ≤ konec, _hit ř. 2632) → 4denní úkol má chip ve 4 buňkách. Implementace CalendarMonth.tsx:69–79 `byDay` mapuje jen podle `taskDay` (= due_date den startu), sloupec `days` ignoruje → úkol zmizí z dnů 2–N.
- **Fix:** V byDay expandovat přes rozsah: pro každý task s days>1 přidat do mapy všechna ISO od startu po start+days-1 (sdílet tIso/tIsoEnd/hit z Calendar.tsx, jsou exportované).

### [MAJOR] Drop v Měsíci a v týdnu-Sloupcích maže čas úkolu (start_date → null)
- **Evidence:** Prototyp měsíc ř. 2710 monthDropTo: `Object.assign({},t,{date})` — mění jen den, start/end (čas) zůstávají; Sloupce ř. 2707 dropToGrid zachovává trvání a dává čas. Implementace: Calendar.tsx:334–343 moveTask s `min=null` → `start_date = null`; volá se z CalendarMonth.tsx:157 (`onDropDay?.(id, iso, null)`) i WeekColumns Calendar.tsx:555 (`moveTask(id, iso, null)`). Úkol s časem 14:00 přetažený na jiný den se stane celodenním — ztráta dat.
- **Fix:** Při min==null zachovat původní čas: v moveTask číst stávající start_date a když má časovou složku, zapsat `${iso}T${původní čas}`; explicitní přesun do pásu CELÝ DEN nechat mazat čas (tam předávat sentinel, např. min=-1 nebo samostatný parametr allDay:true).

### [MINOR] Blok při tažení do jiného dne zmizí (prototyp ho živě posouvá)
- **Evidence:** Prototyp ř. 2696: _calMove zapisuje `date: nd` do stavu → blok se okamžitě vykreslí v cílovém sloupci. Implementace Calendar.tsx:1304–1308: `if (!showInCol && drag?.mode === "move") return null;` skryje blok v původním sloupci, ale cílový sloupec ho nemá v `timed` (filtr ř. 1214 jde nad původními daty) → během cross-day dragu blok není vidět nikde.
- **Fix:** Renderovat dragovaný blok v cílovém sloupci: do `timed` cílového sloupce (iso === drag.iso) přidat task s drag.s/drag.e, nebo blok vykreslit jako overlay nad weekGridRef s left podle indexu drag.iso.

### [MINOR] Meta řádek bloku v mřížce nemá avatar přiřazené osoby
- **Evidence:** Prototyp ř. 2789–2792: při height≥58 && !narrow meta = název projektu + kruhový avatar 15px s iniciálami (`who`, bg var(--avatar-navy), fontSize 8.5). Implementace Calendar.tsx:1389–1398 zobrazuje jen projName; useRowMeta (avatary) je použit jen v CalendarMonth.tsx:47/178.
- **Fix:** V TimeGrid použít useRowMeta().metaOf(tk).avatars[0] a doplnit 15px avatar span vpravo do meta řádku (vzor: CalendarMonth.tsx:236–243, jen velikost 15/8.5).

### [MINOR] Wheel navigace v týdnu skáče po 7 dnech místo rolování po dni
- **Evidence:** Prototyp ř. 2671 calWheel: mimo měsíc volá `this.shiftCur(dir)` = ±1 den (rolující týden; weekDates ř. 2658 startuje na calCur, ne na pondělí). Implementace Calendar.tsx:319–328 volá `shiftCur(dir)`, který je mode-aware (ř. 203 týden = ±7 dní) a days useMemo (ř. 224–225) vždy přichytává na pondělí → wheel = skok o celý týden.
- **Fix:** Pokud má zůstat pondělní zarovnání (jednodušší), aspoň snížit krok: v onWheel pro week volat posun po dni s přepočtem, nebo ponechat vědomě a zdokumentovat; 1:1 řešení = kotva calCur bez snapu + wheel ±1 den, Dnes/šipky snap na pondělí (prototyp calToday ř. 2661).

### [MINOR] Gear menu: Hustota/Barevný okraj se nemají zobrazovat v týdnu-Sloupce; okraj je v prototypu cycle-chip
- **Evidence:** Prototyp ř. 3241: `showGridOpts = calMode!=='month' && !(week && weekView==='list')` → v režimu Sloupce gear obsahuje jen sekci Postranní panel; okraj karty je jeden chip s brass proužkem cyklující „priorita/projekt" (ř. 516, borderLabel lowercase) a chip Plánování má ikonu panelu (ř. 522). Implementace Calendar.tsx:477–527 ukazuje všechny tři sekce vždy (i v Sloupcích, kde hustota nemá efekt), okraj jako dva taby, Plánování bez ikony.
- **Fix:** Podmínit GearSection Hustota+Okraj `!(mode==='week' && weekView==='cols')`; volitelně sjednotit okraj na cycle-chip s 3×14px brass proužkem a doplnit SVG ikonu panelu k chipu Plánování.

### [MINOR] Pás CELÝ DEN: popisek gutteru není vertikálně centrovaný; vícedenní úkol v Dni je pruh místo chipu
- **Evidence:** Prototyp ř. 2824: gutter `alignItems:center; justifyContent:center; textAlign:center` (screenshot 06 — „CELÝ DEN" na středu pásu). Implementace Calendar.tsx:1043–1048: `items-start justify-end` + padding 6px → nahoře vpravo. Dále prototyp v Dni (cols.length===1) kreslí vícedenní úkoly jako běžné chipy přes `_hit` (ř. 2798, bars jen `if(isWeek)` ř. 2808); implementace ř. 978–1006 kreslí bars i v Dni a chip filtr `(days ?? 1) <= 1` je vynechá — chybí tečka projektu, přebývá „N dní" (viz screenshot 06: chip s tečkou).
- **Fix:** Gutter: `items-center justify-center` bez top-paddingu. V Dni (isos.length===1) bars nerenderovat a chip filtr rozšířit na `hit(tk, iso)` pro všechny all-day úkoly.

### [MINOR] Popisek 00:00 v hodinové ose je oříznutý
- **Evidence:** Prototyp ř. 2832: `top:(hr===0?2:hr*60*PPM-6)` — nultá hodina má výjimku. Implementace Calendar.tsx:1200–1208: `top: h * 60 * PPM - 6` pro všechny → label 00:00 na top:-6px je ořezán scroll kontejnerem (overflow-y-auto, ř. 1196).
- **Fix:** `top: h === 0 ? 2 : h * 60 * PPM - 6`.

### [MINOR] „+N" při 4+ překryvech: jediné tlačítko s pevnou výškou místo per-cluster pruhů, pozice podle nesetříděného prvního
- **Evidence:** Prototyp ř. 2746–2756: skryté úkoly se dělí na pod-clustery, každý dostane vlastní +N s top=(min start) a výškou přes rozsah clusteru (min 20). Implementace Calendar.tsx:1403–1426: jeden button `height: 30`, `top: startMin(hiddenByLane[0])` — hiddenByLane není setříděné podle startu (filtr nad `timed` v původním pořadí ř. 1218), takže +N může sedět u pozdějšího úkolu a druhé pásmo překryvů nemá indikátor.
- **Fix:** Setřídit hidden podle startu, seskupit na clustery (stejný algoritmus jako prototyp ř. 2750) a renderovat +N na cluster s výškou Math.max(20,(e-s)*PPM).

### [MINOR] Plánování panel: karty bez due labelu a bez bg panelu
- **Evidence:** Prototyp ř. 544–549: karta má pod názvem mono 10.5px dueLabel obarvený přes data-due (zpožděné červeně) a panel má `background:var(--panel)` (ř. 534); bg karty var(--panel-2). Implementace Calendar.tsx:1485–1501: jen tečka+název (bg-card), PlanningPanel ř. 1506–1510 bez background.
- **Fix:** Doplnit druhý řádek s occLabel/rowDue (lib/tasks.ts) obarvený var(--w-overdue) pro zpožděné, bg karty var(--w-panel-2), panelu bg-card.

### [MINOR] Clamp názvu bloku: chybí lineHeight a odečet meta řádku; v Dni se nikdy neaktivuje narrow režim
- **Evidence:** Prototyp ř. 2771–2777: `narrow = widthPct < 46` (platí i pro Den — 3 lanes v Dni ⇒ narrow), lineH 12/13, name má `lineHeight:lineH`, `nameLines = floor((height-7-(showMeta?15:0))/lineH)`. Implementace Calendar.tsx:1313 `narrow = narrowWeek && (…)` — v Dni (narrowWeek=false) nikdy narrow (checkbox/velikost písma se u překryvů nezmenší) a naopak v týdnu narrow už při cols>1 (wPct 50 ≥ 46 by narrow být neměl); ř. 1315 `nameLines=(hPx-14)/13` bez odečtu meta (15px) a span nemá lineHeight → ořez nesedí na řádky.
- **Fix:** narrow = wPct < 46 (bez vazby na narrowWeek, bez `cols>1`); nastavit lineHeight (12/13px) na span názvu a nameLines = max(1, floor((hPx-7-(showMeta?15:0))/lineH)).

### [MINOR] Kalendář Nadcházející nedostává hotové úkoly (prototyp je ukazuje přeškrtnuté)
- **Evidence:** Prototyp calTasks (ř. 2633) nefiltruje done — hotové bloky se kreslí s opacity .58 a přeškrtnutím (ř. 2780, 2784), odškrtnutí lze vzít zpět přímo v mřížce. Implementace apps/web/src/screens/Nadchazejici.tsx:60: `SELECT * FROM tasks WHERE completed_at IS NULL AND due_date IS NOT NULL` → v kalendáři Nadcházející hotový úkol okamžitě zmizí a nejde od-škrtnout (Úkoly ok — Ukoly.tsx:41 bere vše).
- **Fix:** Pro calendar view v Nadchazejici předávat i dokončené (samostatný dotaz bez completed_at filtru, nebo filtr aplikovat až v list/board větvi).

### [MINOR] Kalendář je zabalen do rounded karty s maxHeight místo full-bleed výšky obsahu
- **Evidence:** Prototyp ř. 490/531: kalendář je flex sloupec `height:100%`, mřížka `flex:1 min-height:0` — plná šířka obsahu, bez karty (screenshoty 04–06: toolbar s border-b od kraje ke kraji). Implementace: TimeGrid v `rounded-[12px] border bg-card` (Calendar.tsx:1006) se scrollem `maxHeight: calc(100vh - 320px)` (ř. 1196) uvnitř kontejneru `max-w-[1080px] px-5 py-7` (Ukoly.tsx:135, Nadchazejici.tsx:155) → dvojité rámování a mrtvý prostor dole při vyšších oknech.
- **Fix:** Nechat Calendar vyplnit výšku obsahu: rodič flex column s h-full, mřížka flex-1 min-h-0 overflow-y-auto (odstranit maxHeight kalkulaci); rounded kartu zvážit odstranit, ať sedí screenshoty.


## Detail úkolu (apps/web/src/components/TaskDetailPanel.tsx + lib/tasks.ts) — 82 %

### [MAJOR] „Označit hotovo“ nesynchronizuje stav (R9) — status chip zůstává stale
- **Evidence:** Prototyp ř. 2482 toggleDone: `status: !t.done?'hotovo':(t.status==='hotovo'?'probiha':t.status)` a při posunu řady `status:t.status==='hotovo'?'probiha':t.status`. Aktuální kód lib/tasks.ts:96–100 nastavuje jen completed_at; status_id se mění pouze při dragu na nástěnce (Board.tsx:63). Detail čte chip čistě z JOINu statuses (TaskDetailPanel.tsx:196–199, render :534–551) bez fallbacku na completed_at.
- **Fix:** V toggleTask po zápisu completed_at dohledat statuses projektu a nastavit status_id na is_done=1 sloupec (a při odškrtnutí zpět na první ne-done), stejně jako Board.dropTo; případně v detailu odvozovat chip z completed_at (jako Board.colOf ř. 40).

### [MAJOR] „Kopírovat odkaz“ vyrábí mrtvý deep-link — ?ukol= nikdo nečte
- **Evidence:** TaskDetailPanel.tsx:309 zapisuje `${location.origin}/ukoly?ukol=${realId}`, ale router.tsx:22–24 validateSearch pro /ukoly propouští jen `projekt` a žádná komponenta param `ukol` nekonzumuje (grep celého apps/web/src). Otevření zkopírovaného odkazu detail neotevře.
- **Fix:** Přidat `ukol` do validateSearch ukolyRoute a v Ukoly.tsx při mountu zavolat useTaskDetail().open(ukol) + param smazat z URL.

### [MAJOR] Detail výskytu počítá „po termínu“ z base úkolu, ne z data výskytu
- **Evidence:** Prototyp ř. 2652 makeOcc: `overdue: b.group==='overdue'` per ISO výskytu (a dueLabel z occ ISO). Aktuální kód: overdue z base due_date (TaskDetailPanel.tsx:245) řídí Watson hint (:319–323) a barvu date chipu `due.overdue` (:528), zatímco label ukazuje occ datum (:531). Budoucí výskyt zpožděné řady tak má červený chip a hlášku „Tenhle úkol je po termínu…“.
- **Fix:** Pro occ počítat overdue = occ.iso < todayISO() (a barvu chipu z toho), rowDue base použít jen pro ne-výskytový detail.

### [MAJOR] Smazat úkol nechává v DB sirotky (vnoučata + assignments/komentáře podúkolů)
- **Evidence:** Prototyp maže celé objekty (ř. 2556). Aktuální kód lib/undo.ts:91–97 maže tasks WHERE id=? OR parent_id=? (jen 2 úrovně, UI ale povoluje 3 — TaskDetailPanel.tsx:168–175 depth<3) a assignments/comments/checklist jen WHERE task_id = taskId, ne pro mazané děti. Vnoučata a řádky dětí zůstanou v DB a dál se počítají v Cílech/Reportech (Cile.tsx:76 čte všechny tasks).
- **Fix:** Rekurzivní CTE posbírat všechna id podstromu, snapshotovat a smazat tasks + assignments/comments/checklist/chain_steps pro všechna tato id.

### [MINOR] Duplikovat nekopíruje přiřazené osoby ani podúkoly; přípona „(kopie)“ mimo i18n
- **Evidence:** Prototyp ř. 2557 duplicateTask kopíruje celý objekt vč. people a subtasks. Aktuální kód TaskDetailPanel.tsx:294–307 INSERT…SELECT kopíruje jen sloupce tasks (bez assignments, bez child tasks) a SQL literál `' (kopie)'` se nepřekládá (EN UI ukáže česky).
- **Fix:** Po insertu zkopírovat assignments (INSERT…SELECT s novým task_id) a child tasks s novým parent_id; příponu vzít z t('detail.copySuffix').

### [MINOR] Chybí popisek režimu přiřazení nad seznamem („Stačí kdokoli…“ / „Každý zvlášť — N/M hotovo“)
- **Evidence:** Prototyp ř. 1040 (assignAll: „Každý zvlášť — {{allLabel}} hotovo“ nad seznamem, 12px ink-3, mb 8) a ř. 1051 (assignAny: „Stačí kdokoli — jeden checkbox pro celý úkol“). Aktuální kód renderuje jen assignAllHint POD tlačítkem „+ Přiřadit“ (TaskDetailPanel.tsx:933–937); klíč detail.assignAnyHint v cs.json existuje, ale nikde se nepoužívá.
- **Fix:** Nad <ul> přiřazení vykreslit popisek dle mode: shared_all → assignAllHint, shared_any → assignAnyHint (12px, ink-3, margin-bottom 8) a odstranit duplicitní řádek dole.

### [MINOR] Banner výskytu je NAD názvem úkolu — prototyp ho má pod ním
- **Evidence:** Prototyp: checkbox+název ř. 993–997, teprve pak banner ř. 999–1008. Aktuální kód: banner na :416–445, odkaz na rodiče :448–457, název až :460–494.
- **Fix:** Přesunout blok banneru výskytu za řádek checkbox+název (margin 14px 0 0 zachovat).

### [MINOR] ⋯ menu: jiná typografie a zkrácený label „Smazat“
- **Evidence:** Prototyp ř. 983–986: položky font-body 13px, color var(--ink) (delete var(--overdue)), text „Smazat úkol“. Aktuální kód MenuItem (TaskDetailPanel.tsx:1033–1041): font-display font-semibold 12.5px, color var(--w-ink-2); cs.json detail.delete = „Smazat“.
- **Fix:** MenuItem přepnout na font-body 13px, barvu ink (danger overdue beze změny); detail.delete → „Smazat úkol“.

### [MINOR] Stav panelu se nenuluje při ↑↓/j/k navigaci (menu, rozepsaný komentář/podúkol se přenáší)
- **Evidence:** Prototyp ř. 2223–2224 při j/k nastavuje `taskMenu:null`. Aktuální kód: <Panel id={openId}> bez key (TaskDetailPanel.tsx:113) → menuOpen/assignOpen/editOpen/cmtText/subText přežijí přepnutí na jiný úkol.
- **Fix:** Renderovat `<Panel key={openId} …>` (remount vynuluje lokální stav).

### [MINOR] Přeskočení/dokončení výskytu není v undo zásobníku (⌘Z)
- **Evidence:** Prototyp skipOccurrence ř. 2477 a setOccField ř. 2479 volají `this._pushHist()` před mutací exceptions. Aktuální kód setOccurrenceOverride (lib/tasks.ts:18–41) žádné pushUndo nevolá — ⌘Z přeskočený výskyt nevrátí.
- **Fix:** V setOccurrenceOverride zavolat pushUndo s inverzní operací (UPDATE zpět na předchozí done/skipped, resp. DELETE nově vloženého řádku).

### [MINOR] Text opakování v banneru: „Denně.“ místo „Opakuje se denně.“ + occ label bez ink-2
- **Evidence:** Prototyp ř. 2933 seriesRepeat: repeatLabel || mapa kind→„Opakuje se denně/týdně/po 14 dnech/měsíčně/ročně“ || „Opakovaný úkol“; ř. 1003 mono label výskytu má color:var(--ink-2). Aktuální kód: `seriesRepeat = task.recurrence || t("detail.recurringTask")` (TaskDetailPanel.tsx:326), přičemž sloupec recurrence nese krátký label z AddTaskModal (repLbl, AddTaskModal.tsx:676 → „Denně“); mono span :429–431 barvu nenastavuje (dědí ink).
- **Fix:** Fallback mapovat recurrence_rule.kind → t('detail.repeatsDaily'/…) ve tvaru „Opakuje se …“ (rich label z parseru nechat přednostně) a mono labelu dát color var(--w-ink-2).


## Postupy — 87 %

### [MAJOR] Dnes „Tvůj další krok v postupech" — jen jeden krok, bez nadpisu sekce a bez „pak předáš →"
- **Evidence:** Prototyp ř. 396–406: sekce s nadpisem „Tvůj další krok v postupech" (ikona štafety) + sc-for přes myFlowSteps (brass-soft karta, subtitle „{{f.flowName}} · pak předáš → {{f.blocking}}", mono „{{f.step}}" vpravo); ř. 3156: myFlowSteps = VŠECHNY moje aktivní kroky vč. jména dalšího v řadě. Aktuální kód apps/web/src/screens/Today.tsx:91–102 — myNextStep vrací jen PRVNÍ nalezený krok (return uvnitř cyklu); ř. 188–216 — jediná karta bez sekčního nadpisu, subtitle jen „{chainName} · krok 2/5" bez „pak předáš → X", styl bg-card + border-brass místo brass-soft. i18n klíče flows.myStepsHead a flows.thenHandOff v cs.json existují, ale nikde se nepoužívají.
- **Fix:** V Today.tsx zmapovat všechny nedokončené aktivní kroky přiřazené mně (ne jen první), nad ně vykreslit nadpis t('flows.myStepsHead') s ikonou; do subtitle doplnit „· {t('flows.thenHandOff')} {jméno prvního přiřazeného kroku position+1}" (dohledat přes chain_steps + assignments); kartu stylovat brass-soft pozadí + 7px brass tečka + mono „pos/total" vpravo dle prototypu ř. 398–404.

### [MINOR] Chybí chip „Připomenout" u čekajících kroků přiřazených mně v detailu postupu
- **Evidence:** Prototyp ř. 1136: canRemind (waiting + přiřazen aktuálnímu uživateli) → toggle chip „Připomenout" se zvonečkem a data-on stavem; ř. 2496 remindStep přepíná flag. Aktuální kód apps/web/src/screens/Postupy.tsx:695–752 — akce kroku jsou jen Dokončit krok / Aktivovat krok / Vrátit sem; žádný Připomenout (překlady flows.remind a flows.remindTitle v cs.json jsou nevyužité).
- **Fix:** Ve FlowDetail u kroků se step_state='dormant' přiřazených mně vykreslit toggle chip t('flows.remind') s title t('flows.remindTitle'); stav držet per-user (localStorage nebo sloupec remind na chain_steps) a přepínat data-on styl (brass-soft/brass-text).

### [MINOR] Role kroku se v ose detailu nezobrazuje — krok s rolí ukazuje „kdokoli z týmu" a relay „?"
- **Evidence:** Prototyp ř. 2554 flowView: whoInitials='◇' a whoName='Role: '+role pro kroky s rolí (relay avatar dostane iniciály/◇). Aktuální kód: builder ukládá roli jen do tasks.description jako „Role: Grafik" (Postupy.tsx:864–865), ale stepWho (Postupy.tsx:176–179) čte pouze assignments → krok s rolí zobrazí „kdokoli z týmu" + avatar „?" místo „Role: Grafik" + ◇.
- **Fix:** V FlowDetail/stepWho detekovat roli (prefix „Role: " v description úkolu, ideálně vlastní sloupec role na chain_steps) a zobrazovat whoName='Role: X' s avatarem ◇; stejně u relay avataru dalšího kroku.

### [MINOR] Šablony: ztracený režim „Každý zvlášť", odchylka gate u grantu, „Uložit jako šablonu" neukládá who/mode
- **Evidence:** Prototyp ř. 2509–2529: podcast „Nahrát epizodu" mode:'all', ples „Sestavit program večera" mode:'all', grant „Interní revize žádosti" gate:'auto' + mode:'all'; ř. 2495 saveFlowAsTemplate ukládá who i mode. Aktuální kód Postupy.tsx:56–98 — TEMPLATES nemají mode vůbec a grant krok 2 má gate 'with_previous' místo after_previous(auto); Postupy.tsx:823 pick() nastavuje mode vždy 'any'; Postupy.tsx:409–429 saveTemplate ukládá jen name/offset/priority/gate.
- **Fix:** Doplnit mode do TEMPLATES dle prototypu a přenášet ho v pick(); grant krok 2 vrátit na after_previous (nebo změnu vědomě zdokumentovat); saveTemplate ukládat i mode (who nechat vynechané kvůli reálným účtům, ale zdokumentovat).

### [MINOR] „Uložit jako šablonu" je pod blokem Plánování místo nad ním
- **Evidence:** Prototyp ř. 1101–1102 + screenshot 13: tlačítko „Uložit jako šablonu" je hned pod ETA a NAD řádkem PLÁNOVÁNÍ. Aktuální kód Postupy.tsx:508–590 — pořadí je Plánování → hint → až pak Uložit jako šablonu (ř. 582–590).
- **Fix:** Přesunout tlačítko saveTemplate před blok „Plánování" (mezi ETA a segment Řetězec/Kotva).

### [MINOR] Mikro-vizuál detailu: waiting tečka bez rámečku, ±1d tlačítka mono místo display 700/12px
- **Evidence:** Prototyp CSS ř. 126 [data-stepdot="waiting"]{background:panel-2; color:ink-3; border:1px solid var(--line)} — aktuální kód Postupy.tsx:598–617 kreslí dormant tečku bez borderu; prototyp ř. 1108–1109 −1d/+1d = font-display, weight 700, 12px — impl Postupy.tsx:546–563 font-mono 11.5px; label „Plánování" 10px (ř. 1103) vs. impl 9.5px (Postupy.tsx:512).
- **Fix:** Dormant/skipped tečce přidat border 1px var(--w-line); ±1d přepnout na font-display font-bold fontSize 12; label Plánování na 10px.

### [MINOR] „Bez víkendů" se aplikuje i v režimu Kotva (prototyp jen v Řetězci)
- **Evidence:** Prototyp ř. 2487 _reflow: anchor větev počítá čistě flowAnchor+anchorOffset bez _nextWork (víkendy se přeskakují jen v chain větvi, si>base). Aktuální kód apps/web/src/lib/chainReflow.ts:85–92 — `if (skip && pos > fromPos) d = nextWork(d)` je mimo větvení režimu, takže i „pevné" kotvené termíny se posunou z víkendu (koliduje s hintem „Termíny jsou pevné").
- **Fix:** Podmínku nextWork aplikovat jen když mode==='chain' (přesun do else větve), případně chování vědomě zdokumentovat jako odklon.


## Projekty + Cíle + Reporty — 72 %

### [CRITICAL] Detail cíle: „Úkoly v hledáčku“ renderují prázdné názvy úkolů (SELECT nezahrnuje name)
- **Evidence:** Prototyp ř. 1342–1348: sampleTasks zobrazují {{ t.name }} + stav (včas/pozdě/otevřený). Kód: apps/web/src/screens/Cile.tsx:75–77 — `SELECT id, project_id, completed_at, due_date FROM tasks` (bez sloupce name), ale GoalDetail na ř. 851 renderuje `{tk.name}` → undefined. Seznam „Úkoly v hledáčku“ v detailu cíle ukazuje řádky bez textu.
- **Fix:** V Cile.tsx přidat `name` do SQL dotazu: `SELECT id, name, project_id, completed_at, due_date FROM tasks`.

### [MAJOR] Detail projektu: členy nelze přidávat/odebírat (toggle avatarů chybí), vlastníka lze zvolit jen ze stávajících členů projektu
- **Evidence:** Prototyp ř. 1255–1258 + logika ř. 3137–3138 a toggleProjMember (ř. ~2380): sekce Členové = klikací avataři celého rosteru prostoru (data-on toggle přidá/odebere člena); Vlastník (ř. 1241–1244, owners=this.PEOPLE) nabízí celý roster (screenshot 08: všech 7 avatarů). Kód: apps/web/src/components/ProjectDetailPanel.tsx:250–263 — členové jsou jen statické <span>, žádný onClick; vlastník (ř. 178–201) iteruje jen `members` z /api/projects/{id}/members.
- **Fix:** V ProjectDetailPanel načíst roster prostoru (/api/workspaces/{ws}/members), sekci Členové vykreslit jako toggle avatary (on = člen projektu, klik = POST/DELETE project_members), Vlastníka nabízet z celého rosteru.

### [MAJOR] Builder cíle: chybí šablony „Začít ze šablony“ (6 karet GOAL_TEMPLATES)
- **Evidence:** Prototyp ř. 1423–1432 (grid 2 sloupce, data-tplcard) + GOAL_TEMPLATES ř. 2324–2330 (Odbavit úkoly toto čtvrtletí, Úkoly odbavené včas, Faktury zaplacené včas, Docházky vyplněné včas, Týdenní osobní penzum, Dokončit projekt) + pickGoalTemplate ř. 2344. Kód: apps/web/src/screens/Cile.tsx:361–617 — GoalModal jde rovnou z názvu na scope/metriku, sekce šablon neexistuje.
- **Fix:** Do GoalModal přidat sekci „Začít ze šablony“ — 6 předdefinovaných karet (label + sub), klik předvyplní name/metric/target/periodic/scope (+ filtr), zvýraznění vybrané (border brass, bg brass-soft).

### [MAJOR] Cíle: chybí filtry „Člověk (volitelně)“ a „Klíčové slovo v názvu“ (fPerson/fKeyword) — v UI i datovém modelu
- **Evidence:** Prototyp ř. 1446 (select Měřený člen / Člověk volitelně), ř. 1450 (input Klíčové slovo, „např. faktur, docház, nábor“), goalTasks ř. 2360 filtruje t.people includes fPerson a name includes fKeyword; README ř. 76: „filtr (projekt/člověk/klíčové slovo)“. Kód: packages/db/src/schema/goals.ts:22–44 — tabulka goals nemá person/keyword sloupce; apps/web/src/screens/Cile.tsx:121–134 goalTasks filtruje jen projekt + (scope=person → owner). Cíle jako „Nábor 6 trenérů“ (fKeyword) nelze vytvořit.
- **Fix:** Přidat sloupce `filter_person_id` a `filter_keyword` do goals (drizzle migrace + sync-config + AppSchema), do GoalModal doplnit select osoby a input klíčového slova (jen pro metriky ≠ project), do goalTasks v Cile.tsx a goalRow v Reporty.tsx doplnit filtraci přes assignments a LIKE na name.

### [MAJOR] Cíle: chybí pole „Období“ (period, např. „Q3 2026“) — na kartě, v builderu i v detailu (grid Období/Termín/Uplynulo)
- **Evidence:** Prototyp: karta cíle ř. 761 `{{ g.period }}` vpravo dole (screenshot 09: „Q3 2026“, „2026“); builder ř. 1457 input Období; detail ř. 1352–1365 třísloupcový grid Období/Termín/Uplynulo. Kód: packages/db/src/schema/goals.ts — sloupec period neexistuje; Cile.tsx:313–315 karta místo období ukazuje fmtDue(due_date); GoalDetail (ř. 868–882) má jen MetaRow, grid chybí.
- **Fix:** Přidat `period` (varchar) do goals + builderu (input „Q3 2026“), na kartě zobrazit period v mono 11px vpravo dole, v detailu doplnit 3sloupcový grid Období / Termín / Uplynulo (bg panel-2, radius 10, mono 14px).

### [MAJOR] Detail cíle: chybí progress ring (76px SVG kruh s % uprostřed) vedle badge
- **Evidence:** Prototyp ř. 1301–1310 + ringNode ř. 2372: kruh r=30, strokeWidth 7, barva dle stavu (GSTAT), % uvnitř (font 17, weight 800), vedle badge + valueLabel. Kód: apps/web/src/screens/Cile.tsx:726–738 — jen řádek label/% + lineární bar, ring úplně chybí.
- **Fix:** Do GoalDetail přidat SVG ring (76×76, r=30, stroke 7, strokeDasharray/offset dle pct, rotate -90, barva GSTAT[st][3]) s procentem absolutně uprostřed, v řádku s badge a valueLabel dle ř. 1301–1310.

### [MAJOR] Periodická obnova cíle: jen popisek — chybí box „Obnovuje se…“ s akcí „Obnovit období“ a jakýkoli reset hodnot po konci období
- **Evidence:** Prototyp ř. 1367–1376: box s ikonou ↻, „Obnovuje se týdně/čtvrtletně… Po konci období se hodnota vynuluje a cíl běží dál“ + tlačítko „Obnovit období“ (resetGoalPeriod ř. 2346). Kód: apps/web/src/screens/Cile.tsx:879–881 — periodic je pouze MetaRow text; žádné reset tlačítko, žádné počítání od začátku běžícího období → count metrika akumuluje dokončené úkoly navždy.
- **Fix:** V GoalDetail přidat panel-2 box s ↻ ikonou, textem a tlačítkem „Obnovit období“; zavést `period_start` (obnova = posun period_start na dnešek) a metriky počítat jen z úkolů dokončených po period_start.

### [MINOR] Stepper cílové úrovně: obrácený krok a chybějící horní mez
- **Evidence:** Prototyp adjGoalTarget ř. 2352: `step=(metric==='count')?5:1`, `max=(count)?100000:100`. Kód: apps/web/src/screens/Cile.tsx:770 a 782 — `adjTarget(metric === "count" ? -1 : -5)` (count ±1, % ±5 = přesně naopak) a adjTarget (ř. 661–665) clampuje jen min 1, % cíl lze zvýšit nad 100. Layout stepperu je také jiný (22px tlačítka inline u metriky vs. 30px tlačítka + label „Cílová úroveň/Cílový počet“ na samostatném řádku, ř. 1331–1338).
- **Fix:** Otočit krok (count ±5, ostatní ±1), přidat clamp max (100 pro %, 100000 pro count) a přiblížit layout prototypu (30px tlačítka, hodnota min-width 58px uprostřed, uppercase label vlevo).

### [MINOR] Projekty header: tlačítko „Nový projekt“ má být plné brass s bílým textem; tečka prostoru má mít barvu prostoru
- **Evidence:** Prototyp ř. 696: `color:#fff; background:var(--brass)` (screenshot 07 — plné oranžové tlačítko); ř. 694 + CSS ř. 105: data-wsdot barví tečku dle prostoru (kancelar #c68a3e, klub #2a6fdb, personal #9a8f80). Kód: apps/web/src/screens/Projekty.tsx:143–144 — border brass + bg brass-soft + text brass-text (outline varianta); ř. 134 — tečka natvrdo `var(--w-brass)` (Reporty.tsx:205 přitom správně používá ws?.color).
- **Fix:** Tlačítko přepnout na `background: var(--w-brass); color:#fff` (hover brightness 1.06); tečku napojit na barvu aktivního prostoru jako v Reporty.tsx.

### [MINOR] Karta cíle: chipy napojených projektů bez pill stylu
- **Evidence:** Prototyp ř. 3200 linkNodes: pill s `background:var(--panel-2); border-radius:999px; padding:3px 9px; font-body 11.5px; color:var(--ink-3)` + 7px tečka. Kód: apps/web/src/screens/Cile.tsx:288–303 — holý inline-flex text (font-display semibold 10.5px) s tečkou, bez pozadí a paddingu.
- **Fix:** Chip obalit pill stylem: bg panel-2, radius 999, padding 3px 9px, font-body 11.5px ink-3.

### [MINOR] Reporty KPI „průměr / den“: dělí 7 dny místo 5 pracovních dnů
- **Evidence:** Prototyp ř. 833: KPI 26 hotovo / průměr 5,2 = 26/5 (reportWeek ř. 3184 má So+Ne = 0, průměr počítán z pracovních dnů). Kód: apps/web/src/screens/Reporty.tsx:130 — `avg: (weekDone / 7)` → u stejných dat by ukázal 3,7 místo 5,2.
- **Fix:** Dělit 5 (pracovní dny), příp. počtem dnů s nenulovou aktivitou: `(weekDone / 5).toFixed(1)`.

### [MINOR] Reporty / Lidé: řádek člena a member detail nezobrazují pracovní roli („Projektový manažer“…)
- **Evidence:** Prototyp ř. 883–888: karta člena = jméno + {{ p.role }} (screenshot 11: „Vedoucí provozu“, „Obchod“…); member detail ř. 1159–1161 = jméno + role + e-mail. Kód: apps/web/src/screens/Reporty.tsx:379–381 — pod jménem e-mail (role v DB neexistuje jako pracovní pozice); MemberDetail ř. 526–533 — jen jméno + e-mail. Chybí i sekundární „Zavřít“ tlačítko v patičce member detailu (prototyp ř. 1214–1215 má obě).
- **Fix:** Přidat volitelné pole job_title k členství/uživateli a zobrazit ho pod jménem (e-mail ponechat v detailu); do patičky MemberDetail doplnit sekundární „Zavřít“.

### [MINOR] Detail cíle: hlavička bez scope labelu, název není editovatelný, chybí sekce „Napojené projekty“ s progress bary
- **Evidence:** Prototyp ř. 1295: hlavička = uppercase scopeLabel („Týmový cíl“); ř. 1299: název jako editovatelný input (onGoalName); ř. 1384–1396: Napojené projekty s barevnou tečkou, % a 6px progress barem per projekt. Kód: apps/web/src/screens/Cile.tsx:705–719 hlavička = ikona + StatusBadge; ř. 722–724 název jako statické h2; ř. 870–877 projekty jen jako text v MetaRow bez barů.
- **Fix:** Hlavičku doplnit o scopeLabel dle g.scope, název přepnout na input s UPDATE goals SET name, přidat sekci Napojené projekty s per-projekt pct + progress barem (barva projektu).

### [MINOR] Detail projektu — vizuální odchylky: 4px barevný levý okraj navíc, název bez rámečku, staty jako karty
- **Evidence:** Prototyp ř. 1222 panel: `border-left:1px solid var(--line)`, šířka 420px; ř. 1231 název = input s rámečkem (border line, bg panel-2, radius 9, padding 9px 11px, font 16/700 — screenshot 08); ř. 1259–1262 staty = holá čísla (mono 22px) nad popiskem, oddělené jen horní linkou. Kód: apps/web/src/components/ProjectDetailPanel.tsx:110 — `borderLeft: 4px solid ${dot}` (v prototypu není); ř. 128–135 název = borderless transparent input; ř. 335–346 staty v bg-panel-2 kartách se zaoblením.
- **Fix:** Odstranit 4px barevný okraj (nechat 1px line), název stylovat jako bordered input dle ř. 1231, staty vykreslit jako tři holá čísla (ink/success-ink/ink-2) s horním borderem.

### [MINOR] GSTAT labely stavů cíle natvrdo česky — v EN režimu zůstanou „Splněno/Na cestě/Ohrožený/Po termínu“
- **Evidence:** Kód: apps/web/src/lib/goals.ts:125–130 — GSTAT obsahuje české labely přímo v konstantě; Cile.tsx:347–358 (StatusBadge) a karty je renderují bez t(). Zbytek modulu jede přes @watson/i18n (rozhodnutí uživatele č. 3: jazyk CS/EN v Nastavení).
- **Fix:** Labely přesunout do cs.json/en.json (goals.stDone/stTrack/stRisk/stOver) a v GSTAT nechat jen klíče + barvy; StatusBadge překládat přes t().
