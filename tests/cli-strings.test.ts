import { describe, expect, test } from "bun:test";

import { camelToKebab, findClosest, kebabToCamel, levenshtein } from "../src/cli/strings.ts";

describe("cli/strings", () => {
  test("kebabToCamel and camelToKebab round-trip", () => {
    expect(kebabToCamel("post-url")).toBe("postUrl");
    expect(kebabToCamel("interval-minutes")).toBe("intervalMinutes");
    expect(kebabToCamel("single")).toBe("single");
    expect(camelToKebab("postUrl")).toBe("post-url");
    expect(camelToKebab("intervalMinutes")).toBe("interval-minutes");
    expect(camelToKebab("single")).toBe("single");
  });

  test("levenshtein computes edit distance", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  test("findClosest returns the closest candidate within threshold", () => {
    expect(findClosest("aut", ["auth", "history", "monitors"])).toBe("auth");
    expect(findClosest("histoy", ["auth", "history", "monitors"])).toBe("history");
    expect(findClosest("", [])).toBeNull();
    expect(findClosest("xxxxxxxx", ["auth"])).toBeNull();
  });
});
