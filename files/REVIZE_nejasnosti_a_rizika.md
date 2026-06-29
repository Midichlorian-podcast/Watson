# REVIZE — nejasnosti, rozpory a rizika (Watson)

> Kontrolní průchod celým balíkem před stavbou. Řazeno podle závažnosti. U každého bodu je **problém**, **doporučené řešení** a značka **[→ Qx]**, pokud potřebuje tvoje rozhodnutí (dotazník `konfigurator_revize.html`).

---

## 1. SHOWSTOPPERY (můžou zenfunkčnit celý systém)

**S1 · Per-projekt Google kalendář — čí účet a kolik kalendářů? [→ Q7, Q8]**
Řekli jsme „každý projekt = vlastní Google kalendář, obousměrně". Jenže projekt má víc členů, každý se svým Google účtem. Není jasné: existuje **jeden kanonický kalendář na projekt** (v jednom týmovém účtu), nebo se projekt **zrcadlí do Google kalendáře každého člena**? Druhá varianta násobí obousměrný sync počtem členů (smyčky, duplicity) a u 15–30 lidí × mnoha projektů naráží na **limity Google API** (počet kalendářů, watch kanály, kvóty) a zaplácne lidem Google kalendář desítkami položek. *Riziko, že kalendář bude křehký nebo nepoužitelný.*
**Doporučení:** v MVP **jeden sdílený kalendář na projekt** (v týmovém Google účtu), členové ho vidí; plná per-uživatel obousměrnost až v2 po ověření limitů. Zvážit start jednosměrně (Watson → Google) a obousměrně dotáhnout v2.

**S2 · Dva synchronizační systémy zároveň (PowerSync + Yjs) [→ Q1]**
Návrh počítá s PowerSync (data) **i** Yjs/CRDT (text). To jsou **dvě nezávislé offline-sync vrstvy** s jedním offline příběhem — velká složitost a zdroj chyb. Navíc **komentáře píše jeden autor** — co-editaci v reálném čase nepotřebují; ta dává smysl až u **sdílených dokumentů (v2)**.
**Doporučení:** v MVP **žádné CRDT** — popisy i komentáře jako **prostý text (Markdown) přes PowerSync** (LWW). Yjs zavést až s kolaborativními docs ve v2.

**S3 · Offline zápis vs. serverové vynucení oprávnění [→ souvisí Q5]**
Offline-first znamená optimistický zápis na klientu. Když klient offline udělá akci, na kterou nemá právo (např. zastaralá role), server ji **musí odmítnout** a klient **vrátit** — a to uživateli vysvětlit. Tahle „rollback po odmítnutí" cesta není navržená. U **plně vlastních rolí** je to ještě horší: dynamická oprávnění se těžko vyjadřují v PowerSync sync rules a těžko vynucují při zápisu.
**Doporučení:** navrhnout explicitní rollback UX; pro MVP/early **bohatší přednastavené role** místo plně dynamických (stabilnější vůči sync enginu).

**S4 · MVP je příliš velký → riziko, že se nikdy nedotáhne [→ Q12]**
„MVP" teď obsahuje: 4 metody přihlášení + 2FA, workspaces+role+restricted+hosté, plný model úkolů (3 vrstvy, 2 režimy přiřazení, barvy, globální štítky), 3 pohledy, **obousměrný per-projekt kalendář**, připomínky, digest, komentáře, **přílohy+verze+hlasovky**, AI quick add, **offline-first sync**, real-time, PWA, **tablet split-view**, CZ+EN, audit, zálohy, fulltext, hromadné akce. Pro „Claude Code + ty" a „kvalita > rychlost" je to **mnohaměsíční** kus, na kterém má denně viset 15–30 lidí.
**Doporučení:** vědomě **osekat MVP** (kalendář jednodušší, verze příloh + hlasovky → v2, tablet split-view → v2), ať vznikne použitelné jádro dřív. Viz Q12. + mít **fallback plán** (kdyby se to protáhlo, drží Todoist dál).

