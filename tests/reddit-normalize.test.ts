import { describe, expect, test } from "bun:test";

import {
  normalizeCommentListing,
  normalizeCommentSummary,
  normalizeListing,
  normalizePostWithComments,
  normalizeProfile,
} from "../src/lib/reddit-normalize.ts";

describe("reddit-normalize", () => {
  test("normalizeProfile tolerates missing fields", () => {
    expect(normalizeProfile({})).toEqual({
      id: "",
      name: "",
      createdUtc: 0,
      linkKarma: 0,
      commentKarma: 0,
    });
    expect(
      normalizeProfile({ id: "t2_1", name: "yak", created_utc: 10, link_karma: 5, comment_karma: 3 }),
    ).toEqual({ id: "t2_1", name: "yak", createdUtc: 10, linkKarma: 5, commentKarma: 3 });
  });

  test("normalizeListing extracts posts and pagination", () => {
    const listing = normalizeListing(
      {
        data: {
          after: "t3_next",
          before: null,
          children: [
            { kind: "t3", data: { id: "p1", title: "A", score: 1, upvote_ratio: 0.9, num_comments: 2 } },
            { kind: "t1", data: { id: "skipme" } },
            { kind: "t3", data: { id: "p2", title: "B" } },
          ],
        },
      },
      { subreddit: "bun", sort: "hot" },
    );
    expect(listing.subreddit).toBe("bun");
    expect(listing.sort).toBe("hot");
    expect(listing.after).toBe("t3_next");
    expect(listing.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(listing.posts[0]!.upvoteRatio).toBe(0.9);
  });

  test("normalizeListing handles malformed input gracefully", () => {
    expect(normalizeListing(null, { subreddit: "x", sort: "hot" }).posts).toEqual([]);
    expect(normalizeListing({ data: {} }, { subreddit: "x", sort: "hot" }).posts).toEqual([]);
  });

  test("normalizePostWithComments extracts post + recursive replies", () => {
    const raw = [
      { data: { children: [{ kind: "t3", data: { id: "p1", title: "T" } }] } },
      {
        data: {
          children: [
            {
              kind: "t1",
              data: {
                id: "c1",
                body: "top",
                author: "u1",
                replies: {
                  data: {
                    children: [
                      { kind: "t1", data: { id: "c2", body: "child", author: "u2", replies: "" } },
                      { kind: "more", data: { id: "more" } },
                    ],
                  },
                },
              },
            },
            { kind: "more", data: { id: "more" } },
          ],
        },
      },
    ];
    const { post, comments } = normalizePostWithComments(raw);
    expect(post?.id).toBe("p1");
    expect(comments).toHaveLength(1);
    expect(comments[0]!.id).toBe("c1");
    expect(comments[0]!.replies).toHaveLength(1);
    expect(comments[0]!.replies[0]!.id).toBe("c2");
    expect(comments[0]!.replies[0]!.replies).toEqual([]);
  });

  test("normalizeCommentSummary tolerates missing link fields", () => {
    expect(normalizeCommentSummary({})).toEqual({
      id: "",
      author: "",
      body: "",
      score: 0,
      createdUtc: 0,
      permalink: "",
      subreddit: "",
      linkTitle: "",
      linkPermalink: "",
      linkId: "",
    });
    const result = normalizeCommentSummary({
      id: "c1",
      author: "yak",
      body: "hi",
      score: 3,
      created_utc: 10,
      permalink: "/r/bun/comments/p1/_/c1/",
      subreddit: "bun",
      link_title: "Post title",
      link_permalink: "/r/bun/comments/p1/_/",
      link_id: "t3_p1",
    });
    expect(result.linkTitle).toBe("Post title");
    expect(result.score).toBe(3);
  });

  test("normalizeCommentListing extracts t1 children and pagination", () => {
    const listing = normalizeCommentListing(
      {
        data: {
          after: "t1_next",
          before: null,
          children: [
            { kind: "t1", data: { id: "c1", author: "u1", body: "A" } },
            { kind: "t3", data: { id: "skipme" } },
            { kind: "t1", data: { id: "c2", author: "u2", body: "B" } },
          ],
        },
      },
      { source: "u/yak", sort: "new" },
    );
    expect(listing.source).toBe("u/yak");
    expect(listing.after).toBe("t1_next");
    expect(listing.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  test("normalizeCommentListing handles malformed input gracefully", () => {
    expect(normalizeCommentListing(null, { source: "x", sort: "new" }).comments).toEqual([]);
    expect(normalizeCommentListing({ data: {} }, { source: "x", sort: "new" }).comments).toEqual([]);
  });

  test("normalizePostWithComments returns empty when input is malformed", () => {
    expect(normalizePostWithComments(null)).toEqual({ post: null, comments: [] });
    expect(normalizePostWithComments([])).toEqual({ post: null, comments: [] });
    expect(normalizePostWithComments([{ data: {} }])).toEqual({ post: null, comments: [] });
  });
});
