/** Přímé SQL/Drizzle negativní testy invariantů, které nesmí jít obejít API klientem. */
import "./src/env";
import {
	eq,
	getDb,
	meetings,
	memberships,
	projectMembers,
	projects,
	statuses,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};
const codeOf = (error: unknown) =>
	(error as { code?: string; cause?: { code?: string } })?.code ??
	(error as { cause?: { code?: string } })?.cause?.code;
async function rejected(label: string, action: () => Promise<unknown>, code = "23514") {
	try {
		await action();
		check(label, false, "operation unexpectedly succeeded");
	} catch (error) {
		check(label, codeOf(error) === code, { code: codeOf(error) });
	}
}

async function main(): Promise<void> {
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [owner] = await db
		.insert(users)
		.values({
			id: crypto.randomUUID(),
			name: "Invariant owner",
			email: `invariant-${stamp}@watson.test`,
			emailVerified: true,
		})
		.returning({ id: users.id });
	if (!owner) throw new Error("owner setup failed");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Invariant ${stamp}`, ownerId: owner.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace setup failed");
	await db
		.insert(memberships)
		.values({ workspaceId: workspace.id, userId: owner.id, role: "admin" });
	const [projectA, projectB] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Invariant A ${stamp}` },
			{ workspaceId: workspace.id, ownerId: owner.id, name: `Invariant B ${stamp}` },
		])
		.returning({ id: projects.id });
	if (!projectA || !projectB) throw new Error("project setup failed");
	await db.insert(projectMembers).values([
		{ projectId: projectA.id, userId: owner.id, role: "manager" },
		{ projectId: projectB.id, userId: owner.id, role: "manager" },
	]);
	const [statusA, statusB] = await db
		.insert(statuses)
		.values([
			{ scope: "project", projectId: projectA.id, name: "A" },
			{ scope: "project", projectId: projectB.id, name: "B" },
		])
		.returning({ id: statuses.id });
	if (!statusA || !statusB) throw new Error("status setup failed");

	try {
		const root = crypto.randomUUID();
		const child = crypto.randomUUID();
		const grandchild = crypto.randomUUID();
		await db.insert(tasks).values([
			{ id: root, projectId: projectA.id, name: "root", statusId: statusA.id },
			{ id: child, projectId: projectA.id, parentId: root, name: "child", statusId: statusA.id },
			{
				id: grandchild,
				projectId: projectA.id,
				parentId: child,
				name: "grandchild",
				statusId: statusA.id,
			},
		]);
		await rejected("DB odmítne čtvrtou úroveň hierarchie", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				parentId: grandchild,
				name: "too deep",
			}),
		);
		await rejected("DB odmítne cyklus přesunu root pod vlastního potomka", () =>
			db.update(tasks).set({ parentId: grandchild }).where(eq(tasks.id, root)),
		);

		const concurrentA = crypto.randomUUID();
		const concurrentB = crypto.randomUUID();
		await db.insert(tasks).values([
			{ id: concurrentA, projectId: projectA.id, name: "concurrent A" },
			{ id: concurrentB, projectId: projectA.id, name: "concurrent B" },
		]);
		const concurrent = await Promise.allSettled([
			db.update(tasks).set({ parentId: concurrentB }).where(eq(tasks.id, concurrentA)),
			db.update(tasks).set({ parentId: concurrentA }).where(eq(tasks.id, concurrentB)),
		]);
		check(
			"souběžný A↔B přesun skončí právě jedním 23514, nikdy cyklem",
			concurrent.filter((result) => result.status === "fulfilled").length === 1 &&
				concurrent.filter(
					(result) => result.status === "rejected" && codeOf(result.reason) === "23514",
				).length === 1,
			concurrent.map((result) =>
				result.status === "fulfilled" ? "ok" : codeOf(result.reason),
			),
		);

		await rejected("DB odmítne status cizího projektu", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "cross status",
				statusId: statusB.id,
			}),
		);
		await rejected("DB nedovolí přesun používaného statusu do cizího projektu", () =>
			db.update(statuses).set({ projectId: projectB.id }).where(eq(statuses.id, statusA.id)),
		);
		await rejected("scope statusu musí mít právě jednoho vlastníka", () =>
			db.insert(statuses).values({
				scope: "project",
				projectId: projectA.id,
				workspaceId: workspace.id,
				name: "invalid owner",
			}),
		);
		await rejected("days=0 je v DB neplatné", () =>
			db.insert(tasks).values({ projectId: projectA.id, name: "bad days", days: 0 }),
		);
		await rejected("deadline před plánovaným due je v DB neplatný", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "bad dates",
				dueDate: new Date("2026-08-10T00:00:00Z"),
				deadline: new Date("2026-08-09T00:00:00Z"),
			}),
		);
		await rejected("start_date bez start_timezone je v DB neplatný", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "missing start timezone",
				startDate: new Date("2026-07-15T07:30:00.000Z"),
			}),
		);
		await rejected("start_timezone bez start_date je v DB neplatný", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "missing start instant",
				startTimezone: "Europe/Prague",
			}),
		);
		await rejected("DB odmítne syntakticky neplatnou časovou zónu", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "invalid start timezone",
				startDate: new Date("2026-07-15T07:30:00.000Z"),
				startTimezone: "Prague",
			}),
		);
		await db.insert(tasks).values({
			projectId: projectA.id,
			name: "valid zoned start",
			startDate: new Date("2026-07-15T07:30:00.000Z"),
			startTimezone: "Europe/Prague",
		});
		check(
			"DB přijme start_date se spárovanou IANA zónou",
			(
				await db
					.select({ id: tasks.id })
					.from(tasks)
					.where(eq(tasks.name, "valid zoned start"))
			).length === 1,
		);

		const meetingId = crypto.randomUUID();
		const hubId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			await tx.insert(tasks).values({
				id: hubId,
				projectId: projectA.id,
				name: "Invariant meeting",
				kind: "meeting",
				meetingId,
				createdBy: owner.id,
			});
			await tx.insert(meetings).values({
				id: meetingId,
				workspaceId: workspace.id,
				title: "Invariant meeting",
				status: "scheduled",
				hubTaskId: hubId,
				createdBy: owner.id,
			});
		});
		await rejected("meeting lifecycle nesmí regresovat", () =>
			db.update(meetings).set({ status: "new" }).where(eq(meetings.id, meetingId)),
		);
		await rejected("meeting sidecar nelze smazat bez hub tasku", () =>
			db.delete(meetings).where(eq(meetings.id, meetingId)),
		);

		const actionId = crypto.randomUUID();
		const followUpId = crypto.randomUUID();
		await db.insert(tasks).values({
			id: actionId,
			projectId: projectA.id,
			name: "Surviving action",
			meetingId,
			createdBy: owner.id,
		});
		await db.insert(meetings).values({
			id: followUpId,
			workspaceId: workspace.id,
			title: "Preserved follow-up",
			seriesId: meetingId,
			prevMeetingId: meetingId,
			createdBy: owner.id,
		});
		await db.delete(tasks).where(eq(tasks.id, hubId));
		check(
			"delete hubu kaskáduje sidecar a atomicky odpojí zachovaný action task",
			(await db.select().from(meetings).where(eq(meetings.id, meetingId))).length === 0 &&
				(await db.select().from(tasks).where(eq(tasks.id, actionId)))[0]?.meetingId === null,
		);
		check(
			"delete meetingu odpojí zachovanou navazující poradu přes FK SET NULL",
			(await db.select().from(meetings).where(eq(meetings.id, followUpId)))[0]?.prevMeetingId ===
				null,
		);

		await rejected("meeting hub bez meeting_id nevznikne", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "orphan hub",
				kind: "meeting",
			}),
		);
		await rejected("task nemůže odkazovat na neexistující meeting", () =>
			db.insert(tasks).values({
				projectId: projectA.id,
				name: "orphan action",
				meetingId: crypto.randomUUID(),
			}),
		);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, owner.id));
	}

	if (failed) throw new Error(`${failed} DB invariant checks failed`);
	console.log("\nDB invariant checks passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
