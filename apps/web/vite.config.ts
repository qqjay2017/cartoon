import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tailwindcss(),
    // tanstackStart 已内置 tanstackRouterGenerator + code-splitter，勿再单独加 tanstackRouter()
    tanstackStart(),
    tsconfigPaths(),
    react(),
  ],
  server: {
    port: 3000,
  },
})
