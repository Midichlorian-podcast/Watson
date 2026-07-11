/**
 * Ask Watson (Modul 8 — permission-aware, se zdrojem; prototyp markup
 * ř. 2130–2168 + logika askVals ř. 4279–4338). Klíčový router připravených
 * odpovědí dle prototypu; živé AI volání (askAI, ř. 4362) tu poctivě chybí —
 * neznámé dotazy dostanou odpověď, že AI backend zatím není připojen.
 * Zdroje odpovědi = chipy: mailová vlákna otevírají openThread, úkoly/projekty
 * jen toast (žijí v produktivní části, entity_links vedou oběma směry).
 */
import { useEffect, useRef, useState } from "react";
import { showToast } from "../lib/toast";
import { MB } from "./data";
import { useMail } from "./state";

/** Zdroj odpovědi — mailové vlákno (id) nebo úkol/projekt (task). */
interface AskSrc {
	id?: string;
	task?: boolean;
	l: string;
}

interface AskAnswer {
	text: string;
	src: AskSrc[];
}

/** Kruhová ikonka Watsona (prototyp ř. 2134/2141/2151). */
function WBadge({ size = 17 }: { size?: number }) {
	return (
		<span
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				border: "1.6px solid var(--brass-text)",
				color: "var(--brass-text)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: size >= 18 ? 9.5 : 9,
				fontWeight: 800,
				fontFamily: "var(--w-font-display)",
				flex: "none",
				marginTop: size >= 18 ? 0 : 2,
			}}
		>
			W
		</span>
	);
}

