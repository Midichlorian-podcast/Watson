export const MAIL_SWIPE_SLOTS = ["r1", "r2", "l1", "l2"] as const;
export type MailSwipeSlot = (typeof MAIL_SWIPE_SLOTS)[number];

export const MAIL_SWIPE_ACTIONS = [
	"read",
	"pin",
	"archive",
	"snooze",
	"done",
	"trash",
	"assign",
	"set_aside",
	"none",
] as const;
export type MailSwipeAction = (typeof MAIL_SWIPE_ACTIONS)[number];

export type MailSwipeConfig = Record<MailSwipeSlot, MailSwipeAction>;

/**
 * Bezpečný výchozí triage: dvě nejčastější akce jsou na pravé straně,
 * odstranění není ve výchozím mapování a všechny akce jsou stavově reverzní.
 */
export const DEFAULT_MAIL_SWIPE_CONFIG: MailSwipeConfig = {
	r1: "read",
	r2: "pin",
	l1: "archive",
	l2: "snooze",
};

const ACTION_SET = new Set<string>(MAIL_SWIPE_ACTIONS);

export function normalizeMailSwipeConfig(value: unknown): MailSwipeConfig {
	if (!value || typeof value !== "object") return { ...DEFAULT_MAIL_SWIPE_CONFIG };
	const raw = value as Record<string, unknown>;
	return Object.fromEntries(
		MAIL_SWIPE_SLOTS.map((slot) => {
			const action = raw[slot];
			return [
				slot,
				typeof action === "string" && ACTION_SET.has(action)
					? action
					: DEFAULT_MAIL_SWIPE_CONFIG[slot],
			];
		}),
	) as MailSwipeConfig;
}

export function mailSwipeSlotSide(slot: MailSwipeSlot): "left" | "right" {
	return slot.startsWith("r") ? "right" : "left";
}

export function mailSwipeSlotDistance(slot: MailSwipeSlot): "short" | "long" {
	return slot.endsWith("1") ? "short" : "long";
}
