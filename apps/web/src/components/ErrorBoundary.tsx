import i18n from "@watson/i18n";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	/** Volitelný vlastní fallback (jinak výchozí obrazovka s Obnovit). */
	fallback?: ReactNode;
}
interface State {
	error: Error | null;
}

/**
 * Globální hranice chyb — jedna neošetřená render výjimka jinak zbělá celou appku.
 * Zachytí, zaloguje a nabídne obnovení místo prázdné obrazovky. (Audit: chyběla úplně.)
 */
export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo) {
		// V devu do konzole; v produkci by sem šel report do telemetrie.
		console.error(
			"[watson] render error caught by ErrorBoundary:",
			error,
			info,
		);
	}

	private reset = () => {
		this.setState({ error: null });
		window.location.reload();
	};

	override render() {
		if (!this.state.error) return this.props.children;
		if (this.props.fallback) return this.props.fallback;
		const t = i18n.t.bind(i18n);
		return (
			<div
				className="grid min-h-full place-items-center"
				style={{ padding: "40px 20px" }}
			>
				<div
					className="rounded-2xl border border-line bg-card text-center"
					style={{
						maxWidth: 420,
						padding: "28px 26px",
						boxShadow: "var(--w-shadow)",
					}}
				>
					<div
						className="mx-auto flex items-center justify-center rounded-full"
						style={{
							width: 44,
							height: 44,
							background: "var(--w-brass-soft)",
							color: "var(--w-brass-text)",
							marginBottom: 14,
						}}
					>
						<svg
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden
						>
							<path
								d="M12 8v5M12 16.5v.5"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
							/>
							<circle
								cx="12"
								cy="12"
								r="9"
								stroke="currentColor"
								strokeWidth="1.6"
							/>
						</svg>
					</div>
					<div
						className="font-display font-bold text-ink"
						style={{ fontSize: 16, marginBottom: 6 }}
					>
						{t("errors.title")}
					</div>
					<p
						className="font-body text-ink-3"
						style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}
					>
						{t("errors.body")}
					</p>
					<button
						type="button"
						onClick={this.reset}
						className="rounded-[10px] font-display font-bold text-white hover:brightness-105"
						style={{
							background: "var(--w-brass)",
							padding: "10px 18px",
							fontSize: 13,
						}}
					>
						{t("errors.reload")}
					</button>
				</div>
			</div>
		);
	}
}
