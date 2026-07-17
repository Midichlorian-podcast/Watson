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
let refreshes = 0;
let messageGets = 0;
let historyLists = 0;
const mailboxes = new Map();

function message(email, index, historyId) {
  const id = `msg-${String(index).padStart(3, "0")}`;
  const threadId = `thread-${String(Math.ceil(index / 2)).padStart(3, "0")}`;
  const at = Date.UTC(2026, 6, 17, 8, index);
  return {
    id,
    threadId,
    labelIds: index % 2 === 0 ? ["INBOX", "UNREAD"] : ["INBOX"],
    snippet: `Bezpečný náhled zprávy ${index} pro ${email}`,
    historyId: String(historyId),
    internalDate: String(at),
    sizeEstimate: 1000 + index,
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: `Synchronizovaná zpráva ${index}` },
        { name: "From", value: `Odesílatel ${index} <sender-${index}@example.test>` },
        { name: "To", value: email },
        { name: "Date", value: new Date(at).toUTCString() },
      ],
      body: { size: 0 },
      parts: [
        {
          partId: "0",
          mimeType: "text/plain; charset=utf-8",
          filename: "",
          body: {
            size: 64,
            data: Buffer.from(`Text zprávy ${index}. Token sem nikdy nepatří.`, "utf8").toString("base64url"),
          },
        },
        {
          partId: "1",
          mimeType: "text/html; charset=utf-8",
          filename: "",
          body: {
            size: 80,
            data: Buffer.from(`<p>HTML zprávy <strong>${index}</strong>.</p>`, "utf8").toString("base64url"),
          },
        },
      ],
    },
  };
}

function ensureMailbox(email, count = 3) {
  const existing = mailboxes.get(email);
  if (existing) return existing;
  const messages = new Map();
  let historyId = 1000;
  for (let index = 1; index <= count; index += 1) {
    historyId += 1;
    const item = message(email, index, historyId);
    messages.set(item.id, item);
  }
  const mailbox = { email, messages, history: [], historyId, expireBefore: 0 };
  mailboxes.set(email, mailbox);
  return mailbox;
}

