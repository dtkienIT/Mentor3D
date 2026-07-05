import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
  },
  assetsInclude: ['**/*.vrm', '**/*.vrma'],
});
