/**
 * Týmy, projekty, struktura. Invarianty R5 (oprávnění), R6 (barvy), R8 (osobní prostor).
 * Pozn.: každá tabulka má jediný UUID PK `id` (požadavek PowerSync), přirozené klíče
 * jsou vynucené přes unique indexy.
 */
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import {
	projectKindEnum,
	projectLayoutEnum,
	projectRoleEnum,
	projectStatusEnum,
	projectVisibilityEnum,
	statusScopeEnum,
	workspaceRoleEnum,
} from "./enums";

export const workspaces = pgTable(
	"workspaces",
	{
		id: pk(),
		name: varchar("name", { length: 200 }).notNull(),
		/** Volný typ kontextu (kavárna/studio/podcast…) — generické, tvoří uživatel. */
		contextType: varchar("context_type", { length: 64 }),
		/** Brand-nezávislá barva workspace (R6). */
		color: varchar("color", { length: 9 }),
		/** R8 — osobní prostor každého uživatele (soukromý workspace). */
		isPersonal: boolean("is_personal").notNull().default(false),
		/** Konflikty úkolů: warning informuje, strict zakáže neplatnou mutaci. */
		taskConflictPolicy: varchar("task_conflict_policy", { length: 16 })
			.notNull()
			.default("warning"),
		ownerId: uuid("owner_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check(
			"workspaces_task_conflict_policy_valid",
			sql`${t.taskConflictPolicy} in ('warning', 'strict')`,
		),
	],
);

export const memberships = pgTable(
	"memberships",
	{
		id: pk(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		/** R5 — přednastavené role (BEZ plně vlastních rolí). */
		role: workspaceRoleEnum("role").notNull().default("member"),
		/** Oblasti odpovědnosti v TOMTO prostoru (comma-separated) — pro AI směrování
		 *  a lidský přehled „kdo co řeší". Nastavuje admin/manager. */
		areas: text("areas"),
		/** Krátký popis role člověka v prostoru (co dělá) — doplněk k users.jobTitle. */
		bio: text("bio"),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("memberships_user_workspace_uq").on(t.userId, t.workspaceId),
	],
);

/**
 * Invite-only onboarding. Bearer token drží Better Auth verification tabulka;
 * zde je jen auditovatelná autorizace konkrétního e-mailu, role a expirace.
 */
export const workspaceInvitations = pgTable(
	"workspace_invitations",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		email: varchar("email", { length: 254 }).notNull(),
		role: workspaceRoleEnum("role").notNull().default("member"),
		invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("workspace_invitations_email_idx").on(t.email),
		index("workspace_invitations_workspace_idx").on(t.workspaceId),
		uniqueIndex("workspace_invitations_active_uq")
			.on(t.workspaceId, t.email)
			.where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
	],
);

export const projects = pgTable("projects", {
	id: pk(),
	workspaceId: uuid("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	name: varchar("name", { length: 200 }).notNull(),
	/** R6 — uživatelská barva projektu (oddělená od priority a brand palety). */
	color: varchar("color", { length: 9 }),
	icon: varchar("icon", { length: 64 }),
	defaultLayout: projectLayoutEnum("default_layout").notNull().default("list"),
	/** Typ projektu (Cloud Design): flow=Průběžný / goal=Cílový / cycle=Periodický. */
	kind: projectKindEnum("kind").notNull().default("flow"),
	/** Vlastník projektu (Cloud Design „VLASTNÍK"). */
	ownerId: uuid("owner_id").references(() => users.id, {
		onDelete: "set null",
	}),
	/** Stav projektu (Cloud Design): active/paused/archive/done. */
	status: projectStatusEnum("status").notNull().default("active"),
	/** Termín dodání (jen goal/cycle). */
	deliveryDate: timestamp("delivery_date", { withTimezone: true }),
	/** Definice hotového (jen goal/cycle). */
	definitionOfDone: text("definition_of_done"),
	/** Volitelné podmíněné projektové milníky; jejich stav se odvozuje z úkolů. */
	milestonesEnabled: boolean("milestones_enabled").notNull().default(false),
	/** Volitelná druhostranná akceptace pouze pro urgentní úkoly. */
	urgentAcceptanceEnabled: boolean("urgent_acceptance_enabled").notNull().default(false),
	/** Nejnižší zahrnutá urgence: 1 = pouze P1, 2 = P1 a P2. */
	urgentAcceptancePriority: integer("urgent_acceptance_priority").notNull().default(1),
	/** R5 — restricted projekt je neviditelný nečlenům. */
	visibility: projectVisibilityEnum("visibility").notNull().default("team"),
	/** null = nearchivováno (legacy; nově řídí `status`). */
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
}, (t) => [
	index("projects_workspace_idx").on(t.workspaceId),
	check(
		"projects_urgent_acceptance_priority_valid",
		sql`${t.urgentAcceptancePriority} between 1 and 2`,
	),
]);

export const projectMembers = pgTable(
	"project_members",
	{
		id: pk(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: projectRoleEnum("role").notNull().default("editor"),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("project_members_project_user_uq").on(t.projectId, t.userId),
		// /api/projects dotazuje podle user_id (uq má project_id první → seq scan bez tohoto).
		index("project_members_user_idx").on(t.userId),
	],
);

export const sections = pgTable(
	"sections",
	{
		id: pk(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 200 }).notNull(),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [
		// CC-P0-15: cíl composite FK z tasks (section musí patřit do stejného projektu)
		uniqueIndex("sections_id_project_uq").on(t.id, t.projectId),
	],
);

/**
 * Statusy — jednoduché per projekt (default), volitelně per workspace.
 * R9 — `isDone=true` status je provázaný se zaškrtnutím úkolu (řeší app/sync vrstva).
 */
export const statuses = pgTable(
	"statuses",
	{
		id: pk(),
		scope: statusScopeEnum("scope").notNull().default("project"),
		projectId: uuid("project_id").references(() => projects.id, {
			onDelete: "cascade",
		}),
		workspaceId: uuid("workspace_id").references(() => workspaces.id, {
			onDelete: "cascade",
		}),
		name: varchar("name", { length: 100 }).notNull(),
		color: varchar("color", { length: 9 }),
		position: integer("position").notNull().default(0),
		isDone: boolean("is_done").notNull().default(false),
		createdAt: createdAt(),
	},
	(t) => [
		check(
			"statuses_scope_owner_valid",
			sql`(${t.scope} = 'project' and ${t.projectId} is not null and ${t.workspaceId} is null)
				or (${t.scope} = 'workspace' and ${t.workspaceId} is not null and ${t.projectId} is null)`,
		),
	],
);

export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Status = typeof statuses.$inferSelect;
