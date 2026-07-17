import { type RefObject, useLayoutEffect, useRef } from "react";

type LayerEntry = {
	id: symbol;
	onEscape: () => void;
};

const layerStack: LayerEntry[] = [];

/**
 * Společná Escape fronta pro modaly i nemodální popovery. Poslouchá v bubble
 * fázi, takže editor uvnitř může Escape spotřebovat dřív; jinak jej dostane
 * právě jen naposledy otevřená vrstva.
 */
export function useDismissableLayer(
	active: boolean,
	_ref: RefObject<HTMLElement | null>,
	onEscape: () => void,
	options: {
		restoreFocusOnEscape?: boolean;
		openerRef?: RefObject<HTMLElement | null>;
	} = {},
) {
	const escapeRef = useRef(onEscape);
	escapeRef.current = onEscape;
	const restoreRef = useRef(options.restoreFocusOnEscape);
	restoreRef.current = options.restoreFocusOnEscape;
	const explicitOpenerRef = useRef(options.openerRef);
	explicitOpenerRef.current = options.openerRef;

	useLayoutEffect(() => {
		if (!active) return;
		const opener =
			explicitOpenerRef.current?.current ?? (document.activeElement as HTMLElement | null);
		const entry: LayerEntry = { id: Symbol("watson-layer"), onEscape: () => escapeRef.current() };
		layerStack.push(entry);
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				layerStack.at(-1)?.id !== entry.id
			)
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			entry.onEscape();
			// Popover neinertuje okolí, takže lze fokus vrátit synchronně ještě před
			// pasivním React cleanupem. Tím se zamezí jednomu snímku na <body>.
			if (restoreRef.current && opener && document.contains(opener) && !opener.inert) opener.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			const index = layerStack.findIndex((candidate) => candidate.id === entry.id);
			if (index >= 0) layerStack.splice(index, 1);
		};
	}, [active]);
}
