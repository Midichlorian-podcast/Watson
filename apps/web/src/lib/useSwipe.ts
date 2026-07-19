/**
 * Jednotný řádkový swipe pro mail i úkoly.
 *
 * - pointer (touch / stisk a tah): akce při skutečném puštění;
 * - trackpad (wheel): živý náhled a commit po krátkém klidu, protože webové
 *   wheel eventy nemají přenositelnou fázi „prsty zvednuty";
 * - horizontální wheel je připojen nativně jako non-passive, aby Safari ani
 *   Chromium neposouvaly současně celý viewport;
 * - r1/r2/l1/l2 jsou čtyři samostatné dosažitelné stavy.
 */
import { useCallback, useEffect, useRef } from "react";

export type SwipeMag = "none" | "r0" | "r1" | "r2" | "l0" | "l1" | "l2";
export type SwipeActionMag = "r1" | "r2" | "l1" | "l2";
export type SwipeSide = "l" | "r";

let gestureOwner: symbol | null = null;
export function claimGesture(id: symbol): boolean {
	if (gestureOwner && gestureOwner !== id) return false;
	gestureOwner = id;
	return true;
}
export function releaseGesture(id: symbol): void {
	if (gestureOwner === id) gestureOwner = null;
}

/** Krátké potažení (tier 1). */
export const SWIPE_SHORT = 110;
/** Velké potažení (tier 2). */
export const SWIPE_LONG = 260;
/** Klid trackpadu interpretovaný jako konec gesta. */
export const SWIPE_WHEEL_SETTLE_MS = 180;
/** Levý/pravý okraj necháváme systémovému back/forward gestu na dotyku. */
export const SWIPE_EDGE_GUARD = 18;

const ACTION_TIERS = new Set<SwipeMag>(["r1", "r2", "l1", "l2"]);

export const swipeMag = (dx: number): SwipeMag => {
	const distance = Math.abs(dx);
	if (distance < 16) return "none";
	const side = dx > 0 ? "r" : "l";
	if (distance < SWIPE_SHORT) return `${side}0` as SwipeMag;
	if (distance < SWIPE_LONG) return `${side}1` as SwipeMag;
	return `${side}2` as SwipeMag;
};

/** Gumový odpor až za velkým prahem; oba akční prahy tak zůstávají dosažitelné. */
export const swipeEase = (dx: number): number => {
	const distance = Math.abs(dx);
	return distance <= SWIPE_LONG ? dx : Math.sign(dx) * (SWIPE_LONG + (distance - SWIPE_LONG) * 0.2);
};

type VibratingNavigator = Navigator & {
	vibrate?: (pattern: number | number[]) => boolean;
};

/**
 * Haptika je progresivní vylepšení: Android/některá PWA zařízení ji provedou,
 * Safari/iOS Vibration API neposkytuje a bezpečně skončí vizuální odezvou.
 */
export const swipeBuzz = (kind: "threshold" | "commit" = "threshold"): void => {
	if (typeof navigator === "undefined") return;
	const vibratingNavigator = navigator as VibratingNavigator;
	if (typeof vibratingNavigator.vibrate !== "function") return;
	try {
		vibratingNavigator.vibrate(kind === "commit" ? 14 : 7);
	} catch {
		// Platforma haptiku odmítla; swipe musí zůstat plně funkční i bez ní.
	}
};

