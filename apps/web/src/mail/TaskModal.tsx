/**
 * Mail — Email → úkol, plný mini-formulář (Modul 10; prototyp taskMV,
 * markup ř. 1962–2038 + logika ř. 3087–3127, otevření makeTask ř. 3888).
 * Pole dle handoff zadání: Název (z předmětu), Popis (AI shrnutí t.sum),
 * Priorita P1–P4, Termín (date input), Projekt VÝHRADNĚ z m.bridge.projects
 * (audit L-19: osobní vlákno smí jen do osobních projektů), Poznámka.
 * Vytvoření jde přes m.bridge.onCreateTask — payload už tato pole podporuje.
 */
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { showToast } from "../lib/toast";
import type { MailThread } from "./data";
import { useMail } from "./state";

const lbl: CSSProperties = {
	fontFamily: "var(--w-font-mono)",
	fontSize: 9.5,
	letterSpacing: ".06em",
	color: "var(--ink-3)",
	margin: "11px 0 4px",
};

const inputBox: CSSProperties = {
	width: "100%",
	boxSizing: "border-box",
	border: "1px solid var(--line)",
	background: "var(--panel-2)",
	borderRadius: 9,
	padding: "8px 11px",
	fontFamily: "var(--w-font-body)",
	fontSize: 12,
	color: "var(--ink)",
	lineHeight: 1.5,
	outline: "none",
};

/** Dnešek/zítřek jako YYYY-MM-DD pro <input type="date"> (předvyplnění z urgence). */
const isoPlusDays = (days: number): string => {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
};

