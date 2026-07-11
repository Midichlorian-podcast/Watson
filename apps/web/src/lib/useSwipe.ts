/**
 * Řádkový swipe — JEDNOTNÝ systém pro úkoly i mail (feedback 2026-07-11,
 * 3 kola ladění). Tvrdé pravidlo: AKCE SE PROVEDE VÝHRADNĚ TAŽENÍM
 * A NÁSLEDNÝM PUŠTĚNÍM, nebo klikem na tlačítko. Nikdy „samovolně po čase".
 *
 * Tři vstupy:
 *  · dotyk (pointer touch) — akce na zvednutí prstů dle prahu;
 *  · stisk + tah (myš / jeden prst na trackpadu) — pointer capture, akce
 *    na puštění tlačítka;
 *  · dvouprstý trackpad (wheel) — web NEUMÍ poznat zvednutí prstů, proto
 *    wheel NIKDY neprovádí akci: po usazení (200 ms) řádek buď zaskočí
 *    zpět (malý tah), nebo se UKOTVÍ otevřený (LATCH) a akce dané strany
 *    se zobrazí jako klikací tlačítka. Klik mimo / Esc / svislý scroll
 *    kotvu zavře bez akce.
 *
 * Prahy: malé potažení 110 px (tier 1) / velké 260 px (tier 2); kotva od
 * 66 px. Gumový odpor za velkým prahem, vibrace při překročení prahu (kde
 * zařízení umí). Vizuál kreslí konzument přes onUpdate(dx, mag) a stav
 * kotvy dostává přes onLatch(side|null).
 */
import { useCallback, useEffect, useRef } from "react";

export type SwipeMag = "none" | "r0" | "r1" | "r2" | "l0" | "l1" | "l2";
export type SwipeSide = "l" | "r";

/* Globální vlastník gesta — v jednu chvíli smí táhnout JEN JEDEN řádek.
 * Bez toho kurzor sjíždějící přes řádky akumuloval na několika naráz a po
 * dokončení vystřelily dvě akce (audit S1). Sdílí i mail modul. */
let gestureOwner: symbol | null = null;
export function claimGesture(id: symbol): boolean {
	if (gestureOwner && gestureOwner !== id) return false;
	gestureOwner = id;
	return true;
}
export function releaseGesture(id: symbol): void {
	if (gestureOwner === id) gestureOwner = null;
}

