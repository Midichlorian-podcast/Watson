/**
 * Tvrdé invarianty Watsona (R1–R9) zhmotněné jako sdílené konstanty.
 * Tyto hodnoty MUSÍ platit přesně — viz CLAUDE.md a MASTER §12.
 * Sdílené FE↔BE, aby se logika nikdy nerozcházela.
 */

/** R1 — úkoly max 3 úrovně zanoření (úkol → podúkol → pod-podúkol). */
export const MAX_TASK_DEPTH = 3;

/** R6 — priorita je nebarevný odznak P1–P4 (nezávislá na barvě). */
export const PRIORITIES = [1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Sémantika priorit (P1 nejvyšší, P4 = default/nejnižší). */
export const PRIORITY_LABELS: Record<Priority, string> = {
  1: "priority.acute", // Akutní
  2: "priority.soon", // Co nejdřív
  3: "priority.notAcute", // Neakutní
  4: "priority.future", // Budoucnost
};

/**
 * R2 — režimy přiřazení.
 * - single:      jeden řešitel; dokončí on → hotovo.
 * - shared_any:  kdokoli z přiřazených → hotovo pro všechny.
 * - shared_all:  každý zvlášť; Task.completed_at je ODVOZENÉ až všichni hotovi.
 */
export const ASSIGNMENT_MODES = ["single", "shared_any", "shared_all"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

/**
 * R2 — výchozí režim pro NEINTERAKTIVNÍ cesty (automatizace / AI / hromadně).
 * Interaktivně se na režim VŽDY ptáme; tohle je default jen tam, kde není koho se ptát.
 */
export const DEFAULT_NONINTERACTIVE_ASSIGNMENT_MODE: AssignmentMode = "shared_all";

/** R4 — scope úprav opakovaného úkolu. */
export const RECURRENCE_EDIT_SCOPES = ["this_occurrence", "this_and_future", "all"] as const;
export type RecurrenceEditScope = (typeof RECURRENCE_EDIT_SCOPES)[number];

/** R4 — základ opakování: výchozí od termínu; "od dokončení" je per úkol (every!). */
export const RECURRENCE_BASIS = ["due_date", "completion"] as const;
export type RecurrenceBasis = (typeof RECURRENCE_BASIS)[number];
export const DEFAULT_RECURRENCE_BASIS: RecurrenceBasis = "due_date";

/** R5 — workspace role (bohatší PŘEDNASTAVENÉ role, BEZ plně vlastních rolí). */
export const WORKSPACE_ROLES = ["admin", "manager", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** R5 — projektové role. */
export const PROJECT_ROLES = ["manager", "editor", "commenter"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** R5 — viditelnost projektu (restricted = neviditelný nečlenům). */
export const PROJECT_VISIBILITY = ["team", "restricted"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number];

/** Podporované jazyky (CZ default, EN plně) — i18n od začátku. */
export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";

/** MVP = jedno časové pásmo (Europe/Prague), explicitně. */
export const DEFAULT_TIMEZONE = "Europe/Prague";

/** Výchozí pohledy projektu (List/Board/Calendar). */
export const PROJECT_LAYOUTS = ["list", "board", "calendar"] as const;
export type ProjectLayout = (typeof PROJECT_LAYOUTS)[number];

/** Typ projektu (Cloud Design): Průběžný / Cílový / Periodický. */
export const PROJECT_KINDS = ["flow", "goal", "cycle"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** Stav projektu (Cloud Design): Aktivní / Pozastavený / Archiv / Hotovo. */
export const PROJECT_STATUSES = ["active", "paused", "archive", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Rozsah statusu — jednoduché per projekt (default), volitelně per workspace. */
export const STATUS_SCOPES = ["project", "workspace"] as const;
export type StatusScope = (typeof STATUS_SCOPES)[number];

/** Typy připomínek (E1). */
export const REMINDER_TYPES = ["time", "relative", "recurring", "location"] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

/** Notifikační kanály (MVP: push + e-mail; in_app pro inbox). */
export const NOTIFICATION_CHANNELS = ["push", "email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Úrovně AI chování (AI_chovani_spec.md).
 * - off:          AI činnost nedělá vůbec.
 * - suggest:      vytvoří AISuggestion (pending) → čeká na schválení.
 * - auto_notify:  provede + zapíše audit + upozorní + vždy undo.
 * Pozn.: "auto (tiše)" se NEpoužívá (0 položek).
 */
export const AI_LEVELS = ["off", "suggest", "auto_notify"] as const;
export type AiLevel = (typeof AI_LEVELS)[number];

/** Stav AI návrhu. */
export const AI_SUGGESTION_STATUS = ["pending", "accepted", "dismissed"] as const;
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUS)[number];

/** Aktér auditní události (člověk vs AI). */
export const ACTOR_TYPES = ["user", "ai"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Vlastník uloženého filtru / palety. */
export const OWNER_SCOPES = ["user", "workspace"] as const;
export type OwnerScope = (typeof OWNER_SCOPES)[number];

/** Poskytovatelé kalendáře (MVP: Google; Apple CalDAV až v2). */
export const CALENDAR_PROVIDERS = ["google", "apple"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
