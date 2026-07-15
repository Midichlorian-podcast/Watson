import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { useState } from "react";
import type { RejectedOpRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { retryRejectedOperation } from "../lib/powersync/syncRecovery";
import { showToast } from "../lib/toast";

/**
 * CC-P0-04 — Centrum problémů se synchronizací (první verze). Ukazuje trvale
 * odmítnuté zápisy z local_rejected_ops: co, kdy, proč (kód + request ID pro
 * dohledání v serverovém logu) a payload. Umí retry se stejným idempotency
 * klíčem, export do schránky a explicitně potvrzené zahození.
 */
export function SyncProblems() {
	const { t } = useTranslation();
	const { data: rows } = usePsQuery<RejectedOpRow>(
		"SELECT * FROM local_rejected_ops WHERE status = 'open' ORDER BY created_at DESC LIMIT 50",
	);
	const [retryingId, setRetryingId] = useState<string | null>(null);
	const list = rows ?? [];
	if (list.length === 0) return null;

	const discard = (id: string) => {
		if (!window.confirm(t("sync.problemDiscardConfirm"))) return;
		void powerSync.execute("UPDATE local_rejected_ops SET status = 'discarded' WHERE id = ?", [
			id,
		]);
	};
	const retry = async (r: RejectedOpRow) => {
		if (retryingId) return;
		setRetryingId(r.id);
		try {
			const result = await retryRejectedOperation(powerSync, r);
			showToast(
				result.ok
					? t("sync.problemRetrySuccess")
					: t("sync.problemRetryFailed", { code: result.code ?? "unknown" }),
			);
		} finally {
			setRetryingId(null);
		}
	};
	const copyOne = async (r: RejectedOpRow) => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
			showToast(t("sync.problemCopied"));
		} catch {
			showToast(t("sync.problemCopyFailed"));
		}
	};

	return (
		<>
			<div
				className="font-display"
				style={{
					fontSize: 11,
					fontWeight: 700,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					color: "var(--w-overdue)",
					margin: "22px 0 8px",
				}}
			>
				{t("sync.problemsTitle")} ({list.length})
			</div>
			<div
				style={{
					background: "var(--w-card)",
					border: "1px solid var(--w-line)",
					borderRadius: 12,
					marginBottom: 10,
				}}
			>
				<div
					className="font-body"
					style={{
						fontSize: 11.5,
						color: "var(--w-ink-3)",
						padding: "10px 14px",
						borderBottom: "1px solid var(--w-line)",
						lineHeight: 1.5,
					}}
				>
					{t("sync.problemsDesc")}
				</div>
				{list.map((r) => (
					<div
						key={r.id}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "9px 14px",
							borderBottom: "1px solid var(--w-line)",
							minWidth: 0,
						}}
					>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div className="font-display" style={{ fontSize: 12.5, fontWeight: 600 }}>
								<span style={{ color: "var(--w-ink)" }}>
									{r.table_name} · {r.op}
								</span>{" "}
								<span className="font-mono" style={{ fontSize: 11, color: "var(--w-overdue)" }}>
									HTTP {r.http_code}
									{r.server_code ? ` · ${r.server_code}` : ""}
								</span>
							</div>
							<div
								className="font-mono"
								style={{
									fontSize: 10.5,
									color: "var(--w-ink-3)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{r.created_at?.slice(0, 19).replace("T", " ")}
								{r.request_id ? ` · req:${r.request_id}` : ""} · {(r.payload ?? "").slice(0, 80)}
							</div>
						</div>
						<button
							type="button"
							disabled={retryingId !== null}
							onClick={() => void retry(r)}
							className="font-display hover:border-brass"
							style={{
								flex: "none",
								fontSize: 11.5,
								fontWeight: 600,
								color: "var(--w-brass)",
								border: "1px solid var(--w-line)",
								borderRadius: 8,
								padding: "5px 10px",
								background: "transparent",
								cursor: retryingId === null ? "pointer" : "wait",
								opacity: retryingId !== null && retryingId !== r.id ? 0.5 : 1,
							}}
						>
							{retryingId === r.id ? t("sync.problemRetrying") : t("sync.problemRetry")}
						</button>
						<button
							type="button"
							onClick={() => void copyOne(r)}
							className="font-display hover:border-brass"
							style={{
								flex: "none",
								fontSize: 11.5,
								fontWeight: 600,
								color: "var(--w-ink-2)",
								border: "1px solid var(--w-line)",
								borderRadius: 8,
								padding: "5px 10px",
								background: "transparent",
								cursor: "pointer",
							}}
						>
							{t("sync.problemCopy")}
						</button>
						<button
							type="button"
							onClick={() => discard(r.id)}
							className="font-display hover:border-overdue"
							style={{
								flex: "none",
								fontSize: 11.5,
								fontWeight: 600,
								color: "var(--w-ink-3)",
								border: "1px solid var(--w-line)",
								borderRadius: 8,
								padding: "5px 10px",
								background: "transparent",
								cursor: "pointer",
							}}
						>
							{t("sync.problemDiscard")}
						</button>
					</div>
				))}
			</div>
		</>
	);
}
