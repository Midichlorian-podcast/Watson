# Watson F8a — informační architektura a role-aware vstupy

## Produktový kontrakt

- `/` je **Dnes**: konkrétní provedení dnešní a zpožděné práce.
- `/prehled` je **Přehled**: syntéza osobní práce, komunikace a stavu organizace.
- `/prehled?vstup=tym` je **Tým**: komunikace, předávání práce, společné seznamy a dění.
- `/prehled?vstup=provoz` je **Provoz**: rizika, zadrhnuté Postupy a vazby pro vedení.

Přehled a Dnes se neslučují. Team/Operations jsou jen adresovatelné řezy stejného
read modelu; nevytvářejí další kopii dat ani nový autoritativní stav.

## Role a bezpečnost

- Můj den a Tým jsou dostupné každému přihlášenému členovi podle jeho stávajícího ACL.
- Provoz se zobrazuje, pokud má uživatel roli `admin` nebo `manager` alespoň v jednom
  týmovém prostoru.
- Ruční deep link na Provoz se bez této role nenechá otevřený a nahradí se týmovým
  vstupem. Jde o defense-in-depth pro informační architekturu; serverová ACL a
  PowerSync buckety zůstávají skutečnou autoritou dat.

## Navigace a progressive disclosure

Výchozí `guided` režim ukazuje každodenní jádro a tlačítko **Všechny nástroje**.
Rozbalení je jeden krok, aktivní pokročilá routa zůstává viditelná a Seznamy jsou
v horní části skupiny nástrojů. `advanced` režim ukazuje všechny nástroje trvale.
Preference je pouze necitlivé per-device UI nastavení `watson.navigationMode`;
doménová data se do Web Storage nezapisují.

Mobilní spodní lišta zůstává jediná. Role-aware vstupy jsou v dosažitelném sheetu
Více a všechny mají nejméně 44 px.

## Ověření

```bash
node scripts/verify-information-architecture-contract.mjs
IA_UI_WEB=http://localhost:5180 pnpm --filter @watson/api verify:ia-ui
pnpm gate
```

Browser verifier vytváří izolované admin/member účty pro Chromium i WebKit,
kontroluje role gating, oba řezy, guided/advanced persistence, mobilní reflow,
horizontální overflow, runtime chyby a axe WCAG A/AA.

## Rollback a roll-forward

Změna nemá migraci ani doménový zápis. Bezpečný rollback vrátí rozdělení
`CORE_NAV`/`TOOL_NAV`, odstraní `vstup` search parametr a preference se může
ignorovat; všechny původní routy a obrazovky dál existují. Preferovaný roll-forward
je opravit mapování nebo copy a zachovat deep linky `/prehled?vstup=tym|provoz`.
