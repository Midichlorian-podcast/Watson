/** F6 — vysvětlitelný Radar dopadů nad autoritativními fakty, bez employee scoringu. */
import {
	and,
	assignments,
	availabilityBlocks,
	availabilityTaskOverrides,
	decisions,
	decisionTaskLinks,
	eq,
	getDb,
	inArray,
	isNull,
	memberships,
	projectMembers,
	projects,
	sql,
	taskDependencies,
	tasks,
	users,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const radarRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const querySchema = z
	.object({
		workspaceId: uuid.optional(),
		timezone: z.string().trim().min(1).max(64).default("UTC"),
		severity: z.enum(["critical", "high", "medium"]).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	})
	.strict();

type Severity = "critical" | "high" | "medium";
type Confidence = "high" | "medium";
type EvidenceBasis = "fact" | "projection";
type EvidenceCode =
	| "deadline_overdue"
	| "due_overdue"
	| "deadline_soon"
	| "due_soon"
	| "incomplete_blocker"
	| "sequence_impossible"
	| "assignee_unavailable"
	| "focus_conflict"
	| "schedule_collision"
	| "unassigned"
	| "decision_review_overdue"
	| "decision_review_soon";

export type RadarEvidence = {
	id: string;
	code: EvidenceCode;
	label: string;
	detail: string;
	weight: number;
	basis: EvidenceBasis;
	source: { type: "task" | "decision" | "availability" | "dependency"; id: string };
};

export type RadarItem = {
	id: string;
	entityType: "task" | "decision";
	entityId: string;
	workspaceId: string;
	workspaceName: string;
	projectId: string;
	projectName: string;
	title: string;
	severity: Severity;
	score: number;
	confidence: Confidence;
	targetDate: string | null;
	evidence: RadarEvidence[];
};

type RadarTask = {
	id: string;
	projectId: string;
	name: string;
	priority: number;
	dueDate: Date | null;
	deadline: Date | null;
	startDate: Date | null;
	durationMin: number | null;
};

type ProjectScope = {
	projectId: string;
	projectName: string;
	workspaceId: string;
	workspaceName: string;
};

const MAX_TASK_CANDIDATES = 5_000;
const MAX_DECISION_CANDIDATES = 2_000;
const LOOKAHEAD_DAYS = 14;

function validTimeZone(value: string) {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
		return /^(UTC|[A-Za-z_]+\/[A-Za-z0-9_+./-]+)$/.test(value);
	} catch {
		return false;
	}
}

function isoDayInZone(value: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(value);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return `${read("year")}-${read("month")}-${read("day")}`;
}

function storedDay(value: Date | null) {
	return value?.toISOString().slice(0, 10) ?? null;
}

