/**
 * Řádkový swipe — dotyk (pointer) i trackpad (horizontální wheel). Feedback
 * 2026-07-11: prahy zvednuté (malé 110 px / velké 260 px), akce se provede
 * VÝHRADNĚ po dokončení gesta (puštění prstů / 280 ms klidu kolečka), wheel
 * gesto se musí „ozbrojit" výrazně horizontálním prvním pohybem a svislý
 * scroll ho okamžitě ruší — jinak vznikala spousta omylných akcí. Při
 * překročení prahu krátká vibrace (podpora dle zařízení; desktop trackpad
 * web rozvibrovat neumí). Vizuál kreslí konzument přes onUpdate(dx, mag).
 */
import { useCallback, useRef } from "react";

export type SwipeMag = "none" | "r0" | "r1" | "r2" | "l0" | "l1" | "l2";

/** Malé potažení — pod ním se nic neprovede (jen náznak r0/l0). */
export const SWIPE_SHORT = 110;
/** Velké potažení — druhá úroveň akce. */
export const SWIPE_LONG = 260;

const ACTION_TIERS = new Set<SwipeMag>(["r1", "r2", "l1", "l2"]);

export const swipeMag = (dx: number): SwipeMag => {
	const a = Math.abs(dx);
	if (a < 16) return "none";
	const side = dx > 0 ? "r" : "l";
	if (a < SWIPE_SHORT) return `${side}0` as SwipeMag;
	if (a < SWIPE_LONG) return `${side}1` as SwipeMag;
	return `${side}2` as SwipeMag;
};

/** Gumový odpor za velkým prahem (prototyp swRubber). */
export const swipeEase = (dx: number): number => {
	const a = Math.abs(dx);
	return a <= SWIPE_LONG ? dx : Math.sign(dx) * (SWIPE_LONG + (a - SWIPE_LONG) * 0.2);
};

/** Krátká vibrace při překročení prahu (Android/mobil; jinde tiché no-op). */
export const swipeBuzz = (): void => {
	if (typeof navigator !== "undefined" && "vibrate" in navigator) {
		navigator.vibrate(8);
	}
};

export function useSwipe(opts: {
	/** Živý vizuál během tahu — dx už s gumovým odporem; mag pro barvy/text. */
	onUpdate: (dx: number, mag: SwipeMag) => void;
	/** Dokončený tah přes práh (r1/r2/l1/l2) — až PO puštění/usazení. */
	onSwipe: (mag: "r1" | "r2" | "l1" | "l2") => void;
	disabled?: boolean;
}) {
	const { onUpdate, onSwipe, disabled } = opts;
	const st = useRef({ startX: 0, dx: 0, on: false });
	const wheel = useRef({
		acc: 0,
		armed: false,
		timer: null as ReturnType<typeof setTimeout> | null,
	});
	const lastTier = useRef<SwipeMag>("none");
	const blockUntil = useRef(0);

	/** Vizuál + haptika při změně úrovně (náznak → malé → velké potažení). */
	const emit = useCallback(
		(dx: number) => {
			const eased = swipeEase(dx);
			const mag = swipeMag(eased);
			if (ACTION_TIERS.has(mag) && mag !== lastTier.current) swipeBuzz();
			lastTier.current = mag;
			onUpdate(eased, mag);
		},
		[onUpdate],
	);

	const finish = useCallback(
		(dx: number) => {
			lastTier.current = "none";
			onUpdate(0, "none");
			const mag = swipeMag(swipeEase(dx));
			if (mag === "r1" || mag === "r2" || mag === "l1" || mag === "l2") {
				blockUntil.current = Date.now() + 350;
				onSwipe(mag);
			} else if (Math.abs(dx) > 16) {
				blockUntil.current = Date.now() + 350;
			}
		},
		[onUpdate, onSwipe],
	);

	const cancelWheel = useCallback(() => {
		if (wheel.current.timer) clearTimeout(wheel.current.timer);
		wheel.current = { acc: 0, armed: false, timer: null };
		lastTier.current = "none";
		onUpdate(0, "none");
	}, [onUpdate]);

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
			emit(st.current.dx);
		},
		[emit],
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

	/** Trackpad: ozbrojí se prvním převážně horizontálním pohybem a pak jede
	 * PLYNULE (drobné svislé chvění gesto neruší — ruší ho jen zřetelně svislý
	 * scroll); akce se potvrdí 160 ms po posledním pohybu (≈ puštění prstů). */
	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			if (disabled) return;
			const ax = Math.abs(e.deltaX);
			const ay = Math.abs(e.deltaY);
			if (!wheel.current.armed) {
				if (ax < 4 || ax <= ay) return;
				wheel.current.armed = true;
			} else if (ay > 12 && ay > 2 * ax) {
				// zřetelně svislý scroll během gesta = omyl → zrušit bez akce
				cancelWheel();
				return;
			}
			// obsah jede proti směru prstů (natural scroll)
			wheel.current.acc -= e.deltaX;
			emit(wheel.current.acc);
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			wheel.current.timer = setTimeout(() => {
				const dx = wheel.current.acc;
				wheel.current = { acc: 0, armed: false, timer: null };
				finish(dx);
			}, 160);
		},
		[disabled, emit, finish, cancelWheel],
	);

	/** Klik těsně po tahu ignorovat (prototyp _swBlock). */
	const swipedRecently = useCallback(() => Date.now() < blockUntil.current, []);

	return {
		handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel },
		swipedRecently,
	};
}
