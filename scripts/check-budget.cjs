#!/usr/bin/env node
/**
 * Warn-only line-budget ratchet for the daemon refactor (#159 KD-6).
 *
 * Soft limit: 500 lines per `scripts/*.ts` code file, measured by plain
 * `wc -l` (comments + blanks included — simplest, no tooling). Test files
 * (`*.test.ts`) are exempt and unlimited.
 *
 * Always exits 0 (warn, never fail): the ratchet bars NEW growth while the
 * `agent-daemon.ts` <500 follow-up extractions (run-control, probe,
 * poll/main) land separately. Deliberately NOT wired into `npm run
 * validate` — run via `npm run check:budget`.
 */
const fs = require('node:fs');
const path = require('node:path');

const BUDGET_LINES = 500;
const SCRIPTS_DIR = path.join(__dirname);

function main() {
  const files = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();
  let over = 0;
  let largest = { file: '', lines: 0 };
  for (const file of files) {
    const lines = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8').split('\n').length;
    if (lines > largest.lines) {
      largest = { file, lines };
    }
    if (lines > BUDGET_LINES) {
      over += 1;
      console.warn(`[check:budget] WARNING: scripts/${file} is ${lines} lines (soft limit ${BUDGET_LINES})`);
    }
  }
  const daemon = path.join(SCRIPTS_DIR, 'agent-daemon.ts');
  if (fs.existsSync(daemon)) {
    const daemonLines = fs.readFileSync(daemon, 'utf8').split('\n').length;
    console.log(`[check:budget] agent-daemon.ts: ${daemonLines} lines (target <${BUDGET_LINES + 1}; follow-up extractions pending per #159 KD-6)`);
  }
  if (over === 0) {
    console.log(`[check:budget] OK: all ${files.length} code files within the ${BUDGET_LINES}-line soft limit (largest: ${largest.file} ${largest.lines})`);
  } else {
    console.warn(`[check:budget] ${over} file(s) over budget — ratchet: no new growth; shrink or split before adding legs (new watchdog/VM legs go in new modules, never agent-daemon.ts)`);
  }
  process.exit(0);
}

main();
