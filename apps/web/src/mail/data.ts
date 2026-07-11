/** Seed mailového modulu — VERBATIM transkripce z design/handoff WatsonMail.dc.html (ř. 2251–2474, 2910–2931). Demo svět T-Group; reálný mail backend = program M1–M3. */

/* ── Typy ── */

/** Osoba (člen týmu) — klíč = pid ('ad', 'tm', …). */
export interface MailPerson {
  ini: string;
  n: string;
  av: string;
  role: string;
}

/** Sdílená schránka — klíč = id ('info', 'granty', 'podcast', 'studio'). */
export interface Mailbox {
  short: string;
  addr: string;
  team: string;
  sig: string;
  people: string[];
  count: string;
  aiOff?: boolean;
  warn?: boolean;
}

/** Definice urgence P1–P4. */
export interface SlaDef {
  name: string;
  chip: string;
  sla: string;
  left: string;
  esk: string;
  task: boolean;
  desc: string;
}

/** Stav vlákna. */
export type ThreadStatus = 'novy' | 'otevreny' | 'ceka' | 'odeslano' | 'hotovo';

/** Vlajka urgence vlákna ('prop' = AI návrh vlajky, 'none' = bez vlajky). */
export type ThreadFlag = 'p1' | 'p2' | 'p3' | 'p4' | 'prop' | 'none';

/** Odesílatel v Gatekeeper frontě (noví/neznámí odesílatelé). */
export interface GkSender {
  id: string;
  ini: string;
  name: string;
  addr: string;
  mb: string;
  subj: string;
  hot?: boolean;
}

/** Odesílatel mailu ve vlákně. */
export interface MailFrom {
  n: string;
  ini: string;
  addr: string;
}

/** Jedna mailová zpráva ve vlákně. */
export interface MailMsg {
  dir: 'in' | 'out';
  by?: string;
  t: string;
  to: string;
  att?: string;
  body: string[];
  quote?: string[];
  en?: boolean;
  cz?: string[];
}

/** Zpráva v interní diskusi (chatu) u vlákna. */
export interface ChatMsg {
  who: string;
  t: string;
  pre?: string;
  m?: string;
  post?: string;
  ai?: boolean;
}

/** Společná pole mailového vlákna (týmového i osobního). */
export interface MailThreadBase {
  id: string;
  grp: string;
  from: MailFrom;
  subj: string;
  snip: string;
  time: string;
  st: ThreadStatus;
  flag?: ThreadFlag;
  owner?: string;
  att?: boolean;
  aiDraft?: boolean;
  aiRoute?: boolean;
  coll?: boolean;
  sum?: string;
  why?: string[];
  draft?: string[];
  quick?: string[];
  unread?: boolean;
  readBy?: string[];
  readAt?: Record<string, string>;
  pin?: boolean;
  fu?: string;
  snoozed?: string;
  roz?: boolean;
  sentF?: boolean;
  bounce?: string;
  draftF?: boolean;
  htmlMail?: boolean;
  replyTo?: string;
  msgs: MailMsg[];
  chat: ChatMsg[];
}

/** Vlákno týmové schránky — má mb (id schránky). */
export interface TeamThread extends MailThreadBase {
  mb: string;
  personal?: false;
}

/** Vlákno osobní sféry — bez schránky, personal: true. */
export interface PersonalThread extends MailThreadBase {
  personal: true;
  mb?: undefined;
}

/** Mailové vlákno (diskriminant: personal). */
export type MailThread = TeamThread | PersonalThread;

/** Sdílená šablona odpovědi. */
export interface MailTemplate {
  n: string;
  b: string;
}

/** Položka AI fronty návrhů (route = předat, flag = vlajka, grp = přesun skupiny). */
export interface AiQueueItem {
  k: 'route' | 'flag' | 'grp';
  th: string;
  who?: string;
  flag?: string;
  st: string;
  txt: string;
  why: string;
}

/** Admin nastavení schránek (Gatekeeper, AI režim, přístupy). */
export interface AdmSeed {
  fixed: boolean;
  gate: Record<string, boolean>;
  ai: Record<string, 'triage' | 'read' | 'off'>;
  acc: Record<string, Record<string, number>>;
}

