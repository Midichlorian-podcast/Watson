/**
 * Stable callback-ref for user-triggered editors and dialogs. Unlike the HTML
 * `autoFocus` attribute it waits until React committed the overlay and does not
 * race the shared focus trap or steal focus during server rendering/hydration.
 */
export function focusOnMount(element: HTMLElement | null): void {
	if (!element) return;
	requestAnimationFrame(() => {
		if (element.isConnected) element.focus({ preventScroll: true });
	});
}
