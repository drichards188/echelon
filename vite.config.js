import { defineConfig } from 'vite';

export default defineConfig({
  // relative paths: the build runs from a site's root or any folder in it (an itch.io upload)
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  server: { port: 5200, strictPort: true },
});