/** Osobní nastavení mailu (notifikace, soukromí, VIP, mimo kancelář). */
export interface NastSeed {
  notif: Record<string, 'vse' | 'vip' | 'zadne'>;
  quiet: boolean;
  privImg: boolean;
  privAtt: boolean;
  beh: string;
  vip: string[];
  vipIn: string;
  ooo: boolean;
  oooTxt: string;
}

/* ── Lidé ── */
export const P: Record<string, MailPerson> = {
  ad: { ini: 'AK', n: 'Adam Košír', av: 'brass', role: 'vedoucí · admin' },
  tm: { ini: 'TM', n: 'Tereza Malá', av: '', role: 'projektová manažerka' },
  js: { ini: 'JS', n: 'Jakub Svoboda', av: '', role: 'barista' },
  mh: { ini: 'MH', n: 'Markéta Horáková', av: '', role: 'grantová specialistka' },
  fk: { ini: 'FK', n: 'Filip Krejčí', av: '', role: 'editor podcastu' },
  ps: { ini: 'PŠ', n: 'Petra Šimková', av: '', role: 'provoz a office' }
};

/* ── Schránky ── */
export const MB: Record<string, Mailbox> = {
  info: { short: 'info@', addr: 'info@t-group-dance.cz', team: 'Provoz', sig: 'T-Group Studio', people: ['ad', 'ps', 'tm'], count: '3' },
  granty: { short: 'granty@', addr: 'granty@t-group-dance.cz', team: 'Granty', sig: 'Grantové oddělení T-Group', people: ['mh', 'ad'], count: '1', aiOff: true },
  podcast: { short: 'podcast@', addr: 'podcast@t-group-dance.cz', team: 'Podcast', sig: 'T-Group Podcast', people: ['fk', 'ad'], count: '2', warn: true },
  studio: { short: 'studio@', addr: 'studio@t-group-dance.cz', team: 'Studio', sig: 'T-Group Studio Dornych', people: ['js', 'ps', 'ad'], count: '1' }
};

/* ── Urgence P1–P4 ── */
export const SLA: Record<string, SlaDef> = {
  p1: { name: 'P1 · Kritické', chip: 'P1', sla: 'odpovědět dnes do 17:00', left: 'zbývá 6 h', esk: 'při porušení → admin', task: true, desc: 'Do konce pracovního dne. Vytvoří úkol „Odpovědět…“; při porušení upozorní admina.' },
  p2: { name: 'P2 · Urgentní', chip: 'P2', sla: 'odpovědět do zítra 17:00', left: 'zbývá 31 h', esk: 'při porušení → dispečink', task: true, desc: '1 pracovní den. Vytvoří úkol „Odpovědět…“ a připomene v půlce SLA.' },
  p3: { name: 'P3 · Důležité', chip: 'P3', sla: 'do pátku 11. 7.', left: '', esk: 'jen připomenutí', task: false, desc: '3 pracovní dny. Jen vlajka a follow-up — bez úkolu v seznamu.' },
  p4: { name: 'P4 · Nízké', chip: 'P4', sla: 'bez termínu', left: '', esk: 'follow-up po 7 dnech ticha', task: false, desc: 'Bez SLA. Po 7 dnech ticha Watson navrhne follow-up.' }
};

/* ── Labely stavů vlákna ── */
export const STL: Record<string, string> = { novy: 'Nový', otevreny: 'Otevřený', ceka: 'Čeká interně', odeslano: 'Odesláno', hotovo: 'Hotovo' };

/* ── Gatekeeper fronta ── */
export const GK: GkSender[] = [
  { id: 'g1', ini: 'CN', name: 'CultureNet.cz', addr: 'newsletter@culturenet.cz', mb: 'info', subj: 'CultureNet digest — kulturní výzvy a granty (týden 28)', hot: false },
  { id: 'g2', ini: 'MD', name: 'Marek Dvořák', addr: 'marek.dvorak@seznam.cz', mb: 'studio', subj: 'Dotaz na taneční kurzy pro děti od 6 let' },
  { id: 'g3', ini: 'PR', name: 'Printify Sales', addr: 'sales@printify.com', mb: 'podcast', subj: 'Merch partnership for your podcast' }
];

