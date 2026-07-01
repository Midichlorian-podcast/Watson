# RECONCILIACE — Claude Design ⟷ kód ⟷ zamčená pravidla

> **Proč:** v Claude Design vznikla spousta _logických a strukturálních_ rozhodnutí (ne jen vzhled).
> Aby se appka nerozjela do dvou směrů, tady je **delta**: co design tvrdí, jak to sedí s kódem a
> zamčenými pravidly (R1–R9, MASTER §11/§12), a **co se musí rozhodnout.**
>
> **Zdroje:** design-pravda = `design/handoff_watson/README.md` (+ `CLAUDE.md`, 20 screenshotů).
> kód-pravda = `packages/db/src/schema/*` + `packages/shared`. zamčená pravda = `files/CLAUDE.md`,
> `MASTER §11/§12`.
>
> **Princip (anti-fork):** _Design vládne vzhledu/IA/interakcím. Spec (`files/`) vládne logice/datům/
> invariantům. Kód staví ze specu._ Každé logické rozhodnutí z prototypu se **portne sem do specu** —
> nezůstává jen v prototypu. A staví se **po fázích** (MVP→v2→v3), i když design ukazuje celou vizi.

---

## ✅ ROZHODNUTO (2026-06-29)

- **Governance:** **Claude Design handoff je zdroj pravdy.** Kde se liší od starších rozhodnutí
  (spec/invarianty), **vyhrává handoff** a propisuje se do kódu i specu. → appka má jednu hlavu.
- **K1 (barva vs priorita): design vyhrává.** Levý okraj karty = priorita (P1 červená / P2 žlutá /
  P3 modrá / P4 šedá). Tělo karty = výchozí barva projektu **nebo** per-uživatelská barva úkolu
  (týž úkol může každý vidět jinak barevný). Nebarevný odznak P1–P4 smí zůstat jako doplněk.
  R6 v původní podobě nahrazeno. Plné pravidlo: `design/handoff_watson/README.md`.
- **K2 (role):** sjednoceno na **Vlastník / Admin / Člen / Host** (design) + app-level **super-admin**
  (mail/admin vrstva). Duplicitní „manager" z kódu splyne s Admin.
- **K3 (localStorage):** efemérní UI stav lokálně OK; trvalé per-uživatel preference přes sync.
- **K4 (Schránka):** „Schránka" = úkolový inbox (design); mailová sekce dostane jiný název.
- **Pořadí stavby (uživatel):** teď postavit hotový design (MVP) + rozjet mailovou část, pak
  systematicky přidávat. Design lock proveden (tokeny → `packages/ui/src/tokens.css`).
- **Logika prototypu vytažena** do `files/logika/` (parser, opakování/výskyty, postupy/cíle/projekty,
  shell/stav/zkratky — 95/97 metod, implementační detail + odhalené produkční opravy). Závazná spec.

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

Design je _konkrétnější_ než spec v těchto modulech — **portujeme je do specu jako závazné chování:**

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

| Obrazovka (design)             | Screenshot | Kód dnes              | Fáze               | Pozn.                                       |
| ------------------------------ | ---------- | --------------------- | ------------------ | ------------------------------------------- |
| Dnes (dashboard)               | 01         | ⬜                    | **MVP** (Krok 5–6) | „Watson pruh", zpožděné odděleně (R: §11)   |
| Úkoly (seznam dle projektů)    | 03         | schéma ano            | **MVP** (5–6)      | grouping per projekt                        |
| Nadcházející                   | 02         | ⬜                    | **MVP** (6)        | agregace + výskyty opakování                |
| Kalendář den/týden/měsíc       | 04–06      | schéma částečně       | **MVP** základ (8) | drag-create/resize → **v2**                 |
| Projekty + detail              | 07–08      | `projects` ano        | **MVP** (5)        | „Typ projektu" (flow/goal/cycle) = nové, §4 |
| Detail úkolu / Výskyt          | 15–16      | `tasks` ano           | **MVP** (5)        | výskyt-banner = occurrences model           |
| Přidat úkol + parser           | 17–18      | ⬜                    | **MVP** (7)        | lokální parser (offline) + AI online        |
| Nastavení / Tým a role         | 19         | `memberships` ano     | **MVP** (3)        | role — viz K2                               |
| Schránka (inbox úkolů)         | —          | `isPersonal` (R8)     | **MVP**            | ⚠️ název koliduje s mailem — K4             |
| Hledat                         | —          | ⬜                    | **MVP** (6)        | permission-aware fulltext                   |
| **Postupy** + detail + builder | 12–14      | `fazovane_ukoly_PLAN` | **v2**             | aditivní, server-authored advance           |
| **Cíle**                       | 09         | ⬜                    | **v2**             | = OKR (MASTER §11 → v2)                     |
| **Reporty** přehled/lidé       | 10–11      | ⬜                    | **v2**             | = dashboardy (MASTER §11 → v2)              |
| Tmavý režim                    | 20         | tokeny                | **MVP**-ready      | tokeny v handoffu hotové                    |

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
- Pozn.: design barvu _nesdružuje_ nesmyslně — priorita = levý okraj, projekt = tečka, uživatelská
  barva = zvlášť. Takže „hybrid" je reálný (nebarevný odznak kvůli přístupnosti + jemný prioritní
  akcent; silná barva zůstává uživateli/projektu).

### 🟠 K2 — Taxonomie rolí (sjednotit)

- **Design:** Vlastník / Admin / Člen / Host. **Kód:** `memberships.role` = admin/manager/**member**/guest
  (+ `workspaces.ownerId` = vlastník). **Mail plán** navíc přidává **super-admin** (app-level).
