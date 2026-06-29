# Porovnání: náš nástroj vs. Todoist · Asana · Notion

> Cíl dokumentu: realisticky nastavit očekávání a říct, **kam investovat** (kde se odlišíme) a **kde mezery přijmout** (kde nemá smysl soupeřit). Poctivě.

## Výchozí realita
Nestavíme „Todoist + Asana + Notion killer". Stavíme **fokusovaný interní nástroj** šitý na vaše procesy, s několika konkrétními výhodami (čeština, barvy, dva režimy přiřazení, vlastnictví dat, napojení na váš stack). Velcí hráči mají roky vývoje, desítky až stovky lidí v týmu a vyladěný ekosystém. **V šíři, vyladěnosti, mobilu a zralosti budeme zaostávat — a to je v pořádku, pokud vyhrajeme tam, na čem nám záleží.**

Pozicování ve zkratce:
- **Todoist** — nejlepší osobní/lehký týmový task manager; vyladěné parsování, opakování, sync, mobil.
- **Asana** — týmové projektové řízení; workload, portfolia, automatizace, formuláře, reporting, schvalování.
- **Notion** — dokumenty + databáze + wiki; relace, rollupy, flexibilní struktura. Jiná kategorie.
- **Náš nástroj** — task+kalendář+tým na míru EDCB/T-Group, offline-first, česky, s vlastními daty.

---

## Srovnání po oblastech

| Oblast | Todoist | Asana | Notion | Náš nástroj (plán) |
|---|---|---|---|---|
| Úkoly, podúkoly, priority | ✅ špička | ✅ | ⚠️ přes DB | ✅ dorovnáme |
| Více přiřazených (2 režimy) | ❌ | ❌ | ❌ | ✅ **předčíme** |
| Quick add přirozený jazyk | ✅ (nově i CZ) | ⚠️ | ❌ | ✅ **CZ first, vč. filtrů** |
| Barevný/grafický systém | ⚠️ slabý | ⚠️ | ✅ | ✅ **předčíme (záměr)** |
| Opakování (edge-casy) | ✅ špička | ⚠️ | ❌ | ⚠️ **zaostaneme zpočátku** |
| Pohledy List/Board/Cal | ✅ | ✅ +Gantt/Timeline | ✅ | ✅ MVP, Gantt až v2 |
| Workload / kapacita | ❌ | ✅ | ❌ | ⚠️ v2, méně vyladěné |
| Obousměrný Google Cal | ✅ | ✅ | ⚠️ | ✅ dorovnáme (core) |
| Time-blocking / AI plánování | ❌ | ⚠️ | ❌ | ✅ v2 (Suggest) |
| Automatizace / pravidla | ⚠️ | ✅ bohatá | ⚠️ | ⚠️ v2, užší |
| Formuláře (intake) | ❌ | ✅ | ✅ | ⚠️ v2 |
| Reporting / dashboardy / portfolia | ⚠️ (Karma) | ✅ silné | ⚠️ | ⚠️ v2, základní |
| Dokumenty / databáze / relace | ❌ | ⚠️ | ✅ špička | ❌ **zaostaneme (záměr, v2/v3)** |
| Schvalování / proofing | ❌ | ✅ | ❌ | ⚠️ v2 |
| Offline-first + sync zralost | ✅ roky vyladěné | ⚠️ | ⚠️ | ⚠️ **zaostaneme zpočátku** |
| Nativní mobil + widgety + hodinky | ✅ | ✅ | ✅ | ❌ **zaostaneme (web/PWA, nativní až v3)** |
| Šíře integrací | ✅ 80+ | ✅ 300+ | ✅ stovky | ❌ **pár vybraných** |
| Vlastnictví dat / self-host | ❌ | ❌ | ❌ | ✅ **předčíme** |
| Cena při růstu (per-seat) | ⚠️ | ⚠️ drahé | ⚠️ | ✅ **plochá, předčíme** |
| Napojení na váš stack (Lucky OS, iDoklad, Spark) | ❌ | ❌ | ❌ | ✅ **na míru, předčíme** |
| Bezpečnost/compliance (SSO/SCIM/SOC2) | ✅ (Business) | ✅ | ✅ | ❌ **vynecháno (záměr)** |
| Zralost, uptime, podpora | ✅ | ✅ | ✅ | ⚠️ **nové, riziko** |

Legenda: ✅ silné · ⚠️ částečné/později · ❌ chybí.

---

## Kde dorovnáme nebo PŘEDČÍME (kam investovat)

