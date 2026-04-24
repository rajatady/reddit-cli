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
  const entries = Object.entries(def.options);
  const required = entries.filter(([, opt]) => opt.required);
  const optional = entries.filter(([, opt]) => !opt.required);
  const isRequest = def.kind === "request";

  const reqFlagsSummary = required.map(([n]) => `--${camelToKebab(n)} <${optionTypeHint(n, def.options[n]!)}>`);
  const usagePieces = ["redditer", module, tool, ...reqFlagsSummary];
  if (isRequest) usagePieces.push("--why <text>");
  usagePieces.push("[options]");

  const lines: string[] = [
    `redditer ${module} ${tool}`,
    def.description,
    "",
    "Usage:",
    `  ${usagePieces.join(" ")}`,
    "",
    "Required:",
  ];

  for (const [name, opt] of required) {
    lines.push(...renderOption(name, opt));
  }
  if (isRequest) {
    lines.push("  --why <text>");
    lines.push("      Why you're running this (recorded to history).");
  }
  if (required.length === 0 && !isRequest) {
    lines.push("  (none)");
  }

  if (optional.length > 0) {
    lines.push("");
    lines.push("Options:");
    for (const [name, opt] of optional) {
      lines.push(...renderOption(name, opt));
    }
  }

  if (isRequest) {
    lines.push("");
    lines.push("Output:");
    lines.push("  --out <path>      Write response JSON to <path>.");
    lines.push(
      "                    Default: /tmp/reddit-cli/<auto-named>.json (override dir with REDDIT_CLI_OUT_DIR).",
    );
    lines.push("  --out -           Write response JSON to stdout (for | jq).");
    lines.push("  --dry-run         Print the planned request without executing.");
  }

  if (def.example) {
    lines.push("");
    lines.push("Example:");
    lines.push(`  ${def.example}`);
  }

  return lines.join("\n");
}

function optionTypeHint(_name: string, opt: ToolDefinition["options"][string]): string {
  if (opt.allowedValues && opt.allowedValues.length > 0) return opt.allowedValues.join("|");
  return opt.type;
}

function renderOption(name: string, opt: ToolDefinition["options"][string]): string[] {
  const flag = `--${camelToKebab(name)}`;
  const typeBit = opt.type === "boolean" ? "" : ` <${optionTypeHint(name, opt)}>`;
  const defBit = opt.defaultValue !== undefined ? `  [default: ${String(opt.defaultValue)}]` : "";
  return [`  ${flag}${typeBit}${defBit}`, `      ${opt.description}`];
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
