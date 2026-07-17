import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "::1", "host.docker.internal", "localhost"]);
const PLACEHOLDER_PARTS = [
  "change-me",
  "changeme",
  "example-secret",
  "not-for-production",
  "replace-me",
  "watson-dev-secret",
];

function isUnsafeHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    LOCAL_HOSTS.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".test") ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    normalized.startsWith("::ffff:127.")
  );
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    PLACEHOLDER_PARTS.some((part) => normalized.includes(part)) ||
    normalized.startsWith("<") ||
    normalized.endsWith(">")
  );
}

function parseUrl(value, allowedProtocols) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (!url.hostname || isUnsafeHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function validateKeyRing(raw) {
  if (!raw) return false;
  try {
    const ring = JSON.parse(raw);
    if (
      ring?.version !== 1 ||
      typeof ring.currentKid !== "string" ||
      !ring.currentKid ||
      !Array.isArray(ring.keys) ||
      ring.keys.length < 1 ||
      ring.keys.length > 5
    ) {
      return false;
    }
    const kids = new Set();
    for (const key of ring.keys) {
      if (
        typeof key?.kid !== "string" ||
        !key.kid ||
        kids.has(key.kid) ||
        key.publicJwk?.kty !== "RSA" ||
        typeof key.publicJwk.n !== "string" ||
        !key.publicJwk.n ||
        typeof key.publicJwk.e !== "string" ||
        !key.publicJwk.e
      ) {
        return false;
      }
      kids.add(key.kid);
    }
    const current = ring.keys.find((key) => key.kid === ring.currentKid);
    return Boolean(
      current?.privateJwk?.kty === "RSA" &&
      typeof current.privateJwk.d === "string" &&
      current.privateJwk.d &&
      current.privateJwk.n === current.publicJwk.n &&
      current.privateJwk.e === current.publicJwk.e,
    );
  } catch {
    return false;
  }
}

function readMailVaultKeys(raw) {
  if (!raw) return null;
  try {
    const ring = JSON.parse(raw);
    if (
      ring?.version !== 1 ||
      typeof ring.currentKid !== "string" ||
      !/^[a-zA-Z0-9._-]{1,64}$/.test(ring.currentKid) ||
      !ring.keys ||
      typeof ring.keys !== "object" ||
      Array.isArray(ring.keys)
    ) {
      return null;
    }
    const entries = Object.entries(ring.keys);
    if (entries.length < 1 || entries.length > 8) return null;
    const decoded = new Map();
    for (const [kid, value] of entries) {
      if (
        !/^[a-zA-Z0-9._-]{1,64}$/.test(kid) ||
        typeof value !== "string" ||
        !/^[a-zA-Z0-9_-]{43}$/.test(value) ||
        Buffer.from(value, "base64url").length !== 32 ||
        decoded.has(value)
      ) {
        return null;
      }
      decoded.set(value, kid);
    }
    if (!Object.hasOwn(ring.keys, ring.currentKid)) return null;
    return [...decoded.keys()];
  } catch {
    return null;
  }
}

export function validateProductionConfig(source = process.env) {
  const checks = [];
  const record = (id, status, message) => checks.push({ id, status, message });
  const required = (name) => {
    const value = source[name]?.trim();
    if (!value) {
      record(name.toLowerCase(), "failed", `${name} is required.`);
      return null;
    }
    return value;
  };
  const secret = (name, minimum = 32, maximum = 512) => {
    const value = required(name);
    if (!value) return null;
    if (value.length < minimum || value.length > maximum || isPlaceholder(value)) {
      record(
        `${name.toLowerCase()}_strength`,
        "failed",
        `${name} must be an independent non-placeholder value of ${minimum}–${maximum} characters.`,
      );
      return value;
    }
    record(
      `${name.toLowerCase()}_strength`,
      "passed",
      `${name} satisfies the length and placeholder policy.`,
    );
    return value;
  };

  record(
    "node_env",
    source.NODE_ENV === "production" ? "passed" : "failed",
    "NODE_ENV must be exactly production.",
  );

  const databaseUrl = required("DATABASE_URL");
  const parsedDatabase = databaseUrl ? parseUrl(databaseUrl, ["postgres:", "postgresql:"]) : null;
  record(
    "database_url",
    parsedDatabase ? "passed" : "failed",
    "DATABASE_URL must be a non-local PostgreSQL endpoint.",
  );

  const origins = (source.WEB_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const validOrigins =
    origins.length > 0 &&
    origins.every((origin) => {
      const url = parseUrl(origin, ["https:"]);
      return (
        url &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        !url.hostname.includes("*")
      );
    });
  record(
    "web_origins",
    validOrigins ? "passed" : "failed",
    "Every WEB_ORIGIN entry must be an exact non-local HTTPS origin.",
  );

  const authUrl = parseUrl(source.BETTER_AUTH_URL?.trim(), ["https:"]);
  record(
    "better_auth_url",
    authUrl && !authUrl.username && !authUrl.password ? "passed" : "failed",
    "BETTER_AUTH_URL must be a non-local HTTPS URL without embedded credentials.",
  );
  record(
    "invite_only",
    source.AUTH_ALLOW_SIGNUP === "0" ? "passed" : "failed",
    "AUTH_ALLOW_SIGNUP must be explicitly set to 0 for the invite-only production pilot.",
  );
  record(
    "privileged_2fa",
    source.AUTH_REQUIRE_PRIVILEGED_2FA === "1" ? "passed" : "failed",
    "AUTH_REQUIRE_PRIVILEGED_2FA must be explicitly set to 1.",
  );
  record(
    "trusted_proxy",
    source.TRUST_PROXY === "1" ? "passed" : "failed",
    "TRUST_PROXY must be 1 for the managed production edge described by the deployment runbook.",
  );

  const authSecret = secret("BETTER_AUTH_SECRET");
  const backupSecret = secret("BACKUP_SIGNING_SECRET");
  const localDataSecret = secret("LOCAL_DATA_ENCRYPTION_SECRET");
  const metricsToken = secret("OPS_METRICS_TOKEN");
  const independentSecrets = [authSecret, backupSecret, localDataSecret, metricsToken].filter(
    Boolean,
  );
  record(
    "core_secret_isolation",
    new Set(independentSecrets).size === 4 ? "passed" : "failed",
    "Auth, export signing, local-data encryption, and metrics credentials must all be present and different.",
  );

  const mailVaultRaw = required("MAIL_VAULT_KEYS_JSON");
  const mailVaultKeys = readMailVaultKeys(mailVaultRaw);
  record(
    "mail_vault_keyring",
    mailVaultKeys ? "passed" : "failed",
    "MAIL_VAULT_KEYS_JSON must contain a version 1 keyring with unique 32-byte base64url AES keys.",
  );
  record(
    "mail_vault_isolation",
    mailVaultKeys &&
      !mailVaultKeys.some((key) =>
        [authSecret, backupSecret, localDataSecret, metricsToken].includes(key),
      )
      ? "passed"
      : "failed",
    "Mailbox vault keys must not be reused by auth, export, local-data, or metrics systems.",
  );

  const resendKey = required("RESEND_API_KEY");
  record(
    "resend_key",
    resendKey && resendKey.length >= 16 && !isPlaceholder(resendKey) ? "passed" : "failed",
    "RESEND_API_KEY must be a non-placeholder provider credential.",
  );
  const emailFrom = required("AUTH_EMAIL_FROM");
  const emailMatch = emailFrom?.match(/(?:<)?([^<>\s]+@[^<>\s]+)(?:>)?$/);
  const emailDomain = emailMatch?.[1]?.split("@")[1]?.toLowerCase();
  const validEmailDomain = Boolean(
    emailDomain &&
    !emailDomain.endsWith(".local") &&
    !emailDomain.endsWith(".example") &&
    !emailDomain.endsWith(".test") &&
    !emailDomain.endsWith(".invalid") &&
    emailDomain !== "example.com",
  );
  record(
    "auth_email_from",
    validEmailDomain ? "passed" : "failed",
    "AUTH_EMAIL_FROM must contain a deliverable production-domain address.",
  );
  const reminderEmailFrom = source.REMINDER_EMAIL_FROM?.trim() || emailFrom;
  const reminderEmailMatch = reminderEmailFrom?.match(/(?:<)?([^<>\s]+@[^<>\s]+)(?:>)?$/);
  const reminderEmailDomain = reminderEmailMatch?.[1]?.split("@")[1]?.toLowerCase();
  record(
    "reminder_email_from",
    reminderEmailDomain &&
      !reminderEmailDomain.endsWith(".local") &&
      !reminderEmailDomain.endsWith(".example") &&
      !reminderEmailDomain.endsWith(".test") &&
      !reminderEmailDomain.endsWith(".invalid") &&
      reminderEmailDomain !== "example.com"
      ? "passed"
      : "failed",
    "REMINDER_EMAIL_FROM (or AUTH_EMAIL_FROM fallback) must contain a deliverable production-domain address.",
  );

  const powersyncUrl = parseUrl(source.POWERSYNC_URL?.trim(), ["https:"]);
  record(
    "powersync_url",
    powersyncUrl && !powersyncUrl.username && !powersyncUrl.password ? "passed" : "failed",
    "POWERSYNC_URL must be a non-local HTTPS endpoint without embedded credentials.",
  );
  const powersyncRing = source.POWERSYNC_SIGNING_KEYS_JSON?.trim();
  record(
    "powersync_keyring",
    validateKeyRing(powersyncRing) ? "passed" : "failed",
    "POWERSYNC_SIGNING_KEYS_JSON must contain a structurally valid version 1 RSA overlap keyring.",
  );

  const vapidPublic = required("VAPID_PUBLIC_KEY");
  const vapidPrivate = required("VAPID_PRIVATE_KEY");
  record(
    "vapid_keypair",
    vapidPublic &&
      vapidPublic.length >= 80 &&
      vapidPrivate &&
      vapidPrivate.length >= 40 &&
      vapidPrivate !== vapidPublic &&
      !isPlaceholder(vapidPublic) &&
      !isPlaceholder(vapidPrivate)
      ? "passed"
      : "failed",
    "VAPID public/private keys must be distinct, non-placeholder production keys.",
  );
  const vapidSubject = source.VAPID_SUBJECT?.trim();
  const normalizedVapidSubject = vapidSubject?.toLowerCase();
  const validVapidSubject =
    Boolean(vapidSubject?.startsWith("https://") && parseUrl(vapidSubject, ["https:"])) ||
    Boolean(
      vapidSubject &&
      /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(vapidSubject) &&
      !normalizedVapidSubject?.endsWith(".test") &&
      !normalizedVapidSubject?.endsWith(".local") &&
      !normalizedVapidSubject?.endsWith(".example") &&
      !normalizedVapidSubject?.includes("@example.com"),
    );
  record(
    "vapid_subject",
    validVapidSubject ? "passed" : "failed",
    "VAPID_SUBJECT must be a production mailto: or non-local HTTPS contact.",
  );

  const googleId = source.GOOGLE_CLIENT_ID?.trim();
  const googleSecret = source.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleId) !== Boolean(googleSecret)) {
    record(
      "google_oauth",
      "failed",
      "Google OAuth must provide both client ID and client secret, or neither.",
    );
  } else if (!googleId) {
    record(
      "google_oauth",
      "warning",
      "Google OAuth is disabled; confirm this is intentional for the release.",
    );
  } else if (isPlaceholder(googleId) || isPlaceholder(googleSecret)) {
    record(
      "google_oauth",
      "failed",
      "Configured Google OAuth credentials must not be placeholders.",
    );
  } else {
    record("google_oauth", "passed", "Google OAuth credentials are configured as a pair.");
  }

  const mailGoogleId = source.MAIL_GOOGLE_CLIENT_ID?.trim();
  const mailGoogleSecret = source.MAIL_GOOGLE_CLIENT_SECRET?.trim();
  const mailGoogleRedirect = parseUrl(source.MAIL_GOOGLE_REDIRECT_URI?.trim(), ["https:"]);
  if (Boolean(mailGoogleId) !== Boolean(mailGoogleSecret)) {
    record(
      "mail_google_oauth",
      "failed",
      "Gmail OAuth must provide its dedicated client ID and client secret together.",
    );
  } else if (!mailGoogleId) {
    record(
      "mail_google_oauth",
      "warning",
      "Gmail mailbox OAuth is disabled; Mail must remain visibly in demo mode.",
    );
  } else {
    const validMailGoogle =
      !isPlaceholder(mailGoogleId) &&
      !isPlaceholder(mailGoogleSecret) &&
      mailGoogleRedirect &&
      !mailGoogleRedirect.username &&
      !mailGoogleRedirect.password &&
      mailGoogleRedirect.pathname === "/api/mail/oauth/google/callback" &&
      !mailGoogleRedirect.search &&
      !mailGoogleRedirect.hash;
    record(
      "mail_google_oauth",
      validMailGoogle ? "passed" : "failed",
      "Gmail OAuth requires dedicated non-placeholder credentials and an exact HTTPS callback URI.",
    );
  }

  const anthropicKey = source.ANTHROPIC_API_KEY?.trim();
  if (!anthropicKey) {
    record("anthropic", "warning", "Anthropic is disabled; AI features will not be available.");
  } else {
    record(
      "anthropic",
      anthropicKey.length >= 16 && !isPlaceholder(anthropicKey) ? "passed" : "failed",
      "Configured Anthropic credential must be a non-placeholder provider value.",
    );
  }

  const luckyBase = source.LUCKYOS_BASE_URL?.trim();
  const luckyRing = source.LUCKYOS_SIGNING_KEYS_JSON?.trim();
  if (source.LUCKYOS_MOCK === "1") {
    record("luckyos_mock", "failed", "LUCKYOS_MOCK must not be enabled in production.");
  } else {
    record("luckyos_mock", "passed", "LuckyOS mock mode is disabled.");
  }
  if (Boolean(luckyBase) !== Boolean(luckyRing)) {
    record(
      "luckyos_bridge",
      "failed",
      "LuckyOS must provide both HTTPS base URL and signing keyring, or neither.",
    );
  } else if (!luckyBase) {
    record("luckyos_bridge", "warning", "LuckyOS bridge is disabled for this release.");
  } else {
    const luckyUrl = parseUrl(luckyBase, ["https:"]);
    const validBridge =
      Boolean(luckyUrl && !luckyUrl.username && !luckyUrl.password) && validateKeyRing(luckyRing);
    record(
      "luckyos_bridge",
      validBridge ? "passed" : "failed",
      "LuckyOS bridge requires a non-local HTTPS URL and a structurally valid version 1 RSA keyring.",
    );
    record(
      "signing_keyring_isolation",
      luckyRing !== powersyncRing ? "passed" : "failed",
      "PowerSync and LuckyOS must use different signing keyrings.",
    );
  }

  const failed = checks.filter((check) => check.status === "failed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return {
    checkedAt: new Date().toISOString(),
    status: failed > 0 ? "failed" : warnings > 0 ? "passed_with_warnings" : "passed",
    summary: { passed: checks.length - failed - warnings, warnings, failed },
    checks,
  };
}

async function main() {
  const artifactPath = resolve(
    process.env.WATSON_PRODUCTION_PREFLIGHT_ARTIFACT ?? "artifacts/production-preflight.json",
  );
  const report = validateProductionConfig(process.env);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(artifactPath, 0o600);
  console.log(
    `Production preflight: ${report.status}; passed=${report.summary.passed}, warnings=${report.summary.warnings}, failed=${report.summary.failed}; artifact=${artifactPath}`,
  );
  if (report.summary.failed > 0) {
    console.error(
      `Failed checks: ${report.checks
        .filter((check) => check.status === "failed")
        .map((check) => check.id)
        .join(", ")}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
