# 02 — Opakování / výskyty + Kalendář (den/týden/měsíc)

> Exhaustivní extrakce logiky z prototypu `design/handoff_watson/WatsonApp.dc.html`
> (jedna třída `class Component`, ~3268 řádků). Čísla řádků odkazují na tento soubor.
> Doména: model opakování (occurrences), projekce výskytů do seznamů i kalendáře,
> a kompletní render/layout/chování kalendáře.
>
> Cíl dokumentu: aby šlo logiku **bít za bit** reimplementovat v produkci (React + TS),
> aniž by se ztratilo jediné jemné rozhodnutí prototypu. Záměrná zjednodušení jsou
> explicitně označena „⚠️ Zjednodušení prototypu". Produkční doporučení v sekcích
> „Implementace" (zarovnáno na invariant **R4** — viz konec).

---

## 0. Konstanty a magická čísla (zachyceno přesně)

| Konstanta | Hodnota | Řádek | Význam |
|---|---|---|---|
| `DAY_START` | `0` | 1911 | minuta začátku dne v gridu (0:00) |
| `DAY_END` | `1440` | 1911 | minuta konce dne (24:00) |
| `PPM` | `0.62` (default) | 1911 | **pixelů na minutu** v gridu (výška) |
| `PPMOPT` | `{ comfortable:0.62, spacious:0.95 }` | 1912 | hustota gridu (px/min); „compact" se v UI nabízí, ale mapuje na 0.62 fallbackem |
| horizont seznamů | `16` dní | 2654 (`listTasks(days||16)`) | jak daleko do budoucna se promítají výskyty do **Dnes/Nadcházející** |
| auto-scroll cíl | **7:00** (gridRef) / **8:00 nebo „teď"** (componentDidUpdate) | 2622 / 2239 | viz pozn. níže — dvě různá místa! |
| „+N" práh v gridu | **4+** (`MAX=3`, čtvrtý a další jdou do „+N") | 2734 | max 3 sloupce vedle sebe, zbytek = bublina „+N" |
| měsíc: úkolů/den | **3** + „+N další" | 2875 (`slice(0,3)`) | `shown=dt.slice(0,3); more=dt.length-3` |
| snap krok (drag/resize/create) | **15 min** | 2686, 2668, 2666 | `Math.round(dy/PPM/15)*15` |
| min. délka bloku (resize) | **15 min** | 2694–2695 | top nesmí přerůst `e0-15`, bottom pod `s0+15` |
| min. výška bloku (vizuál) | **22 px** event / **20 px** „+N" / **24 px** all-day fallback | 2768 / 2754 | `Math.max(22, …)` |
| default trvání nového úkolu | **30 min** | 2462 (`tmin+30`), 2667 (`end:a+30`) | drag-create i klik-add |
| drag-create práh „pohnul jsem" | **15 min** (`abs(cur-anchor)>=15`) | 2668 | jinak = klik (otevře add bez tažení) |
| drag práh „moved" | **4 px** (X nebo Y) | 2687, 2668 | rozliší klik vs. tah u bloku |
| guard iterací v `_recOccur` | **800** | 2640 | tvrdá pojistka proti nekonečné smyčce |
| „dnes" v prototypu | **2026-06-25 (čtvrtek)** | 2626 `TODAY_ISO`, 2073 `recBase()` | všechny relativní výpočty z něj |

> ⚠️ **Dvě různá auto-scroll cílení** (vědomě nekonzistentní v prototypu):
> - `gridRef` (2622) cílí vždy na **7:00**: `top = 7*60*PPM - 8`.
> - `componentDidUpdate` (2239) cílí na **„teď"** pokud je zobrazen 25. červen (`curJun()===25`), jinak na **8:00**: `tgt = curJun()===25 ? nowMin() : 8*60; top = tgt*PPM - 90`.
> Oba se aktivují přes `this._needScroll7=true`. V produkci sjednoť na jedno chování (doporučeno: scroll na `min(prvníUdálost, 7:00)`).

---

## 1. Datový model výskytů (occurrences)

