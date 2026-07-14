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
	const userId = session?.user?.id ?? null;

	useEffect(() => {
		if (!userId) return;
		let cancelled = false;
		void initPowerSyncForUser(userId).then(() => {
			if (!cancelled) setDbUserId(userId);
		});
		return () => {
			cancelled = true;
		};
	}, [userId]);

	if (isPending) {
		return (
			<div className="grid min-h-full place-items-center text-sm text-ink-3">
				…
			</div>
		);
	}
	if (!session) return <SignIn />;
	if (dbUserId !== userId) {
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
