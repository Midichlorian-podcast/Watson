# 01 — Quick-add parser + datum/čas/opakování + draft UI

> **Účel dokumentu.** Vyčerpávající extrakce logiky chytrého zadávání úkolu z prototypu
> `design/handoff_watson/WatsonApp.dc.html` (jedna třída `class Component`). Tohle je
> **referenční chování**, ne produkční kód — implementační poznámky („Implementace") ukazují,
> jak to postavit pořádně v TS. Řádkové odkazy jsou na verzi souboru ze stavu repo (3268 řádků).
>
> **Doména:** `parseQuick`, `parseRecurrence`, `dayFromGen`, `resolveDate`, `draftView`,
> `renderVals` (jen část draftu), našeptávače `#projekt` / `@osoba` / `+osoba`, zvýraznění tokenů,
> guard prázdného názvu, a všechny pomocné funkce + lookup tabulky.

---

## 0. Klíčové konstanty a kontext „dneška"

Celý parser je postaven kolem **fixního „dneška" = čtvrtek 25. 6. 2026** (seed prototypu).
V produkci to musí být reálné `now()` / uživatelova timezone.

| Konstanta / funkce | Hodnota | Řádek | Význam |
|---|---|---|---|
| `recBase()` | `new Date(2026,5,25)` | 2073 | Základ pro VŠECHNY relativní výpočty opakování a holého dne. Pozn.: měsíc je 0-based → `5` = červen. |
| `recISO(d)` | `YYYY-MM-DD` lokálně | 2074 | Formátování data na ISO bez timezone posunu (`getFullYear`/`getMonth`+1/`getDate`). |
| `DAY_START` / `DAY_END` | `0` / `1440` | 1911 | Minuty od půlnoci; konec dne se používá jako strop pro `end`. |
| `PPM` | `0.62` | 1911 | px na minutu v kalendáři (mimo doménu parseru, ale `freshDraft` jiné). |

> **Pozor — dvě paralelní reprezentace data.** Prototyp drží jak **legacy „červen-den"**
> (`date` = číslo dne 22–28, `group`/`day` symbolické buckety) tak **reálné ISO** (`iso`,
> `customDate`). Parser produkuje hlavně ISO; `resolveDate` pak dopočítá legacy `date`
> jen pro okno 22.–28. 6. 2026 (viz §10). README „Co je vědomě zjednodušené" to potvrzuje:
> drag-drop mezi měsíci a vícedenní úpravy stále jedou na legacy červen-čísle, **zobrazení už
> je na ISO**. V produkci: jediný zdroj pravdy = ISO datum (případně `Date`/`Temporal`), legacy
> bucket zahodit.

---

## 1. `parseQuick(text)` — hlavní parser (řádky 1959–2003)

### Vstup / výstup
- **Vstup:** raw text z `<textarea>` (název úkolu psaný v přirozené češtině).
- **Výstup:** objekt `patch` s rozpoznanými poli + `hits` (pole tokenů pro zvýraznění) +
  `liveName` / `cleanName` (text bez rozpoznaných částí).

### Mechanika (jádro)
```js
const patch={}; const hits=[];
let work=' '+(text||'')+' ';                       // wrap mezerami → \b a (^|\s) fungují i na krajích
const cut=(m,kind)=>{                              // odřízne match z `work` a zapíše token do hits
  if(m){ const s=(typeof m==='string'?m:m[0]);
         const t=String(s).trim();
         if(t) hits.push({ t, kind:kind||'date' });
         work=work.replace(s,' '); } };            // POZOR: replace nahradí jen PRVNÍ výskyt
```
- `work` je pracovní kopie obalená mezerami. Každé rozpoznané pravidlo svůj match **vyřízne**
  (`cut`) → následující pravidla už ten kus textu nevidí. **Pořadí pravidel je tedy závazné.**
- `cut` přidává token do `hits` s `kind` ∈ `date | repeat | proj | person` (default `date`).
  `kind` řídí jen barvu/sémantiku zvýraznění, ne logiku.
- `work=work.replace(s,' ')` — `String.replace(string, ...)` nahrazuje **jen první výskyt**.
  To je vědomé (token je obvykle unikátní), ale je to edge case: dvojí `p1 ... p1` vyřízne jen
  první, druhý zůstane v názvu.

### Pořadí vyhodnocení (důležité!)
1. **Deadline** `!d. m. [rrrr]` (ř. 1964–1965)
2. **Priorita** `p1–p4` (ř. 1966)
3. **Čas** (4 varianty, else-if řetěz; ř. 1967–1972)
4. **Trvání** (6 variant, else-if řetěz; ř. 1973–1980)
5. **Vícedenní** `N dn[íiy]` (ř. 1981)
6. **Datum** `d. m. [rrrr]` → else `pozítří` → else `zítra` → else `dnes` (ř. 1982–1986)
7. **Opakování** přes `parseRecurrence(work)` (ř. 1987–1988)
8. **Holý den v týdnu** (jen když nebylo opakování ani datum; ř. 1989–1993)
9. **Projekt** `#X` (ř. 1994)
10. **Sestavení `base` názvu** — odřezání „v měsíci", recyklace RECVOCAB, odřezání `@`/`+` (ř. 1995–2001)

Každé z těchto je rozepsané níže jako samostatná sekce.

### Výstupní pole `patch` (souhrn)
| Pole | Typ | Plněno kým |
|---|---|---|
| `deadline` | `YYYY-MM-DD` | §2 |
| `priority` | `1..4` | §3 |
| `time` | `HH:MM` | §4 (i z §8 opakování) |
| `duration` | minuty (int) | §5 |
| `days` | `1..60` | §6 |
| `dateKind` | `'custom' \| 'zitra' \| 'dnes'` (+ `'pristi'`,`'pmonth'`,`'none'` z UI) | §7, §9 |
| `customDate` | `YYYY-MM-DD` | §7, §8, §9 |
| `repeat` / `repeatRule` / `repeatLabel` | viz §11 | §8 |
| `project` | id projektu | §10 |
| `liveName` | string | §12 |
| `cleanName` | string (bez `@`/`+` tokenů) | §12 |
| `hits` | `[{t,kind}]` | průběžně |

---

## 2. Deadline `!d. m. [rrrr]` (ř. 1964–1965)

- **Trigger:** vykřičník + den + tečka + měsíc + tečka + volitelně rok.
- **Regex:** `/!\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/`
- **Logika:**
  ```js
  const dl=work.match(/!\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/);
  if(dl){ const da=+dl[1],mo=+dl[2],y=dl[3]?+dl[3]:2026;
    if(mo>=1&&mo<=12&&da>=1&&da<=31){
      patch.deadline = y+'-'+pad(mo)+'-'+pad(da); }
    cut(dl[0]); }
  ```
- **Pole:** `patch.deadline = 'YYYY-MM-DD'`.
- **Default rok = 2026** (fixní rok prototypu).
- **Validace:** měsíc 1–12, den 1–31 (žádná kontrola délky měsíce — `31. 2.` projde).
- **Důležité pořadí:** deadline se parsuje **PŘED** běžným datem (§7), protože jinak by
  `/(\d{1,2})\.\s*(\d{1,2})\./` chytlo i datum za `!`. `!` je tu rozlišovač deadline vs. termín.
- **Edge:** I když je den/měsíc mimo rozsah, `cut(dl[0])` se zavolá tak jako tak → token z názvu
  zmizí, ale `deadline` se nenastaví. (drobná nekonzistence)
- **Implementace (TS):** regex zachovat; default rok = aktuální rok; validovat reálnou délku
  měsíce (`new Date(y, mo, 0).getDate()`); pokud nevalidní, NEvyřezávat z názvu.

---

## 3. Priorita `p1`–`p4` (ř. 1966)

- **Trigger:** `p` + číslice 1–4 jako samostatné slovo.
- **Regex:** `/\bp([1-4])\b/i` (case-insensitive → `P2` taky).
- **Logika:** `if(pr){ patch.priority=+pr[1]; cut(pr[0]); }`
- **Pole:** `patch.priority = 1..4`.
- **Edge:** `\b` hranice slova → `p5` se nechytí; `top1` se nechytí (`p` není na hranici).
  Ale pozor: `\b` mezi písmenem a číslicí NEexistuje, takže `\bp1` vyžaduje `p` na začátku slova.
- **Default priorita** je `2` (z `freshDraft`, ř. 1920) — když není `p`, zůstane P2.
- **Implementace:** triviální. Zachovat `i` flag.

---

## 4. Čas (ř. 1967–1972) — 4 varianty, else-if řetěz

Společné výstupy: `tH` (hodina), `tM` (minuta). Na konci:
```js
if(tH!=null){ patch.time = pad(tH)+':'+pad(tM); }
```

### 4a. Předložka + `HH:MM` nebo `HH.MM`
- **Regex:** `/\b(?:v|ve|od)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i`
- `v 14:00`, `ve 9:30`, `od 14.00`. Hodina 0–23, minuta 00–59. Oddělovač `:` nebo `.`.
- `tH=+m[1]; tM=+m[2]`.

### 4b. Holý `HH:MM` (bez předložky)
- **Regex:** `/\b([01]?\d|2[0-3]):([0-5]\d)\b/` (jen `:`, ne `.`)
- `14:00`. Pozor: bez `i` flagu (nepotřebuje, jsou tam jen číslice).

### 4c. Předložka + celé hodiny slovem „hodin"
- **Regex:** `/\b(?:v|ve|od)\s+(\d{1,2})\s*hodin\w*/i`
- `v 15 hodin`, `od 9 hodin`, `v 9 hodinách`. `\w*` pokryje pádové koncovky.
- Podmínka `+m[1]<=23` (jen platná hodina), pak `tH=+m[1]; tM=0`.
- **Edge:** Když hodina > 23, match **se nevyřízne** (`cut` je uvnitř `if`) → zůstane v názvu.

### 4d. Předložka + hodina SLOVEM + „hodin" (`v patnácti hodin`)
- **Regex:** `/\b(?:v|ve|od)\s+([\p{L}]+(?:\s+[\p{L}]+)?)\s+hodin\w*/iu`
- `v patnácti hodin`, `v devíti hodin`, `ve třiceti hodin` (ale to >23 → zahozeno).
- Bere 1–2 slova (`([\p{L}]+(?:\s+[\p{L}]+)?)`) → kvůli složeným číslovkám typu „dvacet jedna".
- Slovo→číslo přes **`czNum()`** (viz §13). Podmínka `v!=null && v<=23` → pak `tH=v; tM=0`.

> **Pořadí 4a→4d je závazné** (else-if). Numerický tvar má přednost před slovním.
> Holý `HH:MM` (4b) je až po předložkové variantě (4a), aby `v 14:00` nechytlo dvakrát.

- **Pole:** `patch.time = 'HH:MM'`, vždy s nulami (`pad`). Minuty u slovních/celohodinových = `00`.
- **Implementace (TS):**
  - Zachovat všechny 4 větve a jejich pořadí.
  - `\p{L}` vyžaduje `u` flag (unicode) — v TS regexu OK.
  - `czNum` přepsat jako čistou funkci (viz §13).
  - Doporučení: u 4c/4d, když hodina > 23, **nevyřezávat** (sjednotit chování s 4a/4b, kde
    regex sám hlídá 0–23).

---

## 5. Trvání (ř. 1973–1980) — 6 variant, else-if řetěz

Společný výstup: `dur` (minuty). Na konci: `if(dur!=null) patch.duration=dur;`

| # | Trigger / regex | Výsledek | Pozn. |
|---|---|---|---|
| 5a | `/(?:po dobu\s+)?(\d+)\s*min\w*/i` | `dur=+m[1]` | `90 min`, `po dobu 90 minut`, `45 minut`. `\w*` = koncovky. |
| 5b | `/po dobu\s+([\p{L}]+(?:\s+[\p{L}]+)?)\s*minut\w*/iu` | `dur=czNum(m[1])` | `po dobu šedesáti minut`. 1–2 slova. |
| 5c | `/\b([\p{L}]+(?:\s+[\p{L}]+)?)\s+minut\w*/iu` | `dur=czNum(m[1])` | `šedesát minut` (bez „po dobu"). |
| 5d | `/(?:po dobu\s+)?p[ůu]l\s+hodin\w*/i` | `dur=30` | `půl hodiny`, `po dobu půl hodiny`. `p[ůu]l` = ů i u. |
| 5e | `/(?:po dobu\s+)?(\d+(?:[.,]\d+)?)\s*(?:hodin\w*\|hod\w*\|h)\b/i` | `dur=round(parseFloat(...)*60)` | `1.5 h`, `2 hodiny`, `1,5 hod`. Desetinná čárka i tečka (`replace(',','.')`). |
| 5f | `/po dobu\s+([\p{L}]+)\s+hodin\w*/iu` | `dur=czNum(m[1])*60` | `po dobu dvou hodin`. Jen 1 slovo. |

> **Pořadí je klíčové:** minutové varianty (5a–5c) PŘED hodinovými (5d–5f), protože „min" je
> specifičtější. `půl hodiny` (5d) před obecnými hodinami (5e), jinak by `5e` nechytlo „půl"
> (není číslo). `1.5 h` (5e) má desetinné číslo → násobí 60.

- **Pole:** `patch.duration` v minutách.
- **Edge cases:**
  - 5a `\w*` za `min` → chytne i „min" v jiném slově? Ne, protože před tím je `\d+\s*`.
  - 5e: `h` na konci samostatně (`\b`), takže `1.5h`, `1.5 h`, `2 hod`, `2 hodiny`.
  - `czNum` může vrátit `null` (neznámé slovo) → u 5b/5c/5f se `dur` nenastaví, ale match
    **se přesto vyřízne** jen pokud `v!=null` (cut je uvnitř `if(v!=null)`). U 5f je `cut` taky
    uvnitř → OK.
- **Implementace (TS):**
  - Zachovat 6 větví + pořadí.
  - `parseFloat(m[1].replace(',','.'))` pro desetinné hodiny.
  - `Math.round(... * 60)` → `1.5 h` = 90, `1,25 h` = 75.
  - Zvážit horní strop (UI má `Math.min(10080, ...)` = týden, ř. 2406).

---

## 6. Vícedenní `N dn[íiy]` (ř. 1981)

- **Trigger:** číslo + „dny/dní/dnů…" — regex `/(\d+)\s*dn[íiy]\b/i`.
- `4 dny`, `3 dní`, `2 dny`. Koncovka `dn` + jedno z `í/i/y`.
- **Logika:** `patch.days = Math.max(1, Math.min(60, parseInt(dd[1],10)));`
- **Pole:** `patch.days` (clamp 1–60).
- **Edge:** `dn[íiy]` nepokrývá „den" (jednotné číslo „1 den"). To je vědomé — `N dny` je
  vícedenní rozsah, „den" jednotně nedává smysl jako rozsah. Pozor ale: opakování `parseRecurrence`
  rozumí „den/dny/dní" jako „každý den" (viz §11) — ale to běží na `work` PO vyříznutí `N dny`
  zde, takže `4 dny` (multi) ≠ `dny` (opakování). Pořadí je správné: multi-day se vyřízne dřív.
- **Implementace:** zachovat clamp 1–60; v produkci dopočítat `isoEnd` z `iso + (days-1)`
  (viz `submitTask`, ř. 2466).

---

## 7. Datum — explicitní + relativní (ř. 1982–1986)

else-if řetěz; první match vyhrává.

### 7a. Explicitní `d. m. [rrrr]`
- **Regex:** `/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/`
- `3. 7. 2027`, `5. 7.`, `25.6.`. Den, měsíc, volitelně rok.
- **Logika:**
  ```js
  const da=+dm[1], mo=+dm[2], y=dm[3]?+dm[3]:2026;
  if(mo>=1&&mo<=12&&da>=1&&da<=31){
    patch.dateKind='custom';
    patch.customDate = y+'-'+pad(mo)+'-'+pad(da);
    cut(dm[0]); }
  ```
- **Pole:** `dateKind='custom'`, `customDate='YYYY-MM-DD'`.
- **Default rok = 2026.** Validace 1–12 / 1–31 (bez délky měsíce). Když nevalidní → NEvyřízne
  (cut uvnitř if, na rozdíl od deadline §2).

### 7b. `pozítří`
- **Regex:** `/poz[íi]t[řr][íi]|po\s+z[íi]t[řr][íi]/i`
- `pozítří`, `po zítří` (i bez diakritiky `pozitri`).
- **Pevně:** `dateKind='custom'`, `customDate='2026-06-27'` (= 25.6. + 2 dny, hardcoded!).

### 7c. `zítra`
- **Regex:** `/z[íi]tra/i`
- `zítra`, `zitra`. → `dateKind='zitra'` (token vyříznut z odpovídajícího matche).
- Pozn.: zde `customDate` se NEnastavuje, jen `dateKind='zitra'`; konkrétní datum dopočte
  `resolveDate`/`termISO` (= `2026-06-26`).

### 7d. `dnes`
- **Regex:** `/\bdnes\b/i` → `dateKind='dnes'`.

> **Hardcoded data.** `pozítří` → `2026-06-27` natvrdo, `zítra`/`dnes` přes symbolický kind
> (mapováno v `termISO`/`resolveDate` na `2026-06-26`/`2026-06-25`). V produkci nahradit
> `recBase()+N dní`.

- **Implementace (TS):**
  - 7a: default rok = aktuální; validovat délku měsíce.
  - 7b/7c/7d: počítat z reálného „dneška": `dnes = today`, `zítra = today+1`, `pozítří = today+2`.
  - Zvážit i past/future rozlišení: explicitní datum bez roku v minulosti → příští rok?
    (prototyp neřeší — vždy rok 2026 / zadaný.)

---

## 8. Opakování v parseQuick (ř. 1987–1988)

```js
const rec=this.parseRecurrence(work);
if(rec){
  patch.repeat=rec.repeat;
  patch.repeatRule=rec.repeatRule;
  patch.repeatLabel=rec.repeatLabel;
  if(rec.startISO && patch.dateKind===undefined){     // start jen když datum ještě nepadlo
    patch.dateKind='custom'; patch.customDate=rec.startISO; }
  if(rec.time && !patch.time) patch.time=rec.time;     // čas z fráze, jen když ještě není
}
```
- `parseRecurrence` dostává `work` **po** vyříznutí deadline/priority/času/trvání/multi/data.
- Pokud opakování vrátí `startISO` (první výskyt) **a** datum ještě nebylo nastaveno z §7,
  použije se jako termín. Tj. „každou středu" zároveň nastaví nejbližší středu jako start.
- Pokud fráze obsahuje čas (`parseRecurrence` si ho taky parsuje) a §4 ho nenašlo, doplní se.

Detail samotného `parseRecurrence` viz **§11**.

---

## 9. Holý den v týdnu → nejbližší budoucí (ř. 1989–1993)

Spustí se **jen když** `!rec && patch.dateKind===undefined` (nebylo opakování ani datum).

```js
let bareWd=false;
if(!rec && patch.dateKind===undefined){
  const WD2=[['pond[ěe]l',1],['[úu]ter',2],['st[řr]ed',3],['[čc]tvrt',4],
             ['p[áa]t(?:ek|ku|ky)',5],['sobot',6],['ned[ěe]l',0]];
  for(let i=0;i<WD2.length;i++){
    const st=WD2[i][0], d=WD2[i][1];
    if(new RegExp('(?:^|\\s)(?:'+st+')[\\p{L}]*(?=\\s|$)','iu').test(work)){
      const ahead=/p[řr][íi]št/i.test(work)?1:0;   // „příští" → +1 týden navíc
      patch.dateKind='custom';
      patch.customDate=this.weekdayDate(d, ahead);
      bareWd=true; break; } }
}
```

### WD2 tabulka (stem → weekday, neděle=0)
| Stem (regex) | Den (JS getDay) | Pokrývá |
|---|---|---|
| `pond[ěe]l` | 1 | pondělí, pondělky… |
| `[úu]ter` | 2 | úterý, úter… (i `uter`) |
| `st[řr]ed` | 3 | středa, středu… (i `stred`) |
| `[čc]tvrt` | 4 | čtvrtek… (i `ctvrt`) |
| `p[áa]t(?:ek\|ku\|ky)` | 5 | pátek/pátku/pátky (i `patek`) — **POZOR: jen tyto 3 koncovky** |
| `sobot` | 6 | sobota, sobotu… |
| `ned[ěe]l` | 0 | neděle, neděli… (i `nedel`) |

- **Regex per den:** `(?:^|\s)(?:STEM)[\p{L}]*(?=\s|$)` — stem následovaný písmeny, ohraničený
  mezerou/krajem. `[\p{L}]*` chytne libovolnou pádovou koncovku.
- **„příští":** `/p[řr][íi]št/i` ⟹ `ahead=1` (jeden týden navíc).
- **`weekdayDate(d, ahead)`** (ř. 2060):
  ```js
  weekdayDate(wd, weeksAhead){
    const d=this.recBase();                  // 25.6.2026 (čt)
    let add=(wd-d.getDay()+7)%7;
    if(add===0) add=7;                       // dnešní den → BERE AŽ PŘÍŠTÍ TÝDEN (ne dnes!)
    d.setDate(d.getDate()+add+7*(weeksAhead||0));
    return this.recISO(d); }
  ```
  - „nejbližší budoucí" = striktně budoucí; pokud je dnes čtvrtek a napíšu „čtvrtek", dostanu
    **příští** čtvrtek (`add===0 → 7`), ne dnešek.
  - „příští pondělí" = nejbližší pondělí + 7 dní.
- **Pole:** `dateKind='custom'`, `customDate=ISO`, `bareWd=true` (flag pro zvýraznění v §12).

> **Pozor na kolizi s opakováním.** Den v týdnu se jako *termín* (ne opakování) bere jen když
> `parseRecurrence` nevrátil nic. „každou středu" → opakování (§11), „středa" → holý termín
> (tady). „příští středa" → holý termín +1 týden (protože „každ" tam není → `parseRecurrence`
> vrátí null, viz §11 `hasK`).

