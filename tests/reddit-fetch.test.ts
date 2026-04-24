import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, saveAuthenticatedAccount } from "../src/lib/config.ts";
import { redditFetch } from "../src/lib/reddit-fetch.ts";

const tempDirs: string[] = [];
function freshHome() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-reddit-fetch-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedAccount(homeDir: string, opts: { refreshToken?: string | null } = {}) {
  saveAuthenticatedAccount({
    homeDir,
    clientId: "client-123",
    clientSecret: "secret-123",
    redirectUri: "http://127.0.0.1:9780/callback",
    userAgent: "reddit-cli/test",
    scope: "identity read",
    accessToken: "old-access",
    refreshToken: opts.refreshToken === undefined ? "refresh-1" : opts.refreshToken,
    expiresAt: 1,
    username: "yak",
    redditUserId: "user-1",
  });
}

describe("redditFetch", () => {
  test("calls reddit with the saved access token and returns json", async () => {
    const homeDir = freshHome();
    seedAccount(homeDir);
    const calls: Array<{ url: string; auth: string }> = [];

    const data = await redditFetch<{ kind: string }>("/api/v1/me", {
      homeDir,
      env: {},
      fetchImpl: async (url, init) => {
        const headers = init?.headers as Record<string, string>;
        calls.push({ url: String(url), auth: headers.Authorization ?? "" });
        return new Response(JSON.stringify({ kind: "t2" }), { status: 200 });
      },
    });

    expect(data.kind).toBe("t2");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://oauth.reddit.com/api/v1/me");
    expect(calls[0]!.auth).toBe("Bearer old-access");
  });

  test("refreshes on 401 and retries once with the new token", async () => {
    const homeDir = freshHome();
    seedAccount(homeDir);
    const authHeaders: string[] = [];

    const data = await redditFetch<{ ok: true }>("/api/v1/me", {
      homeDir,
      env: {},
      fetchImpl: async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        authHeaders.push(headers.Authorization ?? "");
        if (authHeaders.length === 1) return new Response("unauth", { status: 401 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      refreshImpl: async () => ({
        accessToken: "new-access",
        refreshToken: "refresh-2",
        scope: "identity read",
        expiresAt: 2,
      }),
    });

    expect(data).toEqual({ ok: true } as const);
    expect(authHeaders).toEqual(["Bearer old-access", "Bearer new-access"]);
    const config = loadConfig({ homeDir, env: {} });
    expect(config.accessToken).toBe("new-access");
    expect(config.refreshToken).toBe("refresh-2");
  });

  test("throws when there is no active account", async () => {
    const homeDir = freshHome();
    await expect(
      redditFetch("/api/v1/me", {
        homeDir,
        env: {},
        fetchImpl: async () => new Response("x"),
      }),
    ).rejects.toThrow("No active Reddit account");
  });

  test("throws actionable error when 401 hits and no refresh token exists", async () => {
    const homeDir = freshHome();
    seedAccount(homeDir, { refreshToken: null });
    await expect(
      redditFetch("/api/v1/me", {
        homeDir,
        env: {},
        fetchImpl: async () => new Response("unauth", { status: 401 }),
      }),
    ).rejects.toThrow("Run `reddit-cli auth login`");
  });

  test("bubbles non-401 errors without retrying", async () => {
    const homeDir = freshHome();
    seedAccount(homeDir);
    let calls = 0;
    await expect(
      redditFetch("/api/v1/me", {
        homeDir,
        env: {},
        fetchImpl: async () => {
          calls++;
          return new Response("boom", { status: 500 });
        },
      }),
    ).rejects.toThrow("Reddit request failed (500)");
    expect(calls).toBe(1);
  });

  test("fails cleanly when refresh itself fails", async () => {
    const homeDir = freshHome();
    seedAccount(homeDir);
    await expect(
      redditFetch("/api/v1/me", {
        homeDir,
        env: {},
        fetchImpl: async () => new Response("unauth", { status: 401 }),
        refreshImpl: async () => {
          throw new Error(
            "Reddit rejected the refresh token (invalid_grant). Run `reddit-cli auth login` to reauthenticate.",
          );
        },
      }),
    ).rejects.toThrow("invalid_grant");
  });

  test("accepts absolute reddit urls as-is", async () => {
    const homeDir = freshHome();
    seedAccount(homeDir);
    let sawUrl = "";
    await redditFetch("https://oauth.reddit.com/r/bun/comments/abc.json", {
      homeDir,
      env: {},
      fetchImpl: async (url) => {
        sawUrl = String(url);
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });
    expect(sawUrl).toBe("https://oauth.reddit.com/r/bun/comments/abc.json");
  });
});
