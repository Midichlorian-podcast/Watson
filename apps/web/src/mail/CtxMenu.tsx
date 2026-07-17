/**
 * Mail — kontextové menu řádku (pravý klik / dvouprstý tap; prototyp markup
 * ř. 2039–2051 + logika ctxV ř. 3130–3165). Průhledná click-catch vrstva dle
 * prototypu (bez scrimu), pozice clampnutá do viewportu, Esc/klik mimo zavírá.
 */
import { copyDeepLink } from "../lib/deepLink";
import { showToast } from "../lib/toast";
import { usePopoverLayer } from "../lib/usePopoverLayer";
import { useMail } from "./state";

type CtxItem =
	| { kind: "div" }
	| { kind: "item"; l: string; go: () => void; k?: string; danger?: boolean };

export function CtxMenu({
	ctx,
	onClose,
}: {
	ctx: { id: string; x: number; y: number } | null;
	onClose: () => void;
}) {
	const m = useMail();
	const menuRef = usePopoverLayer<HTMLDivElement>(Boolean(ctx), onClose);

	if (!ctx) return null;
	const id = ctx.id;
	const t = m.threads.find((x) => x.id === id);
	const e = t ? m.eff(t) : null;

	const act = (kind: Parameters<typeof m.rowAct>[1]) => () => {
		onClose();
		m.rowAct(id, kind);
	};
	const items: CtxItem[] = [];
	const push = (l: string, go: () => void, extra?: { k?: string; danger?: boolean }) =>
		items.push({ kind: "item", l, go, ...extra });
	const div = () => items.push({ kind: "div" });

	// položky přesně dle prototypu (ř. 3141–3160)
	push("Otevřít", () => {
		onClose();
		m.openThread(id);
	}, { k: "Enter" });
	push("Odpovědět", () => {
		onClose();
		m.openThread(id);
		// otevře koncept v režimu edit se zachováním rozepsaného textu (ř. 3144)
		m.setDraft(id, m.drafts[id]?.text ?? "", "edit");
	}, { k: "R" });
	div();
	push("Hotovo", act("done"), { k: "H" });
	push(e?.pin ? "Odepnout" : "Připnout", act("pin"), { k: "D" });
	push("Odložit na zítra", act("snooze"), { k: "S" });
	push("Set Aside — bez termínu", () => {
		onClose();
		m.setOv(id, { snoozed: "bez termínu" });
		showToast("Set Aside — čeká v Odloženo bez termínu.");
	});
	push(
		t?.unread && !e?.read ? "Označit jako přečtené" : "Označit jako nepřečtené",
		act("unread"),
		{ k: "U" },
	);
	push(e?.muted ? "Zrušit ztlumení" : "Ztlumit vlákno", act("mute"), { k: "M" });
	div();
	push("Kopírovat odkaz na vlákno", () => {
		onClose();
		void copyDeepLink("mail", id).then((copied) =>
			showToast(
				copied
					? "Odkaz zkopírován — otevře ho jen ten, kdo má ke schránce přístup."
					: "Odkaz se nepodařilo zkopírovat.",
			),
		);
	});
	push("Kopírovat předmět", () => {
		onClose();
		try {
			void navigator.clipboard.writeText(t?.subj ?? "");
		} catch {
			/* clipboard nedostupný */
		}
		showToast("Předmět zkopírován.");
	});
	div();
	if (e && (e.arch || e.trash)) push("Vrátit do Inboxu", act("restore"));
	else push("Archivovat", act("arch"), { k: "E" });
	push("Do koše", act("trash"), { danger: true });

	// clamp pozice do viewportu (prototyp ř. 3161–3163)
	const x = Math.max(8, Math.min(ctx.x, (window.innerWidth || 1400) - 248));
	const y = Math.max(
		8,
		Math.min(ctx.y, (window.innerHeight || 800) - (items.length * 30 + 60)),
	);

	return (
		<div data-esc-layer>
			{/* průhledná click-catch vrstva (ř. 2041) — pravý klik mimo taky zavře */}
			<button type="button" aria-label="Zavřít kontextové menu"
				onClick={onClose}
				onContextMenu={(ev) => {
					ev.preventDefault();
					onClose();
				}}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: "var(--w-layer-popover)",
					border: 0,
					background: "transparent",
				}}
			/>
			<div
				ref={menuRef}
				role="menu"
				aria-label="Kontextové menu"
				data-screen-label="Kontextové menu"
				style={{
					position: "fixed",
					zIndex: "calc(var(--w-layer-popover) + 1)",
					width: 232,
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 13,
					boxShadow: "var(--shadow)",
					padding: 5,
					animation: "wPop .12s ease",
					left: x,
					top: y,
				}}
			>
				{items.map((it, i) =>
					it.kind === "div" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: statický seznam položek
						<div key={i} style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
					) : (
						<button type="button" role="menuitem"
							key={it.l}
							onClick={it.go}
							data-menuitem
							data-danger={it.danger ? "true" : undefined}
						>
							<span style={{ flex: 1 }}>{it.l}</span>
							{it.k && (
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 9, color: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 4, padding: "0 4px" }}>
									{it.k}
								</span>
							)}
						</button>
					),
				)}
			</div>
		</div>
	);
}
