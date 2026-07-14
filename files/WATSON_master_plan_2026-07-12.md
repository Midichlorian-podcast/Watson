# Watson — Master plán „všeho" (2026-07-12)

_Výstup multi-agent workflow (4 domény → syntéza). Zdroj rozhodnutí; potvrdit s uživatelem._

## Přehled
Master plán slučuje čtyři domény (sdílený rich-text composer, deterministický Watson Radar + vycentrovaná karta, hlasové diktování, AI příkazová vrstva Claude) do pěti fází řazených podle pravidla „hodnota hned a bez závislostí první". Fáze 1–3 nepotřebují Claude klíč a dají uživateli okamžitě použitelné věci (formátovaný mail všude, chytrý radar pozornosti nad reálnými daty, diktování do polí). Fáze 4–5 zapnou AI teprve až uživatel dodá Claude klíč (příkazy nad mailem/úkoly, diktát→úkoly). Klíčová poctivost: mail je z ~95 % demo (seed + localStorage, reálně persistuje jen „úkol z mailu"), takže rich-text i AI příkazy nad mailem jsou zobrazovací/návrhové až do samostatné várky mail-persistence M1 — v plánu je to explicitně označeno u každé dotčené fáze.

## Fáze

### F1 — Sdílený rich-text composer (barevný text všude stejně)  ·  effort L  ·  bez klíče

**Cíl:** Jeden formátovací editor včetně barevného textu ve VŠECH čtyřech composerech (Nová zpráva, odpověď ve vlákně, mail peek, plovoucí composer) místo dnešního mixu holého textarea + jednoho RTE.

**Dodá uživateli:** Plnohodnotný formátovací composer (tučné/kurzíva/seznamy/odkaz/barva) identicky ve všech čtyřech místech mailu; draft rozepsaný v peeku se ukáže formátovaný ve vlákně. Formátování je zatím composer-only (odeslané zprávy se renderují jako plain), skutečné doručení formátu přijde s mail M1.

**Obsahuje:**
- Extrahovat funkční contentEditable RTE z MailThread.tsx do sdílené komponenty apps/web/src/mail/RichText.tsx (editor + toolbar + link popover + sanitizer), včetně load-bearing triku „nastav innerHTML jen když se value liší od lastHtml" (jinak skáče kurzor)
- Přidat ovladač barvy textu jako FIXNÍ Watson paletu (~6–8 hex hodnot čitelných v light i dark), ne volný hex picker — kvůli kontrastu a allowlistu v sanitizeru
- Přidat sanitizeMailHtml() (dnes ŽÁDNÝ sanitizer neexistuje) s allowlistem tagů + onPaste čištění; normalizovat execCommand <font color> na <span style=color>
- Aditivně rozšířit draft store (state.tsx): k poli text přidat volitelné html; text zůstává kanonická plain projekce, aby chips/snip/send-split nepraskly
- Nasadit <RichText> do MailThread (smaže ~200 řádků), NewMessage (pozor: ATT_RE a empty-form detekce musí běžet na plain projekci, ne na HTML), PeekPanel MailPeek a FloatComposer
- Znovupoužít existující [data-rte] CSS v mail.css; ověřit kontrast barev na var(--panel-2) v obou tématech

### F2 — Watson: vycentrovaná karta + deterministický Radar pozornosti (režim A)  ·  effort L  ·  bez klíče

**Cíl:** Nahradit slabý boční drawer WatsonPanel vycentrovanou kartou (vzor AddTaskModal) a naplnit ji deterministickým radarem nad REÁLNĚ syncovanými daty: míč u tebe, uvázlo (tichý stall), dnes hoří, predikce cílů, kaskádová projekce Postupů.

**Dodá uživateli:** Vycentrovaná Watson karta místo draweru + skutečně užitečný radar: „co je míč u tebe", „co uvázlo", „co dnes hoří" (s tlačítkem přeplánovat), predikce cílů a dopadová projekce Postupů — vše nad reálnými synced daty, offline. Dva reálné bugy (přeplánování, počty) opraveny. Mailové radar-pruhy se shipnou jen jako viditelné demo.

