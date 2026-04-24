import {
  normalizeCommentListing,
  normalizeListing,
  normalizePostWithComments,
  normalizeProfile,
  parseRedditPostUrl,
  parseSubreddit,
} from "./reddit.ts";

export type ToolOptionType = "string" | "number" | "boolean";
export type ToolKind = "request" | "auth";

export interface ToolOptionDefinition {
  type: ToolOptionType;
  description: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
}

export interface ToolAnnotations {
  cacheable: boolean;
  writes: boolean;
}

export interface ToolExecutionContext {
  params: Record<string, unknown>;
  baseUrl: string;
  activeUsername?: string | null;
}

export interface RequestPreview {
  kind: "request";
  method: "GET" | "POST";
  url: string;
  path: string;
  cacheKey: string;
}

export type ToolPreview = RequestPreview | { kind: "auth"; provider: "reddit" };

export interface ToolDefinition {
  module: string;
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  options: Record<string, ToolOptionDefinition>;
  annotations: ToolAnnotations;
  buildPreview: (context: ToolExecutionContext) => ToolPreview;
  normalize?: (raw: unknown, params: Record<string, unknown>) => unknown;
}

export interface ModuleDefinition {
  title: string;
  tools: string[];
}

export interface Registry {
  version: string;
  modules: Record<string, ModuleDefinition>;
  tools: Record<string, ToolDefinition>;
}

function buildToolKey(moduleName: string, toolName: string): string {
  return `${moduleName}:${toolName}`;
}

function postRequest(params: Record<string, unknown>, baseUrl: string): RequestPreview {
  const post = parseRedditPostUrl(String(params.postUrl));
  const path = `/r/${post.subreddit}/comments/${post.postId}/.json?raw_json=1`;
  return {
    kind: "request",
    method: "GET",
    url: `${baseUrl}${path}`,
    path,
    cacheKey: `posts/${post.subreddit}/${post.postId}`,
  };
}

