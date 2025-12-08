import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/mojimoji/',
  plugins: [react()],
  server: {
    host: true, // Listen on all interfaces (0.0.0.0)
  },
  build: {
    chunkSizeWarningLimit: 1000, // 1MB
  },
  define: {
    // Store as ISO string (UTC), will be converted to local time in browser for Japanese locale
    __BUILD_TIMESTAMP_UTC__: JSON.stringify(new Date().toISOString()),
  },
})
