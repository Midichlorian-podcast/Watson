import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
	knowledgeJson,
	type KnowledgeArticleType,
	type KnowledgeContent,
	type KnowledgeSummary,
	useKnowledgeDetail,
	useKnowledgeList,
	useKnowledgeMembers,
} from "../knowledge/api";
import { KnowledgeEditor } from "../knowledge/KnowledgeEditor";
import { showToast } from "../lib/toast";
import { useWorkspace } from "../lib/workspace";

const buttonPrimary =
	"min-h-11 rounded-lg bg-brass px-4 py-2 font-display text-sm font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50";
const buttonSecondary =
	"min-h-11 rounded-lg border border-line px-3 py-2 font-display text-sm font-semibold text-ink-2 hover:border-brass hover:text-brass-text disabled:opacity-40";

function humanDate(value: string | null | undefined) {
	if (!value) return "—";
	return new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(value));
}

function typeLabel(t: (key: string) => string, type: KnowledgeArticleType | null | undefined) {
	if (type === "sop") return t("knowledge.typeSop");
	if (type === "policy") return t("knowledge.typePolicy");
	return t("knowledge.typeGuide");
}

function stateLabel(t: (key: string) => string, article: KnowledgeSummary) {
	if (article.state === "archived") return t("knowledge.stateArchived");
	if (article.state === "draft") return t("knowledge.stateDraft");
	if (article.hasUnpublishedChanges) return t("knowledge.stateDraftChanges");
	return t("knowledge.statePublished");
}

function errorLabel(t: (key: string) => string, code: string | undefined) {
	if (code === "stale_draft" || code === "stale_published_version") {
		return t("knowledge.errorStale");
	}
	if (code === "no_unpublished_changes") return t("knowledge.errorNoChanges");
	if (code === "knowledge_ack_not_allowed") return t("knowledge.errorAck");
	return t("knowledge.errorAction");
}

function SummaryCard({
	label,
	value,
	description,
}: {
	label: string;
	value: number;
	description: string;
}) {
	return (
		<div className="rounded-xl border border-line bg-card px-4 py-3">
			<div className="font-display font-extrabold text-2xl text-ink">{value}</div>
			<div className="font-display font-bold text-xs text-ink-2">{label}</div>
			<div className="mt-1 font-body text-[11px] leading-relaxed text-ink-3">{description}</div>
		</div>
	);
}

function ArticleListItem({
	article,
	active,
	onOpen,
}: {
	article: KnowledgeSummary;
	active: boolean;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-current={active ? "page" : undefined}
			className="w-full rounded-xl border p-3 text-left transition-colors"
			style={{
				borderColor: active ? "var(--w-brass)" : "var(--w-line)",
				background: active ? "var(--w-brass-soft)" : "var(--w-card)",
			}}
		>
			<div className="flex items-start gap-3">
				<div
					className="grid size-9 shrink-0 place-items-center rounded-lg"
					style={{ background: active ? "var(--w-card)" : "var(--w-panel-2)", color: "var(--w-brass-text)" }}
				>
					<Icon name={article.articleType === "sop" ? "postup" : "popis"} size={18} />
				</div>
				<div className="min-w-0 flex-1">
					<div className="line-clamp-2 font-display font-extrabold text-sm leading-snug text-ink">
						{article.title}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						<span className="rounded-full bg-panel-2 px-2 py-0.5 font-display font-bold text-[10px] text-ink-2">
							{typeLabel(t, article.articleType)}
						</span>
						<span
							className={`rounded-full px-2 py-0.5 font-display font-bold text-[10px] ${
								article.state === "published" && !article.hasUnpublishedChanges
									? "bg-success-soft text-[var(--w-success-ink)]"
									: "bg-brass-soft text-brass-text"
							}`}
						>
							{stateLabel(t, article)}
						</span>
						{article.acknowledgementRequired && !article.acknowledgedByMe && article.state === "published" && (
							<span className="rounded-full bg-overdue-soft px-2 py-0.5 font-display font-bold text-[10px] text-overdue">
								{t("knowledge.ackNeeded")}
							</span>
						)}
					</div>
					{article.summary && (
						<p className="mt-2 line-clamp-2 font-body text-xs leading-relaxed text-ink-3">
							{article.summary}
						</p>
					)}
				</div>
			</div>
		</button>
	);
}

