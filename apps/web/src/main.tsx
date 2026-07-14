import { QueryClientProvider } from "@tanstack/react-query";
import { initI18n } from "@watson/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { queryClient } from "./lib/queryClient";
import "./index.css";

initI18n();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root nenalezen");

createRoot(rootEl).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
