# RECONCILIACE — Claude Design ⟷ kód ⟷ zamčená pravidla

> **Proč:** v Claude Design vznikla spousta *logických a strukturálních* rozhodnutí (ne jen vzhled).
> Aby se appka nerozjela do dvou směrů, tady je **delta**: co design tvrdí, jak to sedí s kódem a
> zamčenými pravidly (R1–R9, MASTER §11/§12), a **co se musí rozhodnout.**
>
> **Zdroje:** design-pravda = `design/handoff_watson/README.md` (+ `CLAUDE.md`, 20 screenshotů).
> kód-pravda = `packages/db/src/schema/*` + `packages/shared`. zamčená pravda = `files/CLAUDE.md`,
> `MASTER §11/§12`.
>
> **Princip (anti-fork):** *Design vládne vzhledu/IA/interakcím. Spec (`files/`) vládne logice/datům/
> invariantům. Kód staví ze specu.* Každé logické rozhodnutí z prototypu se **portne sem do specu** —
> nezůstává jen v prototypu. A staví se **po fázích** (MVP→v2→v3), i když design ukazuje celou vizi.

---

## 0. TL;DR — co z toho plyne
1. **Design je z velké části hotová MVP+v2 vize** — ale 3 velké bloky (Postupy, Cíle, Reporty) jsou
   **v2**. Nesmí spadnout do MVP (riziko S4). Mapování fází viz §2.
2. **Jeden tvrdý konflikt k rozhodnutí (K1): R6 „barva ≠ priorita" vs. design „barva = priorita".**
   Design to má explicitně jako „nedriftovat". Tvoje volba rozhodne spec i UI. Viz §3.
