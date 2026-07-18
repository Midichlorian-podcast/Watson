import { createContext, type ReactNode, useContext } from "react";
import type { WatsonSurface, WindowShell } from "./windowSurfaces";

interface WindowContextValue {
	shell: WindowShell;
	surface: WatsonSurface | null;
	isFocus: boolean;
	isWallboard: boolean;
}

const WindowContext = createContext<WindowContextValue>({
	shell: "app",
	surface: null,
	isFocus: false,
	isWallboard: false,
});

export function WindowContextProvider({
	shell,
	surface,
	children,
}: {
	shell: WindowShell;
	surface: WatsonSurface | null;
	children: ReactNode;
}) {
	return (
		<WindowContext.Provider
			value={{
				shell,
				surface,
				isFocus: shell === "focus",
				isWallboard: shell === "wallboard",
			}}
		>
			{children}
		</WindowContext.Provider>
	);
}

export const useWindowContext = () => useContext(WindowContext);
