import type { History } from "../lib/history.ts";
import { formatRelativeTime } from "../lib/history.ts";
import type { Monitors } from "../lib/monitors.ts";
import { refreshAccessToken as defaultRefreshAccessToken } from "../lib/oauth.ts";
import { normalizePostWithComments } from "../lib/reddit-normalize.ts";
import { parseRedditPostUrl } from "../lib/reddit-url.ts";
import { redditFetch as defaultRedditFetch } from "../lib/reddit-fetch.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MonitorsCommandContext {
  monitors: Monitors;
  history: History;
  homeDir?: string;
  configCwd?: string;
  env: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  redditFetch: typeof defaultRedditFetch;
  refreshAccessToken: typeof defaultRefreshAccessToken;
  now: () => number;
  createId: () => string;
  forkedFrom: string | null;
}

export interface MonitorsCommandResult {
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
}

export class MonitorsCommand {
  constructor(private readonly ctx: MonitorsCommandContext) {}

  async run(args: string[]): Promise<MonitorsCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const sub = args[0];
    if (!sub) {
      stdoutLines.push(renderMonitorsHelp());
      stderrLines.push("Missing monitors subcommand.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    if (sub === "list") return this.list();
    if (sub === "create") return this.create(args.slice(1));
    if (sub === "show") return this.show(args[1]);
    if (sub === "stop") return this.stop(args.slice(1));
    if (sub === "tick") return this.tick(args.slice(1));

    stderrLines.push(`Unknown monitors subcommand: ${sub}`);
    return { exitCode: 1, stdoutLines, stderrLines };
  }

  private list(): MonitorsCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const jobs = this.ctx.monitors.list();
    if (jobs.length === 0) {
      stdoutLines.push("(no monitor jobs)");
      return { exitCode: 0, stdoutLines, stderrLines };
    }
    const nowMs = this.ctx.now();
    stdoutLines.push(
      jobs
        .map((j) => {
          const activeTag = j.active ? "active" : "stopped";
          const last = j.lastRunAt ? formatRelativeTime(j.lastRunAt, nowMs) : "never";
          const next = j.active ? formatRelativeTime(j.nextRunAt, nowMs) : "-";
          return `${j.id}  r/${j.subreddit}/${j.postId}  every ${j.intervalMinutes}m  ${activeTag}  last:${last}  next:${next}`;
        })
        .join("\n"),
    );
    return { exitCode: 0, stdoutLines, stderrLines };
  }

