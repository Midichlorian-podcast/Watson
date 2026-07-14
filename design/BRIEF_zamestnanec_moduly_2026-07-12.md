# Watson — modul „Zaměstnanec" — popis obrazovek pro Claude Design

> **Účel:** kompletní, neosekaný popis nového modulu **Zaměstnanec** (trenérská self-service plocha nad
> účetním/mzdovým systémem LuckyOS) — obrazovka po obrazovce: **co to je · co dělá · jak vypadá ·
> stavy/edge-case · data (pole) · otevřené otázky.** Vlož do Claude Design jako podklad pro návrh.
> Zdroj funkcí = **produkční zaměstnanecký portál LuckyOS** (13 obrazovek, ověřeno field-level v kódu).
>
> **Cíl:** trenér otevírá **jen Watson** — docházku, výplatu, výdaje, dokumenty a upozornění řeší v jedné
> appce, ve **stejném designu** jako zbytek Watsonu. LuckyOS zůstává skrytý (účetní/admin nástroj).
>
> **Autor:** Claude Code · **Datum:** 2026-07-12 · **Verze rozsahu:** v1 = Fáze 1 (čtení+upozornění) +
> Fáze 2 (odevzdávací formuláře). **Smlouvy/e-podpis = v2**, demo trio (kostýmy/fondy/akce) = později.
> Souvisí: `files/ZAMESTNANEC_integracni_PLAN_2026-07-12.md` (co je hotové na backendu),
> `~/Downloads/lucky-os-transfer/WATSON_LUCKYOS_zamestnanec_katalog_ukonu_2026-07-12.md` (field-level katalog).

---

## Kontext (drž při návrhu)

- Modul **rozšiřuje** existující Watson shell (levý navy sidebar + header + mobilní spodní lišta <880px),
  **nezakládá nový svět.** Design systém: tokeny `--w-*`, **Montserrat** (UI/nadpisy) + **Inter** (text) +
  **mono pro čísla/peníze/časy**, akcent **brass**, **světlý i tmavý** režim, **CZ default / EN plně**.
- **Sdílené komponenty k reuse:** TaskCard, chipy/pilulky, checkbox, prioritní odznak (levý okraj P1–P4),
  modaly a vycentrované karty (vzor `AddTaskModal` / `WatsonCard`), boční panely, avatary, tlačítka.
- **Persona:** **trenér/lektor tanečního spolku, 20–55 let, NE-vývojář**, řeší tohle **z mobilu**, většinou
  **nárazově jednou za měsíc** (uzávěrka docházky, občas účtenka). Nechce účetnictví — chce mít **klid, že
  nic nepropadlo** a vidět **kolik dostane a co má ještě dodělat**.
- **Model (drž ho, vysvětluje celý zážitek):** zaměstnanec vždy jen **„ODEVZDÁ"** — každé odeslání jde do
  LuckyOS jako `submitted`/`pending`. **Nic neschvaluje, nepočítá mzdu, neúčtuje.** Schválení, výpočet mzdy
  a proplacení dělá **admin/účetní v LuckyOS** (mimo Watson). Watson **sbírá vstupy a zobrazuje stav.**
- **Celý modul je OSOBNÍ SFÉRA a ONLINE-ONLY** (na rozdíl od offline jádra úkolů): mzdy, číslo účtu, osobní
  doklady se **nikdy** neukládají do týmového syncu, čtou se z LuckyOS na vyžádání. To má být **vizuálně cítit**
  (viz průřezový marker níže) — „tohle je tvoje soukromé, jen pro tebe".

---

## ⚑ Designový jazyk modulu (DŮLEŽITÉ pro Claude Design)

Watson core je **produktivní/kartový**, mail je **klidný kreativní klient**. Modul Zaměstnanec je třetí tón:
**důvěryhodná, klidná, EXAKTNÍ self-service plocha o penězích a povinnostech.** Člověk tu řeší **svou výplatu,
smlouvu, osobní údaje** — cokoli matoucího vyvolá úzkost. Proto:

1. **Klid a jistota, ne úřad.** Vzdušné, přehledné, málo prvků na obrazovku. Každá obrazovka odpoví na
   **jednu otázku** („Kolik dostanu?", „Co mám dodělat?", „Odevzdal jsem docházku?"). Žádná byrokratická
   změť polí bez hierarchie.
2. **Exaktnost u čísel.** Peníze, hodiny, termíny = **mono font, zarovnané, jednoznačné**, s měnou/jednotkou.
   Nikdy „přibližně". Číslo účtu, částky výplaty = přesně, kopírovatelně.
3. **Formuláře jsou vlídné a odpouštějící.** Watson dnes **nemá formulářovou vrstvu** (jediný `<form>` je
   login) — je to **net-new**, navrhni ji čistě: velké tap-cíle (mobil!), inline validace „u pole" (ne až po
   odeslání), jasné povinné/volitelné, průběžné ukládání konceptu, nezničitelný rozdělaný vstup.
