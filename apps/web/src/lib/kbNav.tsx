import { useEffect, useRef, useState } from "react";
import { useSession } from "./auth-client";
import type { TaskRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";
import { useTaskDetail } from "./taskDetail";
import { toggleTask } from "./tasks";
import { deleteTaskWithUndo, pushColumnUndo } from "./undo";

/**
 * Seznamová klávesová navigace kbsel (prototyp ř. 2263–2276) — j/k/↑↓ výběr,
 * Enter detail, Space toggle, 1–4 priorita, ⌫ smazat s undo. Sdílená pro
 * Dnes/Úkoly/Nadcházející; virtuální výskyty (id@ISO) jen toggle, ne mazání/priorita.
 */
export function useKbNav(list: TaskRow[], enabled: boolean) {
	const { open, openId } = useTaskDetail();
	const { data: session } = useSession();
	const [kbSel, setKbSel] = useState<string | null>(null);
	const ref = useRef({ list, kbSel, actorId: session?.user?.id });
	ref.current = { list, kbSel, actorId: session?.user?.id };

	useEffect(() => {
		if (!enabled) return;
		const h = (e: KeyboardEvent) => {
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
			if (typing || e.metaKey || e.ctrlKey || e.altKey || openId) return;
			// Otevřená vrstva (tahák/⌘K/modal, [data-esc-layer]) — seznam nereaguje (prototyp ř. 2263).
			if (document.querySelector("[data-esc-layer]")) return;
			const { list: rows, kbSel: cur } = ref.current;
			const ids = rows.map((x) => x.id);
			if (!ids.length) return;
			let i = cur ? ids.indexOf(cur) : -1;
			if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
				e.preventDefault();
				i = i < 0 ? 0 : Math.min(ids.length - 1, i + 1);
				setKbSel(ids[i] ?? null);
				return;
			}
			if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
				e.preventDefault();
				i = i < 0 ? 0 : Math.max(0, i - 1);
				setKbSel(ids[i] ?? null);
				return;
			}
			if (i < 0 || !cur) return;
			const virtual = cur.includes("@");
			if (e.key === "Enter") {
				e.preventDefault();
				open(cur);
				return;
			}
			if (e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				const tk = rows.find((x) => x.id === cur);
				if (tk) void toggleTask(tk, ref.current.actorId);
				return;
			}
			if (["1", "2", "3", "4"].includes(e.key) && !virtual) {
				e.preventDefault();
				const prev = rows.find((x) => x.id === cur)?.priority ?? 4;
				const next = +e.key;
				// D9 — undo záznam až PO úspěšném zápisu; push před execute by při
				// selhání nechal v ⌘Z falešný krok, který „vrací" nic.
				void powerSync
					.execute("UPDATE tasks SET priority = ? WHERE id = ?", [next, cur])
					.then(() => pushColumnUndo("tasks", cur, "priority", prev, next));
				return;
			}
			if ((e.key === "Backspace" || e.key === "Delete") && !virtual) {
				e.preventDefault();
				const ni = ids[i + 1] ?? ids[i - 1] ?? null;
				void deleteTaskWithUndo(cur); // ⌫ smaže s undo (tahák ř. 1654)
				setKbSel(ni);
				return;
			}
			if (e.key === "Escape") setKbSel(null);
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [enabled, openId, open]);

	return kbSel;
}