export function TaskModal({ t, onClose }: { t: MailThread; onClose: () => void }) {
	const m = useMail();
	const e = m.eff(t);
	const flag = e.flag;
	const [title, setTitle] = useState(t.subj);
	// Popis = AI shrnutí vlákna, když existuje (prototyp desc: t.sum || t.snip)
	const [desc, setDesc] = useState(t.sum ?? t.snip);
	const [prio, setPrio] = useState(
		flag === "p1" || flag === "p2" || flag === "p3" || flag === "p4" ? flag : "p3",
	);
	// termín předvyplněný z urgence: P1 dnes, P2 zítra (prototyp term z e.flag)
	const [due, setDue] = useState(
		flag === "p1" ? isoPlusDays(0) : flag === "p2" ? isoPlusDays(1) : "",
	);
	const [projId, setProjId] = useState<string | null>(null);
	const [comment, setComment] = useState("");

	// Projekty VÝHRADNĚ z mostu do aplikace; osobní vlákno → jen osobní projekty (L-19)
	const projects = useMemo(() => {
		const all = m.bridge.projects ?? [];
		return t.personal ? all.filter((p) => p.personal) : all;
	}, [m.bridge.projects, t.personal]);

	// Esc zavírá JEN modal (vzor NewMessage) — bez data-esc-layer by globální Esc
	// v MailScreen zavřel i vlákno/výběr pod ním (audit S10)
	useEffect(() => {
		const h = (ev: globalThis.KeyboardEvent) => {
			if (ev.key === "Escape") onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [onClose]);

	const create = () => {
		const name = title.trim() || t.subj;
		if (!m.bridge.onCreateTask) {
			showToast("Mail demo běží bez aplikace — úkol se nevytvoří.");
			onClose();
			return;
		}
		// Poznámka zadavatele jde do popisu pod AI shrnutí (payload má jedno pole description)
		const description = [desc.trim(), comment.trim() ? `Poznámka: ${comment.trim()}` : ""]
			.filter(Boolean)
			.join("\n\n");
		void m.bridge.onCreateTask({
			id: crypto.randomUUID(),
			name,
			mailTh: t.id,
			mailLabel: t.subj,
			priority: prio === "p1" ? 1 : prio === "p2" ? 2 : prio === "p3" ? 3 : 4,
			description: description || undefined,
			// null = vymazaný termín → úkol BEZ termínu; undefined by v bridge
			// spadlo na dnešek (audit S8)
			dueISO: due || null,
			projectId: projId ?? undefined,
		});
		// toast hlásí bridge (s akcí Otevřít) — druhý odsud by se dubloval (S8)
		onClose();
	};

	return (
		<>
			<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
				onClick={onClose}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 79,
					background: "rgba(23,40,63,.32)",
					animation: "wFade .12s ease",
				}}
			/>
			<div
				data-esc-layer
				data-screen-label="Email → úkol"
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%,-50%)",
					zIndex: 80,
					width: "min(460px, 94vw)",
					maxHeight: "88vh",
					overflow: "auto",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "var(--shadow)",
					animation: "wPop .14s ease",
					padding: "17px 18px 15px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 800,
							fontSize: 14.5,
							color: "var(--ink)",
							flex: 1,
						}}
					>
						Udělat z mailu úkol
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						onClick={onClose}
						style={{ fontSize: 16, lineHeight: 1, color: "var(--ink-3)", cursor: "pointer" }}
					>
						×
					</span>
				</div>
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 11,
						color: "var(--ink-3)",
						marginTop: 2,
					}}
				>
					Úkol dostane odkaz zpět na vlákno, přílohy a tvůj komentář. Stav se provazuje obousměrně.
				</div>

				<div style={{ ...lbl, marginTop: 13 }}>NÁZEV</div>
				<input
					value={title}
					onChange={(ev) => setTitle(ev.target.value)}
					style={{
						...inputBox,
						fontFamily: "var(--w-font-display)",
						fontWeight: 600,
						fontSize: 13,
					}}
				/>

				<div style={lbl}>
					POPIS {t.sum && <span style={{ color: "var(--brass-text)" }}>· AI shrnutí vlákna</span>}
				</div>
				<textarea
					value={desc}
					onChange={(ev) => setDesc(ev.target.value)}
					rows={2}
					style={{ ...inputBox, color: "var(--ink-2)", resize: "none" }}
				/>

				<div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 11 }}>
					<div style={{ flex: "none" }}>
						<div style={{ ...lbl, margin: "0 0 5px" }}>PRIORITA</div>
						<div style={{ display: "flex", gap: 4 }}>
							{(["p1", "p2", "p3", "p4"] as const).map((p) => (
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									key={p}
									onClick={() => setPrio(p)}
									data-statepill
									data-on={prio === p || undefined}
									style={{
										fontFamily: "var(--w-font-mono)",
										fontWeight: 600,
										fontSize: 10,
										padding: "3px 8px",
										borderRadius: 999,
									}}
								>
									{p.toUpperCase()}
								</span>
							))}
						</div>
					</div>
					<div>
						<div style={{ ...lbl, margin: "0 0 5px" }}>
							TERMÍN <span style={{ opacity: 0.7 }}>· z urgence</span>
						</div>
						<input
							type="date"
							value={due}
							onChange={(ev) => setDue(ev.target.value)}
							style={{
								...inputBox,
								width: "auto",
								fontFamily: "var(--w-font-mono)",
								fontSize: 11,
								padding: "5px 9px",
							}}
						/>
					</div>
				</div>

				<div style={{ ...lbl, margin: "11px 0 5px" }}>
					PROJEKT{" "}
					{t.personal && (
						<span style={{ opacity: 0.7 }}>· osobní vlákno → jen osobní projekty</span>
					)}
				</div>
				{projects.length > 0 ? (
					<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => setProjId(null)}
							data-statepill
							data-on={projId === null || undefined}
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 10.5,
								padding: "3px 10px",
								borderRadius: 999,
							}}
						>
							Bez projektu
						</span>
						{projects.map((p) => (
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								key={p.id}
								onClick={() => setProjId(p.id)}
								data-statepill
								data-on={projId === p.id || undefined}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 10.5,
									padding: "3px 10px",
									borderRadius: 999,
								}}
							>
								{p.color && (
									<span
										style={{
											width: 8,
											height: 8,
											borderRadius: "50%",
											background: p.color,
											flex: "none",
										}}
									/>
								)}
								{p.name}
							</span>
						))}
					</div>
				) : (
					<div style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-3)" }}>
						{t.personal
							? "Žádný osobní projekt — úkol vznikne bez projektu (týmové projekty tu nenabízíme, L-19)."
							: "Projekty dodává aplikace (bridge) — úkol vznikne bez projektu."}
					</div>
				)}

				<div style={lbl}>KOMENTÁŘ ZADAVATELE</div>
				<textarea
					value={comment}
					onChange={(ev) => setComment(ev.target.value)}
					rows={2}
					placeholder="Instrukce pro přiřazeného — např. „zkontroluj zápočet přeplatku, pak zaplať z provozního účtu“"
					style={{ ...inputBox, resize: "none" }}
				/>

				<div style={{ display: "flex", gap: 7, marginTop: 13, justifyContent: "flex-end" }}>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} data-ghost onClick={onClose} style={{ fontSize: 11.5, padding: "7px 13px" }}>
						Zrušit
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} data-primary onClick={create} style={{ fontSize: 11.5, padding: "7px 15px" }}>
						Vytvořit úkol
					</span>
				</div>
			</div>
		</>
	);
}
