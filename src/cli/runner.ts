import { loadConfig } from "../lib/config.ts";
import { History, resolveHistoryPath } from "../lib/history.ts";
import { Monitors, resolveMonitorsPath } from "../lib/monitors.ts";
import {
  authorizeWithReddit as defaultAuthorizeWithReddit,
  refreshAccessToken as defaultRefreshAccessToken,
} from "../lib/oauth.ts";
import { redditFetch as defaultRedditFetch } from "../lib/reddit-fetch.ts";
import { buildRegistry, findTool } from "../lib/registry.ts";

import { AuthCommand } from "./auth-command.ts";
import { renderHelp, renderModuleHelp, renderToolHelp, renderToolsList } from "./help.ts";
import { HistoryCommand } from "./history-command.ts";
import { MonitorsCommand } from "./monitors-command.ts";
import { parseToolArgs, stripCliFields } from "./parse-args.ts";
import { findClosest } from "./strings.ts";
import { ToolExecutor } from "./tool-executor.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RunCliOptions {
  cwd?: string;
  configCwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  now?: () => number;
  createId?: () => string;
  createState?: () => string;
  authorizeWithReddit?: typeof defaultAuthorizeWithReddit;
  refreshAccessToken?: typeof defaultRefreshAccessToken;
  redditFetch?: typeof defaultRedditFetch;
  fetchImpl?: FetchLike;
  printLine?: (line: string) => void;
  forkedFrom?: string | null;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<CliResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => `hist_${Math.random().toString(36).slice(2, 10)}`);
  const createState = options.createState ?? (() => crypto.randomUUID());
  const authorizeWithReddit = options.authorizeWithReddit ?? defaultAuthorizeWithReddit;
  const refreshAccessToken = options.refreshAccessToken ?? defaultRefreshAccessToken;
  const redditFetch = options.redditFetch ?? defaultRedditFetch;
  const printLine = options.printLine ?? (() => {});
  const forkedFrom = options.forkedFrom ?? null;

  const stdout: string[] = [];
  const stderr: string[] = [];

  const registry = buildRegistry();
  const config = loadConfig({
    env,
    homeDir: options.homeDir,
    cwd: options.configCwd ?? cwd,
  });
  const history = new History(resolveHistoryPath({ env, cwd }));

  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    stdout.push(renderHelp(registry));
    return done(0, stdout, stderr);
  }

  if (argv[0] === "tools" && argv[1] === "list") {
    stdout.push(renderToolsList(registry));
    return done(0, stdout, stderr);
  }

  if (argv[0] === "history") {
    const command = new HistoryCommand({
      history,
      now,
      runCli: (forkArgv, forked) => runCli(forkArgv, { ...options, forkedFrom: forked }),
    });
    const result = await command.run(argv.slice(1));
    return done(result.exitCode, [...stdout, ...result.stdoutLines], [...stderr, ...result.stderrLines]);
  }

  if (argv[0] === "monitors") {
    const command = new MonitorsCommand({
      monitors: new Monitors(resolveMonitorsPath({ env, cwd })),
      history,
      homeDir: options.homeDir,
      configCwd: options.configCwd ?? cwd,
      env,
      fetchImpl: options.fetchImpl,
      redditFetch,
      refreshAccessToken,
      now,
      createId,
      forkedFrom,
    });
    const result = await command.run(argv.slice(1));
    return done(result.exitCode, [...stdout, ...result.stdoutLines], [...stderr, ...result.stderrLines]);
  }

  const moduleName = argv[0]!;
  const moduleDef = registry.modules[moduleName];
  if (!moduleDef) {
    const suggestion = findClosest(moduleName, [
      ...Object.keys(registry.modules),
      "history",
      "tools",
      "monitors",
    ]);
    stderr.push(`Unknown command: ${moduleName}`);
    if (suggestion) stderr.push(`Did you mean '${suggestion}'?`);
    stdout.push(renderHelp(registry));
    return done(1, stdout, stderr);
  }

  const toolName = argv[1];
  if (!toolName || toolName.startsWith("--")) {
    stderr.push(`Missing subcommand for module '${moduleName}'.`);
    stdout.push(renderModuleHelp(registry, moduleName));
    return done(1, stdout, stderr);
  }

  const tool = findTool(registry, moduleName, toolName);
  if (!tool) {
    const suggestion = findClosest(toolName, moduleDef.tools);
    stderr.push(`Unknown subcommand '${toolName}' for module '${moduleName}'.`);
    if (suggestion) stderr.push(`Did you mean '${suggestion}'?`);
    stdout.push(renderModuleHelp(registry, moduleName));
    return done(1, stdout, stderr);
  }

  if (argv.slice(2).includes("--help")) {
    stdout.push(renderToolHelp(moduleName, toolName, tool));
    return done(0, stdout, stderr);
  }

  if (moduleName === "auth") {
    const command = new AuthCommand({
      config,
      homeDir: options.homeDir,
      createState,
      authorizeWithReddit,
      refreshAccessToken,
      now,
      printLine,
    });
    const result = await command.run(toolName, argv.slice(2), tool.options);
    return done(result.exitCode, [...stdout, ...result.stdoutLines], [...stderr, ...result.stderrLines]);
  }

  const parsed = parseToolArgs(argv.slice(2), tool.options);
  if (parsed.error) {
    stderr.push(parsed.error);
    return done(1, stdout, stderr);
  }
  if (!parsed.values.why) {
    stderr.push("--why is required for every tool run.");
    return done(1, stdout, stderr);
  }

  const executor = new ToolExecutor({
    config,
    history,
    homeDir: options.homeDir,
    configCwd: options.configCwd ?? cwd,
    env,
    redditFetch,
    fetchImpl: options.fetchImpl,
    now,
    createId,
    forkedFrom,
  });
  const result = await executor.run(moduleName, toolName, tool, parsed.values, stripCliFields);
  return done(result.exitCode, [...stdout, ...result.stdoutLines], [...stderr, ...result.stderrLines]);
}

function done(exitCode: number, stdout: string[], stderr: string[]): CliResult {
  return {
    exitCode,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}
