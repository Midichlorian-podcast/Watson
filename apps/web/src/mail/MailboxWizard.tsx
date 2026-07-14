/**
 * Průvodce připojením schránky (Modul 15; prototyp markup ř. 1840–1902 +
 * logika wizV ř. 3239–3274). Kroky: 1) poskytovatel (Gmail / M365 / IMAP+SMTP),
 * 2) přihlášení — OAuth demo „rovnou připojeno", nebo IMAP formulář s testem:
 * první test s portem ≠ 993 selže LIDSKOU hláškou (audit A-01 — řeč ne-vývojáře,
 * konkrétní rada, heslo se neodeslalo), po opravě portu uspěje, 3) lidé
 * s přístupem, 4) hotovo — poctivý závěr, že reálné připojení přijde s mail
 * backendem (M1). Oproti prototypu (3 kroky + toast) přidán krok 4 a progress
 * tečky dle zadání; heslo je jen demo pole, nikam se neposílá.
 */
import { useEffect, useState } from "react";
import { showToast } from "../lib/toast";
import { useFocusTrap } from "../lib/useFocusTrap";
import { P } from "./data";

type Provider = "gmail" | "m365" | "imap";

/** Karty poskytovatelů (prototyp wizV.provs, ř. 3243). */
const PROVS: { id: Provider; l: string }[] = [
	{ id: "gmail", l: "Gmail / Workspace" },
	{ id: "m365", l: "Microsoft 365" },
	{ id: "imap", l: "IMAP + SMTP" },
];

/** Pořadí lidí dle matice přístupů (prototyp PIDS). */
const PIDS = ["ad", "ps", "tm", "mh", "fk", "js"];

const STEP_L = ["poskytovatel", "přihlášení", "přístupy", "hotovo"];

/** Vstup formuláře IMAP — vzhled dle prototypu ř. 1873–1878. */
const inputStyle = {
	border: "1px solid var(--line)",
	background: "var(--panel-2)",
	borderRadius: 9,
	padding: "8px 11px",
	fontFamily: "var(--w-font-mono)",
	fontSize: 11,
	color: "var(--ink)",
	outline: "none",
	minWidth: 0,
} as const;

const hint = {
	fontFamily: "var(--w-font-body)",
	fontSize: 11.5,
	color: "var(--ink-3)",
	margin: "10px 0 8px",
} as const;

