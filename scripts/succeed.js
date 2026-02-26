#!/usr/bin/env node
/**
 * Cross-platform wrapper that runs a command and always exits with code 0
 * Useful for commands like kill-port that may fail when nothing is running
 */

const { spawn } = require('child_process');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: succeed.js <command> [args...]');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

// Run the command
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  shell: true,
});

child.on('error', (err) => {
  console.error(`Error running ${command}:`, err.message);
  // Always exit with 0 regardless of error
  process.exit(0);
});

child.on('close', (code) => {
  // Always exit with 0 regardless of the command's exit code
  process.exit(0);
});
