export interface RedditProfile {
  id: string;
  name: string;
  createdUtc: number;
  linkKarma: number;
  commentKarma: number;
}

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  selftext: string;
  url: string;
  permalink: string;
  subreddit: string;
  createdUtc: number;
  score: number;
  upvoteRatio: number;
  numComments: number;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  permalink: string;
  replies: RedditComment[];
}

export interface RedditListing {
  subreddit: string;
  sort: string;
  after: string | null;
  before: string | null;
  posts: RedditPost[];
}

export interface RedditCommentSummary {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  permalink: string;
  subreddit: string;
  linkTitle: string;
  linkPermalink: string;
  linkId: string;
}

export interface RedditCommentListing {
  source: string;
  sort: string;
  after: string | null;
  before: string | null;
  comments: RedditCommentSummary[];
}

type RawPost = Record<string, unknown>;
type RawChild = { kind?: string; data?: Record<string, unknown> };

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

export function normalizePost(raw: RawPost): RedditPost {
  return {
    id: str(raw.id),
    title: str(raw.title),
    author: str(raw.author),
    selftext: str(raw.selftext),
    url: str(raw.url),
    permalink: str(raw.permalink),
    subreddit: str(raw.subreddit),
    createdUtc: num(raw.created_utc),
    score: num(raw.score),
    upvoteRatio: num(raw.upvote_ratio),
    numComments: num(raw.num_comments),
  };
}

export function normalizeComment(raw: Record<string, unknown>): RedditComment {
  const repliesField = raw.replies;
  const repliesChildren: RawChild[] =
    repliesField && typeof repliesField === "object" && "data" in repliesField
      ? ((repliesField as { data?: { children?: RawChild[] } }).data?.children ?? [])
      : [];
  return {
    id: str(raw.id),
    author: str(raw.author),
    body: str(raw.body),
    score: num(raw.score),
    createdUtc: num(raw.created_utc),
    permalink: str(raw.permalink),
    replies: repliesChildren
      .filter((child) => child.kind === "t1" && child.data)
      .map((child) => normalizeComment(child.data!)),
  };
}

export function normalizeProfile(raw: Record<string, unknown>): RedditProfile {
  return {
    id: str(raw.id),
    name: str(raw.name),
    createdUtc: num(raw.created_utc),
    linkKarma: num(raw.link_karma),
    commentKarma: num(raw.comment_karma),
  };
}

export function normalizeListing(
  raw: unknown,
  meta: { subreddit: string; sort: string },
): RedditListing {
  const data =
    ((raw as { data?: { children?: RawChild[]; after?: string | null; before?: string | null } })
      ?.data) ?? {};
  const children = data.children ?? [];
  return {
    subreddit: meta.subreddit,
    sort: meta.sort,
    after: data.after ?? null,
    before: data.before ?? null,
    posts: children
      .filter((child) => child.kind === "t3" && child.data)
      .map((child) => normalizePost(child.data!)),
  };
}

export function normalizeCommentSummary(raw: Record<string, unknown>): RedditCommentSummary {
  return {
    id: str(raw.id),
    author: str(raw.author),
    body: str(raw.body),
    score: num(raw.score),
    createdUtc: num(raw.created_utc),
    permalink: str(raw.permalink),
    subreddit: str(raw.subreddit),
    linkTitle: str(raw.link_title),
    linkPermalink: str(raw.link_permalink),
    linkId: str(raw.link_id),
  };
}

export function normalizeCommentListing(
  raw: unknown,
  meta: { source: string; sort: string },
): RedditCommentListing {
  const data =
    ((raw as { data?: { children?: RawChild[]; after?: string | null; before?: string | null } })
      ?.data) ?? {};
  const children = data.children ?? [];
  return {
    source: meta.source,
    sort: meta.sort,
    after: data.after ?? null,
    before: data.before ?? null,
    comments: children
      .filter((child) => child.kind === "t1" && child.data)
      .map((child) => normalizeCommentSummary(child.data!)),
  };
}

export function normalizePostWithComments(raw: unknown): {
  post: RedditPost | null;
  comments: RedditComment[];
} {
  if (!Array.isArray(raw) || raw.length < 1) {
    return { post: null, comments: [] };
  }
  const postListing = raw[0] as { data?: { children?: RawChild[] } };
  const commentListing = raw[1] as { data?: { children?: RawChild[] } } | undefined;
  const postChild = postListing?.data?.children?.[0];
  const post = postChild?.kind === "t3" && postChild.data ? normalizePost(postChild.data) : null;
  const commentChildren = commentListing?.data?.children ?? [];
  const comments = commentChildren
    .filter((child) => child.kind === "t1" && child.data)
    .map((child) => normalizeComment(child.data!));
  return { post, comments };
}
