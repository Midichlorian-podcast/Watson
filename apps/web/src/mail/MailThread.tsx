/**
 * Mail — panel 3: Thread workspace (prototyp data-threadpane, ř. 785–1380).
 * VRSTVA 4 hlavička (subjekt, urgence P1–P4, stav, přiřazení, per-osoba čtení),
 * SLA lišta (ř. 898–916), záložky Vlákno/Interní chat (ř. 917–930), čtecí
 * sloupec (navázané úkoly, AI shrnutí, zprávy s citacemi/překladem/HTML
 * ostrovem, ř. 931–1051), interní chat záložka + pravý panel (ř. 1052–1146)
 * a composer VRSTVA 2 (ř. 1147–1380): RTE editor s toolbariem, Cc/Bcc, šablony,
 * AI draft karta, sdílené koncepty + schvalování, důvěrný režim, Odeslat později,
 * kontrola přílohy, kolizní hlídka a undo lišta (overlaye prototypu ř. 2207–2230).
 */
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { copyDeepLink } from "../lib/deepLink";
import { keyedValues } from "../lib/keyedValues";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import { TEXT_COLORS } from "./colors";
import { MB, P, SLA, STL, TPL } from "./data";
import { HostPreview } from "./HostPreview";
import { RecipientField, SigBlock, SigPicker, sigIdOf } from "./SigPicker";
import { escapeHtmlText, safeRichTextHref } from "./sanitizeRichText";
import { useMail } from "./state";
import { TaskModal } from "./TaskModal";

/** Otevřený popover hlavičky — jen jeden najednou (prototyp state.pop). */
type Pop = "flag" | "state" | "assign" | "more" | null;

/** Popovery composeru (odkaz / šablony / odeslat později / proč návrh). */
type CPop = "lnk" | "tpl" | "send" | "why" | null;

/** Sjednocená zpráva vlákna: seed MailMsg + odeslané SentMsg (prototyp msgsOf). */
interface UMsg {
	dir: "in" | "out";
	by?: string;
	t: string;
	to: string;
	att?: string;
	body: string[];
	quote?: string[];
	en?: boolean;
	cz?: string[];
}

/** Položka interní diskuse včetně systémových řádků (prototyp thr.chat, ř. 3831–3838). */
type ChatItem =
	| { sys: true; text: string }
	| {
			sys: false;
			ini: string;
			name: string;
			av: string;
			t: string;
			pre: string;
			m: string;
			post: string;
			ai: boolean;
	  };

/** Odeslání odložené na další render — viz komentář u warn modalu. */
interface PendSend {
	id: string;
	markDone: boolean;
	/** počet sentX zpráv před pokusem — nárůst = odesláno */
	base: number;
}

/** Skloňování počtu zpráv (prototyp pl, ř. 3466). */
const pl = (n: number) => (n === 1 ? "zpráva" : n < 5 ? "zprávy" : "zpráv");

/** První jméno (prototyp owner.n.split(' ')[0]). */
const first = (n: string) => n.split(" ")[0] ?? n;

/** Texty quick reply chipů (prototyp quickBody, ř. 3993–3997). */
const QUICK_BODY: Record<string, string> = {
	"Úhradu potvrzujeme":
		"Dobrý den, pane Horáku,\n\npotvrzujeme — částka 42 200 Kč odejde dnes z našeho provozního účtu. Potvrzení o platbě pošlu po provedení příkazu.\n\nAdam Košír, T-Group Studio",
	Poděkovat: "Dobrý den,\n\nděkujeme za zprávu i rychlé vyřízení.\n\nAdam Košír, T-Group Studio",
	"Vyžádat podklady":
		"Dobrý den,\n\nprosím pošlete nám k platbě ještě QR kód nebo variabilní symbol pro spárování.\n\nAdam Košír, T-Group Studio",
};

/** Jméno fake přílohy (prototyp warnVals/comp.attach, ř. 4096, 4446). */
const ATT_NAME = "potvrzeni_platby_2026-0714b.pdf · 121 kB";
/** Neviditelný marker „poslat bez přílohy" — projde regexem checkSend, chip se nekreslí. */
const ATT_MARK = "—";

/** Text konceptu → HTML pro RTE (prototyp rteHtmlFromDraft, ř. 2826–2831). */
const textToHtml = (txt: string): string =>
	txt
		? txt
				.split("\n")
				.map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;"))
				.join("<br>")
		: "";

/* ── sdílené kousky markup ── */

const avStyle = (size: number, fs: number): CSSProperties => ({
	width: size,
	height: size,
	borderRadius: "50%",
	background: "var(--avatar-navy)",
	color: "#fff",
	fontFamily: "var(--w-font-display)",
	fontWeight: 700,
	fontSize: fs,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flex: "none",
});

const popShell = (w: number, pad = 7): CSSProperties => ({
	position: "absolute",
	top: "calc(100% - 6px)",
	right: 14,
	zIndex: 50,
	width: w,
	background: "var(--panel)",
	border: "1px solid var(--line)",
	borderRadius: 13,
	boxShadow: "var(--shadow)",
	padding: pad,
	animation: "wPop .14s ease",
});

const popTitle: CSSProperties = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 700,
	fontSize: 10,
	letterSpacing: ".05em",
	textTransform: "uppercase",
	color: "var(--ink-3)",
	padding: "5px 9px 7px",
};

const popNote: CSSProperties = {
	fontFamily: "var(--w-font-body)",
	fontSize: 10,
	color: "var(--ink-3)",
	lineHeight: 1.5,
	padding: "5px 9px 4px",
};

/** Mono badge položky menu (prototyp ⋯ menu, ř. 874–889). */
const menuBadge: CSSProperties = {
	fontFamily: "var(--w-font-mono)",
	fontSize: 9,
	color: "var(--ink-3)",
	border: "1px solid var(--line)",
	borderRadius: 4,
	padding: "0 4px",
};

/** Mono poznámka vpravo v položce menu (zítra 8:00 / bez termínu). */
const menuHint: CSSProperties = {
	fontFamily: "var(--w-font-mono)",
	fontSize: 10,
	color: "var(--ink-3)",
};

