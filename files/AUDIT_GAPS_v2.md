# AUDIT GAPS v2 — poctivé porovnání prototyp vs. implementace

**Datum:** 2026-07-02. Nahrazuje závěr AUDIT_FINAL (~95 % byl chybný — self-audit bez porovnání
prvek-po-prvku; uživatel odmítl). Metodika: 10 modulových adversariálních auditů + kritik úplnosti.
**Celkový poctivý odhad: ~46 %.** Postup uzavírání mezer: per modul,
critical → major → minor, každý fix živě ověřit + odškrtnout zde.

| Modul | % | critical | major | minor |
|---|---|---|---|---|
| Přidat úkol (modal + quick add + parser UI) | 28 % | 5 | 8 | 7 |
| Anatomie řádku úkolu (TaskCard/TaskItem — Dnes/Úkoly/Nadcházející/projekt) | 32 % | 11 | 7 | 5 |
| Obrazovky Dnes + Úkoly + Nadcházející (struktura obrazovek) | 48 % | 5 | 12 | 6 |
| Kalendář (den/týden/měsíc) | 40 % | 9 | 10 | 5 |
| Detail úkolu + detail výskytu (screenshots 15, 16) | 30 % | 6 | 6 | 8 |
| Projekty + detail projektu | 58 % | 2 | 7 | 9 |
| Cíle + Reporty | 63 % | 6 | 9 | 6 |
| Postupy (štafetová workflow) — screens 12-postupy, 13-postup-detail, 14-postup-builder + integrace (flow chip, Dnes strip, add-task) | 55 % | 8 | 9 | 7 |
| Nastavení + tmavý režim | 70 % | 1 | 5 | 6 |
| App shell — sidebar + header + Watson panel + Schránka/Hledat | 70 % | 2 | 6 | 9 |
| completeness-critic | 46 % | 2 | 3 | 3 |


## Přidat úkol (modal + quick add + parser UI) — 28 %

