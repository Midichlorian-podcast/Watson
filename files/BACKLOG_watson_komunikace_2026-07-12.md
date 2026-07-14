# Backlog — Watson akce + komunikační vrstva (2026-07-12)

Zaznamenáno na přání uživatele („nemělo by se zapomenout").

## 1. Notifikace přes Watson (`send_notification` akce)
Příkaz typu: *„pošli notifikaci všem, co mají zpožděné úkoly v projektu XY"*.
- Watson (apps/api/src/watson.ts) dostane nový tool `send_notification` → NÁVRH: komu (odvozeno z filtru, např. řešitelé zpožděných úkolů v projektu) + text.
- Provedení po schválení: přes existující notifikační infrastrukturu — web push (apps/api/src/push.ts, VAPID `pushEnabled`) + centrum oznámení (mail/NotifCenter). Cílení „kdo má zpožděné úkoly v projektu": server dopočítá z tasks/assignments.
- Human-in-the-loop: Watson ukáže KOMU a CO pošle, uživatel potvrdí.
- Priorita: hned po composeru.

## 2. Komunikační / agregační vrstva „Zprávy" (light, NE chat)
Rozhodnutí směru: **light agregát, ne messenger.** Uživatel: „nechci chatovací aplikaci, ale přehled kdo mi co psal + možnost napsat někomu".
- Agreguje na jedno místo, co UŽ v appce vzniká: zmínky `@někdo`, interní poznámky u mailů (mail internal chat), komentáře u úkolů (comments).
- Přidá: „kdo mi co napsal" (příchozí zmínky/poznámky mířené na mě) + možnost napsat krátkou interní poznámku člověku (objeví se v jeho přehledu).
- BEZ realtime, bez presence/online teček. Jen agregace + odpověď.
- Admin↔zaměstnanec i zaměstnanec↔zaměstnanec přes stejný mechanismus.
- Priorita: až za composerem a notifikacemi. Rozmyslet, jestli samostatný modul „Zprávy" nebo sekce v kartě W / Přehledu.
