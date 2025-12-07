import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Development config - run from dev/ directory, no base path
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  define: {
    __BUILD_TIMESTAMP_UTC__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
})
