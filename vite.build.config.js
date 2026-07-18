import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Avoid expanding Lucide's barrel into thousands of modules in production.
      'lucide-react': fileURLToPath(
        new URL('./node_modules/lucide-react/dist/cjs/lucide-react.js', import.meta.url),
      ),
    },
  },
})
