import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8765",
      "/health": "http://localhost:8765",
      "/ws": { target: "ws://localhost:8765", ws: true },
    },
  },
})
