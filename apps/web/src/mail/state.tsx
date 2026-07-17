/**
 * Mail modul — stavové jádro (port `class Component` z design/handoff WatsonMail.dc.html).
 * Demo modul se seed daty (reálný mail backend = samostatný program M1–M3 dle
 * files/MAIL_*.md); drží kontrakt handoffu: per-osoba nepřečtenost (unread +
 * readBy/readAt, režim per/shared per schránka), overrides `ov` (eff), urgence
 * P1–P4 se SLA, stavový automat vlákna, koncepty s persistencí, undo odeslání.
 * Persistence jen UI preference + koncepty (klíče watson-mail.*), ov je efemérní
 * jako v prototypu.
 */
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { migratePrivateJson, writePrivateJson } from "../lib/powersync/privateState";
import { showToast } from "../lib/toast";
import { storageGet, storageSet } from "../lib/storage";
import {
	ADM_SEED,
	type AdmSeed,
	GK,
	type MailSig,
	type MailThread,
	MB,
	NAST_SEED,
	P,
	SIGS,
	SLA,
	STL,
	TH,
} from "./data";
import { belongsToActiveTeamInbox, countsAsUnread, isUrgentMailFlag } from "./digest";

/** Per-thread overrides (prototyp `ov` + eff, ř. 3449–3465). */
export interface ThreadOv {
	st?: string;
	closed?: boolean;
	owner?: string | null;
	sent?: boolean;
	pin?: boolean;
	snoozed?: string | null;
	read?: boolean;
	flag?: string;
	arch?: boolean;
	trash?: boolean;
	spam?: boolean;
	muted?: boolean;
	grp?: string;
	snip?: string;
	time?: string;
	bounceFixed?: boolean;
	/** Odhlášeno z odběru (list-unsubscribe) — jen news skupina. */
	unsub?: boolean;
}

/** Sdílený koncept + schvalování (prototyp state.sd, ř. 4035–4046) — IDENTICKÉ klíče. */
export interface SdState {
	shared?: boolean;
	pending?: boolean;
	approved?: boolean;
	returned?: boolean;
}

export interface ThreadEff {
	st: string;
	closed: boolean;
	owner: string | null;
	sent: boolean;
	pin: boolean;
	snoozed: string | null;
	read: boolean;
	flag: string;
	arch: boolean;
	trash: boolean;
	spam: boolean;
	muted: boolean;
}

export interface DraftState {
	mode: "draft" | "edit" | "empty";
	text: string;
	queued?: boolean;
}

/** Odchozí zpráva přidaná do vlákna po odeslání (prototyp sentX). */
export interface SentMsg {
	dir: "out";
	by: string;
	t: string;
	to: string;
	body: string[];
}

export interface ChatExtra {
	who: string;
	t: string;
	pre: string;
}

export type MailFolder = string; // vse|pinned|odlozene|gatekeeper|osobni|f_*|d_*|<mbId>

/** Vnitřní obrazovka mail modulu (prototyp state.scr, ř. 2282): seznam+vlákno | Dění | Administrace | Nastavení | Příručka. */
export type MailScr = "mail" | "deni" | "admin" | "nastaveni" | "prirucka";

interface UndoState {
	on: boolean;
	left: number;
	mb: string;
	markDone: boolean;
}

/** Most do aplikace (kontrakt handoffu on-nav / task-states / on-create-task). */
export interface MailBridge {
	onNav?: (target: string) => void;
	taskStates?: Record<string, { done: boolean }>;
	/** Vazby vlákno → úkoly odvozené z reálných tasks.mail_th (bridge.tsx). */
	taskLinks?: Record<string, { n: string; owner: string; prio: string; app: string }[]>;
	/** Projekty aplikace pro Email → úkol formulář (L-19: osobní vlákno smí jen osobní). */
	projects?: { id: string; name: string; color: string | null; personal: boolean }[];
	onCreateTask?: (payload: {
		id: string;
		name: string;
		mailTh: string;
		mailLabel: string;
		priority?: number;
		/** Volitelná pole plného formuláře Email → úkol (Modul 10).
		 * dueISO: undefined = pole nebylo v UI (fallback dnešek), null = uživatel
		 * termín vymazal → úkol bez termínu (audit S8). */
		description?: string;
		dueISO?: string | null;
		projectId?: string;
	}) => void | Promise<void>;
}

