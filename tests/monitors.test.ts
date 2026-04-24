import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Monitors, resolveMonitorsPath } from "../src/lib/monitors.ts";

const tempDirs: string[] = [];
function freshPath() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-monitors-"));
  tempDirs.push(dir);
  return join(dir, "monitors.db");
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("monitors store", () => {
  test("create, get, list, and stop lifecycle", () => {
    const store = new Monitors(freshPath());
    const job = store.create({
      id: "mon_a",
      postUrl: "https://www.reddit.com/r/bun/comments/abc/x/",
      subreddit: "bun",
      postId: "abc",
      intervalMinutes: 30,
      now: 1_700_000_000_000,
    });
    expect(job.active).toBe(true);
    expect(job.nextRunAt).toBe(1_700_000_000_000);
    expect(store.get("mon_a")?.id).toBe("mon_a");
    expect(store.get("mon_")?.id).toBe("mon_a");
    expect(store.list()).toHaveLength(1);

    const stopped = store.stop("mon_a");
    expect(stopped?.active).toBe(false);
    expect(store.list({ activeOnly: true })).toHaveLength(0);
    expect(store.stop("ghost")).toBeNull();
  });

  test("due returns only active jobs with next_run_at in the past", () => {
    const store = new Monitors(freshPath());
    store.create({ id: "a", postUrl: "u", subreddit: "s", postId: "1", intervalMinutes: 10, now: 100 });
    store.create({ id: "b", postUrl: "u", subreddit: "s", postId: "2", intervalMinutes: 10, now: 200 });
    store.touchRun("a", 100); // pushes a to next_run=100+10*60_000
    expect(store.due(200).map((j) => j.id)).toEqual(["b"]);
    expect(store.due(1_000_000).map((j) => j.id).sort()).toEqual(["a", "b"]);
  });

  test("appendSnapshot + latestSnapshot + snapshots list", () => {
    const store = new Monitors(freshPath());
    store.create({ id: "a", postUrl: "u", subreddit: "s", postId: "1", intervalMinutes: 10, now: 100 });
    store.appendSnapshot({ jobId: "a", capturedAt: 110, score: 5, upvoteRatio: 0.9, numComments: 3 });
    store.appendSnapshot({ jobId: "a", capturedAt: 120, score: 8, upvoteRatio: 0.88, numComments: 4 });
    expect(store.latestSnapshot("a")?.score).toBe(8);
    expect(store.snapshots("a").map((s) => s.score)).toEqual([8, 5]);
    expect(store.latestSnapshot("ghost")).toBeNull();
  });

  test("touchRun is a no-op for unknown ids", () => {
    const store = new Monitors(freshPath());
    store.touchRun("ghost", 1);
    expect(store.list()).toEqual([]);
  });

  test("resolveMonitorsPath honors explicit, env, then cwd default", () => {
    expect(resolveMonitorsPath({ explicit: "/tmp/x.db" })).toBe("/tmp/x.db");
    expect(
      resolveMonitorsPath({ env: { REDDIT_CLI_MONITORS_DB: "/tmp/env.db" }, cwd: "/tmp/ws" }),
    ).toBe("/tmp/env.db");
    expect(resolveMonitorsPath({ env: {}, cwd: "/tmp/ws" })).toBe(
      "/tmp/ws/.reddit-cli/monitors.db",
    );
  });
});
