/**
 * Karta osoby (Modul 15; prototyp markup ř. 1903–1946 + logika personV
 * ř. 3276–3303). Avatar + role, přístupy ke schránkám (ADM_SEED.acc přes
 * useMail().adm — úroveň 0/1/2), oblasti odpovědnosti (řídí AI směrování,
 * ne viditelnost) a offboarding s NÁSLEDKY předem (audit L-47: X přiřazených
 * vláken osiří → přeřadit, koncepty, VIP). Potvrzení je jen toast — demo
 * vrstva, přístupy se reálně nemění (matice v AdminScreen má vlastní cache).
 */
import { useEffect, useState } from "react";
import { showToast } from "../lib/toast";
import { MB, P } from "./data";
import { useMail } from "./state";

/** Labely úrovní přístupu (prototyp ROLE2, ř. 3275). */
const ROLE2 = ["bez přístupu", "člen", "správce"];

/** Oblasti odpovědnosti per osoba (prototyp AREAS, ř. 3276). */
const AREAS: Record<string, string[]> = {
	ad: ["provoz a finance", "pronájmy", "smlouvy"],
	ps: ["studio — rezervace", "platby a GoPay"],
	tm: ["projekty", "komunikace s lektory"],
	mh: ["granty a výzvy", "žádosti, vyúčtování"],
	fk: ["podcast — hosté", "natáčení a postprodukce"],
	js: ["kavárna", "objednávky zboží"],
};

/** Sekce label — mono kapitálky (prototyp ř. 1915/1923). */
const secLbl = {
	fontFamily: "var(--w-font-mono)",
	fontSize: 9.5,
	letterSpacing: ".06em",
	color: "var(--ink-3)",
} as const;

/** Skloňování počtu vláken pro následky (prototyp má napevno „přiřazená vlákna"). */
const vlaknaTxt = (n: number): string =>
	n === 1 ? "1 přiřazené vlákno" : n < 5 ? `${n} přiřazená vlákna` : `${n} přiřazených vláken`;

