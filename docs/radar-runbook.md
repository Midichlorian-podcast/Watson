# Watson Radar — provozní a produktový kontrakt

## Co Radar dělá

Radar je deterministický read model nad autoritativními daty. Nehodnotí lidi a nepoužívá
AI. Skóre patří konkrétnímu úkolu nebo rozhodnutí a je omezeným součtem zveřejněných vah:

- prošlý nebo blízký `deadline` / plánované datum;
- nedokončený blocker a nelogické pořadí termínů;
- skutečný překryv naplánované práce;
- absence, nedostupnost nebo Focus Time bez schválené nouzové výjimky;
- chybějící řešitel u blízkého termínu;
- prošlá nebo blízká revize aktivního rozhodnutí.

Každý signál vrací kód, lidské vysvětlení, váhu, druh vstupu (`fact` nebo
`projection`) a zdrojový objekt. `radar:v1` je veřejná verze pravidel.

## Oprávnění a soukromí

- Endpoint je dostupný pouze adminovi/managerovi týmového workspace.
- Výpočet zahrne jen projekty, jejichž členem je i volající. Workspace role nikdy
  neobchází restricted project.
- Soukromý popisek absence se nenačítá ani nevrací; tým vidí jen typ a čas.
- Odpověď má `private, no-store` a endpoint vlastní distribuovaný rate limit.
- Neexistuje employee/productivity score ani odmítnutý kapacitní součet dne.

## Přesnost a limity

Radar se přepočítá při načtení, po návratu do okna a každou minutu. `asOf` uvádí okamžik
výpočtu. Při překročení bezpečného limitu kandidátů vrátí `coverage: partial`; UI nesmí
částečný výsledek prezentovat jako úplný. Kalendářní dny se posuzují v časové zóně
odeslané klientem, instanty a překryvy zůstávají v UTC.

## Incident a roll-forward

Radar nic nezapisuje, proto nemá destruktivní rollback. Při chybě se nezobrazí staré číslo
jako živé; UI ukáže nedostupnost a nabídne nový výpočet. Chybná váha nebo pravidlo se
opravuje novou verzí rulesetu a regresním fixturem. Samotné zdrojové entity se opravují
jejich existujícími commandy, auditem a undo cestami.

## Povinné důkazy

- `pnpm --filter @watson/api verify:radar`
- `pnpm --filter @watson/api verify:radar-ui`
- `node scripts/verify-radar-contract.mjs`
- `pnpm gate`

Browser audit musí projít v Chromium i WebKitu, na 390 px bez horizontálního overflow a
bez WCAG A/AA nálezů. Deep-link z Radar položky musí otevřít přesný úkol nebo přesné
rozhodnutí, nikoli jen obecnou obrazovku.
