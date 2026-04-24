import { loadConfig, updateActiveAccountTokens } from "./config.ts";
import { refreshAccessToken as defaultRefreshAccessToken } from "./oauth.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RedditFetchOptions {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  init?: RequestInit;
  fetchImpl?: FetchLike;
  refreshImpl?: typeof defaultRefreshAccessToken;
  now?: () => number;
}

export async function redditFetch<T = unknown>(
  path: string,
  options: RedditFetchOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const refreshImpl = options.refreshImpl ?? defaultRefreshAccessToken;
  const now = options.now ?? Date.now;

  let config = loadConfig({ homeDir: options.homeDir, env: options.env, cwd: options.cwd });
  if (!config.activeAccountId || !config.accessToken) {
    throw new Error("No active Reddit account. Run `redditer auth login` first.");
  }

  const url = path.startsWith("http") ? path : `${config.baseUrl}${path}`;
  const doCall = (token: string) =>
    fetchImpl(url, {
      ...options.init,
      headers: {
        ...(options.init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
        "User-Agent": config.userAgent,
      },
    });

  let response = await doCall(config.accessToken);
  if (response.status === 401) {
    if (!config.refreshToken || !config.clientId) {
      throw new Error(
        "Reddit rejected the saved access token and no refresh token is available. Run `redditer auth login`.",
      );
    }
    const tokens = await refreshImpl({
      refreshToken: config.refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      userAgent: config.userAgent,
      now,
    });
    updateActiveAccountTokens({
      homeDir: options.homeDir,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope || config.scope,
      now: now(),
    });
    config = loadConfig({ homeDir: options.homeDir, env: options.env, cwd: options.cwd });
    response = await doCall(tokens.accessToken);
  }

  if (!response.ok) {
    throw new Error(`Reddit request failed (${response.status}) ${path}`);
  }
  return (await response.json()) as T;
}
