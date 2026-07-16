import { column, Schema, Table } from "@powersync/web";

// P0-06: PATCH/DELETE musí nést snapshot řádku, který uživatel skutečně editoval.
// Server jej porovná v téže transakci se současnou DB a stale zápis odmítne 409.
const trackAllPrevious = { trackPrevious: true } as const;
const tracked = <T extends Record<string, unknown>>(options: T) => ({
	...options,
	trackPrevious: true as const,
});

/**
 * Klientské zrcadlo (podmnožina) app tabulek.
 * PowerSync přidává textové `id` PK automaticky — neuvádí se.
 * SQLite nemá boolean → bool sloupce jako integer (0/1), časy jako text (ISO) / null.
 */
const tasks = new Table(
	{
		project_id: column.text,
		section_id: column.text,
		parent_id: column.text,
		name: column.text,
		description: column.text,
    why_now: column.text,
		priority: column.integer,
		color: column.text,
		due_date: column.text,
		start_date: column.text,
		start_timezone: column.text,
		deadline: column.text,
		duration_min: column.integer,
		days: column.integer,
		sort_order: column.integer,
		recurrence: column.text,
		recurrence_rule: column.text,
		recurrence_basis: column.text,
		assignment_mode: column.text,
		status_id: column.text,
		/** Propojení Mail ↔ úkol — chip „Z mailu" (handoff 2026-07-10). */
		mail_th: column.text,
		mail_label: column.text,
		/** Meets — 'task' (běžný) | 'meeting' (kotva porady); seznamy porady odfiltrují. */
		kind: column.text,
		/** Meets — backpointer hub/akčního úkolu na meetings.id (soft). */
		meeting_id: column.text,
		completed_at: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	{
		// Hot sloupce dotazované napříč obrazovkami (Dnes/Nadcházející/Sidebar/rowMeta/detail).
		// Bez nich = full scan tasks při KAŽDÉ změně (i cizí došlé syncem) → jank s tisíci úkolů.
		indexes: {
			by_project: ["project_id"],
			by_parent: ["parent_id"],
			by_due: ["due_date"],
			by_completed: ["completed_at"],
			by_status: ["status_id"],
			by_meeting: ["meeting_id"],
		},
		trackPrevious: true,
	},
);

const task_dependencies = new Table(
	{
		project_id: column.text,
		blocking_task_id: column.text,
		blocked_task_id: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_blocking: ["blocking_task_id"], by_blocked: ["blocked_task_id"] } }),
);

/** Projektové definice vlastních polí; zápis jde přes validující API commandy. */
const project_custom_fields = new Table(
	{
		project_id: column.text,
		name: column.text,
		field_type: column.text,
		options: column.text,
		position: column.integer,
		created_by: column.text,
		created_at: column.text,
		updated_at: column.text,
	},
	{ indexes: { by_project: ["project_id"] } },
);

/** Typovaná hodnota úkolu; JSON scalar validuje server i DB trigger. */
const task_custom_field_values = new Table(
	{
		field_id: column.text,
		task_id: column.text,
		project_id: column.text,
		value: column.text,
		updated_by: column.text,
		created_at: column.text,
		updated_at: column.text,
	},
	{
		indexes: {
			by_task: ["task_id"],
			by_project: ["project_id"],
		},
		trackPrevious: true,
	},
);

/** Vložitelné task ankety; definice a stav se mění přes auditovaný API command. */
const task_polls = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		question: column.text,
		response_type: column.text,
		options: column.text,
		closed_at: column.text,
		created_by: column.text,
		created_at: column.text,
		updated_at: column.text,
	},
	{ indexes: { by_task: ["task_id"], by_project: ["project_id"] } },
);

/** Jedna typovaná odpověď člena na anketu; server drží identitu i validaci. */
const task_poll_responses = new Table(
	{
		poll_id: column.text,
		task_id: column.text,
		project_id: column.text,
		respondent_id: column.text,
		value: column.text,
		created_at: column.text,
		updated_at: column.text,
	},
	{
		indexes: {
			by_poll: ["poll_id"],
			by_task: ["task_id"],
			by_respondent: ["respondent_id"],
		},
	},
);

/** Projekt (barva = tělo karet úkolů, R6); kind=flow|goal|cycle, status 4-stavový. */
const projects = new Table(
	{
		workspace_id: column.text,
		name: column.text,
		color: column.text,
		icon: column.text,
		default_layout: column.text,
		visibility: column.text,
		kind: column.text,
		owner_id: column.text,
		status: column.text,
		delivery_date: column.text,
		definition_of_done: column.text,
		archived_at: column.text,
		created_at: column.text,
	},
	trackAllPrevious,
);

