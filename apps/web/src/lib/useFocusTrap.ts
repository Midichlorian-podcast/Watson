import { useRef } from "react";
import { useFocusTrap as useSharedFocusTrap } from "./focusTrap";

/**
 * Přístupnost modálů: uzamkne fokus DOVNITŘ kontejneru (Tab/Shift+Tab cyklí uvnitř) a po zavření
 * vrátí fokus na prvek, ze kterého se modal otevřel. Vrací ref, který se přiřadí na kořen modalu.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
	const ref = useRef<T>(null);
	useSharedFocusTrap(active, ref);
	return ref;
}