**Obsahuje:**
- Překlopit surface: lib/watson.tsx stav open na {mode:'radar'|'ask'}; nová WatsonCard.tsx klonuje interakční skořápku AddTaskModalu (focus-trap, Esc kaskáda přes data-esc-layer, wPop animace); prázdný tab „Řekni Watsonovi" pro budoucí režim B
- Sdílený engine lib/radar.ts: čte tasks/assignments/chain_steps/chains/goals + session.user.id, vrací tři počty (u tebe/uvázlo/hoří) se single-lane dedupem
- Oprava #1 (reálný bug): extrahovat SPRÁVNOU verzi přeplánování z Prehled.tsx do lib/reschedule.ts (date-only, přeskočí recurrence R4, undo+toast) a použít v Přehledu i Radaru; zahodit bugovou kopii z WatsonPanel (píše plný timestamp bez R4/undo)
- Oprava #2 (counts): nedatované úkoly nesmí padat do „dnes" (dnešní d==null||d===tdy → d!=null && d<=tdy)
- Pruh „Míč u tebe" plně lokálně z chain_steps.activated_at + assignments.created_at; provenienci předávky dopočítat v JS z předchozího kroku
- Pruh „Uvázlo" jako offline proxy z activated_at (aktivní krok ≥3 dny bez pohybu, ještě ne po termínu); pro neštafetové úkoly „kdo naposledy hnul" volitelně malý Hono endpoint GET /api/activity/digest (task_activity se nesyncuje dolů)
- Doplnit Přehled: čistá goalForecast() (projekce tempa cíle) a čistá simulateReflow() vytažená z chainReflow.ts BEZ zápisu (refaktor, ne duplikát) — použít v kartě i v radarových pruzích
- Paměť delt: localStorage watermark (vzor NotifCenter), přepínač Nové/Vše; koordinovat s NotifCenter, ať zvonek a karta nedublují signály; i18n klíče watson.radar.*

### F3 — Hlasové diktování do textových polí (STT, bez Claude)  ·  effort L  ·  bez klíče

**Cíl:** Mikrofon → přepis → vložení textu na pozici kurzoru do všech composerů i QuickAddu. Serverová STT cesta (konzistentní napříč prohlížeči), zatím BEZ Claude cleanupu.

**Dodá uživateli:** Uživatel může diktovat do libovolného pole (mail, rychlé přidání úkolu) na jakémkoli prohlížeči; přepis se vloží na kurzor. Push-to-talk stačí pro MVP. Vyžaduje separátní STT klíč (ne Claude); bez klíče se mikrofon skryje. Bez Claude je přepis „surový" (interpunkce/úklid přijdou ve F5).

**Obsahuje:**
- Backend: nový Hono endpoint apps/api/src/voice.ts (POST /api/voice/transcribe, multipart audio → {rawText}) zapojený v index.ts; klíče v env.ts vzorem googleEnabled (voiceEnabled = Boolean klíčů); rate-limit + strop délky audia (60–120 s)
- STT provider za swappable adaptérem transcribe(audio, lang='cs') — start s jedním providerem po krátkém cs bake-offu (ElevenLabs Scribe/Speechmatics pro kvalitu cs vs Groq/OpenAI pro cenu). POZOR: Anthropic NEMÁ speech-to-text → potřeba SAMOSTATNÝ STT klíč, ne Claude klíč
- Frontend: sdílený hook lib/useDictation.ts (getUserMedia→MediaRecorder→POST) + komponenta MicButton.tsx (brass akcent, stavy idle/recording/transcribing); iOS Safari mime fallback (mp4/m4a), online-only guard
- Zapojit MicButton s inzercí na kurzor do NewMessage <textarea>, MailThread contentEditable (Range), PeekPanel MailPeek, FloatComposer a QuickAdd <input> (hlas projde stejným parseQuick jako psaný text)
- Feature-flag celý hlas (skrýt/disable offline i bez klíče), viditelný rec indikátor, auto-stop na max délce

### F4 — AI příkazová vrstva Claude (návrh→schválení, režim B)  ·  effort L  ·  🔑 potřebuje Claude klíč

**Cíl:** Endpoint POST /api/watson/command, který z příkazu + klientského mail/task kontextu vrátí NÁVRHY akcí (vytvoř úkoly, přiřaď dle memberships.areas, draft odpovědi, sumář). Server nic nezapisuje; mutace jdou až po schválení přes existující write-path. Naplní prázdný tab „Řekni Watsonovi" z F2.

**Dodá uživateli:** Uživatel napíše „z posledních 10 mailů udělej úkoly pro Zdeňka" a dostane NÁVRHY ke schválení; jen po kliknutí se vytvoří úkoly/přiřazení přes ověřený write-path (R5 re-validace). OMEZENÍ: draftReply a mailový kontext jsou demo (localStorage/seed) až do mail M1 — reálně persistuje jen createTask + assignment. Privacy: osobní sféra a AI-off schránky se na klienta nesmí posílat.