**S5 · Delivery/maintenance riziko (meta)**
Stavíš kritickou infrastrukturu pro firmu v režii „solo + AI". Bug = ztracený úkol = okamžitá ztráta důvěry. Bez **záloh, monitoringu, jasného „kdo to opravuje" a fallbacku** je vlastní appka spíš přítěž.
**Doporučení:** zálohy/monitoring od první verze (už je v plánu); předem dohodnout, co se stane, když MVP slipne (paralelní běh Todoistu, etapové nasazení po jednom workspace).

---

## 2. ROZPORY (vnitřní konflikty rozhodnutí)

**R-A · Tiché hodiny AI (noc + víkend) vs. víkendový/večerní provoz [→ Q9]**
Kavárna, taneční studio i podcast **jedou hlavně večer a o víkendu**. „Tiché hodiny = noc + víkend" by umlčely AI přesně tehdy, kdy se nejvíc pracuje.
**Doporučení:** tiché hodiny **per workspace** (kavárna jinak než „kancelářské" projekty), nebo jen noc.

**R-B · „Vše funguje offline" vs. AI quick add a kalendář [→ Q10, Q11]**
AI parsování (Claude) i Google kalendář **potřebují připojení**. „Vše offline" tedy nemůže platit doslova.
**Doporučení:** explicitně oddělit: **offline = jádro CRUD a čtení**; AI, kalendář a notifikace jsou **online-only**. Quick add offline řešit **lokálním parserem** (#, @, p1, datum) a AI doplnit po připojení.

**R-C · Quick add: „Auto+info" (provede) vs. „náhled k potvrzení" [→ Q11]**
AI spec značí quick-add (A1) jako *Auto+info* (udělá a upozorní), ale spec produktu říká *náhled k potvrzení před uložením*. To si protiřečí.
**Doporučení:** sjednotit na **náhled k potvrzení** (uživatel vidí rozpoznané atributy v compose poli, pak uloží).

**R-D · Globální štítky vs. izolace workspaců a hosté [→ Q3]**
Štítky jsou „globální napříč vším". Ale **host** (rodič/klient) je jen v jednom projektu — globální seznam štítků by mu **prozradil** štítky z cizích kontextů. A jeden globální namespace se přes 8 kontextů zaplevelí (např. „urgent" jinde znamená něco jiného).
**Doporučení:** globální **jen pro interní tým, skryté hostům**; zvážit i **per-workspace** štítky vedle globálních.

**R-E · Stav úkolu vs. dokončení (dvojí „hotovo") [→ Q2]**
Máme **vlastní statusy** (vč. „Hotovo", `is_done`) **i** dokončení úkolu (`completed_at`, checkbox). Není jasné, jestli přesun do stavu „Hotovo" = zaškrtnutí úkolu, nebo jsou to dvě nezávislé věci. U boardu (sloupec „Hotovo") je to klíčové.
**Doporučení:** **provázat** — checkbox a stav „Hotovo" se navzájem nastavují; jinak budou data nekonzistentní.

**R-F · „Vždy se ptát na režim přiřazení" vs. automatizace/AI/hromadné akce [→ Q4]**
Když přiřazení dělá **automatizace, AI nebo hromadná akce**, není koho se ptát.
**Doporučení:** definovat **výchozí režim pro neinteraktivní cesty** (doporučuju „každý zvlášť").

---

## 3. HRANIČNÍ TÉMATA (doprobrat)

**H1 · `assignment_mode` × opakování.** Co se stane s per-osoba dokončením u `shared_all` při dalším výskytu opakovaného úkolu? Reset všech? *Doporučení:* při výskytu resetovat všechna per-osoba dokončení; zdokumentovat i pro `shared_any`.

**H2 · Offline binárky (přílohy, hlasovky) [→ Q6].** „Vše offline + zápis" + soubory = velké lokální úložiště (IndexedDB blobs) + fronta uploadů + konflikty. *Doporučení:* úkoly/text offline, **soubory vyžadují připojení** (nebo aspoň upload odložit).

**H3 · Vlastní role × PowerSync sync rules [→ Q5].** Plně dynamické role se v sync rules vyjadřují těžko a můžou zpomalit sync. *Doporučení:* bohatší **přednastavené** role.

**H4 · Globální hledání × oprávnění a hosté.** Fulltext „napříč vším" **musí filtrovat podle práv** — nesmí vracet restricted/cizí workspace ani hostům. *Doporučení:* hledání vždy permission-aware (řešit při návrhu indexu).

**H5 · AI nudge (E1) vs. ztlumení a tiché hodiny.** AI připomínání lidem musí **respektovat jejich ztlumení a tiché hodiny**, jinak jde proti notifikačním preferencím. *Doporučení:* AI akce procházejí stejnou notifikační/quiet-hours bránou jako vše ostatní.

**H6 · Účetní model hostů.** Jsou hosté **samostatné účty** (Google/Apple/magic link), nebo jen e-mailové pozvánky bez účtu? Lehký režim potřebuje jasno. *Doporučení:* host = lehký účet (magic link), přístup jen k pozvanému; doladit s prvním externím nasazením.

**H7 · Kalendářový konflikt „ptát se" ve velkém [→ Q8].** Při automatickém syncu chodí změny i když jsi offline/pryč — „ptát se" se nakupí a nemá to jasný zdroj pravdy mezitím. *Doporučení:* jasné pravidlo zdroje pravdy mezi dotazy; „ptát se" jen u skutečných kolizí, jinak deterministicky.

**H8 · Kontrast brass (#C68A3E) vs. přístupnost.** Brass na bílé **nesplní** kontrast pro malý text (chceš „solidní základ" a11y). *Doporučení:* brass jen pro akcenty/velké prvky; pro text tmavší odstín (#A8722E) nebo navy.

**H9 · Časová pásma v MVP.** Floating/fixed je až v3. Pokud je tým celý v ČR, OK; jakmile někdo bude jinde (nebo eventy v zahraničí), připomínky/kalendář se rozjedou. *Doporučení:* MVP = jedno pásmo (Europe/Prague), explicitně.

---

## 4. NEJASNOSTI (chybí jednoznačnost)

**N1 · Vizuální kódování priority (když je barva oddělená).** Když barvu řídí uživatel, priorita potřebuje **vlastní nebarevný indikátor** (vlajka/odznak P1–P4), ať je vždy vidět. *Řeším:* vlajka/odznak P1–P4 (nezávislé na barvě). [potvrzení Q neřeší — zapíšu jako default]

**N2 · iDoklad — k čemu, když je time tracking pryč? [→ Q13]** Hlavní důvod (fakturace z odpracovaného času) padl. *Doporučení:* potvrdit účel (obecná fakturace?), nebo vyřadit.

**N3 · `shared_all` odvozené dokončení (R2) vs. podúkoly nedokončují rodiče (R3) — slovo „rodič" v obou.** Jsou to různé věci (spoluřešitelé vs podúkoly), ale termín se překrývá → riziko záměny v implementaci. *Řeším:* v kódu rozlišit „dokončení podle spoluřešitelů" vs „roll-up podúkolů"; podúkol může mít vlastní `assignment_mode`, ale **nikdy** neovlivní dokončení rodiče.

**N4 · Lucky OS je „core kontext" T-Group, ale neexistuje.** T-Group pojede zatím v obecné appce bez speciálního napojení — OK, ale ať je to vědomé.

**N5 · Watson = IBM Watson.** Pro interní nástroj vyřešeno (akceptováno). Při případném vypuštění ven by to byl problém.

---

## Shrnutí — co jde rozhodnout teď
Většina bodů má jasné doporučení a vyřeším je sám (H1, H4, H5, H8, H9, N1, N3). **Tvoje rozhodnutí potřebuje 13 bodů** → dotazník `konfigurator_revize.html`: CRDT v MVP, stav vs. dokončení, štítky+hosté, výchozí režim přiřazení, vlastní vs. přednastavené role, offline soubory, model per-projekt kalendáře, rozsah kalendáře v MVP, tiché hodiny, quick add offline, quick add potvrzení, osekání MVP, iDoklad.