const workspaces = new Table(
	{
		name: column.text,
		is_personal: column.integer,
		task_conflict_policy: column.text,
	},
	trackAllPrevious,
);

const sections = new Table(
	{
		project_id: column.text,
		name: column.text,
		position: column.integer,
		created_at: column.text,
	},
	tracked({ indexes: { by_project: ["project_id"] } }),
);

/** Stavy úkolů per projekt; is_done (0/1) provázané se zaškrtnutím úkolu (R9). */
const statuses = new Table(
	{
		scope: column.text,
		project_id: column.text,
		workspace_id: column.text,
		name: column.text,
		color: column.text,
		position: column.integer,
		is_done: column.integer,
		created_at: column.text,
	},
	tracked({ indexes: { by_project: ["project_id"] } }),
);

const project_members = new Table(
	{
		project_id: column.text,
		user_id: column.text,
		role: column.text,
		created_at: column.text,
	},
	{ indexes: { by_project: ["project_id"], by_user: ["user_id"] } },
);

/** Detail úkolu (task-children, denormalizovaný project_id pro scoping). */
const assignments = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		completed_at: column.text,
		created_at: column.text,
	},
	{
		indexes: {
			by_task: ["task_id"],
			by_project: ["project_id"],
			by_user: ["user_id"], // Sidebar „Přiřazeno mně" / rowMeta agregace
		},
		trackPrevious: true,
	},
);

const comments = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		parent_id: column.text,
		author_id: column.text,
		body: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_task: ["task_id"] } }),
);

/**
 * Přílohy — do offline cache patří jen bezpečná metadata. Binární obsah se čte
 * autorizovanou API route a klient do této tabulky nikdy nezapisuje přímo.
 */
const attachments = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		comment_id: column.text,
		url: column.text,
		file_name: column.text,
		sha256: column.text,
		version: column.integer,
		mime: column.text,
		size_bytes: column.integer,
		uploaded_by: column.text,
		created_at: column.text,
	},
	{
		indexes: {
			by_task: ["task_id"],
			by_project: ["project_id"],
			by_comment: ["comment_id"],
		},
	},
);

const mentions = new Table(
	{
		comment_id: column.text,
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	tracked({
		indexes: {
			by_comment: ["comment_id"],
			by_task: ["task_id"],
			by_user: ["user_id"],
		},
	}),
);

const comment_reactions = new Table(
	{
		comment_id: column.text,
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		emoji: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_comment: ["comment_id"], by_task: ["task_id"] } }),
);

const comment_decisions = new Table(
	{
		comment_id: column.text,
		task_id: column.text,
		project_id: column.text,
		marked_by: column.text,
		created_at: column.text,
	},
	tracked({
		indexes: {
			by_comment: ["comment_id"],
			by_task: ["task_id"],
			by_project: ["project_id"],
		},
	}),
);

/** R4 — per-výskyt výjimky opakování (done/skip jednoho výskytu). */
const task_occurrence_overrides = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		occ_date: column.text,
		done: column.integer,
		skipped: column.integer,
		created_at: column.text,
	},
	tracked({ indexes: { by_task: ["task_id"], by_project: ["project_id"] } }),
);

/** R6 — per-uživatelská barva úkolu (syncuje se jen vlastní barva). */
const task_user_colors = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		color: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_task: ["task_id"] } }),
);

const reminders = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		type: column.text,
		remind_at: column.text,
		offset_min: column.integer,
		channel: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_task: ["task_id"] } }),
);

/**
 * Historie úprav úkolu (audit log). `insertOnly` = řádky se jen NAHRÁVAJÍ do Postgresu (write-path),
 * ale NEuchovávají se lokálně ani nesyncují dolů — audit log jinak roste do stovek MB na každém
 * zařízení (hlavní strop škálovatelnosti). Detail historie se čte on-demand přes API.
 */
const task_activity = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		field: column.text,
		old_value: column.text,
		new_value: column.text,
		created_at: column.text,
	},
	{ insertOnly: true },
);

/** Postupy (štafeta) — chains + chain_steps (project-scoped). */
const chains = new Table(
	{
		project_id: column.text,
		workspace_id: column.text,
		template_id: column.text,
		name: column.text,
		description: column.text,
		anchor_date: column.text,
		state: column.text,
		sched_mode: column.text,
		skip_weekend: column.integer,
		created_by: column.text,
		completed_at: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_project: ["project_id"] } }),
);