export function useSwipe(opts: {
	/** Živý vizuál během tahu — dx je po gumovém odporu. */
	onUpdate: (dx: number, mag: SwipeMag) => void;
	/** Dokončený tah přes jeden ze čtyř akčních prahů. */
	onSwipe: (mag: SwipeActionMag) => void;
	disabled?: boolean;
}) {
	const { onUpdate, onSwipe, disabled } = opts;
	const surfaceRef = useRef<HTMLDivElement>(null);
	const gid = useRef(Symbol("swipe"));
	const lastTier = useRef<SwipeMag>("none");
	const blockUntil = useRef(0);
	const pointer = useRef({
		tracking: false,
		active: false,
		pointerId: -1,
		startX: 0,
		startY: 0,
		dx: 0,
	});
	const wheel = useRef({
		acc: 0,
		armed: false,
		timer: null as ReturnType<typeof setTimeout> | null,
	});

	const emit = useCallback(
		(dx: number) => {
			const eased = swipeEase(dx);
			const mag = swipeMag(eased);
			if (ACTION_TIERS.has(mag) && mag !== lastTier.current) swipeBuzz("threshold");
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
				swipeBuzz("commit");
				onSwipe(mag);
			} else if (Math.abs(dx) > 16) {
				blockUntil.current = Date.now() + 350;
			}
		},
		[onUpdate, onSwipe],
	);

	const cancelWheel = useCallback(
		(resetVisual: boolean) => {
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			const wasArmed = wheel.current.armed;
			wheel.current = { acc: 0, armed: false, timer: null };
			lastTier.current = "none";
			if (wasArmed) releaseGesture(gid.current);
			if (resetVisual && wasArmed) onUpdate(0, "none");
		},
		[onUpdate],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (disabled || !event.isPrimary || (event.pointerType !== "touch" && event.button !== 0)) {
				return;
			}
			if (
				event.pointerType === "touch" &&
				(event.clientX <= SWIPE_EDGE_GUARD || window.innerWidth - event.clientX <= SWIPE_EDGE_GUARD)
			) {
				return;
			}
			cancelWheel(true);
			pointer.current = {
				tracking: true,
				active: false,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				dx: 0,
			};
		},
		[disabled, cancelWheel],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const current = pointer.current;
			if (!current.tracking || current.pointerId !== event.pointerId || disabled) return;
			if (event.pointerType !== "touch" && event.buttons !== 1) return;
			const dx = event.clientX - current.startX;
			const dy = event.clientY - current.startY;
			if (!current.active) {
				if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
				if (Math.abs(dx) <= Math.abs(dy)) {
					pointer.current.tracking = false;
					return;
				}
				if (!claimGesture(gid.current)) {
					pointer.current.tracking = false;
					return;
				}
				pointer.current.active = true;
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {
					// Capture pomáhá mimo řádek, ale není podmínkou funkčního gesta.
				}
			}
			event.preventDefault();
			pointer.current.dx = dx;
			emit(dx);
		},
		[disabled, emit],
	);

	const onPointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const current = pointer.current;
			if (!current.tracking || current.pointerId !== event.pointerId) return;
			pointer.current = {
				tracking: false,
				active: false,
				pointerId: -1,
				startX: 0,
				startY: 0,
				dx: 0,
			};
			if (current.active) finish(current.dx);
		},
		[finish],
	);

	const onPointerCancel = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const current = pointer.current;
			if (!current.tracking || current.pointerId !== event.pointerId) return;
			pointer.current = {
				tracking: false,
				active: false,
				pointerId: -1,
				startX: 0,
				startY: 0,
				dx: 0,
			};
			if (current.active) {
				releaseGesture(gid.current);
				lastTier.current = "none";
				blockUntil.current = Date.now() + 350;
				onUpdate(0, "none");
			}
		},
		[onUpdate],
	);

	const onWheel = useCallback(
		(event: WheelEvent) => {
			if (disabled) return;
			const horizontal = Math.abs(event.deltaX);
			const vertical = Math.abs(event.deltaY);
			if (!wheel.current.armed) {
				if (horizontal < 3 || horizontal <= vertical) return;
				if (!claimGesture(gid.current)) return;
				wheel.current.armed = true;
			} else if (vertical > 12 && vertical > horizontal * 2) {
				cancelWheel(true);
				return;
			}
			// Od chvíle, kdy je gesto rozpoznané jako horizontální, nesmí pokračovat
			// do Safari historie ani do celé stránky.
			event.preventDefault();
			wheel.current.acc -= event.deltaX;
			emit(wheel.current.acc);
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			wheel.current.timer = setTimeout(() => {
				const dx = wheel.current.acc;
				wheel.current = { acc: 0, armed: false, timer: null };
				finish(dx);
			}, SWIPE_WHEEL_SETTLE_MS);
		},
		[disabled, cancelWheel, emit, finish],
	);

	useEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) return;
		surface.addEventListener("wheel", onWheel, { passive: false });
		return () => surface.removeEventListener("wheel", onWheel);
	}, [onWheel]);

	useEffect(
		() => () => {
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			releaseGesture(gid.current);
		},
		[],
	);

	const swipedRecently = useCallback(() => Date.now() < blockUntil.current, []);

	return {
		surfaceRef,
		handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
		swipedRecently,
	};
}
