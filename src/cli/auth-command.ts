import {
  configPath,
  loadConfig,
  readableConfigSnapshot,
  removeActiveAccount,
  saveAuthenticatedAccount,
  setActiveAccount,
  updateActiveAccountTokens,
} from "../lib/config.ts";
import {
  authorizeWithReddit as defaultAuthorizeWithReddit,
  buildAuthorizationUrl,
  refreshAccessToken as defaultRefreshAccessToken,
} from "../lib/oauth.ts";
import type { ToolOptionDefinition } from "../lib/registry.ts";
import { parseToolArgs } from "./parse-args.ts";
import { renderAccounts } from "./help.ts";

export interface AuthCommandContext {
  config: ReturnType<typeof loadConfig>;
  homeDir?: string;
  createState: () => string;
  authorizeWithReddit: typeof defaultAuthorizeWithReddit;
  refreshAccessToken: typeof defaultRefreshAccessToken;
  now: () => number;
  printLine: (line: string) => void;
}

export interface AuthCommandResult {
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
}

export class AuthCommand {
  constructor(private readonly ctx: AuthCommandContext) {}

  async run(
    toolName: string,
    args: string[],
    schema: Record<string, ToolOptionDefinition>,
  ): Promise<AuthCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    if (toolName === "whoami") {
      stdoutLines.push(readableConfigSnapshot(this.ctx.config));
      stdoutLines.push(`configPath: ${configPath({ homeDir: this.ctx.homeDir })}`);
      return { exitCode: 0, stdoutLines, stderrLines };
    }

    if (toolName === "accounts") {
      stdoutLines.push(renderAccounts(this.ctx.config));
      return { exitCode: 0, stdoutLines, stderrLines };
    }

    const parsed = parseToolArgs(args, schema);
    if (parsed.error) {
      stderrLines.push(parsed.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }

    if (toolName === "login") return this.login(parsed.values);
    if (toolName === "refresh") return this.refresh(parsed.values);
    if (toolName === "logout") return this.logout(parsed.values);
    if (toolName === "use") return this.use(parsed.values);

    stderrLines.push(`Unknown auth command: ${toolName}`);
    return { exitCode: 1, stdoutLines, stderrLines };
  }

  private async login(values: Record<string, unknown>): Promise<AuthCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    if (!this.ctx.config.clientId) {
      stderrLines.push(
        "Missing Reddit client id. Set REDDIT_CLI_CLIENT_ID or save it in ~/.reddit-cli/config.json first.",
      );
      return { exitCode: 1, stdoutLines, stderrLines };
    }

    const redirectUri = this.ctx.config.redirectUri ?? "http://127.0.0.1:9780/callback";
    const state = this.ctx.createState();
    const authUrl = buildAuthorizationUrl({
      clientId: this.ctx.config.clientId,
      redirectUri,
      scope: this.ctx.config.scope,
      state,
    });

