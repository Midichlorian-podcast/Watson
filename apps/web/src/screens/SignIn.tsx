import { useTranslation } from "@watson/i18n";
import { useState } from "react";
import { signIn, signUp } from "../lib/auth-client";

export function SignIn() {
	const { t } = useTranslation();
	const [mode, setMode] = useState<"in" | "up">("in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const res =
			mode === "in"
				? await signIn.email({ email, password })
				: await signUp.email({ email, password, name });
		setBusy(false);
		if (res.error) setError(res.error.message ?? t("auth.genericError"));
	}

	return (
		<div className="grid min-h-full place-items-center px-4">
			<form
				onSubmit={submit}
				className="w-full max-w-sm rounded-2xl border border-line bg-card p-6"
				style={{ boxShadow: "var(--w-shadow)" }}
			>
				<div className="mb-5 flex items-center gap-2">
					<span className="grid h-8 w-8 place-items-center rounded-lg bg-navy font-display text-sm font-extrabold text-white">
						W
					</span>
					<span className="font-display text-lg font-extrabold tracking-tight text-navy">
						{t("app.name")}
					</span>
				</div>

				{mode === "up" && (
					<label className="mb-3 block text-xs font-semibold text-ink-2" htmlFor="auth-name">
						{t("auth.name")}
						<input
							id="auth-name"
							name="name"
							autoComplete="name"
							className="mt-1 min-h-11 w-full rounded-lg border border-line px-3 py-2 text-sm font-normal text-ink"
							placeholder={t("auth.name")}
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</label>
				)}
				<label className="mb-3 block text-xs font-semibold text-ink-2" htmlFor="auth-email">
					{t("auth.email")}
					<input
						id="auth-email"
						name="email"
						autoComplete="email"
						className="mt-1 min-h-11 w-full rounded-lg border border-line px-3 py-2 text-sm font-normal text-ink"
						type="email"
						placeholder={t("auth.email")}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</label>
				<label className="mb-3 block text-xs font-semibold text-ink-2" htmlFor="auth-password">
					{t("auth.password")}
					<input
						id="auth-password"
						name="password"
						autoComplete={mode === "in" ? "current-password" : "new-password"}
						className="mt-1 min-h-11 w-full rounded-lg border border-line px-3 py-2 text-sm font-normal text-ink"
						type="password"
						placeholder={t("auth.password")}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
					/>
				</label>

				{error && <p className="mb-3 text-xs text-overdue">{error}</p>}

				<button
					type="submit"
					disabled={busy}
					className="min-h-11 w-full rounded-lg bg-navy py-2 font-display text-sm font-semibold text-white disabled:opacity-50"
				>
					{mode === "in" ? t("auth.signIn") : t("auth.createAccount")}
				</button>

				<button
					type="button"
					onClick={() => setMode(mode === "in" ? "up" : "in")}
					className="mt-2 min-h-11 w-full text-center text-xs text-ink-3 hover:text-brass-text"
				>
					{mode === "in" ? t("auth.switchToSignUp") : t("auth.switchToSignIn")}
				</button>
			</form>
		</div>
	);
}
