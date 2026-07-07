# GAP ANALÝZA — co Watsonu chybí k „firemnímu powerhouse"

> Vstup: aktuální stav (12 obrazoven, offline sync, opakování, postupy, cíle, reporty — funkčně
> kompletní task manager), audit 2026-07-07, `porovnani_todoist_notion_asana.md`, v2/v3 roadmapa
> v CLAUDE.md. Cíl: nástroj, který denně unese celá firma (15–30 lidí, většina ne-vývojáři, terén
> i kancelář). Řazeno podle **návratnosti pro každodenní produktivitu**, ne podle velikosti.

---

## A. ZÁKLADY — bez nich to není „daily driver" (dělat první)

| # | Mezera | Proč to bolí | Velikost |
|---|---|---|---|
| A1 | **Výkon ve velkém** (viz AUDIT ČÁST B/P0) | 30 lidí × desítky tisíc úkolů dnes appka neunese — full-scany, žádná virtualizace, `task_activity` roste do stovek MB na každém zařízení. | L |
| A2 | **Mobil použitelný** | Půlka obrazovek (Nastavení/Schránka/Cíle/Reporty/Postupy) je na telefonu **nedostupná**; header přetéká. Terénní lidé (trenéři, baristé) jsou primárně na mobilu. | M |
| A3 | **Přílohy reálně** | Modal sbírá jen názvy souborů, nic se neukládá (R2/R10 do R2 storage). DoD MVP počítá se základními přílohami. | M |
| A4 | **Notifikace — ovládání + digest** | Web Push existuje, ale **není kde ho zapnout** (přepínače v Nastavení jsou atrapy); chybí denní digest a tiché hodiny v UI. | M |
| A5 | **AI vůbec neexistuje** | Ověřeno grepem: v repu **není žádná** integrace Claude/Anthropic (žádný `/api/ai`, žádné SDK). „Watson" panel i CZ quick-add jedou bez AI; **filtry z české věty** (hlavní deklarovaný diferenciátor) nejsou. Quick-add má jen lokální parser (ten je hotový a dobrý). Dotáhnout server-side s mantinely (nemaže, nepíše externím, vždy undo, audit, tiché hodiny). | L |
| A6 | **Zálohy + export + provoz** | „Kdo to spravuje/zálohuje" je podmínka důvěry u vlastní appky. Automatické zálohy Postgresu, export workspace (JSON/CSV), monitoring, rate-limit. | M |

## B. NÁSOBIČE PRODUKTIVITY — vysoká ROI pro firemní procesy

| # | Mezera | Užitek | Velikost |
|---|---|---|---|
| B1 | **Šablony úkolů/projektů + auto-datování** | Opakující se procesy (onboarding, grantové kolo, spuštění epizody, event) jedním klikem s posunutými termíny. Postupy už mají „řetězce" — šablony jsou přirozené rozšíření. | M |
| B2 | **Uložené filtry / vlastní pohledy** | „Moje na tento týden", „Po termínu v projektu X", sdílené týmové pohledy. Toolbar filtry existují, chybí uložení/sdílení. | S–M |
| B3 | **Automatizace / pravidla (presety)** | „Když se dokončí krok → přiřaď další + notifikuj", „nový v projektu → přidej štítek". Pro handoffy a SLA. Asana tím vyniká. Užší presetová verze stačí. | L |
| B4 | **Závislosti + milníky (+ jednoduchý Gantt/timeline)** | Řízení projektů s návazností; dnes jen ploché úkoly. | L |
| B5 | **Hromadné akce + workload (vytížení)** | Kdo je přetížený, hromadné přeřazení/přeplánování. Reporty mají roster, chybí kapacita. | M |
| B6 | **Formuláře (intake)** | Sběr požadavků od ne-uživatelů (nákup, IT tiket, žádost) → úkol. | M |
| B7 | **Vlastní pole** (Text/Číslo/Výběr/Datum/Osoba/Odkaz) | Firemní metadata na úkolech/projektech (klient, rozpočet, kanál). | M–L |

## C. DIFERENCIÁTORY — do čeho investovat, kde vyhrajete

1. **Čeština napříč AI** — quick-add i **filtry z české věty** (Todoist umí česká data, ne české
   filtry). **Zatím nepostavené (A5)** — největší nevyužitá příležitost. *Unikát, až vznikne.*
2. **Dva režimy více-přiřazení** (`shared_any`/`shared_all`) — teď v tomto běhu **opraveno, aby reálně
   fungovaly** (dřív kosmetika). Nemá Todoist/Asana/Notion. Přímý zásah do provozů (trenéři/baristé).
3. **Barevný systém + priorita jako okraj** — first-class, přesně co uživatelům Todoistu chybí.
4. **Vlastnictví dat + self-host + plochá cena** — přidáš 50 brigádníků zdarma; data u vás.
5. **Napojení na váš stack** — Lucky OS, iDoklad, Spark, AdamOS; bespoke, které SaaS neudělá.
6. **Obousměrný kalendář** — MVP jednosměrný (úkol→Google); plná obousměrnost + konflikty = cílová meta.
7. **Mail jako orgán Watsonu** — sdílené schránky + „udělej z mailu úkol" + kompetenční směrování
   (viz `MAIL_implementacni_plan_2026-07-07.md`). Velký diferenciátor pro provozní tým.

## D. VĚDOMĚ ODLOŽIT (nesoutěžit)

- **Notion-class dokumenty/databáze/relace** (v2/v3, okrajově), **SSO/SCIM/SOC2** (malý interní tým
  nepotřebuje), **nativní mobil + widgety/hodinky** (PWA prvotřídní teď, nativní v3), **obří
  marketplace integrací** (jen vybrané), **time tracking** (mimo rozsah).

---

## DOPORUČENÉ POŘADÍ (návrh)

1. **Stabilizace (P0 z auditu)** — výkon/škálovatelnost + mobil dostupnost + přílohy + notifikace UI.
   *Bez tohoto každá další funkce jen zvětšuje pomalou appku.*
2. **AI napojení (A5)** — protože je to hlavní diferenciátor a „prodává" nástroj internímu týmu.
3. **Šablony + uložené filtry (B1, B2)** — nejlevnější velké zvýšení denní produktivity.
4. **Mail Blok I základy** (aditivní schéma, levné teď — viz mail plán) paralelně.
5. **Automatizace/pravidla + závislosti/workload (B3–B5)** — jakmile je jádro rychlé a stabilní.
6. **Mail M1–M3** jako samostatný program (po stabilizaci jádra).

**Pravidlo:** tři rizikové oblasti (offline sync, mobil/PWA, spolehlivost opakování/připomínek) jsou
kvalitativní laťka — ne „doděláme potom". Audit teď dvě z nich posunul (sync ztráta dat, opakování/čas).
