import { describe, expect, test } from "bun:test";

import {
  renderAccounts,
  renderHelp,
  renderModuleHelp,
  renderToolHelp,
  renderToolsList,
} from "../src/cli/help.ts";
import type { Config } from "../src/lib/config.ts";
import { buildRegistry, findTool } from "../src/lib/registry.ts";

const registry = buildRegistry();

describe("cli/help renderers", () => {
  test("renderHelp lists all modules", () => {
    const help = renderHelp(registry);
    expect(help).toContain("reddit-cli");
    expect(help).toContain("Modules:");
    for (const m of Object.keys(registry.modules)) expect(help).toContain(m);
  });

  test("renderToolsList enumerates every tool", () => {
    const listing = renderToolsList(registry);
    expect(listing).toContain("auth login");
    expect(listing).toContain("users whoami-remote");
    expect(listing).toContain("comments get-comments");
  });

  test("renderModuleHelp falls back to top-level for unknown module", () => {
    expect(renderModuleHelp(registry, "bogus")).toContain("Modules:");
    expect(renderModuleHelp(registry, "auth")).toContain("auth login");
  });

  test("renderToolHelp describes the option schema", () => {
    const tool = findTool(registry, "subreddits", "list-posts")!;
    const help = renderToolHelp("subreddits", "list-posts", tool);
    expect(help).toContain("--subreddit <string>");
    expect(help).toContain("(required)");
    expect(help).toContain("--sort <string>");
    expect(help).toContain("[default: hot]");
    expect(help).toContain("--out <path>");
  });

  test("renderToolHelp notes tool-specific options missing for simple tools", () => {
    const tool = findTool(registry, "users", "whoami-remote")!;
    const help = renderToolHelp("users", "whoami-remote", tool);
    expect(help).toContain("(no tool-specific options)");
  });

  test("renderAccounts handles empty and populated lists", () => {
    const emptyConfig = { accounts: [] } as unknown as Config;
    expect(renderAccounts(emptyConfig)).toContain("No saved Reddit accounts");

    const populated = {
      accounts: [
        { id: "acct_a", username: "yak", label: null, isActive: true } as unknown as Config["accounts"][number],
        { id: "acct_b", username: null, label: "alt", isActive: false } as unknown as Config["accounts"][number],
      ],
    } as unknown as Config;
    const out = renderAccounts(populated);
    expect(out).toContain("yak [acct_a] (active)");
    expect(out).toContain("alt [acct_b]");
  });
});
