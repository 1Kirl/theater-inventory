import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        /**
         * One reason only: caching.
         *
         * The Firebase SDK is around 770 kB and changes when Firebase is
         * upgraded, which is rare. Left alone, the bundler groups it with
         * whatever application module happens to share the chunk, so editing a
         * button would give the whole 770 kB a new hash and every returning
         * user would download it again.
         *
         * `@firebase/ai` is deliberately excluded. It belongs to the two AI
         * features, which load it on demand; folding it in here would put it
         * back on the path of every page that never uses it.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@firebase/ai') || id.includes('firebase/ai')) return undefined
          if (id.includes('@firebase/') || id.includes('/firebase/')) return 'firebase'
          return undefined
        },
      },
    },
  },
  test: {
    // Domain logic arrives in Phase 4; the runner is configured now so later
    // phases can add tests without touching build configuration.
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
  },
})
