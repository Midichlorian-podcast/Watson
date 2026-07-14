# Watson Mail — Popis modulů pro Claude Design

> **Účel:** kompletní, neosekaný popis mailového klienta Watsonu — modul po modulu:
> **co to je · co to dělá · jak to vypadá · stavy/edge-case · otevřené otázky.**
> Vzniká iterativně s uživatelem (postupně po modulech). Vlož do Claude Design jako podklad
> pro návrh obrazovek. Zdroj funkcí = **Spark Desktop** (týmový klient) + doplňky z **Gmailu**.
> Cíl: **plnohodnotná samostatná mailová aplikace zakomponovaná do Watsonu — bez osekání.**

## Kontext (drž při návrhu)
- Mail **rozšiřuje** existující Watson shell (sidebar + header + mobilní spodní lišta <880px),
  **nezakládá nový svět**. Design systém: tokeny `--w-*`, Montserrat (UI) + Inter (text),
  akcent brass, světlý + tmavý režim, CZ default / EN plně.
- Sdílené komponenty k reuse: TaskCard, chipy, checkbox, prioritní odznak, modaly, boční panely.
- **Persona:** provozní tým 15–30 lidí (kavárna, granty, podcast, studia), z velké části ne-vývojáři.

## ⚑ Designový jazyk mailu (DŮLEŽITÉ pro Cloud Design)
Watson má krásný, ale silně **„produktivní / kartový"** design. Mail **sdílí základní stavební prvky**
(tokeny `--w-*`, komponenty, shell, světlý/tmavý), ať zapadá do zbytku Watsonu — ale **NEkopíruj
produktivní kartovost za každou cenu**. Mail je **kreativní klient, kam se píše**: musí být
**přehledný, přístupný, exaktní a čitelný**, klidnější a méně „nabušený" než produktivní pohledy.
Priorita = **čitelnost textu a soustředění na psaní/čtení**, ne hustá mřížka karet.

