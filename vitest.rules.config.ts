import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Security Rules tests run against the Firestore emulator, separately from the
 * unit tests so that `npm test` stays runnable without Java.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
