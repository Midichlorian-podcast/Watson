# TaskCard

Základní karta úkolu Watsona — stavební kámen seznamů, „Dnes" a sloupců boardu.

## Anatomie
- **Barevná tečka** (`color`) = uživatelská barva úkolu/projektu. **Samostatný akcent, ne priorita** (R6).
- **Název** — Montserrat 700.
- **Prioritní odznak** — `<PriorityBadge>`, nebarevný (R6).
- **Termín** — chip; když je deadline po termínu, červeně (`w-chip--overdue`, token `--w-overdue`). Datum/čas mono.
- **Status chip** — „Probíhá" / „Ke kontrole" / „Hotovo".
- **Přiřazení** — dle režimu (R2).

## Dvě tvrdá pravidla, která musí být vidět
1. **Barva ≠ priorita.** Tečka je uživatelská barva; priorita je nebarevný odznak.
2. **Dva režimy přiřazení (R2) musí jít vizuálně odlišit:**
   - `shared_any` („stačí kdokoli") → jeden/několik avatarů, jeden checkbox pro celý úkol.
   - `shared_all` („každý zvlášť") → **per-osoba progres** odznak „3/5" + skupina avatarů.

## Příklady
```jsx
// Po termínu, jeden řešitel
<TaskCard
  name="Odeslat grantovou zprávu nadaci"
  priority={1}
  color="#C2473C"
  due={{ label: "Po termínu · út", overdue: true }}
  status="Probíhá"
  assignment={{ mode: "shared_any", people: ["AK"] }}
/>

// Per-osoba progres (shared_all)
<TaskCard
  name="Proškolit nové baristy na espresso"
  priority={3}
  color="#C68A3E"
  status="Probíhá"
  assignment={{ mode: "shared_all", done: 3, total: 5, people: ["T", "M", "J"] }}
/>
```

## Data
Používej **reálná česká data** (dlouhé názvy úkolů, stavy po termínu) — žádné lorem ipsum.
