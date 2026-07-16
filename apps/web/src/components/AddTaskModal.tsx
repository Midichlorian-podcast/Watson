import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { Icon, type IconName } from "@watson/ui";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { logTaskActivity } from "../lib/activity";
import { API_URL } from "../lib/api";
import {
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_MAX_SELECTION,
	AttachmentApiError,
	attachmentSizeLabel,
	cancelAttachmentStage,
	finalizeAttachment,
	rememberAttachmentFinalization,
	stageAttachment,
} from "../lib/attachments";
import { useSession } from "../lib/auth-client";
import { USER_COLORS } from "../lib/colors";
import { initials } from "../lib/format";
import type { ChainRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import type { Highlight, RecurrenceRule } from "../lib/quickadd";
import { parseQuick } from "../lib/quickadd";
import { todayISO } from "../lib/tasks";
import { deviceTimeZone, zonedDateTimeToIso } from "../lib/timeZone";
import { showToast } from "../lib/toast";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useWorkspace } from "../lib/workspace";

/**
 * Přidat úkol — 1:1 port ADD MODAL z prototypu (WatsonApp.dc.html ř. 1673–1889 + draftView
 * ř. 2937–3003): titulek se zvýrazněním tokenů, našeptávač #projekt/@osoba, chipy polí
 * s jedním sdíleným popover panelem, footer s nápovědou parseru a validací deadline.
 */

type DateKind = "dnes" | "zitra" | "pristi" | "pmonth" | "none" | "custom";
type RepeatKind = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
type PopKey =
	| ""
	| "projekt"
	| "termin"
	| "priorita"
	| "prirazeni"
	| "trvani"
	| "deadline"
	| "opakovani"
	| "barva"
	| "priloha"
	| "postup";

interface Draft {
	rawName: string;
	name: string;
	highlights: Highlight[];
	desc: string;
	descOpen: boolean;
	project: string | null;
	priority: 1 | 2 | 3 | 4;
	assignees: string[];
	assignMode: "any" | "all";
	dateKind: DateKind;
	customDate: string;
	time: string;
	duration: number;
	days: number;
	repeat: RepeatKind;
	repeatRule: RecurrenceRule | null;
	repeatLabel: string;
	repeatEndKind: "never" | "until" | "count";
	repeatUntil: string;
	repeatCount: number;
	repeatShowAll: boolean;
	color: string; // "none" | hex z USER_COLORS
	deadline: string;
	flowAttach: string;
	pop: PopKey;
	more: boolean;
	suggestIdx: number;
	projQuery: string;
}

