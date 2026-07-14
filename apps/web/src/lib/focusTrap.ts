import { type RefObject, useEffect } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * P1-08 — základ dialog primitive: past na fokus + návrat fokusu.
 * Při aktivaci přesune fokus dovnitř kontejneru, Tab/Shift+Tab cyklí uvnitř
 * (pozadí je pro klávesnici nedosažitelné) a po zavření vrátí fokus na
 * prvek, který overlay otevřel. Escape řeší volající (vrstvy data-esc-layer).
 */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		if (!active) return;
		const container = ref.current;
		if (!container) return;
		const opener = document.activeElement as HTMLElement | null;

		const focusables = () =>
			[...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
				(el) => el.offsetParent !== null || el === document.activeElement,
			);
		// fokus dovnitř — první fokusovatelný prvek, jinak kontejner sám
		const first = focusables()[0];
		if (first) first.focus();
		else {
			container.tabIndex = -1;
			container.focus();
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			const items = focusables();
			if (items.length === 0) return;
			const head = items[0] as HTMLElement;
			const tail = items[items.length - 1] as HTMLElement;
			const current = document.activeElement as HTMLElement | null;
			// fokus mimo kontejner (klik do pozadí) → přitáhni zpět
			if (current && !container.contains(current)) {
				e.preventDefault();
				head.focus();
				return;
			}
			if (e.shiftKey && current === head) {
				e.preventDefault();
				tail.focus();
			} else if (!e.shiftKey && current === tail) {
				e.preventDefault();
				head.focus();
			}
		};
		document.addEventListener("keydown", onKey, true);
		// scroll lock pozadí po dobu otevření
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.body.style.overflow = prevOverflow;
			// návrat fokusu na otvírač (pokud stále existuje v DOM)
			if (opener && document.contains(opener)) opener.focus();
		};
	}, [active, ref]);
}
