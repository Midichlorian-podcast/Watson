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

## Profil, docházka a malá čísla

První v1 self-service vertikála je dostupná jen při `linked=true` a
`selfService=true`. Browser používá výhradně Watson routy pod
`/api/employee/self-service/*`; provider person ID, tenant, scopes, M2M token ani
LuckyOS URL nikdy neposílá. Server je odvodí z podepsané identity binding a pro
každou operaci vydá token pouze s jedním minimálním scope.

- Profil vrací maskovaný bankovní účet a změnu posílá jako žádost ke schválení.
  Historie žádostí ukazuje jen názvy měněných polí, ne jejich dřívější či navržené
  hodnoty.
- Docházka odděluje `save_draft` od potvrzeného `submit`. Watson odmítá duplicitní
  řádky, datum mimo měsíc, budoucí datum, neplatné hodiny i prázdný submit ještě
  před providerem.
- Malá čísla čtou jen dostupné choreografie a měsíční záznamy. Koncept a odevzdání
  jsou dva explicitní stavy; minuty mají providerem podporovaný krok.
- Každý write má klientské UUID převedené na user-bound idempotency key. Stejný
  klíč a obsah lze bezpečně zopakovat, stejný klíč s jiným obsahem skončí 409.
- Provider odpovědi procházejí Zod kontraktem a veřejnou allowlist projekcí.
  Neznámá pole, raw patch hodnoty, identity metadata a upstream error text se
  zahodí.
- React Query drží odpovědi jen krátce v paměti. Profil, docházka ani malá čísla se
  neukládají do PowerSyncu, IndexedDB, `localStorage` nebo `sessionStorage`.
  Koncept je trvalý až po výslovném „Uložit koncept“ do LuckyOS.

V1 work items se před existujícím reconciliation mapují na stabilní Watson typy
(`attendance_reminder`, `missing_document`, `contract_signature_required`). Tím
se rozšíří současný osobní projekt Zaměstnanec bez výměny nebo duplikace původního
mechanismu.

## Dokumenty, výdaje a elektronický podpis

Tato v1 vertikála je pouze person-scoped facade nad autoritativními LuckyOS
agregáty. Watson neukládá soubor, účtenku, obrázek podpisu, finální PDF ani Drive
ID do vlastní databáze, PowerSyncu nebo browser storage.

- Dokument a účtenka mohou mít nejvýše 25 MB. Watson ověří příponu i magic bytes,
  normalizuje název a spočítá SHA-256. Potom si od LuckyOS vyžádá immutable upload
  intent, odešle přesný binární obsah a teprve po potvrzení spustí atomický finalize.
- LuckyOS znovu ověřuje MIME, velikost a hash, provádí malware scan a ukládá soubor
  do svého úložiště. Chyba skenu nebo storage nesmí ve Watsonu vypadat jako úspěch.
- Upload intent i následný doménový command mají oddělený user-bound idempotency
  key. Po timeoutu lze zopakovat celý browser command; již spotřebovaný upload ani
  vytvořený dokument či výdaj se nesmí zdvojit.
- Výdaje posílají originální částku, měnu a kurz; Watson odvodí CZK částku na
  serveru. Stav schválení, účetnictví a proplacení zůstává výhradně v LuckyOS.
- Publikovaný dokument se čte online přes Watson facade s minimálním
  `documents:read` scope, zákazem redirectu, 25MB response stropem a `no-store`.
  LuckyOS ověřuje osobu a auditní stopu každého otevření nebo stažení.
- Podpis vyžaduje přesnou verzi smlouvy, celé jméno, datum narození, volitelné
  poslední čtyři číslice účtu, PNG/JPEG podpis, explicitní souhlas a druhé potvrzení.
  LuckyOS challenge ověří, atomicky vytvoří finální PDF a neměnný audit. Watson
  vrací jen veřejný stav smlouvy a nikdy podpisový obrázek nebo storage metadata.
