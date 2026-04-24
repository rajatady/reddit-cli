import { describe, expect, test } from "bun:test";
import {
  authorizeWithReddit,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  fetchRedditIdentity,
  openInBrowser,
  refreshAccessToken,
  waitForOAuthCallback,
} from "../src/lib/oauth.ts";

describe("oauth", () => {
  test("builds the reddit authorization url", () => {
    const url = buildAuthorizationUrl({
      clientId: "client-123",
      redirectUri: "http://127.0.0.1:9780/callback",
      scope: "identity read history",
      state: "state-123",
    });

    expect(url).toContain("https://www.reddit.com/api/v1/authorize");
    expect(url).toContain("client_id=client-123");
    expect(url).toContain("duration=permanent");
    expect(url).toContain("scope=identity+read+history");
    expect(url).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A9780%2Fcallback");
  });

  test("exchanges an authorization code for tokens", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const tokens = await exchangeCodeForTokens({
      code: "code-123",
      clientId: "client-123",
      clientSecret: "secret-123",
      redirectUri: "http://127.0.0.1:9780/callback",
      userAgent: "reddit-cli/test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            access_token: "access-123",
            refresh_token: "refresh-123",
            scope: "identity read history",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      now: () => 1_700_000_000_000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://www.reddit.com/api/v1/access_token");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toContain("Basic ");
    expect((calls[0]?.init?.headers as Record<string, string>)["User-Agent"]).toBe("reddit-cli/test");
    expect(tokens.accessToken).toBe("access-123");
    expect(tokens.refreshToken).toBe("refresh-123");
    expect(tokens.expiresAt).toBe(1_700_000_000_000 + 3_600_000);
  });

  test("fetches the reddit identity", async () => {
    const me = await fetchRedditIdentity({
      accessToken: "access-123",
      userAgent: "reddit-cli/test",
      fetchImpl: async () =>
        new Response(JSON.stringify({ name: "consistent_yak", id: "user_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(me.name).toBe("consistent_yak");
    expect(me.id).toBe("user_123");
  });

  test("refreshes an access token while preserving the refresh token when reddit omits it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const tokens = await refreshAccessToken({
      refreshToken: "refresh-123",
      clientId: "client-123",
      clientSecret: "secret-123",
      userAgent: "reddit-cli/test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            access_token: "access-456",
            scope: "identity read history",
            expires_in: 1800,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      now: () => 1_700_000_000_000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://www.reddit.com/api/v1/access_token");
    expect((calls[0]?.init?.headers as Record<string, string>)["User-Agent"]).toBe("reddit-cli/test");
    expect(tokens.accessToken).toBe("access-456");
    expect(tokens.refreshToken).toBe("refresh-123");
    expect(tokens.expiresAt).toBe(1_700_000_000_000 + 1_800_000);
  });

  test("rejects failed token exchange and identity fetches", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "bad-code",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () => new Response("nope", { status: 401 }),
      }),
    ).rejects.toThrow("Reddit token exchange failed");

    await expect(
      fetchRedditIdentity({
        accessToken: "bad-token",
        userAgent: "reddit-cli/test",
        fetchImpl: async () => new Response("nope", { status: 403 }),
      }),
    ).rejects.toThrow("Reddit identity fetch failed");
  });

  test("maps invalid_grant on login to a reauth-oriented message", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "stale",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("authorization code");
  });

  test("maps invalid_grant on refresh to a run-auth-login message", async () => {
    await expect(
      refreshAccessToken({
        refreshToken: "revoked",
        clientId: "client-123",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("redditer auth login");
  });

  test("maps redirect_uri_mismatch to include the uri the cli sent", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "code-1",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "redirect_uri_mismatch" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("http://127.0.0.1:9780/callback");
  });

  test("maps invalid_client to a credentials-oriented message", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "code-1",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_client" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("REDDIT_CLIENT_ID");
  });

  test("falls back to the status when reddit returns a non-json error body", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "code-1",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () => new Response("<html>503</html>", { status: 503 }),
      }),
    ).rejects.toThrow("HTTP 503");
  });

  test("surfaces unknown reddit error codes verbatim", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "code-1",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("rate_limited");
  });

  test("throws when the token response is missing access_token", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "code-1",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ refresh_token: "r" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("missing access_token");
  });

  test("throws when a 200 response carries an error field", async () => {
    await expect(
      exchangeCodeForTokens({
        code: "code-1",
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("authorization code");
  });

  test("waitForOAuthCallback maps EADDRINUSE to an actionable message", async () => {
    const { createServer } = await import("node:http");
    const blocker = createServer(() => {});
    await new Promise<void>((resolve) => blocker.listen(9831, "127.0.0.1", () => resolve()));
    try {
      await expect(waitForOAuthCallback("http://127.0.0.1:9831/callback", 2)).rejects.toThrow(
        "already in use",
      );
    } finally {
      blocker.close();
    }
  });

  test("completes the authorize flow with injected callback handling", async () => {
    const opened: string[] = [];
    const result = await authorizeWithReddit({
        clientId: "client-123",
        clientSecret: "secret-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        scope: "identity read history",
        timeoutSeconds: 1,
      createState: () => "state-123",
      waitForCallback: async () => ({ code: "code-123", state: "state-123" }),
      openExternal: async (url) => {
        opened.push(url);
      },
      fetchImpl: async (url) => {
        if (String(url).includes("access_token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-123",
              refresh_token: "refresh-123",
              scope: "identity read history",
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ name: "yak", id: "user-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(opened).toHaveLength(1);
    expect(result.authUrl).toContain("state=state-123");
    expect(result.tokens.accessToken).toBe("access-123");
    expect(result.identity.name).toBe("yak");
  });

  test("rejects oauth state mismatches", async () => {
    await expect(
      authorizeWithReddit({
        clientId: "client-123",
        redirectUri: "http://127.0.0.1:9780/callback",
        userAgent: "reddit-cli/test",
        scope: "identity read history",
        timeoutSeconds: 1,
        createState: () => "state-123",
        waitForCallback: async () => ({ code: "code-123", state: "wrong-state" }),
        openExternal: async () => {},
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
    ).rejects.toThrow("OAuth state mismatch");
  });

  test("waits for a real loopback callback and handles bad callback inputs", async () => {
    const success = waitForOAuthCallback(
      "http://127.0.0.1:9791/callback",
      1,
      createFakeServer("/callback?code=code-123&state=state-123"),
    );
    await expect(success).resolves.toEqual({ code: "code-123", state: "state-123" });

    const withError = waitForOAuthCallback(
      "http://127.0.0.1:9792/callback",
      1,
      createFakeServer("/callback?error=access_denied"),
    );
    await expect(withError).rejects.toThrow("Reddit authorization failed");

    const missingState = waitForOAuthCallback(
      "http://127.0.0.1:9793/callback",
      1,
      createFakeServer("/callback?code=code-123"),
    );
    await expect(missingState).rejects.toThrow("OAuth callback missing code or state");

    const wrongPath = waitForOAuthCallback(
      "http://127.0.0.1:9794/callback",
      0.01,
      createFakeServer("/wrong-path?code=code-123&state=state-123"),
    );
    await expect(wrongPath).rejects.toThrow("OAuth login timed out");

    const throwingHandler = waitForOAuthCallback(
      "http://127.0.0.1:9795/callback",
      1,
      createFakeServer("/callback?code=code-123&state=state-123", {
        throwOnWriteHead: true,
      }),
    );
    await expect(throwingHandler).rejects.toThrow("writeHead failed");

    const timeout = waitForOAuthCallback(
      "http://127.0.0.1:9796/callback",
      0.01,
      createIdleFakeServer(),
    );
    await expect(timeout).rejects.toThrow("OAuth login timed out");

    await expect(waitForOAuthCallback("https://127.0.0.1:9797/callback", 1)).rejects.toThrow(
      "must use http://",
    );
  });

  test("opens the browser using the platform command", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const fakeChild = { unref: () => {} } as ReturnType<typeof Bun.spawn>;
    const fakeSpawn = ((command: string, args: string[]) => {
      calls.push({ command, args });
      return fakeChild;
    }) as unknown as typeof import("node:child_process").spawn;

    openInBrowser("https://example.com", "linux", fakeSpawn);
    openInBrowser("https://example.com", "darwin", fakeSpawn);
    openInBrowser("https://example.com", "win32", fakeSpawn);

    expect(calls[0]).toEqual({ command: "xdg-open", args: ["https://example.com"] });
    expect(calls[1]).toEqual({ command: "open", args: ["https://example.com"] });
    expect(calls[2]).toEqual({
      command: "cmd",
      args: ["/C", "start", "", "https://example.com"],
    });
  });
});

function createFakeServer(
  requestUrl: string,
  options: { throwOnWriteHead?: boolean } = {},
) {
  return ((handler: (request: any, response: any) => void) => {
    return {
      close: () => {},
      on: () => {},
      listen: (_port: number, _hostname: string, callback: () => void) => {
        callback();
        queueMicrotask(() => {
          handler(
            { url: requestUrl },
            {
              writeHead() {
                if (options.throwOnWriteHead) {
                  throw new Error("writeHead failed");
                }
                return this;
              },
              end() {
                return this;
              },
            },
          );
        });
      },
    };
  }) as any;
}

function createIdleFakeServer() {
  return ((_handler: (request: any, response: any) => void) => {
    return {
      close: () => {},
      on: () => {},
      listen: (_port: number, _hostname: string, callback: () => void) => {
        callback();
      },
    };
  }) as any;
}
