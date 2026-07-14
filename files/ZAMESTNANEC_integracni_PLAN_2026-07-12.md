# Zaměstnanecký modul Watson ↔ LuckyOS — implementační plán (Watsonova strana)

> **Co:** plán pro postavení zaměstnaneckého (trenérského) modulu ve Watsonu jako tenkého klienta nad
> employee API LuckyOS. **Zdroj:** handoff `WATSON_HANDOFF_KOMPLETNI_zamestnanecky_modul_2026-07-12.md`
> + doprovodné analýzy (`WATSON_LUCKYOS_*`), ověřené **field-level čtením kódu OBOU repozitářů k 2026-07-12**
> (Watson `~/Desktop/Watson`, LuckyOS `~/Downloads/lucky-os`).
> **Autor:** Claude Code · **Datum:** 2026-07-12.
>
> **Doprovodný dokument:** `files/ZAMESTNANEC_LUCKYOS_pozadavky_2026-07-12.md` — přesný spec toho, co musí
> doplnit strana LuckyOS (rozhodnuto: Watson postaví svou stranu + odevzdá spec; LuckyOS doplní jeho tým).

---

## 0. Uzamčená rozhodnutí (2026-07-12, s uživatelem)

1. **Dělba práce:** Watson postaví **celou svou stranu**; změny v produkčním LuckyOS se **nedělají tady**,
   ale odevzdají jako **přesný spec** (viz doprovodný dokument). Plán je proto strukturován tak, aby
   Watsonova strana šla postavit a otestovat i **proti mocku LuckyOS**, dokud reálné doplňky nedorazí.
2. **Rozsah v1 = Fáze 1 + Fáze 2:** čtení/dashboard/výplaty + notifikace→úkoly **a zároveň** odevzdávací
   formuláře (docházka, výdaje+účtenka, dokumenty, profil, malá čísla). **Smlouvy / e-podpis = až v2 (Fáze 3).**
3. **Most = broker přes server Watsonu** (ne prohlížeč-přímo), viz §3 — obchází same-origin blokádu LuckyOS
   a minimalizuje jeho změny na „přijmi bridge-token".
4. **Citlivá data (mzdy, účet, doklady) = osobní sféra, online-only** — nikdy do týmových PowerSync bucketů.
5. **Fidelity:** každá nová obrazovka projde **Claude Design** (design = zdroj pravdy, viz `MEMORY:design-zdroj-pravdy`);
   stavíme až podle handoffu, ne od oka. Design brief = první krok Fáze 0.

---

## 1. Model a hranice (zlaté pravidlo)

- **Watson = jediná appka zaměstnance.** Sbírá vstupy, zobrazuje, doručuje notifikace/úkoly, řeší přihlášení.
- **LuckyOS = system-of-record** (účetnictví/mzdy). Zaměstnanec vždy jen **„odevzdá"** (`submitted`/`pending`/
  `draft`); schvalování, výpočet mezd, uzávěrky a právní finalizaci spouští **admin v LuckyOS**.
- **Watson NIKDY:** nepočítá mzdy, neschvaluje, neúčtuje, needituje `persons`, nefinalizuje právní podpis.
- **Tok:** převážně Watson → LuckyOS (zápisy); zpět tečou jen **stavy a odvozená data ke čtení**
  (výplaty, stav schválení, blokery, notifikace).

Tahle dělicí čára je **feature, ne omezení** — legislativní jádro zůstává, kde být musí, a zaměstnanec o čáře
ani neví (pro něj je to jedna plynulá appka).

---

## 2. Co Watson ZNOVUPOUŽIJE vs. co je NET-NEW

Ověřeno v kódu. **Cíl: nestavět, co už existuje.**