export function MailboxWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [step, setStep] = useState(1);
	const [prov, setProv] = useState<Provider>("gmail");
	const [auth, setAuth] = useState(false);
	const [tested, setTested] = useState<"fail" | "ok" | null>(null);
	// port 143 jako výchozí — první test tak předvede lidskou chybovou hlášku (A-01)
	const [port, setPort] = useState("143");
	const [failPort, setFailPort] = useState("143");
	const [ppl, setPpl] = useState<Record<string, boolean>>({ ad: true, ps: true });
	// a11y: fokus dovnitř modalu + cyklení Tab uvnitř + návrat po zavření (audit MED MailboxWizard.tsx:120)
	const trapRef = useFocusTrap<HTMLDivElement>(open);

	// scroll-lock pozadí po dobu otevření modalu (audit MED MailboxWizard.tsx:120)
	useEffect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, [open]);

	// otevření = čistý průvodce (prototyp wizOpen, ř. 3304)
	useEffect(() => {
		if (!open) return;
		setStep(1);
		setProv("gmail");
		setAuth(false);
		setTested(null);
		setPort("143");
		setPpl({ ad: true, ps: true });
	}, [open]);

	// Esc zavírá (prototyp globální Escape ř. 2746)
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [open, onClose]);

	if (!open) return null;

	/** Test IMAP: port ≠ 993 → srozumitelné selhání; 993 → úspěch (zadání + A-01). */
	const doTest = () => {
		if (port.trim() !== "993") {
			setFailPort(port.trim() || "?");
			setTested("fail");
			showToast("Test selhal — hlášku píšeme řečí ne-vývojáře, s konkrétní radou");
			return;
		}
		setTested("ok");
		showToast("Simulace testu připojení — žádný server nebyl kontaktován");
	};

	// krok 2 = přihlášení; „Pokračovat" povol až po ověření (OAuth) / testu (IMAP)
	const canNext = step !== 2 || (prov === "imap" ? tested === "ok" : auth);

	const finish = () => {
		const n = PIDS.filter((pid) => ppl[pid]).length;
		showToast(
			`Simulace: schránka připojena jen v demu (nic se reálně nepřipojilo). Přístup dostalo ${n} lidí, zbytek ji neuvidí vůbec.`,
		);
		setStep(4);
	};

	return (
		<div
			data-esc-layer
			onClick={onClose}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 79,
				background: "rgba(23,40,63,.32)",
				animation: "wFade .12s ease",
			}}
		>
			<div
				ref={trapRef}
				tabIndex={-1}
				data-screen-label="Připojení schránky"
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%,-50%)",
					zIndex: 80,
					outline: "none",
					width: "min(440px, 94vw)",
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
				{/* hlavička s krokem (prototyp ř. 1844–1848) */}
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
						Připojit schránku
					</span>
					<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 9.5, color: "var(--ink-3)" }}>
						Krok {step} / 4 — {STEP_L[step - 1]}
					</span>
					<span
						onClick={onClose}
						title="Zavřít (Esc)"
						style={{ fontSize: 16, lineHeight: 1, color: "var(--ink-3)", cursor: "pointer" }}
					>
						×
					</span>
				</div>

				{/* krok 1 — poskytovatel (prototyp ř. 1849–1856) */}
				{step === 1 && (
					<>
						<div style={hint}>
							Odkud schránka je? Multi-doména i mix poskytovatelů je v pořádku.
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							{PROVS.map((p) => (
								<span
									key={p.id}
									data-statepill
									data-on={prov === p.id || undefined}
									onClick={() => {
										setProv(p.id);
										setAuth(false);
										setTested(null);
									}}
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 12,
										padding: "9px 13px",
										borderRadius: 11,
									}}
								>
									{p.l}
								</span>
							))}
						</div>
					</>
				)}

				{/* krok 2 — přihlášení: OAuth (prototyp ř. 1858–1866) */}
				{step === 2 && prov !== "imap" && (
					<>
						<div style={hint}>Přihlášení proběhne u poskytovatele — Watson heslo nikdy nevidí.</div>
						{auth ? (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									background: "var(--success-soft)",
									borderRadius: 10,
									padding: "9px 12px",
								}}
							>
								<span style={{ color: "var(--success-ink)", fontWeight: 700 }}>✓</span>
								<span
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 12,
										color: "var(--success-ink)",
									}}
								>
									Simulace ověření — reálný token a vault přijdou s M1
								</span>
							</div>
						) : (
							<span
								data-primary
								onClick={() => {
									// demo — OAuth okno poskytovatele tu není, rovnou „připojeno"
									setAuth(true);
									showToast(
										"Simulace ověření — žádný token nevznikl; šifrovaný vault přijde s M1",
									);
								}}
								style={{ display: "inline-flex", fontSize: 12, padding: "9px 16px" }}
							>
								{prov === "m365" ? "Přihlásit přes Microsoft" : "Přihlásit přes Google"}
							</span>
						)}
					</>
				)}

				{/* krok 2 — přihlášení: IMAP + SMTP (prototyp ř. 1867–1881) */}
				{step === 2 && prov === "imap" && (
					<>
						<div style={hint}>Servery zadáš ručně — funguje s kýmkoli.</div>
						{tested === "fail" && (
							<div
								style={{
									display: "flex",
									gap: 8,
									alignItems: "flex-start",
									border: "1px solid var(--ink-3)",
									borderRadius: 10,
									padding: "8px 11px",
									marginBottom: 8,
								}}
							>
								<span
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 800,
										fontSize: 12,
										color: "var(--ink)",
										flex: "none",
									}}
								>
									⚠
								</span>
								<span
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--ink-2)",
										lineHeight: 1.5,
									}}
								>
									{/* lidská hláška dle auditu A-01 — co se stalo + konkrétní rada */}
									Server odmítl spojení na portu {failPort} — zkus 993 (šifrované IMAP), nebo ověř u
									poskytovatele, že máš IMAP zapnutý. Heslo se neodeslalo.
								</span>
							</div>
						)}
						{tested === "ok" && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									background: "var(--success-soft)",
									borderRadius: 10,
									padding: "8px 11px",
									marginBottom: 8,
								}}
							>
								<span style={{ color: "var(--success-ink)", fontWeight: 700 }}>✓</span>
								<span
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--success-ink)",
									}}
								>
									Simulace testu — reálné ověření IMAP/SMTP přijde s mail backendem (M1).
								</span>
							</div>
						)}
						<div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 6 }}>
							<input placeholder="IMAP server — imap.forpsi.com" style={inputStyle} />
							<input
								value={port}
								onChange={(e) => {
									setPort(e.target.value);
									// změna portu ruší předchozí výsledek testu — jinak by po úspěchu na 993
									// zůstal „ok" i po přepnutí na 143 (audit LOW MailboxWizard.tsx:317)
									setTested(null);
								}}
								title="IMAP port — 993 je šifrovaný standard"
								style={inputStyle}
							/>
							<input placeholder="SMTP server — smtp.forpsi.com" style={inputStyle} />
							<input placeholder="465" style={inputStyle} />
						</div>
						{/* jméno + heslo (zadání) — demo pole, nikam se neodesílají */}
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
							<input placeholder="přihlašovací jméno" autoComplete="off" style={inputStyle} />
							<input type="password" placeholder="heslo" autoComplete="off" style={inputStyle} />
						</div>
						<span
							data-ghost
							onClick={doTest}
							style={{ display: "inline-flex", fontSize: 11, padding: "6px 12px", marginTop: 8 }}
						>
							{tested === "fail" ? "Otestovat znovu" : "Otestovat připojení"}
						</span>
					</>
				)}

				{/* krok 3 — lidé s přístupem (prototyp ř. 1883–1894) */}
				{step === 3 && (
					<>
						<div style={hint}>
							Kdo schránku uvidí? Ostatním v UI nebude existovat. Doladíš pak v matici.
						</div>
						<div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
							{PIDS.map((pid) => {
								const p = P[pid];
								if (!p) return null;
								return (
									<span
										key={pid}
										data-statepill
										data-on={ppl[pid] || undefined}
										onClick={() => setPpl((s) => ({ ...s, [pid]: !s[pid] }))}
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 5,
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 10.5,
											padding: "3px 10px 3px 4px",
											borderRadius: 999,
										}}
									>
										<span
											data-av={p.av || undefined}
											style={{
												width: 17,
												height: 17,
												borderRadius: "50%",
												background: "var(--avatar-navy)",
												color: "#fff",
												fontSize: 7,
												fontWeight: 700,
												display: "inline-flex",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											{p.ini}
										</span>
										{p.n.split(" ")[0]}
									</span>
								);
							})}
						</div>
					</>
				)}

				{/* krok 4 — hotovo, poctivý závěr (zadání; prototyp končil toastem) */}
				{step === 4 && (
					<>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								background: "var(--success-soft)",
								borderRadius: 10,
								padding: "9px 12px",
								marginTop: 10,
							}}
						>
							<span style={{ color: "var(--success-ink)", fontWeight: 700 }}>✓</span>
							<span
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 12,
									color: "var(--success-ink)",
								}}
							>
								Schránka připojena (simulace) — objeví se v sidebaru dema. Přístup:{" "}
								{PIDS.filter((pid) => ppl[pid]).length} lidí, zbytek ji neuvidí vůbec.
							</span>
						</div>
						<div
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 9.5,
								color: "var(--ink-3)",
								marginTop: 10,
								lineHeight: 1.6,
							}}
						>
							Demo — reálné připojení přijde s mail backendem (M1).
						</div>
					</>
				)}

				{/* navigace + progress tečky (prototyp ř. 1896–1900; tečky dle zadání) */}
				<div style={{ display: "flex", gap: 7, marginTop: 14, alignItems: "center" }}>
					<span
						style={{ display: "inline-flex", gap: 5, flex: 1 }}
						aria-label={`Krok ${step} ze 4`}
					>
						{[1, 2, 3, 4].map((s) => (
							<span
								key={s}
								style={{
									width: 7,
									height: 7,
									borderRadius: "50%",
									background: s <= step ? "var(--brass)" : "var(--line)",
								}}
							/>
						))}
					</span>
					{step > 1 && step < 4 && (
						<span
							data-ghost
							onClick={() => setStep((s) => Math.max(1, s - 1))}
							style={{ fontSize: 11.5, padding: "7px 13px" }}
						>
							← Zpět
						</span>
					)}
					{step < 3 && (
						<span
							data-primary
							onClick={() => {
								// krok 2 nejde přeskočit bez ověření — OAuth vyžaduje přihlášení,
								// IMAP úspěšný test (audit LOW MailboxWizard.tsx:317)
								if (!canNext) {
									showToast(
										prov === "imap"
											? "Nejdřív otestuj připojení (port 993) — teprve pak pokračuj."
											: "Nejdřív se přihlas u poskytovatele — teprve pak pokračuj.",
									);
									return;
								}
								setStep((s) => Math.min(3, s + 1));
							}}
							style={{
								fontSize: 11.5,
								padding: "7px 15px",
								display: "inline-flex",
								opacity: canNext ? 1 : 0.5,
								cursor: canNext ? "pointer" : "not-allowed",
							}}
						>
							Pokračovat
						</span>
					)}
					{step === 3 && (
						<span
							data-primary
							onClick={finish}
							style={{ fontSize: 11.5, padding: "7px 15px", display: "inline-flex" }}
						>
							Připojit
						</span>
					)}
					{step === 4 && (
						<span
							data-primary
							onClick={onClose}
							style={{ fontSize: 11.5, padding: "7px 15px", display: "inline-flex" }}
						>
							Hotovo
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
