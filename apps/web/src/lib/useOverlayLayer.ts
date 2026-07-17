import { useRef } from "react";
import { useDismissableLayer } from "./dismissableLayer";
import { useFocusTrap } from "./focusTrap";

/**
 * Společný behaviorální základ modalů a modalních drawerů:
 * - focus trap a inert pozadí,
 * - referenčně počítaný scroll lock,
 * - Escape pouze pro právě vrchní vrstvu,
 * - návrat fokusu na skutečný opener.
 *
 * Vizuální DOM zůstává u konkrétního povrchu, aby se neztratily mailové theme
 * scope ani mobilní sheet layouty.
 */
export function useOverlayLayer<T extends HTMLElement>(
	active: boolean,
	onEscape: () => void,
) {
	const ref = useRef<T>(null);
	useFocusTrap(active, ref);
	useDismissableLayer(active, ref, onEscape);
	return ref;
}
