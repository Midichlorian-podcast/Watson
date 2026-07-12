# Stav rozhodnutí, mezery a dotazník — 2026-07-12

Ověřeno multi-agent průzkumem proti **reálnému kódu** (ne jen memory/plánům).
Klíčový rozlišovací klíč všude níže: **reálná datová vrstva** (packages/db +
PowerSync + apps/api → přežije reload, jiné zařízení, jiného uživatele) vs.
**demo/frontend** (mail/data.ts seed + localStorage → per-prohlížeč, nikam se
nesynchronizuje).

---

## A) Dohodnutá rozhodnutí — co je SKUTEČNĚ v kódu ✅

| Rozhodnutí | Stav | Poznámka |
|---|---|---|
| R6 barva úkolu = per-uživatelská (overlay `task_user_colors`) | ✅ reálné | schema + PowerSync per-user bucket + zápis z detailu i Add |
| Detail úkolu = centrovaný modal (ne boční panel) | ✅ reálné | `role=dialog`, focus-trap; horizontálně centr., svisle od 6vh |
| Podúkoly = vrstvené REÁLNÉ úkoly (INSERT do `tasks` s parent_id) | ✅ reálné | depth-limit R1 vynucen |
| Priorita = levý barevný okraj (odznak neutrální) | ✅ reálné | `TaskCard` inset 3px |
| Hlasité autosave + historie `task_activity` | ✅ reálné (částečně, viz C) | append-only, čte se přes API |
| Dvě sféry osobní/týmová (`workspaces.isPersonal`) | ✅ reálné | osobní ws se zakládá při registraci |
| Mail per-osoba nepřečtenost | ⚠️ jen DEMO | žádná DB tabulka; jen seed + localStorage |

**Dvě nepřesnosti v memory** (ne chyby v kódu): (1) „checklist zrušen" —
`checklist_items` pořád existuje **vedle** podúkolů (dva paralelní koncepty).
(2) „barva=priorita" znamená jen že priorita je vizualizovaná okrajem; barva
(user-color) je samostatný akcent, schema drží „barva ≠ priorita".

---

## B) Tvé konkrétní otázky — přímé odpovědi

1. **Dnes/Úkoly sloučení?** ❌ **Jen koncept** (dokument ANALYZA, dodatek).
   V kódu nic: `/`, `/ukoly`, `/nadchazejici` jsou tři samostatné routy,
   žádné záložky, žádný Zásobník, nedatované pořád padají do Dnes. Hotová je
   jen dílčí oprava (kalendář Nadcházejících ukazuje i minulost).

2. **Admin — lidé s popisem a oblastmi pro AI směrování?** ❌ **Jen demo
   konstanta.** Reálně má osoba jen `users.jobTitle` (volný text) a
   `role` enum (oprávnění). Pole „oblasti/expertíza" existuje jako natvrdo
   zadaná konstanta `AREAS` v `mail/PersonCard.tsx` pro 6 demo osob — neukládá
   se, není editovatelné, není napojené na žádný AI routing (AI není vůbec
   napojená).

3. **Má všechno log + zálohuje se?** ⚠️ **Částečně, zálohu nemá vůbec.**
   - `task_activity` = jediný reálný append-only log, ale **zapisuje se JEN
     z detailu úkolu** → vytvoření, odškrtnutí v seznamu, hromadné akce,
     řetězce postupů **historii nezanechají**.
   - `audit_events` (generická tabulka) je **zmigrovaná, ale MRTVÁ** — nikdo
     do ní nezapisuje ani nečte.
   - Komentáře nemají historii (edit přepíše). Mail se **neukládá vůbec**.
   - **Záloha/export: neexistuje žádná** — žádný export souboru, žádné Google
     Disk / externí úložiště. „O nic nemůžeme přijít" je dnes daleko od reality
     (mail, konverzace, většina změn se nikam trvale neukládá).

