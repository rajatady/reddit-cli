# reddit-cli

A Bun-first command-line Reddit client designed for humans and agents. Read posts, walk comment threads, search for people by keyword, watch a post over time, and replay any past run from a local SQLite history — all from the terminal.

## Motivation

Most Reddit tooling is either a full web client or a thin HTTP wrapper. Neither fits the shape of an agent or a terminal-driven workflow:

- **Agents need file-first output.** A 200 KB comment thread shouldn't flood a chat window. `reddit-cli` writes normalized JSON to `/tmp/reddit-cli/<slug>.json` by default and prints a short summary, so you can `jq` the file afterwards or pipe it with `--out -`.
- **Every run should be replayable.** Each tool invocation lands in a local SQLite history with `why`, params, preview, and timing — so `history rerun <id>` and `history fork <id> --set limit=50` work without re-assembling flags.
- **Tracking a post is a first-class thing.** Monitors are persistent jobs with snapshots and deltas, not a cron one-liner.
- **Auth should be boring.** OAuth login writes tokens to an account-aware config, refresh is reactive on 401, multi-account switching is one command.

It's a CLI I wanted for running Reddit workflows from agent sessions without the agent having to rediscover how Reddit responses are shaped every time.

## Install

```bash
npm i -g redditer
redditer auth login
```

