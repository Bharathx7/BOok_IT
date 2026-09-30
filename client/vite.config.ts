import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // Same-origin API calls, so the httpOnly refresh cookie is first-party
    // (production does the same with a Vercel rewrite).
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
  // `vite preview` (the production build, used by the E2E tests) proxies the same way.
  preview: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
})