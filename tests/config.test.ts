import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  configPath,
  loadConfig,
  removeActiveAccount,
  saveAuthenticatedAccount,
  setActiveAccount,
  updateActiveAccountTokens,
} from "../src/lib/config.ts";
import { VERSION } from "../src/lib/version.ts";

const UA = `redditer/${VERSION}`;

const tempDirs: string[] = [];

function freshHome() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("config", () => {
  test("prefers non-empty env vars over defaults", () => {
    const config = loadConfig({
      env: {
        REDDIT_CLI_BASE_URL: "https://reddit.local",
        REDDIT_CLI_CLIENT_ID: "client-123",
        REDDIT_CLI_CLIENT_SECRET: "secret-123",
      },
    });

    expect(config.baseUrl).toBe("https://reddit.local");
    expect(config.clientId).toBe("client-123");
    expect(config.clientSecret).toBe("secret-123");
  });

  test("treats empty strings as absent", () => {
    const homeDir = freshHome();
    const cwd = freshHome();
    const config = loadConfig({
      homeDir,
      cwd,
      env: {
        REDDIT_CLI_BASE_URL: "",
        REDDIT_CLI_CLIENT_ID: "",
      },
    });

    expect(config.baseUrl).toBe("https://oauth.reddit.com");
    expect(config.clientId).toBeNull();
    expect(config.userAgent).toBe(UA);
  });

  test("persists app credentials and active account on save, env can still override", () => {
    const homeDir = freshHome();
    saveAuthenticatedAccount({
      homeDir,
      clientId: "saved-client",
      clientSecret: "saved-secret",
      redirectUri: "http://127.0.0.1:9780/callback",
      userAgent: UA,
      scope: "identity read",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1_700_000_000_000,
      username: "saved-user",
      redditUserId: "user-1",
    });

    const config = loadConfig({
      homeDir,
      env: {
        REDDIT_CLI_CLIENT_ID: "env-client",
      },
    });

    expect(config.clientId).toBe("env-client");
    expect(config.redirectUri).toBe("http://127.0.0.1:9780/callback");
    expect(config.username).toBe("saved-user");
    expect(config.activeAccountId).toBe("acct_saved-user");
  });

  test("writes a minimal account-aware config to disk", () => {
    const homeDir = freshHome();
    const { path, accountId } = saveAuthenticatedAccount({
      homeDir,
      clientId: "abc",
      redirectUri: "http://127.0.0.1:9780/callback",
      userAgent: UA,
      scope: "identity",
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: 1_700_000_000_000,
      username: "yak",
      redditUserId: "user-1",
    });

    expect(path).toBe(configPath({ homeDir }));
    expect(accountId).toBe("acct_yak");
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
    expect(raw).not.toHaveProperty("version");
    expect(raw).not.toHaveProperty("authProfiles");
    expect(raw.activeAccountId).toBe("acct_yak");
    expect(raw.app.clientId).toBe("abc");
    expect(raw.accounts.acct_yak.accessToken).toBe("token");
    expect(raw.accounts.acct_yak.username).toBe("yak");
  });

  test("reads user agent from env and .env.local", () => {
    const envDir = freshHome();
    writeFileSync(join(envDir, ".env.local"), "REDDIT_USER_AGENT=repo-agent/1.0\n");

    const config = loadConfig({
      cwd: envDir,
      env: { REDDIT_CLI_USER_AGENT: "explicit-agent/2.0" },
    });

    expect(config.userAgent).toBe("explicit-agent/2.0");
  });

  test("reads reddit client id from .env.local", () => {
    const envDir = freshHome();
    writeFileSync(
      join(envDir, ".env.local"),
      "REDDIT_CLIENT_ID=repo-client-id\nREDDIT_CLIENT_SECRET=repo-secret\nREDDIT_REDIRECT_URI=http://localhost:4200/cb\n",
    );

    const config = loadConfig({ cwd: envDir, env: {} });
    expect(config.clientId).toBe("repo-client-id");
  });

  test("reads reddit client secret from .env.local", () => {
    const envDir = freshHome();
    writeFileSync(join(envDir, ".env.local"), "REDDIT_CLIENT_SECRET=repo-secret\n");
    const config = loadConfig({ cwd: envDir, env: {} });
    expect(config.clientSecret).toBe("repo-secret");
  });

  test("reads reddit redirect uri from .env.local", () => {
    const envDir = freshHome();
    writeFileSync(
      join(envDir, ".env.local"),
      "REDDIT_REDIRECT_URI=http://localhost:4200/api/connections/reddit/callback\n",
    );
    const config = loadConfig({ cwd: envDir, env: {} });
    expect(config.redirectUri).toBe("http://localhost:4200/api/connections/reddit/callback");
  });

  test("lets explicit env override .env values", () => {
    const envDir = freshHome();
    writeFileSync(join(envDir, ".env.local"), "REDDIT_CLIENT_ID=repo-client-id\n");
    const config = loadConfig({
      cwd: envDir,
      env: { REDDIT_CLI_CLIENT_ID: "explicit-client-id" },
    });
    expect(config.clientId).toBe("explicit-client-id");
  });

  test("recovers from a corrupt config file by returning defaults", () => {
    const homeDir = freshHome();
    const path = configPath({ homeDir });
    require("node:fs").mkdirSync(require("node:path").dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");

    const config = loadConfig({ homeDir, env: {} });
    expect(config.activeAccountId).toBeNull();
    expect(config.accounts).toEqual([]);
  });

  test("re-authenticating the same reddit user reuses the account id", () => {
    const homeDir = freshHome();
    const first = saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a1",
      refreshToken: "r1",
      expiresAt: 1,
      username: "yak",
      redditUserId: "user-1",
    });
    const second = saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a2",
      refreshToken: "r2",
      expiresAt: 2,
      username: "yak",
      redditUserId: "user-1",
    });

    expect(first.accountId).toBe(second.accountId);
    const config = loadConfig({ homeDir, env: {} });
    expect(config.accounts).toHaveLength(1);
    expect(config.accessToken).toBe("a2");
  });

  test("updateActiveAccountTokens rewrites tokens in place", () => {
    const homeDir = freshHome();
    saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "old",
      refreshToken: "old-r",
      expiresAt: 1,
      username: "yak",
      redditUserId: "user-1",
    });
    const result = updateActiveAccountTokens({
      homeDir,
      accessToken: "new",
      expiresAt: 2,
      scope: "identity",
    });
    expect(result.accountId).toBe("acct_yak");
    const config = loadConfig({ homeDir, env: {} });
    expect(config.accessToken).toBe("new");
    expect(config.refreshToken).toBe("old-r");
    expect(config.scope).toBe("identity");
  });

  test("updateActiveAccountTokens throws when no active account", () => {
    const homeDir = freshHome();
    expect(() =>
      updateActiveAccountTokens({ homeDir, accessToken: "x", expiresAt: 1 }),
    ).toThrow("No active Reddit account");
  });

  test("setActiveAccount resolves by id, username, or label", () => {
    const homeDir = freshHome();
    saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a",
      expiresAt: 1,
      username: "yak",
      redditUserId: "user-1",
      label: "main",
    });
    saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a",
      expiresAt: 1,
      username: "otter",
      redditUserId: "user-2",
      label: "alt",
    });

    setActiveAccount("yak", { homeDir });
    expect(loadConfig({ homeDir, env: {} }).username).toBe("yak");
    setActiveAccount("alt", { homeDir });
    expect(loadConfig({ homeDir, env: {} }).username).toBe("otter");
    setActiveAccount("acct_yak", { homeDir });
    expect(loadConfig({ homeDir, env: {} }).username).toBe("yak");

    expect(() => setActiveAccount("ghost", { homeDir })).toThrow("No saved Reddit account");
  });

  test("removeActiveAccount falls back to another account or null", () => {
    const homeDir = freshHome();
    saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a",
      expiresAt: 1,
      username: "yak",
      redditUserId: "user-1",
    });
    saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a",
      expiresAt: 1,
      username: "otter",
      redditUserId: "user-2",
    });

    const removed = removeActiveAccount({ homeDir });
    expect(removed.removedUsername).toBe("otter");
    expect(loadConfig({ homeDir, env: {} }).username).toBe("yak");

    removeActiveAccount({ homeDir });
    const final = loadConfig({ homeDir, env: {} });
    expect(final.activeAccountId).toBeNull();
    expect(final.accounts).toEqual([]);

    expect(() => removeActiveAccount({ homeDir })).toThrow("No active Reddit account");
  });

  test("derives acct_primary when no username or redditUserId is given", () => {
    const homeDir = freshHome();
    const { accountId } = saveAuthenticatedAccount({
      homeDir,
      clientId: "c",
      redirectUri: "r",
      userAgent: "u",
      scope: "s",
      accessToken: "a",
      expiresAt: 1,
    });
    expect(accountId).toBe("acct_primary");
  });
});