interface MailCtxValue {
	// data
	threads: MailThread[];
	// stav navigace/seznamu
	folder: MailFolder;
	setFolder: (f: MailFolder) => void;
	/** Aktivní obrazovka modulu (Dění / Administrace / Nastavení místo seznamu+vlákna). */
	scr: MailScr;
	setScr: (v: MailScr) => void;
	fdr: string;
	setFdr: (v: string) => void;
	grp: string;
	setGrp: (v: string) => void;
	filters: { unread: boolean; att: boolean; mine: boolean; fu: boolean };
	toggleFilter: (k: "unread" | "att" | "mine" | "fu") => void;
	sel: string | null;
	/** Kurzor seznamu (j/k) — jen posun výběru, bez otevření/označení přečteno. */
	setSel: (id: string | null) => void;
	ctab: "vlakno" | "chat";
	setCtab: (v: "vlakno" | "chat") => void;
	mstep: "list" | "thread";
	setMstep: (v: "list" | "thread") => void;
	pinExp: boolean;
	setPinExp: (v: boolean) => void;
	rozOn: boolean;
	setRozOn: (v: boolean) => void;
	selIds: Record<string, true>;
	toggleSel: (id: string) => void;
	clearSel: () => void;
	// overrides + predikáty
	ovOf: (id: string) => ThreadOv;
	eff: (t: MailThread) => ThreadEff;
	unreadFor: (t: MailThread) => boolean;
	readModeOf: (t: MailThread) => "per" | "shared";
	unreadStats: () => { total: number; per: Record<string, number>; pers: number };
	msgsOf: (t: MailThread) => number;
	// akce
	openThread: (id: string) => void;
	closeThread: () => void;
	rowAct: (
		id: string,
		kind: "done" | "pin" | "snooze" | "arch" | "trash" | "spam" | "unread" | "mute" | "restore",
	) => void;
	bulkAct: (kind: "done" | "arch" | "trash" | "unread" | "snooze") => void;
	setOv: (id: string, patch: ThreadOv) => void;
	setFlag: (id: string, flag: string) => void;
	setThreadState: (id: string, st: string) => void;
	setOwner: (id: string, owner: string | null) => void;
	// koncepty + odesílání
	drafts: Record<string, DraftState>;
	setDraft: (id: string, text: string, mode?: DraftState["mode"]) => void;
	attached: Record<string, string>;
	attach: (id: string, label: string) => void;
	detach: (id: string) => void;
	sentX: Record<string, SentMsg[]>;
	/** Vrací true, pokud se REÁLNĚ odeslalo (false = zablokováno pojistkou). */
	checkSend: (t: MailThread, markDone: boolean) => boolean;
	// sdílené koncepty + schvalování (prototyp sd, ř. 1272–1291 + 4035–4046)
	sd: Record<string, SdState>;
	sdShare: (id: string) => void;
	sdAsk: (id: string) => void;
	sdApprove: (id: string) => void;
	sdReturn: (id: string) => void;
	/** Hledání zúžené na jedno vlákno (prototyp soTh, ř. 2097–2102). */
	soTh: string | null;
	setSoTh: (v: string | null) => void;
	/** Předvyplnění Nové zprávy (Přeposlat → Fwd:). Nastaví MailThread, čte NewMessage/MailScreen. */
	newMsg: { fwd?: { subj: string; body: string } } | null;
	setNewMsg: (v: { fwd?: { subj: string; body: string } } | null) => void;
	/** Plovoucí composer (prototyp float, ř. 2052–2087) — psaní vedle procházení pošty. */
	float: { id: string; min: boolean } | null;
	setFloat: (v: { id: string; min: boolean } | null) => void;
	undo: UndoState | null;
	undoBack: () => void;
	warn: { id: string; markDone: boolean } | null;
	setWarn: (w: { id: string; markDone: boolean } | null) => void;
	/** Kolizní pojistka per vlákno — globální bool platil napříč vlákny (audit D6). */
	collArmed: Record<string, boolean>;
	// chat
	chatX: Record<string, ChatExtra[]>;
	sendChat: (id: string, text: string) => void;
	chatOff: boolean;
	setChatOff: (v: boolean) => void;
	// per-osoba čtení
	perOsoba: boolean;
	setPerOsoba: (v: boolean) => void;
	mbRead: Record<string, "per" | "shared">;
	setMbRead: (mb: string, mode: "per" | "shared") => void;
	// podpisy composeru (vzor Spark) — klíč = id schránky nebo "osobni", hodnota = id podpisu
	sigChoice: Record<string, string>;
	setSigChoice: (mb: string, sigId: string) => void;
	// uživatelsky definované podpisy (Nastavení → Podpisy, persistováno watson-mail.sigs)
	sigs: MailSig[];
	addSig: (n: string, body: string[]) => void;
	updateSig: (id: string, patch: { n?: string; body?: string[] }) => void;
	deleteSig: (id: string) => void;
	// gatekeeper
	gkDone: Record<string, string>;
	gkDecide: (id: string, verdict: "accept" | "acceptDone" | "block" | "blockDom") => void;
	gkLeft: number;
	// zobrazení
	exp: Record<string, boolean>;
	toggleExp: (key: string) => void;
	/** Explicitní zápis (ne flip) — sbalení zpráv má default „poslední otevřená",
	 * který se odesláním posouvá; flip přes toggleExp se pak četl obráceně (audit D2). */
	setExp: (key: string, open: boolean) => void;
	translated: boolean;
	setTranslated: (v: boolean) => void;
	imgOk: Record<string, boolean>;
	allowImgs: (id: string) => void;
	sum: boolean;
	setSum: (v: boolean) => void;
	// vazby na úkoly (reálné tasks.mail_th přes bridge; seed fallback bez bridge)
	taskLinks: Record<string, { n: string; owner: string; prio: string; app: string }[]>;
	/** Email → úkol jedním klikem (prototyp quickTask, ř. 2594) — přes bridge.onCreateTask.
	 * `silent` potlačí per-vlákno toast (hromadná cesta si dělá souhrn sama). */
	quickTask: (id: string, opts?: { silent?: boolean }) => "created" | "exists" | "busy";
	bridge: MailBridge;
	// admin/nastavení: adm = seed + živé overrides (fixed, ai) — banner v seznamu
	// a warn tečky sidebaru musí vidět, co správce přepnul (audit S5)
	adm: AdmSeed;
	setAdmFixed: (v: boolean) => void;
	setAdmAi: (mb: string, lvl: "off" | "read" | "triage") => void;
	/** Přepnutí role v matici Přístupů — žije v provideru (S5), aby ji viděla
	 * i karta osoby (PersonCard), ne jen lokální cache Administrace. */
	setAdmAcc: (mbid: string, pid: string, v: number) => void;
	nast: typeof NAST_SEED;
}

const Ctx = createContext<MailCtxValue | null>(null);

const LS = {
	drafts: "watson-mail.drafts",
	perOsoba: "watson-mail.perOsoba",
	mbRead: "watson-mail.mbRead",
	chatOff: "watson-mail.chatOff",
	sig: "watson-mail.sig",
	sigs: "watson-mail.sigs",
};

