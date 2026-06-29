# Brief pro Claude Design — Watson

> **Jak to použít:** Zkopíruj celý tento dokument do **Claude Design** (samostatná plocha na claude.ai, ne tady v Claude Code). Iteruj v chatu, dokud nebudou obrazovky hezké. Pak z výstupu vytáhneme **design tokeny** a ty nahradí `packages/ui/src/tokens.css` — od té chvíle staví Claude Code všechno jen z nich („design lock").

---

## Zadání

Postav **design systém a klíčové obrazovky** pro **Watson** — interní, offline-first **task / projekt / kalendář** aplikaci pro tým 15–30 lidí (z velké části ne-vývojáři: trenéři, baristé, lidé v terénu). Obecná jako Todoist, ale **kvalitnější a vzdušnější**.

**Tón:** klidný profesionál s lidskou jiskrou. Persona „Watson" = bystrý, diskrétní, vřelý asistent.

**Pravidla návrhu (důležité):**
- **Mobile-first**, pak desktop. Terénní lidé to mají hlavně na telefonu → velké touch targety, palcem dosažitelné akce.
- **Reálná česká data**, ne lorem ipsum (dlouhé názvy úkolů, prázdné seznamy, stavy po termínu).
- **Konzistence > originalita.** Jeden systém všude. Vzdušnost. Jedna akcentová barva (brass), žádný vizuální šum.
- **Tablet:** vlastní split-view (seznam + detail vedle sebe), ne jen zmenšený desktop.

---

## Identita (závazná)

**Barvy (brand — značka Watsona):**
| Token | Hex | Použití |
|---|---|---|
| Navy | `#17283F` | hlavní tmavá, důvěra/klid, nadpisy |
| Navy 2 | `#24395A` | sekundární tmavá |
| Brass | `#C68A3E` | **akcent** — jen velké prvky/zvýraznění, „přítomnost" Watsona |
| Brass text | `#A8722E` | tmavší odstín pro **text** (kontrast/přístupnost) |
| Paper | `#F5F4F0` | pozadí aplikace |
| Card | `#FFFFFF` | karty, panely |
| Ink | `#16161A` | hlavní text |
| Ink 2 | `#55554F` | sekundární text |
| Ink 3 | `#8C8A82` | terciární / placeholdery |
| Line | `#E7E5DF` | linky, rámečky |
| Success | `#2E9C6E` | hotovo / pozitivní |
| Po termínu | `#C2473C` | overdue / chyba |

⚠️ **Brass na bílé nesmí nést malý text** (nízký kontrast) — pro text používej Brass text `#A8722E` nebo navy.

**Typografie:**
- **Montserrat** (300–900) — display, nadpisy, UI labely. Wordmark `Watson` = Montserrat 800.
- **Inter** (400–600) — běžný text.
- **Mono** — čas a čísla (např. „12 úkolů · 3 po termínu · 14:30").

**Logo/ikona:** monogram **W** v ukotvené dlaždici (radius ~18 na 76px) + brassová „tečka přítomnosti" vpravo dole. Varianty: tmavá (navy pozadí), brass, světlá.

---

## Dvě tvrdá pravidla, která MUSÍ být vidět v návrhu

1. **Barva ≠ priorita.** Priorita je **nebarevný odznak P1–P4** (vlaječka/badge), nezávislý na uživatelských barvách projektů/štítků. Uživatelská barva úkolu/projektu je samostatný akcent (tečka/proužek).
2. **Dva režimy přiřazení** musí jít vizuálně odlišit:
   - „Stačí kdokoli" (shared_any) — jeden checkbox pro celý úkol,
   - „Každý zvlášť" (shared_all) — **per-osoba progres**, např. odznak „3/5" + avatary.

---

## Komponenty (navrhni jako systém)

- **Tlačítko** — varianty: primární (navy/brass), sekundární, ghost, destruktivní; stavy hover/active/disabled.
- **Vstup** (text, s ikonou), **textarea**, **select/dropdown**, **checkbox** (a „kruhový" complete toggle u úkolu).
- **Chip / štítek** — s uživatelskou barvou; varianta status chip (To Do / Probíhá / Ke kontrole / Hotovo).
- **Prioritní odznak P1–P4** (nebarevný).
- **Avatar** + skupina avatarů (přiřazení).
- **Karta úkolu** — název, prioritní odznak, barevný akcent, termín (a zvlášť **deadline červeně**), status chip, přiřazení (1 nebo per-osoba „3/5").
- **Sloupec boardu** (záhlaví + počet + karty).
- **Quick add pole** — kam se píše česká věta; ukazuje **rozpoznané atributy jako chipy k potvrzení** (datum, #projekt, @štítek, p1).

---

## Obrazovky (telefon + desktop, u „Dnes" i tablet split-view)

1. **Dnes** — hlavní obrazovka. Nahoře „Co dnes řešit". **Sekce „Zpožděné" je VLASTNÍ oddělená rozbalovací sekce**, nemíchat s dnešními úkoly. Pod tím dnešní úkoly.
2. **Seznam úkolů** (projekt) — list karet úkolů, volitelné seskupení (sekce/status/přiřazený/priorita).
3. **Detail úkolu** — název, popis (rich text), podúkoly (max 3 úrovně) + lehké checklisty, přiřazení s režimem, termín/start/deadline, opakování, priorita, barva, štítky, komentáře.
4. **Board** — sloupce (sekce/status) s drag&drop kartami.
5. **Kalendář** — měsíc + týden; barevné bloky událostí/úkolů s termínem.

**Stavy navíc:** prázdný seznam, načítání (skeleton), úkol po termínu.

---

## Co od Designu chci jako výstup

- **Design tokeny** (barvy, typografická škála, spacing, radiusy, stíny) ve formě, kterou jde převést na **`tokens.css` / Tailwind v4 `@theme`**. (Projekt už používá Tailwind v4 s CSS proměnnými `--w-*` a `@theme` mapováním — viz `packages/ui/src/tokens.css`.)
- **Komponenty** výše + **5 obrazovek** v telefonní i desktop verzi (Dnes navíc tablet split-view).
- Krátká pravidla použití (kdy brass, kdy navy, spacing rytmus).

---

## Až bude hotovo

Pošli mi (do Claude Code) finální tokeny a screenshoty obrazovek. Já:
1. nahradím `packages/ui/src/tokens.css` zamčenými tokeny,
2. přemapuju Tailwind `@theme` v `apps/web/src/index.css`,
3. a od kroku 5 (úkoly) stavím každou obrazovku přesně podle těchto návrhů.
