import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic tests only — no WebGL, no network.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});