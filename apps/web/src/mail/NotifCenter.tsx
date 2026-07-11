/**
 * Notifikační centrum (Modul 11; prototyp markup ř. 2169–2187 + logika
 * notifVals ř. 4395–4418). Panel ukotvený vpravo nahoře pod zvonkem.
 * Položky NEJSOU statický seznam prototypu — odvozují se deterministicky
 * ze seedu a živého stavu: @zmínka v interní diskusi, běžící SLA P1/P2,
 * fronta Gatekeeperu (gkLeft) a bounce nedoručeného mailu. „Viděno" je
 * lokální session stav (module cache jako u AdminScreen — přežije zavření
 * panelu, ne reload; prototyp drží notifSeen v globálním state).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { P, SLA } from "./data";
import { useMail } from "./state";

/** Druh tečky — mapuje na [data-nk] barvy v mail.css (ř. 100–101). */
type NotifKind = "sla" | "mention" | "gate";

interface NotifItem {
	key: string;
	k: NotifKind;
	t: string;
	txt: string;
	/** Bounce používá tečku SLA (červená = chyba doručení), odliší se stylem. */
	bounce?: boolean;
	go: () => void;
}

/** Session cache viděných položek (přežije unmount panelu). */
const seenCache: Record<string, true> = {};

/** Česká množná čísla fronty Gatekeeperu (prototyp má napevno „3 noví…"). */
const gkTxt = (n: number): string =>
	n === 1
		? "1 nový odesílatel čeká v Gatekeeperu"
		: n < 5
			? `${n} noví odesílatelé čekají v Gatekeeperu`
			: `${n} nových odesílatelů čeká v Gatekeeperu`;

