import type { Config } from "../lib/config.ts";
import type { History } from "../lib/history.ts";
import {
  resolveOutputPath,
  summarizeResponse,
  toolOutputSlug,
  writeOutputFile,
} from "../lib/output.ts";
import { redditFetch as defaultRedditFetch } from "../lib/reddit-fetch.ts";
import type { ToolDefinition } from "../lib/registry.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ToolExecutorContext {
  config: Config;
  history: History;
  homeDir?: string;
  configCwd?: string;
  env: Record<string, string | undefined>;
  redditFetch: typeof defaultRedditFetch;
  fetchImpl?: FetchLike;
  now: () => number;
  createId: () => string;
  forkedFrom: string | null;
}

export interface ToolExecutorResult {
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
}

export class ToolExecutor {
  constructor(private readonly ctx: ToolExecutorContext) {}

  async run(
    moduleName: string,
    toolName: string,
    tool: ToolDefinition,
    values: Record<string, unknown>,
    stripCliFields: (values: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<ToolExecutorResult> {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const startedAt = this.ctx.now();
    let preview;
    try {
      preview = tool.buildPreview({
        params: values,
        baseUrl: this.ctx.config.baseUrl,
        activeUsername: this.ctx.config.username,
      });
    } catch (error) {
      stderrLines.push(error instanceof Error ? error.message : String(error));
      return { exitCode: 1, stdoutLines, stderrLines };
    }
    const prettyPreview = JSON.stringify(preview, null, 2);

    if (values.dryRun) {
      stdoutLines.push(`DRY RUN\n${prettyPreview}`);
      this.ctx.history.insert({
        id: this.ctx.createId(),
        createdAt: startedAt,
        module: moduleName,
        tool: toolName,
        why: String(values.why),
        params: stripCliFields(values),
        preview: prettyPreview,
        exitCode: 0,
        durationMs: Math.max(0, this.ctx.now() - startedAt),
        forkedFrom: this.ctx.forkedFrom,
      });
      return { exitCode: 0, stdoutLines, stderrLines };
    }

    if (preview.kind !== "request") {
      stderrLines.push(`Tool ${moduleName} ${toolName} is not runnable directly.`);
      return { exitCode: 1, stdoutLines, stderrLines };
    }

    try {
      const raw = await this.ctx.redditFetch(preview.path, {
        homeDir: this.ctx.homeDir,
        env: this.ctx.env,
        cwd: this.ctx.configCwd,
        fetchImpl: this.ctx.fetchImpl,
      });
      const normalized = tool.normalize ? tool.normalize(raw, values) : raw;
      const body = JSON.stringify(normalized, null, 2);
      const slug = toolOutputSlug({
        module: moduleName,
        tool: toolName,
        params: values,
        activeUsername: this.ctx.config.username,
      });
      const target = resolveOutputPath({
        explicit: typeof values.out === "string" ? values.out : null,
        slug,
        env: this.ctx.env,
      });
      const summaryLines = summarizeResponse(moduleName, toolName, normalized);
      let historyPreview: string;
      if (target === "stdout") {
        stdoutLines.push(body);
        historyPreview = body.length > 1000 ? body.slice(0, 1000) + "…" : body;
      } else {
        const bytes = writeOutputFile(target, body);
        stdoutLines.push(`wrote ${target} (${bytes} bytes)`);
        stdoutLines.push(summaryLines.join("\n"));
        historyPreview = [`out: ${target}`, ...summaryLines].join("\n");
      }
      this.ctx.history.insert({
        id: this.ctx.createId(),
        createdAt: startedAt,
        module: moduleName,
        tool: toolName,
        why: String(values.why),
        params: stripCliFields(values),
        preview: historyPreview,
        exitCode: 0,
        durationMs: Math.max(0, this.ctx.now() - startedAt),
        forkedFrom: this.ctx.forkedFrom,
      });
      return { exitCode: 0, stdoutLines, stderrLines };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderrLines.push(message);
      this.ctx.history.insert({
        id: this.ctx.createId(),
        createdAt: startedAt,
        module: moduleName,
        tool: toolName,
        why: String(values.why),
        params: stripCliFields(values),
        preview: message,
        exitCode: 1,
        durationMs: Math.max(0, this.ctx.now() - startedAt),
        forkedFrom: this.ctx.forkedFrom,
      });
      return { exitCode: 1, stdoutLines, stderrLines };
    }
  }
}