/* ── Výchozí AI fronta návrhů (state.aiQ) ── */
export const AI_QUEUE_SEED: AiQueueItem[] = [
  { k: 'route', th: 'host42', who: 'fk', st: 'ceka', txt: 'Předat „Host do epizody #42“ Filipovi', why: 'oblast odpovědnosti: podcast — hosté a natáčení; 9 z 10 podobných vláken řešil Filip' },
  { k: 'flag', th: 'cenik', flag: 'p3', st: 'ceka', txt: 'Nastavit P3 na „Nový ceník pronájmu sálů“', why: 'v textu je termín „pak jde do tisku“ — bez odpovědi se tisk zdrží' },
  { k: 'grp', th: 'gopay', st: 'ceka', txt: 'Přesunout „Vyúčtování plateb za červen“ do Oznámení', why: 'automat (no-reply hlavička) — nečeká na odpověď' }
];

/* ── Výchozí admin nastavení (state.adm) ── */
export const ADM_SEED: AdmSeed = {
  fixed: false,
  gate: { info: true, granty: true, podcast: false, studio: true },
  ai: { info: 'triage', granty: 'off', podcast: 'read', studio: 'read' },
  acc: {
    info: { ad: 2, ps: 1, tm: 1, mh: 0, fk: 0, js: 0 },
    granty: { ad: 1, ps: 0, tm: 0, mh: 2, fk: 0, js: 0 },
    podcast: { ad: 1, ps: 0, tm: 0, mh: 0, fk: 2, js: 0 },
    studio: { ad: 1, ps: 2, tm: 0, mh: 0, fk: 0, js: 1 }
  }
};

/* ── Výchozí osobní nastavení (state.nast) ── */
export const NAST_SEED: NastSeed = { notif: { info: 'vse', granty: 'vip', podcast: 'zadne', studio: 'vip', osobni: 'vse' }, quiet: true, privImg: false, privAtt: true, beh: 'dalsi', vip: ['vyzvy@npi.cz', 'kultura@brno.cz'], vipIn: '', ooo: false, oooTxt: 'Dobrý den, do 20. 7. jsem mimo kancelář s omezeným přístupem k poště. V urgentních věcech volejte studio: 731 220 415. Adam Košír' };

