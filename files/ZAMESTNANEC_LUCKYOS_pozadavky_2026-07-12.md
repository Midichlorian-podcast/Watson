# Požadavky na LuckyOS — aby fungoval zaměstnanecký modul Watsonu

> **Komu:** týmu/session, který spravuje **LuckyOS** (`tg-ucetni`, Next.js 15, Supabase, NextAuth v4).
> **Co:** přesný, ohraničený seznam **aditivních** doplňků, které musí LuckyOS udělat, aby Watson mohl
> fungovat jako zaměstnanecký klient. **Nic z toho nemění účetní/mzdovou/právní logiku** — jen otevírá
> úzkou, bezpečnou plochu pro Watson a přesouvá pár věcí z klienta na server.
>
> **Zdroj:** field-level čtení kódu LuckyOS k 2026-07-12. Cesty `soubor:řádek` jsou orientační kotvy.
> **Protistrana:** `files/ZAMESTNANEC_integracni_PLAN_2026-07-12.md` (Watsonova strana).

---

## 0. Princip a hranice

- **Vše je aditivní.** Nesahat na výpočet mezd, schvalování, uzávěrky (`period_locks`), generování dokladů,
  zápis do `persons`, append-only audit. Ty zůstávají výhradně v LuckyOS.
- **Watson volá server-to-server**, ne z prohlížeče. Proto **není potřeba plné CORS** — stačí přijmout
  bridge-token. Same-origin obrana LuckyOS (`middleware.ts`, `origin-check.ts`) zůstává pro prohlížeče beze změny.
- **Priorita = pořadí fází.** Fáze 0 je brána (bez ní nic). Fáze 1–2 pokrývají v1 Watsonu. Fáze 3–4 = později.

---

## 1. FÁZE 0 — přijmout bridge-token (🔴 brána, bez ní nic nefunguje)

Dnes `/api/employee/*` autentizuje **jen NextAuth cookie** (`src/lib/api-auth.ts:17` `requireApiRole`,
`:58` `requireApiRoleWithRateLimit`) a osobu řeší `ensureEmployeePersonForIdentity`
(`src/lib/user-person-link.ts:136`). Origin je hlídán v `src/middleware.ts:144` + `src/lib/origin-check.ts`.

**Úkol 1.1 — přijmout `Authorization: Bearer <jwt>` vedle cookie.**
Na `/api/employee/*` **a** `/api/storage/drive`:
- Pokud dorazí `Authorization: Bearer <jwt>`, ověř ho **místo cookie**:
  - Podpis přes **Watson JWKS** (veřejné klíče stahované z Watson API — URL dodá Watson, formát standardní JWKS,
    vzor je stejný jako Watsonův PowerSync JWKS).
  - Povinné claims: `aud === 'luckyos'`, `iss === '<watson>'`, `exp` v platnosti, `role === 'employee'`,
    `email` (a volitelně `person_id`).
  - Z `email` dohledej osobu **stávající** cestou `ensureEmployeePersonForIdentity` (přijímá e-mail →
    `app_users` → `persons`). Žádná nová identitní logika — jen alternativní zdroj `{email, role}`.
  - Fail-closed zůstává: nevyřešený mapping → **403** (`assertEmployeePersonMapping`), stejně jako dnes.
- **`person_id` se dál bere ze serveru** (z dohledané osoby), NIKDY z tokenu jako pravda (anti-IDOR beze změny).

**Úkol 1.2 — propustit server-to-server volání přes origin-check.**
`middleware.ts:144` dnes blokuje `Sec-Fetch-Site: cross-site` / `Origin ≠ host`. Server-server volání Watsonu
**nenese** browser `Origin` ani `Sec-Fetch-Site`, takže by mělo projít. **Ověřit** a případně explicitně
povolit request nesoucí platný `Authorization: Bearer` (token-authed = není CSRF). Cookie-cesta z prohlížeče
zůstává chráněná beze změny.

**Úkol 1.3 — bez nového CORS.** Nepřidávat `Access-Control-Allow-Origin` pro prohlížeč Watsonu (není třeba).

**Kontrakt bridge-tokenu** (dodá Watson, sem pro úplnost):
```
JWT RS256, header {alg:RS256, kid}
claims: { iss:"<watson-issuer>", aud:"luckyos", sub:"<person_id|user_id>",
          email:"<zamestnanec@…>", role:"employee", exp:<~5 min>, iat }
ověření: JWKS na <watson-api>/api/employee/jwks  (nebo sdílené s /api/powersync/jwks — upřesní Watson)
```

**Definition of done F0:** Watson server zavolá `GET /api/employee/me` s bridge-tokenem a dostane
`{user, person}` pro správnou osobu; volání bez/špatného tokenu → 401/403; cizí `person_id` nelze podstrčit.

