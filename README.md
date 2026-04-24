# redditer

A terminal Reddit client built for humans and agents. Read posts, walk comment threads, search for people by keyword, watch a post over time — and replay any past run from a local history. File-first JSON output, OAuth that refreshes itself, no web UI to navigate.

```bash
npm i -g redditer
redditer auth login
redditer search comments --query "cofounder" --subreddit startups --limit 50 --why "find operators"
```

## Why

Most Reddit tooling is either a full web client or a thin HTTP wrapper. Neither fits a terminal or agent workflow:

- **File-first output.** A 200 KB comment thread shouldn't flood your terminal or an agent's chat context. `redditer` writes normalized JSON to `/tmp/reddit-cli/<slug>.json` by default and prints a one-line summary. `jq` it afterwards or pipe with `--out -`.
- **Every run is replayable.** Each invocation lands in local SQLite. `history rerun <id>` and `history fork <id> --set limit=50` replay exactly — no reassembling flags.
- **Tracking a post is a first-class thing.** Monitors are persistent jobs with snapshots and score/comment deltas, not a cron one-liner.
- **Auth is boring.** OAuth login persists tokens; refresh is reactive on 401; multi-account switching is one command.

## Install

Requires [Bun](https://bun.sh) ≥ 1.3 on your `PATH`. (The package ships as a single Bun-compiled bundle — no Node runtime needed, but `bun` is.)

```bash
# Install Bun if you don't have it:
curl -fsSL https://bun.sh/install | bash

# Install redditer:
npm i -g redditer
```

## Setup (first time only)

Reddit requires every developer to register their own OAuth app — there's no shared client id. This takes 2 minutes.

### 1. Create a Reddit OAuth app

1. Sign in to Reddit and open <https://www.reddit.com/prefs/apps>.
2. Click **"create another app…"** at the bottom.
3. Fill in:
   - **Name** — anything, e.g. `redditer-local`.
   - **App type** — choose **`web app`**.
   - **Redirect URI** — **must be exactly** `http://127.0.0.1:9780/callback`. A mismatch here is the #1 cause of a failed login.
4. Click **create app**.
5. From the resulting page, copy:
   - The string directly under the app name → that's your **client id**.
   - The **secret** field → that's your **client secret**.

### 2. Point `redditer` at your credentials

Three ways. Pick one; env vars win when multiple are set.

**(a) Export for this shell:**

```bash
export REDDIT_CLIENT_ID=your_client_id
export REDDIT_CLIENT_SECRET=your_client_secret
export REDDIT_REDIRECT_URI=http://127.0.0.1:9780/callback
```

**(b) A `.env.local` file** in the directory you run `redditer` from:

```
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_REDIRECT_URI=http://127.0.0.1:9780/callback
```

**(c) After first login**, credentials persist to `~/.reddit-cli/config.json` — you only need env vars once.

(Both `REDDIT_*` and `REDDIT_CLI_*` variants are accepted.)

### 3. Log in

```bash
redditer auth login
```

This opens Reddit in your browser, catches the callback on `127.0.0.1:9780`, and saves tokens. Verify:

```bash
redditer auth whoami
redditer users whoami-remote --why "confirm live path"
```

**If login hangs or 400s:**
- Your Reddit app's redirect URI must *exactly* match `REDDIT_REDIRECT_URI` (byte-for-byte).
- Something else might be holding port 9780. Change both the env var and your Reddit app's redirect URI to the same new port.

### Default OAuth scopes

`redditer` requests `identity read history` — enough to read your profile, public posts/comments/subreddits, and your own submission + comment history. You don't need to pre-declare these anywhere; Reddit prompts you to approve them when you log in.

## Commands

All read tools require `--why "reason"` (recorded to history) and support `--dry-run`, `--out <path>`, `--out -` (stdout JSON for `| jq`), and `--help`.

### Auth

| Command | Purpose |
|---|---|
| `auth login` | OAuth flow; persists tokens for a new or existing account. |
| `auth whoami` | Show the active account + merged config. |
| `auth refresh` | Refresh the active account's access token. |
| `auth logout` | Remove the active account locally. |
| `auth accounts` | List saved accounts; mark the active one. |
| `auth use --account <id\|username\|label>` | Switch the active account. |

### Reading Reddit

| Command | Purpose |
|---|---|
| `users whoami-remote` | Fetch your profile from Reddit. |
| `users my-submissions [--username X] [--sort ...] [--limit 25]` | A user's posts. Defaults to the active account. |
| `users list-comments [--username X] [--sort ...] [--limit 25]` | A user's comments with parent-post titles. |
| `posts get-post --post-url <url>` | One post (no comments). |
| `comments get-comments --post-url <url>` | One post with its full comment tree. |
| `subreddits list-posts --subreddit <name\|url> [--sort ...] [--limit 25]` | A subreddit listing. |
| `search posts --query "..." [--subreddit X] [--sort ...] [--time ...] [--limit 25]` | Keyword search across posts. |
| `search comments --query "..." [--subreddit X] [--sort ...] [--time ...] [--limit 25]` | Keyword search across comments. |

Default output directory: `/tmp/reddit-cli/<slug>.json`. Override with `REDDIT_CLI_OUT_DIR`.

### History

Every tool run records to `./.reddit-cli/history.db` in the current working directory.

| Command | Purpose |
|---|---|
| `history list [--module X] [--tool Y] [--limit N] [--offset N] [--json]` | Browse past runs. |
| `history show <id-prefix>` | Show one entry's full params, preview, and timing. |
| `history rerun <id-prefix>` | Replay a past run verbatim. |
| `history fork <id-prefix> --set key=value` | Replay with param overrides. |

Both `rerun` and `fork` record new entries pointing at the original via `forkedFrom`.

### Monitors

Persistent tracking jobs in `./.reddit-cli/monitors.db`. Each tick captures a snapshot and prints deltas (score, numComments, upvoteRatio) vs the previous one.

| Command | Purpose |
|---|---|
| `monitors create --post-url <url> [--interval-minutes 60] --why ...` | Register a job. |
| `monitors tick --why ...` | Run all due jobs. |
| `monitors tick --job <id> --why ...` | Run one specific job regardless of due time. |
| `monitors list` | Show all jobs and their state. |
| `monitors show <id>` | Show job + full snapshot history (JSON). |
| `monitors stop <id> --why ...` | Deactivate a job. |

## Recipes

**Find operators talking about a topic, then dig into a specific person:**

```bash
redditer search comments --query "cofounder" --subreddit startups --limit 50 --why "find operators"
jq -r '.comments[].author' /tmp/reddit-cli/search-comments-startups-cofounder.json | sort -u

redditer users list-comments --username someuser --limit 50 --why "read their comments"
redditer users my-submissions  --username someuser --limit 50 --why "read their posts"
```

**Watch a post as it grows:**

```bash
redditer monitors create --post-url https://www.reddit.com/r/bun/comments/abc/x/ --interval-minutes 15 --why "watch growth"
redditer monitors tick --why "poll due jobs"   # run whenever; cron it if you want
```

**Replay a past run with a wider limit:**

```bash
redditer history list --module subreddits
redditer history fork hist_abcd --set limit=100
```

**Pipe JSON straight to `jq`:**

```bash
redditer posts get-post --post-url <url> --why "inspect" --out - | jq '.post.score'
```

## Configuration knobs

| Env var | Default | Purpose |
|---|---|---|
| `REDDIT_CLIENT_ID` / `REDDIT_CLI_CLIENT_ID` | — | Reddit app client id (required for login). |
| `REDDIT_CLIENT_SECRET` / `REDDIT_CLI_CLIENT_SECRET` | — | Reddit app client secret. |
| `REDDIT_REDIRECT_URI` / `REDDIT_CLI_REDIRECT_URI` | `http://127.0.0.1:9780/callback` | Must match your Reddit app. |
| `REDDIT_CLI_USER_AGENT` | `reddit-cli/0.1.0` | User-Agent sent to Reddit. |
| `REDDIT_CLI_SCOPE` | `identity read history` | OAuth scopes to request. |
| `REDDIT_CLI_OUT_DIR` | `/tmp/reddit-cli` | Default dump directory. |

## Status

Shipped: OAuth lifecycle, live reads (including search), history, monitors.

Not yet: write tools (draft/submit replies), normalized cache, rate-limit surfacing, Reddit-side token revocation on logout, background monitor runner.

## Contributing & source

- Source: <https://github.com/rajatady/reddit-cli>
- Issues: <https://github.com/rajatady/reddit-cli/issues>
- Operational guide for contributors (directory layout, testing policy, architectural conventions): [`AGENTS.md`](https://github.com/rajatady/reddit-cli/blob/main/AGENTS.md)

## License

MIT
