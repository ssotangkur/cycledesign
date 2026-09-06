// Offset-aware ports (issue #76): `node scripts/ports.cjs` prints the
// effective ports for this checkout (base + .ports.local.json/PORT_OFFSET).
const { getPorts } = require('./scripts/ports.cjs');

const ports = getPorts();

module.exports = {
  apps: [
    {
      name: 'server',
      cwd: './apps/server',
      script: 'npm.cmd',
      args: 'run dev',
      env: {
        PORT: ports.server,
        SERVER_PORT: ports.server,
        NODE_ENV: 'development',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './tmp/pm2-server-error.log',
      out_file: './tmp/pm2-server-out.log',
      merge_logs: true,
      exec_mode: 'fork',
      kill_timeout: 5000,
    },
    {
      name: 'web',
      cwd: './apps/web',
      script: 'npm.cmd',
      args: 'run dev',
      env: {
        PORT: ports.web,
        WEB_PORT: ports.web,
        SERVER_PORT: ports.server,
        VITE_API_URL: `http://localhost:${ports.server}`,
        VITE_WS_URL: `ws://localhost:${ports.server}`,
        VITE_TOOL_URL: `http://localhost:${ports.web}`,
        VITE_PREVIEW_URL: `http://localhost:${ports.preview}`,
        NODE_ENV: 'development',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './tmp/pm2-web-error.log',
      out_file: './tmp/pm2-web-out.log',
      merge_logs: true,
      exec_mode: 'fork',
      kill_timeout: 5000,
    },
    {
      name: 'preview',
      cwd: './apps/preview',
      script: 'npm.cmd',
      args: 'run dev',
      env: {
        PORT: ports.preview,
        PREVIEW_PORT: ports.preview,
        VITE_TOOL_URL: `http://localhost:${ports.web}`,
        NODE_ENV: 'development',
        IN_PREVIEW_SERVER: 'true',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './tmp/pm2-preview-error.log',
      out_file: './tmp/pm2-preview-out.log',
      merge_logs: true,
      exec_mode: 'fork',
      kill_timeout: 5000,
    },
  ],
};