---

## 2. FÁZE 1 — zpětný kanál (stavy + notifikace ke čtení)

Dnes se readiness a notifikace generují **klientsky** (`src/lib/runtime-employees.ts:483`
`buildEmployeeNotifications`, `computePayrollReadiness`) až při otevřeném portálu — když trenér portál
neotevře, **notifikace ani nevzniknou**. Watson potřebuje **serverový, spolehlivý zdroj**.

**Úkol 2.1 — přesunout generování readiness + notifikací na server** (nebo je zpřístupnit serverově).
Výstup ať odpovídá dnešním typům: readiness `blocked|pending|ready` + `blockers[]` (8 typů), `missing_documents[]`,
deadliny (`attendance_due_day`, `payroll_day` z `AppSettings`), DPP progres, ~7 reálných notif typů
(`attendance_reminder`, `missing_bank_account`, `missing_document`, `attendance_approved`,
`attendance_rejected`, `payroll_ready`, `payroll_blocked`) + admin-emitované (`contract_signature_required`,
`contract_signed`).

**Úkol 2.2 — dedikovaný agregační endpoint** (aby Watson nemusel spoléhat na tvar interního store):
```
GET /api/employee/status
200: {
  person: { id, full_name, person_type, ... },
  readiness: { status, blockers:[{type, explanation, href}], missing_documents:[...],
               has_submitted_attendance, parent_contribution_completed },
  deadlines: { attendance_due_day, payroll_day, withholding_tax_day, ... , computed_countdowns:[...] },
  dpp_progress?: { hours_used, hours_limit:300, monthly_limit, ... },   // jen person_type='dpp'
  submissions: { attendance:[{period, status, reviewer_note}], expenses:[...], documents:[...],
                 profile_changes:[...], small_numbers:[...] },
  notifications: [{ id, type, title, message, href, is_read, created_at }]
}
```
- Person-scoped, fail-closed (nevyřešený mapping → 403). Read-only.
- Watson to **pulluje** (při otevření modulu + periodicky) a dělá z toho úkoly/připomínky.

**Úkol 2.3 — stavy odevzdání zpět.** Dnes to jde jen přes person-scoped GET (`/api/employee/{expenses,
documents,profile-change,small-numbers}`) + `/api/store/bootstrap|entities` (employee smí číst
`attendance_records/submissions`, `payroll_entries`, `notification_items`, `contracts`, `contract_signatures`,
`_entity-config.ts:44`). **Attendance nemá přímý employee GET** → doplnit ho, nebo ať to pokryje `2.2` (submissions).
Cíl: Watson nemusí sahat na interní `/api/store/*` tvar.

**Volitelné (nice-to-have, ne blokuje v1):**
- **Payslip / potvrzení o příjmech jako server PDF** (dnes client-side `generatePayslipPDF`,
  `generateIncomeConfirmationPDF`): `GET /api/employee/payroll/:period/payslip.pdf`. Jinak Watson zobrazí
  nativní read view z `payroll_entries` bez PDF.
- **Webhook (push) místo pullu:** `POST <watson>/api/integrations/luckyos/events` při změně stavu
  (`approved/rejected/reimbursed/verified/payroll_ready`). Zrychlí zpětný kanál; v1 stačí pull.

---

## 3. FÁZE 2 — odevzdávací endpointy (většina UŽ existuje)

Watson bude volat **stávající** employee routy — beze změny kontraktu. Ověřeno, že existují a vynucují
server-side status + anti-IDOR:
- `POST /api/employee/attendance` (`attendance/route.ts`) — records ≤200, `submit` → status vždy `submitted`.
- `GET/POST /api/employee/expenses` — status vždy `submitted`, `trainer_fund` vyžaduje `trainer_project_id`.
- `GET/POST /api/employee/documents` — `review_status` vždy `pending`; soubor přes Drive nebo `data_url` fallback.
- `GET/POST /api/employee/profile-change` — status `pending`, `field_decisions` null.
- `GET/POST /api/employee/small-numbers` — `draft|submitted`; uzavřené období → 409; cizí choreografie → 403.
- `POST /api/storage/drive` (multipart, `area`, ≤25 MB, magic-byte) — Watson posílá bajty sem přes broker.

**Jediné úkoly LuckyOS pro Fázi 2 (oba volitelné):**
- **Úkol 3.1 (volitelné) — HEIC na Drive.** Dnes `storage/drive/route.ts:135` magic-byte HEIC/HEIF nezná →
  400. Doplnit magic-byte pro HEIC, jinak fotky z iPhonu spadnou do base64 fallbacku (≤8 MB).
- **Úkol 3.2 (volitelné) — AI kontrola dokladu pro roli `employee`.** Dnes `/api/ai/extract-document` vrací
  employee 403. Povolit, má-li Watson tuto funkci nabízet.