  private create(args: string[]): MonitorsCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const parsed = parseCreateFlags(args);
    if (parsed.error) {
      stderrLines.push(parsed.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const post = parseRedditPostUrl(parsed.postUrl!);
    const id = parsed.id ?? `mon_${Math.random().toString(36).slice(2, 10)}`;
    const job = this.ctx.monitors.create({
      id,
      postUrl: parsed.postUrl!,
      subreddit: post.subreddit,
      postId: post.postId,
      intervalMinutes: parsed.intervalMinutes,
      now: this.ctx.now(),
    });
    this.ctx.history.insert({
      id: this.ctx.createId(),
      createdAt: this.ctx.now(),
      module: "monitors",
      tool: "create",
      why: parsed.why!,
      params: { postUrl: parsed.postUrl, intervalMinutes: parsed.intervalMinutes },
      preview: JSON.stringify(job, null, 2),
      exitCode: 0,
      durationMs: 0,
      forkedFrom: this.ctx.forkedFrom,
    });
    stdoutLines.push(
      `Created monitor ${job.id} for r/${job.subreddit}/${job.postId} every ${job.intervalMinutes}m.`,
    );
    return { exitCode: 0, stdoutLines, stderrLines };
  }

  private show(id: string | undefined): MonitorsCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    if (!id) {
      stderrLines.push("monitors show requires an id.");
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const job = this.ctx.monitors.get(id);
    if (!job) {
      stderrLines.push(`No monitor job matching ${id}`);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const snaps = this.ctx.monitors.snapshots(job.id, 20);
    stdoutLines.push(JSON.stringify({ job, snapshots: snaps }, null, 2));
    return { exitCode: 0, stdoutLines, stderrLines };
  }

  private stop(args: string[]): MonitorsCommandResult {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const parsed = parseStopFlags(args);
    if (parsed.error) {
      stderrLines.push(parsed.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const job = this.ctx.monitors.stop(parsed.id!);
    if (!job) {
      stderrLines.push(`No monitor job matching ${parsed.id}`);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    this.ctx.history.insert({
      id: this.ctx.createId(),
      createdAt: this.ctx.now(),
      module: "monitors",
      tool: "stop",
      why: parsed.why!,
      params: { id: job.id },
      preview: null,
      exitCode: 0,
      durationMs: 0,
      forkedFrom: this.ctx.forkedFrom,
    });
    stdoutLines.push(`Stopped monitor ${job.id}.`);
    return { exitCode: 0, stdoutLines, stderrLines };
  }

  private async tick(args: string[]): Promise<MonitorsCommandResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const parsed = parseTickFlags(args);
    if (parsed.error) {
      stderrLines.push(parsed.error);
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const now = this.ctx.now();
    const jobs = parsed.job
      ? (() => {
          const j = this.ctx.monitors.get(parsed.job!);
          return j ? [j] : [];
        })()
      : this.ctx.monitors.due(now);
    if (jobs.length === 0) {
      stdoutLines.push("(no monitor jobs due)");
      return { exitCode: 0, stdoutLines, stderrLines };
    }
    const summaries: string[] = [];
    let hadError = false;
    for (const job of jobs) {
      try {
        const raw = await this.ctx.redditFetch(
          `/r/${job.subreddit}/comments/${job.postId}/.json?raw_json=1`,
          {
            homeDir: this.ctx.homeDir,
            env: this.ctx.env,
            cwd: this.ctx.configCwd,
            fetchImpl: this.ctx.fetchImpl,
          },
        );
        const { post } = normalizePostWithComments(raw);
        if (!post) {
          summaries.push(`${job.id}  (post not found)`);
          hadError = true;
          continue;
        }
        const prev = this.ctx.monitors.latestSnapshot(job.id);
        this.ctx.monitors.appendSnapshot({
          jobId: job.id,
          capturedAt: now,
          score: post.score,
          upvoteRatio: post.upvoteRatio,
          numComments: post.numComments,
        });
        this.ctx.monitors.touchRun(job.id, now);
        const deltaScore = prev ? post.score - prev.score : post.score;
        const deltaComments = prev ? post.numComments - prev.numComments : post.numComments;
        summaries.push(
          `${job.id}  score:${post.score} (Δ${deltaScore >= 0 ? "+" : ""}${deltaScore})  comments:${post.numComments} (Δ${deltaComments >= 0 ? "+" : ""}${deltaComments})  upvoteRatio:${post.upvoteRatio}`,
        );
      } catch (error) {
        hadError = true;
        summaries.push(
          `${job.id}  error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.ctx.history.insert({
      id: this.ctx.createId(),
      createdAt: now,
      module: "monitors",
      tool: "tick",
      why: parsed.why!,
      params: parsed.job ? { job: parsed.job } : {},
      preview: summaries.join("\n"),
      exitCode: hadError ? 1 : 0,
      durationMs: Math.max(0, this.ctx.now() - now),
      forkedFrom: this.ctx.forkedFrom,
    });
    stdoutLines.push(summaries.join("\n"));
    return { exitCode: hadError ? 1 : 0, stdoutLines, stderrLines };
  }
}

export interface CreateFlags {
  postUrl?: string;
  intervalMinutes: number;
  why?: string;
  id?: string;
  error?: string;
}

export function parseCreateFlags(args: string[]): CreateFlags {
  const out: CreateFlags = { intervalMinutes: 60 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (a === "--post-url" && next) { out.postUrl = next; i++; continue; }
    if (a === "--interval-minutes" && next) {
      const n = Number(next);
      if (Number.isNaN(n)) return { ...out, error: `--interval-minutes expected a number, got: ${next}` };
      out.intervalMinutes = n;
      i++;
      continue;
    }
    if (a === "--why" && next) { out.why = next; i++; continue; }
    if (a === "--id" && next) { out.id = next; i++; continue; }
    return { ...out, error: `Unknown monitors create flag: ${a}` };
  }
  if (!out.postUrl) return { ...out, error: "Missing required flag: --post-url" };
  if (!out.why) return { ...out, error: "Missing required flag: --why" };
  return out;
}

export interface StopFlags {
  id?: string;
  why?: string;
  error?: string;
}

export function parseStopFlags(args: string[]): StopFlags {
  const out: StopFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (a === "--id" && next) { out.id = next; i++; continue; }
    if (a === "--why" && next) { out.why = next; i++; continue; }
    if (!a.startsWith("--") && !out.id) { out.id = a; continue; }
    return { ...out, error: `Unknown monitors stop flag: ${a}` };
  }
  if (!out.id) return { ...out, error: "monitors stop requires an id." };
  if (!out.why) return { ...out, error: "Missing required flag: --why" };
  return out;
}

export interface TickFlags {
  job?: string;
  why?: string;
  error?: string;
}

export function parseTickFlags(args: string[]): TickFlags {
  const out: TickFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (a === "--job" && next) { out.job = next; i++; continue; }
    if (a === "--why" && next) { out.why = next; i++; continue; }
    return { ...out, error: `Unknown monitors tick flag: ${a}` };
  }
  if (!out.why) return { ...out, error: "Missing required flag: --why" };
  return out;
}

export function renderMonitorsHelp(): string {
  return [
    "monitors commands",
    "",
    "Usage:",
    "  reddit-cli monitors create --post-url <url> [--interval-minutes 60] --why <text>",
    "  reddit-cli monitors tick [--job <id>] --why <text>",
    "  reddit-cli monitors list",
    "  reddit-cli monitors show <id>",
    "  reddit-cli monitors stop <id> --why <text>",
  ].join("\n");
}
