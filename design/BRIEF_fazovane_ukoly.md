# Brief pro Claude Design — Fázované úkoly („Postup")

> **Jak to použít:** Zkopíruj celý tento dokument do **Claude Design** (samostatná plocha na claude.ai, ne Claude Code). Iteruj, dokud nebudou obrazovky hezké. Pak z výstupu vytáhneme tokeny/komponenty do `packages/ui` a Claude Code podle nich postaví UI. **Navazuje na hlavní brief `BRIEF_claude_design.md` — používá tytéž barvy, typografii, komponenty a pravidla** (zde jen nové části pro Postupy). Logika a datový model: `files/fazovane_ukoly_PLAN.md`.

---

## Co navrhujeme

**„Postup"** = **řetězec navazujících úkolů s předáváním mezi lidmi** (mikroprojekt, ne plný projekt). Dokončí-li jeden krok svůj úkol, **automaticky se rozsvítí další krok dalšímu člověku** — jako štafeta. Každý krok je normální úkol (přiřazení, priorita, termín, komentáře). Dokud na krok nedojde řada, je „spící" (vidět jen v pohledu Postupu, ne v „Dnes").

**Tón:** klidný profesionál s lidskou jiskrou. Musí být na první pohled jasné: **kdo je teď na řadě, co už je hotové, co teprve přijde.**

---

## Kotevní příklad (používej reálně tato data, ne lorem ipsum)

**Postup: „Plakát na červnovou show"** — 5 kroků:
1. **Udělat návrh plakátu** — Adam (grafik) — *jeden řešitel* — ✅ hotovo
2. **Poptávka do tisku** — Tereza (produkce) — *jeden řešitel* — 🟡 **teď na řadě**
3. **Zadat do tisku** — Tereza — *jeden řešitel* — ⚪ čeká
4. **Vyzvednout tisk** — *kdokoli z týmu* (stačí jeden) — ⚪ čeká
5. **Pohlídat platbu faktury** — Jana (účetní) — *jeden řešitel* — ⚪ čeká

Progres: **2/5**. Další reálné šablony pro varianty: „Nová epizoda podcastu", „Příprava plesu", „Žádost o grant".

---

## Dvě tvrdá pravidla z hlavního briefu (musí být vidět i tady)

1. **Barva ≠ priorita.** Stav kroku (čeká / teď / hotovo) **NEKÓDUJ barvou priority.** Priorita zůstává nebarevný odznak P1–P4. Stav kroku má vlastní indikátory (viz komponenty níže).
2. **Dva režimy přiřazení** musí jít vizuálně odlišit i na úrovni kroku: „stačí kdokoli" (jeden checkbox) vs „každý zvlášť" (per-osoba progres „3/5" + avatary).

---

## Nové komponenty (navrhni jako systém)

- **Stepper / timeline řetězce** — vertikální (mobil) i kompaktní horizontální (desktop). Spojnice mezi kroky naznačuje tok/štafetu.
- **Řádek kroku** — pořadí (1–5), název, avatar(y) přiřazeného + odznak režimu R2, **stavový štítek** (Čeká / Teď na řadě / Hotovo / Přeskočeno), termín (deadline zřetelně, červeně).
- **Stavové štítky kroku:** `Čeká` (spící, tlumené/zámek), `Teď na řadě` (zvýrazněné — brass akcent), `Hotovo` (success ✓), `Přeskočeno`.
- **Progres odznak „2/5"** (mono číslice) — kolik kroků hotovo z celku.
- **Glyf „štafety / předání"** — drobný indikátor „přišlo na tebe z předchozího kroku".
- **Ikony gate:** auto (→ rozsvítí se po předchozím), ruční (✋ spustí člověk), souběh (⇉ běží paralelně).
- **Badge „Postup" na kartě úkolu** — když je úkol krokem řetězce: „Postup: Plakát · krok 2/5".
- **Builder kroku** (řádek v editoru šablony) — název, přiřazený/role, přepínač režimu R2, gate, posun termínu od kotvy, priorita, volitelný checklist.

---

## Obrazovky (telefon + desktop; pohled instance i tablet split-view)

1. **Pohled instance Postupu** (hlavní) — záhlaví (název, progres „2/5", stav), pod ním **timeline kroků** s aktuálně aktivním krokem zvýrazněným. Jasně „teď je to na Tereze". Akce: dokončit svůj krok, (manager) editovat/rewind/zrušit.
2. **Karta úkolu jako krok** — varianty: **aktivní** („Teď na tobě", zvýraznění), **spící** („Čeká na krok 1", tlumené + zámek), **čerstvě předané** („Přišlo na tebe").
3. **„Dnes" / inbox s předáním** — aktivní krok se chová jako běžný úkol, ale s chipem „Postup" + poznámkou „Přišlo na tebe: Plakát → Poptávka do tisku". Spící kroky se **nezobrazují**. Návrh **toastu/notifikace** „Přišlo na tebe".
4. **Builder šablony** — uspořádaný seznam kroků (drag pro přeřazení), pole kotvy (např. „Datum show"), per krok nastavení (viz Builder kroku). Tlačítko „Uložit jako šablonu".
5. **Založení Postupu (s náhledem)** — vyber šablonu / začni prázdně → zadej kotvu (datum show) → potvrď přiřazení (s upozorněním, když někdo není člen projektu) → **náhled vygenerovaných kroků se spočítanými termíny** → vytvořit.
6. **(Volitelně) Přehled „Postupy"** — seznam běžících řetězců v projektu: název, progres, kdo je teď na řadě, **zvýraznit zaseknuté** (aktivní krok po termínu = úzké hrdlo).

**Stavy navíc:** prázdný (žádné Postupy), načítání (skeleton), **spící krok**, **aktivní krok po termínu (bottleneck, červeně)**, hotový/archivovaný řetězec, zrušený řetězec.

---

## Pravidla návrhu (z hlavního briefu)

- **Mobile-first**, velké touch targety (terénní lidé na telefonu). Tablet = vlastní split-view (seznam Postupů + detail).
- **Reálná česká data** (viz kotevní příklad), dlouhé názvy, stavy po termínu.
- **Konzistence > originalita.** Jedna akcentová barva (**brass** jen pro „teď na řadě" / přítomnost), vzdušnost, žádný vizuální šum.
- Identita (barvy, typografie, logo) **přesně dle `BRIEF_claude_design.md`** — neopakuje se zde.

---

## Co od Designu chci jako výstup

- **Nové komponenty** výše + **6 obrazovek** (telefon + desktop; pohled instance navíc tablet split-view).
- Zapadnutí do **stávajícího design systému** (tytéž tokeny/komponenty jako 5 hlavních obrazovek).
- Krátká pravidla použití: kdy brass (jen „teď na řadě"/předání), jak vizuálně odlišit spící vs aktivní vs hotovo, jak ukázat režim R2 na kroku.
