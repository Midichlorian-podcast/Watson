/**
 * Peek — rychlé odbavení položky z Přehledu/Velína NA MÍSTĚ. Feedback
 * 2026-07-11 (2. kolo): centrovaná karta jako detail úkolu (ne boční panel)
 * a položky jdou rovnou VYŘÍDIT — mail Hotovo/Odložit/→úkol, seznam
 * odškrtávání, úkoly členů a kroky postupů zaškrtnout. „Otevřít naplno"
 * provede původní navigaci (closure `openFull` dodá obrazovka — může nést
 * setActiveWs apod.). Vrstvení: z-40/41 = pod detailem úkolu (z-70), takže
 * klik na úkol v peeku vyskočí modal NAD kartou; Esc zavírá odshora.
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "../lib/auth-client";
import { initials } from "../lib/format";
import type { FlowOverviewRow, GoalOverviewRow } from "../lib/overview";
import type { ListItemRow, ListRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { P, SLA, TH } from "../mail/data";
import { useMail } from "../mail/state";

export type PeekTarget =
	| { kind: "goal"; goal: GoalOverviewRow & { firm?: string }; openFull: () => void }
	| { kind: "flow"; flow: FlowOverviewRow; openFull: () => void }
	| { kind: "mail"; id: string; openFull: () => void }
	| { kind: "list"; id: string; name: string; openFull: () => void }
	| { kind: "member"; id: string; name: string; openFull: () => void };

const KIND_LABEL: Record<PeekTarget["kind"], string> = {
	goal: "peek.goal",
	flow: "peek.flow",
	mail: "peek.mail",
	list: "peek.list",
	member: "peek.member",
};

/** Akční tlačítko peeku (styl akcí syntézy na Přehledu). */
function ActBtn({
	label,
	onClick,
	primary,
}: {
	label: string;
	onClick: () => void;
	primary?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={
				primary
					? "rounded-lg font-display font-semibold"
					: "rounded-lg border border-line bg-card font-display font-semibold text-ink-2 hover:border-brass hover:text-ink"
			}
			style={{
				fontSize: 12,
				padding: "6px 13px",
				...(primary
					? {
							background: "var(--w-brass-soft)",
							color: "var(--w-brass-text)",
							border: "1px solid rgba(198,138,62,.32)",
						}
					: {}),
			}}
		>
			{label}
		</button>
	);
}