const chain_steps = new Table(
	{
		chain_id: column.text,
		task_id: column.text,
		project_id: column.text,
		position: column.integer,
		gate: column.text,
		step_state: column.text,
		anchor_offset: column.integer,
		gap_days: column.integer,
		activated_at: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_chain: ["chain_id"], by_project: ["project_id"] } }),
);

/** Cíle (workspace-scoped). */
const goals = new Table(
	{
		workspace_id: column.text,
		name: column.text,
		scope: column.text,
		metric: column.text,
		target: column.integer,
		due_date: column.text,
		/** Období — volný text „Q3 2026" (prototyp ř. 1457). */
		period: column.text,
		periodic: column.text,
		/** Začátek běžícího období — reset přes „Obnovit období" (prototyp resetGoalPeriod ř. 2346). */
		period_start: column.text,
		/** Filtry hledáčku cíle (fPerson/fKeyword, prototyp goalTasks ř. 2360). */
		filter_person_id: column.text,
		filter_keyword: column.text,
		owner_id: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_workspace: ["workspace_id"] } }),
);
const goal_projects = new Table(
	{ goal_id: column.text, project_id: column.text, workspace_id: column.text },
	tracked({ indexes: { by_goal: ["goal_id"] } }),
);
const goal_milestones = new Table(
	{
		goal_id: column.text,
		workspace_id: column.text,
		label: column.text,
		done: column.integer,
		position: column.integer,
		created_at: column.text,
	},
	tracked({ indexes: { by_goal: ["goal_id"] } }),
);

// Seznamy — checklisty na akce (handoff 2026-07-10; šablona → instance).
const lists = new Table(
	{
		workspace_id: column.text,
		project_id: column.text,
		template_id: column.text,
		name: column.text,
		/** „datum a místo akce" — volný text. */
		event: column.text,
		archived: column.integer,
		created_by: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_workspace: ["workspace_id"] } }),
);
const list_sections = new Table(
	{
		list_id: column.text,
		workspace_id: column.text,
		name: column.text,
		position: column.integer,
		created_at: column.text,
	},
	tracked({ indexes: { by_list: ["list_id"] } }),
);
const list_items = new Table(
	{
		list_id: column.text,
		section_id: column.text,
		workspace_id: column.text,
		text: column.text,
		qty: column.text,
		who_id: column.text,
		done: column.integer,
		position: column.integer,
		created_at: column.text,
	},
	tracked({ indexes: { by_list: ["list_id"], by_section: ["section_id"] } }),
);
const list_templates = new Table(
	{
		workspace_id: column.text,
		name: column.text,
		description: column.text,
		/** JSON text: [{ name, items: ["text|qty", …] }] (formát prototypu). */
		sections: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_workspace: ["workspace_id"] } }),
);