| Potřeba modulu | Stav ve Watsonu | Akce |
|---|---|---|
| Zobecněný write-path (registr `TABLES`) | ✅ hotovo (`apps/api/src/powersync.ts`) | jen přidat `entity_links` do registru |
| Osobní sféra (`workspaces.isPersonal`) | ✅ existuje (`schema/workspace.ts`) | modul poběží v osobní sféře, online-only |
| Routing dle oblastí (`memberships.areas`/`bio`) | ✅ existuje (migrace 0019) | využít pro přiřazení úkolů z notifikací |
| Vzor „online-only přes REST fetch" | ✅ existuje (`watson.ts`, `meetings.ts`) | most na LuckyOS jde přesně tudy |
| Úkoly / připomínky / kalendář / Web Push | ✅ produkce | **jádro hodnoty**: notifikace→úkoly |
| `audit_events` (píše se na každou mutaci) | ✅ (`powersync.ts:auditLog`) | zaměstnanecké akce se audítují samy |
| Vydávání JWT (RS256 + JWKS) | ✅ pro PowerSync (`powersync.ts:issueToken`) | **vzor** pro bridge-token na LuckyOS |
| Vycentrovaná karta / modal | ✅ (`WatsonCard.tsx`, `AddTaskModal.tsx`) | vzor pro formuláře a náhledy |
| i18n cs+en, design tokeny | ✅ (design lock) | nové klíče `zam.*`, dodržet tokeny |
| — | — | — |
| **SSO / bridge-token most** | ❌ NENÍ (jediný JWT = PowerSync) | **net-new** (Fáze 0) |
| **`entity_links` tabulka** | ❌ NENÍ (jen aspirační komentář v mailu) | **net-new** (Fáze 0), sdílená s mailem |
| **Broker na LuckyOS API** | ❌ NENÍ | **net-new** modul `apps/api/src/employee.ts` |
| **Formulářová vrstva** (validace) | ❌ jediný `<form>` je login | **net-new** (Fáze 2), vzor = controlled `useState` |
| **Upload souborů** (multipart/preview) | ❌ `attachments` tabulka je mrtvá, žádný endpoint | **net-new** (Fáze 2) — proxy na Drive LuckyOS |
| **PDF viewer / podpisový pad / PDF gen** | ❌ NENÍ | **net-new, ale až Fáze 3** (smlouvy, v2) |

**Důsledek pro v1:** net-new UI primitiva pro v1 jsou **jen formulářová vrstva + upload/náhled souboru**
(obrázek + odkaz na PDF). PDF viewer, podpisový pad a generování PDF spadají do smluv (v2) → v1 je odkládá.

---

## 3. Architektura mostu — broker přes server Watsonu

