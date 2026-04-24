import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface MonitorJob {
  id: string;
  postUrl: string;
  subreddit: string;
  postId: string;
  intervalMinutes: number;
  active: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
}

export interface MonitorSnapshot {
  id: number;
  jobId: string;
  capturedAt: number;
  score: number;
  upvoteRatio: number;
  numComments: number;
}

interface ResolveMonitorsPathOptions {
  explicit?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export function resolveMonitorsPath(options: ResolveMonitorsPathOptions = {}): string {
  if (options.explicit) return options.explicit;
  const env = options.env ?? process.env;
  const fromEnv = env.REDDIT_CLI_MONITORS_DB;
  if (fromEnv) return fromEnv;
  return resolve(options.cwd ?? process.cwd(), ".reddit-cli/monitors.db");
}

export class Monitors {
  private db: Database;

  constructor(path: string) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        post_url TEXT NOT NULL,
        subreddit TEXT NOT NULL,
        post_id TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(active, next_run_at);

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        score INTEGER NOT NULL,
        upvote_ratio REAL NOT NULL,
        num_comments INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_job ON snapshots(job_id, captured_at DESC);
    `);
  }

  create(input: {
    id: string;
    postUrl: string;
    subreddit: string;
    postId: string;
    intervalMinutes: number;
    now: number;
  }): MonitorJob {
    const nextRunAt = input.now;
    this.db
      .query(
        `INSERT INTO jobs
          (id, post_url, subreddit, post_id, interval_minutes, active, created_at, last_run_at, next_run_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?)`,
      )
      .run(
        input.id,
        input.postUrl,
        input.subreddit,
        input.postId,
        input.intervalMinutes,
        input.now,
        nextRunAt,
      );
    return this.get(input.id)!;
  }

  get(id: string): MonitorJob | null {
    const row = this.db
      .query(
        `SELECT id, post_url, subreddit, post_id, interval_minutes, active, created_at, last_run_at, next_run_at
         FROM jobs WHERE id = ? OR id LIKE ? LIMIT 1`,
      )
      .get(id, `${id}%`) as Record<string, unknown> | null;
    return row ? rowToJob(row) : null;
  }

  list(options: { activeOnly?: boolean } = {}): MonitorJob[] {
    const where = options.activeOnly ? "WHERE active = 1" : "";
    const rows = this.db
      .query(
        `SELECT id, post_url, subreddit, post_id, interval_minutes, active, created_at, last_run_at, next_run_at
         FROM jobs ${where} ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToJob);
  }

  due(now: number): MonitorJob[] {
    const rows = this.db
      .query(
        `SELECT id, post_url, subreddit, post_id, interval_minutes, active, created_at, last_run_at, next_run_at
         FROM jobs WHERE active = 1 AND next_run_at <= ? ORDER BY next_run_at ASC`,
      )
      .all(now) as Array<Record<string, unknown>>;
    return rows.map(rowToJob);
  }

  stop(id: string): MonitorJob | null {
    const job = this.get(id);
    if (!job) return null;
    this.db.query(`UPDATE jobs SET active = 0 WHERE id = ?`).run(job.id);
    return { ...job, active: false };
  }

  touchRun(id: string, now: number): void {
    const job = this.get(id);
    if (!job) return;
    const nextRunAt = now + job.intervalMinutes * 60_000;
    this.db
      .query(`UPDATE jobs SET last_run_at = ?, next_run_at = ? WHERE id = ?`)
      .run(now, nextRunAt, job.id);
  }

  appendSnapshot(input: {
    jobId: string;
    capturedAt: number;
    score: number;
    upvoteRatio: number;
    numComments: number;
  }): void {
    this.db
      .query(
        `INSERT INTO snapshots (job_id, captured_at, score, upvote_ratio, num_comments)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.jobId, input.capturedAt, input.score, input.upvoteRatio, input.numComments);
  }

  latestSnapshot(jobId: string): MonitorSnapshot | null {
    const row = this.db
      .query(
        `SELECT id, job_id, captured_at, score, upvote_ratio, num_comments
         FROM snapshots WHERE job_id = ? ORDER BY captured_at DESC LIMIT 1`,
      )
      .get(jobId) as Record<string, unknown> | null;
    return row ? rowToSnapshot(row) : null;
  }

  snapshots(jobId: string, limit = 20): MonitorSnapshot[] {
    const rows = this.db
      .query(
        `SELECT id, job_id, captured_at, score, upvote_ratio, num_comments
         FROM snapshots WHERE job_id = ? ORDER BY captured_at DESC LIMIT ?`,
      )
      .all(jobId, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToSnapshot);
  }
}

function rowToJob(row: Record<string, unknown>): MonitorJob {
  return {
    id: String(row.id),
    postUrl: String(row.post_url),
    subreddit: String(row.subreddit),
    postId: String(row.post_id),
    intervalMinutes: Number(row.interval_minutes),
    active: Number(row.active) === 1,
    createdAt: Number(row.created_at),
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    nextRunAt: Number(row.next_run_at),
  };
}

function rowToSnapshot(row: Record<string, unknown>): MonitorSnapshot {
  return {
    id: Number(row.id),
    jobId: String(row.job_id),
    capturedAt: Number(row.captured_at),
    score: Number(row.score),
    upvoteRatio: Number(row.upvote_ratio),
    numComments: Number(row.num_comments),
  };
}
