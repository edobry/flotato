import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://edobry.github.io/flowtato/ (GitHub Pages project site)
  base: '/flowtato/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
