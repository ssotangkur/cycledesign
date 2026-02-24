const { spawn } = require('child_process');
const killPort = require('kill-port');

const PORT = process.env.PORT || 3001;
const script = 'src/index.ts';

let child = null;
let restarting = false;

async function killExisting() {
  try {
    await killPort(PORT);
    console.log(`Killed process on port ${PORT}`);
  } catch (e) {
    // Port was free
  }
}

async function start() {
  if (restarting) return;
  restarting = true;
  
  await killExisting();
  
  // Small delay to ensure port is released
  await new Promise(r => setTimeout(r, 500));
  
  console.log(`Starting ${script}...`);
  
  child = spawn('npx', ['tsx', 'watch', script], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PORT }
  });
  
  child.on('exit', (code) => {
    if (code !== 0) {
      console.log(`Process exited with code ${code}, restarting...`);
      setTimeout(start, 1000);
    }
  });
  
  child.on('error', (err) => {
    console.error('Process error:', err);
  });
  
  restarting = false;
}

// Watch for file changes using a simple polling approach
const fs = require('fs');
let lastCheck = Date.now();

setInterval(() => {
  // For now, just restart on any .ts file change detection
  // The actual tsx watch handles this, but we need to handle restarts
}, 2000);

start();
