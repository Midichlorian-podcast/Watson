import { type RefObject, useRef } from "react";
import { useDismissableLayer } from "./dismissableLayer";

/** Nemodální vrstva: sdílí topmost Escape pořadí, ale neinertuje ani nezamyká stránku. */
export function usePopoverLayer<T extends HTMLElement>(
	active: boolean,
	onEscape: () => void,
	openerRef?: RefObject<HTMLElement | null>,
) {
	const ref = useRef<T>(null);
	useDismissableLayer(active, ref, onEscape, { restoreFocusOnEscape: true, openerRef });
	return ref;
}