3. **Pár menších srovnání** (role, localStorage, název „Schránka") — mám doporučení, §3.
4. **Design lock je TEĎ možný** — handoff README má finální tokeny (světlý+tmavý+priority+projekty).
   Nahradit placeholder `packages/ui/src/tokens.css`. (Část „priority barvy" čeká na K1.) §5.
5. **Mail v designu NENÍ** — žádný konflikt; mailová vrstva je samostatný pozdější design+build track
   (`design/BRIEF_mail.md`). Sedí s `MAIL_integracni_PLAN.md` (mail po MVP).

---

## 1. Co design přidal/upřesnil oproti dosavadnímu specu (logika, ne vzhled)
Design je *konkrétnější* než spec v těchto modulech — **portujeme je do specu jako závazné chování:**
- **Quick-add parser (čeština)** — plná pravidla (priorita/čas/trvání/datum/opakování/`#projekt`/
  `@osoba`), zvýraznění tokenů v textu, našeptávač. (handoff README §„Chytré zadávání".)
- **Model opakování & výskytů** — base úkol + `exceptions` mapa, virtuální výskyt `id@YYYY-MM-DD`,
  projekce do Nadcházející/kalendáře, konec opakování (never/until/count). Netriviální, MVP-kritické.
- **Kalendář** — den/týden/měsíc na reálných ISO datech, drag/resize/drag-create.
- **Klávesové zkratky** — globální handler, paleta ⌘K, `G`+písmeno navigace.
- **Postupy / Cíle / Reporty** — plně navržené (ale v2, viz §2).
- **Per-uživatel zobrazení** projektů/pohledů; hustota (Vzdušné/Vyvážené).

> Tyto moduly mají **nejvíc logiky** → stavět jako samostatné, dobře otestované jednotky (parser,
> occurrences) — shoduje se s doporučením handoffu i s `POSTUP_kvalitni_appka.md`.

---

## 2. Inventář obrazovek × fáze (aby v2 nespadlo do MVP)
| Obrazovka (design) | Screenshot | Kód dnes | Fáze | Pozn. |
|---|---|---|---|---|
| Dnes (dashboard) | 01 | ⬜ | **MVP** (Krok 5–6) | „Watson pruh", zpožděné odděleně (R: §11) |
| Úkoly (seznam dle projektů) | 03 | schéma ano | **MVP** (5–6) | grouping per projekt |
| Nadcházející | 02 | ⬜ | **MVP** (6) | agregace + výskyty opakování |
| Kalendář den/týden/měsíc | 04–06 | schéma částečně | **MVP** základ (8) | drag-create/resize → **v2** |
| Projekty + detail | 07–08 | `projects` ano | **MVP** (5) | „Typ projektu" (flow/goal/cycle) = nové, §4 |
| Detail úkolu / Výskyt | 15–16 | `tasks` ano | **MVP** (5) | výskyt-banner = occurrences model |
| Přidat úkol + parser | 17–18 | ⬜ | **MVP** (7) | lokální parser (offline) + AI online |
| Nastavení / Tým a role | 19 | `memberships` ano | **MVP** (3) | role — viz K2 |
| Schránka (inbox úkolů) | — | `isPersonal` (R8) | **MVP** | ⚠️ název koliduje s mailem — K4 |
| Hledat | — | ⬜ | **MVP** (6) | permission-aware fulltext |
| **Postupy** + detail + builder | 12–14 | `fazovane_ukoly_PLAN` | **v2** | aditivní, server-authored advance |
| **Cíle** | 09 | ⬜ | **v2** | = OKR (MASTER §11 → v2) |
| **Reporty** přehled/lidé | 10–11 | ⬜ | **v2** | = dashboardy (MASTER §11 → v2) |
| Tmavý režim | 20 | tokeny | **MVP**-ready | tokeny v handoffu hotové |

**Pravidlo:** MVP staví jen MVP řádky. Postupy/Cíle/Reporty se **navrhly dopředu** (dobře — vize je
konzistentní), ale **kódí se až po MVP.** Design jejich obrazovek je hotový → až přijde v2, jede se
rovnou podle screenshotů.

---

## 3. KONFLIKTY & ROZHODNUTÍ

### 🔴 K1 — Barva vs. priorita (TVRDÝ konflikt, rozhodni)
- **Zamčeno (R6, `files/CLAUDE.md`):** „**Barva ≠ priorita**; priorita = **nebarevný odznak P1–P4**."
  Důvod: barvu si vlastní uživatel (projekty/štítky), priorita ji nesmí přebíjet; přístupnost.
- **Design (handoff `CLAUDE.md` ř. 21, jako „NEdriftovat"):** „**Barva = priorita** na kartách
  (P1 červená, P2 žlutá, P3 modrá, P4 šedá) — **levý okraj karty**." + tokeny `--p1..--p4`.
- **To jsou přímo protichůdná pravidla.** Rozhodnutí je produktové a je **tvoje** — viz dotaz níže.
- Pozn.: design barvu *nesdružuje* nesmyslně — priorita = levý okraj, projekt = tečka, uživatelská
  barva = zvlášť. Takže „hybrid" je reálný (nebarevný odznak kvůli přístupnosti + jemný prioritní
  akcent; silná barva zůstává uživateli/projektu).

### 🟠 K2 — Taxonomie rolí (sjednotit)
- **Design:** Vlastník / Admin / Člen / Host. **Kód:** `memberships.role` = admin/manager/**member**/guest
  (+ `workspaces.ownerId` = vlastník). **Mail plán** navíc přidává **super-admin** (app-level).
- **Doporučení:** jedna definice — `owner`(=ownerId) · `admin` · `member` · `guest` (design 4 tiers)
  + app-level `super-admin` (mail/admin vrstva). **Roli `manager` z kódu sjednotit s `admin`** (ať
  nejsou dvě skoro stejné). Vše **přednastavené role** (R5, žádné vlastní).

### 🟡 K3 — localStorage vs. „bez localStorage pro doménová data"
- **Design:** pozice/obrazovka + per-uživatel výchozí zobrazení v `localStorage`.
- **Zamčeno:** „bez `localStorage` pro **doménová** data (vše přes sync engine)."
- **Řešení (ne konflikt):** efemérní UI stav (aktuální obrazovka, scroll) v `localStorage` = OK;
  **trvalé per-uživatel preference** (výchozí pohled, hustota) → přes sync engine (uživatelské
  nastavení), ne localStorage. Zapsat do specu jako pravidlo.

### 🟡 K4 — Název „Schránka"
- **Design:** „Schránka" = inbox **nezařazených úkolů** (triage). **Mail spec:** chce sekci pro mail.
- **Doporučení:** „Schránka" zůstává **úkolový inbox** (R8); mailová sekce dostane jiný název
  (**„Mail" / „Pošta"**), až se bude stavět. Zapsat do `BRIEF_mail.md` / mail plánu.

---

## 4. Datový model — delta (design ↔ `tasks`/`projects`)
Kód `tasks` už má: `parentId, projectId, priority, color, due/start/deadline, durationMin,
recurrence, recurrenceBasis, assignmentMode, statusId, completedAt`, `assignments`, `checklist_items`.

**Doplnit (MVP, aditivní migrace):**
- **Opakování/výskyty:** model `exceptions` (per-výskyt done/skip/override) + konec opakování
  (`until`/`count`) + projekce výskytů. *Produkčně:* výskyty = odvozené z definice řady + tabulka
  výjimek klíčovaná datem (handoff README to přímo doporučuje). Sladit s **R4**.
- **Vícedenní úkol:** `isoEnd`/`endDate`. **Čas:** `start/end` (min. od půlnoci) — kód má start/due,
  ověřit pokrytí.
- **Projekt „Typ"** (Průběžný/Cílový/Periodický) + u cílového „Termín dodání"+„Definice hotového" →
  sloupce na `projects`.

**Až v2 (vlastní tabulky, ne sloupce na tasks):**
- **Postupy:** `chains/chain_steps/...` dle `fazovane_ukoly_PLAN.md` (flowId/stepIndex/gate jsou v
  prototypu na úkolu jen pro demo; produkčně do chain tabulek).
- **Cíle:** `goals` (metrika dokončení/včasnost/počet/stav, scope tým/projekt/osoba).
- **Reporty:** počítané z úkolů/cílů (žádná velká nová tabulka).

---

## 5. Design lock — TEĎ
Handoff README má **finální tokeny** (světlý+tmavý režim, brass, success/overdue, **barvy projektů**,
**uživatelské barvy úkolů**, hustota, stíny). Akce:
1. Nahradit placeholder `packages/ui/src/tokens.css` těmito hodnotami + přemapovat Tailwind `@theme`
   v `apps/web/src/index.css` (a `ds-bundle/tokens/tokens.css`). = **„design lock" z `CLAUDE.md`.**
2. **Tmavý režim** přes `[data-w-theme="dark"]` — tokeny hotové.
3. ⚠️ **Tokeny `--p1..--p4` (priority barvy) čekají na K1** — pokud platí R6, priorita je nebarevný
   odznak a `--p1..--p4` se nepoužijí na prioritu (nebo zůstanou jen jako neutrální).

---

## 6. Jak to propsat do kódu (sjednocený postup)
Navazuje na pořadí stavby z `CLAUDE.md` (Krok 5–10) + screen-order z handoffu:
1. **Rozhodni K1–K4** (níže) → zapiš výsledky do `files/` (spec = jedna pravda).
2. **Design lock** (§5) — tokeny + tmavý režim. Od teď UI jen z tokenů.
3. **MVP obrazovky** v pořadí: design system primitiva → Dnes → Úkoly/Nadcházející → Detail úkolu →
   Přidat úkol+parser → Kalendář (základ) → Projekty+detail → Nastavení/role → Hledat. Vše proti
   screenshotům (pixel reference).
4. **Moduly s nejvíc logikou samostatně + testy:** parser, occurrences/exceptions (R4).
5. **Po MVP:** Postupy → Cíle → Reporty (v2), podle hotových návrhů.
6. **Mail track** paralelně/později: `BRIEF_mail.md` → Claude Design → pak build dle `MAIL_integracni_PLAN.md`.

---

## 7. Anti-fork disciplína (od teď)
- **Logické rozhodnutí z Claude Design → vždy portnout do `files/`** (ne nechat jen v prototypu).
- **`design-sync` pull + tahle reconciliace** při každém větším designovém milníku.
- **„Design pass" po každé fázi** (už v `CLAUDE.md`): screenshoty reálné appky → Design → zpět přes tokeny.
- Prototyp = referenční vzhled+chování, **ne** zdroj datového modelu (ten je ve specu/kódu).
- Fázová kázeň: design smí ukázat v2/v3, kód staví po fázích.

---
*Otevřené rozhodnutí blokující design lock i UI: **K1** (barva vs priorita). K2–K4 mají doporučení
k potvrzení. Po rozhodnutí: zapsat do specu, provést design lock, začít MVP obrazovky.*
