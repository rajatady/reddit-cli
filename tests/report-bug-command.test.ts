import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseReportBugFlags, ReportBugCommand } from "../src/cli/report-bug-command.ts";
import type { Config } from "../src/lib/config.ts";
import { History } from "../src/lib/history.ts";

const tempDirs: string[] = [];
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-report-bug-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    activeAccountId: "acct_yak",
    clientId: "client-123",
    clientSecret: "secret-123",
    redirectUri: "http://127.0.0.1:9780/callback",
    baseUrl: "https://oauth.reddit.com",
    userAgent: "redditer/test",
    scope: "identity read",
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 1,
    username: "yak",
    redditUserId: "t2_1",
    accounts: [
      {
        id: "acct_yak",
        label: null,
        username: "yak",
        redditUserId: "t2_1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: 1,
        createdAt: 1,
        updatedAt: 1,
        isActive: true,
      } as unknown as Config["accounts"][number],
    ],
    ...overrides,
  } as Config;
}

function freshHistory() {
  return new History(join(freshDir(), "history.db"));
}

describe("parseReportBugFlags", () => {
  test("parses known flags and --last as a positive integer", () => {
    const result = parseReportBugFlags([
      "--title",
      "t",
      "--what",
      "w",
      "--expected",
      "e",
      "--steps",
      "s",
      "--last",
      "3",
    ]);
    expect(result.error).toBeNull();
    expect(result.flags).toEqual({ title: "t", what: "w", expected: "e", steps: "s", last: 3 });
  });

  test("rejects unknown flags, missing values, and bad --last", () => {
    expect(parseReportBugFlags(["--bogus"]).error).toContain("Unknown report-bug flag");
    expect(parseReportBugFlags(["--title"]).error).toContain("--title requires a value");
    expect(parseReportBugFlags(["--last", "abc"]).error).toContain("positive integer");
    expect(parseReportBugFlags(["--last"]).error).toContain("--last requires a number");
    expect(parseReportBugFlags(["--id"]).error).toContain("--id requires a value");
  });
});

describe("ReportBugCommand", () => {
  test("builds a GitHub URL with env table and history and opens browser", () => {
    const history = freshHistory();
    history.insert({
      id: "hist_abc123",
      createdAt: 1_700_000_000_000,
      module: "posts",
      tool: "get-post",
      why: "sensitive free-text reason",
      params: { postUrl: "https://reddit.com/r/x/comments/y/z/" },
      preview: "sensitive response body",
      exitCode: 0,
      durationMs: 42,
      forkedFrom: null,
    });

    const opened: string[] = [];
    const cmd = new ReportBugCommand({
      config: makeConfig(),
      history,
      openBrowser: (url) => opened.push(url),
    });
    const result = cmd.run(["--title", "bug title", "--what", "thing broke"]);
    expect(result.exitCode).toBe(0);
    expect(opened).toHaveLength(1);
    const url = opened[0]!;
    const decoded = decodeURIComponent(url);
    expect(url).toContain("github.com/rajatady/reddit-cli/issues/new");
    expect(url).toContain("title=bug%20title");
    expect(decoded).toContain("thing broke");
    expect(decoded).toContain("redditer version");
    expect(decoded).toContain("hist_abc12");
    expect(decoded).toContain("posts / get-post");
    // Sensitive fields must NOT leak:
    expect(decoded).not.toContain("sensitive free-text reason");
    expect(decoded).not.toContain("sensitive response body");
    expect(decoded).not.toContain("yak"); // username
    expect(decoded).not.toContain("secret-123");
    expect(decoded).not.toContain("client-123");

    const stderr = result.stderrLines.join("\n");
    expect(stderr).toContain("Review the issue form");
    expect(stderr).toContain("If it does not open");
  });

  test("attaches a specific entry with --id", () => {
    const history = freshHistory();
    history.insert({
      id: "hist_pick_me",
      createdAt: 1_700_000_000_000,
      module: "users",
      tool: "whoami-remote",
      why: "w",
      params: {},
      preview: null,
      exitCode: 1,
      durationMs: 7,
      forkedFrom: null,
    });
    history.insert({
      id: "hist_not_me",
      createdAt: 1_700_000_000_001,
      module: "posts",
      tool: "get-post",
      why: "w",
      params: {},
      preview: null,
      exitCode: 0,
      durationMs: 1,
      forkedFrom: null,
    });

    const opened: string[] = [];
    const cmd = new ReportBugCommand({
      config: makeConfig(),
      history,
      openBrowser: (url) => opened.push(url),
    });
    const result = cmd.run(["--id", "hist_pick"]);
    expect(result.exitCode).toBe(0);
    const decoded = decodeURIComponent(opened[0]!);
    expect(decoded).toContain("hist_pick");
    expect(decoded).toContain("users / whoami-remote");
    expect(decoded).toContain("exit 1");
    expect(decoded).not.toContain("hist_not_me");
  });

  test("--id with no match errors", () => {
    const cmd = new ReportBugCommand({ config: makeConfig(), history: freshHistory() });
    const result = cmd.run(["--id", "ghost"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderrLines.join("\n")).toContain('No history entry matching "ghost"');
  });

  test("handles empty history gracefully", () => {
    const opened: string[] = [];
    const cmd = new ReportBugCommand({
      config: makeConfig({ accounts: [] }),
      history: freshHistory(),
      openBrowser: (url) => opened.push(url),
    });
    const result = cmd.run([]);
    expect(result.exitCode).toBe(0);
    expect(decodeURIComponent(opened[0]!)).toContain("no history entries found");
  });

  test("rejects bad flags", () => {
    const cmd = new ReportBugCommand({ config: makeConfig(), history: freshHistory() });
    const result = cmd.run(["--what"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderrLines.join("\n")).toContain("requires a value");
  });
});
