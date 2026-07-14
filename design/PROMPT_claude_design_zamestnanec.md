# Prompt pro Claude Design — Watson „Zaměstnanec" (vlož jako první zprávu)

Navrhni modul **„Zaměstnanec"** pro Watson. Watson je offline-first **týmový** nástroj (úkoly + projekty +
kalendář + spolupráce). Tento modul je **trenérská self-service plocha** nad účetním/mzdovým systémem
LuckyOS — trenér tu řeší **docházku, výplatu, výdaje, dokumenty, profil** a vidí **upozornění**, aby otevíral
jen jednu appku. Není to druhá appka „přilepená vedle" — **rozšiřuje Watson shell** (levý navy sidebar +
header + mobilní spodní lišta <880px) a používá **stejný design systém** (tokeny `--w-*`, Montserrat pro UI /
Inter pro text / **mono pro peníze a časy**, akcent brass, světlý + tmavý režim, CZ default / EN).

## Zdroj pravdy (přečti nejdřív)
- **`design/BRIEF_zamestnanec_moduly_2026-07-12.md`** — kompletní funkční popis: modul po modulu **co to je /
  co dělá / jak vypadá / stavy / data (pole) / otevřené otázky**. Toto je specifikace.
- **`design/handoff_watson/README.md`** — existující design Watsonu (shell, tokeny, komponenty, ikony) — ať
  modul vypadá jako Watson, ne jako cizí portál.
- **`packages/ui/src/tokens.css`** — přesné hodnoty tokenů `--w-*` (světlý + tmavý).

## Drž direktivy (jsou v briefu nahoře)
1. **Designový jazyk:** třetí tón Watsonu — **důvěryhodná, klidná, EXAKTNÍ self-service plocha o penězích a
   povinnostech.** Vzdušné, jedna otázka na obrazovku, čísla mono/přesná, formuláře vlídné a odpouštějící,
   **mobil-first** (trenér to dělá z telefonu). Sdílej prvky Watsonu, ale nekopíruj hustou kartovost.
2. **Barva = význam:** prioritní barvy jen na úkolech; stav readiness/odevzdání = sémantické (success /
   neutrální / overdue); peníze neutrální mono; osobní-sféra marker.

## Guardraily (nesmí se porušit)
- **„Odevzdáváš, neschvaluješ."** Zaměstnanec vždy jen odevzdá (`submitted`/`pending`); schvaluje/počítá/
  proplácí admin v LuckyOS (mimo Watson). Žádné tlačítko schválit/proplatit.
- **Osobní sféra + online-only.** Celý modul = soukromá zóna (mzda, účet, doklady), vizuálně oddělená od
  týmové práce; marker „Soukromé · jen ty · online" (NE „E2E").
- **Gated viditelnost:** položku „Zaměstnanec" i kartu „Můj stav" na Přehledu vidí **jen napojený trenér**;
  zbytek týmu nic (žádné zašedlé „nemáš přístup").
- **Stav = read-only zrcadlo** (schválení/proplacení přichází z LuckyOS).
- **Smlouvy/e-podpis = v2** (navrhni cíl, nekresli jako hotové jádro). **Kostýmy/fondy/akce = později.**
- **Nenafukovat menu:** JEDNA gated položka + vnitřní záložky (takeover jako Mail), ne 8 položek v sidebaru.

## Pořadí obrazovek (začni vlajkou)
1. **Dashboard „Můj stav" (VLAJKA)** — readiness (ready/pending/blocked), „co udělat teď", 8 blokerů, odpočty
   termínů, DPP progres (X/300 h) + varianta **karta na Přehledu**. Určuje tón celého modulu.
2. **Docházka** — bulk tabulka 3 činností (Trénink/Malá čísla/Ostatní) na desktopu + **denní karty na mobilu**;
   validace u pole, odevzdat, uzamčené/vrácené stavy.
3. **Výplaty** — výplatní karta (čistá mono + rozpad + vyplaceno/čeká), YTD graf, hodinové sazby, DPP limit.
4. **Výdaje** (formulář + upload účtenky, multi-měna, zdroj proplacení) a **Dokumenty** (upload, typy, expirace).
5. **Profil** (read-only + žádost o změnu, per-pole) a **Malá čísla** (hodiny H:MM, bez cen).
6. **Shell modulu** (gated položka, vnitřní záložky, marker sféry, mobilní přepínač Práce↔Moje mzda).
7. **(v2)** Smlouvy & e-podpis (PDF viewer + podpisový pad).

## Reálná CZ data pro mockupy (ne lorem ipsum — v briefu je celý set)
Trenér Adam Kosír (DPP, sazby 280/320/200 Kč/h); červen výplata čistá 10 234 Kč (vyplaceno 15. 7.); DPP
86/300 h; výdaj „Látka na kostýmy" 1 240 Kč (trenérský fond, čeká); blokery „chybí potvrzení účtu" +
„neodevzdaná docházka"; choreografie „Minipřípravka A" 3:20, „Juniorky – Show 2026" 4:45.

## Co od tebe chci jako výstup
Obrazovky výše (**telefon primárně + desktop**; docházka navíc mobilní denní-kartový layout) + **nové
komponenty** na stávajících tokenech: readiness banner, blocker karta, deadline countdown chip, DPP progress
bar, docházková tabulka + denní karty, výplatní karta + YTD graf, **formulářová vrstva** (net-new: inline
validace, měnový input+kurz, „zdroj proplacení" selektor), **upload + náhled souboru**, dokumentová karta
s badge expirace, řádek žádosti o změnu profilu (diff + per-pole), **stavová pilulka + banner recenzenta**,
odznak původu úkolu „Z mzdy", marker osobní sféry. K tomu krátká pravidla použití (stavová škála, validace
u pole, marker sféry, překlad docházky z tabulky do denních karet na mobilu).
