# AUDIT v1 — stav po fázích P0–P2 (checkpoint)

**Datum:** 2026-07-01 · autonomní 1:1 běh. Navazuje na `files/AUDIT_design_vs_implementace.md` (baseline:
94 done / 86 partial / 337 missing = ~18 % hotovo). Toto je **progress delta**, ne plné re-ověření 517 položek —
každý task níže byl ověřen živě (viz commity + `RECONCILIACE §11–§18`).

## Hotové fáze

### P0 — Datové fundamenty ✅
- **#16** Projekt metadata: `kind`/`status`/`owner_id`/`delivery_date`/`definition_of_done` + panel (migrace 0004).
- **#24** Detail sync tabulky: comments/checklist_items/assignments/reminders (+ labels/task_labels existují).
- **#26** Postupy datový model: `chains`/`chain_steps` (+ enumy gate/step_state).
- **#25a** Cíle datový model: `goals`/`goal_projects`/`goal_milestones` + bucket `user_workspaces`.
- **#21** `recurrence_rule` (JSON struktura) — migrace 0005.

### P1 — Atrapy + mrtvý kód ✅ (největší past z baseline auditu)
- **#28** Globální Add-task modal (zkratka `q`) + `QuickAdd.submit` ukládá **všechna** parsovaná pole
  (dřív se výstup parseru zahazoval — hlavní kritika baseline auditu **vyřešena**).
- **#29 + #37** Atrapy napojeny: Watson pill + zvonek + „Více →" → **Watson drawer** (greet + insights + staty).
  Lupa → odloženo na #33 (Hledat). `+Úkol`/`+Přidat úkol` → modal.
- **#30** Detail úkolu: **Přiřazení R2** (single/shared_any/shared_all) + avataři + per-osoba done + badge Připomenutí.
- **#13** Parser: cut-by-index + RECVOCAB over-match fix (slova v názvu se nemažou) + odstraněn mrtvý recVocab.

### P2 — Globální průřezové vrstvy ✅
- **#31** Klávesové zkratky (`?` tahák, `g`+navigace, `q`, Esc) — 1:1 cheatsheet overlay.
- **#32** ⌘K command palette (fuzzy: obrazovky + projekty; lidé/postupy odloženo za #19/#27).
- **#19** Workspaces: aktivní prostor (localStorage) + přepínač v sidebaru + filtr Projektů.
- **#21** Opakování occurrence engine R4 + projekce výskytů do Nadcházející.
- **#14** Host (workspace guest) read-only ve write-path.

## Modul × stav (aktualizováno)

| Modul | Baseline | Teď | Pozn. |
|---|---|---|---|
| Nastavení | 20/5/6 | ✅ ~vysoké | Tweaks panel #39 (P4) |
| Shell | 19/8/13 | ✅ vysoké | + workspace sekce, atrapy napojeny |
| Přidat úkol + parser | 15/6/17 | ✅ vysoké | modal + všechna pole + cut-by-index; @osoba našeptávač za #19-done→doplnit |
| Projekty | 8/12/14 | ✅ dobré | + workspace filtr; Nový projekt #15 (P3) |
| Detail úkolu | 7/8/21 | ✅ dobré | + R2 + reminder badge; per-occurrence/labels odloženo |
| Nadcházející | 7/9/21 | ✅ dobré | + projekce výskytů R4 |
| Dnes | 6/10/29 | ✅ dobré | + Watson strip napojen |
| Kalendář | 5/5/24 | 🟡 částečné | měsíc OK; den/týden grid #20 (P3) |
| **Úkoly/seznam** | 0/11/23 | 🔴 **stub** | view modes/Board/toolbar #17/#36 (P3) — hlavní mezera |
| **Schránka** | 0/3/36 | 🔴 **stub** | #34 (P3) |
| **Hledat** | 0/·/· | 🟡 částečné | ⌘K palette hotová; obrazovka + header search #33 (P3) |
| **Cíle** | 0/0/43 | 🟡 schema | obrazovka #25b (P3) |
| **Reporty** | 0/0/29 | 🔴 **stub** | #35 (P3) |
| **Postupy** | 1/0/43 | 🟡 schema | obrazovky + `_advance` #27 (P3) |

## Zbývá — P3 (dostavět obrazovky) → P4 (leštění)
- **P3:** #34 Schránka · #33 Hledat (+dokončí lupu #29) · #25b Cíle obrazovka (+workspaceVia write-path) ·
  #35 Reporty · #27 Postupy obrazovky+advance · #17/#36 Board+toolbar (+seznamová j/k nav) · #20 Kalendář den/týden ·
  #15 projekt create · #18 avataři členů.
- **P4:** #40 fidelity cleanup (partial položky) · #38 mobil (<880) · #39 Tweaks panel.
- **Odloženo:** #8 Mail (až po 1:1).

## Odhad
Baseline ~18 %. Po P0–P2 jsou hotové **všechny průřezové vrstvy + datové fundamenty + půlka obrazovek**.
Hrubý odhad ~50–55 % hotovo 1:1. Zbývající ~45 % = 6 obrazovkových modulů (P3) + leštění (P4).
Klíčové: 5 „stub" obrazovek z baseline (Cíle/Reporty/Postupy/Schránka + Úkoly-seznam) je stále hlavní mezera —
mají ale připravené datové modely, takže P3 je „jen" UI + logika, ne fundament.
