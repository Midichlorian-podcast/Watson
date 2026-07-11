/**
 * Mail — výběr podpisu composeru (vzor Spark): tlačítko „Podpis" + popover
 * se seznamem vytvořených podpisů (SIGS). Volba se drží per identita
 * (id schránky / "osobni") a persistuje (watson-mail.sig). Zvolený podpis
 * kreslí composer jako blok na konci mailu (SigBlock) — do těla se nevpisuje,
 * při odeslání se k němu přidá.
 */
import { useEffect, useRef, useState } from "react";
import { SIGS } from "./data";
import { useMail } from "./state";

/** Id zvoleného podpisu pro identitu — výchozí: osobní „krátký", týmové „plný". */
const sigIdOf = (sigChoice: Record<string, string>, mb: string): string =>
	sigChoice[mb] ?? (mb === "osobni" ? "kratky" : "plny");

/** Řádky zvoleného podpisu pro identitu (prázdné pole = bez podpisu). */
export const sigBody = (m: { sigChoice: Record<string, string> }, mb: string): string[] =>
	SIGS.find((s) => s.id === sigIdOf(m.sigChoice, mb))?.body ?? [];

const CheckSvg = () => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 14 14"
		fill="none"
		style={{ color: "var(--brass-text)", flex: "none" }}
		aria-hidden
	>
		<path
			d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

/** Blok zvoleného podpisu na konci mailu — kreslí ho composer pod editorem. */
export function SigBlock({ mb }: { mb: string }) {
	const m = useMail();
	const body = sigBody(m, mb);
	if (!body.length) return null;
	return (
		<div
			style={{
				borderTop: "1px dashed var(--line)",
				marginTop: 8,
				paddingTop: 7,
				fontFamily: "var(--w-font-body)",
				fontSize: 12,
				color: "var(--ink-2)",
				lineHeight: 1.55,
			}}
		>
			{body.map((l, i) => (
				<div key={l} style={i === 0 ? { fontWeight: 600 } : undefined}>
					{l}
				</div>
			))}
		</div>
	);
}

/** Tlačítko „Podpis" s popoverem výběru (vzor popoveru Šablony v NewMessage). */
export function SigPicker({ mb }: { mb: string }) {
	const m = useMail();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const cur = sigIdOf(m.sigChoice, mb);

	// klik mimo popover ho zavře (vzor Šablony popover)
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [open]);

	return (
		<div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
			<span
				onClick={() => setOpen((v) => !v)}
				data-ghost
				title="Podpis na konci mailu — vyber z vytvořených podpisů"
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 5,
					fontSize: 11,
					padding: "7px 12px",
				}}
			>
				<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
					<path
						d="M2 10.6 C3.4 7.2 4.7 4.4 5.7 4.7 C6.9 5.1 4.9 10.3 6.1 10.5 C7.1 10.7 7.4 8.4 8.3 8.5 C9.1 8.6 9 10.2 9.9 10.2 C10.6 10.2 11.2 9.6 12 9.6"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinecap="round"
					/>
				</svg>
				Podpis
			</span>
			{open && (
				<div
					style={{
						position: "absolute",
						bottom: "calc(100% + 6px)",
						left: 0,
						zIndex: 52,
						width: 232,
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
						Podpis
					</div>
					{SIGS.map((s) => (
						<div
							key={s.id}
							onClick={() => {
								m.setSigChoice(mb, s.id);
								setOpen(false);
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>{s.n}</span>
							{cur === s.id && <CheckSvg />}
						</div>
					))}
					<div
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 10,
							color: "var(--ink-3)",
							padding: "6px 10px 5px",
							borderTop: "1px solid var(--line)",
							marginTop: 4,
						}}
					>
						Podpis se přidá na konec mailu — volba se pamatuje per identita.
					</div>
				</div>
			)}
		</div>
	);
}
