import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface HistoryEntry {
  id: string;
  createdAt: number;
  module: string;
  tool: string;
  why: string;
  params: Record<string, unknown>;
  preview: string | null;
  exitCode: number;
  durationMs: number;
  forkedFrom: string | null;
}

interface ResolveHistoryPathOptions {
  explicit?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export function resolveHistoryPath(options: ResolveHistoryPathOptions = {}): string {
  if (options.explicit) return options.explicit;
  const env = options.env ?? process.env;
  const fromEnv = env.REDDIT_CLI_HISTORY_DB;
  if (fromEnv) return fromEnv;
  return resolve(options.cwd ?? process.cwd(), ".reddit-cli/history.db");
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  module?: string;
  tool?: string;
}

export class History {
  private db: Database;

  constructor(path: string) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        module_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        why TEXT NOT NULL,
        params_json TEXT NOT NULL,
        preview TEXT,
        exit_code INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        forked_from TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
    `);
    // Idempotent migration for DBs created before forked_from existed.
    const columns = this.db.query(`PRAGMA table_info(entries)`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "forked_from")) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN forked_from TEXT`);
    }
  }

  insert(entry: HistoryEntry): void {
    this.db
      .query(
        `INSERT INTO entries
          (id, created_at, module_name, tool_name, why, params_json, preview, exit_code, duration_ms, forked_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.createdAt,
        entry.module,
        entry.tool,
        entry.why,
        JSON.stringify(entry.params),
        entry.preview,
        entry.exitCode,
        entry.durationMs,
        entry.forkedFrom,
      );
  }

  list(options: ListOptions = {}): HistoryEntry[] {
    const limit = options.limit ?? 25;
    const offset = options.offset ?? 0;
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    if (options.module) {
      conditions.push("module_name = ?");
      bindings.push(options.module);
    }
    if (options.tool) {
      conditions.push("tool_name = ?");
      bindings.push(options.tool);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .query(
        `SELECT id, created_at, module_name, tool_name, why, params_json, preview, exit_code, duration_ms, forked_from
         FROM entries
         ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...(bindings as import("bun:sqlite").SQLQueryBindings[]), limit, offset) as Array<Record<string, unknown>>;
    return rows.map(rowToEntry);
  }

  get(idOrPrefix: string): HistoryEntry | null {
    const row = this.db
      .query(
        `SELECT id, created_at, module_name, tool_name, why, params_json, preview, exit_code, duration_ms, forked_from
         FROM entries
         WHERE id = ? OR id LIKE ?
         LIMIT 1`,
      )
      .get(idOrPrefix, `${idOrPrefix}%`) as Record<string, unknown> | null;
    return row ? rowToEntry(row) : null;
  }

  count(): number {
    const row = this.db.query(`SELECT COUNT(*) as total FROM entries`).get() as { total: number };
    return row.total;
  }
}

function rowToEntry(row: Record<string, unknown>): HistoryEntry {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    module: String(row.module_name),
    tool: String(row.tool_name),
    why: String(row.why),
    params: JSON.parse(String(row.params_json)) as Record<string, unknown>,
    preview: row.preview == null ? null : String(row.preview),
    exitCode: Number(row.exit_code),
    durationMs: Number(row.duration_ms),
    forkedFrom: row.forked_from == null ? null : String(row.forked_from),
  };
}

export function formatRelativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - fromMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
