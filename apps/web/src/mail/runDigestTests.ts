import {
	belongsToActiveTeamInbox,
	countsAsTeamUnread,
	countsAsUnread,
	isUrgentMailFlag,
	type MailDigestThreadState,
} from "./digest";

const base: MailDigestThreadState = {
	personal: false,
	sent: false,
	draft: false,
	archived: false,
	trashed: false,
	spam: false,
	snoozed: false,
	muted: false,
	closed: false,
};
const check = (message: string, condition: boolean) => {
	if (!condition) throw new Error(message);
	console.log(`  ✓ ${message}`);
};

check("aktivní týmové vlákno se počítá jako nepřečtené", countsAsTeamUnread(base));
check("aktivní osobní vlákno zůstává v osobním badge", countsAsUnread({ ...base, personal: true }));
for (const field of Object.keys(base).filter((field) => field !== "personal") as (keyof MailDigestThreadState)[]) {
	check(`${field} je explicitně mimo KPI`, !countsAsTeamUnread({ ...base, [field]: true }));
}
check("osobní vlákno je mimo týmové KPI", !countsAsTeamUnread({ ...base, personal: true }));
check("jen skupina inbox patří do urgentního digestu", belongsToActiveTeamInbox(base, "inbox"));
check("archivní skupina do urgentního digestu nepatří", !belongsToActiveTeamInbox(base, "archiv"));
check("P1 i P2 jsou urgentní", isUrgentMailFlag("p1") && isUrgentMailFlag("p2"));
check("P3 a P4 nejsou urgentní", !isUrgentMailFlag("p3") && !isUrgentMailFlag("p4"));

console.log("Mail digest KPI scope testy prošly.");
