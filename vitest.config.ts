import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Obsidian distributes types; its runtime is provided by the host app.
      obsidian: fileURLToPath(new URL('./tests/fixtures/obsidian-runtime.ts', import.meta.url)),
    },
  },
});
