/**
 * Mail — okno „Nová zpráva" (prototyp ř. 1807–1839 + nw logika ř. 4205–4223).
 * Plovoucí okno vpravo dole (BEZ scrimu — dle prototypu jde psát a zároveň
 * procházet poštu). Od = jen schránky s přístupem, identita barevným chipem
 * (audit L-11); externí příjemce dostane marker (audit SEC-02); před odesláním
 * hlídám slíbenou přílohu (Modul 5); šablony TPL nikdy nepřepisují text (L-50).
 */
import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
	migratePrivateJson,
	removePrivateJson,
	writePrivateJson,
} from "../lib/powersync/privateState";
import { showToast } from "../lib/toast";
import { MailDemoBanner } from "./DemoBanner";
import { MB, TPL } from "./data";
import { RichText, type RichTextHandle } from "./RichText";
import { RecipientField, SigBlock, SigPicker, sigIdOf } from "./SigPicker";
import { useMail } from "./state";

/** Regex „text slibuje přílohu" — shodný se state.checkSend (prototyp ř. 3417). */
const ATT_RE = /příloh|příloz|přikládám|přiložen|attach/i;

/** Prostý text z HTML těla (composer je rich-text) — pro prázdnost + hlídku přílohy. */
const plainText = (html: string): string =>
	html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li)>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.trim();

/** Pořadí identit v řádku Od (prototyp froms, ř. 4205–4208): 4 schránky + osobní. */
const FROM_IDS = ["info", "granty", "podcast", "studio"] as const;
const OSOBNI_ADDR = "kosir.adam@gmail.com";

/** Popisek pole composeru (Od / Komu / Předmět) — výrazné verzálky, ať má hlavička strukturu. */
const FIELD_LABEL: CSSProperties = {
	fontFamily: "var(--w-font-mono)",
	fontWeight: 600,
	fontSize: 10,
	letterSpacing: ".08em",
	textTransform: "uppercase",
	color: "var(--ink-2)",
	width: 52,
	flex: "none",
	paddingTop: 2,
};

/** Adresa vybrané identity (osobní je mimo MB seed). */
const addrOf = (from: string): string =>
	from === "osobni" ? OSOBNI_ADDR : (MB[from]?.addr ?? from);

/** Externí příjemce = adresa mimo doménu t-group-dance.cz (audit SEC-02). */
const hasExternal = (to: string): boolean =>
	to
		.split(/[,;\s]+/)
		.filter((tok) => tok.includes("@"))
		.some((tok) => !/@t-group-dance\.cz$/i.test(tok.trim()));

/** Persistence rozepsané Nové zprávy (audit D10) — koncepty vláken už reload
 * přežívají (watson-mail.drafts), tohle okno drželo text jen v useState. */
const LS_NEW = "watson-mail.newDraft";

/** Příloha se stabilním id — dřív se klíčovala/odebírala podle zobrazeného názvu,
 * takže po přidání→odebrání→přidání vznikl duplicitní název, kolizní React key
 * a klik na × smazal obě stejnojmenné (audit LOW NewMessage.tsx:172). */
interface Att {
	id: string;
	label: string;
}

interface NewDraft {
	from: string;
	to: string;
	cc: string;
	bcc: string;
	subj: string;
	body: string;
	atts: string[];
}

const EMPTY_DRAFT: NewDraft = {
	from: "info",
	to: "",
	cc: "",
	bcc: "",
	subj: "",
	body: "",
	atts: [],
};

