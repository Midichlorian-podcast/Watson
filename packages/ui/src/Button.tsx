import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
	primary: "bg-navy text-white hover:bg-navy-2",
	secondary: "border border-line bg-card text-ink hover:border-brass",
	ghost: "text-ink-2 hover:bg-panel-2",
};

/** Tlačítko — primární (navy) / sekundární / ghost. */
export function Button({
	variant = "primary",
	className,
	children,
	...rest
}: {
	variant?: Variant;
	children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-display text-sm font-semibold transition disabled:opacity-50",
				VARIANTS[variant],
				className,
			)}
			{...rest}
		>
			{children}
		</button>
	);
}
