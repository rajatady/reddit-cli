import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  expiresAt: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SpawnLike = typeof spawn;
type CreateServerLike = typeof createServer;

export interface RedditIdentity {
  id?: string;
  name?: string;
}

interface BuildAuthorizationUrlOptions {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}

interface ExchangeCodeOptions {
  code: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  userAgent: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface FetchIdentityOptions {
  accessToken: string;
  userAgent: string;
  fetchImpl?: FetchLike;
}

interface AuthorizeWithRedditOptions {
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  userAgent: string;
  scope: string;
  timeoutSeconds: number;
  fetchImpl?: FetchLike;
  openExternal?: (url: string) => Promise<void> | void;
  createState?: () => string;
  waitForCallback?: typeof waitForOAuthCallback;
}

export function buildAuthorizationUrl(options: BuildAuthorizationUrlOptions): string {
  const url = new URL("https://www.reddit.com/api/v1/authorize");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", options.state);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("duration", "permanent");
  url.searchParams.set("scope", options.scope);
  return url.toString();
}

export async function exchangeCodeForTokens(options: ExchangeCodeOptions): Promise<OAuthTokens> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  return exchangeForTokens(
    {
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
    },
    {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      userAgent: options.userAgent,
      fetchImpl,
      now,
      fallbackRefreshToken: null,
      mode: "login",
      redirectUri: options.redirectUri,
    },
  );
}

export async function refreshAccessToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
  userAgent: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<OAuthTokens> {
  return exchangeForTokens(
    {
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
    },
    {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      userAgent: options.userAgent,
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? Date.now,
      fallbackRefreshToken: options.refreshToken,
      mode: "refresh",
    },
  );
}

export async function fetchRedditIdentity(
  options: FetchIdentityOptions,
): Promise<RedditIdentity> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://oauth.reddit.com/api/v1/me", {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "User-Agent": options.userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Reddit identity fetch failed with HTTP ${response.status}`);
  }

  return (await response.json()) as RedditIdentity;
}

export async function authorizeWithReddit(options: AuthorizeWithRedditOptions): Promise<{
  authUrl: string;
  tokens: OAuthTokens;
  identity: RedditIdentity;
}> {
  const state = options.createState?.() ?? crypto.randomUUID();
  const authUrl = buildAuthorizationUrl({
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    scope: options.scope,
    state,
  });

  const callbackPromise = (options.waitForCallback ?? waitForOAuthCallback)(
    options.redirectUri,
    options.timeoutSeconds,
  );

  const openExternal = options.openExternal ?? openInBrowser;
  await openExternal(authUrl);

  const callback = await callbackPromise;
  if (callback.state !== state) {
    throw new Error("OAuth state mismatch. Please try login again.");
  }

  const tokens = await exchangeCodeForTokens({
    code: callback.code,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: options.redirectUri,
      userAgent: options.userAgent,
      fetchImpl: options.fetchImpl,
    });
  const identity = await fetchRedditIdentity({
    accessToken: tokens.accessToken,
    userAgent: options.userAgent,
    fetchImpl: options.fetchImpl,
  });

  return { authUrl, tokens, identity };
}

