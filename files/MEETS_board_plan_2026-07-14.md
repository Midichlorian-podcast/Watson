# Meet board — detail porady na JEDNÉ obrazovce (plán, 2026-07-14)

Feedback: „přepis může být objemný, ale nepotřebuje tolik prostoru; ať to není překombinované,
na jedné obrazovce elegantnější — ale chce to dobrý plán."

## Princip: jedna obrazovka, tři důrazy

Detail porady přestane být modal se 4 záložkami a stane se **celostránkovým boardem**
(uvnitř modulu Meets: klik na řádek → board nahradí seznam, „← Meets" vrací zpět;
deep-link přes `?meet=`). Layout je pořád JEDEN — jen **přesouvá důraz** podle stavu porady:

| Stav | Levý sloupec (≈58 %) | Pravý sloupec (≈42 %) |
|---|---|---|
| **naplánováno** | PŘÍPRAVA zvýrazněná (checklist + add) · Akční body jen hint | Zápis ztlumený („po poradě sem vlož zápis") · mini řetěz |
| **čeká na zápis** | Příprava (odškrtaná, ztlumená) | ZÁPIS zvýrazněný (textarea + „Vytáhnout akční body →") |
| **zpracováno** | AKČNÍ BODY dominují (řešitel · termín · „přeneseno dál") | Zápis sbalený na ~5 řádků + Rozbalit · řetěz |

## Krocení přepisu (klíčový požadavek)

Přepis je **sbalená karta**: náhled prvních ~5 řádků, `Rozbalit ↓` / `Vložit zápis` otevře
textarea. Po extrakci se přepis sám sbalí a scéna patří akčním bodům. Nikdy nezabírá
většinu obrazovky.

## Co se ZRUŠÍ (anti-překombinování)

- **Záložky úplně pryč** (žádné taby).
- **Záložka Přehled se rozpustí do hlavičky**: `← Meets · Název · út 21. 7. 10:00–11:00 · 60 min
  · avatary · stav-pilulka · [Navazující →]` — jeden řádek, žádná sekce.
- **Řetěz = mini pruh** pod zápisem: `14. 7. ✓ → 21. 7. (tahle)` s prokliky; žádný samostatný panel.
- Mobil: sloupce se složí pod sebe (příprava → akční body → zápis → řetěz).

## Technicky (žádné DB/API změny!)

1. Logiku MeetDetail (dotazy, commitActions, followUp, linkToServer) vytáhnout do hooku
   `useMeet(meetingId, hubId)` — čistý přesun, chování beze změny.
2. Nová komponenta `MeetBoard` (celostránková v Mitingy; `?meet=` search param) — layout výše.
3. Smazat overlay MeetDetail (board ho plně nahrazuje). Bonus: mizí problém vrstvení
   (detail úkolu se otevírá NAD stránkou, ne nad overlayem).
4. Stavová logika důrazu: `naplánováno` (den >= dnes, bez přepisu) / `čeká na zápis`
   (den < dnes nebo hub hotový, bez commitu) / `zpracováno` (committed).
5. Brány + audit + e2e (všechny tři stavy) — jako vždy.

Odhad: ~1 den. Mockup: artifact „meet-board-mockup" (přepínač 3 stavů).