    if (values.dryRun) {
      stdoutLines.push(
        [
          "AUTH DRY RUN",
          `redirectUri: ${redirectUri}`,
          `userAgent: ${this.ctx.config.userAgent}`,
          `scope: ${this.ctx.config.scope}`,
          `authUrl: ${authUrl}`,
        ].join("\n"),
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    }

    const openMessage = `Opening Reddit authorization in your browser. If it doesn't open, visit:\n  ${authUrl}`;
    this.ctx.printLine(openMessage);
    stdoutLines.push(openMessage);

    try {
      const result = await this.ctx.authorizeWithReddit({
        clientId: this.ctx.config.clientId,
        clientSecret: this.ctx.config.clientSecret,
        redirectUri,
        userAgent: this.ctx.config.userAgent,
        scope: this.ctx.config.scope,
        timeoutSeconds: 300,
        createState: () => state,
      });

      const saved = saveAuthenticatedAccount({
        baseUrl: this.ctx.config.baseUrl,
        clientId: this.ctx.config.clientId,
        clientSecret: this.ctx.config.clientSecret,
        redirectUri,
        userAgent: this.ctx.config.userAgent,
        scope: result.tokens.scope || this.ctx.config.scope,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresAt: result.tokens.expiresAt,
        username: result.identity.name,
        redditUserId: result.identity.id,
        homeDir: this.ctx.homeDir,
        now: this.ctx.now(),
      });

      stdoutLines.push(
        [
          "Authenticated with Reddit.",
          `username: ${result.identity.name ?? "(unknown)"}`,
          `scope: ${result.tokens.scope || this.ctx.config.scope}`,
          `accountId: ${saved.accountId}`,
          `savedTo: ${saved.path}`,
        ].join("\n"),
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    } catch (error) {
      stderrLines.push(error instanceof Error ? error.message : String(error));
      return { exitCode: 1, stdoutLines, stderrLines };
    }
  }

  private async refresh(values: Record<string, unknown>): Promise<AuthCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    if (!this.ctx.config.activeAccountId || !this.ctx.config.username) {
      stderrLines.push("No active Reddit account is saved locally.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    if (!this.ctx.config.refreshToken) {
      stderrLines.push("The active Reddit account does not have a refresh token.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    if (!this.ctx.config.clientId) {
      stderrLines.push("Missing Reddit client id for token refresh.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }

    if (values.dryRun) {
      stdoutLines.push(
        [
          "AUTH REFRESH DRY RUN",
          `activeAccountId: ${this.ctx.config.activeAccountId}`,
          `username: ${this.ctx.config.username}`,
          `userAgent: ${this.ctx.config.userAgent}`,
        ].join("\n"),
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    }

    try {
      const tokens = await this.ctx.refreshAccessToken({
        refreshToken: this.ctx.config.refreshToken,
        clientId: this.ctx.config.clientId,
        clientSecret: this.ctx.config.clientSecret,
        userAgent: this.ctx.config.userAgent,
        now: this.ctx.now,
      });
      const saved = updateActiveAccountTokens({
        homeDir: this.ctx.homeDir,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope || this.ctx.config.scope,
        now: this.ctx.now(),
      });
      stdoutLines.push(
        [
          "Refreshed Reddit access token.",
          `username: ${this.ctx.config.username}`,
          `accountId: ${saved.accountId}`,
          `savedTo: ${saved.path}`,
        ].join("\n"),
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    } catch (error) {
      stderrLines.push(error instanceof Error ? error.message : String(error));
      return { exitCode: 1, stdoutLines, stderrLines };
    }
  }

  private logout(values: Record<string, unknown>): AuthCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    if (!this.ctx.config.activeAccountId) {
      stderrLines.push("No active Reddit account is saved locally.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }

    if (values.dryRun) {
      stdoutLines.push(
        [
          "AUTH LOGOUT DRY RUN",
          `activeAccountId: ${this.ctx.config.activeAccountId}`,
          `username: ${this.ctx.config.username ?? "(unknown)"}`,
        ].join("\n"),
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    }

    try {
      const removed = removeActiveAccount({ homeDir: this.ctx.homeDir });
      stdoutLines.push(
        [
          `Logged out account ${removed.removedUsername ?? removed.removedAccountId}.`,
          `savedTo: ${removed.path}`,
        ].join("\n"),
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    } catch (error) {
      stderrLines.push(error instanceof Error ? error.message : String(error));
      return { exitCode: 1, stdoutLines, stderrLines };
    }
  }

  private use(values: Record<string, unknown>): AuthCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const account = String(values.account);
    try {
      setActiveAccount(account, { homeDir: this.ctx.homeDir });
      const nextConfig = loadConfig({ homeDir: this.ctx.homeDir });
      stdoutLines.push(
        `Active account set to ${nextConfig.username ?? nextConfig.activeAccountId ?? account}.`,
      );
      return { exitCode: 0, stdoutLines, stderrLines };
    } catch (error) {
      stderrLines.push(error instanceof Error ? error.message : String(error));
      return { exitCode: 1, stdoutLines, stderrLines };
    }
  }
}
