import { describe, expect, test } from "bun:test";

import {
  buildArgvFromEntry,
  parseHistoryListFlags,
  parseSetOverrides,
} from "../src/cli/history-command.ts";

describe("cli/history-command parsers", () => {
  test("parseHistoryListFlags defaults and flag handling", () => {
    expect(parseHistoryListFlags([])).toEqual({ limit: 25, offset: 0, json: false });
    expect(parseHistoryListFlags(["--json"]).json).toBe(true);
    expect(parseHistoryListFlags(["--limit", "10"]).limit).toBe(10);
    expect(parseHistoryListFlags(["--offset", "5"]).offset).toBe(5);
    expect(parseHistoryListFlags(["--module", "posts"]).module).toBe("posts");
    expect(parseHistoryListFlags(["--tool", "get-post"]).tool).toBe("get-post");
  });

  test("parseHistoryListFlags error paths", () => {
    expect(parseHistoryListFlags(["--limit", "abc"]).error).toContain("expected a number");
    expect(parseHistoryListFlags(["--offset", "xyz"]).error).toContain("expected a number");
    expect(parseHistoryListFlags(["--bogus"]).error).toContain("Unknown history list flag");
  });

  test("parseSetOverrides accepts key=value pairs", () => {
    expect(parseSetOverrides(["--set", "limit=50"])).toEqual({
      values: { limit: "50" },
    });
    expect(parseSetOverrides(["--set", "a=1", "--set", "b=2"])).toEqual({
      values: { a: "1", b: "2" },
    });
  });

  test("parseSetOverrides rejects malformed pairs", () => {
    expect(parseSetOverrides(["--set", "nope"]).error).toContain("key=value");
    expect(parseSetOverrides(["limit=50"]).error).toContain("Unexpected argument");
  });

  test("buildArgvFromEntry reconstructs the original command", () => {
    const argv = buildArgvFromEntry(
      { module: "posts", tool: "get-post", why: "w" },
      { postUrl: "https://example.com", dryRun: true },
    );
    expect(argv).toEqual([
      "posts",
      "get-post",
      "--post-url",
      "https://example.com",
      "--dry-run",
      "--why",
      "w",
    ]);
  });

  test("buildArgvFromEntry skips null/undefined params", () => {
    const argv = buildArgvFromEntry(
      { module: "posts", tool: "get-post", why: "w" },
      { postUrl: "x", limit: null as unknown as string, other: undefined },
    );
    expect(argv).toEqual(["posts", "get-post", "--post-url", "x", "--why", "w"]);
  });
});
