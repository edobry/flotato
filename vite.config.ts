/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://edobry.github.io/flotato/ (GitHub Pages project site)
  base: '/flotato/',
  // The commit each run reports to the board; GitHub Actions sets GITHUB_SHA.
  define: { __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  build: {
    rollupOptions: {
      input: { main: 'index.html', board: 'board/index.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
