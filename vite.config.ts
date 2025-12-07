import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all interfaces (0.0.0.0)
  },
  define: {
    // Store as ISO string (UTC), will be converted to local time in browser for Japanese locale
    __BUILD_TIMESTAMP_UTC__: JSON.stringify(new Date().toISOString()),
  },
})
