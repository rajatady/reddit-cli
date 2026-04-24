import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { formatRelativeTime, History, resolveHistoryPath } from "../src/lib/history.ts";

const tempDirs: string[] = [];

function freshHistoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-history-"));
  tempDirs.push(dir);
  return join(dir, "history.db");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const baseEntry = {
  createdAt: 1_700_000_000_000,
  module: "posts",
  tool: "get-post",
  why: "inspect a target thread",
  params: { postUrl: "https://www.reddit.com/r/test/comments/abc123/demo/" },
  preview: "{\"kind\":\"request\"}",
  exitCode: 0,
  durationMs: 14,
  forkedFrom: null,
};

describe("history", () => {
  test("round-trips insert, list, and get", () => {
    const history = new History(freshHistoryPath());
    history.insert({ id: "hist_001", ...baseEntry });

    expect(history.count()).toBe(1);
    expect(history.list()[0]?.tool).toBe("get-post");
    expect(history.get("hist_001")?.why).toBe("inspect a target thread");
    expect(history.get("hist_")?.id).toBe("hist_001");
  });

  test("list filters by module, tool, limit, and offset", () => {
    const history = new History(freshHistoryPath());
    history.insert({ ...baseEntry, id: "a", tool: "get-post", createdAt: 1 });
    history.insert({ ...baseEntry, id: "b", tool: "list-posts", module: "subreddits", createdAt: 2 });
    history.insert({ ...baseEntry, id: "c", tool: "get-post", createdAt: 3 });

    expect(history.list({ module: "posts" }).map((r) => r.id)).toEqual(["c", "a"]);
    expect(history.list({ tool: "list-posts" }).map((r) => r.id)).toEqual(["b"]);
    expect(history.list({ limit: 1 }).map((r) => r.id)).toEqual(["c"]);
    expect(history.list({ limit: 1, offset: 1 }).map((r) => r.id)).toEqual(["b"]);
  });

  test("persists forkedFrom lineage", () => {
    const history = new History(freshHistoryPath());
    history.insert({ ...baseEntry, id: "orig" });
    history.insert({ ...baseEntry, id: "fork", forkedFrom: "orig" });
    expect(history.get("fork")?.forkedFrom).toBe("orig");
    expect(history.get("orig")?.forkedFrom).toBeNull();
  });

  test("formatRelativeTime produces human-readable spans", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe("5s ago");
    expect(formatRelativeTime(now - 90_000, now)).toBe("1m ago");
    expect(formatRelativeTime(now - 3_600_000, now)).toBe("1h ago");
    expect(formatRelativeTime(now - 86_400_000 * 2, now)).toBe("2d ago");
    expect(formatRelativeTime(now - 86_400_000 * 60, now)).toBe("2mo ago");
    expect(formatRelativeTime(now - 86_400_000 * 400, now)).toBe("1y ago");
    expect(formatRelativeTime(now + 1000, now)).toBe("0s ago");
  });

  test("migrates a pre-forkedFrom database in place", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reddit-cli-hist-migrate-"));
    tempDirs.push(dir);
    const path = join(dir, "history.db");
    const { Database } = await import("bun:sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        module_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        why TEXT NOT NULL,
        params_json TEXT NOT NULL,
        preview TEXT,
        exit_code INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL
      );`);
    legacy.query(
      `INSERT INTO entries (id, created_at, module_name, tool_name, why, params_json, preview, exit_code, duration_ms)
       VALUES ('legacy', 1, 'posts', 'get-post', 'w', '{}', null, 0, 0)`,
    ).run();
    legacy.close();

    const history = new History(path);
    expect(history.get("legacy")?.forkedFrom).toBeNull();
    history.insert({ ...baseEntry, id: "new", forkedFrom: "legacy" });
    expect(history.get("new")?.forkedFrom).toBe("legacy");
  });

  test("resolves explicit path, env override, then cwd default", () => {
    expect(resolveHistoryPath({ explicit: "/tmp/custom.db" })).toBe("/tmp/custom.db");
    expect(
      resolveHistoryPath({
        env: { REDDIT_CLI_HISTORY_DB: "/tmp/from-env.db" },
        cwd: "/tmp/workspace",
      }),
    ).toBe("/tmp/from-env.db");
    expect(resolveHistoryPath({ env: {}, cwd: "/tmp/workspace" })).toBe(
      "/tmp/workspace/.reddit-cli/history.db",
    );
  });
});
