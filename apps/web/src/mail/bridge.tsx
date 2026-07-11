/**
 * Most aplikace ↔ mail modul (kontrakt handoffu on-nav / task-states /
 * on-create-task): vazby mail ↔ úkol žijí na REÁLNÝCH úkolech (tasks.mail_th
 * + mail_label z migrace 0017) — mail z nich odvozuje chipy NAVÁZANÉ ÚKOLY
 * se živým stavem a „Email → úkol" zakládá skutečný úkol (default osobní
 * inbox dle R8; osobní vlákna NIKDY týmový projekt — audit L-19).
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { type ReactNode, useMemo } from "react";
import { useSession } from "../lib/auth-client";
import { inboxProjectIds, pickInboxId } from "../lib/inbox";
import { powerSync } from "../lib/powersync/db";
import { useProjects } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { showToast } from "../lib/toast";
import { useWorkspaces } from "../lib/workspace";
import { type MailBridge, MailProvider } from "./state";
// mail styly jsou scopované na [data-wm-theme] — musí být načtené app-wide,
// protože mail UI žije i mimo /mail (peek na Přehledu/Velíně, notifikace)
import "./mail.css";

/** on-nav cíle prototypu → routy aplikace (WatsonApp mailNav, ř. 4033). */
const NAV_MAP: Record<string, string> = {
	dnes: "/",
	ukoly: "/ukoly",
	nadchazejici: "/nadchazejici",
	projekty: "/projekty",
	cile: "/cile",
	reporty: "/reporty",
	postupy: "/postupy",
	prehled: "/prehled",
};

export function MailBridgeProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const { open } = useTaskDetail();
	const { data: session } = useSession();
	const { t } = useTranslation();
	const projects = useProjects();
	const { data: workspaces } = useWorkspaces();
	const { data: linked } = usePsQuery<{
		id: string;
		name: string | null;
		priority: number | null;
		completed_at: string | null;
		mail_th: string | null;
	}>(
		"SELECT id, name, priority, completed_at, mail_th FROM tasks WHERE mail_th IS NOT NULL",
	);

	const bridge = useMemo<MailBridge>(() => {
		const taskLinks: NonNullable<MailBridge["taskLinks"]> = {};
		const taskStates: NonNullable<MailBridge["taskStates"]> = {};
		for (const row of linked ?? []) {
			if (!row.mail_th) continue;
			taskLinks[row.mail_th] = [
				...(taskLinks[row.mail_th] ?? []),
				{
					n: row.name ?? "",
					owner: "",
					prio: `p${row.priority ?? 3}`,
					app: row.id,
				},
			];
			taskStates[row.id] = { done: !!row.completed_at };
		}
		const personalWs = new Set(
			(workspaces ?? []).filter((w) => w.isPersonal).map((w) => w.id),
		);
		return {
			taskLinks,
			taskStates,
			projects: projects.map((p) => ({
				id: p.id,
				name: p.name ?? "",
				color: p.color,
				personal: !!p.workspace_id && personalWs.has(p.workspace_id),
			})),
			onNav: (target: string) => {
				if (target.startsWith("task:")) {
					open(target.slice(5));
					return;
				}
				void navigate({ to: NAV_MAP[target] ?? "/" });
			},
			onCreateTask: async (p) => {
				// R8: bez projektu → osobní inbox (triage v Schránce); L-19: osobní
				// vlákno nesmí nabídnout týmový projekt — inbox VÝHRADNĚ z osobního
				// prostoru, jinak by úkol s předmětem soukromého mailu viděl celý tým.
				const personalProjects = projects.filter(
					(pr) => !!pr.workspace_id && personalWs.has(pr.workspace_id),
				);
				const inboxId =
					pickInboxId(personalProjects) ??
					[...inboxProjectIds(personalProjects)][0] ??
					null;
				const projectId = p.projectId ?? inboxId;
				if (!projectId) {
					showToast(t("mail.taskNoInbox"));
					return;
				}
				const now = new Date();
				const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
				await powerSync.execute(
					`INSERT INTO tasks (id, project_id, name, description, priority, due_date, mail_th, mail_label, assignment_mode, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'single', ?, ?)`,
					[
						p.id,
						projectId,
						p.name,
						p.description ?? null,
						p.priority ?? 3,
						p.dueISO ?? iso,
						p.mailTh,
						p.mailLabel,
						session?.user?.id ?? null,
						now.toISOString(),
					],
				);
				showToast(t("mail.taskCreatedToast"), {
					label: t("mail.taskCreatedOpen"),
					onClick: () => open(p.id),
				});
			},
		};
	}, [linked, navigate, open, projects, workspaces, session, t]);

	return <MailProvider bridge={bridge}>{children}</MailProvider>;
}