/* ── Vlákna ── */
export const TH: MailThread[] = [
  {
    id: 'faktura', mb: 'info', grp: 'inbox', from: { n: 'Pavel Horák', ini: 'PH', addr: 'horak@vlnena-sprava.cz' },
    subj: 'Faktura za nájem — červenec', snip: 'Máte pravdu, omlouvám se za přehlédnutí. V příloze opravná faktura č. 2026-0714b se zápočtem přeplatku — k úhradě zbývá 42 200 Kč.',
    time: '9:12', st: 'otevreny', owner: 'ad', flag: 'prop', att: true, aiDraft: true, coll: true,
    sum: 'Vlněna poslala opravnou fakturu za červencový nájem — po zápočtu přeplatku 6 200 Kč zbývá uhradit 42 200 Kč. Čekají na potvrzení platby do pátku 11. 7.',
    why: [
      'Poslední zpráva čeká na potvrzení úhrady do pátku 11. 7. (dnes 9:12).',
      'Petra v interní diskusi potvrdila platbu dnes z provozního účtu (9:20).',
      'Tón formální — externí dodavatel; podpis podle schránky info@.'
    ],
    draft: [
      'Dobrý den, pane Horáku,',
      'děkujeme za opravnou fakturu. Částku 42 200 Kč odešleme dnes z provozního účtu — potvrzení o platbě pošlu, jakmile banka příkaz provede, nejpozději zítra ráno.',
      'Přeplatek 6 200 Kč z vyúčtování služeb za druhé čtvrtletí tím považujeme za vyrovnaný.',
      'S pozdravem, Adam Košír, T-Group Studio'
    ],
    quick: ['Úhradu potvrzujeme', 'Poděkovat', 'Vyžádat podklady'],
    msgs: [
      { dir: 'in', t: 'út 1. 7. 10:42', to: 'info@t-group-dance.cz', att: 'faktura_2026-0714.pdf · 182 kB', body: ['Dobrý den,', 'v příloze posílám fakturu č. 2026-0714 za pronájem prostor Dornych 47 za červenec — 48 400 Kč včetně záloh na energie, splatnost 15. 7.', 'Prosím o potvrzení přijetí. S pozdravem, Pavel Horák, správa nemovitostí Vlněna'] },
      { dir: 'out', by: 'ad', t: 'st 2. 7. 14:05', to: 'horak@vlnena-sprava.cz', body: ['Dobrý den, pane Horáku,', 'fakturu potvrzujeme. Při kontrole jsme ale narazili na přeplatek 6 200 Kč z vyúčtování služeb za druhé čtvrtletí — počítáte s jeho zápočtem proti červencovému nájmu?', 'Děkuji, Adam Košír'] },
      { dir: 'in', t: 'dnes 9:12', to: 'info@t-group-dance.cz', att: 'faktura_2026-0714b.pdf · 184 kB', quote: ['fakturu potvrzujeme. Při kontrole jsme ale narazili na přeplatek 6 200 Kč z vyúčtování služeb za druhé čtvrtletí…'], body: ['Dobrý den,', 'máte pravdu, omlouvám se za přehlédnutí. V příloze posílám opravnou fakturu č. 2026-0714b se zápočtem přeplatku — k úhradě zbývá 42 200 Kč.', 'Prosím jen o potvrzení, že platba odejde do pátku 11. 7., ať ji stihneme spárovat před pololetní závěrkou.', 'Děkuji, Pavel Horák'] }
    ],
    chat: [
      { who: 'ps', t: '9:20', pre: 'Opravná faktura sedí, zápočet souhlasí s naší evidencí. Zaplatím dnes z provozního účtu — ', m: '@Adam', post: ' potvrdíš?' },
      { who: 'ad', t: '9:24', pre: 'Potvrzuji, zaplať dnes. Odpověď Horákovi beru já.' }
    ]
  },
  {
    id: 'opjak', mb: 'granty', grp: 'inbox', from: { n: 'Mgr. Jana Sedláčková', ini: 'JS', addr: 'vyzvy@npi.cz' },
    subj: 'Výzva OP JAK — doplnění žádosti do 31. 7.', snip: 'U žádosti č. CZ.02.01.01/00/25_042 evidujeme chybějící přílohu — rozpočet po jednotkových cenách. Bez doplnění nelze žádost posunout dál.',
    time: '8:47', st: 'otevreny', owner: 'mh', flag: 'p1',
    msgs: [
      { dir: 'in', t: 'dnes 8:47', to: 'granty@t-group-dance.cz', body: ['Vážená paní Horáková,', 'u žádosti č. CZ.02.01.01/00/25_042 (Taneční vzdělávání pro ZŠ) evidujeme chybějící přílohu — rozpočet rozpadnutý po jednotkových cenách. Bez doplnění nemůžeme žádost posunout do věcného hodnocení.', 'Doplňte prosím přes ISKP21+ nejpozději do 31. 7. 2026.', 'S pozdravem, Jana Sedláčková, NPI ČR'] }
    ],
    chat: [
      { who: 'mh', t: '9:02', pre: 'Rozpočet mám rozpracovaný, do čtvrtka ho nahraju. ', m: '@Adam', post: ' — chceš finální verzi vidět předem?' }
    ]
  },
  {
    id: 'podmatrix', mb: 'podcast', grp: 'inbox', from: { n: 'Lukas Meyer', ini: 'LM', addr: 'l.meyer@podmatrix.io' },
    subj: 'Nabídka spolupráce (podcast)', snip: 'I lead partnerships at Podmatrix — we connect independent podcasts with sponsors across Austria and Czechia. Would you have 20 minutes next week?',
    time: '7:58', unread: true, readBy: ['fk'], readAt: { fk: 'dnes 8:05' }, st: 'novy', flag: 'none', aiRoute: true,
    msgs: [
      { dir: 'in', t: 'dnes 7:58', to: 'podcast@t-group-dance.cz', en: true,
        body: ['Hi,', 'I lead partnerships at Podmatrix — we connect independent podcasts with sponsors across Austria and Czechia (40+ shows, including Deep Dance Vienna).', 'I think the T-Group podcast would be a great fit for two of our clients this autumn. Would you have 20 minutes next week for a quick call?', 'Best, Lukas Meyer'],
        cz: ['Dobrý den,', 'vedu partnerství v Podmatrixu — propojujeme nezávislé podcasty se sponzory v Rakousku a Česku (40+ pořadů, včetně Deep Dance Vienna).', 'Myslím, že podcast T-Group by letos na podzim skvěle seděl dvěma našim klientům. Našlo by se příští týden 20 minut na krátký hovor?', 'S pozdravem, Lukas Meyer'] }
    ],
    chat: []
  },
  {
    id: 'reklamace', mb: 'studio', grp: 'inbox', from: { n: 'Alena Vrbová', ini: 'AV', addr: 'alena.vrbova@email.cz' },
    subj: 'Reklamace objednávky #2417 — permanentka', snip: 'Permanentku na 10 lekcí jsem zaplatila 28. 6., ale v rezervačním systému se mi pořád ukazuje jen 5 vstupů. Můžete to prověřit?',
    time: 'po', st: 'ceka', owner: 'js', fu: 'čt 10. 7.', flag: 'none', pin: true,
    msgs: [
      { dir: 'in', t: 'po 7. 7. 16:21', to: 'studio@t-group-dance.cz', body: ['Dobrý den,', 'permanentku na 10 lekcí jsem zaplatila 28. 6. (objednávka #2417), ale v rezervačním systému se mi pořád ukazuje jen 5 vstupů. Můžete to prosím prověřit?', 'Děkuji, Alena Vrbová'] },
      { dir: 'out', by: 'js', t: 'po 7. 7. 17:02', to: 'alena.vrbova@email.cz', body: ['Dobrý den, paní Vrbová,', 'děkujeme za upozornění — prověřím to s rezervačním systémem a ozvu se nejpozději ve čtvrtek. Omlouvám se za komplikaci.', 'Jakub Svoboda, T-Group Studio Dornych'] }
    ],
    chat: [
      { who: 'js', t: 'po 17:05', pre: 'Vypadá to na chybu importu z GoPay. ', m: '@Petra', post: ' — nemáš přístup do adminu rezervací?' },
      { who: 'ps', t: 'po 17:31', pre: 'Mám, mrknu na to zítra ráno.' }
    ]
  },
  {
    id: 'rezervace', mb: 'info', grp: 'inbox', from: { n: 'Tomáš Klimeš', ini: 'TK', addr: 'klimes.tomas@gmail.com' },
    subj: 'Rezervace sálu na workshop 14. 8.', snip: 'Rádi bychom si na čtvrtek 14. 8. od 17 do 21 hodin pronajali velký sál pro zhruba 25 lidí. Je termín volný a jaká by byla cena?',
    time: '8:31', unread: true, readBy: ['ps'], readAt: { ps: 'dnes 8:40' }, st: 'novy', flag: 'none',
    msgs: [
      { dir: 'in', t: 'dnes 8:31', to: 'info@t-group-dance.cz', body: ['Dobrý den,', 'rádi bychom si u vás na čtvrtek 14. 8. od 17 do 21 hodin pronajali velký sál pro zhruba 25 lidí (firemní workshop s pohybovou částí).', 'Je termín volný a jaká by byla cena včetně ozvučení?', 'Děkuji, Tomáš Klimeš'] }
    ],
    chat: []
  },
  {
    id: 'smlouva', mb: 'granty', grp: 'inbox', pin: true, from: { n: 'Magistrát města Brna', ini: 'MB', addr: 'kultura@brno.cz' },
    subj: 'Dodatek smlouvy o podpoře — sál Radlas', snip: 'Zasíláme podepsaný dodatek č. 2 ke smlouvě o poskytnutí dotace. Prosíme o kontrolu a potvrzení převzetí datovou schránkou.',
    time: 'út', st: 'odeslano', owner: 'ad', flag: 'p3', att: true,
    msgs: [
      { dir: 'in', t: 'út 7. 7. 11:20', to: 'granty@t-group-dance.cz', att: 'dodatek_c2_radlas.pdf · 412 kB', body: ['Vážení,', 'zasíláme podepsaný dodatek č. 2 ke smlouvě o poskytnutí dotace na provoz sálu Radlas. Prosíme o kontrolu a potvrzení převzetí datovou schránkou.', 'S pozdravem, Odbor kultury MMB'] },
      { dir: 'out', by: 'ad', t: 'út 7. 7. 15:44', to: 'kultura@brno.cz', body: ['Dobrý den,', 'dodatek jsme zkontrolovali a potvrzení odešlo dnes datovou schránkou. Děkujeme za rychlé vyřízení.', 'Adam Košír, T-Group'] }
    ],
    chat: []
  },
  {
    id: 'zoner', mb: 'info', grp: 'ozn', from: { n: 'Zoner', ini: 'ZO', addr: 'noreply@zoner.com' },
    subj: 'Doména t-group-dance.cz prodloužena', snip: 'Platba 348 Kč přijata. Doména je prodloužena do 8. 7. 2027, daňový doklad najdete v příloze.',
    time: '6:40', unread: true, st: 'novy', flag: 'none', att: true,
    msgs: [ { dir: 'in', t: 'dnes 6:40', to: 'info@t-group-dance.cz', att: 'doklad_2026-3481.pdf · 96 kB', body: ['Dobrý den,', 'platba 348 Kč byla přijata. Doména t-group-dance.cz je prodloužena do 8. 7. 2027. Daňový doklad je v příloze.', 'Zoner, a.s.'] } ],
    chat: []
  },
  {
    id: 'csob', mb: 'info', grp: 'ozn', from: { n: 'ČSOB', ini: 'ČS', addr: 'vypisy@csob.cz' },
    subj: 'Výpis z podnikatelského účtu 06/2026', snip: 'Výpis za období 1. 6. – 30. 6. 2026 je připraven ke stažení v InternetBankingu 24.',
    time: 'po', unread: true, st: 'novy', flag: 'none',
    msgs: [ { dir: 'in', t: 'po 7. 7. 5:12', to: 'info@t-group-dance.cz', body: ['Vážený kliente,', 'výpis z podnikatelského účtu za období 1. 6. – 30. 6. 2026 je připraven ke stažení v InternetBankingu 24.', 'ČSOB'] } ],
    chat: []
  },
  {
    id: 'gopay', mb: 'studio', grp: 'ozn', htmlMail: true, replyTo: 'no-reply@gopay.cz', from: { n: 'GoPay', ini: 'GP', addr: 'ucty@gopay.cz' },
    subj: 'Vyúčtování plateb za červen', snip: 'Souhrnné vyúčtování transakcí za červen: 214 plateb, 187 420 Kč. Podklady ke stažení v administraci.',
    time: 'po', st: 'novy', flag: 'none',
    msgs: [ { dir: 'in', t: 'po 7. 7. 8:02', to: 'studio@t-group-dance.cz', body: ['Dobrý den,', 'souhrnné vyúčtování transakcí za červen: 214 plateb v celkové výši 187 420 Kč. Podklady najdete v administraci GoPay.', 'Tým GoPay'] } ],
    chat: []
  },
  {
    id: 'tanecni', mb: 'studio', grp: 'news', from: { n: 'Taneční zóna', ini: 'TZ', addr: 'redakce@tanecnizona.cz' },
    subj: 'Červencový přehled: festivaly, výzvy, rezidence', snip: 'Léto v pohybu — 12 festivalů, 3 rezidence a nová výzva Nadace umění. Přehled termínů na jednom místě.',
    time: 'ne', unread: true, st: 'novy', flag: 'none',
    msgs: [ { dir: 'in', t: 'ne 6. 7. 9:00', to: 'studio@t-group-dance.cz', body: ['Léto v pohybu —', '12 festivalů, 3 rezidence a nová výzva Nadace umění. Kompletní přehled termínů a uzávěrek najdete v článku.', 'Redakce Taneční zóny'] } ],
    chat: []
  },
  {
    id: 'fakturoid', mb: 'info', grp: 'news', from: { n: 'Fakturoid', ini: 'FA', addr: 'novinky@fakturoid.cz' },
    subj: 'Novinky: e-fakturace a API v2', snip: 'Od července podporujeme ISDOC 6.1, nové API v2 a hromadné odesílání upomínek.',
    time: 'so', st: 'novy', flag: 'none',
    msgs: [ { dir: 'in', t: 'so 5. 7. 10:15', to: 'info@t-group-dance.cz', body: ['Ahoj,', 'od července podporujeme ISDOC 6.1, nové API v2 a hromadné odesílání upomínek. Podrobnosti v changelogu.', 'Tým Fakturoidu'] } ],
    chat: []
  },
  {
    id: 'host42', mb: 'podcast', grp: 'inbox', roz: true, from: { n: 'Marie Dvořáková', ini: 'MD', addr: 'marie.dvorakova@jamu.cz' },
    subj: 'Host do epizody #42 — potvrzení termínu', snip: 'Čtvrtek 17. 7. v 10:00 mi vyhovuje. Pošlete prosím předem okruhy otázek?',
    time: 'pá', st: 'otevreny', owner: 'fk', flag: 'none', pin: true,
    msgs: [ { dir: 'in', t: 'pá 4. 7. 13:40', to: 'podcast@t-group-dance.cz', body: ['Dobrý den,', 'čtvrtek 17. 7. v 10:00 mi vyhovuje. Pošlete mi prosím předem okruhy otázek?', 'Marie Dvořáková'] } ],
    chat: []
  },
  {
    id: 'cenik', mb: 'studio', grp: 'inbox', roz: true, from: { n: 'Print Dornych', ini: 'PD', addr: 'studio@printdornych.cz' },
    subj: 'Nový ceník pronájmu sálů — korektura', snip: 'Posílám sazbu ceníku po korektuře. Zkontrolujte prosím ceny u velkého sálu, pak jde do tisku.',
    time: 'čt', st: 'otevreny', owner: 'ps', flag: 'none', att: true, pin: true,
    msgs: [ { dir: 'in', t: 'čt 3. 7. 15:10', to: 'studio@t-group-dance.cz', att: 'cenik_2026_v3.pdf · 1,2 MB', body: ['Dobrý den,', 'posílám sazbu ceníku po korektuře. Zkontrolujte prosím ceny u velkého sálu, pak to pouštíme do tisku.', 'Print Dornych'] } ],
    chat: []
  },
  {
    id: 'hluk', mb: 'info', grp: 'inbox', snoozed: 'po 8:00', from: { n: 'BD Dornych 45', ini: 'BD', addr: 'vybor@bddornych45.cz' },
    subj: 'Stížnost na hluk 28. 6.', snip: 'V sobotu 28. 6. po 22. hodině byl z vašich prostor slyšet hluk. Žádáme o dodržování nočního klidu.',
    time: '30. 6.', st: 'otevreny', owner: 'ad', flag: 'none',
    msgs: [ { dir: 'in', t: 'po 30. 6. 9:05', to: 'info@t-group-dance.cz', body: ['Vážení,', 'v sobotu 28. 6. po 22. hodině byl z vašich prostor slyšet hluk. Žádáme o dodržování nočního klidu.', 'Výbor BD Dornych 45'] } ],
    chat: []
  },
  {
    id: 'mleko', mb: 'studio', grp: 'inbox', sentF: true, bounce: 'objednavky@mlekarna-olesnice.cz neexistuje (mailer-daemon: user unknown)', from: { n: 'Mlékárna Olešnice', ini: 'MO', addr: 'objednavky@mlekarna-olesnice.cz' },
    subj: 'Objednávka mléka a smetany na srpen', snip: 'Objednáváme na srpen: plnotučné mléko 120 l týdně, smetana 33 % 24 l týdně. Závoz prosím v pondělí a ve čtvrtek.',
    time: 'pá', st: 'odeslano', owner: 'ps', flag: 'none',
    msgs: [ { dir: 'out', by: 'ps', t: 'pá 4. 7. 9:30', to: 'objednavky@mlekarna-olesnice.cz', body: ['Dobrý den,', 'objednáváme na srpen: plnotučné mléko 120 l týdně, smetana 33 % 24 l týdně. Závoz prosím v pondělí a ve čtvrtek dopoledne.', 'Petra Šimková, T-Group Studio Dornych'] } ],
    chat: []
  },
  {
    id: 'nabidka-kentico', mb: 'studio', grp: 'inbox', draftF: true, from: { n: 'Kentico (koncept)', ini: 'KE', addr: 'hr@kentico.com' },
    subj: 'Nabídka firemních lekcí — Kentico', snip: 'Koncept: nabídka pravidelných pohybových lekcí pro zaměstnance, 2× týdně v poledních blocích…',
    time: 'st', st: 'otevreny', flag: 'none',
    msgs: [ { dir: 'out', by: 'ad', t: 'koncept · st 2. 7.', to: 'hr@kentico.com', body: ['Dobrý den,', 'navazuji na telefonát — posílám nabídku pravidelných pohybových lekcí pro vaše zaměstnance, 2× týdně v poledních blocích přímo u vás nebo v našem studiu na Dornychu.', '(koncept — rozepsáno)'] } ],
    chat: []
  },
  {
    id: 'alza', personal: true, grp: 'inbox', from: { n: 'Alza.cz', ini: 'AL', addr: 'objednavky@alza.cz' },
    subj: 'Objednávka #245-8891 odeslána', snip: 'Balík jsme předali dopravci. Doručení zítra mezi 8:00 a 17:00, sledování v aplikaci.',
    time: '7:44', unread: true, st: 'novy', flag: 'none',
    msgs: [ { dir: 'in', t: 'dnes 7:44', to: 'kosir.adam@gmail.com', body: ['Dobrý den,', 'balík s objednávkou #245-8891 jsme předali dopravci. Doručení zítra mezi 8:00 a 17:00 — sledování najdete v aplikaci.', 'Alza.cz'] } ],
    chat: []
  },
  {
    id: 'tata', personal: true, grp: 'inbox', from: { n: 'Petr Košír', ini: 'PK', addr: 'petr.kosir58@seznam.cz' },
    subj: 'Víkend na chatě?', snip: 'Ahoj, přijedete s Klárou v sobotu na chatu? Mamka peče koláče a chtěla by vidět malou.',
    time: 'ne', st: 'otevreny', flag: 'none',
    msgs: [ { dir: 'in', t: 'ne 6. 7. 19:12', to: 'kosir.adam@gmail.com', body: ['Ahoj,', 'přijedete s Klárou v sobotu na chatu? Mamka peče koláče a chtěla by vidět malou.', 'Dej vědět do čtvrtka. Táta'] } ],
    chat: []
  }
];

