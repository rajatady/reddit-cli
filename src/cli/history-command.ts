import { formatRelativeTime, type History, type HistoryEntry } from "../lib/history.ts";
import { camelToKebab } from "./strings.ts";

export interface HistoryCommandContext {
  history: History;
  runCli: (argv: string[], forkedFrom: string) => Promise<CliLikeResult>;
  now: () => number;
}

export interface CliLikeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HistoryCommandResult {
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
}

export class HistoryCommand {
  constructor(private readonly ctx: HistoryCommandContext) {}

  async run(args: string[]): Promise<HistoryCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const subcommand = args[0] ?? "list";

    if (subcommand === "list") return this.list(args.slice(1));
    if (subcommand === "show") return this.show(args[1]);
    if (subcommand === "rerun" || subcommand === "fork") {
      return this.rerunOrFork(subcommand, args.slice(1));
    }

    stderrLines.push(`Unknown history subcommand: ${subcommand}`);
    return { exitCode: 1, stdoutLines, stderrLines };
  }

  private list(flagsArgs: string[]): HistoryCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const flags = parseHistoryListFlags(flagsArgs);
    if (flags.error) {
      stderrLines.push(flags.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const rows = this.ctx.history.list({
      limit: flags.limit,
      offset: flags.offset,
      module: flags.module,
      tool: flags.tool,
    });
    if (flags.json) {
      stdoutLines.push(JSON.stringify(rows, null, 2));
      return { exitCode: 0, stdoutLines, stderrLines };
    }
    if (rows.length === 0) {
      stdoutLines.push("(no history yet — run any tool to populate)");
      return { exitCode: 0, stdoutLines, stderrLines };
    }
    const nowMs = this.ctx.now();
    const lines: string[] = [];
    for (const r of rows) {
      const status = r.exitCode === 0 ? "ok" : `exit ${r.exitCode}`;
      const idShort = r.id.slice(0, 10);
      const rel = formatRelativeTime(r.createdAt, nowMs);
      const forked = r.forkedFrom ? ` (forked from ${r.forkedFrom.slice(0, 10)})` : "";
      lines.push(`${idShort}  ${rel}  ${r.module} ${r.tool}  ${status}${forked}`);
      lines.push(`    why: ${r.why}`);
    }
    stdoutLines.push(lines.join("\n"));
    return { exitCode: 0, stdoutLines, stderrLines };
  }

  private show(id: string | undefined): HistoryCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    if (!id) {
      stderrLines.push("history show requires an id or prefix.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const entry = this.ctx.history.get(id);
    if (!entry) {
      stderrLines.push(`No history entry matching ${id}`);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    stdoutLines.push(JSON.stringify(entry, null, 2));
    return { exitCode: 0, stdoutLines, stderrLines };
  }

  private async rerunOrFork(
    subcommand: "rerun" | "fork",
    args: string[],
  ): Promise<HistoryCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const id = args[0];
    if (!id) {
      stderrLines.push(`history ${subcommand} requires an id or prefix.`);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const entry = this.ctx.history.get(id);
    if (!entry) {
      stderrLines.push(`No history entry matching ${id}`);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const overrides =
      subcommand === "fork"
        ? parseSetOverrides(args.slice(1))
        : { values: {} as Record<string, unknown>, error: undefined as string | undefined };
    if (overrides.error) {
      stderrLines.push(overrides.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const mergedParams = { ...entry.params, ...overrides.values };
    const forkArgv = buildArgvFromEntry(entry, mergedParams);
    const result = await this.ctx.runCli(forkArgv, entry.id);
    if (result.stdout) stdoutLines.push(result.stdout);
    if (result.stderr) stderrLines.push(result.stderr);
    return { exitCode: result.exitCode, stdoutLines, stderrLines };
  }
}

export interface HistoryListFlags {
  limit: number;
  offset: number;
  module?: string;
  tool?: string;
  json: boolean;
  error?: string;
}

export function parseHistoryListFlags(args: string[]): HistoryListFlags {
  const flags: HistoryListFlags = { limit: 25, offset: 0, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") {
      flags.json = true;
      continue;
    }
    const next = args[i + 1];
    if (a === "--limit" && next !== undefined) {
      const n = Number(next);
      if (Number.isNaN(n)) return { ...flags, error: `--limit expected a number, got: ${next}` };
      flags.limit = n;
      i++;
      continue;
    }
    if (a === "--offset" && next !== undefined) {
      const n = Number(next);
      if (Number.isNaN(n)) return { ...flags, error: `--offset expected a number, got: ${next}` };
      flags.offset = n;
      i++;
      continue;
    }
    if (a === "--module" && next !== undefined) {
      flags.module = next;
      i++;
      continue;
    }
    if (a === "--tool" && next !== undefined) {
      flags.tool = next;
      i++;
      continue;
    }
    return { ...flags, error: `Unknown history list flag: ${a}` };
  }
  return flags;
}

export function parseSetOverrides(args: string[]): {
  values: Record<string, unknown>;
  error?: string;
} {
  const values: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--set") {
      return { values, error: `Unexpected argument: ${args[i]}` };
    }
    const pair = args[i + 1];
    if (!pair || !pair.includes("=")) {
      return { values, error: "--set requires key=value." };
    }
    const eq = pair.indexOf("=");
    values[pair.slice(0, eq)] = pair.slice(eq + 1);
    i++;
  }
  return { values };
}

export function buildArgvFromEntry(
  entry: Pick<HistoryEntry, "module" | "tool" | "why">,
  params: Record<string, unknown>,
): string[] {
  const argv = [entry.module, entry.tool];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    argv.push(`--${camelToKebab(key)}`);
    if (value !== true) argv.push(String(value));
  }
  argv.push("--why", entry.why);
  return argv;
}
