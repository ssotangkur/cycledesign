#!/usr/bin/env node
/**
 * Kill only the ports owned by the current mode (dev or e2e) in this checkout.
 * Never touches the other mode's ports or another checkout's ports, since
 * those resolve to different port numbers via the offset scheme.
 *
 * Usage: node scripts/kill-ports.cjs [--e2e] [--only web|server|preview]
 */
'use strict';

const killPort = require('kill-port');
const { getPorts } = require('./ports.cjs');

async function main() {
  const args = process.argv.slice(2);
  const e2e = args.includes('--e2e');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

  let ports;
  try {
    ports = getPorts({ e2e });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const targets = Object.entries(ports)
    .filter(([name]) => ['web', 'server', 'preview'].includes(name))
    .filter(([name]) => !only || name === only);

  if (only && !['web', 'server', 'preview'].includes(only)) {
    console.error(`[ports] Invalid --only ${JSON.stringify(only)} (expected web|server|preview)`);
    process.exit(1);
  }

  for (const [name, port] of targets) {
    try {
      await killPort(port);
      console.log(`[ports] Killed ${name} on port ${port}`);
    } catch {
      // Nothing listening - fine.
    }
  }
}

main();