4. **Mobil-first.** Tohle je jediný modul, který trenér reálně dělá **na telefonu v šatně**. Desktop je bonus.
   Navrhni **napřed telefon**, pak desktop.
5. **„Nic nepropadne".** Vizuálně komunikuj bezpečí: co je **hotové** (zeleně, s datem), co **čeká na admina**
   (neutrálně), co **musí trenér dodělat** (jasná výzva + termín). Nikdy nenech člověka tápat, „jestli to prošlo".

---

## ⚑ Barvy v modulu (pro Claude Design)

Použij Watson paletu (`--w-*`), ale drž **„barva = význam, ne dekorace":**
- **Prioritní barvy** (P1 `--w-p1` červená / P2 žlutá / P3 modrá / P4 šedá) **jen** na úkolech odvozených
  z modulu (viz Modul 9), ne v self-service ploše.
- **Stav readiness / odevzdání = sémantické barvy:** `--w-success` (ready / vyplaceno / schváleno /
  verified), neutrální `--w-ink-2/3` (čeká na admina / pending), `--w-overdue` (blokováno / zamítnuto /
  po termínu / vráceno k opravě). **Střídmě** — jedna barva = jeden význam.
- **Peníze/čísla = neutrální mono** (ink), NE barevné. Barva jen když nese stav (vyplaceno = zeleně).
- **Osobní-sféra marker** = vlastní decentní vizuál (zámek/odstín) — vždy odlišitelný, „jen ty, online".
- **Blokery / výzvy k akci** = brass akcent + `--w-overdue` u urgentních; ne křiklavě, ale zřetelně.

---

## Guardraily (NESMÍ se porušit)

1. **„Odevzdáváš, neschvaluješ."** Nikde ve Watsonu není tlačítko schválit/proplatit/ověřit/uzavřít — to je
   admin v LuckyOS. Všechny akce zaměstnance končí stavem `submitted`/`pending`/`draft`. Design nesmí
   sugerovat, že zaměstnanec něco „potvrzuje s účinkem".
2. **Osobní sféra + online-only.** Celý modul = soukromá zóna, čte se z LuckyOS. Vizuálně oddělit od
   týmové práce (marker). Citlivá data (mzda, účet, doklad) nikdy nevypadají jako „týmově sdílená".
3. **Gated viditelnost.** Položku „Zaměstnanec" v menu i kartu „Můj stav" na Přehledu **vidí jen napojený
   trenér.** Zbytek týmu nic z toho nevidí (princip „co nevidíš, v UI neexistuje" — žádné zašedlé „nemáš
   přístup"). Nenafukovat menu (viz IA).
4. **Stav = read-only zrcadlo.** Stavy schválení/proplacení přicházejí z LuckyOS; Watson je **zobrazuje**,
   zaměstnanec je **nepřepisuje**.
5. **Smlouvy / e-podpis = v2.** Navrhni cílově (náhled PDF + ověření + podpis), ale **nekresli jako hotové
   jádro v1** — je to pozdější fáze (potřebuje serverovou právní finalizaci v LuckyOS).
6. **Demo trio (Kostýmy / Trenérské fondy / Akce) = později.** Neexistuje ani v LuckyOS. Naznač max jako
   „připravujeme", nestav na nich zážitek.

---

## Informační architektura (jak modul zapadne — anti-přehlcení menu)

Sidebar Watsonu je už nabitý → modul přidá do menu **max jednu položku, a jen trenérům:**
- **Jedna gated položka „Zaměstnanec"** v levém sidebaru (vedle Mailu; ikona v tahové sadě — návrh: karta/ID
  s korunkou nebo peněženka; **ne emoji**). Odznak s počtem „co dodělat" (blokery + vrácené k opravě).
