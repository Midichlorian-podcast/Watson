import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.MAIL_GOOGLE_STUB_PORT ?? 8793);
const clientId = process.env.MAIL_GOOGLE_CLIENT_ID ?? "mail-google-ci-client";
const clientSecret = process.env.MAIL_GOOGLE_CLIENT_SECRET ?? "mail-google-ci-secret";
const codes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
let tokenExchanges = 0;
let revocations = 0;

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { ok: true });
  }
  if (request.method === "GET" && url.pathname === "/test/stats") {
    return json(response, 200, { tokenExchanges, revocations, activeTokens: accessTokens.size });
  }
  if (request.method === "GET" && url.pathname === "/oauth2/v2/auth") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    const email = url.searchParams.get("login_hint")?.trim().toLowerCase();
    if (
      !redirectUri ||
      !state ||
      !challenge ||
      !email ||
      url.searchParams.get("client_id") !== clientId ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      url.searchParams.get("scope") !== "https://www.googleapis.com/auth/gmail.modify" ||
      url.searchParams.get("access_type") !== "offline"
    ) {
      return json(response, 400, { error: "invalid_authorization_request" });
    }
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", state);
    if (email.includes("denied")) {
      callback.searchParams.set("error", "access_denied");
      return redirect(response, callback.toString());
    }
    const code = `code-${randomUUID()}`;
    codes.set(code, { challenge, email, redirectUri });
    callback.searchParams.set("code", code);
    return redirect(response, callback.toString());
  }
  if (request.method === "POST" && url.pathname === "/token") {
    tokenExchanges += 1;
    const form = new URLSearchParams(await body(request));
    const code = form.get("code");
    const pending = code ? codes.get(code) : null;
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      !pending ||
      challenge !== pending.challenge ||
      form.get("client_id") !== clientId ||
      form.get("client_secret") !== clientSecret ||
      form.get("redirect_uri") !== pending.redirectUri ||
      form.get("grant_type") !== "authorization_code"
    ) {
      return json(response, 400, { error: "invalid_grant" });
    }
    codes.delete(code);
    if (pending.email.includes("malformed")) {
      return json(response, 200, {
        access_token: `access-${randomUUID()}`,
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.modify",
        token_type: "Bearer",
        upstream_secret: "must-not-leak",
      });
    }
    const accessToken = `access-${randomUUID()}`;
    const refreshToken = `refresh-${randomUUID()}`;
    accessTokens.set(accessToken, pending.email);
    refreshTokens.set(refreshToken, pending.email);
    return json(response, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      token_type: "Bearer",
    });
  }
  if (request.method === "GET" && url.pathname === "/gmail/v1/users/me/profile") {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const email = accessTokens.get(token);
    if (!email) return json(response, 401, { error: "invalid_token" });
    if (email.includes("profile-malformed")) {
      return json(response, 200, { emailAddress: "not-an-email", upstream_secret: "must-not-leak" });
    }
    return json(response, 200, {
      emailAddress: email,
      historyId: "123456789",
      messagesTotal: 42,
      threadsTotal: 21,
    });
  }
  if (request.method === "POST" && url.pathname === "/revoke") {
    revocations += 1;
    const token = new URLSearchParams(await body(request)).get("token") ?? "";
    const email = refreshTokens.get(token);
    if (email?.includes("revoke-fail")) return json(response, 503, { error: "provider_down" });
    if (email) {
      refreshTokens.delete(token);
      for (const [accessToken, tokenEmail] of accessTokens) {
        if (tokenEmail === email) accessTokens.delete(accessToken);
      }
    }
    response.writeHead(200, { "Cache-Control": "no-store" });
    return response.end();
  }
  return json(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
