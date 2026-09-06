import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getPorts } = require('../../scripts/ports.cjs') as {
  getPorts: (options?: { e2e?: boolean }) => { web: number; server: number };
};

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : fallback;
}

// Offset-aware ports (issue #76): WEB_PORT/SERVER_PORT are set by
// scripts/run-with-ports.cjs; the helper fallback covers direct `vite` runs.
const ports = getPorts();
const webPort = parsePort(process.env.WEB_PORT ?? process.env.PORT, ports.web);
const serverPort = parsePort(process.env.SERVER_PORT, ports.server);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: webPort,
    // Fail fast on conflicts instead of silently picking another port.
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
      '/trpc': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    force: true,
    include: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
    exclude: ['@trpc/react-query', '@trpc/client', '@trpc/server'],
  },
});
