import { useMemo, useState } from "react";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import type {
	CreateExecutionTaskInput,
	PersonalMailExecution,
	PersonalMailProject,
	PersonalMessageSummary,
} from "./usePersonalMail";

const errorLabels: Record<string, string> = {
	mail_execution_personal_project_required: "Vyber aktivní projekt ze stejného osobního prostoru.",
	mail_message_already_linked: "Z této zprávy už úkol vznikl. Stav jsme právě obnovili.",
	mail_execution_task_deleted: "Původní úkol je smazaný. Použij výslovnou náhradu.",
	mail_execution_task_id_reused: "ID úkolu už existuje. Zkus vytvoření znovu.",
	operation_id_reused: "Tento příkaz už byl použit s jinými údaji. Zkus vytvoření znovu.",
	mail_execution_busy: "Předchozí vytvoření ještě probíhá.",
};

export function PersonalMailTaskDialog({
	message,
	existing,
	projects,
	creating,
	onClose,
	onCreate,
	onOpenTask,
}: {
	message: PersonalMessageSummary;
	existing: PersonalMailExecution | null;
	projects: PersonalMailProject[];
	creating: boolean;
	onClose: () => void;
	onCreate: (
		message: PersonalMessageSummary,
		input: CreateExecutionTaskInput,
	) => Promise<PersonalMailExecution>;
	onOpenTask: (taskId: string) => void;
}) {
	const activeReplacement = Boolean(existing && !existing.taskExists);
	const [name, setName] = useState((message.subject || "Úkol z e-mailu").slice(0, 500));
	const [description, setDescription] = useState(message.snippet.slice(0, 2_000));
	const [priority, setPriority] = useState(3);
	const [dueDate, setDueDate] = useState("");
	const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
	const [error, setError] = useState<string | null>(null);
	const dialogRef = useOverlayLayer<HTMLDivElement>(true, onClose);
	const selectedProject = useMemo(
		() => projects.find((project) => project.id === projectId),
		[projectId, projects],
	);

	const submit = async () => {
		if (creating || !name.trim() || !selectedProject) return;
		setError(null);
		try {
			const execution = await onCreate(message, {
				operationId: crypto.randomUUID(),
				taskId: crypto.randomUUID(),
				projectId: selectedProject.id,
				name: name.trim(),
				description: description.trim() || null,
				priority,
				dueDate: dueDate || null,
				replaceDeleted: activeReplacement,
			});
			onClose();
			showToast(activeReplacement ? "Náhradní úkol je bezpečně navázaný na zprávu." : "Úkol je bezpečně navázaný na zprávu.", {
				label: "Otevřít úkol",
				onClick: () => onOpenTask(execution.taskId),
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_execution_unavailable");
		}
	};

	return (
		<div data-esc-layer style={{ position: "fixed", inset: 0, zIndex: "var(--w-layer-nested)" }}>
			<button
				type="button"
				aria-label="Zavřít vytvoření úkolu"
				onClick={onClose}
				style={{ position: "absolute", inset: 0, border: 0, background: "rgba(23,40,63,.36)" }}
			/>
			<div
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="personal-mail-task-title"
				data-screen-label="Mail → úkol"
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%, -50%)",
					zIndex: "calc(var(--w-layer-nested) + 1)",
					width: "min(520px, 94vw)",
					maxHeight: "88vh",
					overflow: "auto",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "var(--shadow)",
					padding: 18,
				}}
			>
				<div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						<h2 id="personal-mail-task-title" style={{ margin: 0, fontSize: 17, color: "var(--ink)" }}>
							{activeReplacement ? "Nahradit smazaný úkol" : "Udělat z mailu úkol"}
						</h2>
						<p style={{ margin: "5px 0 0", fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
							Do úkolu se zkopírují jen pole, která tady vidíš a potvrdíš. Celé tělo ani přílohy se nepřenášejí automaticky.
						</p>
					</div>
					<button type="button" aria-label="Zavřít" onClick={onClose} style={{ width: 44, height: 44, border: 0, background: "transparent", color: "var(--ink-3)", fontSize: 20, cursor: "pointer" }}>×</button>
				</div>

				{activeReplacement && (
					<div role="status" style={{ marginTop: 12, borderRadius: 10, padding: "9px 11px", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11, lineHeight: 1.45 }}>
						Původní úkol už neexistuje. Jeho provenance zůstane v auditu a tento nový úkol se stane aktivní vazbou.
					</div>
				)}

				<label style={{ display: "grid", gap: 5, marginTop: 14, fontSize: 10, fontWeight: 700, color: "var(--ink-3)" }}>
					NÁZEV
					<input value={name} maxLength={500} onChange={(event) => setName(event.target.value)} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel-2)", color: "var(--ink)", padding: "0 11px", font: "inherit" }} />
				</label>
				<label style={{ display: "grid", gap: 5, marginTop: 12, fontSize: 10, fontWeight: 700, color: "var(--ink-3)" }}>
					POPIS · upravitelný náhled
					<textarea value={description} maxLength={20_000} rows={4} onChange={(event) => setDescription(event.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel-2)", color: "var(--ink)", padding: "9px 11px", font: "inherit", lineHeight: 1.5, resize: "vertical" }} />
				</label>

				<div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, marginTop: 12 }}>
					<label style={{ display: "grid", gap: 5, fontSize: 10, fontWeight: 700, color: "var(--ink-3)" }}>
						PROJEKT
						<select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={projects.length === 0} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel-2)", color: "var(--ink)", padding: "0 9px" }}>
							{projects.length === 0 && <option value="">Chybí osobní projekt</option>}
							{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
						</select>
					</label>
					<label style={{ display: "grid", gap: 5, fontSize: 10, fontWeight: 700, color: "var(--ink-3)" }}>
						TERMÍN · volitelný
						<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel-2)", color: "var(--ink)", padding: "0 9px" }} />
					</label>
				</div>

				<fieldset style={{ margin: "12px 0 0", padding: 0, border: 0 }}>
					<legend style={{ marginBottom: 6, fontSize: 10, fontWeight: 700, color: "var(--ink-3)" }}>PRIORITA</legend>
					<div style={{ display: "flex", gap: 6 }}>
						{[1, 2, 3, 4].map((value) => (
							<button key={value} type="button" aria-pressed={priority === value} onClick={() => setPriority(value)} style={{ minWidth: 44, minHeight: 44, border: `1px solid ${priority === value ? "var(--brass)" : "var(--line)"}`, borderRadius: 9, background: priority === value ? "var(--brass-soft)" : "transparent", color: priority === value ? "var(--brass-text)" : "var(--ink-2)", fontWeight: 750, cursor: "pointer" }}>P{value}</button>
						))}
					</div>
				</fieldset>

				{projects.length === 0 && <div role="alert" style={{ marginTop: 12, color: "var(--danger-ink)", fontSize: 11 }}>Nejdřív vytvoř aktivní projekt v osobním prostoru.</div>}
				{error && <div role="alert" style={{ marginTop: 12, borderRadius: 9, padding: "9px 10px", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11 }}>{errorLabels[error] ?? "Úkol se nepodařilo bezpečně vytvořit. Zkus to znovu."}</div>}
				<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
					<button type="button" onClick={onClose} disabled={creating} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 14px", cursor: "pointer" }}>Zrušit</button>
					<button type="button" onClick={() => void submit()} disabled={creating || !name.trim() || !selectedProject} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 15px", fontWeight: 750, cursor: "pointer" }}>
						{creating ? "Vytvářím…" : activeReplacement ? "Vytvořit náhradní úkol" : "Vytvořit úkol"}
					</button>
				</div>
			</div>
		</div>
	);
}
