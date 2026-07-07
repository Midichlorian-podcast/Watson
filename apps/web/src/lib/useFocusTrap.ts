import { useEffect, useRef } from "react";

const FOCUSABLE =
	'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Přístupnost modálů: uzamkne fokus DOVNITŘ kontejneru (Tab/Shift+Tab cyklí uvnitř) a po zavření
 * vrátí fokus na prvek, ze kterého se modal otevřel. Vrací ref, který se přiřadí na kořen modalu.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
	const ref = useRef<T>(null);

	useEffect(() => {
		if (!active) return;
		const root = ref.current;
		if (!root) return;
		const prevFocused = document.activeElement as HTMLElement | null;

		// Fokus na první fokusovatelný prvek (nebo kontejner), pokud fokus není už uvnitř.
		if (!root.contains(document.activeElement)) {
			const first = root.querySelector<HTMLElement>(FOCUSABLE);
			(first ?? root).focus();
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			const items = Array.from(
				root.querySelectorAll<HTMLElement>(FOCUSABLE),
			).filter((el) => el.offsetParent !== null || el === document.activeElement);
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			const activeEl = document.activeElement as HTMLElement | null;
			if (e.shiftKey && activeEl === first) {
				e.preventDefault();
				last?.focus();
			} else if (!e.shiftKey && activeEl === last) {
				e.preventDefault();
				first?.focus();
			}
		};
		root.addEventListener("keydown", onKey);
		return () => {
			root.removeEventListener("keydown", onKey);
			// Vrať fokus tam, odkud se modal otevřel (pokud prvek stále existuje).
			if (prevFocused && document.contains(prevFocused)) prevFocused.focus();
		};
	}, [active]);

	return ref;
}
