import { describe, expect, test } from "bun:test";

import {
  parseCreateFlags,
  parseStopFlags,
  parseTickFlags,
  renderMonitorsHelp,
} from "../src/cli/monitors-command.ts";

describe("cli/monitors-command parsers", () => {
  test("parseCreateFlags enforces post-url and why", () => {
    expect(parseCreateFlags([]).error).toContain("--post-url");
    expect(parseCreateFlags(["--post-url", "x"]).error).toContain("--why");
    const ok = parseCreateFlags([
      "--post-url",
      "https://example.com",
      "--interval-minutes",
      "15",
      "--why",
      "w",
      "--id",
      "mon_a",
    ]);
    expect(ok).toMatchObject({
      postUrl: "https://example.com",
      intervalMinutes: 15,
      why: "w",
      id: "mon_a",
    });
  });

  test("parseCreateFlags rejects bad numbers and unknown flags", () => {
    expect(
      parseCreateFlags(["--post-url", "x", "--interval-minutes", "bad", "--why", "w"]).error,
    ).toContain("expected a number");
    expect(parseCreateFlags(["--bogus", "x", "--why", "w"]).error).toContain("Unknown");
  });

  test("parseStopFlags accepts positional id or --id", () => {
    expect(parseStopFlags(["mon_a", "--why", "w"]).id).toBe("mon_a");
    expect(parseStopFlags(["--id", "mon_b", "--why", "w"]).id).toBe("mon_b");
    expect(parseStopFlags(["--why", "w"]).error).toContain("requires an id");
    expect(parseStopFlags(["mon_a"]).error).toContain("--why");
    expect(parseStopFlags(["--bogus", "x"]).error).toContain("Unknown");
  });

  test("parseTickFlags parses optional --job and requires why", () => {
    expect(parseTickFlags(["--why", "w"]).why).toBe("w");
    expect(parseTickFlags(["--job", "mon_a", "--why", "w"]).job).toBe("mon_a");
    expect(parseTickFlags([]).error).toContain("--why");
    expect(parseTickFlags(["--bogus", "x"]).error).toContain("Unknown");
  });

  test("renderMonitorsHelp lists every subcommand", () => {
    const help = renderMonitorsHelp();
    for (const word of ["create", "tick", "list", "show", "stop"]) {
      expect(help).toContain(word);
    }
  });
});
