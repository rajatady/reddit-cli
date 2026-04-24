import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LCOV_PATH = resolve(process.cwd(), "coverage/lcov.info");
const THRESHOLD = 95;

const raw = readFileSync(LCOV_PATH, "utf8");
const totals = {
  lines: { hit: 0, found: 0 },
  functions: { hit: 0, found: 0 },
};

for (const line of raw.split("\n")) {
  if (line.startsWith("LF:")) {
    totals.lines.found += Number(line.slice(3));
  } else if (line.startsWith("LH:")) {
    totals.lines.hit += Number(line.slice(3));
  } else if (line.startsWith("FNF:")) {
    totals.functions.found += Number(line.slice(4));
  } else if (line.startsWith("FNH:")) {
    totals.functions.hit += Number(line.slice(4));
  }
}

const lineCoverage = totals.lines.found === 0 ? 100 : (totals.lines.hit / totals.lines.found) * 100;
const functionCoverage =
  totals.functions.found === 0 ? 100 : (totals.functions.hit / totals.functions.found) * 100;

if (lineCoverage < THRESHOLD || functionCoverage < THRESHOLD) {
  console.error(
    `Coverage check failed. lines=${lineCoverage.toFixed(2)}% functions=${functionCoverage.toFixed(2)}% threshold=${THRESHOLD}%`,
  );
  process.exit(1);
}

console.log(
  `Coverage check passed. lines=${lineCoverage.toFixed(2)}% functions=${functionCoverage.toFixed(2)}%`,
);