const contacts = new Table(
	{
		workspace_id: column.text,
		name: column.text,
		email: column.text,
		org: column.text,
		role: column.text,
		areas: column.text,
		note: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	tracked({ indexes: { by_workspace: ["workspace_id"] } }),
);

/** Polymorfní vazby (mail↔úkol, LuckyOS↔úkol) — dedup + proklik. Workspace-scoped. */
const entity_links = new Table(
	{
		workspace_id: column.text,
		from_type: column.text,
		from_id: column.text,
		to_type: column.text,
		to_id: column.text,
		relation: column.text,
		source_system: column.text,
		external_id: column.text,
		created_at: column.text,
	},
	{ indexes: { by_from: ["from_type", "from_id"], by_to: ["to_type", "to_id"] } },
);

/**
 * Meets — porada (sidecar kotevního úkolu), JEN METADATA. Přepis + AI extraction se plošně
 * nesyncují (CC-P0-13: obsah smí jen účastník/pozvaný) — čtou se on-demand přes API; offline
 * kopii dostane až participant-scoped bucket. Termín/příprava/účastníci žijí na hub-úkolu.
 */
const meetings = new Table(
	{
		workspace_id: column.text,
		title: column.text,
		status: column.text,
		hub_task_id: column.text,
		series_id: column.text,
		prev_meeting_id: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	{
		indexes: { by_workspace: ["workspace_id"], by_hub: ["hub_task_id"], by_series: ["series_id"] },
		trackPrevious: true,
	},
);

/**
 * CC-P0-04 — trvale odmítnuté sync operace (Centrum problémů se synchronizací).
 * LOCAL-ONLY: nesyncuje se, žije v per-user DB → přežije reload i re-login
 * stejného účtu a jiný účet ji nevidí. Zapisuje connector PŘED dokončením
 * upload transakce; UI v Nastavení umí zobrazit / exportovat / zahodit.
 */
const local_rejected_ops = new Table(
	{
		created_at: column.text,
		last_attempt_at: column.text,
		attempt_count: column.integer,
		client_id: column.text,
		operation_id: column.text,
		table_name: column.text,
		/** PUT | PATCH | DELETE */
		op: column.text,
		/** id dotčeného řádku */
		row_id: column.text,
		/** JSON zamýšlené změny — data uživatele, zůstávají jen na zařízení */
		payload: column.text,
		http_code: column.integer,
		/** bezpečný kód ze serveru (forbidden / write_failed / SQLSTATE…) */
		server_code: column.text,
		/** korelace se serverovým logem (X-Request-Id) */
		request_id: column.text,
		/** open | retrying | resolved | discarded */
		status: column.text,
	},
	{ localOnly: true },
);

/**
 * Citlivý stav, který má zůstat jen na zařízení (rozepsané demo e-maily,
 * vlastní podpisy apod.). Tabulka žije uvnitř šifrované per-user SQLite DB;
 * nikdy se neuploaduje do PowerSync služby.
 */
const local_private_state = new Table(
	{
		value: column.text,
		updated_at: column.text,
	},
	{ localOnly: true },
);

/** Strukturované osobní a týmové pohledy úkolů; zápis probíhá CAS API commandem. */
const filters = new Table(
	{
		owner_scope: column.text,
		user_id: column.text,
		workspace_id: column.text,
		name: column.text,
		query: column.text,
		surface: column.text,
		config: column.text,
		version: column.integer,
		created_at: column.text,
		updated_at: column.text,
	},
	{ trackPrevious: true },
);

export const AppSchema = new Schema({
	tasks,
	task_dependencies,
	project_custom_fields,
	task_custom_field_values,
	task_polls,
	task_poll_responses,
	workspaces,
	projects,
	sections,
	statuses,
	project_members,
	assignments,
	comments,
	attachments,
	comment_decisions,
	mentions,
	comment_reactions,
	task_occurrence_overrides,
	task_user_colors,
	local_rejected_ops,
	local_private_state,
	reminders,
	task_activity,
	chains,
	chain_steps,
	goals,
	goal_projects,
	goal_milestones,
	lists,
	list_sections,
	list_items,
	list_templates,
	contacts,
	entity_links,
	meetings,
	filters,
});

export type Database = (typeof AppSchema)["types"];
export type TaskRow = Database["tasks"];
export type TaskDependencyRow = Database["task_dependencies"];
export type ProjectCustomFieldRow = Database["project_custom_fields"];
export type TaskCustomFieldValueRow = Database["task_custom_field_values"];
export type TaskPollRow = Database["task_polls"];
export type TaskPollResponseRow = Database["task_poll_responses"];
export type WorkspaceRow = Database["workspaces"];
export type ProjectRow = Database["projects"];
export type SectionRow = Database["sections"];
export type StatusRow = Database["statuses"];
export type ProjectMemberRow = Database["project_members"];
export type AssignmentRow = Database["assignments"];
export type CommentRow = Database["comments"];
export type AttachmentRow = Database["attachments"];
export type MentionRow = Database["mentions"];
export type CommentReactionRow = Database["comment_reactions"];
export type ReminderRow = Database["reminders"];
export type TaskUserColorRow = Database["task_user_colors"];
export type TaskActivityRow = Database["task_activity"];
export type ChainRow = Database["chains"];
export type ChainStepRow = Database["chain_steps"];
export type GoalRow = Database["goals"];
export type GoalProjectRow = Database["goal_projects"];
export type GoalMilestoneRow = Database["goal_milestones"];
export type ListRow = Database["lists"];
export type ListSectionRow = Database["list_sections"];
export type ListItemRow = Database["list_items"];
export type ContactRow = Database["contacts"];
export type ListTemplateRow = Database["list_templates"];
export type EntityLinkRow = Database["entity_links"];
export type RejectedOpRow = Database["local_rejected_ops"];
export type LocalPrivateStateRow = Database["local_private_state"];
export type FilterRow = Database["filters"];
