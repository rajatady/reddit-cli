import { describe, expect, test } from "bun:test";

import { coerce, parseToolArgs, stripCliFields } from "../src/cli/parse-args.ts";
import type { ToolOptionDefinition } from "../src/lib/registry.ts";

const schema: Record<string, ToolOptionDefinition> = {
  postUrl: { type: "string", description: "URL", required: true },
  limit: { type: "number", description: "max", defaultValue: 25 },
  verbose: { type: "boolean", description: "flag" },
};

describe("cli/parse-args", () => {
  test("parses flags and applies defaults", () => {
    const parsed = parseToolArgs(
      ["--post-url", "https://example.com", "--why", "w"],
      schema,
    );
    expect(parsed.values.postUrl).toBe("https://example.com");
    expect(parsed.values.limit).toBe(25);
    expect(parsed.values.why).toBe("w");
    expect(parsed.error).toBeUndefined();
  });

  test("accepts --out and --dry-run", () => {
    const parsed = parseToolArgs(
      ["--post-url", "x", "--out", "/tmp/foo.json", "--dry-run", "--why", "w"],
      schema,
    );
    expect(parsed.values.out).toBe("/tmp/foo.json");
    expect(parsed.values.dryRun).toBe(true);
  });

  test("returns error on missing required", () => {
    const parsed = parseToolArgs(["--why", "w"], schema);
    expect(parsed.error).toContain("Missing required flag");
  });

  test("returns error on unknown flag", () => {
    const parsed = parseToolArgs(["--bogus", "x"], schema);
    expect(parsed.error).toContain("Unknown flag: --bogus");
  });

  test("returns error on unexpected positional", () => {
    const parsed = parseToolArgs(["oops"], schema);
    expect(parsed.error).toContain("Unexpected argument");
  });

  test("returns error on flags missing values", () => {
    expect(parseToolArgs(["--why"], schema).error).toContain("--why requires a value");
    expect(parseToolArgs(["--out"], schema).error).toContain("--out requires a path");
    expect(parseToolArgs(["--post-url"], schema).error).toContain("requires a value");
  });

  test("boolean flags flip without a value", () => {
    const parsed = parseToolArgs(
      ["--post-url", "x", "--verbose", "--why", "w"],
      schema,
    );
    expect(parsed.values.verbose).toBe(true);
  });

  test("coerce handles strings, numbers, and booleans", () => {
    expect(coerce("42", "number")).toBe(42);
    expect(() => coerce("nope", "number")).toThrow("Expected a number");
    expect(coerce("true", "boolean")).toBe(true);
    expect(coerce("false", "boolean")).toBe(false);
    expect(coerce("raw", "string")).toBe("raw");
  });

  test("stripCliFields drops why and out", () => {
    const stripped = stripCliFields({ why: "w", out: "/tmp/x.json", postUrl: "x", dryRun: true });
    expect(stripped).toEqual({ postUrl: "x", dryRun: true });
  });
});