function ArticleContent({ content }: { content: KnowledgeContent }) {
	return (
		<div className="space-y-5">
			{content.sections.map((section, index) => (
				<section
					key={section.id}
					className="rounded-xl border border-line bg-card p-4 sm:p-5"
				>
					<div className="flex items-start gap-3">
						{content.articleType === "sop" && (
							<div className="grid size-8 shrink-0 place-items-center rounded-full bg-brass-soft font-display font-extrabold text-brass-text text-xs">
								{index + 1}
							</div>
						)}
						<div className="min-w-0 flex-1">
							<h3 className="font-display font-extrabold text-base text-ink">{section.title}</h3>
							<div className="mt-2 whitespace-pre-wrap font-body text-sm leading-7 text-ink-2">
								{section.body}
							</div>
						</div>
					</div>
				</section>
			))}
		</div>
	);
}

export function Znalosti() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const search = useSearch({ from: "/znalosti" });
	const { activeWs, setActiveWs } = useWorkspace();
	const [mode, setMode] = useState<"published" | "manage">("published");
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query.trim());
	const [type, setType] = useState<KnowledgeArticleType | "all">("all");
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorTarget, setEditorTarget] = useState<"new" | "current">("new");
	const [publishPanel, setPublishPanel] = useState(false);
	const [changeNote, setChangeNote] = useState("");
	const [archiveReady, setArchiveReady] = useState(false);
	const [actionBusy, setActionBusy] = useState(false);
	const publishCommand = useRef<{ fingerprint: string; operationId: string } | null>(null);
	const archiveCommand = useRef<{ fingerprint: string; operationId: string } | null>(null);
	const ackCommand = useRef<{ fingerprint: string; operationId: string } | null>(null);

	useEffect(() => {
		if (search.prostor && search.prostor !== activeWs) setActiveWs(search.prostor);
	}, [search.prostor, activeWs, setActiveWs]);

	const list = useKnowledgeList({ workspaceId: activeWs, mode, query: deferredQuery, type });
	const canManage = list.data?.canManage ?? false;
	useEffect(() => {
		if (!list.isLoading && !canManage && mode === "manage") setMode("published");
	}, [canManage, list.isLoading, mode]);
	const selectedId = search.clanek ?? null;
	const detail = useKnowledgeDetail(activeWs, selectedId);
	const members = useKnowledgeMembers(activeWs, canManage && editorOpen);
	const articles = list.data?.articles ?? [];
	const stats = useMemo(
		() => ({
			published: articles.filter((article) => article.state === "published").length,
			ack: articles.filter(
				(article) =>
					article.state === "published" &&
					article.acknowledgementRequired &&
					!article.acknowledgedByMe,
			).length,
			drafts: articles.filter(
				(article) => article.state === "draft" || article.hasUnpublishedChanges,
			).length,
		}),
		[articles],
	);

	function openArticle(id: string) {
		void navigate({
			to: "/znalosti",
			search: { clanek: id, prostor: activeWs ?? undefined },
		});
		setPublishPanel(false);
		setArchiveReady(false);
	}

	async function refresh(articleId?: string) {
		await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
		if (articleId) openArticle(articleId);
	}

	async function editorSaved(articleId: string) {
		setMode("manage");
		await refresh(articleId);
	}

	async function publish() {
		const article = detail.data?.article;
		if (!article?.draftRevision || actionBusy) return;
		const fingerprint = JSON.stringify({ articleId: article.id, revision: article.draftRevision, changeNote: changeNote.trim() });
		if (!publishCommand.current || publishCommand.current.fingerprint !== fingerprint) {
			publishCommand.current = { fingerprint, operationId: crypto.randomUUID() };
		}
		setActionBusy(true);
		try {
			await knowledgeJson(`/api/knowledge/${article.id}/publish`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					operationId: publishCommand.current.operationId,
					expectedDraftRevision: article.draftRevision,
					changeNote: changeNote.trim() || null,
				}),
			});
			publishCommand.current = null;
			setPublishPanel(false);
			setChangeNote("");
			showToast(t("knowledge.publishedToast"));
			await refresh(article.id);
		} catch (error) {
			showToast(errorLabel(t, (error as Error & { code?: string }).code));
			await refresh(article.id);
		} finally {
			setActionBusy(false);
		}
	}

	async function archive() {
		const article = detail.data?.article;
		if (!article || article.publishedVersion < 1 || actionBusy) return;
		if (!archiveReady) {
			setArchiveReady(true);
			showToast(t("knowledge.archiveWarning"));
			return;
		}
		const fingerprint = `${article.id}:${article.publishedVersion}`;
		if (!archiveCommand.current || archiveCommand.current.fingerprint !== fingerprint) {
			archiveCommand.current = { fingerprint, operationId: crypto.randomUUID() };
		}
		setActionBusy(true);
		try {
			await knowledgeJson(`/api/knowledge/${article.id}/archive`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					operationId: archiveCommand.current.operationId,
					expectedPublishedVersion: article.publishedVersion,
				}),
			});
			archiveCommand.current = null;
			setArchiveReady(false);
			showToast(t("knowledge.archivedToast"));
			await refresh(article.id);
		} catch (error) {
			showToast(errorLabel(t, (error as Error & { code?: string }).code));
			await refresh(article.id);
		} finally {
			setActionBusy(false);
		}
	}

	async function acknowledge() {
		const article = detail.data?.article;
		const version = article?.published?.version;
		if (!article || !version || actionBusy) return;
		const fingerprint = `${article.id}:${version}`;
		if (!ackCommand.current || ackCommand.current.fingerprint !== fingerprint) {
			ackCommand.current = { fingerprint, operationId: crypto.randomUUID() };
		}
		setActionBusy(true);
		try {
			await knowledgeJson(`/api/knowledge/${article.id}/acknowledge`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ operationId: ackCommand.current.operationId, articleVersion: version }),
			});
			ackCommand.current = null;
			showToast(t("knowledge.ackToast"));
			await refresh(article.id);
		} catch (error) {
			showToast(errorLabel(t, (error as Error & { code?: string }).code));
			await refresh(article.id);
		} finally {
			setActionBusy(false);
		}
	}

	async function copyLink() {
		if (!selectedId) return;
		const url = new URL("/znalosti", window.location.origin);
		url.searchParams.set("clanek", selectedId);
		if (activeWs) url.searchParams.set("prostor", activeWs);
		try {
			await navigator.clipboard.writeText(url.toString());
			showToast(t("deepLink.copied"));
		} catch {
			showToast(t("deepLink.copyFailed"));
		}
	}

	const article = detail.data?.article;
	const activeContent =
		mode === "manage" && article?.draft ? article.draft : article?.published ?? null;
	const hasUnpublishedChanges = Boolean(
		article?.draft &&
			(!article.published || article.draftRevision !== article.published.draftRevision),
	);

	return (
		<main className="mx-auto w-full max-w-[1440px] px-3 py-4 pb-28 sm:px-5 sm:py-6 lg:px-7">
			<header className="rounded-2xl border border-line bg-card p-4 sm:p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex min-w-0 items-start gap-3">
						<div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brass-soft text-brass-text">
							<Icon name="popis" size={22} />
						</div>
						<div>
							<h1 className="font-display font-extrabold text-xl text-ink sm:text-2xl">
								{t("knowledge.title")}
							</h1>
							<p className="mt-1 max-w-2xl font-body text-sm leading-relaxed text-ink-3">
								{t("knowledge.subtitle")}
							</p>
						</div>
					</div>
					{canManage && (
						<button type="button" className={buttonPrimary} onClick={() => { setEditorTarget("new"); setEditorOpen(true); }}>
							<span className="inline-flex items-center gap-2">
								<Icon name="pridat" size={16} /> {t("knowledge.newArticle")}
							</span>
						</button>
					)}
				</div>
				<div className="mt-5 grid gap-2 sm:grid-cols-3">
					<SummaryCard label={t("knowledge.statAvailable")} value={stats.published} description={t("knowledge.statAvailableHint")} />
					<SummaryCard label={t("knowledge.statAck")} value={stats.ack} description={t("knowledge.statAckHint")} />
					<SummaryCard label={t("knowledge.statDrafts")} value={canManage ? stats.drafts : 0} description={canManage ? t("knowledge.statDraftsHint") : t("knowledge.statManagedHint")} />
				</div>
			</header>

			<div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-2.5">
				<label className="relative min-w-[220px] flex-1">
					<span className="sr-only">{t("knowledge.search")}</span>
					<Icon name="hledat" size={17} className="absolute top-3.5 left-3 text-ink-3" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("knowledge.searchPlaceholder")}
						className="min-h-11 w-full rounded-lg border border-line bg-panel-2 pr-3 pl-10 font-body text-sm text-ink outline-none focus:border-brass"
					/>
				</label>
				<select
					value={type}
					onChange={(event) => setType(event.target.value as KnowledgeArticleType | "all")}
					className="min-h-11 rounded-lg border border-line bg-panel-2 px-3 font-display font-semibold text-ink-2 text-sm outline-none focus:border-brass"
					aria-label={t("knowledge.filterType")}
				>
					<option value="all">{t("knowledge.typeAll")}</option>
					<option value="guide">{t("knowledge.typeGuide")}</option>
					<option value="sop">{t("knowledge.typeSop")}</option>
					<option value="policy">{t("knowledge.typePolicy")}</option>
				</select>
				{canManage && (
					<div className="flex min-h-11 rounded-lg border border-line bg-panel-2 p-1" role="group" aria-label={t("knowledge.mode") }>
						{(["published", "manage"] as const).map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => setMode(value)}
								aria-pressed={mode === value}
								className="min-h-9 rounded-md px-3 font-display font-bold text-xs"
								style={{
									background: mode === value ? "var(--w-card)" : "transparent",
									color: mode === value ? "var(--w-brass-text)" : "var(--w-ink-3)",
								}}
							>
								{value === "published" ? t("knowledge.modePublished") : t("knowledge.modeManage")}
							</button>
						))}
					</div>
				)}
			</div>

			<div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
				<aside className="min-w-0 rounded-2xl border border-line bg-card p-3" aria-label={t("knowledge.articleList") }>
					<div className="mb-3 flex items-center justify-between px-1">
						<h2 className="font-display font-extrabold text-sm text-ink">
							{mode === "manage" ? t("knowledge.allContent") : t("knowledge.forTeam")}
						</h2>
						<span className="font-mono text-[11px] text-ink-3">{articles.length}</span>
					</div>
					{list.isLoading ? (
						<div className="space-y-2" role="status" aria-label={t("common.loading") }>
							{[0, 1, 2].map((value) => (
								<div key={value} className="h-24 animate-pulse rounded-xl bg-panel-2" />
							))}
						</div>
					) : list.isError ? (
						<div role="alert" className="rounded-xl bg-overdue-soft p-4 text-center">
							<p className="font-body text-sm text-overdue">{t("knowledge.loadFailed")}</p>
							<button type="button" className={`${buttonSecondary} mt-3`} onClick={() => void list.refetch()}>
								{t("common.retry")}
							</button>
						</div>
					) : articles.length === 0 ? (
						<div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
							<div className="mx-auto grid size-11 place-items-center rounded-full bg-panel-2 text-ink-3">
								<Icon name="hledat" size={19} />
							</div>
							<p className="mt-3 font-display font-bold text-sm text-ink">{t("knowledge.empty")}</p>
							<p className="mt-1 font-body text-xs leading-relaxed text-ink-3">
								{query || type !== "all" ? t("knowledge.emptyFilterHint") : t("knowledge.emptyHint")}
							</p>
						</div>
					) : (
						<div className="space-y-2">
							{articles.map((item) => (
								<ArticleListItem key={item.id} article={item} active={selectedId === item.id} onOpen={() => openArticle(item.id)} />
							))}
						</div>
					)}
				</aside>

				<section className="min-w-0 rounded-2xl border border-line bg-surface p-3 sm:p-5" aria-live="polite">
					{!selectedId ? (
						<div className="grid min-h-[420px] place-items-center px-4 py-10 text-center">
							<div className="max-w-md">
								<div className="mx-auto grid size-16 place-items-center rounded-2xl bg-brass-soft text-brass-text">
									<Icon name="popis" size={28} />
								</div>
								<h2 className="mt-4 font-display font-extrabold text-lg text-ink">{t("knowledge.selectTitle")}</h2>
								<p className="mt-2 font-body text-sm leading-relaxed text-ink-3">{t("knowledge.selectHint")}</p>
							</div>
						</div>
					) : detail.isLoading ? (
						<div className="space-y-3" role="status" aria-label={t("common.loading") }>
							<div className="h-28 animate-pulse rounded-xl bg-panel-2" />
							<div className="h-40 animate-pulse rounded-xl bg-panel-2" />
						</div>
					) : detail.isError || !article || !activeContent ? (
						<div role="alert" className="grid min-h-[360px] place-items-center text-center">
							<div>
								<p className="font-display font-bold text-ink">{t("knowledge.detailUnavailable")}</p>
								<p className="mt-1 font-body text-xs text-ink-3">{t("knowledge.detailUnavailableHint")}</p>
								<button type="button" className={`${buttonSecondary} mt-3`} onClick={() => void detail.refetch()}>
									{t("common.retry")}
								</button>
							</div>
						</div>
					) : (
						<div>
							<div className="rounded-xl border border-line bg-card p-4 sm:p-5">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="rounded-full bg-panel-2 px-2.5 py-1 font-display font-bold text-[10px] text-ink-2">
												{typeLabel(t, activeContent.articleType)}
											</span>
											{mode === "manage" ? (
												<span className="rounded-full bg-brass-soft px-2.5 py-1 font-display font-bold text-[10px] text-brass-text">
													{t("knowledge.draftRevision", { revision: article.draftRevision ?? 0 })}
												</span>
											) : (
												<span className="rounded-full bg-success-soft px-2.5 py-1 font-display font-bold text-[10px] text-[var(--w-success-ink)]">
													{t("knowledge.version", { version: article.publishedVersion })}
												</span>
											)}
											{article.state === "archived" && (
												<span className="rounded-full bg-panel-2 px-2.5 py-1 font-display font-bold text-[10px] text-ink-3">
													{t("knowledge.stateArchived")}
												</span>
											)}
										</div>
										<h2 className="mt-3 font-display font-extrabold text-xl leading-tight text-ink sm:text-2xl">
											{activeContent.title}
										</h2>
										{activeContent.summary && (
											<p className="mt-2 max-w-3xl font-body text-sm leading-relaxed text-ink-2">
												{activeContent.summary}
											</p>
										)}
									</div>
									<div className="flex flex-wrap gap-2">
										<button type="button" className={buttonSecondary} onClick={() => void copyLink()}>
											<span className="inline-flex items-center gap-2"><Icon name="odkaz" size={15} />{t("deepLink.copy")}</span>
										</button>
										{canManage && mode === "manage" && (
											<button type="button" className={buttonSecondary} onClick={() => { setEditorTarget("current"); setEditorOpen(true); }}>
												<span className="inline-flex items-center gap-2"><Icon name="upravit" size={15} />{t("common.edit")}</span>
											</button>
										)}
									</div>
								</div>

								<div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-line border-t pt-3 font-body text-xs text-ink-3">
									<span>{t("knowledge.owner")}: <strong className="text-ink-2">{article.owner?.name ?? t("knowledge.ownerNone")}</strong></span>
									<span>{mode === "manage" ? t("knowledge.updated") : t("knowledge.publishedAt")}: <strong className="text-ink-2">{humanDate(mode === "manage" ? article.updatedAt : article.publishedAt)}</strong></span>
									<span>{activeContent.audience === "team" ? t("knowledge.audienceTeam") : t("knowledge.audienceAll")}</span>
								</div>
								{activeContent.tags.length > 0 && (
									<div className="mt-3 flex flex-wrap gap-1.5">
										{activeContent.tags.map((tag) => <span key={tag} className="rounded-full border border-line px-2 py-1 font-body text-[11px] text-ink-3">#{tag}</span>)}
									</div>
								)}
							</div>

							{mode === "manage" && (
								<div className="mt-3 rounded-xl border border-line bg-card p-3">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<div className="font-display font-bold text-sm text-ink">
												{hasUnpublishedChanges ? t("knowledge.readyToPublish") : t("knowledge.noDraftChanges")}
											</div>
											<div className="mt-1 font-body text-xs text-ink-3">
												{article.state === "archived" && !hasUnpublishedChanges ? t("knowledge.archivedEditHint") : t("knowledge.publishHint")}
											</div>
										</div>
										<div className="flex flex-wrap gap-2">
											{article.state === "published" && (
												<button type="button" className={buttonSecondary} onClick={() => void archive()} disabled={actionBusy}>
													{archiveReady ? t("knowledge.archiveConfirm") : t("knowledge.archive")}
												</button>
											)}
											<button type="button" className={buttonPrimary} onClick={() => setPublishPanel((value) => !value)} disabled={!hasUnpublishedChanges || actionBusy}>
												{t("knowledge.publish")}
											</button>
										</div>
									</div>
									{publishPanel && (
										<div className="mt-3 rounded-lg bg-panel-2 p-3">
											<label className="block font-display text-xs font-bold text-ink-2">
												{t("knowledge.changeNote")}
												<input value={changeNote} onChange={(event) => { setChangeNote(event.target.value); publishCommand.current = null; }} maxLength={500} placeholder={t("knowledge.changeNotePlaceholder")} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-card px-3 font-body text-sm text-ink outline-none focus:border-brass" />
											</label>
											<div className="mt-3 flex justify-end gap-2">
												<button type="button" className={buttonSecondary} onClick={() => setPublishPanel(false)}>{t("common.cancel")}</button>
												<button type="button" className={buttonPrimary} onClick={() => void publish()} disabled={actionBusy}>{actionBusy ? t("common.saving") : t("knowledge.publishNow")}</button>
											</div>
										</div>
									)}
								</div>
							)}

							{mode === "published" && article.acknowledgement?.required && (
								<div className={`mt-3 rounded-xl border p-4 ${article.acknowledgement.acknowledgedByMe ? "border-success/30 bg-success-soft" : "border-brass bg-brass-soft"}`}>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<div className="font-display font-extrabold text-sm text-ink">{article.acknowledgement.acknowledgedByMe ? t("knowledge.ackDone") : t("knowledge.ackTitle")}</div>
											<p className="mt-1 font-body text-xs leading-relaxed text-ink-2">{article.acknowledgement.acknowledgedByMe ? t("knowledge.ackDoneHint") : t("knowledge.ackHint")}</p>
										</div>
										{!article.acknowledgement.acknowledgedByMe && <button type="button" className={buttonPrimary} onClick={() => void acknowledge()} disabled={actionBusy}>{t("knowledge.ackButton")}</button>}
									</div>
								</div>
							)}

							{mode === "manage" && article.acknowledgement?.required && (
								<div className="mt-3 rounded-xl border border-line bg-card p-4">
									<div className="font-display font-bold text-sm text-ink">{t("knowledge.ackProgress")}</div>
									<div className="mt-2 flex items-end gap-2">
										<span className="font-display font-extrabold text-2xl text-ink">{article.acknowledgement.acknowledgedCount ?? 0}</span>
										<span className="pb-1 font-body text-xs text-ink-3">/ {article.acknowledgement.eligibleCount ?? 0} {t("knowledge.people")}</span>
									</div>
									<p className="mt-1 font-body text-xs text-ink-3">{t("knowledge.ackPrivacyHint")}</p>
								</div>
							)}

							<div className="mt-4"><ArticleContent content={activeContent} /></div>

							{mode === "manage" && (article.versions?.length ?? 0) > 0 && (
								<details className="mt-4 rounded-xl border border-line bg-card p-4">
									<summary className="min-h-11 cursor-pointer py-2 font-display font-bold text-sm text-ink">{t("knowledge.versionHistory", { count: article.versions?.length ?? 0 })}</summary>
									<div className="mt-2 space-y-2 border-line border-t pt-3">
										{article.versions?.map((version) => (
											<div key={version.version} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-panel-2 p-3">
												<div>
													<div className="font-display font-bold text-sm text-ink">{t("knowledge.version", { version: version.version })} · {version.title}</div>
													<div className="mt-1 font-body text-xs text-ink-3">{humanDate(version.publishedAt)} · {version.publishedByName}{version.changeNote ? ` · ${version.changeNote}` : ""}</div>
												</div>
												{version.acknowledgementRequired && <span className="rounded-full bg-card px-2 py-1 font-display font-bold text-[10px] text-ink-2">{version.acknowledgedCount} {t("knowledge.confirmed")}</span>}
											</div>
										))}
									</div>
								</details>
							)}
						</div>
					)}
				</section>
			</div>

			{editorOpen && activeWs && (
				<KnowledgeEditor
					workspaceId={activeWs}
					article={editorTarget === "current" && selectedId && detail.data?.canManage ? detail.data.article : null}
					members={members.data ?? []}
					onClose={() => setEditorOpen(false)}
					onSaved={editorSaved}
				/>
			)}
		</main>
	);
}
