import { describe, expect, test } from "bun:test";

import { buildRegistry, findTool } from "../src/lib/registry.ts";

describe("registry", () => {
  test("builds the default reddit-cli tool surface", () => {
    const registry = buildRegistry();

    expect(registry.version).toBe("1");
    expect(Object.keys(registry.modules).sort()).toEqual([
      "auth",
      "comments",
      "posts",
      "search",
      "subreddits",
      "users",
    ]);
    expect(registry.modules.auth!.tools).toEqual([
      "login",
      "whoami",
      "refresh",
      "logout",
      "accounts",
      "use",
    ]);
    expect(registry.modules.posts!.tools).toContain("get-post");
    expect(registry.modules.comments!.tools).toContain("get-comments");
    expect(registry.modules.users!.tools).toContain("whoami-remote");
    expect(registry.modules.subreddits!.tools).toContain("list-posts");
  });

  test("post and comment tools share the same request shape", () => {
    const registry = buildRegistry();
    const postTool = findTool(registry, "posts", "get-post");
    const commentTool = findTool(registry, "comments", "get-comments");

    const pv = postTool!.buildPreview({
      params: { postUrl: "https://www.reddit.com/r/bun/comments/abc123/example_post/" },
      baseUrl: "https://oauth.reddit.com",
    });
    const cv = commentTool!.buildPreview({
      params: { postUrl: "https://www.reddit.com/r/bun/comments/abc123/example_post/" },
      baseUrl: "https://oauth.reddit.com",
    });
    expect(pv).toEqual(cv);
    if (pv.kind !== "request") throw new Error("expected request preview");
    expect(pv.url).toBe("https://oauth.reddit.com/r/bun/comments/abc123/.json?raw_json=1");
    expect(pv.path).toBe("/r/bun/comments/abc123/.json?raw_json=1");
    expect(pv.cacheKey).toBe("posts/bun/abc123");
  });

  test("every registered tool builds a preview without throwing", () => {
    const registry = buildRegistry();
    const sampleParams: Record<string, Record<string, unknown>> = {
      "auth:use": { account: "yak" },
      "posts:get-post": { postUrl: "https://www.reddit.com/r/bun/comments/abc/x/" },
      "comments:get-comments": { postUrl: "https://www.reddit.com/r/bun/comments/abc/x/" },
      "subreddits:list-posts": { subreddit: "bun", sort: "hot", limit: 5 },
      "users:my-submissions": { username: "yak", sort: "new", limit: 10 },
      "users:list-comments": { username: "yak", sort: "new", limit: 10 },
      "search:posts": { query: "react", sort: "relevance", time: "all", limit: 10 },
      "search:comments": { query: "react", subreddit: "typescript", sort: "new", time: "week", limit: 5 },
    };
    for (const tool of Object.values(registry.tools)) {
      const key = `${tool.module}:${tool.name}`;
      const preview = tool.buildPreview({
        params: sampleParams[key] ?? {},
        baseUrl: "https://oauth.reddit.com",
        activeUsername: "yak",
      });
      expect(preview.kind).toMatch(/auth|request/);
    }
  });

  test("normalizers attach to request tools", () => {
    const registry = buildRegistry();
    const usersTool = findTool(registry, "users", "whoami-remote")!;
    const listingTool = findTool(registry, "subreddits", "list-posts")!;
    const postTool = findTool(registry, "posts", "get-post")!;
    const commentsTool = findTool(registry, "comments", "get-comments")!;

    expect(typeof usersTool.normalize).toBe("function");
    expect(typeof listingTool.normalize).toBe("function");
    expect(typeof postTool.normalize).toBe("function");
    expect(typeof commentsTool.normalize).toBe("function");
  });

  test("users list-comments builds the user comments path", () => {
    const registry = buildRegistry();
    const tool = findTool(registry, "users", "list-comments")!;
    const pv = tool.buildPreview({
      params: { username: "yak", sort: "new", limit: 10 },
      baseUrl: "https://oauth.reddit.com",
    });
    if (pv.kind !== "request") throw new Error("expected request preview");
    expect(pv.path).toBe("/user/yak/comments.json?raw_json=1&sort=new&limit=10");
    expect(pv.cacheKey).toBe("users/yak/comments/new/10");
  });

  test("users list-comments falls back to activeUsername and errors when missing", () => {
    const registry = buildRegistry();
    const tool = findTool(registry, "users", "list-comments")!;
    const pv = tool.buildPreview({
      params: {},
      baseUrl: "https://oauth.reddit.com",
      activeUsername: "otter",
    });
    if (pv.kind !== "request") throw new Error("expected request preview");
    expect(pv.path).toContain("/user/otter/comments.json");

    expect(() =>
      tool.buildPreview({ params: {}, baseUrl: "https://oauth.reddit.com" }),
    ).toThrow("needs --username");
  });

  test("search posts builds /search.json with query and no subreddit restriction", () => {
    const registry = buildRegistry();
    const tool = findTool(registry, "search", "posts")!;
    const pv = tool.buildPreview({
      params: { query: "hello world", sort: "top", time: "week", limit: 5 },
      baseUrl: "https://oauth.reddit.com",
    });
    if (pv.kind !== "request") throw new Error("expected request preview");
    expect(pv.path).toBe(
      "/search.json?raw_json=1&type=link&q=hello%20world&sort=top&t=week&limit=5",
    );
    expect(pv.cacheKey).toBe("search/posts/all/top/week/5/hello world");
  });

  test("search posts restricts to subreddit when given", () => {
    const registry = buildRegistry();
    const tool = findTool(registry, "search", "posts")!;
    const pv = tool.buildPreview({
      params: { query: "bun", subreddit: "r/typescript", limit: 3 },
      baseUrl: "https://oauth.reddit.com",
    });
    if (pv.kind !== "request") throw new Error("expected request preview");
    expect(pv.path).toBe(
      "/r/typescript/search.json?raw_json=1&type=link&q=bun&sort=relevance&t=all&limit=3&restrict_sr=on",
    );
  });

  test("search comments uses type=comment", () => {
    const registry = buildRegistry();
    const tool = findTool(registry, "search", "comments")!;
    const pv = tool.buildPreview({
      params: { query: "cofounder", subreddit: "startups", sort: "new", time: "month", limit: 2 },
      baseUrl: "https://oauth.reddit.com",
    });
    if (pv.kind !== "request") throw new Error("expected request preview");
    expect(pv.path).toBe(
      "/r/startups/search.json?raw_json=1&type=comment&q=cofounder&sort=new&t=month&limit=2&restrict_sr=on",
    );
  });

  test("supports auth and subreddit planning previews", () => {
    const registry = buildRegistry();
    const authTool = findTool(registry, "auth", "login");
    const subredditTool = findTool(registry, "subreddits", "list-posts");

    expect(authTool?.buildPreview({ params: {}, baseUrl: "https://oauth.reddit.com" })).toEqual({
      kind: "auth",
      provider: "reddit",
    });
    expect(
      subredditTool?.buildPreview({
        params: { subreddit: "https://www.reddit.com/r/typescript/", sort: "new", limit: 10 },
        baseUrl: "https://oauth.reddit.com",
      }),
    ).toEqual({
      kind: "request",
      method: "GET",
      url: "https://oauth.reddit.com/r/typescript/new.json?raw_json=1&limit=10",
      path: "/r/typescript/new.json?raw_json=1&limit=10",
      cacheKey: "subreddits/typescript/new/10",
    });
  });
});
