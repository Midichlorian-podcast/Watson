/**
 * Vyhledávání v poště — sdílená logika (operátory from:/schranka:/has:/is: +
 * fulltext přes předmět, snippet, odesílatele a těla). Vytaženo z dřívějšího
 * mail/SearchOverlay, aby STEJNÉ hledání pošty žilo v JEDNÉ globální paletě
 * (components/CommandPalette) — jeden vstup pro navigaci i poštu.
 */
import type { MailThread } from "./data";
import type { useMail } from "./state";

export interface MailHit {
	id: string;
	ini: string;
	from: string;
	subj: string;
	snip: string;
	mb: string;
	time: string;
}

type MailCtx = ReturnType<typeof useMail>;

/** Hity pošty pro dotaz (s operátory). Prázdný dotaz = žádné hity. Max `limit`. */
export function searchMailThreads(m: MailCtx, query: string, limit = 6): MailHit[] {
	const q = query.trim();
	if (!q) return [];
	const toks = q.toLowerCase().split(/\s+/);
	const terms: string[] = [];
	const ops = { from: null as string | null, mb: null as string | null, att: false, unread: false };
	for (const tk of toks) {
		if (tk.startsWith("from:")) ops.from = tk.slice(5);
		else if (tk.startsWith("schranka:") || tk.startsWith("mailbox:"))
			ops.mb = tk.split(":")[1] ?? "";
		else if (tk === "has:priloha" || tk === "has:attachment") ops.att = true;
		else if (tk === "is:neprectene" || tk === "is:unread") ops.unread = true;
		else terms.push(tk);
	}
	// Bez čistého fulltextu ani operátoru nemá smysl vracet celou schránku.
	if (terms.length === 0 && !ops.from && !ops.mb && !ops.att && !ops.unread) return [];

	const bodyOf = (t: MailThread): string =>
		t.msgs
			.map((msg) => (msg.body ?? []).join(" "))
			.concat((m.sentX[t.id] ?? []).map((msg) => msg.body.join(" ")))
			.join(" ");

	return m.threads
		.filter((t) => {
			const e = m.eff(t);
			if (e.trash) return false;
			if (ops.from && !`${t.from.n} ${t.from.addr}`.toLowerCase().includes(ops.from)) return false;
			if (ops.mb && !(t.personal ? "osobni" : (t.mb ?? "")).includes(ops.mb)) return false;
			if (ops.att && !t.att) return false;
			if (ops.unread && !(t.unread && !e.read)) return false;
			const hay = `${t.subj} ${t.snip} ${t.from.n} ${t.from.addr} ${bodyOf(t)}`.toLowerCase();
			return terms.every((x) => hay.includes(x));
		})
		.slice(0, limit)
		.map((t) => ({
			id: t.id,
			ini: t.from.ini,
			from: t.from.n,
			subj: t.subj,
			snip: m.ovOf(t.id).snip ?? t.snip,
			mb: t.personal ? "osobni" : (t.mb ?? "osobni"),
			time: m.ovOf(t.id).time ?? t.time,
		}));
}
