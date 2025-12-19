import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Plugin to set correct Content-Type for markdown files
function markdownCharsetPlugin(): Plugin {
  return {
    name: 'markdown-charset',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith('.md')) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/mojimoji/',
  plugins: [react(), markdownCharsetPlugin()],
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