export function AskWatson({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const m = useMail();
	const [q, setQ] = useState("");
	const [a, setA] = useState<AskAnswer | null>(null);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const close = () => {
		if (busyTimer.current) clearTimeout(busyTimer.current);
		setQ("");
		setA(null);
		setBusy(false);
		onClose();
	};

	// Esc zavírá + autofocus (prototyp globální Escape ř. 2746, autoFocus ř. 2135)
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		document.addEventListener("keydown", h);
		inputRef.current?.focus();
		return () => document.removeEventListener("keydown", h);
		// biome-ignore lint/correctness/useExhaustiveDependencies: close je stabilní wrapper nad onClose
	}, [open, onClose]);

	if (!open) return null;

	/** Klíčový router odpovědí (prototyp askVals.send, ř. 4281–4337). */
	const send = () => {
		const ql = q.toLowerCase();
		if (!ql.trim()) return;
		if (busyTimer.current) clearTimeout(busyTimer.current);
		setBusy(false);

		// „napiš drafty…" — hromadné návrhy odpovědí (prototyp ř. 4283–4310)
		if (/draft|napiš|napis|připrav|priprav|odpově(z|d)/.test(ql)) {
			const num = ql.match(/\d+/);
			const lim = num?.[0] ? Number.parseInt(num[0], 10) : 10;
			const list = m.threads
				.filter((t) => {
					const e = m.eff(t);
					return (
						!t.personal &&
						!t.sentF &&
						!t.draftF &&
						(m.ovOf(t.id).grp ?? t.grp) === "inbox" &&
						!e.closed &&
						!e.sent &&
						!e.arch &&
						!e.trash &&
						!e.snoozed &&
						m.adm.ai[t.mb] !== "off"
					);
				})
				.slice(0, lim);
			if (list.length) {
				// Poctivě: návrhy se do fronty „AI návrhy ke schválení" reálně nepřidají
				// (state API frontu nevystavuje) — hláška drží znění prototypu.
				setA({
					text: `Připravuju návrhy odpovědí na ${list.length} příchozích vláken (granty@ vynechávám — AI je tam vypnutá). Najdeš je nahoře v Inboxu jako „AI návrhy ke schválení“ — projdeš, schválíš, odešleš. Sám nic neodesílám.`,
					src: list.slice(0, 2).map((t) => ({ id: t.id, l: t.subj })),
				});
			} else {
				setA({
					text: "Teď nevidím žádné příchozí vlákno bez odpovědi, pro které bych mohl draft připravit.",
					src: [],
				});
			}
			return;
		}
		// „mistrovství / MČR" — hledá napříč Watsonem (prototyp ř. 4311–4320)
		if (/mistrovstv|mčr|mcr/.test(ql)) {
			setA({
				text: "Napříč celým Watsonem jsem k „Mistrovství ČR“ našel 4 položky: 2 úkoly, 1 projekt a 1 mailové vlákno se zmínkou. Úkoly a projekty žijí v produktivní části — odsud na ně jen skáčeš.",
				src: [
					{ task: true, l: "úkol · Přihlášky na Mistrovství ČR — do 20. 7. (Tereza)" },
					{ task: true, l: "úkol · Rezervovat autobus na Mistrovství ČR (Jakub)" },
					{ task: true, l: "projekt · Mistrovství ČR 2026 — příprava" },
					{ id: "host42", l: "mail · Host do epizody #42 (zmínka v textu)" },
				],
			});
			return;
		}
		// „sdílené úkoly" (prototyp ř. 4321–4329)
		if (/sdíl|sdil/.test(ql)) {
			setA({
				text: "Úkoly, které sdílí Karel a Jarda (oba přiřazení, režim shared_any/shared_all): 3. Ukazuji jen to, kam máš přístup — cizí prostory se neprojeví ani počtem, osobní sféra je mimo úplně.",
				src: [
					{ task: true, l: "úkol · Inventura skladu kavárny — Karel + Jarda" },
					{ task: true, l: "úkol · Servis světel velkého sálu — Karel + Jarda" },
					{ task: true, l: "úkol · Vratky záloh za červen — Karel + Jarda + Petra" },
				],
			});
			return;
		}
		// faktura / nájem / platba (prototyp ř. 4330)
		if (/faktur|nájem|najem|platb/.test(ql)) {
			setA({
				text: "Poslední faktura za nájem je opravná č. 2026-0714b od Vlněny — po zápočtu přeplatku 6 200 Kč zbývá uhradit 42 200 Kč do pátku 11. 7. Petra dnes ráno potvrdila platbu z provozního účtu.",
				src: [{ id: "faktura", l: "Faktura za nájem — červenec" }],
			});
			return;
		}
		// grant / výzva / termín / OP JAK (prototyp ř. 4331)
		if (/grant|výzv|vyzv|termín|termin|op jak/.test(ql)) {
			setA({
				text: "U žádosti OP JAK (CZ.02.01.01/00/25_042) chybí rozpočet po jednotkových cenách — doplnit přes ISKP21+ do 31. 7. Marie ho nahraje do čtvrtka.",
				src: [{ id: "opjak", l: "Výzva OP JAK — doplnění žádosti" }],
			});
			return;
		}
		// Jiné dotazy: prototyp volá živou AI (askAI) — tady poctivá odpověď,
		// že backend zatím není; krátký skeleton drží rytmus prototypu (data-sk).
		setA(null);
		setBusy(true);
		busyTimer.current = setTimeout(() => {
			setBusy(false);
			setA({
				text: "AI backend zatím není připojen — Ask Watson umí zatím jen připravené odpovědi (zkus: faktura, grant, MČR).",
				src: [],
			});
		}, 600);
	};

	const openSrc = (sr: AskSrc) => {
		if (sr.task) {
			// úkoly/projekty žijí mimo mail (prototyp aSrc.onOpen, ř. 4353)
			showToast(
				"Otevře se v produktivní části Watsonu (úkoly/projekty) — entity_links vedou oběma směry",
			);
			return;
		}
		if (!sr.id) return;
		close();
		m.openThread(sr.id);
	};

	// Schránky s vypnutou AI (prototyp exclOn/exclTxt, ř. 4346–4347)
	const offBoxes = Object.keys(m.adm.ai)
		.filter((k) => m.adm.ai[k] === "off")
		.map((k) => MB[k]?.short ?? k);
	const exclOn = !!a && offBoxes.length > 0;

	return (
		<div
			data-esc-layer
			onClick={close}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 74,
				background: "rgba(23,40,63,.32)",
				animation: "wFade .12s ease",
			}}
		>
			<div
				data-screen-label="Ask Watson"
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "fixed",
					top: 84,
					left: "50%",
					transform: "translateX(-50%)",
					zIndex: 76,
					width: "min(600px, 94vw)",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "var(--shadow)",
					animation: "wPop .14s ease",
					overflow: "hidden",
				}}
			>
				{/* vstupní řádek (prototyp ř. 2133–2137) */}
				<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--line)" }}>
					<WBadge size={18} />
					<input
						ref={inputRef}
						value={q}
						onChange={(e) => setQ(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") send();
						}}
						placeholder="Zeptej se, nebo přikaž… „kolik zbývá za nájem?“ · „napiš drafty na posledních 10 mailů“"
						style={{
							flex: 1,
							minWidth: 0,
							border: "none",
							background: "transparent",
							outline: "none",
							fontFamily: "var(--w-font-body)",
							fontSize: 14,
							color: "var(--ink)",
						}}
					/>
					<span onClick={send} data-primary style={{ fontSize: 11.5, padding: "6px 13px", flex: "none", display: "inline-flex" }}>
						Zeptat se
					</span>
				</div>

				{/* přemýšlí — skeleton (prototyp ř. 2139–2147) */}
				{busy && (
					<div style={{ padding: "13px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
						<WBadge />
						<div style={{ flex: 1 }}>
							<span data-sk style={{ display: "block", height: 11, width: "85%" }} />
							<span data-sk style={{ display: "block", height: 11, width: "60%", marginTop: 7 }} />
						</div>
					</div>
				)}

				{/* odpověď + zdroje (prototyp ř. 2149–2166) */}
				{!!a && (
					<>
						<div style={{ padding: "13px 16px 6px", display: "flex", gap: 10 }}>
							<WBadge />
							<div style={{ fontFamily: "var(--w-font-body)", fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>
								{a.text}
							</div>
						</div>
						{exclOn && (
							<div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 16px 8px 43px", flexWrap: "wrap" }}>
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 9.5, color: "var(--ink-3)" }}>
									AI nevidí do: {offBoxes.join(", ")} (vypnutá per schránka) — fulltext ⌘K prohledává i je.
								</span>
								<span
									onClick={() => {
										// „Hledat všude" (prototyp goSearch) — zavře Ask a otevře
										// fulltext přes zkratku ⌘K, kterou poslouchá MailScreen.
										close();
										window.dispatchEvent(
											new KeyboardEvent("keydown", { key: "k", metaKey: true }),
										);
									}}
									style={{ fontFamily: "var(--w-font-display)", fontWeight: 600, fontSize: 10.5, color: "var(--brass-text)", cursor: "pointer" }}
								>
									Hledat všude →
								</span>
							</div>
						)}
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "4px 16px 13px 43px" }}>
							{a.src.map((sr) => (
								<span
									key={sr.l}
									onClick={() => openSrc(sr)}
									data-oneclick
									style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--w-font-display)", fontWeight: 600, fontSize: 11, padding: "4px 11px", borderRadius: 999 }}
								>
									<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
										<rect x="3.5" y="5" width="17" height="14" rx="1.6" />
										<path d="M4.2 6.4 L12 12.6 L19.8 6.4" />
									</svg>
									{sr.l}
								</span>
							))}
						</div>
					</>
				)}

				{/* patička — hranice oprávnění (prototyp ř. 2167) */}
				<div style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)", padding: "9px 16px", borderTop: "1px solid var(--line)", background: "var(--panel-2)" }}>
					Watson odpovídá jen z pošty, kam máš přístup — osobní schránka je mimo.
					Odpověď odkazuje na zdroj. Příkazy („napiš drafty…“) vytvoří jen návrhy ke
					schválení — odesíláš vždy ty.
				</div>
			</div>
		</div>
	);
}
