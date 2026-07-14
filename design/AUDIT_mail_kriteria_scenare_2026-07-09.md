# Watson Mail — MASIVNÍ AUDIT v2 (KOLO 2): kritéria + scénáře + zátěž + release gate (2026-07-09)

> **Účel:** Tento dokument vlož do Claude Design k hotovému návrhu/prototypu mailu.
> Claude Design se má stylizovat do role **externího auditora, který Watson nikdy neviděl**:
> nic nepředpokládá, nic neomlouvá („to se dodělá později" neexistuje), každé tvrzení ověří
> proti obrazovkám.
>
> **Stav: Kolo 1 (části A–D) proběhlo a všechna kritéria údajně PROŠLA.** Auditor Kola 2
> tomu **zásadně nevěří**. Zkušenost říká: návrh, kterému projde všechno napoprvé, nebyl
> testován dost tvrdě. Kolo 2 proto: (1) **re-verifikuje** Kolo 1 s důkazní povinností,
> (2) testuje **interakce modulů mezi sebou** (Kolo 1 testovalo moduly převážně izolovaně),
> (3) žene návrh přes **maratonové řetězené scénáře, chaos selhání a tvrdé datové limity**,
> (4) měří **připravenost k implementaci** a vynáší **release verdikt**.
>
> **Ton auditu: EXTRA PŘÍSNÝ, přitvrzeno.** Když si auditor není jistý, jestli něco projde —
> neprojde to. Když obrazovka pro nějaký stav neexistuje, je to nález (ne „domyslí se").
> **PASS bez důkazu = OPEN (neprokázáno), počítá se jako FAIL.**

---

## 0. Metodika auditu (závazná)

1. **Nulová znalost.** Auditor předstírá, že nezná brief. Vše, co UI nesdělí samo, je nález
   typu NEDEFINOVÁNO. („Uživatel nemá brief v ruce.")
2. **Pořadí:** nejdřív část A (kritéria) obrazovku po obrazovce → pak část B (stavová matice)
   pro každou obrazovku → pak část D (scénáře) krok za krokem.
3. **Každý nález** dostane: ID kritéria/scénáře · obrazovku · popis · **severitu** · návrh opravy.
4. **Severity:**
   - **S0 BLOCKER** — porušený guardrail (sféry, From, AI odesílá, slib „E2E", host vidí mail),
     ztráta dat/rozepsaného textu, slepá ulička bez úniku, klíčový flow nedostupný z klávesnice,
     stav bez definované obrazovky v kritické cestě.
   - **S1 CRITICAL** — klíčový flow rozbitý na podporovaném breakpointu/stavu; dva prvky UI
     tvrdí protichůdné věci; logika stavů/SLA vede k špatnému rozhodnutí uživatele.
   - **S2 MAJOR** — tření, nekonzistence, chybějící sekundární stav, kontrast pod limitem,
     nejednoznačný text akce.
   - **S3 MINOR** — kosmetika.
   - **NEDEF** — spec/servis mezera: návrh na ni mlčí. Musí být vypsána, ne tiše obkreslena.
5. **Verdikt obrazovky (PŘITVRZENO v Kole 2):** jediný S0 = FAIL. Na **vlajkových
   obrazovkách** (Inbox/triage · Thread workspace · Composer) **jediný S1 = FAIL**.
   Jinde 2× S1 = FAIL. Jinak PASS s výhradami.
6. **Zákaz sebeobhajoby:** auditor nehodnotí, „jak to bylo myšleno", ale co je nakreslené.
7. **Důkazní povinnost (Kolo 2):** každý PASS platí, jen pokud k němu existuje artefakt —
   odkaz na konkrétní obrazovku/stav, **v obou tématech (light/dark), obou jazycích (CZ/EN)
   a min. na 2 šířkách** (mobil + desktop). PASS „z paměti" = **OPEN** = počítá se jako FAIL.
8. **Izolovaný PASS neexistuje:** funkce prošla, jen pokud prošla i ve všech kombinacích
   z části F (interakční matice), které se jí týkají. Modul otestovaný „sám o sobě" je
   otestovaný napůl.
9. **Náhodná re-verifikace:** auditor si vylosuje **15 kritérií Kola 1** a projde je znovu
   do hloubky. Každý rozpor s deklarovaným PASS = S1 + **eskalace nedůvěry**: losuje se
   dalších 15. Dva rozpory = kompletní re-audit celé části A.
10. **Guardraily se re-verifikují VŽDY, bez losování** (část E, seznam E-ALWAYS).

---

# ČÁST A — Kritéria auditu (jako by auditor klienta neznal)

## A1 — Design systém & vizuální disciplína

- **D-01** Každá barva na obrazovce má dohledatelný token (`--w-*`). Jediná ad-hoc barva = S1.
- **D-02** **Barva = význam, ne dekorace.** Červená/žlutá/modrá/šedá se objevují VÝHRADNĚ jako
  priorita/urgence P1–P4. Červená použitá pro „nepřečteno", „chyba", „smazat" v témže pohledu,
  kde je P1 = S1 (kolize významů). Zelená/oranžová/šedá tečka připojení schránky se nesmí dát
  splést s prioritou (jiný tvar/umístění, ne jen jiný odstín).
- **D-03** Barvy účtů/schránek = hlavní identita „za koho jednám". Musí být rozlišitelné i pro
  barvoslepé (nikoli jen hue: doplněná iniciála/tvar/label). Dvě schránky se stejnou barvou
  vedle sebe = S2.
- **D-04** Čtecí plocha = klidná (paper/ink). Jakýkoli sytý akcent uvnitř těla e-mailu, který
  nepochází z e-mailu samého = S2.
- **D-05** Typografická hierarchie max 3 úrovně na obrazovku (mimo tělo HTML mailu). Montserrat
  jen UI/nadpisy, Inter text. Odchylka = S2.
- **D-06** **Odznakový rozpočet karty threadu:** karta může nést až 6+ odznaků (příloha · počet
  ve vláknu · přiřazený · follow-up · SLA · „AI navrhlo" · stav · priorita). Audit vyžaduje
  explicitní pravidlo: **max N viditelných + overflow** („+2"). Karta s ≥5 souběžnými odznaky
  musí být nakreslená a čitelná v Kompaktní hustotě na 320 px. Chybí-li pravidlo = NEDEF/S1.
- **D-07** Stav threadu (Nový/Otevřený/Čeká interně/Odesláno/Hotovo) = decentní odznak; nesmí
  vizuálně soupeřit s prioritou. Uživatel musí na 1 pohled rozlišit „stav" vs „prioritu" vs
  „připojení účtu" — tři různé sémantiky, tři různé vizuální jazyky. Splynutí = S1.
- **D-08** Ikony: jedna sada, jeden stroke, jedna velikostní řada. Assign vs Share vs Ask musí
  být rozlišitelné ikonou i labelem (trojice je v briefu explicitně riziková). Záměnnost = S1.
- **D-09** Světlý i tmavý režim: KAŽDÁ obrazovka a KAŽDÝ stav (část B) v obou. Chybějící dark
  varianta = S1. Speciálně: **HTML e-mail s natvrdo bílým pozadím v dark modu** — návrh musí
  ukázat, jak se renderuje (ponechat světlý ostrov? invertovat? rámovat?). Mlčení = NEDEF/S1.
- **D-10** Osobní sféra: marker („zámek / šifrováno — uložené maily provoz nečte") je vidět
  VŽDY, když je uživatel v osobním kontextu (seznam, thread, composer, hledání). Slovo „E2E"
  kdekoli = **S0**.
- **D-11** Prázdný pixel-perfect stav loga/brandu: mail nesmí vypadat jako cizí appka — shell
  (sidebar, header, spodní lišta) identický se zbytkem Watsonu. Odchylka shellu = S1.
- **D-12** Žádný text nesmí být obrázkem; žádný stav sdělovaný jen barvou (WCAG 1.4.1) = S1.

## A2 — Čitelnost, obsah, lokalizace

- **C-01** Délka řádku čtecí plochy 50–90 znaků na desktopu (jinak zdůvodněný limit šířky).
  Text přes celou šířku 1440px+ monitoru bez limitu = S1.
- **C-02** Minimální velikost textu: 13 px sekundární / 15–16 px tělo. Menší = S2.
- **C-03** CZ default / EN plně: každý label existuje v obou; audit testuje **+30 % délky**
  textu (čeština: „Odpovědět všem", „Naplánované odeslání", „Čeká na schválení") — nic se
  nesmí lámat/ořezávat bez tooltipů. Ořez kritické akce = S1.
- **C-04** Datum/čas: relativní („před 2 h") + absolutní na hover/detail; formát dle locale;
  časová zóna u Send Later explicitně uvedená. Chybí = S2.
- **C-05** Předmět: prázdný předmět („(bez předmětu)"), 200znakový předmět, emoji v předmětu,
  RE: RE: FWD: řetězce — vše musí mít definované chování (ořez s tooltipem). Chybí = S2.
- **C-06** Odesílatel: jméno s emoji/diakritikou, jen e-mail bez jména, stejné jméno dvou lidí
  („Jana Nováková" ×2) — jak UI disambiguuje? NEDEF = S2.
- **C-07** Úryvek (preview) nesmí obsahovat HTML/CSS smetí, podpisy, „Doufám, že Vás tento
  e-mail zastihl v pořádku" logiku ořezu definovat. NEDEF = S3.
- **C-08** Citovaný text: sbalený s jasným affordance rozbalení; 15 úrovní citací (starý
  řetěz) nesmí rozbít layout. Test povinný = S2.
- **C-09** Vzdálené obrázky default vypnuté (privacy) → návrh MUSÍ ukázat stav „obrázky
  blokovány" + per-odesílatel povolení, a jak vypadá rozbitý newsletter bez obrázků. NEDEF = S1.
- **C-10** RTL úryvky, dlouhá slova bez mezer (URL 200 znaků), tabulky v HTML mailu širší než
  čtecí sloupec (horizontální scroll UVNITŘ zprávy, ne stránky). Porušení = S1.

## A3 — Stavová disciplína (nejtvrdší část)

Pro **každou obrazovku** existuje návrh pro **všech 8 stavů** (viz část B):
prázdný · první použití/onboarding · loading (skeleton) · částečný fail · plný fail/offline ·
přeplněný (10k položek) · read-only (bez oprávnění k akci) · úspěch/potvrzení.

- **ST-01** Chybějící stav v kritické cestě (inbox, thread, composer, odeslání) = **S0**.
- **ST-02** **Mail je online-only uvnitř offline-first appky.** Uživatel offline přepne
  z Úkolů (fungují) na Mail. Co vidí? Cached read-only seznam? Banner? Prázdno? Návrh musí
  existovat a být konzistentní s „úkoly fungují offline". NEDEF = S0 (jádrová identita produktu).
- **ST-03** Rozepsaný text NIKDY nezmizí bez varování: crash/refresh/ztráta spojení uprostřed
  composeru → obnovení draftu musí být nakreslené. NEDEF = S0.
- **ST-04** Odeslání selže (SMTP down, příloha velká, adresát neexistuje): zpráva zůstává
  viditelná jako „neodesláno — opakovat", nikdy tiše nezmizí. NEDEF = S0.
- **ST-05** Loading: skeleton do 100 ms, žádné layout-shift poskoky seznamu (badge se dokreslí
  bez posunu karet). Porušení = S2.
- **ST-06** Mailer-daemon / bounce („Mail delivery failed") — kam spadne (Inbox? Notifications?)
  a jak se propíše k původní odeslané zprávě? NEDEF = S1.
- **ST-07** Chyba připojení schránky (token vypršel): oranžová/červená tečka + co uživatel
  udělá dál (CTA k adminovi? sám?). Mrtvá tečka bez akce = S1.

## A4 — Přístupnost (bez výjimek)

- **P-01** Kontrast: text 4.5:1, velký text a UI komponenty 3:1 — **včetně brass akcentu na
  paper** (známá past: brass `#C68A3E` na světlém podkladu NEprochází pro text — nutný tmavší
  `#A8722E`). Každé porušení = S1.
- **P-02** Kompletní průchod klávesnicí: triage (další/předchozí/archiv/pin/hotovo), odpověď,
  assign, hledání — bez myši. Focus ring viditelný na každém prvku. Chybí = S0 pro core flow.
- **P-03** Touch cíle ≥ 44×44 pt; swipe akce mají non-gesturální alternativu (menu na kartě).
  Swipe-only akce = S1.
- **P-04** Screen reader: karta threadu čte smysluplné pořadí (odesílatel → předmět → stav →
  priorita → čas), badge mají textové ekvivalenty. NEDEF = S1.
- **P-05** Zoom 200 % / textové škálování: reflow bez horizontálního scrollu (WCAG 1.4.10),
  3-panel se přeskládá. Porušení = S1.
- **P-06** `prefers-reduced-motion`: animace (snooze odlet, collision pulz) mají tichou
  variantu. NEDEF = S3.
- **P-07** Barvoslepost: P1 červená vs P3 modrá vs P2 žlutá rozlišitelné i tvarem/labelem
  (odznak „P1"), ne jen barvou. Porušení = S1.

## A5 — Responzivita (matice povinná)

Testovací šířky: **320 · 360 · 390 · 768 · 879 · 880 · 881 · 1024 · 1280 · 1440 · 1920 · 3440 px**
(hranici 880 testovat ±1 px — přepnutí shellu nesmí nic ztratit, včetně rozepsaného draftu!).

- **R-01** 320 px: žádný horizontální scroll stránky, všechny akce dosažitelné. Porušení = S0.
- **R-02** Mobil <880: 1-panel stack složky → seznam → thread s funkčním „zpět" (systémové
  gesto i UI šipka); sub-sidebar jako zásuvka. Ztráta pozice v seznamu po návratu z threadu = S2.
- **R-03** **Thread workspace = 4 vrstvy (vlákno · composer · interní chat · lišta akcí) na
  mobilu.** Návrh MUSÍ explicitně ukázat, jak se 4 vrstvy vejdou na 390×844: co je tab, co je
  sheet, co je sbalené. Chybí-li mobilní řešení interního chatu = S1 (týmová vlajka).
- **R-04** Composer na mobilu: klávesnice zabírá ~40 % výšky — pole Komu/Předmět/tělo/Odeslat
  musí zůstat dosažitelné; safe-area (notch, home indicator); landscape telefon. NEDEF = S1.
- **R-05** Tablet: split-view dle briefu; přetahovatelný dělič s minimy panelů (seznam nesmí
  jít zúžit pod čitelnost karty — definovat min-width). NEDEF = S2.
- **R-06** Desktop 1440+: limit šířky čtecí plochy (C-01); 3 panely + otevřené samostatné okno
  composeru + interní chat současně — nakreslit, ne tvrdit. NEDEF = S2.
- **R-07** **Top-level přepínač Mail ↔ Práce (mobil/tablet)**: kde přesně je, jak vypadá badge
  nepřečtených na něm, co se stane s rozepsaným draftem při přepnutí. NEDEF = S1.
- **R-08** Swipe gesta: 4 konfigurovatelná gesta nesmí kolidovat se systémovým back-swipe
  (iOS levá hrana!) a scrollem; trackpad varianta na desktopu. Kolize s back-gestem = S1.
- **R-09** PWA standalone: bez browser chrome — vlastní navigace vždy přítomná; pull-to-refresh
  chování definované. NEDEF = S2.

## A6 — Logika a stavové automaty (auditor = state-machine pedant)

### Thread & stav
- **L-01** Stavový automat threadu (Nový → Otevřený → Čeká interně → Odesláno → Hotovo):
  KDO smí kterou hranu, které hrany jsou automatické (odeslání → „Odesláno"? příchozí → zpět
  „Otevřený"?), a jak vypadá každá hrana v UI. Chybí-li diagram/odpověď = NEDEF/S1.
- **L-02** **Hotovo je terminální pro urgenci** („i kdyby přišla další zpráva, urgence se už
  NEobnoví") — ale co STAV threadu, když po Hotovo přijde nová zpráva? Zůstane „Hotovo"
  s nepřečtenou zprávou (rozpor!), nebo se reotevře (pak co znamená „terminální")? UI musí
  odpovědět jednoznačně. NEDEF = S1.
- **L-03** Provázání stav threadu ↔ stav úkolu (R9): úkol dokončen ručně → thread Hotovo?
  Thread Hotovo → úkol odškrtnut? Oba směry ukázat. NEDEF = S1.

### Priorita, urgence, SLA
- **L-04** **Dva prioritní systémy:** Pinned „plní roli priority" (Modul 3) × P1–P4 vlajka
  (Modul 4). Návrh musí vysvětlit vztah (Pin = ruční „drž nahoře", P1–P4 = urgence odpovědi?)
  a nesmí je vizuálně splétat. Splynutí = S1.
- **L-05** P1/P2 → auto-úkol „Odpovědět: …": kde úkol vidím (Watson to-do i mail?), co vidí
  přiřazený, jak vypadá „sám se odškrtl po odeslání". Odpověď odešle KOLEGA (ne přiřazený) —
  odškrtne se úkol přiřazeného? UI to musí komunikovat. NEDEF = S1.
- **L-06** SLA běží „jen když je poslední zpráva příchozí a neodpovězená". Ověř hraniční
  případy v UI: (a) odpověď NAPLÁNOVANÁ přes Send Later — SLA stojí, nebo běží až do reálného
  odeslání? (b) koncept čekající na SCHVÁLENÍ — SLA běží? (c) interní chat zpráva — neběží?
  Každý případ = viditelný stav odpočtu. NEDEF = S1.
- **L-07** SLA v pracovních dnech: P1 přijde v pátek 17:30 (po pracovní době) — kdy je
  deadline a co ukazuje odpočet přes víkend? NEDEF = S1.
- **L-08** Eskalace: komu PŘESNĚ chodí (přiřazený → admin až při porušení; nepřiřazené P1/P2 →
  „celý dispečink" — to je kdo? všichni s přístupem? notifikační bouře?). UI eskalace u admina
  nakreslené. NEDEF = S1.
- **L-09** Tiché hodiny: P1 override — jak vypadá žádost/označení „tohle tě vzbudí"? Kdo ho
  zapíná (odesílatel eskalace? admin?)? NEDEF = S2.

### Identita & From
- **L-10** From u odpovědi = zamčené na schránku vlákna („odpovídáš jako info@…") — ověř, že
  composer NEnabízí změnu. Nabízí = **S0**.
- **L-11** Nová zpráva: výběr z oprávněných identit — jaké je DEFAULT From, když má uživatel
  5 schránek (naposledy použitá? kontext právě otevřené schránky?)? Špatný default = odeslání
  za špatnou identitu. NEDEF = S1. Prevence „poslal jsem to za studio@ místo granty@" (viditelná
  identita v composeru barvou schránky) chybí = S1.
- **L-12** Podpis se mění s From; při přepnutí identity uprostřed psaní se podpis vymění bez
  zničení textu. NEDEF = S2.

### Gatekeeper & triage
- **L-13** Gatekeeper: kde fyzicky žijí zprávy čekající na screening? Počítají se do badge
  nepřečtených? Co když čekající zpráva je P1 od klíčového klienta — běží SLA? (past: urgence
  vs. clona). NEDEF = S1.
- **L-14** Accept & Done vs Accept: rozdíl viditelný a vysvětlený v UI. Block Domain u
  freemailu (gmail.com!) — ochrana před sebestřelením. NEDEF = S2.
- **L-15** Chybná klasifikace: faktura spadne do Newsletters → přesun do Inboxu jedním tahem +
  „příště od tohoto odesílatele sem" (učení). NEDEF = S1.
- **L-16** „Rozpracované" (přečtené+neroztříděné, stav Otevřený): jak se liší vizuálně od
  Inboxu a kdy tam věc spadne/vypadne. NEDEF = S2.

### Sféry (nejpřísnější sekce)
- **L-17** **Sjednocený Inbox „napříč vším" × „sféry se NIKDY nemíchají":** je osobní schránka
  ve sjednoceném Inboxu? Pokud ano — jak je označená a proč to neporušuje guardrail? Pokud ne —
  kde je řečeno, že „sjednocený" znamená „jen týmové"? Návrh musí zvolit a ukázat. NEDEF = **S0**
  (přímý rozpor guardrailů).
- **L-18** Osobní sféra bez AI: globální „Ask" lišta / AI tlačítka v osobním kontextu —
  neexistují (ne zašedlé!). Zašedlé AI tlačítko s tooltipem „v osobní schránce nedostupné" =
  porušení „co nevidíš, v UI neexistuje"? Auditor vyhodnotí konzistenci zvoleného výkladu. NEDEF = S1.
- **L-19** Email→úkol z osobního mailu → JEN osobní úkoly; UI nesmí nabídnout týmový projekt.
  Nabídne = **S0** (křížení sfér přes entity_links).
- **L-20** Hledání: výsledky napříč sférami v jednom seznamu? Osobní výsledky označené, nebo
  hledání per sféra? NEDEF = S1.
- **L-21** Badge „Mail" v sidebaru: agregát „týmové schránky, ke kterým mám přístup" — počítá
  se osobní? Když ano/ne, je to konzistentní s L-17? NEDEF = S2.
- **L-22** Host (guest): mail neexistuje — položka Mail v sidebaru pro hosta NENÍ (ne zašedlá).
  Deep link na thread hostovi ukáže co? (nesmí být „nemáš přístup" se jménem threadu — únik
  informace). NEDEF = S1, únik metadat = **S0**.

### Tým, dispečink, souběh
- **L-23** Assign: nabídka ukazuje JEN osoby s přístupem ke schránce. Ověř i hromadné přiřazení.
  Osoba bez přístupu v nabídce = **S0**.
- **L-24** Přiřazenému VYPRŠÍ grant / je offboardnut, thread zůstal přiřazený: co vidí
  dispečink? (thread nesmí zmizet do černé díry — „osiřelé přiřazení" stav). NEDEF = S1.
- **L-25** Collision: „Adam právě odpovídá" — co se stane, když odpovím i tak? (měkká zábrana,
  ne zámek?) Dva inline composery na tomtéž threadu — druhý odesílatel dostane varování před
  odesláním? NEDEF = S1. (Pozn.: realtime je M2 — návrh smí ukázat fallback bez presence, ale
  musí říct, který stav kreslí.)
- **L-26** Shared draft × individuální odpověď × schvalování: tři cesty k jedné odpovědi.
  Jak UI brání, aby vznikly souběžně dvě odpovědi (shared draft od Jany + rychlá odpověď od
  Tomáše)? NEDEF = S1.
- **L-27** Schvalovací krok: stavy konceptu (čeká na schválení / vráceno s komentářem /
  schváleno+odesláno) + kde je vidí junior a kde schvalovatel. Kdo je uveden jako odesílatel
  po schválení? Vrácení bez komentáře možné? NEDEF = S1.
- **L-28** Interní chat: NIKDY nesmí vypadat jako odpověď externímu (jiné pozadí + zámek +
  label „interní"). Auditor zkusí „šilhací test": rozmazané oko rozliší chat od mailu? Ne = S1.
  Reply pole chatu hned vedle composeru mailu — riziko odeslání interní poznámky klientovi = S0
  pokud je záměna snadná.

### Composer & odeslání
- **L-29** Pořadí ochran při odeslání: reply-all guard (40 příjemců) → varování externí
  příjemce → chybějící příloha → schvalování → Undo Send okno → Send Later. Návrh ukazuje
  celý řetěz a jejich kombinace (Send Later + schvalování?). NEDEF = S1.
- **L-30** Undo Send: kde widget žije (toast?), co se stane při zavření appky během okna,
  a jak vypadá „Send & Mark done" + Undo (vrátí se i stav Hotovo?). NEDEF = S1.
- **L-31** Přílohy: >25 MB fail, upload progress, příloha z R2/Drive vs disk, inline obrázek
  drag&drop, příloha v podepsaném threadu s důvěrným režimem. Stavy nakreslené = povinnost. NEDEF = S1.
- **L-32** Důvěrný režim: příjemcova zkušenost (kód, expirace) + odesílatelova (jak vidím, že
  vypršel?) + UI enforcement (Přeposlat/Kopírovat u důvěrné zprávy NEEXISTUJE, ne zašedlé —
  konzistence s „co nevidíš…"). NEDEF = S1.

### Plánování & čas
- **L-33** Send Later: naplánováno na zítra 8:00, mezitím přijde nová zpráva do vlákna —
  upozornění „kontext se změnil, zkontroluj naplánovanou odpověď"? Kde vidím frontu
  naplánovaných a jak zruším/upravím? NEDEF = S1.
- **L-34** Snooze: vrátí se „napříč zařízeními" — probudí ho nová příchozí zpráva dřív?
  (obě chování legitimní — musí být zvoleno a vidět). NEDEF = S1.
- **L-35** Recurring e-mail: úprava jedné instance vs celé řady (analogie R4 u úkolů);
  zastavení řady; co když recipient odpoví — pokračuje řada? NEDEF = S2.
- **L-36** Časová pásma: Send Later „zítra ráno" — čí ráno? Odesílatel v Praze, příjemce v LA,
  AI navrhne „optimální čas" — UI ukazuje obojí? NEDEF = S2.

### AI vrstva
- **L-37** AI nikdy neodesílá: každý AI výstup končí v draftu s viditelnou lidskou akcí.
  Jediná cesta AI → externí svět bez člověka = **S0**.
- **L-38** AI Triage batch: 15 návrhů, schválit vše najednou — a JEDEN byl špatně: jednotlivý
  undo po dávkovém schválení. NEDEF = S1. Každý návrh má „proč" popover. Chybí = S1.
- **L-39** AI stav: generování trvá 8 s / selže / vrátí nesmysl v cizím jazyce — loading,
  retry, discard nakreslené. NEDEF = S2.
- **L-40** Agent Off/Read/Triage per schránka: přepínač u schránky + co který stupeň DĚLÁ
  vysvětleno v UI jazykem ne-vývojáře. NEDEF = S2.

### Notifikace & Dění
- **L-41** Per-účet Všechny/VIP/Žádné + VIP seznam: VIP odesílatel napíše do schránky s „Žádné"
  → notifikace přijde (VIP vyhrává)? Návrh ukazuje prioritu pravidel. NEDEF = S2.
- **L-42** Notifikační bouře: 30 nových mailů za 5 minut do sdílené schránky — grupování
  notifikací, ne 30 push zpráv. NEDEF = S1.
- **L-43** Dění: permission-aware feed (vidím jen entity, kam smím) — ale admin vidí VŠE:
  jak feed admina označuje položky, které členové nevidí? Ruční příspěvek — kdo ho vidí?
  NEDEF = S2. Denní digest opt-in nakreslen = S3 pokud chybí.
- **L-44** „Nadcházející" karty (naplánovaná odeslání, snooze návraty, SLA odpočty) — NEJSOU
  úkoly, neodklikávají se: vizuálně odlišené od úkolů s termínem v témže proudu. Splynutí = S1.

### Admin & onboarding
- **L-45** Wizard připojení: OAuth fail, IMAP špatný port, 2FA u providera, duplicitní
  připojení téže schránky — chybové stavy nakreslené. NEDEF = S1.
- **L-46** Access matrix: 3 pohledy (osoba / schránka / matice), expirace grantu viditelná
  PŘED vypršením, „co tento grant přidá" (least privilege náhled). NEDEF = S2.
- **L-47** Offboarding kartou osoby: revoke vše + co se stane s jejich přiřazenými thready,
  shared drafts, naplánovanými odesláními (!). NEDEF = S1.
- **L-48** Osobní schránky v admin matici NEJSOU (ani řádek „skrytá"). Přítomnost = **S0**.

### Šablony
- **L-49** Správa šablon: vytvořit / upravit / smazat / drag-řazení / hledání / kategorie
  (Přihlášky, Faktury…) — všechny stavy nakreslené vč. prázdného. **Osobní vs týmové:** kdo
  smí editovat/smazat TÝMOVOU šablonu (každý? admin?) musí být z UI zřejmé. NEDEF = S2,
  nejasné vlastnictví týmové šablony = S1.
- **L-50** Vložení šablony do composeru: do rozepsaného draftu se **vloží na kurzor, nebo
  přepíše tělo?** (přepis bez varování = ztráta textu = S0). **+AI přizpůsobení** = náhled
  upravené verze PŘED vložením (AI = jen návrh, L-37) + fallback bez AI; v osobní sféře +AI
  neexistuje (konzistence L-18). NEDEF = S1.

### Hledání & operátory (Gmail nadstavba)
- **L-51** Operátory (`from:`, `has:attachment`, `before:`, `is:unread`…) s nápovědou /
  autocomplete použitelnou pro ne-vývojáře (Tomáš je nikdy neviděl); neplatný operátor
  nespadne do tichého „0 výsledků" bez vysvětlení. NEDEF = S2.
- **L-52** Výsledky přísně permission-aware: schránka bez grantu se neprojeví ani počtem,
  ani našeptáváním jmen odesílatelů. Únik metadat = **S0**. Stav „0 výsledků" s radou
  (překlepy, jiná schránka, filtr aktivní?) nakreslen. NEDEF = S2.
- **L-53** Hledání UVNITŘ otevřeného vlákna (120 zpráv, E-02) — existuje a je odlišené od
  globálního hledání. NEDEF = S2.

### Nastavení — chování (Modul 13 detailně)
- **L-54** Chování po archivaci/smazání (otevřít další / zpět na seznam) a chování
  připnutých po archivaci: volby existují, výchozí hodnota je řečená, a seznam/thread se
  podle nich skutečně chová (focus po akci, P-02). NEDEF = S2.
- **L-55** Editor podpisů per schránka: kde žije, náhled podpisu, Markdown; kdo smí měnit
  podpis SDÍLENÉ schránky (podpis = identita firmy, ne osobní hračka). NEDEF = S2,
  volná editace sdíleného podpisu kýmkoli bez označení = S1.

## A7 — Konzistence napříč

- **K-01** Stejná akce = stejný název + ikona všude (Hotovo v seznamu = Hotovo v threadu =
  Hotovo ve swipe). Synonyma („Vyřízeno"/„Hotovo"/„Done") = S1.
- **K-02** Terminologický slovník: Schránka (mailbox) vs „Schránky" (triage úkolů ve Watsonu!)
  — kolize názvů v jednom sidebaru. Návrh ji musí řešit (přejmenování/oddělení). Kolize = S1.
- **K-03** Deep link (Share/Copy link) se chová stejně z Dění, z úkolu, z chatu; příjemce bez
  přístupu → konzistentní zážitek (L-22). NEDEF = S2.
- **K-04** Klávesové zkratky: sada ~8–10, zobrazená v UI (cheat-sheet), nekoliduje s ⌘K
  paletou ani s browserem. NEDEF = S2.
- **K-05** Nastavení: působnost každé volby označená (jen Mail / jen App / obojí); žádná
  duplicitní volba na dvou místech. Duplicita = S1.

## A8 — Bezpečnost & soukromí v UI

- **SEC-01** Žádný slib „E2E" nikde (viz D-10). = **S0**.
- **SEC-02** Externí vs interní příjemce vizuálně odlišen v chipech (doména mimo tým = marker).
  NEDEF = S2.
- **SEC-03** Phishing hygiena: zobrazená adresa odesílatele (ne jen display name) dostupná na
  1 interakci; reply-to ≠ from viditelně označeno. NEDEF = S1.
- **SEC-04** Credentials/vault, tokeny: nikdy zobrazené v UI adminu v plaintextu. = S0.
- **SEC-05** Audit trail viditelný: „kdo odeslal za info@" u odeslané zprávy (sdílená identita
  = auditovaná). NEDEF = S2.

---

# ČÁST B — Povinná stavová matice (vyplnit pro každou obrazovku)

| Obrazovka | Prázdná | 1. použití | Loading | Část. fail | Offline/plný fail | 10k položek | Read-only | Úspěch | Dark | 320px | 200% zoom |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Inbox/triage | | | | | | | | | | | |
| Thread workspace | | | | | | | | | | | |
| Composer (inline) | | | | | | | | | | | |
| Composer (okno) | | | | | | | | | | | |
| Gatekeeper/Screener | | | | | | | | | | | |
| Dispečink (nepřiřazené…) | | | | | | | | | | | |
| Osobní schránka | | | | | | | | | | | |
| Dění (feed) | | | | | | | | | | | |
| Hledání + operátory | | | | | | | | | | | |
| Šablony | | | | | | | | | | | |
| Nastavení Mail | | | | | | | | | | | |
| Admin: wizard | | | | | | | | | | | |
| Admin: access matrix | | | | | | | | | | | |
| Admin: health | | | | | | | | | | | |
| AI (Ask/AISuggestion) | | | | | | | | | | | |
| Notifikační centrum | | | | | | | | | | | |

Značky: ✅ nakresleno · ⚠️ odvoditelné, nenakreslené (= S2) · ❌ chybí (= dle A3) · N/A zdůvodněné.

---

# ČÁST C — Persony (auditor v nich žije, ne o nich mluví)

| Persona | Kdo to je | Zařízení | Technická úroveň | Klíčové vlastnosti |
|---|---|---|---|---|
| **Adam** | majitel / super-admin, 5+ schránek | desktop + iPhone večer | vysoká | přepíná identity, řeší eskalace, spravuje přístupy, má i osobní gmail |
| **Markéta** | projektová manažerka / dispečerka | desktop 1440, občas tablet | střední | ranní triage 40+ mailů, rozděluje nepřiřazené, hlídá SLA, schvaluje juniorům |
| **Tomáš** | barista, jen `info@` | JEN telefon (Android, 360px) | nízká — bojí se „něco rozbít" | swipe, česky, jeho koncepty podléhají schválení |
| **Jana** | grantová specialistka, `granty@` | notebook 1280 | střední | deadliny výzev, maily→úkoly, přílohy, důvěrný režim, P1 svět |
| **Filip** | editor podcastu, `podcast@` | MacBook + iPhone | vyšší | dlouhá kreativní vlákna, EN komunikace, šablony, Send Later, newslettery |
| **Věra** | externí účetní — per-thread delegace | starší notebook 1024 | nízká | vidí JEN delegované thready; nesmí vidět nic jinýho |
| **Karel** | host (guest) ve workspace | telefon | střední | mail pro něj NEEXISTUJE — negativní persona |
| **Eva** | nová zaměstnankyně, den 1 | firemní notebook | střední | prázdné stavy, onboarding, Gatekeeper od nuly |
| **Petr** | odcházející zaměstnanec | — | — | offboarding: přiřazené thready, drafty, naplánovaná odeslání |
| **Alena** | slabozraká administrativa | desktop, 200 % zoom, občas čtečka | střední | klávesnice + zoom + kontrast; plnohodnotná práce, ne „ochutnávka" |

---

# ČÁST D — Scénáře (auditor projde KROK ZA KROKEM a zapíše, kde to praskne)

> Formát průchodu: **cíl → kroky v UI → u každého kroku: existuje obrazovka? je akce
> nalezitelná do 5 s? co se stane pak?** Každé zaváhání = nález. „Uživatel by si domyslel"
> se nepočítá.

## D1 — Běžný provoz (B)

- **B-01 · Tomáš, mobil:** Na `info@` přijde reklamace rozlitého kafe. Tomáš ji má najít,
  odpovědět omluvou (koncept → schválení Markétou), a označit vyřízeno až po schválení.
  Ověř: celý schvalovací okruh na 360px; kde Tomáš vidí „čeká na schválení"; co když Markéta
  koncept upraví a odešle — kdo je odesílatel; Tomášova jistota „už je to pryč?".
- **B-02 · Markéta, desktop, pondělí 8:00:** 40 nových napříč `info@`+`granty@`+`podcast@`.
  Cíl: za 10 minut roztřídit — 5 přiřadit, 3 P1/P2, 10 archiv, 2 block, 1 udělej úkol.
  Ověř: hromadné akce, klávesnice-only průchod, filtr-chipy, rychlost přiřazení (počet kliků
  na 1 assign), kolik badge najednou unese seznam.
- **B-03 · Jana:** Přijde „Výzva OP JAK — deadline 15. 7." s PDF. Cíl: P1 vlákno + úkol
  s termínem 14. 7. přiřazený sobě + PDF u úkolu + komentář pro kolegyni. Ověř: předvyplnění
  mini-formuláře (název z předmětu + AI shrnutí), přenos přílohy, kde na úkolu vidím chip
  „z mailu" a zpáteční proklik.
- **B-04 · Filip, EN rozhraní:** Dlouhé vlákno 30 zpráv s americkým hostem. Cíl: přeložit
  poslední zprávu, AI sumarizace vlákna, odpovědět šablonou „Booking confirmation" s +AI
  přizpůsobením, naplánovat odeslání na 9:00 pacifického času. Ověř: překlad vs originál
  toggle, kde žije sumarizace, šablona+AI flow, časová pásma (L-36).
- **B-05 · Adam, večer na iPhonu:** Chce jen zkontrolovat, jestli nehoří nic P1, a jedno
  vlákno posunout kolegovi. Ověř: „P1 jedním pohledem" na mobilu (filtr? sekce?), assign na
  mobilu, kolik ťuknutí; tiché hodiny — co mu vůbec přišlo za notifikace.
- **B-06 · Eva, den 1:** Otevře Mail poprvé. Ověř: prázdný Inbox (co říká?), Gatekeeper se
  zprávami od 20 neznámých odesílatelů — jak pochopí Accept/Block bez školení; kde zjistí,
  ke kterým schránkám má přístup.
- **B-07 · Markéta:** Faktura od nového dodavatele spadla do Newsletters. Najde ji až po
  urgenci telefonem. Ověř: cesta „hledání → našla → přesun do Inboxu → nauč se to" (L-15);
  jak by jí UI MOHLO říct dřív (Notifications badge? digest?).
- **B-08 · Jana:** Odpovídá na vlákno, uprostřed psaní si všimne, že odpovídá za `info@`,
  ale mělo to jít z `granty@`. Ověř: u odpovědi From zamčené (L-10) — jak tedy situaci vyřeší
  (přeposlat? nová zpráva?); UI jí vysvětlí proč.
- **B-09 · Markéta, pátek 16:00 — Dění:** Chce týdenní přehled: „co se tento týden stalo
  v projektu Granty a co udělal Tomáš?" Ověř: filtr osoba + projekt + typ (mail/úkol/ruční),
  seskupení po dnech, proklik z položky do threadu/úkolu. Pak Tomáš přidá ruční příspěvek
  („doplnil jsem zásoby, mimo Watson") a Markéta ho okomentuje. Ověř L-43: kdo ruční
  příspěvek vidí; a Věra (per-thread delegace) otevře Dění — vidí JEN události svých
  delegovaných threadů, nic víc (R5). Nakonec sekce „Nadcházející": naplánovaná odeslání +
  snooze návraty + SLA odpočty se NEdají odkliknout jako úkoly (L-44).
- **B-10 · Šablony end-to-end:** Filip vytvoří týmovou šablonu „Potvrzení bookingu" v
  kategorii Podcast. Tomáš ji o týden později omylem vloží do rozepsané odpovědi na reklamaci
  kávy. Ověř L-49/L-50: našel ji vůbec (hledání, kategorie)? Přepsala mu rozepsaný text?
  +AI přizpůsobení ukázalo náhled a Tomáš poznal, že se to k reklamaci nehodí? Kdo smí
  Filipovu týmovou šablonu upravit — a pozná Tomáš, že edituje šablonu pro celý tým?
- **B-11 · Jana hledá fakturu:** „Ta faktura za nájem ze začátku července, měla PDF přílohu,
  ale nevím, jestli přišla na granty@ nebo info@." Ověř L-51/L-52: složí dotaz
  (`has:attachment before:2026-07-08 faktura`) s nápovědou operátorů; výsledky jen ze
  schránek, kam smí; zvýraznění shody; 0 výsledků stav při překlepu „fakutra". Totéž zkus
  na mobilu (360px) — operátorová nápověda použitelná prstem.

## D2 — Tým & souběh (T)

- **T-01 · Kolize:** Markéta i Tomáš otevřou tutéž novou reklamaci. Markéta píše odpověď,
  Tomáš taky (neví o sobě). Ověř: collision indikátor (nebo M1 fallback — co přesně návrh
  kreslí, L-25); co se stane, když odešlou oba; jak vypadá thread se dvěma odpověďmi.
- **T-02 · Shared draft:** Jana + Adam píší společně odpověď na grantovou výzvu, komentují
  si ji, odeslat smí jen Adam. Ověř: rozdíl shared draft vs interní chat vs komentáře; co vidí
  Jana po odeslání; historie verzí?
- **T-03 · Předání:** Markéta přiřadí vlákno Tomášovi s instrukcí v interním chatu. Tomáš je
  nemocný, druhý den Markéta přeřazuje na Janu. Ověř: notifikace při přiřazení/přeřazení,
  co vidí Jana z historie (chat + kdo už co udělal), SLA během předávání.
- **T-04 · Dispečink:** V `info@` je 7 nepřiřazených, 2 z nich P2 (SLA běží dispečinku).
  Ověř: sekce Nepřiřazené, hromadné přiřazení, kdo dostává SLA notifikace u nepřiřazeného (L-08).
- **T-05 · Interní únik (adversarial):** Tomáš chce napsat do interního chatu „ten klient je
  hrozně otravnej" — ale má otevřený composer odpovědi. Ověř šilhací test L-28: jak moc je
  SNADNÉ splést pole. Kde končí Tab z composeru?
- **T-06 · Věra (scoped):** Adam jí nasdílí JEDEN thread s fakturou. Ověř: co Věra vidí
  (jen ten thread — žádný sidebar plný schránek), může odpovídat? za koho?; co vidí, když jí
  delegace vyprší uprostřed rozepsané odpovědi.

## D3 — Čas, SLA, plánování (S)

- **S-01 · P1 v pátek 17:30:** klient hlásí havárii platby. SLA „do konce prac. dne" — ověř
  L-07 (co ukazuje odpočet), tiché hodiny + P1 override (L-09), eskalace v sobotu?
- **S-02 · „Míč na naší straně":** Jana odpoví na P2 → SLA stop → klient odepíše v úterý →
  urgence se obnoví na P2. Ověř celý životní cyklus VIZUÁLNĚ na kartě i v threadu (odpočet
  zmizí/vrátí se, úkol se odškrtne/reaktivuje — jak vypadá reaktivovaný úkol?).
- **S-03 · Terminál vs realita (past L-02):** Vlákno Hotovo. Klient po týdnu odepíše
  „ještě jedna věc…". Urgence se NEobnoví (by design). Ověř: jak se uživatel o nové zprávě
  vůbec dozví, jaký má thread stav, a jak snadno se stane, že zpráva ZAPADNE (to je přesně
  scénář, proti kterému má být systém „nic nepropadne").
- **S-04 · Send Later změna kontextu:** Filip naplánuje odpověď hostovi na zítra 9:00. Host
  mezitím večer pošle „zapomeňte na to, ruším". Ověř L-33: dozví se Filip PŘED odesláním?
  Kde zruší naplánované z telefonu v 8:55?
- **S-05 · Snooze past:** Markéta snoozne vlákno na čtvrtek. Klient ve středu pošle urgentní
  doplnění. Ověř L-34 (probudí se?) + co když je vzbuzené vlákno zároveň P2 s běžícím SLA.
- **S-06 · Undo Send drama:** Tomáš odešle omluvu s chybným jménem klienta, všimne si v 5. s.
  Ověř: kde je Undo, co se stane po Undo (draft zpět v composeru?), a kombinace
  Send & Mark done → Undo (vrátí se stav? L-30).
- **S-07 · Recurring:** Jana má týdenní připomínku klientům každé pondělí. Klient odpoví
  „už neposílejte". Ověř L-35: kde řadu najde, zastaví, upraví jen příští instanci.
- **S-08 · Follow-up detekce:** Filip poslal nabídku, 7 dní ticho → návrh follow-upu.
  Ověř: jak návrh vypadá (karta v Nadcházejícím? badge?), jak se liší od SLA, odmítnutí návrhu.

## D4 — Sféry & soukromí (P)

- **P-01 · Ranní káva:** Adam si u kávy čte osobní gmail (doktor, škola dětí) a pak plynule
  přejde do `info@`. Ověř: přechod osobní ↔ týmová (kolik kroků, jak VÝRAZNĚ se změní kontext),
  marker soukromí všude (D-10), a že osobní zprávy nejsou ve sjednoceném Inboxu — nebo jsou,
  dle zvoleného řešení L-17 (audit KONZISTENCE).
- **P-02 · AI hranice:** Adam v osobním gmailu chce sumarizovat dlouhý mail od právníka.
  AI tam NENÍ. Ověř L-18: jak UI absenci komunikuje, aniž by lhalo nebo ukazovalo mrtvá tlačítka.
- **P-03 · Úkol z osobního:** Adam si z mailu od instalatéra udělá úkol „zavolat zpět".
  Ověř L-19: nabídka projektů obsahuje JEN osobní prostor; úkol v osobním inboxu s chipem
  „z mailu" — a týmoví kolegové ho nevidí.
- **P-04 · Admin pokušení (adversarial):** Markéta (admin) v access matrix hledá Adamův osobní
  gmail. Ověř L-48: NIKDE ani řádek. Pak zkusí fulltext hledání — osobní výsledky se jí nesmí
  ukázat ani jako „zamčené".
- **P-05 · Mobilní přepínač:** Tomáš na mobilu přepíná Mail ↔ Práce (top-level). Ověř R-07:
  přepínač najde napoprvé; rozepsaný draft přežije; badge logika (L-21).
- **P-06 · Karel (host):** dostane od Markéty deep link na thread („mrkni na to"). Ověř L-22:
  co uvidí — žádné jméno threadu, žádné „požádej o přístup" se jmény schránek; ideálně
  neutrální „tento odkaz pro tebe nic neobsahuje".

## D5 — Admin & přístupy (A)

- **A-01 · Onboarding schránky:** Adam připojuje `studio@t-group-dance.cz` (IMAP, exotický
  hosting). Zadá špatný port → fail → opraví → connected. Ověř L-45: chybové hlášky řečí
  ne-vývojáře, test připojení, health tečka po připojení.
- **A-02 · Nová kolegyně:** Eva nastupuje — Adam jí kartou osoby dá `info@` (plný agent) +
  `granty@` (scoped: jen thready projektu X, expirace 31. 12.). Ověř L-46: least-privilege
  náhled („co tento grant přidá"), viditelná expirace, Evin první pohled na Mail poté.
- **A-03 · Offboarding s następky:** Petr odchází. Má: 12 přiřazených threadů, 2 shared
  drafts, 3 naplánovaná odeslání, VIP seznamy. Ověř L-47: karta osoby ukáže NÁSLEDKY revoke
  („12 threadů osiří → přeřadit na…") — ne jen tlačítko „odebrat vše".
- **A-04 · Token vypršel:** `podcast@` přestane synchronizovat v pátek. Ověř ST-07: kdo se
  to dozví (admin health + uživatelé schránky?), co vidí Filip u schránky, CTA.
- **A-05 · Duplicitní připojení:** Adam omylem připojí `info@` podruhé. Ověř L-45: wizard
  to pozná? Dvojité thready?

## D6 — Mobil & responzivita (M)

- **M-01 · 4 vrstvy na 390px:** Tomáš otevře thread s během: 6 zpráv + interní chat s 2
  instrukcemi + potřebuje odpovědět. Ověř R-03: přepínání vlákno/chat, composer nad klávesnicí
  (R-04), akční lišta dostupná, nic nepřekrývá Odeslat.
- **M-02 · Swipe konfigurace:** Tomáš si nastaví velký swipe vpravo = Hotovo. Pak na iOS
  swipne od levé hrany (chce zpět) — ověř R-08 kolizi; a omylem swipne Hotovo na P1 vláknu —
  undo toast?
- **M-03 · Hranice 880:** Markéta na tabletu otočí ze širokého (split) na úzký (stack)
  UPROSTŘED psaní odpovědi. Ověř: draft přežije, kurzor zůstane, layout se nerozsype (R-05, ±1px).
- **M-04 · Alena, 200 % zoom:** celý flow B-02 (triage) při 200 % na 1280px (efektivně 640px).
  Ověř P-05: reflow, žádný horizontální scroll, badge čitelné.
- **M-05 · Klávesnice-only:** Alena bez myši: otevřít thread → přiřadit → odpovědět → odeslat.
  Ověř P-02: focus management (kam skočí focus po archivaci threadu?), zkratky (K-04).
- **M-06 · Ultrawide:** Adam na 3440px: 3 panely + composer okno + chat. Ověř R-06 + C-01
  (délka řádku), a že composer okno nejde „ztratit" za panelem.
- **M-07 · PWA offline vlak:** Markéta v tunelu otevře Mail (online-only!). Ověř ST-02:
  co přesně vidí; přepne na Úkoly — fungují; vrátí se — Mail se zotaví bez reloadu.

## D7 — Extrémy & zátěž (E)

- **E-01 · Návrat z dovolené:** Filip po 3 týdnech: 2 400 nepřečtených, 40 čekajících
  v Gatekeeperu, 6 prošlých SLA, 12 snooze návratů najednou. Ověř: čím UI ZAČNE (priorizace
  vs zeď), hromadné akce přes stránky („vybrat vše" = kolik?), výkon seznamu (virtualizace
  aspoň implikovaná), „označit vše jako viděné" v Notifications.
- **E-02 · Megavlákno:** 120 zpráv, 5 účastníků, 3 jazyky, 15 příloh. Ověř: sbalení,
  Expand all výkon, hledání UVNITŘ vlákna, překlad celého vlákna, sumarizace, skok na
  konkrétní přílohu.
- **E-03 · Příloha z pekla:** Jana přikládá 25MB výkres + 30MB video (fail) + inline foto.
  Ověř L-31: limity řečené PŘEDEM, částečný fail (2 z 3 prošly), odeslat bez failnuté?
- **E-04 · Dark mode newsletter:** Filip v dark modu otevře marketingový HTML mail s bílým
  pozadím natvrdo + obrázky vypnuté (C-09). Ověř D-09: čitelnost, tlačítko „načíst obrázky",
  „zobrazit v původní podobě".
- **E-05 · Bounce:** Tomášova schválená omluva se vrátí jako nedoručitelná (překlep v adrese).
  Ověř ST-06: kde se o tom dozví TOMÁŠ (ne jen schránka), jak opraví a znovu odešle; stav
  threadu (bylo „Odesláno"…).
- **E-06 · Notifikační bouře:** Pondělí 9:00, do `info@` přijde 30 mailů za 5 min + 3 @zmínky
  + 1 eskalace. Ověř L-42: grupování, pořadí důležitosti (eskalace > zmínka > nový mail),
  notifikační centrum to unese.
- **E-07 · Bez předmětu, bez těla:** přijde zpráva bez předmětu s jedinou přílohou .ics
  (pozvánka). Ověř C-05 + jak mail zachází s kalendářní pozvánkou (aspoň důstojný fallback).
- **E-08 · 0 schránek:** Uživatel, kterému admin ještě nedal žádný grant, klikne na Mail.
  Ověř: prázdný stav vysvětlí PROČ nic nevidí a CO dál (za kým jít) — bez porušení
  „co nevidíš, neexistuje" u konkrétních schránek.

## D8 — Adversarial / rozpory specifikace (X) — tady to MÁ prasknout

- **X-01 · Sjednocený Inbox vs sféry:** (viz L-17) Projdi P-01 a schválně hledej JEDNU
  obrazovku, kde se osobní a týmová zpráva potkají v jednom seznamu (unified inbox, hledání,
  Dění, notifikační centrum, badge součty). Každé nalezené smíchání bez markeru = S0.
- **X-02 · Pin vs P1:** Připni P4 vlákno a zároveň měj nepřipnuté P1. Co je „nahoře"? Co
  z toho je „priorita"? (L-04) Vysvětlí to UI, nebo má systém dvě hlavy?
- **X-03 · Hotovo + nová zpráva:** (S-03/L-02) — cíleně zkoumej, jestli „nic nepropadne"
  přežije vlastní terminální pravidlo.
- **X-04 · SLA vs schvalování:** Tomáš (junior) odpoví na P1 včas, ale Markéta schválí až po
  SLA. Kdo „porušil SLA"? Co vidí admin v eskalaci? (L-06b)
- **X-05 · SLA vs Send Later:** Jana „odpoví" na P2 pomocí Send Later na příští týden. SLA
  stojí, nebo běží? (L-06a) Ať to dopadne jakkoli — je to VIDĚT?
- **X-06 · Auto-úkol vs kolega:** P1 úkol „Odpovědět" má Tomáš; odpoví Markéta. Tomášův úkol
  se sám odškrtne — Tomáš ráno vidí odškrtnutý úkol, který nedělal. Jak UI vysvětluje „kdo
  to zavřel"? (L-05)
- **X-07 · Gatekeeper vs P1:** Nový odesílatel = klíčový klient z nové domény napíše havárii.
  Zpráva stojí ve Screeneru. Běží SLA? Přijde notifikace? Nebo systém „nic nepropadne"
  právě propustil díru? (L-13)
- **X-08 · Assign bez přístupu přes zadní vrátka:** Markéta chce přiřadit fakturu účetní
  Věře, která nemá grant na `info@`. UI ji v nabídce nemá (správně) — jak tedy Markéta úlohu
  PŘEDÁ? (sdílení threadu / per-thread delegace — je ta cesta v UI, nebo je to slepá ulička?)
- **X-09 · Důvěrný režim vs týmovost:** Jana pošle důvěrný mail (nelze přeposlat/kopírovat)
  ze sdílené schránky. Kolegové s přístupem ke schránce ho vidí? Smí ho vidět? Assign na něm?
- **X-10 · „Co nevidíš, neexistuje" vs vysvětlitelnost:** Věře vyprší delegace → thread jí
  zmizí. Věra: „kam se mi ztratil ten mail?!" Jak UI balancuje neexistenci vs zoufalství
  uživatele? (aspoň neutrální stopa „obsah už není dostupný" v jejích rozepsaných věcech?)
- **X-11 · Jazyková past:** Markéta má EN rozhraní, Tomáš CZ. Sdílené koncepty/stavy threadu
  („Waiting internally" vs „Čeká interně") — stav je datový, ne textový? Screenshot obou verzí.
- **X-12 · AI navrhne nesmysl:** AI Triage předpřiřadí P1 reklamaci... editorovi podcastu
  Filipovi (špatně). Admin schválí dávku bez čtení (E-01 únava). Ověř L-38: jak snadné je
  schválit slepě + jak těžké je pak najít a vrátit JEDEN špatný krok.

---

# ČÁST E — Zero-trust re-verifikace Kola 1

> Kolo 1 prošlo. Dobře. Teď to dokaž.

- **E-01 Důkazní tabulka:** pro každé kritérium části A vyplň: ID · odkaz na obrazovku/stav ·
  light ✅ / dark ✅ · CZ ✅ / EN ✅ · mobil ✅ / desktop ✅. Neúplný řádek = OPEN.
- **E-02 E-ALWAYS (re-verifikace 100 %, bez losování)** — všechna S0-třídy kritéria:
  **D-10** (marker soukromí) · **L-10** (From zamčené) · **L-17** (unified inbox × sféry) ·
  **L-19** (úkol z osobního jen osobní) · **L-22** (host + deep link) · **L-23** (assign jen
  s přístupem) · **L-37** (AI nikdy neodesílá) · **L-48** (osobní mimo admin matici) ·
  **L-50** (šablona nepřepíše draft) · **L-52** (hledání bez úniku metadat) · **SEC-01**
  (žádné „E2E") · **SEC-04** (žádné credentials v UI) · **ST-02** (offline) · **ST-03**
  (draft nikdy nezmizí) · **ST-04** (fail odeslání viditelný) · **R-01** (320 px) ·
  **P-02** (klávesnice) · **X-01** (smíchání sfér).
- **E-03 Negativní důkaz:** u guardrailů nestačí „je to nakreslené správně" — auditor musí
  aktivně HLEDAT obrazovku, kde je guardrail porušen (např. jakékoli místo v celém návrhu,
  kde se dá změnit From; jakýkoli seznam, kde se potká osobní a týmová položka). Nenajde-li,
  napíše, KDE VŠUDE hledal.
- **E-04 Losování:** 15 náhodných kritérií mimo E-ALWAYS (uveď vylosovaná ID) → hloubková
  re-verifikace dle pravidla 9 metodiky.

---

# ČÁST F — Interakční matice modulů (kombinace, které Kolo 1 netestovalo)

> Pravidlo: **každá dvojice funkcí, která se může potkat na jednom threadu, musí mít
> definovaný výsledek.** Prázdná buňka matice = NEDEF = S1 (S0, křížíli guardrail).
> Auditor sestaví plnou matici *akce × akce* a *akce × stav threadu* (akce: Pin · Snooze ·
> Set Aside · Archiv · Koš · Spam · Block · Assign · Hotovo · P1–P4 · Send Later · Důvěrný ·
> Email→úkol · Shared draft · Schválení) a odevzdá ji vyplněnou. Níže povinné minimum —
> 28 kombinací, kde to bolí nejvíc:

- **F-01 Snooze × Assign:** přiřazený si thread snoozne. Vidí ho dispečink? Běží SLA?
  Markéta neví, že Tomáš „schoval" P2.
- **F-02 Snooze × eskalace:** snoozlé vlákno poruší SLA — probudí se? Eskalace odejde
  adminovi, i když vlákno „spí"?
- **F-03 Send Later × offboarding:** Petr má 3 naplánovaná odeslání za `info@` a v úterý
  dostane revoke. Odejdou zprávy ve čtvrtek? (odeslání za identitu, na kterou už nemá právo
  = **S0**, pokud odejdou bez rozhodnutí admina).
- **F-04 Send Later × schvalování:** junior naplánuje odeslání na pondělí 8:00 — schvaluje
  se PŘED plánovaným časem, nebo zpráva čeká? Co když schválení přijde v 8:05?
- **F-05 Send Later × Undo Send:** liší se „zrušit naplánované" od „undo po odeslání"?
  Obě cesty v UI?
- **F-06 Gatekeeper × VIP:** nový odesílatel je na VIP seznamu (přidán ručně předem) —
  obchází screener?
- **F-07 Gatekeeper × AI Triage:** smí AI číst a předtřídit zprávy, které člověk ještě
  nepustil přes clonu? (pořadí bran definované?)
- **F-08 Důvěrný režim × Email→úkol:** příloha důvěrné zprávy připnutá k úkolu = obejití
  zákazu kopírování? Blokovat, nebo povolit s auditem — ale VIDITELNĚ.
- **F-09 Důvěrný režim × sdílená schránka × Dění:** událost „Jana poslala důvěrnou zprávu"
  ve feedu — kolik z obsahu smí feed ukázat?
- **F-10 Recurring × bounce:** týdenní řada narazí na nedoručitelnou adresu — běží dál
  tiše? (3× bounce → pauza + notifikace?)
- **F-11 Recurring × Hotovo:** thread s běžící řadou označen Hotovo (terminál) — řada
  pokračuje? (rozpor „terminální stav" × „bude to psát dál")
- **F-12 Pin × Archiv:** připnutý thread archivován (L-54) — zůstává připnutý v archivu?
  Zmizí z Pinned? Napříč zařízeními stejně?
- **F-13 Assign × Set Aside:** přiřazený si odloží vlákno do odkladiště bez termínu —
  dispečink vidí „odloženo", nebo to vypadá jako práce v běhu? SLA?
- **F-14 Interní chat × offboarding:** Petrovy zprávy v interním chatu po revoke — zůstávají
  se jménem (audit) — a deep linky z nich na thready, kam už nový čtenář nesmí?
- **F-15 Shared draft × Undo Send:** kdo smí stisknout Undo — jen odesílající, nebo každý
  spoluautor? Vrácený draft je zase sdílený?
- **F-16 Collision × schvalování:** dva junioři pošlou ke schválení dvě různé odpovědi na
  týž thread — schvalovatel obě vidí VEDLE SEBE s varováním o duplicitě?
- **F-17 Překlad × odpověď:** odpovídám na přeloženou zprávu — citace v odpovědi je
  originál, nebo překlad? (překlad odeslaný klientovi = potenciální faux pas)
- **F-18 Scoped přístup × sumarizace/hledání:** Věra vidí thread až od data delegace —
  AI sumarizace a hledání pracují JEN nad tím, co smí vidět (jinak únik = **S0**).
- **F-19 Per-účet „Žádné" × eskalace SLA:** eskalace přebíjí ztlumený účet? (přiřazenému
  P1 ano — a je to v nastavení řečeno?)
- **F-20 Block × běžící SLA:** zablokuju odesílatele s otevřeným P2 vláknem — SLA/úkol
  „Odpovědět" se zruší? Zůstane sirotek?
- **F-21 Email→úkol × Koš:** thread smazán, úkol s chipem „z mailu" žije — proklik vede
  kam? (důstojný náhrobek, ne 404)
- **F-22 Spam × „nic nepropadne":** legitimní P1 spadne do Spamu — které záchranné sítě
  přežily? (Spam se nescreenuje, nenotifikuje, nepočítá — je to jediná složka, kde smí věc
  zapadnout? Řečeno explicitně?)
- **F-23 Pin + Snooze + Set Aside současně:** smí thread nést všechny tři? Co vyhrává
  v řazení a viditelnosti? (matice stavů!)
- **F-24 Hledání × důvěrný režim:** fulltext indexuje obsah důvěrných zpráv? Pro koho?
- **F-25 Dva příjemci = jedna zpráva:** mail poslaný současně na `info@` i `granty@` —
  jeden thread ve dvou schránkách? Dva nezávislé thready? Odpověď z jedné — vidí to druhá?
  (deduplikace + dvě From identity = nejtvrdší kombinace identity vůbec)
- **F-26 Reply-all × Bcc:** odpovídám všem na zprávu, kde jsem byl v Bcc — varování, že se
  právě prozradím?
- **F-27 Mail↔Práce přepínač × deep link:** z úkolu (Práce) kliknu na chip „z mailu" na
  mobilu — přepne mě to top-level přepínačem do Mailu a ZPĚT se vrátím kam?
- **F-28 Šablona × podpis × identita:** šablona vložená do composeru za `granty@` — nese
  vlastní rozloučení, podpis se zdvojí? (šablona + podpis = klasický dvojitý „S pozdravem")

---

# ČÁST G — Maratonové scénáře (řetězené, multi-modulové)

> Kolo 1 testovalo momentky. Kolo 2 testuje ČAS. Auditor vede deník: u každého kroku
> zapíše stav threadu · kartu v seznamu · badge · záznam v Dění · notifikace · audit trail.
> Jediný krok, kde tyto vrstvy nesouhlasí (karta říká Hotovo, Dění říká Otevřený) = S1.

- **G-01 · Život jednoho vlákna (21 dní):** reklamace od nového odesílatele: Gatekeeper →
  Accept → Inbox → Markéta: P2 + assign Tomáš → interní chat instrukce → Tomáš: shared
  draft → Markéta: vrací s komentářem → Tomáš: oprava → schváleno + odesláno → SLA stop →
  klient odpoví (urgence obnovena P2) → Tomáš nemocný → přeřazeno na Janu → Jana: email→úkol
  (náhrada zboží) + odpověď → Hotovo → o 6 dní později klient: „ještě něco" (terminál! S-03)
  → ruční rozhodnutí → archiv. **Výstup: tabulka 18 kroků × 6 vrstev.** Každá díra = nález.
- **G-02 · Krizový den:** výpadek plateb, 9:00–12:00: 25 P1/P2 mailů do `info@`, 3 lidé
  online, 2 kolize, 1 eskalace na admina, hromadná odpověď šablonou 10 klientům, quiet-hours
  override u nočního dozvuku. Sleduj: čím UI začne (priorizace vs zeď), notifikační hygiena
  (L-42 pod palbou), dispečink jako velín — a jestli po krizi zůstal konzistentní stav
  (0 sirotků: úkoly bez threadů, SLA bez přiřazených).
- **G-03 · Firma od nuly (30 dní):** den 0: super-admin připojí 4 schránky (1× IMAP fail),
  pozve 8 lidí, granty, persony/oblasti, AI agenti (2× Triage, 2× Read, zbytek Off) →
  den 1: Gatekeeper prázdné firmy (vše je „nový odesílatel"!) → den 7: první eskalace →
  den 14: offboarding brigádníka → den 30: admin čte analytics/SLA plnění. Ověř: admin
  modul funguje **v čase**, ne jako izolovaná obrazovka; každý den má definované UI.
- **G-04 · Tomášův týden (jen mobil, 360 px):** 5 pracovních dní nejslabšího uživatele:
  denní rutina jen swipe + schvalování. **Měř ťuknutí** na denní úkon (otevřít → přečíst →
  odpovědět šablonou → poslat ke schválení → zavřít): >12 ťuknutí = S2, >18 = S1.
  Zaznamenej každé místo, kde si Tomáš může NEVĚDOMKY něco rozbít (swipe Hotovo na P1) —
  a jestli se dozví, že se to stalo (undo toast všude?).
- **G-05 · Migrace ze Sparku (2 týdny paralelního provozu):** tým odpovídá půl ve Sparku,
  půl ve Watsonu (realita přechodu!): dvojité odpovědi na tentýž mail — jak Watson ukáže,
  že „odpovězeno jinde"? Spark návyky bez ekvivalentu: „Mark as Done" neexistuje — kde UI
  vysvětlí náhradu (stav Hotovo)? Historie 10k starých mailů: import/readonly/nic — řečeno?

---

# ČÁST H — Chaos & selhání (failure injection)

> Pravidlo: pro KAŽDÝ vícekrokový flow (odeslání · schválení · assign · připojení schránky ·
> email→úkol · šablona+AI) auditor přeruší **každý jednotlivý krok**: pád spojení / zavření
> tabu / vypršení tokenu / revoke práv uprostřed. Po zotavení platí tři zákony:
> **žádná ztráta dat · žádný dvojitý efekt · stav je jednoznačně čitelný.** Porušení = S0/S1.

- **H-01** Síť spadne mezi stiskem „Odeslat" a potvrzením: odešlo, nebo ne? UI musí umět
  říct „ověřuji…" — tiché riziko dvojitého odeslání klientovi = **S0**.
- **H-02** Revoke grantu s otevřeným composerem (tvrdší X-10): rozepsaný text se nesmí
  ztratit bez stopy — export/kopie do schránky aspoň jednou cestou.
- **H-03** Schvalovatel smaže/zamítne draft PŘESNĚ ve chvíli, kdy ho junior edituje.
- **H-04** Kolega archivuje/označí Hotovo thread, který právě čtu a píšu do něj odpověď.
  Můj composer: zavře se? žije dál? co uvidím při odeslání?
- **H-05** Přechod na letní čas × běžící SLA odpočet × Send Later „zítra 9:00" (existuje
  2:30 ráno dvakrát/vůbec — ukáže UI správné časy?).
- **H-06** API vrací 500 uprostřed triage: degradace s vysvětlením a retry, ne bílá stránka;
  rozpracované akce (3 archivace ve frontě) — co s nimi?
- **H-07** Tentýž uživatel, dvě zařízení: draft začne na desktopu, pokračuje na mobilu —
  konflikt verzí draftu má UI (poslední vyhrává? volba?), ne tichý přepis.
- **H-08** Hodiny klienta rozjeté o +15 min: „před −14 minutami" se nesmí objevit; SLA
  odpočet ze serveru, ne z lokálních hodin (aspoň deklarace v handoffu).
- **H-09** Upload 3 příloh, druhá selže, uživatel mezitím stiskl Odeslat.
- **H-10** OAuth token schránky vyprší BĚHEM psaní odpovědi za tuto schránku: dozvím se to
  před stiskem Odeslat, nebo až failem?

---

# ČÁST I — Výkon & datové limity (tvrdá čísla, deklarovaná v návrhu)

> Design nemusí být benchmark, ale MUSÍ ukázat strategii: virtualizace, stránkování,
> skeleton, agregace. „Ono to nějak pojede" = NEDEF = S1.

- **I-01** Inbox **50 000 threadů**: otevření s obsahem < 1 s (skeleton okamžitě), plynulý
  scroll ⇒ virtualizace ⇒ **konstantní výška karty per hustota** — variabilní výška karet
  rozbíjí virtualizaci: návrh to musí vědět (odznaky nesmí kartu nafukovat).
- **I-02** Thread **500 zpráv**, jedna zpráva **10 MB HTML**, 100 příloh ve vláknu:
  postupné načítání, „zobrazit celou zprávu" práh.
- **I-03** Sub-sidebar **100 schránek** (agentura!): skupiny, scroll, hledání schránky;
  badge **9 999+** formát.
- **I-04** Hledání nad **200k zpráv**: průběžný stav („prohledávám…"), částečné výsledky,
  zrušitelnost.
- **I-05** Access matrix **50 lidí × 100 schránek** = 5 000 buněk read-only přehledu:
  jak se VEJDE (zoom? filtr? sekce?).
- **I-06** Dění **2 000 událostí/den**: stránkování, digest, „od posledně" značka.
- **I-07** Našeptávač **10 000 kontaktů**: latence, řazení (frekvence > abeceda), duplicitní
  jména.
- **I-08** Unicode tortura v seznamu: zalgo text, RTL+LTR mix, emoji-only předmět,
  1000znakové slovo bez mezer, `<script>` jako literál v předmětu (escapování — zobrazí se
  jako text, nikdy nespustí!) = **S0** při selhání.
- **I-09** Notifikační centrum po týdnu ignorování: 800 položek — agregace, „označit vše",
  výkon.

---

# ČÁST J — Připravenost k implementaci (handoff gate)

> Krásný návrh ≠ stavitelný návrh. Bez těchto 10 artefaktů se NEZAČÍNÁ stavět.

- **J-01 Kompletní stavy komponent:** každá nová komponenta má enumerováno default / hover /
  focus / active / loading / error / prázdná — **plus psané pravidlo, kdy se prvek skrývá
  („co nevidíš, neexistuje") a kdy smí být disabled** (výjimky odůvodněné).
- **J-02 Tokeny:** žádná hodnota mimo `--w-*`; nové mailové tokeny pojmenované a vypsané
  v tabulce (název · light · dark · použití), ne „hex zamčený v obrázku".
- **J-03 Redlines vlajkových obrazovek:** spacing/rozměry na mřížce (8pt?), min/max šířky
  panelů, breakpointy s chováním děliče.
- **J-04 Interakční spec:** Enter/Esc v každém modalu · tab-order Thread workspace ·
  **kam jde focus po každé destruktivní akci** (archiv, hotovo, block) · dlouhý stisk/kontext
  menu na mobilu.
- **J-05 Motion spec:** trvání + easing pro snooze/archiv/collision pulz/undo toast +
  reduced-motion varianta každé animace.
- **J-06 Textový inventář:** všechny UI stringy CZ+EN v tabulce (žádný text jen v obrázku),
  **včetně českých plurálů** (1 zpráva / 2 zprávy / 5 zpráv) a všech chybových hlášek
  z části H.
- **J-07 Prázdné/chybové stavy** jako dodané artefakty v obou tématech (ne „doplní se").
- **J-08 Komponentní mapa:** co je reuse z Watsonu (TaskCard, chipy, modaly…) vs nová
  komponenta — každá NOVÁ s jednovětým odůvodněním, proč nestačí existující.
- **J-09 Fázová mapa M1/M2/M3:** každá obrazovka označená fází — a **M1 obrazovky nesmí
  stát na M2/M3 prvcích** (collision, SLA odpočty, AI): pro každou vlajkovou obrazovku
  existuje nakreslená **M1 varianta bez nich** (ne „vygumujeme to pak").
- **J-10 Stavové diagramy jako artefakt:** thread (Nový→…→Hotovo) + urgence (baseline/aktivní/
  terminál) + schvalování (draft→čeká→vráceno/schváleno→odesláno) — nakreslené diagramy,
  ne próza. Diagram musí souhlasit s každou obrazovkou (křížová kontrola).

---

# ČÁST K — Release gate (definice „připraveno")

> Tři brány. Verdikt každé: **READY / READY s podmínkami (vyjmenované) / NOT READY (top
> blockery).** Bez projití brány se nepokračuje k další.

**K-G1 — Design complete:**
- 0× S0 · 0× S1 na vlajkových · ≤5× S1 celkem (s plánem opravy) ·
- 0 nerozhodnutých NEDEF (všechny eskalované uživateli s návrhem řešení) ·
- stavová matice (část B) 100 % ✅/N/A · interakční matice (část F) bez prázdných buněk ·
- důkazní tabulka (E-01) kompletní · část J: 10/10 artefaktů.

**K-G2 — M1 ready:**
- všechny M1 obrazovky samostatně funkční bez M2/M3 prvků (J-09 ověřeno obrazovku po
  obrazovce) · chaos testy H-01–H-10 mají pro M1 flows definované chování ·
- offline stav (ST-02) a všechny fail stavy odeslání (ST-04, H-01) nakreslené — M1 je
  přesně ta fáze, kde budou selhání nejčastější.

**K-G3 — Pilot ready (tým 15–30 lidí smí dovnitř):**
- maratony G-01–G-05 projdou bez S1 · přístupnost P-01–P-07 bez výjimek (Alena = plnohodnotný
  člen pilotu, ne „edge case") · výkonnostní strategie I-01–I-09 deklarované v handoffu ·
- Tomášův metr (G-04): denní rutina ≤12 ťuknutí · onboarding Evy (B-06) bez lidské asistence.

---

# ČÁST L — Výstupní protokol auditu (co má Claude Design odevzdat)

1. **Souhrnná tabulka nálezů:** ID · obrazovka · kritérium/scénář · popis · severita ·
   doporučená oprava (1–2 věty). Seřazeno S0 → S3, NEDEF zvlášť, OPEN (neprokázané PASS) zvlášť.
2. **Stavová matice (část B) vyplněná** — ✅/⚠️/❌ s odkazy na obrazovky.
3. **Verdikt per obrazovka:** PASS / PASS s výhradami / FAIL (+ důvod dle pravidla 5 metodiky).
4. **Top 10 nejzávažnějších nálezů** s návrhem řešení — jako první kandidáti na iteraci.
5. **Seznam NEDEF** (mezery specifikace) — k rozhodnutí uživatelem, NE k tichému dokreslení.
6. **Co prošlo na výbornou** (max 5 bodů — ať víme, čeho se držet).

**Kolo 2 navíc odevzdává:**

7. **Důkazní tabulka re-verifikace (E-01)** + vylosovaná ID a výsledek losování (E-04) +
   zpráva o negativním důkazu guardrailů (E-03: „kde všude jsem hledal porušení").
8. **Vyplněná interakční matice (část F)** — akce × akce, akce × stav; F-01–F-28 s verdikty.
9. **Deníky maratonů (část G)** — u G-01 povinně tabulka „krok × 6 vrstev" (stav · karta ·
   badge · Dění · notifikace · audit); u G-04 naměřený počet ťuknutí denní rutiny.
10. **Výsledky chaos testů (část H)** — H-01–H-10, každý s verdiktem proti třem zákonům
    (ztráta dat / dvojitý efekt / čitelnost stavu).
11. **Handoff checklist (část J)** — 10 artefaktů, u každého ✅/❌ + odkaz.
12. **Release gate verdikt (část K)** — K-G1/K-G2/K-G3, každá brána READY / READY
    s podmínkami / NOT READY s vyjmenovanými blockery. **Tohle je poslední věta auditu.**

> Připomínka auditorovi: jsi přísný, ne krutý — každý nález má návrh opravy. Ale žádný
> nález nezamlčíš, protože „to se nejspíš myslelo dobře". Nakresleno ≠ vyřešeno; vyřešeno =
> nakresleno pro všechny stavy, obě témata, oba jazyky a všechny šířky.

---

# PŘÍLOHA — Mapa pokrytí modulů (brief `BRIEF_mail_moduly_2026-07-08.md`)

> Kontrola úplnosti: každý modul briefu → která kritéria a scénáře ho testují.
> Auditor NEsmí modul přeskočit; pokud pro některý řádek nenajde v návrhu obrazovky,
> je to samostatný nález (NEDEF za celý modul).
>
> **Kolo 2 (části E–K) je průřezové:** re-verifikace, interakční matice, maratony, chaos,
> limity a release gate se vztahují na VŠECHNY moduly současně — mapují se přes kombinace
> (část F) a řetězené scénáře (část G), ne po jednom modulu.

| Modul | Kritéria | Scénáře |
|---|---|---|
| 1 · Shell & layout | D-11 · K-02 · R-01–R-09 · ST-05 | M-01–M-07 · B-05 |
| 2 · Účty, sféry & identita | D-03 · ST-07 · L-10–L-12 | B-08 · A-04 · P-01 |
| 3 · Schránka & triage | D-06 · L-13–L-16 | B-02 · B-06 · B-07 · E-01 · X-07 |
| 4 · Thread workspace | D-07 · C-08 · L-01–L-09 | S-01–S-03 · M-01 · E-02 · X-02–X-06 |
| 5 · Composer | ST-03 · ST-04 · R-04 · L-29–L-31 | S-06 · E-03 · E-05 · B-08 · T-05 |
| 6 · Spolupráce & dispečink | L-23–L-28 | T-01–T-06 · X-04 · X-06 · X-08 |
| 7 · Plánování | L-33–L-36 · L-44 | S-04–S-08 · X-05 |
| ⊕ Dění (průřezový) | L-43 · L-44 | B-09 |
| ⊕ Osobní vs týmová sféra | D-10 · L-17–L-22 · L-48 · SEC-01 | P-01–P-06 · X-01 · X-10 |
| 8 · AI vrstva | L-37–L-40 | B-04 · P-02 · X-12 |
| 9 · Šablony | L-49 · L-50 | B-10 · B-04 |
| 10 · Email → úkol & entity graf | L-03 · L-05 · L-19 | B-03 · P-03 · X-06 |
| 11 · Notifikace | L-09 · L-41 · L-42 | E-06 · B-05 · S-01 |
| 12 · Swipe & zkratky | R-08 · K-04 · P-02 · P-03 | M-02 · M-05 |
| 13 · Nastavení | K-05 · C-09 · L-54 · L-55 | M-02 (Swipes) · B-05 (notifikace) · E-04 (obrázky) |
| 14 · Gmail nadstavba | L-32 · L-51–L-53 | B-11 · X-09 · E-02 |
| 15 · Admin & onboarding | L-45–L-48 · SEC-04 · SEC-05 | A-01–A-05 · P-04 |
| ⊕ Designový jazyk & barvy | celá A1 + A2 | průřezově všechny |
