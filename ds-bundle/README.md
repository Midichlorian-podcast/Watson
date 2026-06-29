<!-- Tento README je generován ze seedu packages/ui. Horní část = .design-sync/conventions.md -->

# Watson — design systém (konvence)

Watson je interní, offline-first nástroj na úkoly/projekty/kalendář pro tým 15–30 lidí (z velké části ne-vývojáři). Tón: **klidný profesionál s lidskou jiskrou**. Mobile-first, vzdušné, jedna akcentová barva (brass), reálná česká data (žádné lorem ipsum).

## Nastavení (žádný provider)
Komponenty nepotřebují žádný React provider ani wrapper. Vše vychází ze stylů: stačí, aby byl v dosahu **`styles.css`** — ten `@import`uje fonty (Montserrat + Inter), tokeny (`tokens/tokens.css`) a komponentní styly (`components.css`).

## Styling idiom — tokeny a `.w-*` třídy
Stylizuj výhradně přes tokeny `--w-*` a `.w-*` třídy (viz `components.css`). Produkční appka má stejné tokeny i jako Tailwind v4 utility přes `@theme` (`bg-navy`, `text-brass-text`, `font-display`…) — názvy utilit = názvy tokenů bez `--w-`.

Plná pravidla (kdy brass/navy, dvě tvrdá pravidla, příklad) viz horní sekce / `.design-sync/conventions.md`.

## Obsah seedu
**Foundations**
- `guidelines/brand.html` — paleta, typografie, kdy brass / kdy navy.
- `guidelines/hard-rules.html` — barva ≠ priorita; dva režimy přiřazení.

**Components**
- `components/Components/PriorityBadge/` — nebarevný odznak P1–P4 (R6).
- `components/Components/TaskCard/` — karta úkolu (po termínu, per-osoba „3/5").

## K čemu to je
Seed = startovní brand + komponenty, ze kterých se na claude.ai/design doladí **5 obrazovek**
(Dnes, seznam, detail, board, kalendář). Finální tokeny se pak vytáhnou zpět do
`packages/ui/src/tokens.css` přes `/design-sync` („design lock").
