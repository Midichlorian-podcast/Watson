/**
 * Řádkový swipe — TŘI vstupy: dotyk (pointer touch), tažení myší/stiskem
 * jednoho prstu (pointer mouse + capture — gesto drží i mimo řádek a potvrdí
 * se puštěním tlačítka) a trackpad dvouprstý (horizontální wheel; konec gesta
 * web nehlásí → usazení 160 ms). Prahy malé 110 / velké 260 px, gumový odpor,
 * akce VÝHRADNĚ po dokončení gesta, svislý scroll wheel gesto ruší. Při
 * překročení prahu krátká vibrace (kde zařízení umí). Vizuál kreslí konzument
 * přes onUpdate(dx, mag).
 */
import { useCallback, useEffect, useRef } from "react";

export type SwipeMag = "none" | "r0" | "r1" | "r2" | "l0" | "l1" | "l2";

/* Globální vlastník gesta — v jednu chvíli smí táhnout JEN JEDEN řádek.
 * Bez toho kurzor sjíždějící přes řádky akumuloval na několika naráz a po
 * usazení vystřelily dvě akce (audit S1). Sdílí i mail modul. */
let gestureOwner: symbol | null = null;
export function claimGesture(id: symbol): boolean {
	if (gestureOwner && gestureOwner !== id) return false;
	gestureOwner = id;
	return true;
}
export function releaseGesture(id: symbol): void {
	if (gestureOwner === id) gestureOwner = null;
}

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
	const gid = useRef(Symbol("swipe"));

	// unmount: zrušit timer BEZ provedení akce a pustit vlastnictví gesta
	// (jinak akce „do zad" na odmountovaném řádku — audit S1)
	useEffect(() => {
		const w = wheel.current;
		const g = gid.current;
		return () => {
			if (w.timer) clearTimeout(w.timer);
			releaseGesture(g);
		};
	}, []);

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
			releaseGesture(gid.current);
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
		releaseGesture(gid.current);
		onUpdate(0, "none");
	}, [onUpdate]);

	// Tažení: dotyk hned; myš/jeden prst (stisk + tah) se aktivuje až po 6 px
	// do strany, aby nekolidoval s klikem — pak si vezme pointer capture,
	// takže gesto drží i mimo řádek/trackpad a potvrdí se AŽ puštěním.
	const ms = useRef({ startX: 0, startY: 0, active: false });
	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (disabled) return;
			if (e.pointerType === "touch") {
				if (!claimGesture(gid.current)) return;
				st.current = { startX: e.clientX, dx: 0, on: true };
			} else if (e.button === 0) {
				ms.current = { startX: e.clientX, startY: e.clientY, active: false };
				st.current = { startX: e.clientX, dx: 0, on: false };
			}
		},
		[disabled],
	);
	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (e.pointerType === "touch") {
				if (!st.current.on) return;
				st.current.dx = e.clientX - st.current.startX;
				emit(st.current.dx);
				return;
			}
			if (e.buttons !== 1 || disabled) return;
			const dx = e.clientX - ms.current.startX;
			const dy = e.clientY - ms.current.startY;
			if (!ms.current.active) {
				if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return;
				if (!claimGesture(gid.current)) return;
				ms.current.active = true;
				try {
					(e.currentTarget as Element).setPointerCapture(e.pointerId);
				} catch {
					/* capture není podmínkou gesta */
				}
			}
			e.preventDefault();
			st.current.dx = dx;
			emit(dx);
		},
		[emit, disabled],
	);
	const endPointer = useCallback(
		(e: React.PointerEvent) => {
			if (e.pointerType === "touch") {
				if (!st.current.on) return;
				st.current.on = false;
				finish(st.current.dx);
				st.current.dx = 0;
				return;
			}
			if (!ms.current.active) return;
			ms.current.active = false;
			finish(st.current.dx);
			st.current.dx = 0;
		},
		[finish],
	);
	const onPointerUp = endPointer;
	const onPointerCancel = endPointer;

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
				if (!claimGesture(gid.current)) return;
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
