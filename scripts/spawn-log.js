#!/usr/bin/env node
/**
 * Cross-platform spawn with logging
 * Runs a command, logs output to both console and file
 * 
 * Usage: node spawn-log.js <log-file> <command> [args...]
 * 
 * Example: node spawn-log.js tmp/server.log npm run dev:server
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: spawn-log.js <log-file> <command> [args...]');
  process.exit(1);
}

const logFile = args[0];
const command = args[1];
const commandArgs = args.slice(2);

// Ensure log directory exists
const logDir = path.dirname(logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create log write stream (append mode)
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const timestamp = new Date().toISOString();
const startMessage = `\n[${timestamp}] Starting: ${command} ${commandArgs.join(' ')}\n`;
logStream.write(startMessage);
console.log(startMessage);

// Run the command
const child = spawn(command, commandArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

function log(data, prefix = '') {
  const text = prefix + data.toString();
  process.stdout.write(text);
  logStream.write(text);
}

child.stdout.on('data', (data) => {
  log(data);
});

child.stderr.on('data', (data) => {
  log(data, '[stderr] ');
});

child.on('error', (err) => {
  const errorMessage = `[ERROR] Failed to start ${command}: ${err.message}\n`;
  log(errorMessage);
  logStream.end();
  process.exit(1);
});

child.on('close', (code) => {
  const endMessage = `[${new Date().toISOString()}] Process exited with code ${code}\n`;
  log(endMessage);
  logStream.end();
  process.exit(code);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, terminating...');
  child.kill('SIGINT');
  process.exit(0);
});
