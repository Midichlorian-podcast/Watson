import { type RefObject, useEffect } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const trapStack: HTMLElement[] = [];
let scrollLocks = 0;
let originalBodyOverflow = "";

type InertState = { count: number; inert: boolean; ariaHidden: string | null };
const inertStates = new WeakMap<HTMLElement, InertState>();

function acquireInert(element: HTMLElement): void {
	const state = inertStates.get(element);
	if (state) {
		state.count++;
		return;
	}
	inertStates.set(element, {
		count: 1,
		inert: element.inert,
		ariaHidden: element.getAttribute("aria-hidden"),
	});
	element.inert = true;
	element.setAttribute("aria-hidden", "true");
}

function releaseInert(element: HTMLElement): void {
	const state = inertStates.get(element);
	if (!state) return;
	state.count--;
	if (state.count > 0) return;
	element.inert = state.inert;
	if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
	else element.setAttribute("aria-hidden", state.ariaHidden);
	inertStates.delete(element);
}

/** Inertuje všechny sourozenecké větve mezi dialogem a body, nikdy samotný dialog. */
function inertOutside(container: HTMLElement): HTMLElement[] {
	const acquired: HTMLElement[] = [];
	let current: HTMLElement | null = container;
	while (current?.parentElement) {
		for (const sibling of [...current.parentElement.children]) {
			if (
				sibling === current ||
				!(sibling instanceof HTMLElement) ||
				sibling.hasAttribute("data-focus-trap-companion")
			)
				continue;
			acquireInert(sibling);
			acquired.push(sibling);
		}
		if (current.parentElement === document.body) break;
		current = current.parentElement;
	}
	return acquired;
}

/**
 * P1-08 — základ dialog primitive: past na fokus + návrat fokusu.
 * Při aktivaci přesune fokus dovnitř kontejneru, Tab/Shift+Tab cyklí uvnitř
 * (pozadí je pro klávesnici nedosažitelné) a po zavření vrátí fokus na
 * prvek, který overlay otevřel. Escape sjednocuje dismissableLayer.
 */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		if (!active) return;
		const container = ref.current;
		if (!container) return;
		const opener = document.activeElement as HTMLElement | null;
		trapStack.push(container);
		const inerted = inertOutside(container);
		if (scrollLocks++ === 0) {
			originalBodyOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
		}

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
			if (trapStack.at(-1) !== container) return;
			if (e.key !== "Tab") return;
			const items = focusables();
			if (items.length === 0) return;
			e.preventDefault();
			const current = document.activeElement as HTMLElement | null;
			const currentIndex = current ? items.indexOf(current) : -1;
			const nextIndex =
				currentIndex < 0
					? e.shiftKey
						? items.length - 1
						: 0
					: (currentIndex + (e.shiftKey ? -1 : 1) + items.length) % items.length;
			items[nextIndex]?.focus();
		};
		const onFocus = (event: FocusEvent) => {
			if (trapStack.at(-1) !== container || container.contains(event.target as Node)) return;
			const target = focusables()[0];
			if (target) target.focus();
			else container.focus();
		};
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("focusin", onFocus, true);

		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("focusin", onFocus, true);
			const stackIndex = trapStack.lastIndexOf(container);
			if (stackIndex >= 0) trapStack.splice(stackIndex, 1);
			for (const element of inerted) releaseInert(element);
			scrollLocks = Math.max(0, scrollLocks - 1);
			if (scrollLocks === 0) document.body.style.overflow = originalBodyOverflow;
			// návrat fokusu na otvírač (pokud stále existuje v DOM)
			if (opener && document.contains(opener) && !opener.inert) opener.focus();
		};
	}, [active, ref]);
}
