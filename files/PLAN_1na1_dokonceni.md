# PLÁN: Watson → „1:1" s Cloud Design (autonomní dokončení)

> Řídící dokument pro dlouhý autonomní běh. Cíl uživatele: po návratu mít appku **nakódovanou 1:1
> dle Cloud Design, zauditovanou a ověřenou**. Stojí na [AUDITU](AUDIT_design_vs_implementace.md)
> (517 položek) + [RECONCILIACI](RECONCILIACE_design_vs_kod.md) + backlogu tasků #8–#40.

## 1. Definice „hotovo" (1:1)

Appka je 1:1, když **re-audit** ukáže:

- **0 stub obrazovek** — Cíle, Reporty, Postupy, Hledat, Schránka jsou reálné (dnes `Placeholder`).
- **0 „atrap"** — žádné tlačítko/ikona bez akce (lupa, Watson pill, zvonek, „Více →", +Úkol, Pozvat člena).
- **Každý modul ≥ 95 % `done`** proti prototypu (vizuál + funkce + stav + logika).
- **Parser neztrácí data** — quick-add ukládá všech ~20 polí (dnes ~6).
- **Opakování funguje** — výskyty se projikují (dnes se `recurrence` zahazuje).
- **Fidelity 1:1** — extract přesného markupu/CSS z prototypu, ne interpretace.

