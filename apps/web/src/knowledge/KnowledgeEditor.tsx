import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { type FormEvent, useRef, useState } from "react";
import { focusOnMount } from "../lib/focusOnMount";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import {
	knowledgeJson,
	type KnowledgeArticleType,
	type KnowledgeAudience,
	type KnowledgeContent,
	type KnowledgeDetail,
	type KnowledgeMember,
	type KnowledgeSection,
} from "./api";

const fieldClass =
	"min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass focus:ring-2 focus:ring-brass/20";
const primaryClass =
	"min-h-11 rounded-lg bg-brass px-4 py-2 font-display text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass =
	"min-h-11 rounded-lg border border-line px-3 py-2 font-display text-sm font-semibold text-ink-2 hover:border-brass hover:text-brass-text disabled:opacity-40";

type EditorDraft = KnowledgeContent & { tagsText: string };

function initialDraft(article: KnowledgeDetail["article"] | null): EditorDraft {
	const value = article?.draft;
	return {
		articleType: value?.articleType ?? "guide",
		title: value?.title ?? "",
		summary: value?.summary ?? "",
		tags: value?.tags ?? [],
		tagsText: value?.tags.join(", ") ?? "",
		sections: value?.sections ?? [
			{ id: crypto.randomUUID(), title: "", body: "" },
		],
		audience: value?.audience ?? "team",
		acknowledgementRequired: value?.acknowledgementRequired ?? false,
		ownerUserId: value?.ownerUserId ?? null,
	};
}

function errorMessage(t: (key: string) => string, code: string | undefined) {
	if (code === "stale_draft") return t("knowledge.errorStale");
	if (code === "knowledge_owner_not_member") return t("knowledge.errorOwner");
	if (code === "operation_id_reused") return t("knowledge.errorRetry");
	if (code === "knowledge_conflict") return t("knowledge.errorConflict");
	return t("knowledge.errorSave");
}

