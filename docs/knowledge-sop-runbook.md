# Employee Knowledge & SOP — provozní a bezpečnostní runbook

## Zdroj pravdy a hranice produktu

- `knowledge_articles` drží jediný měnitelný koncept. Čtenářům se nikdy neposílá.
- `knowledge_article_versions` je neměnný snapshot vytvořený explicitní publikací. Rozpracovaná změna proto nemůže přepsat postup, který tým právě používá.
- Obsah je záměrně omezený na příručku, SOP nebo zásadu a nejvýše 50 pojmenovaných sekcí. Modul není Notion-like databázový builder, whiteboard, interní chat ani kancelářský balík.
- V1 je online server-authoritative povrch. Při nedostupném API ukazuje poctivý chybový stav a nevydává starý browser draft za aktuální publikaci.

## Role a publikum

- Číst publikovaný obsah může člen pracovního prostoru.
- Výchozí publikum `team` vylučuje hosty. Host uvidí jen snapshot, který správce výslovně publikuje jako `all_workspace_members`.
- Koncepty, správu, historii verzí a agregovaný stav potvrzení vidí workspace manager, admin nebo owner.
- Vytvořit, upravit, publikovat a archivovat může stejný managerský práh. Oprávnění se ověřuje serverem ve stejné transakci jako zápis.
- Vlastník znalosti musí být současný člen stejného prostoru nebo workspace owner. Server i DB odmítají cross-tenant vlastníka.

## Draft → Publish

Každá změna konceptu používá přesnou `draft_revision`. Souběžná nebo zastaralá editace skončí `stale_draft`; rozepsaná data zůstávají v otevřeném editoru. Write commandy mají user-bound operation ID, payload hash a trvalý receipt, takže ztracenou odpověď lze bezpečně zopakovat.

Publikace:

1. zamkne článek;
2. ověří roli, revizi, vlastníka a to, že existuje nepublikovaná změna;
3. vloží nový snapshot se sekcemi, publikem a pravidlem potvrzení;
4. teprve potom přepne aktuální publikovanou verzi;
5. uloží redigovaný audit bez textu dokumentu.

DB trigger kontroluje, že běžná publikace přesně odpovídá konceptu a že verze roste po jedné. Přímý update nebo delete publikovaného snapshotu odmítne; delete je povolen pouze jako vnořený FK cascade při odstranění celého parent/workspace.

## Potvrzení přečtení

- Potvrzení lze vyžádat volitelně pro konkrétní publikovanou verzi.
- Uživatel smí potvrdit jen aktuální, povinnou a pro něj viditelnou verzi.
- Nová publikace vyžaduje nové potvrzení; staré zůstává v historickém snapshotu.
- Správa zobrazuje pouze agregovaný počet vůči oprávněnému publiku. Nevzniká employee productivity score ani pořadí lidí.
- Retry potvrzení je idempotentní a audit ukládá pouze ID článku a číslo verze.

## Archivace a obnova obsahu

Archivace skryje článek čtenářům, ale nemaže verze ani potvrzení. Pro obnovení správce upraví koncept a publikuje novou verzi; archivovaná verze zůstane v historii. Modul nemá hard-delete endpoint.

## Export, restore a retention

Podepsaný export v3 zahrnuje články, verze a potvrzení, nikoli provozní command receipts. Restore vkládá článek před jeho snapshoty podle explicitního dependency order. Pouze podepsaná restore transakce nastaví transaction-local `watson.allow_knowledge_restore=on`; běžné API a SQL příkazy tuto výjimku nemají. Po vložení se stále uplatní FK, JSON shape, délky, typy a tenant scope.

Před změnou retenční politiky zohledněte, že potvrzení může být auditní důkaz. Smazání workspace odstraní celý jeho znalostní strom; PostgreSQL PITR a off-site retention řeší obecný backup runbook.

## Diagnostika

- `stale_draft`: načíst aktuální detail a vědomě znovu aplikovat rozepsanou změnu.
- `no_unpublished_changes`: koncept už odpovídá publikované revizi; nevytvářet prázdnou verzi.
- `knowledge_owner_not_member`: zvolit současného člena prostoru nebo vlastníka odebrat.
- `knowledge_ack_not_allowed`: načíst aktuální verzi; stará nebo skrytá publikace se nepotvrzuje.
- `knowledge_invariant_failed`: nepokračovat přímým SQL obcházením. Zkontrolovat strukturu sekcí, tenant vazby a migrace 0080/0081.
- `knowledge_unavailable`: zachovat rozepsaný editor otevřený, obnovit API/DB a zopakovat stejný operation ID se stejným payloadem.

## Povinné ověření releasu

1. `pnpm --filter @watson/api verify:knowledge` proti živému API a migrované DB.
2. `pnpm --filter @watson/api verify:knowledge-ui` proti živému webu v Chromium i WebKitu.
3. `node scripts/verify-knowledge-contract.mjs`.
4. `bash scripts/ci-api-integration.sh` a následně `pnpm gate`.

API důkaz pokrývá RBAC, draft leak, host publikum, CAS, retry, dvě verze, potvrzení, search, neměnnost DB, redigovaný audit a skutečný export/delete/restore obou verzí i potvrzení. Browser důkaz pokrývá create → edit → publish → acknowledge, historii, hledání, focus, WCAG A/AA, 390px overflow, 44px cíle a vizuální snímky v obou enginech.
