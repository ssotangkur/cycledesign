import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const { getPorts } = require('../../scripts/ports.cjs') as {
  getPorts: (options?: { e2e?: boolean }) => { preview: number };
};

// Offset-aware port (issue #76): PREVIEW_PORT is set by
// scripts/run-with-ports.cjs; the helper fallback covers direct `vite` runs.
const ports = getPorts();
const previewPort = Number(process.env.PREVIEW_PORT ?? process.env.PORT ?? ports.preview);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design': resolve(__dirname, '../../workspace/designs'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: previewPort,
    // Fail fast on conflicts instead of silently picking another port.
    strictPort: true,
    cors: true,
  },
});
