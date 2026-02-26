#!/usr/bin/env node
/**
 * Cross-platform tee implementation
 * Writes to both stdout and a file
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: tee.js <output-file>');
  process.exit(1);
}

const outputFile = args[0];

// Ensure tmp directory exists
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Create write stream
const writeStream = fs.createWriteStream(outputFile);

// Pipe stdin to both stdout and file
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  process.stdout.write(chunk);
  writeStream.write(chunk);
});

process.stdin.on('end', () => {
  writeStream.end();
});

process.stdin.on('error', (err) => {
  console.error('Error reading stdin:', err);
  process.exit(1);
});

writeStream.on('error', (err) => {
  console.error('Error writing to file:', err);
  process.exit(1);
});
