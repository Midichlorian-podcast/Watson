import { PowerSyncContext } from "@powersync/react";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useSession } from "./lib/auth-client";
import { initPowerSyncForUser, powerSync } from "./lib/powersync/db";
import { router } from "./router";
import { SignIn } from "./screens/SignIn";

export function App() {
	const { data: session, isPending } = useSession();
	// CC-P0-03: router se NErenderuje, dokud není otevřená per-user DB právě
	// přihlášeného uživatele — jinak by dotazy četly databázi předchozí identity.
	const [dbUserId, setDbUserId] = useState<string | null>(null);
	const [dbError, setDbError] = useState<string | null>(null);
	const [dbAttempt, setDbAttempt] = useState(0);
	const userId = session?.user?.id ?? null;

	useEffect(() => {
		// Explicitní retry nonce: tlačítko musí znovu spustit celý bezpečný init.
		void dbAttempt;
		if (!userId) return;
		let cancelled = false;
		setDbError(null);
		void initPowerSyncForUser(userId)
			.then(() => {
				if (!cancelled) setDbUserId(userId);
			})
			.catch(() => {
				if (!cancelled) setDbError("Lokální data se nepodařilo bezpečně otevřít nebo zašifrovat.");
			});
		return () => {
			cancelled = true;
		};
	}, [userId, dbAttempt]);

	if (isPending) {
		return (
			<div className="grid min-h-full place-items-center text-sm text-ink-3">
				…
			</div>
		);
	}
	if (!session) return <SignIn />;
	if (dbUserId !== userId) {
		if (dbError) {
			return (
				<div className="grid min-h-full place-items-center p-6">
					<div className="max-w-md text-center">
						<p className="text-sm font-semibold text-ink">{dbError}</p>
						<p className="mt-2 text-sm text-ink-3">
							Zkontroluj připojení. Neodeslané offline změny zůstaly na zařízení a nebyly smazány.
						</p>
						<button
							type="button"
							className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
							onClick={() => setDbAttempt((n) => n + 1)}
						>
							Zkusit znovu
						</button>
					</div>
				</div>
			);
		}
		return (
			<div className="grid min-h-full place-items-center text-sm text-ink-3">
				…
			</div>
		);
	}

	return (
		<ErrorBoundary>
			<PowerSyncContext.Provider value={powerSync}>
				<RouterProvider router={router} />
			</PowerSyncContext.Provider>
		</ErrorBoundary>
	);
}
