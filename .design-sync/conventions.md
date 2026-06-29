# Watson — design systém (konvence)

Watson je interní, offline-first nástroj na úkoly/projekty/kalendář pro tým 15–30 lidí (z velké části ne-vývojáři). Tón: **klidný profesionál s lidskou jiskrou**. Mobile-first, vzdušné, jedna akcentová barva (brass), reálná česká data (žádné lorem ipsum).

## Nastavení (žádný provider)
Komponenty nepotřebují žádný React provider ani wrapper. Vše vychází ze stylů: stačí, aby byl v dosahu **`styles.css`** — ten `@import`uje fonty (Montserrat + Inter z Google Fonts), tokeny (`tokens/tokens.css`) a komponentní styly (`components.css`). Bez `styles.css` nejsou fonty ani barvy.

## Styling idiom — používej tokeny a `.w-*` třídy
Stylizuj **výhradně přes design tokeny** `--w-*` a hotové `.w-*` třídy. Nezaváděj ad-hoc barvy ani odsazení.

**Barvy:** `var(--w-navy)`, `var(--w-navy-2)`, `var(--w-brass)`, `var(--w-brass-text)` (brass pro TEXT — kontrast), `var(--w-paper)`, `var(--w-card)`, `var(--w-ink)`, `var(--w-ink-2)`, `var(--w-ink-3)`, `var(--w-line)`, `var(--w-success)`, `var(--w-overdue)`.
**Typo:** `var(--w-font-display)` (Montserrat — nadpisy/UI/labely), `var(--w-font-body)` (Inter — text), `var(--w-font-mono)` (čísla/čas). Škála `--w-text-xs … --w-text-3xl`, váhy `--w-weight-*`.
**Spacing:** `--w-space-1 … --w-space-8` (4px base). **Tvar:** `--w-radius`, `--w-radius-sm`, `--w-radius-pill`. **Stíny:** `--w-shadow`, `--w-shadow-sm`.

**Hotové třídy** (viz `components.css`): `.w-priority-badge[data-priority]`, `.w-chip` (+ `.w-chip--status`, `.w-chip--overdue`), `.w-num` (mono), `.w-avatar` (+ `.w-avatar--brass`), `.w-avatar-group`, `.w-task-card` (+ `__top`, `__dot`, `__name`, `__meta`, `__assignees`).

> Produkční appka (`apps/web`) má přesně tyto tokeny vyjádřené i jako **Tailwind v4 utility** přes `@theme` (`bg-navy`, `text-brass-text`, `bg-paper`, `font-display`, `text-overdue`…). Pojmenování utilit = názvy tokenů bez prefixu `--w-`. Když navrhuješ v Tailwindu, drž se těchto jmen — usnadní to převod zpět do kódu.

## Kdy brass / kdy navy
- **Navy** = hlavní tmavá (důvěra, klid, nadpisy, primární plochy).
- **Brass** = akcent, **jen velké prvky/zvýraznění** („přítomnost" Watsona). Ne na každém tlačítku.
- ⚠️ **Brass na bílé nesmí nést malý text.** Pro text `var(--w-brass-text)` nebo navy.

## Dvě tvrdá pravidla, která MUSÍ být v návrhu vidět
1. **Barva ≠ priorita.** Priorita = nebarevný odznak `PriorityBadge` (P1–P4). Uživatelská barva úkolu/projektu je samostatný akcent (tečka/proužek).
2. **Dva režimy přiřazení** vizuálně odlišit: „Stačí kdokoli" (jeden checkbox) vs. „Každý zvlášť" (per-osoba progres „3/5" + avatary).

## Kde je pravda
- `tokens/tokens.css` — všechny tokeny. `components.css` — styly komponent. `styles.css` — vstupní bod (čti první).
- Per-komponenta: `components/Components/<Name>/<Name>.prompt.md` (použití) + `<Name>.d.ts` (API).

## Idiomatický příklad
```jsx
// karta v sekci „Dnes"
<div style={{ display: "grid", gap: "var(--w-space-3)" }}>
  <h2 style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, color: "var(--w-navy)" }}>
    Co dnes řešit
  </h2>
  <TaskCard
    name="Odeslat grantovou zprávu nadaci"
    priority={1}
    color="#C2473C"
    due={{ label: "Po termínu · út", overdue: true }}
    status="Probíhá"
    assignment={{ mode: "shared_any", people: ["AK"] }}
  />
</div>
```
