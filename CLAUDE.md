# Watson — závazný re-audit a implementační plán pro Claude Code

> Stav dokumentu: 2026-07-17 po stabilizaci a průběžných produktových dávkách do migrace 0064.
>
> CLAUDE CODE: přečti celý soubor před první změnou. Toto je jediný aktuální řídicí dokument. Staré audity, handoffy a plány ve `files/` jsou historické podklady. Pokud odporují tomuto souboru nebo současnému schématu, nemají autoritu.

## 0. Výkonný kontrakt

### 0.1 Co znamená „opraveno"

Nález je opravený pouze tehdy, když platí současně:

1. oprava pokrývá celou vertikálu, kterou chyba zasahuje: DB, API, sync, lokální cache, UI, recovery a audit;
2. autorita je na serveru nebo v DB, ne pouze ve skrytém tlačítku;
3. zápis je atomický a retry je idempotentní, pokud může být opakován;
4. chyba se uživateli nezmění na tichý no-op ani falešný úspěch;
5. existuje automatický důkaz přiměřený riziku;
6. proběhl typecheck, lint bez warnings, relevantní testy a produkční build;
7. zbytkové riziko je explicitně uvedeno.

Komentář, toast, `catch {}`, odstranění ovladače, změna copy nebo zelený happy-path unit test samy o sobě opravu nedokazují.

### 0.2 Potvrzená produktová rozhodnutí

Tato rozhodnutí jsou závazná a nesmí být změněna bez výslovného souhlasu zakladatele:

1. První release je interní pilot do 20 lidí.
2. Hlavní Mail UI a jeho akce zůstávají viditelně demo, dokud se nepřepojí na ověřený provider read/send model. Gmail account lifecycle, šifrovaný inbound sync a owner-only read API už skutečné jsou.
3. Přepis porady smí číst účastník nebo explicitně pozvaný člověk; workspace admin nemá automatický přístup.
4. Offline přepis je v první verzi povolen, ale pouze v per-user šifrované lokální DB s revokací a cleanupem.
5. Projektové členství mění project manager nebo workspace admin/owner; editor nikdy.
6. Konflikty používají optimistic version/CAS, field diff a Centrum problémů; obecné LWW není přijatelné.
7. Kalendářní den je `DATE`; časovaný začátek je `TIMESTAMPTZ` plus IANA `start_timezone`.
8. AI je per workspace/capability výchozím stavem vypnutá.
9. AI potřebuje model routing, denní budget, explicitní souhlas a audit bez vstupního obsahu.
10. STT provider musí být vyměnitelný a projít EU/DPA gate.
11. Cílové DR parametry pilotu jsou RPO 15 minut a RTO 2 hodiny.
12. Implementaci řídí jeden člověk; WIP limit je jedna epika plus jeden naléhavý fix.

### 0.3 Zakázané zkratky

- Nepřidávej `localStorage` pro doménová nebo citlivá data.
- Nevracej raw chybu, stack, SQL, název constraintu, token, klíč ani obsah AI promptu.
- Nepoužívej `INSERT ... ON CONFLICT DO UPDATE` jako univerzální CREATE.
- Neoznačuj reminder, mail, upload, integraci nebo zálohu jako úspěšnou před autoritativním potvrzením.
- Neřeš RBAC pouze v UI.
- Nezahazuj permanentně odmítnutou sync operaci.
- Nevypínej constraint, CSP, rate limit, lint, typecheck nebo test kvůli průchodu CI.
- Neměň aplikovanou migraci 0000–0039. Další změna je forward migrace 0040+.
- Nepouštěj mock data v produkci. `NODE_ENV=production` musí být fail-closed.
- Nepřidávej AI před policy, consentem, redakcí, kvótou, auditem a lidským potvrzením.
- Nepřepisuj nesouvisející změny v dirty worktree.
- Neříkej „hotovo“, pokud jsi neprovedl uvedené důkazy nebo přesně neoznačil externí blokaci.

### 0.4 Povinný pracovní postup

Pro každou issue:

1. reprodukuj porušení nebo napiš failing test;
2. určete trust boundary, tenant, oprávnění, retry a offline scénář;
3. změň nejmenší úplnou vertikálu;
4. přidej negativní test, nejen happy path;
5. proveď forward migraci a ověř backfill/invariant na PostgreSQL;
6. spusť minimální quality gate;
7. u UI proveď klávesnici, focus, 320/390/768/1440 px a axe/browser test;
8. zapiš důkaz, rollback/roll-forward a zbytkové riziko.

