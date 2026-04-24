import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { VERSION } from "./version.ts";

export interface AccountSummary {
  id: string;
  label: string | null;
  username: string | null;
  redditUserId: string | null;
  isActive: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt: number | null;
}

export interface Config {
  baseUrl: string;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  userAgent: string;
  scope: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  username: string | null;
  redditUserId: string | null;
  activeAccountId: string | null;
  accounts: AccountSummary[];
}

interface PersistedApp {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  userAgent?: string;
  scope?: string;
}

interface PersistedAccount {
  label?: string;
  username?: string;
  redditUserId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

interface Persisted {
  activeAccountId: string | null;
  app: PersistedApp;
  accounts: Record<string, PersistedAccount>;
}

interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  cwd?: string;
}

interface SaveConfigOptions {
  homeDir?: string;
}

interface SaveAuthenticatedAccountOptions extends SaveConfigOptions {
  baseUrl?: string;
  clientId: string | null;
  clientSecret?: string | null;
  redirectUri: string;
  userAgent: string;
  scope: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number;
  username?: string | null;
  redditUserId?: string | null;
  label?: string | null;
  now?: number;
}

interface UpdateActiveAccountTokensOptions extends SaveConfigOptions {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number;
  scope?: string;
  now?: number;
}

const DEFAULT_BASE_URL = "https://oauth.reddit.com";
const DEFAULT_SCOPE = "identity read history";
const DEFAULT_USER_AGENT = `redditer/${VERSION}`;

const COMPAT_ENV_NAMES = {
  clientId: ["REDDIT_CLI_CLIENT_ID", "REDDIT_CLIENT_ID"],
  clientSecret: ["REDDIT_CLI_CLIENT_SECRET", "REDDIT_CLIENT_SECRET"],
  redirectUri: ["REDDIT_CLI_REDIRECT_URI", "REDDIT_REDIRECT_URI"],
  userAgent: ["REDDIT_CLI_USER_AGENT", "REDDIT_USER_AGENT"],
  scope: ["REDDIT_CLI_SCOPE"],
  baseUrl: ["REDDIT_CLI_BASE_URL"],
  accessToken: ["REDDIT_CLI_ACCESS_TOKEN"],
  refreshToken: ["REDDIT_CLI_REFRESH_TOKEN"],
} as const;

function envAny(
  env: Record<string, string | undefined>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readDotEnvFiles(
  cwd: string | undefined,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const explicitEnvFile = env.REDDIT_CLI_ENV_FILE;
  const files = explicitEnvFile
    ? [explicitEnvFile]
    : cwd
      ? [join(cwd, ".env"), join(cwd, ".env.local")]
      : [];

  const merged: Record<string, string> = {};
  for (const file of files) {
    if (!existsSync(file)) continue;
    Object.assign(merged, parseDotEnv(readFileSync(file, "utf8")));
  }
  return merged;
}

function emptyPersisted(): Persisted {
  return { activeAccountId: null, app: {}, accounts: {} };
}

export function configPath(options: SaveConfigOptions = {}): string {
  return join(options.homeDir ?? homedir(), ".reddit-cli", "config.json");
}

function readPersisted(options: SaveConfigOptions = {}): Persisted {
  const path = configPath(options);
  if (!existsSync(path)) return emptyPersisted();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Persisted>;
    return {
      activeAccountId: raw.activeAccountId ?? null,
      app: { ...(raw.app ?? {}) },
      accounts: { ...(raw.accounts ?? {}) },
    };
  } catch {
    return emptyPersisted();
  }
}

