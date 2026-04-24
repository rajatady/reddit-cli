import { describe, expect, test } from "bun:test";

import { parseRedditPostUrl, parseSubreddit } from "../src/lib/reddit-url.ts";

describe("reddit-url parsers", () => {
  test("parses a reddit post url", () => {
    expect(
      parseRedditPostUrl("https://www.reddit.com/r/bun/comments/abc123/example_post/"),
    ).toEqual({ subreddit: "bun", postId: "abc123" });
  });

  test("rejects an invalid reddit post url", () => {
    expect(() => parseRedditPostUrl("https://www.reddit.com/r/bun/")).toThrow(
      "Invalid Reddit post URL",
    );
  });

  test("parses subreddit values from raw names and urls", () => {
    expect(parseSubreddit("r/typescript")).toBe("typescript");
    expect(parseSubreddit("https://www.reddit.com/r/typescript/")).toBe("typescript");
  });

  test("rejects invalid subreddit urls", () => {
    expect(() => parseSubreddit("https://www.reddit.com/user/example")).toThrow(
      "Invalid subreddit input",
    );
  });
});
