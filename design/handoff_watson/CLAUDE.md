# CLAUDE.md — naváděcí soubor pro Claude Code

> Tento soubor čte Claude Code jako první. Říká, **co postavit**, **podle čeho** a **na co si dát pozor**.

## Co to je
Tohle je **designový handoff** aplikace **Watson** — týmová appka na úkoly, projekty, kalendář, postupy (štafetová workflow), cíle a reporty. Multi‑workspace (jednotlivec i více týmů). Cíl: překonat Todoist/Asanu/Notion přehledností, rychlostí (klávesnice) a chytrým zadáváním v přirozené češtině.

## Zdroj pravdy (čti v tomto pořadí)
1. **`README.md`** — kompletní specifikace: každá obrazovka, datový model, design tokeny, klávesové zkratky, model opakování/výskytů, seed data. **Toto je hlavní dokument.**
2. **`screenshots/`** — 20 snímků každé obrazovky a stavu (vizuální cíl, pixel reference).
3. **`WatsonApp.dc.html`** — interaktivní prototyp. **Není to produkční kód ke zkopírování** — je to referenční chování + logika. Celá logika je v jedné třídě `class Component` (stav + metody jako `parseQuick`, `calTasks`, `_advance`, `createGoal` …) a v šabloně s `{{ }}` výrazy. Čti to jako referenční JS a přepiš do produkčních komponent.

## Úkol
**Znovu vytvoř tento design v reálném kódu** — věrně (high‑fidelity: finální barvy, typografie, rozestupy, interakce). Ne refaktor prototypu, ale čistá implementace podle vzorů cílového projektu.

- **Pokud projekt ještě neexistuje:** založ **React + TypeScript** (Vite), state management dle uvážení (Zustand/Redux/Context), CSS proměnné přesně podle tokenů v README.
- **Pokud projekt existuje:** dodrž jeho konvence, knihovny a strukturu; jen přenes vzhled + chování.

## Fidelita — na co NEdrift
- **Barvy/typografie/hustota** — přesné hodnoty jsou v README (sekce Design tokeny). Brass akcent `#c68a3e`, tmavě‑navy sidebar, světlý i tmavý režim.
- **Barva = priorita** na kartách úkolů (P1 červená, P2 žlutá, P3 modrá, P4 šedá) — levý okraj karty.
- **Ikony** — jednotná tahová sada 24×24, ne emoji.
- **Chytré zadávání** — parser přirozené češtiny (`#projekt`, `+osoba`, termíny „příští úterý", časy „v 15:00", trvání „60 minut", opakování „každý sudý čtvrtek"). Tokeny se zvýrazní přímo v textu a po rozpoznání vyjmou do polí. Klávesy ↓/↑/Enter v našeptávači. **Detailně v README.**
- **Opakování & výskyty** — jeden „base" úkol generuje virtuální výskyty napříč pohledy; per‑výskyt dokončení/přeskočení přes výjimky (`exceptions` mapa). **Toto je netriviální — viz README sekce „Opakování a výskyty".**
- **Postupy (štafeta)** — kroky = běžné úkoly s `flowId`; dokončení kroku „předá" další osobě; kaskáda termínů. Viz README + screenshoty 12–14.

## Klíčové oblasti, které nepodcenit (jsou v prototypu hotové)
- Kalendář na **reálných datech** (týden/měsíc/den), drag‑drop, projekce opakování.
- **Cíle** s měřitelnými metrikami (dokončení / včasnost / počet / stav projektu) — počítané z reálných úkolů.
- **Klávesové zkratky** napříč appkou (přehled v README).
- **Multi‑workspace** scoping (osobní + týmy); Tým a role v Nastavení (oprávnění Vlastník/Admin/Člen/Host).

## Seed data
README obsahuje přesná seed data (3 prostory, 7 lidí, 17 projektů s typy/vlastníky, „dnes = 25. 6. 2026"). Použij je pro vývojový režim, ať appka odpovídá screenshotům.

## Doporučený postup
1. Přečti `README.md` celý.
2. Projdi `screenshots/` vedle příslušných sekcí README.
3. Postav design system (tokeny → primitiva: Button, Badge, Card, Avatar, Popover, Modal).
4. Postav obrazovky v pořadí: Dnes → Úkoly/Nadcházející → Kalendář → Projekty/detail → Postupy → Cíle → Reporty → Nastavení.
5. Implementuj chytré zadávání a model opakování jako samostatné, dobře otestované moduly (mají nejvíc logiky).
