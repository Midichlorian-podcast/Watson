import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_URL } from "./api";

/** Better Auth klient — míří na náš Hono backend (/api/auth). */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
