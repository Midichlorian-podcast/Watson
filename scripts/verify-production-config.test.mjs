import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateProductionConfig } from "./verify-production-config.mjs";

const scriptPath = fileURLToPath(new URL("./verify-production-config.mjs", import.meta.url));

function keyRing(kid = "current-key") {
  return JSON.stringify({
    version: 1,
    currentKid: kid,
    keys: [
      {
        kid,
        createdAt: "2026-07-16T00:00:00.000Z",
        publicJwk: { kty: "RSA", n: `${kid}-public-modulus`, e: "AQAB" },
        privateJwk: {
          kty: "RSA",
          n: `${kid}-public-modulus`,
          e: "AQAB",
          d: `${kid}-private-exponent`,
        },
      },
    ],
  });
}

function mailVaultKeyRing(kid = "mail-current") {
  return JSON.stringify({
    version: 1,
    currentKid: kid,
    keys: { [kid]: Buffer.alloc(32, 0x5a).toString("base64url") },
  });
}

function validEnv() {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://watson:database-password@db.internal.example.net:5432/watson",
    WEB_ORIGIN: "https://app.watson.cz,https://admin.watson.cz",
    BETTER_AUTH_URL: "https://api.watson.cz",
    AUTH_ALLOW_SIGNUP: "0",
    AUTH_REQUIRE_PRIVILEGED_2FA: "1",
    TRUST_PROXY: "1",
    BETTER_AUTH_SECRET: "auth_7J3p4Y8t2N6q9W5v1K0m8B7x4C2d6F3h",
    BACKUP_SIGNING_SECRET: "export_8V2r5M9c3X7z1L4n6P0q2S5u8D1f4G7j",
    LOCAL_DATA_ENCRYPTION_SECRET: "local_6Q1w4E8r2T5y9U3i7O0p4A6s8D2f5G9h",
    MAIL_VAULT_KEYS_JSON: mailVaultKeyRing(),
    OPS_METRICS_TOKEN: "metrics_9Z4x7C1v5B8n2M6a0S3d7F1g4H8j2K5l",
    RESEND_API_KEY: "re_production_provider_key_123456789",
    AUTH_EMAIL_FROM: "Watson <auth@watson.cz>",
    REMINDER_EMAIL_FROM: "Watson <reminders@watson.cz>",
    POWERSYNC_URL: "https://sync.watson.cz",
    POWERSYNC_SIGNING_KEYS_JSON: keyRing("powersync-key"),
    VAPID_PUBLIC_KEY: `B${"p".repeat(86)}`,
    VAPID_PRIVATE_KEY: "v".repeat(43),
    VAPID_SUBJECT: "mailto:security@watson.cz",
    LUCKYOS_MOCK: "0",
  };
}

test("valid core configuration passes without exposing any value", () => {
  const env = validEnv();
  const report = validateProductionConfig(env);
  assert.equal(report.status, "passed_with_warnings");
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.warnings >= 2);
  const serialized = JSON.stringify(report);
  for (const [name, value] of Object.entries(env)) {
    if (
      name.endsWith("_JSON") ||
      name.endsWith("_SECRET") ||
      name.endsWith("_TOKEN") ||
      name.endsWith("_KEY")
    ) {
      assert.equal(serialized.includes(value), false, `${name} leaked into report`);
    }
  }
});

test("local and insecure production endpoints fail closed", () => {
  const env = validEnv();
  env.DATABASE_URL = "postgres://watson:watson@localhost:5432/watson";
  env.WEB_ORIGIN = "https://app.watson.example";
  env.BETTER_AUTH_URL = "http://api.watson.cz";
  env.POWERSYNC_URL = "https://127.20.30.40:8080";
  const report = validateProductionConfig(env);
  assert.equal(report.status, "failed");
  for (const id of ["database_url", "web_origins", "better_auth_url", "powersync_url"]) {
    assert.equal(report.checks.find((check) => check.id === id)?.status, "failed");
  }
});

test("weak, duplicate, and unsafe policy settings fail closed", () => {
  const env = validEnv();
  env.AUTH_ALLOW_SIGNUP = "1";
  env.AUTH_REQUIRE_PRIVILEGED_2FA = "0";
  env.TRUST_PROXY = "0";
  env.BETTER_AUTH_SECRET = "change-me";
  env.BACKUP_SIGNING_SECRET = env.LOCAL_DATA_ENCRYPTION_SECRET;
  const report = validateProductionConfig(env);
  assert.equal(report.status, "failed");
  for (const id of [
    "invite_only",
    "privileged_2fa",
    "trusted_proxy",
    "better_auth_secret_strength",
    "core_secret_isolation",
  ]) {
    assert.equal(report.checks.find((check) => check.id === id)?.status, "failed");
  }
});