export function KnowledgeEditor({
	workspaceId,
	article,
	members,
	onClose,
	onSaved,
}: {
	workspaceId: string;
	article: KnowledgeDetail["article"] | null;
	members: KnowledgeMember[];
	onClose: () => void;
	onSaved: (articleId: string) => Promise<void>;
}) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<EditorDraft>(() => initialDraft(article));
	const [dirty, setDirty] = useState(false);
	const [discardReady, setDiscardReady] = useState(false);
	const [saving, setSaving] = useState(false);
	const articleIdRef = useRef(article?.id ?? crypto.randomUUID());
	const commandRef = useRef<{ fingerprint: string; operationId: string } | null>(null);
	const requestClose = () => {
		if (!dirty || discardReady) {
			onClose();
			return;
		}
		setDiscardReady(true);
		showToast(t("knowledge.discardWarning"));
	};
	const dialogRef = useOverlayLayer<HTMLDivElement>(true, requestClose);
	const patchDraft = (patch: Partial<EditorDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		setDirty(true);
		setDiscardReady(false);
	};
	const patchSection = (index: number, patch: Partial<KnowledgeSection>) => {
		patchDraft({
			sections: draft.sections.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item,
			),
		});
	};
	const moveSection = (index: number, direction: -1 | 1) => {
		const target = index + direction;
		if (target < 0 || target >= draft.sections.length) return;
		const next = [...draft.sections];
		const source = next[index];
		const destination = next[target];
		if (!source || !destination) return;
		next[index] = destination;
		next[target] = source;
		patchDraft({ sections: next });
	};

	async function save(event: FormEvent) {
		event.preventDefault();
		if (saving) return;
		const normalizedSections = draft.sections.map((item) => ({
			...item,
			title: item.title.trim(),
		}));
		if (
			!draft.title.trim() ||
			normalizedSections.length === 0 ||
			normalizedSections.some((item) => !item.title || !item.body.trim())
		) {
			showToast(t("knowledge.validationRequired"));
			return;
		}
		const normalizedTags = [
			...new Map(
				draft.tagsText
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean)
					.slice(0, 12)
					.map((tag) => [tag.toLocaleLowerCase("cs"), tag.slice(0, 30)]),
			).values(),
		];
		const fields = {
			articleType: draft.articleType,
			title: draft.title.trim(),
			summary: draft.summary?.trim() || null,
			tags: normalizedTags,
			sections: normalizedSections.map((item) => ({ ...item, body: item.body.trim() })),
			audience: draft.audience,
			acknowledgementRequired: draft.acknowledgementRequired,
			ownerUserId: draft.ownerUserId || null,
		};
		const fingerprint = JSON.stringify({ workspaceId, articleId: articleIdRef.current, fields });
		if (!commandRef.current || commandRef.current.fingerprint !== fingerprint) {
			commandRef.current = { fingerprint, operationId: crypto.randomUUID() };
		}
		setSaving(true);
		try {
			if (article) {
				await knowledgeJson(`/api/knowledge/${article.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						operationId: commandRef.current.operationId,
						expectedDraftRevision: article.draftRevision,
						...fields,
					}),
				});
			} else {
				await knowledgeJson("/api/knowledge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id: articleIdRef.current,
						operationId: commandRef.current.operationId,
						workspaceId,
						...fields,
					}),
				});
			}
			setDirty(false);
			showToast(article ? t("knowledge.draftSaved") : t("knowledge.draftCreated"));
			await onSaved(articleIdRef.current);
			onClose();
		} catch (error) {
			showToast(errorMessage(t, (error as Error & { code?: string }).code));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div
			className="fixed inset-0 grid place-items-end bg-black/45 sm:place-items-center sm:p-5"
			style={{ zIndex: "var(--w-layer-modal)" }}
			data-esc-layer
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="knowledge-editor-title"
				className="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-card shadow-2xl sm:max-w-[820px] sm:rounded-2xl"
			>
				<header className="flex min-h-16 items-center gap-3 border-line border-b px-4 sm:px-6">
					<div className="grid size-10 place-items-center rounded-xl bg-brass-soft text-brass-text">
						<Icon name="popis" size={20} />
					</div>
					<div className="min-w-0 flex-1">
						<h2 id="knowledge-editor-title" className="font-display font-extrabold text-base text-ink">
							{article ? t("knowledge.editTitle") : t("knowledge.createTitle")}
						</h2>
						<p className="mt-0.5 font-body text-xs text-ink-3">
							{t("knowledge.editorHint")}
						</p>
					</div>
					{dirty && (
						<span className="rounded-full bg-brass-soft px-2.5 py-1 font-display font-bold text-[11px] text-brass-text">
							{t("knowledge.unsaved")}
						</span>
					)}
					<button
						type="button"
						className="grid size-11 place-items-center rounded-lg text-ink-2 hover:bg-panel-2"
						onClick={requestClose}
						aria-label={t("common.close")}
					>
						<Icon name="zavrit" size={18} />
					</button>
				</header>

				<form onSubmit={save} className="min-h-0 flex-1 overflow-y-auto">
					<div className="space-y-5 px-4 py-5 sm:px-6">
						<div className="grid gap-4 sm:grid-cols-[180px_1fr]">
							<label className="block font-display text-xs font-bold text-ink-2">
								{t("knowledge.articleType")}
								<select
									className={`${fieldClass} mt-1.5`}
									value={draft.articleType}
									onChange={(event) =>
										patchDraft({ articleType: event.target.value as KnowledgeArticleType })
									}
								>
									<option value="guide">{t("knowledge.typeGuide")}</option>
									<option value="sop">{t("knowledge.typeSop")}</option>
									<option value="policy">{t("knowledge.typePolicy")}</option>
								</select>
							</label>
							<label className="block font-display text-xs font-bold text-ink-2">
								{t("knowledge.titleLabel")}
								<input
									className={`${fieldClass} mt-1.5`}
									value={draft.title}
									maxLength={200}
									onChange={(event) => patchDraft({ title: event.target.value })}
									placeholder={t("knowledge.titlePlaceholder")}
									ref={focusOnMount}
								/>
							</label>
						</div>
						<label className="block font-display text-xs font-bold text-ink-2">
							{t("knowledge.summaryLabel")}
							<textarea
								className={`${fieldClass} mt-1.5 min-h-20 resize-y`}
								value={draft.summary ?? ""}
								maxLength={1000}
								onChange={(event) => patchDraft({ summary: event.target.value })}
								placeholder={t("knowledge.summaryPlaceholder")}
							/>
						</label>

						<section aria-labelledby="knowledge-sections-heading">
							<div className="flex items-end justify-between gap-3">
								<div>
									<h3 id="knowledge-sections-heading" className="font-display font-extrabold text-sm text-ink">
										{t("knowledge.sections")}
									</h3>
									<p className="mt-1 font-body text-xs text-ink-3">
										{draft.articleType === "sop"
											? t("knowledge.sectionsSopHint")
											: t("knowledge.sectionsHint")}
									</p>
								</div>
								<button
									type="button"
									className={secondaryClass}
									onClick={() =>
										patchDraft({
											sections: [
												...draft.sections,
												{ id: crypto.randomUUID(), title: "", body: "" },
											],
										})
									}
									disabled={draft.sections.length >= 50}
								>
									<span className="inline-flex items-center gap-2">
										<Icon name="pridat" size={16} /> {t("knowledge.addSection")}
									</span>
								</button>
							</div>
							<div className="mt-3 space-y-3">
								{draft.sections.map((item, index) => (
									<div key={item.id} className="rounded-xl border border-line bg-surface p-3 sm:p-4">
										<div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
											<div className="grid size-8 shrink-0 place-items-center rounded-full bg-brass-soft font-display font-extrabold text-brass-text text-xs">
												{index + 1}
											</div>
											<input
												className={fieldClass}
												value={item.title}
												maxLength={160}
												onChange={(event) => patchSection(index, { title: event.target.value })}
												aria-label={t("knowledge.sectionTitle")}
												placeholder={t("knowledge.sectionTitlePlaceholder")}
											/>
											<div className="col-span-2 flex shrink-0 justify-end gap-1 sm:col-span-1">
												<button
													type="button"
													className="grid size-11 place-items-center rounded-lg border border-line text-ink-2 disabled:opacity-30"
													onClick={() => moveSection(index, -1)}
													disabled={index === 0}
													aria-label={t("knowledge.moveUp")}
												>
													<span aria-hidden="true">↑</span>
												</button>
												<button
													type="button"
													className="grid size-11 place-items-center rounded-lg border border-line text-ink-2 disabled:opacity-30"
													onClick={() => moveSection(index, 1)}
													disabled={index === draft.sections.length - 1}
													aria-label={t("knowledge.moveDown")}
												>
													<span aria-hidden="true">↓</span>
												</button>
												<button
													type="button"
													className="grid size-11 place-items-center rounded-lg border border-line text-danger disabled:opacity-30"
													onClick={() =>
														patchDraft({
															sections: draft.sections.filter((_, itemIndex) => itemIndex !== index),
														})
													}
													disabled={draft.sections.length === 1}
													aria-label={t("knowledge.removeSection")}
												>
													<Icon name="smazat" size={16} />
												</button>
											</div>
										</div>
										<textarea
											className={`${fieldClass} mt-2 min-h-32 resize-y leading-relaxed`}
											value={item.body}
											maxLength={10000}
											onChange={(event) => patchSection(index, { body: event.target.value })}
											aria-label={t("knowledge.sectionBody")}
											placeholder={t("knowledge.sectionBodyPlaceholder")}
										/>
									</div>
								))}
							</div>
						</section>

						<div className="grid gap-4 border-line border-t pt-5 sm:grid-cols-2">
							<label className="block font-display text-xs font-bold text-ink-2">
								{t("knowledge.owner")}
								<select
									className={`${fieldClass} mt-1.5`}
									value={draft.ownerUserId ?? ""}
									onChange={(event) => patchDraft({ ownerUserId: event.target.value || null })}
								>
									<option value="">{t("knowledge.ownerNone")}</option>
									{members.map((member) => (
										<option key={member.id} value={member.id}>
											{member.name}
										</option>
									))}
								</select>
							</label>
							<label className="block font-display text-xs font-bold text-ink-2">
								{t("knowledge.audience")}
								<select
									className={`${fieldClass} mt-1.5`}
									value={draft.audience}
									onChange={(event) =>
										patchDraft({ audience: event.target.value as KnowledgeAudience })
									}
								>
									<option value="team">{t("knowledge.audienceTeam")}</option>
									<option value="all_workspace_members">{t("knowledge.audienceAll")}</option>
								</select>
							</label>
							<label className="block font-display text-xs font-bold text-ink-2 sm:col-span-2">
								{t("knowledge.tags")}
								<input
									className={`${fieldClass} mt-1.5`}
									value={draft.tagsText}
									onChange={(event) => patchDraft({ tagsText: event.target.value })}
									placeholder={t("knowledge.tagsPlaceholder")}
								/>
							</label>
							<label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-line bg-panel-2 p-3 sm:col-span-2">
								<input
									type="checkbox"
									className="mt-1 size-4 accent-brass"
									checked={draft.acknowledgementRequired}
									onChange={(event) =>
										patchDraft({ acknowledgementRequired: event.target.checked })
									}
								/>
								<span>
									<span className="block font-display font-bold text-sm text-ink">
										{t("knowledge.requireAck")}
									</span>
									<span className="mt-1 block font-body text-xs leading-relaxed text-ink-3">
										{t("knowledge.requireAckHint")}
									</span>
								</span>
							</label>
						</div>
					</div>

					<footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-line border-t bg-card px-4 py-3 sm:px-6">
						<button type="button" className={secondaryClass} onClick={requestClose} disabled={saving}>
							{discardReady ? t("knowledge.discardConfirm") : t("common.cancel")}
						</button>
						<button type="submit" className={primaryClass} disabled={saving}>
							{saving ? t("common.saving") : t("knowledge.saveDraft")}
						</button>
					</footer>
				</form>
			</div>
		</div>
	);
}