### [CRITICAL] Chybí celá interaktivní řada chipů (Projekt / Termín / Priorita / Přiřadit / Více)
- **Prototyp:** WatsonApp.dc.html ř. 1707–1726: `<div style="display:flex; flex-wrap:wrap; gap:7px; margin-top:15px;"> <sc-for list="{{ draft.addFields }}" as="f"> <span onClick="{{ f.onClick }}" data-addpill data-on="{{ f.on }}" style="…gap:6px; font-family:var(--w-font-display); font-weight:600; font-size:12.5px; padding:6px 11px; border-radius:9px; border:1px solid var(--line); color:var(--ink-2); cursor:pointer;" style-hover="border-color:var(--brass)">` + tečka projektu `f.dot` 8px / ikona `f.icon` (wIcon 16). Definice ř. 2966–2971: `addFields=[mkF('projekt','Projekt','projekt', sel.name, true, sel.id), mkF('termin','Termín','termin', hasTermC?termLbl:null, hasTermC), mkF('priorita','Priorita','priorita','P'+d.priority, d.priority!==2), mkF('prirazeni','Přiřadit','prirazeni', peopleVal, npc>0)]` — chip zobrazuje hodnotu (`disp:value||label`, termLbl např. „Zítra · 09:00 · 4 dní", ř. 2962) a kliknutím otevírá popover (`onClick:this.setAddPop(key)`, ř. 1955). Aktivní stav CSS ř. 150–151: `[data-addpill][data-on="true"]{ background:var(--brass-soft); border-color:var(--brass) !important; color:var(--brass-text) !important; }`. Toggle „Více/Méně" ř. 1725: dashed border `border:1px dashed var(--line)`, label `{{ draft.moreLabel }}`. Viz screenshot 17 — chipy „Q3 plánování · Dnes · P2 · Přiřadit · Více" jsou viditelné VŽDY (i s prázdným polem).
- **Stav app:** QuickAdd.tsx:152–164 + 228–237 — jen read-only <Chip tone="brass"> pilulky, které se objeví AŽ když parser něco rozpozná; nejsou klikací, nemají default stav (Projekt/Dnes/P2/Přiřadit), nemají popover, Chip je rounded-full text-xs (prototyp radius 9px, 12.5px font-display 600). „Více" toggle neexistuje.
- **Fix:** QuickAdd.tsx: přidat stav draftu (project, dateKind+customDate+time+days, priority, assignees, pop, more…) po vzoru freshDraft (ř. 1920) mergovaný s výstupem parseru; vyrenderovat řadu `addFields` jako <button data-on> s přesným CSS (padding 6px 11px, radius 9px, font-display 600 12.5px, brass-soft aktivní) + tečkou projektu (barva z lib/colors.ts) a ikonami z packages/ui Icon (projekt/termin/priorita/prirazeni). Kliknutí přepíná aktivní popover.

### [CRITICAL] Chybí rozšířená řada „Více" (Trvání, Deadline, Opakování, Barva, Příloha, Postup, Méně)
- **Prototyp:** WatsonApp.dc.html ř. 1716–1724 (`sc-if draft.addMore` → `draft.addFieldsMore`), definice ř. 2972–2979: `mkF('trvani',…, d.duration?this.durFmt(d.duration):null), mkF('deadline',…, d.deadline?this.deadlineFmt(d.deadline).replace('do ','') : null), mkF('opakovani',…, d.repeatLabel || repLbl), mkF('barva',…,'Moje barva', on, sw:d.color) , mkF('priloha',…, count+'×'); if(hasFlowsC) addFieldsMore.push(mkF('postup','Postup',…, d.flowAttach?'Přidáno':null))` — chip Barva ukazuje čtvereček `data-sw` 11×11 radius 3 (CSS ř. 64). `moreLabel:(d.more?'Méně':'Více')` ř. 3001. Viz screenshot 18 — druhá řada „1 h 30 min · Deadline · Každou středu · Barva" + třetí „Příloha · Postup · Méně".
- **Stav app:** Neexistuje nic — QuickAdd.tsx nemá žádný „Více" režim ani chipy trvání/deadline/opakování/barva/příloha/postup jako ovládací prvky.
- **Fix:** QuickAdd.tsx: stav `more:boolean`; druhé pole chipů dle mkF logiky (hodnota → disp, on stav). Postup chip podmíněně dle existence chains (lib/chainAdvance.ts / tabulka chains). durFmt přepsat na „1 h 30 min" formát (viz samostatná mezera).

### [CRITICAL] Chybí všech 10 popoverů chipů (projekt, termín+kalendář, priorita, přiřazení, trvání, deadline, opakování, barva, příloha, postup)
- **Prototyp:** WatsonApp.dc.html ř. 1728–1879, kontejner ř. 1729: `<div style="margin-top:12px; border:1px solid var(--line); border-radius:12px; background:var(--panel-2); padding:12px 13px;">`. (a) Projekt ř. 1730–1744: search input „Hledat projekt…" + lupa SVG + list s tečkou, checkmark u vybraného, `[data-rowsel][data-on=true]{background:var(--brass-soft)}` (CSS ř. 99). (b) Termín ř. 1746–1770: dateChips `[['dnes','Dnes'],['zitra','Zítra'],['pristi','Příští týden'],['pmonth','Začátkem příštího měsíce'],['none','Bez termínu']]` se sub-datem mono 9.5px (ř. 2947–2948), `<input type=date>` + `<input type=time>` (ř. 1755, 1759), stepper „Více dní" −/+ 1–60 (ř. 1762–1768) + label `multiKind` „celodenní/s časy". (c) Priorita ř. 1773–1779: 4 chipy P1–P4 padding 7px 18px. (d) Přiřazení ř. 1781–1794: avatary 30px `[data-person]{opacity:.5}` → on `box-shadow:0 0 0 2px var(--panel),0 0 0 4px var(--brass)` (CSS ř. 97–98), režim „Stačí kdokoli / Každý zvlášť" při n≥2 + `assignHint` texty (ř. 2992). (e) Trvání ř. 1796–1806: chipy `[[0,'—'],[15,'15 min'],[30,'30 min'],[60,'1 h'],[120,'2 h']]` + ruční input min. (f) Deadline ř. 1808–1815: date input s vlaječkou (overdue barva) + label `deadlineFmt`. (g) Opakování ř. 1817–1852: banner „Z TEXTU" s repeatLabel + ✕ (brass-soft, ř. 1819–1823), chipy Neopakovat/Denně/Týdně/Po 14 dnech/Měsíčně, sekce „KONEC OPAKOVÁNÍ" Nikdy/K datu(+date)/Po počtu(+number „výskytů") a „V KALENDÁŘI" Všechny výskyty/Jen příští + hint (ř. 1849). (h) Barva ř. 1854–1862: „vidíš ji jen ty" + 10 swatchů 24px `data-csel` + přeškrtnutý none. (i) Příloha ř. 1864–1871: chipy souborů s ✕ + „+ Přidat přílohu". (j) Postup ř. 1873–1876: <select> běžících postupů + hint „Přidá se jako další krok řetězce…".
- **Stav app:** Neexistuje žádný popover — QuickAdd.tsx nemá žádné UI pro ruční nastavení termínu/priority/přiřazení/trvání/deadline/opakování/barvy/přílohy/postupu. Vše jde jen přes text parseru.
- **Fix:** QuickAdd.tsx (příp. nový components/AddTaskPopovers.tsx): jeden panel pod řadou chipů (`anyPop` — vždy max 1 otevřený, ne floating popover!) s přesným markup dle ř. 1728–1879. Data: projekty z useProjects, lidé z workspace members, chains z PowerSync. Chip stavy `data-chip[data-on]` = brass-soft (CSS ř. 88–89).

### [CRITICAL] Chybí footer: nápověda parseru / varování „Úkol potřebuje název" + tlačítka Zrušit a Přidat úkol
- **Prototyp:** WatsonApp.dc.html ř. 1881–1886: `<div style="display:flex; align-items:center; gap:9px; margin-top:18px; padding-top:14px; border-top:1px solid var(--line);">` — (1) při `needsName` (prázdný název, ale rozpoznaná pole; ř. 2983) varování s trojúhelníkem: „Úkol potřebuje název — napiš, co se má udělat. Datum a opakování zůstanou nastavené." barvou --overdue (ř. 1882); (2) jinak hint 11.5px ink-3: „Do názvu napiš <b>#projekt</b> · <b>p1–p4</b> · <b>14:00</b> · <b>3. 7. 2027</b> · <b>!5. 7.</b> (deadline) · <b>@jméno</b> — samo se to roztřídí do polí." (ř. 1883); (3) `<button>Zrušit</button>` panel-2 + border (ř. 1884); (4) `<button data-dis="{{ draft.cantSubmit }}">Přidat úkol</button>` brass, disabled `[data-dis=true]{opacity:.4; pointer-events:none}` (ř. 1885, CSS ř. 96). Viz screenshot 17 (disabled šedé „Přidat úkol") a 18 (aktivní brass).
- **Stav app:** QuickAdd.tsx:200–203 — jediné tlačítko „+ Přidat" vpravo VEDLE inputu (ne ve footeru), žádný Zrušit, žádný hint, žádné varování needsName, žádný oddělovač border-top.
- **Fix:** QuickAdd.tsx: přesunout submit do footeru s border-top, přidat Zrušit (onDone/onClose), hint text s <b> tokeny (i18n cs.json), needsName variantu, disabled stav vizuálně opacity .4 (text „Přidat úkol", ne „Přidat").

### [CRITICAL] @jméno našeptávač je v modalu mrtvý a přiřazení osob se vůbec neukládá
- **Prototyp:** WatsonApp.dc.html ř. 2393: `if(mPer){ const list=this.PEOPLE.filter(p=>p.name.toLowerCase().includes(q)||p.initials.toLowerCase().startsWith(q)).slice(0,5).map(p=>({…action:'přiřadit ↵', onClick:this.pickSuggest(p.id, mPer[0])}))…}`; ř. 2401 `pickSuggest`: odstraní token z rawName, přeparsuje a `assignees:d.assignees.concat(pid)`; submit ř. 2454–2456+2467: `people=d.assignees.slice(); mode=people.length>=2?d.assignMode:'any'; …if(mode==='all'){task.aTotal=people.length;…}`.
- **Stav app:** AddTaskModal.tsx:48–53 — QuickAdd volán BEZ prop `people` (default []), takže @/+ našeptávač se v modalu nikdy neukáže; QuickAdd.tsx:81–87 applySug jen vloží text „@Jméno " zpět do inputu (osobu nepřiřadí, token zůstane v názvu jako personQuery pilulka); submit (ř. 100–115) INSERT do tasks bez jakéhokoli zápisu do tabulky `assignments` (AppSchema.ts:86) ani `assignment_mode`.
- **Fix:** AddTaskModal.tsx: načíst členy workspace (lib/workspace.tsx / project_members) a předat `people`. QuickAdd.tsx: pickSuggest po vzoru prototypu — odstranit token, přidat do `assignees` stavu; submit: INSERT řádků do `assignments` (task_id, project_id, user_id) + `assignment_mode` ('any'/'all').

### [MAJOR] Výběr projektu z našeptávače nefunguje pro víceslovné/číselné názvy
- **Prototyp:** WatsonApp.dc.html ř. 2394: suggest položka volá `pickProject(p.id, mProj[0])`; ř. 2402 `pickProject`: odstraní token z textu a nastaví `project:pid` PŘÍMO (žádné re-parsování názvu) — funguje pro „Q3 plánování", „Provoz kanceláře" atd. Akce v listu: `action:'projekt ↵'`.
- **Stav app:** QuickAdd.tsx:81–87 — applySug vloží do textu „#Q3 plánování "; parse.ts:181–187 pak matchuje jen `/#(\p{L}+)/u` (jedno slovo, bez číslic) a hledá EXACT shodu názvu → `#Q3` nenajde „Q3 plánování", projectId zůstane null a úkol spadne do inboxu. Token navíc zůstává v názvu.
- **Fix:** QuickAdd.tsx: držet `projectId` ve stavu draftu; applySug pro kind='proj' odstranit token z raw (bez vložení názvu) a setnout projectId — přesně jako pickProject prototypu. Parser nechat jen pro exact-match jednoslabičných tokenů.

### [MAJOR] Titulek úkolu: má být velký bezrámečkový autosize textarea (17px display bold) s tečkou projektu; místo toho malý input + hlavička s X, která v prototypu není
- **Prototyp:** WatsonApp.dc.html ř. 1677–1682: `<span data-proj="{{ draft.proj }}" style="width:9px; height:9px; border-radius:50%; margin-top:7px;"></span>` + `<textarea rows=1 placeholder="Název úkolu — např. report zítra v 14:00 každou středu #Obchod @Tomáš p1" style="…min-height:25px; field-sizing:content; border:none; background:transparent; outline:none; resize:none; font-family:var(--w-font-display); font-weight:700; font-size:17px; line-height:1.45; white-space:pre-wrap;">` s overlay divem stejné typografie (ř. 1680). Modal NEMÁ žádný hlavičkový řádek s názvem „Přidat úkol" ani zavírací křížek — začíná rovnou titulkem (screenshot 17).
- **Stav app:** AddTaskModal.tsx:34–47 — vlastní hlavička (ikona pridat + „Přidat úkol" 15px + kulaté X tlačítko), v prototypu neexistuje. QuickAdd.tsx:191–198 — jednořádkový <input> text-sm (14px) font-body s border border-line a paddingem; overlay (ř. 171–190) rovněž text-sm font-body. Placeholder jiný: cs.json:36 „Přidat úkol… (např. zavolat Petře zítra v 15 p1 #Obchod)". Tečka projektu před titulkem chybí.
- **Fix:** AddTaskModal.tsx: smazat hlavičku. QuickAdd.tsx: nahradit input za <textarea rows=1> bez borderu, font-display 700 17px lh 1.45 + auto-výška (field-sizing:content / JS), overlay se stejnou typografií a `white-space:pre-wrap`, před něj 9px tečku s barvou vybraného projektu; placeholder přesně dle ř. 1681 (aktualizovat cs.json).

### [MAJOR] Chybí „+ Přidat popis" a pole popisu
- **Prototyp:** WatsonApp.dc.html ř. 1700–1705: zavřený stav `<span onClick="{{ draft.toggleDescOpen }}" style="…font-size:12px; color:var(--ink-3); cursor:pointer; margin-top:6px; margin-left:19px;" style-hover="color:var(--brass-text)">+ Přidat popis</span>`; otevřený `<input placeholder="Popis (nepovinné)" style="…border:none; background:transparent; font-size:13.5px; color:var(--ink-2); margin-top:6px;"/>` (draftDesc ř. 2409). Submit ukládá `desc` (ř. 2456).
- **Stav app:** Nic — QuickAdd.tsx nemá popis; INSERT (ř. 100–115) nezapisuje `description`, ačkoli sloupec v AppSchema.ts:14 existuje.
- **Fix:** QuickAdd.tsx: stav descOpen/desc, link „+ Přidat popis" (margin-left 19px = zarovnání pod textarea za tečkou), bezrámečkový input, přidat `description` do INSERT.

### [MAJOR] Neukládá se konec opakování ani volba „Všechny výskyty / Jen příští"
- **Prototyp:** WatsonApp.dc.html ř. 1830–1851 (UI Konec opakování + V kalendáři) a submit ř. 2464: `task.repeatEndKind=d.repeatEndKind||'never'; if(…'until')task.repeatUntil=…; if(…'count')task.repeatCount=…; task.repeatShowAll=d.repeatShowAll!==false;` — dle README §Opakování je konec řady součást modelu R4.
- **Stav app:** QuickAdd.tsx:110–112 — INSERT ukládá jen recurrence (label), recurrence_rule (JSON), recurrence_basis; žádné end-kind/until/count/show_all UI ani hodnoty. AppSchema.ts tasks nemá odpovídající sloupce.
- **Fix:** Rozšířit recurrence_rule JSON o `{endKind, until, count, showAll}` (bez migrace schématu) nebo přidat sloupce; UI v popoveru opakování dle ř. 1830–1851; lib/occurrences.ts naučit konec řady respektovat.

### [MAJOR] Vícedenní úkol („4 dny") se rozparsuje, ale při uložení zahodí
- **Prototyp:** WatsonApp.dc.html ř. 2466: `if(days>1){ task.days=days; …if(task.iso){ const _e=this._d(task.iso); _e.setDate(_e.getDate()+days-1); task.isoEnd=this._isoOf(_e); } …dueLabel=days+' dní'}` + stepper „Více dní" v popoveru termínu (ř. 1762–1768).
- **Stav app:** parse.ts:120–124 vrací `days`, QuickAdd.tsx:159 z něj udělá jen pilulku; INSERT (ř. 100–115) days/end date vůbec nezapisuje — sloupec pro konec rozsahu v AppSchema.ts tasks chybí.
- **Fix:** Přidat sloupec `end_date` (tasks) do AppSchema + sync-config (pozor na PowerSync reload gotchu) a zapisovat `due_date + days-1`; UI stepper v popoveru termínu.

### [MAJOR] Chybí výchozí hodnoty konceptu: termín „Dnes", priorita P2, výchozí projekt
- **Prototyp:** WatsonApp.dc.html ř. 1920 freshDraft: `{ …project:'q3', priority:2, …dateKind:'dnes', … }` — nový úkol má od otevření modalu předvybraný projekt (chip s tečkou), termín Dnes (chip aktivní brass, screenshot 17) a P2; termISO ř. 2079 mapuje dnes→dnešní ISO. „Bez termínu" je explicitní volba (dateChips `none` → inbox, resolveDate ř. 2432).
- **Stav app:** QuickAdd.tsx:89–115 — bez rozpoznaného data se uloží `due_date: null` (úkol padá do Schránky) a project vždy `inboxId` (projects[0]); priorita default 2 jen fallbackem v INSERT.
- **Fix:** Draft stav inicializovat `{dateKind:'dnes', priority:2, project:<první oblíbený/poslední použitý>}`; „Bez termínu" jako vědomá volba v popoveru termínu (→ due_date null/inbox).

### [MAJOR] Chybí validace deadline ≥ termín s chybovou hláškou a blokací submitu
- **Prototyp:** WatsonApp.dc.html ř. 2949: `deadlineBad = !!(d.deadline && tISO && d.deadline < tISO)`; ř. 1814: `<div style="…color:var(--overdue);">Deadline musí být v termínu řešení nebo po něm ({{ draft.termHint }}).</div>`; ř. 2985: `cantSubmit:(d.name…)===0 || !!(d.deadline && … < termISO)`.
- **Stav app:** QuickAdd.tsx — žádná validace; „report zítra !25. 6." (deadline před termínem) se v klidu uloží. Disabled jen na prázdný název (ř. 200).
- **Fix:** V QuickAdd spočítat deadlineBad z parsed.deadline vs parsed.due (nebo draft), zobrazit hlášku v popoveru deadline i blokovat submit.

### [MAJOR] Našeptávač: špatný vizuál i chování (brass rámeček, avatary/tečky, akční text „projekt ↵", aktivní řádek s brass proužkem)
- **Prototyp:** WatsonApp.dc.html ř. 1684–1699: kontejner `margin-top:7px; border:1px solid var(--brass); border-radius:10px; background:var(--panel-2)` (in-flow pod titulkem, ne absolute); řádek: tečka projektu 18px `data-proj` NEBO avatar `data-av=navy` 24px s iniciálami; jméno font-display 600 13px; vpravo `<span style="font-size:11px; color:var(--brass-text);">{{ p.action }}</span>` („projekt ↵"/„přiřadit ↵"); aktivní `data-sgrow=true` CSS ř. 69: `background:var(--panel); box-shadow:inset 2px 0 0 var(--brass)`. Filtr projektů jen v aktivním workspace (`inWS`, ř. 2394), lidé i dle iniciál.
- **Stav app:** QuickAdd.tsx:207–225 — absolute dropdown w-72, border-line (ne brass), generické ikony Icon projekt/prirazeni (ne barevná tečka/avatar), žádný akční text, aktivní řádek jen bg-panel-2. Bez filtru na workspace.
- **Fix:** Přestylovat dle ř. 1684–1699 (in-flow blok, brass border, tečka s barvou projektu z lib/colors.ts, navy avatar s iniciálami, akční labely, inset brass proužek u aktivního), projekty filtrovat aktivním prostorem (lib/workspace.tsx).

### [MINOR] Kontejner modalu: rozměry, backdrop, animace a pozice neodpovídají
- **Prototyp:** WatsonApp.dc.html ř. 1675–1676: backdrop `background:rgba(10,14,20,.42)` + `align-items:flex-start; padding-top:12vh`; panel `width:520px; max-width:94vw; max-height:86vh; overflow:auto; border-radius:16px; box-shadow:var(--shadow); animation:wPop .18s ease; padding:18px;`; CSS ř. 44 `@keyframes wPop{from{transform:scale(.97);opacity:0}…}`.
- **Stav app:** AddTaskModal.tsx:27–33 — backdrop rgba(10,14,20,.34), panel max-w-xl (576px), p-4 (16px), top:96px fix, bez animace, bez max-height/overflow.
- **Fix:** AddTaskModal.tsx: 520px, padding 18px, top 12vh, backdrop .42, keyframes wPop do index.css.

### [MINOR] Esc s otevřeným našeptávačem zavře celý modal místo jen našeptávače
- **Prototyp:** WatsonApp.dc.html ř. 2400: `else if(e.key==='Escape'){ e.preventDefault(); this.patchDraft({ suggest:null }); }` — Esc nejdřív zavře našeptávač; kaskáda Esc (ř. 2213) zavírá modal až samostatným stiskem.
- **Stav app:** AddTaskModal.tsx:13–19 — window keydown Escape volá onClose vždy; QuickAdd.tsx:138–141 sice suggest odbourá (hackem `setRaw(raw+" ")`), ale modal se stejně zavře současně.
- **Fix:** QuickAdd onKey: při sug volat e.stopPropagation() + čistě zrušit suggest (separátní stav `sugDismissed`, ne mutace textu); AddTaskModal poslouchat až nebublané události.

### [MINOR] Formát trvání „1.5 h" místo „1 h 30 min"
- **Prototyp:** WatsonApp.dc.html ř. 2080: `durFmt(min){ if(min<60) return min+' min'; const h=Math.floor(min/60), m=min%60; return h+' h'+(m?' '+m+' min':''); }` — screenshot 18 ukazuje chip „1 h 30 min".
- **Stav app:** QuickAdd.tsx:14: `durLabel = (min) => (min < 60 ? `${min} min` : `${min / 60} h`)` → 90 min = „1.5 h".
- **Fix:** Nahradit durLabel implementací durFmt (h + zbytkové minuty).

### [MINOR] Pilulky rozpoznaných hodnot zobrazují surové ISO datum a nejsou v české podobě
- **Prototyp:** WatsonApp.dc.html ř. 2962 termLbl: „Dnes/Zítra/Příští týden" nebo formát z deadlineFmt (ř. 2078 `'do '+da+'. '+m+'.'+(y!==2026?(' '+y):'')`), čas se přidává „ · 14:00", dny „ · 4 dní"; deadline chip `deadlineFmt(d.deadline).replace('do ','')` → „5. 7.".
- **Stav app:** QuickAdd.tsx:154 `pills.push({icon:'termin', label: parsed.due})` → zobrazí „2026-07-03"; ř. 158 deadline `do ${parsed.deadline}` → „do 2026-07-05".
- **Fix:** Formátovací helper (deadlineFmt/termLbl ekvivalent) v lib/quickadd nebo QuickAdd; hodnoty slučovat do jednoho chipu Termín („Zítra · 09:00") místo tří samostatných pilulek — do doby, než je nahradí plnohodnotná řada chipů (mezera #1).

### [MINOR] Kalendář/board neumí předvyplnit datum a čas nového úkolu (openAddAt)
- **Prototyp:** WatsonApp.dc.html ř. 2664: `openAddAt=(date,min)=>{const dd=this.freshDraft(); dd.dateKind='custom'; dd.customDate=…; dd.time=this.fmt(…round(min/15)*15…); this.setState({addOpen:true, addDraft:dd});}`; ř. 2665 addAllDayAt; ř. 2669 drag-create předá i duration `dd.duration=c.end-c.start`.
- **Stav app:** lib/addTask.tsx:5–17 — `openAdd: () => void` bez parametrů; Calendar.tsx nemá klik-to-add s prefillem.
- **Fix:** Rozšířit AddTaskCtx na `openAdd(prefill?: {date?: string; time?: string; duration?: number})`, AddTaskModal/QuickAdd přijme initialDraft; napojit v Calendar.tsx (klik na slot / drag-create).

### [MINOR] Uložení času bez trvání nevytvoří výchozí 30min blok
- **Prototyp:** WatsonApp.dc.html ř. 2462: `if(tmin!=null){ task.start=tmin; task.end=Math.min(this.DAY_END, tmin+(d.duration||30)); }` — úkol s časem bez trvání dostane 30 min (jinak by v kalendářní mřížce neměl výšku).
- **Stav app:** QuickAdd.tsx:93–99,109 — ukládá start_date s časem, ale duration_min zůstane null, pokud nebyla v textu → blok v kalendáři bez definované délky.
- **Fix:** Při startMin!=null a durationMin==null ukládat duration_min:30 (nebo řešit default v kalendářním renderu — zvolit jedno, konzistentně s prototypem).

### [MINOR] Zvýraznění tokenů: drobně jiný radius (a po opravě typografie ověřit zarovnání overlay)
- **Prototyp:** CSS ř. 68: `[data-nmark="true"]{ background:var(--brass-soft); border-radius:5px; box-shadow:0 0 0 2px var(--brass-soft); }` na overlay se stejným fontem jako textarea (17px display 700, pre-wrap).
- **Stav app:** QuickAdd.tsx:176–189 — rounded-[4px], brass-soft + box-shadow OK; overlay je ale text-sm font-body whitespace-pre nad 14px inputem — po přechodu na 17px textarea (mezera #7) nutno přepsat na pre-wrap/break-word se shodnou typografií, jinak se zvýraznění rozjede.
- **Fix:** radius 5px; overlay div zrcadlit přesně styl textarey (font, line-height 1.45, white-space:pre-wrap, word-break:break-word).


## Anatomie řádku úkolu (TaskCard/TaskItem — Dnes/Úkoly/Nadcházející/projekt) — 32 %

### [CRITICAL] Avatary přiřazených (1–3 kruhy s iniciálami) na pravém konci řádku
- **Prototyp:** WatsonApp.dc.html ř. 441–443 (assignAny): `<span data-avg style="display:inline-flex; align-items:center; flex:none;"><sc-for list="{{ t.avatars }}" as="a"><span style="width:22px; height:22px; border-radius:50%; color:#fff; font-family:var(--w-font-display); font-weight:600; font-size:10px; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 2px var(--panel);" data-av="{{ a.role }}">{{ a.initials }}</span></sc-for></span>`; ř. 2904: `avatars = (t.people||[]).slice(0,3).map((pid,i)=>({ initials:…, role:(t.assignMode==='all'&&i===0)?'brass':'navy' }))`; ř. 79: `[data-av="navy"]{ background:var(--avatar-navy); } [data-av="brass"]{ background:var(--brass); }`. Viditelné na 01-dnes.png (MB/JD/AK) i 02/03 — KAŽDÝ řádek má avatar.
- **Stav app:** packages/ui/src/TaskCard.tsx — žádný `avatars` prop, nic se nerenderuje. Avatar/AvatarGroup existují (packages/ui/src/Avatar.tsx) ale v řádku se nepoužívají. Data jsou: tabulka assignments (AppSchema.ts:86) + members endpoint (TaskDetailPanel.tsx:105).
- **Fix:** TaskCard.tsx: přidat prop `avatars?: { initials: string; brass?: boolean }[]` a renderovat jako poslední pravý prvek (22px kruhy, ring 2px var(--w-card), max 3). Nový hook apps/web/src/lib/useTaskAssignees.ts: 1 dotaz `SELECT task_id, user_id, completed_at FROM assignments` + cache jmen členů workspace (fetch members jako v TaskDetailPanel) → Map<taskId, {initials, done}[]>. Předat v TaskItem.tsx a Today.tsx card().

### [CRITICAL] Pilulka „Každý zvlášť · N/M“ pro assignment_mode=shared_all
- **Prototyp:** WatsonApp.dc.html ř. 435–440: `<sc-if value="{{ t.assignAll }}"><span style="display:flex; align-items:center; gap:6px; flex:none;"><span style="font-family:var(--w-font-display); font-weight:600; font-size:11px; padding:3px 9px; border-radius:999px; background:var(--panel-2); color:var(--ink-2);">Každý zvlášť · <span style="font-family:var(--w-font-mono);">{{ t.allLabel }}</span></span> [avatary] </span></sc-if>`; ř. 2917: `allLabel:(t.aDone||0)+'/'+t.aTotal`; první avatar má roli brass (ř. 2904). Vidět na 02-nadchazejici.png („Každý zvlášť · 2/4“) a 03-ukoly.png („Každý zvlášť · 0/3“).
- **Stav app:** Neexistuje. TaskCard.tsx nemá assignment prop; tasks.assignment_mode (AppSchema.ts:23) i assignments.completed_at (ř. 90) jsou v klientském schématu, jen se nečtou do řádku.
- **Fix:** TaskCard.tsx: prop `assignAll?: { done: number; total: number }` → pilulka panel-2/ink-2 11px s mono N/M + avatary (první brass). Počty z useTaskAssignees (completed_at != null = done). Předat z TaskItem/Today když task.assignment_mode === 'shared_all'.

### [CRITICAL] Časový rozsah „09:00–10:30“ (mono) místo/vedle textového termínu
- **Prototyp:** WatsonApp.dc.html ř. 2902–2903: `const timeLabel = t.start!=null ? this.fmt(t.start)+'–'+this.fmt(t.end) : ''; const dueLabel = t.dueLabel || timeLabel;` (fmt ř. 2247 = HH:MM); render ř. 431: `<span style="font-family:var(--w-font-mono); font-size:12px; flex:none;" data-due="{{ t.dueAttr }}">{{ t.dueLabel }}</span>`. Screenshoty 02/03: „09:00–10:30“, „14:00–15:00“, „14:30–16:00“ na většině dnešních řádků.
- **Stav app:** apps/web/src/lib/tasks.ts dueLabel() (ř. 36–47) vrací jen slovní datum; čas/rozsah nikde. tasks mají due_date (text ISO vč. času), start_date, duration_min (AppSchema.ts:18–21).
- **Fix:** lib/tasks.ts: rozšířit dueLabel — pokud due_date obsahuje čas (nebo start_date+duration_min), pro dnešek vrátit `HH:MM–HH:MM` (konec = start + duration_min), pro jiné dny `zítra · 13:00`. TaskCard beze změny (mono slot už existuje).

### [CRITICAL] Deadline vlaječka „⚑ do pá 27. 6.“ (červená pilulka)
- **Prototyp:** WatsonApp.dc.html ř. 432: `<sc-if value="{{ t.hasDeadline }}"><span style="display:inline-flex; align-items:center; gap:3px; font-family:var(--w-font-mono); font-size:11px; flex:none; color:var(--overdue); background:var(--overdue-soft); padding:2px 7px; border-radius:999px;"><svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5 V10.5 M3 2 H9 L7.4 4 L9 6 H3" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>{{ t.deadlineLabel }}</span></sc-if>`; formát ř. 2078: `deadlineFmt(iso){ … return 'do '+da+'. '+m+'.'+(y!==2026?(' '+y):''); }`; seed ř. 2158 `deadlineLabel:'do pá 27. 6.'`. Na 02-nadchazejici.png dvakrát („⚑ do pá 27. 6.“, „⚑ do 30. 6.“).
- **Stav app:** TaskCard.tsx nemá deadline prop; sloupec tasks.deadline v klientu existuje (AppSchema.ts:20), v řádku se nikdy nezobrazí.
- **Fix:** TaskCard.tsx: prop `deadline?: string` → pilulka overdue/overdue-soft, mono 11px, padding 2px 7px + flag SVG (path výše). lib/tasks.ts: helper deadlineLabel(iso) = `do {den?} d. m.`. Předat z TaskItem/Today (task.deadline).

### [CRITICAL] Ikona checklistu + počet „⚏ 2/5“ v podřádku
- **Prototyp:** WatsonApp.dc.html ř. 425: `<sc-if value="{{ t.hasSub }}"><span style="display:inline-flex; align-items:center; gap:3px; font-family:var(--w-font-mono); font-size:11px; color:var(--ink-3);"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 3 H9.5 M2.5 6 H9.5 M2.5 9 H6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>{{ t.subLabel }}</span></sc-if>`; ř. 2913: `hasSub: t.subTotal>0, subLabel:(t.subDone||0)+'/'+t.subTotal`. Na 01-dnes.png „⚏ 0/3“, 02 „⚏ 2/5“, 03 „⚏ 0/4“.
- **Stav app:** Nic. checklist_items tabulka existuje (AppSchema.ts:97, sloupce checked/position), ale řádek počty nečte.
- **Fix:** Hook useRowMeta (1 agregační dotaz: `SELECT task_id, COUNT(*) total, SUM(checked) done FROM checklist_items GROUP BY task_id`) → TaskCard prop `checklist?: {done,total}` → span s SVG výše v podřádku.

### [CRITICAL] Ikona komentářů + počet „💬 1“ v podřádku
- **Prototyp:** WatsonApp.dc.html ř. 428: `<sc-if value="{{ t.hasComments }}"><span style="display:inline-flex; align-items:center; gap:3px; font-family:var(--w-font-mono); font-size:11px; color:var(--ink-3);"><svg width="11" height="11" viewBox="0 0 12 12"><rect x="1.3" y="2" width="9.4" height="6.4" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M4 8.4 L4 10 L6 8.4" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>{{ t.comments }}</span></sc-if>`; ř. 2912: `hasComments: t.comments>0`. Na 01-dnes.png „💬 2“, 02/03 „💬 1“.
- **Stav app:** Nic. comments tabulka existuje (AppSchema.ts:109), počty se v řádku nezobrazují.
- **Fix:** Do useRowMeta přidat `SELECT task_id, COUNT(*) FROM comments GROUP BY task_id`; TaskCard prop `comments?: number` → span s bublinou v podřádku.

### [CRITICAL] Zvoneček připomínky v podřádku
- **Prototyp:** WatsonApp.dc.html ř. 427: `<sc-if value="{{ t.reminder }}"><svg width="11" height="11" viewBox="0 0 12 12" style="color:var(--ink-3);"><path d="M3 9 V5.6 a3 3 0 0 1 6 0 V9" stroke="currentColor" stroke-width="1.2"/><line x1="2.2" y1="9" x2="9.8" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></sc-if>`; decorate ř. 2912 `reminder:!!t.reminder`. Vidět na 02-nadchazejici.png (řádky 1 a 3).
- **Stav app:** Nic. reminders tabulka v klientu existuje (AppSchema.ts:120).
- **Fix:** useRowMeta: `SELECT DISTINCT task_id FROM reminders`; TaskCard prop `reminder?: boolean` → bell SVG v podřádku (ink-3, 11×11).

### [CRITICAL] Indikátor opakování ↻ v podřádku
- **Prototyp:** WatsonApp.dc.html ř. 426: `<sc-if value="{{ t.recurring }}"><span style="font-family:var(--w-font-mono); font-size:12px; color:var(--ink-3);">↻</span></sc-if>`; decorate ř. 2912 `recurring:!!t.recurring`.
- **Stav app:** TaskCard.tsx nemá recurrence prop — tasks.recurrence existuje (AppSchema.ts:22). ↻ se ukazuje jen v board buňkách Ukoly.tsx:293–297, v seznamovém řádku nikde.
- **Fix:** TaskCard prop `recurring?: boolean` → mono ↻ 12px ink-3 v podřádku; předat `Boolean(task.recurrence && task.recurrence !== 'none')` z TaskItem/Today.

### [CRITICAL] Chip „→ Přišlo na tebe“ (handedOff)
- **Prototyp:** WatsonApp.dc.html ř. 424: `<sc-if value="{{ t.handedOff }}"><span style="display:inline-flex; align-items:center; gap:4px; font-family:var(--w-font-display); font-weight:600; font-size:10.5px; padding:2px 8px; border-radius:999px; background:var(--brass-soft); color:var(--brass-text);">→ Přišlo na tebe</span></sc-if>`; nastavuje se v _advance ř. 2483 (`stepStatus:'now', handedOff:true`) a seed fp2 ř. 2139. Vidět na 02-nadchazejici.png u „Poptávka do tisku“.
- **Stav app:** Neexistuje — žádný handed-off stav v chain_steps ani v TaskCard.
- **Fix:** Nejblíž datům: chip zobrazit, když flow krok je `active` a task je přiřazen mně (assignments) — TaskItem už flow info má (lib/flowSteps.ts state). TaskCard prop `handedOff?: boolean` → brass-soft pilulka s textem výše. Pro věrnost doplnit `handed_off` reset při otevření detailu (volitelné, server-authored advance dle chainAdvance.ts).

### [MAJOR] Chip postupu: má obsahovat název postupu + tečky kroků + „2/5“ + stavové barvy
- **Prototyp:** WatsonApp.dc.html ř. 423: `<span data-stepstate="{{ t.stepStateKey }}" title="Otevřít Postup: {{ t.flowName }} · krok {{ t.stepLabel }}" style="…font-size:10.5px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--ink-3);"><svg …><path d="M1.5 6 H8 M5.5 3 L8.5 6 L5.5 9" …/></svg>{{ t.flowName }} {{ t.stepDotsNode }} {{ t.stepLabel }}</span>`; stepDotsNode ř. 2910: 5px tečky — před aktuálním `var(--ink-3)`, aktuální `var(--brass)`, budoucí transparent + `inset 0 0 0 1px var(--line)`; stavové CSS ř. 121–123: now=brass-soft+brass border+brass-text, waiting=panel-2+opacity .85, done=success-soft+success-ink. Na 02-nadchazejici.png: „→ Plakát na červnovou show ·· 2/5“ (brass).
- **Stav app:** packages/ui/src/TaskCard.tsx:112–129 — chip je jen `⛓ {flow.label}` (emoji řetěz, vždy brass-soft, žádný název postupu, žádné tečky, žádné stavové barvy, žádný title). FlowStepInfo má chainId/pos/total/state, název chainu se nepředává (TaskItem.tsx:34–41).
- **Fix:** TaskCard: flow prop rozšířit na `{ name, pos, total, state: 'active'|'dormant'|'done', onClick }`; render šipkové SVG + name + tečky (mapa fill dle pos) + `pos/total`; className dle state (brass/waiting/done). TaskItem: dotáhnout chain name (join chains v useFlowSteps).

### [MAJOR] Chip postupu je na špatném místě — patří do podřádku, ne na pravou stranu
- **Prototyp:** WatsonApp.dc.html ř. 421–429: podřádek je flex `gap:10px; margin-top:2px` a obsahuje v pořadí: [ws-tečka+projekt] → flowChip → handedOff → checklist → ↻ → zvoneček → komentáře. Pravá strana řádku (ř. 431–443) = termín → deadline → P-badge → status → přiřazení/avatary.
- **Stav app:** packages/ui/src/TaskCard.tsx:111–129 — flow chip je vykreslen MEZI titulkem a due labelem na pravé straně; podřádek (ř. 104–108) obsahuje jen text projektu (není to ani flex kontejner).
- **Fix:** TaskCard: podřádek předělat na `<div style="display:flex; align-items:center; gap:10px; margin-top:2px">` a přesunout do něj flow chip + všechny nové ikony; pravou stranu držet v pořadí prototypu.

### [MAJOR] Workspace tečka (6×6, radius 2) před názvem projektu v podřádku
- **Prototyp:** WatsonApp.dc.html ř. 422: `<span style="display:inline-flex; align-items:center; gap:6px;"><span data-wsdot="{{ t.wsId }}" style="width:6px; height:6px; border-radius:2px; flex:none;"></span><span style="font-family:var(--w-font-body); font-size:11.5px; color:var(--ink-3);">{{ t.projName }}</span></span>`; barvy ř. 105: `[data-wsdot="personal"]{#9a8f80} [data-wsdot="kancelar"]{#c68a3e} [data-wsdot="klub"]{#2a6fdb}`.
- **Stav app:** packages/ui/src/TaskCard.tsx:104–108 — podřádek je jen `{projectName}`, žádná ws tečka. Pozn.: na screenshotech je tečka projektové barvy — v appce lze použít projectColor (kulatá 6px) NEBO barvu workspace; prototyp používá wsId.
- **Fix:** TaskCard: prop `wsColor?: string` → 6×6 čtvereček radius 2 před názvem projektu (gap 6px). Barvu workspace vzít z lib/workspace.tsx; předat v TaskItem/Today.

### [CRITICAL] Status pilulka (Probíhá/Ke kontrole) se nikdy nezobrazí — prop se nepředává
- **Prototyp:** WatsonApp.dc.html ř. 434: `<sc-if value="{{ t.hasStatus }}"><span style="font-family:var(--w-font-display); font-weight:600; font-size:11px; padding:3px 9px; border-radius:999px; flex:none;" data-status="{{ t.status }}">{{ t.statusLabel }}</span></sc-if>`; CSS ř. 65–66: probiha/hotovo = success-soft+success-ink, kontrola = panel-2+ink-2; mapování ř. 2899–2901. Na 02-nadchazejici.png má 5 z 6 řádků „Probíhá“ (zeleně) nebo „Ke kontrole“.
- **Stav app:** packages/ui/src/TaskCard.tsx:158 StatusPill existuje, ale TaskItem.tsx (ř. 28–45) prop `status` vůbec nepřijímá/nepředává a Today.tsx card() (ř. 116–135) taky ne → mrtvý kód, pilulka se nikde nerenderuje. tasks.status_id + statuses tabulka jsou k dispozici (AppSchema.ts:26, 61).
- **Fix:** TaskItem: přidat prop / dotáhnout statuses mapu (id→{name,is_done}) hookem (1 dotaz pro celý seznam, jako useFlowSteps) a předat `status={statusName}` když status není výchozí/hotovo; StatusPill přepnout z porovnávání českých labelů na `isDone/isReview` flagy.

### [CRITICAL] Volitelná barva úkolu — podbarvení celého řádku (data-tc)
- **Prototyp:** WatsonApp.dc.html ř. 415: `data-tc="{{ t.color }}"` na řádku; CSS ř. 60–61: `[data-tc="rose"]{background:#fbeceb!important} [data-tc="amber"]{#fbf2df} [data-tc="lime"]{#f1f6e5} [data-tc="green"]{#e8f6ef} [data-tc="teal"]{#e5f4f4} [data-tc="sky"]{#e6f4fb} [data-tc="blue"]{#e8f0fb} [data-tc="violet"]{#efebfe} [data-tc="plum"]{#f9eaf1} [data-tc="slate"]{#eef0f2}`; dark varianty ř. 62–63 (rgba .17); hotový úkol zpět na panel ř. 117.
- **Stav app:** TaskCard.tsx nemá `color` prop; tasks.color v klientu existuje (AppSchema.ts:17). Řádek je vždy bílý.
- **Fix:** TaskCard: prop `color?: string` → mapa 10 světlých pozadí (a dark rgba variant přes CSS třídy v index.css, ať funguje tmavý režim); při done pozadí neaplikovat. Předat task.color z TaskItem/Today.

### [MAJOR] Spící krok postupu — šrafovaný řádek (data-dormant)
- **Prototyp:** WatsonApp.dc.html ř. 113: `[data-trow][data-dormant="true"]{ opacity:.6; box-shadow:none !important; background:repeating-linear-gradient(135deg, transparent, transparent 7px, var(--panel-2) 7px, var(--panel-2) 8px); }`; ř. 415 `data-dormant="{{ t.stepDormant }}"`, decorate ř. 2910 `stepDormant:t.stepStatus==='waiting'`. Navíc v Dnes se spící kroky vůbec nezobrazují (README ř. 73).
- **Stav app:** Nic — waiting kroky postupu vypadají jako běžné úkoly (TaskCard nemá dormant prop; Today.tsx je nefiltruje).
- **Fix:** TaskCard: prop `dormant?: boolean` → opacity .6 + repeating-linear-gradient výše + bez prioritního okraje. TaskItem předá `flow?.state === 'dormant'`. V Today.tsx dormant kroky vyfiltrovat ze skupin.

### [MAJOR] Nadcházející nepředává projekt → chybí podřádek s projektem a tečka je šedá
- **Prototyp:** Screenshot 02-nadchazejici.png: každý řádek má barevnou tečku projektu + podřádek „Q3 plánování / Provoz kanceláře / Obchod…“. Šablona ř. 418+422 (tečka data-proj + projName).
- **Stav app:** apps/web/src/screens/Nadchazejici.tsx:121 a 135: `<TaskItem key={tk.id} task={tk} flow={flowSteps.get(tk.id)} />` — bez `project` prop → TaskCard.tsx:90 fallback `var(--w-ink-3)` (šedá tečka) a podřádek se vůbec nevykreslí (ř. 104 podmínka projectName).
- **Fix:** Nadchazejici.tsx: sestavit projMap (useProjects už v souboru je pro projByDay) a předat `project={projMap.get(tk.project_id ?? '')}` na obou místech.

### [MAJOR] Formáty termínu: chybí „zítra · 13:00“, „po · příští týden“, vícedenní „4 dní“
- **Prototyp:** WatsonApp.dc.html seed ř. 2176 `dueLabel:'zítra · 13:00'`, ř. 2180 `dueLabel:'po · příští týden'`, ř. 2183 `dueLabel:'4 dní'`; addTask ř. 2463: `task.dueLabel = r.due + (tmin!=null ? (' · '+d.time) : '')`; ř. 2466 vícedenní: `dueLabel = (tmin!=null?(fmt(tmin)+' · '):'')+days+' dní'`. Vidět na 03-ukoly.png („zítra · 13:00“, „po · příští týden“).
- **Stav app:** apps/web/src/lib/tasks.ts dueLabel() ř. 36–47 — jen „po termínu · st“ / „dnes“ / „zítra“ / „st 3. 7.“; bez času, bez „příští týden“, bez vícedenních.
- **Fix:** lib/tasks.ts: dueLabel rozšířit — (a) suffix `· HH:MM` když due_date nese čas; (b) datum v příštím týdnu → `{den} · příští týden`; (c) start_date+due_date span > 1 den → `N dní`.

### [MINOR] Hotový úkol: tečka projektu se neztlumí (grayscale)
- **Prototyp:** WatsonApp.dc.html ř. 119: `[data-done="true"] [data-proj]{ filter:grayscale(1); opacity:.4; }`.
- **Stav app:** packages/ui/src/TaskCard.tsx:88–91 — tečka drží plnou projektovou barvu i u done (řádek má jen opacity .5).
- **Fix:** TaskCard: na span tečky přidat `filter: done ? 'grayscale(1)' : undefined, opacity: done ? 0.4 : 1`.

### [MINOR] Checkbox hover: okraj se nezbarvuje brass
- **Prototyp:** WatsonApp.dc.html ř. 417: `<span onClick=… style="width:18px; height:18px; border-radius:50%; border:2px solid var(--line); …" style-hover="border-color:var(--brass)"></span>`.
- **Stav app:** packages/ui/src/TaskCard.tsx:59–85 — button bez hover stylu (border zůstává var(--w-line)).
- **Fix:** TaskCard: className `hover:border-brass` (nebo `[&:hover]:border-[var(--w-brass)]`) na checkbox button; border přes třídu místo inline stylu, aby hover fungoval.

### [MINOR] Flash animace nově přidaného úkolu (data-flash)
- **Prototyp:** WatsonApp.dc.html ř. 152–153: `@keyframes wFlash { 0%{ background:var(--brass-soft); } 100%{ background:transparent; } } [data-flash="true"]{ animation:wFlash 1.6s ease; }`; decorate ř. 2906 `flash:this.state.justAdded===t.id`.
- **Stav app:** Žádný flash — po přidání přes QuickAdd/AddTaskModal se řádek objeví bez zvýraznění.
- **Fix:** index.css: přidat keyframes + `[data-flash="true"]`; TaskCard prop `flash?: boolean`; v QuickAdd držet justAddedId (state/context) ~1.6 s a předávat do TaskItem.

### [MAJOR] Klávesový výběr (brass ring) chybí v Dnes a Nadcházející
- **Prototyp:** WatsonApp.dc.html ř. 72: `[data-trow][data-kbsel="true"]{ box-shadow:0 0 0 2px var(--brass); border-radius:11px; }` + ř. 415 `data-kbsel="{{ t.kbsel }}"` — platí pro všechny seznamy (README ř. 52: ↑/↓ j/k, Enter, Space, 1–4, ⌫).
- **Stav app:** Jen Ukoly.tsx má kbSel + KbRow (ř. 46, 316, 337); Today.tsx a Nadchazejici.tsx nemají žádnou klávesovou navigaci řádků.
- **Fix:** Vytáhnout kbSel logiku z Ukoly.tsx (ř. 79–110) do sdíleného hooku useListKeyboard(ids) a nasadit v Today.tsx i Nadchazejici.tsx; KbRow wrapper přesunout do components/.

### [MINOR] Seznam řádků má mezery a jiné hlavičky skupin (Nadcházející) — prototyp je souvislý seznam
- **Prototyp:** WatsonApp.dc.html ř. 415: řádky na sebe navazují (`border-bottom:1px solid var(--line)`, žádný gap); hlavička skupiny ř. 409–411: `font-weight:700; font-size:13px; color:var(--ink)` + mono count 11.5px — bez uppercase (viz „Dnes · čtvrtek 16“ na 02-nadchazejici.png).
- **Stav app:** apps/web/src/screens/Nadchazejici.tsx:119,133 — `<ul className="mt-3 flex flex-col gap-2">` (8px mezery mezi řádky) a h2 s `text-xs uppercase tracking-[0.18em]` (ř. 115, 129) — vizuálně jiné než prototyp.
- **Fix:** Nadchazejici.tsx: odstranit gap-2 (nechat border-bottom řádků), hlavičky přepsat na vzor SectionHead z Today.tsx (13px bold ink + mono count, bez uppercase).

### [MINOR] Podřádek se nezobrazí bez projektu — v prototypu je flex kontejner vždy (ikony i bez projektu)
- **Prototyp:** WatsonApp.dc.html ř. 421: podřádek `<div style="display:flex; align-items:center; gap:10px; margin-top:2px;">` se renderuje vždy a nese i chipy/ikony nezávisle na projektu.
- **Stav app:** packages/ui/src/TaskCard.tsx:104–108 — podřádek podmíněn `{projectName && …}`; jakmile přibudou ikony (checklist/komentáře/↻/zvoneček), u úkolů bez projektu by zmizely.
- **Fix:** Render podřádku podmínit `(projectName || flow || meta…)` a uvnitř skládat prvky v pořadí prototypu s gap 10px.


## Obrazovky Dnes + Úkoly + Nadcházející (struktura obrazovek) — 48 %

### [CRITICAL] Přepínač pohledů Seznam|Nástěnka|Kalendář není v headeru a má špatný vzhled
- **Prototyp:** WatsonApp.dc.html ř. 277–282: přepínač je PŘÍMO V TOPBARU hned vedle titulku — `<div style="margin-left:6px; flex:none; display:flex; background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:3px;"> <span … padding:5px 12px; border-radius:7px; font-size:12.5px; font-weight:600" data-tab data-active="{{ viewIs.list }}">Seznam</span> …Nástěnka…Kalendář`. Aktivní tab (ř. 51): `[data-tab][data-active="true"]{ background:var(--panel); color:var(--ink); }` (bílý segment na panel-2 podkladu, NE brass chip). Viditelnost ř. 3241: `showViewSwitcher: isWorkspace && screen!=='dnes' && screen!=='schranka'`. Screenshot 03: segmenty Seznam/Nástěnka/Kalendář nahoře vedle „Úkoly".
- **Stav app:** layout/Header.tsx — přepínač v headeru vůbec není. screens/Ukoly.tsx:189–199 renderuje vlastní `ViewTab` POD headerem v obsahu, se stylem brass chip (`borderColor: brass, background: brass-soft, color: brass-text` ř. 378–382) místo panel/panel-2 segmentů.
- **Fix:** Header.tsx: přidat segmented control vedle titulku (render když route ∈ /ukoly, /nadchazejici, /oblibene), styl 1:1 (panel-2 pozadí, border line, radius 10, padding 3, taby 5px 12px radius 7, aktivní = bg panel + ink). View state vytáhnout z Ukoly.tsx do sdíleného kontextu/localStorage (`watson.viewMode` už existuje). Z Ukoly.tsx lokální ViewTab odstranit.

### [CRITICAL] Nadcházející nemá přepínač zobrazení vůbec — chybí Nástěnka i Kalendář
- **Prototyp:** WatsonApp.dc.html ř. 3241: `showViewSwitcher: isWorkspace && screen!=='dnes'…` — `nadchazejici` je v `isWorkspace` (ř. 3022: `['dnes','seznam','nadchazejici','oblibene',…]`), takže na Nadcházejícím fungují všechny tři pohledy (board sloupce ř. 455–486, kalendář ř. 489–557 jsou společné pro workspace obrazovky). Screenshot 02: v headeru Nadcházející je Seznam|Nástěnka|Kalendář.
- **Stav app:** screens/Nadchazejici.tsx — pouze list render (ř. 104–162), žádný view state, žádný Board/Calendar.
- **Fix:** Nadchazejici.tsx: převzít view-mode pattern z Ukoly.tsx (sdílený stav, viz gap 1) a renderovat `<Calendar tasks={…}>` a board sloupce pro množinu nadcházejících úkolů.

### [CRITICAL] Chybí řada workspace chipů Vše / Moje / Kancelář / Sokol na Dnes i Nadcházející
- **Prototyp:** WatsonApp.dc.html ř. 342–346: `<sc-if value="{{ showDayWs }}"><div style="display:flex; gap:7px; padding:8px 4px 2px; flex-wrap:wrap;"><sc-for list="{{ dayWsChips }}"><span data-wschip data-on="{{ c.on }}" style="display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:12px; padding:5px 11px; border-radius:999px; border:1px solid var(--line); color:var(--ink-2);"><span data-wsdot="{{ c.id }}" style="width:7px; height:7px; border-radius:2px;"></span>{{ c.label }}`. Aktivní chip ř. 110: `[data-wschip][data-on="true"]{ background:var(--brass-soft); border-color:var(--brass); color:var(--brass-text); }`. Data ř. 3256: `showDayWs:(screen==='dnes'||screen==='nadchazejici'), dayWsChips: [{id:'',label:'Vše',on:!s.dayWs,hasDot:false}].concat(WORKSPACES.map(w=>({label:{personal:'Moje',kancelar:'Kancelář',klub:'Sokol'}[w.id]…})))`. Filtr skupin ř. 3025: `dayWf=(t)=> !s.dayWs || wsOf(proj(t.project))===s.dayWs`.
- **Stav app:** Today.tsx ani Nadchazejici.tsx nic takového nemají (grep dayWs/wschip = 0 zásahů); workspace existuje jen jako sidebar přepínač (lib/workspace.tsx).
- **Fix:** Nová komponenta components/WorkspaceChips.tsx: `useWorkspaces()` + lokální `dayWs` state; chip „Vše" bez tečky + chip per prostor s 7×7 čtvercovou tečkou v barvě prostoru. Vložit jako první řádek obsahu Today.tsx a Nadchazejici.tsx; filtrovat úkoly přes project.workspace_id.

### [CRITICAL] Podtitul headeru „{N} úkolů · {X,X} h" — chybí součet hodin a chybí na Úkoly/Nadcházející
- **Prototyp:** WatsonApp.dc.html ř. 269–274: `<sc-if value="{{ isWorkspace }}"><div style="…font-family:var(--w-font-mono); font-size:11.5px; color:var(--ink-3);"><span>{{ count }} úkolů</span><sc-if value="{{ hasTime }}"><span>· {{ timeLabel }}</span></sc-if>`. Výpočet ř. 3090–3092: `const count = src.length; const timeSum = src.filter(t=>t.start!=null).reduce((a,t)=>a+(t.end-t.start),0); const timeLabel = (Math.round(timeSum/60*10)/10).toString().replace('.',',')+' h';` — src = úkoly aktuální obrazovky. Screenshoty: „19 úkolů · 8,8 h" (Dnes), „30 úkolů · 15,3 h" (Nadcházející), „31 úkolů · 16,3 h" (Úkoly).
- **Stav app:** layout/Header.tsx:26–47: `showSubtitle = path === "/"` — jen na Dnes; count je globální `count(*) FROM tasks WHERE completed_at IS NULL` (ne scope obrazovky); hodiny chybí úplně.
- **Fix:** Header.tsx: renderovat podtitul pro všechny workspace routy (/​, /ukoly, /nadchazejici, /oblibene); count + SUM(duration_min) spočítat per route (SQL WHERE dle obrazovky, nebo obrazovky publikují count/minuty do kontextu). Formát `{n} úkolů · {h.toFixed(1).replace('.',',')} h`, mono 11,5 px, ink-3, skrýt hodiny při 0.

### [CRITICAL] Chybí zámek výchozího zobrazení (per-user) vedle přepínače pohledů
- **Prototyp:** WatsonApp.dc.html ř. 283–287: `<span onClick="{{ toggleViewLock }}" data-chip data-on="{{ viewLocked }}" title="Zamknout toto zobrazení jako výchozí pro všechny sekce" style="width:32px; height:32px; border-radius:9px; border:1px solid var(--line);">` + SVG zamčený/odemčený zámek; po zamknutí label `Výchozí: {{ lockLabel }}` (brass-soft pill). Logika ř. 3240: `lockLabel:(s.lockedView?((({list:'Seznam',board:'Nástěnka',calendar:'Kalendář'})[s.lockedView.view]…)`. Screenshot 02/03: ikonka zámku hned vpravo od segmentů.
- **Stav app:** Nikde — Ukoly.tsx má jen localStorage `watson.viewMode` (ř. 23, 36–43) bez UI zámku a bez „Výchozí: …" labelu.
- **Fix:** V Header.tsx vedle nového přepínače přidat 32×32 chip s lock/unlock SVG (přesné paths ř. 284–285), toggle persistuje {view, calMode} do localStorage/user settings a krátce zobrazí brass-soft label „Výchozí: Seznam".

### [MAJOR] Nadcházející seskupuje po jednotlivých datech místo bucketů Dnes/Zítra/Víkend/Příští týden/Začátkem příštího měsíce/Později
- **Prototyp:** WatsonApp.dc.html ř. 3048: `const b=[['dnes','Dnes · čtvrtek'],['zitra','Zítra · pátek'],['patek','Víkend'],['pristi','Příští týden'],['pmonth','Začátkem příštího měsíce'],['custom','Později']];` + ř. 2649 `_dayBucket(iso){ …diff<=0→'dnes'; diff===1→'zitra'; diff<=6 && (dow===6||dow===0)→'patek'; diff<=7→'pristi'; 1.–6. příštího měsíce→'pmonth'; jinak 'custom' }`. Screenshot 02: první skupina „Dnes · čtvrtek 16".
- **Stav app:** Nadchazejici.tsx:92–99: skupina za každé datum (`fmtDate` → „pátek 3. července"), jen dnes/zítra mají speciální label.
- **Fix:** Nadchazejici.tsx: portovat `_dayBucket` (lib/occurrences.ts nebo lib/tasks.ts) a mapovat labely: Dnes · {den}, Zítra · {den}, Víkend, Příští týden, Začátkem příštího měsíce, Později; buckets řadit v tomto pořadí a prázdné skrýt.

### [MAJOR] Hlavičky skupin Nadcházejícího mají špatný styl (uppercase brass tracking) a app přidává sekci Zpožděné, kterou tam prototyp nemá
- **Prototyp:** WatsonApp.dc.html ř. 409–412 (společné pro všechny seznamy): `<div style="display:flex; align-items:center; gap:10px; margin:18px 0 2px; padding:0 4px;"><span style="font-family:var(--w-font-display); font-weight:700; font-size:13px; color:var(--ink);">{{ g.label }}</span><span style="font-family:var(--w-font-mono); font-size:11.5px; color:var(--ink-3);">{{ g.count }}</span>` — normální case, barva ink. Buckety Nadcházejícího (ř. 3048–3050) Zpožděné neobsahují; screenshot 02 začíná „Dnes · čtvrtek 16".
- **Stav app:** Nadchazejici.tsx:115–118 a 129–132: `className="font-display text-xs font-bold uppercase tracking-[0.18em] text-brass-text"` resp. `text-overdue`; navíc vlastní sekce Zpožděné (ř. 113–125).
- **Fix:** Použít stejný SectionHead jako Today.tsx (13px bold ink + mono count 11,5 ink-3, margin 18px 0 2px); sekci Zpožděné z Nadcházejícího odstranit (zpožděné patří na Dnes).

### [MAJOR] Toolbar: chipy bez ikon a ▾, řazení není split-button se směrem „Vzestupně/Sestupně"
- **Prototyp:** WatsonApp.dc.html ř. 350: Filtr = `padding:6px 11px; border-radius:8px; border:1px solid var(--line)` + funnel SVG `<path d="M2 3 H12 L8 8 V12 L6 11 V8 Z"…/>` + text `Filtr` + `<span style="font-size:10px; opacity:.6;">▾</span>`. Ř. 377–383: řazení = spojený split-button — levý segment `border-radius:8px 0 0 8px` s ikonou `<path d="M4 3 V11 M9 3 V11"/>` + `{{ sortLabel2 }}` + ▾; pravý segment `border:1px solid var(--line); border-left:none; border-radius:0 8px 8px 0` s šipkou-SVG ↑/↓ + textem `{{ sortDirLabel }}` (Vzestupně/Sestupně). Ř. 390: Dokončené chip s fajfkou `<path d="M3 7.4 L6 10 L11 4"/>`. Screenshot 01/03: „Filtr ▾ | ‖ Chytré ▾ | ↑ Vzestupně | ✓ Dokončené".
- **Stav app:** components/TasksToolbar.tsx:92–99 + 101–197: všechny prvky jsou kulaté pilulky radius 999 bez ikon a bez ▾; směr je samostatná pilulka s holým znakem „↑" bez textu (ř. 177–185); label „Řadit · Chytré" místo jen „Chytré".
- **Fix:** TasksToolbar.tsx: přestylovat na radius 8, přidat SVG ikony (funnel, dvě svislé čáry, fajfka) a ▾; směrové tlačítko spojit s řadicím (border-left:none, radius 0 8 8 0) a doplnit text Vzestupně/Sestupně + SVG šipku.

### [MAJOR] Filtr menu má jen Prioritu — chybí Stav, Projekt (s hledáním), Osoba (s hledáním) a „Vymazat filtry"
- **Prototyp:** WatsonApp.dc.html ř. 352–374: dropdown 230px se sekcemi: Priorita (chipy P1–P4), **Stav** (ř. 357–360, opts ř. 3236: Probíhá/Ke kontrole/Nezahájeno/Hotovo), **Projekt** (ř. 361–365: `<input placeholder="Hledat projekt…"` + chipy s barevnou tečkou `data-proj`), **Osoba** (ř. 366–372, jen team ws — ř. 3237: `Jen já / Nepřiřazené / Více lidí` + lidé, `<input placeholder="Hledat člověka…"`), a `<span onClick="{{ clearFilters }}"…>Vymazat filtry</span>` (ř. 373). Aktivní chipy všech dimenzí s × (ř. 391, data ř. 3239).
- **Stav app:** TasksToolbar.tsx:114–139: menu má jen sekci Priorita; ToolbarState (ř. 5–10) nemá filterProj/filterStatus/filterPerson; aktivní chipy jen pro priority (ř. 200–216).
- **Fix:** Rozšířit ToolbarState o `projects: string[]`, `statuses: string[]`, `people: string[]` + query stringy; do menu přidat 3 sekce dle markup výše (statusy z tabulky statuses, projekty z useProjects, lidé z members); filterTasks rozšířit; přidat Vymazat filtry a aktivní chipy pro všechny dimenze.

### [MAJOR] Řazení bez voleb Projekt a Stav
- **Prototyp:** WatsonApp.dc.html ř. 3233: `sortOptions:[['smart','Chytré'],['due','Termín'],['priority','Priorita'],['name','Abeceda'],['project','Projekt'],['status','Stav']]`; komparátory ř. 3015: `project:(a,b)=>proj(a.project).name.localeCompare(proj(b.project).name,'cs'), status:(a,b)=>({probiha:0,kontrola:1,'':2,hotovo:3}…)`. Aktivní položka menu = brass-soft řádek (`data-rowsel data-on` ř. 386, CSS ř. 99).
- **Stav app:** TasksToolbar.tsx:4 `type SortBy = "smart" | "due" | "priority" | "name"` a SORTS ř. 78–83 — Projekt a Stav chybí; aktivní položka označena ✓ místo brass-soft pozadí.
- **Fix:** Přidat 'project' a 'status' do SortBy + sortTasks (projekt dle názvu z projMap — komparátor bude potřebovat mapu, předat přes props/argument; status dle statuses.position); aktivní řádek menu stylovat brass-soft.

### [MAJOR] „Tvůj další krok v postupech" na Dnes: chybí hlavička sekce, brass-soft karta, „pak předáš → {osoba}" a krok 2/5 vpravo; jen jedna karta
- **Prototyp:** WatsonApp.dc.html ř. 396: hlavička `…font-weight:700; font-size:13px…<svg…color:var(--brass)><path d="M2 5h7l-2-2M14 11H7l2 2"…/></svg>Tvůj další krok v postupech`. Ř. 397–406: pro KAŽDÝ můj aktivní krok karta `background:var(--brass-soft); border:1px solid var(--line); border-radius:11px; padding:11px 13px` s brass tečkou 7px, názvem 13,5px bold, podtitulem `{{ f.flowName }}<sc-if value="{{ f.hasBlocking }}"> · pak předáš → {{ f.blocking }}</sc-if>` a vpravo `<span style="font-family:var(--w-font-mono); font-size:11.5px; color:var(--brass-text);">{{ f.step }}</span>` (= „2/5"). Data ř. 3156: blocking = jméno prvního člověka následujícího kroku, jinak 'kdokoli z týmu'. Screenshot 01 přesně tak.
- **Stav app:** Today.tsx:73–84 vrací jen PRVNÍ krok; ř. 188–215: bílá karta `border-brass bg-card` s ikonou v čtverečku, podtitul „{chainName} · krok {pos}/{total}" (chybí „pak předáš →"), vpravo „→" místo „2/5"; hlavička sekce chybí.
- **Fix:** Today.tsx: myNextStep → myNextSteps (všechny aktivní kroky přiřazené mně); přidat hlavičku sekce s výměnnou SVG ikonou; kartu přestylovat na brass-soft + 7px tečku; dopočítat příjemce dalšího kroku (chain_steps pos+1 → assignments) pro „· pak předáš → {jméno}"; vpravo mono „{pos}/{total}" brass-text.

### [MAJOR] Pořadí obsahu Dnes je přeházené a navíc obsahuje inline QuickAdd, který v prototypu není
- **Prototyp:** WatsonApp.dc.html pořadí šablony: ws chipy (ř. 342) → toolbar (ř. 347) → „Tvůj další krok v postupech" (ř. 395) → skupiny (ř. 408). V celé workspace šabloně (ř. 329–559) žádný inline input pro přidání úkolu není (grep placeholder — jediné vstupy jsou v menu/hledání); přidání jde přes sidebar „Přidat úkol" (ř. 173) a header „+ Úkol" (ř. 308). Screenshot 01: pod toolbarem hned „Tvůj další krok…".
- **Stav app:** Today.tsx:180–220: pořadí QuickAdd (ř. 182–185) → myNextStep (ř. 188) → toolbar (ř. 218) — obráceně a s prvkem navíc.
- **Fix:** Today.tsx: přeskládat na chipy → toolbar → další krok → skupiny; `<QuickAdd>` z Dnes odstranit (parser žije v AddTaskModal / + Úkol), případně za feature flag.

### [MAJOR] Výskyty opakování v Nadcházejícím jsou čárkované „ghost" řádky místo plnohodnotných řádků úkolu
- **Prototyp:** WatsonApp.dc.html ř. 2654 `listTasks(days)`: výskyty se pushují jako `makeOcc(t, iso)` (ř. 2652) — plný klon úkolu s `id:baseId@iso`, `done:!!exc.done`, `dueLabel: _occLabel(iso)` (např. „st 1. 7.") — a v šabloně jdou stejným renderem `groups → t` jako běžné řádky (checkbox, priorita, projekt, ↻, klik otevře detail s bannerem výskytu; per-výskyt done/skip přes exceptions — toggleDone ř. 2482, skipOccurrence ř. 2477). Screenshot 02: opakované úkoly vypadají jako normální řádky.
- **Stav app:** Nadchazejici.tsx:137–158: projekce renderuje vlastní `<li>` s `border-dashed`, `opacity: 0.75`, bez checkboxu, neklikací, jen název + ↻.
- **Fix:** Nadchazejici.tsx: z occurrence vyrobit virtuální TaskRow (spread base + id=occId, due_date=od) a renderovat přes `<TaskItem>`; toggle → zápis výjimky (occurrence engine R4 už existuje v lib/occurrences.ts), klik → detail výskytu.

### [MAJOR] Board karty: chybí prioritní barevný rámeček, avataři, deadline ⚑, label opakování a tlačítko „+ Přidat" ve sloupci
- **Prototyp:** WatsonApp.dc.html ř. 465: karta má `data-pcard="{{ t.pri }}"` → ř. 57 `[data-pcard="1"]{ border-color:var(--p1) !important; }` (celý rámeček v barvě priority). Meta řádek ř. 470–475: pri pilulka, due, `↻ {{ t.repeatLabel }}` (brass-text), `⚑ {{ t.deadlineLabel }}` (overdue), a `<span data-avg style="margin-left:auto…">` avataři 20px. Ř. 464/479: drag gap = `<div style="height:0; border-top:2px dashed var(--brass);">`. Ř. 480–482: patička sloupce `<div onClick="{{ openAdd }}"…><svg +>…Přidat</div>`.
- **Stav app:** Ukoly.tsx:241–301: border vždy `border-line`, meta jen P-pilulka + datum + holé ↻; žádní avataři, žádný deadline, žádný gap indikátor (jen opacity), žádné „+ Přidat" na konci sloupce.
- **Fix:** Ukoly.tsx board karta: borderColor = `var(--w-p{priority})`; doplnit avatary z assignments (ml-auto), deadline chip, repeat label; do sloupce přidat footer button openAdd; drag-over vykreslit 2px dashed brass linku na insert pozici.

### [MAJOR] Úkoly nescopují seznam na aktivní prostor a negrupují dle pořadí projektů
- **Prototyp:** WatsonApp.dc.html ř. 3040–3043: `const inWs = this.PROJECTS.filter(p=>this.inWS(p)); … groups=inWs.map(p=>({ id:p.id, label:proj(p.id).name, count:…, tasks:decL(…) })).filter(g=>g.tasks.length>0);` — skupiny v pořadí definice projektů AKTIVNÍHO prostoru, úkoly cizích prostorů se nezobrazují.
- **Stav app:** Ukoly.tsx:50–52 bere všechny tasks; groups (ř. 64–73) vznikají v pořadí, v jakém úkoly přijdou z SQL, klíč „—" pro bez projektu; useProjects (lib/projects.ts:8–13) nefiltruje workspace.
- **Fix:** Ukoly.tsx: joinovat přes projects.workspace_id = activeWs (useWorkspace) a iterovat projekty (ORDER BY name/position) → skupiny; úkoly bez projektu ven (patří do Schránky).

### [MAJOR] Chybí inline hledání v headeru (lupa → rozbalovací input filtrující seznam)
- **Prototyp:** WatsonApp.dc.html ř. 290–299: klik na lupu přepne na `<div style="…background:var(--panel-2); border:1px solid var(--line); border-radius:9px; padding:6px 11px; width:200px;"><svg lupa/><input placeholder="Hledat…"/><span onClick="{{ toggleSearch }}">×</span></div>`; dotaz filtruje aktuální seznam — ř. 3012–3013 `const q=s.search.trim().toLowerCase(); const match=(t)=> !q || t.name.toLowerCase().includes(q);` aplikované v decL/dec.
- **Stav app:** Header.tsx:51–72: lupa jen naviguje na /hledat (samostatná obrazovka).
- **Fix:** Header.tsx: state searchOpen + input 200px dle markup; hodnotu sdílet kontextem (např. useListSearch) a v Today/Ukoly/Nadchazejici filtrovat `name.includes(q)` před groupováním. Fulltext /hledat zůstává pro `/` zkratku.

### [MAJOR] Dnes zahrnuje úkoly bez termínu do skupiny „Dnes"
- **Prototyp:** WatsonApp.dc.html ř. 3028: `td=T.filter(t=>t.group==='today'…)` — do Dnes jen úkoly s dnešním termínem; úkoly bez termínu mají `inbox:true` a žijí v Schránce (ř. 3052–3054), do počtů Dnes nevstupují (`navCount.dnes:16`).
- **Stav app:** Today.tsx:64–67: `today: opn.filter((x) => { const d = dayOf(x); return d === null || d === tdy; })` — každý úkol bez due_date se zobrazí v Dnes (duplicitně se Schránkou).
- **Fix:** Today.tsx: `d === tdy` pouze; úkoly bez termínu nechat Schránce (inbox triage už existuje).

### [MINOR] Dnes/Nadcházející: skrytý „Dokončené" toggle + Dnes má navíc sbalovací sekci „Hotovo"
- **Prototyp:** WatsonApp.dc.html ř. 390: chip Dokončené je v toolbaru vždy (`showToolbar: isWorkspace && s.view==='list'`, ř. 3229); zapnutí zobrazí hotové PŘÍMO ve skupinách (decL ř. 3017: `.filter(t=>(s.showDone||!t.done))`, přeškrtnuté opacity .5 ř. 111–112). Samostatná sekce „Hotovo" v prototypu neexistuje.
- **Stav app:** Today.tsx:219 a Nadchazejici.tsx:106 volají `<TasksToolbar hideDone />`; Today.tsx:248–266 má vlastní collapsible „Hotovo ▸".
- **Fix:** Odebrat hideDone na obou obrazovkách, hotové promíchat do skupin dle toggle; sekci Hotovo z Today.tsx smazat.

### [MINOR] Prázdné stavy neodpovídají textem ani stylem
- **Prototyp:** WatsonApp.dc.html ř. 448–449: bez filtru projektu `<div style="text-align:center; padding:80px 20px; color:var(--ink-3);">Nic tu není — čistý stůl. 🙂</div>` (bez rámečku); s filtrem projektu `V tomto projektu zatím nejsou žádné úkoly.` + brass tlačítko `+ Přidat úkol` (padding 70px, radius 10, 9px 16px).
- **Stav app:** Today.tsx:238–241, Ukoly.tsx:308–312, Nadchazejici.tsx:107–111: čárkovaný orámovaný box s textem „Na dnešek nemáš nic. Hezký klid." (cs.json:121) všude, i mimo Dnes; projektová varianta s tlačítkem chybí.
- **Fix:** Sjednotit: centrovaný text bez borderu „Nic tu není — čistý stůl. 🙂" (nový i18n klíč), v projektovém filtru Úkolů text + brass tlačítko openAdd.

### [MINOR] Banner filtrovaného projektu na Úkoly: karta místo prostého řádku, chybí „Upravit projekt"
- **Prototyp:** WatsonApp.dc.html ř. 335–340: prostý řádek `padding:8px 4px 10px` — tečka 11px, název `font-weight:800; font-size:18px`, vedle `<span onClick="{{ openProjDetail }}" style="font-size:12px; color:var(--ink-3);">Upravit projekt</span>`, vpravo `← Všechny úkoly` (brass-text, hover underline). Bez rámečku/karty.
- **Stav app:** Ukoly.tsx:173–186: `rounded-xl border border-line bg-card px-4 py-3` karta; „Upravit projekt" (otevření detail panelu projektu) chybí.
- **Fix:** Odstranit kartové orámování, přidat link „Upravit projekt" → useProjectDetail().open(projektId); „← Všechny úkoly" stylovat brass-text vpravo.

### [MINOR] Šířky kontejnerů seznamů: 768 px místo 1080 px
- **Prototyp:** WatsonApp.dc.html ř. 333: list `<div style="max-width:1080px; margin:0 auto; padding:10px 22px 90px;">`; board ř. 456 je full-width `padding:18px 22px 90px; overflow-x:auto`.
- **Stav app:** Ukoly.tsx:169–171: `max-w-3xl` (768px) pro list, board uvnitř `max-w-[1080px]` (má být bez limitu); Nadchazejici.tsx:105: `max-w-3xl px-5 py-7`. Today.tsx 1080px OK.
- **Fix:** List kontejnery sjednotit na max-w-[1080px] + padding 10px 22px 90px; board vykreslit mimo max-width wrapper.

### [MINOR] Header: tlačítko CS/EN navíc (v designu není)
- **Prototyp:** WatsonApp.dc.html ř. 289–311: pravá strana headeru má pevné pořadí lupa → zvonek → motiv → Watson pill → + Úkol; nic jiného. Screenshoty 01–03 shodně.
- **Stav app:** Header.tsx:138–145: mezi motivem a Watsonem je button CS/EN.
- **Fix:** Přesunout přepínač jazyka do Nastavení (screens/Nastaveni.tsx), z headeru odstranit.

### [MINOR] Watson strip: „Přeplánovat zpožděné" mizí, když nejsou zpožděné; v prototypu je stálou součástí
- **Prototyp:** WatsonApp.dc.html ř. 316–322: strip vždy obsahuje `<span onClick="{{ reschedule }}"…>Přeplánovat zpožděné</span>` + `Více →` (bez podmínky); zobrazení stripu `showWatsonStrip: screen==='dnes' && !isMobile` (ř. 3243).
- **Stav app:** Today.tsx:160–169: tlačítko podmíněné `g.overdue.length > 0`; strip se renderuje i na mobilu.
- **Fix:** Renderovat akci vždy (disabled/no-op při 0 zpožděných) a strip skrýt pod mobilním breakpointem (useIsMobile).


## Kalendář (den/týden/měsíc) — 40 %

### [CRITICAL] Projekce opakovaných úkolů do kalendáře chybí
- **Prototyp:** ř. 2633-2637 calTasks(): base.forEach(t=>{ if(((t.repeat&&t.repeat!=='none')||t.recurring)&&!t.flowId){ const occ=this._recOccur(t,a,b); occ.forEach(iso=>{ …if(exc.skipped) return; out.push(this.makeOcc(t,iso)); }) } }); ř. 2639 _calRange() = viditelný rozsah dle calMode (měsíc = celý měsíc, týden = po–ne, den = 1 den); ř. 2652 makeOcc — virtuální výskyt s id base.id+'@'+iso (ř. 2646), aplikuje exceptions (done/skipped/time) a recurring:true. Všechny pohledy čtou calTasks(): eventsNode ř. 2732, allDayRow ř. 2798, buildMonth ř. 2874. README §Kalendář: „Opakované úkoly se promítají jako jednotlivé výskyty do budoucích týdnů/měsíců“.
- **Stav app:** apps/web/src/components/Calendar.tsx:108-116 — byDay se staví z raw tasks (Ukoly.tsx:204 posílá scoped přímo). lib/occurrences.ts má hotový expandOccurrences/occId, ale používá ho jen screens/Nadchazejici.tsx:73. CalendarMonth.tsx:16 to výslovně přiznává v komentáři.
- **Fix:** Calendar.tsx: před byDay spočítat [fromISO,toISO] dle mode/offset a pro každý task s recurrenceKind(t.recurrence_rule) přidat virtuální TaskRow klony přes expandOccurrences (id=occId, due_date=iso, completed_at dle výjimky), předat i do CalendarMonth. Klik na výskyt → detail výskytu (parseOccId).

### [CRITICAL] Vícedenní pruhy v pásu CELÝ DEN (span přes sloupce, „4 dní“)
- **Prototyp:** ř. 2809-2820: const ev=this.calTasks().filter(t=> …t.start==null && !t.inbox && this.tIsoEnd(t)>this.tIso(t) && cols.some(c=>c.iso>=this.tIso(t)&&c.iso<=this.tIsoEnd(t))) → absolutně pozicované pruhy: top:(idx*23+2)px, left:calc(left%+2px), width:calc(width%-4px), height:20px, borderLeft:'3px solid '+(priorita/projekt), borderRadius:6px, s calCheck(t,12), názvem (ellipsis) a this._dayspan(t)+' dní' (mono 9px, ř. 2817; _dayspan ř. 2642). Zásah dne řeší _hit (ř. 2632): iso>=tIso && iso<=tIsoEnd — úkol se ukazuje KAŽDÝ den rozsahu (i v měsíci a dni). Screenshot 04: pruh „Mistrovství světa v aranžování · 4 dní“ přes Út–Pá.
- **Stav app:** Calendar.tsx:15 taskDay() bere jen (due_date ?? start_date).slice(0,10) — úkol visí na jediném dni; žádné pruhy, žádný span v měsíci/dni. Schema tasks nemá koncept konce vícedenního úkolu vyřešený v UI (start_date+due_date pár se nevyužívá jako rozsah).
- **Fix:** Calendar.tsx + CalendarMonth.tsx: zavést taskSpan(t) = [start_date…due_date] pokud jsou oba a liší se den; hit(iso) testovat rozsah. V allDayRow (novém, viz další gap) vykreslit řádek pruhů s výpočtem li/ri indexů sloupců přesně dle ř. 2812.

### [CRITICAL] Pás CELÝ DEN neexistuje jako band (label, karty s checkboxem+tečkou, prázdný stav, klik=nový úkol)
- **Prototyp:** ř. 2823-2826: band s ref allDayBandEl, borderBottom:1px var(--line), minHeight:30px, background:var(--panel-2); gutter 46px s textem 'Celý den' (mono 8.5px uppercase, ř. 2824). Sloupce (ř. 2799-2805): onClick=addAllDayAt(iso), padding:4px, gap:3px, dnešek background:var(--brass-soft); karta all-day úkolu = calCheck(t,13) + tečka projektu 6px (data-proj) + název 11.5px display 600 s WebkitLineClamp:2, border:1px var(--line), borderRadius:6px, padding:'3px 7px 3px 8px', cursor:grab, draggable; data-prow={t.priority} (prioritní okraj přes CSS). Prázdný stav v dni: 'Žádné celodenní úkoly' (ř. 2805). V týdnu filtr (!t.endDate && tIso===c.iso) — vícedenní jdou do pruhů, ne do chipů (ř. 2798).
- **Stav app:** Calendar.tsx:294-325 — all-day chipy jsou nacpané do hlavičky dne (slice(0,3) — 4.+ úkol tiše zmizí bez „+N“), bez checkboxu, bez tečky projektu, bez labelu CELÝ DEN, bez prázdného stavu, bez kliku pro přidání, truncate na 1 řádek, borderLeft jen 2px.
- **Fix:** Calendar.tsx: vyčlenit AllDayBand komponentu (gutter 46px 'CELÝ DEN', pruhy + chipy s checkboxem/tečkou/2-line clampem), bez slice(0,3); klik do prázdna otevře quick-add s předvyplněným datem bez času.

### [CRITICAL] Drag&drop přesun úkolů (bloky mezi dny, all-day⇄grid, měsíc)
- **Prototyp:** ř. 2673-2702 calBlockDown/_calMove/_calUp: pointer drag bloku, dmin=Math.round(dy/PPM/15)*15 (15min snap), cross-day přes weekGridEl idx=floor((clientX-left)/(width/7)) (ř. 2691), puštění nad allDayBandEl → {start:null,end:null,date} (ř. 2700); klik bez pohybu = otevřít detail (ř. 2701). ř. 2703-2707 adDragStart/dropToAllDay/dropToGrid: HTML5 drag all-day chipu do gridu nastaví start=min a zachová trvání (dur=end-start||60). ř. 2708-2710 monthDragStart/monthDropTo: přetažení chipu v měsíci na jiný den. Během tažení badge s časem (ř. 2781: mono 9.5px bílá na var(--w-navy)) a cursor grabbing.
- **Stav app:** Calendar.tsx — žádný onPointerDown/draggable/onDrop nikde (bloky ř. 371-400 jen onClick), CalendarMonth.tsx čipy jen onClick (ř. 154). README: „Drag & drop … v kalendáři; přeplánování přetažením“.
- **Fix:** Calendar.tsx: port calBlockDown/_calMove/_calUp na pointer eventy s refs na grid (výpočet sloupce), zápis přes powerSync UPDATE tasks SET start_date/due_date/duration_min; all-day chipy draggable + onDrop na sloupce gridu i band; CalendarMonth: draggable chip + onDrop buňky.

### [CRITICAL] Drag-create tažením v prázdné mřížce (ghost s časem)
- **Prototyp:** ř. 2667-2669 _calCreateDown/Move/Up: pointerdown v prázdném sloupci (ne na [data-evblock]) → anchor zaokrouhlený na 15 min; tažením vzniká rozsah (min 15 min, end=start+30 default); pointerup s moved → openAdd s dd.time=fmt(c.start), dd.duration=c.end-c.start. ř. 2670 createGhost: position:absolute, background:var(--brass-soft), border:'1.5px dashed var(--brass)', borderRadius:6px, zIndex:8, uvnitř mono 9.5px 700 brass-text 'HH:MM–HH:MM'.
- **Stav app:** Calendar.tsx — nic; TimeGrid sloupce nemají žádné pointer handlery (ř. 341-404). Komentář ř. 33 přiznává „drag-create/resize odloženo“, ale uživatel to odmítl — je to součást handoffu (README §Kalendář: „drag-create tažením“).
- **Fix:** Calendar.tsx TimeGrid: lokální state {date,start,end} z pointerdown/move/up na sloupci, ghost div dle ř. 2670, po puštění otevřít quick-add (AddTask) s předvyplněným časem+trváním.

### [CRITICAL] Resize trvání bloku (úchyty nahoře/dole)
- **Prototyp:** ř. 2782 a 2793: neviditelné úchyty h('div',{onPointerDown:this.calBlockDown(t.id,'top'|'bottom'), style:{position:'absolute',top/bottom:0,left:0,right:0,height:'5px',cursor:'ns-resize',zIndex:4}}); logika ř. 2694-2695: mode 'top' → ns=max(DAY_START,min(e0-15,s0+dmin)); 'bottom' → ne=min(DAY_END,max(s0+15,e0+dmin)) — 15min krok, min. délka 15 min.
- **Stav app:** Calendar.tsx bloky (ř. 371-400) — žádné úchyty, výška se počítá z duration_min ?? 60 a nejde měnit.
- **Fix:** V bloku TimeGrid přidat 2 úchyty 5px s pointer capture; na up uložit duration_min (bottom) resp. start_date čas + duration (top).

### [CRITICAL] Klik do prázdné mřížky / pásu = nový úkol s předvyplněným časem
- **Prototyp:** ř. 2666 gridClickAdd: min=round((clientY-rect.top)/PPM/15)*15 → ř. 2664 openAddAt: dd.customDate=iso, dd.time=fmt(min) → otevře quick-add kartu; ř. 2665 addAllDayAt: totéž bez času (dd.time=''). Ignoruje klik na [data-evblock] a po drag-create (_suppressClick).
- **Stav app:** Calendar.tsx — klik do prázdna nedělá nic (sloupce nemají onClick), all-day oblast taky ne.
- **Fix:** TimeGrid sloupec onClick → spočítat minutu z offsetu, otevřít globální AddTask (lib/addTask kontext, pokud existuje — jinak dialog) s date+time; AllDayBand onClick → date bez času.

### [CRITICAL] Menu „Možnosti zobrazení“ (ozubené kolo): Hustota + Barevný okraj karty
- **Prototyp:** ř. 504-517: tlačítko 34×34 s gear SVG (viewBox 0 0 16 16, ř. 506), popover 212px (top:40px right:0, radius 12, shadow, padding 12): sekce „Hustota“ s taby Vyvážené/Vzdušné (ř. 512) → setDensity, PPMOPT={comfortable:0.62, spacious:0.95} (ř. 1912, setDensity ř. 2662, persistuje se ř. 2199); sekce „Barevný okraj karty“ (ř. 515-516) → cycleBorder priorita⇄projekt (ř. 2663): všechna borderLeft barvení pak this.state.calBorder==='project'? proj.color : var(--p{n}) (např. ř. 2775). Zobrazuje se jen mimo měsíc (showGearBtn ř. 3227).
- **Stav app:** Calendar.tsx — PPM je konstanta 0.62 (ř. 11), okraje vždy priorita (ř. 248, 311, 382), žádné gear menu, nic se nepersistuje kromě mode.
- **Fix:** Calendar.tsx: stavy calDensity (PPM) a calBorder v localStorage, gear popover dle markup ř. 504-529; barvící funkce borderColor(t) sdílená pro blok/chip/pruh/měsíc.

### [CRITICAL] Postranní panel „Plánování“ (Zpožděné + Bez termínu, Přeplánovat)
- **Prototyp:** ř. 533-554: pravý panel width:272px, borderLeft 1px var(--line), padding 16px: nadpis „Plánování“ (display 800 14px) + text „Přetáhni úkol do mřížky, nebo bloky posouvej a roztahuj.“ (11.5px ink-3); skupiny z ř. 3117: {label:'Zpožděné', count, reschedule:true → odkaz „Přeplánovat“ brass} a {label:'Bez termínu' = group today && start==null}; karty úkolů (ř. 544-550): tečka projektu 7px + název 12.5px + dueLabel mono 10.5px, hover border-color:var(--brass). Toggle v gear menu „Postranní panel → Plánování“ (ř. 519-523), jen mimo měsíc (showPlanning ř. 3116).
- **Stav app:** Calendar.tsx — neexistuje vůbec.
- **Fix:** Calendar.tsx: nový PlanningPanel (vpravo od gridu, flex layout), skupiny ze stejných tasks (overdue = due<today && !completed; bez termínu = dnešní bez času), karty draggable do gridu; toggle stav v localStorage.

### [MAJOR] Checkbox (odškrtnutí) chybí v time-grid blocích, týdenních sloupcích i all-day chipech
- **Prototyp:** ř. 2762 calCheck(t,size): kruhový checkbox border:'1.6px solid '+(done?var(--success-ink):var(--ink-3)), po dokončení zelená výplň s ✓; nasazený v eventBlock (ř. 2783 narrow absolutně vpravo nahoře / ř. 2785 float:right, velikost 12-13), weekListChip (ř. 2590, absolute top:3px right:3px, 13px), all-day chip (ř. 2801, 13px), vícedenní pruh (ř. 2815, 12px), měsíc (ř. 2881, 11px). README: „Odškrtávání přímo v kalendáři ve všech pohledech.“
- **Stav app:** Checkbox má jen CalendarMonth.tsx:164-180. Calendar.tsx: bloky gridu (ř. 371), WeekColumns chipy (ř. 242) i all-day chipy (ř. 304) jsou jen onClick=open bez checkboxu.
- **Fix:** Vytáhnout CalCheck komponentu (dle ř. 2762, stopPropagation + toggleTask) a vložit do bloku (float right / narrow absolute), week chipu i all-day chipu.

### [MAJOR] Event blok v gridu: chybí konec času, meta řádek (projekt+avatar), ↻, přeškrtnutí, tooltip, výška podle start–end
- **Prototyp:** ř. 2763-2795 eventBlock: timeStr=fmt(es)+'–'+fmt(ee); title tooltip name·čas·projekt·osoba (ř. 2779); název 11px (narrow 10.5px) s vypočteným nameLines clampem, done → line-through + color ink-3 + opacity .58 + borderLeft var(--line); recurring → name+' ↻' (ř. 2787); tečka projektu 6px inline (ř. 2786); meta při height>=58 && !narrow (ř. 2789-2792): název projektu 9.5px ellipsis + avatar iniciály 15px kruh var(--avatar-navy); výška (ee-es)*PPM min 22 (ř. 2768); narrow varianta při widthPct<46. Čas se v bloku NEzobrazuje textem (jen v tooltipu/badge při tažení).
- **Stav app:** Calendar.tsx:367-400 — blok ukazuje 'HH:MM' start inline před názvem (prototyp nemá), výška z duration_min ?? 60 místo end času, žádný tooltip, žádné meta, žádné ↻, done jen opacity (bez line-through/šedé), min výška 20 místo 22; startMin (ř. 17-25) bere 00:00 jako bez času — úkol explicitně o půlnoci spadne do all-day (prototyp rozlišuje start==null).
- **Fix:** Přestavět blok 1:1 dle ř. 2763-2795: layout name-row s float checkboxem + tečkou, meta řádek, title atribut, výšku z duration/end, odstranit inline čas, ošetřit done stav.

### [MAJOR] Překryvy bloků: lane layout + „+N“ dashed box při 4+ souběžných
- **Prototyp:** ř. 2248-2255 layoutDay: greedy lane přiřazení do clusterů (kolize podle start/end), map[id]={lane,cols}; ř. 2730-2760 eventsNode: bloky left=lane*100/cols %, width=100/cols %; při cols>MAX(3) šířka W=100/3.8, skryté lane>=3 → dashed box '+N' (border:'1px dashed var(--ink-3)', background:var(--panel-2), radius 6, 11px 700) s title 'N dalších úkolů v tomto čase — otevřít den' a onClick → setState({calMode:'day', calCur}) (ř. 2755).
- **Stav app:** Calendar.tsx:367-400 — všechny bloky mají left:2/right:8, překrývající se úkoly se vykreslí přes sebe; žádné lanes, žádné +N.
- **Fix:** Portovat layoutDay do Calendar.tsx (čistá funkce nad {id,start,end}), aplikovat left/width % a doplnit +N box s přepnutím na den.

### [MAJOR] „Teď“ linka bez časového štítku
- **Prototyp:** ř. 2624 nowLineNode(withLabel): linka 2px var(--overdue) + tečka 8px vlevo + při withLabel pill s aktuálním časem: mono 9px 700, color #fff, background:var(--overdue), borderRadius 4px, padding '1px 4px', left:4px top:-15px. Den (ř. 2838) i dnešní sloupec týdne (ř. 2857) volají s withLabel=true.
- **Stav app:** Calendar.tsx:355-364 — jen linka + tečka, štítek s časem chybí; navíc nowMin se spočítá jen při renderu (neaktualizuje se).
- **Fix:** Doplnit label pill dle ř. 2624 a interval (60 s) pro obnovu pozice.

### [MAJOR] Podbarvení dnešního sloupce a víkendu v časové mřížce
- **Prototyp:** ř. 2857 (týden): background: w.today?'var(--brass-soft)':((w.wl==='So'||w.wl==='Ne')?'rgba(120,120,140,.045)':'transparent'); ř. 2834 (den): background: isTod?'var(--brass-soft)':'transparent'. Hlavička dnů má dnešek brass-text (ř. 2848-2849). Screenshot 04: čtvrtkový sloupec zřetelně krémový, So/Ne šedavé.
- **Stav app:** Calendar.tsx:345 — sloupce gridu bez pozadí (jen border-l); dnešek se pozná pouze v DayHead barvou textu.
- **Fix:** Na sloupec gridu přidat background dle iso===todayIso / getDay()∈{0,6}; totéž pro all-day sloupce (ř. 2799 brass-soft).

### [MAJOR] Týden „Sloupce“ má úplně jiný markup než prototyp (weekListChip)
- **Prototyp:** ř. 2599-2620 buildWeekList: hlavičková lišta (uppercase 10.5px + mono 15px číslo, dnešek brass na brass-soft, ř. 2601-2606); sloupce oddělené jen borderLeft 1px var(--line) (žádné rounded karty), dnešek bg rgba(198,138,62,.05), víkend rgba(120,120,140,.04), padding '6px 4px', gap 4px; prázdný den → '—' centrované 11px opacity .5 (ř. 2616); řazení all-day první, pak dle času (ř. 2612). Chip ř. 2582-2598: bílý var(--panel), borderLeft 3px priorita/projekt, radius 7px, padding '5px 6px', shadow-sm, checkbox absolute top-right 13px, tečka projektu 6px, název 11.5px display 600 clamp 3 řádky, ↻ brass u opakovaných, dole timeStr 'Celý den' (brass-text) nebo 'HH:MM–HH:MM' mono 9.5px, draggable + title tooltip.
- **Stav app:** Calendar.tsx:213-263 WeekColumns — rounded bordered buňky s min-h 300 (prototyp nemá), dnešek border brass (prototyp ne), chipy à la měsíc: borderLeft 2px jen priorita, padding 3px 5px, font 10.5, bez checkboxu, bez času, bez ↻, bez clampu, bez drag, bez '—', DayHead uvnitř buňky místo hlavičkové lišty.
- **Fix:** Přepsat WeekColumns dle buildWeekList: společná hlavička, ploché sloupce s dělicími linkami a tintem, chip komponenta dle weekListChip vč. časového řádku a checkboxu.

### [MAJOR] Měsíc: neklikací „+N další“, chybí čas + avatar v chipu, dny mimo měsíc se vykreslují
- **Prototyp:** ř. 2863-2891 buildMonth: buňky gridAutoRows:'126px' (fixní, overflow:hidden), gap 6px; prázdné pozice před 1. dnem = transparentní div bez rámečku (ř. 2872), dny cizích měsíců se NEzobrazují; chip (ř. 2879-2886): checkbox 11 + tečka 5px + název 10.5px + čas mono 8px (start? fmt(start) : 'celý den' brass-text) + avatar iniciály 13px kruh var(--avatar-navy), title tooltip name·projekt·čas·osoba, draggable; „+N další“ (ř. 2887): klikací → setState({calMode:'day', calCur:new Date(y,mo,d)}), title 'Zobrazit všech N úkolů v tomto dni', hover background:var(--brass-soft).
- **Stav app:** CalendarMonth.tsx:117-208 — vykresluje 6 týdnů včetně ztlumených dnů okolních měsíců (ř. 118-137, opacity .55 + panel-2), buňky min-h (rostou), chip bez času a avatara, title jen name, „+N další“ je nekликací span (ř. 198-205), žádný drag.
- **Fix:** CalendarMonth: přejít na cells=[null…,1..dim] dle ř. 2869, fixní výšku řádků, doplnit čas+avatar do chipu, +N s onClick → přepnout Calendar na day mode s daným datem (vytáhnout setMode/setDate callback prop), drag mezi buňkami.

### [MAJOR] Výchozí režim a persistence: prototyp startuje Týden+Sloupce, app Měsíc+Mřížka
- **Prototyp:** ř. 1901: calMode:'week', … weekView:'list' (=Sloupce); ř. 1908+2199: calDensity/calBorder se persistují; setCal (ř. 2578) nemění aktuální datum (calCur zůstává), Dnes v týdnu skočí na pondělí aktuálního týdne (ř. 2661).
- **Stav app:** Calendar.tsx:42-52 — default mode 'month' (fallback), weekView default 'grid' (ř. 52) a nepersistuje se; setMode resetuje offset→0, takže přepnutí Den⇄Týden⇄Měsíc vždy skočí zpět na dnešek (prototyp drží prohlížené datum).
- **Fix:** Default mode='week', weekView='cols' + persist weekView; místo čistého offsetu držet kotevní datum (calCur) sdílené mezi režimy a offset z něj derivovat.

### [MAJOR] Hlavička dnů v mřížce: špatný formát a umístění (i v Den view navíc)
- **Prototyp:** ř. 2846-2851 (týden-mřížka): centrované sloupce s marginLeft:46px — uppercase label 10.5px 700 letterSpacing .03em + POD ním číslo dne mono 15px (bez tečky), dnešek obojí brass-text; den view hlavičku dne NEMÁ (jen all-day band, ř. 2830; datum je v range labelu toolbaru). Screenshot 04: 'ČT' nad '25'.
- **Stav app:** Calendar.tsx:411-425 DayHead — inline baseline řádek 'ČT 25.' (s tečkou, 12px číslo vedle labelu), vložený do každé hlavičkové buňky vč. day view.
- **Fix:** DayHead přepsat na sloupcový (label nad mono 15px číslem, centrovat), v day mode hlavičku nevykreslovat.

### [MAJOR] Kalendář není dostupný z Nadcházející (přepínač Seznam/Nástěnka/Kalendář)
- **Prototyp:** README ř. 19: „Nadcházející — … přepínač Seznam / Nástěnka / Kalendář“; prototyp goTo + viewIs.calendar funguje pro nadchazejici (ř. 2257, šablona ř. 488).
- **Stav app:** screens/Nadchazejici.tsx — pouze seznam (žádný view switcher, Calendar se importuje jen v Ukoly.tsx).
- **Fix:** Nadchazejici.tsx: přidat stejný view přepínač jako Ukoly a renderovat <Calendar tasks={…}/>.

### [MINOR] Klávesové zkratky kalendáře ignorují otevřené panely a nescrollují na „teď“
- **Prototyp:** ř. 2228-2235: ←/→/d/1/2/3 jen když !addOpen && !selectedId && !selectedProject && !selectedMember && !selectedFlow; calToday (ř. 2661) nastaví _needScroll7 → componentDidUpdate (ř. 2239) scrolluje na aktuální čas (nowMin-90) v dnešním dni, jinak 8:00.
- **Stav app:** Calendar.tsx:86-106 — handler guarduje jen typing/mod klávesy; s otevřeným detailem úkolu ←/→ přepíná období a 1-4 koliduje s nastavením priority v seznamu (Ukoly.tsx:118-121). Scroll jen na 7:00 při mountu TimeGrid (ř. 286-289), 'd' nescrolluje.
- **Fix:** Do handleru přidat guard na openId z useTaskDetail (a případný add dialog); po 'Dnes'/'d' nastavit scrollTop na nowMin*PPM-90.

### [MINOR] Hodinová osa: chybí linka 24:00, bottom padding a plná výška
- **Prototyp:** ř. 2725 calHours() = 0..24 včetně (25 linek); grid padding '0 0 40px 0' (ř. 2860), labely mono 10px right:6px (ř. 2832), linky bez opacity; kalendář vyplňuje výšku obrazovky (flex:1 minHeight:0, ř. 2840).
- **Stav app:** Calendar.tsx:331-352 — 24 linek (0..23), labely 9.5px, linky s opacity:0.6, kontejner maxHeight:'62vh' (ř. 327), bez bottom paddingu.
- **Fix:** length:25, odstranit opacity, labely 10px, výšku řešit flexem na celou obrazovku obsahu + padding-bottom 40px.

### [MINOR] Toolbar kalendáře: SVG chevrony, oddělená lišta, tooltips přepínače, aktivní tab token
- **Prototyp:** ř. 491-503: lišta s border-bottom:1px var(--line), padding '10px 18px'; šipky = SVG chevron 14px v 30×30 hover background:var(--panel-2) (ř. 493, 495); Dnes hover border-color:var(--brass)+color brass-text (ř. 494); Sloupce/Mřížka mají title='Sloupcový přehled — čitelné názvy' / 'Časová mřížka — přesné časy' (ř. 503); aktivní tab CSS ř. 50-51: [data-tab][data-active=true]{background:var(--panel)}.
- **Stav app:** Calendar.tsx:121-198 — textové ‹ › glyfy, žádná border-bottom lišta (jen mb-3), žádné title atributy, aktivní tab používá var(--w-card).
- **Fix:** Nahradit glyfy inline SVG (path M9 3 L5 7 L9 11), obalit toolbar do lišty s border-b, doplnit title atributy; sjednotit aktivní pozadí na panel token.

### [MINOR] Horizontální wheel navigace obdobím (calWheel)
- **Prototyp:** ř. 2671 calWheel: při |deltaX|>|deltaY| akumuluje deltu, krok 32px → posun dne/týdne (shiftCur) nebo měsíce (monthOffset), max 8 kroků na event; napojeno na hlavičku i grid (ř. 2607, 2830, 2840, 2852, 2860, 2891).
- **Stav app:** Calendar.tsx — žádný onWheel handler.
- **Fix:** Přidat onWheel na wrapper gridu/měsíce s akumulátorem dle ř. 2671 (posun offsetu).

### [MINOR] Barva úkolu (data-tc) se v kalendáři nepromítá do pozadí karet
- **Prototyp:** CSS ř. 60-63: [data-tc=rose]{background:#fbeceb !important} … 10 barev + dark variant; ř. 117: [data-done=true][data-tc]{background:var(--panel)}. Atribut nese eventBlock (ř. 2779), weekListChip (ř. 2588), all-day chip (ř. 2800), vícedenní pruh (ř. 2813).
- **Stav app:** Calendar.tsx / CalendarMonth.tsx — tasks.color existuje ve schématu (AppSchema ř. 16), ale kalendářové karty ho ignorují (vždy bg-panel-2/card).
- **Fix:** Mapovat t.color → světlé pozadí (sdílená mapa tokenů s TaskItem, pokud existuje) na blok/chip/pruh, s override na panel u done.


## Detail úkolu + detail výskytu (screenshots 15, 16) — 30 %

### [CRITICAL] Detail výskytu opakovaného úkolu (screen 16) zcela chybí — banner „↻ Výskyt řady“ + odkaz na base úkol
- **Prototyp:** WatsonApp.dc.html ř. 999–1008: `<sc-if value="{{ detail.isOcc }}"><div style="margin:14px 0 0; padding:11px 13px; background:var(--panel-2); border:1px solid var(--line); border-radius:11px;"><span style="…font-weight:700; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--brass-text);">↻ Výskyt řady</span><span style="font-family:var(--w-font-mono); font-size:12px;">{{ detail.occLabel }}</span>…{{ detail.seriesRepeat }}. Dokončení a přeskočení platí jen pro tento výskyt; změny názvu, priority a osob mění celou řadu.…<div onClick="{{ detail.onOpenSeries }}" …color:var(--brass-text)" style-hover="text-decoration:underline">Upravit celou řadu →</div>`. Resoluce virtuálního id ř. 2646–2653: `_occId(baseId,iso){ return baseId+'@'+iso; } … resolveTask(id){ …const sp=this._splitOcc(id); const base=…; return base?this.makeOcc(base, sp.iso):null; }` a ř. 3119: `if(s.selectedId){ const t=this.resolveTask(s.selectedId); if(t) detail=this.decorateDetail(t,multi); }`; `openSeries` ř. 2481 přepne selectedId na baseId. Lidský popis řady ř. 2933: `seriesRepeat: (t.repeatLabel || ({daily:'Opakuje se denně',weekly:'Opakuje se týdně',biweekly:'Opakuje se po 14 dnech',monthly:'Opakuje se měsíčně',yearly:'Opakuje se ročně'})[t.repeat] || 'Opakovaný úkol')`.
- **Stav app:** apps/web/src/components/TaskDetailPanel.tsx:63 dělá jen `SELECT * FROM tasks WHERE id = ? LIMIT 1` — virtuální id `uuid@YYYY-MM-DD` nikdy nenajde řádek a ř. 125 `if (!task) return null` panel tiše nevykreslí. Žádný banner, žádné `isOcc`, žádné „Upravit celou řadu →“. Lib apps/web/src/lib/occurrences.ts přitom `occId/parseOccId/isOccId` už exportuje (ř. 71–76), ale TaskDetailPanel je neimportuje.
- **Fix:** TaskDetailPanel.tsx: na začátku Panel rozparsovat id přes `parseOccId` z lib/occurrences.ts; při výskytu načíst base task podle `taskId`, datum výskytu z `iso`, vyrenderovat banner (panel-2 bg, border line, radius 11, uppercase brass „↻ Výskyt řady“ + mono datum `čt 2. 7.`, vysvětlující text s lidským popisem z `task.recurrence`, odkaz „Upravit celou řadu →“ = `open(taskId)`). Editační pole (název, priorita, přiřazení) při výskytu patchují base úkol (= celou řadu), done/skip jen výjimku.

### [CRITICAL] Per-výskyt dokončení a přeskočení (exceptions) chybí včetně datové vrstvy
- **Prototyp:** WatsonApp.dc.html ř. 2477: `skipOccurrence = (id) => () => { …const sp=this._splitOcc(id); …ex[sp.iso]=Object.assign({}, ex[sp.iso]||{}, { skipped:true }); return Object.assign({},t,{exceptions:ex}); }), selectedId:null… }, ()=>this._flowToast('Výskyt přeskočen · '+this._occLabel(sp.iso)))`; ř. 2482 toggleDone větev pro výskyt: `if(this._isOccId(id)){ …ex[sp.iso]=Object.assign({}, c, { done: !c.done }); …}`; ř. 2652 `makeOcc` merguje `(base.exceptions&&base.exceptions[iso])||{}` do zobrazeného úkolu (done, time, start/end, priority). Tlačítko ř. 1075: `<sc-if value="{{ detail.isOcc }}"><button onClick="{{ detail.onSkip }}" …>Přeskočit</button></sc-if>` (viz screenshot 16 dole).
- **Stav app:** Nikde v apps/web ani apps/api neexistuje tabulka/sloupec pro výjimky (grep `exceptions|skipped` najde jen chain step_state). AppSchema.ts (ř. 8–135) má tasks/assignments/checklist_items/comments/reminders/chains — žádné occurrence overrides. toggleTask (lib/tasks.ts:16–23) umí jen `completed_at` celého úkolu.
- **Fix:** Přidat tabulku `task_occurrence_overrides` (id, task_id, project_id, occ_date, done, skipped, created_at) do apps/api migrací + powersync sync-config.yaml (pozor na restart watson-powersync) + AppSchema.ts. V TaskDetailPanel u výskytu: „Označit hotovo“ → upsert override {done}, „Přeskočit“ → upsert {skipped:true} + zavřít panel + toast „Výskyt přeskočen · čt 2. 7.“. Nadcházející/kalendář při projekci výskytů overrides odfiltrují (skipped) a označí (done).

### [CRITICAL] Chybí spodní akční lišta „Označit hotovo / (Přeskočit) / Zavřít“
- **Prototyp:** WatsonApp.dc.html ř. 1073–1077: `<div style="display:flex; gap:9px; padding:13px 18px; border-top:1px solid var(--line);"><button onClick="{{ detail.onToggle }}" style="flex:1; …font-weight:700; font-size:13px; color:#fff; background:var(--brass); border:none; border-radius:10px; padding:10px;" style-hover="filter:brightness(1.06)">Označit hotovo</button><sc-if value="{{ detail.isOcc }}"><button …background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:10px 14px;">Přeskočit</button></sc-if><button onClick="{{ closeTask }}" …>Zavřít</button></div>` — dominantní prvek obou screenshotů 15 i 16.
- **Stav app:** TaskDetailPanel.tsx nemá žádný footer — obsah končí sekcí komentářů (ř. 508–531), `</aside>` na ř. 532. Dokončení jde jen přes malý kroužek v hlavičce (ř. 213–224).
- **Fix:** TaskDetailPanel.tsx: aside přepnout na `flex flex-col` s body `flex-1 overflow-y-auto` (teď scrolluje celý aside, ř. 205) a přidat footer `border-t border-line px-[18px] py-[13px] flex gap-[9px]`: brass tlačítko flex-1 „Označit hotovo“ (volá toggleDone), u výskytu sekundární „Přeskočit“, vždy sekundární „Zavřít“ (panel-2 bg, border line, radius 10).

### [CRITICAL] Dokončení opakovaného base úkolu neposouvá řadu na další termín
- **Prototyp:** WatsonApp.dc.html ř. 2482 (toggleDone): `if(cur && !cur.flowId && !cur.done && cur.repeat && cur.repeat!=='none'){ const doneCount=(cur.repeatDoneCount||0)+1; const endKind=cur.repeatEndKind||'never'; const reachedCount = endKind==='count' && doneCount>=(cur.repeatCount||1); const next = reachedCount ? null : this._nextOccISO(cur); if(next){ …tasks.map(t=> t.id===id?Object.assign({},t,{ iso:next, …repeatDoneCount:doneCount, done:false… }` + callback toast `this._flowToast('Posunuto na '+this.deadlineFmt(advancedTo)…)`. README ř. 67: „Dokončení základního výskytu posouvá celou řadu na další termín (repeatDoneCount); dokončení budoucího výskytu jen označí ten jeden den.“
- **Stav app:** lib/tasks.ts:16–23 `toggleTask` a TaskDetailPanel.tsx:135–138 `toggleDone` jen zapíší `completed_at` — opakovaný úkol se dokončením natrvalo uzavře a z Nadcházejícího zmizí celá řada (projekce v Nadchazejici.tsx jede z base `due_date`).
- **Fix:** V lib/tasks.ts (a v detail toggleDone) rozvětvit: pokud task má `recurrence_rule` a není hotový, spočítat další ISO přes `advance()` z lib/occurrences.ts, `UPDATE tasks SET due_date = next` (completed_at nechat NULL), zobrazit toast „Posunuto na …“. Respektovat budoucí `repeat_until/repeat_count` (sloupce zatím ve schématu chybí — přidat).

### [CRITICAL] Watson hint pruh (brass box s kontextovou radou) chybí
- **Prototyp:** WatsonApp.dc.html ř. 1018–1021: `<div style="display:flex; gap:9px; align-items:flex-start; margin:18px 0 0; padding:12px 14px; background:var(--brass-soft); border-radius:11px;"><span style="width:18px; height:18px; border-radius:50%; border:1.6px solid var(--brass); color:var(--brass-text); …font-weight:800; font-size:10px;">W</span><span style="font-size:13px; color:var(--ink-2); line-height:1.5;">{{ detail.hint }}</span></div>`. Logika ř. 2930: `const hint = t.overdue ? 'Tenhle úkol je po termínu — chceš ho přehodit na dnes dopoledne?' : (t.assignMode==='all' ? 'Režim „každý zvlášť" — sleduju postup po jednotlivých lidech.' : 'Stačí, když to zvládne kdokoli z přiřazených.');` — viditelný na obou screenshotech 15 i 16.
- **Stav app:** TaskDetailPanel.tsx žádný takový box nemá; režimová věta je jen malý šedý text pod přepínačem režimu (ř. 456–460).
- **Fix:** TaskDetailPanel.tsx: pod řádek chipů vložit box `bg-brass-soft rounded-[11px] px-3.5 py-3 flex gap-[9px]` s kroužkem „W“ (18 px, border 1.6px brass) a textem podle stejné logiky (po termínu / shared_all / jinak) — texty dát do i18n `detail.hintOverdue/hintAll/hintAny`.

### [CRITICAL] Menu ⋯ (Duplikovat / Kopírovat odkaz / Smazat úkol) chybí; Duplikovat neexistuje vůbec
- **Prototyp:** WatsonApp.dc.html ř. 980–988: tři tečky `<svg…><circle cx="8" cy="3.5" r="1.4"/>…` + dropdown `width:210px; …border-radius:11px; box-shadow:var(--shadow); padding:5px; animation:wPop .14s ease` s položkami „Duplikovat“ (ikona kopie), „Kopírovat odkaz“ (ikona řetězu), divider `height:1px; background:var(--line)`, „Smazat úkol“ červeně `color:var(--overdue)` hover `background:var(--overdue-soft)`. Duplicate ř. 2557: `const copy=Object.assign({},t,{ id:nid, name:t.name+' (kopie)', done:false… }); return { tasks:[copy, ...s.tasks], …justAdded:nid, selectedId:nid }`. Screenshot 15: v hlavičce je jen tečka projektu, název projektu, ⋯ a ×.
- **Stav app:** TaskDetailPanel.tsx:234–244 má místo menu holé tlačítko koše (okamžité smazání bez menu), duplikace ani kopírování odkazu neexistují nikde v apps/web.
- **Fix:** TaskDetailPanel.tsx: nahradit koš tlačítkem ⋯ s popover menu (210 px, radius 11, shadow): Duplikovat = INSERT kopie řádku tasks s `name || ' (kopie)'` + otevřít nový detail; Kopírovat odkaz = `navigator.clipboard.writeText(location.origin + '/ukol/' + id)`; divider; Smazat úkol červeně (stávající DELETE).

### [MAJOR] Řádek chipů (Priorita P· / termín s časem / stav / ↻ Opakuje se / Připomenutí) nahrazen formulářovou mřížkou
- **Prototyp:** WatsonApp.dc.html ř. 1010–1016: `<div style="display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 0;"><span style="…font-weight:600; font-size:11.5px; padding:4px 10px; border-radius:999px; background:var(--panel);" data-pri="{{ detail.pri }}">Priorita {{ detail.priLabel }}</span><sc-if value="{{ detail.hasDue }}"><span style="font-family:var(--w-font-mono); font-size:11.5px; padding:5px 10px; border-radius:999px; background:var(--panel-2);" data-due="{{ detail.dueAttr }}">{{ detail.dueLabel }}</span></sc-if><sc-if value="{{ detail.hasStatus }}"><span …data-status="{{ detail.status }}">{{ detail.statusLabel }}</span></sc-if><sc-if value="{{ detail.recurring }}"><span …background:var(--panel-2); color:var(--ink-2);">↻ Opakuje se</span></sc-if><sc-if value="{{ detail.reminder }}"><span …>Připomenutí</span></sc-if></div>`. CSS ř. 52–54: `[data-pri]{ border:1px solid var(--line); color:var(--ink-2); } [data-pri="1"]{ border-color:var(--ink-3); color:var(--ink); } [data-pri="4"]{ color:var(--ink-3); }`; ř. 65–67+74 status/due barvy. Screenshot 15: pills „Priorita P2“ a „zítra · 13:00“ hned pod názvem.
- **Stav app:** TaskDetailPanel.tsx:278–328 renderuje label+input mřížku (P1–P4 barevná tlačítka v prioritních barvách, `<input type=date>` pro termín/začátek/deadline, barevná paleta). Chybí: pill vzhled, čas u termínu (chip „zítra · 13:00“ — čas se nikde nezobrazuje, `duration_min` ve schématu je ale v detailu ignorován), stavový chip Probíhá/Ke kontrole/Hotovo (tabulka statuses existuje), „↻ Opakuje se“ pill (recurrence je jen malý text ř. 265–270), „Připomenutí“ pill je zalomený u názvu (ř. 272–276) místo v řadě chipů.
- **Fix:** TaskDetailPanel.tsx: pod název přidat flex-wrap řádek chipů 1:1 (monochromní data-pri vzhled — border line, P1 tmavší, NE prioritní barvy; mono font pro termín vč. času z due_date+čas/duration_min; status z tabulky statuses; ↻ Opakuje se; Připomenutí). Editace polí nechat, ale až POD chips (nebo chipy udělat klikací → otevřou příslušný editor), aby první pohled odpovídal screenshotu.

### [MAJOR] Checkbox úkolu patří vedle názvu (22 px kruh), ne do hlavičky; název 19 px bold bez inputového podtržení
- **Prototyp:** WatsonApp.dc.html ř. 993–997: `<div style="display:flex; align-items:flex-start; gap:11px;">` + nehotový: `<span onClick="{{ detail.onToggle }}" style="width:22px; height:22px; border-radius:50%; border:2px solid var(--line); …margin-top:2px;" style-hover="border-color:var(--brass)"></span>` / hotový: `background:var(--brass)` s bílou fajfkou; název `<div style="…font-weight:700; font-size:19px; line-height:1.25; color:var(--ink);">{{ detail.name }}</div>`. Hlavička (ř. 977–979) obsahuje jen 9px tečku projektu + název projektu `font-weight:600; font-size:13px; color:var(--ink-2); flex:1`.
- **Stav app:** TaskDetailPanel.tsx:213–224 má 20px checkbox v hlavičce vedle projektu; název je `<input>` text-lg (18 px) na ř. 256–263 bez checkboxu, při done dostává line-through (prototyp v detailu nepřeškrtává). Projektový label je text-xs ink-3 (ř. 226–232) místo 13px w600 ink-2.
- **Fix:** TaskDetailPanel.tsx: checkbox přesunout z hlavičky do body vedle názvu (22 px kruh, hover brass, done = brass bg + bílá fajfka), název zvětšit na 19 px w700 (input se stejnou typografií, bez line-through), projektový řádek v hlavičce na 13 px w600 text-ink-2 flex-1.

### [MAJOR] Všechny „hotovo“ checkboxy používají zelenou (--w-success) místo brass
- **Prototyp:** Hlavní checkbox ř. 994: `background:var(--brass)`; podúkol ř. 1032: `width:17px; height:17px; border-radius:5px; background:var(--brass)` + bílá fajfka; per-osoba ř. 1043: `width:18px; height:18px; border-radius:50%; background:var(--brass)`. Brass = #c68a3e (README tokeny). V celém detail panelu prototypu není zelená ani jednou.
- **Stav app:** TaskDetailPanel.tsx: `var(--w-success)` na ř. 219–221 (hlavní), 364–366 (podúkoly), 406–408 (checklist), 478–480 (per-osoba) — zelené kroužky, navíc podúkoly kulaté místo hranatých.
- **Fix:** Ve všech čtyřech místech nahradit `var(--w-success)` za `var(--w-brass)`; podúkolový/checklistový checkbox předělat na 17 px čtverec `rounded-[5px]`, per-osoba nechat 18 px kruh; fajfku jako SVG path `M2 5.7 L4.3 8 L9 2.7` stroke #fff 1.7 místo textového ✓.

### [MAJOR] Komentáře bez avataru, autora a času; insert neukládá author_id ani created_at
- **Prototyp:** WatsonApp.dc.html ř. 1063–1067: `<div style="display:flex; gap:9px; margin-bottom:11px;"><span style="width:26px; height:26px; border-radius:50%; background:var(--avatar-navy); color:#fff; …font-size:10px;">{{ c.init }}</span><div><div style="…font-weight:600; font-size:12.5px;">{{ c.who }} <span style="…color:var(--ink-3); font-size:11px;">· {{ c.when }}</span></div><div style="…font-size:13px; color:var(--ink-2); margin-top:2px;">{{ c.text }}</div></div></div>` (např. „Adéla Kučerová · dnes 8:05“, ř. 2929).
- **Stav app:** TaskDetailPanel.tsx:513–519 renderuje jen `{cm.body}` v šedém boxu; SELECT (ř. 87–90) nebere author_id/created_at, ačkoli AppSchema comments je má (AppSchema.ts:109–118); INSERT (ř. 177–184) je nezapisuje → nové komentáře mají created_at NULL a rozbíjí i `ORDER BY created_at`.
- **Fix:** TaskDetailPanel.tsx: SELECT rozšířit o author_id, created_at; INSERT doplnit author_id (aktuální user z auth-client) + created_at; render 1:1 — 26px navy avatar s iniciálami, jméno w600 12.5px + „· relativní čas“ 11px ink-3, text 13px ink-2. Jména členů už máš v `team` query.

### [MAJOR] ↑/↓ (j/k) přepínání na předchozí/další úkol při otevřeném detailu chybí
- **Prototyp:** WatsonApp.dc.html ř. 2221–2225: `if(this.state.selectedId && !this.state.addOpen && !this.state.paletteOpen && !this.state.cheatOpen){ const ids=this._navIds||[]; const i=ids.indexOf(this.state.selectedId); if(i>=0 && (e.key==='ArrowDown'||e.key==='j'||e.key==='J')){ if(i<ids.length-1){ e.preventDefault(); this.setState({ selectedId:ids[i+1], kbSel:ids[i+1], taskMenu:null }); } return; } …ArrowUp||k…`. README ř. 31: „V panelu lze ↑/↓ přepínat na předchozí/další úkol v seznamu.“
- **Stav app:** keyboard.tsx nezná openId (žádný import taskDetail); TaskDetailPanel.tsx:56–62 poslouchá jen Escape. Seznamy nikam nepublikují pořadí id.
- **Fix:** Rozšířit TaskDetailCtx (lib/taskDetail.tsx) o `navIds: string[]` + `setNavIds` — každý seznam (Dnes/Úkoly/Nadcházející) po renderu zapíše viditelné pořadí. V TaskDetailPanel keydown handleru přidat ArrowUp/Down + j/k → open(navIds[i±1]).

### [MAJOR] Promítnuté výskyty v Nadcházejícím nejsou klikací — do detailu výskytu se nejde vůbec dostat
- **Prototyp:** README ř. 64: „Každý výskyt je klikací → otevře detail s bannerem ‚↻ Výskyt řady · <datum>‘.“ V prototypu jsou výskyty plnohodnotné položky (makeOcc ř. 2652 vrací kompletní task s `id:base+'@'+iso`, onOpen ř. 2907 `openTask(t.id)` funguje i pro ně) — se stejnou kartou jako běžný úkol vč. checkboxu.
- **Stav app:** Nadchazejici.tsx:137–158: výskyty jsou statické `<li>` s opacity 0.75, dashed borderem, bez onClick a bez checkboxu (jen tečka + ikona ↻ + název). CalendarMonth.tsx výskyty neexpanduje vůbec (komentář ř. 16 „Výskyty opakování zatím neexpandujeme“).
- **Fix:** Nadchazejici.tsx: výskytům dát onClick `open(occId(tk.id, od))` + checkbox (toggle → occurrence override z gapu #2) a vzhled běžné TaskCard s ↻ chipem; CalendarMonth/Calendar doplnit stejnou projekci přes expandOccurrences pro viditelný rozsah.

### [MINOR] Sekční nadpisy (PŘIŘAZENÍ, KOMENTÁŘE · N, PODÚKOLY, POPIS) nejsou uppercase s letter-spacingem
- **Prototyp:** WatsonApp.dc.html ř. 1024/1029/1038/1062 shodně: `font-family:var(--w-font-display); font-weight:700; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); margin:20px 0 7px;` — na screenshotu 15 zřetelně „PŘIŘAZENÍ“, „KOMENTÁŘE · 0“. Počet komentářů se ukazuje vždy (i · 0).
- **Stav app:** TaskDetailPanel.tsx používá `font-display font-semibold text-ink-3 text-xs` (12 px, bez uppercase/trackingu, ř. 332, 349, 392, 430, 509); počet komentářů jen když > 0 (ř. 511); sekce oddělené border-t (prototyp bez borderů, jen mezery 20/7 px).
- **Fix:** Zavést sdílenou třídu/komponentu SectionLabel: `text-[11px] font-bold uppercase tracking-[.06em] text-ink-3 mt-5 mb-[7px]`; komentáře vždy s `· {count}`; odstranit border-t oddělovače sekcí.

### [MINOR] Panel: chybí slide-in animace, navíc 4px prioritní border, slabší backdrop, šířka
- **Prototyp:** WatsonApp.dc.html ř. 976: `width:444px; max-width:94vw; background:var(--panel); border-left:1px solid var(--line); box-shadow:var(--shadow); …animation:wSlide .22s ease;` + ř. 43 `@keyframes wSlide { from { transform:translateX(26px); opacity:0; } to { transform:none; opacity:1; } }`; overlay ř. 975 `background:rgba(10,14,20,.34)`. Screenshot 15/16: levá hrana panelu je jemná 1px linka, žádný barevný pruh.
- **Stav app:** TaskDetailPanel.tsx:202–209: backdrop `bg-navy/20` (slabší), aside `max-w-md` (448 px), `borderLeft: 4px solid var(--w-p{priority})` — barevný pruh, který v prototypu detail panelu není — a žádná animace.
- **Fix:** TaskDetailPanel.tsx: šířku `w-[444px] max-w-[94vw]`, borderLeft `1px solid var(--w-line)`, backdrop `rgba(10,14,20,.34)`, přidat keyframes wSlide (translateX(26px)→0, .22s ease) do index.css a použít na aside.

### [MINOR] Podúkoly: chybí border-bottom řádků a klik na celý řádek
- **Prototyp:** WatsonApp.dc.html ř. 1031: `<div onClick="{{ s.onToggle }}" style="display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); cursor:pointer;">` — toggle na klik kamkoli do řádku, řádky oddělené linkou, text 13 px.
- **Stav app:** TaskDetailPanel.tsx:353–375: `<li className="flex items-center gap-2">` bez border-bottom, toggle jen na 16px kroužku, text text-sm (14 px). (Vstup „Přidat podúkol…“ je aditivní OK — prototyp add nemá.)
- **Fix:** Řádek podúkolu: `py-[7px] border-b border-line cursor-pointer` s onClick na celém li; checkbox 17px čtverec radius 5 brass (viz gap barvy); text 13 px.

### [MINOR] Komentářový vstup: jiný placeholder a textarea místo jednořádkového inputu
- **Prototyp:** WatsonApp.dc.html ř. 1070: `<input placeholder="Napsat komentář…" style="flex:1; border:1px solid var(--line); background:var(--panel-2); border-radius:9px; padding:8px 11px; …font-size:13px;"/>` — jednořádkový, přesně „Napsat komentář…“ (screenshot 15).
- **Stav app:** TaskDetailPanel.tsx:520–529: `<textarea rows={2}>` s placeholderem z i18n `detail.addComment` = „Napiš komentář… (⌘/Ctrl+Enter odeslat)“ (cs.json ř. ~55).
- **Fix:** Vyměnit za jednořádkový input, Enter odešle; cs.json `detail.addComment` → „Napsat komentář…“; radius 9, padding 8/11, font 13.

### [MINOR] Esc kaskáda rozbitá — detail se zavře i když je nad ním tahák/paleta
- **Prototyp:** README ř. 51: „Esc zavřít (kaskáda: tahák→paleta→přidání→postup→detail→projekt→člen→výběr)“ — Esc vždy zavře jen nejvrchnější vrstvu.
- **Stav app:** TaskDetailPanel.tsx:56–62 zavírá na Escape bezpodmínečně; keyboard.tsx:36–40 má vlastní handler pro tahák/paletu — oba listenery na window dostanou tentýž event, takže Esc při otevřeném taháku nad detailem zavře obojí najednou.
- **Fix:** Zavést sdílený overlay-stack (context s pushem vrstev) nebo v TaskDetailPanel před zavřením zkontrolovat, že není otevřen cheatsheet/palette/add modal (např. přes DOM marker či sdílený stav v KeyboardProvider) a `stopPropagation` v nejvrchnější vrstvě.

### [MINOR] Přiřazení: zobrazují se všichni členové projektu místo jen přiřazených; avatar šedne opacity
- **Prototyp:** WatsonApp.dc.html ř. 1050–1059 (režim any): seznam POUZE přiřazených — `<sc-for list="{{ detail.people }}">` (people = t.people, ř. 2927), řádek = 24px navy avatar `background:var(--avatar-navy)` + jméno 13 px; žádní ztlumení nepřiřazení, žádný přepínač režimu (režim je jen popisná věta ř. 1040/1051). Screenshot 15: pod „PŘIŘAZENÍ“ jen „Adéla Kučerová“.
- **Stav app:** TaskDetailPanel.tsx:461–504 vypisuje všechny členy projektu, nepřiřazené s `background: var(--w-line), opacity: 0.5`; nad tím trojice segment tlačítek Jeden/Stačí kdokoli/Každý zvlášť (ř. 433–455), kterou prototyp v detailu nemá.
- **Fix:** Primárně vypsat jen přiřazené (plný navy avatar + jméno, hint věty už sedí 1:1); přidávání řešit tlačítkem „+ Přiřadit“ s popoverem členů; přepínač režimu schovat do popoveru/rozbalení místo trvalé segmentované řady.

### [MINOR] Popis: prototyp zobrazuje čistý text (jen když existuje), app vždy textarea
- **Prototyp:** WatsonApp.dc.html ř. 1023–1026: `<sc-if value="{{ detail.hasDesc }}"><div …>Popis</div><div style="…font-size:13.5px; color:var(--ink-2); line-height:1.55;">{{ detail.desc }}</div></sc-if>` — sekce se bez popisu vůbec nerenderuje, text bez rámečku.
- **Stav app:** TaskDetailPanel.tsx:331–345: vždy viditelná orámovaná textarea s placeholderem „Přidej poznámku…“ i u úkolů bez popisu — screenshot 15 žádné prázdné pole nemá.
- **Fix:** Render: bez popisu jen nenápadné „+ Přidat popis“ (nebo nic + položka v ⋯ menu); s popisem text 13.5px ink-2 line-height 1.55, klik → přepne do editace (textarea bez trvalého rámu).

### [MINOR] Chybí toasty zpětné vazby („Výskyt přeskočen · …“, „Posunuto na …“)
- **Prototyp:** WatsonApp.dc.html ř. 2477 callback `this._flowToast('Výskyt přeskočen · '+this._occLabel(sp.iso))`; ř. 2482 `this._flowToast('Posunuto na '+…)`; vzhled toastu ř. 1083: navy pilulka dole uprostřed s brass tečkou.
- **Stav app:** apps/web má jen WriteRejectedToast.tsx (zamítnuté zápisy) — žádný obecný toast pro akce detailu/výskytů.
- **Fix:** Zobecnit WriteRejectedToast na sdílený toast (navy bg, brass tečka, bottom-center) a volat po skip/advance akcích z gapů #2 a #4.


## Projekty + detail projektu — 58 %

### [CRITICAL] Karty průběžných projektů: chybí aktivita-sparkline + týdenní statistiky
- **Prototyp:** ř. 717–723: pro kind==='flow' se místo progress baru kreslí {{ p.tepNode }} + řádek `<div style="display:flex; align-items:center; gap:13px; margin-top:9px; font-family:var(--w-font-mono); font-size:11.5px; color:var(--ink-3);"><span style="color:var(--success-ink);">✓ {{ p.weekDone }} týden</span><span>↑ {{ p.added }} nové</span><sc-if value="{{ p.hasOverdue }}"><span style="color:var(--overdue);">⚠ {{ p.overdueCount }}</span></sc-if></div>`. tepNode ř. 3181: 8 sloupků `display:flex,alignItems:flex-end,gap:3px,height:30px,marginTop:12px`, každý `flex:1, borderRadius:2px, background: i===7?'var(--brass)':'var(--panel-2)', border:1px solid var(--line)`, výška `Math.round(v/10*30)px`. Screenshot 07: karta „Provoz kanceláře“ má sloupkový graf + „✓ 4 týden ↑ 6 nové ⚠ 1“.
- **Stav app:** apps/web/src/screens/Projekty.tsx:355–368 — ProjectCard kreslí všem projektům jen progress bar + „% hotovo / N členů“; žádný sparkline, žádné weekDone/added/overdue řádky (kind se používá jen pro label a due).
- **Fix:** Projekty.tsx (ProjectCard): pro kind==='flow' vykreslit 8-sloupkový mini-graf (flex items-end gap-[3px] h-[30px] mt-3, poslední sloupek --w-brass, ostatní --w-panel-2 + border line) + mono řádek 11.5px se ✓ dokončenými za 7 dní, ↑ nově vytvořenými a ⚠ počtem po termínu — spočítat z tasks (completed_at >= now-7d, created_at >= now-7d, due < today & !done); dotaz v Projekty.tsx rozšířit o created_at/due.

### [CRITICAL] Detail projektu: členy nelze přidávat/odebírat (sekce Členové je read-only)
- **Prototyp:** ř. 1255–1258: `Členové · {{ projDetail.memberCount }}` + `<sc-for list="{{ projDetail.people }}" …><span onClick="{{ p.onClick }}" data-person data-on="{{ p.on }}" …>{{ p.initials }}</span>` — people = VŠICHNI lidé prostoru (ř. 3138 `people:this.PEOPLE.concat(s.newMembers||[]).map(pp=>({ …, on:mem.includes(pp.id), onClick:this.toggleProjMember(pp.id) }))`), toggle ř. 2380. CSS ř. 97–98: `[data-person]{ opacity:.5; } [data-person][data-on="true"]{ opacity:1; box-shadow:0 0 0 2px var(--panel), 0 0 0 4px var(--brass); }`.
- **Stav app:** apps/web/src/components/ProjectDetailPanel.tsx:250–263 — renderuje jen stávající členy (GET /api/projects/:id/members) jako statické <span> bez onClick; nečlenové prostoru se vůbec nezobrazují.
- **Fix:** ProjectDetailPanel.tsx: načíst i členy workspace (GET /api/workspaces/:ws/members — vzor v Projekty.tsx:52–62; workspace_id je na ProjectRow), vykreslit všechny s opacity .5 / plnou + brass ring dle členství a klikem volat API pro add/remove project_members (přidat endpoint v apps/api, pokud chybí).

### [MAJOR] Progress bar + „% hotovo“ zobrazeny u všech projektů místo jen u cílových/periodických; navíc text „N členů“
- **Prototyp:** ř. 714–716: `<sc-if value="{{ p.notFlow }}"><div style="height:6px; border-radius:3px; background:var(--panel-2); overflow:hidden; margin-top:12px;">{{ p.barFill }}</div></sc-if>` — jen goal/cycle. ř. 730: `<sc-if value="{{ p.notFlow }}"><span style="font-family:var(--w-font-mono); font-size:12px; color:var(--ink-3);">{{ p.pct }} % hotovo</span></sc-if>` — pct sedí VPRAVO na řádku s avatary (ř. 725 justify-content:space-between). Žádný text s počtem členů na kartě není.
- **Stav app:** apps/web/src/screens/Projekty.tsx:355–368 — bar + pct pod barem + „{count} členů“ pro každý projekt s total>0, bez ohledu na kind.
- **Fix:** Projekty.tsx (ProjectCard): bar podmínit `kind !== 'flow'`, pct přesunout jako mono 12px span napravo od avatarového řádku (justify-between), řádek „N členů“ odstranit; výška baru 6px radius 3 (nyní h-1.5=6px OK).

### [MAJOR] Tlačítko „+ Nový projekt“ má být plné brass s bílým textem
- **Prototyp:** ř. 696: `<button onClick="{{ addProject }}" style="margin-left:auto; …; color:#fff; background:var(--brass); border:none; border-radius:9px; padding:8px 13px; …" style-hover="filter:brightness(1.06)"><svg width="12" height="12"…>Nový projekt</button>` — screenshot 07 potvrzuje plný brass button vpravo.
- **Stav app:** apps/web/src/screens/Projekty.tsx:110–118 — `border border-brass … text-brass-text hover:bg-brass`, background: var(--w-brass-soft) → outline/ghost varianta, ne plný brass.
- **Fix:** Projekty.tsx: přepnout na `background: var(--w-brass)`, text bílý, bez borderu, padding 8px 13px, hover brightness(1.06), ikona plus 12px bílá.

### [MAJOR] Vlastník v detailu: kandidáti mají být celý tým prostoru, ne jen členové projektu
- **Prototyp:** ř. 3134: `owners:this.PEOPLE.concat(s.newMembers||[]).map(pp=>({ …, on:pp.id===curOwner, onClick:this.setProjOwner(pp.id) })), ownerName:curOwner?this.person(curOwner).name:'—'` — screenshot 08: řádek 7 avatarů (AK TM JD MB PN LH EP), vybraný TM plný + ring, ostatní ztlumení. Label `Vlastník · {{ projDetail.ownerName }}` (ř. 1241) s fallbackem „—“.
- **Stav app:** apps/web/src/components/ProjectDetailPanel.tsx:71–78,178–201 — mapuje jen project members; když vlastník není v project_members, avatar chybí a label nemá fallback „—“; vlastnictví nejde předat nečlenovi projektu.
- **Fix:** ProjectDetailPanel.tsx: pro sekci Vlastník použít členy workspace (viz gap Členové), fallback labelu „—“; selected styl = opacity 1 + dvojitý ring (0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)), nevybraní opacity .5 (to už sedí).

### [MAJOR] Pole Název v panelu: chybí label „NÁZEV“ a orámovaný input
- **Prototyp:** ř. 1230–1231: `<div style="…font-weight:700; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); margin-bottom:7px;">Název</div><input … style="width:100%; border:1px solid var(--line); background:var(--panel-2); border-radius:9px; padding:9px 11px; font-family:var(--w-font-display); font-weight:700; font-size:16px; color:var(--ink); outline:none;"/>` — screenshot 08: viditelný boxovaný input pod nadpisem NÁZEV.
- **Stav app:** apps/web/src/components/ProjectDetailPanel.tsx:128–135 — holý transparentní input bez labelu, text-lg text-navy, žádný border/bg.
- **Fix:** ProjectDetailPanel.tsx: obalit do Section label="Název" (uppercase 10.5px) a inputu dát border line, bg panel-2, radius 9, padding 9px 11px, font-display 700 16px, color var(--w-ink).

### [MAJOR] Avatary na kartě: vlastník má být vždy první s brass ringem, pak max 4 členové
- **Prototyp:** ř. 726–729: `<span style="display:inline-flex; align-items:center; padding-left:6px;"><sc-if value="{{ p.ownerInitials }}"><span title="Vlastník · {{ p.ownerName }}" style="width:24px; height:24px; …; box-shadow:0 0 0 2px var(--brass); margin-left:-6px;">{{ p.ownerInitials }}</span></sc-if><sc-for list="{{ p.members }}"><span style="…box-shadow:0 0 0 2px var(--panel); margin-left:-6px;">{{ m }}</span></sc-for></span>` — owner samostatně předřazen (i když není v members), members `slice(0,4)` (ř. 3181) → až 5 avatarů; žádný „+N“ indikátor; title `Vlastník · jméno`.
- **Stav app:** apps/web/src/screens/Projekty.tsx:371–397 — avatars = jen project_members se slice(0,4) celkem; owner jen flag (ring), může chybět úplně nebo být uprostřed; navíc „+N“ text, který v prototypu není; když projekt nemá členy, nezobrazí se ani vlastník.
- **Fix:** Projekty.tsx: sestavit pole [owner (z p.owner_id, title `Vlastník · jméno`, brass ring), ...members bez ownera slice(0,4) (ring barvy karty var(--w-card))]; řádek zobrazit vždy, když existuje owner; odstranit „+N“.

### [MAJOR] Banner filtrovaného projektu na Úkolech: chybí odkaz „Upravit projekt“, špatná barva „← Všechny úkoly“ a rám navíc
- **Prototyp:** ř. 335–340: prostý řádek (bez karty/borderu, padding 8px 4px 10px): tečka 11px, název `font-weight:800; font-size:18px; color:var(--ink)`, hned vedle `<span onClick="{{ openProjDetail }}" style="…font-size:12px; color:var(--ink-3); cursor:pointer;" style-hover="color:var(--ink)">Upravit projekt</span>`, vpravo `<span onClick="{{ clearProjFilter }}" style="margin-left:auto; …font-size:12px; color:var(--brass-text);" style-hover="text-decoration:underline">← Všechny úkoly</span>` (openProjDetail = otevře ProjectDetail panel, ř. 3255).
- **Stav app:** apps/web/src/screens/Ukoly.tsx:172–186 — bordered card (rounded-xl border bg-card), název text-navy, ŽÁDNÝ „Upravit projekt“ link, „← Všechny úkoly“ v text-ink-3 místo brass-text.
- **Fix:** Ukoly.tsx: odstranit rám/kartu, přidat „Upravit projekt“ (ink-3, hover ink) volající useProjectDetail().open(projektId), zpětný odkaz obarvit var(--w-brass-text) s hover underline; název color var(--w-ink).

### [MAJOR] Prázdný stav projektu na Úkolech: chybí text „V tomto projektu…“ + brass tlačítko „+ Přidat úkol“
- **Prototyp:** ř. 448: `<sc-if value="{{ projFilterOn }}"><div style="text-align:center; padding:70px 20px;"><div style="…font-size:14px; color:var(--ink-3);">V tomto projektu zatím nejsou žádné úkoly.</div><button onClick="{{ openAdd }}" style="margin-top:14px; …color:#fff; background:var(--brass); border:none; border-radius:10px; padding:9px 16px;">+ Přidat úkol</button></div></sc-if>` — přidání úkolu v kontextu projektu.
- **Stav app:** apps/web/src/screens/Ukoly.tsx:308–312 — generické `t("today.empty")` v dashed boxu, bez CTA tlačítka a bez projektově specifického textu.
- **Fix:** Ukoly.tsx: při projektId && shown.length===0 vykreslit centrovaný blok (padding 70px 20px) s textem „V tomto projektu zatím nejsou žádné úkoly.“ + brass tlačítkem otevírajícím QuickAdd/AddTaskModal s předvyplněným projektem.

### [MINOR] Výběr barvy: selected stav má brass dvojitý ring, výchozí swatch diagonální čárku; v modalu čtverečky ne kruhy
- **Prototyp:** CSS ř. 100: `[data-csel][data-on="true"]{ box-shadow:0 0 0 2px var(--panel), 0 0 0 4px var(--brass); }`; ř. 1234: výchozí swatch `width:24px; height:24px; border-radius:7px; border:1px solid var(--line); background:var(--panel);` s `<svg…><line x1="3" y1="11" x2="11" y2="3" stroke="var(--ink-3)" stroke-width="1.3"/></svg>`; ř. 1235 swatche radius 7px (čtverečky). Screenshot 08: vybraný „výchozí“ má brass kroužek.
- **Stav app:** ProjectDetailPanel.tsx:138–164 — outline `2px solid var(--w-navy)` místo brass ringu, výchozí swatch znak „✓“; Projekty.tsx:222–239 (NewProjectModal) — rounded-full kruhy + navy outline.
- **Fix:** Obě místa: swatch 24px radius 7px, selected = boxShadow `0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)`, výchozí = SVG diagonální linka (ink-3, width 1.3).

### [MINOR] Statistiky v panelu: prostá čísla mono 22px, ne boxy
- **Prototyp:** ř. 1259–1263: `<div style="display:flex; gap:22px; margin-top:22px; padding-top:16px; border-top:1px solid var(--line);"><div><div style="font-family:var(--w-font-mono); font-size:22px; color:var(--ink);">{{ projDetail.open }}</div><div style="…font-size:11.5px; color:var(--ink-3);">otevřených</div></div>…` (done má color var(--success-ink), total var(--ink-2)); zarovnané vlevo, bez pozadí.
- **Stav app:** ProjectDetailPanel.tsx:266–270 + 335–346 — grid tří centrovaných boxů s bg-panel-2 rounded-lg; hodnoty text-xl text-navy.
- **Fix:** ProjectDetailPanel.tsx: nahradit flex řádkem gap-[22px] s holými čísly font-mono 22px (open=ink, done=success-ink, total=ink-2) a labely 11.5px ink-3, border-top line.

### [MINOR] Chrome panelu: šířka 420px, border-left 1px, overlay .34, slide-in animace, paddingy 18px
- **Prototyp:** ř. 1222–1223: overlay `background:rgba(10,14,20,.34)`; panel `width:420px; max-width:94vw; background:var(--panel); border-left:1px solid var(--line); box-shadow:var(--shadow); …animation:wSlide .22s ease;` (CSS ř. 43 `@keyframes wSlide { from { transform:translateX(26px); opacity:0; }…}`); hlavička ř. 1224 `padding:14px 18px`, titulek „Projekt“ 700/14px color var(--ink-2); obsah ř. 1229 `padding:18px`.
- **Stav app:** ProjectDetailPanel.tsx:100–127 — max-w-md (448px), borderLeft `4px solid ${dot}` (v prototypu není), overlay bg-navy/20, žádná animace, px-4 py-3, titulek text-ink-3.
- **Fix:** ProjectDetailPanel.tsx: width 420px, border-left 1px var(--w-line) (barevný proužek odstranit), overlay rgba(10,14,20,.34), přidat keyframes wSlide (translateX(26px)→0, .22s ease) do index.css, paddingy 14/18 a 18px, titulek ink-2.

### [MINOR] Tečka prostoru v hlavičce Projektů: barva aktivního workspace, ne vždy brass
- **Prototyp:** ř. 694: `<span data-wsdot="{{ activeWs }}" style="width:8px; height:8px; border-radius:3px; margin-left:13px;"></span>`; CSS ř. 105: `[data-wsdot="personal"]{ background:#9a8f80; } [data-wsdot="kancelar"]{ background:#c68a3e; } [data-wsdot="klub"]{ background:#2a6fdb; }`.
- **Stav app:** Projekty.tsx:104 — `background: "var(--w-brass)"` natvrdo, borderRadius 2, gap 10px (prototyp margin-left 13px).
- **Fix:** Projekty.tsx: použít `workspaces.find(w=>w.id===activeWs)?.color ?? var(--w-brass)` (WorkspaceRow má color, lib/workspace.tsx:9), borderRadius 3, margin-left 13px.

### [MINOR] Metriky karty: radius 14px, číslo otevřených barvou ink a baseline zarovnání
- **Prototyp:** ř. 700: karta `border-radius:14px; padding:16px; box-shadow:var(--shadow-sm)`; ř. 710–712: `<div style="display:flex; align-items:baseline; gap:6px; margin-top:13px;"><span style="font-family:var(--w-font-mono); font-size:24px; color:var(--ink);">{{ p.open }}</span><span style="…font-size:12px; color:var(--ink-3);">otevřených · {{ p.total }} celkem</span></div>`; hlavička stránky margin-bottom:16px (ř. 692).
- **Stav app:** Projekty.tsx:321 rounded-2xl (16px); :348–353 items-end + mb-0.5, číslo text-navy (#17283f) místo var(--w-ink) (#16161a); :126 mt-6 (24px) mezi hlavičkou a gridem.
- **Fix:** Projekty.tsx: rounded-[14px], řádek počtů items-baseline gap-1.5 mt-[13px], číslo text-ink, grid mt-4.

### [MINOR] Segmenty Typ/Stav: kontejner radius 9 bez mezer, seg padding 5px 11px
- **Prototyp:** ř. 1238–1239: `<div style="display:inline-flex; background:var(--panel-2); border:1px solid var(--line); border-radius:9px; padding:3px; flex-wrap:wrap;"><…span data-seg … style="…font-weight:600; font-size:12px; padding:5px 11px; border-radius:7px; …color:var(--ink-3);">`; aktivní CSS ř. 145: `background:var(--brass-soft); color:var(--brass-text); border:1px solid var(--brass)` (stejně ř. 1246–1248 pro Stav).
- **Stav app:** ProjectDetailPanel.tsx:168,205 — `gap-1 rounded-lg` (mezery mezi segmenty, radius 8), Seg :323 px-3 py-1.5 (12/6px) rounded-md; barvy aktivního stavu sedí.
- **Fix:** ProjectDetailPanel.tsx: odstranit gap-1, rounded-[9px] na kontejneru, Seg padding 5px 11px radius 7.

### [MINOR] Footer panelu: tlačítko má být „Zavřít“, ne „Zrušit“
- **Prototyp:** ř. 1267: `<button onClick="{{ closeProject }}" style="…color:var(--ink-2); background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:10px 14px;">Zavřít</button>`.
- **Stav app:** ProjectDetailPanel.tsx:286–292 — `t("common.cancel")` = „Zrušit“, bg transparent (chybí bg-panel-2), text-ink místo ink-2.
- **Fix:** Přidat klíč projects.close=„Zavřít“ do packages/i18n/src/locales/cs.json (+en), použít ho zde; bg panel-2, text ink-2.

### [MINOR] Termín dodání: textové pole s placeholderem „např. 31. 8.“ místo nativního date inputu
- **Prototyp:** ř. 1251: `<input value="{{ projDetail.dueVal }}" onChange="{{ projDetail.onDue }}" placeholder="např. 31. 8." style="width:100%; border:1px solid var(--line); background:var(--panel-2); border-radius:9px; padding:9px 11px; font-family:var(--w-font-body); font-size:13px;…"/>` — plná šířka, body font.
- **Stav app:** ProjectDetailPanel.tsx:226–233 — `<input type="date">` úzký, font-mono text-xs; i18n klíč projects.deliveryPlaceholder existuje, ale je nevyužitý.
- **Fix:** Buď ponechat date input, ale stylovat na plnou šířku, padding 9px 11px, font 13px; nebo věrně: textový input s parserem českého data a placeholderem z projects.deliveryPlaceholder.

### [MINOR] „Nový projekt“ v prototypu vytvoří kartu okamžitě (bez modálu)
- **Prototyp:** ř. 2559: `addProject = () => this.setState(s=>{ const keys=['q3','provoz',…]; const n=(s.newProjects||[]).length; return { newProjects:[…, { id:'np'+n+'_'+Date.now(), name:'Nový projekt '+(n+1), colorKey:keys[n%keys.length] }] }; });` — žádný dialog, karta se přidá rovnou s rotující barvou.
- **Stav app:** Projekty.tsx:146–290 — NewProjectModal (název/barva/typ → POST). Produkčně rozumné rozšíření, ale odchylka od chování prototypu.
- **Fix:** Ponechat modal jako vědomou odchylku (zaznamenat do reconciliace v files/), nebo přidat rychlou variantu: klik vytvoří projekt „Nový projekt N“ ihned a otevře jeho detail panel k dopilování.


## Cíle + Reporty — 63 %

### [CRITICAL] Detail cíle: chybí celá sekce „Jak se měří“ (metrika + reálná hodnota + filtr)
- **Prototyp:** WatsonApp.dc.html ř. 1317–1328: nadpis „Jak se měří“ + pill s metrikou `<span style="…font-size:11px; color:var(--ink-2); background:var(--panel-2); border:1px solid var(--line); border-radius:999px; padding:2px 10px;">{{ goalDetail.metricLabel }}</span>`, pod tím help text `{{ goalDetail.metricHelp }}` (12.5px ink-3), pak box panel-2 radius 12: `<span font-mono 13px>{{ realLabel }}</span><span 12px ink-3>{{ subLabel }}</span>` a řádek „Počítá se z {{ matchCount }} úkolů · {{ filterLabel }}“. Texty: METLABEL/METHELP ř. 2357–2358 (Dokončení úkolů/Včasnost/Počet hotových/Stav projektu + popisy), goalFilterLabel ř. 2361 („projekt X · jméno · „klíč““ nebo „celý prostor“).
- **Stav app:** apps/web/src/screens/Cile.tsx:697–742 — GoalDetail má jen progress bar + pr.sub + pace box + MetaRows. metricLabel pill, metricHelp, realLabel/subLabel box i „Počítá se z N úkolů · filtr“ zcela chybí (matchCount z goalProgress se nikde nezobrazuje).
- **Fix:** Cile.tsx (GoalDetail): přidat sekci „Jak se měří“ — uppercase label + pill METLABEL[g.metric] (i18n klíče goals.metricCompletion… lze reuse jako plné labely nebo přidat metricLabelX), help z existujících goals.helpX, box s pr.label/pr.sub a řádek `Počítá se z {pr.matchCount} úkolů · {filterLabel}`; filterLabel složit z links (projekt) — po doplnění keyword/person i z nich.

### [CRITICAL] Detail cíle: chybí „Úkoly v hledáčku“ (vzorek úkolů se stavovými tečkami)
- **Prototyp:** WatsonApp.dc.html ř. 1340–1350: nadpis „Úkoly v hledáčku“, řádky `<span style="width:7px;height:7px;border-radius:50%" data-goaldot="{{ t.state }}"></span><span data-tname="{{ t.done }}" …13px…>{{ t.name }}</span><span …10.5px ink-3>{{ t.stateLabel }}</span>` (padding 8px 2px, border-bottom line, klik otevře úkol), pod tím `{{ moreLabel }}` = „… a dalších N“. CSS ř. 144: `[data-goaldot="ontime"]{background:#2e9c6e} [data-goaldot="late"]{background:var(--overdue)} [data-goaldot="open"]{background:var(--ink-3)}`. Logika ř. 3204: `sampleTasks: goalTasks(g).slice(0,6)`, stateLabel `včas/pozdě/otevřený`, `moreLabel: '… a dalších '+(len-6)`.
- **Stav app:** apps/web/src/screens/Cile.tsx — GoalDetail (622–794) nemá žádný seznam úkolů; goalTasks(g) existuje jen v rodiči (113–126) a do detailu se nepředává.
- **Fix:** Cile.tsx: předat goalTasks(selected.g) do GoalDetail; vyrenderovat max 6 řádků s tečkou (ontime dle taskOnTime z lib/goals.ts, late = done && !onTime, open), stateLabel včas/pozdě/otevřený, přeškrtnutí u done (data-tname vzor), klik → taskDetail.open(id), moreLabel.

### [CRITICAL] Detail cíle: chybí stepper cílové úrovně (− hodnota +)
- **Prototyp:** WatsonApp.dc.html ř. 1331–1338: `<span flex:1 uppercase>{{ targetLabel }}</span><span onClick=onTargetMinus style="width:30px;height:30px;…border:1px solid var(--line);border-radius:8px;background:var(--panel-2);font-size:17px">−</span><span style="font-weight:700;font-size:15px;min-width:58px;text-align:center">{{ targetText }}</span><span onClick=onTargetPlus …>+</span>`; hover `border-color:var(--brass); color:var(--brass-text)`. Logika ř. 2352 adjGoalTarget: krok 5 pro count / 1 jinak, min 1; ř. 3204: targetText `'N'` pro count, `'N %'` jinak, targetLabel „Cílový počet“/„Cílová úroveň“, skryté pro metric==='project' (canTarget).
- **Stav app:** apps/web/src/screens/Cile.tsx — GoalDetail nemá žádnou možnost změnit target po vytvoření (target jen v builderu ř. 519–537).
- **Fix:** Cile.tsx (GoalDetail): přidat řádek se stepperem (− / hodnota / +), UPDATE goals SET target přes powerSync.execute; krok 5 u count, 1 u %, skrýt pro metric='project'.

### [CRITICAL] Detail cíle: chybí progress ring (SVG donut) — nahrazen lineárním barem
- **Prototyp:** WatsonApp.dc.html ř. 1301–1310: `{{ ringNode }}` + absolutně centrované `{{ pct }}%` (17px/800), vedle `{{ badgeNode }}` a mono `{{ valueLabel }}` (14px). ringNode ř. 2371: `svg 76×76, R=30, kruh stroke var(--panel-2) width 7 + kruh stroke=barva stavu, strokeLinecap:round, strokeDasharray C, strokeDashoffset C*(1-pct/100), rotate(-90 38 38)`.
- **Stav app:** apps/web/src/screens/Cile.tsx:702–714 — detail ukazuje jen řádek label/pct + lineární bar výšky 8, žádný donut.
- **Fix:** Cile.tsx: přidat komponentu Ring (SVG dle vzorce výše, barva GSTAT[st][3]) a přeskládat horní blok detailu na ring + (badge / valueLabel) dle ř. 1301–1310.

### [CRITICAL] Builder: chybí „Začít ze šablony“ (6 šablon cílů)
- **Prototyp:** WatsonApp.dc.html ř. 1423–1431: nadpis „Začít ze šablony“, grid `grid-template-columns:1fr 1fr; gap:8px`, karta `data-tplcard data-on … border:1px solid var(--line); border-radius:11px; padding:10px 12px; background:var(--panel-2)` s `{{ t.label }}` (12.5px/700) a `{{ t.sub }}` (11px ink-3); CSS ř. 107 aktivní: `border-color:var(--brass); background:var(--brass-soft)`. Data ř. 2323–2330 GOAL_TEMPLATES: „Odbavit úkoly toto čtvrtletí“ (count 200, quarter, team), „Úkoly odbavené včas“ (ontime 90), „Faktury zaplacené včas“ (ontime 95, klíč faktur), „Docházky vyplněné včas“, „Týdenní osobní penzum“ (count 20, week), „Dokončit projekt“ (project 100). pickGoalTemplate ř. 2344 předvyplní name/metric/target/periodic/scope/fKeyword.
- **Stav app:** apps/web/src/screens/Cile.tsx GoalModal (352–608) — žádné šablony, jen prázdný formulář.
- **Fix:** Cile.tsx (GoalModal): přidat konstantu GOAL_TEMPLATES + 2sloupcový grid karet mezi name input a „Typ cíle“; klik předvyplní stav formuláře a označí kartu (brass-soft/brass border).

### [CRITICAL] Builder: chybí filtry „Člověk (volitelně)/Měřený člen“ a „Klíčové slovo v názvu“
- **Prototyp:** WatsonApp.dc.html ř. 1446: select `{{ personLabel }}` s option „— kdokoli —“ (zobrazený když metrika ≠ Stav projektu); ř. 1450: input „Klíčové slovo v názvu“ placeholder „např. faktur, docház, nábor“; ř. 3212: personLabel = scope==='person' ? „Měřený člen“ : „Člověk (volitelně)“. Logika goalTasks ř. 2360 filtruje `fPerson` (úkoly přiřazené osobě) a `fKeyword` (substring v názvu, lowercase); goalFilterLabel ř. 2361 je zobrazuje; createGoal ř. 2345: `if(scope==='person' && !fPerson) fPerson=owner`.
- **Stav app:** apps/web/src/screens/Cile.tsx GoalModal — jen Projekt select; goalTasks (113–126) filtruje person jen implicitně přes owner_id u scope='person'; keyword neexistuje. AppSchema.ts:166–180 — tabulka goals nemá sloupce person_id/keyword.
- **Fix:** 1) AppSchema.ts + sync-config + API migrace: přidat sloupce `person_id`, `keyword` do goals (pozor: po změně sync-config restartovat watson-powersync). 2) Cile.tsx GoalModal: přidat select osoby (roster) a input klíčového slova (zobrazené jen když metric!=='project'). 3) goalTasks v Cile.tsx i goalRow v Reporty.tsx: filtrovat dle person_id (assigneesByTask) a keyword (name includes, lowercase).

### [MAJOR] Chybí pole „Období“ (Q3 2026) — v builderu i na kartě/detailu
- **Prototyp:** Builder ř. 1457: `<div style="width:120px">Období <input placeholder="Q3 2026" font-body 13px>` vedle Vlastníka a Termínu (Termín je volný text „30. 9.“, mono, width 100px — ř. 1458). Karta ř. 763: vpravo dole `<span font-mono 11px ink-3>{{ g.period }}</span>` — screenshot 09 ukazuje „Q3 2026“ resp. „2026“, NE „do 30. 9.“. Detail ř. 1354: dlaždice Období = `{{ goalDetail.period }}`. Seed ř. 2111–2122: period 'Q3 2026'/'2026'/'Tento týden'/'Školní rok'.
- **Stav app:** apps/web/src/screens/Cile.tsx:305–307 karta renderuje `fmtDue(g.due_date)` („do 31. 8.“) místo period; builder (556–565) má jen `<input type=date>` Termín, pole Období neexistuje; AppSchema goals nemá sloupec period.
- **Fix:** AppSchema/migrace: přidat `period` (text) do goals. GoalModal: textové pole Období (width 120, placeholder Q3 2026) vedle Vlastníka a Termínu. Karta: vpravo dole zobrazit period (mono 11px); detail: dlaždice Období.

### [MAJOR] Špatný aktivní stav segmentů (taby Cíle + segmenty builderu): má být brass, ne bílá karta
- **Prototyp:** CSS ř. 145: `[data-seg][data-on="true"]{ background:var(--brass-soft); color:var(--brass-text) !important; border:1px solid var(--brass); box-shadow:none; }` — data-seg používají taby Cíle (ř. 743) i segmenty builderu Typ cíle/Metrika/Opakování (ř. 1435, 1439, 1463). Screenshot 09: aktivní „Týmové 2“ je okrové s brass rámečkem.
- **Stav app:** apps/web/src/screens/Cile.tsx:192–193 (taby) a 414–420 (seg v modalu) — aktivní = `background: var(--w-card)` (bílá) + ink text, bez brass rámečku.
- **Fix:** Cile.tsx: u tabů i seg() změnit aktivní stav na `background:var(--w-brass-soft); color:var(--w-brass-text); border:1px solid var(--w-brass)` (neaktivní: transparent, ink-3, border transparent kvůli zachování rozměrů).

### [MAJOR] Detail cíle: chybí 3sloupcová mřížka Období / Termín / Uplynulo
- **Prototyp:** WatsonApp.dc.html ř. 1352–1365: `display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; text-align:center`, každá dlaždice `background:var(--panel-2); border-radius:10px; padding:11px 4px` s mono hodnotou 14px ({{ period }}, {{ dueLabel }}, {{ elapsed }} = „64 %“) a labelem 10px ink-3 (Období/Termín/Uplynulo).
- **Stav app:** apps/web/src/screens/Cile.tsx:728–742 — místo toho MetaRow řádky (Vlastník/Projekt/Termín/Opakování); „Uplynulo“ je jen v textu za pr.sub (ř. 715–718).
- **Fix:** Cile.tsx (GoalDetail): nahradit část MetaRows 3sloupcovou mřížkou dlaždic panel-2 s period/fmtDue/elapsed %.

### [MAJOR] Detail cíle: chybí periodic box „Obnovuje se …“ + tlačítko „Obnovit období“
- **Prototyp:** WatsonApp.dc.html ř. 1367–1376: box panel-2 radius 12 s refresh SVG ikonou (brass-text), titulkem „Obnovuje se {{ periodicLabel }}“ (12.5px/700), podtitulkem „Po konci období se hodnota vynuluje a cíl běží dál.“ (11.5px ink-3) a tlačítkem `Obnovit období` (12px brass-text, border line, radius 8, hover bg panel). Handler resetGoalPeriod ř. 2346 + toast „Cíl obnoven na další období“.
- **Stav app:** apps/web/src/screens/Cile.tsx:739–741 — periodic jen jako MetaRow text, žádný box ani reset akce.
- **Fix:** Cile.tsx (GoalDetail): pro g.periodic!=='none' vykreslit box dle ř. 1367–1376; reset implementovat např. posunem created_at/vynulováním počítaného období (per datový model) + toast.

### [MAJOR] Detail cíle: „Napojené projekty“ bez progress barů
- **Prototyp:** WatsonApp.dc.html ř. 1384–1396: nadpis „Napojené projekty“, na řádek: tečka 9px barvy projektu + název (13px) + `{{ lk.pctW }}` mono 12px, pod tím bar `height:6px; border-radius:999px; background:var(--panel-2)` s výplní `width:pct%; background:barva projektu` (logika ř. 3203: pct z projComputed).
- **Stav app:** apps/web/src/screens/Cile.tsx:730–737 — projekty jen jako text join(' · ') v MetaRow, bez teček, % a barů.
- **Fix:** Cile.tsx (GoalDetail): sekce Napojené projekty — pro každý link spočítat % dokončení projektu (done/total z tasks) a vykreslit tečku+název+%+bar s barvou projektu.

### [MAJOR] Detail cíle: hlavička bez scope labelu a needitovatelný název
- **Prototyp:** WatsonApp.dc.html ř. 1294–1299: hlavička = `{{ scopeLabel }}` uppercase 11px ink-3 („Týmový cíl/Projektový cíl/Osobní cíl“, mapa ř. 3204) + zavírací ×; pod ní `<input value={{ name }} onChange=onName style="border:none; font-weight:800; font-size:21px">` — název je přejmenovatelný (onGoalName ř. 2354). Badge je až u ringu (ř. 1307), ne v hlavičce.
- **Stav app:** apps/web/src/screens/Cile.tsx:681–700 — hlavička má target ikonu + StatusBadge (scope label nikde), název je statické `<h2>` 19px.
- **Fix:** Cile.tsx (GoalDetail): hlavičku předělat na scopeLabel (uppercase) + ×; h2 nahradit borderless inputem 21px/800 s UPDATE goals SET name; badge přesunout k ringu.

### [MAJOR] Reporty/Lidé: podtitul člena má být role/funkce, ne e-mail (řádek i detail)
- **Prototyp:** Řádek ř. 875–876: `{{ p.name }}` (14.5px/700) + `{{ p.role }}` (12.5px ink-3) — screenshot 11: „Adéla Kučerová / Vedoucí provozu“. Member detail ř. 1159–1161: jméno 19px/800 → role 13px ink-3 → e-mail mono 11.5px pod tím.
- **Stav app:** apps/web/src/screens/Reporty.tsx:379–381 řádek zobrazuje `m.email`; MemberDetail ř. 527–532 zobrazuje jen jméno + e-mail (role/funkce chybí). API Member nemá pole pro pracovní roli/funkci.
- **Fix:** API /workspaces/:id/members: vracet i `title`/funkci (sloupec na members/users; fallback e-mail). Reporty.tsx: řádek → subtitle role, MemberDetail → stack jméno/role/e-mail dle ř. 1159–1161.

### [MAJOR] Řádky cílů v Reportech a v member detailu nejsou klikací (mají otevřít detail cíle)
- **Prototyp:** goalRowNode ř. 2370: `onClick:this.openGoal(g.id)` + `cursor:pointer` — platí pro kartu „Cíle týmu“ v Přehledu ({{ reportGoals }}, ř. 862) i sekci Cíle v member detailu ({{ memberDetail.goals }}, ř. 1210). Goal detail panel je globální overlay (ř. 1290+), otevře se i nad Reporty.
- **Stav app:** apps/web/src/screens/Reporty.tsx:322–339 a 671–688 — statické <div>, žádný onClick.
- **Fix:** Reporty.tsx: řádky cílů → button s navigate({to:'/cile', search:{cil:g.id}}) (a v Cile.tsx číst search param a otevřít GoalDetail), nebo vyextrahovat GoalDetail do sdílené komponenty a otevírat přímo v Reportech.

### [MAJOR] „Přidat člena“ má otevřít modal (jméno + e-mail), ne navigovat do Nastavení
- **Prototyp:** ř. 869: `<span onClick={{ openMemberModal }} …>+ Přidat člena</span>`; MEMBER MODAL ř. 1273+ — overlay rgba(10,14,20,.42), karta 440px radius 16, pole jméno + e-mail, submitMember ř. 2384 přidá člena do rosteru.
- **Stav app:** apps/web/src/screens/Reporty.tsx:349–357 — tlačítko naviguje na /nastaveni.
- **Fix:** Reporty.tsx: otevřít invite modal (pokud existuje v Nastavení, vyextrahovat do sdílené komponenty; jinak vytvořit — jméno/e-mail → POST invite na API).

### [MINOR] Karta cíle — mikrodetaily: link chips jako pilulky, hover translateY, badge metriky, title avataru
- **Prototyp:** ř. 750: hover karty `box-shadow:var(--shadow); transform:translateY(-2px)`. Link chips (goalCard ř. 3200): `font-family:body; font-size:11.5px; color:var(--ink-3); background:var(--panel-2); border-radius:999px; padding:3px 9px` s tečkou 7px. Badge karty: `font-size:10.5px; padding:3px 9px; gap:5px` (detail má 11px/3px 10px/gap 6 — ř. 3204). Avatar title ř. 761: `title="Vlastník · {{ g.ownerName }}"`.
- **Stav app:** apps/web/src/screens/Cile.tsx:237–238 hover jen shadow-md bez translate; 283–295 chips jsou holý text 10.5px font-display bez pilulky; StatusBadge (338–349) má jednotné 11px/3px 10px i na kartě; title avataru jen jméno (274).
- **Fix:** Cile.tsx: karta hover:-translate-y-0.5 + shadow; chips → pill (bg panel-2, radius full, 3px 9px, body 11.5 ink-3); StatusBadge s prop size (card: 10.5px/3px 9px/gap 5); title=`Vlastník · ${name}`.

### [MINOR] Detail cíle: pace box špatné pozadí a chybí brass diamant; vlastník bez avataru
- **Prototyp:** ř. 1312–1315: pace box `background:var(--panel-2); border-radius:12px; padding:12px 14px` s `<span style="width:6px;height:6px;transform:rotate(45deg);background:var(--brass);margin-top:6px">` diamantem před textem (13px ink-2). Vlastník ř. 1378–1382: uppercase nadpis „Vlastník“ + avatar 30px navy s iniciálami + jméno 14px.
- **Stav app:** apps/web/src/screens/Cile.tsx:720–725 pace box má bg-brass-soft, radius 11, bez diamantu; vlastník je jen MetaRow text (729).
- **Fix:** Cile.tsx: pace box → panel-2 + rotated square; sekce Vlastník s avatarem (iniciály, navy 30px) + jménem.

### [MINOR] Builder — struktura a texty: sticky header/footer, nadpisy sekcí, výchozí metrika dle scope, „Bez resetu“
- **Prototyp:** ř. 1415–1418 sticky header s target SVG ikonou (17px brass) + „Nový cíl“ 16px/800; ř. 1466–1469 sticky footer s textem „Cíl se založí v aktivním prostoru“ (12px ink-3) vlevo od tlačítek. Nadpis ř. 1443: „Co se počítá — které úkoly cíl měří“; ř. 1461: „Opakování — po konci období se cíl sám obnoví“; overlay padding-top:6vh (ř. 1413), max-height:88vh. setGoalScope ř. 2337: volba Projektový přepne metriku na project, jinak count. Periodics ř. 3217: první volba „Bez resetu“. Termín je volný text „30. 9.“ mono (ř. 1458).
- **Stav app:** apps/web/src/screens/Cile.tsx: header bez ikony a nesticky (439–451), footer bez helper textu (585–603), labely jen „Projekt“/„Opakování“ (FieldLabel), paddingTop 9vh/max-h 84vh (433–437), setScope nemění metric (474), cs.json goals.perNone=„Jednorázový“.
- **Fix:** Cile.tsx: sticky header s ikonou + sticky footer s helper textem; rozšířit labely sekcí (uppercase + tečkovaný dovětek); onScope → setMetric(project?'project':'count'); cs.json perNone → „Bez resetu“; zvážit 6vh/88vh.

### [MINOR] Reporty: aktivní tab Přehled/Lidé bez stínu
- **Prototyp:** CSS ř. 92–93: `[data-rtab]{color:var(--ink-3)} [data-rtab][data-on="true"]{ background:var(--panel); color:var(--ink); box-shadow:var(--shadow-sm); }`.
- **Stav app:** apps/web/src/screens/Reporty.tsx:226–231 — aktivní má jen background var(--w-card) + barvu, bez box-shadow.
- **Fix:** Reporty.tsx: přidat `boxShadow: tab===k ? 'var(--w-shadow-sm)' : 'none'` (stejně i pro role segmenty v MemberDetail — data-rseg ř. 143 má shadow také).

### [MINOR] „Podle projektu“: jiné pořadí a rozsah projektů
- **Prototyp:** ř. 3185: reportProj = projektyView (= prvních 6 projektů prostoru v seed pořadí, ř. 3181 slice(0,6)), bez řazení podle hodnoty — screenshot 10: Q3 5, Provoz 5, Obchod 0, Onboarding 3, Web 1, Nábor a HR 0 (nuly uprostřed). Bar `width:Math.max(3, done/8*100)%` s barvou projektu.
- **Stav app:** apps/web/src/screens/Reporty.tsx:123–129 — všechny ws projekty, řazené sestupně dle počtu, normalizace přes maxProj.
- **Fix:** Reporty.tsx: zachovat pořadí projektů dle prostoru (bez sortu) a omezit na ~6 (slice), min šířka 3 % zachována.

### [MINOR] Member detail footer: chybí tlačítko „Zavřít“ a zkrácený label
- **Prototyp:** ř. 1213–1216: footer `display:flex; gap:9px` — `<button flex:1 brass>Zobrazit všechny úkoly</button>` + `<button style="background:var(--panel-2); border:1px solid var(--line); padding:10px 14px">Zavřít</button>`.
- **Stav app:** apps/web/src/screens/Reporty.tsx:693–702 — jen jedno brass tlačítko přes celou šířku; cs.json reports.showTasks=„Zobrazit úkoly“.
- **Fix:** Reporty.tsx: přidat sekundární Zavřít (panel-2, border line) vedle primárního; cs.json → „Zobrazit všechny úkoly“.


## Postupy (štafetová workflow) — screens 12-postupy, 13-postup-detail, 14-postup-builder + integrace (flow chip, Dnes strip, add-task) — 55 %

### [CRITICAL] Chybí celý blok Plánování v detailu postupu (Řetězec/Kotva, −1d/+1d, Bez víkendů) + reflow engine
- **Prototyp:** ř. 1102–1113: řádek „PLÁNOVÁNÍ" se segmentem `<span data-schedseg data-on="{{ flowDetail.isChain }}">Řetězec</span><span data-schedseg data-on="{{ flowDetail.isAnchor }}" style="…border-left:1px solid var(--line);">Kotva</span>` (title=„Termíny se počítají z předchozího kroku — zpoždění se přelévá dál" / „Pevné termíny ke kotvě — zpoždění se nepřelévá"), tlačítka `−1 d` / `+1 d` (title „Posunout celý řetězec o den dřív/později") a chip `Bez víkendů` (data-chip data-on={{skipWk}}); pod tím hint dle režimu: isChain→„Když se krok zpozdí, navazující se posunou automaticky.", isAnchor→„Termíny jsou pevné. Zpoždění se nepřelévá — Watson označí ohrožený konec.". Logika: ř. 2487 `_reflow` (mode anchor: date=flowAnchor+anchorOffset; mode chain: d=prev+gapDays, skipWeekend→_nextWork), ř. 2488 `shiftFlow(delta)` (posun date+flowAnchor všech kroků), ř. 2489 `setFlowSched(mode)` (přepnutí schedMode + reflow), ř. 2490 `toggleFlowWeekend`. CSS ř. 90–91: `[data-schedseg][data-on="true"]{background:var(--brass-soft); color:var(--brass-text);}`. Screenshot 13 blok jasně ukazuje.
- **Stav app:** apps/web/src/screens/Postupy.tsx:402–405 — jen natvrdo vypsaný hint „Termíny jsou pevné. Zpoždění se nepřelévá…" (Kotva varianta) s komentářem „reflow/kaskáda viz RECONCILIACE §23"; žádný segment, žádné ±1d, žádné Bez víkendů. lib/chainAdvance.ts termíny vůbec nemění. Schema chain_steps (lib/powersync/AppSchema.ts:151–163) nemá sloupce pro offset/gap/sched_mode/skip_weekend.
- **Fix:** AppSchema.ts + sync-config: přidat chains.sched_mode, chains.skip_weekend a chain_steps.anchor_offset, chain_steps.gap_days (naplnit v Postupy.tsx create()). Nový lib/chainReflow.ts: port _reflow/shiftFlow/setFlowSched/toggleFlowWeekend nad due_date v ISO (anchor=chains.anchor_date, chain: prev+gap_days s přeskokem So/Ne). V Postupy.tsx FlowDetail hlavičce vykreslit řádek PLÁNOVÁNÍ přesně dle ř. 1102–1113 (segment, ±1d, chip, podmíněný hint).

### [CRITICAL] Chybí flow toast — „Předáno → X" při předání štafety a kaskádová hláška
- **Prototyp:** ř. 1082–1083: `<div style="position:fixed; left:50%; bottom:26px; transform:translateX(-50%); z-index:60; background:var(--w-navy); color:#fff; …font-weight:600; font-size:13.5px; padding:11px 18px; border-radius:12px; box-shadow:var(--shadow);"><span style="width:8px; height:8px; border-radius:50%; background:var(--brass);"></span>{{ flowToast }}</div>`. ř. 2491 `_flowToast` (auto-hide 2800 ms). ř. 2482 toggleDone: po dokončení kroku `this._flowToast('Předáno → '+this._handoffTo)` (_handoffTo = jméno prvního přiřazeného dalšího kroku, jinak „kdokoli z týmu", nastavuje _advance ř. 2483). ř. 2483 konec: kaskáda → toast „Navazující kroky posunuty o N dní". README ř. 73: „Dokončení kroku předá další osobě (toast ‚Předáno → X')".
- **Stav app:** Žádný toast po dokončení kroku — lib/tasks.ts:16–23 toggleTask jen zavolá advanceChainForTask; Postupy.tsx:343–350 completeStep dtto. V appce existuje jen WriteRejectedToast.tsx (jiný účel).
- **Fix:** Přidat sdílený FlowToast (context/portal v layout/AppLayout.tsx) se stylem z ř. 1083 (navy pill, brass dot, bottom 26px, 2800 ms). advanceChainForTask (lib/chainAdvance.ts) nechat vracet {handedOffTo?: string} (jméno/„kdokoli z týmu" z assignments dalšího aktivovaného kroku) a v toggleTask/completeStep zobrazit „Předáno → X".

### [CRITICAL] Chybí „Uložit jako šablonu" v detailu postupu (šablona z běžícího postupu)
- **Prototyp:** ř. 1101: `<div onClick="{{ flowDetail.onSaveTemplate }}" style="display:inline-flex; …margin-top:11px; font-weight:600; font-size:11.5px; color:var(--ink-2); border:1px solid var(--line); border-radius:8px; padding:5px 10px;" style-hover="border-color:var(--brass)"><svg…/>Uložit jako šablonu</div>`. Logika ř. 2495 `saveFlowAsTemplate`: z kroků složí tpl {label:flowName, desc:'N kroků · z běžícího postupu', steps:[{name, who, mode, gate, offset=(date−base), priority}]}, prepend do FLOW_TEMPLATES + toast „Uloženo jako šablona: X". Screenshot 13 tlačítko ukazuje.
- **Stav app:** Postupy.tsx FlowDetail (ř. 352–553) tlačítko vůbec nemá; TEMPLATES (ř. 43–85) jsou konstanta bez možnosti přidání. Schema chains má template_id, ale žádná tabulka šablon se nepoužívá.
- **Fix:** Postupy.tsx: do hlavičky FlowDetail přidat tlačítko dle ř. 1101; uložit šablonu (název, desc, kroky s offsetem z due_date−anchor_date, gate, priority, who) do localStorage (per-user) nebo nové tabulky chain_templates; FlowModal načítat TEMPLATES ∪ uložené šablony. Toast „Uloženo jako šablona: X".

### [CRITICAL] Builder: chybí výběr osob avatarovou řadou + role (Grafik/Produkce/Účetní/Vedoucí) + režim „Stačí kdokoli / Každý zvlášť"
- **Prototyp:** ř. 1573: avatarová řada `<span onClick="{{ pp.onClick }}" data-person data-on="{{ pp.on }}" data-av="navy" style="width:25px; height:25px; border-radius:50%; color:#fff; …font-size:9.5px;">{{ pp.initials }}</span>` (CSS ř. 97–98: `[data-person]{opacity:.5}` / `[data-on="true"]{opacity:1; box-shadow:0 0 0 2px var(--panel), 0 0 0 4px var(--brass);}`). ř. 1574: role chipy `data-chip … border:1px dashed var(--line)` title=„Přiřadit roli — člověk se dosadí při založení" z `FLOW_ROLES` ř. 2500: Grafik, Produkce, Účetní, Vedoucí. ř. 1575: chip režimu `{{ st.modeLabel }}` = „Každý zvlášť"/„Stačí kdokoli" (toggleFlowStepMode ř. 2544), title „Režim přiřazení (R2)"; createFlow ř. 2551: mode all → aTotal/peopleDone. README ř. 73: „role místo konkrétních lidí".
- **Stav app:** Postupy.tsx:850–862 — místo avatarů obyčejný `<select>` „— kdokoli —" s členy projektu; role neexistují nikde; assignMode kroku se nenastavuje (assignments INSERT ř. 650–655 bez mode).
- **Fix:** Postupy.tsx FlowModal: nahradit select avatarovou řadou členů projektu (opacity .5 → ring při výběru, toggle), vedle dashed chipy rolí (konstanta ROLES nebo workspace role) — výběr role uloží placeholder (chain_steps.role sloupec / task bez assignmenta + role text), a chip režimu any/all cyklovaný klikem; mode propsat do assignments/tasks (assign_mode).

### [CRITICAL] Builder: chybí per-krok projekt (předání mezi projekty) a přesun kroků ↑/↓
- **Prototyp:** ř. 1577: `<select onChange="{{ st.onStepProject }}" title="Projekt kroku — předání mezi projekty" style="…border-radius:999px; padding:5px 8px; font-size:11px; …max-width:130px;">` s projOpts. ř. 1568–1569: `<span onClick="{{ st.onUp }}" data-dis="{{ st.first }}">↑</span><span onClick="{{ st.onDown }}" data-dis="{{ st.last }}">↓</span>` (moveFlowStep ř. 2541; CSS ř. 96 `[data-dis="true"]{opacity:.4; pointer-events:none}`). createFlow ř. 2550: `project:st.project||d.project`. README ř. 73: „předání mezi projekty".
- **Stav app:** Postupy.tsx step row (ř. 820–907) má jen ×, žádné ↑/↓; projekt kroku nelze změnit — create() ř. 633–648 vkládá vše do chain projectId. Schema chain_steps.project_id přitom existuje (AppSchema.ts:155).
- **Fix:** Postupy.tsx: do rows přidat pole project (default = chain projekt), pill-select dle ř. 1577; v create() použít r.project pro tasks.project_id i chain_steps.project_id. Přidat ↑/↓ tlačítka s prohozením prvků rows (disabled first/last, opacity .4).

### [CRITICAL] Chybí „Zařadit do postupu" při přidávání úkolu (flowAttach → připojení kroku k běžícímu postupu)
- **Prototyp:** ř. 2979: pole „Postup" v Add-task „Více": `addFieldsMore.push(mkF('postup','Postup','postup', d.flowAttach?'Přidáno':null,…))` (jen když existují postupy, ř. 2964). ř. 1873–1875: `<select onChange="{{ setDraftFlow }}">` s `addFlowOptions` (ř. 3261: „— žádný —" + názvy postupů). Logika createTask ř. 2471: `if(d.flowAttach){ …maxIdx…; task.stepIndex=newTotal; task.stepTotal=newTotal; task.stepStatus=allDone?'now':'waiting'; task.gate='auto'; if(allDone) task.handedOff=true; }` — přidá nový poslední krok. README §Detail úkolu (ř. 31): „Zařadit do postupu".
- **Stav app:** components/AddTaskModal.tsx — žádná zmínka o flow/chain (grep 0 hitů); components/TaskDetailPanel.tsx také ne (jen advance při toggle na ř. 137).
- **Fix:** AddTaskModal.tsx: do sekce „Více" přidat select postupů aktivního prostoru (chains WHERE state='active'); při uložení INSERT do chain_steps s position=MAX(position)+1, gate='after_previous', step_state = (všechny kroky uzavřené ? 'active' : 'dormant'). Totéž tlačítko v TaskDetailPanel.tsx pro existující úkol bez chain_step.

### [CRITICAL] Chybí chip „Připomenout" na čekajících krocích přiřazených mně
- **Prototyp:** ř. 1136: `<sc-if value="{{ st.canRemind }}"><span onClick="{{ st.onRemind }}" data-chip data-on="{{ st.reminding }}" title="Připomenout, až na mě přijde řada" style="…font-size:11.5px; border:1px solid var(--line); border-radius:8px; padding:5px 10px;"><svg zvonek/>Připomenout</span>`; flowView ř. 2554: `canRemind:(sk==='waiting' && (st.people||[]).includes('ak')), reminding:!!st.remind`; remindStep ř. 2496 togluje task.remind.
- **Stav app:** Postupy.tsx FlowDetail krok (ř. 487–544): akce jen Dokončit/Aktivovat/Vrátit; žádné Připomenout, tasks schema nemá remind pole.
- **Fix:** Přidat tasks.remind (nebo lokální per-user reminders tabulku), v FlowDetail u kroku se step_state='dormant' && assignees obsahuje meId zobrazit chip se zvonečkem dle ř. 1136, toggle → data-on stav (brass-soft).

### [CRITICAL] Spící (dormant) kroky se zobrazují v Dnes a v seznamech chybí jejich šrafování; chybí i chip „→ Přišlo na tebe"
- **Prototyp:** ř. 3028 (Dnes): `ov=T.filter(t=>t.group==='overdue'&&dayWf(t)&&t.stepStatus!=='waiting'), td=T.filter(t=>t.group==='today'&&dayWf(t)&&t.stepStatus!=='waiting')` — čekající kroky v Dnes vůbec nejsou (README ř. 73: „spící kroky se nezobrazují v Dnes"). V ostatních seznamech řádek nese `data-trow data-dormant="{{ t.stepDormant }}"` (ř. 415) a CSS ř. 113: `[data-trow][data-dormant="true"]{ opacity:.6; box-shadow:none !important; background:repeating-linear-gradient(135deg, transparent, transparent 7px, var(--panel-2) 7px, var(--panel-2) 8px); }`. ř. 424: `<sc-if value="{{ t.handedOff }}"><span style="…padding:2px 8px; border-radius:999px; background:var(--brass-soft); color:var(--brass-text);">→ Přišlo na tebe</span></sc-if>`.
- **Stav app:** screens/Today.tsx:55–70 filtruje jen dle completed_at/due_date — dormant kroky s termínem se ukážou v Dnes; packages/ui/src/TaskCard.tsx nemá dormant variantu (žádné šrafování, žádná opacity .6); handedOff chip neexistuje (chain_steps nemá handed_off, dá se odvodit: step_state='active' && activated_at!=null && position>0).
- **Fix:** Today.tsx: při skládání skupin vyřadit tasky, jejichž chain_step má step_state='dormant' (useFlowSteps už mapu má). TaskCard.tsx: prop dormant → opacity .6 + repeating-linear-gradient pozadí + bez prioritního box-shadow; TaskItem předá flow.state==='dormant'. Chip „→ Přišlo na tebe" zobrazit u aktivního kroku přiřazeného mně (brass-soft pill dle ř. 424).

### [MAJOR] Flow chip na kartě úkolu je ochuzený — chybí název postupu, tečkový progress a barvy dle stavu kroku
- **Prototyp:** ř. 423: `<span data-stepstate="{{ t.stepStateKey }}" onClick="{{ t.onOpenFlow }}" title="Otevřít Postup: {{ t.flowName }} · krok {{ t.stepLabel }}" style="display:inline-flex; align-items:center; gap:5px; font-weight:600; font-size:10.5px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--ink-3);"><svg šipka 11×11/>{{ t.flowName }} {{ t.stepDotsNode }} {{ t.stepLabel }}</span>`. stepDotsNode ř. 2910: řada 5px teček — před aktuálním ink-3, aktuální brass, budoucí prázdné s inset ringem. CSS ř. 121–123: stav now→brass-soft/brass border/brass-text, waiting→panel-2+opacity .85, done→success-soft/success-ink.
- **Stav app:** packages/ui/src/TaskCard.tsx:112–129 — chip je jen `⛓ {pos}/{total}`, vždy brass-soft/brass-text, bez názvu postupu, bez teček, bez ohledu na stav kroku; FlowStepInfo (lib/flowSteps.ts) stav nese, ale TaskItem.tsx:34–41 ho nepředává.
- **Fix:** TaskCard.tsx: flow prop rozšířit o {name, pos, total, state}; vykreslit šipkovou SVG + název + tečkový progress (Array.from(total)) + label, podbarvení dle state (now=brass, dormant=panel-2, done=success-soft). TaskItem.tsx a Today.tsx card() předat chain name (mapa chains) a fs.state.

### [MAJOR] Dnes: „Tvůj další krok v postupech" — chybí hlavička sekce, výpis všech mých kroků a „pak předáš → X"; špatný vizuál karty
- **Prototyp:** ř. 396: hlavička `…font-weight:700; font-size:13px; …<svg 15×15 dvojšipka color:var(--brass)/>Tvůj další krok v postupech`. ř. 397–405: `sc-for myFlowSteps` — VÍCE řádků, každý: `background:var(--brass-soft); border:1px solid var(--line); border-radius:11px; padding:11px 13px` hover border brass, vlevo 7px brass tečka, název (700/13.5), podřádek `{{ f.flowName }} · pak předáš → {{ f.blocking }}` (ř. 3156: blocking = jméno osoby dalšího kroku), vpravo mono brass-text `{{ f.step }}` (X/Y).
- **Stav app:** screens/Today.tsx:73–84 vrací jen PRVNÍ nalezený krok (myNextStep single); ř. 188–215: karta bg-card + border-brass (má být brass-soft bg + line border), vlevo ikonka v boxu místo tečky, podřádek „{chain} · krok X/Y" bez „pak předáš → …", vpravo „→" místo mono X/Y; hlavička sekce chybí.
- **Fix:** Today.tsx: myNextStep → myFlowSteps pole (všechny aktivní kroky přiřazené mně), nad ním hlavička s dvojšipkovou SVG dle ř. 396; kartu přestylovat (brass-soft bg, line border, brass tečka 7px, mono step vpravo) a doplnit „ · pak předáš → {jméno prvního přiřazeného kroku position+1}" z chain_steps+assignments.

### [MAJOR] Detail postupu: chybí stavové barvy kroků (aktivní podbarvení, ztlumení čekajících, barevné pilulky stavů)
- **Prototyp:** CSS ř. 121–129: `[data-steprow="now"]{border-color:var(--brass) !important; background:var(--brass-soft);}`, `[data-steprow="waiting"]{opacity:.66;}`; pilulka stavu `[data-stepstate="now"]{background:var(--brass-soft); border-color:var(--brass); color:var(--brass-text);}`, waiting→panel-2/ink-3/opacity .85, done→success-soft/success-ink/transparent border; tečky osy `[data-stepdot="done"]{background:var(--success-ink); color:#fff}` (success-ink=#1c7a52), skipped→panel-2/ink-3. Screenshot 13: aktivní krok 2 celý béžově podbarvený, pilulka „Teď na řadě" brass, „Hotovo" zeleně.
- **Stav app:** Postupy.tsx:444–485 — karta kroku má jen borderColor brass pro active (žádné brass-soft pozadí), dormant bez opacity .66; stavová pilulka vždy border-line + text-ink-3 (ř. 480–485); tečka done = var(--w-success) místo success-ink; skipped tečka dostane bílý text na panel-2 (dotFg jen pro dormant → neviditelné číslo).
- **Fix:** Postupy.tsx FlowDetail: na kartu kroku background var(--w-brass-soft) při active a opacity .66 při dormant; stavové pilulce dát mapu barev dle stavů (ř. 121–123); dotBg done→var(--w-success-ink), skipped→panel-2 s ink-3 textem (dotFg upravit na sk==='dormant'||sk==='skipped').

### [MAJOR] Builder: chybí 4. šablona „Příprava plesu" a šablony ztratily osoby/režimy
- **Prototyp:** ř. 2516–2522 FLOW_TEMPLATES obsahuje `{ id:'ples', label:'Příprava plesu', desc:'Sál → catering → vyúčtování', steps:[Rezervovat sál(pn,p1)… Sestavit program večera(who:null, gate:'manual', mode:'all')… Vyúčtování akce(mb, offset:9)]}` — celkem 4 šablony ve 2sloupcové mřížce + „Začít prázdně" (screenshot 14 ukazuje 4 karty). Kroky šablon nesou `who` a `mode` (např. „Nahrát epizodu" mode:'all' ř. 2511).
- **Stav app:** Postupy.tsx:48–85 TEMPLATES má jen plakat/podcast/grant (3), komentář „bez mock osob"; mode úplně vypuštěn, takže pick() (ř. 597–603) nastavuje jen name/offset/priority/gate.
- **Fix:** Doplnit šablonu ples (5 kroků, offsety 0/3/5/6/9, gate manual u „Sestavit program večera") a do kroků šablon vrátit mode ('any'/'all') — propsat do assignmentů po doplnění režimu z gapu výše. Osoby řešit rolemi, ne ID.

### [MAJOR] Karty postupů nejsou seřazené (vázne první, pak dle % postupu)
- **Prototyp:** ř. 3155: `const flowsSorted=flowsOverview.sort((a,b)=>(b.stuck-a.stuck)||(b.pct-a.pct));` — zaseknuté postupy nahoře, pak sestupně dle procenta dokončení.
- **Stav app:** Postupy.tsx:110 řadí `chains ORDER BY created_at DESC` a view (ř. 153–168) pořadí nemění.
- **Fix:** Postupy.tsx: po sestavení view přidat `.sort((a,b)=>(Number(b.stuck)-Number(a.stuck)) || (pct(b)-pct(a)))` před mineOnly filtr.

### [MAJOR] Karta postupu: „Teď:" ukazuje jen prvního přiřazeného a řádek se zobrazuje i po dokončení
- **Prototyp:** ř. 3154: `nowWho=now?((now.people||[]).map(pid=>this.person(pid).name).join(', ')||'kdokoli z týmu'):''` — VŠECHNA jména čárkou (screenshot 12: „Teď: Poptávka do tisku · Jana Dvořáková, Ad…"). Šablona ř. 792–797: řádek „Teď: …" je v `<sc-if value="{{ f.hasNow }}">` — bez aktivního kroku se nevykreslí vůbec.
- **Stav app:** Postupy.tsx:148–151 stepWho bere jen `assigneesByTask.get(...)?.[0]`; ř. 256–262 řádek renderuje vždy (fallback „Vše hotovo" uvnitř řádku s brass tečkou).
- **Fix:** Postupy.tsx: pro kartu spočítat nowWho = join všech jmen assignees aktivního kroku (fallback „kdokoli z týmu"); řádek `Teď:` renderovat jen když now existuje (podmíněně, bez tečky u hotových).

### [MAJOR] Hlavička Postupů bez workspace tečky a názvu aktivního prostoru
- **Prototyp:** ř. 775–777: `<span …font-size:17px;>Postupy</span><span data-wsdot="{{ activeWs }}" style="width:8px; height:8px; border-radius:3px; margin-left:4px;"></span><span style="…font-weight:600; font-size:13px; color:var(--ink-3);">{{ activeWsName }}</span>` (CSS ř. 105: wsdot barvy personal #9a8f80 / kancelar #c68a3e / klub #2a6fdb). Screenshot 12: „Postupy • TJ Sokol Praha".
- **Stav app:** Postupy.tsx:176–179 — jen `<h1>Postupy</h1>`, žádná tečka ani název prostoru (useWorkspace poskytuje jen activeWs id).
- **Fix:** Postupy.tsx: vedle h1 vykreslit 8×8 zaoblenou tečku (barva prostoru — přidat color do workspaces / deterministicky z id) + název aktivního prostoru font 13 ink-3 z useWorkspace().

### [MAJOR] Po vytvoření postupu se neotevře jeho detail
- **Prototyp:** ř. 2553 createFlow končí: `this.setState(…{ flowModal:false, flowDraft:null, screen:'postupy', selectedFlow:fid })` — zavře modal a rovnou otevře detail nového postupu.
- **Stav app:** Postupy.tsx:614–658 create() končí jen `onClose()` — uživatel zůstane na mřížce bez otevřeného detailu.
- **Fix:** Postupy.tsx: po dokončení create() zavolat `navigate({ to:'/postupy', search:{ postup: chainId } })` (a až pak onClose).

### [MAJOR] Kaskádové přitažení zpožděného kroku na dnešek při předání štafety chybí
- **Prototyp:** ř. 2483 `_advance` závěr: když nově aktivovaný krok má termín v minulosti a režim je chain, posune ho na dnešek (`date:25, day:'dnes', group:'today', overdue:false`), zavolá `_reflow(tasks, flowId, nowIdx)` na navazující kroky a toastne „Navazující kroky posunuty o N dní/dny/den".
- **Stav app:** lib/chainAdvance.ts:75–89 — advance jen přepíná step_state; due_date aktivovaného kroku ani následníků se nemění, žádný toast.
- **Fix:** chainAdvance.ts: po activateRun() v chain režimu zkontrolovat due_date aktivovaného kroku < dnes → UPDATE na dnešek, přepočítat následníky přes reflow (gap_days ze schématu z gapu #1) a vrátit zprávu pro toast „Navazující kroky posunuty o N dní".

### [MINOR] Relay avatar/iniciály: nepřiřazený krok ukazuje „KZ" místo „?" (a v kartě kroku místo ◇)
- **Prototyp:** flowView ř. 2554: `nextWho:…people[0]?initials:'?'` — spojnicový avatar nepřiřazeného dalšího kroku má „?"; `whoInitials:…people[0]?initials:(st.role?'◇':'')` a `whoName:…'Kdokoli z týmu'`.
- **Stav app:** Postupy.tsx:23–30 + 437/463: `initials(stepWho(next))` — stepWho vrací „kdokoli z týmu" → initials() z toho udělá „KZ"; stejně u avataru v kartě kroku.
- **Fix:** Postupy.tsx: pokud krok nemá assignee, renderovat doslovně „?" na relay avataru a prázdné/◇ v kartě kroku; initials() volat jen na skutečné jméno.

### [MINOR] ETA bez „cca" a progress počítá přeskočené kroky jako hotové
- **Prototyp:** flowView ř. 2554: `eta=_last!=null?('cca '+_last+'. 6.'):''` (screenshot 13: „Odhad dokončení: cca 30. 6.") a `done=steps.filter(x=>x.stepStatus==='done').length` — jen done, skipped se do X/Y nepočítá.
- **Stav app:** Postupy.tsx:341 eta = fmtDay(max due) bez „cca"; ř. 160 done zahrnuje i 'skipped'.
- **Fix:** Postupy.tsx: prefix `cca ` před fmtDay; u progress čítače počítat jen step_state==='done' (skipped nechat v „uzavřeno" logice advance, ale ne v X/Y).

### [MINOR] Enter v otevřeném detailu postupu nedokončí aktivní krok
- **Prototyp:** ř. 2227: `if(this.state.selectedFlow && !this.state.addOpen){ if(e.key==='Enter'){ const now=…find(t.stepStatus==='now'); if(now){ e.preventDefault(); this.toggleDone(now.id)(); } return; } }`.
- **Stav app:** Postupy.tsx FlowDetail:320–326 keydown handler řeší jen Escape.
- **Fix:** Postupy.tsx FlowDetail: v handleru přidat `if(e.key==='Enter' && now?.task_id){ e.preventDefault(); void completeStep(now); }` (guard na psaní v inputu).

### [MINOR] ⌘K paleta neskáče na postupy
- **Prototyp:** ř. 1608 placeholder „Skoč na obrazovku, projekt, člověka, postup…"; README ř. 51: paleta = skok na obrazovku/projekt/člověka/postup.
- **Stav app:** components/CommandPalette.tsx:30–61 skládá jen screens + projects — postupy (ani lidé) v paletě nejsou.
- **Fix:** CommandPalette.tsx: přidat položky z chains (usePsQuery SELECT id,name FROM chains) s run=() => navigate('/postupy', {search:{postup:id}}), sub „Postup".

### [MINOR] Mikrodetaily karet a builderu: hover translateY, brass-soft u vybrané šablony, reset kotvy při přepnutí plánování, empty-state při filtru „jen kde jsem na řadě"
- **Prototyp:** ř. 785: karta postupu `style-hover="box-shadow:var(--shadow); transform:translateY(-2px)"`. CSS ř. 107: `[data-tplcard][data-on="true"]{border-color:var(--brass) !important; background:var(--brass-soft);}`. ř. 2538 setFlowSchedFrom: přepnutí režimu resetuje kotvu (deadline→30, start→25). ř. 3249: empty state jen při `noFlows` (flowsSorted.length===0) — filtr mineOnly nechá prázdnou mřížku, ne hlášku „V tomto prostoru zatím není žádný Postup.".
- **Stav app:** Postupy.tsx:232 hover jen shadow-md bez translateY; ř. 782–786 vybraná šablona mění jen border (bg zůstává panel-2); ř. 755 setSchedFrom datum nemění; ř. 208 `shown.length===0` ukáže globální empty hlášku i při aktivním mineOnly filtru.
- **Fix:** Postupy.tsx: přidat hover:-translate-y-0.5 na kartu; vybrané šabloně background var(--w-brass-soft); při přepnutí schedFrom posunout anchor (start→dnes+7, deadline→dnes+14 apod.); empty-state podmínit `view.length===0` (ne shown).

### [MINOR] Ikony hlaviček: detail postupu má mít šipku, builder dvě spojené kružnice
- **Prototyp:** Detail ř. 1090: 26px brass-soft box se šipkou `<svg viewBox="0 0 12 12"><path d="M1.5 6 H8 M5.5 3 L8.5 6 L5.5 9"…/></svg>`; builder ř. 1514: `<svg viewBox="0 0 16 16"><circle cx="4" cy="8" r="2.2"/><circle cx="12" cy="8" r="2.2"/><path d="M6 8 H10"/></svg>`.
- **Stav app:** Postupy.tsx:372 i 685 používají shodně `<Icon name="postup"/>` (tři kružnice z ICONP) v obou hlavičkách.
- **Fix:** packages/ui/src/Icon.tsx: přidat ikony 'postupArrow' (šipka 12×12) a 'postupChain' (2 kružnice) dle výňatků; použít v FlowDetail resp. FlowModal hlavičce.

### [MINOR] „Aktivovat krok" tlačítko v detailu je nad rámec prototypu (odchylka)
- **Prototyp:** Prototyp u manual gate kroku žádné aktivační tlačítko nemá — krok zůstává waiting a dokončuje se přímo checkboxem v seznamu (flowView ř. 2554 zná jen onComplete/onRewind/onRemind; _advance ř. 2483 na manual gate jen `break`).
- **Stav app:** Postupy.tsx:501–510 zobrazuje „Aktivovat krok" pro dormant+manual+priorClosed (activateStepManually v chainAdvance.ts:97–104).
- **Fix:** Funkčně užitečné rozšíření — ponechat, ale vizuálně sladit s chip styly prototypu (border line, ne brass), nebo po dohodě odstranit pro 1:1.


## Nastavení + tmavý režim — 70 %

### [CRITICAL] Tmavá paleta je neúplná — chybí ~12 dark token overridů (soft barvy, stíny, avatar, sidebar ink)
- **Prototyp:** WatsonApp.dc.html ř. 28–39 — [data-w-theme="dark"] přepisuje CELOU paletu: `--sidebar-ink:#eef1f4; --sidebar-ink-2:rgba(232,238,244,.56); --sidebar-line:rgba(255,255,255,.08); --brass-soft:rgba(214,164,96,.16); --success:#39ad7d; --success-soft:rgba(46,156,110,.16); --success-ink:#6fd2a6; --overdue:#e07365; --overdue-soft:rgba(224,115,101,.17); --avatar-navy:#33455f; --shadow:0 1px 2px rgba(0,0,0,.3), 0 16px 36px rgba(0,0,0,.42); --shadow-sm:0 1px 2px rgba(0,0,0,.32);`. Screenshot 20-tmavy-rezim.png: „po termínu" je měkce lososové (#e07365), pilulky/chipy mají tmavé alpha pozadí, stíny hluboké černé, avatary světlejší navy #33455f.
- **Stav app:** packages/ui/src/tokens.css:98–113 — dark blok přepisuje jen 14 tokenů (paper, card, panel-2, sidebar, ink 1–3, line, brass, brass-text, p1–p4). --w-brass-soft zůstává rgba(198,138,62,.13), --w-success-soft zůstává #eaf6f0, --w-overdue-soft zůstává #fbedea (světle růžová!), --w-overdue #c2473c, --w-success-ink #1c7a52, --w-avatar/--w-navy #17283f, --w-shadow* světlé. Soft tokeny konzumuje ~20 souborů (Today.tsx, Reporty.tsx, TaskCard.tsx…) → v dark módu svítí světlé mint/růžové chipy na tmavých kartách.
- **Fix:** packages/ui/src/tokens.css — do bloku [data-w-theme="dark"] doplnit VŠECHNY overridy z prototypu ř. 28–39: --w-brass-soft, --w-success, --w-success-soft, --w-success-ink, --w-overdue, --w-overdue-soft, --w-avatar:#33455f, --w-sidebar-ink:#eef1f4, --w-sidebar-ink-2:rgba(232,238,244,.56), --w-sidebar-line:rgba(255,255,255,.08), --w-shadow, --w-shadow-sm. Zároveň v komponentách přepnout avatary z var(--w-navy)/bg-navy na var(--w-avatar) (např. Nastaveni.tsx:279, Sidebar, Reporty), aby dark override měl efekt.

### [MAJOR] Stav tématu není sdílený — přepnutí v headeru nepřepne switch v Nastavení (a naopak)
- **Prototyp:** WatsonApp.dc.html ř. 2385: `toggleTheme = () => { const t = this.state.theme==='dark'?'light':'dark'; this.setState({theme:t}); this.persist({theme:t}); };` — jediný stav `theme` v jedné třídě Component; ř. 3224 z něj odvozuje `themeIsDark`, `switchBg`, `knobMl` pro header ikonu I settings switch současně.
- **Stav app:** layout/useTheme.ts:10–23 je plain hook s lokálním useState; Header.tsx:21 a Nastaveni.tsx:62 mají DVĚ nezávislé instance. Klik na měsíček v headeru změní <html data-w-theme> + localStorage, ale switch v Nastavení zůstane v levé (světlé) poloze; první klik na něj pak stale stavem nastaví 'dark' znovu → viditelně „nefunguje na první klik". Stejně tak ikona slunce/měsíc v headeru se nepřepne po kliknutí v Nastavení.
- **Fix:** apps/web/src/layout/useTheme.ts — přepsat na sdílený stav: module-level store + useSyncExternalStore (nebo React context v AppLayout.tsx). Jeden zdroj pravdy pro theme, Header i Nastaveni jen subscribují.

### [MAJOR] Tým a role ignoruje aktivní prostor — vždy první týmový workspace, sekce se ukazuje i v osobním prostoru
- **Prototyp:** WatsonApp.dc.html ř. 3182: `const teamRoster=this.wsMembers(s.activeWs)...` — roster je z AKTIVNÍHO prostoru; ř. 911 `<sc-if value="{{ wsTeam }}">` sekci skryje, když je aktivní osobní prostor; ř. 914 `<span data-wsdot="{{ activeWs }}">` + ř. 105 CSS: `[data-wsdot="personal"]{ background:#9a8f80; } [data-wsdot="kancelar"]{ background:#c68a3e; } [data-wsdot="klub"]{ background:#2a6fdb; }` — tečka má barvu prostoru.
- **Stav app:** screens/Nastaveni.tsx:91 `const teamWs = workspaces?.find((w) => !w.isPersonal);` — bere první ne-osobní workspace bez ohledu na aktivní prostor (context useWorkspace v lib/workspace.tsx existuje, ale Nastavení ho nepoužívá). Tečka ř. 248–256 má natvrdo `background: "var(--w-brass)"`.
- **Fix:** screens/Nastaveni.tsx — použít `useWorkspace()` z lib/workspace.tsx: roster pro activeWs; když je aktivní osobní prostor, sekci Tým a role nevykreslit. Barvu tečky mapovat z barvy/typu workspace (přidat ws barvu do API/na klienta), ne hardcode brass.

### [MAJOR] Chybí pracovní pozice člena v podtitulku (jen e-mail místo „Vedoucí provozu · adela.kucerova@firma.cz“)
- **Prototyp:** WatsonApp.dc.html ř. 924: `<div style="font-family:var(--w-font-body); font-size:11.5px; color:var(--ink-3); ...">{{ m.job }} · {{ m.email }}</div>`; ř. 3182 plní `job:p.role||''` (pozice z PEOPLE seedu, např. „Vedoucí provozu", „Projektový manažer"). Screenshot 19: u AK „Vedoucí provozu · adela.kucerova@firma.cz", u TM „Projektový manažer · tomas.marek@firma.cz".
- **Stav app:** screens/Nastaveni.tsx:287–298 renderuje jen `{m.email}`; typ Member (ř. 18–25) job nemá; API /api/workspaces/:id/members (apps/api/src/index.ts:170–185) vrací jen id, name, email, image, role, isOwner — pozice v DB neexistuje.
- **Fix:** apps/api: přidat sloupec jobTitle (users nebo memberships) + vrátit ho v GET /api/workspaces/:id/members + doplnit do seedu; apps/web/src/screens/Nastaveni.tsx: podtitulek `{job} · {email}` (fallback jen email, když job chybí).

### [MAJOR] Klik na avatara/jméno člena neotevírá jeho kartu (vytížení + úkoly)
- **Prototyp:** WatsonApp.dc.html ř. 920: `<span onClick="{{ m.onOpen }}" style="...cursor:pointer;">{{ m.initials }}</span>`; ř. 923: `<div onClick="{{ m.onOpen }}" style="...cursor:pointer;" style-hover="color:var(--brass-text)">{{ m.name }}</div>` — onOpen=openMember(p.id) otevře member detail panel (ř. 3143–3144: efektivita, vytížení, úkoly, cíle). Footnote ř. 942 to explicitně slibuje: „Klik na člena otevře jeho kartu s vytížením a úkoly."
- **Stav app:** screens/Nastaveni.tsx:279 (Avatar) a 281–286 (jméno) — žádný onClick, žádný cursor:pointer, žádný hover. Přitom member detail v appce existuje: Reporty.tsx:61 čte `?tab=lide&clen=<id>` a panel renderuje.
- **Fix:** screens/Nastaveni.tsx — avatar i jméno obalit klikem `navigate({ to: "/reporty", search: { tab: "lide", clen: m.id } })`, jménu přidat cursor:pointer + hover color var(--w-brass-text) (className hover:text-brass-text).

### [MAJOR] Invite modal se liší od prototypu (markup, texty) a pozvaný člen se nepřidá do seznamu
- **Prototyp:** WatsonApp.dc.html ř. 1273–1289: šířka 440, padding-top:14vh, radius 16, animace wPop .18s; title „Přidat člena týmu" (17px/800); uppercase mikro-labely „Jméno" a „E-mail" (10.5px/700/.06em) nad inputy; placeholdery „Jan Novák" / „jan.novak@firma.cz"; footer s border-top a poznámkou vlevo „Pošleme pozvánku na zadaný e-mail." + tlačítka „Zrušit" / „Pozvat" (brass). Chování ř. 2384 submitMember: nový člen se PŘIDÁ do rosteru (newMembers, podtitulek „Pozván(a)") — žádný toast.
- **Stav app:** screens/Nastaveni.tsx:540–609 InviteModal — šířka 400, paddingTop 16vh, bez field labelů, title z i18n „Pozvat člena" (16px), placeholdery „Jméno"/„E-mail", bez footer poznámky, button „Odeslat pozvánku", bez animace; po odeslání jen toast „Pozvánka odeslána" (ř. 482–498), roster beze změny.
- **Fix:** screens/Nastaveni.tsx — srovnat modal 1:1 s ř. 1273–1289 (título „Přidat člena týmu", labely Jméno/E-mail, placeholdery, footer note, Pozvat, 440px/14vh, wPop keyframe do index.css) a po odeslání optimisticky přidat řádek člena s podtitulkem „Pozván(a)" do rosteru (lokální stav do doby reálné mail infra).

### [MINOR] Role menu nemá volbu „Vlastník“ a pill vlastníka není klikací; chybí wPop animace
- **Prototyp:** WatsonApp.dc.html ř. 2305: `ROLE_PERMS = ['Vlastník','Admin','Člen','Host'];` — menu má 4 volby; ř. 3182 `onToggleRole:this.toggleRoleMenu(p.id)` pro KAŽDÉHO člena vč. vlastníka (pill s chevronem je klikací u všech); dropdown ř. 928 má `animation:wPop .14s ease`.
- **Stav app:** screens/Nastaveni.tsx:303 `onClick={() => !m.isOwner && ...}` — owner pill zamčený (cursor default); menu ř. 352–357 jen admin/member/guest; dropdown bez animace. Server (apps/api/src/index.ts:189+) navíc převod vlastnictví nepodporuje (`cannot change owner role`).
- **Fix:** Buď doplnit volbu „Vlastník" (transfer ownership endpoint) + klikatelný owner pill dle prototypu, nebo minimálně přidat wPop animaci dropdownu (keyframe v index.css + className). Rozhodnutí zaznamenat do reconciliace v files/, pokud transfer vlastnictví zůstane vědomě mimo MVP.

### [MINOR] Hustota nemění --w-card-pad (prototyp mění padding karet) a default je „kompaktní“ proti doporučení README
- **Prototyp:** WatsonApp.dc.html ř. 40–42: `[data-w-density="vzdusne"] { --row-py:15px; --row-font:15px; --card-pad:18px; } [data-w-density="vyvazene"] { ...--card-pad:15px; } [data-w-density="kompaktni"] { ...--card-pad:13px; }`. README ř. 111: „Vzdušné … a Vyvážené … — produkčně doporučeny obě; kompaktní raději vynechat."
- **Stav app:** apps/web/src/index.css:53–55 nastavuje jen --w-row-py/--w-row-font (card-pad chybí); --w-card-pad v tokens.css:85 je statický a nikde není konzumován. lib/tweaks.ts getDensity() defaultuje na 'kompaktni'.
- **Fix:** index.css: doplnit `--w-card-pad: 18/15/13px` do tří density pravidel a konzumovat ho v kartách (packages/ui/src/TaskCard.tsx a karty obrazovek místo pevných paddingů); lib/tweaks.ts: default 'vzdusne' (nebo 'vyvazene') a zvážit odebrání volby kompaktní dle README ř. 111.

### [MINOR] Řádek „Hustota a barevnost“ se vizuálně liší od screenshotu (Tweaks pill → dva řádky segmentů)
- **Prototyp:** WatsonApp.dc.html ř. 898–901: jediný řádek — title „Hustota a barevnost", desc „Vzdušné ↔ kompaktní a akcent projektů ladíš v panelu Tweaks.", vpravo pill `<span style="...font-size:11px; padding:5px 11px; border-radius:999px; background:var(--brass-soft); color:var(--brass-text);">Tweaks</span>`. Screenshot 19 to potvrzuje. (Density/accent jsou v prototypu design-tool props, ř. 1894.)
- **Stav app:** screens/Nastaveni.tsx:165–192 — dva řádky se segmentovými přepínači (Hustota: Vzdušné/Vyvážené/Kompaktní; Akcent projektů: Více barev/Jen brass). Funkčně nadstavba (v produkci nutná), ale vizuál neodpovídá pixel referenci a desc text mluví o „panelu Tweaks", který v appce neexistuje.
- **Fix:** Ponechat funkční segmenty (produkční materializace Tweaks), ale: (a) upravit i18n settings.densityDesc, ať neodkazuje na neexistující panel Tweaks, nebo (b) vrátit 1 řádek s pill „Tweaks", který rozbalí segmenty. Zvolenou variantu zapsat do design-reconciliace ve files/.

### [MINOR] Header: extra CS/EN tlačítko, které v prototypu není, + hover odchylka ikon-buttonů
- **Prototyp:** WatsonApp.dc.html ř. 297–305: pevné pořadí akcí — lupa, zvonek (onClick toggleWatson, s tečkou), motiv (slunce/měsíc), Watson pill, + Úkol. Žádný jazykový přepínač. Hover ikon-buttonů: zvonek/motiv `style-hover="color:var(--brass-text)"` (jen barva textu), lupa `style-hover="border-color:var(--brass)"`.
- **Stav app:** layout/Header.tsx:138–145 přidává CS/EN button mezi motiv a Watson pill (v pixel referenci 19/20 není); ICON_BTN (ř. 9–10) aplikuje hover border i barvu na všechny buttony jednotně.
- **Fix:** layout/Header.tsx — přesunout jazykový přepínač do Nastavení (nová sekce/řádek, mimo header), nebo rozhodnutí zapsat do reconciliace; volitelně sladit hover chování per-button dle prototypu.

### [MINOR] Knob přepínačů: offset 18px místo 20px z prototypu
- **Prototyp:** WatsonApp.dc.html ř. 82–84: `[data-w-theme="dark"] [data-switch] > div{ margin-left:20px; }` a notifikační toggly ř. 950: `<div style="width:20px; ... margin-left:20px;"></div>` — knob v ON poloze má margin-left 20px (doražený k pravému okraji).
- **Stav app:** screens/Nastaveni.tsx:159 `marginLeft: theme === "dark" ? 18 : 0` a ř. 668 `marginLeft: 18` — o 2 px jinde; navíc ON klidová poloha začíná na 0 místo 2px vizuálního středu (prototyp má `margin-left:2px` v light, ř. 83).
- **Fix:** screens/Nastaveni.tsx — light poloha marginLeft 2? Ne — app má padding 2 na buttonu, takže 0 je ok; ON polohu srovnat na 18–20 dle skutečného renderu proti screenshotu (prototyp deklaruje 20). Kosmetika, stačí sjednotit obě místa (ř. 159 i 668) na stejnou hodnotu.

### [MINOR] Chybí dark overridy pro barevné tinty úkolů [data-tc] (návaznost na per-task barvy)
- **Prototyp:** WatsonApp.dc.html ř. 60–63: světlé tinty `[data-tc="rose"]{ background:#fbeceb !important; }` … a dark varianty `[data-w-theme="dark"] [data-tc="rose"]{ background:rgba(216,71,61,.17) !important; }` … (všech 10 barev, alpha .17/.2); ř. 118 `[data-w-theme="dark"] [data-done="true"][data-tc]{ background:var(--panel) !important; }`.
- **Stav app:** V apps/web/src ani packages/ui není žádné `data-tc`/tint tělo karty — per-task barva pozadí zatím není implementovaná vůbec (lib/colors.ts má jen syté hexy palety). Až se bude stavět (modul Detail úkolu / barva), bez dark větve budou světlé pastely svítit v dark módu.
- **Fix:** Při implementaci per-task barev přenést OBĚ sady z prototypu ř. 60–63 + 118 do apps/web/src/index.css (light pastel + dark alpha), klíčovat data-atributem na kartě.


## App shell — sidebar + header + Watson panel + Schránka/Hledat — 70 %

### [CRITICAL] Zámek výchozího zobrazení (viewLock) chybí úplně
- **Prototyp:** ř. 283–287: `<span onClick="{{ toggleViewLock }}" data-chip data-on="{{ viewLocked }}" title="Zamknout toto zobrazení jako výchozí pro všechny sekce" style="...width:32px; height:32px; border-radius:9px; border:1px solid var(--line)...">` + dvě SVG varianty zámku (zamčený rect+oblouk / odemčený s otevřeným obloukem) + ř. 287 transientní štítek `Výchozí: {{ lockLabel }}` (brass-soft pill, mizí po 2,6 s — `lockJustSet`, ř. 2258 `this._lockT=setTimeout(...,2600)`). Logika ř. 2257 (goTo aplikuje `lockedView` na sekce nadchazejici/seznam/hledat/oblibene) a ř. 3240 `lockLabel` skládá např. „Kalendář · Týden · Mřížka". Persistuje se v localStorage (`persist({ viewLock, lockedView })`). Vidět na screenshotu 03 (ikona zámku vlevo od lupy).
- **Stav app:** Nikde — `grep viewLock/lock` v apps/web/src nenajde nic. Header.tsx žádný zámek nemá, Ukoly.tsx:23 má jen vlastní `VIEW_LS="watson.viewMode"` per obrazovku.
- **Fix:** apps/web/src/layout/Header.tsx (přidat lock button + label vedle view tabů) + nový sdílený stav (localStorage `watson.viewLock`/`lockedView`) např. v layout/useViewMode.ts; Ukoly.tsx/Nadchazejici.tsx/Oblibene.tsx číst zamčené výchozí view při vstupu na obrazovku (ekvivalent goTo ř. 2257).

### [CRITICAL] Workspace chipy „Vše / Moje / Kancelář / Sokol" na Dnes a Nadcházející chybí
- **Prototyp:** ř. 342–346: `<sc-if value="{{ showDayWs }}">… <span onClick="{{ c.onClick }}" data-wschip data-on="{{ c.on }}" style="display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:12px; padding:5px 11px; border-radius:999px; border:1px solid var(--line)..."><span data-wsdot="{{ c.id }}" style="width:7px; height:7px; border-radius:2px"></span>{{ c.label }}</span>`; CSS ř. 110 `[data-wschip][data-on="true"]{ background:var(--brass-soft); border-color:var(--brass); color:var(--brass-text) }`; logika ř. 3256 `showDayWs:(screen==='dnes'||screen==='nadchazejici')`, chipy `[{label:'Vše'}, …WORKSPACES]`, filtr `dayWf` ř. 3025. Výrazně vidět na screenshotech 01 i 02 (první řádek obsahu).
- **Stav app:** Nikde — `grep dayWs/wschip` v apps/web/src nic nenajde. Today.tsx ani Nadchazejici.tsx chipy nerenderují, filtrování podle prostoru na těchto obrazovkách neexistuje.
- **Fix:** apps/web/src/screens/Today.tsx + Nadchazejici.tsx: řádek chipů nad toolbar (Vše + useWorkspaces() s barevnou tečkou ws.color, radius 2px), lokální stav dayWs (null=Vše), filtr úkolů přes project.workspace_id; aktivní chip brass-soft/brass.

### [MAJOR] View přepínač Seznam/Nástěnka/Kalendář je v obsahu a má úplně jiný styl (má být v headeru jako segment)
- **Prototyp:** ř. 277–282 (v TOPBARu, hned za titulkem): `<div style="margin-left:6px; flex:none; display:flex; background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:3px;"> <span onClick="{{ v.list }}" style="font-weight:600; font-size:12.5px; padding:5px 12px; border-radius:7px;" data-tab data-active="{{ viewIs.list }}">Seznam</span>…`; CSS ř. 50–51 `[data-tab]{ background:transparent; color:var(--ink-3) } [data-tab][data-active="true"]{ background:var(--panel); color:var(--ink) }`; ř. 3241 `showViewSwitcher: isWorkspace && screen!=='dnes' && screen!=='schranka'`. Screenshot 02/03: taby sedí v headeru vedle titulku, aktivní tab = bílá výplň.
- **Stav app:** Header.tsx switcher nemá vůbec; Ukoly.tsx:188–199 renderuje ViewTab v obsahu stránky a Ukoly.tsx:364–386 ho stylizuje jako brass chip (brass-soft bg + brass border + brass-text) — v prototypu je aktivní tab bílý panel bez brass.
- **Fix:** Přesunout přepínač do apps/web/src/layout/Header.tsx (render pro /ukoly, /nadchazejici, /oblibene…), kontejner panel-2 + border line + radius 10 + padding 3, tab 5px 12px radius 7, aktivní = bg var(--w-card)/color ink; view stav vytáhnout ze screens do sdíleného kontextu nebo URL.

### [MAJOR] Podtitulek headeru: chybí hodiny „· X,X h" a zobrazuje se jen na Dnes
- **Prototyp:** ř. 269–274: `<sc-if value="{{ isWorkspace }}"><div style="…font-family:var(--w-font-mono); font-size:11.5px; color:var(--ink-3);"><span>{{ count }} úkolů</span><sc-if value="{{ hasTime }}"><span>· {{ timeLabel }}</span></sc-if></div>`; ř. 3022 `isWorkspace = ['dnes','seznam','nadchazejici','oblibene','board','kalendar']`; ř. 3091–3092 `timeSum = src.filter(t=>t.start!=null).reduce((a,t)=>a+(t.end-t.start),0); timeLabel=(Math.round(timeSum/60*10)/10).toString().replace('.',',')+' h'`. Screenshoty: „19 úkolů · 8,8 h" (01), „30 úkolů · 15,3 h" (02), „31 úkolů · 16,3 h" (03).
- **Stav app:** Header.tsx:26–47 — `showSubtitle = path === "/"` (jen Dnes), počítá jen `count(*) tasks WHERE completed_at IS NULL` (globálně, ne per obrazovka) a hodiny nezobrazuje vůbec.
- **Fix:** Header.tsx: podtitulek pro všechny workspace routes (/, /nadchazejici, /ukoly, /oblibene/*, kalendář), count per obrazovka (stejná filtrace jako obsah) + suma `duration_min` otevřených úkolů dne/rozsahu → formát `X,X h` s čárkou; render `{count} úkolů · {timeLabel}` mono 11,5 px ink-3.

### [MAJOR] Inline hledání v headeru (rozbalovací input filtrující aktuální seznam) chybí
- **Prototyp:** ř. 290–296: `<sc-if value="{{ searchOpen }}"><div style="display:flex;…background:var(--panel-2); border:1px solid var(--line); border-radius:9px; padding:6px 11px; width:200px;"><svg lupa/><input value="{{ search }}" onChange="{{ onSearch }}" placeholder="Hledat…"/><span onClick="{{ toggleSearch }}">×</span></div>`; ř. 2722 `toggleSearch=()=>…{searchOpen:!s.searchOpen, search:''}`; ř. 2218 klávesa `/` → `focusSearch` (ř. 2261 fokusuje tento input); ř. 3012–3013 `match=(t)=>!q||t.name.toLowerCase().includes(q)` — dotaz živě filtruje úkoly aktuální obrazovky (seznam, board i kalendář).
- **Stav app:** Header.tsx:51–72 — lupa jen `navigate({to:"/hledat"})`; keyboard.tsx:78–82 — `/` také jen naviguje na /hledat. Živý filtr aktuálního seznamu neexistuje.
- **Fix:** Header.tsx: stav searchOpen + 200px input (panel-2, radius 9) místo tlačítka; hodnotu sdílet přes context (např. lib/listSearch.tsx) a v Today/Ukoly/Nadchazejici filtrovat `name.includes(q)`; `/` v keyboard.tsx otevřít+fokusovat tento input (na /hledat fokusovat tamní input).

### [MAJOR] Sidebar: klik na projekt otevírá detail panel místo filtrovaného seznamu Úkolů; chybí aktivní stav řádku
- **Prototyp:** ř. 242 `<div onClick="{{ p.onClick }}" data-projrow data-active="{{ p.active }}"…>` + ř. 2295 `openProj = (pid)=>()=>{ …this.setState({ activeWs:ws, projFilter:pid, screen:'seznam', view:'list'… }) }` → otevře Úkoly filtrované na projekt (hlavička s „Upravit projekt" a „← Všechny úkoly", ř. 334–341). Aktivní řádek: CSS ř. 106 `[data-projrow][data-active="true"]{ background:rgba(255,255,255,.10); color:var(--sidebar-ink) }` (`active:p.id===s.projFilter`, ř. 3177).
- **Stav app:** Sidebar.tsx:368–400 — klik volá `projectDetail.open(p.id)` (otevře ProjectDetailPanel) a řádek nemá žádný active stav. Přitom Ukoly.tsx:32–33 už umí `?projekt=` filtr s bannerem.
- **Fix:** Sidebar.tsx: onClick → `navigate({to:"/ukoly", search:{projekt:p.id}})` + `setActiveWs(ws.id)`; active = aktuální `?projekt` z useSearch → bg rgba(255,255,255,.10) + color sidebar-ink. V Ukoly banneru doplnit odkaz „Upravit projekt" (ten ať otevírá projectDetail — dle ř. 338).

### [MAJOR] Watson panel: „Tvé cíle tento týden" bez progress baru, procent a hodnoty
- **Prototyp:** ř. 1501–1504 `{{ myGoals }}` renderuje goalRowNode (ř. 2370): řádek `padding:'11px 0', borderBottom:'1px solid var(--line)'` s názvem (display 600 13px), mono hodnotou `pr.label` (11.5px ink-3), procenty `pr.pct+' %'` (700 12.5px) a pod tím 5px progress bar `height:'5px', borderRadius:999, background:'var(--panel-2)'` s výplní v barvě stavu `st[3]` (ontime zelená / late overdue / open šedá — `data-goaldot` ř. 144). Klik otevře detail cíle (`openGoal`).
- **Stav app:** WatsonPanel.tsx:195–208 — jen karta s názvem a textem „cíl {target}" (watson.goalTarget); žádný progress, žádná % , žádná stavová barva, klik nedělá nic.
- **Fix:** WatsonPanel.tsx: spočítat progress cíle z tasks (stejný výpočet jako obrazovka Cíle — vytáhnout do lib/goals.ts), render name + mono label + pct % + 5px bar se stavovou barvou, onClick → navigate /cile (+ otevření detailu cíle).

### [MAJOR] Watson panel: chybí insight „ohrožený cíl" a „kolize v kalendáři"
- **Prototyp:** ř. 3122–3127: `riskG` = cíle kde status je risk/over → insight `{ text:'Cíl „'+g.name+'" je ohrožený — '+pr.pct+' % hotovo, ale uplynulo '+(g.elapsed)+' % času.', action: riskG.length>1?('Zobrazit cíle · '+riskG.length):'Otevřít cíle', onAction:()=>this.goTo('cile') }`; dále i2 `{ text:'Schůzky se kryjí s blokem hluboké práce (14:30–16:00).', action:'Otevřít kalendář', onAction:()=>this.goTo('kalendar') }`. Insighty mají pořadí: cíl → zpožděné → kolize.
- **Stav app:** WatsonPanel.tsx:80–99 — jen 2 insighty: overdue (OK, odpovídá i1) a generický „Naplánuj si den" → /nadchazejici. Goal-risk ani kolize časů neexistují.
- **Fix:** WatsonPanel.tsx: přidat insight z cílů (progress vs. uplynulý čas periody → risk) s akcí „Otevřít cíle" a detekci překryvu dnešních úkolů s časy (due_time/duration_min) s akcí otevřít kalendář; zachovat pořadí cíl→zpožděné→kolize.

### [MINOR] Watson panel a drawer bez slide-in animace
- **Prototyp:** ř. 1478: drawer `…z-index:43; display:flex; flex-direction:column; animation:wSlide .22s ease;` + keyframes ř. 43 `@keyframes wSlide { from { transform:translateX(26px); opacity:0 } to { transform:none; opacity:1 } }`.
- **Stav app:** WatsonPanel.tsx:112–115 — drawer bez animace; v index.css ani tokens.css žádné wSlide keyframes (grep prázdný).
- **Fix:** apps/web/src/index.css: přidat @keyframes wSlide; WatsonPanel.tsx (a TaskDetailPanel/ProjectDetailPanel) style `animation: wSlide .22s ease`.

### [MINOR] Header má navíc CS/EN tlačítko, které v prototypu neexistuje
- **Prototyp:** ř. 289–311 — pořadí akcí headeru je přesně: lupa → zvonek → motiv → Watson pill → + Úkol. Žádný jazykový přepínač (viz i screenshoty 01–03).
- **Stav app:** Header.tsx:138–145 — tlačítko `CS / EN` mezi motivem a Watson pill.
- **Fix:** Header.tsx: přepínač jazyka přesunout do Nastavení (screens/Nastaveni.tsx, sekce vzhled/účet) a z headeru odstranit, ať sekvence ikon odpovídá prototypu.

### [MINOR] Hover stavy ikon v headeru se liší od prototypu
- **Prototyp:** ř. 298 lupa: `style-hover="border-color:var(--brass)"` (jen border); ř. 300 zvonek a ř. 301 motiv: `style-hover="color:var(--brass-text)"` (jen barva textu, border zůstává var(--line)).
- **Stav app:** Header.tsx:9–10 — jednotné `ICON_BTN … hover:border-brass hover:text-brass-text` pro všechna tři tlačítka.
- **Fix:** Header.tsx: rozdělit — lupa `hover:border-brass` (bez změny barvy), zvonek+motiv `hover:text-brass-text` (bez borderu).

### [MINOR] Sidebar: chybí hover stavy nav řádků, projektů, ws hlaviček a rail togglu
- **Prototyp:** ř. 179/183/188… každý `[data-nav]` má `style-hover="color:var(--sidebar-ink)"`; ř. 236 chevron a ř. 238 název prostoru také `style-hover="color:var(--sidebar-ink)"`; ř. 242 projektový řádek totéž; ř. 170 rail toggle `style-hover="background:rgba(255,255,255,.08); color:var(--sidebar-ink)"`.
- **Stav app:** Sidebar.tsx — NavRow (ř. 60–81) nemá žádnou hover třídu; projektové buttony (368–400), ws název (346–360) a chevron (313–336) taky ne; rail toggle (184–199) mění jen barvu textu, ne pozadí.
- **Fix:** Sidebar.tsx: doplnit `hover:text-[var(--w-sidebar-ink)]` na NavRow/projekty/ws prvky a `hover:bg-[rgba(255,255,255,.08)]` na rail toggle.

### [MINOR] Klik na název prostoru má prostor aktivovat A přejít na Projekty
- **Prototyp:** ř. 238 `<span onClick="{{ ws.onOpen }}">{{ ws.name }}</span>` kde `ws.onOpen = this.setActiveWs(w.id,'projekty')` (ř. 3177 + 2319) — přepne aktivní prostor, rozbalí ho a naviguje na obrazovku Projekty.
- **Stav app:** Sidebar.tsx:346–360 — klik volá jen `setActiveWs(ws.id)` (lib/workspace.tsx), bez navigace.
- **Fix:** Sidebar.tsx: onClick názvu ws → `setActiveWs(ws.id)` + `navigate({to:"/projekty"})` (chevron nechat jen na collapse).

### [MINOR] Schránka: select projektů nabízí projekty všech prostorů; 3tečka má být vertikální
- **Prototyp:** ř. 3086–3087: `const wsProjs=this.PROJECTS.filter(p=>this.inWS(p))` — možnosti selectu jsou jen projekty AKTIVNÍHO prostoru. Ikona otevření ř. 586: `<svg width="16" viewBox="0 0 16 16"><circle cx="8" cy="3.5"…/><circle cx="8" cy="8"…/><circle cx="8" cy="12.5"…/></svg>` — tři tečky SVISLE.
- **Stav app:** Schranka.tsx:38–41 — `targetProjects` = všechny ne-inbox projekty bez ohledu na aktivní prostor; ř. 150 používá Icon "vice" (packages/ui/src/Icon.tsx:37 — tečky VODOROVNĚ cx 6/12/18).
- **Fix:** Schranka.tsx: filtrovat targetProjects přes `useWorkspace().activeWs` (p.workspace_id === activeWs); přidat ikonu `vice-v` (vertikální tečky) do packages/ui/src/Icon.tsx a použít ji zde.

### [MINOR] Hledat: podtitulek osoby (role), hledání dle role, klik na projekt/cíl vede jinam, titulek „Hledání"
- **Prototyp:** ř. 3075: `people = …filter(p=>p.name…includes(ql)||(p.role||'').toLowerCase().includes(ql))…sub:p.role||'Člen'` — sub je ROLE („Obchod", „Projektový manažer") a hledá se i podle ní. ř. 2315 `searchProj` → filtrovaný seznam Úkolů (`projFilter:pid, screen:'seznam'`); ř. 2312 `searchGoal = (id)=>()=>this.setState({ screen:'cile', selectedGoal:id })` — otevře přímo detail cíle. Titulek headeru ř. 3064: `hledat:'Hledání'`.
- **Stav app:** Hledat.tsx:115–123 — sub vždy t("search.member")=„Člen", role se nehledá (hledá se email, což prototyp nedělá); ř. 104–113 projekt → projectDetail.open (detail panel); ř. 152–160 cíl → jen navigate /cile bez otevření. Header title = nav.search „Hledat".
- **Fix:** Hledat.tsx: do members API/typu doplnit roli a použít ji jako sub + match; projekt → navigate /ukoly?projekt=id; cíl → navigate /cile + otevřít detail (search param); cs.json: samostatný klíč pro titulek obrazovky „Hledání".

### [MINOR] Sidebar počty: „Přiřazeno mně" počítá i created_by, „Úkoly" počítá i inbox úkoly
- **Prototyp:** ř. 3150: `mne:T.filter(t=>(t.people||[]).includes('ak')&&!t.done).length` — POUZE přiřazené (ne autor); `seznam:T.filter(t=>!t.done&&!t.inbox).length` — bez schránkových úkolů.
- **Stav app:** Sidebar.tsx:144–145 — `/oblibene/me` = `created_by === userId || assigned.has(id)`; ř. 143 `/ukoly` = všechny otevřené vč. inbox nezařazených.
- **Fix:** Sidebar.tsx counts: mne = jen assignments; /ukoly = tasks.filter(t => !(t.project_id && inbox.has(t.project_id) && !t.due_date && !t.parent_id)).length — konzistentně se Schránkou.

### [MINOR] Mikrodetaily sidebaru: aktivní ws-head pozadí .05 místo .06, ikony stroke 2 místo 1.9
- **Prototyp:** CSS ř. 104: `[data-wshead][data-active="true"]{ background:rgba(255,255,255,.06) }`; nav ikony ř. 180 atd.: `stroke-width="1.9"`.
- **Stav app:** Sidebar.tsx:310 — `background: wsActive ? "rgba(255,255,255,.05)"`; packages/ui/src/Icon.tsx:87 — `strokeWidth={2}` pro celou sadu.
- **Fix:** Sidebar.tsx: .05 → .06; Icon.tsx: default strokeWidth 1.9 (prototyp uvádí 1.9–2, nav používá 1.9).


## completeness-critic — 46 %

### [CRITICAL] Globální undo/redo (⌘Z / ⌘⇧Z) s historií úkolů chybí úplně — mazání je nevratné
- **Prototyp:** WatsonApp.dc.html ř. 2206: `if(mod && (e.key==='z'||e.key==='Z')){ if(typing) return; e.preventDefault(); if(e.shiftKey) this.redo(); else this.undo(); return; }`. Ř. 2239 (componentDidUpdate): každá změna tasks se ukládá do zásobníku `this._hist.push(this._prevTasks); if(this._hist.length>40) this._hist.shift(); this._redo=[];`. Ř. 2259–2260: `undo = () => {... this.setState({ tasks:prev ... }); this._flowToast('Vráceno zpět'); }` / `redo = ... this._flowToast('Znovu provedeno')`. Tahák ř. 1643: „Zpět / Vpřed ⌘Z ⌘⇧Z", ř. 1654: „Smazat (s undo) ⌫". README ř. 51–52: „⌘Z / ⌘⇧Z zpět/vpřed … ⌫ smazat (s undo)", ř. 80: „Undo/redo přes historii stavu úkolů."
- **Stav app:** apps/web/src/lib/keyboard.tsx (celý soubor, ř. 33–91) — žádný handler ⌘Z/⌘⇧Z. apps/web/src/screens/Ukoly.tsx:122–127 — Backspace dělá rovnou `DELETE FROM tasks WHERE id = ?` bez undo; components/TaskDetailPanel.tsx:237 stejně. Přitom components/Cheatsheet.tsx:16 zkratku ⌘Z uživateli inzeruje. Jediné undo v appce je lokální chip ve Schránce (screens/Schranka.tsx:31–64).
- **Fix:** Nový lib/undo.ts: globální zásobník posledních ~40 mutací (inverzní operace nad PowerSync — pro UPDATE ulož předchozí hodnoty sloupců, pro DELETE celý řádek vč. assignments/comments, pro INSERT id ke smazání). Wrapper `execTracked(sql, params, inverse)` používat v Ukoly.tsx (Space/1–4/⌫), TaskDetailPanel, TaskItem toggle, Schranka. V keyboard.tsx přidat větev ⌘Z/⌘⇧Z (před typing guard, jako ⌘K) + toast „Vráceno zpět"/„Znovu provedeno" (sdílený toast dle flowToast, ř. 1082–1084 prototypu).

### [CRITICAL] Chybí demo seed data dle README — appka nemůže odpovídat screenshotům
- **Prototyp:** README.md ř. 147–156: „Prototyp jede na seedu … Pro věrnou rekreaci použijte stejná demo data. Datum ‚dnes' v prototypu = čtvrtek 25. 6. 2026"; prostory `personal/kancelar/klub`, 7 lidí (ak·AK·Adéla Kučerová·Vedoucí provozu (vlastník), tm·TM·Tomáš Marek·PM, …), 17 projektů s typem/vlastníkem/prostorem (q3·Q3 plánování·cílový(do 30. 9.)·tm …), e-maily generované z diakritiky, běžící postup „Plakát na červnovou show" (5 kroků, Firemní akce/Sokol) a měřitelné cíle. CLAUDE.md ř. 33–34: „Použij je pro vývojový režim, ať appka odpovídá screenshotům."
- **Stav app:** V repu neexistuje žádný seed: `find … -name "*seed*"` nenajde nic, jméno „Kučerová" se nevyskytuje v packages/db ani apps/api. packages/db/src obsahuje jen index.ts + schema/. Auditní srovnávání obrazovek tak běží nad náhodným obsahem a stavy jako Watson strip, „Tvůj další krok v postupech", výskyty či reporty nelze vizuálně verifikovat proti screenshots/.
- **Fix:** packages/db/src/seed.ts (drizzle): 3 workspaces, 7 users + members, 17 projektů (typ/vlastník/barva dle README ř. 154), úkoly s relativními termíny počítanými od runtime-dneška (ekvivalent 25. 6. 2026), postup „Plakát na červnovou show" s flow kroky, cíle. Skript `pnpm --filter @watson/db seed` + zmínka v README repa; e-maily generovat deburr(jméno)@firma.cz.

### [MAJOR] ⌘K paleta: chybí Lidé a Postupy, obrazovky Cíle/Reporty/Postupy, projekt vede do detail-panelu místo filtrovaného seznamu, aktivní řádek bez brass
- **Prototyp:** WatsonApp.dc.html ř. 2282: SCN = 11 obrazovek vč. `['kalendar','Kalendář'],['cile','Cíle'],['reporty','Reporty'],['postupy','Postupy']`. Ř. 2285: `this.PEOPLE.forEach(p=>{ … raw.push({ key:'m:'+p.id, kind:'Člověk', label:p.name, ini:p.initials, run:()=>this.searchMember(p.id)() }); });` Ř. 2286–2287: postupy kind 'Postup'. Ř. 2295: `openProj = (pid) => () => { … this.setState({ activeWs:ws, projFilter:pid, screen:'seznam', view:'list' … }) }` — projekt = filtrovaný seznam Úkolů. CSS ř. 73: `[data-palrow="true"]{ background:var(--brass-soft); }`; šablona ř. 1617–1618 vykresluje tečku projektu 16×16 / navy avatar s iniciálami.
- **Stav app:** apps/web/src/components/CommandPalette.tsx:32–59 — jen 7 obrazovek (bez Cíle/Reporty/Postupy/Kalendář, přestože screens/Cile.tsx, Reporty.tsx, Postupy.tsx existují), žádní lidé, žádné postupy; projekt spouští `projectDetail.open(p.id)` (ř. 53–56) místo filtrovaného seznamu; aktivní řádek má `background: var(--w-panel-2)` (ř. 138) místo brass-soft; chybí avatar iniciál pro osoby.
- **Fix:** CommandPalette.tsx: (a) doplnit obrazovky /cile, /reporty, /postupy (+ kalendář = /ukoly s view=calendar); (b) items z workspace_members+users (kind „Člověk", navy avatar s iniciálami, run → Reporty/Lidé member detail); (c) flows z flow tabulky (kind „Postup", run → /postupy?flow=id); (d) projekt run → navigate /ukoly?projekt=id; (e) aktivní řádek background var(--w-brass-soft).

### [MAJOR] Nástěnka: chybí přeuspořádání karet v rámci sloupce + čárkovaný drop-indikátor (boardOrder)
- **Prototyp:** WatsonApp.dc.html ř. 464: `<sc-if value="{{ t.gapBefore }}"><div style="height:0; border-top:2px dashed var(--brass); border-radius:2px; margin:0 2px;"></div></sc-if>` — čárkovaná brass linka nad cílovou pozicí; ř. 465: karta má i `onDragOver="{{ t.onOver }}"` (pozice v sloupci), ř. 479 `c.gapEnd` na konci sloupce. Logika ř. 2569–2573: drop počítá vkládací index do `boardOrder` (`let order=(s.boardOrder||…).filter(x=>x!==id); … order.splice(idx,0,id);`) a pořadí se udržuje i při addTask/duplicate/delete (ř. 2472, 2557, 2199).
- **Stav app:** apps/web/src/screens/Ukoly.tsx:151–166 (`dropTo`) — drop jen mění status_id sloupce; karty (ř. 246–256) mají draggable + onDragStart, ale žádný per-card onDragOver, žádný gapBefore/gapEnd indikátor, žádné pořadí v rámci sloupce (řadí se dle `shown` filtru).
- **Fix:** Ukoly.tsx board větev: stav `overId/overPos` z onDragOver karty (e.clientY vs. střed), vykreslit dashed placeholder (2px dashed var(--w-brass)) před/za kartou, při dropu zapsat pořadí — ideálně sloupec `sort_order` v tasks (PowerSync UPDATE hromadně pro sloupec), fallback lokální pořadí v localStorage.

### [MAJOR] G-navigace zná jen 6 cílů z 10 — chybí K/C/R/S (Kalendář, Cíle, Reporty, Postupy), přestože obrazovky existují
- **Prototyp:** WatsonApp.dc.html ř. 2216: `const gmap={d:'dnes',n:'nadchazejici',u:'seznam',k:'kalendar',p:'projekty',c:'cile',r:'reporty',s:'postupy',i:'schranka',h:'hledat'};` Tahák ř. 1642: „Přejít na… G D/U/K/P/C". README ř. 51: „`G` pak `D/U/K/P/C/R/N/I` přejít na sekci".
- **Stav app:** apps/web/src/lib/keyboard.tsx:8–18 — G_ROUTES jen `{ d:'/', u:'/ukoly', n:'/nadchazejici', p:'/projekty', i:'/schranka', h:'/hledat' }`; přitom routes /cile, /reporty, /postupy v router.tsx existují. components/Cheatsheet.tsx:15 ukazuje jen „G D/U/N/P".
- **Fix:** keyboard.tsx: doplnit `c:'/cile', r:'/reporty', s:'/postupy', k:'/ukoly'` (k s navigate search `{ view:'calendar' }`, případně po zavedení localStorage VIEW_LS přepnout view). Cheatsheet.tsx řádek goto aktualizovat na „G D/U/K/P/C…" dle prototypu ř. 1642.

### [MINOR] Zkratka `/` má fokusovat inline hledání aktuálního seznamu, ne přesměrovat na /hledat
- **Prototyp:** WatsonApp.dc.html ř. 2218: `if(e.key==='/'){ e.preventDefault(); this.focusSearch(); return; }`; ř. 2261: `focusSearch = () => { this.setState({ searchOpen:true }); setTimeout(()=>{ const el=document.querySelector('input[placeholder="Hledat…"]')||…; el.focus(); }, 70); };` — otevře rozbalovací input v headeru (ř. 290–296), který filtruje aktuální seznam; na obrazovce Hledat fokusuje tamní pole.
- **Stav app:** apps/web/src/lib/keyboard.tsx:78–82 — `/` dělá `navigate({ to: "/hledat" })`, uživatel tak opustí kontext seznamu. (Návaznost: inline hledání v headeru už jiný auditor eviduje jako chybějící — po jeho doplnění je nutné na něj přepojit i `/`.)
- **Fix:** Po implementaci inline search v layout/Header.tsx vystavit `focusSearch()` (context/ref) a v keyboard.tsx `/` volat focusSearch na obrazovkách se seznamem; navigaci na /hledat nechat jen tam, kde header search není (např. Nastavení).

### [MINOR] Sbalení sidebaru (rail) se nepersistuje mezi sezeními
- **Prototyp:** WatsonApp.dc.html ř. 2580: `toggleRail = () => this.setState(s=>{ this.persist({ rail:!s.rail }); return { rail:!s.rail }; });` a ř. 2199 obnova při startu: `rail: !!saved.rail` z localStorage klíče `watson.app`. README ř. 81: „pozice/obrazovka v localStorage".
- **Stav app:** apps/web/src/layout/AppLayout.tsx:18 — `const [collapsed, setCollapsed] = useState(false);` — čistě efemérní stav, po reloadu se rail vždy rozbalí.
- **Fix:** AppLayout.tsx: inicializovat z localStorage (`watson.rail`) a v onToggle zapsat; případně sjednotit s lib/tweaks.ts vzorem (localStorage + apply).

### [MINOR] Tahák inzeruje zkratky, které v appce neexistují (⌘Z, plná G-mapa) — klame uživatele
- **Prototyp:** WatsonApp.dc.html ř. 1638–1666: tahák zobrazuje přesně to, co globální handler umí — „Zpět / Vpřed ⌘Z ⌘⇧Z" (ř. 1643), „Přejít na… G D/U/K/P/C" (ř. 1642), „Smazat (s undo) ⌫" (ř. 1654), „Uložit úkol ⌘ Enter" (ř. 1666).
- **Stav app:** apps/web/src/components/Cheatsheet.tsx:16 uvádí ⌘Z/⌘⇧Z a ř. 29 „⌫" (bez poznámky o undo), ale žádná z těchto akcí undo nemá a ⌘Z není vůbec obslouženo (lib/keyboard.tsx); goto řádek (ř. 15) je naopak chudší než skutečná mapa má být.
- **Fix:** Vyřeší se implementací gapů 1 a 5 (undo/redo + plná G-mapa); do té doby buď zkratky z Cheatsheet.tsx dočasně nevypisovat, nebo je implementovat — tahák a handler musí zůstat 1:1 (v prototypu jsou generované ze stejného chování).
