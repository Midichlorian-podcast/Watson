/**
 * Plovoucí composer + chipy konceptů (prototyp ř. 2052–2087) — paralelní psaní
 * vedle procházení pošty. Chipy vpravo dole = všechny neprázdné koncepty mimo
 * právě otevřené okno; okno má hlavičku (schránka, subjekt → přejít na vlákno,
 * minimalizace, zavření), zamčený From řádek, textareu vázanou na drafts a
 * Odeslat přes checkSend (kolizní hlídka i hlídání přílohy platí i tady).
 */
import { useEffect } from "react";
import { MB } from "./data";
import { MailDemoBanner } from "./DemoBanner";
import { useMail } from "./state";

export function FloatComposer() {
	const m = useMail();
	const fc = m.float && !m.float.min ? m.float : null;
	const fcThread = fc ? m.threads.find((t) => t.id === fc.id) : null;

	// Esc zavře plovoucí okno (koncept zůstane u vlákna). Dřív FloatComposer nebyl
	// esc-layer ani neměl vlastní Esc, takže globální handler zavřel vlákno POD ním
	// místo composeru (audit MED FloatComposer.tsx:188).
	const fcId = fc?.id;
	useEffect(() => {
		if (!fcId) return;
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				m.setFloat(null);
			}
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [fcId, m.setFloat]);

	// chipy: neprázdné koncepty mimo otevřené plovoucí okno (prototyp chips)
	const chips = Object.entries(m.drafts)
		.filter(([id, d]) => !!d.text?.trim() && id !== (fc?.id ?? ""))
		.map(([id]) => {
			const t = m.threads.find((x) => x.id === id);
			return t ? { id, mb: t.mb ?? "osobni", label: t.subj } : null;
		})
		.filter((x): x is NonNullable<typeof x> => !!x);

	if (!chips.length && !fcThread) return null;

	return (
		<div
			style={{
				position: "fixed",
				right: 20,
				bottom: 20,
				zIndex: 58,
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: 8,
				maxWidth: "min(560px, 92vw)",
			}}
		>
			{chips.map((ch) => (
				<div
					key={ch.id}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						background: "var(--panel)",
						border: "1px solid var(--line)",
						borderRadius: 12,
						padding: "8px 11px",
						boxShadow: "var(--shadow)",
						animation: "wUp .18s ease",
						maxWidth: "min(400px, 88vw)",
					}}
				>
					<span
						data-mbdot={ch.mb}
						style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }}
					/>
					<svg
						width="12"
						height="12"
						viewBox="0 0 14 14"
						fill="none"
						style={{ color: "var(--brass-text)", flex: "none" }}
						aria-hidden
					>
						<path
							d="M2 12 L2.8 9.2 L9.8 2.2 A1.1 1.1 0 0 1 11.4 2.2 L11.8 2.6 A1.1 1.1 0 0 1 11.8 4.2 L4.8 11.2 Z"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinejoin="round"
						/>
					</svg>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						onClick={() => m.setFloat({ id: ch.id, min: false })}
						title="Otevřít rozepsaný koncept v plovoucím okně"
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 600,
							fontSize: 11.5,
							color: "var(--ink)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							cursor: "pointer",
							flex: 1,
							minWidth: 0,
						}}
					>
						{ch.label}
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						onClick={() => m.setDraft(ch.id, "")}
						title="Zahodit koncept"
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
			))}

			{fcThread && (
				<div
					data-esc-layer
					style={{
						width: "min(560px, 92vw)",
						maxHeight: "min(540px, 76vh)",
						background: "var(--panel)",
						border: "1px solid var(--line)",
						borderRadius: 14,
						boxShadow: "var(--shadow)",
						animation: "wPop .15s ease",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					{/* CC-P0-08 — plovoucí composer nesmí vypadat jako reálné odesílání */}
					<MailDemoBanner compact />
					<div
						style={{
							flex: "none",
							display: "flex",
							alignItems: "center",
							gap: 9,
							padding: "10px 13px",
							borderBottom: "1px solid var(--line)",
							background: "var(--panel-2)",
						}}
					>
						<span
							data-mbdot={fcThread.mb ?? "osobni"}
							style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }}
						/>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								m.openThread(fcThread.id);
								m.setFloat(null);
							}}
							title="Přejít na vlákno"
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 12.5,
								color: "var(--ink)",
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								cursor: "pointer",
							}}
						>
							{fcThread.subj}
						</span>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => m.setFloat({ id: fcThread.id, min: true })}
							title="Minimalizovat — koncept zůstane po ruce"
							data-rowbtn
						>
							<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
								<line
									x1="2.5"
									y1="9.5"
									x2="9.5"
									y2="9.5"
									stroke="currentColor"
									strokeWidth="1.6"
									strokeLinecap="round"
								/>
							</svg>
						</span>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => m.setFloat(null)}
							title="Zavřít okno — koncept se uloží k vláknu"
							data-rowbtn
							style={{ fontSize: 15, lineHeight: 1 }}
						>
							×
						</span>
					</div>

					<div
						style={{
							flex: "none",
							display: "flex",
							alignItems: "center",
							gap: 6,
							flexWrap: "wrap",
							padding: "8px 13px 0",
						}}
					>
						<svg
							width="10"
							height="10"
							viewBox="0 0 12 12"
							fill="none"
							style={{ color: "var(--ink-3)", flex: "none" }}
							aria-hidden
						>
							<rect
								x="2.2"
								y="5"
								width="7.6"
								height="5.2"
								rx="1.2"
								stroke="currentColor"
								strokeWidth="1.2"
							/>
							<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" stroke="currentColor" strokeWidth="1.2" />
						</svg>
						<span style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-3)" }}>
							Odpovídáš jako{" "}
							<span style={{ fontWeight: 600, color: "var(--ink-2)" }}>Adam Košír</span> za
						</span>
						<span
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 10,
								color: "var(--ink-2)",
								background: "var(--panel-2)",
								border: "1px solid var(--line)",
								borderRadius: 6,
								padding: "1px 6px",
							}}
						>
							{fcThread.mb ? (MB[fcThread.mb]?.addr ?? "") : "kosir.adam@gmail.com"}
						</span>
						<span
							style={{
								marginLeft: "auto",
								fontFamily: "var(--w-font-mono)",
								fontSize: 9,
								color: "var(--ink-3)",
							}}
						>
							From svázané s vláknem
						</span>
					</div>

					<textarea
						value={m.drafts[fcThread.id]?.text ?? ""}
						onChange={(e) => m.setDraft(fcThread.id, e.target.value)}
						onKeyDown={(e) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								// zavři okno JEN když se reálně odeslalo — jinak by kolizní/přílohová
								// pojistka jen probliknutím zavřela okno (audit MED FloatComposer.tsx:218)
								if (m.checkSend(fcThread, false)) m.setFloat(null);
							}
						}}
						rows={8}
						placeholder="Piš — a klidně si mezitím projdi ostatní maily…"
						style={{
							flex: 1,
							minHeight: 120,
							margin: "9px 13px 0",
							border: "1px solid var(--line)",
							background: "var(--panel-2)",
							borderRadius: 11,
							padding: "10px 12px",
							fontFamily: "var(--w-font-body)",
							fontSize: 13,
							color: "var(--ink)",
							lineHeight: 1.6,
							outline: "none",
							resize: "none",
						}}
					/>

					<div
						style={{
							flex: "none",
							display: "flex",
							gap: 7,
							alignItems: "center",
							padding: "9px 13px 12px",
						}}
					>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								// zavři okno JEN po skutečném odeslání (audit MED FloatComposer.tsx:218)
								if (m.checkSend(fcThread, false)) m.setFloat(null);
							}}
							data-primary
							style={{ fontSize: 11.5, padding: "7px 14px" }}
						>
							Odeslat
						</span>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => m.attach(fcThread.id, "Podklady.pdf")}
							data-ghost
							title="Přiložit soubor"
							style={{
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								width: 29,
								height: 29,
								padding: 0,
							}}
						>
							<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
								<path
									d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
							</svg>
						</span>
						<span
							style={{
								marginLeft: "auto",
								fontFamily: "var(--w-font-mono)",
								fontSize: 9,
								color: "var(--ink-3)",
							}}
						>
							koncept se průběžně ukládá k vláknu
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