- Watson nabídne náhled jen tehdy, když LuckyOS vrátí publikované PDF se stejným
  názvem souboru i verzí smlouvy. Samotná metadata z přehledu smluv nejsou důkazem
  přečtení dokumentu; při chybějícím PDF UI zobrazí výslovné varování a uživatel
  musí smlouvu před podpisem otevřít přímo v LuckyOS.

Při incidentu `file_scan_unavailable`, `file_storage_unavailable` nebo
`contract_finalization_failed` se výsledek považuje za neúspěšný. Uživatel smí
bezpečně zopakovat stejný command se zachovaným operation ID; nové operation ID
se použije až po vědomé změně obsahu.

## Dovolená a absence

Oficiální dovolená nebo absence vzniká ve Watsonu jako verzovaný LuckyOS
`employee_domain_case` typu `absence`; LuckyOS je jediný HR system of record a
stav `resolved` je jediný stav, který Watson chápe jako schválený. Browser nikdy
neurčuje person ID, tenant ani scopes. Server používá přesné `cases:read`,
`cases:write` a `assignments:write`, normalizuje celé dny přes IANA zónu a odmítá
obrácené, delší než roční nebo překrývající se otevřené období.

Watson ukládá jen provozní projekci do `availability_blocks`: interval, zónu,
viditelnost, provider case ID a `approval_status`. Poznámka zaměstnance ani text
interního rozhodnutí se neukládají do Watson DB, PowerSyncu nebo audit eventu.
Projekce vzniká ve všech prostorech, jejichž je zaměstnanec členem, aby vedení i
kolegové viděli období nedostupnosti bez přístupu k HR detailu.

- `submitted`, `in_review` a `needs_employee` jsou `pending`: zobrazí se
  přerušovaně jako čekající, ale neblokují plánování, nespouštějí Nerušit a
  nevstupují do Radaru.
- `resolved` je `approved`: absence začne chránit plánování podle workspace
  policy a po dobu trvání drží upozornění ve frontě.
- `rejected` a `cancelled` projekci ukončí; historický audit zůstává bez obsahu
  žádosti.

Změnu po posouzení přenáší podepsaný LuckyOS outbox event. Watson z eventu
nepřebírá HR payload naslepo: pod serverovou identitou znovu načte person-scoped
`cases` projekci, ověří shodu ID, data, IANA hranic a verze a teprve poté provede
idempotentní update. Pokud refresh nebo projekce selže, webhook vrátí řízené 503;
LuckyOS může zopakovat stejný event a nevznikne druhý blok.

## Automatické důkazy

```bash
node scripts/verify-employee-hub-contract.mjs
node scripts/verify-luckyos-v1-contract.mjs
node scripts/verify-employee-self-service-contract.mjs
node scripts/verify-employee-files-contract.mjs
node scripts/verify-employee-absences-contract.mjs
EMPLOYEE_HUB_API=http://127.0.0.1:8790 pnpm --filter @watson/api verify:employee-hub
pnpm --filter @watson/api verify:luckyos-v1
EMPLOYEE_SELF_SERVICE_API=http://127.0.0.1:8790 pnpm --filter @watson/api verify:employee-self-service
EMPLOYEE_HUB_UI_WEB=http://localhost:5173 pnpm --filter @watson/api verify:employee-hub-ui
bash scripts/ci-api-integration.sh
pnpm gate
```

API verifier musí běžet proti lokálnímu LuckyOS stubu z integrační sady. Browser verifier pokrývá Chromium i WebKit, desktop, 390 px, navigační gating, dashboard, profil, docházku, malá čísla, žádost o absenci se stabilním retry, dokumentový retry, výdaj, podpisovou challenge, explicitní souhlas a axe WCAG A/AA.

## Scope této dávky

Tato dávka zpřístupňuje profilové změnové žádosti, docházku, malá čísla,
dovolenou/absence, dokumenty, výdaje a elektronický podpis. Starší
broker routy zůstávají zachované kvůli kompatibilitě a výchozí protocol zůstává
`legacy`; nasazení samotného kódu proto nikoho nepřepne. Retention a malware
politiku vlastní LuckyOS. Onboarding/offboarding a znalostní vrstva patří do
následujících samostatně auditovaných F7 vertikál.