function historyEvent(mailbox, event) {
  mailbox.historyId += 7;
  const entry = { id: String(mailbox.historyId), ...event };
  mailbox.history.push(entry);
  return entry;
}

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
    return json(response, 200, {
      tokenExchanges,
      revocations,
      refreshes,
      messageGets,
      historyLists,
      activeTokens: accessTokens.size,
    });
  }
  if (request.method === "POST" && url.pathname === "/test/mailbox") {
    let input;
    try {
      input = JSON.parse(await body(request));
    } catch {
      return json(response, 400, { error: "invalid_json" });
    }
    const email = String(input?.email ?? "").trim().toLowerCase();
    const action = String(input?.action ?? "");
    if (!email) return json(response, 422, { error: "email_required" });
    if (action === "reset") {
      mailboxes.delete(email);
      const mailbox = ensureMailbox(email, Math.max(0, Math.min(60, Number(input?.count ?? 3))));
      return json(response, 200, { historyId: String(mailbox.historyId), messages: mailbox.messages.size });
    }
    const mailbox = ensureMailbox(email);
    if (action === "add") {
      const index = mailbox.messages.size + 50;
      const nextHistory = mailbox.historyId + 7;
      const item = message(email, index, nextHistory);
      mailbox.messages.set(item.id, item);
      historyEvent(mailbox, { messagesAdded: [{ message: { id: item.id, threadId: item.threadId } }] });
      item.historyId = String(mailbox.historyId);
      return json(response, 200, { id: item.id, historyId: String(mailbox.historyId) });
    }
    const messageId = String(input?.messageId ?? "");
    const item = mailbox.messages.get(messageId);
    if (action === "label" && item) {
      item.labelIds = [...new Set([...(item.labelIds ?? []), "STARRED"])];
      historyEvent(mailbox, {
        labelsAdded: [{ message: { id: item.id, threadId: item.threadId }, labelIds: ["STARRED"] }],
      });
      item.historyId = String(mailbox.historyId);
      return json(response, 200, { id: item.id, historyId: String(mailbox.historyId) });
    }
    if (action === "delete" && item) {
      mailbox.messages.delete(messageId);
      historyEvent(mailbox, { messagesDeleted: [{ message: { id: item.id, threadId: item.threadId } }] });
      return json(response, 200, { id: item.id, historyId: String(mailbox.historyId) });
    }
    if (action === "expire") {
      mailbox.expireBefore = mailbox.historyId;
      return json(response, 200, { expireBefore: String(mailbox.expireBefore) });
    }
    if (action === "invalidate_access") {
      for (const [token, tokenEmail] of accessTokens) {
        if (tokenEmail === email) accessTokens.delete(token);
      }
      return json(response, 200, { invalidated: true });
    }
    return json(response, 422, { error: "invalid_mailbox_action" });
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
    const form = new URLSearchParams(await body(request));
    if (form.get("grant_type") === "refresh_token") {
      refreshes += 1;
      const refreshToken = form.get("refresh_token") ?? "";
      const email = refreshTokens.get(refreshToken);
      if (
        !email ||
        form.get("client_id") !== clientId ||
        form.get("client_secret") !== clientSecret
      ) {
        return json(response, 400, { error: "invalid_grant" });
      }
      const accessToken = `access-${randomUUID()}`;
      accessTokens.set(accessToken, email);
      return json(response, 200, {
        access_token: accessToken,
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.modify",
        token_type: "Bearer",
      });
    }
    tokenExchanges += 1;
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
    ensureMailbox(pending.email);
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
    const mailbox = ensureMailbox(email);
    return json(response, 200, {
      emailAddress: email,
      historyId: String(mailbox.historyId),
      messagesTotal: mailbox.messages.size,
      threadsTotal: new Set([...mailbox.messages.values()].map((item) => item.threadId)).size,
    });
  }
  if (request.method === "GET" && url.pathname === "/gmail/v1/users/me/messages") {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const email = accessTokens.get(token);
    if (!email) return json(response, 401, { error: "invalid_token" });
    const mailbox = ensureMailbox(email);
    const maxResults = Math.max(1, Math.min(100, Number(url.searchParams.get("maxResults") ?? 25)));
    const offset = Math.max(0, Number(url.searchParams.get("pageToken") ?? 0));
    const items = [...mailbox.messages.values()]
      .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
      .slice(offset, offset + maxResults)
      .map((item) => ({ id: item.id, threadId: item.threadId }));
    const nextOffset = offset + items.length;
    return json(response, 200, {
      messages: items,
      nextPageToken: nextOffset < mailbox.messages.size ? String(nextOffset) : undefined,
      resultSizeEstimate: mailbox.messages.size,
    });
  }
  if (request.method === "GET" && url.pathname.startsWith("/gmail/v1/users/me/messages/")) {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const email = accessTokens.get(token);
    if (!email) return json(response, 401, { error: "invalid_token" });
    messageGets += 1;
    const id = decodeURIComponent(url.pathname.slice("/gmail/v1/users/me/messages/".length));
    const item = ensureMailbox(email).messages.get(id);
    return item ? json(response, 200, item) : json(response, 404, { error: "not_found" });
  }
  if (request.method === "GET" && url.pathname === "/gmail/v1/users/me/history") {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const email = accessTokens.get(token);
    if (!email) return json(response, 401, { error: "invalid_token" });
    historyLists += 1;
    const mailbox = ensureMailbox(email);
    const start = Number(url.searchParams.get("startHistoryId") ?? 0);
    if (!Number.isFinite(start) || start < mailbox.expireBefore) {
      return json(response, 404, { error: "history_expired" });
    }
    const maxResults = Math.max(1, Math.min(500, Number(url.searchParams.get("maxResults") ?? 100)));
    const offset = Math.max(0, Number(url.searchParams.get("pageToken") ?? 0));
    const events = mailbox.history.filter((entry) => Number(entry.id) > start);
    const page = events.slice(offset, offset + maxResults);
    const nextOffset = offset + page.length;
    return json(response, 200, {
      history: page,
      nextPageToken: nextOffset < events.length ? String(nextOffset) : undefined,
      historyId: String(mailbox.historyId),
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