- **Doporučení:** jedna definice — `owner`(=ownerId) · `admin` · `member` · `guest` (design 4 tiers)
  - app-level `super-admin` (mail/admin vrstva). **Roli `manager` z kódu sjednotit s `admin`** (ať
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
  (`until`/`count`) + projekce výskytů. _Produkčně:_ výskyty = odvozené z definice řady + tabulka
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

## 8. PROJEKTY + detail — reconciliace & co postaveno (#11, 2026-06-30)

Vytěženo workflow z prototypu (`WatsonApp.dc.html`, README, `files/logika/03`). **Design vyhrává.**

**Klíčové delty design ↔ kód (rozhodnuto dle handoffu):**

- **🔴 SEKCE v prototypu NEEXISTUJÍ.** Úkol → projekt **přímo** (`task.project`), žádné Todoist-like
  uživatelské sekce. Seskupení je kontextové: filtrovaný projekt = **jedna plochá skupina**; bez
  filtru = skupiny po projektech; Nadcházející = po dnech. **Kód/DB ale `sections` tabulku má**
  (+ write-path registry ji zná) — to je _odchylka kódu napřed_. **Rozhodnutí:** detail projektu i
  `/ukoly?projekt=$id` jsou **ploché** (BEZ sekcí). Uživatelské sekce = pozdější funkce nad rámec
  prototypu, NE v MVP. (`sections` tabulka zůstává nevyužitá — neodstraňovat, je levná rezerva.)
- **Detail projektu = pravý slide-in panel** (NE plná stránka). `/projekty` = plochý grid karet
  (auto-fill minmax 290px). Panel má vlastní stav (context), ne route-stránku.
- **🟠 Role jsou per-WORKSPACE** (Vlastník/Admin/Člen/Host) — v projektu **jen toggle členství**,
  žádné per-projekt role typu viewer/commenter/editor. DB `project_members.role` (projectRoleEnum)
  je tedy **technický scoping**, ne produktová role. → **koriguje úkol #14** (read-only NEpatří
  per-projekt; je to workspace-role záležitost: Host = read-only). Sjednoceno s K2.
- **Board = STAVY úkolu** (K udělání/Probíhá/Ke kontrole/Hotovo) a je to **globální view mode v
  Úkolech** (přepínač Seznam/Nástěnka/Kalendář + per-uživatel výchozí), **NE** uvnitř detailu projektu.
  R9: drop do/ze „Hotovo" musí překlopit `is_done` (produkce enforcuje — prototyp ne).
- **Typ projektu** (Průběžný/Cílový/Periodický) + **stav** (Aktivní/Pozastavený/Archiv/Hotovo) +
  vlastník + termín dodání + „Definice hotového" → vyžadují sloupce, které DB **nemá** (jen
  `archivedAt`, `visibility`, `defaultLayout`). → **fáze 1+** (aditivní migrace `projects.kind/status/
owner/due/dod`). MVP řeší jen **Aktivní ↔ Archiv** přes `archived_at`.
- **Počty** (otevřených/hotovo/celkem) = **reálně z `tasks`** (ne prototypový pseudo-hash `doneEff`).

**Co postaveno v MVP #11 (ověřeno živě):**

- **Sync vrstva:** `projects, sections, statuses, project_members` přidány do `sync-config.yaml`
  (stejný bucket, scoping dle členství) + klient `AppSchema` + restart PowerSync. ⚠️ `is_done`/bool →
  `column.integer` (SQLite nemá bool).
- **Jednotný zdroj projektů:** `lib/projects.ts` (`useProjects/useProject/useSections/useStatuses`)
  z PowerSync. **Migrováno z API fetchu** (`/api/projects`) → Today, Úkoly, QuickAdd, TaskDetail.
  `/api/projects` zůstává (nepoužíván klientem) — odstranění odloženo. Tím odpadl API↔sync rozkol +
  projektová tečka (barva) je teď reálná všude.
- **Write-path:** `projects` (`projectVia: self` — editovat/archivovat smí jen člen; **vytvoření
  projektu přes write-path NEJDE** kvůli member-bootstrapu → potřebuje server endpoint, odloženo) +
  `statuses`. „Nový projekt" zatím **disabled**.
