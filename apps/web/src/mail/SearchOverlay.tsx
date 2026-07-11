/**
 * Mail — hledání ⌘K / „/" s operátory (Modul 14; prototyp markup ř. 2088–2129
 * + logika soVals ř. 4233–4274). Operátory from:, schranka:/mailbox:,
 * has:priloha/attachment, is:neprectene/unread + fulltext přes předmět, snippet,
 * odesílatele i těla zpráv. Max 8 výsledků, Enter otevře první.
 * Režim „ve vlákně" (soTh, prototyp ř. 2097–2102): ⌘F / „Hledat ve vlákně"
 * nastaví m.soTh — hledá se pak JEN v tom vlákně (vč. těl zpráv), chip ho zruší.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MailThread } from "./data";
import { useMail } from "./state";

interface SearchHit {
	id: string;
	ini: string;
	from: string;
	subj: string;
	snip: string;
	mb: string;
	time: string;
}

export function SearchOverlay({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const m = useMail();
	const [q, setQ] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const close = () => {
		setQ("");
		m.setSoTh(null); // zavření ruší i zúžení na vlákno (prototyp so.close)
		onClose();
	};

	// Esc zavírá (vlastní listener) + autofocus po otevření
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") {
				setQ("");
				m.setSoTh(null);
				onClose();
			}
		};
		document.addEventListener("keydown", h);
		inputRef.current?.focus();
		return () => document.removeEventListener("keydown", h);
	}, [open, onClose, m.setSoTh]);

	/** Parsování operátorů + filtr (prototyp soVals, ř. 4237–4262). */
	const results = useMemo<SearchHit[]>(() => {
		const query = q.trim();
		if (!query) return [];
		const toks = query.toLowerCase().split(/\s+/);
		const terms: string[] = [];
		const ops = {
			from: null as string | null,
			mb: null as string | null,
			att: false,
			unread: false,
		};
		for (const tk of toks) {
			if (tk.startsWith("from:")) ops.from = tk.slice(5);
			else if (tk.startsWith("schranka:") || tk.startsWith("mailbox:"))
				ops.mb = tk.split(":")[1] ?? "";
			else if (tk === "has:priloha" || tk === "has:attachment") ops.att = true;
			else if (tk === "is:neprectene" || tk === "is:unread") ops.unread = true;
			else terms.push(tk);
		}
		const bodyOf = (t: MailThread): string =>
			t.msgs
				.map((msg) => (msg.body ?? []).join(" "))
				.concat((m.sentX[t.id] ?? []).map((msg) => msg.body.join(" ")))
				.join(" ");
		return m.threads
			.filter((t) => {
				const e = m.eff(t);
				// režim „ve vlákně" — hledá se JEN v jednom vlákně (prototyp soVals, ř. 4250)
				if (m.soTh && t.id !== m.soTh) return false;
				if (e.trash) return false;
				if (ops.from && !`${t.from.n} ${t.from.addr}`.toLowerCase().includes(ops.from))
					return false;
				if (ops.mb && !(t.personal ? "osobni" : (t.mb ?? "")).includes(ops.mb))
					return false;
				if (ops.att && !t.att) return false;
				if (ops.unread && !(t.unread && !e.read)) return false;
				// fulltext: předmět + snippet + odesílatel + těla zpráv (vč. odeslaných)
				const hay =
					`${t.subj} ${t.snip} ${t.from.n} ${t.from.addr} ${bodyOf(t)}`.toLowerCase();
				return terms.every((x) => hay.includes(x));
			})
			.slice(0, 8)
			.map((t) => ({
				id: t.id,
				ini: t.from.ini,
				from: t.from.n,
				subj: t.subj,
				snip: m.ovOf(t.id).snip ?? t.snip,
				mb: t.personal ? "osobni" : (t.mb ?? "osobni"),
				time: m.ovOf(t.id).time ?? t.time,
			}));
	}, [q, m]);

	if (!open) return null;

	const openHit = (id: string) => {
		close();
		m.openThread(id);
	};
	/** Chip operátoru — klik vloží operátor do dotazu (prototyp addOp, ř. 4264). */
	const addOp = (op: string) => {
		setQ((prev) => (prev ? `${prev.replace(/\s+$/, "")} ` : "") + op);
		inputRef.current?.focus();
	};

	const none = !!q.trim() && results.length === 0;
	const empty = !q.trim();
	const OPS: { l: string; hint: string }[] = [
		{ l: "from:", hint: "odesílatel — jméno nebo adresa" },
		{ l: "schranka:granty", hint: "jen jedna schránka (i mailbox:)" },
		{ l: "has:priloha", hint: "jen s přílohou" },
		{ l: "is:neprectene", hint: "jen nepřečtené" },
	];

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
				data-screen-label="Hledání"
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "fixed",
					top: 84,
					left: "50%",
					transform: "translateX(-50%)",
					zIndex: 75,
					width: "min(640px, 94vw)",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "var(--shadow)",
					animation: "wPop .14s ease",
					overflow: "hidden",
				}}
			>
				{/* vstupní řádek (ř. 2092–2096) */}
				<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--line)" }}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ color: "var(--ink-3)", flex: "none" }} aria-hidden>
						<circle cx="10.5" cy="10.5" r="6" />
						<line x1="15" y1="15" x2="20" y2="20" />
					</svg>
					<input
						ref={inputRef}
						value={q}
						onChange={(e) => setQ(e.target.value)}
						onKeyDown={(e) => {
							// Enter otevře první výsledek
							if (e.key === "Enter" && results[0]) openHit(results[0].id);
						}}
						// biome-ignore lint/a11y/noAutofocus: command-palette vzor — fokus je smysl overlaye
						autoFocus
						placeholder="Hledej v poště… zkus: faktura · from:horak · has:priloha"
						style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontFamily: "var(--w-font-body)", fontSize: 14, color: "var(--ink)" }}
					/>
					<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 9.5, color: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 5, padding: "1px 6px", flex: "none" }}>
						Esc
					</span>
				</div>

				{/* chip „ve vlákně" — hledání zúžené na jedno vlákno (ř. 2097–2102) */}
				{m.soTh && (
					<div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px 0" }}>
						<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-2)", background: "var(--brass-soft)", borderRadius: 999, padding: "3px 6px 3px 10px" }}>
							ve vlákně: {m.threads.find((x) => x.id === m.soTh)?.subj ?? ""}
							<span
								onClick={() => m.setSoTh(null)}
								title="Zrušit zúžení — hledat v celé poště"
								style={{ cursor: "pointer", opacity: 0.7, fontSize: 12, lineHeight: 1 }}
							>
								×
							</span>
						</span>
						<span style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)" }}>
							hledá se i v textu zpráv tohohle vlákna
						</span>
					</div>
				)}

				{/* prázdný stav — rada s operátory (ř. 2103–2110) */}
				{empty && (
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "11px 16px" }}>
						<span style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-3)" }}>
							Operátory:
						</span>
						{OPS.map((o) => (
							<span
								key={o.l}
								onClick={() => addOp(o.l)}
								data-oneclick
								title={o.hint}
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, padding: "3px 9px", borderRadius: 999 }}
							>
								{o.l}
							</span>
						))}
					</div>
				)}

				{/* výsledky — max 8, řádek mbdot + from + subj + čas (ř. 2111–2123) */}
				{results.map((r) => (
					<div
						key={r.id}
						onClick={() => openHit(r.id)}
						style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 16px", cursor: "pointer", borderTop: "1px solid var(--line)" }}
					>
						<span
							data-av="ext"
							style={{
								width: 28,
								height: 28,
								borderRadius: "50%",
								color: "#fff",
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 10,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flex: "none",
								marginTop: 1,
								background: "var(--avatar-navy)",
							}}
						>
							{r.ini}
						</span>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
								<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 600, fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{r.subj}
								</span>
								<span style={{ flex: 1 }} />
								<span data-mbdot={r.mb} style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }} />
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)", flex: "none" }}>
									{r.time}
								</span>
							</div>
							<div style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{r.from} — {r.snip}
							</div>
						</div>
					</div>
				))}

				{/* nic nenalezeno (ř. 2124–2126) */}
				{none && (
					<div style={{ padding: "18px 16px", fontFamily: "var(--w-font-body)", fontSize: 12, color: "var(--ink-3)" }}>
						Nic nenalezeno — hledá se jen v poště, kam máš přístup. Osobní schránka je mimo týmové hledání.
					</div>
				)}
			</div>
		</div>
	);
}
