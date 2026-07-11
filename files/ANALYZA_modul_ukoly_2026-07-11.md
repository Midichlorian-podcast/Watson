# Analýza modulu „Úkoly" — k čemu je, co s ním (2026-07-11)

> Otázka uživatele: *K čemu je modul Úkoly? Není zbytečný vedle Nadcházejících? Pokud je to agregát všeho vč. nedatovaných, jakou hodnotu má kalendářový pohled? Co by měl modul přinášet, proč a jak toho dosáhnout?*
>
> **Verdikt v jedné větě: modul NEZRUŠIT, ale zúžit mu práci — Úkoly = sklad a údržba (struktura, filtry, nedatované, hromadné akce), Nadcházející = čas. Globální kalendář patří do Nadcházejících, ne do Úkolů.**

---

## 1) Současný stav — co Úkoly reálně dělají (doloženo kódem)

`apps/web/src/screens/Ukoly.tsx`:

- **Data = úplně všechno.** SQL `SELECT * FROM tasks` (ř. 48–52), pouze bez netriážované Schránky (`isInboxTask`, ř. 54–60) a v Seznamu/Nástěnce bez podúkolů (ř. 62–79). Nedatované úkoly zde jsou — jediná obrazovka, kde je vidět celý inventář.
- **Seskupení po projektech** ve stabilním pořadí projektů (ř. 82–105), s počty na sekci.
- **Tři pohledy** Seznam / Nástěnka / Kalendář přes globální `useViewMode` (`lib/viewMode.tsx`); přepínač je v headeru jen pro `/ukoly`, `/nadchazejici`, `/oblibene` (`layout/Header.tsx` ř. 94–97).
- **Toolbar** filtr (priorita/stav/projekt/osoba) + řazení + Dokončené (`components/TasksToolbar.tsx`); stav toolbaru je ale **efemérní `useState`** (Ukoly.tsx ř. 44) — po odchodu z obrazovky se filtry ztratí, nic se neukládá.
- **Drill-down projektu**: `?projekt=` s banerem projektu (ř. 157–194). Sem vedou **všechny cesty „ukaž úkoly projektu"**: sidebar (Sidebar.tsx ř. 503–504), detail projektu (ProjectDetailPanel.tsx ř. 353), command palette (CommandPalette.tsx ř. 125). Úkoly jsou tedy de facto i „pohled projektu".
- **Hromadné akce**: checkbox v řádku + shift-rozsah (`lib/bulkSelect.tsx`) a plovoucí lišta Hotovo/Termín/Projekt/Priorita/Přiřadit/Smazat (`components/BulkBar.tsx`) — funguje sice všude, kde je `TaskItem`, ale smysl dává hlavně tady (jediný úplný průřez).
- **Výkonový strop** CAP 400 řádků + „zobrazit vše" (ř. 135–150, 279–288).
- **Klávesnice**: `g+u` → Úkoly (Seznam), **`g+k` = „kalendář" → také `/ukoly`** s přepnutím na kalendářový pohled (`lib/keyboard.tsx` ř. 30–31, 105–106). Úkoly dnes hostí i „ten pravý" celoapkový kalendář.
- **Badge v sidebaru** = počet VŠECH otevřených top-level úkolů mimo Schránku (Sidebar.tsx ř. 197) — trvale velké číslo bez akční hodnoty.

### Srovnání tří „seznamových" obrazovek

