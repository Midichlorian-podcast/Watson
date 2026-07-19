/**
 * Jednotný řádkový swipe pro mail i úkoly.
 *
 * - pointer (touch / stisk a tah): akce při skutečném puštění;
 * - trackpad (wheel): živý náhled, zřetelný bezpečnostní přesah a commit až po
 *   delším klidu, protože webové wheel eventy nemají fázi „prsty zvednuty";
 * - horizontální wheel je připojen nativně jako non-passive, aby Safari ani
 *   Chromium neposouvaly současně celý viewport;
 * - r1/r2/l1/l2 jsou čtyři samostatné dosažitelné stavy.
 */
import { useCallback, useEffect, useRef } from "react";

export type SwipeMag = "none" | "r0" | "r1" | "r2" | "l0" | "l1" | "l2";
export type SwipeActionMag = "r1" | "r2" | "l1" | "l2";
export type SwipeSide = "l" | "r";
export type SwipePhase = "tracking" | "settling" | "committing";

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
/** Klid trackpadu interpretovaný jako konec gesta. Mikro-pauza nesmí provést akci. */
export const SWIPE_WHEEL_SETTLE_MS = 600;
/** Wheel nemá release, proto musí zřetelně přejet za náhledový práh. */
export const SWIPE_WHEEL_SHORT_COMMIT = SWIPE_SHORT + 28;
export const SWIPE_WHEEL_LONG_COMMIT = SWIPE_LONG + 32;
export const SWIPE_COMMIT_ANIMATION_MS = 220;
export const SWIPE_HYSTERESIS = 14;
export const SWIPE_WHEEL_AXIS_RATIO = 1.6;
export const SWIPE_WHEEL_MAX_DELTA = 42;
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

/** Stabilizuje stav kolem hranice: drobné vrácení prstů nesmí rychle přepínat akce. */
export const swipeMagWithHysteresis = (dx: number, previous: SwipeMag): SwipeMag => {
	const next = swipeMag(dx);
	const distance = Math.abs(dx);
	const side = dx >= 0 ? "r" : "l";
	if (!previous.startsWith(side)) return next;
	if (previous.endsWith("2") && distance >= SWIPE_LONG - SWIPE_HYSTERESIS) return previous;
	if (
		previous.endsWith("1") &&
		distance >= SWIPE_SHORT - SWIPE_HYSTERESIS &&
		distance < SWIPE_LONG + SWIPE_HYSTERESIS
	)
		return previous;
	return next;
};

export const clampSwipeWheelDelta = (delta: number): number =>
	Math.sign(delta) * Math.min(Math.abs(delta), SWIPE_WHEEL_MAX_DELTA);