**Zjištění z kódu:** LuckyOS employee API běží na **same-origin cookie session** a middleware **aktivně blokuje
cizí origin** (403 „Cross-origin request blocked"; `middleware.ts` + `origin-check.ts`). Prohlížeč Watsonu by
se tedy na LuckyOS mutace **nedostal**.

**Řešení — prohlížeč nemluví s LuckyOS vůbec. Mluví s ním server Watsonu:**

```
  Prohlížeč (Watson web)                Watson API (Hono)                    LuckyOS (Next.js)
 ┌──────────────────────┐   same-origin ┌───────────────────────┐  server→server ┌──────────────────┐
 │ obrazovky modulu      │  Better Auth  │  apps/api/employee.ts │  Bearer token  │ /api/employee/*  │
 │ (osobní sféra)        │──────────────▶│  = „LuckyOS Bridge"   │───────────────▶│ /api/storage/drive│
 │ fetch /api/employee/* │◀──────────────│  mint bridge-JWT      │◀───────────────│ (person-scoped)  │
 └──────────────────────┘   JSON         │  outbox + idempotence │  JSON/stav     └──────────────────┘
                                          └───────────────────────┘
```

**Proč to je elegantní:**
- Same-origin blokáda LuckyOS cílí na **prohlížeče/CSRF**, ne na server-server volání (to nenese browser
  `Origin`/`Sec-Fetch-Site`) → **odpadá potřeba otevírat CORS.** LuckyOS si nechá svou obranu netknutou.
- LuckyOS musí doplnit **jen jednu věc**: přijmout `Authorization: Bearer <bridge-jwt>` vedle cookie
  (ověří podpis přes Watson JWKS, z claimu `email` dohledá osobu stávajícím `ensureEmployeePersonForIdentity`).
- **Bridge-token nikdy neopustí server** — prohlížeč ho nevidí. Menší útoková plocha.
- Broker je přirozené místo pro **idempotentní outbox** a rate-limit/backoff (invariant handoffu §5.8).

**Bridge-token (Watsonova strana):**
- Reuse RS256 keypair + JWKS z `powersync.ts`; nový audience `aud='luckyos'`, krátká expirace (~5 min),
  claims `{ email, role:'employee', person_id?, aud, exp, iss }`.
- Mapování `watson.user ↔ luckyos.person` **přes e-mail** (unikátní v obou). `person_id` si Watson při prvním
  volání vytáhne z `GET /api/employee/me` (přes broker) a nacacheuje pro dedup/entity_links.
- Bezpečnost: rotace klíčů, audit každého bridge-volání, scope na `/api/employee/*`+`/api/storage/drive`,
  postup při kompromitaci (token = právo zapisovat jménem zaměstnance) — viz §6.

---

## 4. Datový model (Watsonova strana)

### 4.1 `entity_links` (net-new, sdílené s mailovým plánem)
Polymorfní vazební tabulka (stejný vzor jako `audit_events.(entity,entity_id)`):
```
entity_links {
  id uuid pk,
  from_type text, from_id text,      // např. 'task' + tasks.id
  to_type text,   to_id text,        // např. 'luckyos_notification' + external id
  relation text,                     // derived_from | references | belongs_to | mentions
  source_system text null,           // 'luckyos' | 'mail' | null
  external_id text null,             // = LuckyOS id (dedup)
  workspace_id uuid null,            // scoping/proklik (osobní sféra)
  created_at timestamptz
}
unique (source_system, external_id, to_type)   // dedup importu
```
- Přidat do write-path registru `TABLES` (server-authoritative) + do `AppSchema` a `sync-config.yaml`
  (workspace-scoped, kvůli proklikům v UI).
- **Použití:** import notifikace/deadlinu z LuckyOS → Watson úkol, `entity_links(source_system='luckyos',
  external_id=<luckyos id>)`. Idempotence: opětovný pull nevytvoří duplikát (unique index + upsert).

### 4.2 Identity mapping
- **Primární klíč = e-mail** (unikát v obou). Nová lehká tabulka `luckyos_identity_map(user_id, email,
  luckyos_person_id null, linked_at)` NEBO stačí odvodit z `users.email` + cache `person_id`. Doporučení:
  **cache `person_id` na `memberships`/lehké tabulce**, e-mail je autoritativní klíč.
- „Je to napojený zaměstnanec?" = existuje mapping + `GET /api/employee/me` vrátí 200. Podle toho se
  **zobrazí sekce v sidebaru** (viz §5, Fáze 0).

### 4.3 Osobní sféra (žádná net-new infra)
- Modul běží v **osobní sféře** uživatele (`workspaces.isPersonal=true`, existuje). Citlivá data
  (výplaty/účet/doklady) se **renderují on-demand z LuckyOS** přes broker, drží se jen v paměti, **nikdy do
  PowerSync bucketů.** Tím je splněn GDPR invariant handoffu §5.9.
- Úkoly vzniklé z notifikací = **normální Watson úkoly** (syncují se) v osobním Inboxu / dedikovaném osobním
  projektu „Práce a mzda" — obsahují jen **fakt události + termín + proklik**, žádné částky (princip minima dat).

---

## 5. Fázování

Každá fáze je samostatně nasaditelná. U každé: **Watson (stavíme)** + **LuckyOS (spec — čeká na doplnění)**
+ **Design**. Watsonova strana jde vyvíjet proti **mocku LuckyOS**, dokud reálné doplňky nedorazí.

### Fáze 0 — BRÁNA (identita + most + skelet) 🔴 gate
**Watson:**
- Bridge-token issuer (reuse RS256/JWKS, `aud='luckyos'`); identity mapping přes e-mail; cache `person_id`.
- Broker modul `apps/api/src/employee.ts` — server-to-server volání na LuckyOS s bridge-tokenem; první routa
  `GET /api/employee/me` (health mostu).
- `entity_links` tabulka + write-path registr + AppSchema + sync-config.
- **Navigace BEZ přehlcení menu (IA princip):** modul = **JEDNA položka** v sidebaru (např. „Zaměstnanec"),
  8 obrazovek **uvnitř** jako vnitřní záložky/sub-nav (vzor Mail — jedna položka + header takeover, viz
  `MEMORY:mail-koherence`), **ne 8 top-level položek.** Položka je **gated jen na napojeného zaměstnance**
  (jako `isLeadership` u Velína) → zbytek týmu nevidí nic navíc. Osobní sféra, online-only. i18n `zam.*`.
  **Umístění ROZHODNUTO (2026-07-12):** samostatná **gated položka „Zaměstnanec"** + vnitřní taby.
- **Zásadní signály navíc do Přehledu (rozhodnuto):** gated karta **„Můj stav"** na Přehledu (jen pro
  trenéra) = jen to nejdůležitější (readiness výplaty, nejbližší deadline „odevzdat docházku do X",
  chybějící účet/dokument, „výplata připravena/blokována") s proklikem do modulu. Trenér vidí kritické
  věci, aniž otevře modul.
- **Klíčové: Fáze 1 (notifikace/deadliny→úkoly) nepřidává do menu NIC** — teče do stávajících ploch
  (Přehled, Úkoly, Nadcházející, kalendář, Schránka, notif centrum). Provázané, ne silo. Do menu tak reálně
  přibude **max +1 položka, a jen pro trenéry.**
- **Mock LuckyOS** (dev): malý Hono/route mock vracející realistické tvary, ať jde F1/F2 stavět bez produkce.
**LuckyOS (spec):** přijmout `Bearer` bridge-token na `/api/employee/*` + `/api/storage/drive` (ověření přes
Watson JWKS, `aud`, `exp`, e-mail→osoba); potvrdit, že origin-check propustí server-server volání. *(viz spec §1)*
**Design:** brief → Claude Design pro **shell modulu + všechny obrazovky** (dashboard, docházka, výplaty,
výdaje, dokumenty, profil, malá čísla) — kvůli 1:1 fidelity. **První konkrétní krok.**

### Fáze 1 — ČTENÍ + UPOZORNĚNÍ ⭐ (těžiště hodnoty, jen čtení)
**Watson:**
- **„Můj stav"** dashboard: readiness (ready/pending/blocked), **8 typů blokerů** (každý s vysvětlením +
  proklikem kam doplnit), **deadline countdown** (uzávěrka docházky/den výplat, severita), **DPP progres**
  (X/300 h, měsíční limit) — vše read přes broker.
- **Výplaty** — nativní read view z `payroll_entries` (období, hrubá/čistá/daň/odvody, stav, rozpis, YTD).
  (PDF páska = spec pro LuckyOS server endpoint, nebo v2.)
- **Notifikace/blokery/deadliny → nativní úkoly/připomínky/kalendář** (ingest v brokeru, idempotentně přes
  `entity_links`, přiřazení osobě, termín + připomínka + Web Push). **Tohle je hlavní diferenciátor** —
  LuckyOS to neumí (dnes generuje notifikace jen klientsky při otevřeném portálu).
- (volitelně) Osobní audit — read.
**LuckyOS (spec):** **server-side generování readiness + notifikací** a `GET /api/employee/status`
(readiness + stavy odevzdání + notifikace) jako spolehlivý zdroj pro pull; volitelně `GET` payslip PDF. *(spec §2)*
**Design:** dashboard + výplaty 1:1.

### Fáze 2 — ODEVZDÁVACÍ FORMULÁŘE (dokončuje v1)
**Watson:**
- **Formulářová vrstva** (net-new): controlled inputy + Zod validace (sdílené `@watson/shared`), inline chyby,
  „uloženo/odesláno" stavy, respekt uzamčení (disabled inputy) — vzor `AddTaskModal`.
- **Upload/náhled souboru** (net-new): `<input type=file>` + náhled (obrázek thumbnail / odkaz na PDF); bajty
  jdou přes broker na `/api/storage/drive` LuckyOS (`x-file-storage-mode:auto`), pak metadata do employee API.
- Obrazovky: **Docházka** (bulk tabulka den×3 činnosti, validace budoucí datum/strop 12 h/povinná poznámka,
  Odevzdat), **Výdaje** (multi-měna, zdroj proplacení, povinná účtenka), **Dokumenty** (upload, typy, expirace),
  **Profil** (žádost o změnu e-mail/telefon/účet/adresa), **Malá čísla** (výběr choreografie, hodiny H:MM).
- **Outbox/idempotence:** stabilní klientské `id` (invariant §5.1), draft lokálně (osobní, nesyncovaný) →
  odeslání přes broker → LuckyOS upsert; retry s backoffem na přechodné chyby.
- **Stavový feedback** (§3.7 handoffu): u každého odevzdání zobrazit stav + `reviewer_note` (z pullu Fáze 1),
  a z „needs_changes"/„rejected" udělat úkol „Oprav …".
**LuckyOS (spec):** endpointy už existují (attendance/expenses/documents/profile-change/small-numbers).
Volitelně: HEIC na Drive, AI kontrola dokladu pro roli employee. *(spec §3)*
**Design:** každá formulářová obrazovka 1:1.

### Fáze 3 — SMLOUVY + E-PODPIS (v2, odloženo)
**Watson (net-new):** PDF viewer + podpisový pad; obrazovka náhled smlouvy → ověřovací challenge → e-podpis.
**LuckyOS (spec):** **serverová finalizace `POST /api/employee/contracts/sign`** (vložení podpisu do PDF +
SHA-256 + lock + `contract_signatures` + ověřený `PersonDocument` + audit + idempotence); zobecnění na kanál
**„doručené dokumenty"** `document_delivery` (režimy sign/acknowledge/info) + `GET /api/employee/deliveries`. *(spec §4)*

### Fáze 4 — DEMO TRIO (kostýmy / trenérské fondy / akce) — later
Chybí i v LuckyOS (RBAC employee nepustí, žádné API). Nejdřív musí LuckyOS postavit
`/api/employee/{costumes,trainer,events}` + `event_assignments` entitu; pak zrcadlit ve Watsonu. *(spec §5)*

---

## 6. Invarianty & bezpečnost (Watson MUSÍ dodržet — handoff §5/§9)

1. **Stabilní klientské `id`** → idempotentní upsert; při retry negeneruj nové.
2. **Status jen odevzdávací** (`submitted`/`pending`/`draft`) — nikdy `approved`/`verified`/`reimbursed`.
3. **`person_id` neposílej jako pravdu** — LuckyOS ho dosadí z identity (bridge-token e-mail).
4. **Anti-IDOR** — neposílej cizí `id` (broker relayuje, LuckyOS stejně hlídá `assertIdBelongsToPerson`).
5. **Respektuj uzamčení** (docházka submitted/approved, malá čísla closure) — už v UI (disabled).
6. **Soubor před metadaty**; při selhání úložiště ulož aspoň metadata (fallback bez přílohy).
7. **Zpětné stavy = read-only zrcadlo** — Watson stav nepřepisuje, jen zobrazuje/úkoluje.
8. **Rate-limit + backoff** přes outbox (broker).
9. **GDPR:** mzdy, číslo účtu, osobní doklady = **online-only, osobní sféra, nikdy do sdíleného syncu.**

**Bezpečnost mostu:** krátká expirace + rotace klíčů; audience/scope tokenu; replay-ochrana; **audit každého
bridge-volání**; postup při kompromitaci Watsonu (token = zápis jménem zaměstnance). Bridge-token nikdy do
prohlížeče. Guardrail Watson AI zůstává: AI **nikdy** neodešle odevzdání sama — jen navrhne, člověk potvrdí.

---

## 7. „Maximální potenciál Watsonu" — kde přidáváme hodnotu nad tenký klient

Ne jen zrcadlo LuckyOS. Watson přidává přesně to, co LuckyOS nemá:
- **Notifikace/blokery/deadliny jako reálné úkoly/připomínky/kalendář** s Web Push, digestem, tichými
  hodinami, na mobilu (PWA). „Nic nepropadne" (napojení na koncept urgence, `MEMORY:mail-moduly-brief`).
- **Trenér dostane v téže appce i běžnou týmovou práci** (úkoly, akce, seznamy, kalendář, mail) — jeden
  mobil, jedno přihlášení. To LuckyOS neumí a nikdy nebude.
- **„Dění" feed** (plánovaný průřezový modul) může později zobrazovat LuckyOS události (read-only).
- **Watson AI karta** (`/api/watson/command`) může později **navrhnout** odevzdání / sumarizovat stav mezd
  (human-in-the-loop, nikdy auto-send) — mantinely už existují.

---

## 8. Otevřené otázky (k rozhodnutí za běhu)

- **Umístění v navigaci — ROZHODNUTO (2026-07-12):** gated položka „Zaměstnanec" + vnitřní taby + gated karta
  „Můj stav" na Přehledu. (Zvažované alternativy: jen osobní sféra / žádná položka — zamítnuto.)
- **Provisioning/životní cyklus identity:** kdo zakládá zaměstnance (LuckyOS `persons` vs. Watson účet),
  pozvánka nového trenéra, změna e-mailu, offboarding/deaktivace, chybějící/duplicitní mapping. → navrhnout v F0.
- **Pull vs. push zpětného kanálu:** v1 = **pull** (broker poll `GET /api/employee/status`); webhook (push)
  z LuckyOS = pozdější optimalizace (spec §2, volitelné).
- **Payslip PDF:** nativní render ve Watsonu z dat, nebo server endpoint LuckyOS? → default: v1 nativní read
  view bez PDF; PDF páska jako spec/deferred.
- **Dedikovaný osobní projekt „Práce a mzda"** vs. osobní Inbox pro úkoly z notifikací. → default: dedikovaný.

---

## 9. Odkazy
- Handoff: `~/Downloads/lucky-os-transfer/WATSON_HANDOFF_KOMPLETNI_zamestnanecky_modul_2026-07-12.md`
- Doprovodné: `WATSON_LUCKYOS_{zamestnanci_ve_watsonu,zamestnanec_katalog_ukonu,integrace_analyza}_2026-07-12.md`
- Spec pro LuckyOS: `files/ZAMESTNANEC_LUCKYOS_pozadavky_2026-07-12.md`
- Watson kód: `apps/api/src/{powersync,watson,meetings}.ts`, `packages/db/src/schema/*`, `apps/web/src/{layout,screens,mail}`
- LuckyOS kód: `src/app/api/employee/**`, `src/app/api/storage/drive`, `src/lib/{api-auth,user-person-link,runtime-*}.ts`
- Souvisí (paměť): design=zdroj pravdy, mail integrační plán (sdílená `entity_links`), watson-projekt (invarianty R1–R9).