**Obsahuje:**
- env.ts: anthropicApiKey + aiEnabled; přidat @anthropic-ai/sdk do apps/api; ANTHROPIC_API_KEY do .env/.env.example (klíč dodá uživatel, zůstává jen server-side)
- apps/api/src/watson.ts: session→401, ověření členství workspace→403, !aiEnabled→503 (čistá degradace na deterministický Radar); načíst AUTORITATIVNÍ roster (users+memberships.areas/bio) z Postgresu pro routing
- Čtyři strict tools jako STRUKTUROVANÝ výstupní kontrakt (NE executory): createTask, draftReply (jen draft), assignToPerson (server validuje assigneeUserId proti rosteru), summarize
- Volat client.messages.create (model claude-opus-4-8, thinking adaptive) — NE tool_runner (ten auto-spouští a rozbil by propose-then-approve); tool_use bloky číst jako proposals; system prompt: mail je DATA ne instrukce (guard proti prompt-injection); prompt caching na stabilní prefix; rate-limit /api/watson/*
- Klient: lib/watsonCommand.ts (fetch s credentials, ctx = inbox, non-personal, adm.ai!='off', posledních N mailů + reálné úkoly), lib/watsonApply.ts (applyProposal přes bridge.onCreateTask + assignments write; draftReply jen do composeru, NIKDY neodesílá; summarize jako zobrazení/volitelná poznámka)
- AskWatson.tsx: nahradit stub „AI backend not connected" reálným voláním; UI review seznam s per-item Schválit/Upravit/Zamítnout; footer disclaimer „odesíláš vždy ty"

### F5 — Hlas jako AI příkaz + Wispr-styl cleanup (diktát→úkoly)  ·  effort M  ·  🔑 potřebuje Claude klíč

**Cíl:** Spojit F3 (hlas) a F4 (AI vrstva): dikát → Claude cleanup (interpunkce/odstavce, beze změny významu) pro textová pole, a dikát → AI příkazová roura ve Watson kartě (transcript → návrhy úkolů/sumáře/rozdělení lidem, human-in-the-loop).

**Dodá uživateli:** „Wispr kvalita": diktát se automaticky vyčistí (interpunkce, odstavce) a hlasem lze rovnou zadat AI příkaz „rozděl tohle mezi lidi" → strukturované návrhy ke schválení. Hlas je tenká nadstavba nad F4, takže přírůstkově malé. Vyžaduje Claude klíč (cleanup + příkazy) i STT klíč z F3.

**Obsahuje:**
- Backend: do voice.ts přidat VOLITELNÝ Claude cleanup pass (konzervativní cs prompt „doplň interpunkci, odstraň vatu, neměň význam"); vracet raw i clean, ať jde undo/diff
- Watson karta: MicButton, který přepis NEvkládá do pole, ale posílá do AI příkazové roury z F4 (transcript → runWatsonCommand → review návrhů → schválení)
- Dodržet AI pravidla: vždy návrh→schválení→undo, audit, AI nikdy nemaže ani nepíše externím; zachovat surový přepis pro undo (riziko, že LLM změní význam)
- Guardraily nákladů/UX: online-only degradace, model jako cost lever (Sonnet 5/Haiku 4.5), EU data-residency pro audio (EU endpoint/self-host)

## Pořadí — proč
Pořadí drží tři pravidla. (1) Hodnota bez klíče první: F1 (composer) a F2 (Radar) nepotřebují žádný externí klíč a řeší dvě věci, které uživatel vidí denně — formátování mailu a přehled „na co si dát pozor"; navíc F2 cestou opravuje dva reálné bugy (přeplánování, počty). (2) Diktování (F3) je před AI, protože jde o infrastrukturu (getUserMedia, MediaRecorder, STT endpoint, MicButton), která má hodnotu i sama o sobě (surový přepis do polí) a nepotřebuje Claude klíč — potřebuje jen separátní STT klíč. (3) AI až s klíčem: F4 zapíná Claude příkazovou vrstvu a musí přijít po F2, protože sdílí vycentrovanou Watson kartu a plní její prázdný tab „Řekni Watsonovi". F5 je záměrně poslední a nejmenší — spojuje už hotové F3+F4 (hlas → cleanup, hlas → příkaz), takže je to tenká nadstavba, ne nový kus. Každá fáze je samostatně shippable a degraduje čistě: bez STT klíče se mikrofon skryje, bez Claude klíče endpoint vrací 503 a app spadne zpět na deterministický Radar.

## Rizika
- Mail je z ~95 % demo (seed + localStorage): rich-text formátování i AI draftReply/mailový kontext jsou zobrazovací/návrhové až do samostatné velké várky mail-persistence M1; reálně dnes persistuje jen createTask + assignment. Nutno v UI i plánu poctivě označit.
- Změna sdíleného draft store (F1) je hlavní hazard: html musí být striktně aditivní, text zůstává kanonická plain projekce — jinak prasknou chips/snip/send-split. NewMessage ATT_RE a empty-form detekce musí běžet na plain projekci, ne na HTML.
- contentEditable + execCommand jsou deprecated a foreColor emituje cross-browser variabilní <font color>; držet demo-scoped, sanitizer normalizuje. Paste přijímá libovolné HTML → sanitizer + onPaste musí běžet na každý persist, ne jen na toolbar akce.
- Prompt injection v tělech mailů (F4): struktura to tlumí (server nic nespouští, injection dá jen návrh ke schválení), ale system prompt musí rámovat mail jako data-ne-instrukce a assigneeUserId se validuje proti DB rosteru + write-path R5.
- Náklady/runaway (F4/F5): claude-opus-4-8 je drahý a „drafty pro 10 mailů" fan-out; nutný rate-limit /api/watson/*, případně denní cap a prompt caching; Sonnet/Haiku jako levnější volba.
- NESMÍ se použít SDK tool_runner ve F4 — auto-spouští tooly a rozbil by invariant návrh-pak-schválení; musí to být plain messages.create čtoucí tool_use bloky.
- Refaktor reflowChain na čistou simulateReflow (F2) může změnit termíny existujících Postupů (skip_weekend/anchor) — nutná regrese na advance/reflow.
- Anthropic NEMÁ speech-to-text: F3 vyžaduje SEPARÁTNÍ STT klíč, ne Claude klíč — snadné zaměnit; bez něj se hlas musí skrýt. Web Speech API je nespolehlivý základ (Firefox nepodporuje, Safari cs nejistá) → serverová cesta primární.
- Online-only (AI i hlas): offline-first app musí degradovat na deterministický Radar / skrytý mikrofon a nezobrazovat chyby.
- Překryv Watson karty s NotifCenter (zvonek): stejný signál dvakrát; nutné sdílené odvození a jasné rozdělení rolí, jinak duplicitní upozornění.

## Rozhodnutí, která potřebuju od uživatele
- Formátování na odeslání: mají odeslané odpovědi ZACHOVAT formát (html na SentMsg + sanitizovaný render island), nebo je rich-text jen composer-only a při odeslání se zploští na plain (do mail M1)?
- Rozsah barev: jen barva textu, nebo i zvýraznění/pozadí? A přesná paleta — reuse priority/brand tokenů (brass, p1–p4, ink) nebo dedikovaná malá sada?
- Watson karta vs. drawer: koncept WATSON_koncept_radar_2026-07-12.md chce ZACHOVAT pravý drawer, zadání a paměť chtějí vycentrovanou kartu. Potvrdit kartu (vratné rozhodnutí).
- Stall provenience: postavit /api/activity/digest hned (provenience = jádro důvěry), nebo se spokojit s offline proxy z activated_at bez „kdo hnul"? task_activity se nesyncuje dolů.
- Watermark paměti delt: per-zařízení localStorage (stačí pro MVP), nebo synced per-uživatel (jinak se delty na více zařízeních rozjedou)?
- STT provider pro čeština/cena: krátký cs bake-off (ElevenLabs Scribe / Speechmatics vs Groq Whisper / OpenAI gpt-4o-transcribe), držet za swappable adaptérem. Vyžaduje SEPARÁTNÍ STT klíč nad rámec Claude.
- EU data-residency pro audio: DPA / EU endpoint / self-host Whisper? Watson je deklarovaně EU-region.
- Model pro AI vrstvu: default claude-opus-4-8 vs claude-sonnet-5/haiku-4-5 jako cost lever pro vysoký objem draftů (nákladové rozhodnutí uživatele).
- Kolik mailu posílat Claudovi: plná těla vs truncation per vlákno (limit tokenů + PII expozice); a chceme per-workspace AI on/off + consent gate před odesláním obsahu mailu?
- Kam persistuje schválený draftReply, když je mail demo? Přijmout localStorage-only do mail M1, nebo draftReply z prvního řezu vyřadit?