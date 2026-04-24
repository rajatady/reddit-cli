import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ToolOutputSlugInput {
  module: string;
  tool: string;
  params: Record<string, unknown>;
  activeUsername?: string | null;
}

export function toolOutputSlug(input: ToolOutputSlugInput): string {
  const { module, tool, params, activeUsername } = input;
  const safe = (v: unknown) => String(v ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "x";

  if (module === "users" && tool === "whoami-remote") return `me.json`;
  if (module === "users" && tool === "my-submissions") {
    const u = safe(params.username ?? activeUsername ?? "me");
    const s = safe(params.sort ?? "new");
    return `submissions-${u}-${s}.json`;
  }
  if (module === "posts" && tool === "get-post") {
    const { sub, id } = extractPostRef(params);
    return `post-${safe(sub)}-${safe(id)}.json`;
  }
  if (module === "comments" && tool === "get-comments") {
    const { sub, id } = extractPostRef(params);
    return `thread-${safe(sub)}-${safe(id)}.json`;
  }
  if (module === "subreddits" && tool === "list-posts") {
    const s = safe(params.subreddit);
    const sort = safe(params.sort ?? "hot");
    return `listing-${s}-${sort}.json`;
  }
  if (module === "users" && tool === "list-comments") {
    const u = safe(params.username ?? activeUsername ?? "me");
    const s = safe(params.sort ?? "new");
    return `comments-${u}-${s}.json`;
  }
  if (module === "search" && (tool === "posts" || tool === "comments")) {
    const scope = safe(params.subreddit ?? "all");
    const q = safe(params.query ?? "q");
    return `search-${tool}-${scope}-${q}.json`;
  }
  return `${module}-${tool}-${Date.now()}.json`;
}

function extractPostRef(params: Record<string, unknown>): { sub: string; id: string } {
  const url = String(params.postUrl ?? "");
  const match = url.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
  return { sub: match?.[1] ?? "x", id: match?.[2] ?? "x" };
}

export interface ResolveOutputPathOptions {
  explicit?: string | null;
  slug: string;
  env?: Record<string, string | undefined>;
}

export function resolveOutputPath(options: ResolveOutputPathOptions): string | "stdout" {
  if (options.explicit === "-") return "stdout";
  if (options.explicit) return resolve(options.explicit);
  const env = options.env ?? process.env;
  const dir = env.REDDIT_CLI_OUT_DIR ?? "/tmp/reddit-cli";
  return join(dir, options.slug);
}

export function writeOutputFile(filePath: string, body: string): number {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, body);
  return Buffer.byteLength(body, "utf8");
}

export function summarizeResponse(
  module: string,
  tool: string,
  normalized: unknown,
): string[] {
  const lines: string[] = [];
  const v = normalized as Record<string, unknown>;

  if (module === "users" && tool === "whoami-remote") {
    lines.push(
      `profile: ${v.name ?? "?"}  linkKarma=${v.linkKarma ?? 0}  commentKarma=${v.commentKarma ?? 0}`,
    );
    return lines;
  }
  if (module === "users" && tool === "my-submissions") {
    const posts = (v.posts as Array<Record<string, unknown>>) ?? [];
    lines.push(`submissions: ${posts.length} items (sort=${String(v.sort ?? "?")})`);
    for (const p of posts.slice(0, 5)) {
      lines.push(`  - ${String(p.id)}  r/${String(p.subreddit)}  score=${Number(p.score ?? 0)}  numComments=${Number(p.numComments ?? 0)}  ${shorten(String(p.title ?? ""), 70)}`);
    }
    if (posts.length > 5) lines.push(`  …and ${posts.length - 5} more.`);
    return lines;
  }
  if (module === "posts" && tool === "get-post") {
    const post = v.post as Record<string, unknown> | null;
    if (!post) {
      lines.push("post: (not found)");
      return lines;
    }
    lines.push(
      `post: ${shorten(String(post.title ?? ""), 80)}  by ${String(post.author ?? "?")}  score=${Number(post.score ?? 0)}  numComments=${Number(post.numComments ?? 0)}`,
    );
    return lines;
  }
  if (module === "comments" && tool === "get-comments") {
    const post = v.post as Record<string, unknown> | null;
    const comments = (v.comments as Array<Record<string, unknown>>) ?? [];
    if (post) {
      lines.push(
        `post: ${shorten(String(post.title ?? ""), 80)}  by ${String(post.author ?? "?")}  score=${Number(post.score ?? 0)}`,
      );
    }
    lines.push(`comments: ${comments.length} top-level  (total incl. replies: ${countComments(comments)})`);
    return lines;
  }
  if (module === "subreddits" && tool === "list-posts") {
    const posts = (v.posts as Array<Record<string, unknown>>) ?? [];
    lines.push(`listing: ${posts.length} posts  r/${String(v.subreddit ?? "?")}  sort=${String(v.sort ?? "?")}  after=${String(v.after ?? "null")}`);
    for (const p of posts.slice(0, 5)) {
      lines.push(`  - ${String(p.id)}  score=${Number(p.score ?? 0)}  numComments=${Number(p.numComments ?? 0)}  ${shorten(String(p.title ?? ""), 70)}`);
    }
    if (posts.length > 5) lines.push(`  …and ${posts.length - 5} more.`);
    return lines;
  }
  if (module === "search" && tool === "posts") {
    const posts = (v.posts as Array<Record<string, unknown>>) ?? [];
    lines.push(`search posts: ${posts.length} hits  scope=r/${String(v.subreddit ?? "all")}  sort=${String(v.sort ?? "?")}`);
    for (const p of posts.slice(0, 5)) {
      lines.push(`  - ${String(p.id)}  r/${String(p.subreddit ?? "?")}  score=${Number(p.score ?? 0)}  numComments=${Number(p.numComments ?? 0)}  ${shorten(String(p.title ?? ""), 70)}`);
    }
    if (posts.length > 5) lines.push(`  …and ${posts.length - 5} more.`);
    return lines;
  }
  if ((module === "users" && tool === "list-comments") || (module === "search" && tool === "comments")) {
    const comments = (v.comments as Array<Record<string, unknown>>) ?? [];
    const label = module === "search" ? "search comments" : "comments";
    lines.push(`${label}: ${comments.length} items  source=${String(v.source ?? "?")}  sort=${String(v.sort ?? "?")}`);
    for (const c of comments.slice(0, 5)) {
      const author = String(c.author ?? "?");
      const sub = String(c.subreddit ?? "?");
      const body = shorten(String(c.body ?? "").replace(/\s+/g, " "), 70);
      lines.push(`  - ${String(c.id)}  u/${author}  r/${sub}  score=${Number(c.score ?? 0)}  ${body}`);
    }
    if (comments.length > 5) lines.push(`  …and ${comments.length - 5} more.`);
    return lines;
  }
  lines.push(`${module} ${tool}: ok`);
  return lines;
}

function countComments(comments: Array<Record<string, unknown>>): number {
  let total = 0;
  const walk = (list: Array<Record<string, unknown>>) => {
    for (const c of list) {
      total++;
      const replies = (c.replies as Array<Record<string, unknown>>) ?? [];
      walk(replies);
    }
  };
  walk(comments);
  return total;
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
