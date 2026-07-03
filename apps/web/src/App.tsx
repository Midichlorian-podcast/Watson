import { PowerSyncContext } from "@powersync/react";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession } from "./lib/auth-client";
import { connectPowerSync, powerSync } from "./lib/powersync/db";
import { router } from "./router";
import { SignIn } from "./screens/SignIn";

export function App() {
	const { data: session, isPending } = useSession();

	useEffect(() => {
		if (session) void connectPowerSync();
	}, [session]);

	if (isPending) {
		return (
			<div className="grid min-h-full place-items-center text-sm text-ink-3">
				…
			</div>
		);
	}
	if (!session) return <SignIn />;

	return (
		<PowerSyncContext.Provider value={powerSync}>
			<RouterProvider router={router} />
		</PowerSyncContext.Provider>
	);
}
