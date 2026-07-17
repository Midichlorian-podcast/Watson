# Rules & Automation Engine — provozní runbook

## Co je zdroj pravdy

- `automation_rules.draft_config` je měnitelný koncept. Koncept nikdy neběží.
- Publikace vytvoří nový, neměnný řádek v `automation_rule_versions`.
- Každou revizi konceptu lze publikovat právě jednou. Opakování stejného požadavku i souběžný požadavek s jiným operation ID vrátí existující snapshot.
- `automation_runs.rule_version_id` připne každý běh ke konkrétní verzi. Pozdější změna draftu ani další publikace historický či rozběhnutý běh nezmění.
- Spouštěcí událostí je autoritativní `audit_events` zápis uživatele. Systémové zápisy enginu se znovu nespouštějí.

## Podporovaný rozsah v1

Spouštěče:

- vytvoření úkolu;
- dokončení úkolu;
- znovuotevření úkolu.

Podmínky se skládají logickým AND:

- přesná priorita;
- přítomnost pevného termínu;
- přítomnost řešitele.

Akce:

- změna priority;
- plánované datum jako kalendářní offset v uložené IANA zóně, volitelně s přepsáním;
- komentář autora publikované verze.

Přiřazování podle role či vytížení, SLA, časovače a eskalace jsou podle scope locku záměrně mimo engine. Engine neobsahuje employee score ani skryté hodnocení člověka.

## Bezpečnostní model

Pravidlo mohou číst členové konkrétního projektu. Vytvořit, upravit, publikovat, pozastavit a vrátit běh může project manager nebo projektový člen, který je současně workspace admin/owner. Workspace admin bez project membership restricted projekt neuvidí.

Při každém běhu se znovu ověřuje, že autor publikované verze má stále managerské oprávnění. Odebrané oprávnění vede k `failed / publisher_permission_revoked`; žádná business mutace nevznikne.

## Preview, provedení a Undo

Preview načte aktuální task, vyhodnotí podmínky a vrátí lidský seznam změn. Nezakládá run ani audit, protože nic nemění.

Skutečný běh zamkne run i task, znovu vyhodnotí podmínky a provede všechny akce v jedné databázové transakci. Úspěch uloží veřejný typ změn, ale systémový audit neukládá tělo automatického komentáře.

Undo je dostupné 24 hodin. Před vrácením ověří, že hodnoty stále odpovídají výsledku běhu. Později ručně změněný task nebo komentář skončí `undo_stale`; Watson cizí novější práci nepřepíše.

## Provoz a diagnostika

Worker běží po pěti sekundách a v jednom procesu nepřekrývá dva cykly. Databázový unikát `(rule_version_id, event_id)` brání duplicitě i mezi více instancemi. Stav běhu je `queued → running → succeeded|skipped|failed`, případně `succeeded → undone`; DB trigger jiné přechody odmítne.

V detailu pravidla jsou poslední běhy a počty úspěchů/chyb. `conditions_not_met` a `no_change` jsou očekávané `skipped`, nikoli provozní chyba. `publisher_permission_revoked`, `invalid_published_config` a `automation_execution_*` vyžadují kontrolu správce.

## Rollback

1. Pozastavte dotčené pravidlo. Pozastavené pravidlo nové běhy nefrontuje.
2. U nezměněných běhů použijte jednotlivé Undo.
3. Pokud je Undo stale, proveďte vědomou ruční opravu; nepřepisujte novější data databázovým skriptem.
4. Při globální havárii zastavte automation worker, nikoli celé task jádro. Již rozběhnuté transakce buď celé commitnou, nebo celé rollbacknou.
5. Migraci nemažte za provozu: audit a procesní historie jsou součástí vysvětlitelnosti.
