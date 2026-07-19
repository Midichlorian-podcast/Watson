# Watson — více oken, focus a wallboard shell

## Produktový kontrakt

Watson nemá druhý mailový, kalendářní ani manažerský systém. Všechna okna používají
stejné routy, autentizaci, API, PowerSync databázi, providery a oprávnění. Liší se jen
vizuálním shellem a adresovatelným kontextem obrazovky.

- `app` je plný Watson se sidebarem, běžnou hlavičkou a mobilní navigací.
- `focus` je pracovní okno jednoho modulu bez globální navigace.
- `wallboard` je pasivnější velkoplošný povrch pro Přehled nebo Velín.

Shell se volí validovaným parametrem `?shell=focus|wallboard`. Nepovolená kombinace
routy a shellu se vykreslí jako běžný `app` shell. Samotné otevření okna nikdy
nevytváří kopii doménových dat ani nové oprávnění.

## Podporované povrchy

| Povrch | Focus | Wallboard | Adresovatelný stav |
|---|---:|---:|---|
| Přehled | ano | ano | `vstup`, `prostor`, `firma`, `rozlozeni` |
| Mail | ano | ne | `prostor`, `vlakno`, `mailAccount`, `mailMessage` |
| Úkoly / projekt | ano | ne | `prostor`, `projekt`, `pohled`, `zobrazeni`, `rozsah`, `datum` |
| Nadcházející / kalendář | ano | ne | `prostor`, `pohled`, `zobrazeni`, `rozsah`, `datum` |
| Seznamy | ano | ne | `prostor`, `seznam` |
| Velín | ano | ano | `prostor`, `firma` |

Všechny ostatní registrované routy lze otevřít v novém plném app okně. Focus a
wallboard jsou allowlist, nikoli volný parametr pro libovolnou obrazovku.

## Uživatelské vstupy

- Ikona v běžné hlavičce otevře aktuální modul ve focus okně, pokud jej podporuje;
  jinak otevře nové plné okno. Přehled a Velín mají navíc wallboard tlačítko.
- Kontextové menu položek sidebaru nabízí plné, focus a případně wallboard okno.
- Stejný kontrakt mají pracovní prostory, projekty, připnuté projekty, uložené
  pohledy, oblíbené vstupy a Nastavení.
- Mail má vlastní viditelné tlačítko v hlavičce poštovní složky.
- Focus/wallboard hlavička nabízí návrat do plného Watsonu a zavření okna. Úkoly a
  Nadcházející v ní mohou měnit pohled; změna se okamžitě zapisuje do URL.

## Izolace a koordinace

`WorkspaceProvider` v plném shellu ukládá poslední pracovní prostor do
`watson.activeWs`. Focus a wallboard okno používají `?prostor=` jen lokálně a tuto
globální preferenci nepřepisují. Motiv je naopak vědomě sdílená UI preference a
změna se přes `storage` event propíše do všech oken.

Cross-window zprávy mají verzi, uzavřený seznam typů a validaci payloadu.
`BroadcastChannel` má localStorage fallback. Používá se pro:

- invalidaci relace po odhlášení;
- obnovu osobního Mail modelu po sync/send/cancel/execution změně;
- přítomnost a zavření okna.

Attachment finalization běží přes jediného leadera. Preferuje Navigator Locks,
fallback používá krátký ověřený lease. Start stejné PowerSync databáze je mezi okny
serializovaný. Service worker při kliknutí na notifikaci preferuje přesnou URL,
potom stejné focus/app prostředí; nesouvisející focus nebo wallboard okno nikdy
nepřenaviguje.

## Hranice podpory

Souběžná lokální PowerSync databáze je povolená jen při stejné capability hranici
jako PowerSync Web 1.38.x: desktop, `SharedWorker`, ne Safari. Na Safari/WebKitu a
mobilu přejde `openWatsonWindow` bezpečně ve stejném okně. Uživatel dostane focus či
wallboard UI, ale nevznikne druhá instance lokální DB.

To je vědomý fail-safe. Nesmí se obcházet prostým `window.open`, dokud použitá verze
PowerSync nedoloží bezpečný multi-tab provoz i pro daný engine.

## Ověření

```bash
pnpm verify:multi-window-contract
pnpm --filter @watson/web test
pnpm --filter @watson/api verify:ia-ui
pnpm gate
git diff --check
```

Čisté testy ověřují registr a same-origin URL, capability gate, validaci zpráv,
leader lease a prioritizaci notifikačních klientů. Browser verifier v Chromiu
otevírá souběžně všechny schválené focus/wallboard povrchy, kontroluje URL stav,
izolaci workspace a propagaci motivu. WebKit kontroluje skutečný same-window
fallback, skrytí sidebaru a návrat do plného Watsonu. Oba enginy dál procházejí
role-aware IA, 390px reflow a axe WCAG A/AA.

## Rollback a roll-forward

Změna nemá migraci ani nový doménový zápis. Nouzový rollback může odstranit shell
parametr a UI affordance; původní routy a data zůstanou platné. Preferovaný
roll-forward je vypnout konkrétní `focus`/`wallboard` příznak v registru, opravit
daný povrch a zachovat deep linky i společnou datovou autoritu.

Při změně PowerSync verze znovu ověř capability hranici, více současných oken,
offline/reconnect, jediného background leadera a WebKit fallback. Bez těchto důkazů
se seznam podporovaných prohlížečů nerozšiřuje.