### 1.1 Princip
Opakovaný úkol je **jedna „řada"** (base task) — běžný task se sadou polí:
- `repeat: 'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'` — frekvence (řídí krok projekce).
- `recurring: true` — příznak „je opakovaný" (UI/ikona ↻). **Pozor:** projekce se spustí, pokud platí `((t.repeat && t.repeat!=='none') || t.recurring) && !t.flowId` (2636, 2654). Tj. samotné `recurring:true` bez `repeat` → bere se jako **weekly** (default v `_recOccur`, 2640: `rep = t.repeat || 'weekly'`). To je případ seed úkolů t2, t13, t19 (ř. 2159/2170/2178 — mají jen `recurring:true`).
- `repeatRule` — strukturovaný popis pravidla z parseru (kind: `daily|weekly|biweekly|monthly|monthly-nth|monthly-day|yearly`, plus `weekday/nth/day/parity`). **V projekci se NEpoužívá** (viz ⚠️ níže) — slouží jen jako label/metadata.
- `repeatLabel` — lidský český popis („Každou středu", „Každé sudé pondělí", „25. v měsíci"…).
- `repeatEndKind: 'never'|'until'|'count'`, `repeatUntil` (ISO `YYYY-MM-DD`), `repeatCount` (int ≥1), `repeatShowAll: bool`.
- `repeatDoneCount` — kolikrát byla **base řada** dokončena (posun série, viz §3).
- `exceptions: { 'YYYY-MM-DD': { done, skipped, time, start, end, priority } }` — per-výskytové výjimky.

### 1.2 Virtuální identita výskytu — `id@YYYY-MM-DD`
- `_occId(baseId, iso) = baseId + '@' + iso` (2646).
- `_isOccId(id) = typeof id==='string' && id.indexOf('@')>0` (2647).
- `_splitOcc(id)` → `{ baseId, iso }` (2648), split na **prvním** `@`.
- Base task se v projekcích vyskytuje pod svým reálným id (řada = jeho „první/aktuální" výskyt), ostatní termíny jsou virtuální tasky `makeOcc`. Konkrétní termín base tasku se **nepřidává** podruhé (`if(iso===this.tIso(t)) return;` — 2636, 2654).

### 1.3 `makeOcc(base, iso)` — materializace virtuálního výskytu (2652)
Vrátí plnohodnotný task-objekt (kopie base + výjimka + přepočtené pole):
```
exc = base.exceptions[iso] || {}
day = _dayBucket(iso)          // symbolický kbelík pro seznamy (viz §2.3)
b   = _bucketISO(iso)          // {group, day} pro overdue/today/upcoming
time = (exc.time !== undefined) ? exc.time : base.time
start = base.start; end = base.end
if (exc.start != null) {
  start = exc.start
  end   = (exc.end != null) ? exc.end
        : (base.start!=null && base.end!=null ? exc.start + (base.end - base.start) : null)
}
o = { ...base, ...exc,                       // ⚠ exc se rozprostře přes base
      id: _occId(base.id, iso),
      iso, isoEnd:null, endDate:null, date:null,   // jednodenní virtuální výskyt
      start, end, day, group:b.group, overdue:b.group==='overdue',
      _virt:true, _baseId:base.id, _occIso:iso, recurring:true,
      done: !!exc.done,
      status: exc.done ? 'hotovo' : (base.status==='hotovo' ? '' : base.status),
      dueLabel: _occLabel(iso) + (time ? ' · '+time : '') }
delete o.exceptions   // virtuální výskyt nenese mapu výjimek
```
**Detaily:**
- `Object.assign({}, base, exc, {...})` znamená: pole z `exc` (`done/skipped/time/start/end/priority`) **přepíšou** base. Tedy `exc.priority` reálně přepíše prioritu výskytu (i když UI to ještě nenabízí — viz §4). `start/end` se však ještě jednou dořeší výše a v override objektu, takže výsledné `start/end` jsou korektní i pro přesun času.
- Virtuální výskyt je **vždy jednodenní** (`isoEnd/endDate/date` vynulované, `date:null`). ⚠ Vícedenní opakované řady se tedy promítají jako jednodenní výskyty — viz §6.
- `status` výskytu: hotová výjimka → `'hotovo'`; jinak pokud base byl `'hotovo'`, výskyt se „rozjede" na prázdný status (`''`), jinak zdědí base status.
- `resolveTask(id)` (2653): univerzální resolver — pro occ id vrátí `makeOcc(base, iso)`, jinak najde task v `state.tasks`. Používá se všude, kde detail/akce potřebují „skutečný" objekt z (možná virtuálního) id.

### 1.4 Pomocné ISO/datum funkce
- `_d(iso)` (2641): `new Date(y, m-1, d)` z `'Y-M-D'`. **Lokální** Date, ne UTC.
- `_isoOf(dt)` (2628) / `recISO` (2074): `Y-MM-DD` s pad2.
- `tIso(t)` (2630): `t.iso || ('2026-06-'+pad2(t.date)) || null` — **ISO má přednost, legacy `date` (červen-den) je fallback**.
- `tIsoEnd(t)` (2631): `t.isoEnd || ('2026-06-'+pad2(t.endDate)) || tIso(t)`.
- `_hit(t, iso)` (2632): `s=tIso(t); e=tIsoEnd(t); return iso>=s && iso<=e` — test, zda úkol „zasahuje" daný ISO den (řeší i vícedenní rozsah pomocí string-porovnání ISO, což je korektní pro `YYYY-MM-DD`).
- `_dayspan(t)` (2642): počet dní `round((end-start)/86400000)+1`, min 1.
- `_occLabel(iso)` (2651): `'st 25. 6.'` (`_wdShort` + den. měsíc.). `_wdShort` (2650): `['ne','po','út','st','čt','pá','so'][getDay()]`.
- `_addDaysIso(iso,n)` (2645).

---

## 2. Projekce výskytů (kde se výskyty objevují)

Existují **dvě samostatné projekce** se **dvěma různými horizonty**:

### 2.1 `listTasks(days=16)` — pro seznamy (Dnes, Nadcházející) (2654)
```
out = [...state.tasks]
today = TODAY_ISO ('2026-06-25')
horizon = _addDaysIso(today, days||16)        // → '2026-07-11'
for t in state.tasks:
   if !((t.repeat && t.repeat!=='none') || t.recurring): continue
   if t.flowId: continue                       // kroky postupů se NEopakují
   occ = _recOccur(t, today, horizon)          // ISO data v okně [today, horizon]
   for iso in occ:
       if iso === tIso(t): continue            // base den už je v out
       exc = t.exceptions?.[iso] || {}
       if exc.skipped: continue                 // přeskočený výskyt se neukáže
       out.push(makeOcc(t, iso))
return out
```
- **Použití**: `T = (screen==='dnes'||'nadchazejici') ? listTasks() : state.tasks` (3018). Na Úkolech/Board/Kalendáři/Schránce/Oblíbených se bere syrový `state.tasks` (kalendář má vlastní projekci, viz 2.2).
- **Horizont 16 dní je vědomé rozhodnutí**, aby skupina „Později" v Nadcházejících nebyla zahlcená nekonečnou řadou (README ř. 161).

### 2.2 `calTasks()` — pro kalendář (2633)
```
base = state.tasks
range = _calRange()        // [aIso, bIso] dle viditelného rozsahu (viz níže)
if !range: return base     // bezpečnostní fallback
out = [...base]
for t in base:
   if ((t.repeat && t.repeat!=='none') || t.recurring) && !t.flowId:
       occ = _recOccur(t, a, b)
       for iso in occ:
           if iso===tIso(t): continue
           exc = t.exceptions?.[iso] || {}
           if exc.skipped: continue
           out.push(makeOcc(t, iso))
return out
```
- **`_calRange()` (2639)** = viditelný rozsah podle režimu:
  - `month`: `bs = new Date(2026, 5+monthOffset, 1)`; vrací `[první den měsíce, poslední den měsíce]` (poslední = `new Date(y, mo+1, 0)`).
  - `week`: `[weekDates()[0].iso, weekDates()[6].iso]` (7 dní viditelného týdne).
  - `day`: `[curIso, curIso]` (jen aktuální den).
- Tedy kalendář promítá **přesně viditelné okno** (na rozdíl od fixního horizontu seznamů) — týden 7 dní, měsíc celý měsíc, den 1 den.
- Všechny render-vrstvy kalendáře (`eventsNode`, `allDayRow`, `buildMonth`, `buildWeekList`) volají `calTasks()` a pak filtrují `_hit(t, iso)` / `tIso(t)===iso`.

### 2.3 `_dayBucket(iso)` — symbolický kbelík pro skupiny v Nadcházejících (2649)
```
today=_d(TODAY); d=_d(iso); diff = round((d-today)/86400000)
if diff<=0: 'dnes'
if diff===1: 'zitra'
dow=d.getDay()
if diff<=6 && (dow===6||dow===0): 'patek'   // víkend v rámci 6 dní → skupina „Víkend"
if diff<=7: 'pristi'                          // do týdne → „Příští týden"
nm = 1. den příštího měsíce; nmE = 6. den příštího měsíce
if d>=nm && d<=nmE: 'pmonth'                  // začátek příštího měsíce
return 'custom'                              // jinak „Později"
```
- Skupiny v Nadcházejících (3048): `dnes / zitra / patek(Víkend) / pristi(Příští týden) / pmonth(Začátkem příštího měsíce) / custom(Později)`.
- `_bucketISO(iso)` (2644) je jiná, hrubší klasifikace (jen `overdue/today/upcoming` + den `zpozdene/dnes/zitra/pristi`) — používá ji `makeOcc`/`toggleDone` pro `group`.

### 2.4 „Dnes" ukazuje jen aktuální výskyt
Dnes filtruje `T.filter(t => t.group==='today' && …)` (3028). Virtuální budoucí výskyty mají `group` podle `_bucketISO` (tj. `upcoming`/`overdue`), takže **do Dnes nespadnou** — Dnes ukáže jen base den, pokud je dnes. To je přesně chování z README ř. 63.

---

## 3. Engine projekce výskytů — `_recOccur` (2640)

Toto je jádro. Generuje seznam ISO dat výskytů v okně `[aIso, bIso]`.

```
base = tIso(t); if !base: return []
rep = t.repeat || 'weekly'           // ⚠ default weekly i pro samotné recurring:true
unit, step:
   daily    -> ('d', 1)
   weekly   -> ('d', 7)
   biweekly -> ('d', 14)
   monthly  -> ('m', 1)
   yearly   -> ('y', 1)
endKind = t.repeatEndKind || 'never'
untilIso = (endKind==='until' && t.repeatUntil) ? t.repeatUntil : null
maxCount = (endKind==='count') ? max(1, t.repeatCount||1) : Infinity
A=_d(aIso); B=_d(bIso); res=[]
adv(c): posune c o step v dané jednotce (setDate / setMonth / setFullYear)
cur=_d(base); idx=0; g=0
while g<800:
   if idx>=maxCount: break          // limit počtu (count od ZAČÁTKU řady, ne od okna)
   iso=_isoOf(cur)
   if untilIso && iso>untilIso: break
   if cur>B: break                  // za pravým okrajem okna → konec
   if cur>=A: res.push(iso)         // uvnitř okna → zahrň (levý okraj ořízne počítání, ne index)
   adv(cur); idx++; g++
if t.repeatShowAll===false:         // „jen příští výskyt"
   today=TODAY; up=res.filter(x=>x>=today); return up.slice(0,1)
return res
```

### Klíčová pravidla a edge-cases enginu
1. **Krok je čistě kalendářní od base data** — `weekly` = +7 dní (ne „další výskyt daného dne v týdnu"), `monthly` = `setMonth(+1)` (zachová den, JS přetočí 31.→ další měsíc), `yearly` = `setFullYear(+1)`. `repeatRule` (nth-weekday, monthly-day, parity) se v projekci **ignoruje** — viz ⚠ §3.1.
2. **`repeatCount` se počítá od začátku řady (base), ne od začátku okna.** `idx` inkrementuje při každém kroku včetně termínů před oknem `A`. Tj. „po 5 výskytech" znamená 5 termínů od base data celkem, i kdyby okno začínalo později. To je správně, ale POZOR při reimplementaci.
3. **Levý okraj okna `A` ořezává jen vkládání do `res`** (`if cur>=A`), ale počítadlo `idx`/until běží dál → konzistence count/until napříč okny.
4. **`repeatShowAll===false` → „jen příští výskyt"**: vrátí max 1 termín ≥ dnes. Striktně `=== false` (default `true`), takže nezadaný `repeatShowAll` = všechny.
5. **Guard 800** brání zacyklení (denní řada přes velmi široké okno).
6. Base den se filtruje až v projekci (`calTasks`/`listTasks`), `_recOccur` ho do `res` vloží, pokud spadá do okna.

### 3.1 ⚠️ Zjednodušení: `repeatRule` (nth/parity/monthly-day) se NEpromítá přesně
Parser umí rozeznat „každé první úterý v měsíci" (`monthly-nth`), „každého 25." (`monthly-day`), „každý sudý čtvrtek" (`biweekly+parity`) a uloží to do `repeatRule` + nastaví `startISO` na první správný termín. Ale `_recOccur` projíždí jen podle `repeat` (daily/weekly/biweekly/monthly/yearly) + prostého kroku od base.
- Důsledek: „každé první úterý v měsíci" se promítne jako `monthly` od `startISO` = `setMonth(+1)` na stejné číslo dne → **po pár měsících přestane padat na „první úterý"**. Stejně „sudý čtvrtek" = biweekly +14 dní od správného startu (náhodou OK, protože parita = ob týden), ale není to „kalendářní paritní týden".
- `startISO` z parseru se v `submitTask` reálně použije jako datum úkolu jen tehdy, když draft ještě nemá `dateKind` (1988: `if(rec.startISO && patch.dateKind===undefined)`), takže často se ani neaplikuje.
- **Pro produkci je tohle hlavní místo k dořešení** — viz §3.2.

### 3.2 Implementace (produkce, R4)
Doporučený model = **RRULE-like definice řady + materializer + tabulka výjimek**:
```ts
interface RecurrenceRule {
  freq: 'daily'|'weekly'|'biweekly'|'monthly'|'yearly';
  // strukturovaná pravidla, KTERÁ SE SKUTEČNĚ APLIKUJÍ:
  byWeekday?: number;          // 0–6 (weekly/biweekly: konkrétní den)
  monthlyMode?: 'dayOfMonth'|'nthWeekday';
  dayOfMonth?: number;         // 1–31 (monthly-day)
  nth?: number;                // 1..5 | -1 (poslední) pro nthWeekday
  weekday?: number;            // pro nthWeekday
  parity?: 'even'|'odd';       // ISO-week parita pro biweekly
  anchorISO: string;           // datum prvního výskytu
}
interface RecurrenceEnd { kind:'never'|'until'|'count'; until?:string; count?:number }
```
- **Materializer** `occurrencesInRange(rule, end, [aIso,bIso])` musí respektovat `byWeekday`, `nthWeekday`, `dayOfMonth`, `parity` — tj. generovat skutečné kalendářní termíny (ne jen `+step` od kotvy). Pro `monthly nthWeekday` použít funkci typu `nthWeekdayOfMonth(y,m,nth,wd)` (prototyp ji má jako `nthWeekdayISO`, 2076 — lze recyklovat algoritmus).
- **Tabulka výjimek** `occurrence_exceptions(series_id, date, done, skipped, time, start_min, end_min, priority, …)` keyovaná `(series_id, ISO date)`. Mapuje 1:1 na prototypový `exceptions` objekt, jen jako řádky DB místo JSON.
- Virtuální id zachovat jako `seriesId@ISO`; resolver `resolveTask` zůstává.
- **R4 default**: nové opakování má kotvu = `due date` úkolu. „Od dokončení" (option) → kotva se přepočítá z data dokončení (viz §5.2). Při posunu na další výskyt **vynuluj všechny per-osobní completiony** (`peopleDone`, `aDone`) a `subtasks.done` (prototyp je u advance neřeší — doplnit, viz §5.3).
- **R4 horizont**: ponech materializaci „na vyžádání" podle viditelného okna (kalendář) + krátký horizont pro seznamy (16 dní je rozumný default; udělej konfigurovatelné).

---

## 4. Per-výskyt akce přes `exceptions`

### 4.1 Skip / restore výskytu
- `skipOccurrence(id)` (2477): jen pro occ id. `exceptions[iso].skipped=true`, zavře detail (`selectedId:null`), toast „Výskyt přeskočen · <label>". Skip se promítne do **seznamu i kalendáře** (obě projekce filtrují `if(exc.skipped) return`).
- `restoreOccurrence(baseId, iso)` (2478): smaže `skipped`; pokud po smazání zůstanou jiné klíče výjimky, ponechá záznam, jinak `delete exceptions[iso]`.

### 4.2 Done / undone výskytu — `toggleDone` větev pro occ (2482, první větev)
```
if _isOccId(id):
   sp=_splitOcc(id); c=exceptions[sp.iso]||{}
   exceptions[sp.iso] = { ...c, done: !c.done }
```
- Dokončení **budoucího/jiného výskytu** = jen toggle `done` ve výjimce toho dne. **Neposouvá** řadu. (Posun dělá jen dokončení base — viz §5.)

### 4.3 Posun času výskytu (start/end) / priorita
- `setOccField(id, patch)` (2479) zapíše `patch` do `exceptions[iso]` (s `_pushHist`).
- `setOccPriority(id, p)` (2480) = `setOccField(id, {priority:p})`.
- `makeOcc` při materializaci aplikuje `exc.start/exc.end` (přepočet end dle původního trvání, pokud chybí) a `exc.priority` (přes `Object.assign` spread).
- ⚠️ **UI tyto per-výskyt overridy zatím nevolá** (žádný handler v detailu/kalendáři je netriggeruje). Schopnost engine existuje, ovládání ne. README ř. 161: per-výskyt override názvu/priority/osob a přesun jednotlivého výskytu tažením = **vědomě neimplementováno**.

### 4.4 Detail výskytu (banner) — `decorateDetail` + šablona (2932–2934, 999–1006, 1075)
- `decorate`/`decorateDetail` z (možná virtuálního) tasku odvodí UI props:
  - `isOcc = !!t._virt`, `occLabel = _occLabel(t._occIso)` (např. „st 25. 6.").
  - `seriesRepeat` = lidský popis frekvence (`t.repeatLabel` || mapa `{daily:'Opakuje se denně', weekly:'Opakuje se týdně', biweekly:'Opakuje se po 14 dnech', monthly:'…měsíčně', yearly:'…ročně'}` || „Opakovaný úkol").
  - `onSkip = skipOccurrence(id)`, `onOpenSeries = openSeries(id)`.
- Šablona (ř. 999–1006): banner „↻ Výskyt řady · <occLabel>", text *„<seriesRepeat>. Dokončení a přeskočení platí jen pro tento výskyt; změny názvu, priority a osob mění celou řadu."*, odkaz **„Upravit celou řadu →"** (`onOpenSeries`).
- Tlačítko **„Přeskočit"** (ř. 1075) jen pro `isOcc`.
- `openSeries(id)` (2481): u occ id přepne `selectedId` na `baseId` (skok na detail base řady).

### 4.5 Implementace (R4)
- `exceptions` → DB řádky (viz §3.2). Akce skip/done/override = upsert/patch řádku `(series_id, date)`.
- „Upravit celou řadu" = otevři detail base; „Upravit jen tento výskyt" (rozšíření) = ulož override do výjimky.
- **Sjednoť** detekci virtuálního id na typovaný discriminator (`kind:'occurrence' | 'task'`), ať `indexOf('@')>0` není jediná pojistka (id base nesmí obsahovat `@`).

---

## 5. Posun celé řady při dokončení base výskytu

### 5.1 `toggleDone` — větev pro base opakovaný task (2482, druhá větev)
Podmínka: `cur && !cur.flowId && !cur.done && cur.repeat && cur.repeat!=='none'` (tj. odškrtnutí **nesplněné** base řady, která NENÍ krokem postupu).
```
doneCount = (cur.repeatDoneCount||0)+1
endKind   = cur.repeatEndKind||'never'
reachedCount = endKind==='count' && doneCount>=(cur.repeatCount||1)
next = reachedCount ? null : _nextOccISO(cur)
if next:
   span = _dayspan(cur)                       // zachová délku vícedenního úkolu
   ne = _d(next); ne.setDate(ne.getDate()+span-1)
   bk = _bucketISO(next)
   // přepiš BASE task na další termín:
   t = { ...cur, iso:next, isoEnd: span>1?_isoOf(ne):null,
         date:null, endDate:null, group:bk.group, day:bk.day,
         repeatDoneCount:doneCount, done:false,
         status: status==='hotovo'?'probiha':status }
   → toast „Posunuto na <deadlineFmt(next) bez 'do '>"
```
- Pokud `next===null` (dosažen `count`, nebo `until` překročen → `_nextOccISO` vrátí null), **propadne do běžné větve** a base task se prostě označí `done:true` (řada skončila).
- **Posun NEvytváří záznam o splnění** předchozího termínu (žádná výjimka `done` na starém datu) — base task se „přestěhuje". To je vědomá simplifikace: historie dokončených výskytů se nedrží (kromě `repeatDoneCount` čítače).

### 5.2 `_nextOccISO(t)` (2643)
```
cur=tIso(t); rep=t.repeat; if !cur||!rep||rep==='none': return null
(unit,step) stejně jako _recOccur
d=_d(cur); adv o step
iso=_isoOf(d)
if endKind==='until' && repeatUntil && iso>repeatUntil: return null
return iso
```
- Respektuje `until` (vrátí null za hranicí), ale **nerespektuje `repeatRule`** (stejné zjednodušení jako §3.1).

### 5.3 ⚠️ Co prototyp u posunu NEdělá (doplnit v produkci, R4)
- Nevynuluje `peopleDone`/`aDone` (per-osobní completion u `assignMode==='all'`) ani `subtasks[].done`. → V produkci: **na další výskyt resetuj všechny per-person completiony i podúkoly** (R4: „on next occurrence reset all per-person completions").
- Nedrží historii (kdo/kdy splnil minulý výskyt). Produkce: záznam do výjimkové/audit tabulky.
- „Od dokončení" vs. „od termínu": prototyp posouvá vždy o pevný `step` od *aktuálního* `iso` (tj. fakticky „od termínu", protože iso je termín). R4 vyžaduje volbu „from completion" — pak `next = completionDate + step` (s normalizací na pravidlo).

### 5.4 Implementace (R4)
- Default „from due date": další termín = aplikace rule od kotvy (předchozí termín → next dle rule).
- Option „from completion": při dokončení nastav kotvu = dnes (completion), přepočti rule od ní.
- Při posunu: reset `peopleDone`, `aDone`, `subtasks.done`; volitelně log do historie. Zachovej `repeatDoneCount` jako čítač.
- Konec: `count` (čítej dokončené, ne projektované) a `until` se chovají jako v prototypu.

---

## 6. ⚠️ Vícedenní vs. opakované — interakce

- Base opakovaný úkol **může být vícedenní** (`isoEnd`/`endDate`). Při posunu (§5.1) se délka (`span`) zachová a posune jako celek.
- Ale **virtuální výskyty (`makeOcc`) jsou vždy jednodenní** (vynulují `isoEnd/endDate`). → Vícedenní opakovaná řada se v kalendáři/seznamu (mimo aktuální base termín) zobrazí jen jako jednodenní tečky. Vědomé zjednodušení.
- Multi-day **pruhy** v all-day pásu (§9.3) se počítají jen z reálných tasků s `tIsoEnd>tIso` (tj. z base/jednorázových), ne z virtuálních výskytů.

---

## 7. Kalendář — stav, navigace, hustota, okraje

### 7.1 Relevantní stav (1901, 1908)
`view:'calendar'`, `calMode:'day'|'week'|'month'` (default `week`), `calCur:Date|null` (default null → `new Date(2026,5,25)`), `monthOffset:0` (měsíc se řídí offsetem, ne `calCur`!), `weekView:'list'|'grid'` (default **list**), `calDensity:'comfortable'|'spacious'`, `calBorder:'priority'|'project'`.

### 7.2 `curDate()` / `weekDates()` / Monday alignment
- `curDate()` (2625): `calCur ? new Date(calCur) : new Date(2026,5,25)`.
- `weekDates()` (2658): vezme `curDate()` jako **start** a přidá 0..6 dní. `wl` = `['Ne','Po','Út','St','Čt','Pá','So'][getDay()]`. **`weekDates` sám NEzarovnává na pondělí** — jen iteruje od `calCur`. Pole `d` = `getDate()` jen pokud je den v červnu 2026 (`isJun`), jinak `null` (legacy fallback, viz §11).
- **Monday alignment dělá `calToday` (2661) a `calNav`**: při „Dnes"/přepnutí na týden se `calCur` nastaví na pondělí: `dow=(getDay()+6)%7; setDate(date-dow)`. `weekMonday()` (2657) je samostatný helper se stejnou logikou (vrací Date pondělí), ale render používá `weekDates()`.
- ⚠ Pokud `calCur` není pondělí (např. po `setCal('week')` z jiného režimu bez resetu), hlavička týdne začne libovolným dnem. V praxi se na týden vstupuje přes `calToday`/nav, takže to drží.

### 7.3 Navigace
- `calNav(dir)` (2660): měsíc → `monthOffset += dir`; jinak `shiftCur(dir * (week?7:1))`.
- `shiftCur(n)` (2659): posune `calCur` o n dní.
- `calToday()` (2661): `calCur` = dnes (v týdnu zarovná na pondělí), `monthOffset=0`, `_needScroll7=true`.
- `calWheel(e)` (2671): horizontální scroll (touchpad) → akumulace `_wacc`, krok 32 px → posun období (měsíc: offset; jinak `shiftCur(±1)`), max 8 kroků/event.
- Klávesy: `←/→` období, `D` dnes, `1/2/3` den/týden/měsíc (dle README; handler `_kbList`/globální handler).

### 7.4 Hustota a okraj bloků
- `setDensity(d)` (2662): `PPM = PPMOPT[d] || 0.62`, persist.
- `cycleBorder()` (2663): přepíná `calBorder` `priority↔project`. Levý okraj bloku = `calBorder==='project' ? proj.color : var(--p{priority})`. Hotové → `var(--line)`. Platí v **gridu, all-day, week-list chipu i měsíci**.

---

## 8. `layoutDay` — overlap layout (sloupce/lanes) (2248)

Greedy interval-coloring po klastrech překryvů. Vstup = pole eventů s `{start,end,id}`.
```
evs = tasks sorted by start
map={}; cluster=[]; clusterEnd=-1
flush():                              // přiřaď lanes uvnitř klastru
   cols=[]                            // cols[i] = end-čas posledního eventu v lane i
   for ev in cluster:
       placed=false
       for i in 0..cols.length-1:
           if cols[i] <= ev.start:    // lane volná (předchozí skončil před začátkem)
               cols[i]=ev.end; map[ev.id]={lane:i}; placed=true; break
       if !placed: map[ev.id]={lane:cols.length}; cols.push(ev.end)
   for ev in cluster: map[ev.id].cols = cols.length   // všichni v klastru sdílí počet sloupců
for ev in evs:
   if cluster.length && ev.start < clusterEnd:        // překrývá běžící klastr
       cluster.push(ev); clusterEnd=max(clusterEnd, ev.end)
   else:
       if cluster.length: flush()
       cluster=[ev]; clusterEnd=ev.end
if cluster.length: flush()
return map        // { id: {lane, cols} }
```
**Pravidla:**
- **Klastr** = maximální souvislá množina eventů, kde každý další začíná před koncem dosavadního maxima (`ev.start < clusterEnd`). Pozor: porovnání je `<` (dotyk start==end **nepřekrývá** → nový klastr).
- `lane` = index sloupce; `cols` = celkový počet sloupců v klastru (šířka = `100/cols %`).
- Greedy: event padne do první lane, jejíž poslední konec ≤ jeho start; jinak nová lane.

---

## 9. Render kalendáře — uzly

### 9.1 `eventsNode(iso, multi, dayNum)` — bloky v gridu (den/týden) (2730)
```
evs = calTasks().filter(start!=null && _scopeOk && (search) && _hit(t, iso))
lay = layoutDay(evs)                           // {id:{lane,cols}}
MAX = 3
// re-cluster (stejný algoritmus jako v layoutDay):
sorted = evs by (start, end); clusters = souvislé překryvy
for cl in clusters:
   maxCols = max(lay[t].cols for t in cl)
   if maxCols <= MAX:                            // ≤3 sloupce → vykresli normálně
       for t in cl: eventBlock(t, multi, lane*100/cols, 100/cols, date)
   else:                                         // 4+ sloupců → „+N"
       W = 100/(MAX+0.8)                         // šířka jednoho ze 3 zobrazených (≈26.3 %)
       for t in cl where lane<MAX: eventBlock(t, multi, lane*W, W, date)
       hidden = cl where lane>=MAX
       // hidden se znovu seskupí do pod-klastrů (souvislé překryvy) a každý pod-klastr =
       // jedna „+N" bublina umístěná za 3. sloupcem:
       for grp in subClusters(hidden):
          s=min start, e=max end
          top=(s-DAY_START)*PPM; ht=max(20, (e-s)*PPM)
          node „+{grp.length}" at left:`calc(${MAX*W}% + 2px)`, width:`calc(${100-MAX*W}% - 4px)`
          onClick → přepni na den: { calMode:'day', calCur:_d(iso) }, _needScroll7=true
```
- **„+N" práh = 4+ překrývajících se** (`maxCols>MAX`, MAX=3). Tři se vykreslí, ostatní jako „+N" bublina(y).
- Bublina „+N" otevře **denní pohled** na ten den.
- `W = 100/3.8 ≈ 26.32 %` — tři bloky zaberou ~79 %, zbylých ~21 % patří bublině.

### 9.2 `eventBlock(t, multi, leftPct, widthPct, day)` (2763)
- Čas/pozice: `es/ee` = `dayTimes[day]` override (drag/resize ve week-gridu per-den) **nebo** `t.start/t.end`. `top=(es-DAY_START)*PPM`, `height=max(22,(ee-es)*PPM)`.
- `narrow = widthPct < 46` → menší font (10.5 px), checkbox vpravo nahoře absolutně, žádné meta.
- `showMeta = height>=58 && !narrow` → spodní řádek: název projektu + iniciály prvního přiřazeného (avatar 15 px navy).
- `nameLines = max(1, floor((height-7-(showMeta?15:0))/lineH))`, `lineH = narrow?12:13` — kolik řádků názvu se vejde (line-clamp výškou).
- Levý okraj `bcol` = priorita/projekt (viz 7.4), hotové → `--line`, opacity 0.58.
- Recurring: za názvem `↻` (`t.recurring ? name+' ↻' : name`).
- **Drag/resize úchyty**: `calBlockDown(id,'move',day)` na celém bloku; horní pruh 5 px = `'top'` (resize shora, `ns-resize`); spodní pruh 5 px = `'bottom'`. `data-evblock='1'` — používá se k potlačení klik-add/drag-create, když uživatel míří na blok.
- `calCheck(t,size)` (2762): kulaté zaškrtávátko; `onClick=toggleDone(t.id)`, `onPointerDown/onMouseDown=stop` (aby check nestartoval drag). U occ id toggluje výjimku, u base posouvá řadu (§5) — **odškrtnutí přímo v kalendáři funguje ve všech pohledech**.

### 9.3 `allDayRow(cols, multi)` — celodenní pás + multi-day pruhy (2796)
- `lists[i]` = celodenní úkoly daného sloupce: `calTasks().filter(start==null && !inbox && (week ? (!endDate && tIso===c.iso) : _hit(t, c.iso)))`. Tj. v týdnu jen jednodenní celodenní (`!endDate`) přesně na daný den; v dni přes `_hit`.
- Klik na buňku pásu = `addAllDayAt(c.iso)` (nový celodenní úkol). Drag&drop cíl = `dropToAllDay(c.d)` (přesune existující na celodenní daného dne).
- **Multi-day bars** (jen `isWeek`): `ev = calTasks().filter(start==null && !inbox && tIsoEnd>tIso && nějaký sloupec v rozsahu)`. Každý bar:
  - `li/ri` = index prvního/posledního viditelného sloupce v rozsahu `[tIso, tIsoEnd]`.
  - `left=(li/7)*100 %`, `width=((ri-li+1)/7)*100 %`, výška 20 px, řádek `idx*23+2`.
  - Štítek + `_dayspan(t)+' dní'`. Draggable (celé jako all-day). Border = priorita/projekt.
- Levý gutter pásu „Celý den" 46 px. Pás je `ref=allDayBandEl` — slouží jako **drop-detekce při tažení bloku do all-day** (viz §10.2).

### 9.4 `buildDay(multi)` (2828)
- Header = `allDayRow([{d:jun, iso:curIso, today:isTod}])`.
- Gutter 46 px s hodinovými labely 0..24 (label u 0:00 posunut na `top:2px`, jinak `hr*60*PPM-6`).
- `colInner`: klik = `gridClickAdd(curIso)`; pointerdown = `_calCreateDown(jun)` (drag-create); drop = `dropToGrid(jun)`. Uvnitř hodinové linky + `eventsNode(curIso, multi, jun)` + `createGhost(jun)` + (pokud dnes) `nowLineNode(true)`.
- `total = (DAY_END-DAY_START)*PPM = 1440*0.62 ≈ 892.8 px`; padding gridu `2px 0 40px 0` (40 px dole na poslední hodinu).
- `grid` má `ref=gridRef` (auto-scroll 7:00).

### 9.5 `buildWeek(multi)` (2843)
- Pokud `weekView==='list'` → `buildWeekList` (viz §9.7). Jinak **grid**:
- Hlavička dnů (`marginLeft:46px`), `allDayRow(wd)`.
- Body: hodinové linky `left:46px`, labely vlevo, a **flex kontejner 7 sloupců** `ref=weekGridEl` (slouží pro výpočet dne při drag-move napříč sloupci).
- Každý sloupec: klik = `gridClickAdd(w.iso)`, pointerdown = `_calCreateDown(w.d)`, drop = `dropToGrid(w.d)`, `eventsNode(w.iso, multi, w.d)`, `createGhost(w.d)`, `nowLineNode` jen v dnešním sloupci. Pozadí: dnes = `--brass-soft`, So/Ne = lehce šedé.

### 9.6 `buildMonth(multi)` (2863)
- `base = new Date(2026, 5+monthOffset, 1)`; `dim` = počet dní; `firstDow=(getDay()+6)%7` (pondělí-first). `isCur = monthOffset===0`.
- Hlavička `Po..Ne`; mřížka `repeat(7,1fr)`, řádky 126 px, gap 6 px. Prázdné buňky před prvním dnem.
- Pro každý den: `dt = calTasks().filter(_scopeOk && _hit(t, cellIso))`; `shown=dt.slice(0,3)`, `more=dt.length-3`.
- Karta úkolu (bohatá): zaškrtávátko (11 px), tečka projektu, název (ellipsis), čas `fmt(start)` nebo „celý den" (brass), iniciály přiřazeného (avatar 13 px). Border = priorita/projekt. Draggable (`monthDragStart`), klik = otevřít detail.
- **„+N další"** (`more>0`): klik → denní pohled na ten den (`calMode:'day', calCur:new Date(y,mo,d)`). Tj. **3 úkoly/den + „+N další"**.
- Dnešní buňka: brass border + brass-soft pozadí, číslo dne brass/bold.

### 9.7 `buildWeekList(multi)` + `weekListChip` (2599 / 2582)
- Alternativa ke gridu: 7 sloupců, každý je svislý seznam **chipů** (ne časový grid). Hlavička dnů (dnes = brass).
- Items per den: `calTasks().filter(_scopeOk && (search) && !inbox && _hit(t, w.iso))`, řazeno podle `start` (celodenní = -1 → nahoře).
- `weekListChip(t, day)`: chip s názvem (max 3 řádky), tečka projektu, `↻` u recurring, čas `fmt(es)–fmt(ee)` nebo „Celý den" (brass), zaškrtávátko vpravo nahoře. Border levý = priorita/projekt. Draggable (`adDragStart`), drop sloupce = `dropToGrid(w.d)`.
- `ov = t.dayTimes?.[day]` override i tady (sdílí s gridem).

### 9.8 `hourLinesNode` / `nowLineNode` / `createGhost`
- `hourLinesNode(showLabels)` (2726): 0..24 vodorovných linek, top `(hr*60-DAY_START)*PPM`. (V `buildDay/buildWeek` se linky kreslí inline, tato metoda je samostatná varianta.)
- `nowMin()` (2623) = `getHours()*60+getMinutes()` (reálný čas prohlížeče). `nowLineNode(withLabel)` (2624): červená 2px linka na `nowMin()*PPM`, tečka vlevo, volitelně label s časem. Zobrazí se **jen v dnešním sloupci/dni**.
- `createGhost(date)` (2670): náhled při drag-create (přerušovaný brass obdélník + `fmt(start)–fmt(end)`), jen pro aktivní `_create.date`.

---

## 10. Interakce v gridu — klik-add, drag-create, drag, resize, DnD

### 10.1 Klik = přidat
- `gridClickAdd(date)` (2666): ignoruje, pokud `_suppressClick` (po drag-create), pokud klik na `[data-evblock]`, nebo pokud běží `_cal` (drag). `min = clamp(round((y-top)/PPM/15)*15, 0, 1410)` → `openAddAt(date, min)`.
- `openAddAt(date, min)` (2664): otevře „Přidat úkol" s `dateKind:'custom'`, `customDate` (ISO nebo `2026-06-DD`), `time=fmt(clamp(round(min/15)*15,0,1410))`.
- `addAllDayAt(date)` (2665): celodenní variant z all-day pásu (čas prázdný).

### 10.2 Drag-create (tažením v prázdnu)
- `_calCreateDown(date)` (2667): jen levé tlačítko, ne na `[data-evblock]`. Nastaví `_create={date, rectTop, anchor, start, end:anchor+30, moved:false}`, naváže `pointermove/up`.
- `_calCreateMove` (2668): `cur=clamp(round((y-rectTop)/PPM/15)*15, 0, 1440)`; pokud `abs(cur-anchor)>=15` → `moved=true`; `start=min(anchor,cur)`, `end=max(anchor,cur)` (min 15). `forceUpdate` (živý ghost).
- `_calCreateUp` (2669): odpojí listenery; pokud `moved` → `_suppressClick=true` + otevři add s `customDate=c.date+'. 6.'` (⚠ legacy string „DD. 6.", ne ISO — viz §11), `time=fmt(start)`, `duration=end-start`. Jinak `forceUpdate` (klik propadne na `gridClickAdd`).

### 10.3 Drag (move) a resize bloku
- `calBlockDown(id, mode, day)` (2673): `mode∈{move,top,bottom}`. Uloží `_cal={id,mode,day,multi:!!t.endDate, y0,x0, s0,e0, d0:t.date, moved:false}`. (`s0/e0` z `dayTimes[day]` override, pokud existuje.)
- `_calMove` (2683): `dmin=round((y-y0)/PPM/15)*15`; `moved` pokud `|dy|>4 || |dx|>4`.
  - `move`: `ns=s0+dmin, ne=e0+dmin`. V **týdnu** přepočítá cílový den podle X přes `weekGridEl` (index sloupce 0..6 → `weekDates()[idx].d`). Clamp na `[DAY_START, DAY_END]` se zachováním délky.
  - `top`: `ns=clamp(s0+dmin, DAY_START, e0-15)`.
  - `bottom`: `ne=clamp(e0+dmin, s0+15, DAY_END)`.
  - Zápis: pokud `multi && day!=null` → ulož do `dayTimes[day]={start,end}` (per-den override vícedenního). Jinak přepiš `{start, end, date}`.
- `_calUp` (2698): odpojí listenery.
  - Pokud `moved && mode==='move' && !multi` a kurzor skončil v `allDayBandEl` → **udělej z úkolu celodenní** (`start=null,end=null,date`), v týdnu dle X sloupce. (Drag bloku do all-day pásu = zrušit čas.)
  - Pokud `!moved` → `selectedId=c.id` (klik = otevři detail). Jinak `forceUpdate`.

### 10.4 Drag&drop existujících (HTML5 DnD)
- `adDragStart/adDragEnd` (2704–2705): all-day/chip drag (nastaví `_adDrag=id`).
- `dropToAllDay(date)` (2706): přesune na celodenní daného dne.
- `dropToGrid(date)` (2707): přesune do gridu — `min = DAY_START + round((y-top)/PPM/15)*15`, clamp `[DAY_START, DAY_END-30]`; zachová trvání (`end-start` nebo 60), `end=min(DAY_END, min+dur)`.
- Měsíc: `monthDragStart` / `monthOver` / `monthDropTo(date)` (2708–2710) — přesune úkol na jiný den (`{date}`).

> ⚠️ **DnD a drag-create operují přes legacy `date` / `c.date` (číslo dne v červnu)**, ne přes ISO. `dropToGrid(w.d)`, `monthDropTo(d)`, `_calMove` cílový den (`weekDates()[idx].d`) — všude `w.d` je `null` mimo červen 2026. Tj. **přesun tažením funguje spolehlivě jen v rámci června 2026**; mimo něj `date` je null a zápis `{date:null}` může úkol „odpojit" od dne. Render je už plně na ISO, ale editace tažením zůstala na červnovém čísle. README ř. 159, 161 to označuje za vědomé zjednodušení.

---

## 11. ISO vs. legacy `date` (červen-den) — přesné rozhraní

| Vrstva | Používá |
|---|---|
| **Render/projekce** (`_hit`, `tIso`, `tIsoEnd`, `weekDates.iso`, `_calRange`, `makeOcc`, `_recOccur`) | **ISO** (`t.iso`/`isoEnd`), legacy `date`/`endDate` jen jako fallback `'2026-06-'+pad2(date)` |
| **Posun série** (`toggleDone` advance, `_nextOccISO`) | **ISO** (zapisuje `iso`, vynuluje `date`) |
| **Schránka triage** (`triageSchedule`, 2317) | legacy `date` (map dnes=25/zitra=26/pristi=29) + `dueLabel` z ISO |
| **DnD/drag-create/move cíl** (`dropToGrid`, `monthDropTo`, `_calMove`, `_calCreateUp`) | **legacy `date`** (číslo dne, `null` mimo červen) |
| **Postupy** (`_reflow`, `shiftFlow`, `bucketFor`) | legacy `date` (1..30) |
| `weekDates().d` | `getDate()` jen v červnu 2026, jinak `null`; `dnum` vždy `getDate()` |
| `curJun()` (2656) | `getDate()` jen pokud zobrazený den je v červnu 2026, jinak `null` |

- `bucketFor(date)` (2531): mapuje červnové číslo dne → `{group, day, date}`: `null→inbox`, `<25→overdue/zpozdene`, `25→today/dnes`, `≤28→upcoming/zitra`, jinak `upcoming/pristi`.
- `resolveDate(d)` (2430) v add-formuláři: ISO-aware (počítá `val=y*372+m*31+da` vs. `cur` pro overdue/today/upcoming), ale `date` (legacy číslo) plní jen pro 22.–28. 6. 2026.

---

## 12. Záměrná zjednodušení prototypu (souhrn — NEPŘENÁŠET do produkce 1:1)

1. **`repeatRule` se v projekci ignoruje** — nth-weekday / monthly-day / paritní týden se počítá jen jako prostý krok od kotvy → po čase „uplave". (Hlavní věc k dořešení, §3.1/3.2.)
2. **Per-výskyt override názvu/priority/osob a přesun jednoho výskytu tažením = NEimplementováno** v UI (engine `setOccField` existuje, ovládání ne). README ř. 161.
3. **Posun série nevynuluje** per-person completion (`peopleDone/aDone`) ani podúkoly a nedrží historii dokončených výskytů. §5.3.
4. **Virtuální výskyty jsou vždy jednodenní** — vícedenní opakované řady se zobrazí zploštěle. §6.
5. **DnD / drag-create / drag-move pracují s legacy `date` (číslo dne v červnu 2026)** — spolehlivý přesun jen v rámci června; render je už ISO. §10.4/§11.
6. **Dvě nekonzistentní auto-scroll cílení** (7:00 vs. 8:00/„teď"). §0.
7. **`recurring:true` bez `repeat` ⇒ weekly default** — seed (t2/t13/t19) na tom jede. §1.1.
8. **`weekDates()` nezarovnává na pondělí** — spoléhá, že `calCur` je pondělí (zajišťuje `calToday`/`calNav`). §7.2.
9. Persistence = `localStorage` + seed; bez backendu.

---

## 13. Reimplementace — shrnutí (produkce, React + TS, R4)

**Moduly:**
- `recurrence/` (čistý, dobře testovaný):
  - `RecurrenceRule` + `RecurrenceEnd` (§3.2). Materializer `occurrencesInRange(rule,end,window)` s **plnou** podporou byWeekday/nthWeekday/dayOfMonth/parity.
  - `nextOccurrence(rule, fromISO, end)`; `expandForList(today, horizonDays=16)`; `expandForCalendar(visibleRange)` (přesně viditelné okno).
  - Výjimky: tabulka `(seriesId, ISO) → {done, skipped, time, start, end, priority, …}`; `materializeOccurrence(base, iso, exc)` = ekvivalent `makeOcc` (jednodenní, status/labely dle §1.3) — v produkci povol i vícedenní výskyt (zachovej span z rule).
  - Virtuální id `seriesId@ISO`; `resolveTask(id)`.
- `calendar/`:
  - `layoutDay` (greedy lanes, §8) 1:1.
  - `eventsNode` overlap + „+N při 4+" (MAX=3, W=100/3.8) 1:1; bublina → denní pohled.
  - Konstanty `DAY_START=0`, `DAY_END=1440`, `PPM` (hustota), snap 15 min, default 30 min.
  - Den/týden(Sloupce|Mřížka)/měsíc(3+„+N") + all-day pás + multi-day pruhy.
  - **Editace na ISO** (oprava §10.4/§11): drag/resize/DnD/drag-create musí číst i zapisovat ISO (`iso/isoEnd`), s konverzí dne podle viditelného sloupce → ISO (ne číslo dne).
  - „now" linka z reálného času; auto-scroll na `min(prvníUdálost, 7:00)` (sjednoceno).

**Zarovnání na R4:**
- Default opakování = z **due date** (kotva). Volba **„od dokončení"** (přepočet kotvy z completion).
- Na **další výskyt resetuj všechny per-osobní completiony** (`peopleDone`, `aDone`) i podúkoly.
- Konec: `never/until/count` (count čítej dokončené výskyty, jako `repeatDoneCount`).
- Per-výskyt: skip/done/přesun/priorita/název jako overrides ve výjimkové tabulce (rozšíření, které prototyp jen z části nabízí).
- „Upravit celou řadu" vs. „jen tento výskyt" jako explicitní volba v detailu výskytu.

---

### Příloha: pokryté metody a řádky
- Projekce/engine: `calTasks` 2633, `_calRange` 2639, `_recOccur` 2640, `listTasks` 2654, `makeOcc` 2652, `resolveTask` 2653, `_nextOccISO` 2643, `_dayBucket` 2649, `_bucketISO` 2644, `tIso/tIsoEnd/_hit` 2630–2632, `_occId/_isOccId/_splitOcc` 2646–2648, `_occLabel/_wdShort` 2650–2651, `_d/_isoOf/_dayspan/_addDaysIso` 2641–2645.
- Výjimky/akce: `skipOccurrence` 2477, `restoreOccurrence` 2478, `setOccField/setOccPriority` 2479–2480, `openSeries` 2481, `toggleDone` 2482 (occ větev + advance větev), `calCheck` 2762.
- Parser opakování (kontext): `parseRecurrence` 2005, `RECVOCAB` 2004, `dayFromGen` 2063, ISO helpery `weekdayDate/weekdayParityISO/isoWeek/nthWeekdayISO/nextMonthDayISO` 2060–2077, config setters 2420–2425, materializace do tasku `submitTask` 2447–2474.
- Detail výskytu: `decorate` 2895, `decorateDetail` 2924, šablona banneru 999–1006 + 1075, `repeatCfg` UI 1830–1846 + 2955.
- Kalendář layout/render: `layoutDay` 2248, `weekListChip` 2582, `buildWeekList` 2599, `gridRef/nowMin/nowLineNode` 2622–2624, `curDate/weekDates/weekMonday` 2625/2657/2658, nav `shiftCur/calNav/calToday/calWheel` 2659–2671, density/border `setDensity/cycleBorder` 2662–2663, add/create `openAddAt/addAllDayAt/gridClickAdd/_calCreateDown/Move/Up/createGhost` 2664–2670, drag/resize `calBlockDown/_calMove/_calUp` 2673–2702, DnD `adDragStart/dropToAllDay/dropToGrid/monthDrag*` 2704–2710, node builders `calHours/hourLinesNode/eventsNode/calCheck/eventBlock/allDayRow/buildDay/buildWeek/buildMonth/buildCal` 2725–2893.
- Konstanty: `DAY_START/DAY_END/PPM/PPMOPT` 1911–1912, stav 1901/1908, init 2199/2201, `_needScroll7` chování 2239/2622.