- **Implementace (TS):**
  - Tabulku WD2 sjednotit s `WD` z `parseRecurrence` (§11) — jsou to dvě skoro stejné tabulky,
    riziko rozjetí. Doporučení: jedna tabulka `{stem, weekday, …labely}`.
  - `weekdayDate` přepsat na reálný `today`.
  - Rozšířit `pátek` koncovky (chybí např. lokativ „v pátek" je OK přes „pátek", ale
    „pátkem" by selhalo). Zvážit `p[áa]t[\p{L}]*` jako u ostatních.

---

## 10. Projekt `#X` (ř. 1994)

- **Trigger:** `#` + písmena. Regex `/#(\p{L}+)/u`.
- **Logika:**
  ```js
  const hash=work.match(/#(\p{L}+)/u);
  if(hash){
    const exact=this.PROJECTS.find(x=>x.name.toLowerCase()===hash[1].toLowerCase());
    if(exact){ patch.project=exact.id; }   // jen PŘESNÁ shoda názvu
    cut(hash[0],'proj'); }
  ```
- **Pole:** `patch.project` — **jen když `#X` přesně odpovídá `PROJECTS[].name`** (case-insensitive,
  celý název). Token se vyřízne vždy (`cut` mimo if), i bez shody.
- **Důležité:** `#X` v `parseQuick` přiřadí projekt **jen na přesnou shodu celého názvu**
  (např. `#Obchod` → projekt „Obchod"). Vícесlovné názvy („Q3 plánování") přes `#` neprojdou
  (regex bere jen jedno `\p{L}+` slovo). Skutečný **našeptávač** projektů (částečná shoda, šipky,
  Enter) běží jinde — v `draftName` (§14), ne tady.
- **Implementace:** v `parseQuick` ponechat jen vyříznutí tokenu + případně exact-match;
  fuzzy výběr nechat na našeptávač (§14).

---

## 11. `parseRecurrence(text)` — opakování (ř. 2005–2048)

Nejsložitější část. Vrací `null` nebo objekt:
```ts
{
  repeat: 'daily'|'weekly'|'biweekly'|'monthly'|'yearly',
  repeatRule: { kind: ..., ... },       // strukturovaná definice (viz tabulka rule)
  repeatLabel: string,                  // český label do UI
  startISO?: string,                    // první výskyt (jen u některých)
  time?: string|null                    // HH:MM z fráze (nebo null)
}
```

### Pomocný matcher `B(stem)` (ř. 2007)
```js
const B=(stem)=>{ try{
  return new RegExp('(?<![\\p{L}])(?:'+stem+')(?![\\p{L}])','u').test(s);
}catch(e){ return new RegExp('(?:^|[^a-zà-ž])(?:'+stem+')(?![a-zà-ž])').test(s); } };
```
- Lookbehind/lookahead „není písmeno" → slovo ohraničené ne-písmeny (robustnější `\b` pro
  unicode). Fallback (catch) pro prostředí bez lookbehind.
