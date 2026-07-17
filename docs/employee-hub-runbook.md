# Employee Hub a LuckyOS — provozní runbook

## Zdroj pravdy a datová hranice

- LuckyOS je jediný system of record pro personální údaje, účetnictví, mzdy, schválení a právní finalizaci.
- Watson zobrazuje zaměstnanci jen jeho aktuální read model přes serverový broker. Prohlížeč nikdy nedostane bridge token ani provider credentials.
- Employee status je online-only. Neukládá se do PowerSync, IndexedDB, `localStorage` ani `sessionStorage`; React Query drží jen krátkou paměťovou kopii.
- Všechny `/api/employee/*` odpovědi mají `Cache-Control: private, no-store`.
- `publicEmployeeIdentity` a `publicEmployeeStatus` jsou explicitní allowlist. Nové provider pole se nesmí automaticky objevit ve Watsonu.
- Provider odkazy jsou nedůvěryhodný vstup. Do klienta projde jen relativní cesta začínající jedním `/`; absolutní a protocol-relative URL se zahodí.

## Uživatelský tok

1. `GET /api/employee/status` ověří Better Auth session, lokální revoke a LuckyOS kontrakt.
2. Pouze `linked=true` zpřístupní položku Zaměstnanec v desktopové a mobilní navigaci a kartu Můj stav na Přehledu.
3. Nepropojený přímý odkaz zobrazí pravdivý důvod a cestu do Nastavení → Integrace. Nedostupný provider se nevydává za prázdný nebo aktuální stav.
4. Tlačítko „Přenést akce do úkolů“ je výslovná human-in-the-loop akce. Nevytváří automaticky úkol z každého oznámení.

Akční typy jsou omezeny v `ACTIONABLE_NOTIF`; informativní typy zůstávají pouze v přehledu. Reconciliation vytvoří osobní projekt `Zaměstnanec`, assignment, opaque lineage a redigovaný audit atomicky. Dedup klíč je `(workspace, luckyos, notification id)` a souběh serializuje PostgreSQL advisory lock.

## Provoz a incidenty

- Stav provideru sleduj v Nastavení → Integrace. Revoke okamžitě uzavře čtení, sync, odevzdávací passthrough i upload před vydáním nového bridge tokenu.
- `luckyos_contract_rejected` znamená nekompatibilní payload, ne chybějící data. Neobcházej validátor; oprav nebo verzuj provider kontrakt.
- `luckyos_identity_not_linked` řeš opravou identity v LuckyOS. Watson nesmí založit nebo tipovat person ID z klientského vstupu.
- `luckyos_unavailable` je přechodný stav. UI ponechá data prázdná a netvrdí, že dřívější kopie je aktuální.
- Po timeoutu nebo ztracené odpovědi lze sync bezpečně zopakovat. Již vzniklý task se nepřepíše ani neduplikuje.
- Při úniku bridge klíče rotuj LuckyOS keyring odděleně od Better Auth, PowerSync, mail vaultu a backup signing klíče a proveď provider revoke drill.

## Produkční prerequisite

Lokální CI používá uzavřený LuckyOS stub. Produkční zapnutí vyžaduje:

- nakonfigurovaný `LUCKYOS_BASE_URL` a oddělený bridge keyring;
- serverové ověření Watson bridge JWT na straně LuckyOS;
- jednoznačně provisionovanou identitu zaměstnance a fail-closed odmítnutí neznámého mappingu;
- kompatibilní `/api/employee/me` a `/api/employee/status` kontrakt;
- DPA, rozhodnutí o regionu dat, rotaci credentialů a ověřený revoke/restore postup.

## Verzovaný LuckyOS v1 kontrakt

Nové odevzdávací vertikály nepoužívají starou e-mailovou raw proxy. Cutover je
výslovný přes `LUCKYOS_PROTOCOL=v1`; výchozí `legacy` zachovává stávající modul,
takže deploy samotného kódu provoz nepřepne. V1 navíc vyžaduje přesný
`LUCKYOS_ORGANIZATION_ID` a samostatný `LUCKYOS_WEBHOOK_SIGNING_SECRET` o délce
32–512 znaků. Produkční preflight neúplnou nebo sdílenou konfiguraci odmítne.

LuckyOS doručuje outbox na `POST /api/integrations/luckyos/v1/events`. Watson
ověřuje HMAC nad nezměněným tělem, pětiminutové timestamp okno, event ID, tenant,
64KiB limit a idempotency key. Receipt a safe payload se ukládají pouze na serveru;
nejsou v PowerSyncu. Identity event vytvoří vazbu stabilního Watson user UUID na
opaque LuckyOS person/link ID. Starší verze nesmí přepsat novější, jedna LuckyOS
osoba nesmí patřit dvěma Watson účtům a nový provider link může nahradit pouze již
revokovaný link.

Odchozí v1 JWT má `iss=watson`, `aud=lucky-os`, unikátní `jti`, maximálně
pětiminutovou platnost, tenant, stabilní `watson_user_id` a nejmenší potřebné
scopes. Neobsahuje e-mail ani person ID. Person ID do URL doplní výhradně server z
podepsané vazby; browser jej nemůže zvolit. Lokální odpojení v Integration Center
se kontroluje ještě před vydáním tokenu. Redirect provideru je zakázán, odpověď
má 2MiB strop a timeout se rozlišuje od ostatní nedostupnosti.

LuckyOS musí pro společný staging nastavit:

- Watson RSA public key mapu podle `/api/integrations/luckyos/jwks`;
- Watson webhook URL končící `/api/integrations/luckyos/v1/events`;
- shodný webhook signing secret a organization ID;
- ruční identity provisioning v LuckyOS před prvním přihlášením zaměstnance;
- agenda read/write channel nejprve `legacy`, potom jednotlivě `shadow` a až po
  reconciliation `watson`.

Legacy a v1 token mají různé issuer/audience kontrakty, ale sdílejí pouze LuckyOS
RSA compromise domain; PowerSync, Better Auth, mail vault a webhook HMAC zůstávají
oddělené. Legacy endpoint se v režimu v1 odmítne a nikdy se nepoužívá jako tichý
fallback.

## Automatické důkazy

```bash
node scripts/verify-employee-hub-contract.mjs
node scripts/verify-luckyos-v1-contract.mjs
EMPLOYEE_HUB_API=http://127.0.0.1:8790 pnpm --filter @watson/api verify:employee-hub
pnpm --filter @watson/api verify:luckyos-v1
EMPLOYEE_HUB_UI_WEB=http://localhost:5173 pnpm --filter @watson/api verify:employee-hub-ui
bash scripts/ci-api-integration.sh
pnpm gate
```

API verifier musí běžet proti lokálnímu LuckyOS stubu z integrační sady. Browser verifier pokrývá Chromium i WebKit, desktop, 390 px, navigační gating, dashboard, sync a axe WCAG A/AA.

## Scope této dávky

Tato dávka nezpřístupňuje nové odevzdávací formuláře ani dokumentové mutace. Starší broker routy zůstávají zachované kvůli kompatibilitě, ale jejich nový UI, request/response allowlist, idempotentní command receipt, upload limity, malware/retention pravidla a elektronický podpis patří do následující samostatné F7 vertikály.
