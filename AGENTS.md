# AGENTS.md

Operational guide for coding agents and engineers working on `reddit-cli`.

`reddit-cli` is a standalone Bun-first CLI for Reddit workflows. The source of truth lives here — it does not mirror another repo.

## What this project does today

1. **Auth.** Full OAuth lifecycle against Reddit: `login`, `whoami`, `refresh`, `logout`, `accounts`, `use`. Tokens persisted in an account-aware local config, with multi-account storage but a single-active-account UX.
2. **Live Reddit reads.** `users whoami-remote`, `users my-submissions`, `users list-comments`, `posts get-post`, `comments get-comments`, `subreddits list-posts`, `search posts`, `search comments`. All go through `redditFetch`, which reactively refreshes on 401 and retries once.
3. **Local history.** Every tool run records to SQLite (`.reddit-cli/history.db`). `history list` supports filters (`--module`, `--tool`, `--limit`, `--offset`, `--json`). `history show <id>` inspects a single entry. `history rerun <id>` replays a past entry; `history fork <id> --set k=v` replays with overrides. Lineage is tracked via `forked_from`.
4. **Monitors.** Persistent monitor jobs in `.reddit-cli/monitors.db`. `monitors create` registers a job, `monitors tick` runs due jobs, snapshots the post (score, upvoteRatio, numComments), and prints deltas vs the previous snapshot. `monitors list | show | stop` round out the lifecycle.
5. **CLI ergonomics.** Typo recovery via Levenshtein suggestions, module-level and bare-command help, `--why` enforced on every tool run.

## What is NOT done

