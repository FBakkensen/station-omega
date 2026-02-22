import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup/no-network.ts'],
    include: ['src/**/*.test.ts', 'convex/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['web/**', 'node_modules/**', 'dist/**'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
