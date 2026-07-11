import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import {
	type CSSProperties,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { initials } from "../lib/format";
import type {
	ListItemRow,
	ListRow,
	ListSectionRow,
	ListTemplateRow,
} from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { showToast } from "../lib/toast";
import { useWorkspace, useWorkspaces } from "../lib/workspace";

/**
 * Seznamy — opakované checklisty na akce (prototyp ř. 837–944 + metody 2728–2772):
 * šablona → instance k akci; přehled (aktivní karty + Šablony + Archiv) a detail
 * (editovatelný název, „datum a místo akce", sekce s položkami, qty chip, avatar-assign,
 * přidávání položek, akce Reset po akci / Uložit jako šablonu / Archivovat).
 */

interface TplSection {
	name: string;
	items: string[];
}

const parseTplSections = (raw: string | null): TplSection[] => {
	try {
		const v = JSON.parse(raw ?? "[]") as unknown;
		if (!Array.isArray(v)) return [];
		return v.filter(
			(s): s is TplSection =>
				!!s && typeof (s as TplSection).name === "string" &&
				Array.isArray((s as TplSection).items),
		);
	} catch {
		return [];
	}
};

const pillBtnCls =
	"rounded-[9px] border border-line bg-card font-display font-semibold text-ink-2 hover:border-brass";
const pillBtnStyle: CSSProperties = { fontSize: 12, padding: "6px 11px" };

export function Seznamy() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as { seznam?: string };
	const { data: session } = useSession();
	const { activeWs } = useWorkspace();
	const { data: workspaces } = useWorkspaces();

	const { data: lists } = usePsQuery<ListRow>(
		"SELECT * FROM lists ORDER BY created_at DESC",
	);
	// tiebreaker id: položky šablony sdílejí created_at → bez něj se pořadí
	// remízových řádků po UPDATE (odškrtnutí) měnilo o pár míst (feedback)
	const { data: sections } = usePsQuery<ListSectionRow>(
		"SELECT * FROM list_sections ORDER BY position, created_at, id",
	);
	const { data: items } = usePsQuery<ListItemRow>(
		"SELECT * FROM list_items ORDER BY position, created_at, id",
	);
	const { data: templates } = usePsQuery<ListTemplateRow>(
		"SELECT * FROM list_templates ORDER BY created_at",
	);

	const selected = (lists ?? []).find((l) => l.id === search.seznam) ?? null;

	const statsOf = useMemo(() => {
		const bySection = new Map<string, ListItemRow[]>();
		const byList = new Map<string, ListItemRow[]>();
		for (const it of items ?? []) {
			if (it.section_id)
				bySection.set(it.section_id, [
					...(bySection.get(it.section_id) ?? []),
					it,
				]);
			if (it.list_id) byList.set(it.list_id, [...(byList.get(it.list_id) ?? []), it]);
		}
		return {
			bySection,
			list: (id: string) => {
				const its = byList.get(id) ?? [];
				const done = its.filter((x) => x.done).length;
				return {
					total: its.length,
					done,
					pct: its.length ? Math.round((done / its.length) * 100) : 0,
				};
			},
		};
	}, [items]);

	/** Založit seznam ze šablony (prototyp createListFrom + _instTpl). */
	const createFromTemplate = async (tpl: ListTemplateRow) => {
		const wsId =
			activeWs &&
			!(workspaces ?? []).find((w) => w.id === activeWs)?.isPersonal
				? activeWs
				: (tpl.workspace_id ?? activeWs);
		if (!wsId) return;
		const listId = crypto.randomUUID();
		const now = new Date().toISOString();
		const secs = parseTplSections(tpl.sections);
		await powerSync.writeTransaction(async (tx) => {
			await tx.execute(
				`INSERT INTO lists (id, workspace_id, template_id, name, event, archived, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
				[listId, wsId, tpl.id, tpl.name, t("lists.eventPlaceholderNew"), session?.user?.id ?? null, now],
			);
			for (let si = 0; si < secs.length; si++) {
				const sec = secs[si];
				if (!sec) continue;
				const secId = crypto.randomUUID();
				await tx.execute(
					"INSERT INTO list_sections (id, list_id, workspace_id, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
					[secId, listId, wsId, sec.name, si, now],
				);
				for (let ii = 0; ii < sec.items.length; ii++) {
					const [text, qty] = String(sec.items[ii] ?? "").split("|");
					await tx.execute(
						`INSERT INTO list_items (id, list_id, section_id, workspace_id, text, qty, done, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
						[crypto.randomUUID(), listId, secId, wsId, text ?? "", qty ?? null, ii, now],
					);
				}
			}
		});
		showToast(t("lists.createdToast"));
		void navigate({ to: "/seznamy", search: { seznam: listId } });
	};

	/** Prázdný seznam (feedback 2026-07-11) — jedna výchozí sekce; název a akce
	 * se editují rovnou v detailu (inputy v hlavičce). */
	const createBlank = async () => {
		const wsId =
			activeWs &&
			!(workspaces ?? []).find((w) => w.id === activeWs)?.isPersonal
				? activeWs
				: (workspaces ?? []).find((w) => !w.isPersonal)?.id;
		if (!wsId) return;
		const listId = crypto.randomUUID();
		const now = new Date().toISOString();
		await powerSync.writeTransaction(async (tx) => {
			await tx.execute(
				`INSERT INTO lists (id, workspace_id, name, event, archived, created_by, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
				[
					listId,
					wsId,
					t("lists.newName"),
					t("lists.eventPlaceholderNew"),
					session?.user?.id ?? null,
					now,
				],
			);
			await tx.execute(
				"INSERT INTO list_sections (id, list_id, workspace_id, name, position, created_at) VALUES (?, ?, ?, ?, 0, ?)",
				[crypto.randomUUID(), listId, wsId, t("lists.defaultSection"), now],
			);
		});
		void navigate({ to: "/seznamy", search: { seznam: listId } });
	};

	if (selected) {
		return (
			<ListDetail
				list={selected}
				sections={(sections ?? []).filter((s) => s.list_id === selected.id)}
				itemsBySection={statsOf.bySection}
				stats={statsOf.list(selected.id)}
				onClose={() => void navigate({ to: "/seznamy", search: {} })}
			/>
		);
	}

	const active = (lists ?? []).filter((l) => !l.archived);
	const archived = (lists ?? []).filter((l) => !!l.archived);
	const wsColor = (id: string | null) =>
		(workspaces ?? []).find((w) => w.id === id)?.color ?? "var(--w-ink-3)";

	return (
		<div className="mx-auto" style={{ maxWidth: 980, padding: "20px 22px 90px" }}>
			<p
				className="font-body text-ink-3"
				style={{ fontSize: 13, margin: "6px 0 14px", maxWidth: "62ch" }}
			>
				{t("lists.intro")}
			</p>

			{active.length === 0 && (
				<div
					className="text-center font-body text-ink-3"
					style={{ padding: "40px 20px", fontSize: 13.5 }}
				>
					{t("lists.emptyActive")}
				</div>
			)}

			{/* aktivní instance */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
					gap: 12,
				}}
			>
				{/* nový prázdný seznam (feedback — dřív šlo zakládat jen ze šablon) */}
				<button
					type="button"
					onClick={() => void createBlank()}
					className="flex items-center justify-center rounded-[14px] border border-line border-dashed font-display font-semibold text-ink-3 hover:border-brass hover:text-brass-text"
					style={{ minHeight: 92, fontSize: 13, gap: 7 }}
				>
					+ {t("lists.newList")}
				</button>
				{active.map((l) => {
					const st = statsOf.list(l.id);
					const complete = st.total > 0 && st.done >= st.total;
					return (
						<div
							key={l.id}
							onClick={() =>
								void navigate({ to: "/seznamy", search: { seznam: l.id } })
							}
							className="cursor-pointer rounded-[14px] border border-line bg-card hover:border-brass"
							style={{ padding: "15px 16px", boxShadow: "var(--w-shadow-sm)" }}
						>
							<div className="flex items-center" style={{ gap: 8 }}>
								<span
									className="shrink-0"
									style={{
										width: 8,
										height: 8,
										borderRadius: 3,
										background: wsColor(l.workspace_id),
									}}
								/>
								<span
									className="min-w-0 flex-1 truncate font-display font-bold text-ink"
									style={{ fontSize: 14 }}
								>
									{l.name}
								</span>
								{complete && <DonePill label={t("lists.donePill")} />}
							</div>
							<div
								className="font-mono text-ink-3"
								style={{ fontSize: 11.5, marginTop: 4 }}
							>
								{l.event}
							</div>
							<div className="flex items-center" style={{ gap: 9, marginTop: 11 }}>
								<ProgressBar pct={st.pct} height={6} />
								<span
									className="shrink-0 font-mono text-ink-2"
									style={{ fontSize: 11 }}
								>
									{st.done}/{st.total}
								</span>
							</div>
						</div>
					);
				})}
			</div>

			{/* Šablony */}
			<div
				className="font-display font-bold text-ink-3 uppercase"
				style={{ fontSize: 11, letterSpacing: ".06em", margin: "24px 0 10px" }}
			>
				{t("lists.templates")}
			</div>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
					gap: 10,
				}}
			>
				{(templates ?? []).map((tpl) => {
					const count = parseTplSections(tpl.sections).reduce(
						(n, s) => n + s.items.length,
						0,
					);
					return (
						<div
							key={tpl.id}
							className="rounded-[13px] border border-line border-dashed bg-card"
							style={{ padding: "13px 14px" }}
						>
							<div
								className="font-display font-bold text-ink"
								style={{ fontSize: 13 }}
							>
								{tpl.name}
							</div>
							<div
								className="font-body text-ink-3"
								style={{ fontSize: 11.5, marginTop: 3 }}
							>
								{tpl.description} · {t("lists.itemCount", { count })}
							</div>
							<button
								type="button"
								onClick={() => void createFromTemplate(tpl)}
								className="inline-block rounded-lg font-display font-semibold text-brass-text hover:brightness-105"
								style={{
									marginTop: 10,
									fontSize: 11.5,
									background: "var(--w-brass-soft)",
									padding: "5px 11px",
								}}
							>
								{t("lists.useTemplate")}
							</button>
						</div>
					);
				})}
			</div>

			{/* Archiv */}
			{archived.length > 0 && (
				<>
					<div
						className="font-display font-bold text-ink-3 uppercase"
						style={{ fontSize: 11, letterSpacing: ".06em", margin: "24px 0 10px" }}
					>
						{t("lists.archive")}
					</div>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
							gap: 12,
							opacity: 0.65,
						}}
					>
						{archived.map((l) => {
							const st = statsOf.list(l.id);
							return (
								<div
									key={l.id}
									onClick={() =>
										void navigate({ to: "/seznamy", search: { seznam: l.id } })
									}
									className="cursor-pointer rounded-[14px] border border-line bg-card"
									style={{ padding: "15px 16px" }}
								>
									<div
										className="font-display font-bold text-ink"
										style={{ fontSize: 14 }}
									>
										{l.name}
									</div>
									<div
										className="font-mono text-ink-3"
										style={{ fontSize: 11.5, marginTop: 4 }}
									>
										{l.event} · {st.done}/{st.total}
									</div>
								</div>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}

function DonePill({ label }: { label: string }) {
	return (
		<span
			className="shrink-0 rounded-full font-display font-semibold"
			style={{
				fontSize: 10.5,
				color: "var(--w-success-ink)",
				background: "var(--w-success-soft)",
				padding: "2px 9px",
			}}
		>
			{label}
		</span>
	);
}

function ProgressBar({ pct, height }: { pct: number; height: number }) {
	return (
		<div
			className="flex-1 overflow-hidden rounded-full bg-panel-2"
			style={{ height }}
		>
			<div
				style={{
					height: "100%",
					width: `${Math.min(100, pct)}%`,
					background: pct >= 100 ? "#2e9c6e" : "var(--w-brass)",
					borderRadius: "inherit",
				}}
			/>
		</div>
	);
}

function ListDetail({
	list,
	sections,
	itemsBySection,
	stats,
	onClose,
}: {
	list: ListRow;
	sections: ListSectionRow[];
	itemsBySection: Map<string, ListItemRow[]>;
	stats: { total: number; done: number; pct: number };
	onClose: () => void;
}) {
	const { t } = useTranslation();
	// editace názvu/eventu — lokální stav, zápis na blur/Enter (ne per klávesa)
	const [name, setName] = useState(list.name ?? "");
	const [event, setEvent] = useState(list.event ?? "");
	const [assignOpen, setAssignOpen] = useState<string | null>(null);
	const [inputs, setInputs] = useState<Record<string, string>>({});
	// nová sekce (feedback — sekce šly dřív jen ze šablon)
	const [secName, setSecName] = useState("");
	// řazení odškrtnutých (feedback): dolů v sekci × zůstat na místě — per seznam,
	// per uživatel (jen zobrazení, pozice v DB se nemění)
	const [doneDown, setDoneDown] = useState(
		() => localStorage.getItem(`watson.listDoneSort.${list.id}`) === "1",
	);
	useEffect(() => {
		setName(list.name ?? "");
		setEvent(list.event ?? "");
		setDoneDown(localStorage.getItem(`watson.listDoneSort.${list.id}`) === "1");
	}, [list.id, list.name, list.event]);
	const toggleDoneSort = () =>
		setDoneDown((v) => {
			const n = !v;
			localStorage.setItem(`watson.listDoneSort.${list.id}`, n ? "1" : "0");
			return n;
		});

	// členové prostoru seznamu (assign popover — prototyp roster = wsMembers(l.ws))
	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", list.workspace_id],
		enabled: !!list.workspace_id,
		queryFn: async () => {
			const r = await fetch(
				`${API_URL}/api/workspaces/${list.workspace_id}/members`,
				{ credentials: "include" },
			);
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as { id: string; name: string }[];
		},
	});

	// klik mimo zavře assign popover
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const h = () => setAssignOpen(null);
		document.addEventListener("click", h);
		return () => document.removeEventListener("click", h);
	}, []);

	const saveField = async (col: "name" | "event", val: string) => {
		if ((list[col] ?? "") === val) return;
		await powerSync.execute(`UPDATE lists SET ${col} = ? WHERE id = ?`, [
			val,
			list.id,
		]);
	};

	const toggleItem = (it: ListItemRow) =>
		void powerSync.execute("UPDATE list_items SET done = ? WHERE id = ?", [
			it.done ? 0 : 1,
			it.id,
		]);

	const setWho = (it: ListItemRow, uid: string | null) => {
		setAssignOpen(null);
		void powerSync.execute("UPDATE list_items SET who_id = ? WHERE id = ?", [
			uid,
			it.id,
		]);
	};

	const addSection = async () => {
		const val = secName.trim();
		if (!val) return;
		const pos = sections.length
			? Math.max(...sections.map((s) => s.position ?? 0)) + 1
			: 0;
		setSecName("");
		await powerSync.execute(
			"INSERT INTO list_sections (id, list_id, workspace_id, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			[
				crypto.randomUUID(),
				list.id,
				list.workspace_id,
				val,
				pos,
				new Date().toISOString(),
			],
		);
	};

	const addItem = async (sec: ListSectionRow) => {
		const val = (inputs[sec.id] ?? "").trim();
		if (!val) return;
		const its = itemsBySection.get(sec.id) ?? [];
		const pos = its.length
			? Math.max(...its.map((x) => x.position ?? 0)) + 1
			: 0;
		setInputs((s) => ({ ...s, [sec.id]: "" }));
		await powerSync.execute(
			`INSERT INTO list_items (id, list_id, section_id, workspace_id, text, done, position, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
			[
				crypto.randomUUID(),
				list.id,
				sec.id,
				list.workspace_id,
				val,
				pos,
				new Date().toISOString(),
			],
		);
	};

	/** Reset po akci — vše odškrtnout + odarchivovat (prototyp resetList). */
	const reset = async () => {
		await powerSync.writeTransaction(async (tx) => {
			await tx.execute("UPDATE list_items SET done = 0 WHERE list_id = ?", [
				list.id,
			]);
			await tx.execute("UPDATE lists SET archived = 0 WHERE id = ?", [list.id]);
		});
		showToast(t("lists.resetToast"));
	};

	const archive = async () => {
		await powerSync.execute("UPDATE lists SET archived = ? WHERE id = ?", [
			list.archived ? 0 : 1,
			list.id,
		]);
		onClose();
	};

	/** Uložit jako šablonu (prototyp saveListAsTpl) — sekce+položky → JSON blueprint. */
	const saveAsTemplate = async () => {
		const secs: TplSection[] = sections.map((sec) => ({
			name: sec.name ?? "",
			items: (itemsBySection.get(sec.id) ?? []).map(
				(it) => `${it.text ?? ""}${it.qty ? `|${it.qty}` : ""}`,
			),
		}));
		await powerSync.execute(
			`INSERT INTO list_templates (id, workspace_id, name, description, sections, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				list.workspace_id,
				`${name} ${t("lists.tplSuffix")}`,
				t("lists.tplCustomDesc"),
				JSON.stringify(secs),
				new Date().toISOString(),
			],
		);
		showToast(t("lists.savedTplToast"));
	};

	return (
		<div
			ref={rootRef}
			className="mx-auto"
			style={{ maxWidth: 980, padding: "20px 22px 90px" }}
		>
			{/* horní lišta */}
			<div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
				<button
					type="button"
					onClick={onClose}
					className={`flex items-center ${pillBtnCls}`}
					style={{ ...pillBtnStyle, gap: 6, fontSize: 12.5 }}
				>
					<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
						<path
							d="M7.5 2 L3.5 6 L7.5 10"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					{t("nav.lists")}
				</button>
				<div className="flex-1" />
				<button
					type="button"
					onClick={toggleDoneSort}
					title={t("lists.doneSortTitle")}
					aria-pressed={doneDown}
					className={pillBtnCls}
					style={{
						...pillBtnStyle,
						...(doneDown
							? {
									borderColor: "var(--w-brass)",
									background: "var(--w-brass-soft)",
									color: "var(--w-brass-text)",
								}
							: {}),
					}}
				>
					{t("lists.doneSort")}
				</button>
				<button type="button" onClick={() => void reset()} className={pillBtnCls} style={pillBtnStyle}>
					{t("lists.reset")}
				</button>
				<button
					type="button"
					onClick={() => void saveAsTemplate()}
					className={pillBtnCls}
					style={pillBtnStyle}
				>
					{t("lists.saveAsTpl")}
				</button>
				<button type="button" onClick={() => void archive()} className={pillBtnCls} style={pillBtnStyle}>
					{list.archived ? t("lists.unarchive") : t("lists.archiveAct")}
				</button>
			</div>

			{/* hlavička seznamu */}
			<div
				className="rounded-[14px] border border-line bg-card"
				style={{
					padding: "16px 18px",
					boxShadow: "var(--w-shadow-sm)",
					marginBottom: 14,
				}}
			>
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					onBlur={() => void saveField("name", name.trim() || (list.name ?? ""))}
					onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
					className="w-full border-none bg-transparent font-display font-extrabold text-ink outline-none"
					style={{ fontSize: 20 }}
				/>
				<div className="flex items-center" style={{ gap: 8, marginTop: 4 }}>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.9"
						aria-hidden
						style={{ color: "var(--w-ink-3)", flexShrink: 0 }}
					>
						<rect x="4" y="5.2" width="16" height="14.8" rx="1.4" />
						<line x1="4" y1="9.6" x2="20" y2="9.6" />
						<line x1="8.4" y1="3.2" x2="8.4" y2="6.6" />
						<line x1="15.6" y1="3.2" x2="15.6" y2="6.6" />
					</svg>
					<input
						value={event}
						onChange={(e) => setEvent(e.target.value)}
						onBlur={() => void saveField("event", event.trim())}
						onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
						placeholder={t("lists.eventPlaceholder")}
						className="flex-1 border-none bg-transparent font-mono text-ink-2 outline-none"
						style={{ fontSize: 12 }}
					/>
					<span className="font-mono text-ink-3" style={{ fontSize: 11.5 }}>
						{t("lists.progressLabel", { done: stats.done, total: stats.total })}
					</span>
					<span className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
						{stats.pct} %
					</span>
				</div>
				<div style={{ marginTop: 10 }}>
					<ProgressBar pct={stats.pct} height={6} />
				</div>
			</div>

			{/* sekce */}
			{sections.map((sec) => {
				const its = itemsBySection.get(sec.id) ?? [];
				// „Odškrtnuté dolů": stabilní sort zachovává pořadí uvnitř skupin
				const shown = doneDown
					? [...its].sort((a, b) => Number(!!a.done) - Number(!!b.done))
					: its;
				const secDone = its.filter((x) => x.done).length;
				const complete = its.length > 0 && secDone >= its.length;
				return (
					<div
						key={sec.id}
						className="overflow-hidden rounded-[14px] border border-line bg-card"
						style={{ boxShadow: "var(--w-shadow-sm)", marginBottom: 12 }}
					>
						<div
							className="flex items-center bg-panel-2"
							style={{ gap: 8, padding: "11px 16px" }}
						>
							<span
								className="flex-1 font-display font-bold text-ink-2 uppercase"
								style={{ fontSize: 12, letterSpacing: ".04em" }}
							>
								{sec.name}
							</span>
							{complete && <DonePill label={t("lists.donePill")} />}
							<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
								{secDone}/{its.length}
							</span>
						</div>
						{shown.map((it) => {
							const who = (team ?? []).find((m) => m.id === it.who_id);
							const key = it.id;
							return (
								<div
									key={it.id}
									className="relative flex items-center border-line border-t"
									style={{ gap: 10, padding: "8px 16px" }}
								>
									{/* čtvercový checkbox (prototyp data-lscheck) */}
									<button
										type="button"
										onClick={() => toggleItem(it)}
										aria-pressed={!!it.done}
										className="grid shrink-0 place-items-center"
										style={{
											width: 18,
											height: 18,
											borderRadius: 6,
											border: `1.6px solid ${it.done ? "var(--w-brass)" : "var(--w-line)"}`,
											background: it.done ? "var(--w-brass)" : "var(--w-card)",
											color: it.done ? "#fff" : "transparent",
										}}
									>
										<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
											<path
												d="M1.5 5.5 L4 8 L8.5 2.5"
												stroke="currentColor"
												strokeWidth="1.8"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									</button>
									<span
										className="min-w-0 flex-1 font-body"
										style={{
											fontSize: 13.5,
											color: it.done ? "var(--w-ink-3)" : "var(--w-ink)",
											textDecoration: it.done ? "line-through" : undefined,
										}}
									>
										{it.text}
									</span>
									{it.qty && (
										<span
											className="shrink-0 rounded-md font-mono text-brass-text"
											style={{
												fontSize: 10.5,
												background: "var(--w-brass-soft)",
												padding: "1px 7px",
											}}
										>
											{it.qty}
										</span>
									)}
									<button
										type="button"
										title={who?.name ?? t("lists.assignTitle")}
										onClick={(e) => {
											e.stopPropagation();
											setAssignOpen(assignOpen === key ? null : key);
										}}
										className="flex shrink-0 items-center justify-center rounded-full font-display font-bold hover:border-brass hover:text-brass-text"
										style={{
											width: 24,
											height: 24,
											border: "1px dashed var(--w-line)",
											color: "var(--w-ink-3)",
											fontSize: 9,
										}}
									>
										{who ? initials(who.name) : "+"}
									</button>
									{assignOpen === key && (
										<div
											onClick={(e) => e.stopPropagation()}
											className="absolute z-40 flex rounded-[11px] border border-line bg-card"
											style={{
												right: 12,
												top: 34,
												gap: 4,
												padding: 6,
												boxShadow: "0 10px 30px rgba(20,20,30,.14)",
											}}
										>
											<button
												type="button"
												title={t("lists.assignNone")}
												onClick={() => setWho(it, null)}
												className="flex items-center justify-center rounded-full border border-line bg-panel-2 font-display font-bold text-ink-2 hover:border-brass"
												style={{ width: 28, height: 28, fontSize: 9.5 }}
											>
												—
											</button>
											{(team ?? []).map((m) => (
												<button
													key={m.id}
													type="button"
													title={m.name}
													onClick={() => setWho(it, m.id)}
													className="flex items-center justify-center rounded-full border font-display font-bold hover:border-brass"
													style={{
														width: 28,
														height: 28,
														fontSize: 9.5,
														background:
															it.who_id === m.id
																? "var(--w-brass-soft)"
																: "var(--w-panel-2)",
														borderColor:
															it.who_id === m.id
																? "var(--w-brass)"
																: "var(--w-line)",
														color:
															it.who_id === m.id
																? "var(--w-brass-text)"
																: "var(--w-ink-2)",
													}}
												>
													{initials(m.name)}
												</button>
											))}
										</div>
									)}
								</div>
							);
						})}
						{/* přidání položky */}
						<div
							className="flex items-center border-line border-t"
							style={{ gap: 10, padding: "7px 16px 9px" }}
						>
							<span
								className="shrink-0"
								style={{
									width: 18,
									height: 18,
									borderRadius: 6,
									border: "1.6px dashed var(--w-line)",
								}}
							/>
							<input
								value={inputs[sec.id] ?? ""}
								onChange={(e) =>
									setInputs((s) => ({ ...s, [sec.id]: e.target.value }))
								}
								onKeyDown={(e: KeyboardEvent<HTMLInputElement>) =>
									e.key === "Enter" && void addItem(sec)
								}
								placeholder={t("lists.addItemPlaceholder")}
								className="flex-1 border-none bg-transparent font-body text-ink outline-none"
								style={{ fontSize: 13 }}
							/>
						</div>
					</div>
				);
			})}

			{/* nová sekce (feedback — jako v šablonách, teď i ručně) */}
			<div
				className="flex items-center rounded-[14px] border border-line border-dashed bg-card"
				style={{ gap: 10, padding: "10px 16px" }}
			>
				<input
					value={secName}
					onChange={(e) => setSecName(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && void addSection()}
					placeholder={t("lists.sectionPh")}
					className="flex-1 border-none bg-transparent font-display font-semibold text-ink outline-none"
					style={{ fontSize: 13 }}
				/>
				<button
					type="button"
					onClick={() => void addSection()}
					className={pillBtnCls}
					style={pillBtnStyle}
				>
					{t("lists.addSection")}
				</button>
			</div>
		</div>
	);
}