/** Trackpadový commit je úmyslně přísnější než náhled; release u něj web nezná. */
export const swipeWheelCommitMag = (dx: number): SwipeActionMag | null => {
	const distance = Math.abs(dx);
	const side = dx > 0 ? "r" : "l";
	if (distance >= SWIPE_WHEEL_LONG_COMMIT) return `${side}2` as SwipeActionMag;
	if (distance >= SWIPE_LONG) return null;
	if (distance >= SWIPE_WHEEL_SHORT_COMMIT) return `${side}1` as SwipeActionMag;
	return null;
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
	onUpdate: (dx: number, mag: SwipeMag, phase: SwipePhase) => void;
	/** Dokončený tah přes jeden ze čtyř akčních prahů. */
	onSwipe: (mag: SwipeActionMag) => void;
	disabled?: boolean;
}) {
	const { onUpdate, onSwipe, disabled } = opts;
	const surfaceRef = useRef<HTMLDivElement>(null);
	const gid = useRef(Symbol("swipe"));
	const lastTier = useRef<SwipeMag>("none");
	const blockUntil = useRef(0);
	const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const committing = useRef(false);
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

	const pulse = useCallback((kind: "threshold" | "commit") => {
		const surface = surfaceRef.current;
		if (!surface) return;
		if (pulseTimer.current) clearTimeout(pulseTimer.current);
		surface.setAttribute("data-swipe-pulse", kind);
		pulseTimer.current = setTimeout(() => {
			surfaceRef.current?.removeAttribute("data-swipe-pulse");
			pulseTimer.current = null;
		}, kind === "commit" ? 180 : 130);
	}, []);

	const emit = useCallback(
		(dx: number) => {
			const eased = swipeEase(dx);
			const mag = swipeMagWithHysteresis(dx, lastTier.current);
			if (ACTION_TIERS.has(mag) && mag !== lastTier.current) {
				swipeBuzz("threshold");
				pulse("threshold");
			}
			lastTier.current = mag;
			onUpdate(eased, mag, "tracking");
		},
		[onUpdate, pulse],
	);

	const finish = useCallback(
		(dx: number, source: "pointer" | "wheel") => {
			releaseGesture(gid.current);
			const previewMag = swipeMagWithHysteresis(dx, lastTier.current);
			const mag =
				source === "wheel"
					? swipeWheelCommitMag(dx)
					: previewMag === "r1" ||
							previewMag === "r2" ||
							previewMag === "l1" ||
							previewMag === "l2"
						? previewMag
						: null;
			if (!mag) {
				lastTier.current = "none";
				onUpdate(0, "none", "settling");
				if (Math.abs(dx) > 16) blockUntil.current = Date.now() + 350;
				return;
			}
			committing.current = true;
			blockUntil.current = Date.now() + SWIPE_COMMIT_ANIMATION_MS + 400;
			swipeBuzz("commit");
			pulse("commit");
			const width = surfaceRef.current?.clientWidth ?? SWIPE_LONG * 2;
			onUpdate((mag.startsWith("r") ? 1 : -1) * (width + 32), mag, "committing");
			commitTimer.current = setTimeout(() => {
				commitTimer.current = null;
				onSwipe(mag);
				committing.current = false;
				lastTier.current = "none";
				onUpdate(0, "none", "settling");
			}, SWIPE_COMMIT_ANIMATION_MS);
		},
		[onUpdate, onSwipe, pulse],
	);

	const cancelWheel = useCallback(
		(resetVisual: boolean) => {
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			const wasArmed = wheel.current.armed;
			wheel.current = { acc: 0, armed: false, timer: null };
			lastTier.current = "none";
			if (wasArmed) releaseGesture(gid.current);
			if (resetVisual && wasArmed) onUpdate(0, "none", "settling");
		},
		[onUpdate],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (
				disabled ||
				committing.current ||
				!event.isPrimary ||
				(event.pointerType !== "touch" && event.button !== 0)
			) {
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
				if (Math.abs(dx) <= Math.abs(dy) * 1.25) {
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
			if (current.active) finish(current.dx, "pointer");
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
				onUpdate(0, "none", "settling");
			}
		},
		[onUpdate],
	);

	const onWheel = useCallback(
		(event: WheelEvent) => {
			if (disabled || committing.current) return;
			const horizontal = Math.abs(event.deltaX);
			const vertical = Math.abs(event.deltaY);
			// Safari si může začít rezervovat back/forward gesto dřív, než dosáhneme
			// akčního prahu. Jasně horizontální delta se proto zastaví už v capture fázi.
			if (horizontal > vertical && horizontal > 0) event.preventDefault();
			if (!wheel.current.armed) {
				if (horizontal < 6 || horizontal < vertical * SWIPE_WHEEL_AXIS_RATIO) return;
				if (!claimGesture(gid.current)) return;
				wheel.current.armed = true;
			} else if (vertical > 10 && vertical >= horizontal) {
				cancelWheel(true);
				return;
			}
			// Od chvíle, kdy je gesto rozpoznané jako horizontální, nesmí pokračovat
			// do Safari historie ani do celé stránky.
			event.preventDefault();
			wheel.current.acc -= clampSwipeWheelDelta(event.deltaX);
			emit(wheel.current.acc);
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			wheel.current.timer = setTimeout(() => {
				const dx = wheel.current.acc;
				wheel.current = { acc: 0, armed: false, timer: null };
				finish(dx, "wheel");
			}, SWIPE_WHEEL_SETTLE_MS);
		},
		[disabled, cancelWheel, emit, finish],
	);

	useEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) return;
		surface.addEventListener("wheel", onWheel, { passive: false, capture: true });
		return () => surface.removeEventListener("wheel", onWheel, { capture: true });
	}, [onWheel]);

	useEffect(
		() => () => {
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			if (commitTimer.current) clearTimeout(commitTimer.current);
			if (pulseTimer.current) clearTimeout(pulseTimer.current);
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
