# Decision Log — provozní a bezpečnostní runbook

Decision Log je kanonická stopa rozhodnutí z ručního zápisu, označeného komentáře nebo
lidsky schváleného výstupu porady. Není to chat ani editovatelný dokument. Název, zdroj,
projekt, autor a čas rozhodnutí jsou po vzniku neměnné; změna závěru vytváří nové rozhodnutí
přes `supersedes_id` a původní záznam zůstává v historii.

## Životní cyklus

- `active`: platné rozhodnutí; lze doplnit odůvodnění, vlastníka, účinnost, datum kontroly a
  vazby na úkoly stejného projektu.
- `superseded`: nahrazeno novým rozhodnutím; terminální stav.
- `withdrawn`: výslovně odvoláno nebo odznačeno u zdrojového komentáře; terminální stav.
- Smazaný zdroj nemaže snapshot. UI přizná, že zdroj už není dostupný. Smazání úkolu dočasně
  odstraní jeho vazby, ale serverový Undo je obnoví ze stejného atomického snapshotu.

## Oprávnění a izolace

Číst smí každý člen konkrétního projektu, zapisovat a revidovat role `editor` a `manager`.
Workspace členství samo o sobě přístup k restricted projektu nedává. API vrací při zápisu
do nepřístupného projektu `404`, aby nepotvrdilo jeho existenci. DB trigger nezávisle ověřuje
shodu workspace/project, členství autora a vlastníka, zdrojový komentář nebo poradu, vazby na
úkoly i přesný přechod verze.

## Retry, souběh a audit

`POST /api/decisions` a `PATCH /api/decisions/:id` vyžadují stabilní `operationId`.
Stejný payload vrací uložený výsledek, jiný payload se stejným ID končí `409`. Nahrazení
zamyká původní řádek `FOR UPDATE`, takže ze dvou souběžných náhrad uspěje právě jedna.
Revize používá `expectedVersion`; stale klient dostane `409`. Audit ukládá actor, scope,
request ID a strukturální metadata, nikdy titul ani text odůvodnění.

## Sync, export a obnova

`decisions` a `decision_task_links` se synchronizují pouze bucketem projektu. Command receipt
se do klienta nesynchronizuje. Autoritativní export formátu v3 zahrnuje rozhodnutí i task
vazby. Podepsaný export v2 se přijme bez těchto dvou tabulek; při restore se chybějící
komentářové snapshoty deterministicky doplní. Restore nejdřív proveď v režimu `dry-run`.

## Ověření

- `pnpm --filter @watson/api verify:decisions` — DB/API invarianty, tenant scope, cursor,
  souběh, meeting/comment zdroje, delete/undo a redigovaný audit.
- `pnpm --filter @watson/api verify:meeting-commands` — atomický meeting commit do tasků a
  Decision Logu.
- `pnpm --filter @watson/api verify:decision-ui` — Chromium/WebKit, ztracená odpověď,
  revize, nahrazení, deep-link, mobilní reflow a axe.
- `pnpm --filter @watson/api verify:export` — v3 export/restore a kompatibilita v2.

Při incidentu nevkládej obsah rozhodnutí do logů ani audit diffu. Podezřelé cross-tenant
selhání ověř přes SQLSTATE `23514` a request ID; záznam neopravuj ručním přepisem, ale novou
revizí nebo výslovným nahrazením.