1. **Čeština napříč AI.** Quick add i **filtry z české věty** — Todoist umí parsovat česká data, ale **české filtry ne**. Tady máme jasnou výhodu.
2. **Dva režimy více přiřazených.** „Kdokoli vyřeší" vs. „každý zvlášť" — tohle nemá ani Todoist, ani Asana, ani Notion. Přímý zásah do vašich provozů (trenéři/baristé).
3. **Barevný/grafický systém.** Záměrně first-class — přesně to, co uživatelům Todoistu chybí.
4. **Vlastnictví dat + self-host + plochá cena.** Žádný per-seat; můžete přidat 50 rodičů/brigádníků zadarmo; data u vás.
5. **Napojení na váš vlastní stack.** Lucky OS (T-Group), iDoklad, Spark, AdamOS — bespoke integrace, které žádný SaaS neudělá.
6. **Šité na vaše workflow.** Studia, kavárna, food truck, podcast, granty — UI a šablony na míru, ne obecný nástroj.

## Kde reálně ZAOSTANEME (a jak moc to vadí)

1. **Nativní mobil a vyladěnost. — VYSOKÁ závažnost.** Začínáme web/PWA; Todoist/Asana/Notion mají roky laděné nativní appky, widgety, hodinky, sdílecí rozšíření. Pro lidi v terénu (trenéři, baristé na mobilu) musí být PWA opravdu dobrá, jinak to bolí. Nativní appky až v3.
2. **Zralost offline syncu a řešení konfliktů. — VYSOKÁ.** Todoist tohle ladí přes deset let. Náš sync bude zpočátku hrubší; hraniční případy (souběžné offline editace) se musí pečlivě otestovat, protože ztráta úkolu = okamžitá ztráta důvěry.
3. **Edge-casy opakování. — STŘEDNÍ.** Todoist je v oboru nejlepší. My to uděláme lépe v UX (this/all), ale pokrytí všech kombinací nás dožene až časem.
4. **Šíře integrací. — STŘEDNÍ.** Oni stovky, my pár vybraných. Vadí jen tehdy, když budete chtít napojit něco neobvyklého — pak je potřeba to dostavět.
5. **Reporting/automatizace/formuláře à la Asana. — STŘEDNÍ.** Asana má bohatou knihovnu pravidel, portfolia, workload, schvalování, proofing. My dodáme základ ve v2, ne hloubku.
6. **Dokumenty/databáze/relace à la Notion. — NÍZKÁ až STŘEDNÍ.** Notion je jiná kategorie; my docs/wiki řešíme okrajově (v2) a relační databáze až v3. Pokud byste chtěli Notion-styl znalostní bázi, nebude se nám rovnat.
7. **Vyhledávání, výkon ve velkém, přístupnost, jazyky. — NÍZKÁ.** Velcí mají vyladěný fulltext, desítky jazyků, špičkovou přístupnost. My CZ/EN a solidní základ.
8. **Bezpečnost/compliance pro velké organizace. — NÍZKÁ (záměr).** SSO/SCIM/SOC2 vynecháváme — pro malý interní tým irelevantní.
9. **Zralost, uptime, podpora. — TRVALÁ.** Nový systém nemá za sebou roky provozu. Zálohy, monitoring a jasný „kdo to spravuje" jsou povinnost, ne luxus.

---

## Které mezery jsou přijatelné a které rizikové

**Přijatelné (klidně ignorovat):**
- SSO/SCIM/compliance, Notion-class databáze, obří marketplace integrací, desítky jazyků. Nic z toho váš interní tým nepotřebuje k fungování.

**Rizikové (musíme ohlídat, jinak appka selže v praxi):**
- **Spolehlivost offline syncu** — je to jádro slibu. Když bliká, lidé se vrátí k Todoistu.
- **Použitelnost na mobilu (PWA)** — terénní lidé to chtějí na telefonu; PWA musí být skvělá.
- **Spolehlivost opakování a připomínek** — pokud úkoly „mizí" nebo se posouvají, ztráta důvěry.
- **Provoz a vlastnictví** — kdo to spravuje, zálohuje, opravuje. Bez toho je vlastní appka přítěž, ne výhoda.

---

## Závěr a doporučení

- **Investujte do toho, co vás odlišuje:** čeština/AI, barvy, dva režimy přiřazení, kalendář, napojení na váš stack, plochá cena. Tam vyhrajete.
- **Mezery jinde přijměte vědomě** a komunikujte je týmu (žádné iluze o „Notion uvnitř").
- **Tři rizikové oblasti** (sync, mobil/PWA, spolehlivost opakování/připomínek) berte jako kvalitativní laťku MVP — ne jako „doděláme potom".
- **Připomínka ekonomiky:** velká appka „se vším" je dlouhá a drahá stavba i provoz. Pokud se ukáže, že rizikové oblasti jsou nad síly, fallbackem zůstává buď fork open-source základu (Vikunja apod.), nebo tenčí appka na vašich 20 % + diferenciátory. Tahle spec míří na plnou verzi — ale je dobré vědět, že existuje i levnější cesta, kdyby bylo potřeba ubrat.
