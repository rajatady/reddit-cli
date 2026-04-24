import { camelToKebab, kebabToCamel } from "./strings.ts";
import type { ToolOptionDefinition } from "../lib/registry.ts";

export function parseToolArgs(
  args: string[],
  schema: Record<string, ToolOptionDefinition>,
): { values: Record<string, unknown>; error?: string } {
  const values: Record<string, unknown> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      return { values, error: `Unexpected argument: ${arg}` };
    }

    const flag = arg.slice(2);
    if (flag === "dry-run") {
      values.dryRun = true;
      continue;
    }
    if (flag === "why") {
      const next = args[index + 1];
      if (!next) return { values, error: "--why requires a value." };
      values.why = next;
      index++;
      continue;
    }
    if (flag === "out") {
      const next = args[index + 1];
      if (!next) return { values, error: "--out requires a path or '-' for stdout." };
      values.out = next;
      index++;
      continue;
    }

    const optionName = kebabToCamel(flag);
    const option = schema[optionName];
    if (!option) return { values, error: `Unknown flag: --${flag}` };

    if (option.type === "boolean") {
      values[optionName] = true;
      continue;
    }

    const next = args[index + 1];
    if (!next) return { values, error: `--${flag} requires a value.` };
    try {
      values[optionName] = coerce(next, option.type);
    } catch (error) {
      return { values, error: error instanceof Error ? error.message : String(error) };
    }
    index++;
  }

  for (const [optionName, option] of Object.entries(schema)) {
    if (values[optionName] === undefined && option.defaultValue !== undefined) {
      values[optionName] = option.defaultValue;
    }
    if (option.required && values[optionName] === undefined) {
      return { values, error: `Missing required flag: --${camelToKebab(optionName)}` };
    }
  }

  return { values };
}

export function coerce(value: string, type: ToolOptionDefinition["type"]): unknown {
  if (type === "number") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`Expected a number, got: ${value}`);
    }
    return parsed;
  }
  if (type === "boolean") return value === "true";
  return value;
}

export function stripCliFields(values: Record<string, unknown>): Record<string, unknown> {
  const { why: _why, out: _out, ...rest } = values;
  return rest;
}