function writePersisted(config: Persisted, options: SaveConfigOptions = {}): string {
  const path = configPath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const env = options.env ?? process.env;
  const envFile = readDotEnvFiles(options.cwd, env);
  const persisted = readPersisted({ homeDir: options.homeDir });
  const active = persisted.activeAccountId ? persisted.accounts[persisted.activeAccountId] : undefined;
  const app = persisted.app;

  const pick = (names: readonly string[], envFileKeys: readonly string[], saved: string | undefined, fallback?: string) =>
    envAny(env, names) ?? envFileKeys.map((k) => envFile[k]).find((v) => v != null && v !== "") ?? saved ?? fallback;

  const accounts: AccountSummary[] = Object.entries(persisted.accounts).map(([id, account]) => ({
    id,
    label: account.label ?? null,
    username: account.username ?? null,
    redditUserId: account.redditUserId ?? null,
    isActive: id === persisted.activeAccountId,
    hasAccessToken: !!account.accessToken,
    hasRefreshToken: !!account.refreshToken,
    expiresAt: account.expiresAt ?? null,
  }));

  return {
    baseUrl: pick(COMPAT_ENV_NAMES.baseUrl, ["REDDIT_CLI_BASE_URL"], app.baseUrl, DEFAULT_BASE_URL)!,
    clientId: pick(COMPAT_ENV_NAMES.clientId, ["REDDIT_CLI_CLIENT_ID", "REDDIT_CLIENT_ID"], app.clientId) ?? null,
    clientSecret: pick(COMPAT_ENV_NAMES.clientSecret, ["REDDIT_CLI_CLIENT_SECRET", "REDDIT_CLIENT_SECRET"], app.clientSecret) ?? null,
    redirectUri: pick(COMPAT_ENV_NAMES.redirectUri, ["REDDIT_CLI_REDIRECT_URI", "REDDIT_REDIRECT_URI"], app.redirectUri) ?? null,
    userAgent: pick(COMPAT_ENV_NAMES.userAgent, ["REDDIT_CLI_USER_AGENT", "REDDIT_USER_AGENT"], app.userAgent, DEFAULT_USER_AGENT)!,
    scope: pick(COMPAT_ENV_NAMES.scope, ["REDDIT_CLI_SCOPE"], app.scope, DEFAULT_SCOPE)!,
    accessToken: envAny(env, COMPAT_ENV_NAMES.accessToken) ?? active?.accessToken ?? null,
    refreshToken: envAny(env, COMPAT_ENV_NAMES.refreshToken) ?? active?.refreshToken ?? null,
    expiresAt: active?.expiresAt ?? null,
    username: active?.username ?? null,
    redditUserId: active?.redditUserId ?? null,
    activeAccountId: persisted.activeAccountId,
    accounts,
  };
}

function deriveAccountId(username: string | null | undefined, redditUserId: string | null | undefined): string {
  const base = username ?? redditUserId;
  return base ? `acct_${base}` : "acct_primary";
}

function findExistingAccountId(
  persisted: Persisted,
  username: string | null | undefined,
  redditUserId: string | null | undefined,
): string | null {
  if (redditUserId) {
    for (const [id, acct] of Object.entries(persisted.accounts)) {
      if (acct.redditUserId === redditUserId) return id;
    }
  }
  if (username) {
    for (const [id, acct] of Object.entries(persisted.accounts)) {
      if (acct.username === username) return id;
    }
  }
  return null;
}

export function saveAuthenticatedAccount(options: SaveAuthenticatedAccountOptions): {
  path: string;
  accountId: string;
} {
  const persisted = readPersisted({ homeDir: options.homeDir });
  const existing = findExistingAccountId(persisted, options.username, options.redditUserId);
  const accountId = existing ?? deriveAccountId(options.username, options.redditUserId);
  const now = options.now ?? Date.now();
  const current = persisted.accounts[accountId];

  const next: Persisted = {
    activeAccountId: accountId,
    app: {
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      clientId: options.clientId ?? undefined,
      clientSecret: options.clientSecret ?? undefined,
      redirectUri: options.redirectUri,
      userAgent: options.userAgent,
      scope: options.scope,
    },
    accounts: {
      ...persisted.accounts,
      [accountId]: {
        ...current,
        label: options.label ?? current?.label ?? options.username ?? options.redditUserId ?? undefined,
        username: options.username ?? current?.username ?? undefined,
        redditUserId: options.redditUserId ?? current?.redditUserId ?? undefined,
        accessToken: options.accessToken,
        refreshToken: options.refreshToken ?? current?.refreshToken ?? undefined,
        expiresAt: options.expiresAt,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      },
    },
  };

  return { path: writePersisted(next, { homeDir: options.homeDir }), accountId };
}