4. **Podpisy.** ⚠️ **Rozbité na dva nepropojené modely, oba demo.** Composer
   vybírá ze **3 natvrdo zadaných** podpisů (plný/krátký/žádný) — nemůžeš
   definovat vlastní ani mít různé podpisy per schránka. V Nastavení mailu je
   karta „Podpisy", ale tlačítko „Upravit" jen vyhodí toast (nic neukládá).
   Tvůj požadavek (víc podpisů dle schránek edcb/t-group/club vision/osobní,
   editovatelných v Nastavení) → potřebuje nový model. Plán v části E.

5. **Cc/Bcc rozbalení na řádky.** ⚠️ **Půl na půl.** Ve **vlákně** (odpověď)
   se Cc/Bcc **rozbalí** na samostatný řádek. V okně **Nová zpráva** tlačítko
   „Kopie" jen vyhodí toast („přijde s M2") — **nerozbalí se**. Sjednotím.

6. **Našeptávání příjemce / kontakty.** ❌ **Fake.** Placeholdery slibují
   „našeptává z kontaktů", ale **žádný autocomplete ani adresář neexistuje**.
   Kontakty jsou jen seed konstanty bez úložiště. Souhlasím, že práce s
   kontakty je slabá — robustní plán v části D.

7. **Kontextové menu (dvouprstý klik).** ⚠️ **Jen v mailu.** `onContextMenu`
   je v celé appce na jediném místě — mailový řádek. Úkoly, seznamy, kalendář
   ani projekty menu nemají (úkoly mají jen swipe + „sched" popover). Plán:
   sdílená komponenta + akce, část F.

8. **Kalendář „Celý den".** ⚠️ **Částečně.** Už je strop (max 2 pruhy + „+N"),
   ale architektura je pořád „dvě pásma": vícedenní události = vyčleněné pruhy
   NAD chipy (ne překryvné linky). Tvůj model (max 3 na den, překryvné linky,
   kde přetéká → linka zmizí a udělá místo kartě) není. Navíc přetečená
   vícedenní událost v týdnu **úplně zmizí a nejde otevřít**. Plán v části G.

---

## C) Co ještě chybí z celého vlákna (prioritizováno)

### P0 — MVP-blok / bezpečnost (reálná vrstva)
- **Štítky R7**: schema existuje, ale **není v sync-config** (nesynchronizuje)
  ani ve filtru toolbaru → invariant R7 + MVP DoD nesplněno.
- **Bezpečnost list-tabulek** (audit S7): `list_items/list_sections/lists`
  nevalidují workspace `list_id/section_id/who_id` → lze zapsat cross-tenant
  referenci. Doplnit validaci v `apps/api/powersync.ts`.
- **AI doplnění quick-addu**: DoD žádá „lokálně rozloží + AI doplní + náhled";
  AI vrstva 0× (žádný `@anthropic` v apps/api). (Nebo přeřadit celou AI do v2.)

### P1 — MVP invarianty, potřebují PRODUKTOVÉ rozhodnutí
- **R2 bulkAssign** (S2): hromadné přiřazení ničí `shared_all` účast a nabízí
  členy workspace místo projektu → server 403.
- **R2 toggleTask fallthrough** (S3): neúčastník přes hromadné „Hotovo" obejde
  odvozené dokončení.
- **R4 rekurence** (S4): některé posuny termínu (bulk, kalendář `+ Přeplánovat`)
  hnou kotvou celé řady bez dotazu „tento / a další / celá řada".
- **Undo chainů**: dokončení kroku postupu vyžaduje 2× ⌘Z (sloučení patří do
  `tasks.ts toggleTask`).

### P2 — funkce / UX
- Dnes+Úkoly sloučení (viz A).
- Kontextové menu na úkolech (část F).
- Kalendář „Celý den" redesign (část G).
- Podpisy per schránka (část E).
- Kontakty + našeptávání (část D).
- Logování všude + `audit_events` napojit; zálohování/export.
- Velin urgentní KPI sladit s NotifCenter; CalendarWidget filtr firmy; undo
  action-toast TTL 10 s.

### Mail (dnes 95 % demo, reálný backend = program M1–M3 po MVP)
- Vlákna, zprávy, schránky, kontakty, identity, podpisy, admin přístupy —
  nic se trvale neukládá (mimo per-prohlížeč localStorage pro drafty/podpisy/
  přečtenost). Reálně přežije jen **úkol z mailu** (běžný task v DB).