| | **Dnes** (`Today.tsx`) | **Nadcházející** (`Nadchazejici.tsx`) | **Úkoly** (`Ukoly.tsx`) |
|---|---|---|---|
| Data | zpožděné + dnešní + **všechny nedatované** (ř. 162–170: `d === null` spadá do „Dnes") | **jen s termínem** `due_date IS NOT NULL` **a `>= dnes`** (SQL ř. 89–93 + filtr ř. 119) | všechno vč. nedatovaných i minulosti |
| Seskupení | Zpožděné / Dnes | buckety Dnes/Zítra/Víkend/Příští týden/… (ř. 38–71) | po projektech |
| Pohledy | jen seznam | Seznam + Nástěnka + Kalendář | Seznam + Nástěnka + Kalendář |
| Navíc | Watson strip, QuickAdd, „další krok v postupech", hromadné přeplánování zpožděných | projekce opakování (R4), workspace chipy | drill-down projektu, nedatované, CAP, bulk-průřez |

### Klíčové nálezy (překryvy a díry)

1. **Dva kalendáře, jeden rozbitý.** Nadcházející i Úkoly renderují tentýž `components/Calendar.tsx`. Kalendář Nadcházejících ale dostává jen úkoly s termínem `>= dnes` (Nadchazejici.tsx ř. 119 → ř. 210–216) — **listování do minulosti ukazuje prázdno**. Kalendář Úkolů je jediný úplný, proto na něj míří `g+k`. Duplicitní pohled bez rozdílné hodnoty, přesně to, na co se uživatel ptá.
2. **Kalendář nad „agregátem všeho" žádnou extra hodnotu nemá.** Nedatovaný úkol v kalendáři z principu není vidět (`tIso()` → null se nikdy netrefí na den, Calendar.tsx ř. 58–72). Kalendář nad Úkoly ≡ kalendář nad všemi datovanými úkoly, tedy totéž co (opravený) kalendář Nadcházejících. Jediné reálné odlišnosti dnes: (a) vidí minulost, (b) umí projektový scope přes `?projekt=`.
3. **Zásobník nedatovaných je rozstřelený na tři místa.** Netriážované → Schránka; nedatované s projektem → **padají do Dnes** (Today.tsx ř. 166–169 i podtitulek headeru, Header.tsx ř. 76) a zároveň leží v Úkolech. Dnes tím přestává být „závazek dneška" a nikdo nemá motivaci nedatované třídit.
4. **Plánovací panel kalendáře nedatované vůbec nenabízí.** `PlanningPanel` (Calendar.tsx ř. 2328–2455) ukazuje jen „Zpožděné" a „Bez času **dnes**" (ř. 2340–2345). Smyčka „vezmi ze zásobníku → přetáhni na termín" tedy neexistuje, přestože drop-cíle v mřížce/měsíci fungují (Calendar.tsx ř. 960–965, 1741–1745; CalendarMonth.tsx ř. 180–184).
5. **Nástěnka Nadcházejících je duplikát.** Sloupce podle stavů (Board.tsx ř. 56–58) nemají časový rozměr — je to Nástěnka Úkolů minus nedatované.
6. **Žádné uložené pohledy / štítky.** `ToolbarState` se neukládá; štítky (invariant R7) ve schématu zatím nejsou; Oblíbené jsou dvě hardcoded položky (nav.ts ř. 33–36). Plánovaný dotazovací jazyk filtrů [C5] (MASTER ř. 109) na to čeká.

---

## 2) Konkurence: „sklad všech úkolů" vs. „časová agenda"

- **Todoist** — žádný modul „všechny úkoly" nemá. Inbox = triage, Today/Upcoming = čas, struktura = projekty, a průřez řeší **Filters & Labels** (uložené dotazy `& | !`, p1–p4, datumy) jako first-class navigační položky. Ponaučení: hodnota průřezu je v *uložených filtrech*, ne v monolitickém agregátu.
- **Things 3** — nejčistší řešení skladu: **Anytime** = „co můžu dělat kdykoli teď" (vč. nedatovaných), **Someday** = odložený zásobník (odděleně, aby seznamy nehnily), Upcoming = jen datované, Areas = struktura. Agregát si místo zaslouží tím, že odpovídá na otázku („co teď?"), ne tím, že ukazuje všechno.
- **TickTick** — smart listy (Today, Next 7 Days, **All**) + vlastní filtry; „All" existuje, ale je to utilita, ne páteř navigace. Kalendář je samostatný pohled výhradně nad datovanými.
- **Asana My Tasks** — osobní páteř se sekcemi **Recently assigned / Today / Upcoming / Later** a pravidly auto-promoce podle data. Není to globální inventář (jen „přiřazeno mně"); globální průřez řeší uložená vyhledávání. Ponaučení: triage tok s automatickým posunem mezi sekcemi.
- **Linear** — **Triage** (nové/nezařazené), **Backlog** jako explicitní stav (ne „úkol bez termínu někde"), a **Views = uložené sdílené filtry** jako první třída. „All issues" existuje, ale sekundárně. Ponaučení: zásobník je pojmenovaný stav + uložené pohledy, ne druhá obrazovka se stejnými daty.
- **Microsoft To Do** — **My Day** (denní rituál s návrhy „co si dnes přibrat"), **Planned** (datovaná agenda), Tasks (výchozí seznam). Ponaučení: sklad krmí agendu (návrhy do My Day), nesoupeří s ní.

**Čemu se všichni vyhýbají:** dvě obrazovky ukazující tatáž data v jiném řazení (přesně náš stav kalendáře a nástěnky v Úkoly × Nadcházející). **Co se osvědčuje:** čas (agenda) / závazek dne / struktura / zásobník+triage / uložené průřezy jako pět oddělených prací.

---

## 3) Doporučení: unikátní práce modulu + verdikt

### Kandidáti na „job" modulu a vyhodnocení

| Job | Hodnota pro Watson | Stav dnes |
|---|---|---|
| **Zásobník + triage nedatovaných** | vysoká — nikde jinde nedatované systémově nežijí (Schránka je jen pro nezařazené) | data ano, UX ne (nedatované navíc unikají do Dnes) |
| **Průřez všemi projekty s filtry** | vysoká — jediné místo pro „všechno od Petra ve stavu Kontrola" | ano, ale filtry se neukládají |
| **Hromadná údržba/úklid** | vysoká — BulkBar potřebuje úplný průřez | ano, funguje |
| **Cíl drill-downu projektu** | kritická — `?projekt=` je jediný „pohled projektu" v aplikaci | ano |
| **Plánovací „drag na termín"** | střední — patří ke kalendáři (PlanningPanel), ne k Úkolům samotným | chybí (nález 4) |

### Varianta ZRUŠIT / SLOUČIT — vyhodnocení

Sloučení do Nadcházejících **nedoporučuji**: (a) Nadcházející jsou definované `due_date IS NOT NULL AND >= dnes` — nedatované a minulost by neměly kde žít, nebo by se definice rozbila; (b) zaniklo by `?projekt=`, na které je navěšený sidebar, detail projektu i palette; (c) hromadná údržba a Nástěnka nemají časový rozměr. Zrušit bez náhrady by znamenalo, že „všechny úkoly prostoru" uvidíte jen po projektech jednotlivě — přesně to, co Todoist řeší Filters a Linear Views; tu infrastrukturu ale nemáme.

**Verdikt: PONECHAT a přeprofilovat.** Úkoly nejsou „ještě jedna agenda", ale **sklad a dílna**: struktura (projekty), inventář (vč. nedatovaných), filtry a hromadná údržba. Čas (buckety, kalendář) patří celý do Nadcházejících. Tím zmizí jediná skutečná duplicita — kalendář a nástěnka na obou stranách.

---

## 4) Konkrétní návrh

**Název:** ponechat **„Úkoly"**. „Vše" je vágní, „Zásobník" popisuje jen část práce a rozbil by mobilní tab bar i handoff (README handoffu ř. 20 modul definuje takto). Job modulu ať komunikuje struktura obrazovky, ne název.

**Dělba práce (jedna věta na modul):**
- **Dnes** = závazek dneška (zpožděné + dnešní; *bez nedatovaných*).
- **Nadcházející** = čas (buckety + jediný kalendář, vč. minulosti).
- **Úkoly** = struktura + filtry + zásobník + hromadná údržba.
- **Schránka** = triage nezařazeného (beze změny).

**Pohledy:**
- Úkoly (globální): **Seznam + Nástěnka**. Kalendář z přepínače odstranit — nad „vším" nemá rozdílnou hodnotu (nález 2).
- Úkoly `?projekt=`: ponechat **všechny tři pohledy** — kalendář nad ohraničeným projektem je smysluplný „projektový timeline" (a handoff/MASTER [C1] počítá s přepínáním per projekt). Ve v2 se může přestěhovat do detailu projektu.
- Nadcházející: **Seznam + Kalendář**; Nástěnku odstranit (nález 5). Kalendář krmit všemi datovanými úkoly vč. minulosti (oprava ř. 119/210–216). `g+k` přesměrovat na `/nadchazejici` + calendar.

**Výchozí seskupení Úkolů:** po projektech (beze změny), ale **navrch připnout sekci „Bez termínu · N"** (skrytou, když je prázdná). Ta je srdcem triage.

**Triage UX pro nedatované:**
1. Chip **„Bez termínu"** v toolbaru (rychlý filtr) + počet.
2. Řádkové rychloakce už existují (RescheduleMenu, swipe) — stačí je v sekci zvýraznit; volitelně tlačítko „Projít" otevírající peek kartu úkol po úkolu (konzistentní s peek UX z 2026-07-11).
3. **PlanningPanel kalendáře doplnit o skupinu „Bez termínu"** — drag na mřížku/den už funguje, jen data chybí (nález 4). Tím vznikne smyčka *sklad → drag → termín*.
4. **Nedatované vyřadit z Dnes** (Today.tsx ř. 166–169 + pravidlo podtitulku Header.tsx ř. 76). Přechodně lze nechat sbalitelnou sekci „Bez termínu" v Dnes, cílově pryč — jinak triage nikdy nevznikne.

**Uložené filtry (vazba na R7):** dvě etapy. (1) Persistovat poslední `ToolbarState` per obrazovka (localStorage — UI preference, stejně jako `watson.lockedView`; není to doménové datum). (2) Po MVP **pojmenované uložené pohledy** v DB (`saved_views`: název, vlastník, JSON filtru, volitelně sdílené do týmu) zobrazené v sekci **Oblíbené** — ta je dnes hardcoded (nav.ts ř. 33–36) a je to přirozené místo (Todoist Filters, Linear Views). Návrh schématu ať počítá se štítky (R7: globální, skryté hostům), i když zatím ve schématu nejsou.

**Prázdné / plné stavy:**
- Prázdné globální Úkoly dnes ukazují generické `today.emptyClean` (Ukoly.tsx ř. 225–232) — nahradit textem vysvětlujícím modul + CTA „+ Úkol" a „Otevřít Schránku".
- Plný stav: CAP 400 s patičkou existuje; po MVP nahradit virtualizací.
- **Badge v sidebaru změnit z „všechny otevřené" na „počet bez termínu"** (Sidebar.tsx ř. 197) — malé, akční číslo („dluh triage") místo trvalého alarmu.

---

## 5) Implementační plán (S ≈ hodiny, M ≈ 1–2 dny, L ≈ 3+ dnů)

**Fáze 1 — hned, nízké riziko (čistě subtraktivní/aditivní, bez migrací):**
1. Per-obrazovkový allowlist pohledů: kalendář pryč z globálních Úkolů, nástěnka pryč z Nadcházejících (Header.tsx ř. 94–155 → mapa route→povolené pohledy; `?projekt=` ponechá vše). — **S**
2. Kalendář Nadcházejících krmit všemi datovanými (zrušit filtr `>= dnes` pro kalendářovou větev, Nadchazejici.tsx ř. 117–129/210–216). — **S**
3. `g+k` → `/nadchazejici` + view calendar; `g+u` beze změny (keyboard.tsx ř. 30–31, 105–106; pozor na interakci se zámkem pohledu). — **S**
4. PlanningPanel: skupina „Bez termínu" (Calendar.tsx ř. 2328+; po kroku 2 nutno panelu dodat nedatované zvlášť — kalendářová data je nemají; nejjednodušeji vlastním PowerSync dotazem uvnitř panelu). — **S/M**
5. Toolbar chip „Bez termínu" + připnutá sekce v Úkolech. — **S**

**Fáze 2 — MVP, vyžaduje produktové rozhodnutí:**
6. Nedatované ven z Dnes (Today.tsx ř. 166–169, Header.tsx ř. 76) — komunikovat týmu, přechodná sbalitelná sekce. — **M**
7. Persist `ToolbarState` per obrazovka (localStorage). — **S**
8. Badge `/ukoly` = počet nedatovaných (Sidebar.tsx ř. 197, nav.ts ř. 24). — **S**
9. Prázdný stav Úkolů s vysvětlením + CTA. — **S**

**Fáze 3 — po MVP:**
10. `saved_views` v DB + render v Oblíbených + sdílení do týmu. — **M/L**
11. Štítky (R7): schéma, UI, filtr v toolbaru; poté dotazovací jazyk filtrů [C5] / české AI filtry (hlavní diferenciátor dle `porovnani_todoist_notion_asana.md`, bod 1). — **L**
12. Virtualizace seznamu místo CAP 400. — **M**
13. Projektový kalendář přesunout do detailu projektu (v2) a `?projekt=` zjednodušit na Seznam+Nástěnku. — **M**

**Rizika:** krok 6 mění chování Dnes, které tým zná — udělat až po kroku 5 (ať mají nedatované viditelný domov) a ohlásit; krok 2 zvýší počet řádků v kalendáři Nadcházejících (výkonově kryto tím, že Calendar filtruje na viditelný rozsah, ř. 348–393); zámek pohledu (`watson.lockedView`) je globální pro všechny obrazovky — po zavedení allowlistu ošetřit fallback, když je zamčený pohled na dané obrazovce nedostupný.