export function buildRegistry(): Registry {
  const tools: ToolDefinition[] = [
    {
      module: "auth",
      name: "login",
      title: "Login",
      description: "Authenticate a local CLI session with Reddit OAuth.",
      kind: "auth",
      options: {},
      annotations: { cacheable: false, writes: true },
      buildPreview: () => ({ kind: "auth", provider: "reddit" }),
    },
    {
      module: "auth",
      name: "whoami",
      title: "Whoami",
      description: "Show the currently saved Reddit CLI identity and config state.",
      kind: "auth",
      options: {},
      annotations: { cacheable: false, writes: false },
      buildPreview: () => ({ kind: "auth", provider: "reddit" }),
    },
    {
      module: "auth",
      name: "refresh",
      title: "Refresh",
      description: "Refresh the saved Reddit access token for the active account.",
      kind: "auth",
      options: {},
      annotations: { cacheable: false, writes: true },
      buildPreview: () => ({ kind: "auth", provider: "reddit" }),
    },
    {
      module: "auth",
      name: "logout",
      title: "Logout",
      description: "Remove the active saved Reddit account from local CLI state.",
      kind: "auth",
      options: {},
      annotations: { cacheable: false, writes: true },
      buildPreview: () => ({ kind: "auth", provider: "reddit" }),
    },
    {
      module: "auth",
      name: "accounts",
      title: "Accounts",
      description: "List the saved Reddit accounts known to the CLI.",
      kind: "auth",
      options: {},
      annotations: { cacheable: false, writes: false },
      buildPreview: () => ({ kind: "auth", provider: "reddit" }),
    },
    {
      module: "auth",
      name: "use",
      title: "Use",
      description: "Switch the active Reddit account used by the CLI.",
      kind: "auth",
      options: {
        account: {
          type: "string",
          description: "Saved account id, username, or label.",
          required: true,
        },
      },
      annotations: { cacheable: false, writes: true },
      buildPreview: () => ({ kind: "auth", provider: "reddit" }),
    },
    {
      module: "users",
      name: "whoami-remote",
      title: "Whoami Remote",
      description: "Fetch the active Reddit account profile from Reddit.",
      kind: "request",
      options: {},
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ baseUrl }) => ({
        kind: "request",
        method: "GET",
        url: `${baseUrl}/api/v1/me`,
        path: "/api/v1/me",
        cacheKey: "users/me",
      }),
      normalize: (raw) => normalizeProfile(raw as Record<string, unknown>),
    },
    {
      module: "users",
      name: "my-submissions",
      title: "My Submissions",
      description: "List submissions (posts) by a Reddit user; defaults to the active account.",
      kind: "request",
      options: {
        username: {
          type: "string",
          description: "Reddit username. Defaults to the active account.",
        },
        sort: {
          type: "string",
          description: "Listing sort: new | top | hot | controversial.",
          defaultValue: "new",
        },
        limit: {
          type: "number",
          description: "Max number of submissions to fetch.",
          defaultValue: 25,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl, activeUsername }) => {
        const username = String(params.username ?? activeUsername ?? "");
        if (!username) {
          throw new Error(
            "users my-submissions needs --username or an active account (run `auth login`).",
          );
        }
        const sort = String(params.sort ?? "new");
        const limit = Number(params.limit ?? 25);
        const path = `/user/${username}/submitted.json?raw_json=1&sort=${sort}&limit=${limit}`;
        return {
          kind: "request",
          method: "GET",
          url: `${baseUrl}${path}`,
          path,
          cacheKey: `users/${username}/submitted/${sort}/${limit}`,
        };
      },
      normalize: (raw, params) =>
        normalizeListing(raw, {
          subreddit: `u/${String(params.username ?? "me")}`,
          sort: String(params.sort ?? "new"),
        }),
    },
    {
      module: "users",
      name: "list-comments",
      title: "List Comments",
      description: "List recent comments by a Reddit user; defaults to the active account.",
      kind: "request",
      options: {
        username: {
          type: "string",
          description: "Reddit username. Defaults to the active account.",
        },
        sort: {
          type: "string",
          description: "Comment sort: new | top | hot | controversial.",
          defaultValue: "new",
        },
        limit: {
          type: "number",
          description: "Max number of comments to fetch.",
          defaultValue: 25,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl, activeUsername }) => {
        const username = String(params.username ?? activeUsername ?? "");
        if (!username) {
          throw new Error(
            "users list-comments needs --username or an active account (run `auth login`).",
          );
        }
        const sort = String(params.sort ?? "new");
        const limit = Number(params.limit ?? 25);
        const path = `/user/${username}/comments.json?raw_json=1&sort=${sort}&limit=${limit}`;
        return {
          kind: "request",
          method: "GET",
          url: `${baseUrl}${path}`,
          path,
          cacheKey: `users/${username}/comments/${sort}/${limit}`,
        };
      },
      normalize: (raw, params) =>
        normalizeCommentListing(raw, {
          source: `u/${String(params.username ?? "me")}`,
          sort: String(params.sort ?? "new"),
        }),
    },
    {
      module: "search",
      name: "posts",
      title: "Search Posts",
      description: "Search Reddit posts by keyword; optionally scoped to a subreddit.",
      kind: "request",
      options: {
        query: {
          type: "string",
          description: "Search query.",
          required: true,
        },
        subreddit: {
          type: "string",
          description: "Restrict search to a subreddit (raw name or URL).",
        },
        sort: {
          type: "string",
          description: "Sort: relevance | hot | top | new | comments.",
          defaultValue: "relevance",
        },
        time: {
          type: "string",
          description: "Time window: all | year | month | week | day | hour.",
          defaultValue: "all",
        },
        limit: {
          type: "number",
          description: "Max number of posts to fetch.",
          defaultValue: 25,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl }) => {
        const query = String(params.query ?? "");
        const sort = String(params.sort ?? "relevance");
        const time = String(params.time ?? "all");
        const limit = Number(params.limit ?? 25);
        const sub = params.subreddit ? parseSubreddit(String(params.subreddit)) : null;
        const prefix = sub ? `/r/${sub}/search.json` : `/search.json`;
        const q = encodeURIComponent(query);
        const restrict = sub ? `&restrict_sr=on` : "";
        const path = `${prefix}?raw_json=1&type=link&q=${q}&sort=${sort}&t=${time}&limit=${limit}${restrict}`;
        return {
          kind: "request",
          method: "GET",
          url: `${baseUrl}${path}`,
          path,
          cacheKey: `search/posts/${sub ?? "all"}/${sort}/${time}/${limit}/${query}`,
        };
      },
      normalize: (raw, params) =>
        normalizeListing(raw, {
          subreddit: params.subreddit ? parseSubreddit(String(params.subreddit)) : "all",
          sort: String(params.sort ?? "relevance"),
        }),
    },
    {
      module: "search",
      name: "comments",
      title: "Search Comments",
      description: "Search Reddit comments by keyword; optionally scoped to a subreddit.",
      kind: "request",
      options: {
        query: {
          type: "string",
          description: "Search query.",
          required: true,
        },
        subreddit: {
          type: "string",
          description: "Restrict search to a subreddit (raw name or URL).",
        },
        sort: {
          type: "string",
          description: "Sort: relevance | hot | top | new | comments.",
          defaultValue: "relevance",
        },
        time: {
          type: "string",
          description: "Time window: all | year | month | week | day | hour.",
          defaultValue: "all",
        },
        limit: {
          type: "number",
          description: "Max number of comments to fetch.",
          defaultValue: 25,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl }) => {
        const query = String(params.query ?? "");
        const sort = String(params.sort ?? "relevance");
        const time = String(params.time ?? "all");
        const limit = Number(params.limit ?? 25);
        const sub = params.subreddit ? parseSubreddit(String(params.subreddit)) : null;
        const prefix = sub ? `/r/${sub}/search.json` : `/search.json`;
        const q = encodeURIComponent(query);
        const restrict = sub ? `&restrict_sr=on` : "";
        const path = `${prefix}?raw_json=1&type=comment&q=${q}&sort=${sort}&t=${time}&limit=${limit}${restrict}`;
        return {
          kind: "request",
          method: "GET",
          url: `${baseUrl}${path}`,
          path,
          cacheKey: `search/comments/${sub ?? "all"}/${sort}/${time}/${limit}/${query}`,
        };
      },
      normalize: (raw, params) =>
        normalizeCommentListing(raw, {
          source: `search:${String(params.query ?? "")}${params.subreddit ? `@r/${parseSubreddit(String(params.subreddit))}` : ""}`,
          sort: String(params.sort ?? "relevance"),
        }),
    },
    {
      module: "posts",
      name: "get-post",
      title: "Get Post",
      description: "Fetch a single Reddit post (without comments).",
      kind: "request",
      options: {
        postUrl: {
          type: "string",
          description: "Full Reddit post URL.",
          required: true,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl }) => postRequest(params, baseUrl),
      normalize: (raw) => {
        const { post } = normalizePostWithComments(raw);
        return { post };
      },
    },
    {
      module: "comments",
      name: "get-comments",
      title: "Get Comments",
      description: "Fetch a Reddit post together with its comment tree.",
      kind: "request",
      options: {
        postUrl: {
          type: "string",
          description: "Full Reddit post URL.",
          required: true,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl }) => postRequest(params, baseUrl),
      normalize: (raw) => normalizePostWithComments(raw),
    },
    {
      module: "subreddits",
      name: "list-posts",
      title: "List Posts",
      description: "Fetch a subreddit listing.",
      kind: "request",
      options: {
        subreddit: {
          type: "string",
          description: "Subreddit name or URL.",
          required: true,
        },
        sort: {
          type: "string",
          description: "Listing sort order.",
          defaultValue: "hot",
        },
        limit: {
          type: "number",
          description: "Maximum number of posts to fetch.",
          defaultValue: 25,
        },
      },
      annotations: { cacheable: true, writes: false },
      buildPreview: ({ params, baseUrl }) => {
        const subreddit = parseSubreddit(String(params.subreddit));
        const sort = String(params.sort ?? "hot");
        const limit = Number(params.limit ?? 25);
        const path = `/r/${subreddit}/${sort}.json?raw_json=1&limit=${limit}`;
        return {
          kind: "request",
          method: "GET",
          url: `${baseUrl}${path}`,
          path,
          cacheKey: `subreddits/${subreddit}/${sort}/${limit}`,
        };
      },
      normalize: (raw, params) =>
        normalizeListing(raw, {
          subreddit: parseSubreddit(String(params.subreddit)),
          sort: String(params.sort ?? "hot"),
        }),
    },
  ];

  const modules: Registry["modules"] = {};
  const toolMap: Registry["tools"] = {};

  for (const tool of tools) {
    if (!modules[tool.module]) {
      modules[tool.module] = { title: toTitle(tool.module), tools: [] };
    }
    modules[tool.module]!.tools.push(tool.name);
    toolMap[buildToolKey(tool.module, tool.name)] = tool;
  }

  return { version: "1", modules, tools: toolMap };
}

export function findTool(
  registry: Registry,
  moduleName: string,
  toolName: string,
): ToolDefinition | null {
  return registry.tools[buildToolKey(moduleName, toolName)] ?? null;
}

function toTitle(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