const CheckSvg = ({ size = 12, style }: { size?: number; style?: CSSProperties }) => (
	<svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={style} aria-hidden>
		<path
			d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const FlagSvg = ({ w = 9, h = 11 }: { w?: number; h?: number }) => (
	<svg width={w} height={h} viewBox="0 0 10 12" fill="none" aria-hidden>
		<path
			d="M2 1 V11 M2 1.5 H8.6 L7 4.25 L8.6 7 H2"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
		/>
	</svg>
);

const LockSvg = ({ size = 10, style }: { size?: number; style?: CSSProperties }) => (
	<svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={style} aria-hidden>
		<rect x="2.2" y="5" width="7.6" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
		<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" stroke="currentColor" strokeWidth="1.3" />
	</svg>
);

const ChevSvg = ({ style }: { style?: CSSProperties }) => (
	<svg width="8" height="8" viewBox="0 0 9 9" style={style} aria-hidden>
		<path
			d="M2 3 L4.5 6 L7 3"
			stroke="currentColor"
			strokeWidth="1.5"
			fill="none"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const ClipSvg = ({ size = 12, style }: { size?: number; style?: CSSProperties }) => (
	<svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={style} aria-hidden>
		<path
			d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4"
			stroke="currentColor"
			strokeWidth="1.2"
			strokeLinecap="round"
		/>
	</svg>
);

const SendSvg = ({ size = 14 }: { size?: number }) => (
	<svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
		<path
			d="M2 7 H11 M7.5 3 L11.5 7 L7.5 11"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

/** „odesílatel nevidí" štítek hlavičky chatu (prototyp ř. 1058, 1099). */
const ChatLock = () => (
	<span
		title="Interní vrstva vlákna — externí odesílatel ji nikdy neuvidí"
		style={{
			marginLeft: "auto",
			display: "inline-flex",
			alignItems: "center",
			gap: 5,
			fontFamily: "var(--w-font-mono)",
			fontSize: 9.5,
			color: "var(--ink-3)",
		}}
	>
		<LockSvg size={10} />
		odesílatel nevidí
	</span>
);

export function MailThread() {
	const m = useMail();
	const [pop, setPop] = useState<Pop>(null);
	const [cpop, setCpop] = useState<CPop>(null);
	const [lnkUrl, setLnkUrl] = useState("https://");
	const [ccOn, setCcOn] = useState(false);
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [conf, setConf] = useState(false);
	const [hostPrev, setHostPrev] = useState(false);
	const [taskM, setTaskM] = useState(false);
	const [chatIn, setChatIn] = useState("");
	const [pend, setPend] = useState<PendSend | null>(null);
	// Volba podpisu odpovědi PRO TENTO MAIL (per-mail override); null = výchozí dle schránky.
	const [replySigOverride, setReplySigOverride] = useState<string | null>(null);
	const [colorPop, setColorPop] = useState(false);
	const headRef = useRef<HTMLDivElement>(null);
	const compRef = useRef<HTMLDivElement>(null);
	const rteRef = useRef<HTMLDivElement>(null);
	/** Uložený výběr před otevřením link popoveru (prototyp _rteRange). */
	const rteRange = useRef<globalThis.Range | null>(null);
	/** Poslední text propsaný RTE ↔ draft — brání přepisu innerHTML při psaní. */
	const lastRteText = useRef("");

	const t = m.threads.find((x) => x.id === m.sel);
	const tid = t?.id;

	// Přepnutí vlákna → podpis odpovědi zpět na výchozí dle schránky.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset jen při změně vlákna
	useEffect(() => {
		setReplySigOverride(null);
	}, [tid]);

	// klik mimo hlavičku zavře popover (vzor MailList vmenu)
	useEffect(() => {
		if (!pop) return;
		const h = (e: globalThis.MouseEvent) => {
			if (headRef.current && !headRef.current.contains(e.target as Node)) setPop(null);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [pop]);

	// klik mimo composer zavře jeho popovery (odkaz/šablony/odeslat později/proč)
	useEffect(() => {
		if (!cpop) return;
		const h = (e: globalThis.MouseEvent) => {
			if (compRef.current && !compRef.current.contains(e.target as Node)) setCpop(null);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [cpop]);

	// přepnutí vlákna resetuje lokální UI
	// biome-ignore lint/correctness/useExhaustiveDependencies: tid je záměrný reset trigger; setter funkce jsou stabilní
	useEffect(() => {
		setPop(null);
		setCpop(null);
		setCcOn(false);
		setCc("");
		setBcc("");
		setConf(false);
		setHostPrev(false);
		setTaskM(false);
		setChatIn("");
	}, [tid]);

	/**
	 * RTE ← draft: innerHTML přepisujeme jen když se text změnil jinde než
	 * psaním v editoru (quick chipy, šablony, AI návrh, přepnutí vlákna) —
	 * jinak by se ztratil kurzor (prototyp syncRte, ř. 2832–2837).
	 */
	useEffect(() => {
		const el = rteRef.current;
		if (!el || !tid) return;
		const want = m.drafts[tid]?.text ?? "";
		if (lastRteText.current !== want) {
			el.innerHTML = textToHtml(want);
			lastRteText.current = want;
		}
	}, [tid, m.drafts]);

	// ⌘F v otevřeném vlákně = hledat ve vlákně (prototyp findIn, ř. 886 + 3972);
	// SearchOverlay otvírá MailScreen — proto event watson-mail:search
	useEffect(() => {
		if (!tid) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
				e.preventDefault();
				m.setSoTh(tid);
				window.dispatchEvent(new CustomEvent("watson-mail:search"));
			}
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [tid, m.setSoTh]);

	/**
	 * Dokončení odeslání z warn modalu. checkSend je jediná exponovaná cesta
	 * k odeslání a znovu kontroluje `attached` — attach() + okamžitý checkSend()
	 * v jednom handleru by viděl zastaralý closure (přílohu ještě ne) a modal by
	 * se otevřel znovu. Proto: attach → pend → tenhle efekt zavolá checkSend až
	 * po re-renderu provideru s čerstvým stavem. Úspěch poznáme podle nárůstu
	 * sentX (doSend přílohu zase odepne a nastaví undo). U kolizního vlákna
	 * (t.coll) první průchod jen odjistí pojistku — efekt se po změně collArmed
	 * spustí znovu a odešle.
	 */
	useEffect(() => {
		if (!pend) return;
		if ((m.sentX[pend.id]?.length ?? 0) > pend.base) {
			setPend(null); // odesláno
			return;
		}
		const th = m.threads.find((x) => x.id === pend.id);
		if (!th) {
			setPend(null);
			return;
		}
		if (!m.attached[pend.id]) return; // čekáme na propsání attach do stavu
		m.checkSend(th, pend.markDone);
	}, [pend, m]);

	const warnOn = !!m.warn;
	const warnDialogRef = useOverlayLayer<HTMLDivElement>(warnOn, () => m.setWarn(null));

	// ── prázdný stav (prototyp ř. 1369–1377) ──
	if (!t) {
		return (
			<div
				data-threadpane
				data-chatmode={m.chatOff ? "tab" : "panel"}
				data-ctab={m.ctab}
				style={{
					flex: 1,
					minWidth: 0,
					display: "flex",
					flexDirection: "column",
					minHeight: 0,
					background: "var(--panel)",
					position: "relative",
				}}
			>
				<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
					<div style={{ textAlign: "center" }}>
						<div
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 14,
								color: "var(--ink-2)",
								marginBottom: 4,
							}}
						>
							Vyber konverzaci
						</div>
						<div
							style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-3)" }}
						>
							Vlákno se otevře tady vedle seznamu.
						</div>
					</div>
				</div>
			</div>
		);
	}

	/* ── odvozený stav vlákna (prototyp thrVals, ř. 3798–3930) ── */
	const e = m.eff(t);
	const mb = t.personal ? undefined : MB[t.mb];
	const aiOn = !t.personal && m.adm.ai[t.mb] !== "off";
	const owner = e.owner ? P[e.owner] : undefined;

	const msgsAll: UMsg[] = [...t.msgs, ...(m.sentX[t.id] ?? [])];
	const last = msgsAll.length - 1;
	const metaLine = `${t.from.n} · ${msgsAll.length} ${pl(msgsAll.length)} · poslední ${msgsAll[last]?.t ?? t.time}`;
	const mbAddr = t.personal ? "kosir.adam@gmail.com" : (mb?.addr ?? "");

	// per-osoba čtení: já (otevřeno teď) + seed readBy/readAt (prototyp seenRows, ř. 3860)
	const people = mb?.people ?? [];
	const rb = t.readBy ?? [];
	const seenOn = !t.personal && people.length > 1;
	const seenRows = people.map((k) => {
		const read = k === "ad" || rb.includes(k);
		const at = t.readAt?.[k];
		const per = P[k];
		return {
			k,
			ini: per?.ini ?? "",
			read,
			me: k === "ad",
			tip: `${per?.n ?? k}${k === "ad" ? " (ty) · otevřeno" : read ? ` · otevřeno${at ? ` ${at}` : ""}` : " · zatím neotevřeno"}`,
		};
	});
	const seenN = people.filter((k) => k === "ad" || rb.includes(k)).length;

	const rtoOn = !!t.replyTo && t.replyTo !== t.from.addr;
	const aiOffOn = !t.personal && m.adm.ai[t.mb] === "off";
	const bounceOn = !!t.bounce && !m.ovOf(t.id).bounceFixed;
	const links = m.taskLinks[t.id] ?? [];
	const hasSum = aiOn && !!t.sum && !e.closed;
	const collOn = !!t.coll && !t.personal && !e.sent && !e.closed;

	// SLA lišta (prototyp strip, ř. 3841–3856)
	const strip = (() => {
		if (t.personal) return null;
		if (e.closed && (e.flag !== "none" || e.sent))
			return {
				kind: "off",
				isFlag: false,
				isOk: false,
				title: "Ukončeno",
				meta: "urgence se už neobnoví ani při nové příchozí zprávě",
				note:
					e.flag !== "none" ? `úroveň ${SLA[e.flag]?.chip ?? ""} zůstává v historii vlákna` : "",
				hasTask: false,
				taskDone: false,
				taskMsg: "",
			};
		if (e.sent)
			return {
				kind: "ok",
				isFlag: false,
				isOk: true,
				title: "Odpovězeno",
				meta: "SLA zastaveno · míč na jejich straně",
				note: "nová příchozí zpráva urgenci obnoví na stejné úrovni",
				hasTask: e.flag === "p1" || e.flag === "p2",
				taskDone: true,
				taskMsg: "Úkol je odškrtnutý — odpověď odešla. Detail žije ve Watson úkolech.",
			};
		if (e.flag === "none") return null;
		const d = SLA[e.flag];
		if (!d) return null;
		return {
			kind: e.flag,
			isFlag: true,
			isOk: false,
			title: d.name,
			meta: `${d.sla}${d.left ? ` · ${d.left}` : ""} · míč u nás`,
			note: `eskalace: ${d.esk} · počítají se jen pracovní hodiny (pátek večer → deadline pondělí)`,
			hasTask: d.task,
			taskDone: false,
			taskMsg:
				"Otevře propojený úkol ve Watsonu (entity_links) — po odeslání odpovědi se odškrtne sám.",
		};
	})();

	// interní diskuse: systémové řádky + seed chat + moje nové zprávy (ř. 3831–3838)
	const chatItems: ChatItem[] = [];
	if (!t.personal) {
		if ((e.flag === "p1" || e.flag === "p2") && !e.closed)
			chatItems.push({
				sys: true,
				text: `Watson · vlajka ${SLA[e.flag]?.chip ?? ""} → úkol „Odpovědět: ${t.subj}“ pro ${owner ? first(owner.n) : "dispečink"}`,
			});
		const add = (c: {
			who: string;
			t: string;
			pre?: string;
			m?: string;
			post?: string;
			ai?: boolean;
		}) => {
			const p = P[c.who];
			chatItems.push({
				sys: false,
				ini: p?.ini ?? "",
				name: p?.n ?? c.who,
				av: p?.av ?? "",
				t: c.t,
				pre: c.pre ?? "",
				m: c.m ?? "",
				post: c.post ?? "",
				ai: !!c.ai,
			});
		};
		for (const c of t.chat) add(c);
		for (const c of m.chatX[t.id] ?? []) add(c);
		if (e.sent)
			chatItems.push({ sys: true, text: "Odpověď odeslána — SLA zastaveno, úkol odškrtnut." });
	}
	const nchat = t.chat.length + (m.chatX[t.id] ?? []).length;

	/**
	 * Sbalování zpráv (audit D2): klíč = stabilní identita zprávy (seed index /
	 * index v sentX — obojí append-only), hodnota = explicitní „otevřeno".
	 * Dřívější index-klíče s obrácenou interpretací u poslední zprávy se po
	 * odeslání (přibude zpráva, „poslední" se posune) četly opačně. Default
	 * bez záznamu zůstává prototypový: otevřená je jen poslední zpráva.
	 */
	const expKey = (i: number) =>
		i < t.msgs.length ? `${t.id}:m:${i}` : `${t.id}:x:${i - t.msgs.length}`;
	const isOpen = (i: number) => m.exp[expKey(i)] ?? i === last;
	const anyCollapsed = msgsAll.some((_, i) => !isOpen(i));
	const expAll = () => {
		if (anyCollapsed)
			msgsAll.forEach((_, i) => {
				m.setExp(expKey(i), true);
			});
		else
			msgsAll.forEach((_, i) => {
				m.setExp(expKey(i), i === last);
			});
	};

	/* ── composer (prototyp comp, ř. 3986–4104) ── */
	const dr = m.drafts[t.id];
	const draftText = dr?.text ?? "";
	const canDraft = aiOn && !!t.draft && !e.sent && !e.closed;
	// mode: bez konceptu + AI návrh → karta „draft"; jinak edit/empty (RTE)
	let mode: "draft" | "edit" | "empty" = dr?.mode ?? (canDraft && t.aiDraft ? "draft" : "empty");
	if (mode === "draft" && !(canDraft && t.aiDraft)) mode = "empty";
	const quick = t.quick ?? [];
	const showQuickRow =
		mode !== "draft" && !draftText && !e.sent && !e.closed && aiOn && quick.length > 0;
	const attLabel = m.attached[t.id];
	const tpls = TPL[t.personal ? "osobni" : t.mb] ?? [];

	// sdílený koncept + schvalování (prototyp sd flagy, ř. 4035–4046)
	const sdt = m.sd[t.id] ?? {};
	const sdOn = !!sdt.shared;
	const sdPending = !!sdt.pending && !sdt.approved;
	const sdApproved = !!sdt.approved;
	const sdReturned = !!sdt.returned && !sdt.approved;
	const sdCanAsk = sdOn && !sdt.pending && !sdt.approved && !sdt.returned;
	const sdShow = !t.personal && !sdt.shared;

	/** Fokus RTE s kurzorem na konec — po ticku, ať editor po přepnutí mode existuje. */
	const focusComp = () => {
		setTimeout(() => {
			const el = rteRef.current;
			if (!el) return;
			el.focus();
			try {
				const r = document.createRange();
				r.selectNodeContents(el);
				r.collapse(false);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(r);
			} catch {
				/* selekce může selhat (skrytý editor) — fokus stačí */
			}
		}, 30);
	};
	/** Odpovědět z karty/tlačítek: přepne draft kartu do edit režimu a fokusne. */
	const startEdit = () => {
		if (mode === "draft") m.setDraft(t.id, draftText);
		focusComp();
	};

	/** RTE → draft: persistujeme jen čistý text (innerText), HTML žije v editoru. */
	const persistRte = () => {
		const el = rteRef.current;
		if (!el || !tid) return;
		const text = el.innerText ?? "";
		lastRteText.current = text;
		m.setDraft(tid, text);
	};
	/**
	 * Formátovací příkaz nad RTE — document.execCommand jako prototyp (rteCmd,
	 * ř. 2844–2849). API je deprecated, ale pro demo modul je to záměr: reálný
	 * editor přijde s mail backendem M1–M3.
	 */
	const rteCmd = (cmd: string, val?: string) => {
		const el = rteRef.current;
		if (!el) return;
		el.focus();
		try {
			document.execCommand(cmd, false, val);
		} catch {
			/* starší prohlížeč bez execCommand — demo bez formátování */
		}
		persistRte();
	};
	/** Toolbar mousedown — neukrást výběr z editoru (prototyp comp.pd). */
	const pd = (ev: { preventDefault: () => void }) => ev.preventDefault();
	const linkOpen = () => {
		const sel = window.getSelection();
		rteRange.current = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
		setLnkUrl("https://");
		setCpop(cpop === "lnk" ? null : "lnk");
	};
	/** Vložení odkazu (prototyp lnkApply, ř. 2850–2864). */
	const lnkApply = () => {
		const el = rteRef.current;
		if (!el) return;
		const safeUrl = safeRichTextHref(lnkUrl);
		if (!safeUrl) {
			showToast("Odkaz musí začínat https://, http:// nebo mailto:.");
			return;
		}
		el.focus();
		if (rteRange.current) {
			try {
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(rteRange.current);
			} catch {
				/* výběr už neplatí — vloží se na kurzor */
			}
		}
		try {
			const sel = window.getSelection();
			if (sel?.isCollapsed)
				document.execCommand(
					"insertHTML",
					false,
					`<a href="${escapeHtmlText(safeUrl)}" rel="noopener noreferrer nofollow">${escapeHtmlText(safeUrl)}</a>`,
				);
			else document.execCommand("createLink", false, safeUrl);
		} catch {
			/* demo — bez odkazu */
		}
		setCpop(null);
		persistRte();
	};

	/**
	 * Odeslat později (prototyp plan, ř. 4116) — demo bez reálné fronty:
	 * jen toast, koncept zůstává uložený u vlákna (setDraft se nemění).
	 */
	const plan = (when: string) => {
		setCpop(null);
		showToast(`Simulace: naplánováno na ${when} — nic se samo neodešle; zrušíš v Dění → Nadcházející.`);
	};

	const sendChatNow = () => {
		const txt = chatIn.trim();
		if (!txt) {
			showToast("Napiš nejdřív text poznámky.");
			return;
		}
		m.sendChat(t.id, txt);
		setChatIn("");
		if (txt.includes("@"))
			showToast(
				"Zmíněný kolega dostane upozornění — externí odesílatel tuhle vrstvu nikdy neuvidí.",
			);
	};

	// warn modal: attach (marker/dummy) → pend → efekt výš pošle přes checkSend
	const warn = m.warn;
	const beginPendSend = (id: string, markDone: boolean, label: string) => {
		m.attach(id, label);
		setPend({ id, markDone, base: m.sentX[id]?.length ?? 0 });
		m.setWarn(null);
	};

	/* ── renderery interního chatu (záložka ř. 1052–1096, pravý panel ř. 1097–1146) ── */
	const chatMsgs = (compact: boolean): ReactNode => (
		<>
			{chatItems.map((c, i) =>
				c.sys ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: statický seed seznam
					<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
						<span style={{ flex: 1, height: 1, background: "var(--line)" }} />
						<span
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 9,
								color: "var(--ink-3)",
								textAlign: "center",
								maxWidth: "82%",
								lineHeight: 1.5,
							}}
						>
							{c.text}
						</span>
						<span style={{ flex: 1, height: 1, background: "var(--line)" }} />
					</div>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: statický seed seznam
					<div key={i} style={{ display: "flex", gap: 8 }}>
						<span
							data-av={c.av}
							style={{ ...avStyle(compact ? 22 : 24, compact ? 8.5 : 9), marginTop: 2 }}
						>
							{c.ini}
						</span>
						<div
							data-chatmsg
							data-ai={c.ai || undefined}
							style={{ flex: 1, minWidth: 0, padding: compact ? "7px 10px" : "8px 11px" }}
						>
							<div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
								<span
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: compact ? 11.5 : 12,
										color: "var(--ink)",
									}}
								>
									{c.name}
								</span>
								<span
									style={{ fontFamily: "var(--w-font-mono)", fontSize: 9.5, color: "var(--ink-3)" }}
								>
									{c.t}
								</span>
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: compact ? 12 : 12.5,
									color: "var(--ink-2)",
									lineHeight: 1.55,
									marginTop: 2,
								}}
							>
								{c.pre}
								{c.m && <span data-mention>{c.m}</span>}
								{c.post}
							</div>
						</div>
					</div>
				),
			)}
			{chatItems.length === 0 && (
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 11.5,
						color: "var(--ink-3)",
						lineHeight: 1.55,
						padding: compact ? "4px 2px" : undefined,
					}}
				>
					Zatím ticho. Napiš poznámku nebo zmiň kolegu přes @ — externí lidé tuhle vrstvu nikdy
					neuvidí.
				</div>
			)}
		</>
	);

	const chatInput = (compact: boolean): ReactNode => (
		<div style={{ display: "flex", gap: 7, alignItems: "center" }}>
			<input
				value={chatIn}
				aria-label="Interní komentář k e-mailovému vláknu"
				onChange={(ev) => setChatIn(ev.target.value)}
				onKeyDown={(ev) => {
					if (ev.key === "Enter") sendChatNow();
				}}
				placeholder="Napiš interně… @ zmíní kolegu"
				style={{
					flex: 1,
					minWidth: 0,
					border: "1px solid var(--line)",
					background: "var(--panel)",
					borderRadius: 9,
					padding: compact ? "8px 11px" : "9px 12px",
					fontFamily: "var(--w-font-body)",
					fontSize: compact ? 12 : 12.5,
					color: "var(--ink)",
					outline: "none",
				}}
			/>
			<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
				onClick={sendChatNow}
				title="Přidat interní zprávu"
				style={{
					width: compact ? 31 : 34,
					height: compact ? 31 : 34,
					borderRadius: 9,
					background: "var(--brass)",
					color: "#fff",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					cursor: "pointer",
					flex: "none",
				}}
			>
				<SendSvg size={compact ? 13 : 14} />
			</span>
		</div>
	);

	return (
		<div
			data-threadpane
			data-screen-label="Thread workspace"
			data-chatmode={m.chatOff ? "tab" : "panel"}
			data-ctab={m.ctab}
			style={{
				flex: 1,
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				minHeight: 0,
				background: "var(--panel)",
				position: "relative",
			}}
		>
			{/* ── VRSTVA 4: lišta stavu & akce (prototyp ř. 788–897) ── */}
			<div
				ref={headRef}
				style={{
					flex: "none",
					padding: "11px 18px 10px",
					borderBottom: "1px solid var(--line)",
					background: "var(--panel)",
					position: "relative",
				}}
			>
				<div data-thrhead style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-moonly
						onClick={m.closeThread}
						style={{
							width: 31,
							height: 31,
							borderRadius: 8,
							border: "1px solid var(--line)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							cursor: "pointer",
							color: "var(--ink-2)",
							flex: "none",
							marginTop: 2,
						}}
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
							<path
								d="M8.5 2.5 L4 7 L8.5 11.5"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</span>
					<div style={{ flex: 1, minWidth: 160 }}>
						<div
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 16.5,
								color: "var(--ink)",
								lineHeight: 1.25,
							}}
						>
							{t.subj}
						</div>
						<div
							data-thrmeta
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								marginTop: 5,
								flexWrap: "wrap",
								minWidth: 0,
							}}
						>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontFamily: "var(--w-font-mono)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									flex: "none",
								}}
							>
								<span
									data-mbdot={t.personal ? "osobni" : t.mb}
									style={{ width: 8, height: 8, borderRadius: "50%" }}
								/>
								{mbAddr}
							</span>
							<span
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 11.5,
									color: "var(--ink-3)",
									minWidth: 0,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{metaLine}
							</span>
							{seenOn && (
								<span
									title="Kdo z týmu schránky už konverzaci otevřel"
									style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}
								>
									<span data-seengrp>
										{seenRows.map((p) => (
											<span key={p.k} data-seenav data-read={p.read} data-me={p.me} title={p.tip}>
												{p.ini}
											</span>
										))}
									</span>
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10.5,
											color: "var(--ink-3)",
										}}
									>
										přečteno {seenN}/{people.length}
									</span>
								</span>
							)}
							{rtoOn && (
								<span
									title="Bezpečnostní upozornění: adresa pro odpovědi se liší od odesílatele"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
										fontFamily: "var(--w-font-mono)",
										fontSize: 9,
										color: "var(--ink-2)",
										border: "1px solid var(--ink-3)",
										borderRadius: 999,
										padding: "1px 7px",
										flex: "none",
									}}
								>
									⚠ odpovědi jdou na {t.replyTo} (reply-to ≠ odesílatel)
								</span>
							)}
							{t.personal && (
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 5,
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10,
										padding: "2px 9px",
										borderRadius: 999,
										background: "var(--pers-bg)",
										border: "1px solid var(--pers-line)",
										color: "var(--pers-ink)",
									}}
								>
									<LockSvg size={9} />
									osobní · demo
								</span>
							)}
							{aiOffOn && (
								<span
									title="AI je pro granty@ vypnutá — žádná shrnutí ani drafty"
									style={{
										fontFamily: "var(--w-font-mono)",
										fontSize: 9.5,
										color: "var(--ink-3)",
										border: "1px solid var(--line)",
										borderRadius: 4,
										padding: "1px 5px",
									}}
								>
									AI vypnuta
								</span>
							)}
						</div>
					</div>
					{!t.personal && (
						<div
							data-thracts
							style={{
								display: "flex",
								gap: 6,
								flex: "none",
								alignItems: "center",
								flexWrap: "wrap",
								justifyContent: "flex-end",
							}}
						>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setPop(pop === "flag" ? null : "flag")}
								title="Priorita a urgence vlákna — P1 až P4"
								data-pflag={e.flag}
							>
								<FlagSvg />
								{e.flag === "none" ? "Vlajka" : (SLA[e.flag]?.chip ?? "")}
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setPop(pop === "state" ? null : "state")}
								data-mstate={e.st}
								style={{ cursor: "pointer" }}
							>
								{STL[e.st] ?? e.st}
								<ChevSvg style={{ opacity: 0.6 }} />
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setPop(pop === "assign" ? null : "assign")}
								title="Přiřazená odpovědná osoba"
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									border: "1px solid var(--line)",
									borderRadius: 999,
									padding: "2px 9px 2px 3px",
									cursor: "pointer",
									background: "var(--panel)",
								}}
							>
								{owner ? (
									<span data-av={owner.av} style={{ ...avStyle(19, 8), display: "inline-flex" }}>
										{owner.ini}
									</span>
								) : (
									<span
										style={{
											width: 19,
											height: 19,
											borderRadius: "50%",
											border: "1.4px dashed var(--ink-3)",
											display: "inline-flex",
										}}
									/>
								)}
								<span
									data-actlbl
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 11.5,
										color: "var(--ink-2)",
									}}
								>
									{owner ? first(owner.n) : "Přiřadit"}
								</span>
								<ChevSvg style={{ color: "var(--ink-3)" }} />
							</span>
							<span style={{ width: 1, height: 20, background: "var(--line)", margin: "0 2px" }} />
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setTaskM(true)}
								title="Udělej z mailu úkol — formulář s prioritou, termínem a projektem, propojí se s vláknem"
								data-ghost
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontSize: 11.5,
									padding: "6px 10px",
								}}
							>
								<svg width="11" height="11" viewBox="0 0 13 13" aria-hidden>
									<line
										x1="6.5"
										y1="2"
										x2="6.5"
										y2="11"
										stroke="currentColor"
										strokeWidth="1.7"
										strokeLinecap="round"
									/>
									<line
										x1="2"
										y1="6.5"
										x2="11"
										y2="6.5"
										stroke="currentColor"
										strokeWidth="1.7"
										strokeLinecap="round"
									/>
								</svg>
								<span data-actlbl>Úkol</span>
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setPop(pop === "more" ? null : "more")}
								aria-label="Další akce s e-mailem"
								title="Další akce s e-mailem"
								data-ghost
								style={{
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									width: 29,
									height: 29,
									padding: 0,
								}}
							>
								<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
									<circle cx="8" cy="3.5" r="1.3" fill="currentColor" />
									<circle cx="8" cy="8" r="1.3" fill="currentColor" />
									<circle cx="8" cy="12.5" r="1.3" fill="currentColor" />
								</svg>
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => m.rowAct(t.id, "done")}
								title="Hotovo — terminální stav, urgence se už neobnoví"
								data-ghost
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontSize: 11.5,
									padding: "6px 11px",
									color: "var(--success-ink)",
								}}
							>
								<CheckSvg size={11} />
								<span data-actlbl>Hotovo</span>
							</span>
						</div>
					)}
				</div>

				{/* popover: urgence P1–P4 (prototyp ř. 822–841) */}
				{pop === "flag" && !t.personal && (
					<div style={popShell(308)}>
						<div style={popTitle}>Priorita a urgence vlákna</div>
						{(["p1", "p2", "p3", "p4"] as const).map((k) => {
							const d = SLA[k];
							if (!d) return null;
							return (
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									key={k}
									onClick={() => {
										m.setFlag(t.id, k);
										setPop(null);
									}}
									style={{
										display: "flex",
										alignItems: "flex-start",
										gap: 9,
										padding: "7px 9px",
										borderRadius: 9,
										cursor: "pointer",
									}}
								>
									<span
										data-pdot={k}
										style={{ width: 10, height: 10, borderRadius: 3, flex: "none", marginTop: 3 }}
									/>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
											<span
												style={{
													fontFamily: "var(--w-font-display)",
													fontWeight: 700,
													fontSize: 12,
													color: "var(--ink)",
												}}
											>
												{d.name}
											</span>
											<span
												style={{
													fontFamily: "var(--w-font-mono)",
													fontSize: 9.5,
													color: "var(--ink-3)",
												}}
											>
												{d.sla}
											</span>
										</div>
										<div
											style={{
												fontFamily: "var(--w-font-body)",
												fontSize: 11,
												color: "var(--ink-3)",
												lineHeight: 1.45,
												marginTop: 1,
											}}
										>
											{d.desc}
										</div>
									</div>
									{e.flag === k && (
										<CheckSvg
											size={12}
											style={{ color: "var(--brass-text)", flex: "none", marginTop: 3 }}
										/>
									)}
								</div>
							);
						})}
						<div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.setFlag(t.id, "none");
								setPop(null);
							}}
							data-menuitem
							style={{ color: "var(--ink-2)" }}
						>
							Zrušit vlajku
						</div>
						<div style={popNote}>
							SLA běží, jen když je poslední zpráva příchozí. Odpovědí se uspí, novou příchozí se
							obnoví. Hotovo = konec, urgence se už neobnoví.
						</div>
					</div>
				)}

				{/* popover: stav vlákna (prototyp ř. 843–852) */}
				{pop === "state" && !t.personal && (
					<div style={popShell(250, 9)}>
						<div style={{ ...popTitle, padding: "0 3px 8px" }}>Stav vlákna</div>
						<div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
							{(["novy", "otevreny", "ceka", "odeslano", "hotovo"] as const).map((k) => (
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									key={k}
									onClick={() => {
										m.setThreadState(t.id, k);
										setPop(null);
									}}
									data-statepill
									data-on={e.st === k || undefined}
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10.5,
										padding: "4px 10px",
										borderRadius: 999,
										whiteSpace: "nowrap",
									}}
								>
									{STL[k]}
								</span>
							))}
						</div>
						<div style={{ ...popNote, padding: "8px 3px 0" }}>
							Stav se zrcadlí do propojeného úkolu — Hotovo tady = hotovo tam.
						</div>
					</div>
				)}

				{/* popover: předat vlákno (prototyp ř. 854–869) */}
				{pop === "assign" && !t.personal && (
					<div style={popShell(262)}>
						<div style={popTitle}>Předat vlákno — odpovědná osoba</div>
						{people.map((pid) => {
							const p = P[pid];
							if (!p) return null;
							return (
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									key={pid}
									onClick={() => {
										m.setOwner(t.id, pid);
										setPop(null);
									}}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 9,
										padding: "7px 9px",
										borderRadius: 9,
										cursor: "pointer",
									}}
								>
									<span data-av={p.av} style={avStyle(24, 9)}>
										{p.ini}
									</span>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div
											style={{
												fontFamily: "var(--w-font-display)",
												fontWeight: 600,
												fontSize: 12.5,
												color: "var(--ink)",
											}}
										>
											{p.n}
										</div>
										<div
											style={{
												fontFamily: "var(--w-font-body)",
												fontSize: 10,
												color: "var(--ink-3)",
											}}
										>
											{p.role}
										</div>
									</div>
									{e.owner === pid && (
										<CheckSvg size={12} style={{ color: "var(--brass-text)", flex: "none" }} />
									)}
								</div>
							);
						})}
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.setOwner(t.id, null);
								setPop(null);
							}}
							data-menuitem
							style={{ color: "var(--ink-2)" }}
						>
							Odebrat přiřazení
						</div>
						<div
							style={{
								display: "flex",
								gap: 6,
								alignItems: "flex-start",
								fontFamily: "var(--w-font-body)",
								fontSize: 10,
								color: "var(--ink-3)",
								lineHeight: 1.5,
								padding: "6px 9px 4px",
								borderTop: "1px solid var(--line)",
								marginTop: 4,
							}}
						>
							<LockSvg size={10} style={{ flex: "none", marginTop: 1 }} />
							<span>
								Nabídka ukazuje jen lidi s přístupem k {mb?.short ?? ""} — komu schránka nepatří,
								tomu vlákno předat nejde.
							</span>
						</div>
					</div>
				)}

				{/* popover: další akce — plné ⋯ menu (prototyp ř. 871–895) */}
				{pop === "more" && !t.personal && (
					<div style={popShell(226, 5)}>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								// Deep link stále respektuje oprávnění cílové schránky (L-22).
								void copyDeepLink("mail", t.id).then((copied) =>
									showToast(
										copied
											? `Odkaz zkopírován. Otevře se jen lidem s přístupem k ${mb?.short ?? ""} — ostatním neexistuje.`
											: "Odkaz se nepodařilo zkopírovat.",
									),
								);
							}}
							data-menuitem
						>
							Sdílet — kopírovat odkaz
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								showToast("Posláno Tereze pro přehled (FYI) — bez povinnosti, bez předání vlákna.");
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>Poslat Tereze pro přehled</span>
							<span style={menuBadge}>FYI</span>
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								m.setCtab("chat");
								setChatIn("@Tereza ");
								showToast(
									"Přizvání: napiš interní zprávu — Tereza dostane upozornění, vlákno zůstává tvoje.",
								);
							}}
							data-menuitem
						>
							Přizvat do interní diskuse
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								showToast(
									"Per-thread delegace: externí (např. účetní Věra) uvidí JEN tohle vlákno, s expirací. Žádný sidebar, žádné jiné schránky — „co nevidíš, neexistuje“.",
								);
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>Delegovat externímu</span>
							<span style={menuBadge}>jen toto vlákno</span>
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								setHostPrev(true);
							}}
							data-menuitem
						>
							Náhled: příjemce bez přístupu
						</div>
						<div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
						{(m.ovOf(t.id).grp ?? t.grp) !== "inbox" && (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									setPop(null);
									// učení klasifikace: korekce → příště od odesílatele rovnou Inbox
									m.setOv(t.id, { grp: "inbox" });
									showToast(
										`Přesunuto do Inboxu — příště od ${t.from.addr} rovnou sem. Systém se učí z korekcí.`,
									);
								}}
								data-menuitem
							>
								<span style={{ flex: 1 }}>Přesunout do Inboxu</span>
								<span style={menuBadge}>naučí se</span>
							</div>
						)}
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "pin");
								setPop(null);
							}}
							data-menuitem
						>
							{e.pin ? "Odepnout" : "Připnout"}
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "snooze");
								setPop(null);
								m.closeThread();
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>Odložit</span>
							<span style={menuHint}>zítra 8:00</span>
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								m.setOv(t.id, { snoozed: "bez termínu" });
								m.closeThread();
								showToast(
									"Set Aside — odloženo bez termínu. Čeká v Odloženo, dokud ho ručně nevrátíš.",
								);
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>Set Aside</span>
							<span style={menuHint}>bez termínu</span>
						</div>
						{!!e.snoozed && (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									setPop(null);
									m.setOv(t.id, { snoozed: null });
									showToast("Vráceno do Inboxu.");
								}}
								data-menuitem
							>
								Vrátit do Inboxu teď
							</div>
						)}
						{(e.arch || e.trash) && (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									setPop(null);
									m.rowAct(t.id, "restore");
								}}
								data-menuitem
							>
								Vrátit do Inboxu
							</div>
						)}
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								setPop(null);
								m.setSoTh(t.id);
								// SearchOverlay otvírá MailScreen — event ho poprosí o otevření
								window.dispatchEvent(new CustomEvent("watson-mail:search"));
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>Hledat ve vlákně</span>
							<span style={menuBadge}>⌘F</span>
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "unread");
								setPop(null);
							}}
							data-menuitem
						>
							Označit jako nepřečtené
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "mute");
								setPop(null);
							}}
							data-menuitem
						>
							{e.muted ? "Zrušit ztlumení" : "Ztlumit vlákno"}
						</div>
						{t.grp === "news" && !m.ovOf(t.id).unsub && (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									setPop(null);
									m.setOv(t.id, { unsub: true });
									showToast(
										"Odhlášeno z odběru (list-unsubscribe) — odesílatel už nemá posílat další.",
									);
								}}
								data-menuitem
							>
								<span style={{ flex: 1 }}>Odhlásit odběr</span>
								<span style={menuBadge}>1 klik</span>
							</div>
						)}
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "arch");
								setPop(null);
							}}
							data-menuitem
						>
							Archivovat
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "trash");
								setPop(null);
							}}
							data-menuitem
						>
							Do koše
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "spam");
								setPop(null);
							}}
							data-menuitem
							style={{ color: "var(--overdue)", borderTop: "1px solid var(--line)", marginTop: 4 }}
						>
							Blokovat odesílatele
						</div>
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.rowAct(t.id, "spam");
								setPop(null);
							}}
							data-menuitem
							style={{ color: "var(--overdue)", borderRadius: "0 0 8px 8px" }}
						>
							Nahlásit spam
						</div>
					</div>
				)}
			</div>

			{/* ── Urgence / SLA lišta (prototyp ř. 898–916) ── */}
			{strip && (
				<div
					data-pstrip={strip.kind}
					title={strip.note}
					style={{
						flex: "none",
						display: "flex",
						alignItems: "center",
						gap: 10,
						padding: "7px 18px",
						borderBottom: "1px solid var(--line)",
						minWidth: 0,
					}}
				>
					<span
						data-pink={strip.kind}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 11,
							flex: "none",
						}}
					>
						{strip.isFlag && <FlagSvg />}
						{strip.isOk && <CheckSvg size={11} />}
						{strip.title}
					</span>
					<span
						data-pink={strip.kind}
						data-stripmeta
						style={{
							fontFamily: "var(--w-font-mono)",
							fontSize: 10.5,
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{strip.meta}
					</span>
					{strip.hasTask && (
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => showToast(strip.taskMsg)}
							title="Úkol vytvořený urgencí — propojený s vláknem, po odeslání odpovědi se sám odškrtne"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								background: "var(--panel)",
								border: "1px solid var(--line)",
								borderRadius: 999,
								padding: "2px 10px 2px 5px",
								cursor: "pointer",
								maxWidth: 340,
								minWidth: 0,
								flex: "0 1 auto",
							}}
						>
							{strip.taskDone ? (
								<span
									style={{
										width: 13,
										height: 13,
										borderRadius: "50%",
										background: "var(--success)",
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										flex: "none",
									}}
								>
									<svg width="7" height="7" viewBox="0 0 10 10" aria-hidden>
										<path
											d="M1.5 5.2 L4 7.7 L8.5 2.6"
											stroke="#fff"
											strokeWidth="1.8"
											fill="none"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</span>
							) : (
								<span
									style={{
										width: 13,
										height: 13,
										borderRadius: "50%",
										border: "1.5px solid var(--ink-3)",
										flex: "none",
									}}
								/>
							)}
							<span
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 11,
									color: "var(--ink-2)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								Odpovědět: {t.subj}
							</span>
						</span>
					)}
				</div>
			)}

			{/* ── Záložky Vlákno / Interní chat (prototyp ř. 917–930) ── */}
			{!t.personal && (
				<div
					data-chattabs
					style={{
						flex: "none",
						padding: "8px 18px 0",
						background: "var(--panel)",
						borderBottom: "1px solid var(--line)",
						gap: 8,
						alignItems: "center",
					}}
				>
					<div
						style={{
							display: "inline-flex",
							background: "var(--panel-2)",
							border: "1px solid var(--line)",
							borderRadius: 10,
							padding: 3,
							marginBottom: 8,
						}}
					>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => m.setCtab("vlakno")}
							data-tab
							data-active={m.ctab === "vlakno" || undefined}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 12,
								padding: "5px 14px",
								borderRadius: 7,
								cursor: "pointer",
							}}
						>
							Vlákno
							<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, opacity: 0.65 }}>
								{msgsAll.length}
							</span>
						</span>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => m.setCtab("chat")}
							data-tab
							data-active={m.ctab === "chat" || undefined}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 12,
								padding: "5px 14px",
								borderRadius: 7,
								cursor: "pointer",
							}}
						>
							<svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
								<path
									d="M2.5 2.5 H11.5 V9.5 H7 L4.5 12 V9.5 H2.5 Z"
									stroke="currentColor"
									strokeWidth="1.3"
									strokeLinejoin="round"
								/>
							</svg>
							Interní chat
							<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, opacity: 0.65 }}>
								{nchat}
							</span>
						</span>
					</div>
					<span style={{ flex: 1 }} />
					{m.chatOff && (
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							data-deskonly
							onClick={() => {
								m.setChatOff(false);
								m.setCtab("vlakno");
							}}
							title="Vrátit interní chat jako pravý panel"
							data-rowbtn
							style={{
								border: "1px solid var(--line)",
								background: "var(--panel)",
								fontFamily: "var(--w-font-mono)",
								fontSize: 11,
								marginBottom: 8,
							}}
						>
							«
						</span>
					)}
				</div>
			)}

			{/* ── VRSTVA 1+3: vlákno + interní chat (prototyp ř. 931–1146) ── */}
			<div data-thrbody style={{ flex: 1, minHeight: 140, display: "flex" }}>
				{/* Čtecí sloupec */}
				<div
					data-tpane="mail"
					style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}
				>
					<div style={{ flex: 1, overflow: "auto" }}>
						<div style={{ maxWidth: 768, margin: "0 auto", padding: "18px 28px 22px" }}>
							{msgsAll.length > 1 && (
								<div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 6px" }}>
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={expAll}
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10,
											color: "var(--ink-3)",
											cursor: "pointer",
										}}
									>
										{anyCollapsed ? "Rozbalit vše" : "Sbalit starší"}
									</span>
								</div>
							)}

							{/* bounce banner (prototyp ř. 943–952) */}
							{bounceOn && (
								<div
									style={{
										display: "flex",
										gap: 9,
										alignItems: "flex-start",
										border: "1px solid var(--ink-3)",
										borderRadius: 11,
										padding: "9px 12px",
										marginBottom: 6,
										background: "var(--panel)",
									}}
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.9"
										strokeLinecap="round"
										style={{ color: "var(--ink-2)", flex: "none", marginTop: 1 }}
										aria-hidden
									>
										<path d="M12 5 V13" />
										<circle cx="12" cy="17.5" r="1.3" fill="currentColor" />
										<circle cx="12" cy="12" r="9.2" />
									</svg>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div
											style={{
												fontFamily: "var(--w-font-display)",
												fontWeight: 700,
												fontSize: 12,
												color: "var(--ink)",
											}}
										>
											Simulace: nedoručeno — zpráva se vrátila
										</div>
										<div
											style={{
												fontFamily: "var(--w-font-body)",
												fontSize: 11.5,
												color: "var(--ink-2)",
												marginTop: 2,
											}}
										>
											{t.bounce}. Nic se neztratilo — původní text je níž ve vlákně.
										</div>
									</div>
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => {
											m.setOv(t.id, { bounceFixed: true });
											startEdit();
											showToast(
												"Oprav adresu v poli Komu a pošli znovu — původní zpráva zůstává ve vlákně jako nedoručená.",
											);
										}}
										data-ghost
										style={{ fontSize: 10.5, padding: "5px 11px", flex: "none" }}
									>
										Opravit a poslat znovu
									</span>
								</div>
							)}

							{/* navázané úkoly (prototyp ř. 953–960) */}
							{links.length > 0 && (
								<div
									style={{
										display: "flex",
										gap: 8,
										alignItems: "center",
										flexWrap: "wrap",
										border: "1px solid var(--line)",
										borderRadius: 11,
										padding: "8px 12px",
										marginBottom: 6,
										background: "var(--panel)",
									}}
								>
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 9.5,
											color: "var(--ink-3)",
											flex: "none",
										}}
									>
										NAVÁZANÉ ÚKOLY
									</span>
									{links.map((tk) => {
										const rec = m.bridge.taskStates?.[tk.app];
										return (
											<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
												key={tk.app}
												onClick={() => {
													if (m.bridge.onNav) m.bridge.onNav(`task:${tk.app}`);
													else
														showToast(
															"Úkol žije v produktivní části Watsonu — chip „z mailu“ na něm vede zpět do tohohle vlákna.",
														);
												}}
												data-pflag={tk.prio}
												// reálné vazby z bridge vlastníka nenesou (owner="") —
												// tooltip spadne na název úkolu, ať není prázdný (audit D8)
												title={`${tk.owner ? `vyřizuje ${P[tk.owner]?.n ?? tk.owner}` : tk.n} · klik otevře úkol v aplikaci`}
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: 6,
													fontFamily: "var(--w-font-display)",
													fontWeight: 600,
													fontSize: 10.5,
													padding: "3px 10px",
													borderRadius: 999,
													cursor: "pointer",
												}}
											>
												<svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
													<path
														d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
														stroke="currentColor"
														strokeWidth="1.7"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
												{tk.n}
												{rec && (
													<span
														data-mstate={rec.done ? "hotovo" : "otevreny"}
														style={{ fontSize: 9.5, padding: "1px 7px", marginLeft: 2 }}
													>
														{rec.done ? "hotovo" : "otevřený"}
													</span>
												)}
											</span>
										);
									})}
								</div>
							)}

							{/* AI shrnutí vlákna (prototyp ř. 961–969) */}
							{hasSum && (
								<div
									style={{
										display: "flex",
										gap: 10,
										background: "var(--brass-soft)",
										borderRadius: 12,
										padding: "10px 13px",
										marginBottom: 6,
										alignItems: "flex-start",
									}}
								>
									<span
										style={{
											width: 17,
											height: 17,
											borderRadius: "50%",
											border: "1.6px solid var(--brass-text)",
											color: "var(--brass-text)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: 9,
											fontWeight: 800,
											fontFamily: "var(--w-font-display)",
											flex: "none",
											marginTop: 1,
										}}
									>
										W
									</span>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div
											style={{
												fontFamily: "var(--w-font-display)",
												fontWeight: 700,
												fontSize: 10.5,
												letterSpacing: ".05em",
												color: "var(--brass-text)",
											}}
										>
											SHRNUTÍ VLÁKNA
										</div>
										{m.sum && (
											<div
												style={{
													fontFamily: "var(--w-font-body)",
													fontSize: 12.5,
													color: "var(--ink-2)",
													lineHeight: 1.55,
													marginTop: 3,
												}}
											>
												{t.sum}
											</div>
										)}
									</div>
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => m.setSum(!m.sum)}
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10,
											color: "var(--brass-text)",
											cursor: "pointer",
											flex: "none",
										}}
									>
										{m.sum ? "skrýt" : "zobrazit"}
									</span>
								</div>
							)}
							{aiOffOn && (
								<div
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11,
										color: "var(--ink-3)",
										margin: "2px 0 6px",
									}}
								>
									AI je pro granty@ vypnutá (osobní údaje žadatelů) — bez shrnutí a draftů.
								</div>
							)}

							{/* zprávy vlákna (prototyp ř. 975–1042) */}
							{msgsAll.map((msg, i) => {
								const key = expKey(i);
								const open = isOpen(i);
								const outd = msg.dir === "out";
								const who = outd ? P[msg.by ?? ""] : undefined;
								const name = outd ? (who?.n ?? msg.by ?? "") : t.from.n;
								const ini = outd ? (who?.ini ?? "") : t.from.ini;
								const av = outd ? (msg.by === "ad" ? "brass" : "") : "ext";
								const addr = outd ? (mb ? mb.addr : "kosir.adam@gmail.com") : t.from.addr;
								const body = msg.en && m.translated && msg.cz ? msg.cz : msg.body;
								const island = !!t.htmlMail && msg.dir === "in";
								const imgBlocked = island && !m.nast.privImg && !m.imgOk[t.id];
								const qKey = `q:${key}`;

								if (!open)
									return (
										<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
											key={key}
											onClick={() => m.setExp(key, true)}
											title="Rozbalit zprávu"
											style={{
												display: "flex",
												alignItems: "center",
												gap: 10,
												padding: "11px 0",
												borderBottom: "1px solid var(--line)",
												cursor: "pointer",
											}}
										>
											<span data-av={av} style={avStyle(26, 9)}>
												{ini}
											</span>
											<span
												style={{
													fontFamily: "var(--w-font-display)",
													fontWeight: 600,
													fontSize: 12.5,
													color: "var(--ink)",
													flex: "none",
												}}
											>
												{name}
											</span>
											<span
												style={{
													fontFamily: "var(--w-font-body)",
													fontSize: 12,
													color: "var(--ink-3)",
													flex: 1,
													minWidth: 0,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{msg.body[1] ?? msg.body[0]}
											</span>
											{msg.att && (
												<ClipSvg size={11} style={{ color: "var(--ink-3)", flex: "none" }} />
											)}
											<span
												style={{
													fontFamily: "var(--w-font-mono)",
													fontSize: 10.5,
													color: "var(--ink-3)",
													flex: "none",
												}}
											>
												{msg.t}
											</span>
										</div>
									);

								return (
									<div
										key={key}
										style={{ padding: "15px 0 10px", borderBottom: "1px solid var(--line)" }}
									>
										<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
											onClick={() => m.setExp(key, false)}
											style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
										>
											<span data-av={av} style={avStyle(32, 11)}>
												{ini}
											</span>
											<div style={{ flex: 1, minWidth: 0 }}>
												<div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
													<span
														style={{
															fontFamily: "var(--w-font-display)",
															fontWeight: 700,
															fontSize: 13.5,
															color: "var(--ink)",
														}}
													>
														{name}
													</span>
													<span
														style={{
															fontFamily: "var(--w-font-mono)",
															fontSize: 10,
															color: "var(--ink-3)",
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
														}}
													>
														{addr}
													</span>
												</div>
												<div
													style={{
														fontFamily: "var(--w-font-mono)",
														fontSize: 10,
														color: "var(--ink-3)",
														marginTop: 2,
													}}
												>
													komu: {msg.to}
												</div>
											</div>
											{msg.en && (
												<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
													onClick={(ev) => {
														ev.stopPropagation();
														m.setTranslated(!m.translated);
													}}
													title="Watson přeloží zprávu — originál zůstává k dispozici"
													style={{
														display: "inline-flex",
														alignItems: "center",
														gap: 5,
														fontFamily: "var(--w-font-display)",
														fontWeight: 600,
														fontSize: 10.5,
														padding: "3px 9px",
														borderRadius: 999,
														background: "var(--brass-soft)",
														color: "var(--brass-text)",
														cursor: "pointer",
														flex: "none",
													}}
												>
													{m.translated ? "Zobrazit originál" : "Přeložit do češtiny"}
												</span>
											)}
											<span
												style={{
													fontFamily: "var(--w-font-mono)",
													fontSize: 10.5,
													color: "var(--ink-3)",
													flex: "none",
												}}
											>
												{msg.t}
											</span>
										</div>
										{outd && mb && (
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: 6,
													margin: "7px 0 0 42px",
												}}
											>
												<LockSvg size={10} style={{ color: "var(--brass-text)" }} />
												<span
													style={{
														fontFamily: "var(--w-font-mono)",
														fontSize: 10,
														color: "var(--brass-text)",
													}}
												>
													odesláno (simulace) za {mb.short} · odeslal {name}
												</span>
											</div>
										)}
										<div style={{ margin: "10px 0 0 42px", maxWidth: "66ch" }}>
											{imgBlocked && (
												<div
													style={{
														display: "flex",
														alignItems: "center",
														gap: 8,
														border: "1px dashed var(--line)",
														background: "var(--panel-2)",
														borderRadius: 9,
														padding: "6px 10px",
														marginBottom: 8,
														flexWrap: "wrap",
													}}
												>
													<svg
														width="12"
														height="12"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="1.8"
														style={{ color: "var(--ink-3)", flex: "none" }}
														aria-hidden
													>
														<rect x="3.5" y="5" width="17" height="14" rx="1.6" />
														<circle cx="9" cy="10" r="1.6" />
														<path d="M4.5 17 L10 12 L14 15.5 L16.5 13.5 L20 16.5" />
													</svg>
													<span
														style={{
															flex: 1,
															minWidth: 140,
															fontFamily: "var(--w-font-body)",
															fontSize: 11,
															color: "var(--ink-2)",
														}}
													>
														Obrázky blokovány — ochrana před sledovacími pixely.
													</span>
													<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
														onClick={() => {
															m.allowImgs(t.id);
															showToast(
																"Obrázky načteny pro tuhle zprávu. „Vždy od odesílatele“ si zapamatuje výjimku.",
															);
														}}
														data-ghost
														style={{ fontSize: 10, padding: "3px 9px", flex: "none" }}
													>
														Načíst
													</span>
													<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
														onClick={() => {
															m.allowImgs(t.id);
															showToast(
																"Obrázky načteny pro tuhle zprávu. „Vždy od odesílatele“ si zapamatuje výjimku.",
															);
														}}
														data-ghost
														style={{ fontSize: 10, padding: "3px 9px", flex: "none" }}
													>
														Vždy od {t.from.n}
													</span>
												</div>
											)}
											{island && (
												<div
													style={{
														fontFamily: "var(--w-font-mono)",
														fontSize: 9,
														color: "var(--ink-3)",
														marginBottom: 4,
													}}
												>
													HTML e-mail · zobrazuje se jako světlý ostrov i v tmavém režimu ·{" "}
													<span
														style={{ cursor: "pointer", color: "var(--brass-text)" }}
														title="Demo — otevře originál v plné šířce"
													>
														původní podoba
													</span>
												</div>
											)}
											{island ? (
												<div
													style={{
														background: "#ffffff",
														color: "#16161a",
														border: "1px solid var(--line)",
														borderRadius: 10,
														padding: "12px 14px",
													}}
												>
											{keyedValues(body, (paragraph) => paragraph).map(({ key, value: p }) => (
												<p
													key={key}
															style={{
																fontFamily: "var(--w-font-body)",
																fontSize: 14,
																color: "#16161a",
																lineHeight: 1.65,
																margin: "0 0 10px",
															}}
														>
															{p}
														</p>
													))}
												</div>
											) : (
										keyedValues(body, (paragraph) => paragraph).map(({ key, value: p }) => (
											<p
												key={key}
														style={{
															fontFamily: "var(--w-font-body)",
															fontSize: 14.5,
															color: "var(--ink)",
															lineHeight: 1.68,
															margin: "0 0 10px",
														}}
													>
														{p}
													</p>
												))
											)}
											{msg.att && (
												<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
													onClick={() =>
														showToast("Náhled přílohy — v aplikaci se otevře prohlížeč souboru.")
													}
													style={{
														display: "inline-flex",
														alignItems: "center",
														gap: 8,
														background: "var(--panel-2)",
														border: "1px solid var(--line)",
														borderRadius: 9,
														padding: "7px 11px",
														margin: "2px 0 8px",
														cursor: "pointer",
													}}
												>
													<svg
														width="13"
														height="13"
														viewBox="0 0 14 14"
														fill="none"
														style={{ color: "var(--ink-3)" }}
														aria-hidden
													>
														<rect
															x="3"
															y="1.5"
															width="8"
															height="11"
															rx="1.5"
															stroke="currentColor"
															strokeWidth="1.2"
														/>
														<line
															x1="5"
															y1="5"
															x2="9"
															y2="5"
															stroke="currentColor"
															strokeWidth="1.2"
														/>
														<line
															x1="5"
															y1="7.5"
															x2="9"
															y2="7.5"
															stroke="currentColor"
															strokeWidth="1.2"
														/>
													</svg>
													<span
														style={{
															fontFamily: "var(--w-font-mono)",
															fontSize: 11,
															color: "var(--ink-2)",
														}}
													>
														{msg.att}
													</span>
												</span>
											)}
											{msg.quote && (
												<>
													<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
														onClick={() => m.toggleExp(qKey)}
														title="Citovaný text předchozích zpráv"
														style={{
															display: "inline-flex",
															alignItems: "center",
															gap: 6,
															fontFamily: "var(--w-font-mono)",
															fontSize: 10.5,
															color: "var(--ink-3)",
															border: "1px solid var(--line)",
															borderRadius: 999,
															padding: "2px 10px",
															cursor: "pointer",
														}}
													>
														⋯ citovaný text
													</span>
													{m.exp[qKey] && (
														<div
															style={{
																borderLeft: "2px solid var(--line)",
																marginTop: 8,
																paddingLeft: 12,
															}}
														>
												{keyedValues(msg.quote, (paragraph) => paragraph).map(({ key, value: q }) => (
													<p
														key={key}
																	style={{
																		fontFamily: "var(--w-font-body)",
																		fontSize: 12.5,
																		color: "var(--ink-3)",
																		lineHeight: 1.6,
																		margin: "0 0 7px",
																	}}
																>
																	{q}
																</p>
															))}
														</div>
													)}
												</>
											)}
										</div>
									</div>
								);
							})}

							{/* odpovědní řádek (prototyp ř. 1043–1048) */}
							<div style={{ display: "flex", gap: 7, margin: "14px 0 4px", flexWrap: "wrap" }}>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={startEdit}
									data-ghost
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										padding: "7px 14px",
										color: "var(--brass-text)",
										borderColor: "var(--brass)",
									}}
								>
									<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
										<path
											d="M6 3.2 L2.6 6.6 L6 10"
											stroke="currentColor"
											strokeWidth="1.4"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
										<path
											d="M2.6 6.6 H8.6 A2.9 2.9 0 0 1 11.5 9.5 V10.8"
											stroke="currentColor"
											strokeWidth="1.4"
											strokeLinecap="round"
										/>
									</svg>
									Odpovědět
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => {
										startEdit();
										showToast(
											"Odpověď všem — příjemci z vlákna. Reply-all guard ohlídá externí adresy.",
										);
									}}
									data-ghost
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										padding: "7px 14px",
									}}
								>
									Odpovědět všem
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => {
										// Přeposlat = Nová zpráva s Fwd: (prototyp forward, ř. 3913);
										// okno Nové zprávy otvírá MailScreen/NewMessage přes m.newMsg
										const lastMsg = msgsAll[last];
										m.setNewMsg({
											fwd: {
												subj: `Fwd: ${t.subj}`,
												body: `---------- Přeposlaná zpráva ----------\nOd: ${t.from.n} <${t.from.addr}>\nPředmět: ${t.subj}\n\n${(lastMsg?.body ?? []).join("\n")}`,
											},
										});
									}}
									data-ghost
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										padding: "7px 14px",
									}}
								>
									<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
										<path
											d="M8 3.2 L11.4 6.6 L8 10"
											stroke="currentColor"
											strokeWidth="1.4"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
										<path
											d="M11.4 6.6 H5.4 A2.9 2.9 0 0 0 2.5 9.5 V10.8"
											stroke="currentColor"
											strokeWidth="1.4"
											strokeLinecap="round"
										/>
									</svg>
									Přeposlat
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Interní chat: záložka (mobil/tablet/režim Záložka, prototyp ř. 1052–1096) */}
				{!t.personal && (
					<div
						data-tpane="chat"
						style={{
							flex: 1,
							minWidth: 0,
							flexDirection: "column",
							minHeight: 0,
							background: "var(--panel-2)",
						}}
					>
						<div style={{ flex: 1, overflow: "auto", padding: "14px 18px 6px" }}>
							<div
								style={{
									maxWidth: 640,
									margin: "0 auto",
									display: "flex",
									flexDirection: "column",
									gap: 9,
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: 7 }}>
									<span
										style={{
											fontFamily: "var(--w-font-display)",
											fontWeight: 700,
											fontSize: 10.5,
											letterSpacing: ".05em",
											textTransform: "uppercase",
											color: "var(--ink-3)",
										}}
									>
										Interní diskuse
									</span>
									<ChatLock />
								</div>
								{chatMsgs(false)}
							</div>
						</div>
						<div style={{ flex: "none", padding: "8px 18px 12px" }}>
							<div style={{ maxWidth: 640, margin: "0 auto" }}>{chatInput(false)}</div>
						</div>
					</div>
				)}

				{/* Interní chat: pravý panel (desktop ≥1440, prototyp ř. 1097–1146) */}
				{!t.personal && (
					<div
						data-chatrail
						style={{
							width: 306,
							flex: "none",
							borderLeft: "1px solid var(--line)",
							background: "var(--panel-2)",
							flexDirection: "column",
							minHeight: 0,
						}}
					>
						<div
							style={{
								flex: "none",
								display: "flex",
								alignItems: "center",
								gap: 7,
								padding: "12px 14px 8px",
							}}
						>
							<span
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 10.5,
									letterSpacing: ".05em",
									textTransform: "uppercase",
									color: "var(--ink-3)",
								}}
							>
								Interní diskuse
							</span>
							<span
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)" }}
							>
								{nchat}
							</span>
							<ChatLock />
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									m.setChatOff(true);
									m.setCtab("vlakno");
								}}
								title="Sbalit chat do záložky — vlákno dostane celou šířku"
								data-rowbtn
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 11, flex: "none" }}
							>
								»
							</span>
						</div>
						<div
							style={{
								flex: 1,
								overflow: "auto",
								padding: "2px 14px 6px",
								display: "flex",
								flexDirection: "column",
								gap: 9,
							}}
						>
							{chatMsgs(true)}
						</div>
						<div style={{ flex: "none", padding: "8px 14px 12px" }}>{chatInput(true)}</div>
					</div>
				)}
			</div>

			{/* ── Kolizní hlídka (prototyp ř. 923–931 v bloku Kolize) ── */}
			{collOn && (
				<div
					data-tpane="mail"
					style={{
						flex: "none",
						display: "flex",
						alignItems: "center",
						gap: 9,
						padding: "7px 18px",
						background: "var(--brass-soft)",
						borderTop: "1px solid var(--line)",
					}}
				>
					<span
						data-pulse
						style={{
							width: 7,
							height: 7,
							borderRadius: "50%",
							background: "var(--brass)",
							flex: "none",
						}}
					/>
					<span style={{ ...avStyle(18, 7.5), display: "inline-flex" }}>PŠ</span>
					<span
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 12,
							color: "var(--ink-2)",
							flex: 1,
							minWidth: 0,
						}}
					>
						<span style={{ fontWeight: 600 }}>Petra Šimková</span> právě píše odpověď v tomhle
						vlákně — domluvte se, ať neodejdou dvě.
					</span>
					<span
						style={{
							fontFamily: "var(--w-font-mono)",
							fontSize: 9.5,
							color: "var(--ink-3)",
							flex: "none",
						}}
					>
						{m.collArmed[t.id] ? "další klik na Odeslat odešle i tak" : "kolizní hlídka"}
					</span>
				</div>
			)}

			{/* ── VRSTVA 2: composer (prototyp ř. 1147–1380) — RTE + toolbar + karty ── */}
			{/* CSS ≥1440 vnucuje [data-tpane="mail"] display:flex !important → nutný column */}
			<div
				ref={compRef}
				data-tpane="mail"
				style={{
					flex: "none",
					flexDirection: "column",
					borderTop: "1px solid var(--line)",
					background: "var(--panel)",
					padding: "9px 18px 12px",
					position: "relative",
				}}
			>
				<div
					title="From je svázané s vláknem — identita se u odpovědi nemění. Podpis se doplní podle schránky."
					style={{
						display: "flex",
						alignItems: "center",
						gap: 7,
						flexWrap: "wrap",
						paddingBottom: 7,
					}}
				>
					<LockSvg size={11} style={{ color: "var(--ink-3)", flex: "none" }} />
					<span style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-3)" }}>
						Odpovídáš jako
					</span>
					<span
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 600,
							fontSize: 12,
							color: "var(--ink)",
						}}
					>
						Adam Košír
					</span>
					{!t.personal && mb && (
						<>
							<span
								style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-3)" }}
							>
								za
							</span>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontFamily: "var(--w-font-mono)",
									fontSize: 10.5,
									color: "var(--ink-2)",
									background: "var(--panel-2)",
									border: "1px solid var(--line)",
									borderRadius: 6,
									padding: "1px 7px",
								}}
							>
								<span data-mbdot={t.mb} style={{ width: 7, height: 7, borderRadius: "50%" }} />
								{mb.addr}
							</span>
						</>
					)}
					{t.personal && (
						<>
							<span
								style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-3)" }}
							>
								ze své osobní adresy
							</span>
							<span
								style={{
									fontFamily: "var(--w-font-mono)",
									fontSize: 10.5,
									color: "var(--pers-ink)",
									background: "var(--pers-bg)",
									border: "1px solid var(--pers-line)",
									borderRadius: 6,
									padding: "1px 7px",
								}}
							>
								kosir.adam@gmail.com
							</span>
						</>
					)}
					<span style={{ flex: 1 }} />
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						onClick={() => m.setFloat({ id: t.id, min: false })}
						title="Psát v plovoucím okně — seznam zůstane po ruce"
						data-rowbtn
						style={{ border: "1px solid var(--line)" }}
					>
						<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
							<path
								d="M5.5 2.5 H2.5 V11.5 H11.5 V8.5"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
							/>
							<path
								d="M8 2.5 H11.5 V6"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
							/>
							<line
								x1="11.2"
								y1="2.8"
								x2="6.8"
								y2="7.2"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
							/>
						</svg>
					</span>
				</div>

				{/* AI draft karta (prototyp comp.isDraft, ř. 1183–1209) — jen aiDraft && AI on && bez konceptu */}
				{mode === "draft" && (
					<div
						style={{
							border: "1.5px solid var(--brass)",
							background: "var(--brass-soft)",
							borderRadius: 13,
							padding: "11px 13px",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
							<span
								style={{
									width: 17,
									height: 17,
									borderRadius: "50%",
									border: "1.6px solid var(--brass-text)",
									color: "var(--brass-text)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: 9,
									fontWeight: 800,
									fontFamily: "var(--w-font-display)",
									flex: "none",
								}}
							>
								W
							</span>
							<span
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 12,
									color: "var(--brass-text)",
								}}
							>
								Watson · návrh odpovědi
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setCpop(cpop === "why" ? null : "why")}
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 11,
									color: "var(--brass-text)",
									cursor: "pointer",
								}}
							>
								proč tenhle návrh?
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => m.setDraft(t.id, "", "empty")}
								title="Zahodit návrh"
								style={{
									marginLeft: "auto",
									fontSize: 15,
									lineHeight: 1,
									color: "var(--ink-3)",
									cursor: "pointer",
									flex: "none",
								}}
							>
								×
							</span>
						</div>
						{cpop === "why" && (
							<div
								style={{
									background: "var(--panel)",
									border: "1px solid var(--line)",
									borderRadius: 9,
									padding: "8px 11px",
									marginBottom: 8,
								}}
							>
								{(t.why ?? []).map((w) => (
									<div
										key={w}
										style={{
											display: "flex",
											gap: 7,
											fontFamily: "var(--w-font-body)",
											fontSize: 11.5,
											color: "var(--ink-2)",
											lineHeight: 1.55,
										}}
									>
										<span style={{ color: "var(--brass)", flex: "none" }}>·</span>
										<span>{w}</span>
									</div>
								))}
								<div
									style={{
										fontFamily: "var(--w-font-mono)",
										fontSize: 9.5,
										color: "var(--ink-3)",
										marginTop: 6,
									}}
								>
									návrh vychází z vlákna a interní diskuse · nikam se neodeslal
								</div>
							</div>
						)}
						<div
							role="region"
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Posuvný text musí být dosažitelný klávesnicí (axe scrollable-region-focusable).
							tabIndex={0}
							aria-label="Návrh odpovědi od Watsonu"
							style={{ maxHeight: 148, overflow: "auto" }}
						>
							{keyedValues(t.draft ?? [], (paragraph) => paragraph).map(({ key, value: p }) => (
								<p
									key={key}
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 12.5,
										color: "var(--ink)",
										lineHeight: 1.6,
										margin: "0 0 6px",
									}}
								>
									{p}
								</p>
							))}
						</div>
						<div
							style={{
								display: "flex",
								gap: 7,
								marginTop: 8,
								alignItems: "center",
								flexWrap: "wrap",
							}}
						>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									m.setDraft(t.id, (t.draft ?? []).join("\n\n"));
									focusComp();
								}}
								data-ghost
								style={{ fontSize: 11.5, padding: "6px 12px", background: "var(--panel)" }}
							>
								Použít a upravit
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => m.setDraft(t.id, "", "empty")}
								data-ghost
								style={{ fontSize: 11.5, padding: "6px 12px" }}
							>
								Zahodit
							</span>
							<span
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginLeft: "auto",
								}}
							>
								AI nikdy neodesílá sama — odešleš ty.
							</span>
						</div>
					</div>
				)}

				{mode !== "draft" && (
					<>
						{/* quick reply chipy (prototyp comp.quick) */}
						{showQuickRow && (
							<div
								style={{
									display: "flex",
									gap: 6,
									flexWrap: "wrap",
									marginBottom: 8,
									alignItems: "center",
								}}
							>
								{quick.map((label) => (
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										key={label}
										onClick={() => {
											m.setDraft(t.id, QUICK_BODY[label] ?? label);
											focusComp();
										}}
										data-oneclick
										style={{
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 11,
											padding: "4px 10px",
											borderRadius: 999,
										}}
									>
										{label}
									</span>
								))}
								<span
									style={{
										marginLeft: "auto",
										fontFamily: "var(--w-font-body)",
										fontSize: 10.5,
										color: "var(--ink-3)",
									}}
								>
									AI nikdy neodesílá sama — odešleš ty.
								</span>
							</div>
						)}

						{/* Komu + Cc/Bcc (prototyp ř. 1211–1222) */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								flexWrap: "wrap",
								marginBottom: 6,
								fontFamily: "var(--w-font-body)",
								fontSize: 11.5,
								color: "var(--ink-3)",
							}}
						>
							<span style={{ flex: "none" }}>Komu</span>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									background: "var(--panel-2)",
									border: "1px solid var(--line)",
									borderRadius: 999,
									padding: "2px 10px",
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 11,
									color: "var(--ink-2)",
								}}
							>
								{t.from.n} &lt;{t.from.addr}&gt;
							</span>
							{!ccOn && (
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => setCcOn(true)}
									style={{ cursor: "pointer", color: "var(--brass-text)", fontWeight: 600 }}
								>
									Cc/Bcc
								</span>
							)}
						</div>
						{ccOn && (
							<div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
								<RecipientField
									value={cc}
									onChange={setCc}
									placeholder="Cc — kopie (našeptává z kontaktů)"
									bordered
									autoFocus
								/>
								<RecipientField
									value={bcc}
									onChange={setBcc}
									placeholder="Bcc — skrytá kopie"
									bordered
								/>
							</div>
						)}

						{/* RTE toolbar (prototyp ř. 1223–1259) */}
						<div
							style={{
								display: "flex",
								gap: 2,
								marginBottom: 6,
								alignItems: "center",
								flexWrap: "wrap",
							}}
						>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("bold")}
								data-rowbtn
								title="Tučné (⌘B)"
								style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 12 }}
							>
								B
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("italic")}
								data-rowbtn
								title="Kurzíva (⌘I)"
								style={{
									fontFamily: "var(--w-font-body)",
									fontStyle: "italic",
									fontWeight: 600,
									fontSize: 12,
								}}
							>
								I
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("underline")}
								data-rowbtn
								title="Podtržení (⌘U)"
								style={{
									fontSize: 11.5,
									textDecoration: "underline",
									fontFamily: "var(--w-font-body)",
									fontWeight: 600,
								}}
							>
								U
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("strikeThrough")}
								data-rowbtn
								title="Přeškrtnutí"
								style={{
									fontSize: 11.5,
									textDecoration: "line-through",
									fontFamily: "var(--w-font-body)",
									fontWeight: 600,
								}}
							>
								S
							</span>
							<span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 4px" }} />
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("insertUnorderedList")}
								data-rowbtn
								title="Odrážky"
							>
								<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
									<circle cx="2.6" cy="3.4" r="1" fill="currentColor" />
									<circle cx="2.6" cy="7" r="1" fill="currentColor" />
									<circle cx="2.6" cy="10.6" r="1" fill="currentColor" />
									<line
										x1="5.4"
										y1="3.4"
										x2="12"
										y2="3.4"
										stroke="currentColor"
										strokeWidth="1.3"
									/>
									<line x1="5.4" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.3" />
									<line
										x1="5.4"
										y1="10.6"
										x2="12"
										y2="10.6"
										stroke="currentColor"
										strokeWidth="1.3"
									/>
								</svg>
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("insertOrderedList")}
								data-rowbtn
								title="Číslování"
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 10 }}
							>
								1.
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => rteCmd("formatBlock", "blockquote")}
								data-rowbtn
								title="Citace"
								style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 13 }}
							>
								„
							</span>
							<span style={{ position: "relative", display: "inline-flex" }}>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onMouseDown={pd}
									onClick={linkOpen}
									data-rowbtn
									data-on={cpop === "lnk" || undefined}
									title="Vložit odkaz — označ text a klikni"
								>
									<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
										<path
											d="M5.8 8.2 L8.2 5.8"
											stroke="currentColor"
											strokeWidth="1.3"
											strokeLinecap="round"
										/>
										<path
											d="M6.5 4 L7.8 2.7 A2.3 2.3 0 0 1 11.3 6.2 L10 7.5"
											stroke="currentColor"
											strokeWidth="1.3"
											strokeLinecap="round"
										/>
										<path
											d="M7.5 10 L6.2 11.3 A2.3 2.3 0 0 1 2.7 7.8 L4 6.5"
											stroke="currentColor"
											strokeWidth="1.3"
											strokeLinecap="round"
										/>
									</svg>
								</span>
								{/* popover odkazu (prototyp pop='lnk', ř. 1234–1239 + lnkApply) */}
								{cpop === "lnk" && (
									<div
										style={{
											position: "absolute",
											bottom: "calc(100% + 8px)",
											left: 0,
											zIndex: 52,
											display: "flex",
											gap: 6,
											alignItems: "center",
											width: "min(300px, 74vw)",
											background: "var(--panel)",
											border: "1px solid var(--line)",
											borderRadius: 11,
											boxShadow: "var(--shadow)",
											padding: 7,
											animation: "wPop .12s ease",
										}}
									>
										<input
											value={lnkUrl}
											onChange={(ev) => setLnkUrl(ev.target.value)}
											onKeyDown={(ev) => {
												if (ev.key === "Enter") {
													ev.preventDefault();
													lnkApply();
												}
											}}
											placeholder="https://…"
											style={{
												flex: 1,
												minWidth: 0,
												border: "1px solid var(--line)",
												background: "var(--panel-2)",
												borderRadius: 8,
												padding: "6px 9px",
												fontFamily: "var(--w-font-mono)",
												fontSize: 11,
												color: "var(--ink)",
												outline: "none",
											}}
										/>
										<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
											onClick={lnkApply}
											data-primary
											style={{ fontSize: 11, padding: "6px 11px", flex: "none" }}
										>
											Vložit
										</span>
									</div>
								)}
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onMouseDown={pd}
								onClick={() => {
									rteCmd("removeFormat");
									rteCmd("unlink");
								}}
								data-rowbtn
								title="Vyčistit formátování"
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 10 }}
							>
								Tx
							</span>
							{/* barva textu — sdílená paleta (parita s Novou zprávou) */}
							<span style={{ position: "relative", display: "inline-flex" }}>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onMouseDown={pd}
									onClick={() => setColorPop((v) => !v)}
									data-rowbtn
									data-on={colorPop || undefined}
									title="Barva textu"
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 800,
										fontSize: 12,
									}}
								>
									A▾
								</span>
								{colorPop && (
									<div role="region"
										onMouseDown={pd}
										style={{
											position: "absolute",
											bottom: "calc(100% + 8px)",
											left: 0,
											zIndex: 52,
											display: "flex",
											gap: 5,
											background: "var(--panel)",
											border: "1px solid var(--line)",
											borderRadius: 10,
											boxShadow: "var(--shadow)",
											padding: 7,
											animation: "wPop .12s ease",
										}}
									>
										{TEXT_COLORS.map((c) => (
											<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
												key={c.css}
												title={c.label}
												onClick={() => {
													rteCmd("styleWithCSS", "true");
													rteCmd("foreColor", c.css);
													setColorPop(false);
												}}
												style={{
													width: 18,
													height: 18,
													borderRadius: "50%",
													border: "1px solid var(--line)",
													background: c.css,
													cursor: "pointer",
													flex: "none",
												}}
											/>
										))}
									</div>
								)}
							</span>
							<span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 4px" }} />
							<span style={{ position: "relative", display: "inline-flex" }}>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => setCpop(cpop === "tpl" ? null : "tpl")}
									data-rowbtn
									data-on={cpop === "tpl" || undefined}
									title="Vložit šablonu odpovědi"
									style={{
										width: "auto",
										padding: "0 9px",
										gap: 5,
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 11,
									}}
								>
									<svg
										width="12"
										height="12"
										viewBox="0 0 14 14"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.3"
										aria-hidden
									>
										<rect x="2" y="2" width="10" height="10" rx="1.6" />
										<line x1="4.4" y1="5" x2="9.6" y2="5" />
										<line x1="4.4" y1="7.5" x2="9.6" y2="7.5" />
										<line x1="4.4" y1="10" x2="7.5" y2="10" />
									</svg>
									Šablony
								</span>
								{/* popover šablon (prototyp ř. 1246–1256) — vloží NA KONEC konceptu */}
								{cpop === "tpl" && (
									<div
										style={{
											position: "absolute",
											bottom: "calc(100% + 8px)",
											left: 0,
											zIndex: 52,
											width: "min(330px, 78vw)",
											background: "var(--panel)",
											border: "1px solid var(--line)",
											borderRadius: 13,
											boxShadow: "var(--shadow)",
											padding: 5,
											animation: "wPop .14s ease",
										}}
									>
										{tpls.map((tp) => (
											<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
												key={tp.n}
												onClick={() => {
													// nikdy nepřepsat rozepsané — šablona jde na konec, oddělená prázdným řádkem
													const cur = m.drafts[t.id]?.text ?? "";
													m.setDraft(
														t.id,
														cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${tp.b}` : tp.b,
													);
													setCpop(null);
													focusComp();
												}}
												data-menuitem
												style={{ display: "block" }}
											>
												<div
													style={{
														fontFamily: "var(--w-font-display)",
														fontWeight: 600,
														fontSize: 12,
														color: "var(--ink)",
													}}
												>
													{tp.n}
												</div>
												<div
													style={{
														fontFamily: "var(--w-font-body)",
														fontSize: 10.5,
														color: "var(--ink-3)",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														marginTop: 1,
													}}
												>
													{tp.b
														.split("\n")
														.filter(
															(x) => x && !x.startsWith("Dobrý den") && !x.startsWith("Vážení"),
														)[0] ?? tp.b}
												</div>
											</div>
										))}
										<div
											style={{
												fontFamily: "var(--w-font-body)",
												fontSize: 10,
												color: "var(--ink-3)",
												padding: "6px 10px 5px",
												borderTop: tpls.length ? "1px solid var(--line)" : undefined,
												marginTop: tpls.length ? 4 : 0,
											}}
										>
											{t.personal
												? "Osobní schránka nemá sdílené šablony."
												: `Sdílené šablony pro ${mb?.short ?? ""} — spravují se v Administraci. Při vložení je Watson umí přizpůsobit příjemci (+AI).`}
										</div>
									</div>
								)}
							</span>
							{/* výběr podpisu (vzor Spark) — blok se kreslí pod editorem */}
							<SigPicker
								value={replySigOverride ?? sigIdOf(m.sigChoice, t.personal ? "osobni" : t.mb)}
								onChange={setReplySigOverride}
							/>
							<span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 4px" }} />
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									setConf(!conf);
									if (!conf)
										showToast(
											"Důvěrný režim zapnut — příjemce otevře mail kódem, nejde přeposlat ani kopírovat.",
										);
								}}
								data-rowbtn
								data-on={conf || undefined}
								title="Důvěrný režim — expirace, otevření kódem, nejde přeposlat/kopírovat/tisknout"
							>
								<LockSvg size={12} />
							</span>
						</div>

						{/* sdílený koncept + schvalování (prototyp comp.sdOn, ř. 1272–1291) */}
						{sdOn && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									background: "var(--navy-soft)",
									border: "1px solid var(--line)",
									borderRadius: 10,
									padding: "6px 11px",
									marginBottom: 6,
									flexWrap: "wrap",
								}}
							>
								<span style={{ display: "inline-flex" }}>
									<span
										data-av="brass"
										style={{
											width: 19,
											height: 19,
											borderRadius: "50%",
											background: "var(--avatar-navy)",
											color: "#fff",
											fontFamily: "var(--w-font-display)",
											fontWeight: 700,
											fontSize: 7.5,
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
											border: "2px solid var(--panel)",
										}}
									>
										AK
									</span>
									<span
										style={{
											width: 19,
											height: 19,
											borderRadius: "50%",
											background: "var(--avatar-navy)",
											color: "#fff",
											fontFamily: "var(--w-font-display)",
											fontWeight: 700,
											fontSize: 7.5,
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
											border: "2px solid var(--panel)",
											marginLeft: -7,
										}}
									>
										TM
									</span>
								</span>
								<span
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--ink-2)",
										flex: 1,
										minWidth: 150,
									}}
								>
									Sdílený koncept — píšete ho spolu, změny se slévají živě.
								</span>
								{sdCanAsk && (
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => m.sdAsk(t.id)}
										data-ghost
										style={{ fontSize: 10.5, padding: "4px 10px", flex: "none" }}
									>
										Vyžádat schválení
									</span>
								)}
								{sdPending && (
									<>
										<span
											title="Odejde za schránku; audit zaznamená autora (Adam) i schvalovatele (Tereza). SLA běží dál až do reálného odeslání — eskalace by šla schvalovateli."
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: 5,
												fontFamily: "var(--w-font-display)",
												fontWeight: 600,
												fontSize: 10,
												padding: "2px 9px",
												borderRadius: 999,
												background: "var(--brass-soft)",
												color: "var(--brass-text)",
												flex: "none",
											}}
										>
											čeká na schválení · Tereza
										</span>
										{t.id === "faktura" && (
											<>
												<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
													onClick={() => m.sdApprove(t.id)}
													data-ghost
													style={{ fontSize: 10.5, padding: "4px 10px", flex: "none" }}
													title="Demo — v reálu schvaluje pověřená osoba ze svého účtu"
												>
													Schválit za Terezu
												</span>
												<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
													onClick={() => m.sdReturn(t.id)}
													data-ghost
													style={{ fontSize: 10.5, padding: "4px 10px", flex: "none" }}
												>
													Vrátit s komentářem
												</span>
											</>
										)}
									</>
								)}
								{sdReturned && (
									<>
										<span
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: 5,
												fontFamily: "var(--w-font-display)",
												fontWeight: 600,
												fontSize: 10,
												padding: "2px 9px",
												borderRadius: 999,
												border: "1px solid var(--line)",
												color: "var(--ink-2)",
												flex: "none",
											}}
										>
											vráceno · Tereza: „Zmírni druhý odstavec“
										</span>
										<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
											onClick={() => m.sdAsk(t.id)}
											data-ghost
											style={{ fontSize: 10.5, padding: "4px 10px", flex: "none" }}
										>
											Vyžádat znovu
										</span>
									</>
								)}
								{sdApproved && (
									<span
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 5,
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 10,
											padding: "2px 9px",
											borderRadius: 999,
											background: "var(--success-soft)",
											color: "var(--success-ink)",
											flex: "none",
										}}
									>
										schváleno · Tereza
									</span>
								)}
							</div>
						)}

						{/* důvěrný režim — pruh (prototyp comp.confOn, ř. 1299–1305) */}
						{conf && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									border: "1px solid var(--brass)",
									background: "var(--brass-soft)",
									borderRadius: 10,
									padding: "6px 11px",
									marginBottom: 6,
								}}
							>
								<LockSvg size={12} style={{ color: "var(--brass-text)", flex: "none" }} />
								<span
									style={{
										flex: 1,
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--ink-2)",
									}}
								>
									Důvěrné — příjemce nemůže přeposlat ani kopírovat; přístup vyprší 31. 8. V týmové
									schránce ho vidí všichni s přístupem (schránka = hranice), Assign funguje.
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => setConf(false)}
									style={{
										fontSize: 14,
										lineHeight: 1,
										color: "var(--ink-3)",
										cursor: "pointer",
										flex: "none",
									}}
								>
									×
								</span>
							</div>
						)}

						{/* RTE editor — contentEditable jako prototyp (ř. 1306, [data-rte] v mail.css);
						    HTML žije jen v editoru, do konceptu se ukládá čistý text (innerText) */}
						<div role="region"
							ref={rteRef}
							data-rte
							contentEditable
							suppressContentEditableWarning
							data-ph="Napiš odpověď… formátování nahoře, ⌘Enter odešle"
							onInput={persistRte}
							onPaste={(event) => {
								// Tento starší composer persistuje jen text, proto nepřebíráme cizí HTML
								// ani na jediný frame (event atribut by se mohl spustit ještě před onInput).
								event.preventDefault();
								document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
								persistRte();
							}}
							onKeyDown={(ev) => {
								if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
									ev.preventDefault();
									m.checkSend(t, false);
								}
							}}
						/>

						{/* blok zvoleného podpisu (vzor Spark) — vybírá se tlačítkem Podpis v toolbaru */}
						<SigBlock
							sigId={replySigOverride ?? sigIdOf(m.sigChoice, t.personal ? "osobni" : t.mb)}
						/>

						{/* chip přílohy (prototyp comp.attached, ř. 1312–1320); marker „—" se nekreslí */}
						{attLabel && attLabel !== ATT_MARK && (
							<div style={{ display: "flex", marginTop: 8 }}>
								<span
									title="Nahráno · limit 25 MB se hlídá předem"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 8,
										background: "var(--panel-2)",
										border: "1px solid var(--line)",
										borderRadius: 9,
										padding: "6px 10px",
									}}
								>
									<ClipSvg size={12} style={{ color: "var(--ink-3)" }} />
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10.5,
											color: "var(--ink-2)",
										}}
									>
										{attLabel}
									</span>
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => m.detach(t.id)}
										title="Odebrat přílohu"
										style={{
											cursor: "pointer",
											color: "var(--ink-3)",
											fontSize: 13,
											lineHeight: 1,
										}}
									>
										×
									</span>
								</span>
							</div>
						)}

						<div
							style={{
								display: "flex",
								gap: 7,
								marginTop: 8,
								alignItems: "center",
								flexWrap: "wrap",
							}}
						>
							{/* Odeslat se šipkou = Odeslat později (prototyp ř. 1324–1327) */}
							<span style={{ display: "inline-flex", borderRadius: 8, overflow: "hidden" }}>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-primary
									onClick={() => m.checkSend(t, false)}
									style={{ fontSize: 11.5, padding: "7px 14px", borderRadius: "8px 0 0 8px" }}
								>
									Odeslat
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-primary
									onClick={() => setCpop(cpop === "send" ? null : "send")}
									title="Naplánovat odeslání"
									style={{
										fontSize: 11.5,
										padding: "7px 8px",
										borderRadius: "0 8px 8px 0",
										borderLeft: "1px solid rgba(255,255,255,.35)",
										display: "inline-flex",
										alignItems: "center",
									}}
								>
									<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
										<path
											d="M2 3 L4.5 6 L7 3"
											stroke="#fff"
											strokeWidth="1.5"
											fill="none"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</span>
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-ghost
								onClick={() => {
									m.attach(t.id, ATT_NAME);
									showToast(
										"Příloha se nahrává (progress na chipu) — z disku nebo úložiště (Drive/R2).",
									);
								}}
								title="Přiložit soubor — z disku nebo úložiště"
								style={{
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									width: 30,
									height: 30,
									padding: 0,
								}}
							>
								<ClipSvg size={13} />
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-ghost
								onClick={() => m.setDraft(t.id, "", "empty")}
								style={{ fontSize: 11.5, padding: "6px 12px" }}
							>
								Zahodit
							</span>
							<span
								style={{
									marginLeft: "auto",
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
								}}
							>
								po odeslání máš 10 s na Zpět
							</span>
						</div>

						{/* Odeslat později + sdílený koncept (prototyp comp.sendMenu, ř. 1352–1365).
						    Demo bez reálné fronty — plan() jen ohlásí naplánování, koncept zůstává. */}
						{cpop === "send" && (
							<div
								style={{
									position: "absolute",
									bottom: "calc(100% - 46px)",
									left: 18,
									zIndex: 52,
									width: 238,
									background: "var(--panel)",
									border: "1px solid var(--line)",
									borderRadius: 12,
									boxShadow: "var(--shadow)",
									padding: 5,
									animation: "wPop .14s ease",
								}}
							>
								<div
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 700,
										fontSize: 10,
										letterSpacing: ".05em",
										textTransform: "uppercase",
										color: "var(--ink-3)",
										padding: "5px 10px 6px",
									}}
								>
									Odeslat později
								</div>
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} onClick={() => plan("dnes v 18:00")} data-menuitem>
									<span style={{ flex: 1 }}>Dnes večer</span>
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10.5,
											color: "var(--ink-3)",
										}}
									>
										18:00
									</span>
								</div>
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} onClick={() => plan("zítra v 8:00")} data-menuitem>
									<span style={{ flex: 1 }}>Zítra ráno</span>
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10.5,
											color: "var(--ink-3)",
										}}
									>
										8:00
									</span>
								</div>
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} onClick={() => plan("ve vlastní čas")} data-menuitem>
									<span style={{ flex: 1 }}>Vlastní čas…</span>
								</div>
								<div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => {
										setCpop(null);
										m.checkSend(t, true);
									}}
									data-menuitem
								>
									<span style={{ flex: 1 }}>Odeslat a označit Hotovo</span>
								</div>
								<div
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 10,
										color: "var(--ink-3)",
										padding: "5px 10px 4px",
										lineHeight: 1.45,
									}}
								>
									Časy v tvém pásmu (Praha), u zahraničního příjemce ukážeme i jeho. Naplánování SLA
									nezastaví — běží až do reálného odeslání.
								</div>
								<div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
								{sdShow && (
									<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => {
											setCpop(null);
											m.sdShare(t.id);
										}}
										data-menuitem
									>
										Sdílet koncept s týmem
									</div>
								)}
								{sdCanAsk && (
									<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => {
											setCpop(null);
											m.sdAsk(t.id);
										}}
										data-menuitem
									>
										Vyžádat schválení před odesláním
									</div>
								)}
							</div>
						)}
					</>
				)}
			</div>

			{/* ── undo lišta po odeslání (prototyp ř. 2225–2230) ── */}
			{m.undo?.on && (
				<div
					style={{
						position: "fixed",
						left: "50%",
						transform: "translateX(-50%)",
						bottom: 26,
						zIndex: 70,
						display: "flex",
						alignItems: "center",
						gap: 12,
						background: "#17283f",
						color: "#fff",
						borderRadius: 12,
						padding: "10px 16px",
						boxShadow: "var(--shadow)",
						animation: "wUp .2s ease",
					}}
				>
					<span style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5 }}>
						Odesláno (simulace) za {MB[m.undo.mb]?.short ?? "osobní adresu"}
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						onClick={m.undoBack}
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 12.5,
							color: "var(--brass)",
							cursor: "pointer",
						}}
					>
						Zpět ({m.undo.left} s)
					</span>
				</div>
			)}

			{/* ── varování: chybějící příloha (prototyp ř. 2207–2223) ── */}
			{warn && (
				<>
					<button type="button" aria-label="Zavřít varování"
						onClick={() => m.setWarn(null)}
						style={{
							position: "fixed",
							inset: 0,
							zIndex: "var(--w-layer-nested)",
							border: 0,
							background: "rgba(23,40,63,.32)",
							animation: "wFade .12s ease",
						}}
					/>
					<div
						ref={warnDialogRef}
						role="alertdialog"
						aria-modal="true"
						aria-label="Varování — příloha"
						data-esc-layer
						data-screen-label="Varování — příloha"
						style={{
							position: "fixed",
							top: "50%",
							left: "50%",
							transform: "translate(-50%,-50%)",
							zIndex: "calc(var(--w-layer-nested) + 1)",
							width: "min(400px, 92vw)",
							background: "var(--panel)",
							border: "1px solid var(--line)",
							borderRadius: 16,
							boxShadow: "var(--shadow)",
							animation: "wPop .14s ease",
							padding: "17px 18px 15px",
						}}
					>
						<div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
							<span
								style={{
									width: 30,
									height: 30,
									borderRadius: 9,
									background: "var(--p2-soft)",
									color: "var(--p2-text)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									flex: "none",
								}}
							>
								<ClipSvg size={15} />
							</span>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 700,
										fontSize: 14,
										color: "var(--ink)",
									}}
								>
									Zmiňuješ přílohu — ale žádná není připojená
								</div>
								<div
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 12,
										color: "var(--ink-2)",
										lineHeight: 1.55,
										marginTop: 4,
									}}
								>
									V textu je „v příloze“. U sdílené schránky je to častá chyba — mail odejde za celý
									tým.
								</div>
							</div>
						</div>
						<div
							style={{
								display: "flex",
								gap: 7,
								marginTop: 14,
								justifyContent: "flex-end",
								flexWrap: "wrap",
							}}
						>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-ghost
								onClick={() => m.setWarn(null)}
								style={{ fontSize: 11.5, padding: "7px 13px" }}
							>
								Zrušit
							</span>
							{/* marker „—" projde kontrolou přílohy v checkSend; doSend ho zase odepne */}
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-ghost
								onClick={() => beginPendSend(warn.id, warn.markDone, ATT_MARK)}
								style={{ fontSize: 11.5, padding: "7px 13px" }}
							>
								Poslat i tak
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-primary
								onClick={() => beginPendSend(warn.id, warn.markDone, ATT_NAME)}
								style={{ fontSize: 11.5, padding: "7px 14px" }}
							>
								Připojit a odeslat
							</span>
						</div>
					</div>
				</>
			)}

			{/* ── náhled deep linku bez přístupu (L-22; prototyp ř. 1947–1960) ── */}
			{hostPrev && <HostPreview onClose={() => setHostPrev(false)} />}

			{/* ── Email → úkol formulář (Modul 10; prototyp ř. 1962–2038) ── */}
			{taskM && <TaskModal t={t} onClose={() => setTaskM(false)} />}
		</div>
	);
}