## ⚑ Barvy v mailu (pro Cloud Design)
Použij Watson paletu (`--w-*`), ale v mailu platí **„barva = význam, ne dekorace":**
- **Prioritní barvy** (P1 červená / P2 žlutá / P3 modrá / P4 šedá) **jen** pro prioritu/urgenci vlákna —
  nikde jinde (ať se červená nečte jako „chyba/nepřečteno").
- **Barvy účtů/schránek** = hlavní barevný prvek (identita „od koho / za koho").
- **Stav threadu** = decentní odznaky, ne křiklavé.
- **Čtecí plocha klidná/neutrální** (paper/ink), soustředěná na text.
- **Osobní sféra** = vlastní vizuální marker (zámek/odstín), vždy odlišitelná od týmové.

## ⚑ Realizovatelnost & fázování (viz `files/MAIL_moduly_audit_2026-07-08.md`)
Brief popisuje **cílový stav** (neosekaný). Audit proti reálnému kódu potvrdil, že koncept dává smysl,
ale je nutné **sekvencovat** (nezkracuje rozsah):
- **Blok 0 (teď):** `entity_links` + instrumentace `audit_events` (prerekvizita pro email→úkol i Dění).
- **M1:** týmové jádro mailu (jeden provider, bez AI/urgence-úkolů/presence). **M2:** spolupráce +
  dispečink + urgence-SLA + collision. **M3:** AI vrstva. **Osobní sféra = samostatná větev** (dle #1 níže).
- **Vyžaduje NOVOU infrastrukturu** (ne „reuse"): živá přítomnost/collision (chybí realtime kanál) a
  SLA engine urgence (chybí fronty + pracovní kalendář). Design ať s tím počítá jako s pozdější fází.
- **Implementační pozn.:** dispečink úkol = `shared_any` (vědomě přepsat R2 default `shared_all`);
  AI Triage = návrh přes `ai_suggestions`, nikdy přímý zápis přiřazení (D2 je OFF).

## Guardraily (NESMÍ se porušit)
1. **Mail ve DVOU sférách (REVIDOVÁNO 2026-07-08):** **týmová** (řízená, admin dohled) + **osobní**
   (soukromá — **šifrování at-rest** klíčem uživatele: server stáhne, zašifruje, plaintext zahodí →
   *uložené osobní maily provoz/admin nepřečte*, **ne plné E2E**; bez týmových funkcí a **bez AI**).
   Host pohled = bez mailu. *(Nahrazuje původní „mail = jen týmová sféra". Model soukromí = rozhodnutí
   z 2026-07-08, viz `files/MAIL_moduly_audit_2026-07-08.md`.)*
2. **„Co nevidíš, v UI neexistuje"** — hranice na datech, žádné zašedlé „nemáš přístup".
3. **From není volný text.** U odpovědi svázané s vláknem se nemění („odpovídáš jako info@…"); u nové
   zprávy vybíráš z **oprávněných identit** (schránek, kam máš přístup) — ne libovolný text.
4. **AI = draft, člověk odesílá.** AI nikdy neodesílá externě, nemaže, nemění práva.
5. Vizuálně **oddělit osobní vs. týmovou sféru** a guest pohled.
6. Mail je **online-only** (na rozdíl od offline jádra úkolů).

## Legenda stavu modulu
🔲 projednává se · 🟡 rozpracováno · ✅ odsouhlaseno

## Roadmapa modulů
| # | Modul | Stav |
|---|---|---|
| 1 | Shell & layout mailu (rám, panely, navigace, mobil) | ✅ |
| 2 | Účty, sféry & identita (osobní/sdílené schránky, From/podpis) | ✅ |
| 3 | Schránka & triage (chytré skupiny, režimy, Gatekeeper, stavy) | ✅ |
| 4 | Thread workspace — vlajka (čtení + akce + interní chat + lišta stavu) | ✅ |
| 5 | Composer (psaní, formátování, přílohy, odeslání, undo) | ✅ |
| 6 | Týmová spolupráce & dispečink (Assign/Share, shared drafts, collision) | ✅ |
| 7 | Plánování (Send Later / Reminder / Snooze) | ✅ |
| ⊕ | **Dění** — týmová aktivita/feed (PRŮŘEZOVÝ, napříč celým Watsonem) | ✅ |
| ⊕ | **Osobní vs. týmová sféra mailu** — soukromí + mobilní oddělení (PRŮŘEZOVÝ, mění guardrail) | ✅ |
| 8 | AI vrstva (draft, sumarizace, překlad, Ask, agenti Off/Read/Triage) | ✅ |
| 9 | Šablony (osobní + týmové, +AI) | ✅ |
| 10 | Email → úkol & entity graf (thread ↔ úkol/projekt) | ✅ |
| 11 | Notifikace (per účet/tým, tiché hodiny) | ✅ |
| 12 | Swipe gesta & klávesové zkratky | ✅ |
| 13 | Nastavení (celá plocha jako Spark) | ✅ |
| 14 | Gmail nadstavba (štítky, kategorie, důvěrný režim, filtry) | ✅ |
| 15 | Admin & onboarding (připojení schránky, access matrix, health) | ✅ |

---
## Modul 1 — Shell & layout mailu ✅

**Umístění v navigaci:** samostatná položka **„Mail"** v levém app-sidebaru Watsonu (vedle
„Schránky", která zůstává pro triage úkolů). Mail je vlastní „svět" uvnitř obsahové plochy;
provázání s úkoly řeší Modul 10. Na položce „Mail" **odznak nepřečtených** (agregovaně přes týmové
schránky, ke kterým mám přístup).

**Rozložení — plný Spark, 3 panely:**
1. **Mail sub-sidebar** — účty/schránky (barevné iniciály/avatary) + chytré složky.
2. **Seznam threadů** — karty ve stylu Watson TaskCard (odesílatel, předmět, úryvek, odznaky:
   přiřazená osoba · „AI navrhlo odpověď" · follow-up · SLA · příloha).
3. **Čtení / Thread workspace** — vpravo (Modul 4).

**Přepínač layoutu** (v headeru mailu): **Full Screen** (čtení na celou šířku) / **Split View**
(default — seznam + čtení vedle sebe) / **Switch Inside Inbox** (přepínač přímo v schránce).
Dělič panelů sbalitelný + přetahovatelný; nastavitelný počet řádků náhledu v seznamu (1/2/3).

**Vizuál:** vnější Watson shell (sidebar + header + mobilní spodní lišta) zůstává; tokeny `--w-*`,
brass akcent na aktivní položce, Montserrat/Inter, světlý + tmavý režim.

**Mobil <880px:** 1-panel stack s prokliky (složky → seznam → thread) + spodní lišta;
mail sub-sidebar jako výsuvná zásuvka.

---

## Modul 2 — Účty, sféry & identita ✅

**Seskupení schránek v sub-sidebaru (jako Spark):** nahoře sjednocený **Inbox** (napříč vším), pod ním
dvě skupiny — **„Moje schránky"** (kde mám plný přístup) a **„Sdílené týmové schránky"** (více lidí).
Tyto schránky jsou **týmové sféry** (rozdělení „moje / sdílené" je vizuální podle typu grantu, ne
datová hranice). **Osobní (soukromé) schránky jsou zvlášť** — vlastní jasně oddělená sekce, viz
průřezový modul „Osobní vs. týmová sféra mailu".

**Identita per schránka/tým:** každá schránka má vlastní **zobrazené jméno + podpis** (Markdown) —
`info@` = „T-Group Studio", `granty@` = „Grantové oddělení" atd. Podpis se vkládá do composeru dle
aktivní schránky. **From nejde měnit** — u threadu/composeru jen viditelné „**odpovídáš jako info@…**".

**Vizuál účtu:** barevná iniciála/avatar (Color coding) + **stavová tečka připojení**
(zelená = connected, oranžová = error, šedá = paused).

**Sféry:** mail žije ve **dvou sférách** — týmová (tato sekce) + **osobní/soukromá** (průřezový modul);
sféry jasně vizuálně oddělit. **Host pohled = bez mailu.**
Připojení nové schránky = jen super-admin (Modul 15).

**⚠️ Přístupový model schránek (M:N) — DŮLEŽITÉ (platí napříč Moduly 6, 8, 15):**
- **Schránka ≠ uživatel.** Jedna schránka může být čtená/vlastněná **více uživateli** Watsonu (i když
  není „oficiálně sdílená" — např. `studio@t-group-dance.cz` má reálně ~5 lidí); jeden uživatel má
  přístup k **0..N** schránkám. Vztah uživatel ↔ schránka je **M:N** (řeší `mailbox_grants`).
- **Přiřazuje se konkrétní OSOBĚ, ne schránce.** Aplikace **ověří, že osoba má ke schránce přístup** —
  nikdy nepřiřadím „vyřídit tento e-mail" někomu, kdo na schránku nevidí. Nabídka přiřazení proto
  ukazuje jen oprávněné lidi.
- **Sdílení konkrétního obsahu** z dané schránky osobě je možné (přes grant / interní sdílení threadu).

---

## Modul 3 — Schránka & triage ✅

> Referenční model = **HEY** (nejčistší triage na trhu), týmovost dle **Missive**, karty dle **Spark**.

**Model třídění — JEDEN režim „chytré skupiny"** (bez přepínače Unread/Focused/Simple). Příchozí se
automaticky roztřídí do sekcí:
- **Inbox** — reálné konverzace od přijatých odesílatelů (jádro; = HEY *Imbox*).
- **Notifications** — automatické/systémové zprávy (faktury, potvrzení, upozornění) + tlačítko
  „označit vše jako viděné" (= HEY *Paper Trail*).
- **Newsletters** — hromadné odběry/marketing oddělené z hlavního proudu (= HEY *The Feed*).
- **Pinned** — ručně připnuté nahoru; **plní roli priority**. Žádná zvláštní auto-„Priority" skupina —
  záměrně se vyhýbáme auto-hádání důležitosti (to na Outlooku/Sparku často štve).
- **Rozpracované** — přečtené + neroztříděné thready (stav *Otevřený*) sbalené pod aktivní zprávy.
  **Náhrada Spark „Seen"**, řešeno přes stav threadu (žádný duplicitní koncept).

**Gatekeeper (clona odesílatelů)** = HEY *Screener*: u nového odesílatele dotaz
**Accept / Accept & Done / Block / Block Domain / Block All**. Blokovaní → složka Blocked.

**Stavy/akce na zprávě (vždy k dispozici):** Pin · Snooze · **Set Aside** (odkladiště bez termínu) ·
Read/Unread · Archiv · Koš · Spam · Block. **BEZ Spark „Mark as Done"** — „vyřízeno" =
**stav threadu Hotovo** provázaný s Watson úkolem (viz Modul 4 a 10).

**Stav threadu na kartě:** Nový · Otevřený · Čeká interně · Odesláno · Hotovo (provázáno se stavem
úkolu, R9).

**Zobrazení seznamu (výsledek srovnání Spark/Gmail/Superhuman/Missive/HEY):**
- **Hustota:** přepínač **Komfortní (default) / Kompaktní**; náhled **1/2/3 řádky** (default **2**).
- **Karta:** avatar odesílatele (týmový kontext „kdo") + předmět + 2řádkový úryvek + odznaky
  (příloha · počet ve vláknu · přiřazený · follow-up · SLA · „AI navrhlo").
- **Konverzační vlákna zapnutá** (seskupení dle threadu).
- **Řazení:** nejnovější nahoře (default) + volba „nejstarší nahoře" pro přiřazené (SLA).
- **Filtr-chipy:** nepřečtené · přílohy · přiřazené mně · follow-up · účet · štítek.
- Levý okraj karty může nést stav/prioritu konzistentně s Watson TaskCard (R6).

---

## Modul 4 — Thread workspace (vlajka) ✅

> Vlajková obrazovka — určuje jazyk celého mailu. Reference: **Missive** (chat vedle vlákna),
> **Spark** (akční lišta) + **znovupoužití Watson engine** (úkoly/priority/připomínky — neduplikovat).

**Rozložení — 4 vrstvy:**
- **E-mailové vlákno** (uprostřed): zprávy pod sebou, staré sbalené, Expand/Collapse all, skrytí
  citovaného textu, **překlad vlákna / zobrazit originál**.
- **Interní týmový chat** (pravý postranní panel, Missive styl): @zmínky kolegů,
  **neviditelné externímu odesílateli**, vizuálně oddělený blok (jiné pozadí, štítek „interní", zámek).
- **Composer** (dole): **přepínatelný inline ↔ samostatné okno**.
- **Lišta stavu & akce** (nahoře).

**Horní lišta stavu & akce:** předmět · účastníci · **chip stavu** (Nový/Otevřený/Čeká interně/
Odesláno/Hotovo) · avatar přiřazeného · akce **Assign · Udělej úkol · Share/Copy link ·
Snooze/Set Aside/Pin · Hotovo**. U composeru „odpovídáš jako info@…" (From nejde měnit).

### Priorita & urgence vlákna — systém „nic nepropadne"

**Úroveň = Watson priority P1–P4** (barvy R6: P1 červená / P2 žlutá / P3 modrá / P4 šedá). Nastavuje se
**na celé vlákno** (NE per-zpráva — vyhne se zmatku „5 důležitých zpráv ve vlákně").

**Vlajka priority (P1–P4) na vlákně** = vizuální „vyžaduje odpověď" v barvě priority: na kartě v seznamu
(barevný levý okraj + odznak, konzistentní s TaskCard) i v hlavičce threadu. Celé vlákno je obarvené dle
priority.

**Vynucení = HYBRID dle priority:**
- **P1 & P2** → vytvoří **reálný Watson úkol** „Odpovědět: <předmět>" přiřazený odpovědné osobě,
  priorita = priorita vlákna, s SLA termínem; **sám se odškrtne po odeslání odpovědi**.
- **P3 & P4** → jen **vlajka + SLA/follow-up**, bez úkolu v seznamu (nezaneřádí to-do list).

**SLA + eskalace (per priorita, konfigurovatelné per workspace):**

| Priorita | SLA (default) | Připomínka | Eskalace |
|---|---|---|---|
| **P1 Kritické** | do konce prac. dne | přiřazenému hned + v ½ SLA | přiřazený → **admin/manažer AŽ při porušení** · volitelný override tichých hodin |
| **P2 Urgentní** | 1 prac. den | přiřazenému v ½ SLA | přiřazený → dispečink/manažer při porušení |
| **P3 Důležité** | 3 prac. dny | přiřazenému | jen znovupřipomenutí (neeskaluje výš) |
| **P4 Nízké** | bez SLA | — | jemná follow-up detekce (7 dní ticho → návrh) |

- **„Míč na naší straně":** SLA běží **jen když je poslední zpráva příchozí a neodpovězená**; naší
  odpovědí se zastaví (nikdo není otravován, když čekáme my na druhou stranu).
- **Admin až při porušení:** dokud SLA běží, řeší to přiřazený. Po vypršení bez odpovědi dostane
  admin/manažer upozornění „na tento e-mail měla být odpověď (P1, do 1 dne), zatím neodešla."
- **Nepřiřazené + P1/P2:** úkol i eskalace míří na celý **dispečink** (nikdo nevlastní → nesmí viset).
- **Tiché hodiny** (guardrail) připomínky respektují; jen P1 nabídne override.

**Životní cyklus urgence:** nastav → SLA běží → **odpovíme → uspí** (úkol odškrtnut, SLA stop) →
**nová příchozí odpověď → obnoví se stejná úroveň** (úkol reaktivován, SLA restart) →
**„Ukončit konverzaci" / označit Hotovo = terminální stav**: i kdyby přišla další zpráva, urgence se
už NEobnoví. Vlákno si drží „baseline úroveň" zvlášť od aktivního stavu, aby šlo obnovit.

---

## Modul 5 — Composer (psaní) ✅

**Editor:** **WYSIWYG rich text (HTML e-mail)** — vizuální formátování jako Spark/Gmail (příjemci
čekají HTML). Interní chat (Modul 4) naopak zůstává **Markdown**.

**Akce:** nová zpráva · Odpovědět · Odpovědět všem · Přeposlat.
**Pole:** To/Cc/Bcc s našeptáváním z kontaktů (chip-y) · předmět · tělo. **Podpis** dle aktivní
schránky (Modul 2). **From = jedna z tvých oprávněných identit** — u odpovědi svázané s vláknem se
nemění („odpovídáš jako info@…"); u nové zprávy vybíráš ze schránek, kam máš přístup (ne volný text).

**Formátování (vždy):** tučné · kurzíva · podtržení · škrtnuté · odrážky · číslování · citace ·
odsazení · nadpis/podnadpis · odkaz · vyčistit formátování.

**Zahrnuté chytré prvky:**
- **Undo Send** — konfigurovatelný časovač zrušení odeslání (5–30 s).
- **Varování před odesláním** — externí příjemce · chybějící příloha (zmíněná v textu) · reply-all guard.
  (Zvlášť důležité u sdílených schránek.)
- **Inline obrázky + přílohy z úložiště** (R2/Drive), nejen z disku.
- **Rychlé AI odpovědi** (Interested/Thanks…) → vygenerují draft k odeslání člověkem (Modul 8).

**Odeslání:** Send · Send & Mark done · **Send Later** (Modul 7) · Send again. Vložení **šablony**
(Modul 9), **AI draft** (Modul 8), **Shared draft** (Modul 6).

**Vzhled:** přepínatelně ukotvený dole (rozbalovací) / samostatné okno; příjemci jako chip-y; dole
panel formátování + brass tlačítko **Odeslat** s rozbalovací šipkou (naplánovat).

**Guardrail:** AI generuje jen draft — **odesílá vždy člověk**.

---

## Modul 6 — Týmová spolupráce & dispečink ✅

> Hlavní důvod integrace mailu do Watsonu. Reference: **Missive**.

- **Assign** — přiřaď thread **konkrétní osobě** (NE schránce), přeřaď, odeber. Přiřazený =
  **odpovědná osoba** (napojení na urgenci/SLA z Modulu 4). **Přiřadit vyřízení lze jen osobě
  s přístupem ke schránce** (M:N model, viz Modul 2) — nabídka ukazuje jen oprávněné lidi.
- **Dispečink = filtry/sekce v seznamu:** Nepřiřazené · Přiřazené mně · Přiřazené ostatním ·
  Dokončené (per sdílená schránka) + hromadné akce. Avatar přiřazeného na kartě i v hlavičce.
- **Interní chat** k threadu s @zmínkami (Modul 4).
- **Collision detection = živá přítomnost:** avatary lidí s otevřeným threadem + varování
  „Adam právě odpovídá" — prevence dvojích odpovědí ve sdílené schránce.
- **Shared drafts (spolupsaní):** víc lidí píše/edituje jednu odpověď před odesláním, s komentáři;
  odeslat smí pověřený; „ukázat odeslané sdílené koncepty".
- **Schvalovací krok:** koncept musí před odesláním schválit pověřená osoba (junior → manager);
  řízená kvalita u ne-expertů. Volitelné per schránka/role.
- **Share / Copy deep link.**

**Zatím NEzahrnuto** (lze doplnit později): send-as-team round-robin (auto rozdělení), one-click
týmové odpovědi.

---

## Modul 7 — Plánování (Send Later / Reminder / Snooze) ✅

**Časové funkce (vše zahrnuto):**
- **Send Later** — naplánované odeslání ve zvolený čas + presety (dnes večer / zítra ráno / příští týden).
- **Snooze** — thread zmizí a vrátí se ve zvolený čas napříč zařízeními.
- **AI optimální čas / časové pásmo příjemce** — Watson navrhne nejlepší čas odeslání (online-only, +AI).
- **Opakované odeslání (recurring)** — pravidelně se opakující e-mail (např. týdenní připomínka klientům).
- **Auto follow-up detekce** — Watson pozná odeslané bez odpovědi a nabídne připomínku (napojení na
  SLA z Modulu 4 a notifikace Modul 11).

**Vzhled:** ikona hodin v liště; výběr času s presety; odznak „naplánováno na…" / „připomenu 12. 7."
na kartě.

**Informační přehled** těchto časových událostí (naplánovaná odeslání, snooze návraty, follow-up, SLA)
se propisuje do průřezového modulu **Dění → Nadcházející** (viz níže) jako **informativní karty**
(neodklikávají se — nejsou to úkoly).

## Modul — Dění (PRŮŘEZOVÝ: týmová aktivita / feed) ✅

> **Průřezový modul napříč celým Watsonem** (ne jen mail — mail je jen jeden zdroj). Staví na
> existujícím `audit_events` + `task_activity` + `entity_links` → hlavně **read-model + UI + ruční
> zápisy** nad tím, co už logujeme, ne nový těžký backend. Cíl: přehled „kdo co kdy" **bez chaosu**;
> **informativní** (ne reaktivní jako úkoly).

**Jeden proud kolem „teď":**
- **Nadcházející** (nahoře) — co se stane: naplánovaná odeslání, snooze návraty, follow-up připomínky,
  SLA odpočty urgentních (Modul 4), termíny úkolů. Informativní karty (zmizí/zašednou po události).
- **Dění** (dole) — co se stalo: odeslané/přijaté maily, dokončené úkoly, přiřazení, změny stavu,
  komentáře. Příklad: „Adam poslal mail klientovi X", „Pepa dokončila úkol Mzdy", „Lucka odeslala mzdy".

**Zdroje:**
1. **Automatické události** — mail (odesláno/přijato/přiřazeno/stav) + úkoly/cíle z audit logu.
2. **Ruční příspěvky** — člověk napíše vlastní status („dnes jsem udělal X mimo Watson, hotovo").
3. **Komentáře** k položkám feedu.
4. *(později)* **LuckyOS** účetní události — až bude jeho API (viz CLAUDE.md: LuckyOS čeká na API).

**Permission-aware (R5):** každý vidí dění entit, ke kterým má přístup; **admin vidí vše**
(workspace/app_admin). Platí „co nevidíš, v UI neexistuje".

**Proti chaosu:** seskupení po dnech/entitách · **filtry** (osoba, typ: mail/úkol/cíl/ruční, projekt,
workspace, datum) · **řazení** · **fulltext** · volitelný **denní digest** místo záplavy.

**Vzhled:** živá časová osa karet (styl Reportů); ikona typu + avatar aktéra + čas + odkaz do
threadu/úkolu + možnost komentovat / přidat vlastní zápis.

**Napojení:** `entity_links` spojuje událost s threadem/úkolem/projektem; z Dění skok přímo do entity.
Mailová část „Nadcházející" = to, co Modul 7 nazývá „Naplánované".

---

## Modul 8 — AI vrstva ✅

> **Guardrail (nad vším):** AI **nikdy neodesílá externě**, nemaže, nemění práva/role. Generuje
> **návrh/draft** → odesílá/schvaluje **člověk**. Vše auditované, respektuje tiché hodiny,
> **vypínatelné per schránka** (`ai_policies`).

**AI funkce (vše zahrnuto):**
- **Draft / přepis / tón** — napiš/uprav odpověď, změň tón, zkrať/rozveď.
- **Sumarizace vlákna** — TL;DR dlouhého threadu.
- **Překlad** — čtení i psaní v cizím jazyce.
- **Ask („Ask me anything")** — hledání zpráv/faktů **s odkazem na zdroj**, **permission-aware**.
- **Rychlé AI odpovědi** (Interested/Thanks…) → draft (Modul 5).

**AI Agenti per účet: Off / Read / Triage:**
- **Off** = AI se schránky nedotýká.
- **Read** = čte příchozí, sumarizuje, extrahuje fakta (nic nemění navenek).
- **Triage = předpřipraví a předpřiřadí, ČLOVĚK schvaluje** (nikdy auto-odeslání/auto-přiřazení):
  - Vychází z **popisů person / oblastí odpovědnosti** (`person_areas`): každý uživatel má profil
    „dělá pro tyto skupiny: … ; e-mailová komunikace se ho týká v tématech: …".
  - AI zanalyzuje příchozí → **předpřiřadí** odpovědné osobě/skupině + **předpřipraví balík úkolů/akcí
    k odkliknutí / úpravě**.
  - **Dávkové schválení:** admin může schválit celou situaci najednou, nebo po jedné.
  - Vždy s **„proč"** (důvod návrhu) + možnost korekce (feedback učí systém).

**Kompetenční směrování:** AI navrhne, komu thread patří (dle oblastí odpovědnosti); **vždy s „proč"**;
člověk/admin potvrdí. Nikdy nepřiřazuje ani neodesílá samo.

**Vzhled:** „Ask" lišta dole (jako Spark „Ask me anything"); AI návrhy jako `AISuggestion` karty ke
schválení; sumarizace nad vláknem; u agenta přepínač Off/Read/Triage u každé schránky.

**Závislost:** potřebuje **profily person / oblasti odpovědnosti** — setup v „Lidé & oblasti
odpovědnosti" (řeší Modul 15). Bez nich směrování jede jen z historie chování.

---

## Modul 9 — Šablony ✅

**Základ (vždy):** vytvořit/upravit/smazat, drag-řazení, hledání, vložení do composeru.

**Zahrnuto:**
- **Osobní + týmové sdílené šablony** — jednotné odpovědi za firmu (jako Spark „Team Templates").
- **+AI přizpůsobení** — při vložení AI upraví šablonu na míru příchozímu mailu (jméno, kontext, tón).
- **Kategorie / složky šablon** — Přihlášky, Faktury, Nabídky… pro rychlé nalezení.

**Nezahrnuto:** statické proměnné/placeholdery ({{jméno}}…) — personalizaci řeší **+AI přizpůsobení**
(dynamičtější než pevné značky).

**Vzhled:** seznam s drag-řazením + hledání + „Přidat"; sekce Osobní / Týmové + kategorie; náhled těla.

---

## Modul 10 — Email → úkol & entity graf ✅

> Srdce integrace do Watsonu. Staví na `entity_links` (už v plánu schématu).

**„Udělej z mailu úkol"** — přenese se:
- **Odkaz zpět na thread** (vždy) — `entity_link: mail_thread → task, derived_from`.
- **Název = předmět + AI shrnutí** vlákna do popisu (jasné, o co jde, bez otevírání mailu).
- **Přiřazený z threadu** (jinak dispečink/nepřiřazeno).
- **Priorita / termín z urgence** (P1–P4 + SLA, Modul 4).
- **Přílohy mailu** (faktura, smlouva… u sebe).
- **Komentář admina/zadavatele** — pole pro instrukci přiřazenému při vytvoření úkolu.

**Propojení = plné obousměrné + projekt↔konverzace:**
- Thread ↔ úkol oběma směry (z úkolu vidíš zdrojový mail; z threadu seznam navázaných úkolů).
- **Thread ↔ projekt** (kontext na jednom místě).
- Vše přes `entity_links`; app vrstva hlídá, že link nekříží hranici sfér.

**Stav threadu ↔ stav úkolu** (R9). P1/P2 zakládají auto-úkol „Odpovědět: …" (Modul 4).

**Vzhled:** akce „Udělej úkol" → předvyplněný mini-formulář (vč. pole pro komentář admina); na úkolu
chip „z mailu" s prokliknutím do threadu; v detailu úkolu blok s e-mailovým kontextem; na threadu
seznam navázaných úkolů.

---

## Modul 11 — Notifikace ✅

> **Znovupoužívá** existující Watson systém: Web Push + Resend digest + tiché hodiny + připomínky.

- **Per-účet úroveň:** **Všechny / VIP / Žádné** + **VIP seznam** odesílatelů (ti upozorní vždy).
  Např. `info@` = Všechny, `newsletter@` = Žádné, `granty@` = jen VIP.
- **Události, které upozorňují:** nový mail (dle per-účet úrovně) · **@zmínka** v interním chatu ·
  **přiřazení mně** · **eskalace/SLA** (Modul 4 — přiřazenému i adminovi při porušení) ·
  **nové v nepřiřazených** (dispečink).
- **Kanály:** in-app · Web Push · e-mailový digest.
- **Tiché hodiny** per workspace (guardrail) — mail i AI je respektují; jen **P1** nabídne override.

**Vzhled:** per-účet dropdowny (Všechny/VIP/Žádné), správa VIP seznamu, nastavení tichých hodin,
notifikační centrum + odznak nepřečtených na „Mail".

---

## Modul 12 — Swipe gesta & klávesové zkratky ✅

**Swipe gesta:**
- **Plně konfigurovatelná 4 gesta** — malý/velký swipe × vlevo/vpravo → uživatel si přiřadí akce
  z pevné nabídky (Hotovo, Read/Unread, Pin, Delete, Snooze, Archiv, Assign, Set Aside…). Jako Spark.
- **Fungují i na desktopu přes trackpad** (dvouprstové gesto na MacBooku), nejen mobil/tablet.

**Klávesové zkratky:**
- **Pevná kurátorská sada ~8–10 nejčastějších** (odpovědět, další/předchozí, archiv, pin, hotovo,
  snooze, přiřadit, hledat…). **Bez vytváření vlastních** — záměrně „nepřehánět" (ne obří Spark keymapa).
- Rozšiřuje existující Watson **command palette (⌘K)**.

**Vzhled:** obrazovka Swipes (4 gesta s výběrem akce, jako Spark); přehled klávesových zkratek
(jen ke čtení); command palette overlay.

---

## Modul 13 — Nastavení ✅

**Organizace:** **samostatná sekce „Mail"** v celkovém Nastavení Watsonu (Nastaveni.tsx), rozdělená do
pod-kategorií jako Spark (General · Vzhled schránky · Schránka/Gatekeeper · Composer · Notifikace ·
Plánování · Šablony · Swipes · Účty · Teams · +AI · AI Agenti).
- **Sdílené globální volby** (téma, tiché hodiny, jazyk) zůstávají v globálním Watson nastavení —
  **neduplikovat** stejnou položku na dvou místech.
- U každé volby **jasně vyznačit působnost** (jen Mail / jen App / obojí), ať nevznikne zmatek.

**Zahrnutá další nastavení (ze Sparku):**
- **Privacy:** vypínatelné načítání vzdálených obrázků (tracking pixely) + auto-download příloh.
- **Chování po archivaci/smazání** (otevřít další / zpět na seznam), chování připnutých po archivaci.
- **Editor podpisů per schránka** (Modul 2).
- *(Accessibility řeší globální Watson nastavení — neduplikovat.)*

---

## Modul 14 — Gmail nadstavba ✅

**Zahrnuto:**
- **Pokročilé vyhledávací operátory** — `from:`, `has:attachment`, `before:`, `is:unread`… s nápovědou.
- **Důvěrný režim** — e-mail s expirací + kódem, nelze přeposlat/kopírovat/tisknout (smlouvy, osobní údaje).

**Nezahrnuto:**
- **Štítky/labely** — kryjí je složky + chytré skupiny (Modul 3); lze doplnit později.
- **Kategorie** (Primary/Social/Promo) — překrývá se s našimi chytrými skupinami → vynecháno kvůli duplicitě.

**Vzhled:** operátory v hledání s nápovědou; důvěrný režim jako volba v composeru (ikona zámku).

---

## Modul — Osobní vs. týmová sféra mailu (PRŮŘEZOVÝ) ✅

> **Reconciliace guardrailu:** mění zamčené „mail = jen týmová sféra". Mail nově žije ve **dvou sférách**
> (mapuje se na `workspaces.isPersonal`, R8). **Cíl:** jeden klient na vše — nástroj tak dobrý, že ho
> lidé budou chtít i na osobní poštu (ne dva maily).

**Dvě sféry:**

| Vlastnost | Osobní (soukromá) | Týmová (řízená) |
|---|---|---|
| Viditelnost | jen vlastník; **ani admin nevidí** | tým dle grantů; admin dohled |
| Sdílení / dispečink / přiřazování | ❌ nic | ✅ vše |
| Interní chat / shared drafts / schvalování | ❌ | ✅ |
| **AI vrstva** (Modul 8) | ❌ **žádná** (soukromí + náklady) | ✅ |
| Email → úkol | ✅ jen do **osobní** části | ✅ týmové úkoly |
| Připomínky / snooze / kalendář | ✅ (osobní) | ✅ |
| Úložiště / klíče | **šifrováno at-rest klíčem uživatele** (provoz nepřečte uložené; ne plné E2E) | firemní vault, řízené granty |

**Soukromí osobních = šifrování at-rest (ROZHODNUTO 2026-07-08):** server osobní poštu stáhne,
**zašifruje klíčem uživatele a plaintext zahodí** → *uložené osobní maily provoz/admin nepřečte*.
Není to plné E2E (krátký plaintext při stahování — jako u každého poskytovatele), proto **zámek/marker
= „šifrováno, uložené maily nikdo z provozu nečte"**, NE „E2E". Bez AI, bez admin přístupu, mimo firemní
GDPR hranici. *(Plné klient-only E2E = případná pozdější samostatná větev.)*

**Vizuální oddělení:** osobní schránka vždy jasně označená (zámek / „soukromé" / odlišný odstín);
týmová týmově. **Nikdy se nemíchají.**

**Mobil/tablet:** **top-level přepínač Mail ↔ Práce** — mail má vlastní soustředěnou plochu
(triage-first), oddělenou od produktivní části, ať se dvě části appky nemotají. Desktop = 3 panely OK.

**Hranice (efektivita bez extra nákladů):** osobní sféra je **lehká** (čtení/psaní, osobní
úkoly/připomínky/kalendář; žádná AI ani týmová infrastruktura) → minimální provozní zátěž.

---

## Modul 15 — Admin & onboarding ✅

**Připojení schránky (wizard, jen super-admin):**
- **Gmail / M365** přes OAuth **+ generický IMAP/SMTP** pro schránky na **různých doménách a od různých
  poskytovatelů** (zadání IMAP/SMTP serverů, portů, přihlášení). Počítat s multi-domain/multi-provider
  od začátku. Credentials → **šifrovaný vault** (sahá jen Mail Sync Service).

**Access matrix / správa grantů = vrstvené granty + 3 pohledy:**
- Granty na úrovni **tým / projekt / osoba** (sčítají se → „effective access" spočítán jednou). Typy:
  vlastník / plný agent / scoped agent / per-thread delegát / interní spolupracovník; `scope_filter`;
  **expirace**.
- **Témata (oblasti odpovědnosti) zvlášť** — neurčují viditelnost, jen AI směrování (Modul 8); routing
  jen mezi lidmi s přístupem ke schránce.
- **3 pohledy:** (1) **karta osoby** (týmy/projekty/schránky/témata — on/offboarding), (2) **per-schránka**
  (kdo vidí a přes co), (3) **souhrnná matice** lidé × schránky (read-only přehled).

**Connection-health:** u každé schránky zelená/oranžová/červená (přístup, tokeny, poslední sync, výpadky).
**Lidé & oblasti odpovědnosti:** profily person (`person_areas`) = vstup pro AI směrování (Modul 8).
**Audit & analytics per schránka:** kdo co kdy odeslal, doba odezvy, plnění SLA; napojení na Dění.

**Guardrail:** osobní schránky **NIKDY** v admin matici/dohledu (šifrované, neviditelné ani adminovi).

**Bezpečnostní rizika (krocení):** least privilege (ukázat, co grant přidá) · čistý offboarding
(karta osoby = revoke vše + purge lokální kopie) · tvrdé hranice sfér · auditovaná sdílená From ·
jen super-admin připojuje schránky.

**Vzhled:** onboarding wizard (kroky připojení); matice + karty osob; health dashboard s barevnými
stavy; editor profilů/témat.

---

# ✅ Hotovo — jak s dokumentem naložit

Všech **15 modulů + 3 průřezové** (Dění · Osobní/týmová sféra · designové direktivy) odsouhlaseno.
Tento dokument je **kompletní funkční popis mailového klienta Watsonu pro Claude Design.**

**Doporučené pořadí návrhu v Claude Design (dle vlajky):**
1. **Thread workspace** (Modul 4) — určí vizuální jazyk celého mailu.
2. **Schránka & triage** (Modul 3) + **Shell/layout** (Modul 1).
3. **Composer** (Modul 5) + **Dispečink & tým** (Modul 6).
4. **Osobní vs. týmová sféra + mobilní oddělení** (průřezový) + **Dění** (průřezový).
5. **Admin/onboarding & přístupy** (Modul 15) + **Nastavení** (Modul 13).
6. **AI vrstva** (Modul 8) + zbytek (Plánování, Notifikace, Šablony, Swipes, Gmail nadstavba).

**Vždy drž:** „Designový jazyk mailu" + „Barvy v mailu" (nahoře) + Guardraily (vč. revidované sféry).

**Otevřené k pozdějšímu rozhodnutí:** round-robin / one-click týmové odpovědi (Modul 6) · štítky /
kategorie (Modul 14) · LuckyOS napojení do Dění · technické detaily šifrování osobní sféry (klíče,
hosting) · účetní/legální rámec osobní pošty v pracovní appce.
