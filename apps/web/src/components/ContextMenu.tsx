/**
 * Sdílené kontextové menu (pravý klik / dvouprstý tap → onContextMenu) pro celou
 * aplikaci — feedback 2026-07-12: „musí fungovat v každé části appky i v úkolech",
 * dřív bylo jen v mailu (mail/CtxMenu svázané s useMail). Jeden portál v rootu,
 * otevíraný přes useContextMenu().open(e, items). Klik mimo / Esc / scroll zavře.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface CtxItem {
	/** oddělovač: `{ sep: true }` */
	sep?: boolean;
	label?: string;
	/** volitelná ikona/prefix (např. emoji nebo malé SVG). */
	icon?: ReactNode;
	/** pravý sloupec (např. „P1", zkratka). */
	hint?: string;
	danger?: boolean;
	disabled?: boolean;
	/** aktivní/zaškrtnutá položka (radio/checkbox styl). */
	on?: boolean;
	onClick?: () => void;
	/** podpoložky — po najetí/kliku rozbalí druhý sloupec. */
	children?: CtxItem[];
}

interface OpenState {
	x: number;
	y: number;
	items: CtxItem[];
}

interface Ctx {
	open: (
		e: { clientX: number; clientY: number; preventDefault: () => void },
		items: CtxItem[],
	) => void;
	close: () => void;
}

const CtxCtx = createContext<Ctx>({ open: () => {}, close: () => {} });
export const useContextMenu = () => useContext(CtxCtx);

const MENU_W = 208;

export function ContextMenuProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<OpenState | null>(null);
	const [sub, setSub] = useState<{ key: number; items: CtxItem[] } | null>(null);

	const close = useCallback(() => {
		setState(null);
		setSub(null);
	}, []);

	const open = useCallback<Ctx["open"]>((e, items) => {
		e.preventDefault();
		// clamp do viewportu — menu se nesmí utnout za okrajem
		const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
		const y = Math.min(e.clientY, window.innerHeight - Math.min(items.length * 34 + 12, 360) - 8);
		setState({ x: Math.max(8, x), y: Math.max(8, y), items });
		setSub(null);
	}, []);

	// klik mimo / Esc / scroll / resize zavře (listenery jen dokud je otevřeno)
	useEffect(() => {
		if (!state) return;
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key === "Escape") {
				ev.stopPropagation();
				close();
			}
		};
		const onScroll = () => close();
		document.addEventListener("keydown", onKey, true);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [state, close]);

	const run = (it: CtxItem, i: number, isSub: boolean) => {
		if (it.disabled || it.sep) return;
		// položka s podpoložkami: KLIK rozbalí druhý sloupec (funguje i na dotyku/
		// trackpadu, kde hover není) — na desktopu ho otevře i najetí myší.
		if (!isSub && it.children?.length) {
			setSub((cur) => (cur?.key === i ? null : { key: i, items: it.children ?? [] }));
			return;
		}
		it.onClick?.();
		close();
	};

	const renderItem = (it: CtxItem, i: number, isSub = false) => {
		if (it.sep) return <div key={`s${i}`} className="my-1 border-line border-t" />;
		return (
			<button
				key={it.label ?? i}
				type="button"
				disabled={it.disabled}
				onClick={() => run(it, i, isSub)}
				onMouseEnter={() =>
					!isSub && it.children?.length
						? setSub({ key: i, items: it.children })
						: setSub(isSub ? sub : null)
				}
				className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-body ${
					it.disabled
						? "cursor-default text-ink-3 opacity-50"
						: it.danger
							? "text-overdue hover:bg-overdue-soft"
							: "text-ink-2 hover:bg-panel-2 hover:text-ink"
				}`}
				style={{ fontSize: 12.5 }}
			>
				{it.icon != null && (
					<span className="grid w-4 shrink-0 place-items-center text-ink-3">{it.icon}</span>
				)}
				<span className="min-w-0 flex-1 truncate">{it.label}</span>
				{it.on && <span className="shrink-0 text-brass-text">✓</span>}
				{it.hint && (
					<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
						{it.hint}
					</span>
				)}
				{it.children?.length ? <span className="shrink-0 text-ink-3">›</span> : null}
			</button>
		);
	};

	return (
		<CtxCtx.Provider value={{ open, close }}>
			{children}
			{state &&
				createPortal(
					<div
						data-esc-layer
						onClick={close}
						onContextMenu={(e) => {
							e.preventDefault();
							close();
						}}
						style={{ position: "fixed", inset: 0, zIndex: 85 }}
					>
						<div
							onClick={(e) => e.stopPropagation()}
							className="rounded-xl border border-line bg-card p-1 shadow-lg"
							style={{
								position: "fixed",
								left: state.x,
								top: state.y,
								width: MENU_W,
								maxHeight: 360,
								overflowY: "auto",
								boxShadow: "var(--w-shadow)",
								animation: "wPop .12s ease",
							}}
						>
							{state.items.map((it, i) => renderItem(it, i))}
						</div>
						{sub &&
							(() => {
								// druhý sloupec vedle položky (nebo vlevo, když by přetekl)
								const rightX = state.x + MENU_W + 2;
								const subX = rightX + MENU_W > window.innerWidth ? state.x - MENU_W - 2 : rightX;
								const subY = Math.min(
									state.y + sub.key * 32,
									window.innerHeight - sub.items.length * 32 - 12,
								);
								return (
									<div
										onClick={(e) => e.stopPropagation()}
										className="rounded-xl border border-line bg-card p-1"
										style={{
											position: "fixed",
											left: Math.max(8, subX),
											top: Math.max(8, subY),
											width: MENU_W,
											boxShadow: "var(--w-shadow)",
											animation: "wPop .1s ease",
										}}
									>
										{sub.items.map((it, i) => renderItem(it, i, true))}
									</div>
								);
							})()}
					</div>,
					document.body,
				)}
		</CtxCtx.Provider>
	);
}