export function updateActiveAccountTokens(
  options: UpdateActiveAccountTokensOptions,
): { path: string; accountId: string } {
  const persisted = readPersisted({ homeDir: options.homeDir });
  const accountId = persisted.activeAccountId;
  if (!accountId || !persisted.accounts[accountId]) {
    throw new Error("No active Reddit account is saved locally.");
  }

  const account = persisted.accounts[accountId]!;
  const now = options.now ?? Date.now();

  const next: Persisted = {
    ...persisted,
    app: {
      ...persisted.app,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
    },
    accounts: {
      ...persisted.accounts,
      [accountId]: {
        ...account,
        accessToken: options.accessToken,
        refreshToken: options.refreshToken ?? account.refreshToken,
        expiresAt: options.expiresAt,
        updatedAt: now,
      },
    },
  };

  return { path: writePersisted(next, { homeDir: options.homeDir }), accountId };
}

function resolveAccountId(persisted: Persisted, identifier: string): string | null {
  if (persisted.accounts[identifier]) return identifier;
  for (const [id, acct] of Object.entries(persisted.accounts)) {
    if (acct.username === identifier || acct.label === identifier) return id;
  }
  return null;
}

export function setActiveAccount(
  identifier: string,
  options: SaveConfigOptions = {},
): { path: string; accountId: string } {
  const persisted = readPersisted(options);
  const accountId = resolveAccountId(persisted, identifier);
  if (!accountId) {
    throw new Error(`No saved Reddit account matches ${identifier}`);
  }
  const next: Persisted = { ...persisted, activeAccountId: accountId };
  return { path: writePersisted(next, options), accountId };
}

export function removeActiveAccount(options: SaveConfigOptions = {}): {
  path: string;
  removedAccountId: string;
  removedUsername: string | null;
} {
  const persisted = readPersisted(options);
  const removedAccountId = persisted.activeAccountId;
  if (!removedAccountId || !persisted.accounts[removedAccountId]) {
    throw new Error("No active Reddit account is saved locally.");
  }

  const removedAccount = persisted.accounts[removedAccountId]!;
  const nextAccounts = { ...persisted.accounts };
  delete nextAccounts[removedAccountId];
  const remainingIds = Object.keys(nextAccounts);

  const next: Persisted = {
    ...persisted,
    activeAccountId: remainingIds[0] ?? null,
    accounts: nextAccounts,
  };

  return {
    path: writePersisted(next, options),
    removedAccountId,
    removedUsername: removedAccount.username ?? null,
  };
}

export function readableConfigSnapshot(config: Config): string {
  return [
    `baseUrl: ${config.baseUrl}`,
    `clientId: ${config.clientId ?? "(unset)"}`,
    `clientSecret: ${config.clientSecret ? "<present>" : "(missing)"}`,
    `redirectUri: ${config.redirectUri ?? "(unset)"}`,
    `userAgent: ${config.userAgent}`,
    `scope: ${config.scope}`,
    `activeAccountId: ${config.activeAccountId ?? "(none)"}`,
    `knownAccounts: ${config.accounts.length}`,
    `username: ${config.username ?? "(unknown)"}`,
    `redditUserId: ${config.redditUserId ?? "(unknown)"}`,
    `accessToken: ${config.accessToken ? "<present>" : "(missing)"}`,
    `refreshToken: ${config.refreshToken ? "<present>" : "(missing)"}`,
    `expiresAt: ${config.expiresAt ?? "(unknown)"}`,
  ].join("\n");
}
