import type { Config } from "../lib/config.ts";
import { findTool, type Registry, type ToolDefinition } from "../lib/registry.ts";
import { VERSION } from "../lib/version.ts";
import { camelToKebab } from "./strings.ts";

export function renderHelp(registry: Registry): string {
  const lines = [
    `redditer ${VERSION}`,
    "",
    "Usage:",
    "  redditer tools list",
    "  redditer history [list|show <id>|rerun <id>|fork <id> --set k=v]",
    "  redditer monitors [create|tick|list|show|stop] ...",
    "  redditer report-bug [--title ...] [--what ...] [--id <prefix>|--last N]",
    "  redditer auth login [--dry-run]",
    "  redditer auth whoami",
    "  redditer auth accounts",
    "  redditer auth use --account <id|username|label>",
    "  redditer auth refresh [--dry-run]",
    "  redditer auth logout [--dry-run]",
    "  redditer <module> <tool> --why <text> [options]",
    "",
    "Modules:",
  ];
  for (const [moduleName, moduleDef] of Object.entries(registry.modules)) {
    lines.push(`  ${moduleName} (${moduleDef.tools.length} tools)`);
  }
  return lines.join("\n");
}

export function renderToolsList(registry: Registry): string {
  const lines: string[] = [];
  for (const [moduleName, moduleDef] of Object.entries(registry.modules)) {
    for (const toolName of moduleDef.tools) {
      const tool = findTool(registry, moduleName, toolName)!;
      lines.push(`${moduleName} ${toolName}  ${tool.description}`);
    }
  }
  return lines.join("\n");
}

export function renderModuleHelp(registry: Registry, moduleName: string): string {
  const moduleDef = registry.modules[moduleName];
  if (!moduleDef) return renderHelp(registry);

  const lines = [
    `${moduleName} commands`,
    "",
    "Usage:",
    `  redditer ${moduleName} <subcommand> [options]`,
    "",
    "Subcommands:",
  ];
  for (const toolName of moduleDef.tools) {
    const tool = findTool(registry, moduleName, toolName)!;
    lines.push(`  ${moduleName} ${toolName}  ${tool.description}`);
  }
  return lines.join("\n");
}

export function renderToolHelp(module: string, tool: string, def: ToolDefinition): string {
  const lines = [
    `redditer ${module} ${tool}`,
    def.description,
    "",
    "Usage:",
    `  redditer ${module} ${tool} [options] --why <text>`,
    "",
    "Options:",
  ];
  const opts = Object.entries(def.options);
  if (opts.length === 0) {
    lines.push("  (no tool-specific options)");
  } else {
    for (const [name, opt] of opts) {
      const flag = `--${camelToKebab(name)}`;
      const typeBit = opt.type === "boolean" ? "" : ` <${opt.type}>`;
      const req = opt.required ? " (required)" : "";
      const defBit =
        opt.defaultValue !== undefined ? ` [default: ${String(opt.defaultValue)}]` : "";
      lines.push(`  ${flag}${typeBit}${req}${defBit}`);
      lines.push(`      ${opt.description}`);
    }
  }
  lines.push("");
  lines.push("Common options:");
  lines.push("  --why <text>    (required) why you're running this");
  lines.push("  --dry-run       print the planned request without executing");
  if (def.kind === "request") {
    lines.push("  --out <path>    write response JSON to path (use - for stdout)");
    lines.push(
      "                  default: /tmp/reddit-cli/<auto-named>.json (override with REDDIT_CLI_OUT_DIR)",
    );
  }
  return lines.join("\n");
}

export function renderAccounts(config: Config): string {
  if (config.accounts.length === 0) return "No saved Reddit accounts.";
  const lines = ["Saved Reddit accounts:"];
  for (const account of config.accounts) {
    const display = account.username ?? account.label ?? account.id;
    const active = account.isActive ? " (active)" : "";
    lines.push(`  ${display} [${account.id}]${active}`);
  }
  return lines.join("\n");
}
