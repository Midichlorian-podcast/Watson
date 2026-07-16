export type ReminderItem = {
	type: string;
	remind_at: string | null;
	offset_min: number | null;
};

export type ReminderTiming = {
	startDate: string | null;
	dueDate: string | null;
};

export type ReminderCandidate =
	| { type: "relative"; offsetMin: number }
	| { type: "time"; remindAt: string };

export function reminderCandidateKey(candidate: ReminderCandidate): string {
	return candidate.type === "relative"
		? `relative:${candidate.offsetMin}`
		: `time:${new Date(candidate.remindAt).toISOString()}`;
}

export function reminderCandidateFireAt(
	candidate: ReminderCandidate,
	timing: ReminderTiming,
): number | null {
	return reminderFireAt(
		{
			type: candidate.type,
			remind_at: candidate.type === "time" ? candidate.remindAt : null,
			offset_min: candidate.type === "relative" ? candidate.offsetMin : null,
		},
		timing,
	);
}

export function reminderItemKey(reminder: ReminderItem): string | null {
	if (reminder.type === "relative" && reminder.offset_min != null) {
		return `relative:${reminder.offset_min}`;
	}
	if (reminder.type === "time" && reminder.remind_at) {
		const timestamp = new Date(reminder.remind_at);
		return Number.isNaN(timestamp.getTime()) ? null : `time:${timestamp.toISOString()}`;
	}
	return null;
}

export function hasEquivalentReminder(
	reminders: ReminderItem[],
	candidate: ReminderCandidate,
): boolean {
	const key = reminderCandidateKey(candidate);
	return reminders.some((reminder) => reminderItemKey(reminder) === key);
}

/**
 * Client-side mirror of the server worker's reminder base. It is used only for
 * ordering and explaining reminders; the server remains authoritative for firing.
 */
export function reminderFireAt(
	reminder: ReminderItem,
	timing: ReminderTiming,
): number | null {
	if (reminder.type === "relative") {
		const base = timing.startDate ?? timing.dueDate;
		if (!base || reminder.offset_min == null) return null;
		const baseTime = new Date(base).getTime();
		if (Number.isNaN(baseTime)) return null;
		return baseTime - reminder.offset_min * 60_000;
	}
	if (!reminder.remind_at) return null;
	const time = new Date(reminder.remind_at).getTime();
	return Number.isNaN(time) ? null : time;
}

export function sortReminders<T extends ReminderItem>(
	reminders: T[],
	timing: ReminderTiming,
): T[] {
	return [...reminders].sort((a, b) => {
		const aTime = reminderFireAt(a, timing);
		const bTime = reminderFireAt(b, timing);
		if (aTime == null && bTime == null) return 0;
		if (aTime == null) return 1;
		if (bTime == null) return -1;
		return aTime - bTime;
	});
}
