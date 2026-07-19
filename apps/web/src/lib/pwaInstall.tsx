import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type InstallResult = "accepted" | "dismissed" | "installed" | "unavailable" | "error";
type InstallState = "available" | "installed" | "unavailable";

interface PwaInstallContextValue {
	state: InstallState;
	install: () => Promise<InstallResult>;
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

function isStandalone(): boolean {
	const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		standaloneNavigator.standalone === true
	);
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
	const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
	const [installed, setInstalled] = useState(isStandalone);

	useEffect(() => {
		const media = window.matchMedia("(display-mode: standalone)");
		const onBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			setPromptEvent(event as BeforeInstallPromptEvent);
		};
		const onInstalled = () => {
			setInstalled(true);
			setPromptEvent(null);
		};
		const onDisplayModeChange = () => setInstalled(isStandalone());
		window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
		window.addEventListener("appinstalled", onInstalled);
		media.addEventListener("change", onDisplayModeChange);
		return () => {
			window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
			window.removeEventListener("appinstalled", onInstalled);
			media.removeEventListener("change", onDisplayModeChange);
		};
	}, []);

	const install = useCallback(async (): Promise<InstallResult> => {
		if (installed) return "installed";
		if (!promptEvent) return "unavailable";
		try {
			await promptEvent.prompt();
			const { outcome } = await promptEvent.userChoice;
			setPromptEvent(null);
			return outcome;
		} catch {
			setPromptEvent(null);
			return "error";
		}
	}, [installed, promptEvent]);

	const value = useMemo<PwaInstallContextValue>(
		() => ({ state: installed ? "installed" : promptEvent ? "available" : "unavailable", install }),
		[install, installed, promptEvent],
	);
	return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

export function usePwaInstall(): PwaInstallContextValue {
	const value = useContext(PwaInstallContext);
	if (!value) throw new Error("usePwaInstall must be used inside PwaInstallProvider");
	return value;
}