const freshDraft = (project: string | null): Draft => ({
	rawName: "",
	name: "",
	highlights: [],
	desc: "",
	descOpen: false,
	project,
	priority: 2,
	assignees: [],
	assignMode: "any",
	// Výchozí = BEZ termínu (uživatel: nový úkol nemá být defaultně „dnes"). Kontextové
	// otevření (kalendář/den) termín dodá přes `initial.date`; „Dnes" jde vybrat ručně.
	dateKind: "none",
	customDate: "",
	time: "",
	duration: 0,
	days: 1,
	repeat: "none",
	repeatRule: null,
	repeatLabel: "",
	repeatEndKind: "never",
	repeatUntil: "",
	repeatCount: 10,
	repeatShowAll: true,
	color: "none",
	deadline: "",
	flowAttach: "",
	pop: "",
	more: false,
	suggestIdx: 0,
	projQuery: "",
});

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoAddDays = (iso: string, n: number) => {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const nextMondayISO = (today: string) => {
	const d = new Date(`${today}T00:00:00`);
	let add = (1 - d.getDay() + 7) % 7;
	if (add === 0) add = 7;
	return isoAddDays(today, add);
};
const firstNextMonthISO = (today: string) => {
	const d = new Date(`${today}T00:00:00`);
	const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
	const m = (d.getMonth() + 1) % 12;
	return `${y}-${pad2(m + 1)}-01`;
};
/** „25. 6." z ISO. */
const dmLabel = (iso: string) => `${+iso.slice(8, 10)}. ${+iso.slice(5, 7)}.`;
/** „do 5. 7." (+rok, pokud jiný než letos) — deadlineFmt prototypu. */
const deadlineFmt = (iso: string, today: string) =>
	iso
		? `do ${+iso.slice(8, 10)}. ${+iso.slice(5, 7)}.${
				iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ""
			}`
		: "";
const durFmt = (min: number) => {
	if (!min) return "";
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return `${h} h${m ? ` ${m} min` : ""}`;
};

/** Pracovní termín draftu (termISO prototypu) — null = bez termínu. */
function termISO(d: Draft, today: string): string | null {
	switch (d.dateKind) {
		case "none":
			return null;
		case "custom":
			return d.customDate || null;
		case "zitra":
			return isoAddDays(today, 1);
		case "pristi":
			return nextMondayISO(today);
		case "pmonth":
			return firstNextMonthISO(today);
		default:
			return today;
	}
}

/** Segmenty rawName pro overlay zvýraznění. */
function segments(raw: string, hl: Highlight[]) {
	const segs: { text: string; mark: boolean; start: number }[] = [];
	let pos = 0;
	for (const h of [...hl].sort((a, b) => a.start - b.start)) {
		if (h.start > pos) segs.push({ text: raw.slice(pos, h.start), mark: false, start: pos });
		segs.push({ text: raw.slice(h.start, h.end), mark: true, start: h.start });
		pos = h.end;
	}
	if (pos < raw.length) segs.push({ text: raw.slice(pos), mark: false, start: pos });
	if (segs.length === 0) segs.push({ text: raw, mark: false, start: 0 });
	return segs;
}

type Member = { id: string; name: string };

/* ── mikro-komponenty popoverů (styly 1:1 dle prototypu) ─────────────── */

/** data-chip — obdélníkový chip v popoveru; on = brass-soft + brass okraj. */
function ChipBtn({
	on,
	onClick,
	children,
	style,
}: {
	on: boolean;
	onClick: () => void;
	children: ReactNode;
	style?: CSSProperties;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="min-h-11 cursor-pointer font-display font-semibold hover:border-brass md:min-h-0"
			style={{
				fontSize: 12,
				padding: "6px 12px",
				borderRadius: 9,
				border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
				background: on ? "var(--w-brass-soft)" : "transparent",
				color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
				...style,
			}}
		>
			{children}
		</button>
	);
}

/** data-addpill — chip pole v hlavní řadě. */
function FieldPill({
	on,
	onClick,
	icon,
	dot,
	sw,
	label,
}: {
	on: boolean;
	onClick: () => void;
	icon: IconName;
	dot?: string | null;
	sw?: string | null;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex min-h-11 cursor-pointer items-center font-display font-semibold hover:border-brass md:min-h-0"
			style={{
				gap: 6,
				fontSize: 12.5,
				padding: "6px 11px",
				borderRadius: 9,
				border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
				background: on ? "var(--w-brass-soft)" : "transparent",
				color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
				transition: "border-color .12s, background .12s",
			}}
		>
			{dot ? (
				<span className="shrink-0 rounded-full" style={{ width: 8, height: 8, background: dot }} />
			) : sw ? (
				<span
					className="shrink-0"
					style={{ width: 11, height: 11, borderRadius: 3, background: sw }}
				/>
			) : (
				<Icon name={icon} size={16} />
			)}
			{label}
		</button>
	);
}

/* ── modal ────────────────────────────────────────────────────────────── */

export function AddTaskModal({
	onClose,
	initial,
}: {
	onClose: () => void;
	/** Předvyplnění z kalendáře (openAddAt): datum/čas/trvání. */
	initial?: {
		capture?: boolean;
		date?: string;
		time?: string;
		duration?: number;
		days?: number;
		projectId?: string;
		parentId?: string;
		parentName?: string;
	};
}) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const today = todayISO();
	const allProjects = useProjects();
	const { activeWs } = useWorkspace();

	// Projekty aktivního prostoru (prototyp: inWS filtr); fallback všechny.
	const projects = useMemo(() => {
		const ws = allProjects.filter((p) => !activeWs || p.workspace_id === activeWs);
		return ws.length ? ws : allProjects;
	}, [allProjects, activeWs]);
	const inbox = useMemo(
		() => projects.find((p) => p.name === "Doručené" || p.name === "Inbox") ?? projects[0],
		[projects],
	);

	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as Member[];
		},
	});
	const people = useMemo(
		() =>
			(team ?? []).map((m) => ({
				id: m.id,
				name: m.name,
				initials: initials(m.name),
			})),
		[team],
	);

	// Běžící postupy pro „Postup" chip (prototyp: hasFlowsC → addFieldsMore.push(postup)).
	const { data: chains } = usePsQuery<ChainRow>(
		"SELECT * FROM chains WHERE state IS NULL OR state != 'done' ORDER BY created_at DESC",
	);
	const flowOptions = chains ?? [];

	const [draft, setDraft] = useState<Draft>(() => {
		const d = freshDraft(null);
		if (initial?.date) {
			if (initial.date === today) d.dateKind = "dnes";
			else {
				d.dateKind = "custom";
				d.customDate = initial.date;
			}
		}
		if (initial?.time) d.time = initial.time;
		if (initial?.duration) d.duration = initial.duration;
		if (initial?.days && initial.days > 1) d.days = initial.days;
		if (initial?.projectId) d.project = initial.projectId;
		return d;
	});
	const [captureMode, setCaptureMode] = useState(Boolean(initial?.capture));
	const [files, setFiles] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	// Výchozí projekt = inbox (R8), jakmile jsou projekty načtené.
	useEffect(() => {
		if (!draft.project && inbox) setDraft((d) => ({ ...d, project: d.project ?? inbox.id }));
	}, [inbox, draft.project]);

	const patch = (obj: Partial<Draft>) => setDraft((d) => ({ ...d, ...obj }));

	const taRef = useRef<HTMLTextAreaElement>(null);
	const trapRef = useFocusTrap<HTMLDivElement>(true);
	// In-flight zámek — dvojklik/dvojí Enter jinak projde guardem a vytvoří dva úkoly.
	const submitting = useRef(false);
	useEffect(() => {
		taRef.current?.focus();
	}, []);
	// Esc: zavřít popover/našeptávač, pak modal — jen když nad modalem není vyšší vrstva
	// (tahák/⌘K nesou [data-esc-layer]; Esc kaskáda zavírá po jedné, prototyp ř. 2213).
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (document.querySelector("[data-esc-layer]:not([data-add-layer])")) return;
			// Esc kaskáda: nejdřív zavři otevřený field popover, teprve pak celý modal —
			// jinak by první Esc s otevřeným popoverem zahodil celý rozepsaný draft.
			if (draft.pop !== "") {
				setDraft((d) => ({ ...d, pop: "" }));
				return;
			}
			onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, draft.pop]);

	const parseCtx = useMemo(
		() => ({
			today,
			projects: projects.map((p) => ({ id: p.id, name: p.name ?? "" })),
			people,
		}),
		[today, projects, people],
	);

	/** draftName prototypu — reparse celého textu, patch jen rozpoznaných polí. */
	function onName(v: string) {
		const parsed = parseQuick(v, parseCtx);
		const p: Partial<Draft> = {
			rawName: v,
			name: parsed.name,
			highlights: parsed.highlights,
		};
		if (parsed.priority) p.priority = parsed.priority;
		if (parsed.startMin != null)
			p.time = `${pad2(Math.floor(parsed.startMin / 60))}:${pad2(parsed.startMin % 60)}`;
		if (parsed.durationMin != null) p.duration = parsed.durationMin;
		if (parsed.days) p.days = parsed.days;
		if (parsed.deadline) p.deadline = parsed.deadline;
		if (parsed.projectId) p.project = parsed.projectId;
		if (parsed.due) {
			if (parsed.due === today) p.dateKind = "dnes";
			else if (parsed.due === isoAddDays(today, 1)) p.dateKind = "zitra";
			else {
				p.dateKind = "custom";
				p.customDate = parsed.due;
			}
		}
		if (parsed.recurrence) {
			const r = parsed.recurrence;
			p.repeatRule = r;
			p.repeatLabel = r.label;
			p.repeat =
				r.kind === "monthly-nth" || r.kind === "monthly-day" ? "monthly" : (r.kind as RepeatKind);
		}
		patch({ ...p, suggestIdx: 0 });
	}

	// Našeptávač: #projekt / @osoba token na konci vstupu.
	const suggest = useMemo(() => {
		const mPer = draft.rawName.match(/[@+](\p{L}{1,})$/u);
		const mProj = draft.rawName.match(/#(\p{L}{1,})$/u);
		if (mPer) {
			const q = (mPer[1] ?? "").toLowerCase();
			const list = people
				.filter((p) => p.name.toLowerCase().includes(q) || p.initials.toLowerCase().startsWith(q))
				.slice(0, 5)
				.map((p) => ({
					id: p.id,
					isProj: false,
					initials: p.initials,
					name: p.name,
					action: t("addmodal.sugAssign"),
					token: mPer[0] ?? "",
				}));
			return list.length ? list : null;
		}
		if (mProj) {
			const q = (mProj[1] ?? "").toLowerCase();
			const list = projects
				.filter((p) => (p.name ?? "").toLowerCase().includes(q))
				.slice(0, 6)
				.map((p) => ({
					id: p.id,
					isProj: true,
					initials: "",
					name: p.name ?? "",
					action: t("addmodal.sugProject"),
					token: mProj[0] ?? "",
				}));
			return list.length ? list : null;
		}
		return null;
	}, [draft.rawName, people, projects, t]);

	/** pickSuggest/pickProject prototypu — odřízne token, reparse, aplikuje výběr. */
	function pickSug(item: { id: string; isProj: boolean; token: string }) {
		const raw = draft.rawName;
		const idx = raw.lastIndexOf(item.token);
		const nraw = `${(idx >= 0 ? raw.slice(0, idx) : raw).replace(/\s+$/, "")} `;
		const parsed = parseQuick(nraw, parseCtx);
		if (item.isProj) {
			patch({
				rawName: nraw,
				name: parsed.name,
				highlights: parsed.highlights,
				project: item.id,
				suggestIdx: 0,
			});
		} else {
			const assignees = draft.assignees.includes(item.id)
				? draft.assignees
				: [...draft.assignees, item.id];
			patch({
				rawName: nraw,
				name: parsed.name,
				highlights: parsed.highlights,
				assignees,
				suggestIdx: 0,
			});
		}
		taRef.current?.focus();
	}

	function onNameKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
		if (suggest?.length) {
			const n = suggest.length;
			const i = draft.suggestIdx;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				patch({ suggestIdx: (i + 1) % n });
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				patch({ suggestIdx: (i - 1 + n) % n });
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const it = suggest[i] ?? suggest[0];
				if (it) pickSug(it);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				patch({ rawName: `${draft.rawName} ` });
				return;
			}
		}
		if (e.key === "Enter") {
			e.preventDefault();
			if (e.metaKey || e.ctrlKey || !suggest) void submit();
		}
	}

	/* ── odvozené view hodnoty (draftView prototypu) ── */
	const selProject = projects.find((p) => p.id === draft.project);
	const tISO = termISO(draft, today);
	const deadlineBad = !!(draft.deadline && tISO && draft.deadline < tISO);
	const richActive = !!(
		draft.repeatRule &&
		(draft.repeatRule.weekday != null ||
			draft.repeatRule.day != null ||
			draft.repeatRule.nth != null ||
			draft.repeatRule.parity != null ||
			draft.repeatRule.kind === "yearly")
	);
	const hasRep = draft.repeat !== "none" || richActive;
	const nAssign = draft.assignees.length;
	const repLbl: Record<RepeatKind, string> = {
		none: t("addmodal.repNone"),
		daily: t("addmodal.repDaily"),
		weekly: t("addmodal.repWeekly"),
		biweekly: t("addmodal.repBiweekly"),
		monthly: t("addmodal.repMonthly"),
		yearly: t("addmodal.repYearly"),
	};

	const termLabel = (() => {
		let b =
			draft.dateKind === "dnes"
				? t("addmodal.dToday")
				: draft.dateKind === "zitra"
					? t("addmodal.dTomorrow")
					: draft.dateKind === "pristi"
						? t("addmodal.dNextWeek")
						: draft.dateKind === "pmonth"
							? dmLabel(firstNextMonthISO(today))
							: draft.dateKind === "none"
								? t("addmodal.dNone")
								: draft.customDate
									? dmLabel(draft.customDate)
									: t("addmodal.dateFallback");
		if (draft.time) b += ` · ${draft.time}`;
		if (draft.days > 1) b += ` · ${draft.days} dní`;
		return b;
	})();

	const peopleVal =
		nAssign === 0
			? null
			: nAssign === 1
				? (people.find((p) => p.id === draft.assignees[0])?.name ?? t("addmodal.onePerson"))
				: t("addmodal.people", { n: nAssign });

	const togglePop = (key: PopKey) => () => patch({ pop: draft.pop === key ? "" : key });

	type Field = {
		key: PopKey;
		icon: IconName;
		disp: string;
		on: boolean;
		dot?: string | null;
		sw?: string | null;
	};
	const addFields: Field[] = [
		{
			key: "projekt",
			icon: "projekt",
			disp: selProject?.name ?? t("addmodal.fieldProject"),
			on: true,
			dot: selProject?.color ?? "var(--w-ink-3)",
		},
		{ key: "termin", icon: "termin", disp: termLabel, on: true },
		{
			key: "priorita",
			icon: "priorita",
			disp: `P${draft.priority}`,
			on: draft.priority !== 2,
		},
		{
			key: "prirazeni",
			icon: "prirazeni",
			disp: peopleVal ?? t("addmodal.fieldAssign"),
			on: nAssign > 0,
		},
	];
	const addFieldsMore: Field[] = [
		{
			key: "trvani",
			icon: "trvani",
			disp: draft.duration ? durFmt(draft.duration) : t("addmodal.fieldDuration"),
			on: draft.duration > 0,
		},
		{
			key: "deadline",
			icon: "deadline",
			disp: draft.deadline
				? deadlineFmt(draft.deadline, today).replace("do ", "")
				: t("addmodal.fieldDeadline"),
			on: !!draft.deadline,
		},
		{
			key: "opakovani",
			icon: "opakovani",
			disp:
				draft.repeatLabel ||
				(draft.repeat !== "none" ? repLbl[draft.repeat] : t("addmodal.fieldRepeat")),
			on: draft.repeat !== "none",
		},
		{
			key: "barva",
			icon: "barva",
			disp: draft.color !== "none" ? t("addmodal.myColor") : t("addmodal.fieldColor"),
			on: draft.color !== "none",
			sw: draft.color !== "none" ? draft.color : null,
		},
		{
			key: "priloha",
			icon: "priloha",
			disp:
				files.length > 0
					? `${t("addmodal.fieldAttach")} · ${files.length}`
					: t("addmodal.fieldAttach"),
			on: files.length > 0,
		},
		...(flowOptions.length
			? [
					{
						key: "postup" as PopKey,
						icon: "postup" as IconName,
						disp: draft.flowAttach ? t("addmodal.flowAdded") : t("addmodal.fieldFlow"),
						on: !!draft.flowAttach,
					},
				]
			: []),
	];

	const dateChips: { k: DateKind; l: string; sub: string }[] = [
		{ k: "dnes", l: t("addmodal.dToday"), sub: dmLabel(today) },
		{
			k: "zitra",
			l: t("addmodal.dTomorrow"),
			sub: dmLabel(isoAddDays(today, 1)),
		},
		{
			k: "pristi",
			l: t("addmodal.dNextWeek"),
			sub: dmLabel(nextMondayISO(today)),
		},
		{
			k: "pmonth",
			l: t("addmodal.dNextMonth"),
			sub: dmLabel(firstNextMonthISO(today)),
		},
		{ k: "none", l: t("addmodal.dNone"), sub: "—" },
	];
	const durChips: { m: number; l: string }[] = [
		{ m: 0, l: t("addmodal.durNone") },
		{ m: 15, l: "15 min" },
		{ m: 30, l: "30 min" },
		{ m: 60, l: "1 h" },
		{ m: 120, l: "2 h" },
	];
	const repChips: RepeatKind[] = ["none", "daily", "weekly", "biweekly", "monthly"];

	const needsName =
		draft.name.trim().length === 0 &&
		(draft.repeat !== "none" ||
			(draft.dateKind !== "dnes" && draft.dateKind !== "none") ||
			!!draft.time ||
			draft.duration > 0 ||
			draft.assignees.length > 0);
	// Úkol nelze vytvořit s prázdným VYČIŠTĚNÝM názvem (README ř. 48 — po vytažení formulí).
	const cantSubmit = draft.name.trim().length === 0;
	const disabled = cantSubmit || deadlineBad;
	const submitDisabled = disabled || !draft.project || uploading;

	const assignHint =
		nAssign === 0
			? t("addmodal.assignHintNone")
			: nAssign === 1
				? t("addmodal.assignHintOne")
				: draft.assignMode === "all"
					? t("addmodal.assignHintAll", { n: nAssign })
					: t("addmodal.assignHintAny", { n: nAssign });
	const recognizedCount = new Set(draft.highlights.map((highlight) => highlight.kind)).size;
	const previewItems = [
		`${t("addmodal.fieldProject")}: ${selProject?.name ?? t("addmodal.fieldProject")}`,
		`${t("addmodal.fieldDate")}: ${termLabel}`,
		`${t("addmodal.fieldPriority")}: P${draft.priority}`,
		nAssign > 0 ? `${t("addmodal.fieldAssign")}: ${peopleVal}` : null,
		draft.duration > 0 ? `${t("addmodal.fieldDuration")}: ${durFmt(draft.duration)}` : null,
		draft.deadline
			? `${t("addmodal.fieldDeadline")}: ${deadlineFmt(draft.deadline, today).replace("do ", "")}`
			: null,
		hasRep
			? `${t("addmodal.fieldRepeat")}: ${draft.repeatLabel || repLbl[draft.repeat]}`
			: null,
		files.length > 0 ? `${t("addmodal.fieldAttach")}: ${files.length}` : null,
	].filter((item): item is string => Boolean(item));

	/* ── submit (submitTask prototypu → PowerSync insert) ── */
	async function submit() {
		const name = draft.name.trim();
		if (!name || !draft.project || disabled || submitting.current) return;
		submitting.current = true;
		try {
			await doSubmit(name);
		} catch {
			showToast(t("addmodal.saveFailed"));
		} finally {
			submitting.current = false;
			setUploading(false);
		}
	}

	async function doSubmit(name: string) {
		if (!draft.project) return;
		const id = crypto.randomUUID();
		const dueISO = tISO;
		const timeZone = session?.user?.timezone ?? deviceTimeZone();
		const startDate =
			draft.time && dueISO ? zonedDateTimeToIso(dueISO, `${draft.time}:00`, timeZone) : null;
		if (draft.time && dueISO && !startDate) {
			showToast(t("addmodal.invalidLocalTime"));
			return;
		}
		const mode =
			draft.assignees.length >= 2
				? draft.assignMode === "all"
					? "shared_all"
					: "shared_any"
				: "single";
		let recurrenceRule: string | null = null;
		let recurrenceLabel: string | null = null;
		if (hasRep) {
			const base: Record<string, unknown> = draft.repeatRule
				? { ...draft.repeatRule }
				: { kind: draft.repeat, label: repLbl[draft.repeat] };
			base.endKind = draft.repeatEndKind;
			if (draft.repeatEndKind === "until" && draft.repeatUntil) base.until = draft.repeatUntil;
			if (draft.repeatEndKind === "count") base.count = draft.repeatCount;
			base.showAll = draft.repeatShowAll;
			recurrenceRule = JSON.stringify(base);
			recurrenceLabel = draft.repeatLabel || repLbl[draft.repeat];
		}
		const staged = [] as Awaited<ReturnType<typeof stageAttachment>>[];
		if (files.length > 0) {
			if (!navigator.onLine) {
				showToast(t("addmodal.attachOffline"));
				return;
			}
			setUploading(true);
			try {
				for (const file of files) staged.push(await stageAttachment(id, draft.project, file));
			} catch (error) {
				await Promise.allSettled(staged.map((item) => cancelAttachmentStage(item.stageId)));
				if (error instanceof AttachmentApiError && error.code === "attachment_too_large")
					showToast(t("addmodal.attachTooLarge"));
				else showToast(t("addmodal.attachUploadFailed"));
				return;
			}
		}
		try {
			await powerSync.execute(
			`INSERT INTO tasks (id, project_id, parent_id, name, description, priority, color, due_date, start_date, start_timezone,
        deadline, duration_min, days, recurrence, recurrence_rule, recurrence_basis, assignment_mode, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				draft.project,
				initial?.parentId ?? null,
				name,
				draft.desc || null,
				draft.priority,
				// R6 — barva z pickeru je PER-USER (task_user_colors níže), ne sdílený tasks.color.
				null,
				dueISO,
				startDate,
				startDate ? timeZone : null,
				draft.deadline || null,
				draft.duration || null,
				draft.days > 1 ? draft.days : null,
				recurrenceLabel,
				recurrenceRule,
				"due_date",
				mode,
				session?.user?.id ?? null,
				new Date().toISOString(),
			],
			);
		} catch (error) {
			await Promise.allSettled(staged.map((item) => cancelAttachmentStage(item.stageId)));
			throw error;
		}
		try {
			// historie: vytvoření úkolu (dřív se logoval jen edit v detailu, ne create)
			void logTaskActivity(id, draft.project, session?.user?.id, "created", null, null);
			for (const uid of draft.assignees) {
				await powerSync.execute(
					"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)",
					[crypto.randomUUID(), id, draft.project, uid, new Date().toISOString()],
				);
			}
			// R6 — zvolená barva jako per-user overlay (konzistentně s detailem přes task_user_colors),
			// aby týž úkol mohl každý vidět v jiné barvě a nešířila se sdíleně celému týmu.
			if (draft.color !== "none" && session?.user?.id) {
				await powerSync.execute(
					"INSERT INTO task_user_colors (id, task_id, project_id, user_id, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
					[
						crypto.randomUUID(),
						id,
						draft.project,
						session.user.id,
						draft.color,
						new Date().toISOString(),
					],
				);
			}
			// Připojení jako další krok postupu (prototyp: flowAttach → append step).
			if (draft.flowAttach) {
				const steps = await powerSync.getAll<{
					position: number;
					step_state: string | null;
				}>("SELECT position, step_state FROM chain_steps WHERE chain_id = ? ORDER BY position", [
					draft.flowAttach,
				]);
				const maxPos = steps.reduce((m, s) => Math.max(m, s.position ?? 0), 0);
				const allDone = steps.every((s) => s.step_state === "done" || s.step_state === "skipped");
				await powerSync.execute(
					`INSERT INTO chain_steps (id, chain_id, task_id, project_id, position, gate, step_state, created_at)
         VALUES (?, ?, ?, ?, ?, 'after_previous', ?, ?)`,
					[
						crypto.randomUUID(),
						draft.flowAttach,
						id,
						draft.project,
						maxPos + 1,
						// bug fix: platný enum je dormant (ne "waiting" — tam se štafeta zasekla)
						allDone ? "active" : "dormant",
						new Date().toISOString(),
					],
				);
			}
		} catch {
			// Jádro úkolu už je bezpečně uložené. Doplňkové vazby nesmí vyvolat druhý
			// pokus a duplicitní úkol; odmítnutý zápis ukáže standardní sync recovery.
			showToast(t("addmodal.partialSave"));
		}
		let pendingUploads = 0;
		for (const item of staged) {
			try {
				await finalizeAttachment(item.stageId);
			} catch (error) {
				if (
					!(error instanceof AttachmentApiError) ||
					error.code === "attachment_task_not_synced" ||
					error.status >= 500
				) {
					await rememberAttachmentFinalization(item.stageId, id);
					pendingUploads += 1;
				} else {
					showToast(t("addmodal.attachUploadFailed"));
				}
			}
		}
		if (pendingUploads > 0) showToast(t("addmodal.attachFinishing"));
		onClose();
	}

	const segs = segments(draft.rawName, draft.highlights);
	const titleFont: CSSProperties = {
		fontFamily: "var(--w-font-display)",
		fontWeight: 700,
		fontSize: 17,
		lineHeight: 1.45,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	};

	// z-75 = NAD detailem úkolu (z-70/71): „přidat podúkol" otevřený z detailu
	// se musí kreslit před ním, ne za ním (feedback 2026-07-11)
	return (
		<div
			data-esc-layer
			data-add-layer
			className="fixed inset-0 z-[75] flex justify-center"
			style={{
				alignItems: "flex-start",
				paddingTop: "12vh",
			}}
		>
			<button
				type="button"
				aria-label={t("common.close")}
				onClick={onClose}
				className="absolute inset-0 cursor-default border-0 p-0"
				style={{ background: "rgba(10,14,20,.42)" }}
			/>
			<div
				ref={trapRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={captureMode ? t("addmodal.captureTitle") : t("addmodal.dialogTitle")}
				className="border border-line bg-card outline-none"
				style={{
					position: "relative",
					zIndex: 1,
					width: 520,
					maxWidth: "94vw",
					maxHeight: "86vh",
					overflow: "auto",
					borderRadius: 16,
					boxShadow: "var(--w-shadow)",
					animation: "wPop .18s ease",
					padding: 18,
				}}
			>
				{captureMode && (
					<div className="mb-3 flex items-center border-line border-b pb-3" style={{ gap: 10 }}>
						<div className="flex-1">
							<div className="font-display font-extrabold text-ink" style={{ fontSize: 16 }}>
								{t("addmodal.captureTitle")}
							</div>
							<div className="mt-0.5 font-body text-ink-3" style={{ fontSize: 11.5 }}>
								{t("addmodal.captureSubtitle")}
							</div>
						</div>
						<kbd
							className="shrink-0 rounded-md border border-line bg-panel-2 font-mono text-ink-3"
							style={{ fontSize: 10, padding: "3px 6px" }}
						>
							⌘ ⇧ Space
						</kbd>
					</div>
				)}
				{/* dílčí úkol — kontext rodiče (plné přidání podúkolu z detailu) */}
				{initial?.parentId && (
					<div
						className="mb-2 inline-flex items-center font-display font-semibold text-brass-text"
						style={{
							gap: 6,
							fontSize: 12,
							padding: "3px 10px",
							borderRadius: 999,
							background: "var(--w-brass-soft)",
						}}
					>
						↳ {t("detail.subtaskOf")}
						{initial.parentName ? `: ${initial.parentName}` : ""}
					</div>
				)}
				{/* titulek s overlay zvýrazněním tokenů */}
				<div className="flex items-start" style={{ gap: 9 }}>
					<span
						className="shrink-0 rounded-full"
						style={{
							width: 9,
							height: 9,
							marginTop: 7,
							background: selProject?.color ?? "var(--w-ink-3)",
						}}
					/>
					<div className="relative flex-1">
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0 overflow-hidden"
							style={{ ...titleFont, color: "transparent" }}
						>
							{segs.map((s) =>
								s.mark ? (
									<span
										key={s.start}
										style={{
											background: "var(--w-brass-soft)",
											borderRadius: 5,
											boxShadow: "0 0 0 2px var(--w-brass-soft)",
										}}
									>
										{s.text}
									</span>
								) : (
									<span key={s.start}>{s.text}</span>
								),
							)}
						</div>
						<textarea
							ref={taRef}
							value={draft.rawName}
							onChange={(e) => onName(e.target.value)}
							onKeyDown={onNameKey}
							rows={1}
							placeholder={
								captureMode ? t("addmodal.capturePlaceholder") : t("addmodal.titlePlaceholder")
							}
							className="relative block w-full resize-none overflow-hidden border-none bg-transparent text-ink outline-none"
							style={
								{
									...titleFont,
									minHeight: 25,
									fieldSizing: "content",
								} as CSSProperties
							}
						/>
					</div>
				</div>

				{/* našeptávač */}
				{suggest && (
					<div
						className="overflow-hidden border border-brass bg-panel-2"
						style={{ marginTop: 7, borderRadius: 10 }}
					>
						{suggest.map((p, i) => (
							<button
								key={p.id}
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									pickSug(p);
								}}
								className="flex w-full cursor-pointer items-center text-left hover:bg-card"
								style={{
									gap: 9,
									padding: "7px 10px",
									...(i === draft.suggestIdx
										? {
												background: "var(--w-card)",
												boxShadow: "inset 2px 0 0 var(--w-brass)",
											}
										: {}),
								}}
							>
								{p.isProj ? (
									<span
										className="shrink-0 rounded-full"
										style={{
											width: 18,
											height: 18,
											margin: 3,
											background: projects.find((x) => x.id === p.id)?.color ?? "var(--w-ink-3)",
										}}
									/>
								) : (
									<span
										className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold"
										style={{
											width: 24,
											height: 24,
											color: "#fff",
											fontSize: 10,
											background: "var(--w-avatar)",
										}}
									>
										{p.initials}
									</span>
								)}
								<span
									className="flex-1 font-display font-semibold text-ink"
									style={{ fontSize: 13 }}
								>
									{p.name}
								</span>
								<span className="font-body" style={{ fontSize: 11, color: "var(--w-brass-text)" }}>
									{p.action}
								</span>
							</button>
						))}
					</div>
				)}

				{draft.rawName.trim() && (
					<section
						aria-label={t("addmodal.previewTitle")}
						className="mt-3 rounded-xl border border-line bg-panel-2"
						style={{ padding: "11px 12px" }}
					>
						<div className="flex items-center justify-between" style={{ gap: 8 }}>
							<span
								className="font-display font-bold text-ink-3 uppercase"
								style={{ fontSize: 10, letterSpacing: ".06em" }}
							>
								{t("addmodal.previewTitle")}
							</span>
							<span className="font-mono text-ink-3" style={{ fontSize: 10 }}>
								{t("addmodal.recognizedCount", { count: recognizedCount })}
							</span>
						</div>
						<div
							className="mt-1.5 font-display font-bold"
							style={{
								fontSize: 14,
								color: draft.name.trim() ? "var(--w-ink)" : "var(--w-overdue)",
							}}
						>
							{draft.name.trim() || t("addmodal.previewMissingName")}
						</div>
						<div className="mt-2 flex flex-wrap" style={{ gap: 5 }}>
							{previewItems.map((item) => (
								<span
									key={item}
									className="rounded-full border border-line bg-card font-display font-semibold text-ink-2"
									style={{ fontSize: 10.5, padding: "4px 8px" }}
								>
									{item}
								</span>
							))}
						</div>
						{recognizedCount === 0 && (
							<p className="mt-2 font-body text-ink-3" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
								{t("addmodal.previewNoAttributes")}
							</p>
						)}
					</section>
				)}

				{!captureMode && (
					<>
				{/* popis */}
				{draft.descOpen ? (
					<input
						value={draft.desc}
						onChange={(e) => patch({ desc: e.target.value })}
						placeholder={t("addmodal.descPlaceholder")}
						className="w-full border-none bg-transparent font-body outline-none"
						style={{ fontSize: 13.5, color: "var(--w-ink-2)", marginTop: 6 }}
					/>
				) : (
					<button
						type="button"
						onClick={() => patch({ descOpen: true })}
						className="inline-flex min-h-11 cursor-pointer items-center font-body text-ink-3 hover:text-brass-text md:min-h-0"
						style={{ gap: 5, fontSize: 12, marginTop: 6, marginLeft: 19 }}
					>
						{t("addmodal.addDesc")}
					</button>
				)}

				{/* chipy polí */}
				<div className="flex flex-wrap" style={{ gap: 7, marginTop: 15 }}>
					{addFields.map((f) => (
						<FieldPill
							key={f.key}
							on={f.on}
							onClick={togglePop(f.key)}
							icon={f.icon}
							dot={f.dot}
							sw={f.sw}
							label={f.disp}
						/>
					))}
					{draft.more &&
						addFieldsMore.map((f) => (
							<FieldPill
								key={f.key}
								on={f.on}
								onClick={togglePop(f.key)}
								icon={f.icon}
								dot={f.dot}
								sw={f.sw}
								label={f.disp}
							/>
						))}
					<button
						type="button"
						onClick={() => patch({ more: !draft.more })}
						className="inline-flex min-h-11 cursor-pointer items-center font-display font-semibold text-ink-3 hover:border-brass hover:text-brass-text md:min-h-0"
						style={{
							gap: 4,
							fontSize: 12.5,
							padding: "6px 10px",
							borderRadius: 9,
							border: "1px dashed var(--w-line)",
						}}
					>
						{draft.more ? t("addmodal.less") : t("addmodal.more")}
					</button>
				</div>

				{/* sdílený popover panel */}
				{draft.pop !== "" && (
					<div
						className="border border-line bg-panel-2"
						style={{ marginTop: 12, borderRadius: 12, padding: "12px 13px" }}
					>
						{draft.pop === "projekt" && (
							<>
								<div
									className="flex items-center border-line border-b"
									style={{ gap: 7, paddingBottom: 9, marginBottom: 5 }}
								>
									<Icon name="hledat" size={13} className="shrink-0 text-ink-3" />
									<input
										value={draft.projQuery}
										onChange={(e) => patch({ projQuery: e.target.value })}
										placeholder={t("addmodal.searchProject")}
										className="flex-1 border-none bg-transparent font-body text-ink outline-none"
										style={{ fontSize: 13 }}
									/>
								</div>
								<div style={{ maxHeight: 210, overflow: "auto" }}>
									{projects
										.filter((p) => {
											const q = draft.projQuery.trim().toLowerCase();
											return !q || (p.name ?? "").toLowerCase().includes(q);
										})
										.map((p) => {
											const on = p.id === draft.project;
											return (
												<button
													key={p.id}
													type="button"
													onClick={() => patch({ project: p.id, pop: "" })}
													className="flex w-full cursor-pointer items-center text-left hover:bg-card"
													style={{
														gap: 9,
														padding: "8px 9px",
														borderRadius: 8,
														background: on ? "var(--w-brass-soft)" : undefined,
													}}
												>
													<span
														className="shrink-0 rounded-full"
														style={{
															width: 9,
															height: 9,
															background: p.color ?? "var(--w-ink-3)",
														}}
													/>
													<span
														className="flex-1 font-display font-semibold text-ink"
														style={{ fontSize: 13 }}
													>
														{p.name}
													</span>
													{on && (
														<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
															<path
																d="M3 7.4 L6 10 L11 4"
																stroke="var(--w-brass-text)"
																strokeWidth="1.6"
																strokeLinecap="round"
																strokeLinejoin="round"
															/>
														</svg>
													)}
												</button>
											);
										})}
								</div>
							</>
						)}

						{draft.pop === "termin" && (
							<>
								<div className="flex flex-wrap" style={{ gap: 6 }}>
									{dateChips.map((d) => (
										<ChipBtn
											key={d.k}
											on={draft.dateKind === d.k}
											onClick={() =>
												patch(
													d.k === "custom"
														? { dateKind: "custom" }
														: { dateKind: d.k, customDate: "" },
												)
											}
											style={{
												display: "flex",
												flexDirection: "column",
												alignItems: "center",
												gap: 1,
												lineHeight: 1.2,
												padding: "5px 12px",
											}}
										>
											{d.l}
											<span className="font-mono" style={{ fontSize: 9.5, opacity: 0.7 }}>
												{d.sub}
											</span>
										</ChipBtn>
									))}
								</div>
								<div className="flex" style={{ gap: 8, marginTop: 9 }}>
									<label
										className="flex flex-1 items-center"
										style={{
											gap: 7,
											border: `1px solid ${draft.dateKind === "custom" ? "var(--w-brass)" : "var(--w-line)"}`,
											background: draft.dateKind === "custom" ? "var(--w-brass-soft)" : undefined,
											borderRadius: 9,
											padding: "7px 11px",
										}}
									>
										<Icon name="termin" size={14} className="shrink-0 text-ink-3" />
										<input
											type="date"
											value={draft.customDate}
											onChange={(e) =>
												patch({
													dateKind: "custom",
													customDate: e.target.value,
												})
											}
											className="w-full border-none bg-transparent font-body text-ink outline-none"
											style={{ fontSize: 13 }}
										/>
									</label>
									<label
										className="flex items-center"
										style={{
											gap: 7,
											width: 128,
											border: "1px solid var(--w-line)",
											borderRadius: 9,
											padding: "7px 11px",
										}}
									>
										<Icon name="deadline" size={14} className="shrink-0 text-ink-3" />
										<input
											type="time"
											value={draft.time}
											onChange={(e) => patch({ time: e.target.value })}
											className="w-full border-none bg-transparent font-body text-ink outline-none"
											style={{ fontSize: 13 }}
										/>
									</label>
								</div>
								<div className="flex flex-wrap items-center" style={{ gap: 9, marginTop: 9 }}>
									<span className="font-display font-semibold text-ink-3" style={{ fontSize: 11 }}>
										{t("addmodal.multiDays")}
									</span>
									<div
										className="flex items-center"
										style={{
											gap: 2,
											border: "1px solid var(--w-line)",
											borderRadius: 9,
											padding: 3,
										}}
									>
										<button
											type="button"
											onClick={() => patch({ days: Math.max(1, draft.days - 1) })}
											className="flex cursor-pointer items-center justify-center font-display font-bold text-ink-2 hover:bg-card"
											style={{
												width: 24,
												height: 24,
												borderRadius: 7,
												fontSize: 15,
											}}
										>
											−
										</button>
										<input
											type="number"
											min={1}
											max={60}
											value={draft.days}
											onChange={(e) => {
												const n = Number.parseInt(e.target.value, 10);
												patch({
													days: Number.isNaN(n) ? 1 : Math.max(1, Math.min(60, n)),
												});
											}}
											className="border-none bg-transparent text-center font-mono text-ink outline-none"
											style={{ width: 34, fontSize: 13 }}
										/>
										<button
											type="button"
											onClick={() => patch({ days: Math.min(60, draft.days + 1) })}
											className="flex cursor-pointer items-center justify-center font-display font-bold text-ink-2 hover:bg-card"
											style={{
												width: 24,
												height: 24,
												borderRadius: 7,
												fontSize: 15,
											}}
										>
											+
										</button>
									</div>
									{draft.days > 1 && (
										<span
											className="font-display font-semibold"
											style={{ fontSize: 12, color: "var(--w-brass-text)" }}
										>
											{draft.time
												? `${t("addmodal.multiTimes")} ${draft.time}`
												: t("addmodal.multiAllDay")}
										</span>
									)}
								</div>
							</>
						)}

						{draft.pop === "priorita" && (
							<div className="flex" style={{ gap: 6 }}>
								{([1, 2, 3, 4] as const).map((p) => (
									<ChipBtn
										key={p}
										on={draft.priority === p}
										onClick={() => patch({ priority: p })}
										style={{ padding: "7px 18px" }}
									>
										P{p}
									</ChipBtn>
								))}
							</div>
						)}

						{draft.pop === "prirazeni" && (
							<>
								<div className="flex flex-wrap" style={{ gap: 8 }}>
									{people.map((p) => {
										const on = draft.assignees.includes(p.id);
										return (
											<button
												key={p.id}
												type="button"
												title={p.name}
												onClick={() => {
													const assignees = on
														? draft.assignees.filter((x) => x !== p.id)
														: [...draft.assignees, p.id];
													patch({ assignees });
												}}
												className="flex cursor-pointer items-center justify-center rounded-full font-display font-semibold"
												style={{
													width: 30,
													height: 30,
													color: "#fff",
													fontSize: 11,
													background: "var(--w-avatar)",
													opacity: on ? 1 : 0.5,
													boxShadow: on
														? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)"
														: undefined,
													transition: "opacity .12s, box-shadow .12s",
												}}
											>
												{p.initials}
											</button>
										);
									})}
								</div>
								{nAssign >= 2 && (
									<div className="flex" style={{ gap: 6, marginTop: 9 }}>
										<ChipBtn
											on={draft.assignMode === "any"}
											onClick={() => patch({ assignMode: "any" })}
										>
											{t("addmodal.modeAny")}
										</ChipBtn>
										<ChipBtn
											on={draft.assignMode === "all"}
											onClick={() => patch({ assignMode: "all" })}
										>
											{t("addmodal.modeAll")}
										</ChipBtn>
									</div>
								)}
								<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginTop: 7 }}>
									{assignHint}
								</div>
							</>
						)}

						{draft.pop === "trvani" && (
							<div className="flex flex-wrap items-center" style={{ gap: 6 }}>
								{durChips.map((d) => (
									<ChipBtn
										key={d.m}
										on={draft.duration === d.m}
										onClick={() => patch({ duration: d.m })}
										style={{ padding: "6px 11px" }}
									>
										{d.l}
									</ChipBtn>
								))}
								<label
									className="flex items-center"
									style={{
										gap: 5,
										border: "1px solid var(--w-line)",
										borderRadius: 9,
										padding: "5px 9px",
									}}
								>
									<input
										type="number"
										min={0}
										max={10080}
										step={5}
										value={draft.duration}
										onChange={(e) => {
											const n = Number.parseInt(e.target.value, 10);
											patch({
												duration: Number.isNaN(n) ? 0 : Math.max(0, Math.min(10080, n)),
											});
										}}
										className="border-none bg-transparent text-right font-mono text-ink outline-none"
										style={{ width: 52, fontSize: 12 }}
									/>
									<span className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
										{t("addmodal.min")}
									</span>
								</label>
							</div>
						)}

						{draft.pop === "deadline" && (
							<>
								<label
									className="flex items-center"
									style={{
										gap: 7,
										border: `1px solid ${draft.deadline ? "var(--w-brass)" : "var(--w-line)"}`,
										background: draft.deadline ? "var(--w-brass-soft)" : undefined,
										borderRadius: 9,
										padding: "7px 11px",
									}}
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 15 15"
										fill="none"
										aria-hidden
										className="shrink-0"
									>
										<path
											d="M3.5 2 V13 M3.5 2.5 H11 L9 5 L11 7.5 H3.5"
											stroke="var(--w-overdue)"
											strokeWidth="1.3"
											fill="none"
											strokeLinejoin="round"
										/>
									</svg>
									<input
										type="date"
										value={draft.deadline}
										onChange={(e) => patch({ deadline: e.target.value })}
										className="w-full border-none bg-transparent font-body text-ink outline-none"
										style={{ fontSize: 13 }}
									/>
									{draft.deadline && (
										<span
											className="shrink-0 font-mono"
											style={{ fontSize: 11.5, color: "var(--w-overdue)" }}
										>
											{deadlineFmt(draft.deadline, today)}
										</span>
									)}
								</label>
								{deadlineBad && (
									<div
										className="flex items-center font-body"
										style={{
											gap: 6,
											marginTop: 6,
											fontSize: 11.5,
											color: "var(--w-overdue)",
										}}
									>
										{t("addmodal.deadlineBad", {
											term: deadlineFmt(tISO ?? "", today).replace("do ", ""),
										})}
									</div>
								)}
							</>
						)}

						{draft.pop === "opakovani" && (
							<>
								{richActive && draft.repeatLabel && (
									<div
										className="flex items-center"
										style={{
											gap: 8,
											padding: "7px 11px",
											marginBottom: 9,
											borderRadius: 9,
											background: "var(--w-brass-soft)",
											border: "1px solid var(--w-brass)",
										}}
									>
										<span
											className="shrink-0 font-display font-bold uppercase"
											style={{
												fontSize: 10,
												letterSpacing: ".05em",
												color: "var(--w-brass-text)",
											}}
										>
											{t("addmodal.fromText")}
										</span>
										<span className="flex-1 font-body text-ink" style={{ fontSize: 13 }}>
											{draft.repeatLabel}
										</span>
										<button
											type="button"
											onClick={() =>
												patch({
													repeat: "none",
													repeatRule: null,
													repeatLabel: "",
												})
											}
											className="shrink-0 cursor-pointer text-ink-3"
											style={{ fontSize: 14 }}
											title={t("addmodal.clear")}
										>
											✕
										</button>
									</div>
								)}
								<div className="flex flex-wrap" style={{ gap: 6 }}>
									{repChips.map((r) => (
										<ChipBtn
											key={r}
											on={draft.repeat === r && !richActive}
											onClick={() => patch({ repeat: r, repeatRule: null, repeatLabel: "" })}
										>
											{repLbl[r]}
										</ChipBtn>
									))}
								</div>
								{hasRep && (
									<div
										className="flex flex-col border-line border-t"
										style={{ marginTop: 12, paddingTop: 12, gap: 11 }}
									>
										<div>
											<div
												className="font-display font-bold text-ink-3 uppercase"
												style={{
													fontSize: 10,
													letterSpacing: ".05em",
													marginBottom: 6,
												}}
											>
												{t("addmodal.repeatEnd")}
											</div>
											<div className="flex flex-wrap items-center" style={{ gap: 6 }}>
												<ChipBtn
													on={draft.repeatEndKind === "never"}
													onClick={() => patch({ repeatEndKind: "never" })}
												>
													{t("addmodal.endNever")}
												</ChipBtn>
												<ChipBtn
													on={draft.repeatEndKind === "until"}
													onClick={() => patch({ repeatEndKind: "until" })}
												>
													{t("addmodal.endUntil")}
												</ChipBtn>
												<ChipBtn
													on={draft.repeatEndKind === "count"}
													onClick={() => patch({ repeatEndKind: "count" })}
												>
													{t("addmodal.endCount")}
												</ChipBtn>
												{draft.repeatEndKind === "until" && (
													<input
														type="date"
														value={draft.repeatUntil}
														onChange={(e) => patch({ repeatUntil: e.target.value })}
														className="border border-line bg-card font-body text-ink outline-none"
														style={{
															borderRadius: 8,
															padding: "5px 8px",
															fontSize: 12.5,
														}}
													/>
												)}
												{draft.repeatEndKind === "count" && (
													<span className="inline-flex items-center" style={{ gap: 6 }}>
														<input
															type="number"
															min={1}
															max={999}
															value={draft.repeatCount}
															onChange={(e) => {
																const n = Number.parseInt(e.target.value, 10);
																patch({
																	repeatCount: Number.isNaN(n) ? 1 : Math.max(1, Math.min(999, n)),
																});
															}}
															className="box-border border border-line bg-card font-body text-ink outline-none"
															style={{
																width: 58,
																borderRadius: 8,
																padding: "5px 8px",
																fontSize: 12.5,
															}}
														/>
														<span className="font-body text-ink-3" style={{ fontSize: 12 }}>
															{t("addmodal.occurrences")}
														</span>
													</span>
												)}
											</div>
										</div>
										<div>
											<div
												className="font-display font-bold text-ink-3 uppercase"
												style={{
													fontSize: 10,
													letterSpacing: ".05em",
													marginBottom: 6,
												}}
											>
												{t("addmodal.inCalendar")}
											</div>
											<div className="flex" style={{ gap: 6 }}>
												<ChipBtn
													on={draft.repeatShowAll}
													onClick={() => patch({ repeatShowAll: true })}
												>
													{t("addmodal.showAllOcc")}
												</ChipBtn>
												<ChipBtn
													on={!draft.repeatShowAll}
													onClick={() => patch({ repeatShowAll: false })}
												>
													{t("addmodal.nextOnly")}
												</ChipBtn>
											</div>
										</div>
										<div className="font-body text-ink-3" style={{ fontSize: 11, lineHeight: 1.5 }}>
											{t("addmodal.repeatHint")}
										</div>
									</div>
								)}
							</>
						)}

						{draft.pop === "barva" && (
							<>
								<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginBottom: 8 }}>
									{t("addmodal.colorHint")}
									<b style={{ color: "var(--w-ink-2)" }}>{t("addmodal.colorHintB")}</b>.
								</div>
								<div className="flex flex-wrap items-center" style={{ gap: 7 }}>
									<button
										type="button"
										title={t("addmodal.colorNone")}
										onClick={() => patch({ color: "none" })}
										className="flex cursor-pointer items-center justify-center border border-line bg-card"
										style={{
											width: 24,
											height: 24,
											borderRadius: 7,
											boxShadow:
												draft.color === "none"
													? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)"
													: undefined,
										}}
									>
										<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
											<line
												x1="3"
												y1="11"
												x2="11"
												y2="3"
												stroke="var(--w-ink-3)"
												strokeWidth="1.3"
											/>
										</svg>
									</button>
									{USER_COLORS.map((c) => (
										<button
											key={c}
											type="button"
											onClick={() => patch({ color: c })}
											className="cursor-pointer"
											style={{
												width: 24,
												height: 24,
												borderRadius: 7,
												background: c,
												boxShadow:
													draft.color === c
														? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)"
														: undefined,
											}}
										/>
									))}
								</div>
							</>
						)}

						{draft.pop === "priloha" && (
							<div>
								<label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line border-dashed bg-card px-3 font-display font-semibold text-ink-2 hover:border-brass hover:text-brass-text">
									<Icon name="priloha" size={16} className="mr-2" />
									{t("addmodal.attachChoose")}
									<input
										type="file"
										multiple
										className="sr-only"
										onChange={(event) => {
											const selected = Array.from(event.target.files ?? []);
											const valid = selected.filter(
												(file) => file.size > 0 && file.size <= ATTACHMENT_MAX_BYTES,
											);
											if (valid.length !== selected.length) showToast(t("addmodal.attachTooLarge"));
											setFiles((current) => {
												const merged = [...current];
												for (const file of valid) {
													const duplicate = merged.some(
														(item) =>
															item.name === file.name &&
															item.size === file.size &&
															item.lastModified === file.lastModified,
													);
													if (!duplicate && merged.length < ATTACHMENT_MAX_SELECTION) merged.push(file);
												}
												return merged;
											});
											event.target.value = "";
										}}
									/>
								</label>
								<p className="mt-2 font-body text-ink-3" style={{ fontSize: 11.5 }}>
									{t("addmodal.attachHint")}
								</p>
								{files.length > 0 && (
									<ul className="mt-2 space-y-1">
										{files.map((file, index) => (
											<li
												key={`${file.name}:${file.size}:${file.lastModified}`}
												className="flex min-h-11 items-center rounded-lg bg-panel px-2"
												style={{ gap: 8 }}
											>
												<span className="min-w-0 flex-1 truncate font-body text-ink" style={{ fontSize: 12.5 }}>
													{file.name}
												</span>
												<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 10.5 }}>
													{attachmentSizeLabel(file.size)}
												</span>
												<button
													type="button"
													aria-label={t("addmodal.attachRemove")}
													onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
													className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:text-overdue"
												>
													✕
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						)}

						{draft.pop === "postup" && (
							<>
								<select
									value={draft.flowAttach}
									onChange={(e) => patch({ flowAttach: e.target.value })}
									className="box-border w-full cursor-pointer border border-line bg-card font-body text-ink"
									style={{ borderRadius: 9, padding: "9px 11px", fontSize: 13 }}
								>
									<option value="">{t("addmodal.flowNone")}</option>
									{flowOptions.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
								<div className="font-body text-ink-3" style={{ fontSize: 11, marginTop: 6 }}>
									{t("addmodal.flowHint")}
								</div>
							</>
						)}
					</div>
				)}
					</>
				)}

				{/* footer */}
				<div
					className="flex flex-wrap items-center border-line border-t"
					style={{ gap: 9, marginTop: 18, paddingTop: 14 }}
				>
					{captureMode ? (
						<span
							className="w-full basis-full font-body text-ink-3"
							style={{ fontSize: 11.5, lineHeight: 1.5 }}
						>
							{t("addmodal.captureHint")}
						</span>
					) : needsName ? (
						<span
							className="flex flex-1 items-center font-body"
							style={{
								gap: 6,
								fontSize: 11.5,
								color: "var(--w-overdue)",
								lineHeight: 1.5,
							}}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 14 14"
								fill="none"
								aria-hidden
								className="shrink-0"
							>
								<path
									d="M7 1.5 L13 12 H1 Z"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinejoin="round"
								/>
								<line
									x1="7"
									y1="5.5"
									x2="7"
									y2="8.5"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
								<circle cx="7" cy="10.3" r=".7" fill="currentColor" />
							</svg>
							{t("addmodal.needsName")}
						</span>
					) : (
						<span
							className="flex-1 font-body text-ink-3"
							style={{ fontSize: 11.5, lineHeight: 1.5 }}
							// Nápověda parseru s tučnými tokeny (statický lokalizovaný HTML z locales).
							// biome-ignore lint/security/noDangerouslySetInnerHtml: statický string z vlastních locales, ne user input
							dangerouslySetInnerHTML={{ __html: t("addmodal.hint") }}
						/>
					)}
					{captureMode && (
						<button
							type="button"
							onClick={() => setCaptureMode(false)}
							className="min-h-11 w-full basis-full cursor-pointer rounded-[10px] border border-line bg-card px-3 font-display font-semibold text-ink-2 hover:border-brass hover:text-brass-text"
							style={{ fontSize: 12 }}
						>
							{t("addmodal.captureExpand")}
						</button>
					)}
					<button
						type="button"
						onClick={onClose}
						disabled={uploading}
						className={`${captureMode ? "flex-1" : ""} min-h-11 cursor-pointer border border-line bg-panel-2 font-display font-semibold text-ink-2`}
						style={{ fontSize: 13, borderRadius: 10, padding: "9px 14px" }}
					>
						{t("addmodal.cancel")}
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={submitDisabled}
						aria-busy={uploading}
						className={`${captureMode ? "flex-1" : ""} min-h-11 cursor-pointer border-none font-display font-bold hover:brightness-106`}
						style={{
							fontSize: 13,
							color: "#fff",
							background: "var(--w-brass)",
							borderRadius: 10,
							padding: "9px 16px",
							opacity: submitDisabled ? 0.4 : 1,
						}}
					>
						{uploading ? t("addmodal.attachUploading") : t("addmodal.submit")}
					</button>
				</div>
			</div>
		</div>
	);
}
