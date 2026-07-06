import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, independently-versioned vendor deps into their own chunks.
        // These change far less often than app code, so this also improves
        // long-term browser caching across deploys, not just chunk size.
        manualChunks: {
          clerk: ['@clerk/react'],
          sentry: ['@sentry/react'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