/** Malé potažení (tier 1). */
export const SWIPE_SHORT = 110;
/** Velké potažení (tier 2). */
export const SWIPE_LONG = 260;
/** Od kolika px se wheel gesto ukotví (místo akce). */
const LATCH_MIN = 66;
/** Odsazení ukotveného řádku — dost místa pro dvě tlačítka. */
export const SWIPE_LATCH_OFF = 148;

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
	/** Dokončený TAH (dotyk/stisk) přes práh — provádí akci. */
	onSwipe: (mag: "r1" | "r2" | "l1" | "l2") => void;
	/** Ukotvení po wheel gestu — konzument zobrazí klikací tlačítka strany. */
	onLatch?: (side: SwipeSide | null) => void;
	disabled?: boolean;
}) {
	const { onUpdate, onSwipe, onLatch, disabled } = opts;
	const st = useRef({ startX: 0, dx: 0, on: false });
	const wheel = useRef({
		acc: 0,
		armed: false,
		timer: null as ReturnType<typeof setTimeout> | null,
	});
	const latched = useRef<SwipeSide | null>(null);
	const lastTier = useRef<SwipeMag>("none");
	const blockUntil = useRef(0);
	const gid = useRef(Symbol("swipe"));

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

	/** Zavřít kotvu (bez akce) — klik mimo, Esc, svislý scroll, nové gesto. */
	const unlatch = useCallback(() => {
		if (!latched.current) return;
		latched.current = null;
		lastTier.current = "none";
		releaseGesture(gid.current);
		onLatch?.(null);
		onUpdate(0, "none");
	}, [onLatch, onUpdate]);

	// klik mimo / Esc zavírá kotvu — listenery jen dokud je ukotveno
	const unlatchRef = useRef(unlatch);
	unlatchRef.current = unlatch;
	const docListeners = useRef(false);
	const attachDocListeners = useCallback(() => {
		if (docListeners.current) return;
		docListeners.current = true;
		const onClick = () => {
			unlatchRef.current();
			detach();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				unlatchRef.current();
				detach();
			}
		};
		function detach() {
			docListeners.current = false;
			document.removeEventListener("click", onClick);
			document.removeEventListener("keydown", onKey);
		}
		// až po doběhnutí aktuálního kliknutí (jinak by kotvu hned zavřel)
		setTimeout(() => {
			if (!latched.current) return;
			document.addEventListener("click", onClick);
			document.addEventListener("keydown", onKey);
		}, 0);
	}, []);

	/** Dokončený TAH (dotyk/stisk) — jediná cesta, která akci provádí sama. */
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

	// unmount: zrušit timer BEZ provedení akce a pustit vlastnictví gesta
	useEffect(() => {
		const w = wheel.current;
		const g = gid.current;
		return () => {
			if (w.timer) clearTimeout(w.timer);
			releaseGesture(g);
		};
	}, []);

	// Tažení: dotyk hned; myš/jeden prst (stisk + tah) se aktivuje až po 6 px
	// do strany, aby nekolidoval s klikem — pak si vezme pointer capture,
	// takže gesto drží i mimo řádek/trackpad a potvrdí se AŽ puštěním.
	const ms = useRef({ startX: 0, startY: 0, active: false });
	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (disabled) return;
			if (latched.current) unlatch();
			if (e.pointerType === "touch") {
				if (!claimGesture(gid.current)) return;
				st.current = { startX: e.clientX, dx: 0, on: true };
			} else if (e.button === 0) {
				ms.current = { startX: e.clientX, startY: e.clientY, active: false };
				st.current = { startX: e.clientX, dx: 0, on: false };
			}
		},
		[disabled, unlatch],
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

	/** Trackpad (wheel): plynulý náhled; po usazení NIKDY akce — jen kotva
	 * s klikacími tlačítky (od 66 px), jinak návrat. Zvednutí prstů web
	 * nepozná, proto tudy žádná akce nesmí projít. */
	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			if (disabled) return;
			const ax = Math.abs(e.deltaX);
			const ay = Math.abs(e.deltaY);
			if (latched.current) {
				// svislý scroll zavírá kotvu; horizontální ji nechává být
				if (ay > ax) unlatch();
				return;
			}
			if (!wheel.current.armed) {
				if (ax < 4 || ax <= ay) return;
				if (!claimGesture(gid.current)) return;
				wheel.current.armed = true;
			} else if (ay > 12 && ay > 2 * ax) {
				// zřetelně svislý scroll během gesta = omyl → zrušit bez akce
				if (wheel.current.timer) clearTimeout(wheel.current.timer);
				wheel.current = { acc: 0, armed: false, timer: null };
				lastTier.current = "none";
				releaseGesture(gid.current);
				onUpdate(0, "none");
				return;
			}
			// obsah jede proti směru prstů (natural scroll)
			wheel.current.acc -= e.deltaX;
			emit(wheel.current.acc);
			if (wheel.current.timer) clearTimeout(wheel.current.timer);
			wheel.current.timer = setTimeout(() => {
				const dx = wheel.current.acc;
				wheel.current = { acc: 0, armed: false, timer: null };
				if (Math.abs(dx) >= LATCH_MIN) {
					// UKOTVIT — akci provede až klik na tlačítko
					const side: SwipeSide = dx > 0 ? "r" : "l";
					latched.current = side;
					lastTier.current = "none";
					blockUntil.current = Date.now() + 350;
					onUpdate(side === "r" ? SWIPE_LATCH_OFF : -SWIPE_LATCH_OFF, "none");
					onLatch?.(side);
					attachDocListeners();
				} else {
					lastTier.current = "none";
					releaseGesture(gid.current);
					onUpdate(0, "none");
				}
			}, 200);
		},
		[disabled, emit, onUpdate, onLatch, unlatch, attachDocListeners],
	);

	/** Klik těsně po tahu ignorovat (prototyp _swBlock). */
	const swipedRecently = useCallback(
		() => Date.now() < blockUntil.current || latched.current !== null,
		[],
	);

	return {
		handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel },
		swipedRecently,
		unlatch,
	};
}