- `s = text.toLowerCase()`.

### Čas uvnitř opakování (ř. 2008)
```js
const time = (m=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)) ? (pad(+m[1])+':'+m[2]) : null;
```
- Hledá `HH:MM` v celé frázi. Vrací se v každém výsledku (i null).

### Brány vstupu (ř. 2009–2010)
```js
const hasK = /každ|kazd/.test(s);                        // „každ-" kdekoliv
const evenOdd = B('sud[éýáou]\\w*') ? 'even'
              : (B('lich[éýáou]\\w*') ? 'odd' : null);   // sudý/lichý
```

### Větev A — bez „každ" a bez sudý/lichý (ř. 2011–2017): příslovce
Spustí se jen `if(!hasK && !evenOdd)`:
| Trigger (`B(...)`) | repeat | repeatRule | repeatLabel |
|---|---|---|---|
| `denně` / `denne` | `daily` | `{kind:'daily'}` | `Denně` |
| `týdně` / `tydne` | `weekly` | `{kind:'weekly'}` | `Týdně` |
| `měsíčně` / `mesicne` | `monthly` | `{kind:'monthly'}` | `Měsíčně` |
| `ročně` / `rocne` | `yearly` | `{kind:'yearly'}` | `Ročně` |
- Když nic z toho → `return null`. **Žádný `startISO`** (jen abstraktní pravidlo).

