# AUDIT v2 — stav po fázi P3 (checkpoint)

**Datum:** 2026-07-01 · autonomní 1:1 běh. Navazuje na `AUDIT_v1.md` (~50–55 % po P0–P2).
Každý task ověřen živě (commity + `RECONCILIACE §19–§26`).

## P3 — dostavěné obrazovkové moduly ✅ (vše, co bylo v baseline „stub")

| Task | Modul | Klíčové | Commit |
|---|---|---|---|
| #34 | **Schránka** | inbox triage (Dnes/Zítra/Příští týden + projekt select + undo) | 225f67a |
| #33 | **Hledat** | 5 entit, česká pluralizace, header lupa + `/` + `g h` | 57591c1 |
| #25b | **Cíle** | workspaceVia write-path + karty s reálnými metrikami + builder + detail s milníky | 86a3d7f |
| #35 | **Reporty** | KPI/týdenní graf/podle projektu/cíle z reálných dat + Lidé + member detail (role PATCH) | 3318ec3 |
| #27 | **Postupy** | advance/rewind jádro (after_previous/with_previous/manual) + karty + builder + osa | cd8c37a |
| #17+#36 | **Úkoly Board+toolbar** | Board dle statusů + DnD R9 + Filtr/Řazení/Dokončené + j/k nav | a7b70a0 |
| #20 | **Kalendář den/týden** | časový grid PPM 0,62 + celodenní pás + now-line + ←/→/d/1-3 | dfd888a |
| #15+#18 | **Projekt create + avataři** | POST /api/projects (+statusy seed) + modal + avataři s owner ringem | 9da67ab |

## Modul × stav (vs. baseline 18 % / AUDIT_v1 ~52 %)

| Modul | Baseline | Teď |
|---|---|---|
| Nastavení / Shell / Přidat úkol / Projekty / Detail / Dnes / Nadcházející | částečné | ✅ vysoké |
| Úkoly/seznam (bylo 0 done) | 🔴 | ✅ list+board+kalendář+toolbar+klávesy |
| Kalendář | 🟡 měsíc | ✅ den/týden/měsíc |
| Schránka / Hledat / Cíle / Reporty / Postupy (bylo 5 stubů) | 🔴 | ✅ plné obrazovky s reálnými daty |

**Stub routy: jen `/oblibene/p1` a `/oblibene/me`** (řeší #40 — reálné filtry). Žádné atrapy
(všechna tlačítka mají onClick s reálným cílem).

## Odhad: ~80–85 % 1:1

## Zbývá — P4 (leštění)
- **#40 fidelity cleanup**: /oblibene/* reálné filtry; TaskDetailPanel Esc-close; flow chip na kartách
  úkolů + „Tvůj další krok" na Dnes; toolbar na Dnes/Nadcházející; partial položky z baseline auditu
  (statusy filtr, sort projekt/stav, board in-column reorder, occurrence detail výjimky…).
- **#38 mobil** (<880: spodní lišta, skrytý sidebar). **#39 Tweaks panel** (hustota/accent) + invite modal.
- Vědomě odložené (RECONCILIACE): reflow/kaskáda postupů, drag-create kalendáře, labels UI (Mail #8),
  server-authored advance, undo/redo systém, TZ konvence.
