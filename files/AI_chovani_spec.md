# Specifikace chování AI (pravidla pro Claude Code)

> Vychází z vyplněného `zadani_ai_autonomie.md` (24. 6. 2026). Doplňuje §10 hlavní build-ready specifikace. Tohle jsou závazná pravidla — nadřazená jakémukoli „chytrému" chování modelu.

## 0. Celkový postoj
**Vyvážený (ručně upravený) a transparentní.** Klíčový fakt: **žádná schopnost není „Auto (tiše)"** → **AI nikdy nedělá nic neviditelně.** Každá samostatná akce buď čeká na schválení, nebo se provede a okamžitě o ní přijde upozornění a jde vrátit.

## 1. Dva režimy provedení (jak se úrovně chovají v kódu)
- **Navrhnout (suggest):** AI vytvoří **`AISuggestion`** (stav `pending`). Nic se nezmění, dokud uživatel nepotvrdí. Zamítnutí = `dismissed`.
- **Auto + info (auto_notify):** AI akci **provede**, ale zároveň (a) zapíše **`AuditEvent`**, (b) pošle **upozornění** (in-app/inbox), (c) akce je **vratná (undo)** po nastavené okno.
- **Vypnuto (off):** AI tuhle činnost nedělá vůbec — ani nenavrhuje.

> Pozn.: „Auto (tiše)" v této konfiguraci **nepoužíváme** (0 položek). Kdyby se v budoucnu zapnulo, znamenalo by provést bez upozornění — ale i pak platí mantinely níže.

## 2. Tvrdé mantinely (platí VŽDY, bez ohledu na úroveň)
Vynucovat **server-side** před každou AI akcí:
- **AI NIKDY:** nesmí **mazat úkoly**, **psát ani odpovídat externím lidem** (klienti/rodiče/hosté), **měnit oprávnění a role.** Tyto kategorie jsou zakázané absolutně — i kdyby úroveň schopnosti naznačovala jinak.
- **Tiché hodiny:** v **noci a o víkendech** AI **nedělá žádné auto akce a neruší** (notifikace odložit na pracovní dobu). Týká se jen `auto_notify` a aktivních upozornění; pasivní návrhy (`pending`) můžou vznikat, ale neupozorňují.
- **Vratnost:** **každá** AI akce musí jít **vrátit (undo)** — vždy. Akce bez možnosti undo se neprovede.
- **Změna cizích úkolů:** povolená (nebyla v zákazu), ale **vždy s upozorněním dotčené osobě** (plyne z „žádné tiše").
- **Kdo konfiguruje AI:** **admin + manageři.** Běžný člen úrovně ani mantinely nemění.
- **Audit:** **logovat všechny** AI akce (kdo/co/kdy, návrh i provedení) do `AuditEvent`.
- **Rozsah nastavení:** **per workspace** — každý workspace má vlastní úrovně i mantinely (config tabulka `AiPolicy` na workspace).

## 3. Úrovně po schopnostech (závazné výchozí hodnoty)

### Vypnuto (AI nedělá)
- **C2** Přehodnotit priority existujících úkolů
- **D2** Přiřadit úkol člověku automaticky

### Navrhnout (návrh → schválení)
- **A2** Rozpad velkého úkolu na podúkoly
- **A3** Vytvořit úkol z e-mailu / zprávy
- **A5** Sloučit duplicitní úkoly *(navíc: sloučení musí být plně vratné — drží data obou)*
- **B2** Naplánovat úkol do kalendáře (time-block)
- **B3** Uspořádat / přeplánovat den
- **B4** Posunout termín prošlého úkolu
- **B5** Přerozdělit úkoly při přetížení
- **D1** Navrhnout, komu úkol přiřadit
- **D3** Eskalovat prošlý úkol na vedoucího
- **E1** Připomenout lidem jejich úkoly (nudge)
- **F1** Archivovat hotové úkoly
- **F2** Uklidit / oštítkovat nezařazené
- **F3** Aktualizovat stav úkolu podle aktivity
- **G3** Upozornit na úzká hrdla / nespolehlivost

### Auto + info (provede, upozorní, jde vrátit)
- **A1** Vyplnit rozpoznané atributy z věty (quick add) *(uživatel je vidí a může opravit před uložením)*
- **A4** Navrhnout projekt / sekci / štítky
- **B1** Navrhnout termín novému úkolu
- **B6** Nastavit / upravit připomínky
- **C1** Navrhnout prioritu novému úkolu
- **C3** Určit denní zaměření
- **E2** Napsat draft komentáře / odpovědi *(jen draft, neodesílá — odeslání je akce uživatele)*
- **E3** Shrnout vlákno / diskuzi
- **E4** Shrnout, co tým udělal (standup)
- **E5** Upozornit na riziko skluzu / deadline
- **G1** Denní digest „co dnes řešit"
- **G2** Týdenní přehled / report
- **G4** Navrhnout zlepšení procesu

### Auto (tiše)
- — žádné.

## 4. Implementační poznámky pro Claude Code
- **`AiPolicy` (per workspace):** mapuje schopnost → úroveň + uložené mantinely; editovatelné jen admin/manager. UI = tento konfigurátor zabudovaný do nastavení workspace.
- **AI orchestrátor (backend):** před každou akcí ověří (1) tvrdé mantinely, (2) tiché hodiny, (3) úroveň schopnosti. Teprve pak `suggest` vs `auto_notify`.
- **`AISuggestion`:** fronta návrhů s akceptací/zamítnutím; UI „doručená pošta od AI".
- **Undo:** každá `auto_notify` akce ukládá inverzní operaci; undo okno (např. 24 h) konfigurovatelné.
- **Notifikace:** `auto_notify` → in-app + (dle uživatele) e-mail; respektovat tiché hodiny a digest preference uživatele.
- **Audit:** každý návrh i provedení → `AuditEvent` s aktérem `AI` a diffem.
- **E2 drafty:** AI generuje text, ale **nikdy neodesílá** externím lidem (mantinel) ani interně bez uživatele.
- **Fázování:** v MVP stačí jádro AI (quick add A1, digest G1). Zbytek je v2 (asistence) a režim agentů/rozšířená autonomie ve v3 — úrovně z této konfigurace se aplikují postupně, jak se schopnosti zapínají.

## 5. Doporučení
- Profil je vědomě **opatrně-vyvážený** a transparentní — dobrý start pro budování důvěry. Po pár týdnech provozu doporučuju projít znovu a tam, kde se AI osvědčí, povolit víc (např. některé `suggest` → `auto_notify`).
- Hlídej **A5 (sloučení duplicit)** a **F3 (změna stavu dle aktivity)** — i když jsou na „navrhnout", jsou datově citlivé; undo a jasný náhled změny jsou tu povinné.