export function PeekPanel({
	target,
	onClose,
}: {
	target: PeekTarget | null;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { openId } = useTaskDetail();
	// detail úkolu leží NAD peekem (z-70) — Esc nejdřív zavírá jeho
	const detailOpen = !!openId;

	useEffect(() => {
		if (!target || detailOpen) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape" && !document.querySelector("[data-esc-layer]"))
				onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [target, detailOpen, onClose]);

	if (!target) return null;

	const title =
		target.kind === "goal"
			? target.goal.name
			: target.kind === "flow"
				? target.flow.name
				: target.kind === "mail"
					? (TH.find((x) => x.id === target.id)?.subj ?? "")
					: target.name;

	return createPortal(
		// ztmavený scrim jako u detailu úkolu — klik mimo zavírá
		<div
			onClick={onClose}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 40,
				background: "rgba(10,14,20,.42)",
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				paddingTop: "7vh",
			}}
		>
			<section
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-label={title}
				className="border border-line bg-card"
				style={{
					width: "min(620px, 94vw)",
					maxHeight: "82vh",
					display: "flex",
					flexDirection: "column",
					borderRadius: 16,
					boxShadow: "var(--w-shadow)",
					animation: "wPeekPop .16s ease",
					overflow: "hidden",
				}}
			>
				{/* hlavička: druh + titulek + Otevřít naplno + × */}
				<div
					className="border-line border-b"
					style={{ padding: "14px 18px 12px", flex: "none" }}
				>
					<div className="flex items-center" style={{ gap: 8 }}>
						<span
							className="shrink-0 rounded-md font-display font-bold text-ink-3 uppercase"
							style={{
								fontSize: 9.5,
								letterSpacing: ".07em",
								padding: "2px 7px",
								background: "var(--w-panel-2)",
							}}
						>
							{t(KIND_LABEL[target.kind])}
						</span>
						<div className="flex-1" />
						<button
							type="button"
							onClick={() => {
								onClose();
								target.openFull();
							}}
							className="shrink-0 rounded-lg font-display font-semibold"
							style={{
								fontSize: 11.5,
								padding: "4px 11px",
								background: "var(--w-brass-soft)",
								color: "var(--w-brass-text)",
								border: "1px solid rgba(198,138,62,.32)",
							}}
						>
							{t("peek.open")} →
						</button>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("peek.close")}
							className="grid shrink-0 place-items-center rounded-lg border border-line text-ink-3 hover:text-ink"
							style={{ width: 26, height: 26, fontSize: 14 }}
						>
							×
						</button>
					</div>
					{title && (
						<div
							className="font-display font-bold text-ink"
							style={{ fontSize: 15.5, marginTop: 8, lineHeight: 1.3 }}
						>
							{title}
						</div>
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 18 }}>
					{target.kind === "goal" && <GoalPeek goal={target.goal} />}
					{target.kind === "flow" && <FlowPeek flow={target.flow} />}
					{target.kind === "mail" && (
						<MailPeek id={target.id} onClose={onClose} />
					)}
					{target.kind === "list" && <ListPeek id={target.id} />}
					{target.kind === "member" && (
						<MemberPeek id={target.id} name={target.name} />
					)}
				</div>
			</section>
			<style>{`@keyframes wPeekPop{from{transform:translateY(8px) scale(.985);opacity:0}to{transform:none;opacity:1}}`}</style>
		</div>,
		document.body,
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div
			className="font-display font-bold text-ink-3 uppercase"
			style={{ fontSize: 10, letterSpacing: ".07em", margin: "16px 0 7px" }}
		>
			{children}
		</div>
	);
}