const loadJSON = <T,>(key: string, fallback: T): T => {
	try {
		const raw = storageGet(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};

/** Seed vazeb mail ↔ úkol (prototyp state.taskLinks): faktura ↔ mx1, opjak ↔ mx2. */
const TASK_LINKS_SEED: MailCtxValue["taskLinks"] = {
	faktura: [
		{
			n: "Uhradit opravnou fakturu za nájem — 42 200 Kč",
			owner: "ad",
			prio: "p2",
			app: "mx1",
		},
	],
	opjak: [{ n: "Doplnit rozpočet k žádosti OP JAK", owner: "mh", prio: "p1", app: "mx2" }],
};

export function MailProvider({ children, bridge }: { children: ReactNode; bridge?: MailBridge }) {
	const [folder, setFolderRaw] = useState<MailFolder>("vse");
	const [scr, setScr] = useState<MailScr>("mail");
	const [fdr, setFdr] = useState("dorucene");
	const [grp, setGrp] = useState("inbox");
	const [filters, setFilters] = useState({
		unread: false,
		att: false,
		mine: false,
		fu: false,
	});
	const [sel, setSel] = useState<string | null>("faktura");
	const [ctab, setCtab] = useState<"vlakno" | "chat">("vlakno");
	const [mstep, setMstep] = useState<"list" | "thread">("list");
	const [pinExp, setPinExp] = useState(false);
	const [rozOn, setRozOn] = useState(false);
	const [selIds, setSelIds] = useState<Record<string, true>>({});
	const [ov, setOvState] = useState<Record<string, ThreadOv>>({});
	const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
	const [attached, setAttached] = useState<Record<string, string>>({});
	const [sentX, setSentX] = useState<Record<string, SentMsg[]>>({});
	const [float, setFloat] = useState<{ id: string; min: boolean } | null>(null);
	const [chatX, setChatX] = useState<Record<string, ChatExtra[]>>({});
	const [chatOff, setChatOffRaw] = useState(() => storageGet(LS.chatOff) === "1");
	const [perOsoba, setPerOsobaRaw] = useState(() => storageGet(LS.perOsoba) !== "false");
	const [mbRead, setMbReadState] = useState<Record<string, "per" | "shared">>(() =>
		loadJSON(LS.mbRead, {}),
	);
	// volba podpisu per identita — drží jen explicitní volby, defaulty řeší SigPicker.sigIdOf
	const [sigChoice, setSigChoiceState] = useState<Record<string, string>>({});
	// uživatelské podpisy — seed SIGS jen když v úložišti nic není (pak už žije edit)
	const [sigs, setSigsState] = useState<MailSig[]>(SIGS);
	const [privateHydrated, setPrivateHydrated] = useState(false);
	const [gkDone, setGkDone] = useState<Record<string, string>>({});
	const [sd, setSdState] = useState<Record<string, SdState>>({});
	const [soTh, setSoTh] = useState<string | null>(null);
	const [newMsg, setNewMsg] = useState<{
		fwd?: { subj: string; body: string };
	} | null>(null);
	const [exp, setExpState] = useState<Record<string, boolean>>({});
	const [translated, setTranslated] = useState(false);
	const [imgOk, setImgOk] = useState<Record<string, boolean>>({});
	const [sum, setSum] = useState(true);
	const [undo, setUndo] = useState<UndoState | null>(null);
	const [warn, setWarn] = useState<{ id: string; markDone: boolean } | null>(null);
	const [collArmed, setCollArmed] = useState<Record<string, boolean>>({});
	// S5: admin přepínače žijí v provideru (ov nad ADM_SEED, vzor mbRead) — lokální
	// cache AdminScreen neuměla zhasnout syncWarn banner ani warn tečky sidebaru.
	// Efemérní jako ov, v souladu s prototypem.
	const [admOv, setAdmOv] = useState<{
		fixed?: boolean;
		ai: Record<string, "off" | "read" | "triage">;
		acc: Record<string, Record<string, number>>;
	}>({ ai: {}, acc: {} });
	// Reálné vazby z tasks.mail_th (bridge); seed jen jako fallback bez aplikace.
	const taskLinks = bridge?.taskLinks ?? TASK_LINKS_SEED;

	// Citlivé koncepty a podpisy patří do šifrované local-only SQLite tabulky,
	// ne do čitelného localStorage. Helper zároveň jednorázově přesune stará data.
	useEffect(() => {
		let cancelled = false;
		void Promise.all([
			migratePrivateJson<Record<string, DraftState>>(LS.drafts, {}),
			migratePrivateJson<Record<string, string>>(LS.sig, {}),
			migratePrivateJson<MailSig[]>(LS.sigs, SIGS),
		]).then(([savedDrafts, savedChoice, savedSigs]) => {
			if (cancelled) return;
			setDrafts(savedDrafts);
			setSigChoiceState(savedChoice);
			setSigsState(Array.isArray(savedSigs) && savedSigs.length ? savedSigs : SIGS);
			setPrivateHydrated(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// koncepty přežijí reload (prototyp interval 1,5 s; tady debounce 1,5 s)
	const draftsRef = useRef(drafts);
	draftsRef.current = drafts;
	useEffect(() => {
		void drafts;
		if (!privateHydrated) return;
		const t = setTimeout(() => {
			void writePrivateJson(LS.drafts, draftsRef.current).catch(() => {
				/* DB chyba — koncept zůstává v paměti a další změna zápis zopakuje */
			});
		}, 1500);
		return () => clearTimeout(t);
	}, [drafts, privateHydrated]);
	// flush při zavření/skrytí stránky — jinak reload do 1,5 s od posledního
	// úhozu ztratí text (audit S9; UI slibuje průběžné ukládání)
	useEffect(() => {
		const flush = () => {
			if (privateHydrated)
				void writePrivateJson(LS.drafts, draftsRef.current).catch(() => {
					/* nejlepší možný flush; debounce při další změně zápis zopakuje */
				});
		};
		document.addEventListener("visibilitychange", flush);
		return () => {
			document.removeEventListener("visibilitychange", flush);
		};
	}, [privateHydrated]);

	const undoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
	const prevSend = useRef<{
		id: string;
		ov: ThreadOv | undefined;
		draft: DraftState | undefined;
		att: string | undefined;
		sent: SentMsg[] | undefined;
	} | null>(null);
	// per vlákno (D6) — jeden sdílený timer by odjištění jednoho vlákna zrušil jinému
	const collTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	// synchronní zámek proti dvojímu založení úkolu — taskLinks se plní až po
	// PowerSync roundtripu, takže dvojklik by jinak založil dva stejné úkoly (audit D8)
	const quickTaskLock = useRef<Set<string>>(new Set());

	// D11: timery nesmí přežít provider — setState po unmountu + únik intervalu
	useEffect(
		() => () => {
			if (undoTimer.current) clearInterval(undoTimer.current);
			for (const timer of Object.values(collTimer.current)) clearTimeout(timer);
		},
		[],
	);

	const ovOf = useCallback((id: string): ThreadOv => ov[id] ?? {}, [ov]);
	const setOv = useCallback((id: string, patch: ThreadOv) => {
		setOvState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
	}, []);

	/** Efektivní stav vlákna — seed + override (prototyp eff, ř. 3452). */
	const eff = useCallback(
		(t: MailThread): ThreadEff => {
			const o = ov[t.id] ?? {};
			const st = o.st ?? t.st;
			const flag =
				o.flag !== undefined
					? o.flag
					: t.flag === "prop"
						? "p2" // výchozí urgenceVlajky prop prototypu
						: (t.flag ?? "none");
			return {
				st,
				closed: !!o.closed || st === "hotovo",
				owner: o.owner !== undefined ? o.owner : (t.owner ?? null),
				sent: !!o.sent,
				pin: o.pin !== undefined ? !!o.pin : !!t.pin,
				snoozed: o.snoozed !== undefined ? o.snoozed : (t.snoozed ?? null),
				read: !!o.read,
				flag,
				arch: !!o.arch,
				trash: !!o.trash,
				spam: !!o.spam,
				muted: !!o.muted,
			};
		},
		[ov],
	);

	/** Režim čtení: osobní vždy per; jinak per schránka / globální výchozí. */
	const readModeOf = useCallback(
		(t: MailThread): "per" | "shared" => {
			if (t.personal) return "per";
			return mbRead[t.mb] ?? (perOsoba ? "per" : "shared");
		},
		[mbRead, perOsoba],
	);

	/** Per-osoba nepřečtenost (prototyp unreadFor, ř. 3472). Explicitní override
	 * ov.read má přednost před seedem — jinak „Označit jako nepřečtené" nefunguje
	 * u vláken bez seed unread (audit K2). */
	const unreadFor = useCallback(
		(t: MailThread): boolean => {
			const o = ov[t.id];
			const mine = o?.read !== undefined ? !o.read : !!t.unread;
			if (readModeOf(t) === "per") return mine;
			return mine && !(t.readBy ?? []).length;
		},
		[ov, readModeOf],
	);

	/** Souhrn nepřečtených (badge sidebar + per schránka; prototyp ř. 3473–3484). */
	const unreadStats = useCallback(() => {
		const per: Record<string, number> = {};
		let total = 0;
		let pers = 0;
		for (const t of TH) {
			const e = eff(t);
			if (
				!countsAsUnread({
					personal: !!t.personal,
					sent: !!t.sentF,
					draft: !!t.draftF,
					archived: e.arch,
					trashed: e.trash,
					spam: e.spam,
					snoozed: !!e.snoozed,
					muted: e.muted,
					closed: e.closed,
				})
			)
				continue;
			if (!unreadFor(t)) continue;
			if (t.personal) {
				pers++;
				continue;
			}
			total++;
			per[t.mb] = (per[t.mb] ?? 0) + 1;
		}
		return { total, per, pers };
	}, [eff, unreadFor]);

	const msgsOf = useCallback(
		(t: MailThread) => t.msgs.length + (sentX[t.id]?.length ?? 0),
		[sentX],
	);

	const setFolder = useCallback((f: MailFolder) => {
		setFolderRaw(f);
		setScr("mail"); // klik na složku vrací z Dění/Administrace/Nastavení do seznamu
		setFdr("dorucene");
		setGrp("inbox");
		setMstep("list");
	}, []);

	/** Otevření vlákna = přečteno pro mě (per-osoba vrstva) + mobilní krok. */
	const openThread = useCallback(
		(id: string) => {
			setSel(id);
			setCtab("vlakno");
			setMstep("thread");
			setTranslated(false);
			setOv(id, { read: true });
		},
		[setOv],
	);
	const closeThread = useCallback(() => setMstep("list"), []);

	const toggleSel = useCallback((id: string) => {
		setSelIds((s) => {
			const next = { ...s };
			if (next[id]) delete next[id];
			else next[id] = true;
			return next;
		});
	}, []);
	const clearSel = useCallback(() => setSelIds({}), []);

	/** Akce řádku (prototyp rowAct, ř. 2884–2906). Osobní „done" → archiv. */
	const rowAct = useCallback<MailCtxValue["rowAct"]>(
		(id, kindRaw) => {
			const t = TH.find((x) => x.id === id);
			if (!t) return;
			const kind = kindRaw === "done" && t.personal ? "arch" : kindRaw;
			const e = eff(t);
			const undoPatch = (patch: ThreadOv, label: string) => {
				const prev: ThreadOv = {};
				for (const k of Object.keys(patch) as (keyof ThreadOv)[]) {
					// biome-ignore lint/suspicious/noExplicitAny: zrcadlení klíčů patche
					(prev as any)[k] = (ovOf(id) as any)[k];
				}
				setOv(id, patch);
				showToast(label, {
					label: "Zpět",
					onClick: () => setOv(id, prev),
				});
			};
			switch (kind) {
				case "done":
					undoPatch({ st: "hotovo", closed: true, read: true }, "Hotovo");
					break;
				case "pin":
					setOv(id, { pin: !e.pin });
					break;
				case "snooze":
					undoPatch({ snoozed: "zítra 8:00" }, "Odloženo na zítra 8:00");
					break;
				case "arch":
					undoPatch({ arch: true, read: true }, "Archivováno");
					break;
				case "trash":
					undoPatch({ trash: true }, "Přesunuto do koše");
					break;
				case "spam":
					undoPatch({ spam: true }, "Označeno jako blokované");
					break;
				case "unread":
					setOv(id, { read: !e.read });
					break;
				case "mute":
					setOv(id, { muted: !e.muted });
					break;
				case "restore":
					undoPatch({ arch: false, trash: false, snoozed: null, spam: false }, "Vráceno do Inboxu");
					break;
			}
		},
		[eff, ovOf, setOv],
	);

	const bulkAct = useCallback<MailCtxValue["bulkAct"]>(
		(kind) => {
			const ids = Object.keys(selIds);
			if (!ids.length) return;
			// Jeden souhrnný snapshot + jeden toast se společným Zpět. Dřív bulk volal
			// rowAct N×, jenže showToast je singleton → viděl jsi jen poslední toast a
			// jeho Zpět vrátil jen jedno vlákno (audit R553). Zpět teď obnoví všechna
			// dotčená vlákna najednou; „bulk tlačítko Přečtené" značí PŘEČTENÉ (K3).
			const patchFor = (id: string): ThreadOv | null => {
				const t = TH.find((x) => x.id === id);
				if (!t) return null;
				if (kind === "unread") return { read: true };
				if (kind === "snooze") return { snoozed: "zítra 8:00" };
				// osobní „done" → archiv (parita s rowAct)
				const k = kind === "done" && t.personal ? "arch" : kind;
				if (k === "done") return { st: "hotovo", closed: true, read: true };
				if (k === "arch") return { arch: true, read: true };
				if (k === "trash") return { trash: true };
				return null;
			};
			const prev: Record<string, ThreadOv> = {};
			const next: Record<string, ThreadOv> = {};
			for (const id of ids) {
				const patch = patchFor(id);
				if (!patch) continue;
				const before: ThreadOv = {};
				for (const key of Object.keys(patch) as (keyof ThreadOv)[]) {
					// biome-ignore lint/suspicious/noExplicitAny: zrcadlení klíčů patche
					(before as any)[key] = (ovOf(id) as any)[key];
				}
				prev[id] = before;
				next[id] = patch;
			}
			setSelIds({});
			const n = Object.keys(next).length;
			if (!n) return;
			setOvState((s) => {
				const merged = { ...s };
				for (const id of Object.keys(next)) merged[id] = { ...merged[id], ...next[id] };
				return merged;
			});
			const labels: Record<string, string> = {
				done: "hotovo",
				arch: "archivováno",
				trash: "přesunuto do koše",
				unread: "označeno jako přečtené",
				snooze: "odloženo na zítra 8:00",
			};
			showToast(`${n} ${labels[kind]}`, {
				label: "Zpět",
				onClick: () =>
					setOvState((s) => {
						const merged = { ...s };
						for (const id of Object.keys(prev)) merged[id] = { ...merged[id], ...prev[id] };
						return merged;
					}),
			});
		},
		[selIds, ovOf],
	);

	/** Vlajka urgence: P1/P2 hlásí auto-úkol „Odpovědět: …" (prototyp setFlag, ř. 4109). */
	const setFlagAct = useCallback(
		(id: string, flag: string) => {
			setOv(id, { flag });
			const t = TH.find((x) => x.id === id);
			if (!t) return;
			if (flag === "p1" || flag === "p2") {
				showToast(
					`${SLA[flag]?.chip ?? flag.toUpperCase()} — vznikl úkol „Odpovědět: ${t.subj.slice(0, 32)}…" (${SLA[flag]?.sla ?? ""})`,
				);
			} else if (flag === "p3" || flag === "p4") {
				showToast(`${SLA[flag]?.chip ?? ""} — jen vlajka a follow-up, bez úkolu`);
			}
		},
		[setOv],
	);

	/** Stavový automat vlákna: hotovo = terminál pro urgenci; reopen SLA obnoví. */
	const setThreadState = useCallback(
		(id: string, st: string) => {
			const wasClosed = !!ovOf(id).closed;
			setOv(id, { st, closed: st === "hotovo" });
			if (st === "hotovo")
				showToast("Hotovo — urgence se už neobnoví, i kdyby přišla další zpráva");
			else if (wasClosed) showToast(`Znovu otevřeno — ${STL[st] ?? st}`);
		},
		[ovOf, setOv],
	);

	const setOwner = useCallback(
		(id: string, owner: string | null) => {
			setOv(id, { owner });
			showToast(owner ? `Přiřazeno: ${P[owner]?.n ?? owner}` : "Přiřazení zrušeno");
		},
		[setOv],
	);

	const setDraft = useCallback((id: string, text: string, mode: DraftState["mode"] = "edit") => {
		setDrafts((s) => ({ ...s, [id]: { ...s[id], mode, text } }));
	}, []);
	const attach = useCallback((id: string, label: string) => {
		setAttached((s) => ({ ...s, [id]: label }));
	}, []);
	const detach = useCallback((id: string) => {
		setAttached((s) => {
			const next = { ...s };
			delete next[id];
			return next;
		});
	}, []);

	/** Text, který se REÁLNĚ odešle. Explicitní draft record (i prázdný „empty"
	 * po Zahodit) je autoritativní; na AI návrh t.draft se fallbackuje jen když
	 * žádný draft record neexistuje. Dřív checkSend počítal text přes `??` a doSend
	 * přes `||`, takže po Zahodit odešel zahozený t.draft a hlídač přílohy hlídal
	 * jiný text než co se poslalo (audit HIGH state.tsx:622). */
	const outgoingText = useCallback(
		(t: MailThread): string => {
			const d = drafts[t.id];
			return d ? d.text : (t.draft ?? []).join("\n");
		},
		[drafts],
	);

	/** Odeslání (prototyp sendReply, ř. 4117): zpráva do vlákna, stav, undo okno 10 s. */
	const doSend = useCallback(
		(t: MailThread, markDone: boolean) => {
			const text = outgoingText(t);
			// zvolený podpis (SigBlock) se připojí PŘI odeslání (audit MED
			// MailThread:3652) — v editoru je jen náhled, do těla nepatří.
			const mbKey = t.personal ? "osobni" : t.mb;
			const sigId = sigChoice[mbKey] ?? (mbKey === "osobni" ? "kratky" : "plny");
			const sig = sigs.find((s) => s.id === sigId)?.body ?? [];
			prevSend.current = {
				id: t.id,
				ov: ov[t.id] ? { ...ov[t.id] } : undefined,
				draft: drafts[t.id] ? { ...(drafts[t.id] as DraftState) } : undefined,
				att: attached[t.id],
				sent: sentX[t.id] ? [...(sentX[t.id] as SentMsg[])] : undefined,
			};
			const msg: SentMsg = {
				dir: "out",
				by: "ad",
				t: "teď",
				to: t.from.n,
				body: [...text.split("\n").filter(Boolean), ...(sig.length ? ["", ...sig] : [])],
			};
			setSentX((s) => ({ ...s, [t.id]: [...(s[t.id] ?? []), msg] }));
			setOv(t.id, {
				st: markDone ? "hotovo" : "odeslano",
				closed: markDone,
				sent: true,
				read: true,
				snip: `Ty: ${text.slice(0, 64)}`,
				time: "teď",
			});
			setDrafts((s) => {
				const next = { ...s };
				delete next[t.id];
				return next;
			});
			detach(t.id);
			setWarn(null);
			// undo lišta 10 s (prototyp startUndo, ř. 3497)
			if (undoTimer.current) clearInterval(undoTimer.current);
			setUndo({ on: true, left: 10, mb: t.mb ?? "osobni", markDone });
			undoTimer.current = setInterval(() => {
				setUndo((u) => {
					if (!u) return null;
					if (u.left <= 1) {
						if (undoTimer.current) clearInterval(undoTimer.current);
						return null;
					}
					return { ...u, left: u.left - 1 };
				});
			}, 1000);
		},
		[outgoingText, ov, attached, sentX, setOv, detach, drafts, sigChoice, sigs],
	);

	/** Řetěz ochran před odesláním (prototyp checkSend, ř. 3406–3429).
	 * Vrací true, když se skutečně odeslalo — plovoucí composer podle toho zavírá okno. */
	const checkSend = useCallback(
		(t: MailThread, markDone: boolean): boolean => {
			// prázdné tělo neodesílej — dřív se přes fallbacky odeslal zahozený nebo
			// úplně prázdný obsah bez varování (audit HIGH state.tsx:622)
			const text = outgoingText(t);
			if (!text.trim()) {
				showToast("Prázdná zpráva — napiš text před odesláním.");
				return false;
			}
			// sdílený koncept ve schvalování — pending && !approved blokuje odeslání
			const sdt = sd[t.id];
			if (sdt?.pending && !sdt.approved) {
				showToast("Koncept čeká na schválení — odeslat ho půjde až po schválení pověřenou osobou.");
				return false;
			}
			if (sdt?.returned && !sdt.approved) {
				showToast("Koncept je vrácený s komentářem — uprav ho a vyžádej schválení znovu.");
				return false;
			}
			// kolizní pojistka — kolega právě dopisuje (seed t.coll); druhý klik do 6 s
			// odešle. Odjištění platí JEN pro tohle vlákno (D6) — globální bool by
			// nechal projít bez varování i odeslání v jiném kolizním vlákně.
			if (t.coll && !collArmed[t.id]) {
				setCollArmed((s) => ({ ...s, [t.id]: true }));
				showToast("Petra právě dopisuje odpověď — kliknutím znovu odešleš i tak");
				if (collTimer.current[t.id]) clearTimeout(collTimer.current[t.id]);
				collTimer.current[t.id] = setTimeout(
					() => setCollArmed((s) => ({ ...s, [t.id]: false })),
					6000,
				);
				return false;
			}
			setCollArmed((s) => (s[t.id] ? { ...s, [t.id]: false } : s));
			// hlídání přílohy: text slibuje přílohu, ale žádná není. Negace („nepřikládám")
			// se odstraní, ať nespustí planý poplach (audit LOW NewMessage.tsx:150).
			const attText = text.replace(/nepřikládám|nepřiložen\w*/gi, " ");
			if (/příloh|příloz|přikládám|přiložen|attach/i.test(attText) && !attached[t.id]) {
				setWarn({ id: t.id, markDone });
				return false;
			}
			doSend(t, markDone);
			return true;
		},
		[collArmed, attached, doSend, sd, outgoingText],
	);

	/* Sdílené koncepty + schvalování (prototyp sdShare/sdAsk/sdApprove/sdReturn,
	 * ř. 4042–4045). Demo: schvaluje „Tereza" kliknutím v tomtéž UI. */
	const sdPatch = useCallback((id: string, patch: SdState) => {
		setSdState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
	}, []);
	const sdShare = useCallback((id: string) => {
		const t = TH.find((x) => x.id === id);
		setSdState((s) => ({ ...s, [id]: { shared: true } }));
		showToast(
			`Koncept sdílen s týmem ${(t && !t.personal && MB[t.mb]?.short) || ""} — píšete ho spolu, změny se slévají živě.`,
		);
	}, []);
	const sdAsk = useCallback(
		(id: string) => {
			sdPatch(id, { pending: true, returned: false });
			showToast("Simulace: odesláno ke schválení Tereze — do té doby koncept nejde odeslat.");
		},
		[sdPatch],
	);
	const sdApprove = useCallback(
		(id: string) => {
			const t = TH.find((x) => x.id === id);
			sdPatch(id, { approved: true, pending: false, returned: false });
			showToast(
				`Schváleno (Tereza) — koncept je odemčený k odeslání. Odejde za ${(t && !t.personal && MB[t.mb]?.short) || ""}; audit zaznamená autora i schvalovatele.`,
			);
		},
		[sdPatch],
	);
	const sdReturn = useCallback(
		(id: string) => {
			sdPatch(id, { returned: true, pending: false });
			showToast(
				"Vráceno s komentářem — autor koncept upraví a vyžádá schválení znovu. Zapsáno do Dění.",
			);
		},
		[sdPatch],
	);

	/** Zpět vzetí odeslání — obnoví koncept i stav (prototyp undoBack, ř. 4148). */
	const undoBack = useCallback(() => {
		const p = prevSend.current;
		if (!p) return;
		if (undoTimer.current) clearInterval(undoTimer.current);
		setUndo(null);
		setOvState((s) => {
			const next = { ...s };
			if (p.ov) next[p.id] = p.ov;
			else delete next[p.id];
			return next;
		});
		setDrafts((s) => {
			const next = { ...s };
			if (p.draft) next[p.id] = p.draft;
			else delete next[p.id];
			return next;
		});
		setSentX((s) => {
			const next = { ...s };
			if (p.sent) next[p.id] = p.sent;
			else delete next[p.id];
			return next;
		});
		if (p.att) setAttached((s) => ({ ...s, [p.id]: p.att as string }));
		showToast("Odeslání vzato zpět — koncept je zpátky v editoru");
		prevSend.current = null;
	}, []);

	const sendChat = useCallback((id: string, text: string) => {
		if (!text.trim()) return;
		setChatX((s) => ({
			...s,
			[id]: [...(s[id] ?? []), { who: "ad", t: "teď", pre: text.trim() }],
		}));
	}, []);

	const setPerOsoba = useCallback((v: boolean) => {
		setPerOsobaRaw(v);
		storageSet(LS.perOsoba, String(v));
	}, []);
	const setMbRead = useCallback((mb: string, mode: "per" | "shared") => {
		setMbReadState((s) => {
			const next = { ...s, [mb]: mode };
			storageSet(LS.mbRead, JSON.stringify(next));
			return next;
		});
	}, []);
	const setSigChoice = useCallback((mb: string, sigId: string) => {
		setSigChoiceState((s) => {
			const next = { ...s, [mb]: sigId };
			void writePrivateJson(LS.sig, next).catch(() => {});
			return next;
		});
	}, []);
	const addSig = useCallback((n: string, body: string[]) => {
		setSigsState((prev) => {
			const next = [...prev, { id: crypto.randomUUID(), n: n.trim() || "Podpis", body }];
			void writePrivateJson(LS.sigs, next).catch(() => {});
			return next;
		});
	}, []);
	const updateSig = useCallback((id: string, patch: { n?: string; body?: string[] }) => {
		setSigsState((prev) => {
			const next = prev.map((s) =>
				s.id === id
					? {
							...s,
							...(patch.n !== undefined ? { n: patch.n } : null),
							...(patch.body !== undefined ? { body: patch.body } : null),
						}
					: s,
			);
			void writePrivateJson(LS.sigs, next).catch(() => {});
			return next;
		});
	}, []);
	const deleteSig = useCallback((id: string) => {
		setSigsState((prev) => {
			const next = prev.filter((s) => s.id !== id);
			void writePrivateJson(LS.sigs, next).catch(() => {});
			return next;
		});
	}, []);
	const setChatOff = useCallback((v: boolean) => {
		setChatOffRaw(v);
		storageSet(LS.chatOff, v ? "1" : "0");
	}, []);

	const gkDecide = useCallback<MailCtxValue["gkDecide"]>((id, verdict) => {
		setGkDone((s) => ({ ...s, [id]: verdict }));
		const g = GK.find((x) => x.id === id);
		const labels: Record<string, string> = {
			accept: "Povoleno — příště rovnou do Inboxu",
			acceptDone: "Povoleno a rovnou vyřízeno",
			block: "Blokováno — odesílatel už neprojde",
			blockDom: "Blokována celá doména",
		};
		showToast(`${g?.name ?? id}: ${labels[verdict]}`);
	}, []);

	const toggleExp = useCallback((key: string) => {
		setExpState((s) => ({ ...s, [key]: !s[key] }));
	}, []);
	// D2: explicitní hodnota — volající si drží vlastní default (poslední zpráva
	// otevřená), flip by se po posunu „poslední" interpretoval obráceně
	const setExp = useCallback((key: string, open: boolean) => {
		setExpState((s) => ({ ...s, [key]: open }));
	}, []);
	const setAdmFixed = useCallback((v: boolean) => {
		setAdmOv((s) => ({ ...s, fixed: v }));
	}, []);
	const setAdmAi = useCallback((mb: string, lvl: "off" | "read" | "triage") => {
		setAdmOv((s) => ({ ...s, ai: { ...s.ai, [mb]: lvl } }));
	}, []);
	const setAdmAcc = useCallback((mbid: string, pid: string, v: number) => {
		setAdmOv((s) => ({
			...s,
			acc: { ...s.acc, [mbid]: { ...s.acc[mbid], [pid]: v } },
		}));
	}, []);
	// S5: merge seed + ov drží tvar ADM_SEED — konzumenti (MailList banner,
	// MailSub tečky, MailThread AI) čtou m.adm beze změny a vidí živý stav.
	// acc (matice Přístupů) žije taky tady, aby karta osoby (PersonCard) viděla
	// změny z matice, ne jen seed (audit LOW AdminScreen.tsx:597).
	const adm = useMemo<AdmSeed>(
		() => ({
			...ADM_SEED,
			fixed: admOv.fixed ?? ADM_SEED.fixed,
			ai: { ...ADM_SEED.ai, ...admOv.ai },
			acc: Object.fromEntries(
				Array.from(new Set([...Object.keys(ADM_SEED.acc), ...Object.keys(admOv.acc)])).map(
					(mbid) => [mbid, { ...ADM_SEED.acc[mbid], ...admOv.acc[mbid] }],
				),
			),
		}),
		[admOv],
	);
	const allowImgs = useCallback((id: string) => {
		setImgOk((s) => ({ ...s, [id]: true }));
	}, []);
	const toggleFilter = useCallback((k: "unread" | "att" | "mine" | "fu") => {
		setFilters((s) => ({ ...s, [k]: !s[k] }));
	}, []);

	const gkLeft = GK.filter((g) => !gkDone[g.id]).length;

	/** Email → úkol jedním klikem (prototyp quickTask, ř. 2594–2610): priorita
	 * z vlajky (p1/p2 → P1/P2, jinak P3), termín dnes, název „Odpovědět: …". */
	const quickTask = useCallback<MailCtxValue["quickTask"]>(
		(id, opts) => {
			const t = TH.find((x) => x.id === id);
			if (!t || !bridge?.onCreateTask) return "busy";
			if ((taskLinks[id] ?? []).length) {
				if (!opts?.silent) showToast("Vlákno už úkol má — stav vidíš na chipu");
				return "exists";
			}
			// synchronní zámek přežije stale taskLinks (PowerSync roundtrip) — dvojklik
			// jinak založí dva stejné úkoly (audit MED state.tsx:858)
			if (quickTaskLock.current.has(id)) return "busy";
			quickTaskLock.current.add(id);
			const o = ov[id] ?? {};
			const flag = o.flag ?? (t.flag === "prop" ? "p2" : (t.flag ?? "none"));
			void Promise.resolve(
				bridge.onCreateTask({
					id: crypto.randomUUID(),
					name: `Odpovědět: ${t.subj}`,
					mailTh: t.id,
					mailLabel: t.subj,
					priority: flag === "p1" ? 1 : flag === "p2" ? 2 : 3,
				}),
			).finally(() => {
				quickTaskLock.current.delete(id);
			});
			return "created";
		},
		[bridge, taskLinks, ov],
	);

	const value = useMemo<MailCtxValue>(
		() => ({
			threads: TH,
			folder,
			setFolder,
			scr,
			setScr,
			fdr,
			setFdr,
			grp,
			setGrp,
			filters,
			toggleFilter,
			sel,
			setSel,
			ctab,
			setCtab,
			mstep,
			setMstep,
			pinExp,
			setPinExp,
			rozOn,
			setRozOn,
			selIds,
			toggleSel,
			clearSel,
			ovOf,
			eff,
			unreadFor,
			readModeOf,
			unreadStats,
			msgsOf,
			openThread,
			closeThread,
			rowAct,
			bulkAct,
			setOv,
			setFlag: setFlagAct,
			setThreadState,
			setOwner,
			drafts,
			setDraft,
			attached,
			attach,
			detach,
			sentX,
			checkSend,
			sd,
			sdShare,
			sdAsk,
			sdApprove,
			sdReturn,
			soTh,
			setSoTh,
			newMsg,
			setNewMsg,
			float,
			setFloat,
			undo,
			undoBack,
			warn,
			setWarn,
			collArmed,
			chatX,
			sendChat,
			chatOff,
			setChatOff,
			perOsoba,
			setPerOsoba,
			mbRead,
			setMbRead,
			sigChoice,
			setSigChoice,
			sigs,
			addSig,
			updateSig,
			deleteSig,
			gkDone,
			gkDecide,
			gkLeft,
			exp,
			toggleExp,
			setExp,
			translated,
			setTranslated,
			imgOk,
			allowImgs,
			sum,
			setSum,
			taskLinks,
			quickTask,
			bridge: bridge ?? {},
			adm,
			setAdmFixed,
			setAdmAi,
			setAdmAcc,
			nast: NAST_SEED,
		}),
		[
			folder,
			setFolder,
			scr,
			fdr,
			grp,
			filters,
			toggleFilter,
			sel,
			ctab,
			mstep,
			pinExp,
			rozOn,
			selIds,
			toggleSel,
			clearSel,
			ovOf,
			eff,
			unreadFor,
			readModeOf,
			unreadStats,
			msgsOf,
			openThread,
			closeThread,
			rowAct,
			bulkAct,
			setOv,
			setFlagAct,
			setThreadState,
			setOwner,
			drafts,
			setDraft,
			attached,
			attach,
			detach,
			sentX,
			checkSend,
			sd,
			sdShare,
			sdAsk,
			sdApprove,
			sdReturn,
			soTh,
			newMsg,
			float,
			undo,
			undoBack,
			warn,
			collArmed,
			chatX,
			sendChat,
			chatOff,
			setChatOff,
			perOsoba,
			setPerOsoba,
			mbRead,
			setMbRead,
			sigChoice,
			setSigChoice,
			sigs,
			addSig,
			updateSig,
			deleteSig,
			gkDone,
			gkDecide,
			gkLeft,
			exp,
			toggleExp,
			setExp,
			translated,
			imgOk,
			allowImgs,
			sum,
			taskLinks,
			quickTask,
			bridge,
			adm,
			setAdmFixed,
			setAdmAi,
			setAdmAcc,
		],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMail(): MailCtxValue {
	const v = useContext(Ctx);
	if (!v) throw new Error("useMail mimo MailProvider");
	return v;
}

/** Souhrn pro zbytek aplikace (badge sidebar). */
export function useMailUnread(): number {
	const v = useContext(Ctx);
	if (!v) return 0;
	return v.unreadStats().total;
}

export interface MailDigestItem {
	id: string;
	from: string;
	ini: string;
	subj: string;
	mb: string;
	mbShort: string;
	time: string;
	unread: boolean;
	flag: string;
	hasTask: boolean;
}

export interface MailDigest {
	items: MailDigestItem[];
	unread: number;
	/** Celý aktivní týmový inbox; nesmí se odvozovat jen z top-8 náhledu. */
	urgent: number;
}

const FLAG_ORD: Record<string, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };

/**
 * Digest pošty pro Přehled a Velín (prototyp _sendDigest, ř. 2575–2593):
 * top-8 inboxových vláken řazených dle urgence/pinu/nepřečtenosti + celkový
 * počet nepřečtených. (Bez filtru firmy — seed svět mailu je jiný než seed
 * aplikace; v produkci mapuje schránku na firmu MBF.)
 */
export function useMailDigest(): MailDigest | null {
	const v = useContext(Ctx);
	return useMemo(() => {
		if (!v) return null;
		const inbox = v.threads.filter((t) => {
			const e = v.eff(t);
			return belongsToActiveTeamInbox(
				{
					personal: !!t.personal,
					sent: !!t.sentF,
					draft: !!t.draftF,
					archived: e.arch,
					trashed: e.trash,
					spam: e.spam,
					snoozed: !!e.snoozed,
					muted: e.muted,
					closed: e.closed,
				},
				v.ovOf(t.id).grp ?? t.grp,
			);
		});
		const urgent = inbox.filter((thread) => isUrgentMailFlag(v.eff(thread).flag)).length;
		const rows = inbox
			.sort((a, b) => {
				const ea = v.eff(a);
				const eb = v.eff(b);
				return (
					(FLAG_ORD[ea.flag] ?? 4) - (FLAG_ORD[eb.flag] ?? 4) ||
					Number(eb.pin) - Number(ea.pin) ||
					Number(v.unreadFor(b)) - Number(v.unreadFor(a))
				);
			})
			.slice(0, 8)
			.map((t) => ({
				id: t.id,
				from: t.from.n,
				ini: t.from.ini,
				subj: t.subj,
				mb: t.mb ?? "osobni",
				mbShort: t.mb ? `${t.mb}@` : "osobní",
				time: v.ovOf(t.id).time ?? t.time,
				unread: v.unreadFor(t),
				flag: v.eff(t).flag,
				hasTask: (v.taskLinks[t.id] ?? []).length > 0,
			}));
		return { items: rows, unread: v.unreadStats().total, urgent };
	}, [v]);
}

/** Otevření vlákna odjinud z aplikace (chip „Z mailu" v detailu úkolu). */
export function useOpenMailThread(): ((id: string) => void) | null {
	const v = useContext(Ctx);
	if (!v) return null;
	return v.openThread;
}