async function exchangeForTokens(
  body: Record<string, string>,
  options: {
    clientId: string;
    clientSecret?: string | null;
    userAgent: string;
    fetchImpl: FetchLike;
    now: () => number;
    fallbackRefreshToken: string | null;
    mode: "login" | "refresh";
    redirectUri?: string;
  },
): Promise<OAuthTokens> {
  const response = await options.fetchImpl("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": options.userAgent,
      Authorization: `Basic ${Buffer.from(
        `${options.clientId}:${options.clientSecret ?? ""}`,
      ).toString("base64")}`,
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    throw new Error(await redditTokenErrorMessage(response, options.mode, options.redirectUri));
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
  };

  if (payload.error) {
    throw new Error(mapRedditError(payload.error, options.mode, options.redirectUri));
  }
  if (!payload.access_token) {
    throw new Error("Reddit token response was missing access_token.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? options.fallbackRefreshToken,
    scope: payload.scope ?? "",
    expiresAt: options.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

async function redditTokenErrorMessage(
  response: Response,
  mode: "login" | "refresh",
  redirectUri: string | undefined,
): Promise<string> {
  let errorCode = "";
  try {
    const body = await response.text();
    try {
      const json = JSON.parse(body) as { error?: unknown; message?: unknown };
      if (typeof json.error === "string") errorCode = json.error;
      else if (typeof json.message === "string") errorCode = json.message;
    } catch {
      // body is not JSON; leave errorCode empty
    }
  } catch {
    // body read failed; leave errorCode empty
  }
  if (errorCode) return mapRedditError(errorCode, mode, redirectUri);
  return `Reddit token exchange failed with HTTP ${response.status}.`;
}

function mapRedditError(
  errorCode: string,
  mode: "login" | "refresh",
  redirectUri: string | undefined,
): string {
  if (errorCode === "invalid_grant") {
    return mode === "refresh"
      ? "Reddit rejected the refresh token (invalid_grant). Run `reddit-cli auth login` to reauthenticate."
      : "Reddit rejected the authorization code (invalid_grant). The code may have expired; run `reddit-cli auth login` again.";
  }
  if (errorCode === "invalid_client") {
    return "Reddit rejected the client credentials (invalid_client). Check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.";
  }
  if (errorCode === "redirect_uri_mismatch") {
    return `Reddit rejected the redirect URI (redirect_uri_mismatch). The CLI sent ${redirectUri ?? "<unknown>"}. Register this exact URI in your Reddit app settings.`;
  }
  return `Reddit token exchange failed: ${errorCode}.`;
}

export async function waitForOAuthCallback(
  redirectUri: string,
  timeoutSeconds: number,
  createServerImpl: CreateServerLike = createServer,
): Promise<{
  code: string;
  state: string;
}> {
  const target = new URL(redirectUri);
  if (target.protocol !== "http:") {
    throw new Error("Reddit CLI callback URI must use http:// for local loopback login.");
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServerImpl((request, response) => {
      try {
        handleCallbackRequest(request, response, target.pathname, resolvePromise, rejectPromise);
      } catch (error) {
        rejectPromise(error as Error);
      } finally {
        setTimeout(() => server.close(), 50);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      rejectPromise(new Error("OAuth login timed out waiting for the Reddit callback."));
    }, timeoutSeconds * 1000);

    if (typeof (server as { on?: unknown }).on === "function") {
      (server as { on: (event: string, cb: (err: NodeJS.ErrnoException) => void) => void }).on(
        "error",
        (err) => {
          clearTimeout(timer);
          if (err.code === "EADDRINUSE") {
            rejectPromise(
              new Error(
                `Port ${target.port || 80} is already in use. Another reddit-cli login may be running, or set REDDIT_CLI_REDIRECT_URI to a different port.`,
              ),
            );
          } else {
            rejectPromise(err);
          }
        },
      );
    }

    server.listen(Number(target.port || 80), target.hostname, () => {
      void timer;
    });
  });
}

function handleCallbackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedPath: string,
  resolvePromise: (value: { code: string; state: string }) => void,
  rejectPromise: (error: Error) => void,
): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== expectedPath) {
    response.writeHead(404).end("Not found");
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    response.writeHead(200).end("Reddit authorization failed. Return to the terminal.");
    rejectPromise(new Error(`Reddit authorization failed: ${error}`));
    return;
  }

  if (!code || !state) {
    response.writeHead(200).end("Missing code or state. Return to the terminal.");
    rejectPromise(new Error("OAuth callback missing code or state."));
    return;
  }

  response.writeHead(200).end("Reddit authorization complete. You can close this tab.");
  resolvePromise({ code, state });
}

export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnImpl: SpawnLike = spawn,
): void {
  const command =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/C", "start", "", url]
        : ["xdg-open", url];
  const child = spawnImpl(command[0]!, command.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
