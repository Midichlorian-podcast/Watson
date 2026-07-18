import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_URL } from "./api";
import { publishWindowEvent } from "./windowCoordinator";

/** Better Auth klient — míří na náš Hono backend (/api/auth). */
export const authClient = createAuthClient({
	baseURL: API_URL,
	plugins: [
		twoFactorClient(),
		inferAdditionalFields({
			user: {
				locale: { type: "string", required: true, input: false },
				timezone: { type: "string", required: true, input: false },
			},
		}),
	],
});

export const { signIn, signUp, useSession } = authClient;

export const signOut: typeof authClient.signOut = async (...args) => {
	const result = await authClient.signOut(...args);
	publishWindowEvent("session-invalidated", {});
	return result;
};
