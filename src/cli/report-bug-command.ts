import { spawnSync } from "node:child_process";

import type { Config } from "../lib/config.ts";
import type { History, HistoryEntry } from "../lib/history.ts";
import { VERSION } from "../lib/version.ts";

const GITHUB_ISSUES_URL = "https://github.com/rajatady/reddit-cli/issues/new";

export interface ReportBugContext {
  config: Config;
  history: History;
  openBrowser?: (url: string) => void;
  printLine?: (line: string) => void;
}

export interface ReportBugResult {
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
}

interface ReportBugFlags {
  title?: string;
  what?: string;
  expected?: string;
  steps?: string;
  id?: string;
  last?: number;
}

export class ReportBugCommand {
  constructor(private readonly ctx: ReportBugContext) {}

  run(argv: string[]): ReportBugResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const parsed = parseReportBugFlags(argv);
    if (parsed.error !== null) {
      stderrLines.push(parsed.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const flags = parsed.flags;

    let historyLines: string[];
    try {
      if (flags.id) {
        const entry = this.ctx.history.get(flags.id);
        if (!entry) {
          stderrLines.push(`No history entry matching "${flags.id}".`);
          return { exitCode: 1, stdoutLines, stderrLines };
        }
        historyLines = [formatEntry(entry)];
      } else {
        const n = flags.last ?? 5;
        const entries = this.ctx.history.list({ limit: n });
        historyLines = entries.length > 0 ? entries.map(formatEntry) : ["(no history entries found)"];
      }
    } catch {
      historyLines = ["(history unavailable)"];
    }

    const title = flags.title ?? "[FILL IN: one-line description of the bug]";
    const body = buildBody({
      version: VERSION,
      platform: process.platform,
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
      baseUrl: this.ctx.config.baseUrl,
      userAgent: this.ctx.config.userAgent,
      scope: this.ctx.config.scope,
      hasActiveAccount: Boolean(this.ctx.config.activeAccountId),
      accountsCount: this.ctx.config.accounts.length,
      historyLines,
      what: flags.what,
      expected: flags.expected,
      steps: flags.steps,
    });

    const url = `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

    stderrLines.push("⚠  Review the issue form before submitting — remove anything sensitive before posting.");
    stderrLines.push("Opening GitHub issue form in your browser…");
    stderrLines.push(`If it does not open: ${url}`);

    const opener = this.ctx.openBrowser ?? defaultOpenBrowser;
    opener(url);

    return { exitCode: 0, stdoutLines, stderrLines };
  }
}

export function parseReportBugFlags(
  argv: string[],
): { flags: ReportBugFlags; error: null } | { flags: null; error: string } {
  const flags: ReportBugFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--title":
      case "--what":
      case "--expected":
      case "--steps":
      case "--id": {
        if (next === undefined || next.startsWith("--")) {
          return { flags: null, error: `${arg} requires a value.` };
        }
        const key = arg.slice(2) as "title" | "what" | "expected" | "steps" | "id";
        flags[key] = next;
        i++;
        break;
      }
      case "--last": {
        if (next === undefined || next.startsWith("--")) {
          return { flags: null, error: "--last requires a number." };
        }
        const n = Number(next);
        if (!Number.isFinite(n) || n < 1) {
          return { flags: null, error: "--last expects a positive integer." };
        }
        flags.last = Math.floor(n);
        i++;
        break;
      }
      default:
        return { flags: null, error: `Unknown report-bug flag: ${arg}` };
    }
  }
  return { flags, error: null };
}

interface BodyContext {
  version: string;
  platform: string;
  bunVersion: string;
  baseUrl: string;
  userAgent: string;
  scope: string;
  hasActiveAccount: boolean;
  accountsCount: number;
  historyLines: string[];
  what?: string;
  expected?: string;
  steps?: string;
}

function buildBody(ctx: BodyContext): string {
  const whatText = ctx.what ?? "[FILL IN: describe the unexpected behaviour]";
  const expectedText = ctx.expected ?? "[FILL IN: what should have happened instead]";
  const stepsText = ctx.steps
    ? `\`\`\`bash\n${ctx.steps}\n\`\`\``
    : `[FILL IN: exact command(s) to reproduce — do not paste tokens, post URLs with PII, or response data]\n\n\`\`\`bash\nredditer [FILL IN command]\n\`\`\``;

  return `<!-- ⚠️ STOP — before submitting, check this form for sensitive data.
     Remove any tokens, personal information, query contents, or response
     payloads that may have been added manually. The CLI deliberately omits
     params, response previews, why text, usernames, and tokens. -->

## Environment

| Key | Value |
|-----|-------|
| redditer version | \`${ctx.version}\` |
| OS | \`${ctx.platform}\` |
| Bun | \`${ctx.bunVersion}\` |
| Reddit base URL | \`${ctx.baseUrl}\` |
| User-Agent | \`${ctx.userAgent}\` |
| OAuth scope | \`${ctx.scope}\` |
| Active account | \`${ctx.hasActiveAccount ? "yes" : "no"}\` |
| Saved accounts | \`${ctx.accountsCount}\` |

## What happened?

${whatText}

## Expected behaviour

${expectedText}

## Steps to reproduce

${stepsText}

## CLI history (tool names, exit codes, timings — no params, no why, no response data)

<details>
<summary>Recent calls</summary>

\`\`\`
${ctx.historyLines.join("\n\n")}
\`\`\`

</details>

## Additional context

[FILL IN: anything else — error output, screenshots, related issues]
`;
}

// Safe, non-PII fields only. `why`, `params`, and `preview` are intentionally
// omitted — they may contain user-supplied strings, post URLs with PII, or
// response data.
function formatEntry(e: HistoryEntry): string {
  const ts = new Date(e.createdAt).toISOString();
  const status = e.exitCode === 0 ? "ok" : `exit ${e.exitCode}`;
  const lines = [
    `[${e.id.slice(0, 10)}] ${ts}  ${status}  ${e.durationMs}ms`,
    `  tool:    ${e.module} / ${e.tool}`,
  ];
  if (e.forkedFrom) lines.push(`  forkedFrom: ${e.forkedFrom.slice(0, 10)}`);
  return lines.join("\n");
}

function defaultOpenBrowser(url: string): void {
  const args =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/C", "start", '""', url]
        : ["xdg-open", url];
  try {
    spawnSync(args[0]!, args.slice(1), { stdio: "ignore" });
  } catch {
    // URL already printed above.
  }
}