export function NewMessage({ open, onClose }: { open: boolean; onClose: () => void }) {
	// rozepsaný koncept z minula (D10); lazy init — čte se jen při mountu
	// výchozí identita info@ (prototyp state.newFrom: 'info', ř. 2284)
	const [from, setFrom] = useState("info");
	// Volba podpisu PRO TENTO MAIL (per-mail override). null = řídit se výchozím
	// podpisem schránky; výběr v composeru přepíše jen tuhle zprávu, ne nastavení.
	// (efektivní `sigId` + reset se dopočítá pod `const m = useMail()`.)
	const [sigOverride, setSigOverride] = useState<string | null>(null);
	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	// Cc/Bcc rozbalené, když z minula zůstala kopie (jinak schované za „Kopie")
	const [ccOn, setCcOn] = useState(false);
	const [subj, setSubj] = useState("");
	const [body, setBody] = useState("");
	const [atts, setAtts] = useState<Att[]>([]);
	const [privateHydrated, setPrivateHydrated] = useState(false);
	const [warnAtt, setWarnAtt] = useState(false);
	const [tplOpen, setTplOpen] = useState(false);
	const rteRef = useRef<RichTextHandle>(null);
	const tplRef = useRef<HTMLDivElement>(null);
	const m = useMail();

	useEffect(() => {
		let cancelled = false;
		void migratePrivateJson<NewDraft>(LS_NEW, EMPTY_DRAFT).then((saved) => {
			if (cancelled) return;
			setFrom(typeof saved.from === "string" ? saved.from : "info");
			setTo(typeof saved.to === "string" ? saved.to : "");
			setCc(typeof saved.cc === "string" ? saved.cc : "");
			setBcc(typeof saved.bcc === "string" ? saved.bcc : "");
			setCcOn(Boolean(saved.cc || saved.bcc));
			setSubj(typeof saved.subj === "string" ? saved.subj : "");
			setBody(typeof saved.body === "string" ? saved.body : "");
			setAtts(
				Array.isArray(saved.atts)
					? saved.atts
							.filter((label): label is string => typeof label === "string")
							.map((label) => ({ id: crypto.randomUUID(), label }))
					: [],
			);
			setPrivateHydrated(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// Efektivní podpis composeru: override (per-mail) nebo výchozí dle schránky.
	const sigId = sigOverride ?? sigIdOf(m.sigChoice, from);
	// Přepnutí schránky (From) → zpět na její výchozí podpis pro tento mail.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset jen při změně schránky
	useEffect(() => {
		setSigOverride(null);
	}, [from]);

	// Přeposlat z vlákna (m.newMsg.fwd) — předvyplní předmět a citaci; rozepsaný
	// text se NIKDY nepřepisuje (L-50), proto jen do prázdných polí
	const fwd = m.newMsg?.fwd;
	useEffect(() => {
		if (!open || !fwd) return;
		setSubj((s) => s || fwd.subj);
		setBody((b) => b || fwd.body.replace(/\n/g, "<br>"));
	}, [open, fwd]);

	// Esc zavírá okno (prototyp globální Escape, ř. 2746) — vlastní listener
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") {
				// první Esc zavře jen otevřený popover šablon, teprve druhý celé okno
				// (audit LOW NewMessage.tsx:88/89)
				if (tplOpen) {
					setTplOpen(false);
					return;
				}
				onClose();
			}
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [open, onClose, tplOpen]);

	// klik mimo popover šablon ho zavře
	useEffect(() => {
		if (!tplOpen) return;
		const h = (e: globalThis.MouseEvent) => {
			if (tplRef.current && !tplRef.current.contains(e.target as Node)) setTplOpen(false);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [tplOpen]);

	// koncept přežije zavření okna i reload (D10) — debounce 1 s; prázdný
	// formulář záznam maže, ať nestraší starý koncept po odeslání/resetu
	useEffect(() => {
		if (!privateHydrated) return;
		const timer = setTimeout(() => {
			if (!to && !cc && !bcc && !subj && !plainText(body) && atts.length === 0)
				void removePrivateJson(LS_NEW);
			else
				void writePrivateJson(LS_NEW, {
					from,
					to,
					cc,
					bcc,
					subj,
					body,
					atts: atts.map((a) => a.label),
				});
		}, 1000);
		return () => clearTimeout(timer);
	}, [from, to, cc, bcc, subj, body, atts, privateHydrated]);

	const isFwd = subj.startsWith("Fwd:");
	const extOn = hasExternal(to);
	const tpls = TPL[from] ?? [];

	const reset = () => {
		setFrom("info");
		setTo("");
		setCc("");
		setBcc("");
		setCcOn(false);
		setSubj("");
		setBody("");
		setAtts([]);
		setWarnAtt(false);
		setTplOpen(false);
		// odeslaný/zahozený koncept nesmí obživnout při dalším otevření (D10)
		void removePrivateJson(LS_NEW);
	};

	/** Odeslání (prototyp nw.send, ř. 4220) — s pojistkou na slíbenou přílohu.
	 * Zvolený podpis (SigBlock) se k tělu přidá při odeslání — demo jen v UI. */
	const doSend = () => {
		showToast(`Odesláno (simulace) z ${addrOf(from)} — zpráva neopustila Watson`);
		reset();
		onClose();
	};
	const trySend = () => {
		// prázdný příjemce → neodesílej (parita s hlídkami přílohy/externího;
		// prázdný mail bez adresy dřív prošel bez varování — audit LOW NewMessage.tsx:149)
		if (!to.trim()) {
			showToast("Zadej příjemce (pole Komu) — mail bez adresy poslat nejde.");
			return;
		}
		// negace („nepřikládám") nesmí spustit hlídku přílohy (audit LOW NewMessage.tsx:150)
		const bodyForAtt = plainText(body).replace(/nepřikládám|nepřiložen\w*/gi, " ");
		if (ATT_RE.test(bodyForAtt) && atts.length === 0) {
			setWarnAtt(true);
			return;
		}
		doSend();
	};

	/** Vložení šablony NA KURZOR (rich editor) — neprázdné tělo se nepřepisuje,
	 * text se vloží na aktuální pozici kurzoru (audit L-50). */
	const insertTpl = (b: string) => {
		if (plainText(body).trim()) rteRef.current?.insertText(`\n${b}\n`);
		else setBody(b.replace(/\n/g, "<br>"));
		setTplOpen(false);
		rteRef.current?.focus();
	};

	const addAtt = () => {
		setAtts((s) => [
			...s,
			{ id: crypto.randomUUID(), label: `dokument_${s.length + 1}.pdf · 118 kB` },
		]);
		setWarnAtt(false);
	};

	if (!open) return null;

	return (
		<div
			data-esc-layer
			data-screen-label="Nová zpráva"
			style={{
				position: "fixed",
				zIndex: 62,
				right: 20,
				bottom: 20,
				width: "min(640px, 94vw)",
				maxHeight: "82vh",
				overflow: "auto",
				background: "var(--panel)",
				border: "1px solid var(--line)",
				borderRadius: 16,
				boxShadow: "var(--shadow)",
				animation: "wPop .16s ease",
				padding: "16px 18px",
			}}
		>
			{/* CC-P0-08 — composer nesmí vypadat jako reálné odesílání */}
			<div style={{ margin: "-16px -18px 12px", borderRadius: "16px 16px 0 0", overflow: "hidden" }}>
				<MailDemoBanner compact />
			</div>
			{/* hlavička (prototyp ř. 1809–1812) */}
			<div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
				<span
					style={{
						fontFamily: "var(--w-font-display)",
						fontWeight: 700,
						fontSize: 14,
						color: "var(--ink)",
						flex: 1,
					}}
				>
					Nová zpráva
				</span>
				<button
					type="button"
					aria-label="Zavřít novou zprávu"
					onClick={onClose}
					title="Zavřít (Esc)"
					style={{
						border: 0,
						background: "transparent",
						padding: 4,
						fontSize: 17,
						lineHeight: 1,
						color: "var(--ink-3)",
						cursor: "pointer",
					}}
				>
					×
				</button>
			</div>

			{/* Od — jen schránky s přístupem, identita barvou schránky (ř. 1813–1818, audit L-11) */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexWrap: "wrap",
					paddingBottom: 9,
				}}
			>
				<span style={FIELD_LABEL}>Od</span>
				{FROM_IDS.map((id) => (
					<button
						key={id}
						type="button"
						aria-pressed={from === id}
						onClick={() => setFrom(id)}
						data-chip
						data-on={from === id ? "true" : undefined}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							fontFamily: "var(--w-font-mono)",
							fontSize: 10.5,
							padding: "4px 10px",
							borderRadius: 999,
							border: "1px solid var(--line)",
							cursor: "pointer",
							whiteSpace: "nowrap",
						}}
					>
						<span data-mbdot={id} style={{ width: 7, height: 7, borderRadius: "50%" }} />
						{MB[id]?.short}
					</button>
				))}
				{/* osobní identita — se zámkem (soukromá sféra, prototyp ř. 4208) */}
				<button
					type="button"
					aria-pressed={from === "osobni"}
					onClick={() => setFrom("osobni")}
					data-chip
					data-on={from === "osobni" ? "true" : undefined}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						fontFamily: "var(--w-font-mono)",
						fontSize: 10.5,
						padding: "4px 10px",
						borderRadius: 999,
						border: "1px solid var(--line)",
						cursor: "pointer",
						whiteSpace: "nowrap",
					}}
				>
					<span data-mbdot="osobni" style={{ width: 7, height: 7, borderRadius: "50%" }} />
					{OSOBNI_ADDR}
					<svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden>
						<title>Soukromá identita</title>
						<rect
							x="2.2"
							y="5"
							width="7.6"
							height="5.2"
							rx="1.2"
							stroke="currentColor"
							strokeWidth="1.3"
						/>
						<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" stroke="currentColor" strokeWidth="1.3" />
					</svg>
				</button>
			</div>
			<div
				style={{
					fontFamily: "var(--w-font-body)",
					fontSize: 10.5,
					color: "var(--ink-3)",
					margin: "-4px 0 10px 60px",
				}}
			>
				From vybíráš jen ze schránek, kam máš přístup — volný text neexistuje. Podpis vybereš dole.
			</div>

			{/* Komu (ř. 1820–1824) + marker externí domény (audit SEC-02) */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					borderTop: "1px solid var(--line)",
					padding: "8px 0",
				}}
			>
				<span style={FIELD_LABEL}>Komu</span>
				<RecipientField
					value={to}
					onChange={setTo}
					placeholder="jméno nebo adresa… (našeptává z kontaktů)"
				/>
				{extOn && (
					<span
						title="Příjemce mimo t-group-dance.cz — mail opustí organizaci"
						style={{
							fontFamily: "var(--w-font-mono)",
							fontSize: 9.5,
							color: "var(--p2-text)",
							background: "var(--p2-soft)",
							borderRadius: 5,
							padding: "1px 6px",
							flex: "none",
						}}
					>
						externí
					</span>
				)}
				{!ccOn && (
					<button
						type="button"
						onClick={() => setCcOn(true)}
						title="Přidat kopii (Cc) a skrytou kopii (Bcc)"
						style={{
							border: 0,
							background: "transparent",
							fontFamily: "var(--w-font-mono)",
							fontSize: 10,
							color: "var(--brass-text)",
							fontWeight: 600,
							cursor: "pointer",
							flex: "none",
						}}
					>
						Kopie
					</button>
				)}
			</div>

			{/* Kopie (Cc) + Skrytá kopie (Bcc) — rozbalí se tlačítkem „Kopie" (parita s MailThread) */}
			{ccOn && (
				<>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							borderTop: "1px solid var(--line)",
							padding: "8px 0",
						}}
					>
						<span
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 11,
								color: "var(--ink-3)",
								width: 52,
								flex: "none",
							}}
						>
							Kopie
						</span>
						<RecipientField
							value={cc}
							onChange={setCc}
							placeholder="Cc — kopie (našeptává z kontaktů)"
							autoFocus
						/>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							borderTop: "1px solid var(--line)",
							padding: "8px 0",
						}}
					>
						<span
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 11,
								color: "var(--ink-3)",
								width: 52,
								flex: "none",
							}}
						>
							Skrytá
						</span>
						<RecipientField value={bcc} onChange={setBcc} placeholder="Bcc — skrytá kopie" />
					</div>
				</>
			)}

			{/* Předmět (ř. 1825–1829) */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					borderTop: "1px solid var(--line)",
					padding: "8px 0",
				}}
			>
				<span style={FIELD_LABEL}>Předmět</span>
				<input
					value={subj}
					onChange={(e) => setSubj(e.target.value)}
					placeholder="O čem to je"
					style={{
						flex: 1,
						minWidth: 0,
						border: "none",
						background: "transparent",
						outline: "none",
						fontFamily: "var(--w-font-body)",
						fontSize: 13,
						color: "var(--ink)",
					}}
				/>
				{isFwd && (
					<span
						style={{
							fontFamily: "var(--w-font-mono)",
							fontSize: 9.5,
							color: "var(--ink-3)",
							border: "1px solid var(--line)",
							borderRadius: 5,
							padding: "1px 6px",
							flex: "none",
						}}
					>
						vlákno v citaci + přílohy
					</span>
				)}
			</div>

			{/* tělo — sdílený rich-text editor (formátování + barvy, všude stejně) */}
			<div style={{ marginTop: 6 }}>
				<RichText
					ref={rteRef}
					value={body}
					onChange={setBody}
					placeholder="Piš… tučně, kurzíva, odrážky, odkaz a barvy máš nahoře."
				/>
			</div>

			{/* blok zvoleného podpisu (vzor Spark) — readonly, při odeslání se přidá k tělu */}
			<SigBlock sigId={sigId} />

			{/* přílohy — chipy (styl dle taskMV chipu, ř. 2028) */}
			{atts.length > 0 && (
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
					{atts.map((a) => (
						<span
							key={a.id}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 5,
								fontFamily: "var(--w-font-mono)",
								fontSize: 10,
								color: "var(--ink-2)",
								background: "var(--panel-2)",
								border: "1px solid var(--line)",
								borderRadius: 6,
								padding: "2px 8px",
							}}
						>
							<svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden>
								<title>Příloha</title>
								<path
									d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
							</svg>
							{a.label}
							<button
								type="button"
								aria-label={`Odebrat přílohu ${a.label}`}
								onClick={() => setAtts((s) => s.filter((x) => x.id !== a.id))}
								title="Odebrat přílohu"
								style={{
									border: 0,
									background: "transparent",
									padding: 2,
									cursor: "pointer",
									color: "var(--ink-3)",
									lineHeight: 1,
								}}
							>
								×
							</button>
						</span>
					))}
				</div>
			)}

			{/* inline varování — text slibuje přílohu, žádná není (Modul 5, ř. 2206–2219) */}
			{warnAtt && (
				<div
					style={{
						display: "flex",
						gap: 11,
						alignItems: "flex-start",
						border: "1px solid var(--p2)",
						background: "var(--p2-soft)",
						borderRadius: 11,
						padding: "10px 13px",
						marginTop: 10,
					}}
				>
					<span
						style={{
							width: 30,
							height: 30,
							borderRadius: 9,
							background: "var(--panel)",
							color: "var(--p2-text)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flex: "none",
						}}
					>
						<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
							<title>Přidat přílohu</title>
							<path
								d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
							/>
						</svg>
					</span>
					<div style={{ flex: 1, minWidth: 0 }}>
						<div
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 12.5,
								color: "var(--ink)",
							}}
						>
							Zmiňuješ přílohu — ale žádná není připojená
						</div>
						<div
							style={{
								fontFamily: "var(--w-font-body)",
								fontSize: 11.5,
								color: "var(--ink-2)",
								lineHeight: 1.55,
								marginTop: 3,
							}}
						>
							V textu je „v příloze". U sdílené schránky je to častá chyba — mail odejde za celý
							tým.
						</div>
						<div style={{ display: "flex", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
							<button
								type="button"
								onClick={() => setWarnAtt(false)}
								data-ghost
								style={{ border: 0, fontSize: 11, padding: "5px 11px" }}
							>
								Zrušit
							</button>
							<button
								type="button"
								onClick={doSend}
								data-ghost
								style={{ border: 0, fontSize: 11, padding: "5px 11px" }}
							>
								Poslat i tak
							</button>
							<button
								type="button"
								onClick={addAtt}
								data-primary
								style={{ border: 0, fontSize: 11, padding: "5px 12px" }}
							>
								Připojit soubor
							</button>
						</div>
					</div>
				</div>
			)}

			{/* akční řádek (ř. 1831–1836) + Šablony (TPL per schránka) */}
			<div style={{ display: "flex", gap: 7, marginTop: 10, alignItems: "center" }}>
				<button
					type="button"
					onClick={trySend}
					data-primary
					style={{ border: 0, fontSize: 12, padding: "8px 16px" }}
				>
					Odeslat
				</button>
				<button
					type="button"
					aria-label="Odeslat později"
					onClick={() => showToast("Odeslat později: dnes večer · zítra ráno · vlastní čas.")}
					data-ghost
					title="Odeslat později"
					style={{
						border: 0,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 31,
						height: 31,
						padding: 0,
					}}
				>
					<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
						<title>Odeslat později</title>
						<circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.2" />
						<path
							d="M7 4.2 V7 L9 8.6"
							stroke="currentColor"
							strokeWidth="1.2"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					aria-label="Přiložit soubor"
					onClick={addAtt}
					data-ghost
					title="Přiložit soubor"
					style={{
						border: 0,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 31,
						height: 31,
						padding: 0,
					}}
				>
					<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
						<title>Přiložit soubor</title>
						<path
							d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4"
							stroke="currentColor"
							strokeWidth="1.2"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<div ref={tplRef} style={{ position: "relative" }}>
					<button
						type="button"
						aria-expanded={tplOpen}
						onClick={() => setTplOpen((v) => !v)}
						data-ghost
						title="Sdílené šablony odpovědí vybrané schránky"
						style={{
							border: 0,
							display: "inline-flex",
							alignItems: "center",
							fontSize: 11,
							padding: "7px 12px",
						}}
					>
						Šablony
					</button>
					{tplOpen && (
						<div
							style={{
								position: "absolute",
								bottom: "calc(100% + 6px)",
								left: 0,
								zIndex: 5,
								width: 262,
								background: "var(--panel)",
								border: "1px solid var(--line)",
								borderRadius: 12,
								boxShadow: "var(--shadow)",
								padding: 7,
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
									padding: "4px 9px 5px",
								}}
							>
								Šablony · {from === "osobni" ? "osobní" : MB[from]?.short}
							</div>
							{tpls.length === 0 && (
								<div
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--ink-3)",
										padding: "4px 9px 7px",
									}}
								>
									Osobní schránka sdílené šablony nemá.
								</div>
							)}
							{tpls.map((tp) => (
								<button
									key={tp.n}
									type="button"
									onClick={() => insertTpl(tp.b)}
									data-menuitem
									title="Vloží se na kurzor — rozepsaný text se nikdy nepřepisuje"
									style={{ width: "100%", border: 0, background: "transparent", color: "inherit" }}
								>
									<span style={{ flex: 1 }}>{tp.n}</span>
								</button>
							))}
						</div>
					)}
				</div>
				<SigPicker value={sigId} onChange={setSigOverride} />
				<span
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 10.5,
						color: "var(--ink-3)",
						marginLeft: "auto",
					}}
				>
					Před odesláním hlídám přílohy a externí příjemce.
				</span>
			</div>
		</div>
	);
}