- **Obrazovky:** `/projekty` grid (ProjectCard: barva, název, počty, progres, členové) + detail panel
  (název/barva/stav/statistiky/členové/„Zobrazit úkoly") + `/ukoly?projekt=$id` filtr + banner.
- **R6:** barva projektu = tělo karet úkolů (sdílená); paleta sjednocena v `lib/colors.ts`.

**Odloženo (follow-up úkoly):** server endpoint pro vytvoření projektu; metadata projektu
(typ/stav/vlastník/DoD) + migrace schématu; board view mode (statusy + drag + R9 enforce); avataři
členů (vyžaduje jména uživatelů — sync users nebo endpoint); přepínač zobrazení + per-uživatel
výchozí; aktivní-workspace filtr + přepínač prostorů; (Todoist-like sekce — jen pokud se rozhodne).

---

## 9. KALENDÁŘ — reconciliace & co postaveno (#10, 2026-06-30)

Vytěženo z `files/logika/02-opakovani-kalendar.md` (exhaustivní) + handoff. **Design vyhrává.**

**Klíčové delty design ↔ kód:**

- **Kalendář NENÍ samostatná položka sidebaru.** `MAIN_NAV` (z handoffu) ho nemá; v prototypu je
  kalendář **view mode** v seznamu úkolů (přepínač **Seznam / Nástěnka / Kalendář**). → implementováno
  jako přepínač v obrazovce **Úkoly**, ne nová route/nav. (Splývá s #17 view modes.)
- **Data jsou date-only + ŽÁDNÉ opakované úkoly** (QuickAdd recurrence neukládá, seed nemá). →
  **měsíční pohled je datově nejvhodnější MVP**; occurrence engine je zatím bezpředmětný.
- **Model výskytů** (`_recOccur`, `makeOcc`, virtuální id `seriesId@ISO`, výjimky) je v prototypu
  bohatý, ale s vědomými zjednodušeními (repeatRule se v projekci ignoruje → „uplave"; DnD na legacy
  červnové číslo dne). Produkce: RRULE-like rule + materializer s plnou podporou byWeekday/nthWeekday/
  dayOfMonth/parity + tabulka výjimek (viz `files/logika/02` §3.2, §13). **Vše odloženo** (R4 vertikála).

**Co postaveno v MVP #10 (ověřeno živě):**

- `CalendarMonth` — měsíční mřížka pondělí-first (Intl popisky cs/en), dnešek zvýrazněn (brass),
  dny mimo měsíc ztlumené, úkoly dle `due_date`/`start_date`, **max 3 + „+N další"**, levý okraj
  chipu = priorita (R6), klik → detail panel. Navigace ‹ Dnes ›. Bez drag/resize/create.
- Přepínač **Seznam | Kalendář** v Úkolech (Nástěnka/Board = #17). Respektuje filtr `?projekt`.

**Odloženo (follow-up):** týden/den (časový grid — `layoutDay` lanes, all-day pás, now-linka,
hustota PPM); drag/resize/drag-create + DnD (na ISO, ne legacy číslo dne); **occurrence engine**
(expandování opakování do kalendáře/Nadcházejících + QuickAdd ukládá recurrence + tabulka výjimek,
R4); multi-day pruhy; per-user výchozí pohled. Detaily: `files/logika/02-opakovani-kalendar.md`.

---

## 10. NASTAVENÍ + Tým a role — co postaveno (#12, 2026-06-30) + FIDELITY

**⚑ Zpětná vazba uživatele (2026-06-30):** appka dosud **nevypadá dost jako Cloud Design** — i moduly
stavěné „dle modulů" se liší. Nově: **každá obrazovka 1:1 dle prototypu** (screenshot + EXACT markup/
CSS z `WatsonApp.dc.html`, ne jen logika). Zaznamenáno v paměti `design-fidelity-cloud-design`.

**#12 postaveno PŘESNĚ dle extrahovaného markupu prototypu** (ř. 889–957 + CSS):

- Kontejner `max-width:680px`, sekce **Vzhled / Účet / Tým a role / Oznámení a Watson**; karty
  `radius:13px`, řádky s děliči `border-bottom 1px line`; přesné px/fonty/barvy (mapováno
  `--panel→--w-card`, `--avatar-navy→--w-navy`, atd.).
- **Vzhled**: Tmavý režim switch (funkční přes `useTheme`, zrcadlí téma), „Tweaks" pilulka (panel odložen).
- **Účet**: reálný uživatel (session) + brass avatar + `Odhlásit` (funkční).
- **Tým a role**: členové z nového `GET /api/workspaces/:id/members`; **role pilulka** — Vlastník
  brass, ostatní neutrální (přesně dle `[data-permrole]` CSS); funkční dropdown (Admin/Člen/Host)
  přes `PATCH /api/workspaces/:id/members/:userId/role` (guard: owner/admin, vlastníkův řádek nelze).
  **Mapování role**: owner→Vlastník, admin/manager→Admin, member→Člen, guest→Host (K2).
- **Oznámení a Watson**: 2 dekorativně zapnuté switche (dle prototypu).
- Seed: workspace „Kancelář Praha" (demo=Vlastník + Tomáš/Jana/Martin/Petra) pro demonstraci všech rolí.

**Zjištěné fidelity rozpory shellu** (kandidáti na fidelity-pass): **sidebar** nemá brass tlačítko
**„+ Přidat úkol"** ani počty u položek (Schránka 2, Dnes 16…) ani avatar+gear dole; **header** nemá
„Watson" pill a „+ Úkol" má být **brass plné** (ne navy). Dosud postavené obrazovky (Dnes/Úkoly/
Projekty/Kalendář) podle uživatele neodpovídají dost → fidelity-pass úkoly.

**Odloženo:** „Tweaks" panel (hustota/barevnost); pozvání člena e-mailem (flow); pracovní pozice
člena (`m.job` — users nemají sloupec, zobrazen jen e-mail); ownership transfer (Vlastník v dropdownu).

---

_Otevřené rozhodnutí blokující design lock i UI: **K1** (barva vs priorita) — VYŘEŠENO (design).
K2–K4 potvrzeno. #10–#12 MVP hotovo. **Nová priorita: 1:1 fidelity k Cloud Design** (§10) — fidelity-pass
shellu + dříve postavených obrazovek; viz §8/§9 pro odložené funkční fáze._

---

## §11 — Autonomní 1:1 běh (P1): Add-task modal (#28) + atrapy/Watson (#29/#37)

**Datum:** 2026-07-01 · autonomní smyčka (rozhoduji sám dle ducha designu, zapisuji sem).

### #28 — Add-task modal + QuickAdd ukládá všechna pole
- **Globální modal** `AddTaskModal` (kontext `AddTaskProvider`, zkratka `q`, Esc/klik mimo zavře) obaluje
  existující `QuickAdd` parser. Sidebar „+ Přidat úkol" a Header „+ Úkol" přepnuty z `navigate('/')` na `openAdd`.
- **`QuickAdd.submit`** nově persistuje `start_date` (= termín + čas dne z `startMin`), `deadline`,
  `duration_min`, `recurrence` (label), `recurrence_basis` (dřív jen name/priority/due_date).
- **Odloženo (rozhodnutí):**
  - `personQueries` (`@X`/`+X`) → přiřazení nejsou v `submit` (potřebují resolve osob → `assignments`);
    řeší **#13** (našeptávač lidí) + **#30** (assignment_mode). `submit` je zapisuje: NE (zatím).
  - `days` (vícedenní rozsah 1–60) → **žádný DB sloupec** na konci rozsahu (máme jen `deadline`).
    Rozhodnutí: neukládat `days`; není v produkčním modelu tasku. Pokud se ukáže potřeba, přidat
    `end_date` aditivní migrací. Zapsáno jako známý gap.
- **`recurrence`**: ukládáme **label** (human text) do `tasks.recurrence`. Strukturované rozvití řeší
  occurrence engine **#21** (re-parse labelu, příp. přidat `recurrence_rule` JSON sloupec). Tím je splněno
  „parser nic nezahazuje" pro skalární pole. Ověřeno živě: q → modal → pills → submit → Postgres má vše.

### #29 — atrapy + #37 Watson panel (postaveno společně)
- **Zjištění z prototypu:** atrapy nemají samostatný cíl — Watson pill, zvonek (Oznámení) i „Více →"
  (Dnes strip) volají všechny `toggleWatson` → **Watson drawer**. Lupa → header inline search (`searchOpen`).
- **Rozhodnutí:** postavit **Watson drawer (#37)** hned jako nositele napojení → tím zapojeny **3 ze 4 atrap**
  (pill + zvonek + „Více →"). **Lupa** (search) odložena na **#33 (Hledat)**, kde se staví header search input
  i obrazovka. Tj. #29 se rozpouští do #37 (teď) + #33 (později); netvořím dead-navigace na neexistující cíle.
- **Watson panel = reálná data** (prototyp měl greet/insights mockované):
  - greet = stejná logika jako Dnes strip (pozdrav + jméno + „{n} na dnes · {m} po termínu").
  - insights: (1) pokud jsou úkoly po termínu → „Máš {n} po termínu" + akce **Přeplánovat zpožděné**
    (bulk `UPDATE due_date=now`); jinak „Nic po termínu"; (2) „Naplánuj si den" + **Otevřít nadcházející**.
  - stat strip: hotovo (dnes dokončené) / po termínu / dnes — reálné počty.
  - „Tvé cíle tento týden": `goals WHERE owner_id = me` (skryje se, když prázdné).
- **Route pozn.:** insight #2 míří na `/nadchazejici`, ne `/kalendar` — **kalendář není samostatná route**
  (je to view-mode seznamu, #17/#20). Registrované routes: `/ /ukoly /nadchazejici /projekty /nastaveni`.
  Ostatní nav (Cíle/Reporty/Postupy/Hledat/Schránka) zatím bez route → řeší P3 tasky.

---

## §12 — Detail úkolu: assignment_mode R2 + připomínky (#30)

**Datum:** 2026-07-01 · autonomní smyčka.

### Co je v Cloud Design detailu (a co NENÍ)
- **Přiřazení (R2)** — sekce „Přiřazení": režim `single`/`shared_any`/`shared_all`. Prototyp rozlišuje:
  - `shared_all` („Každý zvlášť") → per-osoba checkbox (každý dokončuje samostatně) + „{done}/{total} hotovo".
  - `shared_any`/`single` („Stačí kdokoli") → jen seznam avatarů (jeden checkbox pro celý úkol).
- **Připomenutí** — v prototypu jen **badge** v pill řádku detailu (žádný editor připomínek v detailu).
- **Štítky (labels) NEJSOU v UI prototypu vůbec** — grep `títk`/`Štítk`/`label` → 0 výskytů v UI; `labels`
  tabulka má `is_internal` (mailový koncept). **Rozhodnutí:** labels sync (AppSchema/sync-config/write-path
  `task_labels` + denorm `project_id`) i UI **odloženy do Mail #8**, kde interní štítky žijí. Netvořím UI,
  které v Cloud Designu není. (#24 titulek zmiňoval „labels" jako součást sync-tabulek — reálně zůstávají
  nezasíťované, protože je nic nekonzumuje.)

### Postaveno (TaskDetailPanel)
- Sekce **Přiřazení**: 3-tlačítkový přepínač režimu (`patch tasks.assignment_mode`), hint dle režimu,
  seznam členů projektu (z `GET /api/projects/:id/members`); klik na avatar = toggle `assignments`
  (insert/delete), v `shared_all` navíc per-osoba checkbox = toggle `assignments.completed_at`.
- **Badge „Připomenutí"** u titulku, když `reminders WHERE task_id` > 0.
- Avataři členů: iniciály z jména (přes members API — souvisí s #18).
- **Ověřeno živě + DB-sync:** mode→`shared_all` (Postgres ✓), avatar→assignment INSERT (✓),
  per-osoba done→`completed_at` (Postgres `2026-07-01 19:27` ✓), reminder badge (seed→zobrazil se ✓).
  Testovací data uklizena (mode=single, 0 asg/rem).

---

## §13 — Quick-add parser: cut-by-index + RECVOCAB over-match (#13)

**Datum:** 2026-07-01 · autonomní smyčka. **Vědomá produkční odchylka od prototypu** (files/logika/01 §12).

### Bugy z code review (opraveno)
1. **cut over-match:** `cut(s)` dělal `work.replace(s," ")` — naivní substring replace, který ignoruje
   pozici/hranice, jež regex použil (lookbehind/`\b`). Mohl vyříznout STEJNĚ znějící dřívější výskyt.
   **Fix:** `cut(m)` vyřízne podle `m.index` (`blank(start,end)` nahradí stejně dlouhou mezerou → indexy
   zůstávají stabilní pro následná pravidla).
2. **RECVOCAB over-match:** `base.replace(recVocab()," ")` globálně mazal VŠECHNA opakovací slova z názvu
   — i ta, co jsou součástí názvu (např. „hodinky"→`hodin\p{L}*`, „středisko"→`st[řr]ed\p{L}*`,
   „dobrý den"→`den`, „druha"(přítel)→`druh…`). **Fix:** `parseRecurrence` nově vrací `consumed: Span[]`
   (přesné rozsahy tokenů, které opakování opravdu spotřebovalo); parser je vyřízne podle indexu.
   Globální RECVOCAB strip + soubor `lexicon/recVocab.ts` **odstraněny** (mrtvý kód).
3. **`druh[a]` false-positive:** biweekly detekce `druh[éouýa]` chytala i „druha"(akuzativ „přítel").
   Zpřísněno na `druh[éouýá]` (accented á, ne bare a) — jako už měl `NTH_DEFS`. „druhé/druhý/druhou/druhá"
   (řadovka) dál fungují, „druha" ne.

### Ověřeno živě (dynamický import reálného modulu přes preview_eval, 16 case)
- Regrese: daily/weekly+den+čas/monthly-nth/monthly/yearly/biweekly/monthly-day/bareWd(příští pátek) — OK.
- Over-match fix: „koupit hodinky každý rok"→„koupit hodinky", „navštívit středisko každý den"→
  „navštívit středisko", „popřát dobrý den každý pátek"→„popřát dobrý den", „pozvat druha každý týden"→
  „pozvat druha" (weekly). Kombinace polí (zítra+15:00+45 min+p1) beze změny.

### Odloženo: `@osoba` našeptávač v quick-addu
Parser `personQueries` funguje, ale QuickAdd dostává `people=[]` (suggest je inert) a `submit` z nich
nezakládá `assignments`. **Rozhodnutí:** plné zapojení (suggest lidí + resolve na submit → assignments)
závisí na **#19** (aktivní workspace → seznam členů prostoru). Odloženo za #19; není to viditelná „atrapa"
(napsaný `@X` se jen tiše neuplatní), řeší se s workspace kontextem.

---

## §14 — Globální klávesové zkratky + „?" tahák (#31)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P2).

### Postaveno + ověřeno živě
- `KeyboardProvider` (globální keydown, uvnitř AddTaskProvider): `?`=tahák toggle, `g`+písmeno=navigace,
  `q`=nový úkol (přesunuto sem z AddTaskProvider — jeden zdroj pravdy), Esc=zavře tahák.
- `Cheatsheet` overlay 1:1 dle Cloud Design (4 sekce: Globální / Seznam úkolů / Kalendář / Našeptávač).
- **g-navigace** jen na existující routes: d→/, u→/ukoly, n→/nadcházející, p→/projekty. Cíle
  k(alendář)/c(íle)/r(eporty)/s(postupy)/i(schránka)/h(ledat) zatím bez route → no-op; doplní se s obrazovkami P3.
- Ověřeno: `?`→tahák (screenshot), Esc→zavře, `g p`→/projekty, `q`→add modal (autofocus).

### Odloženo (dokumentované)
- **Seznamová navigace `j/k`/`Enter`/`x`/`e`/`Space`/`1–4`/`⌫`** a **kalendářové `←/→`/`d`/`1-3`** vyžadují
  per-seznam/kalendář selection state (`kbSel`) sdílený s obrazovkami. Odloženo za **#36** (Úkoly toolbar) /
  **#17** (view modes) / **#20** (kalendář grid). Tahák je **zobrazuje** (1:1 reference dle designu), ale
  fungují zatím jen globální (`g`/`?`/`q`/Esc) + ⌘K (přibude #32).
- `/`=Hledat a `⌘K`=palette: `/` řeší #33 (header search), `⌘K` řeší #32. `⌘Z`/`⌘⇧Z` undo/redo: bez undo
  systému (prototyp má undo stack) — odloženo (není v aktuálním scope; příp. samostatný task).

---

## §15 — Command palette ⌘K (#32)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P2).

### Postaveno + ověřeno živě
- ⌘K/Ctrl+K handler v `KeyboardProvider` (před typing guardem — funguje i z inputu) → toggle palety.
- `CommandPalette` overlay 1:1 dle Cloud Design: search input + fuzzy (substring) seznam, ArrowUp/Down +
  Enter spustí, Esc/klik mimo zavře, řádky s kind (PŘEJÍT/PROJEKT) + barevná tečka projektu.
- **Zdroje položek:** obrazovky (Dnes/Nadcházející/Úkoly/Projekty/Nastavení — jen existující routes) +
  projekty (`useProjects`, klik → `projectDetail.open`).
- **Oprava nesting bugu:** `KeyboardProvider` přesunut dovnitř `ProjectDetailProvider` (byl vně → `useProjectDetail`
  vracel default no-op a Enter na projektu nic nedělal). Teď nejvnitřnější provider.
- Ověřeno: ⌘K→paleta (screenshot), „obch"→Obchod→Enter→projekt detail, „nadch"→Enter→/nadchazejici.

### Odloženo (dokumentované)
- **Lidé** (kind Člověk) a **Postupy** (kind Postup) jako zdroje: lidé potřebují workspace/členy (#19),
  postupy potřebují chains data v UI (#27). Přibudou s těmi tasky. Ostatní obrazovky (Cíle/Reporty/Postupy/
  Schránka/Hledat) do palety přibudou, až budou mít routes (P3) — teď by vedly na 404.

---

## §16 — Workspaces: aktivní prostor + přepínač + filtr (#19)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P2).

### Postaveno + ověřeno živě
- `WorkspaceProvider` (lib/workspace.tsx): aktivní prostor v **localStorage** (`watson.activeWs`, per-user/
  per-browser), default = první neosobní / první; sbalování prostorů (neaktivní default sbalený).
- `useWorkspaces()` sdílený react-query hook (dřív duplicitní inline fetch v Sidebar i Projekty — sjednoceno).
- **Sidebar sekce „Pracovní prostory"** 1:1 dle Cloud Design: hlavičky prostorů (chevron toggle + barevná
  tečka + název UPPERCASE + count), pod aktivním/rozbaleným prostorem projekty (tečka + název + počet
  otevřených úkolů), klik na projekt → `projectDetail.open`. Aktivní prostor zvýrazněný.
- **Projekty screen** filtruje karty dle aktivního prostoru (`workspace_id === activeWs`), heading ukazuje
  název prostoru.
- API `/api/workspaces` rozšířeno o `color`.
- Ověřeno: sekce renderuje (Osobní/Můj prostor/Kancelář Praha + counts), klik „Můj prostor" → aktivace +
  rozbalí Doručené(9)/Obchod(5) + footer „Můj prostor" (screenshot); /projekty ukazuje jen Doručené+Obchod.

### Rozhodnutí / odloženo
- **Workspaces přes API, ne PowerSync sync** — Sidebar už workspaces fetchoval z API; ponecháno (menší
  scope, bez sync-config změny). Offline přepínání prostorů by chtělo sync `workspaces` tabulky → odloženo,
  až bude potřeba (projekty samotné jsou synced s `workspace_id`, takže seznam funguje z cache po prvním fetchi).
- **workspaceVia write-path** (apps/api/src/powersync.ts) pro workspace-scoped zápisy (goals) **NEIMPLEMENTOVÁN** —
  žádný konzument zatím (goals obrazovka #25b je P3, bez zápisů). Implementuji s **#25b**, kde se goals reálně
  zakládají/upravují. (YAGNI — negeneralizuji write-path bez volajícího.)
- **Zbývající workspace-aware UI** (Tým a role dle aktivního prostoru, Reporty dle prostoru, Cíle tabs
  personal/team) přijdou s příslušnými obrazovkami (#12 už má členy per-workspace; #35/#25b doplní).

---

## §17 — Opakování: occurrence engine R4 (#21)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P2).

### Postaveno + ověřeno živě
- **`recurrence_rule` sloupec** (aditivní migrace 0005) = JSON strukturovaného `RecurrenceRule`
  ({kind,weekday,nth,day,parity,label}). QuickAdd nově ukládá `JSON.stringify(rule)` (dřív jen label do
  `recurrence`). AppSchema + sync-config (tasks SELECT) + write-path (tasks whitelist) rozšířeny; powersync restart.
- **`lib/occurrences.ts`** — occurrence engine: `expandOccurrences({baseISO,kind,fromISO,toISO,cap})` →
  ISO data výskytů, krok kalendářní od base (daily=+1d/weekly=+7d/biweekly=+14d/monthly=+1měs/yearly=+1rok),
  guard 800. Virtuální identita `occId(taskId,iso)=taskId@iso` + `parseOccId`/`isOccId` (id má `@` na indexu>0,
  ne jen indexOf). `recurrenceKind(json)` vytáhne kind.
- **Projekce do Nadcházející**: recurring úkol se promítne jako base úkol (reálný, na due dni) + budoucí
  výskyty jako **read-only ↻ řádky** (dashed, muted) v horizontu 16 dní.
- Ověřeno: engine (weekly/daily/monthly/biweekly + occId/kind přes dynamický import), „Zálivka květin každou
  středu" → recurrence_rule JSON v Postgresu (kind weekly, weekday 3), Nadcházející STŘEDA 8.7 = reálný úkol +
  STŘEDA 15.7 = ↻ výskyt (screenshot).

### Zjednodušení / odloženo (dle files/logika/02 §3.1)
- **Projekce ignoruje přesné nth/parity/monthly-day** — krok je prostý kalendářní od base (1:1 s prototypem
  `_recOccur`). „Každé první úterý v měsíci" se po pár měsících rozejde s realitou. Pro přesnost by chtěl
  RRULE-like materializer (§3.2) — odloženo (produkční upgrade).
- **Per-occurrence dokončení/přeskočení** (výjimky řady) — výskyty jsou zatím **read-only projekce** (ne
  interaktivní checkbox → žádná atrapa). Per-occurrence stav by chtěl `recurrence_exceptions` JSON sloupec /
  tabulku výjimek. Odloženo za dořešení řad (kalendář den/týden #20 + série editace). Base úkol je plně interaktivní.
- Projekce zatím jen do **Nadcházející**; Dnes ukazuje jen base den (dle prototypu §2.4), Kalendář měsíc řeší #20.

---

## §18 — Workspace-role-aware oprávnění: Host read-only (#14)

**Datum:** 2026-07-01 · autonomní smyčka (poslední P2).

- Role systém: **workspace_role** = admin/manager/member/**guest** (=„Host"); project_role = manager/editor/
  commenter. Host = guest = jen čtení (dle prototypu ROLE_PERMS „Vlastník/Admin/Člen/Host").
- Write-path (`apps/api/src/powersync.ts` → `/api/sync/write`): přidán `isWorkspaceGuest(projectId,userId)` +
  guard v R5 smyčce — pro každý dotčený projekt: pokud je uživatel v jeho prostoru `guest` → **403 read-only-host**.
  (Klientský `WriteRejectedToast` už existuje, takže se odmítnutí propíše do UI.)
- Ověřeno živě: admin PATCH tasku → 200 ok; po `update memberships set role='guest'` stejný PATCH → **403
  read-only-host**; role vrácena na admin.
- Pozn.: project_role `commenter` (jen komentáře) neřešeno — #14 = workspace Host read-only; jemnější
  project-level práva případně samostatně.

---

## §19 — Schránka: inbox triage (#34) — start P3

**Datum:** 2026-07-01 · autonomní smyčka (fáze P3).

### Model inboxu
- **Žádný `is_inbox` flag** — inbox = úkoly v projektu jménem „Doručené"/„Inbox" (kind=flow). Sidebar už
  tak počítá badge. Schránka = **otevřené + undated + top-level** (`parent_id IS NULL`) úkoly v inbox projektech
  (undated = nezařazené; triage jim dá termín → opustí schránku).

### Postaveno + ověřeno živě
- `Schranka.tsx` (route `/schranka`, nahrazen stub) 1:1 dle Cloud Design: header+count, subtitle, karty
  (checkbox dokončit + název→detail + **project select** (přeřadit mimo inbox) + **triage** Dnes/Zítra/Příští
  týden (set due_date) + kebab→detail), prázdný stav „Schránka je prázdná".
- Triage Příští týden = nejbližší pondělí. **Undo bar** (navy pill dole) po naplánování → vrátí `due_date=NULL`.
- Sidebar badge sjednocen s obrazovkou (`!due_date && !parent_id`). `g i` → Schránka (route existuje).
- i18n `inbox` namespace (cs/en).
- Ověřeno: obrazovka renderuje (1 karta „Sepsat zápis z porady", 3 triage; screenshot), „Zítra" → due=2026-07-02
  v Postgresu + karta zmizí + undo bar, „Zpět" → due=NULL + karta zpět.

### Pozn.
- Přeřazení projektu (select) je implementováno (stejný UPDATE pattern), explicitně netestováno živě.
- Triage nemění projekt (úkol zůstane v inbox projektu, jen dostane termín) — dle prototypu (inbox=undated bucket).

---

## §20 — Hledat: 5 entit + header lupa (#33)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P3).

### Postaveno + ověřeno živě
- `Hledat.tsx` (route `/hledat`, nahrazen stub) 1:1 dle Cloud Design: search box (autofocus) + počítadlo
  s **českou pluralizací** (1 výsledek / 2–4 výsledky / 5+ výsledků — verbatim z prototypu ř. 3080),
  prompt stav („Začni psát…"), empty stav, 5 sekcí: **Úkoly** (limit 8, tečka projektu + sub=projekt,
  klik→task detail), **Projekty** (6, kind label Průběžný/Cílový/Periodický, klik→projekt detail),
  **Lidé** (6, avatar+iniciály, přes members API všech prostorů s dedup), **Postupy** (6, done/total kroků
  z chain_steps), **Cíle** (6, scope label).
- **Header lupa → /hledat** (poslední atrapa z #29 dokončena). Zkratky: `/` → /hledat, `g h` → /hledat.
- ⌘K paleta rozšířena o Schránku + Hledat (routes existují).
- Router: `stub()` helper zgeneričtěn (`<P extends string>`) → stub routy jsou typované navigate cíle.
- Ověřeno: „fakt"→3 výsledky (ÚKOLY+sub projekty), „adam"→1 výsledek (LIDÉ), „obch"→1 výsledek (PROJEKTY,
  screenshot), klik projekt→detail panel, lupa z Dnes→/hledat, `/`→/hledat+fokus.

### Rozhodnutí
- **Úkoly vylučují schránkové položky** (undated top-level v inbox projektech) — prototyp vylučuje `t.inbox`;
  náš ekvivalent dle §19 modelu. Naplánované úkoly v „Doručené" zůstávají hledatelné.
- **Klik na osobu → /nastaveni** (Tým a role) — member detail panel přijde s #35; do té doby je Nastavení
  smysluplný cíl (ne atrapa). Klik na postup → /postupy, cíl → /cile (stub routy — stejné cíle jako nav;
  nahradí je #27/#25b).
- Lidé přes REST (members API, ne sync) — konzistentní s #18/#30 přístupem.

---

## §21 — Cíle: obrazovka + workspaceVia write-path (#25b)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P3). Uzavírá modul Cíle (#25 = #25a schema + #25b).

### workspaceVia write-path (apps/api/src/powersync.ts)
- `TableDef.projectVia` je nově volitelný + přidán `workspaceVia: {kind:'column', col}` pro workspace-scoped
  tabulky. Handler větví: workspaceVia → membership kontrola přes `memberships` (cílový i současný workspace
  řádku), `guest` → **403 read-only-host** (konzistentní s #14). TABLES += goals / goal_projects / goal_milestones.
- Ověřeno: PUT goals jako člen → 200 + řádek s `created_by` atribucí; PUT do cizího prostoru → 403 forbidden.
- Pozn.: goal_projects.project_id se nekontroluje proti workspace (klient by mohl odkázat cizí projekt id —
  neleakuje data, jen odkaz; dotáhnout případně s refWorkspaceCols).

### Obrazovka Cíle (route /cile, nahrazen stub)
- `lib/goals.ts` — VERBATIM port `goalProgress` (completion/ontime/count/project) + `goalStatus`
  (done/track/risk: pct < elapsed−12/over) + GSTAT barvy; `goalElapsed` = created→due (prototyp měl mock `elapsed`).
- Taby dle GTABS: personal ws → **Moje**; jinak **Týmové/Projektové/Lidé** (filtr dle `scope`) + počty.
- Karty 1:1: název + stav badge, valueLabel + pct %, progress bar (barva dle stavu), vlastník avatar,
  chips propojených projektů, ↻ periodicita, „do D. M.". Progres z **reálných úkolů** (goalTasks =
  prostor ∩ propojené projekty ∩ scope=person→přiřazené vlastníkovi přes assignments).
- Builder „Nový cíl": název, scope segmenty, metrika segmenty + **METHELP verbatim**, projekt select
  (→ goal_projects), cílová úroveň (úkolů/%), vlastník (členové prostoru), termín, opakování → INSERT přes
  PowerSync (offline-first, ověřeno až do Postgresu).
- Detail panel: badge + progres + sub („N úkolů v hledáčku · uplynulo E % času") + **pace text** (verbatim:
  V tempu/Zaostává…/Po termínu/Cíl splněn) + meta (vlastník/projekt/termín/opakování) + **milníky**
  (add/toggle → goal_milestones, ověřeno DB) + Smazat cíl (kaskáda milestones+links+goal).
- Ověřeno živě: builder → cíl „Uzavřít 10 zakázek v Q3" (count 10, Obchod, 30.9.) → Postgres (všechna pole
  + 1 goal_projects link) → karta „1 / 10 hotových · 10 % · Na cestě" z reálných úkolů → detail (screenshot)
  → milník add+toggle → Postgres done=t.

### Rozhodnutí / odchylky
- **fKeyword/fPerson filtry z prototypu vypuštěny** — nejsou ve schématu #25a (extrakce je vyhodnotila jako
  prototypový mock). Osoba u scope=person = `owner_id` (prototyp: fPerson fallback na owner). Keyword filtr
  případně aditivně později.
- **Builder bugfix z ověření:** GoalModal neměl Esc-close → starý mount z jiného prostoru přežil přepnutí
  a zapsal špatný scope/owner. Přidán Esc handler + owner default po načtení členů. (Demo řádek srovnán.)
- „period" textové pole prototypu (Q3 2026) → nahrazeno reálným date inputem (due_date v DB), karta ukazuje
  „do D. M." — období bez sloupce nezavádím.

---

## §22 — Reporty: Přehled + Lidé + member detail (#35)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P3). Modul byl v baseline auditu 0/29.

### Postaveno + ověřeno živě
- `Reporty.tsx` (route `/reporty` + search parametry `?tab=lide&clen=<id>` → deep-link na member detail;
  nahrazen stub). Header s ws tečkou + názvem; taby **Přehled/Lidé jen pro týmový prostor** (wsTeam z prototypu).
- **Přehled**: 3 KPI (hotovo tento týden / po termínu / průměr/den s českou čárkou) — **reálné** z completed_at/
  due_date (prototyp měl mock čísla); týdenní graf Po–Ne z completed_at aktuálního týdne (prototyp mock
  [[Po,6]…]); „Podle projektu" (done počty, bar dle max, barva projektu); karta Cíle (wsP→mé cíle dle
  owner_id=me, jinak scope=team — verbatim ř. 3187) s kompaktními goal řádky (label+pct+bar, GSTAT barvy)
  + „Všechny cíle →" → /cile.
- **Lidé**: roster (avatar/jméno/email, overdue chip, load bar `min(100, open*13)%` verbatim, počet otevřených);
  „Přidat člena" → /nastaveni (invite modal přijde s #39 — ne atrapa).
- **Member detail panel** (440px): avatar+jméno+email, efektivita `done/(done+open)` s barem, staty
  otevřených/po termínu/hotovo, **role segmenty Admin/Člen/Host** → PATCH /api/workspaces/:id/members/:userId/role
  (owner → chip Vlastník, segmenty skryté — endpoint ownera odmítá), úkoly člena top 10 (klik→task detail),
  „Podle projektu" rozpad (bar `min(100,count*22)%`), cíle člena, footer „Zobrazit úkoly" → /ukoly.
- **Hledat** klik na osobu přesměrován z /nastaveni na `/reporty?tab=lide&clen=<id>` (member detail deep-link).
- Ověřeno: Přehled reálná data (1 hotovo/5 po termínu/0,1 průměr; Obchod 1; Tvé cíle 1/10·10 %); Kancelář →
  taby → Lidé roster 5; klik Tomáš → detail (?clen= v URL, screenshot); role Admin→Host→Admin ověřeno v DB.

### Rozhodnutí
- Atribuce úkolů členovi = přes `assignments` (user_id) — prototyp `t.people`. Kancelář nemá projekty/úkoly →
  staty 0 (správně; reálná data, žádný mock seed jako prototyp).
- Prototypí mock „doneCount" seed (hash z id) záměrně NEreplikován — reálné počty.
- role `manager` mapována na segment Admin (enum má admin/manager/member/guest, segmenty jen 3 dle designu).

---

## §23 — Postupy: obrazovky + jádro advance (#27)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P3). Poslední velký stub modul (baseline 1/44).

### Jádro advance (lib/chainAdvance.ts) — port `_advance`/`rewindStep`
- **`advanceChainForTask(taskId, nowDone)`** volané ze VŠECH toggle míst (lib/tasks.toggleTask — Today i
  Schránka přesměrovány na něj; TaskDetailPanel.toggleDone; Postupy „Dokončit krok"): done → krok `done` +
  první neuzavřený krok se všemi předchozími uzavřenými se aktivuje (gate `after_previous`); `with_previous`
  se aktivuje souvislým během spolu s předchozím; `manual` zůstává dormant (čeká na ruční aktivaci).
  Un-done → **rewind** (cílový krok active, pozdější dormant + úkoly od-dokončeny — verbatim ř. 2555).
  Chain state se synchronizuje (všechny kroky uzavřené → done + completed_at).
- **ROZHODNUTÍ: advance běží KLIENTSKY** (PowerSync UPDATE, LWW) — původní plán byl server-authored;
  klientský stačí pro single-writer tok, server-authored až při řešení konfliktů více klientů (budoucí task).

### Obrazovky (route /postupy + ?postup=<id> deep-link; nahrazen poslední velký stub)
- **Přehled**: karty 1:1 (proj tečka, název, done/total, bar — červený když stuck, „Teď: {krok} · {kdo}",
  ⚠ stuck chip), filtr „Jen kde jsem na řadě" (aktivní krok přiřazen mně přes assignments), empty stav + CTA.
- **Builder** (Esc-close): název, projekt select, kotva (reálný date input), Plánovat Od začátku/Do termínu
  (deadline → effAnchor = kotva − maxOffset, verbatim), **šablony** (3 z FLOW_TEMPLATES verbatim, bez mock
  osob), kroky (název, osoba = project members API → assignment, gate cycle Auto→Souběh→Ruční, kotva+offset
  s živým datem, priorita), + Přidat krok → INSERT chain + per krok task (due=kotva+offset) + chain_step
  (první active) + assignment.
- **Detail** (470px): hlavička (progress, bar, Teď na řadě, ETA=max due, kotva hint), **časová osa** —
  číslované tečky dle stavu, relay avataři mezi kroky („předá →"), karty kroků (kdo+P#+termín+stav chip,
  gate label, **Dokončit krok** na aktivním, **Aktivovat krok** na dormant manual s uzavřenými předchůdci,
  **↩ Vrátit sem** s dvoukrokovým potvrzením na hotových).
- Hledat: klik na postup → detail deep-link.
- Ověřeno živě: šablona Plakát → Postgres (chain + 5 kroků, kotva 07-08 + offsety, první active) → karta
  „0/5 · Teď: Udělat návrh plakátu" → Dokončit krok → 0 done/1 active (DB) → Dokončit → **manual krok 2
  zůstal dormant** + Aktivovat → active → **rewind na krok 0** → vše dormant + úkoly od-dokončeny + chain
  active (DB). Screenshot osy.

### Odloženo (dokumentované)
- **Reflow/kaskáda** (Řetězec vs Kotva režim, ±1 den shift, Bez víkendů, přelévání zpoždění `_reflow`) —
  postupy zatím jedou v režimu **Kotva** (pevné termíny z kotvy; hint v detailu). Kaskáda = samostatný task.
- **Uložit jako šablonu** (potřebuje persistenci šablon — `templates` tabulka neexistuje; chains.template_id
  připraven), **Připomenout** na kroku (reminders per krok), **flow chip na kartách úkolů** + „Tvůj další
  krok" panel na Dnes — doplní #40 fidelity batch.
- Role placeholders (FLOW_ROLES „dosadí se při založení") — prototypový koncept bez schématu, vypuštěno.

---

## §24 — Úkoly: Board R9 + toolbar + seznamová nav (#17 + #36)

**Datum:** 2026-07-01 · autonomní smyčka (fáze P3).

### Postaveno + ověřeno živě
- **View switcher** Seznam | Nástěnka | Kalendář (Kalendář existoval) + **per-user výchozí** v localStorage
  (`watson.viewMode`). Ověřeno: přepnutí persistuje.
- **Nástěnka (Board)**: sloupce = `statuses` dle position (seed K udělání/Probíhá/Hotovo), umístění karty =
  `status_id` → fallback completed_at→is_done sloupec → první sloupec. Karty 1:1 (proj tečka, název, P pill,
  termín, ↻). HTML5 DnD (bez knihovny) s **dataTransfer text/plain** (id tasku — robustní i pro syntetické
  eventy). **R9**: drop do sloupce s `is_done` → `completed_at=now` + status_id (a zpět → NULL); napojeno i na
  `advanceChainForTask` (krok postupu dokončený z boardu → advance). Ověřeno v Postgresu: drag → Probíhá
  (status_id, completed_at NULL) → Hotovo (completed_at 21:47) → reverted.
- **TasksToolbar** (sdílená komponenta): Filtr (priorita chips v popoveru), Řazení (Chytré=priorita→termín /
  Termín / Priorita / Abeceda) + směr ↑↓, Dokončené toggle, aktivní chips s ×. Ověřeno: filtr P1 20→5 karet.
- **Seznamová klávesová nav** (port kbSel ř. 2263–2276): j/k/↑↓ pohyb (brass ring), Enter=detail,
  Space=toggle done, 1–4=priorita, Esc=zrušit výběr. Guard: jen list view, ne při psaní/otevřeném detailu.
  Ověřeno: j j → ring, Enter → detail panel.

### Rozhodnutí / odloženo
- Toolbar dimenze **status + lidé** (prototyp filtr chips) — odloženy do #40 (status filtr má smysl až s více
  statusy per projekt; lidé potřebují assignments výčet v toolbaru). Sort „Projekt/Stav" dtto.
- **Sdílení toolbaru na Dnes/Nadcházející** (#36 „sdílený") — komponenta je sdílená (export filterTasks/
  sortTasks); zapojení do Dnes/Nadcházející doplní #40 batch (obrazovky mají vlastní grupování).
- Board drag-reorder V RÁMCI sloupce (bOrder/gapBefore v prototypu) — vypuštěno (žádný position sloupec na
  tasks; přesun mezi sloupci je jádro). ⌫ mazání s undo v list nav — vypuštěno (delete je v detail panelu).
- Zjištění pro #40: TaskDetailPanel nemá Esc-close (prototyp Esc zavírá selectedId) — doplnit.