- **Uvnitř = vlastní vnitřní navigace** (takeover headeru jako Mail, ne 8 položek v sidebaru): záložky
  **Můj stav · Docházka · Výplaty · Výdaje · Dokumenty · Profil · Malá čísla** (+ „Smlouvy" jako v2 placeholder).
- **Zásadní signály navíc do Přehledu:** gated karta **„Můj stav"** na dashboardu Přehled (jen trenér) — jen
  to nejdůležitější (readiness, nejbližší termín, co dodělat) s proklikem do modulu.
- **Fáze 1 upozornění tečou do STÁVAJÍCÍCH ploch, ne do sila:** deadline/blokery/notifikace z LuckyOS se
  stávají **nativními Watson úkoly/připomínkami/kalendářem** (viz Modul 9) — objeví se v Úkolech,
  Nadcházejícím, kalendáři, notifikačním centru. Do menu **nepřidávají nic**.
- **Mobil <880px:** modul = 1-panelový stack, vnitřní záložky jako **horní segment/skrolovací pilulky** nebo
  spodní sub-lišta; „Zaměstnanec" dostupný z hlavní navigace. Zvaž **top-level pocit „Práce ↔ Moje mzda"**
  (podobně jako u mailu Mail↔Práce) — ať se soukromá plocha nemíchá s týmovými úkoly.

---

## Roadmapa modulů (fáze v1 = F1+F2; v2 = smlouvy; později = trio)

| # | Modul | Fáze | Zápis? |
|---|---|---|---|
| 0 | Shell & navigace modulu (gated položka, vnitřní záložky, mobil, marker sféry) | F1 | — |
| 1 | **Dashboard „Můj stav"** (VLAJKA) — readiness, 8 blokerů, termíny, DPP progres, „co dodělat" | F1 | čtení |
| 2 | **Docházka** — bulk tabulka 3 činností, validace, odevzdat, uzamčení | F2 | **zápis** |
| 3 | **Výplaty** — pásky, rozpis, YTD, hodinové sazby, DPP limit (PDF později) | F1 | čtení |
| 4 | **Výdaje / účtenky** — formulář, multi-měna, zdroj proplacení, **upload dokladu** | F2 | **zápis+upload** |
| 5 | **Dokumenty** — upload osobních dokladů, typy, expirace, stav ověření | F2 | **upload** |
| 6 | **Profil** — read-only + **žádost o změnu** (per-pole rozhodnutí) | F2 | **žádost** |
| 7 | **Malá čísla** — hodiny per choreografie (bez cen), uzamčení období | F2 | **zápis** |
| ⊕ | **Stavový feedback** (PRŮŘEZOVÝ) — u každého odevzdání stav + poznámka recenzenta | F1/F2 | — |
| ⊕ | **Notifikace → úkoly/připomínky** (PRŮŘEZOVÝ, do stávajících ploch) | F1 | — |
| ⊕ | **Osobní sféra / online-only marker** (PRŮŘEZOVÝ) | F1 | — |
| 8 | **Smlouvy & e-podpis** — náhled PDF, ověřovací challenge, podpisový pad | **v2** | zápis+podpis |
| 9 | Kostýmy / Trenérské fondy / Akce | později | — |

Legenda stavu: 🔲 projednává se · 🟡 rozpracováno · ✅ odsouhlaseno (koncept)

---

## Modul 0 — Shell & navigace modulu ✅

**Co to je.** Rám celého modulu uvnitř Watson shellu + jeho vnitřní přepínání.

**Jak vypadá.**
- **Vstup:** gated položka „Zaměstnanec" v navy sidebaru (odznak „co dodělat"). Klik → **takeover obsahové
  plochy** headerem modulu (titul „Zaměstnanec" + jméno/typ spolupráce vpravo, marker osobní sféry).
- **Vnitřní záložky** (segment pod headerem, brass podtržení aktivní): Můj stav · Docházka · Výplaty ·
  Výdaje · Dokumenty · Profil · Malá čísla. Každá má případně malý stav-odznak (např. „Docházka •
  neodevzdáno", „Výplaty • nová").
- **Marker sféry** (viz průřezový modul): decentní pruh/ikona „🔒 Tvoje soukromá data · online".

**Stavy & edge-case.** Není napojený zaměstnanec → položka i karta se **vůbec nezobrazí** (ne zašedle).
Offline → modul ukáže „online-only" prázdný stav s vysvětlením + poslední známý stav konceptů docházky
(uložené lokálně jako rozdělaný draft).

**Otevřené otázky.** Ikona položky (peněženka vs. ID karta); mobil: horní segment vs. spodní sub-lišta;
zda mít „Práce ↔ Moje mzda" top-level přepínač na mobilu.

---

## Modul 1 — Dashboard „Můj stav" (VLAJKA) ✅

Nejdůležitější obrazovka. Určuje tón celého modulu. Trenér ji otevře a hned ví **kolik dostane**, **jestli
je vše odevzdané** a **co musí dodělat.** Zároveň její zkrácená verze = **karta na Přehledu**.

**Co dělá.** Agreguje stav zaměstnance z LuckyOS (čistě čtení) do jedné klidné plochy: připravenost výplaty,
blokery, termíny, roční DPP limit a osobní frontu úkolů.

**Jak vypadá (shora dolů):**
1. **Readiness banner** — velký stavový odznak: **Připraveno** (`--w-success`, „Výplata připravena k
   zpracování") / **Čeká** (neutrální, „Čeká na zpracování účetní") / **Blokováno** (`--w-overdue`, „Nutné
   doplnit — jinak nebude vyplaceno"). Jedna věta + ikona. Emocionálně nejdůležitější prvek.
2. **„Co udělat teď" (work queue)** — seznam akčních položek P0/P1/P2 s proklikem přímo do formuláře:
   „Odevzdej docházku za červenec (do 10. 7.)", „Doplň číslo účtu", „Nahraj růžové prohlášení". Každá =
   řádek s ikonou, termínem (countdown) a šipkou. **Prázdný stav = pochvala** („Vše máš hotové 🎉", klidně).
3. **8 typů blokerů výplaty** — pokud readiness=blocked, rozbalené karty blokerů, každá s **vysvětlením**
   (lidsky, ne kód) + **tlačítkem „Doplnit"** (deep-link do dané záložky/formuláře). Typy:
   `attendance_missing` (neodevzdaná docházka), `attendance_pending` (čeká na schválení), `attendance_rejected`
   (vrácena k opravě — zvýraznit + reviewer_note), `missing_bank_account`, `missing_contract`,
   `missing_tax_declaration` (růžové prohlášení), `missing_parent_contribution`, `admin_check_pending`.
4. **Odpočty termínů** — pruh/chipy: **uzávěrka docházky** (default 10. v měsíci), **den výplat** (15.),
   s **countdown + severitou** (ok / warning / urgent / po termínu — barevně). Prokliknutelné → udělá/otevře úkol.
5. **DPP roční progres** (jen `person_type='dpp'`) — **progress bar** hodin **{X} / 300 h** (§ zákon):
   zezelena → **zčervená nad 80 %**; pod ním „vyplaceno letos: {Kč}", měsíční limit 12 300 Kč (oznámená) /
   4 000 Kč (neoznámená), mini sloupcový graf po měsících, badge „N× nad měsíční limit" když nastane.
6. **Povinné dokumenty per typ osoby** — checklist „co musíš mít": dpp → **DPP smlouva** + **růžové
   prohlášení**; zaměstnanec (HPP) → **pracovní smlouva** + **růžové prohlášení** + **potvrzení účtu**.
   Zelené odškrtnutí = doloženo/verified, jinak výzva.

**Karta „Můj stav" na Přehledu (zkrácená, gated):** readiness odznak + 1–2 nejbližší termíny + počet „co
dodělat" + tlačítko „Otevřít Zaměstnance". Vejde se do jedné dashboard-karty; ať ladí s ostatními kartami Přehledu.

**Stavy & edge-case.** Vše hotové → klidná zelená („Nic tě netlačí"). Načítání (online-only) → skeleton.
Chyba spojení s LuckyOS → nenápadný banner „Nepodařilo se načíst aktuální stav" + retry, ne prázdno.

**Data (čte se z LuckyOS `GET /api/employee/status`):** `readiness.status`, `blockers[] {type, explanation,
href}`, `missing_documents[]`, `deadlines {attendance_due_day, payroll_day, …}`, `dpp_progress {hours_used,
hours_limit:300, monthly_limit}`, work-queue položky.

**Otevřené otázky.** Kolik blokerů rozbalit vs. sbalit; jak moc „oslavovat" prázdný stav; zda DPP graf i na kartě Přehledu.

---

## Modul 2 — Docházka ✅ (nejsložitější zápis)

**Co to je.** Měsíční výkaz odtrénovaných hodin ve **3 činnostech**, který trenér **odevzdá** na uzávěrku.

**Co dělá.** Trenér zapíše hodiny po dnech, uloží průběžně (draft), a „Odevzdá" celý měsíc → LuckyOS
(`submitted`). Admin schválí → vznikne mzda (mimo Watson).

**3 činnosti:** **Trénink** (`training`), **Malá čísla** (`small_numbers`), **Ostatní** (`other`).
Sazby zaměstnanec v docházce **nevidí** (jsou u Výplat).

**Jak vypadá.**
- **Přepínač měsíce** nahoře (◀ Červenec 2026 ▶) + souhrn („Celkem 42,5 h · odevzdáno / neodevzdáno").
- **3 režimy zadání** (přepínač, default = tabulka):
  - **Bulk tabulka (default)** — řádek = den, sloupce = **Trénink | Malá čísla | Ostatní | Poznámka**.
    Buňka hodin = malý number/stepper (0–12, **krok 0,5**). Víkendy jemně odlišené. Dnešek zvýrazněný.
    **Mobil:** tabulka se překlopí do **denních karet** (den → 3 pole hodin + poznámka) — tabulka na
    telefonu nefunguje, navrhni kartový layout.
  - **Kalendář** — klik na den → malý modal s 3 poli + poznámkou (reuse Watson kalendář-měsíc vzhledu).
  - **Seznam** — jen dny s hodinami, kompaktně.
- **Chytré akce:** **Šablony** („Po/St trénink", „Pá malá čísla" → předvyplní opakující se dny),
  **Fill-down** („zkopíruj tento den v týdnu do konce měsíce"), **Uložit** (průběžně, tichý autosave draftu),
  **Odevzdat** (velké primární tlačítko), **PDF výkaz** (v2/později — placeholder).
- **Odevzdat** = potvrzovací krok („Odevzdáváš docházku za červenec — {X} h. Po odevzdání ji upravíš jen
  přes 'opravu'."). Po odevzdání stav **„Odevzdáno · čeká na schválení"**.

**Stavy & edge-case (KLÍČOVÉ — validace přímo u pole):**
- Hodiny **> 0 a ≤ 12 na činnost**, **denní strop 12 h**, krok 0,5.
- **Poznámka POVINNÁ, když jsou zadané hodiny** (inline chyba „Doplň poznámku k {den}").
- **Zákaz budoucího data** (nelze zapsat dopředu).
- **Uzamčení:** stav `submitted`/`approved` → pole **disabled** (u submitted lze „Požádat o opravu");
  editovatelné **jen aktuální/otevřené období**. Zamčené vizuálně jasné (zámek + vysvětlení).
- **Vrácena k opravě** (`needs_changes`/`rejected`) → nápadný banner s `reviewer_note` („Vrácena k opravě:
  {důvod}") + odemknuté pole k úpravě + re-odevzdání.
- Offline (v šatně bez signálu) → **lokální draft**, „Odevzdat" až online (jasně komunikovat „uloženo u tebe,
  odešle se po připojení").

**Data (LuckyOS `POST /api/employee/attendance`):** `records[] {date, activity_type, hours, note}`,
`submit {period_month, period_year}`; stav submission `draft|submitted|approved|needs_changes|rejected` + `reviewer_note`.

**Otevřené otázky.** Tabulka vs. denní karty jako default na desktopu; jak zobrazit „opravu" u submitted; PDF výkaz už v1 nebo v2.

---

## Modul 3 — Výplaty ✅ (čtení + později PDF)

**Co to je.** Přehled výplat — kolik trenér dostal/dostane, z čeho se to skládá, roční souhrn. **Čistě čtení.**

**Jak vypadá.**
- **Výběr období** (měsíce) + velká **výplatní karta**: **čistá k výplatě** (velké mono číslo, Kč), pod tím
  rozpad **hrubá / daň / SP / ZP / odvody zaměstnavatele**, **způsob výplaty** (banka/hotovost), **stav**
  („Vyplaceno 15. 7." zeleně / „Čeká" neutrálně). Poznámka účetní.
- **Rozpis dle docházky** — hodiny × sazba per činnost (odkud čistá vznikla) — teď se sazby ukazují.
- **YTD přehled** — hrubý/čistý/daně za rok, průměr/měsíc, **mini sloupcový graf po měsících**, porovnání
  s loňskem (decentní). Reuse styl grafů z Reportů.
- **Hodinové sazby** — výpis sazeb za činnosti.
- **DPP progres** (viz Modul 1 — může být i tady detailně).
- **PDF** — „Výplatní páska" + „Potvrzení o příjmech (rok)" → tlačítka stáhnout (**v2/později**, dnes
  placeholder „připravujeme" / generuje LuckyOS server).

**Stavy & edge-case.** Žádná výplata za období → prázdný stav. Blokovaná výplata → odkaz zpět na „Můj stav"
(co dodělat). Vše read-only — žádné akce měnící data.

**Data:** `payroll_entries` (období, hrubá/čistá/daň/SP/ZP/odvody, způsob, stav, rozpis, poznámka), YTD agregace, sazby.

**Otevřené otázky.** Kolik detailu rozpadu na mobilu (sbalit do „zobrazit rozpis"); PDF páska v1 vs. v2.

---

## Modul 4 — Výdaje / účtenky ✅ (zápis + upload)

**Co to je.** Trenér nahlásí výdaj (nákup pro spolek) + **vyfotí účtenku** → odevzdá k proplacení.

**Jak vypadá (formulář — vlídný, mobil-first):**
- **Nahoře „nový výdaj"** (velké tlačítko / vyfoť účtenku rovnou fotoaparátem na mobilu).
- **Pole** (v pořadí, s inline nápovědou žargonu):
  - **Název*** (co to bylo), **Částka*** (mono), **Měna** (CZK/EUR/USD/PLN) — u cizí měny **kurz** +
    dopočtená **částka v Kč** (auto, read-only).
  - **Datum nákupu*** (ne budoucí).
  - **Způsob platby** (segmenty): vlastní hotovost / vlastní karta / pokladna studia / karta studia.
  - **Zdroj proplacení*** (KLÍČOVÉ, vysvětlit lidsky): **Účetnictví** (běžné proplacení / z dotací) ·
    **Interní hotovost** · **Trenérský fond** (→ pak vybrat projekt fondu). Jednou větou u každé „co to znamená".
  - **Kategorie** (kostýmy / doprava / rekvizity / občerstvení / startovné / ubytování / ostatní).
  - **Doklad — POVINNÁ příloha** (foto/PDF), **poznámka**.
- **Náhled účtenky** (thumbnail obrázku / ikona PDF s názvem+velikostí). Upload přes broker na Drive.
- **Odeslat** → `submitted`. Pod formulářem **seznam mých výdajů** se stavovými pilulkami.

**Stavy & edge-case.** Povinná příloha (bez ní nejde odeslat). CZK → skryj kurz. Upload selhal → nabídni
„odeslat i bez přílohy" jako fallback? (ne — příloha povinná; ukázat chybu a retry). Stavy položky:
**Odesláno · Schváleno · Zamítnuto** (+ `reviewer_note` „důvod zamítnutí") **· Proplaceno** (+ jak: hotově/účtem).

**Data (LuckyOS `POST /api/employee/expenses` + `POST /api/employee/storage/drive`):** viz pole výše;
soubor ≤ 25 MB (PDF/JPG/PNG/WEBP; HEIC z iPhonu — pozor, může spadnout do fallbacku).

**Otevřené otázky.** „Vyfoť účtenku" jako první krok (mobil) vs. formulář první; jak vysvětlit 3 zdroje proplacení laikovi.

---

## Modul 5 — Dokumenty ✅ (upload)

**Co to je.** Osobní doklady k zaměstnání — trenér je **nahraje**, admin **ověří**.

**Jak vypadá.**
- **6 typů:** DPP smlouva, pracovní smlouva, **růžové prohlášení** (daňové prohlášení poplatníka),
  potvrzení bankovního účtu, podklad k docházce, ostatní. (U typů vysvětlit lidsky — „růžové prohlášení = …".)
- **Upload:** drag&drop / vyfoť (mobil), **více souborů najednou** (PDF/JPG/PNG/DOC/DOCX/TXT), volitelně
  **„platnost do"** (sledování expirace), poznámka. Náhled (obrázek / PDF ikona).
- **Seznam dokumentů** = karty: typ, název souboru, datum, **stav ověření** (pending / **verified** zeleně /
  **rejected** + `review_note`), **badge expirace** (platný / blíží se konec / **prošlý** — práh 30 dní).

**Stavy & edge-case.** Ověření je na adminovi (read-only stav). Prošlý povinný doklad → propíše se do
blokerů „Můj stav". Rejected → výzva nahrát znovu.

**Data (LuckyOS `POST /api/employee/documents`):** `type, file_name, file_type, valid_until?, note`, stav
`review_status: pending|verified|rejected` + `review_note`.

**Otevřené otázky.** Jak zobrazit expiraci nenápadně, ale jasně; náhled PDF v seznamu vs. jen odkaz (v1 = odkaz/thumbnail, plný PDF viewer je až se smlouvami v2).

---

## Modul 6 — Profil ✅ (žádost o změnu)

**Co to je.** Osobní údaje. Část **jen ke čtení**, část lze **požádat o změnu** (schvaluje admin per pole).

**Jak vypadá.**
- **Read-only sekce** (šedě, zámek): jméno, typ spolupráce (DPP/HPP/…), datum narození, IČO, hodinové sazby.
- **Editovatelná sekce → „Požádat o změnu":** e-mail, telefon, **číslo účtu** (povinné pro výplatu — zvýraznit,
  když chybí), adresa. Změna = **žádost** (`pending`), ne přímý zápis.
- **Historie žádostí** — časová osa s diff („účet: {staré} → {nové}") + stav **per pole**: čeká / **schváleno** /
  **zamítnuto** / **částečně** (některé pole přijato, jiné ne) + `reviewer_note`.

**Stavy & edge-case (validace inline):** e-mail (formát), telefon (9–15 číslic), účet (`předčíslí-číslo/kód`),
adresa (min. 10 znaků). Prázdná žádost nejde odeslat. Zdůraznit, že **jméno/RČ/sazby mění jen admin**.

**Data (LuckyOS `POST /api/employee/profile-change`):** `patch {email?, phone?, bank_account?, address?}`,
stav `pending|approved|rejected|partial` + `field_decisions` + `reviewer_note`.

**Otevřené otázky.** Jak vizuálně odlišit read-only vs. „požádat o změnu"; jak ukázat per-pole rozhodnutí (partial).

---

## Modul 7 — Malá čísla ✅ (zápis)

**Co to je.** Trenér zapíše **odučené hodiny per choreografie** za měsíc. **Ceny nikdy nevidí** (počítá server
z ceníku → příspěvek rodičů do mezd).

**Jak vypadá.**
- **Výběr měsíce** + **seznam choreografií**, kde je osoba trenér a jsou aktivní pro období (názvy jako
  „Minipřípravka A", „Juniorky – Show 2026").
- Pro každou: pole **hodiny ve formátu H:MM** (minuty jen z povolené sady {00,15,20,30,40,45}), poznámka.
- **Uložit koncept** / **Odevzdat**. **Žádné částky** nikde v UI.

**Stavy & edge-case.** **Uzamčené období** (uzávěrka schválena) → disabled + „Období uzavřeno". Choreografie
mimo trenéra → nenabídne se. Stav zápisu: draft / submitted / approved / **needs_changes** (+ reviewer_note).

**Data (LuckyOS `POST /api/employee/small-numbers`):** `choreography_id, period_month, period_year,
hours:"H:MM", note`, stav `draft|submitted`. GET vrací choreografie **bez cen**.

**Otevřené otázky.** Vstup H:MM na mobilu (stepper vs. dvě pole H a MM z povolené sady); jak vysvětlit, proč nevidí částky.

---

## ⊕ Průřezový — Stavový feedback (u každého odevzdání) ✅

**Co to je.** Jednotný způsob, jak u **každého** odevzdání zobrazit, kde ve schvalování je + poznámku admina.
Není to samostatná obrazovka — je to **komponenta**, která se objeví u docházky, výdajů, dokumentů, profilu,
malých čísel (a v „Můj stav").

**Jak vypadá.** **Stavová pilulka** (jednotná škála barev): `submitted`/`pending` (neutrální „Čeká na
schválení"), `approved`/`verified`/`reimbursed` (`--w-success`), `rejected`/`needs_changes`/`partial`
(`--w-overdue`). U vrácených/zamítnutých **banner s `reviewer_note`** („Vrácena k opravě: …" / „Důvod
zamítnutí: …") + akce „Opravit". **Z vráceného odevzdání se udělá i úkol** (Modul 9).

**Stavy dle modulu (škála):** Docházka `draft→submitted→approved / needs_changes / rejected`; Výdaje
`submitted→approved / rejected / reimbursed(+via)`; Dokumenty `pending→verified / rejected`; Profil
`pending→approved / rejected / partial`; Malá čísla `draft→submitted→approved / needs_changes`.

**Otevřené otázky.** Jednotný komponent pilulky+banneru; kde přesně banner (nad položkou vs. v detailu).

---

## ⊕ Průřezový — Notifikace → úkoly / připomínky / kalendář ✅

**Co to je.** Watsonův hlavní přínos: události z LuckyOS (termíny, blokery, „vráceno k opravě", „výplata
připravena") se stanou **nativními Watson úkoly/připomínkami** a objeví se v **existujících plochách** —
NEzakládá to nové menu.

**Jak vypadá.** Žádná nová obrazovka — návrh spočívá v tom, **jak tyto úkoly vypadají v existujících pohledech:**
- **Úkol** v osobním projektu „Zaměstnanec" (např. „Odevzdej docházku za červenec", termín 10. 7., P2) —
  vypadá jako běžný Watson úkol, jen s **decentním odznakem původu „Z mzdy / LuckyOS"** (obdoba chipu
  „Z mailu" u úkolů z mailu) a proklikem do dané záložky modulu.
- **Připomínka** + **Web Push** k termínu (uzávěrka, výplata).
- **Nadcházející / kalendář:** termíny (uzávěrka 10., výplata 15.) jako události/úkoly.
- **Notifikační centrum (zvonek):** „Výplata připravena", „Docházka schválena", „Vráceno k opravě".
- **Akční vs. informativní:** akční (odevzdej / doplň / vráceno) → úkol; informativní (výplata připravena,
  docházka schválena) → jen notifikace/odznak, ne úkol.

**Otevřené otázky.** Odznak původu úkolu (ikona + text); zda „výplata připravena" dělat úkol nebo jen notifikaci (návrh: notifikace).

---

## ⊕ Průřezový — Osobní sféra / online-only marker ✅

**Co to je.** Vizuální jazyk, který říká „**tohle je tvoje soukromé a jen online**" — odlišuje modul od
týmové práce.

**Jak vypadá.** Decentní, ale přítomný marker (zámek + odstín / jemný rámeček plochy) v headeru modulu a
u citlivých čísel (mzda, účet). Text markeru: **„Soukromé · jen ty · online"** (NE „šifrováno/E2E" — to je
mail; tady jde o online-only zónu mimo týmový sync). Offline stav modulu = klidné vysvětlení, ne chyba.

**Otevřené otázky.** Jak silný marker (aby uklidnil, ne strašil); sladit s markerem osobní sféry mailu (konzistence).

---

## Modul 8 — Smlouvy & e-podpis 🟡 (v2 — navrhni cíl, nekresli jako hotové jádro)

**Co to je.** Náhled smlouvy (PDF) + **elektronický podpis** s ověřovací challenge. **Pozdější fáze** —
potřebuje serverovou právní finalizaci v LuckyOS.

**Jak vypadá (cílově).** Seznam „Moje smlouvy" → **náhled PDF** (viewer) + stáhnout → (jen když „čeká na
podpis") **ověřovací challenge** (celé jméno + datum narození + **poslední 4 číslice účtu**) → **podpisový
pad** (kreslení prstem / nahrát PNG) → „Podepsat". Po podpisu **uzamčeno** (locked). Stav: „Čeká na podpis" /
„Podepsáno".

**Deliverables navíc (nové komponenty):** **PDF viewer**, **podpisový pad**, **challenge formulář**.

**Guardrail.** Watson jen sbírá podklady — **právní finalizaci (hash + zámek) dělá server LuckyOS.** Nekreslit
jako hotové v1.

---

## Modul 9 — Kostýmy / Trenérské fondy / Akce ⬜ (později)

Neexistuje ani v LuckyOS. Max naznač „připravujeme" placeholder v záložkách; nestav na nich zážitek.

---

## Nové komponenty (design deliverables na stávajících tokenech)

1. **Readiness banner** (ready/pending/blocked) — velký stavový prvek dashboardu.
2. **Blocker karta** (ikona + vysvětlení + „Doplnit" deep-link) — 8 typů.
3. **Deadline countdown chip** (severita ok/warning/urgent/overdue).
4. **DPP progress bar** (X/300 h, zčervená >80 %, badge „N× nad limit").
5. **Docházková bulk tabulka** + mobilní **denní karty** (3 pole hodin + poznámka; stepper 0,5).
6. **Výplatní karta** (velké mono číslo + rozpad + stav vyplaceno/čeká) + **YTD mini graf**.
7. **Formulářová vrstva** (net-new): pole s inline validací, povinné/volitelné, segmenty, měnový input + kurz,
   „zdroj proplacení" selektor, průběžné ukládání konceptu.
8. **Upload + náhled souboru** (foto/PDF, thumbnail, stav uploadu; přes broker na Drive).
9. **Dokumentová karta** s **badge expirace** + stavem ověření.
10. **Řádek žádosti o změnu profilu** (diff staré→nové + per-pole rozhodnutí).
11. **Stavová pilulka + banner recenzenta** (jednotná škála napříč moduly).
12. **Odznak původu úkolu „Z mzdy / LuckyOS"** (obdoba chipu „Z mailu").
13. **Marker osobní sféry / online-only**.
14. **(v2)** PDF viewer + podpisový pad + challenge formulář.

---

## Reálná CZ data pro mockupy (ne lorem ipsum)

- **Trenér:** Adam Kosír — typ **DPP**, sazby: Trénink 280 Kč/h, Malá čísla 320 Kč/h, Ostatní 200 Kč/h.
- **Období:** červenec 2026; „dnes" = 12. 7. 2026 (uzávěrka 10. už proběhla → jeden termín „po termínu").
- **Docházka (červenec):** Po 6. 7. Trénink 2 h (pozn. „Minipřípravka"), St 8. 7. Trénink 2 h + Malá čísla 1 h,
  Pá 10. 7. Malá čísla 1,5 h. Celkem 6,5 h.
- **Výplata (červen):** hrubá 12 040 Kč, srážková daň 15 %, čistá **10 234 Kč**, způsob **účet**, stav
  **Vyplaceno 15. 7.** DPP letos: **86 / 300 h**.
- **Výdaje:** „Látka na kostýmy — Juniorky" 1 240 Kč, hotovost vlastní, zdroj **Trenérský fond → Show 2026**,
  kategorie kostýmy, účtenka `uctenka_latka.jpg`. Stav **Čeká na schválení**.
- **Dokumenty:** DPP smlouva (verified), Růžové prohlášení 2026 (verified, platnost do 31. 12. 2026),
  Potvrzení účtu (**chybí → blocker**).
- **Malá čísla:** Minipřípravka A 3:20 h; Juniorky – Show 2026 4:45 h.
- **Blokery aktivní:** `missing_bank_account` (chybí potvrzení účtu), `attendance_missing` (neodevzdaná červenec).
- **Notifikace/úkoly:** „Odevzdej docházku za červenec (po termínu!)", „Doplň potvrzení účtu",
  „Výplata za červen je připravena".

---

## Pořadí obrazovek (začni vlajkou)

1. **Dashboard „Můj stav" (VLAJKA)** — telefon + desktop + varianta „karta na Přehledu". Určuje tón.
2. **Docházka** — telefon (denní karty!) + desktop (tabulka); stavy prázdné/rozdělané/odevzdané/uzamčené/vrácené.
3. **Výplaty** — telefon + desktop; výplatní karta + YTD graf + DPP.
4. **Výdaje** (formulář + upload) a **Dokumenty** (upload) — formulářová vrstva + náhled souboru.
5. **Profil** (read-only + žádost o změnu) a **Malá čísla** (hodiny H:MM, bez cen).
6. **Shell & navigace modulu** (gated položka, vnitřní záložky, marker sféry) + **mobilní přepínač**.
7. **Průřezové:** stavová pilulka+banner, odznak původu úkolu, marker sféry — jako sada komponent.
8. **(v2)** Smlouvy & e-podpis (PDF viewer + podpisový pad).

---

## Co od tebe chci jako výstup

Obrazovky výše (**telefon primárně + desktop**; docházka navíc mobilní denní-kartový layout) + **nové
komponenty** ze seznamu, vše na **stávajících tokenech `--w-*`** a v jazyce Watson shellu (sidebar/header/
mobil, Montserrat/Inter/mono, světlý + tmavý, CZ). K tomu **krátká pravidla použití:** jak vypadá stavová
škála (submitted/approved/rejected), jak formulář validuje u pole, jak vypadá marker osobní sféry, jak
docházku přeložit z tabulky do denních karet na mobilu, a jak odznakem odlišit úkol „ze mzdy" od běžného.
Drž **guardraily** (odevzdáváš-neschvaluješ · online-only soukromé · gated · smlouvy až v2).
