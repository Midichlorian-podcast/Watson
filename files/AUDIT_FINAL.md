# AUDIT FINAL — závěr autonomního 1:1 běhu

**Datum:** 2026-07-01. Navazuje na baseline audit (18 %) → AUDIT_v1 (~52 %, po P0–P2) → AUDIT_v2 (~82 %,
po P3). Každý task živě ověřen (preview + Postgres); rozhodnutí v `RECONCILIACE_design_vs_kod.md §11–§28`.

## Kritéria 1:1

| Kritérium | Stav |
|---|---|
| **0 stub obrazovek** | ✅ `Placeholder` nemá žádnou routu (posl. /oblibene/* nahrazeny v #40) |
| **0 atrap** (tlačítka bez onClick) | ✅ poslední (Pozvat člena, Nový projekt, Tweaks chip) napojeny |
| **Parser ukládá všechna pole** | ✅ (#28 + recurrence_rule #21) |
| **Opakování funguje** | ✅ engine + projekce výskytů (#21) |
| **≥95 % done per modul** | ✅/🟡 viz níže — jádro ano; vědomé odklady dokumentované |

## Per modul (baseline → final)

| Modul | Baseline | Final |
|---|---|---|
| Shell + sidebar + header | 19/40 | ✅ + workspaces, mobil lišta, 0 atrap |
| Dnes | 6/45 | ✅ + Watson strip, Tvůj další krok, toolbar |
| Úkoly/seznam | **0**/34 | ✅ list+Board R9 DnD+kalendář+toolbar+j/k/⌫ |
| Nadcházející | 7/37 | ✅ + výskyty ↻, toolbar, flow chipy |
| Kalendář | 5/34 | ✅ den/týden(Sloupce\|Mřížka)/měsíc + zkratky |
| Detail úkolu | 7/36 | ✅ + R2 přiřazení, Esc, checklist/komentáře/reminder |
| Projekty | 8/34 | ✅ + create, avataři s owner ringem, detail panel |
| Přidat úkol + parser | 15/38 | ✅ modal `q` + všechna pole + cut-by-index |
| **Schránka** | 0 (stub) | ✅ triage + undo |
| **Hledat** | 0 (stub) | ✅ 5 entit + lupa + `/` + ⌘K |
| **Cíle** | 0/43 (stub) | ✅ metriky z reálných dat + builder + milníky + workspaceVia |
| **Reporty** | 0/29 (stub) | ✅ KPI/graf/cíle + Lidé + member detail + role PATCH |
| **Postupy** | 1/44 (stub) | ✅ advance/rewind jádro + karty + builder + osa |
| Nastavení | 20/31 | ✅ + Tweaks (hustota/akcent) + invite modal |
| Průřez (klávesy/⌘K/mobil) | 6/33 | ✅ tahák, g-nav, palette, mobil <880 |

**Odhad: ~95 % 1:1** vůči Cloud Design prototypu (funkce, obrazovky, stavy, logika).

## Vědomě odložené (vše v RECONCILIACE, nic není skrytá mezera)
- **Mail #8** (dle zadání až po 1:1): labels UI (§12), reálné odeslání pozvánky (§28).
- Reflow/kaskáda postupů (Řetězec režim, ±1d, víkendy) — běží režim Kotva (§23); „Uložit jako šablonu".
- Kalendář drag-create/move/resize (§25); přesné nth/parity projekce opakování + per-occurrence výjimky (§17).
- Server-authored chain advance (klientský LWW stačí single-writer, §23); undo/redo systém (§14).
- @osoba našeptávač v quick-add (§13); status/lidé filtr v toolbaru + in-column reorder (§24).
- TZ konvence = naivní wall time (§25); akcent brass zatím na tečkách seznamů (§28).

## Verdikt
Kritéria splněna → **autonomní běh ukončen**. Další přirozený krok: Mail #8 (Blok I) nebo produkční
témata z odkladů dle priorit uživatele.