export function PersonCard({
	pid,
	onClose,
}: {
	pid: string | null;
	onClose: () => void;
}) {
	const m = useMail();
	const [offStage, setOffStage] = useState(false);

	// nová osoba = karta začíná bez rozbaleného offboardingu
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset vázaný na změnu pid
	useEffect(() => setOffStage(false), [pid]);

	// Esc zavírá (prototyp globální Escape ř. 2746)
	useEffect(() => {
		if (pid === null) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [pid, onClose]);

	const person = pid ? P[pid] : undefined;
	if (!pid || !person) return null;

	// počty: přiřazená vlákna (eff().owner) + rozepsané koncepty (prototyp offN, ř. 3288)
	const assigned = m.threads.filter(
		(t) => !t.personal && m.eff(t).owner === pid && !m.eff(t).closed,
	);
	// koncepty: seed vlákna-koncepty psaná osobou + živé koncepty na jejích vláknech
	const draftsN = m.threads.filter(
		(t) =>
			(t.draftF && t.msgs.some((msg) => msg.by === pid)) ||
			(!t.draftF && !!m.drafts[t.id]?.text?.trim() && m.eff(t).owner === pid),
	).length;

	// cíl přeřazení dle prototypu = Tereza; když odchází Tereza sama, přebírá admin
	const heirName = pid === "tm" ? "Adama Košíra" : "Terezu Malou";
	const heirShort = pid === "tm" ? "Adama" : "Terezu";

	return (
		<div
			data-esc-layer
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 79,
				animation: "wFade .12s ease",
			}}
		>
			<button
				type="button"
				aria-label="Zavřít kartu osoby"
				onClick={onClose}
				style={{ position: "absolute", inset: 0, border: 0, background: "rgba(23,40,63,.32)" }}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Karta osoby"
				data-screen-label="Karta osoby"
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%,-50%)",
					zIndex: 80,
					width: "min(420px, 94vw)",
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
				{/* hlavička — avatar, jméno, role (prototyp ř. 1907–1914) */}
				<div style={{ display: "flex", alignItems: "center", gap: 11 }}>
					<span
						data-av={person.av || undefined}
						style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--avatar-navy)", color: "#fff", fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
					>
						{person.ini}
					</span>
					<div style={{ flex: 1, minWidth: 0 }}>
						<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 14.5, color: "var(--ink)" }}>
							{person.n}
						</div>
						<div style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-3)" }}>
							{person.role}
						</div>
					</div>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						onClick={onClose}
						title="Zavřít (Esc)"
						style={{ fontSize: 16, lineHeight: 1, color: "var(--ink-3)", cursor: "pointer" }}
					>
						×
					</span>
				</div>

				{/* schránky s přístupem (prototyp ř. 1915–1922) */}
				<div style={{ ...secLbl, margin: "14px 0 5px" }}>SCHRÁNKY</div>
				{Object.entries(MB).map(([mbid, mb]) => {
					const v = m.adm.acc[mbid]?.[pid] ?? 0;
					return (
						<div key={mbid} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
							<span data-mbdot={mbid} style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }} />
							<span style={{ flex: 1, fontFamily: "var(--w-font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
								{mb.short}
							</span>
							<span data-accell data-v={String(v)} style={{ width: "auto", padding: "2px 10px", fontSize: 10, cursor: "default" }}>
								{ROLE2[v]}
							</span>
						</div>
					);
				})}

				{/* počty — přiřazená vlákna a rozepsané koncepty (zadání karty osoby) */}
				<div style={{ ...secLbl, margin: "13px 0 5px" }}>VYŘIZUJE</div>
				<div style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
					{vlaknaTxt(assigned.length)} ·{" "}
					{draftsN === 1 ? "1 rozepsaný koncept" : `${draftsN} rozepsané koncepty`}
				</div>

				{/* oblasti odpovědnosti (prototyp ř. 1923–1928) */}
				<div style={{ ...secLbl, margin: "13px 0 5px" }}>
					OBLASTI ODPOVĚDNOSTI <span style={{ opacity: 0.7 }}>· řídí AI směrování, ne viditelnost</span>
				</div>
				<div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
					{(AREAS[pid] ?? []).map((a) => (
						<span key={a} style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 11px" }}>
							{a}
						</span>
					))}
				</div>

				{/* následky offboardingu — vidíš PŘEDEM, co se stane (prototyp ř. 1929–1938, audit L-47) */}
				{offStage && (
					<div style={{ border: "1px solid var(--ink-3)", borderRadius: 11, padding: "10px 13px", marginTop: 14 }}>
						<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 12.5, color: "var(--ink)" }}>
							Následky offboardingu
						</div>
						<div style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 4 }}>
							· <strong>{vlaknaTxt(assigned.length)}</strong> → přeřadí se na {heirName}
							<br />
							· sdílené koncepty zůstanou týmu, naplánovaná odeslání se pozastaví
							<br />
							· granty se odeberou, lokální kopie pošty se smažou, VIP záznamy zmizí
						</div>
						<div style={{ display: "flex", gap: 7, marginTop: 10, justifyContent: "flex-end" }}>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} data-ghost onClick={() => setOffStage(false)} style={{ fontSize: 11, padding: "6px 12px" }}>
								Zpět
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-primary
								onClick={() => {
									// demo — jen toast (prototyp navíc přepisoval acc + ov, ř. 3292–3300)
									showToast(
										`Offboarding hotov: granty odebrány, vlákna přeřazena na ${heirShort}, lokální kopie smazány. Nic neosiřelo. (demo)`,
									);
									onClose();
								}}
								style={{ fontSize: 11, padding: "6px 13px", display: "inline-flex" }}
							>
								Provést offboarding
							</span>
						</div>
					</div>
				)}

				{/* patička — vstup do offboardingu (prototyp ř. 1940–1943) */}
				<div style={{ display: "flex", gap: 7, marginTop: 15, justifyContent: "space-between", alignItems: "center" }}>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => setOffStage(true)}
						style={{ fontSize: 11, padding: "6px 12px", color: "var(--overdue)" }}
					>
						Offboarding — odebrat všechny přístupy…
					</span>
					<span style={{ fontFamily: "var(--w-font-body)", fontSize: 10, color: "var(--ink-3)" }}>
						role měníš klikáním v matici
					</span>
				</div>
			</div>
		</div>
	);
}
