# Mail M1 — provozní a bezpečnostní runbook

## Rozsah

Tato etapa provozuje osobní Gmail / Google Workspace účty. Skutečné jsou OAuth
lifecycle, šifrovaný inbound sync a owner-only read API. Hlavní Mail UI, odesílání,
IMAP/SMTP a týmové schránky zůstávají mimo tento runbook a musí být označené jako demo.

## Povinná konfigurace

- `MAIL_VAULT_KEYS_JSON`: verzovaný keyring s 32B base64url klíči a jedním `currentKid`.
- `MAIL_GOOGLE_CLIENT_ID` a `MAIL_GOOGLE_CLIENT_SECRET`: dedikovaný mail OAuth klient;
  nesmí se sdílet s login klientem.
- `MAIL_GOOGLE_REDIRECT_URI`: musí přesně odpovídat URI v Google Console.
- Produkce používá výchozí HTTPS Google endpointy. Testovací override URL jsou povolené
  pouze mimo produkci.

Před nasazením musí projít `pnpm verify:production-config`, databázové migrace a
`bash scripts/ci-api-integration.sh`. Restricted scope `gmail.modify` vyžaduje dokončenou
Google OAuth verifikaci a podle způsobu ukládání také požadované bezpečnostní posouzení.

## Datový tok a autorita

1. OAuth callback jednorázově spotřebuje user-bound hashovaný state a PKCE verifier.
2. Credential je uložen pouze jako AES-256-GCM envelope svázaný AAD s účtem a vlastníkem.
3. První sync stránkuje nejvýše 25 zpráv; MIME fetch má souběh 4 a pevné byte/part limity.
4. Další změny čte přes Gmail `historyId`. Idle účet se kontroluje nejpozději po minutě,
   takže správnost nezávisí na doručení push notifikace.
5. Propadlý history cursor (404) automaticky založí nový full generation. Starý obsah se
   smaže až po úspěšném dokončení celé nové generace.
6. V clear indexu jsou jen opaque provider ID, interní čas, system/provider label ID a
   velikost. Předmět, adresy, snippet, těla a metadata příloh jsou ciphertext.
7. Read endpoint je owner-only, stránkovaný a nevrací surové HTML. Přílohy se v této etapě
   nestahují; vrací se pouze jejich zašifrovaná metadata.

## Stavy a reakce

- `pending` / `running`: běžná práce; `running` musí mít platný lease.
- `idle`: poslední stránka uspěla; minutový poll znovu zkontroluje Gmail history.
- `retry`: dočasný timeout, 429 nebo 5xx; exponenciální backoff, nejvýše 60 minut.
- `dead`: provider kontrakt nebo opakovaná provozní chyba vyžaduje zásah. Sleduj
  strukturovaný event `mail_sync_job_failed`; log neobsahuje obsah zprávy ani token.
- `reauth_required`: refresh token byl odmítnut. Uživatel musí znovu projít Google OAuth.
- `mail_history_expired`: očekávaná recovery událost; worker automaticky přejde na full.

Nikdy neopravuj stav ručním přepisem zpráv. Po odstranění příčiny použij owner sync command
nebo znovu připoj účet. Při podezření na kompromitaci nejdřív revokuj u providera.

## Revokace a výmaz

Odpojení je provider-first: Watson nejdřív vyžádá potvrzení revokace od Google a až potom
v jedné lokální transakci odstraní credential, sync cursor a veškerý synchronizovaný obsah.
Při provider výpadku se lokální credential nemaže a UI musí přiznat, že odpojení nebylo
dokončeno. Příkaz je idempotentní a svázaný s očekávanou verzí.

## Rotace klíče

1. Přidej nový klíč, nastav jej jako `currentKid`, ale ponech předchozí klíč v keyringu.
2. Nasaď a nech všechny aktivní účty projít syncem. Credential se při prvním použití
   přebalí pod aktivní klíč; worker v každé stránce přebalí až 25 starších message envelope.
3. Ověř v DB, že pro staré `key_id` nezůstal žádný řádek v `mail_account_credentials` ani
   `mail_messages`.
4. Teprve potom odstraň starý klíč a znovu spusť integrační a produkční preflight.

Odstranění starého klíče před bodem 3 je destruktivní a záměrně fail-closed.

## Bezpečnostní incident

- Zneplatni OAuth klienta nebo dotčené refresh tokeny v Google Console.
- Zastav mail worker, zachovej redigované auditní události a neexportuj ciphertext společně
  s keyringem.
- Rotuj mail keyring odděleně od PowerSync, Better Auth a LuckyOS klíčů.
- Po obnově vynucuj nový consent dotčených účtů a kontroluj tenant/owner scope.
- Demo banner lze odstranit až po samostatném E2E důkazu skutečného read/send UI.