---

## D) Robustní plán — Kontakty & příjemci v mailu

**Problém:** žádný adresář, žádné našeptávání, kontakty = seed konstanty.

**Návrh (fázovaný, aby dával hodnotu i před reálným mail backendem):**

- **Fáze 1 — reálný model kontaktů (teď, i bez mail backendu):**
  nová tabulka `contacts` (id, workspace_id/sphere, name, email, org, role,
  areas text[], avatar, source, created_at) + PowerSync + apps/api. Naplní se
  (a) z členů workspace (už reálné) + (b) ručně přidané + (c) později
  automaticky z odeslaných/přijatých mailů (až bude mail backend).
- **Fáze 2 — našeptávání:** komponenta `RecipientInput` (To/Cc/Bcc): fulltext
  přes `contacts` (jméno/email/org), klávesnice ↑↓/Enter, chip po výběru,
  externí doména varování (už existuje), „přidat jako nový kontakt".
- **Fáze 3 — správa kontaktů:** obrazovka/sekce Kontakty: CRUD, skupiny/
  distribuční listy, oblasti (napojení na AI směrování — část B/2), historie
  komunikace (až s mail backendem), sloučení duplicit.
- **Fáze 4 — obohacení (s mail backendem M2):** auto-kontakty z komunikace,
  „naposledy s tebou psal", řazení návrhů dle frekvence.

**Rozhodnutí:** dělat Fázi 1–2 teď (reálný adresář + našeptávání) jako
foundation, nebo počkat na mail backend? (viz dotazník Q4)

---

## E) Plán — Podpisy per schránka

- **Model:** `signatures` (id, scope = mailbox-id / identity / „osobni",
  název, body text[]) — víc podpisů, každý přiřazený ke schránce/identitě.
- **Nastavení:** reálný editor v Nastavení (přidat/upravit/smazat, výběr
  výchozího per schránka) — nahradí fake „Upravit" toast.
- **Composer/doSend:** `SigPicker` čte `signatures` filtrované na aktivní
  identitu; zvolený se připojí při odeslání (append už funguje).
- **Persistence:** buď reálná DB (přežije všude), nebo demo localStorage
  (rychlé, konzistentní s tím, že mail je demo). Rozhodnutí Q5.
- **Identity edcb / t-group / club vision / osobní:** dnes demo zná jen
  4 T-Group schránky — víc-organizační identity je potřeba přidat do modelu
  schránek (souvisí s mail backendem / admin konfigurací).

---

## F) Plán — Kontextové menu (dvouprstý klik) napříč aplikací

- **Sdílená komponenta** `ContextMenu` (dnešní `mail/CtxMenu` je svázaná s
  `useMail()`/demo) — generická: pozice, klávesy, klik-mimo/Esc, položky.
- **Úkoly** (`TaskItem`/`TaskCard`, reálná data): Otevřít, Hotovo/Vrátit,
  Termín (dnes/zítra/př. týden/vlastní), Přiřadit, Priorita 1–4, Barva řádku,
  Přesunout do projektu, Duplikovat, Kopírovat odkaz, Smazat.
- **Rozšíření:** Seznamy (položky/karty), Kalendář (chip v buňce), Projekty,
  Board (kanban karty).
- Konzistence se swipe akcemi (stejné akce, jiný vstup).

**Rozhodnutí:** rozsah (jen úkoly / všude) + výchozí sada akcí. Q7.

---

## G) Plán — Kalendář „Celý den" (dle tvého popisu)

Cílový model (varianta B): **jeden per-den rozpočet = max 3 položky**, pak
„+X dalších". Vícedenní celodenní událost je defaultně **tenká překryvná
linka** protínající sloupce; v každém DNI, kde je rozpočet plný, se linka na
tom segmentu **nekreslí** a událost se v tom dni ukáže jako **textová karta**;
přetok → „+X" (a MUSÍ jít otevřít — dnešní bug: přetečená vícedenní zmizí
a nejde otevřít). Tím se zruší vyčleněná pásová výška a **uvolní místo časové
mřížce**. Je to redesign layoutu pásu v `Calendar.tsx`, ne jen změna konstant.