Mimo rozsah 1:1: **mail vrstva (#8)** — v Cloud Design NENÍ (samostatný pozdější design+build track).

## 2. Výchozí stav (audit 30.6.2026)

18 % done · 17 % partial · 65 % missing. Vážený postup ~26 %. Hotové: shell, Nastavení, parser,
Projekty (vč. metadat #16), karta úkolu, Dnes, sync vrstva detailu (#24). Zbytek = tento plán.

## 3. Metodika (per položka — nedělitelná smyčka)

1. **Extract** přesného markupu/CSS z `design/handoff_watson/WatsonApp.dc.html` + screenshotu (ne z paměti).
2. **Build** z `--w-*` tokenů, dle konvencí repa.
3. **Typecheck** (web+api+db) — tvrdá brána.
4. **Živě ověřit** — preview (port 5173) + magic-link login `demo@watson.test`; klik/zápis → screenshot/DB.
5. **Commit** atomicky per task; migrace aditivní (`drizzle-kit generate`+`migrate`); po sync změně `docker restart watson-powersync`.

**Guardrail:** nikdy neoznačit `done` bez živého ověření. Nezamlčovat blokace.

## 4. Autonomní mechanismus

- Po „začni": **self-paced `/loop`** — bere task po tasku z roadmapy (§5), staví→ověřuje→commituje.
- **Workflows** pro: (a) paralelní extract markupu modulů, (b) **milestone re-audit** (měření % k 1:1)
  na hranicích fází, (c) build v `worktree` kde jde paralelizovat bez konfliktu.
- **Checkpoint** = commit + (na hranici fáze) re-audit report do `files/`. Uživatel po návratu vidí
  akumulované commity + poslední re-audit % + seznam případných blokací.
- **Infra helper:** re-login (magic-link přes DB token), migrace, powersync restart — zautomatizováno.

## 5. Roadmap (P0 → P4)

### FÁZE P0 — Datové fundamenty  *(strop projektu; bez nich 3 moduly + půl detailu nutně `missing`)*
- ✅ **#16** Projekt metadata (typ/vlastník/stav/termín/DoD) — HOTOVO
- ✅ **#24** Sync detail tabulek (assignments/checklist/comments/reminders) — HOTOVO
- **#25a** Cíle — schéma `goals` (+ enumy metric/scope/periodic, milestones) + sync + write-path
- **#26** Postupy — schéma `chains`/`chain_steps` (+ `step_status`/`gate` enum) + sync + write-path
- **P0.labels** — `labels`/`task_labels` sync (workspace bucket) — pro štítky v detailu

### FÁZE P1 — Odstranit atrapy + živé vstupy  *(vysoký dopad, nízká cena)*
- **#28** Add-task modal + `submitTask` ukládá všech ~20 polí + zkratka `q` (napojit +Přidat úkol/+Úkol)
- **#29** Napojit atrapy (lupa→Hledat, Watson pill→panel, zvonek, „Více →")
- **#30** Detail úkolu — assignment_mode R2 + ✅checklist + ✅komentáře + štítky + připomínky + avataři řešitelů
- **#13** Quick-add — `people` našeptávač (mrtvý kód) + cut-by-index refaktor + RECVOCAB over-match

### FÁZE P2 — Průřezové vrstvy  *(odemykají UX napříč vším)*
- **#31** Globální klávesové zkratky (`/`, `q`, Esc kaskáda, **G-navigace**, list-nav j/k/Space/1-4/⌫, `?`)
- **#32** ⌘K command palette
- **#19** Multi-workspace scoping + přepínač + sidebar sekce „Pracovní prostory" (filtr úkolů/projektů/cílů)
- **#21** Opakování engine — persistence `recurrence` + `_recOccur`/`makeOcc`/`exceptions` + R4 advance
- **#14** Role-aware oprávnění (Host read-only ve write-path)
- **#37** Watson/AI panel (assistant drawer + greet + návrhy; server-side Claude API, mantinely)

### FÁZE P3 — Dostavět obrazovky  *(po datových fundamentech)*
- **#34** Schránka — inbox triage (`is_inbox` + naplánovat Dnes/Zítra/Příští + undo)
- **#33** Hledat — 5-entitní (úkoly/projekty/lidé/postupy/cíle) + header search input + ⌘K napojení
- **#25b** Cíle — obrazovka (karty + detail + progres + metriky z reálných úkolů)
- **#35** Reporty — Přehled (KPI/graf/podle projektu/cíle) + Lidé (roster/vytížení) + Member detail panel
- **#27** Postupy — seznam + detail (timeline/relay) + builder + jádro `_advance`/`_reflow` (server-authored)
- **#17 + #36** Board/Nástěnka (statusy, R9 drop) + toolbar Filtr/Řazení/Dokončené (sdílený)
- **#20** Kalendář den/týden časový grid + all-day + multi-day + drag/resize/create + now-linka
- **#15** Projekt create endpoint + „Nový projekt" modal
- **#18** avataři členů na kartách Projektů

### FÁZE P4 — Leštění + mobil  *(poslední vrstva)*
- **#40** Fidelity cleanup — všechny `partial` položky z auditu (panely 444px/wSlide, meta pilulky, empty stavy)
- **#38** Mobil — detekce <880, spodní lišta, skrytý sidebar (PWA/tablet split)
- **#39** Nastavení Tweaks panel (hustota Vzdušné/Vyvážené/Kompaktní + accent) + invite modal + karta člena

### Milníky (re-audit)
Po **P0**, **P1**, **P2**, **P3**, **P4** → re-run audit workflow → commit `AUDIT_v{n}.md` s % done.
Cíl: konec P3 ≥ 90 % done, konec P4 = **1:1**.

## 6. Rizika & jak je řeším
- **Migrace** — aditivní, na prázdných tabulkách bez backfillu; generate+migrate; ověřit sloupce.
- **PowerSync join limit** — denormalizace `project_id` na task-children (osvědčeno #24).
- **Sync workspace-scoped entity** (labels/goals workspace) — nový bucket dle membership prostoru.
- **Auth při restartu serveru** — re-login helper (magic-link token z DB).
- **Přehlášení „done"** — každý task živě ověřen; re-audit jako nezávislá kontrola.
- **Objem** — self-paced loop + workflows; commit po každém kroku (nic se neztratí při přerušení).

## 7. Pořadí = závazné
P0 → P1 → P2 → P3 → P4. Uvnitř fáze dle dopadu. Mail (#8) až po dosažení 1:1 core (nebo na tvůj pokyn dřív).
