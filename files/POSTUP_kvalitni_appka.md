# POSTUP — kvalitní a hezká aplikace (Watson)

> Krátce a jednoduše: jak dojít k appce, která **vypadá a působí dobře**, ne jen funguje. A kdy zapojit **Claude Design**.

## Princip (to nejdůležitější)
**Odděl „funguje to" od „vypadá to dobře".** Nejdřív ověř, že technické jádro šlape (klidně ošklivé). Pak **zamkni vizuál**. Pak stav všechno do toho zamčeného vizuálu. **Konzistence dělá 80 % krásy** — ne originalita.

## Kroky (proložené s fázemi stavby)
1. **Funkční kostra, ne krása.** V Claude Code postav nejrizikovější věc (krok 4 — offline sync) **holou a ošklivou**. Cíl: ověřit, že to technicky funguje. Vzhled teď neřeš.
2. **Design lock v Claude Design.** Z identity Watsona vytvoř **design systém**: tokeny (barvy, písmo, spacing), a komponenty — tlačítko, vstup, **karta úkolu**, chip/štítek, checkbox, **prioritní odznak**. K tomu **5 klíčových obrazovek**: Dnes, seznam úkolů, detail úkolu, board, kalendář. Iteruj v chatu, dokud to není hezké.
3. **Tokeny do kódu.** Z Designu vytáhni `tokens.css` / Tailwind téma. **Od teď staví Claude Code všechno jen z těchto tokenů a komponent** — žádné ad-hoc barvy a odsazení.
4. **Obrazovku po obrazovce.** Návrh z Designu → Claude Code ho postaví → porovnáš výsledek s návrhem.
5. **Design pass po každé fázi.** Screenshoty reálné appky → Claude Design navrhne vylepšení → vrátíš do kódu.
6. **Detaily na konec.** Prázdné stavy, načítání, mikrointerakce, animace, dark mode (v2) — až jádro funguje a je konzistentní.

## Kdy Design / kdy Code
- **Claude Design** = jak to **vypadá a působí** (systém, obrazovky, ikony). Rychlé iterace bez kódu. → zapoj **hned po kroku 1** a pak **po každé fázi**.
- **Claude Code** = jak to **funguje** (data, sync, logika). Staví **podle tokenů z Designu**.

## 5 pravidel pro „hezké"
1. **Konzistence > originalita** — jeden systém všude.
2. **Méně je víc** — vzdušnost, jedna akcentová barva (brass), žádný šum.
3. **Reálná česká data v návrzích**, ne lorem ipsum (uvidíš dlouhé názvy, prázdné seznamy).
4. **Mobile-first**, pak teprve desktop.
5. **Testuj na reálném telefonu brzy** — emulátor lže.

## Zadání pro Claude Design (první sezení)
Řekni mu zhruba: *„Postav design systém a klíčové obrazovky pro Watson — interní task/projekt/kalendář appku. Tón: klidný profesionál s lidskou jiskrou."* a dej mu identitu:
- **Barvy:** navy `#17283F`, brass `#C68A3E` (text `#A8722E`), paper `#F5F4F0`, ink `#16161A`, success `#2E9C6E`, po termínu `#C2473C`.
- **Písmo:** Montserrat (nadpisy) + Inter (text).

**Chtěj po něm:**
- **Tokeny:** barvy, typografická škála, spacing, radiusy, stíny.
- **Komponenty:** tlačítko (varianty), vstup, checkbox, chip/štítek, **prioritní odznak P1–P4**, **karta úkolu** (přiřazení, stav, termín), sloupec boardu, avatar.
- **Obrazovky** (telefon i desktop): **Dnes** (se **sekcí „Zpožděné" oddělenou** od dnešních), seznam úkolů, detail úkolu, board, kalendář (měsíc/týden).
- **Stavy:** prázdný seznam, načítání, po termínu.
- **Výstup:** design tokeny ve formě, kterou jde převést na `tokens.css` / Tailwind téma.
- **Pravidla:** reálná česká data, mobile-first, jedna akcentová barva, vzdušnost.

## Design pass (po každé fázi — opakuj)
1. Vyfoť reálné obrazovky (telefon + desktop).
2. Do Claude Design: *„Tady je reálný stav — navrhni vylepšení konzistence, hierarchie a vzhledu."*
3. Úpravy vrať do Claude Code **jen přes tokeny/komponenty**.

---

**Co udělat hned:** dokud Claude Code řeší krok 4 (sync), **paralelně** spusť Claude Design a nech ho z identity Watsona vyrobit **kartu úkolu + obrazovku „Dnes"**. Až jsou hezké, vytáhneš tokeny a zbytek MVP se staví do nich.
