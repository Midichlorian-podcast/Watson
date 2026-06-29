# files/logika/ — LOGICKÁ SPECIFIKACE (vytažená z prototypu Claude Design)

> **Co to je:** vyčerpávající zachycení **veškeré logiky** z `design/handoff_watson/WatsonApp.dc.html`
> (3268 ř., celá appka v jedné `class Component`). Protože **design = zdroj pravdy**, tohle je
> **závazná specifikace chování** — implementuj z těchto dokumentů, ne z prototypu (ten je reference
> a má vědomá zjednodušení; viz níže).
>
> **Úplnost:** ze 97 metod prototypu je **95 zachyceno**; nepokryté jsou jen 2 triviální helpery
> (`_pad2` = doplnění nuly, `goalFresh` = prázdný draft cíle) — žádná logika v nich není.
> Extrakci dělaly 4 paralelní agenti (2026-06-29), každý čtl celý prototyp.

## Soubory
| Soubor | Pokrývá | Ř. |
|---|---|---|
| [`01-parser-quickadd.md`](01-parser-quickadd.md) | Quick-add parser (čeština): priorita/čas/trvání/datum/opakování/`#projekt`/`@osoba`; **verbatim tabulky** (`czNum`, všední dny `WD`, `nthDefs`, `RECVOCAB` regex, `freshDraft`); našeptávače, highlight tokenů, empty-name guard | 1191 |
| [`02-opakovani-kalendar.md`](02-opakovani-kalendar.md) | Model výskytů (`baseId@YYYY-MM-DD` + `exceptions` mapa), dva horizonty (seznamy 16 dní / kalendář dle rozsahu), advance série (`repeatDoneCount`), kalendář den/týden/měsíc, layout/overlap, drag/resize/drag-create | 560 |
| [`03-postupy-cile-projekty.md`](03-postupy-cile-projekty.md) | Štafeta (`_advance`, gates auto/manual/parallel, kaskáda `_reflow` Řetězec/Kotva, builder), **metriky cílů** (verbatim vzorce completion/count/ontime/project + stav), typy projektů (Průběžný/Cílový/Periodický) | 680 |
| [`04-shell-stav-zkratky.md`](04-shell-stav-zkratky.md) | Globální stav (všechna pole), **klávesová mapa** + Esc kaskáda, command palette, undo/redo, persistence, theme/hustota, workspaces, search, filtry/řazení, **datový model úkolu (~60 polí)**, seed | 547 |

## Mapování modul → build úkol (postupná implementace)
| Logický modul | Build úkol | Fáze |
|---|---|---|
| Datový model úkolu · stav · shell · zkratky · search · filtry | #2 (shell), #3 (sync) | MVP |
| Quick-add parser | #7 | MVP |
| Opakování / výskyty | #4–6 (Dnes/Úkoly/detail) | MVP |
| Kalendář den/týden/měsíc | *nový úkol „Kalendář"* | MVP základ · drag/resize v2 |
| Projekty (typy, stav, vlastník, per-uživatel view) | *nový úkol „Projekty"* | MVP |
| Nastavení + role (Vlastník/Admin/Člen/Host) | *nový úkol „Nastavení"* | MVP |
| **Postupy / štafeta** | (z fazovane_ukoly_PLAN) | **v2** |
| **Cíle** | — | **v2** (OKR) |
| **Reporty** | — | **v2** (dashboardy) |

## ⚠️ Produkční opravy/rozhodnutí, které extrakce odhalila (NEZTRATIT)
Prototyp má vědomá zjednodušení a pár reálných děr. Při implementaci řešit:
1. **Opakování — `repeatRule` (n-tý den / „každého 25." / sudý-lichý) se v projekci IGNORUJE** → jede plochý krok od kotvy a časem ujede. **#1 oprava.** (02)
2. **Gate „Souběh ⇉" (parallel) nemá v `_advance` větev** → nikdy se sám nerozsvítí; jen vizuál. (03)
3. **Kalendář drag/drag-create jede legacy červnové číslo dne** (spolehlivé jen v červnu 2026), render je už ISO → sjednotit na ISO. (02)
4. **Dvě nesladěné „hustoty"** (UI přepínač řídí jen kalendář PPM; `densityAttr` z `props`) → jedna per-uživatel preference. (04)
5. **`filterPri` jednou skalár, jindy pole** → sjednotit na multi-select. (04)
6. **Dva konfliktní cíle auto-scrollu** kalendáře (7:00 vs 8:00/now). (02)
7. **Advance série neresetuje per-osoba dokončení/subtasky** → sladit s **R4**. (02)
8. **Rewind postupu nemá roli/audit** (kdokoli, kdykoli) → produkčně manager-only + audit (R-CH1). (03)
9. **Per-krok `project` (předání mezi projekty)** vs **R5** scoping → produkčně per-krok scoping + validace členství. (03)
10. **Cíle**: `taskOnTime` a stav projektu jsou v prototypu hash-simulované → produkčně počítat z reálných úkolů na serveru. (03)
11. **Persistence** = localStorage + seed → produkčně přes **sync engine** (ne localStorage pro doménová data — CLAUDE.md). (04)
12. **Parser**: fixní `recBase` 25.6.2026, hardcoded `pozítří`, default rok 2026, bez validace délky měsíce, duplicitní čištění názvu (`parseQuick` vs `submitTask`). (01)

*(Plný seznam zjednodušení je v každém spec souboru v sekci „vědomá zjednodušení".)*

## Disciplína (anti-fork)
Každé nové **logické** rozhodnutí z Claude Design → vždy sem do `files/logika/` (ne nechat jen v
prototypu). Tahle vrstva je závazná pro implementaci. Souvisí: `files/RECONCILIACE_design_vs_kod.md`
(srovnání + fáze), `files/CLAUDE.md` (invarianty, design = zdroj pravdy).