Minimální automatický gate:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @watson/web test:corpus
pnpm build
git diff --check
```

Pro DB/API/RBAC/sync/auth změny navíc:

```bash
pnpm --filter @watson/db db:migrate
bash scripts/ci-api-integration.sh
```

`pnpm audit --prod` je povinný v CI nebo v prostředí s povoleným npm registry. Bez skutečného výsledku nikdy netvrď, že nejsou advisories.

## 1. Verdikt bez obalu

Claude udělal proti prvnímu auditu velký a převážně správný posun. Watson už není jen vizuálně bohatý prototyp s tenkou bezpečnostní vrstvou. Kritické operace mají autoritativní serverové commandy, databázové invarianty, CAS/idempotenci, audit, recovery a rozsáhlé integrační důkazy. Přístupnost, ochrana lokálních dat, auth, sync recovery a backup/restore se zlepšily zásadně.

Před druhým auditem však některé změny končily o jednu vrstvu dřív, než bylo bezpečné:

- časované úkoly dál ukládaly wall-clock řetězec bez zóny;
- několik míst po sync round-tripu četlo UTC text jako lokální čas;
- produkční mock režimy nebyly fail-closed;
- CI actions nebyly immutably připnuté;
- build neměl rozpočet a PWA precachovala přibližně dvojnásobek nutného objemu;
- zůstaly přímé přístupy k Web Storage;
- externí provider cally neměly úplný timeout kontrakt;
- regenerace 2FA recovery kódů chyběla v UI;
- nepodporovaný drag jednoho recurring occurrence byl tichý no-op.

Tyto konkrétní nálezy byly v tomto průchodu opraveny a automaticky ověřeny. Reprodukovatelný Chromium + WebKit runtime/axe/keyboard/reflow důkaz, čerstvý dependency advisory scan i kritické browser cesty task/offline recovery, 2FA, meeting commit a šifrovaný backup/restore jsou zelené. Nelze však poctivě vydat produkční go-live verdikt bez reprodukovaného CI advisory artifactu a reálných produkčních provider/DR zkoušek. To nejsou skryté vady; jsou evidované jako release blokátory v kapitole 8.

### Skóre po opravách

| Oblast | Stav | Přísné hodnocení |
|---|---|---:|
| Datová integrita | DB constraints, transakční commandy, rollback testy | 9/10 |
| Autorizace | server + DB scope, meeting content ACL, role invariants | 9/10 |
| Offline/sync | per-user DB, CAS, dead-letter recovery, idempotence | 8.5/10 |
| Auth | invite-only, magic link, heslo, 2FA, recovery rotace | 8.5/10 |
| Lokální bezpečnost | per-user šifrovaná SQLite, oddělené keyringy | 8/10 |
| Backup/restore | signed, scoped, encrypted wrapper, restore testy | 8/10 |
| Přístupnost | 0 lint warnings, 105 TSX kontrakt, Chromium + WebKit axe/keyboard/reflow matrix | 9/10 |
| Výkon | lazy routes, PWA rozpočet, bundle gate | 7.5/10 |
| Produktová praktičnost | silné task/meeting jádro, složitější IA | 7/10 |
| Produkční připravenost | kritické browser cesty jsou zelené; chybí CI advisory artifact, produkční provider a DR drill | 7/10 |

## 2. Co Watson skutečně nabízí

### 2.1 Funkční jádro

- Offline-first úkoly, podúkoly do tří úrovní, priority, termíny, deadline, odhady,
  vícedennost, opakování, statusy a per-user barvy. Opakování lze bezpečně přesunout
  v rozsahu „jen tento“, „tento a další“ i „celá aktivní řada“ s preview, DST politikou,
  kontrolou dostupnosti, zachováním dřívější historie a serverovým undo.
- Rychlé přidání přirozenou češtinou: datum, čas, délka, recurrence, projekt a lidé; parser má corpus 321/321.
- Seznam, board, den/týden/měsíc kalendář, drag/resize, Dnes, Nadcházející, Oblíbené a Inbox.
- Projekty, projektové role, členové, cíle, seznamy/checklisty, postupy/řetězy, komentáře a audit aktivity.
- Per-workspace dostupnost: pracovní doba, IANA časová zóna, tiché hodiny, ruční Nerušit,
  Focus Time, absence a nedostupnost jako samostatná kalendářní vrstva. Focus Time je
  autoritativní blok plánování s odůvodněnou, auditovanou nouzovou výjimkou.
- Skutečné task přílohy do 20 MB: bezpečný staging při offline-first vytvoření, serverový binární obsah, PowerSync metadata, autorizovaný náhled/download, audit a delete/undo včetně blobu.
- Přehled, Velín, Reporty, globální hledání a command palette.
- Meets: atomické plánování, účastníci, přepis, explicitní content ACL, AI návrhy s revizí, commit action items, follow-up a carryover.
- Interní rezervace nad kalendářem: manager nabízí konkrétní termíny s pevnými
  účastníky, rezervující zaměstnanec se přidá automaticky a teprve potvrzení atomicky
  vytvoří skutečný meet. Rezervace respektuje Focus, dostupnost i obsazený kalendář;
  zrušení bezpečně otevře slot a zachová auditní historii.
- Workspace pozvánky, role a profilové metadata.
- Web Push a volitelné e-mailové remindery sdílejí lease/retry/hold state machine; e-mail
  dostane `sent` až po provider ACK, stabilní idempotency key a message ID.
- Osobní Gmail account lifecycle M1: oddělený serverový OAuth klient, PKCE, jednorázový
  user-bound state, šifrovaný refresh credential, owner-only list a provider-first revoke.
  Full + Gmail history sync běží přes distribuovaný lease, obsah zpráv je v odděleném
  AES-GCM envelope a owner-only API nikdy nevrací surové HTML. Osobní Execution Inbox M2
  umí z konkrétní zprávy atomicky vytvořit osobní úkol a trvale drží obousměrnou provenance.
  Textový composer odesílá skutečně přes Gmail, s desetisekundovým Undo Send, Send Later,
  encrypted frontou a konečným `uncertain` stavem místo rizikového duplicitního retry.
- LuckyOS broker s odděleným bridge keyringem, tenant dedup a transakční reconciliation; reálný provider je externí prerequisite.
- Export/restore s ACL scope, checksumem, HMAC, schema verzí, dry-run, conflict módem a lokálním AES-GCM obalem.
- PWA/offline shell, šifrovaná per-user PowerSync SQLite a Centrum problémů pro odmítnuté zápisy.

### 2.2 Záměrně demo nebo nedostupné

- Mail je částečně skutečný a částečně demo. Permanentní `MailDemoBanner` je povinný na všech vstupních plochách, dokud nejsou hotové týmové cesty. Gmail OAuth, credential vault, šifrovaný inbound sync, osobní inbox a textový send jsou skutečné; týmové schránky stále používají seed a IMAP, odchozí přílohy i týmové odesílání ještě produkční nejsou.
- AI meeting extraction bez klíče je dostupná pouze v non-production ukázkovém režimu a musí být označena `mock`. Produkce bez klíče vrací 503.
- LuckyOS canned data lze zapnout pouze mimo produkci. Produkce bez base URL vrací 503.
- E-mail reminder není totéž co produkční Mail M1: provider potvrzuje přijetí k odeslání,
  ne doručení do cílové schránky. Bez konfigurace nebo po osobním revoke write path fail-closed odmítá.

### 2.3 Technická architektura

| Vrstva | Technologie | Autorita |
|---|---|---|
| Web | React 19, TypeScript, Vite, TanStack, i18next | prezentační a lokální optimistic stav |
| Offline DB | PowerSync + šifrovaná per-user wa-sqlite | cache/outbox, nikdy finální RBAC autorita |
| API | Hono + Better Auth + Zod | auth, policy, command orchestrace |
| Databáze | PostgreSQL + Drizzle | tenant, constrainty, transakce, audit |
| Sync | PowerSync buckets + strict write registry | distribuce dat a upload envelope |
| AI | Anthropic přes server policy | default-deny, explicitní consent |
| Notifikace | Web Push/Resend adapter + DB leases/state | provider potvrzuje push doručení nebo přijetí e-mailu |

Klíčové adresáře:

- `apps/web/src/lib/powersync/` — lokální schema, connector, per-user DB a recovery.
- `apps/api/src/powersync.ts` — write registry, CAS, RBAC, audit a reference validation.
- `apps/api/src/meetings.ts` — meeting commandy a content ACL.
- `apps/api/src/taskCommands.ts` — atomický delete/restore.
- `apps/api/src/export.ts` — export/restore kontrakt.
- `packages/db/src/schema/` a `packages/db/drizzle/` — skutečné invarianty a forward migrace.
- `scripts/ci-api-integration.sh` — autoritativní lokální integrační gate.

## 3. Diferenciální re-audit: co se změnilo a zda je to lepší

| Původní stop-ship nález | Stav 2026-07-15 | Důkaz / přísná poznámka |
|---|---|---|
| P0-01 falešné prázdné stavy při loadingu | Opraveno | jednotný trust-state model, readiness gates a browser důkaz cold/offline/reconnect stavů |
| P0-02 Quick Add zahazoval recurrence/days | Opraveno | insert builder test + 321/321 corpus |
| P0-03 identity sdílely jednu lokální DB | Opraveno | per-user encrypted DB, account cleanup a key endpoint test |
| P0-04 odmítnuté sync operace mizely | Opraveno | dead-letter + retry/open/resolved test; complete až po persistence |
| P0-05 slabé RBAC | Opraveno | project/workspace policy, last-admin/manager invarianty, integrační sada |
| P0-06 PUT přepisoval existující řádek | Opraveno | CREATE conflict 409, idempotency receipt, stale PATCH 409 |
| P0-07 neatomické multiwrites | Opraveno pro kritické toky | meeting, task delete/restore, LuckyOS, manual gate, invite commandy |
| P0-08 Mail klamal | Opraveno jako demo kontrakt | permanentní banner + claims regression; reálný Mail stále program |
| P0-09 reminder lhal o doručení | Opraveno | pending/retry/dead state machine; e-mail fail-closed |
| P0-10 audit byl best-effort | Opraveno | audit ve stejné transakci, before/diff/requestId |
| P0-11 auth nebyla produkční | Výrazně opraveno | invite-only, real mailer gate, TOTP, recovery rotation, privileged 2FA |
| P0-12 lokální data/klíče slabé | Opraveno pro pilot | encrypted SQLite, AES-GCM export, oddělené rotující keyringy 0600 |
| P0-13 transcript ACL příliš široká | Opraveno | participant/invite ACL; admin bez pozvání 403 |
| P0-14 záloha bez restore | Opraveno aplikačně | signed export, dry-run/apply, encrypted wrapper, restore drill test |
| P0-15 DB nevynucovala invarianty | Opraveno | migrace 0030–0039 a negativní DB testy |
| P0-16 perimeter/supply chain | Opraveno z velké části | CSP, safe errors, rate limits, SHA-pinned CI, Dependabot; aktuální registry audit čistý |
| P0-17 320 px a a11y | Opraveno pro Chrome matrix | 0 lint warnings, 105 TSX kontrakt; 90 light + 30 dark axe průchodů, keyboard a 200% zoom |
| P0-18 chyběly testy/observabilita | Opraveno | request ID, timing, readiness, rozsáhlé DB/API testy |

### 3.1 Nové nálezy druhého auditu — všechny implementované

#### A2-01 — čas bez IANA zóny a DST drift

Před opravou se například `2026-07-15 09:30` posílalo jako text bez offsetu. PostgreSQL ho mohl uložit jako UTC a UI pak po syncu četlo prvních pět znaků času, takže skutečný okamžik a zobrazený čas nebyly stejná veličina. Stejná chyba byla v Quick Add, Add Task, detailu, kalendářovém move/resize, recurrence projekci, duplikaci a follow-up meetingu.

Oprava:

- `tasks.start_timezone varchar(64)` a párový CHECK se `start_date`;
- migrace `0039_task_start_timezone.sql` s atomickým backfillem 21 řádků;
- `Intl` validace skutečné IANA zóny na command/write path;
- jednotné helpery pro wall-clock ↔ instant;
- striktní odmítnutí neexistujícího jarního času;
- deterministicky dřívější instant při podzimní dvojznačnosti;
- automatické recurrence posunutí na první validní minutu přes DST mezeru;
- PowerSync schema, registry a bucket rozšířené o `start_timezone`.

Důkaz: 9 timezone regresních kontrol, DB pair/format testy, meeting command test a 0 orphan/missing zone po migraci.

#### A2-02 — produkční mock data

`LUCKYOS_MOCK=1` a meeting mock extraction nebyly explicitně omezeny na non-production. Oprava je fail-closed: `NODE_ENV=production` canned LuckyOS nikdy nezapne a meeting extraction bez skutečného provideru vrací 503.

#### A2-03 — supply-chain mutabilita

CI používalo pohyblivé action tagy. Workflow nyní má globální `contents: read`, checkout bez persist credentials a immutable SHA pro checkout v6.0.3, setup-node v6.5.0 a pnpm/action-setup v6.0.9. Dependabot kontroluje npm i GitHub Actions týdně.

#### A2-04 — neomezené externí requesty

Resend, LuckyOS, upload a Anthropic cally dostaly explicitní timeout, omezený retry a kontrolované 502/504. Timeout není vydáván za business úspěch.

#### A2-05 — PWA/bundle bez rozpočtu

Build nyní selže nad 350 KiB gzip pro největší JS a nad 5.5 MiB offline precache. PWA precachuje jen potřebný encrypted async SQLite WASM. Aktuálně 328 KiB a 5,180 KiB.

#### A2-06 — blokovaný Web Storage mohl rozbít UI

Přímé přístupy byly sjednoceny přes safe storage wrapper; plný, zakázaný nebo nedostupný storage degraduje na session/in-memory stav.

#### A2-07 — neúplná obnova 2FA

Nastavení nyní umí po ověření bezpečně otočit recovery kódy. DB test potvrzuje, že nová sada není uložena čitelně.

#### A2-08 — tichý no-op recurrence drag

První úplná vertikála je dokončená: drag základního i virtuálního výskytu otevře
serverový preview diff, respektuje IANA/DST a Focus/dostupnost, atomicky uloží výjimku
a nabídne 15minutové undo. PowerSync promítá stabilní identitu zdrojového výskytu i
nové cílové datum. Rozsahy „tento a další“ a „celá řada“ zůstávají explicitně
nedostupné, dokud nedostanou vlastní bezpečný model segmentů série.

## 4. Bezpečnostní model po opravách

### 4.1 Silné stránky

- Invite-only registrace je serverová a platí i pro magic link/Google cestu.
- Privilegované zápisy mohou v produkci vyžadovat TOTP; recovery kódy lze rotovat.
- Session, backup, PowerSync a LuckyOS používají oddělené compromise domains.
- PowerSync/LuckyOS private keyringy mají 0600, rotaci current/previous a odlišné `aud`/`iss`.
- Sync write používá tabulkový/sloupcový allowlist, role policy, tenant reference validation, CAS a idempotency.
- Meeting transcript není součástí plošného workspace bucketu.
- HTML composer prochází allowlist sanitizerem; href povoluje jen http/https/mailto a přidává `noopener noreferrer nofollow`.
- CSP, security headers, request ID, safe error mapping a distribuovaný rate limit jsou zapnuté.
- AI policy je default-deny, vyžaduje user consent, redactuje e-mail/telefon, kvótuje a audit neukládá vstup.
- Export je ACL-scoped, podepsaný a lokálně šifrovatelný PBKDF2-SHA256 310k + AES-256-GCM.

### 4.2 Co bezpečnostně ještě není možné prohlásit

- Aktuální lokální `pnpm audit --prod --audit-level high` je čistý; release musí výsledek reprodukovat jako CI artifact nad stejným lockfilem.
- Bez produkčního nasazení nelze potvrdit TLS termination, proxy trust, secret store, log redaction a retention.
- Aplikační export není náhradou PostgreSQL PITR.
- Offline plaintext transcript je nyní v šifrované DB, ale kompromitovaný přihlášený profil/zařízení jej stále může číst.
- Reálný Mail potřebuje OAuth token vault, provider scopes, webhook verification, malware scan, attachment object store a audit doručení.
- Reálný LuckyOS/STT/AI provider potřebuje DPA, EU residency rozhodnutí, rotaci credentialů a revoke drill.

## 5. Top 10 designových vylepšení

Každý bod je samostatná issue s měřitelným acceptance gate; nejde o svolení k redesignu všeho najednou.

1. **Jednotná vrstva důvěryhodných stavů.** Komponenta pro loading/empty/offline/stale/syncing/rejected/permission/demo. Žádná obrazovka nesmí skládat vlastní nekompatibilní copy. Gate: Storybook nebo vizuální katalog + všechny stavy testované.
2. **Mobilní task card podle priorit informací.** Název a stav vždy, termín/deadline/priorita druhá řada, projekt/lidé až třetí; žádné horizontální odřezání na 320 px. Gate: 320/360/390 a 200% zoom.
3. **Rozdělit Nastavení na routy.** Profil, Tým, Zabezpečení, Data a zálohy, Integrace, Notifikace, Vzhled. Deep link pro 2FA musí otevřít přesnou sekci.
4. **Konzistentní mobilní navigace.** Jedna primární spodní lišta, jasné „Více“, zachovaný kontext a žádná jiná navigační taxonomie uvnitř Mailu.
5. **Jeden modal/drawer/popover primitive.** Focus trap, restore focus, Esc, backdrop, scroll lock, nested layer a ARIA z jediné knihovny. Odstranit ruční overlay implementace postupně.
6. **Sémantické design tokeny.** `surface`, `text`, `danger`, `warning`, `success`, `focus`, `disabled`, density a motion; ne nové ad-hoc barvy. Gate: kontrast AA ve světlém i tmavém režimu.
7. **Definice KPI přímo v UI.** Reporty a Velín musí u čísla uvést scope, období, timezone, excluded data a freshness. Tooltip není dostačující pro zásadní omezení.
8. **Explicitní edit/save/conflict režim.** U delších formulářů autosave stav, poslední potvrzení, lokální změna a konflikt; žádné neviditelné uložení po blur bez feedbacku.
9. **Progressive disclosure.** Create flow ukazuje jméno/projekt/termín; recurrence, deadline, flow, barva a pokročilé přiřazení až na vyžádání. Power funkce zůstávají dostupné klávesnicí.
10. **Recovery-first UX.** Centrum problémů sjednotí rejected sync, stale write, provider timeout, restore a retry. Každá chyba má „co se stalo / co zůstalo bezpečné / co může uživatel udělat“.

## 6. Top 10 nových funkcí, které udělají Watson lepší

1. **Watson Radar dopadů.** Vysvětlitelně propojí deadline, blokery, absenci, meeting decision a kapacitu; vždy ukáže zdroje a míru jistoty.
2. **Pravidlový automatizační engine.** Trigger/conditions/actions, dry-run, idempotency key, audit a undo; žádný libovolný serverový kód.
3. **Dependency graph úkolů a projektů.** Explicitní `blocks/blocked-by`, cycle constraint, critical path a dopad skluzu.
4. **Kapacitní what-if plánování.** Pracovní hodiny, absence a odhady; porovnání scénářů bez automatického přepsání plánu.
5. **Plný meeting lifecycle.** Agenda template, pre-read, rozhodnutí, action items, follow-up SLA, series analytics a explicitní invite ACL.
6. **Reálný bezpečný Mail.** Provider adapter, OAuth vault, per-mailbox scope, verified send/delivery, attachments a audit. Demo se odstraní až po E2E provider důkazu.
7. **AI návrhy s provenance.** Každý návrh má citaci zdroje, model/policy, confidence, accept/edit/reject a nikdy se neprovede bez člověka.
8. **Decision log.** Rozhodnutí napříč meetingy/projekty s vlastníkem, datem účinnosti, revizí a vazbou na úkoly.
9. **Verzované šablony.** Projekty, meetingy, seznamy a postupy se schema verzí, migrací instance, diffem a rollbackem.
10. **Portfolio health.** Trend, confidence a vysvětlitelný risk pro cíle/projekty; žádné neprůhledné „AI score“.

## 7. Top 10 funkcí, které udělají Watson praktičtější

1. **Uložené pohledy.** Filtr, řazení, sloupce, density a scope; osobní nebo týmové, s jasným vlastníkem.
2. **Bulk preview a bezpečné hromadné změny.** Předem přesný počet, recurrence scope, konflikty, atomický command a jedno undo batch ID.
3. **Univerzální quick switcher.** Lidé, projekty, úkoly, meetingy a příkazy; permission-filtered, poslední položky lokálně v šifrovaném store.
4. **Pracovní hodiny, svátky a snooze.** Per-user timezone/locale, quiet hours a plán reminderů bez posunů přes DST.
5. **Import wizard.** CSV/Asana/Trello/Todoist s mapováním, validačním preview, dry-runem, idempotentním import ID a rollbackem.
6. **Offline outbox s ruční kontrolou.** Co čeká, co se retryuje, co server odmítl, diff a možnost opravit bez ztráty vstupu.
7. **Voice inbox.** Lokální nahrání, explicitní upload consent, STT adapter, editovatelný přepis a teprve pak create.
8. **Denní digest.** Přesný zdroj a freshness, quiet hours, opt-in kanály a deep link na konkrétní problém.
9. **Rychlá práce z notifikace.** Done, snooze, delegate a open; serverový command, idempotence a permission recheck.
10. **Editor výjimek recurrence.** „Jen tento / tento a další / celá řada“, přesun data/času, DST policy, diff preview a undo. Tím se nahradí současné transparentní omezení drag occurrence.

## 8. Release blokátory a externí prerequisite

Tyto body nesmí být označeny jako hotové bez skutečného důkazu. Nejsou omluvou k obcházení gate.

### R-01 — runtime UI/a11y/E2E důkaz

Browser plugin stále končí chybou `Cannot redefine property: process`, proto je
release kontrola nezávislá na pluginu: `pnpm verify:runtime-a11y` spouští persistentní
Playwright Chromium + WebKit 26.5 matrix nad přihlášeným, synchronizovaným účtem.
Pokrývá 15 hlavních rout × 390/1440 px × light/dark × oba enginy, tedy 120 průchodů
s emulovaným reduced motion. Axe po opravách vrací nula WCAG A/AA nálezů; matrix má
nula horizontálních overflow, chybějících `main` i runtime chyb. Klávesový scénář
v obou enginech ověřil otevření dialogu Enterem, 14krokový focus trap, Escape s
návratem focusu, otevření mailového vlákna Enterem a ovládání split separatoru
šipkou. Domov, Mail a Nastavení prošly ekvivalentem 200% reflow při 720 CSS px.
Lokální sanitized artifact je uložen v `docs/release-evidence/runtime-a11y-2026-07-16.json`.
Navazující `pnpm verify:release-e2e` v Chromium i WebKitu prošel skutečným heslovým
přihlášením izolovaného uživatele, prvním šifrovaným syncem, vytvořením úkolu po
odpojení sítě, důkazem že server zápis offline neviděl, uploadem po reconnectu,
editací názvu a termínu s DB round-tripem, trvale odmítnutým zápisem, jeho durable
recovery záznamem, potvrzeným zahozením a úspěšným retry s idempotency receiptem.
Stejný scénář ověřuje, že globální trust-state okamžitě přizná offline cache,
po reconnectu stale stav odstraní a odmítnutou změnu trvale zpřístupní z každé
routy. Oba kritické stavy jsou axe-clean a bez horizontálního overflow na 390 px.
Stejný běh ověřil UI enrollment TOTP, rotaci šifrovaných recovery kódů, plánování
porady, vložení holého transkriptu, skutečné provider AI zpracování pod explicitní
workspace politikou, review akce a rozhodnutí, commit do task/Decision Log vrstvy,
šifrovaný export, dry-run obnovy a auditovaný restore. Add Task, Task Detail i
meeting plan/review prošly WCAG A/AA axe kontrolou; artifact je v
`docs/release-evidence/release-e2e-2026-07-16.json`. Audit odhalil a opravil aktivně
vypadající submit bez načteného projektu, chybějící přístupné názvy v detailu a
meeting formulářích, kontrast utlumených meeting sekcí a globální reduced-motion
mezeru pop-in animací. R-01 je v podporovaném browser matrixu uzavřený. Nativní
Safari WebDriver nebyl použit, protože na hostiteli není povolená vzdálená
automatizace; podporovaný WebKit engine je zelený.

Acceptance:

- Chrome/Safari nebo podporovaný matrix;
- 320, 360, 390, 768, 1024, 1440 px;
- keyboard-only, 200% zoom, reduced motion, light/dark;
- sign-in, create/edit/move task, offline/reconnect, rejected sync recovery, meeting plan/transcript/commit, 2FA a backup/restore;
- axe: 0 critical/serious; žádný focus loss nebo keyboard trap.

### R-02 — dependency advisory evidence

Reprodukovatelný `pnpm verify:dependency-audit` dne 2026-07-16 registry úspěšně kontaktoval, zapsal sanitizovaný report svázaný se SHA-256 aktuálního lockfile a vrátil nula high/critical advisories. Lokální evidence je v `docs/release-evidence/dependency-audit-2026-07-16.json`. CI stejný blokující runner spouští a report archivuje přes immutable-pinned `upload-artifact`; R-02 lze úplně uzavřít až po prvním skutečně uchovaném CI artifactu.

Acceptance: úspěšný CI artifact se seznamem advisories; high/critical = stop-ship nebo explicitní časově omezená výjimka s kompenzační kontrolou.

### R-03 — produkční provoz

Acceptance: TLS/HSTS, secret manager, backup key rotation, log redaction/retention, alerting, error budget, staging parity, runbook a rollback drill.

### R-04 — PostgreSQL DR

Acceptance: skutečný PITR test na izolované instanci, změřené RPO ≤15 min a RTO ≤2 h, obnovovací protokol a kontrola tenant/ACL po restore.

### R-05 — reálné integrace

- Mail provider + token vault + verified delivery.
- LuckyOS credentials, contract test a revoke/failure drill.
- AI/STT provider DPA, budget a EU/data residency rozhodnutí.
- Attachment object store, scan a retention.

## 9. Sólo implementační plán

Pořadí je závazné. Jedna epika aktivní, další nezačíná před acceptance gate.

### F0 — uzavřít release evidence (2–4 dny)

1. Udržet kritické release E2E scénáře R-01 zelené; Chromium + WebKit axe/keyboard/reflow, task/offline recovery, 2FA, meeting commit a backup/restore jsou hotové.
2. Udržet dependency audit R-02 zelený; runner, lokální evidence i CI upload jsou hotové, první uchovaný CI běh zůstává release podmínkou.
3. Opravit každý runtime nález stejnou vertikální disciplínou.
4. Znovu spustit celý gate a uložit artifacty.

Exit: žádný critical/serious a11y nález, žádný high/critical advisory bez schválené výjimky, všechny hlavní cesty E2E zelené.

### F1 — provozní základ a DR (1–2 týdny)

1. Staging konfigurace se skutečnými produkčními defaulty (`NODE_ENV=production`, mocky off).
2. Secret manager a key rotation runbook.
3. PostgreSQL PITR, restore drill a alerting.
4. SLO zdroj je implementovaný: fail-closed `/ops/slo` dává readiness, 5xx, auth failure, sync rejection, reminder dead a provider timeout. Produkční dashboard/alert routing se musí napojit podle `ops/observability/RUNBOOK.md`.

Rollback: aplikace zůstane invite-only; při nesplněném DR se pilot nerozšíří.

### F2 — UX konsolidace (2–3 týdny)

Pořadí: trust-state primitive → overlay primitive → Nastavení routes → mobile card/nav → KPI definitions.

1. **Trust-state primitive — dokončeno 2026-07-17.** Jediný stavový model rozlišuje
   inicializaci, první sync, aktivní upload/download, potvrzený checkpoint, reconnect,
   offline cache, cold offline start, transportní chybu a durable rejected writes.
   `connected` už nikdy samo nevytvoří tvrzení „Synchronizováno“. Desktopový sidebar,
   mobilní shell, KPI freshness, první data gate a Centrum problémů sdílejí stejnou
   pravdu. Offline/no-cache místo falešného empty stavu vysvětlí nedostupnost; stale
   data nesou locale-aware checkpoint. Browser test ověřuje offline/reconnect,
   odmítnutou změnu, 390px reflow a axe v Chromium i WebKitu. Vizuální audit navíc
   odstranil duplicitní rejected toast, opravil kontrast akce, umístil toast nad
   mobilní navigaci a rozdělil mobilní header do stabilních dvou řádků.
2. **Overlay primitive — dokončeno 2026-07-17.** Modaly a drawery používají jediný
   focus trap, inert pozadí, referenčně počítaný scroll lock, návrat fokusu a
   topmost Escape. Nemodální popovery a kontextová menu sdílejí stejný pořadník,
   ale stránku správně neinertují. Sémantická z-index stupnice nahradila náhodná
   globální čísla; statický kontrakt zakazuje návrat starého focus trapu i druhý
   body scroll lock. Těžké detaily úkolu a projektu jsou lazy-loaded.
3. **Nastavení routes — dokončeno 2026-07-17.** Jediná routa zachovává všechny
   funkční formuláře, ale URL-validované `?sekce=` dělí povrch na Profil, Tým,
   Zabezpečení, Data a zálohy, Integrace a poštu, Oznámení a Vzhled. Kontextové
   vstupy vedou rovnou do správné sekce; staré hash odkazy se bezpečně převádějí.
   Desktop má sticky lokální navigaci, mobil 44px horizontální přepínač a profilová
   karta se na úzkém displeji skládá bez ořezu. Menu rolí používá sdílenou popover
   vrstvu a vrací fokus po Escape.
4. **Mobilní karta a navigace — dokončeno 2026-07-17.** Existující task actions,
   jediná primární spodní lišta a Mail bez druhé navigační taxonomie zůstaly zachované.
   Karta má na dotyku bezpečné akce v titulním řádku, metadata pod názvem a projektový
   kontext až ve třetí úrovni. „Více“ je scrollovatelný modální sheet se všemi moduly,
   prostory, focus trapem a návratem fokusu; aktivní cíle jsou oznámené a 320px popisky
   se neořezávají. Statický kontrakt brání návratu duplicitní lišty a browser audit
   pokrývá 320/360/390 px v Chromium i WebKitu.
5. **Definice KPI — dokončeno 2026-07-17.** Reporty i Velín u každé hlavní metriky
   přímo zobrazují rozsah, období, IANA časovou zónu, vyloučená data, čerstvost a
   přesný výpočet; zásadní omezení nejsou schovaná v tooltipu. PowerSync čísla
   používají potvrzený checkpoint, zatímco Mail otevřeně přiznává lokální demo bez
   provider synchronizace. Urgentní Mail KPI se počítá z celého aktivního inboxu,
   ne jen z top-8 náhledu; týmové unread KPI vylučuje osobní, uzavřená, spamová,
   archivovaná, smazaná, odložená a ztlumená vlákna bez rozbití osobního badge.

Acceptance: vizuální regression snapshots, keyboard/axe gate, žádná změna doménové logiky bez testu.

### F3 — practical core (3–5 týdnů)

Pořadí: saved views → outbox UI → bulk preview/command → recurrence exception editor → working hours/timezone settings.

Datové závislosti:

- recurrence exceptions potřebují nové schema, scope a CAS; nepřetěžovat `done/skipped` sloupce nekompatibilním JSONem;
- timezone setting musí validovat `Intl`, migrovat budoucí plány explicitním preview a nikdy neměnit `due_date`;
- bulk command musí vracet batch ID pro undo a per-item rejection report.

Stav dávky:

1. **Saved views, bulk preview/undo a pracovní zóna — zachováno po auditu.** Existující
   řešení už má striktní roundtrip filtrů, dávkový preview/undo kontrakt a IANA/DST
   testy; F3 je nebude přepisovat. Další změna smí pouze doplnit doloženou mezeru.
2. **Recovery-first outbox — dokončeno 2026-07-17.** Data a zálohy ukazují veřejnou
   PowerSync upload frontu, počet/velikost, pravdivý offline/upload/empty stav a lidský
   redigovaný diff. Čekající změny jsou pouze pro čtení; potvrzení a odstranění zůstává
   výhradně connectoru. Durable odmítnuté zápisy mají diff, otevření objektu, retry,
   kopii technického detailu a vědomý discard. Citlivá pole se nikdy nevypisují.
   Chromium i WebKit dokazují offline create, kontrolu fronty při 390 px, reconnect,
   odmítnutí, retry/discard, axe, reflow a autoritativní serverový výsledek.
3. **Recurrence exception editor / všechny tři rozsahy — dokončeno 2026-07-17.**
   Migrace 0060 rozšířila per-occurrence override o cílové datum, skutečný instant,
   IANA zónu, délku a verzi; dokončení/přeskočení zůstává samostatný kompatibilní stav.
   Migrace 0061–0064 přidaly konečné prefixy původní řady pro „tento a další“, striktní
   allowlist pravidel, nullable autora se `SET NULL` a DB zákaz překryvu segmentů.
   Aktivní task se neklonuje:
   komentáře, přílohy a dependency zůstávají na jediném ID a dřívější výskyty se
   promítají jako auditovatelná část stejného úkolu; samostatně je lze dál přesunout.
   Strukturální undo fail-closed odmítne přepsat jejich pozdější změny. Rozsah „celá aktivní řada“ posune
   kotvu i pravidlo; existující oddělenou historii nemění. Strukturální změna se
   fail-closed zastaví, pokud by přepsala budoucí výjimky nebo překročila deadline.
   Preview, execute a undo jsou serverové commandy s ACL, advisory lockem, idempotency,
   stale-preview kontrolou, CAS, auditem a 15minutovým undo batch ID. Klient používá
   jeden materializer v Kalendáři, Dnes, Nadcházející i detailu. Chromium a WebKit
   ověřily všechny tři rozsahy přes drag → dialog → server save → PowerSync projekci
   → undo, mobilní reflow, focus trap a axe. Export/restore segmenty skutečně obnoví.

### F4 — integration center (2–4 týdny)

Provider registry, health, scopes, last success, last error, revoke, test connection a audit. Začít LuckyOS, poté reminder e-mail/attachments. Mail až samostatně.

Stav dávky:

1. **Provider registry + LuckyOS health/lifecycle — dokončeno 2026-07-17.**
   Existující LuckyOS broker nebyl nahrazen: dostal server-only osobní registry bez
   credentialů, deklarované scopes/capabilities, pravdivý configured/demo/degraded/
   revoked stav, poslední test/úspěch/chybu a bezpečný allowlist error kódů. Test
   validuje nejen HTTP, ale i runtime kontrakt identity; vadný payload se nikdy
   nevrací klientovi. Revoke/reconnect jsou CAS, idempotentní, rate-limitované a
   auditované; revoke před vydáním bridge tokenu uzavře čtení, formuláře i upload.
   DB triggery vynucují osobní tenant scope, vlastnictví receiptů a konzistenci
   revoked/error stavu. Chromium i WebKit ověřily scopes, test, inline potvrzení,
   serverové odpojení, perzistenci, reconnect, 390px reflow a axe. Mail zůstává
   pravdivě označený jako demo a přechází až do samostatného F5 programu.

2. **Reminder e-mail + task attachment health — dokončeno 2026-07-17.**
   Resend adapter je společný pro auth a remindery, ale reminder má vlastní odesílatele,
   per-user revoke/reconnect, safe error allowlist a stabilní idempotency key. Worker
   claimuje push i e-mail přes stejný `SKIP LOCKED` lease, respektuje Focus/snooze,
   trvalé 4xx ukončí bez marných retry a `sent` zapíše až po validním ACK s provider ID.
   PowerSync přijme `channel=email` jen při nakonfigurovaném a povoleném provideru.
   Vestavěné úložiště skutečných task příloh nebylo nahrazeno; Integration Center mu
   přidal redigovaný health/scopes test. Falešné přepínače Oznámení byly odstraněny:
   digest je pravdivě „zatím neaktivní“ a osobní remindery odkazují na nastavení u úkolu.
   Lokální Resend stub dokazuje malformed ACK, žádný upstream leak, worker ACK, CAS,
   tenant izolaci a revoke; Chromium/WebKit ověřily tři provider karty, mobil a axe.

### F5 — reálný Mail (8–12 týdnů; samostatný program)

1. Provider adapter a OAuth vault.
2. Inbound sync/webhook verification a idempotence.
3. Per-mailbox ACL a encrypted local partition.
4. Outbound send command, provider message ID a delivery states.
5. Attachments, malware scan, object retention.
6. Audit, export/delete, incident/revoke runbook.
7. Teprve po E2E důkazu odstranit demo banner a seed claims.

První bezpečnostní základ dokončen 2026-07-17: osobní `mail_accounts`, oddělený
`mail_account_credentials` envelope bez plaintext sloupců, rotovatelný AES-256-GCM
keyring, account/owner/provider AAD, produkční startup/preflight gate a DB triggery pro
osobní tenant scope i shodu credential/provider. Odesílání ještě není hotové;
permanentní Mail demo banner proto záměrně zůstává.

Gmail account lifecycle dokončen 2026-07-17: dedikovaný mail OAuth klient (oddělený od
loginu), PKCE S256, v DB pouze SHA-256 state, user-bound jednorázový callback s expirací,
šifrovaný PKCE verifier, přesná kontrola scope `gmail.modify`, encrypted refresh token,
owner-only account list, reconnect se stabilním account ID a provider-first idempotentní
revoke s CAS/auditem. Osobní správa je v Nastavení → Pošta; týmová administrace ji
nevystavuje. API E2E ověřuje state binding/replay, tenant izolaci, malformed provider,
revoke/reconnect a ciphertext; Chromium i WebKit ověřují dialog, mobilní reflow a WCAG.
Veřejné produkční spuštění navíc vyžaduje doloženou Google OAuth verifikaci a případné
security assessment pro restricted Gmail scope.

Inbound Gmail sync a osobní read-only inbox dokončeny 2026-07-17: stránkovaný bounded full sync, následný
`historyId` incremental sync, minutový fallback poll bez závislosti na push notifikaci,
automatický nový full generation po 404/expired history, CAS refresh access tokenu,
`SKIP LOCKED` lease/retry/dead/reauth state machine a generation-based reconciliation.
Předmět, adresy, snippet, těla i metadata příloh jsou autentizovaný ciphertext pod
odděleným HMAC-derived content subkey; v clear indexu zůstávají jen opaque provider ID,
čas, system label ID a velikost. Owner-only cursor API vrací plaintext text až po
autorizaci, nikdy surové HTML; revoke po provider ACK fyzicky maže credential, cursor i
obsah. Web slučuje skutečné osobní účty nad tímto API, zobrazuje reálné počty a tělo
dešifruje až po otevření zprávy; nic z obsahu neukládá do nešifrovaného browser storage.
Chromium i WebKit dokazují celý OAuth → sync → list → detail tok, řízené selhání,
390px reflow a axe bez A/AA nálezů. Týmové seed UI je stále demo, proto se
banner změnil jen na „částečně demo“ a nesmí se odstranit.

Osobní outbound M1 dokončen: textový composer ukládá příjemce, předmět a tělo pouze do
AAD-vázaného AES-GCM envelope. Okamžitý send má desetisekundové Undo okno, Send Later
zůstává vratný do claimu a paralelní workery používají `SKIP LOCKED`. Gmail ACK je bounded
a validovaný; stabilní Watson `Message-ID` dovoluje zopakovat jen jednoznačné 429. Timeout,
5xx, vadný 2xx ACK nebo expirovaný sending lease končí jako `uncertain` bez automatického
retry, protože provider mohl zprávu přijmout. Revoke zruší queued/retry a sending označí
uncertain. API + DB verifier dokazuje šifrování, owner scope, idempotenci, souběh, Send Later,
provider ACK/no-duplicate i redigovaný audit; Chromium a WebKit navíc dokazují composer,
hlídku zapomenuté přílohy, Undo, skutečné přijetí providerem, mobilní reflow a axe.

Execution Inbox M2 doplněn 2026-07-17: owner může z reálné osobní zprávy přes explicitní
preview založit skutečný úkol pouze v aktivním projektu stejného osobního workspace.
Příkaz je transakční a idempotentní: task, osobní assignment, opaque mail provenance a
redigovaný audit vzniknou společně; celý mail, přílohy ani obsah odpovědi se nekopírují
automaticky. Vazba je vidět v seznamu i detailu zprávy, ukazuje živé dokončení a task
nese kanonický deep link zpět na konkrétní owner-only mail. Smazání tasku nesmaže původ;
náhradní task vyžaduje výslovnou akci a starý link se pouze označí jako retired. DB trigger
odmítá cross-owner, cross-account i cross-workspace reference i mimo API. API verifier a
Chromium/WebKit browser flow pokrývají tenant izolaci, replay/konflikty, delete/replace,
dialog, lazy detail, přímý deep link, mobilní reflow a axe. Týmová varianta zůstává až M3.

### F6 — Radar/automation/AI (4–8 týdnů)

Nejdřív dependency graph a decision log, potom explainable Radar, poté rules engine. AI smí pouze navrhovat, dokud každá action nemá command, preview, permission recheck, audit a undo.

Kanonický Decision Log dokončen 2026-07-17: ruční zápis, označený komentář a lidsky schválený výstup vloženého přepisu porady končí ve stejné projektově izolované vrstvě. Název a zdroj jsou neměnný snapshot; oprava probíhá výslovným nahrazením, původní řádek zůstává `superseded`, odvolání je terminální. Revize používá CAS verzi, create/review mají stabilní operation receipt a paralelní nahrazení zamyká původní rozhodnutí. DB hlídá workspace/project, členství vlastníka i autora, source scope a task vazby. API stránkuje stabilním cursorem, restricted projekt neprozradí nečlenovi a audit neobsahuje titul ani odůvodnění. Meeting commit už rozhodnutí neduplikuje do popisu hubu; nejasnosti tam zůstávají. PowerSync poskytuje project-scoped offline kopii, UI v Meets umí vyhledávání, filtry, vlastníka, review date, související úkoly, deep-link, revizi, nahrazení i lokální fallback. Delete/Undo úkolu zachová historický záznam a obnoví jeho vazby. Export v3 přenáší Decision Log; podepsaný v2 export bez nových tabulek se bezpečně normalizuje a komentářová rozhodnutí doplní. API verifier pokrývá replay, souběh, tenant útoky, cursor, meeting/comment zdroje, delete/undo a redigovaný audit; Chromium i WebKit dokazují ztracenou odpověď bez duplicity, revizi, historii, deep-link, 390px reflow a axe WCAG A/AA.

Explainable Radar dokončen 2026-07-17: Velín dostal živý read model `radar:v1`, který skládá riziko konkrétní práce z termínu, nedokončených blockerů, nemožného pořadí, skutečných časových kolizí, absence/Focus Time, chybějícího řešitele a revize rozhodnutí. Každý signál zveřejňuje váhu, fakt/projekci, zdroj a lidské vysvětlení; score je přesný součet do 100 a nikdy nepatří člověku. Odmítnutý kapacitní součet ani employee productivity score nevznikly. Endpoint je leadership-only, ale ani workspace admin nevidí projekt bez project membership; private label nedostupnosti se vůbec nenačítá, odpověď je `no-store`, rate-limitovaná a při limitu přizná částečné pokrytí. UI filtruje stupně, ukazuje okamžik výpočtu, poctivý error/empty/partial stav a vede přesný deep-link na úkol nebo zvýrazněné rozhodnutí. API verifier dokazuje redakci, scope, timezone, blokace, kolize, meeting decision a přesný rozklad skóre; Chromium i WebKit dokazují vysvětlení, filtr, decision deep-link, 390px bez overflow a WCAG A/AA.

Rules & Automation Engine v1 dokončen 2026-07-17: projektová pravidla mají oddělený měnitelný draft, explicitní Preview a neměnné publikované verze; každý běh je připnutý ke konkrétní verzi. V1 reaguje na vytvoření/dokončení/znovuotevření úkolu, umí AND podmínky nad prioritou, deadlinem a řešitelem a atomicky mění prioritu/plánované datum nebo přidá komentář. Worker deduplikuje `(version,event)`, ignoruje vlastní systémové audity a před každým během znovu ověří oprávnění autora publikace. Výsledek má redigovaný audit, historii a 24h stale-safe Undo. Pozastavení nefrontuje nové běhy. DB hlídá tenant, neměnnost verzí i stavový automat runu. UI v Postupech vysvětluje Když → A pokud → Pak, odděluje koncept od publikace a ukazuje procesní počty bez employee scoringu. API verifier pokrývá replay, CAS, pinning, atomické akce, dedup, pause, Undo a tenant útok; Chromium i WebKit dokazují create → preview → publish, focus modal, 390px bez overflow a axe WCAG A/AA. Odmítnuté přiřazování podle role/vytížení a SLA/eskalace zůstávají mimo scope.

### F7 — Employee Hub, LuckyOS a znalostní vrstva

Employee Hub core dokončen 2026-07-17: existující Watson ↔ LuckyOS broker nebyl nahrazen.
Přibyl owner-only online povrch „Můj zaměstnanecký přehled“ se stavem připravenosti,
blokacemi, chybějícími dokumenty, termíny, DPP limitem a oznámeními. LuckyOS zůstává
jedinou účetní a personální autoritou; citlivý stav se neukládá do PowerSync ani browser
storage a každá Employee odpověď je `private, no-store`. Server validuje provider identitu
i status a vrací pouze explicitní allowlist projekci; neznámá metadata, provider e-mail,
interní ID pravidel a absolutní odkazy se redigují. Modul, sidebar, mobilní nabídka i karta
„Můj stav“ na Přehledu se zobrazí pouze po skutečném `linked=true`.

Akční LuckyOS notifikace lze výslovně převést do osobního projektu „Zaměstnanec“; reconciliation
je serializovaná per user, tenant-scoped, auditovaná a přes `entity_links` idempotentní.
Informativní oznámení úkol nevytvářejí. API důkaz pokrývá session, no-store, redakci,
bezpečné relativní odkazy, provider kontrakt, task lineage a retry bez duplicity. Chromium
i WebKit ověřily gating, dashboard, sync, 390px reflow, mobilní 44px akci a axe WCAG A/AA;
ruční vizuální audit následně přeskládal mobilní hlavičku. Provozní hranice jsou v
`docs/employee-hub-runbook.md`. Dokumenty/podpisy, dovolená/absence i
onboarding/offboarding přes Postupy navazují samostatnými dokončenými F7 vertikálami;
znalostní/SOP povrch zůstává další samostatnou dávkou.

LuckyOS v1 integrační základ dokončen 2026-07-17: starý e-mailový broker zůstává
výslovným `legacy` režimem a žádný deploy ho automaticky nepřepne. V1 vydává přesný
čtyřminutový RS256 token `iss=watson`, `aud=lucky-os`, `jti`, tenant,
`watson_user_id` a nejmenší scopes bez e-mailu/person ID. Podepsaný LuckyOS outbox
má HMAC/timestamp/body limit, trvalý idempotentní inbox a server-only identitu
uživatel → provider link/osoba. DB i command vrstva odmítají cross-tenant, dvojí
napárování osoby, konfliktní verzi, stale downgrade a použití stejného klíče pro
jiný payload; nový link nahradí jen revokovaný. Odchozí adapter odvozuje person ID
výhradně z této vazby, před tokenem respektuje lokální revoke, zakazuje redirect a
limituje timeout i odpověď. Produkční preflight vyžaduje tenant a izolovaný webhook
secret. Integrační důkaz používá reálnou DB a dual-contract LuckyOS stub a pokrývá
podpis, replay, pořadí, replacement, lokální/provider revoke a přesný M2M scope.

LuckyOS v1 self-service profil + docházka + malá čísla dokončen 2026-07-17:
nový povrch je zpřístupněn jen explicitním `selfService=true`; legacy zůstává
beze změny. Browser nikdy nevolí person ID, tenant ani scopes. Profil maskuje
bankovní účet a změnu převádí na schvalovanou žádost bez vracení patch hodnot.
Docházka i malá čísla oddělují koncept od potvrzeného submitu, všechny write
commandy mají user-bound idempotency key a provider konflikty se mapují na
bezpečné kódy. Zod kontrakt a veřejné projekce zahazují neznámá provider pole i
upstream text. V1 work items se mapují do stávajícího reconciliation, takže se
nerozvětvuje původní osobní projekt Zaměstnanec. Citlivé query mají `no-store`,
krátký memory-only cache a žádný browser/offline draft. API důkaz pokrývá
redakci, replay/konflikt, budoucí datum, submit, sync a revoke; Chromium i WebKit
ověřily všechny tři formuláře, potvrzení, 390px reflow a axe WCAG A/AA.

LuckyOS v1 dokumenty + výdaje + elektronický podpis dokončeny 2026-07-17:
Watson je session-bound person-scoped facade a žádný HR soubor, účtenku, podpis
ani finální PDF neukládá do DB, PowerSyncu nebo browser storage. Server ověří
magic bytes a příponu, drží 25MB limit, spočítá SHA-256 a přes immutable upload
intent předá binární obsah do LuckyOS, které vlastní malware scan, storage,
retention i atomický finalize. Upload a doménový command mají oddělené user-bound
idempotency klíče a celý tok lze bezpečně zopakovat po ztracené odpovědi.
Publikované dokumenty se streamují s minimálním scope, response stropem, bez
redirectu a `no-store`. Výdaj má serverový CZK přepočet a může odkazovat jen na
vlastní aktivní trenérský projekt. Podpis je připnutý na verzi smlouvy a vyžaduje
identity challenge, PNG/JPEG podpis, výslovný souhlas i druhé potvrzení; finální
PDF a neměnný audit vytváří LuckyOS. Náhled se nabídne pouze pro publikované PDF
se stejným názvem i verzí smlouvy; chybějící obsah se poctivě přizná a metadata se
nevydávají za přečtenou smlouvu. API důkaz pokrývá redakci provider metadata,
upload/replay, výdaj, challenge, podpis a revoke; Chromium i WebKit pokrývají
retry, dokument, výdaj, podpis, 390px reflow a axe WCAG A/AA.

LuckyOS v1 dovolená a absence dokončena 2026-07-17: zaměstnanec odesílá
striktní, idempotentní `absence` case do LuckyOS; Watson ukládá jen minimalizovanou
kalendářovou projekci bez poznámky nebo HR detailu. `pending` je týmově viditelný,
ale neblokuje plánování, Nerušit ani Radar; až LuckyOS `resolved` podepsaným
eventem přepne projekci na `approved`. Event vždy znovu načte autoritativní
person-scoped cases, ověří alespoň eventovou verzi a při zpoždění read modelu vrátí
retryable 503. API důkaz pokrývá obrácené období, překryv, retry, izolaci osoby,
projekci do více workspace, pending vs. strict plánování i redakci poznámky. Chromium
i WebKit ověřily ztracenou odpověď se stabilním operation ID, explicitní potvrzení,
desktop, 390px, 44px mobilní cíle a axe WCAG A/AA. Produkční build, celý gate a úplná
API integrační sada jsou zelené; ruční screenshot audit nenašel overflow ani nečitelný stav.

LuckyOS v1 onboarding/offboarding přes Postupy dokončen 2026-07-17: LuckyOS je
jediný HR system of record a Watson nevytváří duplicitní `chains`, tasky ani kopii
odpovědí. Online facade čte onboarding/offboarding oddělenými minimálními scopes,
validuje celý provider kontrakt a zveřejňuje pouze název, allowlistované kroky,
stav, termín, progres a verzi. Employee Hub umí výslovně potvrdit, doplnit text či
údaj, udělit souhlas, položit otázku, odmítnout nebo přes zabezpečený
`lifecycle_document` upload předat soubor; každý command má přesnou verzi, druhé
potvrzení a stabilní user-bound operation ID. Postupy zobrazují živý osobní progres
a vedou do stejného Employee Hubu, takže původní flow engine zůstává beze změny.
API důkaz pokrývá redakci, invalidní potvrzení, replay, konflikt idempotency a
souborový submit. Chromium i WebKit ověřily ztracenou odpověď, automatický přechod
na další krok, Postupy, desktop, 390px, lokalizovaný file picker, bez overflow a
axe WCAG A/AA. Další F7 dávka je Employee-facing Knowledge a SOP.

## 10. Detailní acceptance checklist pro budoucí funkce

Každá produkční funkce musí odpovědět ano na vše relevantní:

- Je zdroj pravdy jednoznačný?
- Je tenant odvozen serverem?
- Je role ověřena ve stejné transakci jako zápis?
- Jsou reference ve stejném workspace/projectu?
- Je CREATE odlišeno od UPDATE?
- Má retry stabilní idempotency key a payload hash?
- Co se stane při offline, timeoutu a reconnectu?
- Uvidí uživatel rejected/stale stav a může jej opravit?
- Je multiwrite atomický?
- Má DB negativní invariant?
- Obsahuje audit actor, scope, request ID, before a diff bez tajných dat?
- Je lokální cache per-user a šifrovaná, pokud obsahuje citlivá data?
- Je export/delete/retention cesta?
- Je provider stav poctivý?
- Je AI default-deny, consented, redacted a budgeted?
- Funguje klávesnice, focus, screen reader, 320 px a 200% zoom?
- Má funkce unit + integration + relevantní E2E?
- Existuje rollback nebo bezpečný roll-forward?

## 11. Aktuální automatické důkazy

Poslední ověření 2026-07-17:

- `pnpm lint`: 6 balíčků, 0 warnings/errors; accessibility contract 107 TSX.
- `pnpm typecheck`: 6/6 balíčků.
- `pnpm test`: recurrence 14/14 + 9 projekčních regresí + 6 transformací řady, Quick Add, timezone, recent items, proč-teď, deep linky,
  uložené pohledy, univerzální hledání, více připomínek, progres, závislosti,
  Waiting Room, projektové milníky, zmínky, importní CSV parser, Mail claims, chain gate, sync recovery
  a backup crypto.
- `pnpm --filter @watson/web test:corpus`: 321/321.
- `pnpm audit --prod --audit-level high` i plný `pnpm audit --audit-level high`:
  žádná známá zranitelnost v aktuálním lockfile včetně nových browser dev dependencies.
- `bash scripts/ci-api-integration.sh`: contract, Drizzle, reminders, LuckyOS reconciliation,
  DB invariants, signing keys, RBAC, sync refs/CAS/idempotency, rozhodnutí,
  komentářová spolupráce, bulk commandy, uložené pohledy, projektová přednastavení,
  závislosti, časová osa, přílohy, typovaná vlastní pole, ankety, projektové milníky,
  intake, akceptace urgentních úkolů, jednorázový import,
  dostupnost, Focus Time, snooze/reminder hold, nouzové výjimky a interní rezervace,
  meeting ACL/commandy,
  AI policy, task delete/restore, workspace policy, export/restore, manual gate,
  input/observability, rate limit a auth/2FA — vše prošlo.
- Migrace 0046: aplikována; sedm typů projektových polí i jejich task hodnoty mají
  DB validaci, ACL, audit, export/restore, delete/undo a PowerSync kontrakt.
- Migrace 0047 + dopředná oprava 0048: aplikovány; pět typů vložitelných task anket
  má stabilní option ID, jednu pojmenovanou odpověď na osobu, uzavření/znovuotevření,
  DB validaci, ACL, audit bez obsahu odpovědi, export/restore, delete/undo a PowerSync.
- Migrace 0049: aplikována; volitelné projektové milníky odvozují stav z úkolů
  (`task_completed`, `completed_count`, `all_tasks_completed`). DB guard odmítá uzavření
  i pozdější regresi cílového projektu, task reference chrání delete/move a auditovaný
  API command pokrývá ACL, idempotenci, přesné potvrzení smazání a lokalizovaný výchozí milník.
- Migrace 0050: aplikována; interní formuláře pro příjem práce vytvářejí úkol a
  neměnný snapshot otázek/odpovědí v jedné transakci. Správa respektuje projektové
  role, běžný člen smí použít týmový formulář a cizí tenant dostává fail-closed 404.
  Historie zůstává dohledatelná po smazání úkolu a undo vazbu bezpečně obnoví.
- Intake formuláře prošly 26 integračními kontrolami: ACL, typed validace, CAS,
  idempotentní create i submit/retry, same-project DB guard, archive/delete, audit
  bez obsahu odpovědí, task delete/undo a bezpečný odkaz pouze při aktuálním přístupu.
- Migrace 0051: aplikována a ověřena i kompletním během všech migrací do čerstvé
  prázdné databáze. Volitelná projektová politika vyžádá akceptaci P1 nebo P1–P2
  od každého řešitele kromě autora; systémové request/cancel události mají vlastní
  `system` actor type a dokončení bez platného přijetí blokuje autoritativní DB trigger.
- Akceptace urgentních úkolů prošla 38 integračními kontrolami: manager ACL,
  default-off a threshold policy, per-assignee lifecycle, CAS a přesný retry,
  fail-closed tenant/project přístup, DB completion guard, změna priority či řešitele,
  delete/undo, časová osa a audit bez textu soukromé poznámky. Následně prošly i
  regresní sady bulk move/undo, task delete/restore, export/restore a PowerSync kontrakt.
- Migrace 0052: aplikována a ověřena kompletním během všech migrací do čerstvé
  prázdné databáze. Import ukládá jen minimální dávkovou stopu, nikoli zdrojové CSV;
  DB vynucuje workspace/project/task/attachment scope, aktivní fingerprint brání
  duplicitě a task delete/undo i podepsaný export/restore zachovávají vazby.
- Jednorázový import CSV/Asana/Trello/Todoist prošel 35 integračními kontrolami:
  serverem filtrované cílové projekty, fail-closed ACL, stateless dry-run, tříúrovňová
  hierarchie, členové, termíny, priority, sekce, štítky, dokončení, idempotentní retry,
  fingerprint deduplikace, zabezpečené přílohy, časová osa, delete/undo a bezpečný
  rollback odmítající pozdější práci. Klientský parser navíc ověřuje RFC 4180 quoting,
  BOM, CRLF, delimiter, česká/ISO data, Todoist priority, rodiče podle ID či jednoznačného
  názvu, řešitele, ztrátu nadbytečných hodnot a stabilní SHA-256.
- Migrace 0053–0056: aplikovány a ověřeny i čistým během všech migrací do prázdné
  databáze. Profil dostupnosti má DB-validovaný pracovní/tichý rozvrh a membership
  scope; Focus/absence/nedostupnost/volno jsou verzované bloky; reminder state machine
  rozlišuje `held`; nouzová výjimka je přesný task/block/assignee scope. DB triggery
  a per-user advisory locks uzavírají přímé zápisy i souběh Focus bloku s přiřazením.
- Dostupnost prošla 50 integračními kontrolami: fail-closed tenant a restricted ACL,
  souběžný první profile save a block create, CAS/idempotence, soukromé popisky,
  warning/strict policy, Focus preflight, přesný emergency override retry i atomická
  vícenásobná výjimka přes několik Focus bloků, DB assignment
  a schedule guard, bulk preview, PowerSync 409, atomické odmítnutí porady, tiché hodiny
  přes DST, reminder hold/release bez falešného provider pokusu a auditní časová osa.
- Migrace 0057–0059: interní booking pages, pevní účastníci, sloty a historické
  rezervace mají same-project/workspace vazby, CAS verze, přesnou IANA zónu a DB guard
  délky slotu. Pár meeting/hub se při pozdějším mazání odpojuje atomicky a aktivní
  rezervovaný meet nelze obejít generickým task delete commandem.
- Interní rezervace prošly 37 integračními kontrolami: management ACL, fail-closed
  projektová viditelnost, create/book/cancel replay, reuse ID konflikt, souběžní
  rezervující, privacy rezervujícího, Focus a busy guard, atomický meeting/hub/
  assignments zápis, znovuotevření slotu, ruční meeting parity, archive, export a audit.
- Celý `scripts/ci-api-integration.sh` po opravě korektního ukončení intake verifieru
  proběhl až po produkční 2FA restart a skončil úspěšně.
- PowerSync po restartu: nový replication stream aktivní, sync-config bez chyby.
- Migrace 0060: aplikována; schedule výjimka má same-project FK, párový instant/zónu,
  kladnou délku/verzi a DB zákaz současného `done` + `skipped`. Schedule sloupce jsou
  v PowerSync bucketu pouze pro čtení a nejdou obejít generickým upload registrem.
  Recurrence API prošlo 21 živými kontrolami včetně DB invariantů, restricted ACL, DST mezery,
  Focus blokace, idempotentního replay, operation-ID reuse, stale preview a undo,
  které nesmaže později přidané dokončení výskytu.
- Migrace 0061–0064: aplikovány; „tento a další“ ukládá konečný prefix původní řady
  se same-project FK, validním rozsahem, pravidlem, IANA časem a kladnou verzí. Prefix
  je v PowerSync pouze pro čtení, obecný write registry ho nepřijímá, export/restore
  ho obnoví, `created_by SET NULL` neblokuje správu účtů a exclusion constraint
  nedovolí překryv segmentů ani při souběhu či restore. Recurrence API prošlo 41
  živými kontrolami včetně přesného count/until transformu, zachování jediného tasku,
  idempotence, blokace existujících budoucích výjimek, downsyncu a CAS undo obou
  strukturálních rozsahů.
- `pnpm build`: největší JS 342 KiB gzip, precache 5,192 KiB; oba rozpočty splněny;
  vlastní pole, ankety, projektové milníky, intake, importní průvodce, Úkoly a Nadcházející jsou oddělené
  lazy-loaded chunky.
- Celý `pnpm gate` po runtime opravách znovu prošel: typecheck 6/6, lint bez warnings,
  accessibility contract 105/105, všechny testy, corpus 321/321 a produkční build.
- Autentizovaný Chrome axe matrix: 15 hlavních rout × 320/360/390/768/1024/1440 px
  ve světlém režimu (90 průchodů) a × 390/1440 px v tmavém režimu (30 průchodů),
  vždy s `prefers-reduced-motion: reduce`. Po opravě globálních a Mail tokenů,
  vnořených interaktivních prvků, scroll regionu a split separatoru zůstalo 0
  critical/serious i 0 dalších WCAG A/AA nálezů a 0 horizontálních overflow.
  Jednorázový externí `ERR_QUIC_PROTOCOL_ERROR` se v cíleném opakování nereprodukoval;
  aplikační runtime error nezůstal.
- Chrome keyboard/zoom scénář: dialog úkolu se otevřel Enterem, 14 Tab kroků zůstalo
  uvnitř, Escape jej zavřel a vrátil focus otvírači. Audit odhalil a opravil mezeru
  společného focus trapu na deterministické cyklení. Mailové vlákno se otevřelo
  Enterem, split separator reagoval na šipku a Domov/Mail/Nastavení prošly 200%
  page scale při 720 CSS px bez overflow; žádná runtime chyba.
- Reprodukovatelný `pnpm verify:runtime-a11y` následně ověřil stejný klávesový a
  reflow kontrakt v Chromium i WebKitu a plnou matici 15 rout × 390/1440 px ×
  light/dark × 2 enginy (120 naplněných průchodů): 0 axe WCAG A/AA nálezů,
  0 overflow, 0 chybějících `main`, 0 runtime chyb. Audit odhalil a opravil neplatné
  `ul > div > li`, vnořená tlačítka task/overview karet, kontrast hotových úkolů,
  postranní navigace, overdue/mail/goal stavů a nekonzistentní šířku Mail separatoru.
- Reprodukovatelný `pnpm verify:release-e2e` v Chromium i WebKitu ověřil skutečné
  heslové přihlášení, první sync, lokální offline create, nulový předčasný serverový
  zápis, reconnect upload, editaci názvu a termínu, durable zachycení odmítnuté
  operace, discard i úspěšný ruční retry s autoritativním receiptem. Dále ověřil
  enrollment 2FA a rotaci recovery kódů, meeting plan → transkript → skutečné AI
  review → Decision Log/task commit a šifrovaný export → dry-run → auditovaný restore.
  Add Task, Task Detail a meeting plan/review jsou axe-clean; při opravě se doplnil
  nativní disabled stav submitu, přístupné názvy formulářů, kontrast utlumených sekcí
  a skutečné omezení pop-in animací při `prefers-reduced-motion`.
- F2 trust-state browser důkaz rozšířil release scénář o okamžitý offline stav nad
  potvrzenou cache, odstranění stale lišty po reconnectu, globální durable upozornění
  na rejected write a 390px axe/reflow kontrolu. Cílený runtime matrix Domov/Mail/
  Nastavení v light/dark, 390/1440 px a Chromium/WebKit má 24/24 průchodů, 0 WCAG
  nálezů, 0 overflow a 0 runtime chyb. Ruční snímky odhalily a následný scénář ověřil
  kontrast toast akce, odstranění duplicitního rejected toastu, bezpečný odstup od
  mobilní lišty a stabilní dvouřádkový header bez ztraceného názvu. Sanitizované
  výsledky jsou v `docs/release-evidence/trust-state-e2e-2026-07-17.json` a
  `docs/release-evidence/trust-state-runtime-a11y-2026-07-17.json`.
- F2 overlay primitive sjednotil modaly, drawery i nemodální popovery do jednoho
  topmost Escape pořadníku. Dialogy sdílejí focus trap, inert, referenčně počítaný
  scroll lock a návrat fokusu; popovery okolí neinertují a u explicitního triggeru
  vracejí fokus deterministicky i při rychlém zanoření. Release E2E v Chromium i
  WebKitu ověřuje Task Detail → command palette i Pohledy → command palette,
  12krokové cyklení fokusu, postupné Escape zavírání a návrat otvírači. Cílený
  runtime matrix osmi dotčených rout má 64/64 průchodů, 0 axe, 0 overflow a 0
  runtime chyb. Vizuální kontrola zanořeného desktopového stavu je bez ořezu a
  nechtěného překrytí. Artifacty jsou v
  `docs/release-evidence/overlay-e2e-2026-07-17.json` a
  `docs/release-evidence/overlay-runtime-a11y-2026-07-17.json`.
- F2 Nastavení zachovalo jeden povrch i existující formuláře a přidalo sedm
  adresovatelných sekcí s validovaným URL kontraktem a kompatibilitou starých hash
  odkazů. Kontextové vstupy ze synchronizace, Mailu a Lidé míří do správného místa.
  Chromium i WebKit ověřily všech 7 sekcí při 390/1440 px (28/28 stavů), návrat
  fokusu menu rolí, legacy mail-admin redirect, 0 axe WCAG A/AA nálezů, 0 overflow
  a 0 runtime chyb. Důkaz je v
  `docs/release-evidence/settings-runtime-a11y-2026-07-17.json`.
- F2 mobilní karta a navigace zachovaly jedinou spodní lištu i existující Mail a
  task flows, ale opravily pořadí titul → metadata → projektový kontext, přidaly
  44px dotykovou nabídku bezpečných akcí a plně dosažitelný scrollovatelný sheet
  „Více“. Vizuální audit opravil stísněné „Nadcházející“ na 320 px a chybnou vrstvu
  lišty nad otevřeným sheetem. Chromium i WebKit ověřily 320/360/390 px: právě jednu
  navigaci také v Mailu, 22/22 task karet s novou hierarchií, focus trap, scroll lock,
  překrytí lišty, Escape + návrat fokusu, 0 overflow a 0 runtime chyb. Matice Domov/
  Mail má současně 0 axe WCAG A/AA nálezů. Důkaz je v
  `docs/release-evidence/mobile-runtime-a11y-2026-07-17.json`.
- F2 transparentní KPI nahradily nezdokumentovaná čísla v Reportech a Velínu
  společnou kartou s viditelným rozsahem, obdobím, IANA zónou, výlukami, čerstvostí
  a vzorcem. Audit současně našel a opravil dvě Mail agregace: urgentní počet už
  není omezen top-8 náhledem a unread týmový počet nevstřebává spam ani uzavřená
  vlákna; osobní badge zůstal oddělený. Statický kontrakt, unit scope test a
  Chromium/WebKit ověřily 3 Report KPI + 5 Velín KPI při 390/1440 px, disclosure
  Mail demo zdroje, 0 axe WCAG A/AA nálezů, 0 overflow a 0 runtime chyb. Důkaz je v
  `docs/release-evidence/kpi-runtime-a11y-2026-07-17.json`.
- F3 recovery-first outbox rozšířil původní Centrum problémů bez přepsání connectoru.
  Čekající PowerSync operace jsou čitelné s počtem, velikostí, pravdivým stavem a
  redigovaným dvou/třísloupcovým diffem; rejected operace zachovávají retry, kopii,
  otevření objektu a potvrzený discard. Statický kontrakt zakazuje `.complete()` i
  mazání interní fronty z UI. Chromium + WebKit release E2E ověřily offline create,
  pending diff na 390 px, nulový předčasný serverový zápis, reconnect upload,
  rejected diff, discard a retry s receiptem; oba stavy jsou axe-clean, bez overflow
  a po vizuální opravě používají lidské názvy polí i konzistentní offline copy.
  Důkaz je v `docs/release-evidence/outbox-e2e-2026-07-17.json`.
- F3 recurrence sjednotila dříve oddělenou projekci Dnes/Nadcházející/Kalendáře a
  opravila i start-only sérii přes půlnoc: identita se odvozuje z lokálního data v
  uložené IANA zóně, nikoli z UTC řezu. Živý API verifier má 41/41 kontrol a
  reprodukovatelný browser verifier prošel v Chromium i WebKitu pro „jen tento“,
  „tento a další“ i „celá aktivní řada“: dialogový diff a dopad, 390px reflow, focus
  trap, axe, autoritativní DB zápis, prefix historie, PowerSync downsync a CAS undo.
  Statický kontrakt hlídá command-only schedule/prefix data a zakazuje návrat původního
  tichého `@occurrence` no-opu. Podepsaný export/restore navíc skutečně obnovil smazaný
  segment a opakovaný apply ho neduplikuje. Task delete/undo prefix zahrnuje do stejného
  atomického snapshotu, import rollback ho považuje za pozdější práci a časová osa
  strukturální přesun zobrazuje jako plánovací diff.
- Autentizovaný Chrome CDP audit: 14 desktopových + 15 responzivních rout bez
  horizontálního overflow; vlastní pole prošla 320/390/768/1440 px, min. targetem
  44 px, offline zápisem a následným autoritativním uploadem. Jediný zachycený
  network log pocházel z úmyslné simulace offline stavu.
- Cílený Chrome audit anket: create → hlasování → pojmenované výsledky → uzavření →
  potvrzený delete prošel na 320/390/768/1440 px bez overflow a runtime chyb; nález
  32px summary targetu byl opraven na 44 px a celý scénář poté prošel znovu.
- Waiting Room je odvozený z autoritativních závislostí a aktivních kroků Postupů,
  bez nové kopie stavu. Oba směry, firemní filtr a proklik prošly cíleným scénářem;
  karta má na 320/390/768/1440 px targety ≥44 px, bez overflow a runtime chyb.
- Projektové milníky prošly 20 integračními kontrolami: ACL a fail-closed 404,
  idempotentní create, CAS konflikt nastavení i milníku, same-project FK, DB
  completion/regression guard, blokovaný task delete/move, update/delete confirmation,
  výchozí milník a audit. Editor byl vizuálně
  zkontrolován na 320/390/768/1440 px bez overflow či runtime chyb; formulář a ovládání
  mají 44px cíle a UI respektuje efektivní editor/manager oprávnění.
- Cílený Chrome CDP audit dostupnosti: desktop 1440 px a mobil 390 px bez document ani
  section overflow, všechny ovladače pojmenované a vysoké nejméně 44 px. Dialog bloku
  drží a vrací fokus, Escape jej zavře a pozadí je nedosažitelné. Focus Time se po
  skutečném PowerSync round-tripu vykreslil v týdenním kalendáři jako šrafovaná
  netasková vrstva; rychlé Nerušit je dostupné z hlavičky.
- Cílený Chrome CDP audit interních rezervací: samostatný povrch mimo běžný kalendář
  prošel na 1440 a 390 px bez overflow či runtime chyby. Mobilní grid regresi odhalil
  screenshot a následná oprava; ověřeny jsou seznam, create formulář, fallback prázdného
  jména, potvrzená rezervace, toast, „Moje rezervace“, otevření a zrušení meetu.
- `NODE_ENV=production LUCKYOS_MOCK=1 ...`: oba produkční mock gates potvrzeně zůstaly vypnuté.
- `git diff --check`, YAML parser a journal JSON parser: prošly.
- `pnpm verify:dependency-audit`: produkční registry scan je svázaný s lockfile SHA,
  high/critical = 0; sanitizovaný lokální artifact je uložený a CI má blokující
  runner i immutable-pinned archivaci výsledku.
- SLO observability: unit klasifikace 5xx/auth/sync/504, fail-closed constant-time
  bearer auth a živý PostgreSQL integrační průchod `/ops/slo` jsou zelené; provider
  timeout se nově odlišuje jako 504 a provozní panely/alerty mají runbook.
- Produkční konfigurační preflight kontroluje HTTPS a rezervované hosty, invite-only/2FA/proxy
  politiku, sílu a oddělení tajemství, PowerSync/LuckyOS keyringy i úplnost providerů.
  Šest kontraktních scénářů ověřuje fail-closed návratový kód, sanitizovaný report bez
  hodnot tajemství a atomický artifact s právy `0600`; rotace má samostatný runbook.
- Čerstvý lokální encrypted PostgreSQL restore drill obnovil všech 62 migračních záznamů
  do izolované databáze za 2 sekundy, ověřil nulové orphan/cross-tenant odchylky pro
  tasky, projekty, meetingy, dostupnost, booking a intake a cílovou DB po sobě odstranil.
  Čtyři historická dev přiřazení bez projektového členství jsou explicitní varování;
  lokální drill kvůli nim svévolně nemaže data ani neuděluje přístup, produkční drill je odmítá.

Neověřené v tomto snapshotu:

- nativní Safari smoke zůstává volitelným doplňkem k zelenému podporovanému
  Chromium + WebKit matrixu;
- první skutečně uchovaný dependency audit artifact z CI pipeline; lokální report
  a jeho blokující/archivační workflow jsou zelené;
- cílený browser screenshot audit intake formulářů, urgentní akceptace a importního průvodce; lokální browser
  runtime skončil před připojením chybou pluginu, proto tyto dávky kryjí statické
  design/accessibility kontrakty, integrační testy a produkční build;
- skutečný produkční PITR/provider/deployment drill; lokální restore důkaz nenahrazuje
  WAL archivaci, off-site retention, secret manager, TLS ani produkční alert routing.

## 12. Go/no-go

### Interní vývojový pilot

GO pouze pro řízené interní testování task/project/meeting jádra s vědomím, že Mail je demo a externí providery mohou být unavailable.

### Externí pilot nebo produkce

NO-GO, dokud nejsou splněny R-01 až R-05 v relevantním rozsahu. Žádný zelený unit test nenahrazuje browser evidence, dependency audit, PITR ani skutečné provider potvrzení.

### Konečná instrukce pro Claude Code

Nezačínej nový feature backlog tím, že přepíšeš stabilizované commandy nebo schéma. Nejprve uzavři release evidence F0. Potom postupuj přesně po jedné vertikální epice. Pokud objevíš další reprodukovatelný bug, přidej jej do tohoto dokumentu s důkazem, oprav jej před novou funkcí a nenechávej jej jako poznámku „později“.