/** Zaškrtávátko úkolu v peeku (vzor karta Dnes na Přehledu). */
function PeekCheck({
	done,
	onToggle,
	label,
}: {
	done?: boolean;
	onToggle: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
			className="grid shrink-0 place-items-center rounded-full hover:border-brass"
			style={{
				width: 17,
				height: 17,
				background: done ? "var(--w-brass)" : "var(--w-card)",
				border: done ? "none" : "1.6px solid var(--w-line)",
				color: done ? "#fff" : "transparent",
			}}
		>
			<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
				<path
					d="M1.5 5.5 L4 8 L8.5 2.5"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}

/** Cíl — progres, metrika, uplynulý čas (data z useGoalsOverview, bez dalších dotazů). */
function GoalPeek({ goal }: { goal: GoalOverviewRow & { firm?: string } }) {
	const { t } = useTranslation();
	const riskColor =
		goal.status === "risk" || goal.status === "over"
			? "var(--w-overdue)"
			: "var(--w-brass)";
	return (
		<div>
			<div className="flex items-baseline" style={{ gap: 8 }}>
				<span
					className="font-display font-bold text-ink"
					style={{ fontSize: 26 }}
				>
					{goal.pct} %
				</span>
				{goal.firm && (
					<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
						{goal.firm}
					</span>
				)}
			</div>
			<div
				className="overflow-hidden rounded-full bg-panel-2"
				style={{ height: 7, margin: "10px 0 8px" }}
			>
				<div
					style={{
						height: "100%",
						width: `${Math.min(100, goal.pct)}%`,
						background: riskColor,
						borderRadius: "inherit",
					}}
				/>
			</div>
			<div className="font-body text-ink-2" style={{ fontSize: 12.5 }}>
				{goal.label}
			</div>
			<div
				className="font-body text-ink-3"
				style={{ fontSize: 12, marginTop: 4 }}
			>
				{t("prehled.elapsed", { elapsed: goal.elapsed })}
			</div>
			{(goal.status === "risk" || goal.status === "over") && (
				<div
					className="font-body"
					style={{
						fontSize: 12,
						marginTop: 12,
						padding: "9px 12px",
						borderRadius: 10,
						background: "var(--w-overdue-soft)",
						color: "var(--w-overdue)",
					}}
				>
					{t("peek.goalRisk")}
				</div>
			)}
		</div>
	);
}

/** Postup — kroky řetězce; aktivní krok jde dokončit rovnou zaškrtnutím. */
function FlowPeek({ flow }: { flow: FlowOverviewRow }) {
	const { t } = useTranslation();
	const { open } = useTaskDetail();
	const { data: session } = useSession();
	const myId = session?.user?.id;
	const { data: steps } = usePsQuery<{
		task_id: string | null;
		position: number | null;
		step_state: string | null;
		name: string | null;
		due_date: string | null;
	}>(
		`SELECT cs.task_id, cs.position, cs.step_state, t.name, t.due_date
		 FROM chain_steps cs LEFT JOIN tasks t ON t.id = cs.task_id
		 WHERE cs.chain_id = ? ORDER BY cs.position`,
		[flow.id],
	);
	// dokončení kroku = dokončení jeho úkolu (posun štafety řídí server)
	const completeStep = async (taskId: string) => {
		const rows = await powerSync.getAll<TaskRow>(
			"SELECT * FROM tasks WHERE id = ?",
			[taskId],
		);
		if (rows[0]) await toggleTask(rows[0], myId);
	};
	return (
		<div>
			<div className="font-mono text-ink-2" style={{ fontSize: 12 }}>
				{flow.done}/{flow.total} · {flow.pct} %
			</div>
			{flow.stuck && (
				<div
					className="font-body"
					style={{
						fontSize: 12,
						marginTop: 10,
						padding: "9px 12px",
						borderRadius: 10,
						background: "var(--w-overdue-soft)",
						color: "var(--w-overdue)",
					}}
				>
					{t("prehled.stuckNow", {
						name: flow.nowName,
						who: flow.nowWho || t("flows.anyoneTeam"),
					})}
				</div>
			)}
			<SectionLabel>{t("peek.steps")}</SectionLabel>
			{(steps ?? []).map((s, i) => {
				const active = s.step_state === "active";
				const done = s.step_state === "done";
				return (
					<div
						key={s.task_id ?? i}
						onClick={() => s.task_id && open(s.task_id)}
						className="flex cursor-pointer items-center rounded-lg hover:bg-panel-2"
						style={{ gap: 10, padding: "6px 8px" }}
					>
						{active && s.task_id ? (
							<PeekCheck
								onToggle={() => void completeStep(s.task_id as string)}
								label={t("peek.stepDone")}
							/>
						) : (
							<span
								className="grid shrink-0 place-items-center rounded-full font-mono"
								style={{
									width: 17,
									height: 17,
									fontSize: 9,
									background: done
										? "var(--w-success-soft)"
										: "var(--w-panel-2)",
									color: done ? "var(--w-success-ink)" : "var(--w-ink-3)",
								}}
							>
								{done ? "✓" : i + 1}
							</span>
						)}
						<span
							className={
								done
									? "min-w-0 flex-1 truncate font-body text-ink-3 line-through"
									: "min-w-0 flex-1 truncate font-body text-ink"
							}
							style={{ fontSize: 12.5 }}
						>
							{s.name}
						</span>
						{active && (
							<span
								className="shrink-0 font-display font-semibold text-brass-text"
								style={{ fontSize: 10 }}
							>
								{t("peek.stepNow")}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}

/** Jméno fake přílohy + neviditelný marker „poslat bez přílohy" (vzor MailThread). */
const PEEK_ATT_NAME = "dokument_1.pdf · 118 kB";
const PEEK_ATT_MARK = "—";

/**
 * Pošta — plný workspace v peeku (feedback 3. kolo: „napsat komplet mail,
 * odeslat ho, přidělit ho"): všechny zprávy, přidělení vlastníka, odpověď
 * s REAL-TIME ukládáním do Konceptů (stejný draft store jako vlákno),
 * odeslání přes checkSend (celý řetěz ochran) a rychlé akce. Po odeslání
 * nebo Hotovo se karta zavře → zpátky na Přehled/Velín.
 */
function MailPeek({ id, onClose }: { id: string; onClose: () => void }) {
	const { t } = useTranslation();
	const m = useMail();
	const th = TH.find((x) => x.id === id);
	// odeslání odložené na další render — checkSend čte attached ze zavřeného
	// kontextu, po m.attach() musí proběhnout nový render (vzor MailThread pend)
	const [pend, setPend] = useState<{ markDone: boolean } | null>(null);
	// počet odeslaných před pokusem — nárůst = doopravdy odesláno → zavřít
	const sentBase = useRef<number | null>(null);
	const setOv = m.setOv;

	// otevření peeku = přečteno (zrcadlí openThread, state.tsx ř. 460)
	useEffect(() => {
		setOv(id, { read: true });
	}, [id, setOv]);

	useEffect(() => {
		if (pend && th) {
			setPend(null);
			m.checkSend(th, pend.markDone);
		}
	}, [pend, th, m]);

	const sentCount = (m.sentX[id] ?? []).length;
	useEffect(() => {
		if (sentBase.current !== null && sentCount > sentBase.current) {
			sentBase.current = null;
			showToast(t("peek.sentToast"));
			onClose();
		}
	}, [sentCount, onClose, t]);

	if (!th) return null;
	const sla = th.flag ? SLA[th.flag] : undefined;
	const hasTask = (m.taskLinks[id] ?? []).length > 0;
	const ownerKey = m.ovOf(id).owner ?? th.owner ?? null;
	const draftText = m.drafts[id]?.text ?? (th.draft ?? []).join("\n");
	const attachedLabel = m.attached[id];
	const warnHere = m.warn?.id === id ? m.warn : null;
	const allMsgs = [...th.msgs, ...(m.sentX[id] ?? [])];

	const trySend = (markDone: boolean) => {
		sentBase.current = sentCount;
		m.checkSend(th, markDone);
	};

	return (
		<div>
			<div className="flex items-center" style={{ gap: 8 }}>
				<span
					className="flex shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 font-display font-bold text-ink-2"
					style={{ width: 30, height: 30, fontSize: 10 }}
				>
					{th.from.ini}
				</span>
				<div className="min-w-0 flex-1">
					<div
						className="truncate font-display font-semibold text-ink"
						style={{ fontSize: 12.5 }}
					>
						{th.from.n}
					</div>
					<div className="truncate font-mono text-ink-3" style={{ fontSize: 10.5 }}>
						{th.from.addr} · {th.mb ? `${th.mb}@` : t("peek.mailPersonal")} · {th.time}
					</div>
				</div>
				{(th.flag === "p1" || th.flag === "p2") && (
					<span
						className="shrink-0 font-mono"
						style={{
							fontSize: 10,
							color: "var(--w-overdue)",
							border: "1px solid var(--w-overdue)",
							borderRadius: 5,
							padding: "0 5px",
						}}
					>
						{th.flag.toUpperCase()}
						{sla ? ` · ${sla.sla}` : ""}
					</span>
				)}
			</div>

			{/* přidělení vlastníka (m.setOwner — týmové vlákno) */}
			{!th.personal && (
				<div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 12 }}>
					<span
						className="shrink-0 font-display font-semibold text-ink-3"
						style={{ fontSize: 10.5 }}
					>
						{t("peek.owner")}:
					</span>
					<button
						type="button"
						onClick={() => m.setOwner(id, null)}
						className="rounded-full border font-display font-semibold"
						style={{
							fontSize: 10.5,
							padding: "2px 9px",
							borderColor: ownerKey ? "var(--w-line)" : "var(--w-brass)",
							background: ownerKey ? "var(--w-card)" : "var(--w-brass-soft)",
							color: ownerKey ? "var(--w-ink-3)" : "var(--w-brass-text)",
						}}
					>
						{t("peek.ownerNone")}
					</button>
					{Object.entries(P).map(([key, p]) => (
						<button
							key={key}
							type="button"
							onClick={() => m.setOwner(id, key)}
							title={p.n}
							className="rounded-full border font-display font-semibold"
							style={{
								fontSize: 10.5,
								padding: "2px 9px",
								borderColor: ownerKey === key ? "var(--w-brass)" : "var(--w-line)",
								background: ownerKey === key ? "var(--w-brass-soft)" : "var(--w-card)",
								color: ownerKey === key ? "var(--w-brass-text)" : "var(--w-ink-2)",
							}}
						>
							{p.n.split(" ")[0]}
						</button>
					))}
				</div>
			)}

			{/* rychlé odbavení — po akci zpátky na Přehled/Velín */}
			<div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
				<ActBtn
					label={t("bulk.done")}
					onClick={() => {
						m.rowAct(id, "done");
						onClose();
					}}
				/>
				<ActBtn
					label={t("peek.mailSnooze")}
					onClick={() => {
						m.rowAct(id, "snooze");
						onClose();
					}}
				/>
				{!hasTask && (
					<ActBtn label={t("peek.mailTask")} onClick={() => m.quickTask(id)} />
				)}
			</div>

			{th.sum && (
				<div
					className="font-body text-ink-2"
					style={{
						fontSize: 12,
						marginTop: 12,
						padding: "9px 12px",
						borderRadius: 10,
						background: "var(--w-brass-soft)",
						lineHeight: 1.5,
					}}
				>
					{th.sum}
				</div>
			)}

			<SectionLabel>{t("peek.mailMsgs")}</SectionLabel>
			{allMsgs.map((mg, i) => (
				<div
					key={`${mg.t}-${i}`}
					className="rounded-[10px] border border-line"
					style={{ padding: "10px 12px", marginBottom: 8 }}
				>
					<div className="flex items-center font-mono text-ink-3" style={{ gap: 6, fontSize: 10 }}>
						<span>{mg.dir === "in" ? "→" : "←"}</span>
						<span>{mg.t}</span>
						<span className="min-w-0 flex-1 truncate">{mg.to}</span>
					</div>
					<div
						className="font-body text-ink-2"
						style={{ fontSize: 12, marginTop: 6, lineHeight: 1.55 }}
					>
						{mg.body.map((pp, j) => (
							<p key={`${j}-${pp.slice(0, 8)}`} style={{ margin: "0 0 5px" }}>
								{pp}
							</p>
						))}
					</div>
				</div>
			))}
			{th.chat.length > 0 && (
				<div className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
					{t("peek.mailChat", { count: th.chat.length })}
				</div>
			)}

			{/* odpověď — STEJNÝ draft store jako vlákno (real-time → Koncepty) */}
			<SectionLabel>{t("peek.reply")}</SectionLabel>
			<textarea
				value={draftText}
				onChange={(e) => m.setDraft(id, e.target.value)}
				rows={4}
				placeholder={t("peek.replyPh")}
				className="font-body text-ink"
				style={{
					width: "100%",
					boxSizing: "border-box",
					border: "1px solid var(--w-line)",
					background: "var(--w-panel-2)",
					borderRadius: 11,
					padding: "10px 12px",
					fontSize: 12.5,
					lineHeight: 1.55,
					outline: "none",
					resize: "vertical",
				}}
			/>
			{attachedLabel && attachedLabel !== PEEK_ATT_MARK && (
				<div
					className="inline-flex items-center font-mono text-ink-2"
					style={{
						gap: 5,
						fontSize: 10,
						background: "var(--w-panel-2)",
						border: "1px solid var(--w-line)",
						borderRadius: 6,
						padding: "2px 8px",
						marginTop: 6,
					}}
				>
					📎 {attachedLabel}
					<button
						type="button"
						onClick={() => m.detach(id)}
						className="text-ink-3"
						style={{ lineHeight: 1 }}
					>
						×
					</button>
				</div>
			)}

			{/* inline varování o slíbené příloze — MailThread tu není, kreslíme sami */}
			{warnHere && (
				<div
					className="font-body"
					style={{
						fontSize: 12,
						marginTop: 10,
						padding: "10px 12px",
						borderRadius: 10,
						background: "var(--w-overdue-soft)",
						color: "var(--w-ink)",
					}}
				>
					<div className="font-display font-bold" style={{ fontSize: 12.5 }}>
						{t("peek.warnTitle")}
					</div>
					<div className="flex flex-wrap" style={{ gap: 7, marginTop: 8 }}>
						<ActBtn label={t("peek.warnCancel")} onClick={() => m.setWarn(null)} />
						<ActBtn
							label={t("peek.warnAnyway")}
							onClick={() => {
								m.attach(id, PEEK_ATT_MARK);
								m.setWarn(null);
								setPend({ markDone: warnHere.markDone });
							}}
						/>
						<ActBtn
							primary
							label={t("peek.warnAttach")}
							onClick={() => {
								m.attach(id, PEEK_ATT_NAME);
								m.setWarn(null);
								setPend({ markDone: warnHere.markDone });
							}}
						/>
					</div>
				</div>
			)}

			<div className="flex flex-wrap items-center" style={{ gap: 8, marginTop: 10 }}>
				<ActBtn primary label={t("peek.send")} onClick={() => trySend(false)} />
				<ActBtn label={t("peek.sendDone")} onClick={() => trySend(true)} />
				<ActBtn
					label={t("peek.attach")}
					onClick={() => m.attach(id, PEEK_ATT_NAME)}
				/>
				<span className="font-body text-ink-3" style={{ fontSize: 10.5, marginLeft: "auto" }}>
					{t("peek.draftNote")}
				</span>
			</div>
		</div>
	);
}

/** Seznam (checklist) — položky jdou odškrtávat rovnou v peeku. */
function ListPeek({ id }: { id: string }) {
	const { t } = useTranslation();
	const { data: lists } = usePsQuery<ListRow>(
		"SELECT * FROM lists WHERE id = ?",
		[id],
	);
	const { data: items } = usePsQuery<ListItemRow>(
		"SELECT * FROM list_items WHERE list_id = ? ORDER BY position",
		[id],
	);
	const l = lists?.[0];
	if (!l) return null;
	const done = (items ?? []).filter((x) => x.done).length;
	// stejný zápis jako Seznamy.tsx toggleItem
	const toggleItem = (it: ListItemRow) =>
		void powerSync.execute("UPDATE list_items SET done = ? WHERE id = ?", [
			it.done ? 0 : 1,
			it.id,
		]);
	return (
		<div>
			<div className="flex items-center" style={{ gap: 9 }}>
				<span className="font-mono text-ink-2" style={{ fontSize: 12 }}>
					{done}/{(items ?? []).length}
				</span>
				{l.event && (
					<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
						{l.event}
					</span>
				)}
			</div>
			<div
				className="overflow-hidden rounded-full bg-panel-2"
				style={{ height: 6, margin: "9px 0 4px" }}
			>
				<div
					style={{
						height: "100%",
						width: `${(items ?? []).length ? Math.round((done / (items ?? []).length) * 100) : 0}%`,
						background: done === (items ?? []).length && done > 0 ? "#2e9c6e" : "var(--w-brass)",
						borderRadius: "inherit",
					}}
				/>
			</div>
			<SectionLabel>{t("peek.listItems")}</SectionLabel>
			{(items ?? []).map((it) => (
				<div
					key={it.id}
					onClick={() => toggleItem(it)}
					className="flex cursor-pointer items-center rounded-lg hover:bg-panel-2"
					style={{ gap: 9, padding: "5px 8px" }}
				>
					<span
						className="grid shrink-0 place-items-center rounded-[5px]"
						style={{
							width: 15,
							height: 15,
							border: it.done ? "none" : "1.6px solid var(--w-line)",
							background: it.done ? "var(--w-brass)" : "transparent",
							color: "#fff",
							fontSize: 9,
						}}
					>
						{it.done ? "✓" : ""}
					</span>
					<span
						className={
							it.done
								? "min-w-0 flex-1 truncate font-body text-ink-3 line-through"
								: "min-w-0 flex-1 truncate font-body text-ink"
						}
						style={{ fontSize: 12.5 }}
					>
						{it.text}
						{it.qty ? ` · ${it.qty}` : ""}
					</span>
				</div>
			))}
		</div>
	);
}

/** Člen týmu (Velín „Zátěž lidí") — úkoly jdou rovnou dokončit; klik = detail. */
function MemberPeek({ id, name }: { id: string; name: string }) {
	const { t } = useTranslation();
	const { open } = useTaskDetail();
	const { data: session } = useSession();
	const myId = session?.user?.id;
	const projects = useProjects();
	const { data: rows } = usePsQuery<TaskRow>(
		`SELECT t.* FROM tasks t JOIN assignments a ON a.task_id = t.id
		 WHERE a.user_id = ? AND t.completed_at IS NULL
		 ORDER BY t.due_date IS NULL, t.due_date, t.priority`,
		[id],
	);
	const projById = new Map(projects.map((p) => [p.id, p]));
	const tdy = new Date().toISOString().slice(0, 10);
	return (
		<div>
			<div className="flex items-center" style={{ gap: 9, marginBottom: 4 }}>
				<span
					className="flex shrink-0 items-center justify-center rounded-full font-display font-bold"
					style={{
						width: 28,
						height: 28,
						background: "var(--w-avatar)",
						color: "#fff",
						fontSize: 10,
					}}
				>
					{initials(name)}
				</span>
				<span className="font-body text-ink-2" style={{ fontSize: 12.5 }}>
					{t("peek.memberTasks", { count: (rows ?? []).length })}
				</span>
			</div>
			<SectionLabel>{t("peek.memberOpen")}</SectionLabel>
			{(rows ?? []).length === 0 && (
				<div className="font-body text-ink-3" style={{ fontSize: 12.5 }}>
					{t("peek.memberEmpty")}
				</div>
			)}
			{(rows ?? []).slice(0, 12).map((tk) => {
				const p = tk.project_id ? projById.get(tk.project_id) : undefined;
				const over = !!tk.due_date && tk.due_date.slice(0, 10) < tdy;
				return (
					<div
						key={tk.id}
						onClick={() => open(tk.id)}
						className="flex cursor-pointer items-center rounded-lg hover:bg-panel-2"
						style={{ gap: 9, padding: "6px 8px" }}
					>
						<PeekCheck
							onToggle={() => void toggleTask(tk, myId)}
							label={t("detail.ariaComplete")}
						/>
						<span
							className="shrink-0 rounded-full"
							style={{
								width: 7,
								height: 7,
								background: p?.color ?? "var(--w-ink-3)",
							}}
						/>
						<span
							className="min-w-0 flex-1 truncate font-body text-ink"
							style={{ fontSize: 12.5 }}
						>
							{tk.name}
						</span>
						{tk.due_date && (
							<span
								className="shrink-0 font-mono"
								style={{
									fontSize: 10.5,
									color: over ? "var(--w-overdue)" : "var(--w-ink-3)",
								}}
							>
								{tk.due_date.slice(5, 10)}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