Requires [Bun](https://bun.sh) ≥ 1.3 on your PATH (the CLI ships as a single Bun-compiled bundle). If you don't have Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

### From source

```bash
git clone git@github.com:rajatady/reddit-cli.git
cd reddit-cli
bun install
bun run check   # typecheck + tests (should pass clean)
bun src/index.ts <module> <tool> [flags] --why "..."
```

## Configure

Before you can log in, you need a Reddit OAuth app. Reddit requires each developer to register their own — there's no shared client id.

### 1. Create a Reddit OAuth app

1. Sign in to Reddit and go to <https://www.reddit.com/prefs/apps>.
2. Scroll to the bottom and click **"create another app…"** (or "create app" if it's your first).
3. Fill in the form:
   - **Name** — anything, e.g. `reddit-cli-local`.
   - **App type** — choose **`web app`**. (`script` also works, but `web app` is the cleanest match for the localhost redirect flow this CLI uses.)
   - **Description** — optional.
   - **About URL** — optional.
   - **Redirect URI** — **must be exactly `http://127.0.0.1:9780/callback`** (or whatever port you plan to override via `REDDIT_REDIRECT_URI`). A mismatch here is the #1 cause of a failed login.
4. Click **create app**.
5. You'll now see your app on the prefs page. Copy:
   - The string directly under the app name (e.g. `abc123XYZ...`) — that's your **client id**.
   - The **secret** field — that's your **client secret**.

### 2. Scopes

`reddit-cli` requests `identity read history` by default. That's:

- `identity` — read your username / karma (`auth whoami`, `users whoami-remote`).
- `read` — read public posts, comments, subreddit listings, search.
- `history` — read your own submission and comment history (`users my-submissions`, `users list-comments`).

Reddit doesn't require you to pre-declare scopes when you create the app — you only pick them at authorization time, which the CLI does for you. You don't need to do anything in the UI to enable these.

If/when write tools land (`comments draft-reply`, `comments submit-reply`), the CLI will request `submit` and `edit` on top and prompt a re-login.

### 3. Pass credentials to the CLI

Three ways, evaluated in this order of precedence (higher wins):

**(a) Environment variables** — simplest for one-shot runs:

```bash
export REDDIT_CLIENT_ID=your_client_id
export REDDIT_CLIENT_SECRET=your_client_secret
export REDDIT_REDIRECT_URI=http://127.0.0.1:9780/callback

redditer auth login
```

**(b) `.env.local`** in the current working directory — the CLI auto-loads it:

```
# .env.local
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_REDIRECT_URI=http://127.0.0.1:9780/callback
```

Then just run `redditer auth login` in that directory.

**(c) Saved config** — after a successful `auth login`, the credentials are persisted to `~/.reddit-cli/config.json` and you won't need env vars again for subsequent runs. Env still wins if set.

Both `REDDIT_*` and `REDDIT_CLI_*` variants are accepted — e.g. `REDDIT_CLI_CLIENT_ID` works identically to `REDDIT_CLIENT_ID`. Use the `REDDIT_CLI_*` form if you're worried about clashing with another tool.

**Optional knobs:**

- `REDDIT_CLI_USER_AGENT` — override the user agent Reddit sees (default `reddit-cli/0.1.0`).
- `REDDIT_CLI_SCOPE` — override the requested scopes (default `identity read history`).
- `REDDIT_CLI_OUT_DIR` — override the output dump directory (default `/tmp/reddit-cli`).

### 4. Log in

```bash
redditer auth login
```

This prints a Reddit authorization URL, opens it in your browser, and starts a local HTTP listener on `127.0.0.1:9780` to catch the callback. Approve the app in the browser; the CLI writes the tokens to `~/.reddit-cli/config.json` and prints your Reddit username.

Verify:

```bash
redditer auth whoami
redditer users whoami-remote --why "confirm live path"
```

If `auth login` hangs or 400s, the two most common causes are:
- **Redirect URI mismatch** — the value in your Reddit app must byte-for-byte match `REDDIT_REDIRECT_URI`.
- **Port 9780 already bound** — another process is holding it. Change both the env var and the Reddit app's redirect URI to the same new port.

## Commands

Every read tool supports `--dry-run` (print the planned request), `--out <path>` (write JSON to disk), `--out -` (pipe JSON to stdout, e.g. for `jq`), and `<module> <tool> --help` (show the option schema). `--why "..."` is required on every tool run and is recorded to history.

### Auth

| Command | Purpose |
|---|---|
| `auth login` | OAuth flow; persists tokens for a new or existing account. |
| `auth whoami` | Show the active account + merged config state. |
| `auth refresh` | Refresh the active account's access token. |
| `auth logout` | Remove the active account locally. |
| `auth accounts` | List all saved accounts; mark the active one. |
| `auth use --account <id\|username\|label>` | Switch the active account. |

### Live reads

| Command | Purpose |
|---|---|
| `users whoami-remote` | Fetch the active account's profile from Reddit. |
| `users my-submissions [--username X] [--sort new\|top\|hot\|controversial] [--limit 25]` | List a user's posts. Defaults to the active account. |
| `users list-comments [--username X] [--sort ...] [--limit 25]` | List a user's comments (with parent-post titles). Defaults to the active account. |
| `posts get-post --post-url <url>` | Fetch a single post (no comments). |
| `comments get-comments --post-url <url>` | Fetch a post with its comment tree. |
| `subreddits list-posts --subreddit <name\|url> [--sort hot\|new\|top\|...] [--limit 25]` | Fetch a subreddit listing. |
| `search posts --query "..." [--subreddit X] [--sort relevance\|hot\|top\|new\|comments] [--time all\|year\|month\|week\|day\|hour] [--limit 25]` | Keyword search for posts. |
| `search comments --query "..." [--subreddit X] [--sort ...] [--time ...] [--limit 25]` | Keyword search for comments. |

Output defaults to `/tmp/reddit-cli/<slug>.json`. Override the directory with `REDDIT_CLI_OUT_DIR`.

### History

Every tool run records to `./.reddit-cli/history.db`.

| Command | Purpose |
|---|---|
| `history list [--module X] [--tool Y] [--limit N] [--offset N] [--json]` | Browse past runs. |
| `history show <id-prefix>` | Show one entry's full params, preview, and timing. |
| `history rerun <id-prefix>` | Replay a past run verbatim. |
| `history fork <id-prefix> --set key=value [--set ...]` | Replay with param overrides. |

`rerun` / `fork` record new entries with `forkedFrom` pointing at the original — lineage stays intact.

### Monitors

Persistent tracking jobs in `./.reddit-cli/monitors.db`. Each tick captures a snapshot and prints deltas vs the previous one.

| Command | Purpose |
|---|---|
| `monitors create --post-url <url> [--interval-minutes 60]` | Register a tracking job. |
| `monitors tick` | Run all due jobs. |
| `monitors tick --job <id>` | Run one specific job regardless of due time. |
| `monitors list` | Show all jobs and their state. |
| `monitors show <id>` | Show job + full snapshot history (JSON). |
| `monitors stop <id>` | Deactivate a job. |

## Output, caching, context

- **File-first.** Live read responses write to `/tmp/reddit-cli/<slug>.json` and print a short stdout summary. Use `--out <path>` to change the location, or `--out -` to pipe JSON to stdout.
- **Slugs are per-tool.** `post-<sub>-<id>.json`, `thread-<sub>-<id>.json`, `submissions-<user>-<sort>.json`, `comments-<user>-<sort>.json`, `search-posts-<scope>-<query>.json`, `listing-<sub>-<sort>.json`, `me.json`.
- **`REDDIT_CLI_OUT_DIR`** overrides the default `/tmp/reddit-cli` directory.
- **History previews are truncated at 1000 chars** and never include raw tokens.

## Example workflows

Find people talking about a topic and pull their comment history:

```bash
redditer search comments --query "cofounder" --subreddit startups --limit 50 --why "find operators"
jq -r '.comments[].author' /tmp/reddit-cli/search-comments-startups-cofounder.json | sort -u

# Pull one user's comment + post history
redditer users list-comments --username someuser --limit 50 --why "read their comments" --out /tmp/u-someuser-comments.json
redditer users my-submissions  --username someuser --limit 50 --why "read their posts"   --out /tmp/u-someuser-posts.json
```

Watch a post over two hours:

```bash
redditer monitors create --post-url https://www.reddit.com/r/bun/comments/abc/x/ --interval-minutes 15 --why "watch growth"
# In another terminal, later:
redditer monitors tick --why "poll due jobs"
```

Replay a past run with a wider limit:

```bash
redditer history list --module subreddits
redditer history fork hist_abcd --set limit=100
```

## Repository layout

See [`AGENTS.md`](./AGENTS.md) for the operational guide — directory structure, testing policy, core mental model (registry + `ToolExecutor` + `redditFetch` choke point), and style guidance.

## Status

- Auth lifecycle, live reads (incl. search), history, and monitors: **shipped**.
- Write tools (`comments draft-reply`, `comments submit-reply`), normalized cache, rate-limit surfacing, Reddit-side logout revocation, background monitor runner: **not yet**.

## License

Not yet specified. Treat as "all rights reserved" until a LICENSE file lands.