/* ── Labely swipe akcí (Modul 12) ── */
export const SWL: Record<string, string> = { done: 'Hotovo', pin: 'Připnout', snooze: 'Odložit', arch: 'Archiv', trash: 'Koš', unread: 'Přečtené' };

/* ── Sdílené šablony odpovědí per schránka ── */
export const TPL: Record<string, MailTemplate[]> = {
  info: [
    { n: 'Potvrzení přijetí', b: 'Dobrý den,\n\nděkujeme za zprávu — evidujeme ji a ozveme se nejpozději do dvou pracovních dnů.\n\nS pozdravem\nT-Group Studio' },
    { n: 'Fakturační údaje', b: 'Dobrý den,\n\nfakturační údaje:\nT-Group Dance z. s., Dornych 47, 617 00 Brno\nIČO 08812345 · účet 2801456789/2010 (Fio)\n\nS pozdravem\nT-Group Studio' },
    { n: 'Termíny kurzů — podzim', b: 'Dobrý den,\n\npodzimní semestr začíná v týdnu od 8. 9. Rozvrh a přihlášky najdete na t-group-dance.cz/kurzy.\n\nS pozdravem\nT-Group Studio' }
  ],
  granty: [
    { n: 'Potvrzení příjmu podkladů', b: 'Vážení,\n\npotvrzujeme přijetí podkladů k žádosti. Po kontrole se ozveme s případnými doplněními.\n\nGrantové oddělení T-Group' },
    { n: 'Žádost o prodloužení termínu', b: 'Vážení,\n\nz důvodu kompletace příloh žádáme o prodloužení termínu pro doplnění žádosti o 14 dní.\n\nGrantové oddělení T-Group' }
  ],
  podcast: [
    { n: 'Podklady pro hosta', b: 'Dobrý den,\n\nděkujeme za potvrzení termínu. Natáčíme ve studiu Dornych 47 — stačí přijít 15 minut předem, okruhy otázek posíláme v příloze.\n\nT-Group Podcast' },
    { n: 'Oslovení hosta', b: 'Dobrý den,\n\nrádi bychom vás pozvali jako hosta do našeho podcastu o tanečním vzdělávání. Natáčení trvá zhruba hodinu, termín přizpůsobíme.\n\nT-Group Podcast' }
  ],
  studio: [
    { n: 'Storno podmínky', b: 'Dobrý den,\n\nlekci lze zrušit bez poplatku nejpozději 24 hodin předem v rezervačním systému. Při pozdějším zrušení vstup propadá.\n\nT-Group Studio Dornych' },
    { n: 'Ceník pronájmu sálů', b: 'Dobrý den,\n\nvelký sál 450 Kč/h, malý sál 300 Kč/h, dlouhodobé pronájmy řešíme individuálně. Obsazenost: t-group-dance.cz/pronajem.\n\nT-Group Studio Dornych' }
  ],
  osobni: []
};

/* ── Prahy swipe gest (px) — krátký/dlouhý tah ── */
export const SW_SHORT = 56;
export const SW_LONG = 190;
