import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "default" | "success" | "overdue" | "brass";

const TONES: Record<Tone, string> = {
	default: "border-line bg-panel-2 text-ink-2",
	success: "border-transparent bg-success-soft text-[var(--w-success-ink)]",
	overdue: "border-transparent bg-overdue-soft text-overdue",
	brass: "border-transparent bg-[var(--w-brass-soft)] text-brass-text",
};

/** Obecný chip/štítek (status, termín, počet…). */
export function Chip({
	children,
	tone = "default",
	className,
}: {
	children: ReactNode;
	tone?: Tone;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
				TONES[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}

/** Status chip: Probíhá / Ke kontrole / Hotovo. */
export function StatusChip({ status }: { status: string }) {
	const tone: Tone =
		status === "Hotovo"
			? "success"
			: status === "Ke kontrole"
				? "brass"
				: "default";
	return <Chip tone={tone}>{status}</Chip>;
}
