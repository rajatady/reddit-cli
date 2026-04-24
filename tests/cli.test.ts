import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCli } from "../src/cli.ts";
import { configPath } from "../src/lib/config.ts";
import { History } from "../src/lib/history.ts";

const tempDirs: string[] = [];

function freshWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-cli-"));
  tempDirs.push(dir);
  return dir;
}

function writeAccountAwareConfig(
  homeDir: string,
  value: Record<string, unknown>,
) {
  const path = configPath({ homeDir });
  mkdirSync(join(homeDir, ".reddit-cli"), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cli", () => {
  test("lists the registered tools", async () => {
    const result = await runCli(["tools", "list"], {
      cwd: freshWorkspace(),
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("posts get-post");
    expect(result.stdout).toContain("comments get-comments");
    expect(result.stdout).toContain("users whoami-remote");
  });

  test("renders top-level help with no args", async () => {
    const result = await runCli([], {
      cwd: freshWorkspace(),
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("redditer 0.1.2");
    expect(result.stdout).toContain("Modules:");
  });

  test("shows module help when only a module name is provided", async () => {
    const result = await runCli(["auth"], {
      cwd: freshWorkspace(),
      configCwd: freshWorkspace(),
      homeDir: freshWorkspace(),
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing subcommand for module 'auth'");
    expect(result.stdout).toContain("auth login");
    expect(result.stdout).toContain("auth whoami");
    expect(result.stdout).toContain("auth refresh");
  });

  test("shows recovery help for unknown commands", async () => {
    const result = await runCli(["aut"], {
      cwd: freshWorkspace(),
      configCwd: freshWorkspace(),
      homeDir: freshWorkspace(),
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: aut");
    expect(result.stderr).toContain("Did you mean 'auth'?");
    expect(result.stdout).toContain("Usage:");
  });

  test("shows module-specific recovery help for unknown tools", async () => {
    const result = await runCli(["auth", "logn"], {
      cwd: freshWorkspace(),
      configCwd: freshWorkspace(),
      homeDir: freshWorkspace(),
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand 'logn' for module 'auth'");
    expect(result.stderr).toContain("Did you mean 'login'?");
    expect(result.stdout).toContain("auth login");
  });

  test("renders auth login dry-run instructions", async () => {
    const result = await runCli(
      ["auth", "login", "--dry-run"],
      {
        cwd: freshWorkspace(),
        homeDir: freshWorkspace(),
        env: {
          REDDIT_CLI_CLIENT_ID: "client-123",
          REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
        },
        createState: () => "state-123",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AUTH DRY RUN");
    expect(result.stdout).toContain("client_id=client-123");
    expect(result.stdout).toContain("127.0.0.1:9780/callback");
    expect(result.stdout).toContain("userAgent: redditer/0.1.2");
  });

  test("requires client id for auth login", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const result = await runCli(["auth", "login", "--dry-run"], {
      cwd,
      configCwd: cwd,
      homeDir,
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("REDDIT_CLI_CLIENT_ID");
  });

  test("surfaces auth login flag parse failures and authorize errors", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();

    const badFlag = await runCli(["auth", "login", "--wat"], {
      cwd,
      env: {
        REDDIT_CLI_CLIENT_ID: "client-123",
      },
      homeDir,
    });
    expect(badFlag.exitCode).toBe(1);
    expect(badFlag.stderr).toContain("Unknown flag");

    const failedLogin = await runCli(["auth", "login"], {
      cwd,
      env: {
        REDDIT_CLI_CLIENT_ID: "client-123",
      },
      homeDir,
      authorizeWithReddit: async () => {
        throw new Error("browser open failed");
      },
    });
    expect(failedLogin.exitCode).toBe(1);
    expect(failedLogin.stderr).toContain("browser open failed");
  });

  test("shows saved auth identity", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();

    await runCli(["auth", "login"], {
      cwd,
      env: {
        REDDIT_CLI_CLIENT_ID: "client-123",
        REDDIT_CLI_CLIENT_SECRET: "secret-123",
        REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
      },
      homeDir,
      createState: () => "state-live",
      authorizeWithReddit: async () => ({
        authUrl: "https://www.reddit.com/api/v1/authorize?...",
        tokens: {
          accessToken: "access-live",
          refreshToken: "refresh-live",
          scope: "identity read history",
          expiresAt: 1_700_000_000_000,
        },
        identity: {
          name: "consistent_yak",
          id: "user-1",
        },
      }),
    });

    const result = await runCli(["auth", "whoami"], {
      cwd,
      env: {},
      homeDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("consistent_yak");
    expect(result.stdout).toContain("client-123");
    expect(result.stdout).toContain("userAgent: redditer/0.1.2");
    expect(result.stdout).toContain("activeAccountId: acct_consistent_yak");
  });

  test("reads auth config from .env.local and shows all three reddit auth fields", async () => {
    const cwd = freshWorkspace();
    const envRepo = freshWorkspace();
    Bun.write(
      join(envRepo, ".env.local"),
      [
        "REDDIT_CLIENT_ID=repo-client-id",
        "REDDIT_CLIENT_SECRET=repo-secret",
        "REDDIT_REDIRECT_URI=http://localhost:4200/api/connections/reddit/callback",
      ].join("\n"),
    );

    const result = await runCli(["auth", "whoami"], {
      cwd,
      env: {},
      configCwd: envRepo,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("clientId: repo-client-id");
    expect(result.stdout).toContain("clientSecret: <present>");
    expect(result.stdout).toContain(
      "redirectUri: http://localhost:4200/api/connections/reddit/callback",
    );
  });

  test("lists saved accounts and switches the active one", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    writeAccountAwareConfig(homeDir, {
      activeAccountId: "acct_main",
      app: {
        baseUrl: "https://oauth.reddit.com",
        clientId: "client-123",
        clientSecret: "secret-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "redditer/0.1.2",
        scope: "identity read history",
      },
      accounts: {
        acct_main: {
          label: "main",
          username: "consistent_yak",
          redditUserId: "user-1",
          accessToken: "access-main",
          refreshToken: "refresh-main",
          expiresAt: 1_700_000_000_000,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
        acct_alt: {
          label: "alt",
          username: "otter_friend",
          redditUserId: "user-2",
          accessToken: "access-alt",
          refreshToken: "refresh-alt",
          expiresAt: 1_700_000_100_000,
          createdAt: 1_700_000_100_000,
          updatedAt: 1_700_000_100_000,
        },
      },
    });

    const accountsResult = await runCli(["auth", "accounts"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(accountsResult.exitCode).toBe(0);
    expect(accountsResult.stdout).toContain("consistent_yak");
    expect(accountsResult.stdout).toContain("(active)");
    expect(accountsResult.stdout).toContain("otter_friend");

    const useResult = await runCli(["auth", "use", "--account", "otter_friend"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(useResult.exitCode).toBe(0);
    expect(useResult.stdout).toContain("Active account set to otter_friend");

    const whoamiResult = await runCli(["auth", "whoami"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(whoamiResult.exitCode).toBe(0);
    expect(whoamiResult.stdout).toContain("username: otter_friend");
    expect(whoamiResult.stdout).toContain("activeAccountId: acct_alt");
  });

  test("refreshes the active account tokens and supports dry-run", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    writeAccountAwareConfig(homeDir, {
      activeAccountId: "acct_main",
      app: {
        baseUrl: "https://oauth.reddit.com",
        clientId: "client-123",
        clientSecret: "secret-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "redditer/0.1.2",
        scope: "identity read history",
      },
      accounts: {
        acct_main: {
          label: "main",
          username: "consistent_yak",
          redditUserId: "user-1",
          accessToken: "access-main",
          refreshToken: "refresh-main",
          expiresAt: 1_700_000_000_000,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      },
    });

    const dryRunResult = await runCli(["auth", "refresh", "--dry-run"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(dryRunResult.exitCode).toBe(0);
    expect(dryRunResult.stdout).toContain("AUTH REFRESH DRY RUN");
    expect(dryRunResult.stdout).toContain("consistent_yak");

    const refreshResult = await runCli(["auth", "refresh"], {
      cwd,
      env: {},
      homeDir,
      refreshAccessToken: async () => ({
        accessToken: "access-new",
        refreshToken: "refresh-main",
        scope: "identity read history",
        expiresAt: 1_700_000_900_000,
      }),
    });
    expect(refreshResult.exitCode).toBe(0);
    expect(refreshResult.stdout).toContain("Refreshed Reddit access token");

    const whoamiResult = await runCli(["auth", "whoami"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(whoamiResult.stdout).toContain("expiresAt: 1700000900000");
    expect(whoamiResult.stdout).toContain("refreshToken: <present>");
  });

  test("logs out the active account locally", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    writeAccountAwareConfig(homeDir, {
      activeAccountId: "acct_main",
      app: {
        baseUrl: "https://oauth.reddit.com",
        clientId: "client-123",
        clientSecret: "secret-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "redditer/0.1.2",
        scope: "identity read history",
      },
      accounts: {
        acct_main: {
          label: "main",
          username: "consistent_yak",
          redditUserId: "user-1",
          accessToken: "access-main",
          refreshToken: "refresh-main",
          expiresAt: 1_700_000_000_000,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      },
    });

    const result = await runCli(["auth", "logout"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Logged out account consistent_yak");

    const accountsResult = await runCli(["auth", "accounts"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(accountsResult.exitCode).toBe(0);
    expect(accountsResult.stdout).toContain("No saved Reddit accounts.");
  });

  test("handles auth refresh and auth use validation failures", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();

    const refreshResult = await runCli(["auth", "refresh"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(refreshResult.exitCode).toBe(1);
    expect(refreshResult.stderr).toContain("No active Reddit account");

    const useMissing = await runCli(["auth", "use"], {
      cwd,
      env: {},
      homeDir,
    });
    expect(useMissing.exitCode).toBe(1);
    expect(useMissing.stderr).toContain("Missing required flag: --account");
  });

  test("creates a dry-run request for a reddit post and records history", async () => {
    const cwd = freshWorkspace();
    const result = await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--why",
        "inspect the post growth plan",
        "--dry-run",
      ],
      {
        cwd,
        env: {},
        now: () => 1_700_000_000_000,
        createId: () => "hist_abc12345",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DRY RUN");
    expect(result.stdout).toContain("/comments/abc123/.json");

    const history = new History(join(cwd, ".reddit-cli/history.db"));
    expect(history.count()).toBe(1);
    expect(history.get("hist_abc1")?.tool).toBe("get-post");
  });

  test("supports history list output", async () => {
    const cwd = freshWorkspace();
    await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--why",
        "store history list coverage",
        "--dry-run",
      ],
      {
        cwd,
        env: {},
        createId: () => "hist_listed",
      },
    );

    const result = await runCli(["history"], { cwd, env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("posts get-post");
    expect(result.stdout).toContain("hist_liste");
  });

  test("requires why for tool execution", async () => {
    const result = await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
      ],
      {
        cwd: freshWorkspace(),
        env: {},
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--why is required");
  });

  test("live posts get-post fails gracefully when no account is active", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const result = await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--why",
        "no account path",
      ],
      {
        cwd,
        homeDir,
        env: {},
        createId: () => "hist_live",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No active Reddit account");
  });

  test("shows a stored history entry by prefix", async () => {
    const cwd = freshWorkspace();
    await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--why",
        "store one entry",
        "--dry-run",
      ],
      {
        cwd,
        env: {},
        createId: () => "hist_showcase",
      },
    );

    const result = await runCli(["history", "show", "hist_sho"], {
      cwd,
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("\"tool\": \"get-post\"");
    expect(result.stdout).toContain("\"why\": \"store one entry\"");
  });

  test("handles unknown commands and bad history subcommands", async () => {
    const unknownCommand = await runCli(["unknown", "thing"], {
      cwd: freshWorkspace(),
      env: {},
    });
    expect(unknownCommand.exitCode).toBe(1);
    expect(unknownCommand.stderr).toContain("Unknown command");

    const badHistory = await runCli(["history", "oops"], {
      cwd: freshWorkspace(),
      env: {},
    });
    expect(badHistory.exitCode).toBe(1);
    expect(badHistory.stderr).toContain("Unknown history subcommand");
  });

  test("handles history show validation failures", async () => {
    const cwd = freshWorkspace();
    const missingId = await runCli(["history", "show"], {
      cwd,
      env: {},
    });
    expect(missingId.exitCode).toBe(1);
    expect(missingId.stderr).toContain("requires an id");

    const noMatch = await runCli(["history", "show", "missing"], {
      cwd,
      env: {},
    });
    expect(noMatch.exitCode).toBe(1);
    expect(noMatch.stderr).toContain("No history entry matching");
  });

  test("rejects unexpected args, unknown flags, missing required flags, and bad numbers", async () => {
    const cwd = freshWorkspace();

    const unexpected = await runCli(["posts", "get-post", "oops"], {
      cwd,
      env: {},
    });
    expect(unexpected.exitCode).toBe(1);
    expect(unexpected.stderr).toContain("Unexpected argument");

    const unknownFlag = await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--wat",
        "nope",
        "--why",
        "exercise unknown flag handling",
      ],
      { cwd, env: {} },
    );
    expect(unknownFlag.exitCode).toBe(1);
    expect(unknownFlag.stderr).toContain("Unknown flag");

    const missingRequired = await runCli(
      ["posts", "get-post", "--why", "exercise required flag handling", "--dry-run"],
      { cwd, env: {} },
    );
    expect(missingRequired.exitCode).toBe(1);
    expect(missingRequired.stderr).toContain("Missing required flag");

    const badNumber = await runCli(
      [
        "subreddits",
        "list-posts",
        "--subreddit",
        "typescript",
        "--limit",
        "abc",
        "--why",
        "exercise number parsing",
      ],
      { cwd, env: {} },
    );
    expect(badNumber.exitCode).toBe(1);
    expect(badNumber.stderr).toContain("Expected a number");
  });

  test("prints the reddit auth url before waiting for the callback", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const streamed: string[] = [];
    let seenDuringAuthorize: string[] = [];

    const result = await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env: {
        REDDIT_CLI_CLIENT_ID: "client-123",
        REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
      },
      createState: () => "state-abc",
      printLine: (line) => streamed.push(line),
      authorizeWithReddit: async () => {
        seenDuringAuthorize = [...streamed];
        return {
          authUrl: "https://www.reddit.com/api/v1/authorize?state=state-abc",
          tokens: {
            accessToken: "a",
            refreshToken: "r",
            scope: "identity",
            expiresAt: 1,
          },
          identity: { name: "yak", id: "user-1" },
        };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(seenDuringAuthorize.some((line) => line.includes("state=state-abc"))).toBe(true);
    expect(result.stdout).toContain("If it doesn't open, visit");
    expect(result.stdout).toContain("state=state-abc");
  });

  test("surfaces authorize errors (denied, state mismatch, timeout) verbatim", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "client-123",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };

    const denied = await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => {
        throw new Error("Reddit authorization failed: access_denied");
      },
    });
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain("access_denied");

    const mismatch = await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => {
        throw new Error("OAuth state mismatch. Please try login again.");
      },
    });
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.stderr).toContain("state mismatch");

    const timedOut = await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => {
        throw new Error("OAuth login timed out waiting for the Reddit callback.");
      },
    });
    expect(timedOut.exitCode).toBe(1);
    expect(timedOut.stderr).toContain("timed out");
  });

  test("logging in as a second user adds a new account and switches active", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "client-123",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };

    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "https://example.invalid/u1",
        tokens: { accessToken: "a1", refreshToken: "r1", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "https://example.invalid/u2",
        tokens: { accessToken: "a2", refreshToken: "r2", scope: "identity", expiresAt: 2 },
        identity: { name: "otter", id: "user-2" },
      }),
    });

    const accounts = await runCli(["auth", "accounts"], { cwd, homeDir, env: {} });
    expect(accounts.stdout).toContain("yak");
    expect(accounts.stdout).toContain("otter");
    expect(accounts.stdout).toMatch(/otter[^\n]*\(active\)/);

    const whoami = await runCli(["auth", "whoami"], { cwd, homeDir, env: {} });
    expect(whoami.stdout).toContain("username: otter");
  });

  test("auth refresh surfaces invalid_grant guidance", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "client-123",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };

    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const result = await runCli(["auth", "refresh"], {
      cwd,
      homeDir,
      env: {},
      refreshAccessToken: async () => {
        throw new Error(
          "Reddit rejected the refresh token (invalid_grant). Run `redditer auth login` to reauthenticate.",
        );
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("redditer auth login");
  });

  test("auth refresh persists a rotated refresh token", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "client-123",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };

    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a-old", refreshToken: "r-old", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const refreshed = await runCli(["auth", "refresh"], {
      cwd,
      homeDir,
      env: {},
      refreshAccessToken: async () => ({
        accessToken: "a-new",
        refreshToken: "r-new",
        scope: "identity",
        expiresAt: 2,
      }),
    });
    expect(refreshed.exitCode).toBe(0);

    const second = await runCli(["auth", "refresh"], {
      cwd,
      homeDir,
      env: {},
      refreshAccessToken: async ({ refreshToken }) => {
        if (refreshToken !== "r-new") throw new Error("expected rotated refresh token");
        return {
          accessToken: "a-newer",
          refreshToken: "r-newer",
          scope: "identity",
          expiresAt: 3,
        };
      },
    });
    expect(second.exitCode).toBe(0);
  });

  test("live users whoami-remote normalizes the profile response", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "client-123",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const result = await runCli(
      ["users", "whoami-remote", "--why", "verify live path", "--out", "-"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              id: "t2_x",
              name: "yak",
              created_utc: 1,
              link_karma: 42,
              comment_karma: 7,
            }),
            { status: 200 },
          ),
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.name).toBe("yak");
    expect(parsed.linkKarma).toBe(42);
  });

  test("live posts get-post returns a normalized post", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "client-123",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const result = await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--why",
        "live normalize",
        "--out",
        "-",
      ],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () =>
          new Response(
            JSON.stringify([
              {
                data: {
                  children: [
                    {
                      kind: "t3",
                      data: {
                        id: "abc123",
                        title: "Hello",
                        author: "op",
                        score: 10,
                        upvote_ratio: 0.9,
                        num_comments: 2,
                      },
                    },
                  ],
                },
              },
              { data: { children: [] } },
            ]),
            { status: 200 },
          ),
      },
    );
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout) as { post: { id: string; score: number } };
    expect(data.post.id).toBe("abc123");
    expect(data.post.score).toBe(10);
  });

  test("live subreddits list-posts normalizes and records history preview", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const result = await runCli(
      [
        "subreddits",
        "list-posts",
        "--subreddit",
        "typescript",
        "--sort",
        "hot",
        "--limit",
        "2",
        "--why",
        "live listing",
        "--out",
        "-",
      ],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              data: {
                after: "t3_next",
                children: [{ kind: "t3", data: { id: "p1", title: "T" } }],
              },
            }),
            { status: 200 },
          ),
      },
    );
    expect(result.exitCode).toBe(0);
    const listing = JSON.parse(result.stdout) as { posts: unknown[]; after: string };
    expect(listing.after).toBe("t3_next");
    expect(listing.posts).toHaveLength(1);
  });

  test("live tool failure surfaces error and records exit 1", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: null, scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const failed = await runCli(
      ["users", "whoami-remote", "--why", "forced failure"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () => new Response("unauth", { status: 401 }),
      },
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("auth login");
  });

  test("history list filters and json output", async () => {
    const cwd = freshWorkspace();
    await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc/x/",
        "--why",
        "one",
        "--dry-run",
      ],
      { cwd, env: {}, createId: () => "hist_aaaaaaaa" },
    );
    await runCli(
      [
        "subreddits",
        "list-posts",
        "--subreddit",
        "bun",
        "--why",
        "two",
        "--dry-run",
      ],
      { cwd, env: {}, createId: () => "hist_bbbbbbbb" },
    );

    const list = await runCli(["history", "list"], { cwd, env: {} });
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("posts get-post");
    expect(list.stdout).toContain("subreddits list-posts");

    const filtered = await runCli(["history", "list", "--module", "posts"], { cwd, env: {} });
    expect(filtered.stdout).toContain("posts get-post");
    expect(filtered.stdout).not.toContain("subreddits list-posts");

    const json = await runCli(["history", "list", "--json", "--limit", "1"], { cwd, env: {} });
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);

    const empty = await runCli(["history", "list", "--tool", "nonexistent"], { cwd, env: {} });
    expect(empty.stdout).toContain("no history yet");

    const badFlag = await runCli(["history", "list", "--limit", "abc"], { cwd, env: {} });
    expect(badFlag.exitCode).toBe(1);
    expect(badFlag.stderr).toContain("expected a number");

    const unknown = await runCli(["history", "list", "--bogus"], { cwd, env: {} });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Unknown history list flag");
  });

  test("history rerun replays a past dry-run entry and marks forkedFrom", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc/x/",
        "--why",
        "seed rerun",
        "--dry-run",
      ],
      { cwd, homeDir, env: {}, createId: () => "hist_orig1234" },
    );

    let idx = 0;
    const rerun = await runCli(["history", "rerun", "hist_orig"], {
      cwd,
      homeDir,
      env: {},
      createId: () => `hist_rerun${idx++}`,
    });
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout).toContain("DRY RUN");

    const listJson = await runCli(["history", "list", "--json"], { cwd, homeDir, env: {} });
    const rows = JSON.parse(listJson.stdout) as Array<{ id: string; forkedFrom: string | null; params: Record<string, unknown> }>;
    const forkEntry = rows.find((r) => r.forkedFrom !== null);
    expect(forkEntry?.forkedFrom).toBe("hist_orig1234");
    expect(forkEntry?.params.dryRun).toBe(true);
  });

  test("history fork applies --set overrides and records them", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    await runCli(
      [
        "subreddits",
        "list-posts",
        "--subreddit",
        "bun",
        "--sort",
        "hot",
        "--limit",
        "10",
        "--why",
        "seed fork",
        "--dry-run",
      ],
      { cwd, homeDir, env: {}, createId: () => "hist_forksrc" },
    );

    const fork = await runCli(
      ["history", "fork", "hist_forksrc", "--set", "limit=50"],
      { cwd, homeDir, env: {}, createId: () => "hist_forkdst" },
    );
    expect(fork.exitCode).toBe(0);

    const listJson = await runCli(["history", "list", "--json"], { cwd, homeDir, env: {} });
    const rows = JSON.parse(listJson.stdout) as Array<{ id: string; forkedFrom: string | null; params: Record<string, unknown> }>;
    const forked = rows.find((r) => r.forkedFrom === "hist_forksrc");
    expect(forked?.params.limit).toBe(50);

    const badFork = await runCli(["history", "fork", "hist_forksrc", "--set", "bogus"], {
      cwd,
      homeDir,
      env: {},
    });
    expect(badFork.exitCode).toBe(1);
    expect(badFork.stderr).toContain("--set requires key=value");

    const badArg = await runCli(["history", "fork", "hist_forksrc", "limit=50"], {
      cwd,
      homeDir,
      env: {},
    });
    expect(badArg.exitCode).toBe(1);
    expect(badArg.stderr).toContain("Unexpected argument");
  });

  test("history rerun and fork validate id requirements", async () => {
    const cwd = freshWorkspace();
    const noId = await runCli(["history", "rerun"], { cwd, env: {} });
    expect(noId.stderr).toContain("requires an id");

    const noMatch = await runCli(["history", "fork", "missing"], { cwd, env: {} });
    expect(noMatch.stderr).toContain("No history entry matching");

    const noForkId = await runCli(["history", "fork"], { cwd, env: {} });
    expect(noForkId.stderr).toContain("requires an id");
  });

  test("monitors create, list, show, tick, stop lifecycle", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    let wallClock = 1_700_000_000_000;
    const baseOpts = {
      cwd,
      homeDir,
      env: {},
      now: () => wallClock,
    };

    const created = await runCli(
      [
        "monitors",
        "create",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc/x/",
        "--interval-minutes",
        "15",
        "--id",
        "mon_test1",
        "--why",
        "track growth",
      ],
      baseOpts,
    );
    expect(created.exitCode).toBe(0);
    expect(created.stdout).toContain("mon_test1");

    const list = await runCli(["monitors", "list"], baseOpts);
    expect(list.stdout).toContain("mon_test1");
    expect(list.stdout).toContain("active");

    let postScore = 10;
    let postComments = 2;
    const postResponse = () =>
      new Response(
        JSON.stringify([
          {
            data: {
              children: [
                {
                  kind: "t3",
                  data: {
                    id: "abc",
                    subreddit: "bun",
                    score: postScore,
                    upvote_ratio: 0.9,
                    num_comments: postComments,
                  },
                },
              ],
            },
          },
          { data: { children: [] } },
        ]),
        { status: 200 },
      );

    const tick1 = await runCli(
      ["monitors", "tick", "--why", "first tick"],
      { ...baseOpts, fetchImpl: async () => postResponse() },
    );
    expect(tick1.exitCode).toBe(0);
    expect(tick1.stdout).toContain("mon_test1");
    expect(tick1.stdout).toContain("score:10");

    wallClock += 20 * 60 * 1000;
    postScore = 25;
    postComments = 5;
    const tick2 = await runCli(
      ["monitors", "tick", "--job", "mon_test1", "--why", "second tick"],
      { ...baseOpts, fetchImpl: async () => postResponse() },
    );
    expect(tick2.exitCode).toBe(0);
    expect(tick2.stdout).toContain("Δ+15");
    expect(tick2.stdout).toContain("Δ+3");

    const show = await runCli(["monitors", "show", "mon_test1"], baseOpts);
    const shown = JSON.parse(show.stdout) as { job: { id: string }; snapshots: unknown[] };
    expect(shown.job.id).toBe("mon_test1");
    expect(shown.snapshots).toHaveLength(2);

    const tickNoDue = await runCli(
      ["monitors", "tick", "--why", "nothing due"],
      { ...baseOpts, fetchImpl: async () => postResponse() },
    );
    expect(tickNoDue.stdout).toContain("no monitor jobs due");

    const stop = await runCli(
      ["monitors", "stop", "mon_test1", "--why", "done watching"],
      baseOpts,
    );
    expect(stop.exitCode).toBe(0);
    expect(stop.stdout).toContain("Stopped monitor");

    const listAfter = await runCli(["monitors", "list"], baseOpts);
    expect(listAfter.stdout).toContain("stopped");
  });

  test("monitors tick handles fetch errors per job", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: null, scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    await runCli(
      [
        "monitors",
        "create",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc/x/",
        "--id",
        "mon_err",
        "--why",
        "create for error path",
      ],
      { cwd, homeDir, env: {} },
    );

    const tickErr = await runCli(
      ["monitors", "tick", "--job", "mon_err", "--why", "expect failure"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () => new Response("boom", { status: 500 }),
      },
    );
    expect(tickErr.exitCode).toBe(1);
    expect(tickErr.stdout).toContain("error:");

    const tickMissingPost = await runCli(
      ["monitors", "tick", "--job", "mon_err", "--why", "missing post"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () =>
          new Response(JSON.stringify([{ data: { children: [] } }, { data: { children: [] } }]), {
            status: 200,
          }),
      },
    );
    expect(tickMissingPost.exitCode).toBe(1);
    expect(tickMissingPost.stdout).toContain("post not found");
  });

  test("monitors CLI validation errors", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const empty = { cwd, homeDir, env: {} };

    expect((await runCli(["monitors"], empty)).stderr).toContain("Missing monitors subcommand");
    expect((await runCli(["monitors", "list"], empty)).stdout).toContain("(no monitor jobs)");
    expect((await runCli(["monitors", "bogus"], empty)).stderr).toContain("Unknown monitors subcommand");
    expect((await runCli(["monitors", "show"], empty)).stderr).toContain("requires an id");
    expect((await runCli(["monitors", "show", "ghost"], empty)).stderr).toContain("No monitor job matching");
    expect((await runCli(["monitors", "stop"], empty)).stderr).toContain("monitors stop requires an id");
    expect(
      (await runCli(["monitors", "stop", "ghost", "--why", "x"], empty)).stderr,
    ).toContain("No monitor job matching");
    expect(
      (await runCli(["monitors", "create", "--why", "w"], empty)).stderr,
    ).toContain("Missing required flag: --post-url");
    expect(
      (await runCli(
        ["monitors", "create", "--post-url", "https://reddit.com/r/x/comments/y/z/"],
        empty,
      )).stderr,
    ).toContain("Missing required flag: --why");
    expect(
      (await runCli(
        [
          "monitors",
          "create",
          "--post-url",
          "https://reddit.com/r/x/comments/y/z/",
          "--interval-minutes",
          "abc",
          "--why",
          "w",
        ],
        empty,
      )).stderr,
    ).toContain("expected a number");
    expect(
      (await runCli(
        ["monitors", "create", "--bogus", "x", "--why", "w"],
        empty,
      )).stderr,
    ).toContain("Unknown monitors create flag");
    expect((await runCli(["monitors", "tick"], empty)).stderr).toContain("Missing required flag: --why");
    expect((await runCli(["monitors", "tick", "--bogus", "x"], empty)).stderr).toContain("Unknown monitors tick flag");
    expect(
      (await runCli(["monitors", "stop", "--bogus", "x"], empty)).stderr,
    ).toContain("Unknown monitors stop flag");
  });

  test("dumps live responses to a file by default with a summary", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const outDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const result = await runCli(
      [
        "comments",
        "get-comments",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc123/example_post/",
        "--why",
        "read thread",
      ],
      {
        cwd,
        homeDir,
        env: { REDDIT_CLI_OUT_DIR: outDir },
        fetchImpl: async () =>
          new Response(
            JSON.stringify([
              { data: { children: [{ kind: "t3", data: { id: "abc123", title: "T", author: "op", score: 5, num_comments: 1 } }] } },
              { data: { children: [{ kind: "t1", data: { id: "c1", body: "hi", author: "u1" } }] } },
            ]),
            { status: 200 },
          ),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/wrote .+thread-bun-abc123\.json \(\d+ bytes\)/);
    expect(result.stdout).toContain("comments: 1 top-level");
    const expectedPath = join(outDir, "thread-bun-abc123.json");
    const { readFileSync } = await import("node:fs");
    const parsed = JSON.parse(readFileSync(expectedPath, "utf8")) as { post: { id: string }; comments: unknown[] };
    expect(parsed.post.id).toBe("abc123");
    expect(parsed.comments).toHaveLength(1);
  });

  test("--out <path> writes to the explicit path", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const outFile = join(freshWorkspace(), "explicit.json");
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    const result = await runCli(
      ["users", "whoami-remote", "--why", "test explicit out", "--out", outFile],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ id: "t2", name: "yak", link_karma: 1, comment_karma: 1 }),
            { status: 200 },
          ),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`wrote ${outFile}`);
    const { readFileSync } = await import("node:fs");
    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as Record<string, unknown>;
    expect(parsed.name).toBe("yak");
  });

  test("--out requires a value", async () => {
    const cwd = freshWorkspace();
    const result = await runCli(
      ["users", "whoami-remote", "--why", "nope", "--out"],
      { cwd, env: {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--out requires a path");
  });

  test("live users my-submissions defaults to the active account username", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    let seenUrl = "";
    const result = await runCli(
      ["users", "my-submissions", "--limit", "2", "--why", "mine", "--out", "-"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async (url) => {
          seenUrl = String(url);
          return new Response(
            JSON.stringify({
              data: {
                after: null,
                children: [
                  { kind: "t3", data: { id: "p1", title: "A", subreddit: "bun", score: 3, num_comments: 1 } },
                  { kind: "t3", data: { id: "p2", title: "B", subreddit: "bun", score: 5, num_comments: 7 } },
                ],
              },
            }),
            { status: 200 },
          );
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(seenUrl).toContain("/user/yak/submitted.json");
    const parsed = JSON.parse(result.stdout) as { posts: Array<{ id: string }> };
    expect(parsed.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  test("my-submissions errors clearly when no username and no active account", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const result = await runCli(
      ["users", "my-submissions", "--why", "no account"],
      { cwd, homeDir, env: {} },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("needs --username or an active account");
  });

  test("per-tool --help renders the option schema with required fields, enums, and an example", async () => {
    const cwd = freshWorkspace();
    const result = await runCli(["comments", "get-comments", "--help"], { cwd, env: {} });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("redditer comments get-comments");
    expect(result.stdout).toContain("Required:");
    expect(result.stdout).toContain("--post-url <string>");
    expect(result.stdout).toContain("--out <path>");
    expect(result.stdout).toContain("Example:");

    const noOpts = await runCli(["users", "whoami-remote", "--help"], { cwd, env: {} });
    expect(noOpts.stdout).toContain("Usage:");
    expect(noOpts.stdout).toContain("--why <text>");
    expect(noOpts.stdout).toContain("Example:");

    const withDefault = await runCli(["subreddits", "list-posts", "--help"], { cwd, env: {} });
    expect(withDefault.stdout).toContain("--sort <hot|new|top|rising|controversial>");
    expect(withDefault.stdout).toContain("--time <all|year|month|week|day|hour>");
    expect(withDefault.stdout).toContain("[default: hot]");
  });

  test("live users list-comments returns normalized t1 comments", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    let seenUrl = "";
    const result = await runCli(
      ["users", "list-comments", "--limit", "3", "--why", "pull my comments", "--out", "-"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async (url) => {
          seenUrl = String(url);
          return new Response(
            JSON.stringify({
              data: {
                after: null,
                children: [
                  {
                    kind: "t1",
                    data: {
                      id: "c1",
                      author: "yak",
                      body: "first comment",
                      score: 3,
                      subreddit: "bun",
                      link_title: "Post A",
                      link_id: "t3_a",
                    },
                  },
                  {
                    kind: "t1",
                    data: {
                      id: "c2",
                      author: "yak",
                      body: "second",
                      score: 1,
                      subreddit: "typescript",
                      link_title: "Post B",
                      link_id: "t3_b",
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(seenUrl).toContain("/user/yak/comments.json");
    const parsed = JSON.parse(result.stdout) as { comments: Array<{ id: string; linkTitle: string }> };
    expect(parsed.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(parsed.comments[0]!.linkTitle).toBe("Post A");
  });

  test("live search posts hits /search.json with encoded query", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    let seenUrl = "";
    const result = await runCli(
      [
        "search",
        "posts",
        "--query",
        "co founder",
        "--subreddit",
        "startups",
        "--limit",
        "2",
        "--why",
        "find operator threads",
        "--out",
        "-",
      ],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async (url) => {
          seenUrl = String(url);
          return new Response(
            JSON.stringify({
              data: {
                after: null,
                children: [
                  { kind: "t3", data: { id: "p1", title: "Looking for cofounder", subreddit: "startups" } },
                ],
              },
            }),
            { status: 200 },
          );
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(seenUrl).toContain("/r/startups/search.json");
    expect(seenUrl).toContain("type=link");
    expect(seenUrl).toContain("q=co%20founder");
    expect(seenUrl).toContain("restrict_sr=on");
    const parsed = JSON.parse(result.stdout) as { posts: Array<{ id: string }> };
    expect(parsed.posts.map((p) => p.id)).toEqual(["p1"]);
  });

  test("live search comments hits /search.json with type=comment", async () => {
    const cwd = freshWorkspace();
    const homeDir = freshWorkspace();
    const env = {
      REDDIT_CLI_CLIENT_ID: "c",
      REDDIT_CLI_REDIRECT_URI: "http://127.0.0.1:9780/callback",
    };
    await runCli(["auth", "login"], {
      cwd,
      homeDir,
      env,
      authorizeWithReddit: async () => ({
        authUrl: "x",
        tokens: { accessToken: "a", refreshToken: "r", scope: "identity", expiresAt: 1 },
        identity: { name: "yak", id: "user-1" },
      }),
    });

    let seenUrl = "";
    const result = await runCli(
      ["search", "comments", "--query", "tenancy", "--limit", "5", "--why", "walk comments", "--out", "-"],
      {
        cwd,
        homeDir,
        env: {},
        fetchImpl: async (url) => {
          seenUrl = String(url);
          return new Response(
            JSON.stringify({
              data: {
                after: null,
                children: [
                  {
                    kind: "t1",
                    data: { id: "c1", author: "anon", body: "tenancy thing", subreddit: "rent" },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(seenUrl).toContain("/search.json");
    expect(seenUrl).toContain("type=comment");
    expect(seenUrl).not.toContain("restrict_sr=on");
    const parsed = JSON.parse(result.stdout) as { comments: Array<{ id: string }> };
    expect(parsed.comments[0]!.id).toBe("c1");
  });

  test("report-bug opens a pre-filled GitHub issue with sanitised context", async () => {
    const cwd = freshWorkspace();
    await runCli(
      [
        "posts",
        "get-post",
        "--post-url",
        "https://www.reddit.com/r/bun/comments/abc/x/",
        "--why",
        "secret reason",
        "--dry-run",
      ],
      { cwd, env: {}, createId: () => "hist_bugreport" },
    );

    const opened: string[] = [];
    const result = await runCli(["report-bug", "--title", "broken", "--what", "it died"], {
      cwd,
      env: {},
      openBrowser: (url) => opened.push(url),
    });
    expect(result.exitCode).toBe(0);
    expect(opened).toHaveLength(1);
    const decoded = decodeURIComponent(opened[0]!);
    expect(decoded).toContain("redditer version");
    expect(decoded).toContain("hist_bugre");
    expect(decoded).toContain("posts / get-post");
    expect(decoded).not.toContain("secret reason");
  });

  test("report-bug surfaces flag errors", async () => {
    const badFlag = await runCli(["report-bug", "--nope"], {
      cwd: freshWorkspace(),
      env: {},
    });
    expect(badFlag.exitCode).toBe(1);
    expect(badFlag.stderr).toContain("Unknown report-bug flag");
  });

  test("supports subreddit listing dry-runs and help flag", async () => {
    const listResult = await runCli(
      [
        "subreddits",
        "list-posts",
        "--subreddit",
        "r/typescript",
        "--sort",
        "top",
        "--limit",
        "5",
        "--why",
        "inspect listing shape",
        "--dry-run",
      ],
      {
        cwd: freshWorkspace(),
        env: {},
      },
    );
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("/r/typescript/top.json");

    const helpResult = await runCli(["--help"], {
      cwd: freshWorkspace(),
      env: {},
    });
    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain("Usage:");
  });
});