- Write tools (`comments draft-reply`, `comments submit-reply`) and the draft store.
- Reddit-side token revocation on logout (local-only today).
- Explicit multi-app-credential management (storage supports one `app` block; easy to extend).
- Background monitor runner — `monitors tick` is manual/on-demand.
- Normalized cache layer (the `cacheKey` exists in previews but isn't yet a store).
- Rate-limit awareness via `x-ratelimit-*` headers.

## Fast path

```bash
bun install
bun test
bun run check      # typecheck + coverage-gated tests (canonical verification)
```

Coverage is enforced by `scripts/check-coverage.ts` at 95% for lines and 95% for functions. Do not lower the threshold — add tests.

## Using the CLI

Set Reddit app credentials via env, `.env.local`, or saved config (env wins):

```
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_REDIRECT_URI=http://127.0.0.1:9780/callback
```

Both the `REDDIT_CLI_*` and `REDDIT_*` variants are accepted.

### Auth

```bash
bun src/index.ts auth login
bun src/index.ts auth whoami
bun src/index.ts auth refresh
bun src/index.ts auth logout
bun src/index.ts auth accounts
bun src/index.ts auth use --account <id|username|label>
```

### Live reads

```bash
bun src/index.ts users whoami-remote --why "profile snapshot"
bun src/index.ts users my-submissions [--username yak] [--sort new|top|hot|controversial] [--limit 25] --why "list my posts"
bun src/index.ts users list-comments [--username yak] [--sort new|top|hot|controversial] [--limit 25] --why "read my comments"
bun src/index.ts posts get-post --post-url <url> --why "thread inspection"
bun src/index.ts comments get-comments --post-url <url> --why "read the thread"
bun src/index.ts subreddits list-posts --subreddit bun --sort hot --limit 25 --why "survey"
bun src/index.ts search posts --query "cofounder" [--subreddit startups] [--sort relevance|hot|top|new|comments] [--time all|year|month|week|day|hour] [--limit 25] --why "find threads"
bun src/index.ts search comments --query "cofounder" [--subreddit startups] [--sort ...] [--time ...] [--limit 25] --why "find commenters"
```

All read tools:

- support `--dry-run` to preview the planned request without executing.
- write the normalized JSON response to a file by default (`/tmp/reddit-cli/<auto-name>.json`) and print a short summary to stdout.
- accept `--out <path>` to write elsewhere, or `--out -` to write JSON to stdout (for `| jq`).
- accept `<module> <tool> --help` to print the option schema.

The output directory is overridable via `REDDIT_CLI_OUT_DIR`.

### History

```bash
bun src/index.ts history list [--module X] [--tool Y] [--limit N] [--offset N] [--json]
bun src/index.ts history show <id-prefix>
bun src/index.ts history rerun <id-prefix>
bun src/index.ts history fork <id-prefix> --set key=value [--set key=value]
```

`rerun` / `fork` always record a new entry with `forkedFrom` pointing at the original.

### Monitors

```bash
bun src/index.ts monitors create --post-url <url> [--interval-minutes 60] --why "track"
bun src/index.ts monitors tick --why "poll due jobs"
bun src/index.ts monitors tick --job <id> --why "poll one job"
bun src/index.ts monitors list
bun src/index.ts monitors show <id>
bun src/index.ts monitors stop <id> --why "done watching"
```

`tick` with no `--job` runs all active jobs whose `next_run_at <= now`. Each tick appends a snapshot and advances `next_run_at` by `interval_minutes`.

## Repository layout

```text
reddit-cli/
├── AGENTS.md
├── package.json
├── tsconfig.json
├── .gitignore
├── scripts/
│   └── check-coverage.ts
├── src/
│   ├── index.ts                     # CLI entrypoint
│   ├── cli.ts                       # re-export façade → ./cli/runner.ts
│   ├── cli/
│   │   ├── runner.ts                # runCli dispatcher, CliResult type
│   │   ├── parse-args.ts            # parseToolArgs, coerce, stripCliFields
│   │   ├── strings.ts               # kebab↔camel, levenshtein, findClosest
│   │   ├── help.ts                  # renderHelp, renderToolsList, renderModuleHelp, renderToolHelp, renderAccounts
│   │   ├── auth-command.ts          # AuthCommand class (login/whoami/refresh/logout/use/accounts)
│   │   ├── history-command.ts       # HistoryCommand class + flag parsers
│   │   ├── monitors-command.ts      # MonitorsCommand class + flag parsers
│   │   └── tool-executor.ts         # ToolExecutor (dry-run + live fetch + file dump)
│   └── lib/
│       ├── config.ts                # account-aware local config, env precedence
│       ├── history.ts               # History class + formatRelativeTime
│       ├── monitors.ts              # Monitors class (jobs + snapshots)
│       ├── oauth.ts                 # OAuth flow, error body mapping, callback server
│       ├── output.ts                # toolOutputSlug, resolveOutputPath, writeOutputFile, summarizeResponse
│       ├── reddit.ts                # re-export façade for reddit-url / reddit-normalize / reddit-fetch
│       ├── reddit-url.ts            # parseRedditPostUrl, parseSubreddit
│       ├── reddit-normalize.ts      # RedditPost/Comment/Listing/Profile + normalizers
│       ├── reddit-fetch.ts          # redditFetch with reactive 401 refresh
│       ├── registry.ts              # tool schema (options, previews, normalizers)
│       └── version.ts
└── tests/
    ├── cli.test.ts                  # end-to-end integration via runCli
    ├── cli-help.test.ts
    ├── cli-history-command.test.ts
    ├── cli-monitors-command.test.ts
    ├── cli-parse-args.test.ts
    ├── cli-strings.test.ts
    ├── config.test.ts
    ├── history.test.ts
    ├── monitors.test.ts
    ├── oauth.test.ts
    ├── output.test.ts
    ├── reddit-fetch.test.ts
    ├── reddit-normalize.test.ts
    ├── reddit-url.test.ts
    └── registry.test.ts
```

## Core mental model

**The registry is the center for read tools.** `src/lib/registry.ts` declares every read tool's options, `buildPreview`, and optional `normalize` function. `ToolExecutor` (in `src/cli/tool-executor.ts`) calls `redditFetch(preview.path)` and then `tool.normalize(raw, params)`. Adding a new read tool means: register it in the registry, write its normalizer, done.

**`auth`, `history`, and `monitors` are dedicated command classes** because they manage local state, not Reddit requests. Each lives in its own `src/cli/*-command.ts` file and is instantiated per-invocation by `runner.ts`.

**`redditFetch` is the choke point for live calls.** It sits alone in `src/lib/reddit-fetch.ts`. If you add a new read tool, route through it so reactive refresh, user-agent handling, and error mapping stay uniform.

**Output is file-first.** `ToolExecutor` writes live JSON responses to `/tmp/reddit-cli/<slug>.json` (or `$REDDIT_CLI_OUT_DIR/<slug>.json`) and prints a compact summary to stdout. Use `--out <path>` to redirect; use `--out -` to write JSON to stdout (e.g. for piping to `jq`). Slug and summary logic live in `src/lib/output.ts`.

## TDD policy

Tests first for behavior changes. The gate is `bun run check`. If you touch auth error paths, the oauth unit test and the CLI integration test should both change. If you add a tool, the registry test and a CLI live-path test should both exist.

## History rules

Every tool run records to history with: `id`, `createdAt`, `module`, `tool`, `why`, `params` (minus `why`; `dryRun` is preserved so rerun replays truly), `preview` (truncated at 1000 chars for live responses), `exitCode`, `durationMs`, `forkedFrom`.

Never persist raw tokens in history. `stripCliFields` preserves meaningful params; the response preview is truncated.

## Auth architecture direction

Storage already supports multiple accounts. CLI UX stays single-active-account. The next lifecycle concern worth tackling is reactive refresh already lives in `redditFetch`; what's still missing is Reddit-side revocation on logout and explicit multi-app-credential management.

Do not re-introduce a `version` field or a migration layer on `config.json`. The shape is flat and known; if we need to evolve it later we can add fields additively.

## Planning files

`.plans/` is gitignored. Use numbered markdown files for phase-by-phase workstreams. Do not treat plans as product docs; they are active local notes.

## Style guidance

- Prefer small pure helpers over framework-heavy abstractions.
- Keep registry logic declarative.
- Avoid new dependencies unless Bun or the standard library is clearly insufficient.
- Never persist raw tokens in output or history.
- Keep tool options kebab-case on the CLI and camelCase internally — the parser bridges automatically.
