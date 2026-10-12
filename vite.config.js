import { defineConfig } from 'vite';

export default defineConfig({
  build: { chunkSizeWarningLimit: 2000 },
  server: { port: 5200, strictPort: true },
});