### WD tabulka (dny v týdnu pro opakování) — ř. 2018–2026 (VERBATIM)
```js
const WD=[
 {st:'pond[ěe]l[íi]',      d:1, every:'Každé pondělí', every2:'Každé druhé pondělí', evenL:'Každé sudé pondělí',  oddL:'Každé liché pondělí',  nom:'pondělí'},
 {st:'[úu]ter[ýyíi]',      d:2, every:'Každé úterý',    every2:'Každé druhé úterý',   evenL:'Každé sudé úterý',    oddL:'Každé liché úterý',    nom:'úterý'},
 {st:'st[řr]ed[uaye]',     d:3, every:'Každou středu',  every2:'Každou druhou středu',evenL:'Každou sudou středu', oddL:'Každou lichou středu', nom:'středa'},
 {st:'[čc]tvrt(?:ek|ku|ky)',d:4,every:'Každý čtvrtek',  every2:'Každý druhý čtvrtek', evenL:'Každý sudý čtvrtek',  oddL:'Každý lichý čtvrtek',  nom:'čtvrtek'},
 {st:'p[áa]t(?:ek|ku|ky)', d:5, every:'Každý pátek',    every2:'Každý druhý pátek',   evenL:'Každý sudý pátek',    oddL:'Každý lichý pátek',    nom:'pátek'},
 {st:'sobot[uaye]',        d:6, every:'Každou sobotu',  every2:'Každou druhou sobotu',evenL:'Každou sudou sobotu', oddL:'Každou lichou sobotu', nom:'sobota'},
 {st:'ned[ěe]l[iey]',      d:0, every:'Každou neděli',  every2:'Každou druhou neděli',evenL:'Každou sudou neděli', oddL:'Každou lichou neděli', nom:'neděle'},
];
let wd=null; for(const w of WD){ if(B(w.st)){ wd=w; break; } }
const inMonth = B('m[ěe]s[íi]ci') || /\bv\s+m[ěe]s/.test(s);   // „v měsíci"
```
> Pozn.: stemy se LIŠÍ od `WD2` v §9 (tady mají `[íi]`/`[uaye]` koncovky pro skloňování ve
> spojení „každou středu"). Riziko rozjetí dvou tabulek — viz Implementace.

### Větev B — den v týdnu rozpoznán (`if(wd)`, ř. 2029–2039)
Priorita uvnitř:
1. **n-tý den v měsíci** (`inMonth && nth!=null`, ř. 2030–2035)
   ```js
   const nthDefs=[['posledn[íiěe]?',-1],['prvn[íie]',1],['druh[éouý]',2],
                  ['t[řr]et[íi]',3],['[čc]tvrt[éouý]',4],['p[áa]t[éouý]',5]];
   let nth=null; for(const def of nthDefs){ if(B(def[0])){ nth=def[1]; break; } }
   if(inMonth && nth!=null){
     const lbl = nth===-1 ? ('Poslední '+wd.nom+' v měsíci')
                          : (nth+'. '+wd.nom+' v měsíci');
     return { repeat:'monthly',
              repeatRule:{kind:'monthly-nth', nth, weekday:wd.d},
              repeatLabel:lbl,
              startISO:this.nthWeekdayISO(nth, wd.d), time }; }
   ```
   - „každé první úterý v měsíci" → `{kind:'monthly-nth', nth:1, weekday:2}`, label
     „1. úterý v měsíci", start = první úterý ≥ dneška.
   - „poslední pátek v měsíci" → `nth:-1`.
   - **nthDefs tabulka (VERBATIM):** poslední=-1, první=1, druhé=2, třetí=3, čtvrté=4, páté=5.

2. **sudý/lichý → biweekly s paritou** (`if(evenOdd)`, ř. 2036)
   ```js
   return { repeat:'biweekly',
            repeatRule:{kind:'biweekly', weekday:wd.d, parity:evenOdd},
            repeatLabel:(evenOdd==='even'?wd.evenL:wd.oddL),
            startISO:this.weekdayParityISO(wd.d, evenOdd), time };
   ```
   - „každý sudý čtvrtek" → `{kind:'biweekly', weekday:4, parity:'even'}`, label „Každý sudý čtvrtek",
     start = nejbližší čtvrtek v sudém ISO týdnu.

3. **každý / každý druhý** (default, ř. 2037–2038)
   ```js
   const bi = B('druh[éouýa]\\w*') || B('dva') || B('dvou');
   return { repeat:(bi?'biweekly':'weekly'),
            repeatRule:{kind:(bi?'biweekly':'weekly'), weekday:wd.d},
            repeatLabel:(bi?wd.every2:wd.every),
            startISO:this.weekdayDate(wd.d,0), time };
   ```
   - „každou středu" → weekly, weekday:3, label „Každou středu", start = nejbližší budoucí středa.
   - „každou druhou středu" → biweekly, label „Každou druhou středu".
   - `bi` se aktivuje slovy: „druh-" (druhou/druhý/druhé…), „dva", „dvou".

### Větev C — den v měsíci číslem/slovem (`wd` nenalezen, ř. 2040–2042)
```js
let day=this.dayFromGen(s);                      // slovní řadová číslovka (§ dayFromGen)
if(day==null){
  const dm=s.match(/(\d{1,2})\.(?!\s*\d)/);       // „25." ale NE „25. 7." (negative lookahead na měsíc)
  if(dm){ const nn=+dm[1]; if(nn>=1&&nn<=31) day=nn; } }
if(day!=null) return { repeat:'monthly',
                       repeatRule:{kind:'monthly-day', day},
                       repeatLabel:day+'. v měsíci',
                       startISO:this.nextMonthDayISO(day), time };
```
- „každého 25. v měsíci" → `{kind:'monthly-day', day:25}`, label „25. v měsíci", start = nejbližší
  25. ≥ dneška (`nextMonthDayISO`).
- Číslo bere `(\d{1,2})\.` ale s **negative lookahead** `(?!\s*\d)` — aby `25. 7.` (datum) NEbylo
  chápáno jako „25. v měsíci". Tedy číslo + tečka, za níž už není další číslo.
- `dayFromGen` rozumí i slovní řadové číslovce „pětadvacátého" apod. (viz §15).

### Větev D — obecné jednotky (fallback, ř. 2043–2047)
| `B(...)` trigger | repeat | repeatRule | repeatLabel |
|---|---|---|---|
| `den` / `dny` / `denn[íěe]` | `daily` | `{kind:'daily'}` | `Každý den` |
| `t[ýy]den` / `t[ýy]dn[ěeyů]` | `weekly` nebo `biweekly`* | `{kind:weekly\|biweekly}` | `Každý týden` / `Každé 2 týdny` |
| `m[ěe]s[íi]c` / `m[ěe]s[íi]ce` | `monthly` | `{kind:'monthly'}` | `Každý měsíc` |
| `rok` / `roce` / `roky` | `yearly` | `{kind:'yearly'}` | `Každý rok` |

\* `bi = B('druh[éouýa]\\w*') || B('dva') || /\b2\b/.test(s)` → „každé 2 týdny", „každý druhý týden".

- Když ani jedno → `return null`.

### repeatRule kindy — souhrnná tabulka
| `kind` | Pole | Sémantika | Vzniká z |
|---|---|---|---|
| `daily` | — | každý den | denně / každý den / „den" |
| `weekly` | `weekday?` | každý týden (příp. konkrétní den) | týdně / každý týden / každou STŘEDU |
| `biweekly` | `weekday?`, `parity?` | po 14 dnech; parity = sudý/lichý ISO týden | každou druhou STŘEDU / každý sudý ČTVRTEK / každé 2 týdny |
| `monthly` | — | každý měsíc | měsíčně / každý měsíc |
| `monthly-nth` | `nth`, `weekday` | n-tý <den> v měsíci (nth=-1 = poslední) | každé první úterý v měsíci |
| `monthly-day` | `day` | konkrétní den v měsíci (1–31) | každého 25. v měsíci |
| `yearly` | — | každý rok | ročně / každý rok |

> **`repeat` (string) vs `repeatRule` (objekt).** `repeat` je hrubá kategorie pro výpočet
> výskytů a UI pilulky (Neopakovat/Denně/Týdně/Po 14 dnech/Měsíčně). `repeatRule` nese přesnou
> definici (který den, n-tý, parita). `repeatLabel` je lidský text. V `draftView` je `richActive`
> = `repeatRule` má `weekday|day|nth` nebo `kind==='yearly'` — pak se zobrazí `repeatLabel`
> místo prosté pilulky (ř. 2951–2953).

- **Implementace (TS):**
  - Přepsat na čistou funkci `parseRecurrence(text, today): RepeatResult|null`.
  - `repeatRule` jako diskriminovaná unie (`kind`).
  - Sjednotit WD/WD2 do jedné tabulky.
  - `startISO` počítat z reálného `today`.
  - Doporučení: zvážit RFC 5545 RRULE jako kanonický formát v DB (mapování:
    daily→`FREQ=DAILY`, weekly+weekday→`FREQ=WEEKLY;BYDAY=WE`, biweekly→`FREQ=WEEKLY;INTERVAL=2`,
    monthly-nth→`FREQ=MONTHLY;BYDAY=1TU` / poslední `BYDAY=-1FR`, monthly-day→`FREQ=MONTHLY;BYMONTHDAY=25`,
    yearly→`FREQ=YEARLY`). Parita sudý/lichý ISO-týden NENÍ standardní RRULE — řešit vlastním polem.

---

## 12. Sestavení názvu + zvýraznění (ř. 1995–2002)

```js
// 1) odřízni "v měsíci" → token kind:repeat
let base = work.replace(/\b(?:ve?)\s+m[ěe]s[íi]ci\b/giu,(s)=>{
  const t=s.trim(); if(t) hits.push({ t, kind:'repeat' }); return ' '; });

// 2) pokud bylo opakování NEBO holý den → recykluj celý RECVOCAB jako tokeny a vyřízni
if(rec || bareWd){
  let rm; const re=new RegExp(this.RECVOCAB.source,'giu');
  while(rm=re.exec(base)){ const t=rm[0].trim(); if(t) hits.push({ t, kind:'repeat' }); }
  base = base.replace(this.RECVOCAB,' '); }

// 3) tokeny @osoba / +osoba do hits (ale NEvyřezávat z `base` ještě)
let am; const are=/[@+](\p{L}+)/gu;
while(am=are.exec(work)){ const t=am[0].trim(); if(t) hits.push({ t, kind:'person' }); }

// 4) finalizace
base = base.replace(/\s{2,}/g,' ').trim();
patch.liveName  = base;                                   // text s @/+ tokeny ještě uvnitř
patch.cleanName = base.replace(/[@+]\p{L}+/gu,' ').replace(/\s{2,}/g,' ').trim();  // bez @/+
patch.hits      = hits;
return patch;
```

### `RECVOCAB` (getter, ř. 2004) — VERBATIM
```js
get RECVOCAB(){ return /(?:^|\s)(?:každ\p{L}*|denn[ěe]\p{L}*|denne|týdn[ěe]\p{L}*|tydne|měsí[čc]n[ěe]\p{L}*|mesicne|ro[čc]n[ěe]\p{L}*|rocne|sud\p{L}*|lich\p{L}*|prvn\p{L}*|druh\p{L}*|t[řr]et\p{L}*|posledn\p{L}*|p[řr][íi]št\p{L}*|nejbli[žz]\p{L}*|pond[ěe]l\p{L}*|[úu]ter\p{L}*|st[řr]ed\p{L}*|[čc]tvrt\p{L}*|p[áa]t(?:ek|ku|ky)|sobot\p{L}*|ned[ěe]l\p{L}*|t[ýy]dn\p{L}*|t[ýy]den|m[ěe]s[íi]ci|m[ěe]s[íi]c\p{L}*|den|dny|dn[íi]|rok|roce|roky|hodin\p{L}*|minut\p{L}*|po dobu)(?=\s|$)/giu; }
```
- Slovník VŠECH slov, která mohou patřit k opakování (každ-, denně, týdně, sudý, lichý, první,
  druhý, třetí, poslední, příští, nejbližší, všechny dny v týdnu, týden, měsíc, den/dny/dní, rok,
  hodin, minut, „po dobu"). Použit dvakrát: jako iterátor (`exec`) pro sběr tokenů a jako mask
  (`replace`) pro vyříznutí z názvu — **jen když `rec || bareWd`**.

### Token highlighting — `nameSegments(raw, hits)` (ř. 2403)
```js
nameSegments(raw, hits){
  raw=raw||''; if(!raw) return [{text:'', mark:false}];
  const low=raw.toLowerCase(); const ranges=[];
  const taken=(a,b)=> ranges.some(r=> a<r.e && b>r.s);            // překryv?
  (hits||[]).forEach(h=>{ const t=(h.t||'').toLowerCase().trim(); if(!t) return;
    let from=0,idx;
    while((idx=low.indexOf(t,from))!==-1){
      if(!taken(idx,idx+t.length)){ ranges.push({s:idx,e:idx+t.length}); break; }
      from=idx+1; } });                                          // první NEpřekrytý výskyt
  ranges.sort((a,b)=>a.s-b.s);
  const segs=[]; let pos=0;
  ranges.forEach(r=>{ if(r.s>pos) segs.push({text:raw.slice(pos,r.s),mark:false});
                      segs.push({text:raw.slice(r.s,r.e),mark:true}); pos=r.e; });
  if(pos<raw.length) segs.push({text:raw.slice(pos),mark:false});
  if(!segs.length) segs.push({text:raw,mark:false});
  return segs;
}
```
- Vstup: **původní `rawName`** (přesně co uživatel napsal) + `hits` (rozpoznané tokeny).
- Pro každý token najde **první nepřekrývající** výskyt v `raw` (case-insensitive), zapíše rozsah.
- Výsledek: pole segmentů `{text, mark}`. `mark:true` = zvýrazněná (rozpoznaná) část.
- **Render** (šablona ř. 1680): překryvná `<div>` přes `<textarea>`; segmenty s
  `data-nmark="true"` dostanou brass podsvícení. CSS (ř. 68):
  ```css
  [data-nmark="true"]{ background:var(--brass-soft); border-radius:5px;
                       box-shadow:0 0 0 2px var(--brass-soft); }
  ```
- **Důležité:** zvýraznění je nad `rawName` (živý editor zůstává nedotčený — uživatel pořád vidí
  a edituje to, co napsal). Rozpoznaná část zmizí jen z **výsledného názvu** (`cleanName`/`name`),
  ne z editoru. Token highlighting je čistě vizuální overlay.

### Dva názvy: `liveName` vs `cleanName`
- `liveName` = `base` (po vyříznutí dat/opakování) ale **s @/+ tokeny stále uvnitř**.
- `cleanName` = `liveName` bez `@osoba`/`+osoba` tokenů. Tohle je finální název úkolu.
- V `draftName` (ř. 2395): `name = patch.cleanName ?? v`. Tedy zobrazený/uložený název = `cleanName`.
- **Proč @/+ NEjsou v `cleanName`, ale `#` ano (resp. je vyříznut)?** `#X` se vyřízne z `work`
  hned v §10 (přes `cut`), takže do `base` nejde. `@/+` se z `work` NEvyřezávají (jen se sbírají
  do hits), proto se odstraňují až zvlášť ve `cleanName`. Důvod: našeptávač osob potřebuje token
  v `rawName` zachovat dokud uživatel nevybere (viz §14).

- **Implementace (TS):**
  - `nameSegments` přepsat 1:1 (čistá funkce). Pozor na unicode `toLowerCase` (cs).
  - Overlay-highlight řešit přes řízený `contenteditable`/textarea + absolutně pozicovaný mirror,
    přesně jak prototyp. Nebo segmentový render do `<mark>`.
  - Sjednotit pravidla vyřezávání: ideálně VŠECHNY tokeny (#, @, +, datum, p1…) řešit jednotně
    přes `hits` s rozsahy a z názvu odstranit podle rozsahů, ne dvojím regexem (prototyp má
    `cleanName` regex i `submitTask` fallback regex — viz §16, je to duplicitní).

---

## 13. `czNum(str)` — slovní číslovky pro čas/trvání (ř. 2049–2059) — VERBATIM

Mapuje české **základní číslovky** (nominativ i pádové tvary) na čísla. Použito pro čas (§4d)
a trvání (§5b/5c/5f).

```js
const tens={'dvacet':20,'dvaceti':20,'třicet':30,'třiceti':30,'tricet':30,'triceti':30,
            'čtyřicet':40,'čtyřiceti':40,'ctyricet':40,'padesát':50,'padesáti':50,'padesat':50,
            'šedesát':60,'šedesáti':60,'sedesat':60,'sedesati':60};
const teens={'deset':10,'deseti':10,'desíti':10,'jedenáct':11,'jedenácti':11,'dvanáct':12,
             'dvanácti':12,'třináct':13,'třinácti':13,'čtrnáct':14,'čtrnácti':14,'patnáct':15,
             'patnácti':15,'patnact':15,'šestnáct':16,'šestnácti':16,'sedmnáct':17,'sedmnácti':17,
             'osmnáct':18,'osmnácti':18,'devatenáct':19,'devatenácti':19};
const ones={'nula':0,'jedna':1,'jeden':1,'jednu':1,'jedné':1,'dva':2,'dvě':2,'dve':2,'dvou':2,
            'tři':3,'tří':3,'tri':3,'čtyři':4,'čtyř':4,'ctyri':4,'pět':5,'pěti':5,'pet':5,'peti':5,
            'šest':6,'šesti':6,'sest':6,'sedm':7,'sedmi':7,'osm':8,'osmi':8,'devět':9,'devíti':9,'devet':9};
```
**Algoritmus (ř. 2053–2058):**
```js
const w=s.split(/\s+/);
if(w.length>=2 && tens[w[0]]!=null && ones[w[1]]!=null) return tens[w[0]]+ones[w[1]];  // "dvacet jedna"=21
for(const x of w){ if(teens[x]!=null) return teens[x]; }   // teens mají přednost (10–19)
for(const x of w){ if(tens[x]!=null) return tens[x]; }      // pak desítky (20,30,...)
for(const x of w){ if(ones[x]!=null) return ones[x]; }      // pak jednotky
return null;
```
- **Složené:** „dvacet jedna" = 20+1 (jen vzor `[tens][ones]`, dvouslovné). Pořadí lookupů:
  composite → teens → tens → ones.
- **Rozsah:** prakticky 0–69 (tens jen do 60, + ones). Pro čas se navíc filtruje `<=23`.
- **Diakritika:** klíče jak s diakritikou, tak bez (`třicet`/`tricet`). Vstup `.toLowerCase().trim()`.

> **Pozor:** Tohle je tabulka **základních** číslovek (jedna, dva, deset, dvacet…). Pro
> **řadové** číslovky (prvního, druhého, dvacátého…) je samostatná funkce `dayFromGen` (§15).
> Nepleť si je.

- **Implementace (TS):** přepsat jako čistou funkci s `Record<string,number>`. Zvážit doplnění
  „sedmdesát/osmdesát/devadesát" (chybí) a stovek, pokud bude potřeba delší trvání. Normalizovat
  diakritiku přes `.normalize('NFD')` místo ručních duplicит — ALE pozor, klíče s/bez diakritiky
  jsou tu vědomé kvůli překlepům bez háčků, takže lepší držet obě varianty nebo fold + obě.

---

## 14. Našeptávač `#projekt` / `@osoba` / `+osoba` (ř. 2390–2402)

Toto je **interaktivní** našeptávač (na rozdíl od exact-match v §10). Žije v `draftName` (handler
psaní do textarea) a triggeruje se jen když token je **na konci** vstupu (právě se píše).

### `draftName(e)` — detekce na konci textu (ř. 2390–2395)
```js
draftName = (e) => {
  const v=e.target.value;
  const patch=this.parseQuick(v);                 // vždy přeparsuj
  let suggest=null;
  const mPer  = v.match(/[@+](\p{L}{1,})$/u);      // @X nebo +X NA KONCI
  const mProj = v.match(/#(\p{L}{1,})$/u);         // #X NA KONCI
  if(mPer){
    const q=mPer[1].toLowerCase();
    const list=this.PEOPLE
      .filter(p=> p.name.toLowerCase().includes(q) || p.initials.toLowerCase().startsWith(q))
      .slice(0,5)
      .map(p=>({ id:p.id, isPerson:true, initials:p.initials, name:p.name,
                 action:'přiřadit ↵', onClick:this.pickSuggest(p.id, mPer[0]) }));
    if(list.length) suggest={ list };
  } else if(mProj){
    const q=mProj[1].toLowerCase();
    const list=this.PROJECTS.filter(p=>this.inWS(p))            // jen aktuální workspace!
      .filter(p=> p.name.toLowerCase().includes(q))
      .slice(0,6)
      .map(p=>({ id:p.id, isProj:true, name:p.name,
                 action:'projekt ↵', onClick:this.pickProject(p.id, mProj[0]) }));
    if(list.length) suggest={ list };
  }
  this.setState(s=>({ addDraft:Object.assign(this.freshDraft(), s.addDraft||{}, patch,
    { rawName:v, name:(patch.cleanName!=null?patch.cleanName:v), suggest, suggestIdx:0 }) }));
};
```
- **Osoby (`@`/`+`):** match jen na **konci** vstupu. Filtr: jméno obsahuje `q` **nebo** iniciály
  začínají `q`. Max 5. Akce „přiřadit ↵".
- **Projekty (`#`):** match na konci. Filtr: `inWS(p)` (jen projekty aktivního workspace) **a**
  název obsahuje `q` (částečná shoda, ne exact!). Max 6. Akce „projekt ↵".
- `inWS(p)` (ř. 2321): `this.wsOf(p) === this.state.activeWs`.
- Pokud `q` prázdné nebo žádný match → `suggest=null`, žádný panel.
- `suggestIdx` se resetuje na 0 při každém psaní.

### Klávesová navigace `onNameKey(e)` (ř. 2396–2400)
```js
if(!sug||!sug.list||!sug.list.length) return;   // bez panelu nech default (Enter = nový řádek? ne)
const n=sug.list.length; const i=d.suggestIdx||0;
ArrowDown → suggestIdx=(i+1)%n;  preventDefault
ArrowUp   → suggestIdx=(i-1+n)%n; preventDefault
Enter     → vyber sug.list[i] (zavolá it.onClick); preventDefault
Escape    → suggest=null; preventDefault
```
- Šipky cyklí (modulo). Enter potvrdí zvýrazněnou položku. Esc zavře panel (text zůstane).
- Když panel není otevřený, handler nedělá nic (default chování textarea).

### Výběr osoby `pickSuggest(pid, token)` (ř. 2401)
```js
pickSuggest = (pid, token) => () => this.setState(s=>{
  const d=Object.assign(this.freshDraft(), s.addDraft||{});
  const raw=d.rawName||'';
  const idx=raw.lastIndexOf(token);                          // najdi @X od konce
  const nraw=(idx>=0?raw.slice(0,idx):raw).replace(/\s+$/,'')+' ';   // uřízni token + trailing ws, přidej mezeru
  const patch=this.parseQuick(nraw);                         // přeparsuj nový raw
  const assignees=d.assignees.includes(pid)?d.assignees:d.assignees.concat(pid);  // přidej osobu (idempotentně)
  const assignMode=assignees.length>=2?d.assignMode:'any';   // <2 lidi → vždy 'any'
  return { addDraft:Object.assign({},d,patch,{ rawName:nraw,
    name:(patch.cleanName!=null?patch.cleanName:nraw), assignees, assignMode, suggest:null }) };
});
```
- **Token (`@X`/`+X`) se z `rawName` odstraní** (uřízne od `lastIndexOf` do konce) a osoba se
  přidá do `assignees`. Panel se zavře.
- `assignMode` zůstane `any` dokud nejsou ≥2 lidé.

### Výběr projektu `pickProject(pid, token)` (ř. 2402)
- Stejná mechanika jako `pickSuggest`, ale místo `assignees` nastaví `project:pid`.
- Token `#X` se z `rawName` odstraní.

> **Shrnutí chování dle README/CLAUDE.md:** „`#X` → našeptávač projektů (šipky+Enter), bez
> auto-přiřazení dokud nevybereš" — sedí: panel ukazuje kandidáty, ale `project` se nastaví až
> v `pickProject`. (Výjimka: `parseQuick` §10 nastaví `project` okamžitě **jen na přesnou shodu
> celého názvu** — to je „zkratka", panel se stejně ukáže taky.) „`@X`/`+X` → po výběru se token
> z názvu odstraní a osoba přiřadí" — sedí přesně.

- **Implementace (TS):**
  - Detekce tokenu „na konci" přes regex s `$` — zachovat.
  - Pro projekty respektovat workspace scope (`inWS`).
  - Idempotentní přidání osoby; `assignMode='any'` dokud <2 lidi.
  - Po výběru: odstranit token z rawName přes `lastIndexOf` a přeparsovat (nebo lépe: držet
    strukturovaný model tokenů a nepřeparsovávat celý string).
  - Pozn.: prototyp i `+` i `@` chovají identicky (oba = přiřazení osoby). README to potvrzuje.

---

## 15. `dayFromGen(s)` — řadové číslovky pro den v měsíci (ř. 2063–2072) — VERBATIM

Použito v `parseRecurrence` větvi C (§11) pro „každého **dvacátého pátého** v měsíci" apod.
Rozeznává **řadové** číslovky v genitivu (koncovky -ého/-ího/-eho/-iho).

```js
const U={'prvn':1,'druh':2,'třet':3,'tret':3,'čtvrt':4,'ctvrt':4,'pát':5,'pat':5,
         'šest':6,'sest':6,'sedm':7,'osm':8,'devát':9,'devat':9};      // jednotky 1–9
const T={'dvacát':20,'dvacat':20,'třicát':30,'tricat':30};              // desítky 20,30
const D={'desát':10,'desat':10,'jedenáct':11,'jedenact':11,'dvanáct':12,'dvanact':12,
         'třináct':13,'trinact':13,'čtrnáct':14,'ctrnact':14,'patnáct':15,'šestnáct':16,
         'sestnact':16,'sedmnáct':17,'sedmnact':17,'osmnáct':18,'osmnact':18,
         'devatenáct':19,'devatenact':19};                              // 10–19
const end='(?:ého|ího|eho|iho)';                                        // řadová koncovka v gen.
```
**Algoritmus (ř. 2068–2071):**
```js
// 1) desítky (20/30) + volitelně jednotka: "dvacátého pátého" = 25
for(const t in T){ if(new RegExp(t+end).test(s)){
  let v=T[t];
  for(const u in U){ if(new RegExp(t+end+'\\s+'+u+end).test(s)){ v+=U[u]; break; } }
  return v; } }
// 2) teens 10–19
for(const d in D){ if(new RegExp(d+end).test(s)){ return D[d]; } }
// 3) samotné jednotky 1–9 (s lookbehind „není písmeno")
for(const u in U){ try{
  if(new RegExp('(?<![\\p{L}])'+u+end,'u').test(s)){ return U[u]; }
}catch(e){ if(new RegExp(u+end).test(s)){ return U[u]; } } }
return null;
```
- **Složené desítky:** „dvacátého pátého" → `T['dvacát']=20` + `U['pát']=5` = 25. Vzor:
  `<desítka>ého <jednotka>ého`.
- **teens:** „patnáctého" = 15 (přes D, ale pozor — D klíče jsou bez koncovky `-ého`, ta se
  přidává v regexu; „patnáctého" = `patnáct`+`ého`). U `D` jsou některé klíče už delší
  (`šestnáct`), ale princip `klíč+end` platí.
- **jednotky:** „pátého" = 5, s lookbehind aby `dvacátého` (končí na `átého`) nechytlo `pát`+`ého`
  uvnitř (ochrana proti falešné shodě).
- Vrací 1–39 (max 30+9). V `parseRecurrence` se to chápe jako `day` (1–31) měsíce.

> **Rozdíl od `czNum` (§13):** `czNum` = ZÁKLADNÍ číslovky (pět, deset, dvacet) → čas/trvání.
> `dayFromGen` = ŘADOVÉ číslovky v genitivu (pátého, desátého, dvacátého) → den v měsíci u
> opakování. Dvě oddělené tabulky, vědomě.

- **Implementace (TS):**
  - Přepsat jako čistou funkci `ordinalDayFromCzech(s): number|null`.
  - Lookbehind pro jednotky zachovat (jinak false-positive). Pro prostředí bez lookbehind je
    catch fallback (méně přesný).
  - Zvážit doplnění „prvého" (jen „prvn"+ého = „prvního", ale hovorové „prvého" má jiný kmen).

---

## 16. `resolveDate(d)` — termín draftu → bucket úkolu (ř. 2430–2445)

Mapuje `dateKind`/`customDate` draftu na pole úkolu (`group`, `day`, `date`, `iso`, `due`,
`inbox`, `overdue`). Volá se v `submitTask`.

```js
resolveDate(d){
  const K=d.dateKind;
  if(K==='none')   return { inbox:true, group:'inbox', day:'inbox', date:null, iso:null, due:null };
  if(K==='zitra')  return { group:'upcoming', day:'zitra',  date:26, iso:'2026-06-26', due:'zítra' };
  if(K==='pristi') return { group:'upcoming', day:'pristi', date:29, iso:'2026-06-29', due:'příští týden' };
  if(K==='pmonth') return { group:'upcoming', day:'pmonth', date:null, iso:'2026-07-01', due:'1. července' };
  if(K==='custom' && d.customDate){
    const [y,m,da]=d.customDate.split('-').map(Number);
    const cur=2026*372+6*31+25, val=y*372+m*31+da;            // umělé „lineární" datum pro porovnání
    let group='upcoming', date=null, overdue=false;
    if(y===2026&&m===6&&da>=22&&da<=28) date=da;              // legacy červen-den jen pro okno 22–28
    if(val<cur){ group='overdue'; overdue=true; } else if(val===cur){ group='today'; }
    return { group, day:'custom', date, iso:d.customDate,
             due: group==='today'?null:(da+'. '+m+'. '+y), overdue };
  }
  return { group:'today', day:'dnes', date:25, iso:'2026-06-25', due:null };   // default = dnes
}
```
- **`dateKind` možnosti:** `none` (schránka/inbox), `zitra`, `pristi`, `pmonth`, `custom`, jinak
  default `dnes`.
- **`val`/`cur` porovnání:** umělé „číslo data" `y*372 + m*31 + da` (372 = 12*31) → monotónní
  porovnání bez `Date`. Tím se rozhodne overdue / today / upcoming.
- **Legacy `date` (22–28):** nastaví se jen pro červen 2026 v okně 22.–28. (kvůli starým
  seznamovým komponentám, jinak `null`). Reálné datum nese `iso`.
- **`due` label:** pro today `null`, jinak `d. m. rrrr` (vč. roku) nebo lidsky („zítra", „příští
  týden", „1. července").

> **`termISO(d)` (ř. 2079)** — varianta používaná v draftu pro validaci deadline:
> ```js
> termISO(d){ const map={dnes:'2026-06-25',zitra:'2026-06-26',pristi:'2026-06-29',pmonth:'2026-07-01'};
>   if(d.dateKind==='none') return null;
>   if(d.dateKind==='custom') return d.customDate||null;
>   return map[d.dateKind]||'2026-06-25'; }
> ```
> Vrací čistý ISO termín. Slouží k porovnání s deadline (deadline nesmí být PŘED termínem).

- **Implementace (TS):**
  - Zahodit `val/cur` trik i legacy `date` 22–28 — používat reálné `Date`/ISO porovnání:
    `iso < today → overdue`, `iso === today → today`, jinak `upcoming`.
  - `due` label generovat z reálné lokalizace (Intl) — „zítra/příští týden/1. července".
  - `group`/`day` bucket sjednotit s `_bucketISO` (ř. 2644), který už počítá z reálného „dneška":
    `<today→overdue`, `===today→today/dnes`, `+1→zitra`, jinak `pristi`.

---

## 17. Guard prázdného názvu (ř. 2982–2985, 1882–1883)

V `draftView` se počítají dvě sady flagů:

### `needsName` / `hasName` (ř. 2983–2984) — varovná hláška
```js
needsName: ((d.name||'').trim().length===0)
  && (d.repeat!=='none'
      || (d.dateKind && d.dateKind!=='dnes' && d.dateKind!=='inbox')
      || !!d.time || (d.duration||0)>0 || (d.assignees||[]).length>0),
hasName: !needsName,
```
- `needsName` = **true** když název je prázdný **a zároveň** uživatel už nastavil něco smysluplného
  (opakování / netriviální termín / čas / trvání / přiřazení).
- Tedy: pokud uživatel jen otevřel přidávání (default `dnes`, P2, bez ničeho) a nepsal, hláška
  se NEukáže. Ukáže se, až když „rozparsoval" pole, ale zapomněl napsat co se má udělat.
- **Šablona (ř. 1882):** červená hláška „Úkol potřebuje název — napiš, co se má udělat. Datum a
  opakování zůstanou nastavené." Jinak (ř. 1883) nápověda se syntaxí (#projekt, p1–p4, 14:00,
  3. 7. 2027, !5. 7. deadline, @jméno).

### `canSubmit` / `cantSubmit` (ř. 2985) — povolení tlačítka
```js
canSubmit: (d.name||'').trim().length>0
  && !( !!(d.deadline && this.termISO(d) && d.deadline < this.termISO(d)) ),
cantSubmit: (d.name||'').trim().length===0
  || !!(d.deadline && this.termISO(d) && d.deadline < this.termISO(d)),
```
- Tlačítko „Přidat úkol" je aktivní jen když:
  1. **Název po trimu není prázdný**, A
  2. **Deadline není před termínem** (`deadline < termISO` = chyba; `deadlineBad`, ř. 2949).
- `data-dis="{{ draft.cantSubmit }}"` (ř. 1885) → vizuálně zašedlé.

### Hard guard v `submitTask` (ř. 2449)
```js
const raw=(d.name||'').trim(); if(!raw){ return; }   // bez názvu vůbec nevytvoří
```
- I kdyby UI propustilo, `submitTask` na prázdný název **nic neudělá** (early return).

> **Pravidlo z README/CLAUDE.md:** „Úkol nelze vytvořit, pokud po vytažení formulí zůstane
> prázdný název." — Implementováno trojitě: varovná hláška (`needsName`), zakázané tlačítko
> (`cantSubmit`), early-return v submitu.

- **Implementace (TS):**
  - Validace: `name.trim().length > 0` (po odečtení tokenů!) **a** `!deadlineBad`.
  - `deadlineBad = deadline && termISO && deadline < termISO`.
  - Hlášku ukazovat jen když uživatel už něco naparsoval (ne hned po otevření) — zachovat
    `needsName` heuristiku.

---

## 18. `submitTask()` — sestavení finálního úkolu (ř. 2447–2474)

Pro úplnost dokumentuji jak parser-výstup → entita úkolu (relevantní pro pole, ne UI).

### Finální název (ř. 2450) — fallback regex čištění
```js
const name = ((d.cleanName!=null && d.cleanName.trim()) ? d.cleanName.trim() : raw
  .replace(/!\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{0,4}/g,'')        // deadline
  .replace(/[@+]\p{L}+/gu,'')                                // osoby
  .replace(/#\p{L}+/gu,'')                                   // projekt
  .replace(/\bp[1-4]\b/ig,'')                                // priorita
  .replace(/(\d+)\s*dn\w*/ig,'')                             // dny
  .replace(/(\d+)\s*min\w*/ig,'')                            // minuty
  .replace(/(\d+(?:[.,]\d+)?)\s*(?:hod\w*|h)\b/ig,'')        // hodiny
  .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g,'')               // čas
  .replace(/\b\d{1,2}\.\s*\d{1,2}\.\s*\d{0,4}/g,'')          // datum
  .replace(/\bz[íi]tra\b/ig,'').replace(/\bdnes\b/ig,'')     // zítra/dnes
  .replace(/\s{2,}/g,' ').trim()) || raw;
```
- **Primárně** se použije `cleanName` (z parseru). Fallback regex je záloha, kdyby `cleanName`
  chyběl/byl prázdný. Pokud i fallback vyčistí na prázdno → použije se `raw` (aby úkol měl aspoň
  něco). **Tohle je duplicitní logika k `parseQuick` §12** — viz Implementace.

### Mapování pole→úkol (ř. 2451–2467, výběr)
| Draft pole | Úkol pole | Logika |
|---|---|---|
| `resolveDate(d)` | `group,day,date,iso,inbox,overdue` | §16 |
| `time` (`HH:MM`) | `start` (min) + `end` | `start=H*60+M`; `end=min(1440, start+(duration||30))` (ř. 2462) |
| `duration` | (do `end`) | default 30 min když `time` ale bez duration |
| `days>1` | `days`, `endDate`, `isoEnd`, `dueLabel` | `endDate=min(30,date+days-1)`; `isoEnd=iso+(days-1)` (ř. 2466) |
| `assignees` + `assignMode` | `people`, `assignMode` | `mode='any'` pokud <2 lidi (ř. 2455) |
| `assignMode==='all'` | `aTotal,peopleDone,aDone` | per-osoba odškrtávání (ř. 2467) |
| `repeat!=='none'` | `recurring,repeat,repeatRule,repeatLabel,repeatEndKind,repeatUntil/Count,repeatShowAll` | ř. 2464 |
| `color` (≠none) | `color` | ř. 2457 |
| `deadline` | `deadlineLabel` | `deadlineFmt(d.deadline)` (ř. 2458) |
| `attached[]` | `attachments` (count) | ř. 2459 |
| `flowAttach` | `flowId,flowName,stepIndex/Total,stepStatus,gate` | připojení do postupu (ř. 2471) |

- `deadlineFmt(iso)` (ř. 2078): `'do '+da+'. '+m+'.'+(y!==2026?(' '+y):'')` → „do 5. 7." nebo
  „do 5. 7. 2027".
- `durFmt(min)` (ř. 2080): <60 → „N min"; jinak „H h" (+„ M min").

- **Implementace (TS):**
  - **Odstranit duplicitní fallback regex** — `cleanName` z parseru má být jediný zdroj. Pokud
    parser a submit používají různá pravidla čištění, hrozí nekonzistence (parser §12 nečistí
    `#` ze základny stejně jako submit). Sjednotit do jedné funkce `stripTokens(raw, hits)`.
  - `start/end` v minutách od půlnoci; default trvání 30 min konfigurovatelné.
  - Pole opakování (konec: never/until/count, showAll) řešit dle modelu výskytů (samostatný spec).

---

## 19. `freshDraft()` — výchozí stav draftu (ř. 1920) — VERBATIM

```js
freshDraft(){ return {
  name:'', rawName:'', hits:[], desc:'',
  project:'q3',                 // default projekt = Q3 plánování (POZOR: ne podle workspace)
  priority:2,                   // default P2
  assignees:[], assignMode:'any',
  dateKind:'dnes', customDate:'', time:'', duration:0,
  repeat:'none', repeatRule:null, repeatLabel:'',
  repeatEndKind:'never', repeatUntil:'', repeatCount:10, repeatShowAll:true,
  color:'none', deadline:'', attached:[],
  suggest:null, suggestIdx:0, days:1,
  projOpen:false, projQuery:'', flowAttach:'', pop:'', more:false, descOpen:false
}; }
```
- **Defaulty:** projekt `q3`, priorita `2`, termín `dnes`, bez opakování, konec opakování
  `never`, `repeatCount=10`, `days=1`.
- **`project:'q3'` natvrdo** — v produkci by default měl respektovat aktivní workspace / kontext
  (otevření z projektu by mělo předvyplnit ten projekt).

---

## 20. `draftView()` — datový model pro UI draftu (ř. 2937–3003)

Sestaví všechny props pro render přidávacího modalu. Klíčové odvozeniny (mimo to, co už pokryto):

### Pilulky atributů (`addFields` / `addFieldsMore`, ř. 2966–2979)
`mkF(key,label,icon,value,on,dot,sw)` vytváří pilulku:
```js
mkF=(key,label,icon,value,on,dot,sw)=>({ key,label, disp:value||label, on:!!on,
  dot:dot||null, sw:sw||null, useIcon:(!dot&&!sw), icon:this.wIcon(icon,16),
  onClick:this.setAddPop(key) });
```
- **Hlavní řada (`addFields`):** Projekt (s barevnou tečkou `sel.id`), Termín, Priorita, Přiřadit.
- **„Více" řada (`addFieldsMore`):** Trvání, Deadline, Opakování, Barva (se vzorkem barvy `sw`),
  Příloha, [Postup — jen když existují postupy].
- `on` = pilulka „aktivní" (má hodnotu jinou než default). `disp` = hodnota nebo název.
- `setAddPop(key)` (ř. 1955) togglne popover daného atributu (`pop`), klik na otevřený zavře.

### Hodnoty pilulek (ř. 2960–2975) — jak se formátují
| Pilulka | `disp` logika | Aktivní když |
|---|---|---|
| Projekt | `sel.name` | vždy (`on:true`) |
| Termín | `termLbl` (Dnes/Zítra/Příští týden/`deadlineFmt(customDate)`; +` · čas`; +` · N dní`) | `dateKind && ≠inbox` |
| Priorita | `'P'+d.priority` | `priority!==2` |
| Přiřadit | `peopleVal` (jméno 1 osoby / „N lidí" / null) | `npc>0` |
| Trvání | `durFmt(d.duration)` | `duration>0` |
| Deadline | `deadlineFmt(d.deadline)` bez „do " | `!!deadline` |
| Opakování | `repeatLabel \|\| repLbl` | `repeat≠none` |
| Barva | „Moje barva" + vzorek | `color≠none` |
| Příloha | `N×` | `attached.length>0` |
| Postup | „Přidáno" | `!!flowAttach` |

### `richActive` / `repeatRichLabel` (ř. 2951–2953)
```js
const richActive = !!(d.repeatRule && (d.repeatRule.weekday!=null || d.repeatRule.day!=null
  || d.repeatRule.nth!=null || d.repeatRule.kind==='yearly'));
```
- Když opakování má strukturovaný rule (konkrétní den / n-tý / parita / yearly), UI zobrazí
  bohatý `repeatLabel` místo prosté pilulky. Pilulky Neopakovat/Denně/Týdně/Po 14 dnech/Měsíčně
  jsou `on` jen když `repeat===k && !richActive` (ř. 2952).

### Datum chips + deadline validace (ř. 2947–2949)
```js
const dsub={dnes:'25. 6.',zitra:'26. 6.',pristi:'29. 6.',pmonth:'1. 7.',none:'—'};
const dateChips=[['dnes','Dnes'],['zitra','Zítra'],['pristi','Příští týden'],
  ['pmonth','Začátkem příštího měsíce'],['none','Bez termínu']].map(...);
const tISO=this.termISO(d);
const deadlineBad = !!(d.deadline && tISO && d.deadline < tISO);   // deadline před termínem = chyba
```

### Trvání chips (ř. 2950)
`[[0,'—'],[15,'15 min'],[30,'30 min'],[60,'1 h'],[120,'2 h']]` + manuální input (`durationManual`,
clamp 0–10080 min).

### `nameSegs` (ř. 2981)
`nameSegs: this.nameSegments(d.rawName||'', d.hits||[])` — viz §12. Token highlighting overlay.

### `suggest` (ř. 3000)
```js
suggest: (d.suggest && d.suggest.list)
  ? { list:d.suggest.list.map((it,i)=>Object.assign({}, it, { active:i===(d.suggestIdx||0) })) }
  : d.suggest,
hasSuggest: !!(d.suggest && d.suggest.list && d.suggest.list.length),
```
- Označí aktivní položku našeptávače (`active` = index === suggestIdx) pro zvýraznění.

- **Implementace (TS):** `draftView` je čistá projekce stavu draftu → view-model. V Reactu to
  může být `useMemo` nebo selektory. Klíčové je zachovat: `richActive` rozlišení, deadline
  validaci, formátování pilulek a `active` flag našeptávače.

---

## 21. Pomocné funkce datumů opakování (ř. 2060–2077) — referenční, počítané z `recBase()`

| Funkce | Řádek | Co dělá |
|---|---|---|
| `recBase()` | 2073 | `new Date(2026,5,25)` (čt 25.6.2026) — základ všeho |
| `recISO(d)` | 2074 | `Date` → `YYYY-MM-DD` lokálně |
| `weekdayDate(wd, weeksAhead)` | 2060 | Nejbližší **budoucí** výskyt dne `wd` (dnes→příští týden), +N týdnů. „add===0 → 7". |
| `weekdayParityISO(wd, parity)` | 2061 | Nejbližší budoucí `wd`, ale posunutý tak, aby ISO týden měl správnou paritu (even=sudý=`isoWeek%2===0`, odd=lichý=1). Když nesedí, +7 dní. |
| `isoWeek(dt)` | 2062 | ISO 8601 číslo týdne (čtvrtek-pravidlo, UTC výpočet). |
| `nextWeekdayISO(wd)` | 2075 | Nejbližší `wd` **včetně dneška** (`add` bez „===0→7"). Pozn.: jiné než `weekdayDate`! |
| `nthWeekdayISO(nth, wd)` | 2076 | N-tý výskyt dne `wd` v měsíci (nth=-1 = poslední). Hledá v aktuálním měsíci; když už prošel / neexistuje, bere příští měsíc. |
| `nextMonthDayISO(day)` | 2077 | Nejbližší `day`-tý den v měsíci ≥ dneška (clamp na délku měsíce). |

### `weekdayParityISO` detail (parita sudý/lichý týden)
```js
weekdayParityISO(wd, parity){
  const d=this.recBase(); let add=(wd-d.getDay()+7)%7; if(add===0) add=7;
  d.setDate(d.getDate()+add);                          // nejbližší budoucí wd
  const want=(parity==='even')?0:1;                    // even→sudé ISO číslo, odd→liché
  if((this.isoWeek(d)%2)!==want){ d.setDate(d.getDate()+7); }  // posun o týden když nesedí
  return this.recISO(d); }
```
- „sudý čtvrtek" = čtvrtek v týdnu se sudým ISO číslem. „lichý" = liché.

### `nthWeekdayISO` detail
```js
nthWeekdayISO(nth, wd){
  const b=this.recBase();
  const find=(y,m)=>{
    if(nth===-1){ let dd=new Date(y,m+1,0).getDate();      // poslední den měsíce
                  while(new Date(y,m,dd).getDay()!==wd) dd--; return new Date(y,m,dd); }
    let c=0; for(let dd=1;dd<=31;dd++){ const dt=new Date(y,m,dd);
      if(dt.getMonth()!==m) break; if(dt.getDay()===wd && ++c===nth) return dt; }
    return null; };
  let dt=find(b.getFullYear(),b.getMonth());
  if(!dt||dt<b){ const n=new Date(b.getFullYear(),b.getMonth()+1,1); dt=find(n.getFullYear(),n.getMonth()); }
  return dt?this.recISO(dt):null; }
```
- Vrací první budoucí výskyt n-tého `wd`. Pro „poslední" jde od konce měsíce zpět.

- **Implementace (TS):** všechny přepsat na reálné `today` místo `recBase()`. Zachovat sémantiku
  „nejbližší budoucí" (`weekdayDate` přeskakuje dnešek, `nextWeekdayISO` ne — **pozor na ten
  rozdíl**, prototyp používá `weekdayDate` pro holý den i pro „každou středu" start). Pro paritu
  ISO-týdne použít robustní ISO-week funkci (např. date-fns `getISOWeek`).

---

## 22. Souhrn: úplný seznam zachycených pravidel

| # | Pravidlo | Trigger | Pole | Sekce |
|---|---|---|---|---|
| 1 | Deadline | `!d. m. [rrrr]` | `deadline` | §2 |
| 2 | Priorita | `p1`–`p4` | `priority` | §3 |
| 3 | Čas (HH:MM) | `14:00`, `v 15:00`, `od 14.00` | `time` | §4a/b |
| 4 | Čas (celé hod) | `v 15 hodin`, `od 9 hodin` | `time` (:00) | §4c |
| 5 | Čas (slovem) | `v patnácti hodin` | `time` | §4d |
| 6 | Trvání (min) | `90 min`, `po dobu 90 minut` | `duration` | §5a |
| 7 | Trvání (min slovem) | `šedesát minut`, `po dobu šedesáti minut` | `duration` | §5b/c |
| 8 | Trvání (půl h) | `půl hodiny` | `duration=30` | §5d |
| 9 | Trvání (hod desetinné) | `1.5 h`, `2 hodiny`, `1,5 hod` | `duration` | §5e |
| 10 | Trvání (hod slovem) | `po dobu dvou hodin` | `duration` | §5f |
| 11 | Vícedenní | `4 dny`, `3 dní` | `days` (1–60) | §6 |
| 12 | Datum explicitní | `3. 7. 2027`, `5. 7.` | `dateKind=custom`,`customDate` | §7a |
| 13 | Datum relativní | `dnes` / `zítra` / `pozítří` | `dateKind` | §7b/c/d |
| 14 | Holý den v týdnu | `pondělí` → nejbližší budoucí | `customDate` | §9 |
| 15 | „příští" den | `příští pondělí` → +1 týden | `customDate` | §9 |
| 16 | Projekt (exact + našeptávač) | `#Obchod` | `project` | §10, §14 |
| 17 | Osoba (našeptávač) | `@Jméno` / `+Jméno` | `assignees` | §14 |
| 18 | Opak. denně | `denně` / `každý den` | `repeat=daily` | §11 A/D |
| 19 | Opak. týdně | `týdně` / `každý týden` | `repeat=weekly` | §11 A/D |
| 20 | Opak. měsíčně | `měsíčně` / `každý měsíc` | `repeat=monthly` | §11 A/D |
| 21 | Opak. ročně | `ročně` / `každý rok` | `repeat=yearly` | §11 A/D |
| 22 | Opak. den v týdnu | `každou středu`, `každé úterý` | `weekly`+`weekday` | §11 B |
| 23 | Opak. po 14 dnech | `každou druhou středu`, `každé 2 týdny` | `biweekly` | §11 B/D |
| 24 | Opak. n-tý v měsíci | `každé první úterý v měsíci`, `poslední pátek v měsíci` | `monthly-nth` | §11 B |
| 25 | Opak. den v měsíci | `každého 25. v měsíci`, „dvacátého pátého" | `monthly-day` | §11 C |
| 26 | Opak. sudý/lichý | `každý sudý čtvrtek`, `každý lichý čtvrtek` | `biweekly`+`parity` | §11 B |
| 27 | Token highlighting | (overlay nad rawName) | `hits`,`nameSegs` | §12 |
| 28 | Guard prázdného názvu | (validace) | `needsName`,`cantSubmit` | §17 |

---

## 23. Vědomě zjednodušené (prototyp) vs. zamýšlené chování

Z README sekce „Co je vědomě zjednodušené" + z kódu:

| Zjednodušení v prototypu | Zamýšlené (produkce) |
|---|---|
| Vše počítáno od fixního „dneška" 25.6.2026 (`recBase`) | Reálné `now()` / timezone uživatele |
| `pozítří` → hardcoded `2026-06-27` | `today + 2 dny` |
| `zítra`/`dnes` přes symbolický kind, mapováno v `termISO` | `today + 1` / `today` |
| Legacy `date` (červen-den 22–28) paralelně s `iso` | Jen ISO datum (`Date`/`Temporal`) — README: „zobrazení už je na ISO", drag-drop/multi-day stále legacy |
| Default rok dat = 2026 natvrdo | Aktuální rok; minulé datum bez roku → příští rok? |
| Validace data jen 1–12 / 1–31 (bez délky měsíce, `31.2.` projde) | Reálná validace délky měsíce |
| `cleanName` čištění duplikováno v `parseQuick` i `submitTask` (různé regexy) | Jediná funkce `stripTokens(raw, hits)` |
| Dvě skoro stejné weekday tabulky (`WD2` §9 vs `WD` §11) | Jedna sdílená tabulka |
| `czNum` jen do ~69; `dayFromGen` do 39 | Doplnit vyšší číslovky dle potřeby |
| `#X` exact-match jen jednoslovný název | Fuzzy / víceslovné názvy přes našeptávač |
| `project:'q3'` default natvrdo ve `freshDraft` | Default dle workspace / kontextu otevření |
| Parita sudý/lichý = ISO-týden parita (vlastní logika) | Není v RFC 5545 RRULE — vlastní pole i v produkci |
| `repeat` (string) + `repeatRule` (objekt) + `repeatLabel` (text) drženo zvlášť | Kanonicky RRULE + odvozený label; výskyty viz samostatný spec opakování |
| Per-výskyt override názvu/priority/osob NEimplementováno (mění se celá řada) | Override tabulka klíčovaná datem (mimo doménu parseru) |

---

## 24. Doporučená struktura produkčního modulu (TS)

```
quickadd/
  parseQuick.ts          // hlavní orchestrátor (§1), vrací ParsedTask
  rules/
    deadline.ts          // §2
    priority.ts          // §3
    time.ts              // §4 (+ czNum)
    duration.ts          // §5 (+ czNum)
    multiday.ts          // §6
    date.ts              // §7 (+ weekday §9)
    recurrence.ts        // §11 (parseRecurrence + repeatRule)
    project.ts           // §10
  lexicon/
    czNum.ts             // §13 VERBATIM tabulka (základní číslovky)
    dayFromGen.ts        // §15 VERBATIM tabulka (řadové číslovky)
    weekdays.ts          // sjednocená WD/WD2 tabulka (§9+§11)
    recVocab.ts          // §12 RECVOCAB regex
  dates/
    recurrenceDates.ts   // §21 (weekdayDate, nthWeekdayISO, … na reálném today)
  highlight/
    nameSegments.ts      // §12 token highlighting
  draft/
    draftView.ts         // §20 view-model
    submit.ts            // §18 ParsedTask → Task
    validate.ts          // §17 guard
```
- Všechny `rules/*` jako čisté funkce `(work: string, ctx: ParseCtx) => RuleHit | null`, kde
  `RuleHit` nese `{patch, consumed: {start,end}}` → orchestrátor odřezává podle rozsahů (ne
  `String.replace`, aby šlo vyřezávat i opakované výskyty a držet přesné `hits` pro highlight).
- `ParseCtx` = `{ today: Date, projects, people, activeWs }`.
- Důkladně unit-otestovat každý lexikon a každé pravidlo (mají nejvíc logiky — to říká i CLAUDE.md
  bod 5: „chytré zadávání a model opakování jako samostatné, dobře otestované moduly").

---

*Konec specifikace. Zdroj: `WatsonApp.dc.html` ř. 1911–2080, 2284–2474, 2937–3003; README.md
sekce „Chytré zadávání" + „Co je vědomě zjednodušené".*
