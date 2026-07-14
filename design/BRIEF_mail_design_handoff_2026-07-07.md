# Watson Mail — Design Handoff (pokyny pro Claude Design)

> ⚠️ **REVIDOVÁNO 2026-07-08 — čti napřed.** Aktuální a podrobnější zdroj = **`design/BRIEF_mail_moduly_2026-07-08.md`**
> (+ feasibility `files/MAIL_moduly_audit_2026-07-08.md`). Kde tento handoff říká **„mail jen v týmové
> sféře"** / **„osobní prostor a Host bez mailu"**, platí novější: mail má **DVĚ sféry** — týmová +
> **osobní (soukromá, šifrovaná at-rest, bez AI, mimo admin)**; Host = bez mailu. Nové: modul „Dění" a
> systém urgence (P1–P4 + SLA + eskalace, P1/P2→úkol).

> **Účel:** pokyny, aby Claude Design mohl **začít navrhovat mailové obrazovky** Watsonu.
> Aktuální kód, schéma a stav si Claude Design načte z GitHubu — tento dokument dodává **záměr, funkce,
> cíle, guardraily a seznam obrazovek k návrhu.** Zaměřeno na **co mail umí, jak je napojen na Watson,
> jaké má funkce a jak dosahuje cílů.**
>
> **Drž stávající design systém:** shell (sidebar + header + mobilní spodní lišta), tokeny `--w-*`,
> komponenty (TaskCard, chipy, checkbox, prioritní odznak, modaly, boční panely), světlý + tmavý režim,
> CZ/EN. Mail **rozšiřuje** existující „Schránku", NEzakládá nový shell.

## 0. Kde v repu je pravda (načti z GitHubu)

| Co | Kde |
|---|---|
| Identita, tokeny, komponenty, hlas | `design/handoff_watson/` + `files/CLAUDE.md` (sekce Identita) |
| Datový model + strategie mailu | `files/MAIL_integracni_PLAN.md` + `files/MAIL_implementacni_plan_2026-07-07.md` |
| Konsolidovaný spec mailu | `files/WATSON_MAIL_KONSOLIDOVANY_SPEC.md` |
| Stav appky (na co mail navazuje) | `files/MAIL_handoff_pro_design.md` + `files/AUDIT_2026-07-07.md` |
| Invarianty R1–R9 | `files/CLAUDE.md` |

## 1. Koncept — co Watson Mail JE

Mail **není druhá appka přilepená vedle**. Je to **„orgán" Watsonu**: sdílené týmové schránky, kde je
e-mail first-class objekt propojený s úkoly, projekty a lidmi. Cílová persona = provozní tým
(kavárna, granty, podcast, studia), který zvládá **sdílené schránky bez chaosu** — s jasnou atribucí,
směrováním a návazností na práci.

**Vstupní bod už existuje:** „Schránka" je v navigaci (dnes inbox-triage úkolů) — mail ji rozšíří.

## 2. Jak je napojen na Watson (integrace)

- **Sféry:** mail je **jen týmová sféra** — schránky visí na **týmu**, ne na osobě. Osobní prostor a
  **Host pohled = bez mailu** (vizuálně jasně odlišit osobní vs. týmovou sféru i guest pohled).
- **Entity graf:** „**udělej z mailu úkol**", „projekt ↔ konverzace" — thready se propojují s
  úkoly/projekty. Úkol vzniklý z mailu nese kontext threadu (odkaz zpět).
- **Identita per tým:** zobrazené jméno + podpis se liší podle týmu/schránky. U composeru **From
  nejde měnit** — jen viditelné „odpovídáš jako info@…".
- **Sdílené komponenty a shell:** sidebar, header, karty/chipy/panely, tmavý režim, CZ/EN.
- **Provázaný stav:** stav threadu (Nový / Otevřený / Čeká interně / Odesláno / Hotovo) je analogií
  stavu úkolu (R9) — jeden viditelný stav napříč mailem i úkolem.

## 3. Co mail umí (funkce) — po fázích

**M1 — jádro + bezpečnost**
Připojení účtů (jen super-admin), **sjednocená schránka**, čtení/psaní e-mailů, identita
From/jméno/podpis, lokální fulltext, **per-schránka vypínač AI**, connection-health dashboard,
onboarding wizard připojení schránky, command palette + klávesové zkratky + swipe gesta, tmavý režim,
revocation (zrušení přístupu smaže lokální kopii).

