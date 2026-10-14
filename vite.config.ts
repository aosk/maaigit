import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Express server in server/index.ts runs Vite as middleware during
// development, so the app and its API share one port and one command.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['server/**/*.ts', 'shared/**/*.ts', 'src/**/*.ts'], exclude: ['**/*.test.ts', 'server/index.ts', 'server/security/helpers.ts', 'src/main.tsx'], reporter: ['text-summary', 'text'] },
  },
});
