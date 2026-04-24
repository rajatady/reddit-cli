import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  resolveOutputPath,
  summarizeResponse,
  toolOutputSlug,
  writeOutputFile,
} from "../src/lib/output.ts";

const tempDirs: string[] = [];
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cli-output-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("output/toolOutputSlug", () => {
  test("per-tool default slugs", () => {
    expect(toolOutputSlug({ module: "users", tool: "whoami-remote", params: {} })).toBe("me.json");
    expect(
      toolOutputSlug({
        module: "users",
        tool: "my-submissions",
        params: { sort: "new" },
        activeUsername: "yak",
      }),
    ).toBe("submissions-yak-new.json");
    expect(
      toolOutputSlug({
        module: "posts",
        tool: "get-post",
        params: { postUrl: "https://www.reddit.com/r/bun/comments/abc123/x/" },
      }),
    ).toBe("post-bun-abc123.json");
    expect(
      toolOutputSlug({
        module: "comments",
        tool: "get-comments",
        params: { postUrl: "https://www.reddit.com/r/bun/comments/abc123/x/" },
      }),
    ).toBe("thread-bun-abc123.json");
    expect(
      toolOutputSlug({
        module: "subreddits",
        tool: "list-posts",
        params: { subreddit: "bun", sort: "hot" },
      }),
    ).toBe("listing-bun-hot.json");
  });

  test("users list-comments and search slugs", () => {
    expect(
      toolOutputSlug({
        module: "users",
        tool: "list-comments",
        params: { sort: "new" },
        activeUsername: "yak",
      }),
    ).toBe("comments-yak-new.json");
    expect(
      toolOutputSlug({
        module: "search",
        tool: "posts",
        params: { query: "hello", subreddit: "typescript" },
      }),
    ).toBe("search-posts-typescript-hello.json");
    expect(
      toolOutputSlug({
        module: "search",
        tool: "comments",
        params: { query: "bun" },
      }),
    ).toBe("search-comments-all-bun.json");
  });

  test("unknown tool uses module-tool-timestamp fallback", () => {
    const slug = toolOutputSlug({ module: "x", tool: "y", params: {} });
    expect(slug).toMatch(/^x-y-\d+\.json$/);
  });

  test("sanitizes disallowed characters in slug parts", () => {
    const slug = toolOutputSlug({
      module: "subreddits",
      tool: "list-posts",
      params: { subreddit: "weird name/with slashes!", sort: "!hot!" },
    });
    expect(slug).toBe("listing-weird_name_with_slashes-hot.json");
  });
});

describe("output/resolveOutputPath", () => {
  test("explicit '-' routes to stdout", () => {
    expect(resolveOutputPath({ explicit: "-", slug: "x.json" })).toBe("stdout");
  });
  test("explicit path is resolved absolutely", () => {
    expect(resolveOutputPath({ explicit: "./rel.json", slug: "x.json" })).toMatch(/\/rel\.json$/);
  });
  test("defaults to REDDIT_CLI_OUT_DIR then /tmp/reddit-cli", () => {
    expect(resolveOutputPath({ slug: "x.json", env: { REDDIT_CLI_OUT_DIR: "/tmp/custom" } })).toBe(
      "/tmp/custom/x.json",
    );
    expect(resolveOutputPath({ slug: "x.json", env: {} })).toBe("/tmp/reddit-cli/x.json");
  });
});

describe("output/writeOutputFile", () => {
  test("creates parent directory and writes bytes", () => {
    const dir = freshDir();
    const path = join(dir, "nested", "out.json");
    const bytes = writeOutputFile(path, '{"ok":true}');
    expect(bytes).toBe(11);
    expect(readFileSync(path, "utf8")).toBe('{"ok":true}');
  });
});

describe("output/summarizeResponse", () => {
  test("profile summary", () => {
    const lines = summarizeResponse("users", "whoami-remote", {
      name: "yak",
      linkKarma: 5,
      commentKarma: 7,
    });
    expect(lines[0]).toContain("yak");
    expect(lines[0]).toContain("linkKarma=5");
  });

  test("listing summary includes top 5 posts and an overflow line", () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      title: `T${i}`,
      subreddit: "bun",
      score: i,
      numComments: i,
    }));
    const lines = summarizeResponse("subreddits", "list-posts", {
      subreddit: "bun",
      sort: "hot",
      after: null,
      posts,
    });
    expect(lines[0]).toContain("7 posts");
    expect(lines.some((l) => l.includes("p0"))).toBe(true);
    expect(lines[lines.length - 1]).toContain("2 more");
  });

  test("my-submissions summary", () => {
    const lines = summarizeResponse("users", "my-submissions", {
      sort: "new",
      posts: [{ id: "p1", title: "A", subreddit: "bun", score: 2, numComments: 0 }],
    });
    expect(lines[0]).toContain("submissions: 1 items");
  });

  test("post-only and thread summaries", () => {
    const post = {
      title: "Hello",
      author: "op",
      score: 10,
      numComments: 3,
    };
    const postLines = summarizeResponse("posts", "get-post", { post });
    expect(postLines[0]).toContain("Hello");
    expect(postLines[0]).toContain("op");

    const thread = summarizeResponse("comments", "get-comments", {
      post,
      comments: [
        { body: "a", replies: [{ body: "b", replies: [] }] },
        { body: "c", replies: [] },
      ],
    });
    expect(thread[0]).toContain("Hello");
    expect(thread[1]).toContain("comments: 2 top-level");
    expect(thread[1]).toContain("total incl. replies: 3");

    const missing = summarizeResponse("posts", "get-post", { post: null });
    expect(missing[0]).toContain("not found");
  });

  test("comment-listing summaries for users:list-comments and search:comments", () => {
    const payload = {
      source: "u/yak",
      sort: "new",
      comments: [
        { id: "c1", author: "yak", subreddit: "bun", score: 2, body: "hello world" },
        { id: "c2", author: "yak", subreddit: "bun", score: 1, body: "another" },
      ],
    };
    const ul = summarizeResponse("users", "list-comments", payload);
    expect(ul[0]).toContain("comments: 2 items");
    expect(ul[0]).toContain("source=u/yak");

    const sc = summarizeResponse("search", "comments", {
      ...payload,
      source: "search:hello",
    });
    expect(sc[0]).toContain("search comments: 2 items");

    const big = summarizeResponse("users", "list-comments", {
      source: "u/yak",
      sort: "new",
      comments: Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        author: "u",
        subreddit: "s",
        score: i,
        body: "x",
      })),
    });
    expect(big[big.length - 1]).toContain("3 more");
  });

  test("search posts summary", () => {
    const lines = summarizeResponse("search", "posts", {
      subreddit: "typescript",
      sort: "relevance",
      posts: [{ id: "p1", title: "T", subreddit: "typescript", score: 1, numComments: 0 }],
    });
    expect(lines[0]).toContain("search posts: 1 hits");
    expect(lines[0]).toContain("scope=r/typescript");
  });

  test("unknown tool summary falls back to ok", () => {
    const lines = summarizeResponse("x", "y", {});
    expect(lines[0]).toBe("x y: ok");
  });
});