export function NotifCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
	const m = useMail();
	const [, bump] = useState(0); // re-render po zápisu do seenCache

	// Esc zavírá (prototyp globální Escape ř. 2746)
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [open, onClose]);

	/** Odvození položek ze seedu + stavu (nahrazuje statické notifVals.items). */
	const items = useMemo<NotifItem[]>(() => {
		const out: NotifItem[] = [];
		for (const t of m.threads) {
			if (t.personal) continue;
			const e = m.eff(t);
			// běžící SLA P1/P2 — vlajka aktivní, vlákno neuzavřené a bez odpovědi
			if ((e.flag === "p1" || e.flag === "p2") && !e.closed && !e.sent) {
				const sla = SLA[e.flag];
				out.push({
					key: `sla:${t.id}`,
					k: "sla",
					t: m.ovOf(t.id).time ?? t.time,
					txt: `${sla?.chip ?? e.flag.toUpperCase()} · SLA běží: „${t.subj}“ — ${sla?.sla ?? ""}`,
					go: () => m.openThread(t.id),
				});
			}
			// @zmínka mě v interní diskusi (prototyp: Petra zmínila @Adam u faktury)
			for (const c of t.chat) {
				if (c.m === "@Adam" && c.who !== "ad") {
					const who = P[c.who]?.n.split(" ")[0] ?? c.who;
					out.push({
						key: `mention:${t.id}:${c.t}`,
						k: "mention",
						t: c.t,
						// v seedu zmiňují jen kolegyně — tvar „zmínila" sedí
						txt: `${who} tě zmínila v interní diskusi u „${t.subj}“`,
						go: () => m.openThread(t.id),
					});
				}
			}
			// bounce — odeslaný mail se nedoručil (seed mleko, dokud není opraven)
			if (t.bounce && !m.ovOf(t.id).bounceFixed) {
				out.push({
					key: `bounce:${t.id}`,
					k: "sla",
					bounce: true,
					t: m.ovOf(t.id).time ?? t.time,
					txt: `Nedoručeno: „${t.subj}“ — ${t.bounce}`,
					go: () => m.openThread(t.id),
				});
			}
		}
		// fronta Gatekeeperu (prototyp ř. 4399: „3 noví odesílatelé čekají…")
		if (m.gkLeft > 0) {
			out.push({
				key: "gate",
				k: "gate",
				t: "7:30",
				txt: gkTxt(m.gkLeft),
				go: () => m.setFolder("gatekeeper"),
			});
		}
		return out;
	}, [m]);

	if (!open) return null;

	const fresh = items.filter((n) => !seenCache[n.key]);

	const markAll = () => {
		for (const n of items) seenCache[n.key] = true;
		bump((x) => x + 1);
	};

	const openItem = (n: NotifItem) => {
		seenCache[n.key] = true;
		onClose();
		n.go();
	};

	// Portál do <body>: uvnitř mail panelů vznikají stacking contexty (transform,
	// z-index vrstvy) a fixed overlay by se kreslil ZA stránkou. POZOR: mimo
	// mailroot neplatí mail proměnné (--panel/--ink/--line jsou scopované na
	// [data-wm-theme]) → scrim MUSÍ scope nést sám, jinak je karta průhledná
	// a text se slévá se stránkou (feedback 2026-07-11).
	const wmTheme =
		document.querySelector("[data-wm-theme]")?.getAttribute("data-wm-theme") ??
		"light";
	return createPortal(
		// scrim bez pozadí (prototyp ř. 2170 — jen klik mimo zavírá)
		<div
			data-esc-layer
			data-wm-theme={wmTheme}
			onClick={onClose}
			style={{ position: "fixed", inset: 0, zIndex: 80 }}
		>
			<div
				data-screen-label="Notifikace"
				onClick={(e) => e.stopPropagation()}
				style={{
					position: "fixed",
					top: 60,
					right: 14,
					zIndex: 81,
					width: "min(352px, 94vw)",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 14,
					boxShadow: "var(--shadow)",
					animation: "wPop .14s ease",
					overflow: "hidden",
				}}
			>
				{/* hlavička (prototyp ř. 2172–2175) */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "11px 14px 9px",
						borderBottom: "1px solid var(--line)",
					}}
				>
					<span
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 12.5,
							color: "var(--ink)",
							flex: 1,
						}}
					>
						Oznámení
					</span>
					{fresh.length > 0 && (
						<span
							onClick={markAll}
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 10,
								color: "var(--ink-3)",
								cursor: "pointer",
							}}
						>
							označit vše jako viděné
						</span>
					)}
				</div>

				{/* položky (prototyp ř. 2176–2182) */}
				{fresh.map((n) => (
					<div
						key={n.key}
						onClick={() => openItem(n)}
						style={{
							display: "flex",
							gap: 10,
							alignItems: "flex-start",
							padding: "10px 14px",
							cursor: "pointer",
							borderBottom: "1px solid var(--line)",
						}}
					>
						<span data-nk={n.k} style={n.bounce ? { background: "var(--overdue)" } : undefined} />
						<span
							style={{
								flex: 1,
								fontFamily: "var(--w-font-body)",
								fontSize: 12,
								color: "var(--ink-2)",
								lineHeight: 1.5,
							}}
						>
							{n.txt}
						</span>
						<span
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 9.5,
								color: "var(--ink-3)",
								flex: "none",
							}}
						>
							{n.t}
						</span>
					</div>
				))}

				{/* prázdný stav — vše viděné, nebo nic neběží */}
				{fresh.length === 0 && (
					<div
						style={{
							padding: "18px 14px",
							fontFamily: "var(--w-font-body)",
							fontSize: 12,
							color: "var(--ink-3)",
						}}
					>
						Nic nového — SLA, zmínky, Gatekeeper i doručení jsou v klidu.
					</div>
				)}

				{/* patička (prototyp ř. 2183) */}
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 10.5,
						color: "var(--ink-3)",
						padding: "9px 14px",
						background: "var(--panel-2)",
					}}
				>
					Per schránka: Všechny / VIP / Žádné — nastavíš v Nastavení. Tiché hodiny se respektují,
					jen P1 může přerušit.
				</div>
			</div>
		</div>,
		document.body,
	);
}