function dayNumber(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

function dayDifference(target: string, today: string) {
	return dayNumber(target) - dayNumber(today);
}

function severityFor(score: number): Severity {
	if (score >= 85) return "critical";
	if (score >= 60) return "high";
	return "medium";
}

function itemScore(evidence: RadarEvidence[]) {
	return Math.min(100, evidence.reduce((sum, item) => sum + item.weight, 0));
}

function confidenceFor(evidence: RadarEvidence[], score: number): Confidence {
	return score >= 60 && evidence.some((item) => item.basis === "fact") ? "high" : "medium";
}

function formatMoment(value: Date, timezone: string) {
	return new Intl.DateTimeFormat("cs-CZ", {
		timeZone: timezone,
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value);
}

function addEvidence(
	map: Map<string, RadarEvidence[]>,
	taskId: string,
	evidence: RadarEvidence,
) {
	const current = map.get(taskId) ?? [];
	if (!current.some((item) => item.id === evidence.id)) current.push(evidence);
	map.set(taskId, current);
}

function taskTargetDate(task: RadarTask) {
	return storedDay(task.deadline) ?? storedDay(task.dueDate);
}

export async function buildRadarSnapshot(input: {
	userId: string;
	workspaceId?: string;
	timezone: string;
	severity?: Severity;
	limit: number;
	now?: Date;
}) {
	const db = getDb();
	const now = input.now ?? new Date();
	const today = isoDayInZone(now, input.timezone);
	const leadershipFilters = [
		eq(memberships.userId, input.userId),
		eq(workspaces.isPersonal, false),
		inArray(memberships.role, ["admin", "manager"]),
	];
	if (input.workspaceId) leadershipFilters.push(eq(workspaces.id, input.workspaceId));
	const leadershipScopes = await db
		.select({ id: workspaces.id, name: workspaces.name })
		.from(workspaces)
		.innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
		.where(and(...leadershipFilters));
	if (leadershipScopes.length === 0) {
		const error = new Error(input.workspaceId ? "radar_scope_not_found" : "radar_forbidden");
		(error as Error & { status?: number }).status = input.workspaceId ? 404 : 403;
		throw error;
	}

	const workspaceIds = leadershipScopes.map((scope) => scope.id);
	const projectScopes = await db
		.select({
			projectId: projects.id,
			projectName: projects.name,
			workspaceId: workspaces.id,
			workspaceName: workspaces.name,
		})
		.from(projects)
		.innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
		.innerJoin(
			projectMembers,
			and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, input.userId)),
		)
		.where(
			and(
				inArray(projects.workspaceId, workspaceIds),
				inArray(projects.status, ["active", "paused"]),
			),
		);
	const scopeByProject = new Map(
		projectScopes.map((scope) => [scope.projectId, scope as ProjectScope]),
	);
	const projectIds = projectScopes.map((scope) => scope.projectId);
	const baseResponse = {
		rulesetVersion: "radar:v1" as const,
		asOf: now.toISOString(),
		timezone: input.timezone,
		scope: {
			workspaces: leadershipScopes,
			projectCount: projectIds.length,
		},
	};
	if (projectIds.length === 0) {
		return {
			...baseResponse,
			coverage: "complete" as const,
			total: 0,
			counts: { critical: 0, high: 0, medium: 0 },
			items: [] as RadarItem[],
		};
	}

	const taskRows = await db
		.select({
			id: tasks.id,
			projectId: tasks.projectId,
			name: tasks.name,
			priority: tasks.priority,
			dueDate: tasks.dueDate,
			deadline: tasks.deadline,
			startDate: tasks.startDate,
			durationMin: tasks.durationMin,
		})
		.from(tasks)
		.where(
			and(
				inArray(tasks.projectId, projectIds),
				eq(tasks.kind, "task"),
				isNull(tasks.completedAt),
			),
		)
		.limit(MAX_TASK_CANDIDATES + 1);
	const taskCoverageLimited = taskRows.length > MAX_TASK_CANDIDATES;
	const radarTasks = taskRows.slice(0, MAX_TASK_CANDIDATES) as RadarTask[];
	const taskIds = radarTasks.map((task) => task.id);
	const taskById = new Map(radarTasks.map((task) => [task.id, task]));
	const evidenceByTask = new Map<string, RadarEvidence[]>();

	for (const task of radarTasks) {
		const deadline = storedDay(task.deadline);
		const due = storedDay(task.dueDate);
		if (deadline) {
			const days = dayDifference(deadline, today);
			if (days < 0) {
				addEvidence(evidenceByTask, task.id, {
					id: `deadline_overdue:${deadline}`,
					code: "deadline_overdue",
					label: "Pevný termín je po splatnosti",
					detail: `Deadline ${deadline} uplynul před ${Math.abs(days)} dny.`,
					weight: 80,
					basis: "fact",
					source: { type: "task", id: task.id },
				});
			} else if (days <= 3) {
				addEvidence(evidenceByTask, task.id, {
					id: `deadline_soon:${deadline}`,
					code: "deadline_soon",
					label: days === 0 ? "Pevný termín je dnes" : "Pevný termín se blíží",
					detail: days === 0 ? `Deadline je dnes (${deadline}).` : `Do deadline ${deadline} zbývají ${days} dny.`,
					weight: days === 0 ? 50 : 45,
					basis: "projection",
					source: { type: "task", id: task.id },
				});
			}
		} else if (due) {
			const days = dayDifference(due, today);
			if (days < 0) {
				addEvidence(evidenceByTask, task.id, {
					id: `due_overdue:${due}`,
					code: "due_overdue",
					label: "Plánované dokončení je po termínu",
					detail: `Plánované datum ${due} uplynulo před ${Math.abs(days)} dny.`,
					weight: 65,
					basis: "fact",
					source: { type: "task", id: task.id },
				});
			} else if (days <= 2) {
				addEvidence(evidenceByTask, task.id, {
					id: `due_soon:${due}`,
					code: "due_soon",
					label: days === 0 ? "Dokončení je plánované na dnes" : "Plánované dokončení se blíží",
					detail: days === 0 ? `Úkol je plánovaný na dnešek (${due}).` : `Do plánovaného data ${due} zbývají ${days} dny.`,
					weight: days === 0 ? 40 : 30,
					basis: "projection",
					source: { type: "task", id: task.id },
				});
			}
		}
	}

	const assignmentRows = taskIds.length
		? await db
				.select({ taskId: assignments.taskId, userId: assignments.userId, name: users.name })
				.from(assignments)
				.innerJoin(users, eq(users.id, assignments.userId))
				.where(inArray(assignments.taskId, taskIds))
		: [];
	const assignmentsByTask = new Map<string, Array<{ userId: string; name: string }>>();
	for (const row of assignmentRows) {
		assignmentsByTask.set(row.taskId, [
			...(assignmentsByTask.get(row.taskId) ?? []),
			{ userId: row.userId, name: row.name },
		]);
	}
	for (const task of radarTasks) {
		const target = taskTargetDate(task);
		if (
			target &&
			dayDifference(target, today) <= 7 &&
			(assignmentsByTask.get(task.id)?.length ?? 0) === 0
		) {
			addEvidence(evidenceByTask, task.id, {
				id: `unassigned:${task.id}`,
				code: "unassigned",
				label: "Chybí odpovědný člověk",
				detail: `Úkol má datum ${target}, ale nemá žádného řešitele.`,
				weight: 30,
				basis: "fact",
				source: { type: "task", id: task.id },
			});
		}
	}

	const dependencyRows = await db
		.select({
			id: taskDependencies.id,
			blockedTaskId: taskDependencies.blockedTaskId,
			blockingTaskId: taskDependencies.blockingTaskId,
		})
		.from(taskDependencies)
		.where(inArray(taskDependencies.projectId, projectIds));
	const blockerIds = [...new Set(dependencyRows.map((row) => row.blockingTaskId))];
	const blockerRows = blockerIds.length
		? await db
				.select({
					id: tasks.id,
					name: tasks.name,
					dueDate: tasks.dueDate,
					deadline: tasks.deadline,
					completedAt: tasks.completedAt,
				})
				.from(tasks)
				.where(inArray(tasks.id, blockerIds))
		: [];
	const blockers = new Map(blockerRows.map((row) => [row.id, row]));
	for (const edge of dependencyRows) {
		const blocked = taskById.get(edge.blockedTaskId);
		const blocker = blockers.get(edge.blockingTaskId);
		if (!blocked || !blocker || blocker.completedAt) continue;
		addEvidence(evidenceByTask, blocked.id, {
			id: `incomplete_blocker:${edge.id}`,
			code: "incomplete_blocker",
			label: "Čeká na nedokončený předchozí krok",
			detail: `Blokuje jej „${blocker.name}“.`,
			weight: 45,
			basis: "fact",
			source: { type: "dependency", id: edge.id },
		});
		const target = taskTargetDate(blocked);
		const blockerTarget = storedDay(blocker.deadline) ?? storedDay(blocker.dueDate);
		if (target && blockerTarget && blockerTarget > target) {
			addEvidence(evidenceByTask, blocked.id, {
				id: `sequence_impossible:${edge.id}`,
				code: "sequence_impossible",
				label: "Pořadí termínů nedává prostor k dokončení",
				detail: `Blokující krok má datum ${blockerTarget}, ale tento úkol už ${target}.`,
				weight: 25,
				basis: "fact",
				source: { type: "dependency", id: edge.id },
			});
		}
	}

	const windowStart = new Date(now.getTime() - 7 * 86_400_000);
	const windowEnd = new Date(now.getTime() + 45 * 86_400_000);
	const blockRows = await db
		.select({
			id: availabilityBlocks.id,
			workspaceId: availabilityBlocks.workspaceId,
			userId: availabilityBlocks.userId,
			kind: availabilityBlocks.kind,
			startsAt: availabilityBlocks.startsAt,
			endsAt: availabilityBlocks.endsAt,
			timezone: availabilityBlocks.timezone,
		})
		.from(availabilityBlocks)
		.where(
			and(
				inArray(availabilityBlocks.workspaceId, workspaceIds),
				isNull(availabilityBlocks.cancelledAt),
				sql`${availabilityBlocks.endsAt} >= ${windowStart.toISOString()}::timestamptz`,
				sql`${availabilityBlocks.startsAt} <= ${windowEnd.toISOString()}::timestamptz`,
			),
		)
		.limit(5_001);
	const blockCoverageLimited = blockRows.length > 5_000;
	const activeBlocks = blockRows.slice(0, 5_000);
	const blockIds = activeBlocks.map((block) => block.id);
	const overrideRows = taskIds.length && blockIds.length
		? await db
				.select({
					blockId: availabilityTaskOverrides.blockId,
					taskId: availabilityTaskOverrides.taskId,
					assigneeId: availabilityTaskOverrides.assigneeId,
				})
				.from(availabilityTaskOverrides)
				.where(
					and(
						inArray(availabilityTaskOverrides.taskId, taskIds),
						inArray(availabilityTaskOverrides.blockId, blockIds),
					),
				)
		: [];
	const overrides = new Set(
		overrideRows.map((row) => `${row.blockId}:${row.taskId}:${row.assigneeId}`),
	);
	const blocksByUser = new Map<string, typeof activeBlocks>();
	for (const block of activeBlocks) {
		blocksByUser.set(block.userId, [...(blocksByUser.get(block.userId) ?? []), block]);
	}
	for (const task of radarTasks) {
		const scope = scopeByProject.get(task.projectId);
		if (!scope) continue;
		for (const assignee of assignmentsByTask.get(task.id) ?? []) {
			for (const block of blocksByUser.get(assignee.userId) ?? []) {
				if (block.workspaceId !== scope.workspaceId) continue;
				let overlaps = false;
				if (task.startDate) {
					const end = new Date(task.startDate.getTime() + (task.durationMin ?? 60) * 60_000);
					overlaps = task.startDate < block.endsAt && end > block.startsAt;
				} else {
					const target = taskTargetDate(task);
					if (target) {
						const blockStart = isoDayInZone(block.startsAt, block.timezone);
						const blockEnd = isoDayInZone(new Date(block.endsAt.getTime() - 1), block.timezone);
						overlaps = target >= blockStart && target <= blockEnd;
					}
				}
				if (!overlaps) continue;
				if (
					block.kind === "focus" &&
					overrides.has(`${block.id}:${task.id}:${assignee.userId}`)
				) continue;
				const focus = block.kind === "focus";
				addEvidence(evidenceByTask, task.id, {
					id: `${focus ? "focus_conflict" : "assignee_unavailable"}:${block.id}:${assignee.userId}`,
					code: focus ? "focus_conflict" : "assignee_unavailable",
					label: focus ? "Plán zasahuje do Focus Time" : "Řešitel je v daném čase nedostupný",
					detail: `${assignee.name}: ${formatMoment(block.startsAt, block.timezone)}–${formatMoment(block.endsAt, block.timezone)}.`,
					weight: focus ? 50 : 55,
					basis: "fact",
					source: { type: "availability", id: block.id },
				});
			}
		}
	}

	const scheduledByUser = new Map<
		string,
		Array<{ task: RadarTask; start: Date; end: Date; name: string }>
	>();
	for (const task of radarTasks) {
		if (!task.startDate) continue;
		const end = new Date(task.startDate.getTime() + (task.durationMin ?? 60) * 60_000);
		for (const assignee of assignmentsByTask.get(task.id) ?? []) {
			scheduledByUser.set(assignee.userId, [
				...(scheduledByUser.get(assignee.userId) ?? []),
				{ task, start: task.startDate, end, name: assignee.name },
			]);
		}
	}
	for (const scheduled of scheduledByUser.values()) {
		scheduled.sort((a, b) => a.start.getTime() - b.start.getTime());
		let active: typeof scheduled = [];
		for (const current of scheduled) {
			active = active.filter((candidate) => candidate.end > current.start);
			const collision = active[0];
			if (collision) {
				for (const [item, other] of [
					[current, collision],
					[collision, current],
				] as const) {
					addEvidence(evidenceByTask, item.task.id, {
						id: `schedule_collision:${item.task.id}:${other.task.id}`,
						code: "schedule_collision",
						label: "Čas se překrývá s jinou prací",
						detail: `${item.name} má ve stejném čase také „${other.task.name}“.`,
						weight: 35,
						basis: "fact",
						source: { type: "task", id: other.task.id },
					});
				}
			}
			active.push(current);
		}
	}

	const decisionLookahead = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);
	const decisionRows = await db
		.select({
			id: decisions.id,
			workspaceId: decisions.workspaceId,
			projectId: decisions.projectId,
			title: decisions.title,
			sourceType: decisions.sourceType,
			reviewAt: decisions.reviewAt,
		})
		.from(decisions)
		.where(
			and(
				inArray(decisions.projectId, projectIds),
				eq(decisions.status, "active"),
				sql`${decisions.reviewAt} IS NOT NULL AND ${decisions.reviewAt} <= ${decisionLookahead.toISOString()}::timestamptz`,
			),
		)
		.limit(MAX_DECISION_CANDIDATES + 1);
	const decisionCoverageLimited = decisionRows.length > MAX_DECISION_CANDIDATES;
	const radarDecisions = decisionRows.slice(0, MAX_DECISION_CANDIDATES);
	const decisionIds = radarDecisions.map((decision) => decision.id);
	const decisionLinks = decisionIds.length
		? await db
				.select({
					decisionId: decisionTaskLinks.decisionId,
					taskId: decisionTaskLinks.taskId,
				})
				.from(decisionTaskLinks)
				.where(inArray(decisionTaskLinks.decisionId, decisionIds))
		: [];
	const linksByDecision = new Map<string, string[]>();
	for (const link of decisionLinks) {
		linksByDecision.set(link.decisionId, [
			...(linksByDecision.get(link.decisionId) ?? []),
			link.taskId,
		]);
	}

	const items: RadarItem[] = [];
	for (const task of radarTasks) {
		const evidence = evidenceByTask.get(task.id) ?? [];
		if (evidence.length === 0) continue;
		const scope = scopeByProject.get(task.projectId);
		if (!scope) continue;
		const score = itemScore(evidence);
		items.push({
			id: `task:${task.id}`,
			entityType: "task",
			entityId: task.id,
			workspaceId: scope.workspaceId,
			workspaceName: scope.workspaceName,
			projectId: scope.projectId,
			projectName: scope.projectName,
			title: task.name,
			severity: severityFor(score),
			score,
			confidence: confidenceFor(evidence, score),
			targetDate: taskTargetDate(task),
			evidence: evidence.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
		});
	}
	for (const decision of radarDecisions) {
		if (!decision.reviewAt) continue;
		const scope = scopeByProject.get(decision.projectId);
		if (!scope) continue;
		const reviewDay = isoDayInZone(decision.reviewAt, input.timezone);
		const days = dayDifference(reviewDay, today);
		const overdue = decision.reviewAt < now;
		const evidence: RadarEvidence[] = [
			{
				id: `${overdue ? "decision_review_overdue" : "decision_review_soon"}:${decision.id}`,
				code: overdue ? "decision_review_overdue" : "decision_review_soon",
				label: overdue ? "Rozhodnutí čeká na revizi" : "Blíží se revize rozhodnutí",
				detail: overdue
					? `Naplánovaná revize ${reviewDay} už uplynula.`
					: days === 0
						? `Revize je naplánovaná na dnešek (${reviewDay}).`
						: `Revize je naplánovaná za ${days} dní (${reviewDay}).`,
				weight: overdue ? 55 : days <= 3 ? 35 : 25,
				basis: overdue ? "fact" : "projection",
				source: { type: "decision", id: decision.id },
			},
		];
		const decisionEvidence = evidence[0];
		if (!decisionEvidence) continue;
		for (const taskId of linksByDecision.get(decision.id) ?? []) {
			if (!taskById.has(taskId)) continue;
			addEvidence(evidenceByTask, taskId, {
				...decisionEvidence,
				id: `${decisionEvidence.id}:task:${taskId}`,
				detail: `Navázané rozhodnutí „${decision.title}“ ${overdue ? "čeká na revizi" : "bude brzy revidováno"}.`,
				weight: overdue ? 30 : 20,
			});
		}
		const score = itemScore(evidence);
		items.push({
			id: `decision:${decision.id}`,
			entityType: "decision",
			entityId: decision.id,
			workspaceId: decision.workspaceId,
			workspaceName: scope.workspaceName,
			projectId: decision.projectId,
			projectName: scope.projectName,
			title: decision.title,
			severity: severityFor(score),
			score,
			confidence: confidenceFor(evidence, score),
			targetDate: reviewDay,
			evidence,
		});
	}

	// Rozhodovací evidence se přidává až po prvním sestavení task položek; přepočítat je,
	// aby žádný navázaný signál nezůstal jen v interní mapě.
	for (const item of items) {
		if (item.entityType !== "task") continue;
		const evidence = evidenceByTask.get(item.entityId) ?? item.evidence;
		item.evidence = evidence.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
		item.score = itemScore(item.evidence);
		item.severity = severityFor(item.score);
		item.confidence = confidenceFor(item.evidence, item.score);
	}

	items.sort(
		(a, b) =>
			b.score - a.score ||
			(a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") ||
			a.title.localeCompare(b.title, "cs"),
	);
	const filtered = input.severity
		? items.filter((item) => item.severity === input.severity)
		: items;
	const counts = {
		critical: filtered.filter((item) => item.severity === "critical").length,
		high: filtered.filter((item) => item.severity === "high").length,
		medium: filtered.filter((item) => item.severity === "medium").length,
	};
	return {
		...baseResponse,
		coverage:
			taskCoverageLimited || blockCoverageLimited || decisionCoverageLimited
				? ("partial" as const)
				: ("complete" as const),
		total: filtered.length,
		counts,
		items: filtered.slice(0, input.limit),
	};
}

radarRoutes.get("/api/radar", async (c) => {
	c.header("Cache-Control", "private, no-store");
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const query = querySchema.safeParse(c.req.query());
	if (!query.success || !validTimeZone(query.data?.timezone ?? "")) {
		return c.json({ error: "invalid_radar_query" }, 422);
	}
	try {
		return c.json(
			await buildRadarSnapshot({
				userId: session.user.id,
				workspaceId: query.data.workspaceId,
				timezone: query.data.timezone,
				severity: query.data.severity,
				limit: query.data.limit,
			}),
		);
	} catch (error) {
		const code = error instanceof Error ? error.message : "radar_unavailable";
		if (code === "radar_scope_not_found") return c.json({ error: code }, 404);
		if (code === "radar_forbidden") return c.json({ error: code }, 403);
		return c.json({ error: "radar_unavailable" }, 503);
	}
});
