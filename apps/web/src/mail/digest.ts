export type MailDigestThreadState = {
	personal: boolean;
	sent: boolean;
	draft: boolean;
	archived: boolean;
	trashed: boolean;
	spam: boolean;
	snoozed: boolean;
	muted: boolean;
	closed: boolean;
};

/** Společné stavové výluky pro osobní i týmový badge. */
export function countsAsUnread(state: MailDigestThreadState): boolean {
	return !(
		state.sent ||
		state.draft ||
		state.archived ||
		state.trashed ||
		state.spam ||
		state.snoozed ||
		state.muted ||
		state.closed
	);
}

/** Stejný explicitní týmový scope používá badge i veřejně popsané KPI ve Velínu. */
export function countsAsTeamUnread(state: MailDigestThreadState): boolean {
	return !state.personal && countsAsUnread(state);
}

export function belongsToActiveTeamInbox(state: MailDigestThreadState, group: string): boolean {
	return countsAsTeamUnread(state) && group === "inbox";
}

export const isUrgentMailFlag = (flag: string): boolean => flag === "p1" || flag === "p2";