---

## H) DOTAZNÍK — co potřebuju od tebe rozhodnout

> U každé je moje **doporučení** tučně. Stačí odpovědět čísly, např. „Q1: A, Q2: B…".

**Q1 — Dnes + Úkoly sloučit?**
- A) **Ano, plný model** se záložkami Dnes / Vše / Zásobník (nedatované ven z Dnes)
- B) Jen přidat Zásobník nedatovaných, obrazovky nechat
- C) Ne, nechat tři samostatné
- *Doporučení: **A**, ale až po zbytku P0 (mění zavedené chování Dnes).*

**Q2 — Mail: kdy reálný backend?** (dnes 95 % demo, nepřežije reload)
- A) Postavit reálný mail backend teď
- B) **Až po dokončení MVP zbytku appky** (dle plánu M1–M3)
- C) Nechat demo, jen vylepšit UX (Cc/Bcc, podpisy, kontakty jako demo)
- *Doporučení: **B** pro plný backend; mezitím vylepšit UX (C) na demo vrstvě.*

**Q3 — Zálohování + Google Disk + logování:**
- A) Teď: napojit `audit_events` (vše), export, Google Drive integrace
- B) **Nejdřív dokončit interní logování** (task_activity všude + audit_events živé), export/Google Drive až potom
- C) Celé post-MVP
- *Doporučení: **B** — bez kompletního interního logu nemá smysl řešit externí zálohu; Google Drive napojení je realistické až s reálným backendem.*

**Q4 — Kontakty + našeptávání:**
- A) **Reálný adresář teď** (tabulka contacts + našeptávání) jako foundation
- B) Až s mail backendem
- C) Zatím jen našeptávat z existujících členů týmu (bez nové tabulky)
- *Doporučení: **A** (Fáze 1–2) — hodnota i bez mailu, a připraví AI směrování.*

**Q5 — Podpisy: kde persistovat?**
- A) Reálná DB tabulka `signatures`
- B) **Demo localStorage** v Nastavení mailu (rychlé, konzistentní s demo mailem)
- *Doporučení: **B** teď, migrovat na A s mail backendem.*

**Q6 — Oblasti/expertíza osob pro AI směrování — přidat do reálného schématu teď?**
- A) **Ano** (tabulka/sloupec `areas`) jako foundation, i když AI ještě není napojená
- B) Až s AI vrstvou
- *Doporučení: **A** — levná foundation, viz mail-integrační plán (Kroky 2–4).*

**Q7 — Kontextové menu na úkolech:**
- A) **Ano, všude** (úkoly + seznamy + kalendář + projekty)
- B) Jen úkoly
- C) Ne, swipe + detail stačí
- *Doporučení: **A** přes sdílenou komponentu; začít úkoly.*

**Q8 — Kalendář „Celý den" model:**
- A) **Varianta B** (per-den rozpočet 3, překryvné linky, přetok → karta + „+X") — dle tvého popisu
- B) Jen ztenčit stávající pruhy
- *Doporučení: **A**.*

**Q9 — MVP invariantní bugy (R2 bulkAssign/toggle, R4 rekurence):**
- A) **Blokovat rizikové akce** + u rekurence nabídnout dialog tento/další/řada
- B) Jen blokovat, dialog později
- C) Nechat
- *Doporučení: **A**.*

**Q10 — Štítky R7 (MVP DoD): dodělat sync + filtr teď?**
- A) **Ano** (P0, je to invariant + DoD)  B) Post-MVP
- *Doporučení: **A**.*

**Q11 — `checklist_items` vedle podúkolů:**
- A) Nechat oba (checklist = lehká odškrtávací položka, podúkol = plný úkol)
- B) Zrušit checklist, vše přes podúkoly
- *Doporučení: **A** (mají jiný účel) — jen upřesnit v memory.*

**Q12 — AI doplnění quick-addu (MVP DoD):**
- A) Napojit teď (Claude API)  B) **Přeřadit celou AI do v2**
- *Doporučení: **B** — AI zatím nikde není; nedělat jednu izolovanou AI funkci.*
