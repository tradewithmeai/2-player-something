import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/*/src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  },
  define: {
    'import.meta.env.VITE_MATCH_MODE': JSON.stringify(process.env.VITE_MATCH_MODE || 'turn'),
    'import.meta.env.VITE_WS_URL': JSON.stringify(process.env.VITE_WS_URL || 'http://localhost:8002'),
  },
})