test("malformed or shared signing keyrings and partial providers fail", () => {
  const env = validEnv();
  env.POWERSYNC_SIGNING_KEYS_JSON = keyRing("shared-key");
  env.LUCKYOS_BASE_URL = "https://people.watson.cz";
  env.LUCKYOS_SIGNING_KEYS_JSON = env.POWERSYNC_SIGNING_KEYS_JSON;
  env.GOOGLE_CLIENT_ID = "google-client-only";
  env.MAIL_GOOGLE_CLIENT_ID = "mail-google-client-only";
  let report = validateProductionConfig(env);
  assert.equal(report.checks.find((check) => check.id === "google_oauth")?.status, "failed");
  assert.equal(report.checks.find((check) => check.id === "mail_google_oauth")?.status, "failed");
  assert.equal(
    report.checks.find((check) => check.id === "signing_keyring_isolation")?.status,
    "failed",
  );

  env.POWERSYNC_SIGNING_KEYS_JSON = "{not-json";
  env.LUCKYOS_SIGNING_KEYS_JSON = undefined;
  report = validateProductionConfig(env);
  assert.equal(report.checks.find((check) => check.id === "powersync_keyring")?.status, "failed");
  assert.equal(report.checks.find((check) => check.id === "luckyos_bridge")?.status, "failed");
});

test("mailbox vault rejects malformed, duplicate, and missing current keys", () => {
  const env = validEnv();
  env.MAIL_VAULT_KEYS_JSON = JSON.stringify({
    version: 1,
    currentKid: "missing",
    keys: { old: Buffer.alloc(32, 1).toString("base64url") },
  });
  let report = validateProductionConfig(env);
  assert.equal(report.checks.find((check) => check.id === "mail_vault_keyring")?.status, "failed");

  const repeated = Buffer.alloc(32, 2).toString("base64url");
  env.MAIL_VAULT_KEYS_JSON = JSON.stringify({
    version: 1,
    currentKid: "one",
    keys: { one: repeated, two: repeated },
  });
  report = validateProductionConfig(env);
  assert.equal(report.checks.find((check) => check.id === "mail_vault_keyring")?.status, "failed");

  env.MAIL_VAULT_KEYS_JSON = "{broken";
  report = validateProductionConfig(env);
  assert.equal(report.checks.find((check) => check.id === "mail_vault_keyring")?.status, "failed");
});

test("fully configured optional providers can produce a clean pass", () => {
  const env = validEnv();
  env.GOOGLE_CLIENT_ID = "google-production-client";
  env.GOOGLE_CLIENT_SECRET = "google-production-secret";
  env.MAIL_GOOGLE_CLIENT_ID = "mail-google-production-client";
  env.MAIL_GOOGLE_CLIENT_SECRET = "mail-google-production-secret";
  env.MAIL_GOOGLE_REDIRECT_URI = "https://api.watson.cz/api/mail/oauth/google/callback";
  env.ANTHROPIC_API_KEY = "sk-ant-production-credential";
  env.LUCKYOS_BASE_URL = "https://people.watson.cz";
  env.LUCKYOS_SIGNING_KEYS_JSON = keyRing("luckyos-key");
  const report = validateProductionConfig(env);
  assert.equal(report.status, "passed");
  assert.deepEqual(report.summary, { passed: report.checks.length, warnings: 0, failed: 0 });
});

test("CLI writes a private sanitized artifact and returns a failing exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watson-preflight-"));
  try {
    const artifactPath = join(directory, "report.json");
    const env = {
      ...validEnv(),
      WATSON_PRODUCTION_PREFLIGHT_ARTIFACT: artifactPath,
    };
    let result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
    let artifact = await readFile(artifactPath, "utf8");
    assert.equal(JSON.parse(artifact).status, "passed_with_warnings");
    assert.equal(artifact.includes(env.BETTER_AUTH_SECRET), false);
    assert.equal(result.stdout.includes(env.BETTER_AUTH_SECRET), false);

    env.NODE_ENV = "development";
    result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env });
    assert.equal(result.status, 1);
    artifact = await readFile(artifactPath, "utf8");
    assert.equal(JSON.parse(artifact).status, "failed");
    assert.match(result.stderr, /Failed checks: node_env/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
