# Brief pro Claude Design — Mail / Schránka / Thread workspace

> ⚠️ **NAHRAZENO 2026-07-08 — čti napřed.** Kompletní, aktuální brief = **`design/BRIEF_mail_moduly_2026-07-08.md`**
> (15 modulů + průřezové; feasibility `files/MAIL_moduly_audit_2026-07-08.md`). Tento starší brief drž jen
> jako doplněk; kde se liší, **platí nový.** Konkrétní opravy tohoto souboru:
> - **„Osobní sféra: bez schránek" NEPLATÍ** — osobní sféra nově **má vlastní soukromé schránky**
>   (šifrované at-rest, bez AI, mimo admin). Dvě sféry: týmová + osobní.
> - **„Barva ≠ priorita (R6)" je ZASTARALÉ** — platí revidované **R6: barva = priorita** (P1 červená /
>   P2 žlutá / P3 modrá / P4 šedá); v mailu navíc „barva = význam" (viz nový brief).
> - `files/WATSON_MAIL_KONSOLIDOVANY_SPEC.md` **neexistuje** (visící odkaz) — ignoruj.

> **Jak to použít:** zkopíruj do **Claude Design** (plocha na claude.ai, ne Claude Code). Iteruj,
> dokud nebudou obrazovky hezké. **Navazuje na `BRIEF_claude_design.md`** — používá tytéž barvy,
> typografii, komponenty a pravidla (zde jen nové mailové části). Logika a datový model:
> `files/WATSON_MAIL_KONSOLIDOVANY_SPEC.md` + `files/MAIL_integracni_PLAN.md`.
>
> **Důležité:** app shell už má v navigaci **„Schránka"** (s počítadlem). Tyto obrazovky na ni
> navazují — nezakládej nový shell, rozšiř stávající.

---

## Co navrhujeme

Mailovou vrstvu Watsonu: **sjednocenou schránku** a hlavně **Thread workspace** — vlajkovou
obrazovku produktu. Mail není druhá appka; je to **orgán Watsonu**: thread je kontejner (e-mail +
koncept odpovědi + interní chat), úkol jsou jen „dveře" do téhož threadu.

**Tón:** ostrý, diskrétní, vřelý butler. Klid, prostor, **žádný vizuální hluk.** Funkční hustota bez
přeplácanosti (poučení z Outlook/Superhuman). Mobile-first; thread workspace musí být plynulý i na
telefonu (přepínání e-mail ↔ interní chat nesmí být kostrbaté — náprava stížností na Missive/Spark).

---

## Dvě sféry — musí být vidět na první pohled (ZÁSADNÍ)

Watson je zároveň **osobní pískoviště** i **firemní governovaný prostor.** Vizuálně je oddělit:
- **Týmová sféra** (Mail jen tady): workspace badge, governance prvky.
- **Osobní sféra:** záměrně **bez** firemních prvků — **žádné schránky**, žádné governance ikony.
- **Guest pohled:** extrémně oříznutý — host vidí jen pozvaný osobní projekt, žádnou firemní
  navigaci, žádné workspace přepínače.
- V navigaci vizuální předěl mezi MAIL (týmová) a 🗂 Osobní.

---

## Klíčové obrazovky (telefon + desktop; thread workspace navíc tablet split-view)

1. **Sjednocená schránka** — split inbox / smart kategorie; přepínač účtů; **jen schránky dle
   přístupu** (co nevidíš, v UI neexistuje — žádné zašedlé „nemáš přístup"). Počítadlo navazuje na
   `Schránka` v shellu.
2. **Thread workspace (VLAJKA — navrhnout nejpečlivěji)** — jeden panel, **čtyři vrstvy**:
   1) e-mail (nebo AI shrnutí u awareness úkolu), 2) **inline composer** předvyplněný AI draftem ve
   stylu uživatele, 3) **interní chat k threadu** (@mention, neviditelný odesílateli), 4) **lišta
   stavu** (vlastník, status, due, odkazy na projekt/úkol, collision „Petra teď píše").
3. **Task list s mail-linkovanými úkoly** — odlišit **„mail úkol" (owner, vyřiď)** od
   **„awareness/FYI"**; klik vede do thread workspace.
4. **Lidé & Týmy** — karta osoby (jméno, **podpis(y) per workspace/tým**, funkce, oblasti
   odpovědnosti, jazyk); detail týmu (členové + napojené schránky).
5. **Access matrix** — mřížka osoba/tým × schránka × rozsah; granty jasně viditelné, ať se nechybuje.
6. **Administrace (super-admin konzole)** — workspaces & domény, **připojené schránky + token
   health**, globální politiky (AI/retence/bezpečnost/read-receipts), provisioning lidí, audit log.
   Vizuálně oddělená „bezpečná zóna".
7. **Připojení schránky (flow)** — OAuth (Gmail/M365), IMAP credentialy; stavy připojení a chyb.
8. **Kompetenční směrování (setup)** — oblasti per člověk, AI návrh startovní sady, owner vs.
   awareness přepínač, **„proč"** u směrovaných úkolů + jednoklikové odmítnutí.
9. **Composer identity** — From nelze měnit (svázáno s threadem), ale viditelné „odpovídáš jako
   **Adam – T-Group Studio** z `studio@`".

---

## Nové komponenty (navrhni jako systém, na stávajících tokenech)

- **Trojice akcí na threadu:** **Assign** (předá vlastnictví) / **Share/FYI** (přehled bez
  povinnosti) / **Ask** (vtáhne do interní diskuse bez předání) — tři zřetelně odlišené akce.
- **Stavový odznak threadu:** Nový / Otevřený / **Čekám na interní vstup** / Odesláno / Hotovo
  (provázaný se stavem úkolu).
- **Collision indikátor** — nenápadný, ale jasný („Petra teď píše").
- **Žebřík oprávnění** (vizualizace v Access matrix): vlastník · plný agent · scoped agent ·
  per-thread delegát · interní spolupracovník.
- **Identity řádek composeru** (From zamčené + jméno/podpis osoby).
- **Awareness/FYI chip** na kartě úkolu vs. owner „vyřiď" — vizuálně odlišit.
- **Token-health indikátor** schránky (admin) — ok / vyprší / chyba.
- **„Proč" popover** u AI návrhu (oblast + jednovětný důvod + odmítnout).

---

## Pravidla (z hlavního briefu — neopakovat, jen připomenout)
- **Barva ≠ priorita** (R6). **Brass jen akcenty/velké prvky** (text v `#A8722E`/navy).
- **Aditivní routing:** úkoly přibývají, nic nemizí ze schránky.
- **Permission-aware UI:** co člověk nevidí, v UI neexistuje.
- Reálná česká data (dlouhé předměty, sdílené `studio@`/`info@`, stavy po termínu), ne lorem ipsum.
- Mobil: swipe gesta (archiv/done/snooze/assign), customizovatelná.

---

## Co od Designu chci jako výstup
- **9 obrazovek** výše (telefon + desktop; thread workspace navíc tablet split-view) + nové
  komponenty, vše na **stávajících tokenech/komponentách** (tytéž jako 5 hlavních obrazovek).
- Krátká pravidla použití: jak vizuálně oddělit sféry, jak ukázat 4 vrstvy threadu na malé obrazovce,
  jak odlišit Assign/Share/Ask a owner vs. awareness.