**M2 — týmový režim a dispečink**
**Žebřík oprávnění** (typy grantu: vlastník / plný agent / scoped agent / per-thread delegát /
interní spolupracovník), akce **Assign / Share / Ask**, **thread workspace (vlajková obrazovka)**,
**collision detection** (dva lidé píší témuž), **„udělej z mailu úkol"**, projekt ↔ konverzace,
**dispečink** (přiřazené/nepřiřazené, nízká jistota AI, hromadné akce), **send-as-team**
(round-robin + SLA), schvalovací krok, one-click odpovědi, náhled odkazů.

**M3 — automatizace a hloubková AI**
**Kompetenční směrování** (AI routuje úkoly dle oblastí odpovědnosti, vždy s „proč" + feedbackem),
awareness → **denní digest**, pravidla v přirozeném jazyce, **detekce follow-upů**, unified search
(**Ask AI**), návrh odpovědi z RAG (dřívější e-maily/Drive), audit & analytics per schránka,
snooze/mute, ranní briefing.

## 4. Jak dosahuje cílů (proč tak)

| Cíl | Jak ho mail plní |
|---|---|
| **Sdílená schránka bez chaosu** | Dispečink (kdo co řeší) + collision detection + atribuce reálného odesílatele i u sdílené From |
| **Nic nepropadne** | Mail → úkol, detekce follow-upů, stav threadu provázaný se stavem úkolu |
| **Správná osoba dostane správný mail** | Kompetenční směrování (oblasti odpovědnosti + AI routing, vždy s vysvětlením a možností korekce) |
| **Bezpečnost a soukromí** | „Co nevidíš, v UI neexistuje" (hranice na úrovni dat, ne CSS), credentials v šifrovaném vaultu, každé odeslání auditované, **AI nikdy neodesílá externě** (generuje draft, člověk odešle) |
| **Zapadá do Watsonu** | Sdílený shell/tokeny/komponenty; mail rozšiřuje „Schránku", nezakládá nový svět |

## 5. Obrazovky k navržení (priorita)

1. **Thread workspace — VLAJKA.** 4 vrstvy: (a) e-mailové vlákno, (b) composer s **AI draftem**,
   (c) **interní chat** k threadu (@mention, neviditelný externímu odesílateli), (d) **lišta stavu**
   (stav threadu, přiřazení, akce Assign / Share / „udělej úkol").
2. **Sjednocená schránka / dispečink** — přiřazené vs. nepřiřazené, filtry, hromadné akce,
   low-confidence AI návrhy.
3. **Lidé & Týmy** — roster, oblasti odpovědnosti.
4. **Access matrix** — kdo má jaký grant ke které schránce.
5. **Admin konzole** — připojené schránky, connection-health, super-admin akce.
6. **Připojení schránky** — onboarding wizard (Gmail / M365 / IMAP).
7. **Kompetenční směrování** — návrhy AI + „proč" + feedback.

## 6. Guardraily (design NESMÍ porušit)

- Mail jen v **týmové** sféře; osobní prostor a **Host bez** mailu/governance.
- **„Co nevidíš, v UI neexistuje"** — žádné zašedlé „nemáš přístup".
- **From v composeru nejde měnit** — jen „odpovídáš jako …".
- **AI = draft, člověk odesílá** (žádné auto-send).
- Vizuálně **oddělit osobní vs. týmovou sféru** a guest pohled.

## 7. Realistická data pro mockupy (CZ, ne lorem ipsum)

- **Schránky:** `info@`, `granty@`, `podcast@`, `kavarna@`
- **Lidé/role:** Adam (admin), Projektový manažer, Barista, Grantový specialista, Editor podcastu
- **Předměty threadů:** „Faktura za nájem — červenec", „Nabídka spolupráce (podcast)",
  „Reklamace objednávky", „Výzva OP JAK — deadline"
- **Stavy threadu:** Nový · Otevřený · Čeká (interní) · Odesláno · Hotovo
- **Odznaky na kartě threadu:** přiřazená osoba (avatar), „AI navrhlo odpověď", „follow-up za 2 dny",
  SLA odpočet

---

## 8. Pořadí návrhu (doporučení)

Začni **Thread workspace** (vlajka — určí jazyk celého mailu), pak **sjednocená schránka /
dispečink**, dál **Lidé & Týmy → Access matrix → Admin konzole → Připojení schránky →
Kompetenční směrování**. Po každé obrazovce sesouhlas s tokeny a komponentami stávajícího shellu.

*Stav dokumentu: v1, 2026-07-07. Autoritativní pro záměr/UX mailu; datový model a kód viz odkazy v §0.*
