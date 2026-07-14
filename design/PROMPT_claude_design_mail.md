# Prompt pro Claude Design — Watson Mail (vlož jako první zprávu)

Navrhni **mailový klient pro Watson**. Watson je offline-first **týmový** nástroj (úkoly + projekty +
kalendář + spolupráce). Mail není druhá appka „přilepená vedle" — je to **orgán Watsonu**: rozšiřuje
stávající shell (levý sidebar + header + mobilní spodní lišta <880px) a používá **stejný design systém**
(tokeny `--w-*`, Montserrat pro UI / Inter pro text, akcent brass, světlý + tmavý režim, CZ default / EN).

## Zdroj pravdy (přečti nejdřív)
- **`design/BRIEF_mail_moduly_2026-07-08.md`** — kompletní funkční popis: 15 modulů + průřezové
  („Dění", „Osobní vs. týmová sféra"), u každého **co to je / co dělá / jak vypadá**. Toto je specifikace.
- **`files/MAIL_moduly_audit_2026-07-08.md`** — feasibility + fázování (co je M1/M2/M3, co potřebuje
  novou infrastrukturu). Designuj **cílový stav**, ale věz, co je pozdější fáze (viz níže).

## Drž dvě direktivy (jsou v briefu nahoře)
1. **Designový jazyk mailu:** NENÍ to produktivní/kartová plocha jako zbytek Watsonu — je to **kreativní
   klient, kam se píše**. Přehledný, přístupný, **exaktní a čitelný**, klidný. Sdílej základní prvky
   Watsonu (tokeny, komponenty, shell), ale **nekopíruj hustou kartovost**. Priorita = čitelnost a klid.
2. **Barva = význam, ne dekorace:** prioritní barvy (P1 červená/P2 žlutá/P3 modrá/P4 šedá) **jen** pro
   prioritu/urgenci; barvy účtů = hlavní barevný prvek; čtecí plocha neutrální (paper/ink).

## Guardraily (nesmí se porušit)
- **Dvě sféry, vizuálně jasně oddělené:** **týmová** (řízená, dispečink, admin) + **osobní** (soukromá,
  **šifrovaná at-rest**, bez AI, mimo admin). Osobní marker = „šifrováno, provoz nečte" — **NE „E2E"**.
  **Host = bez mailu.**
- **„Co nevidíš, v UI neexistuje"** — žádné zašedlé „nemáš přístup".
- **From = oprávněná identita** (u odpovědi svázaná s vláknem „odpovídáš jako info@…"; u nové zprávy
  výběr z oprávněných schránek, ne volný text).
- **AI = jen návrh/draft, odesílá člověk.**
- **Mobil/tablet: top-level přepínač Mail ↔ Práce** — mail vlastní soustředěná plocha, nemíchat s úkoly.

## Pořadí obrazovek (začni vlajkou)
1. **Thread workspace (VLAJKA)** — 4 vrstvy: e-mailové vlákno · composer (přepínatelný inline/okno) ·
   **interní chat (pravý panel)** · **lišta stavu + akce** (Assign · Udělej úkol · Share · stav Nový→Hotovo
   · **urgence/priorita P1–P4 vlajka** · Snooze/Pin). Určuje jazyk celého mailu.
2. **Sjednocená schránka & triage** — chytré skupiny Inbox / Notifications / Newsletters / Pinned /
   Rozpracované + **Gatekeeper** (clona nových odesílatelů). Hustota Komfortní/Kompaktní, 2 řádky náhledu,
   avatary, filtr-chipy.
3. **Shell / layout** — 3 panely (sub-sidebar účtů+složek | seznam | čtení) + přepínač Full/Split;
   položka **„Mail"** v sidebaru s odznakem.
4. **Composer** + **Dispečink & tým** (Assign, shared drafts, collision indikátor, schvalovací krok).
5. **Osobní vs. týmová sféra** (marker soukromí + mobilní přepínač) + **Dění** (časová osa
   Nadcházející + co se stalo).
6. **Admin & přístupy** (access matrix + karta osoby + connection-health) + **Nastavení** (sekce „Mail").
7. **AI vrstva** (Ask lišta, AISuggestion karty, agent Off/Read/Triage) + zbytek.

## Fázování (designuj cíl, ale nekresli pozdější věci jako hotové jádro)
M1 = týmové jádro (bez AI, bez urgence-úkolů, bez collision). M2 = spolupráce + urgence-SLA + collision.
M3 = AI. **Osobní sféra = samostatná pozdější větev.** **Collision detection a SLA odpočty** potřebují
novou infrastrukturu → jsou pozdější fáze; naznač je, ale nestav na nich celý zážitek.

## Reálná CZ data pro mockupy (ne lorem ipsum)
Schránky: `info@`, `granty@`, `podcast@`, `studio@t-group-dance.cz`; osobní: `kosir.adam@gmail.com`.
Lidé: Adam (admin), projektový manažer, barista, grantový specialista, editor podcastu.
Předměty: „Faktura za nájem — červenec", „Nabídka spolupráce (podcast)", „Výzva OP JAK — deadline",
„Reklamace objednávky". Stavy threadu: Nový · Otevřený · Čeká (interně) · Odesláno · Hotovo.
Odznaky karty: přiřazená osoba (avatar), „AI navrhlo odpověď", „follow-up za 2 dny", SLA odpočet,
priorita P1–P4.

## Co od tebe chci jako výstup
Obrazovky výše (telefon + desktop; Thread workspace navíc tablet split-view) + **nové komponenty** na
stávajících tokenech: trojice **Assign / Share / Ask**, **stavový odznak threadu**, **priorita/urgence
vlajka**, **collision indikátor**, **žebřík oprávnění** (access matrix), **„proč" popover** u AI návrhu,
**marker sféry** (týmová vs. osobní-šifrovaná). K tomu krátká pravidla použití (jak oddělit sféry, jak
zobrazit 4 vrstvy threadu na mobilu, jak odlišit Assign/Share/Ask).
