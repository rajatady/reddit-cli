#!/usr/bin/env bun
import { runCli } from "./cli.ts";

const result = await runCli(process.argv.slice(2), {
  printLine: (line) => process.stdout.write(line + "\n"),
});

if (result.stdout) {
  console.log(result.stdout);
}
if (result.stderr) {
  console.error(result.stderr);
}
process.exit(result.exitCode);
