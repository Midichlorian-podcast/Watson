/**
 * Řádkový swipe — dotyk (pointer) i trackpad (horizontální wheel, vzor
 * prototyp WatsonMail delegace pointer+wheel, ř. 2516–2571). Krátký/dlouhý
 * tah doprava/doleva (prahy SW_SHORT/SW_LONG jako mail: 56/190 px), gumový
 * odpor za dlouhým prahem, akce až po DOKONČENÍ gesta, klik po tahu se
 * blokuje (350 ms). Vizuál kreslí konzument přes onUpdate(dx, mag).
 */
import { useCallback, useRef } from "react";

export type SwipeMag = "none" | "r0" | "r1" | "r2" | "l0" | "l1" | "l2";

const SHORT = 56;
const LONG = 190;

export const swipeMag = (dx: number): SwipeMag => {
	const a = Math.abs(dx);
	if (a < 12) return "none";
	const side = dx > 0 ? "r" : "l";
	if (a < SHORT) return `${side}0` as SwipeMag;
	if (a < LONG) return `${side}1` as SwipeMag;
	return `${side}2` as SwipeMag;
};

/** Gumový odpor za dlouhým prahem (prototyp swRubber). */
export const swipeEase = (dx: number): number => {
	const a = Math.abs(dx);
	return a <= LONG ? dx : Math.sign(dx) * (LONG + (a - LONG) * 0.2);
};

export function useSwipe(opts: {
	/** Živý vizuál během tahu — dx už s gumovým odporem; mag pro barvy/text. */
	onUpdate: (dx: number, mag: SwipeMag) => void;
	/** Dokončený tah přes práh (r1/r2/l1/l2). */
	onSwipe: (mag: "r1" | "r2" | "l1" | "l2") => void;
	disabled?: boolean;
}) {
	const { onUpdate, onSwipe, disabled } = opts;
	const st = useRef({ startX: 0, dx: 0, on: false });
	const wheel = useRef({ acc: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });
	const blockUntil = useRef(0);

	const finish = useCallback(
		(dx: number) => {
			onUpdate(0, "none");
			const mag = swipeMag(swipeEase(dx));
			if (mag === "r1" || mag === "r2" || mag === "l1" || mag === "l2") {
				blockUntil.current = Date.now() + 350;
				onSwipe(mag);
			} else if (Math.abs(dx) > 12) {
				blockUntil.current = Date.now() + 350;
			}
		},
		[onUpdate, onSwipe],
	);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (disabled || e.pointerType !== "touch") return;
			st.current = { startX: e.clientX, dx: 0, on: true };
		},
		[disabled],
	);
	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!st.current.on || e.pointerType !== "touch") return;
			st.current.dx = e.clientX - st.current.startX;
			const eased = swipeEase(st.current.dx);
			onUpdate(eased, swipeMag(eased));
		},
		[onUpdate],
	);
	const onPointerUp = useCallback(
		(e: React.PointerEvent) => {
			if (e.pointerType !== "touch" || !st.current.on) return;
			st.current.on = false;
			finish(st.current.dx);
			st.current.dx = 0;
		},
		[finish],
	);
	const onPointerCancel = useCallback(() => {
		if (!st.current.on) return;
		st.current.on = false;
		finish(st.current.dx);
		st.current.dx = 0;
	}, [finish]);

	/** Trackpad: horizontální dvouprstý scroll = swipe (deltaX dominantní). */
	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			if (disabled) return;
			if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
			// obsah jede proti směru prstů (natural scroll): deltaX > 0 = tah doleva
			wheel.current.acc -= e.deltaX;
			const eased = swipeEase(wheel.current.acc);
			onUpdate(eased, swipeMag(eased));
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			wheel.current.timer = setTimeout(() => {
				const dx = wheel.current.acc;
				wheel.current.acc = 0;
				wheel.current.timer = 0;
				finish(dx);
			}, 140);
		},
		[disabled, onUpdate, finish],
	);

	/** Klik těsně po tahu ignorovat (prototyp _swBlock). */
	const swipedRecently = useCallback(() => Date.now() < blockUntil.current, []);

	return {
		handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel },
		swipedRecently,
	};
}