*(Pozn.: `documents` Zod povoluje `file_size_bytes` do 50 MB, ale Drive zastropuje na 25 MB —
`storage/drive/route.ts:9`. Sjednotit limit, ať UI Watsonu hlásí správný strop.)*

---

## 4. FÁZE 3 — smlouvy + e-podpis (v2, až později)

Dnes je podpis **100 % klientský** (`src/lib/runtime-contracts.ts:405` `finalizeEmployeeContractSignature`,
pdf-lib v prohlížeči). To pro Watson (a pro důvěryhodnost) nestačí.

**Úkol 4.1 — serverová finalizace podpisu:**
```
POST /api/employee/contracts/sign
body: { contract_id, challenge:{full_name, birth_date, bank_suffix}, signature_png_base64 }
server: ověří challenge proti kanonickým datům osoby → vloží podpis do PDF → SHA-256 →
        zapíše contract_signatures (verification_method, document_sha256_at_signing, user_agent) →
        locked_at → vytvoří verified PersonDocument(dpp_contract) → 2× audit. Idempotence (2. podpis 409).
```
Ruší mzdový blocker `missing_contract`. Watson jen posbírá vstupy (náhled + challenge + podpis PNG).

**Úkol 4.2 — kanál „doručené dokumenty" (`document_delivery`).** Zobecnit dnešní `contracts.sendToEmployee`
(`src/app/(app)/contracts/page.tsx:226`, jen store mutace + in-app notifikace) na obecný kanál:
```
document_delivery { id, person_id, created_by, file_ref, title,
  category: contract|gdpr_consent|policy|payslip|notice|tax_doc|other,
  required_action: 'sign'|'acknowledge'|'info', deadline?, status, viewed_at?, completed_at?, result_ref? }
GET  /api/employee/deliveries                     → [document_delivery…]
POST /api/employee/documents/sign                 { delivery_id, challenge, signature_png_base64 }
POST /api/employee/documents/acknowledge          { delivery_id }   → read receipt + audit
POST /api/employee/documents/viewed               { delivery_id }   (volitelné, info režim)
```
Z GDPR souhlasu a přehledu mezd udělat doručitelné dokumenty (dnes checkbox / self-generované).

---

## 5. FÁZE 4 — demo trio (kostýmy / fondy / akce) — later

Dnes employee **nedostane data** (RBAC `_entity-config.ts` nemá `employee` v `read`) a zápisy = 403. Musí se
teprve postavit serverová vrstva, pak to Watson zrcadlí:
- **`GET /api/employee/costumes`** — person-scoped read trenérových choreografií (náklad/stepař/podíl studia/stav).
- **`GET/POST /api/employee/trainer`** — projekty/přispěvatelé/výdaje (`pending`) + reálný upload přílohy + UI platby rodiče.
- **`event_assignments` jako synchronizovaná entita + `GET /api/employee/events`** + emise `event_assigned`/`event_payment_approved`.

---

## 6. Průřezové bezpečnostní požadavky

- **Ověření bridge-tokenu:** JWKS cache s rozumným TTL; odmítnout `alg:none`, špatné `aud`/`iss`/`exp`.
- **Replay/rotace:** krátká expirace tokenu (~5 min); podpora rotace Watson klíčů přes `kid` v JWKS.
- **Audit bridge-volání:** logovat, že akce přišla přes Watson most (kdo/jménem koho/kdy) — vedle stávajícího
  append-only auditu.
- **Rozsah tokenu:** platí **jen** pro `/api/employee/*` + `/api/storage/drive`. Nikam jinam.
- **Fail-closed všude:** nevyřešený person mapping → 403, žádný leak (zachovat dnešní chování).

---

## 7. Shrnutí priorit pro LuckyOS

| Priorita | Úkol | Blokuje |
|---|---|---|
| 🔴 P0 | 1.1 přijmout bridge-token + 1.2 propustit server-server | úplně vše |
| 🟠 P1 | 2.1/2.2 server readiness + `GET /api/employee/status` | zpětný kanál (dashboard, notifikace→úkoly) |
| 🟡 P2 | 2.3 attendance status GET (nebo přes 2.2) | stav docházky ve Watsonu |
| 🟢 P3 (volit.) | 3.1 HEIC, 3.2 AI doklad, payslip PDF, webhook | UX vylepšení |
| ⚪ v2 | 4.1 serverový podpis, 4.2 document_delivery | smlouvy |
| ⚪ later | 5. employee costumes/trainer/events | demo trio |

**Bez P0 se Watsonova strana nedá spustit proti produkci** (jde ji ale vyvíjet proti mocku). **P1 je těžiště
hodnoty** zpětného kanálu. Vše ostatní je aditivní vylepšení.
