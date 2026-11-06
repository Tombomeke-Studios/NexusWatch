import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // The dashboard's sample data imports through its `@/` alias.
  resolve: { alias: { '@': fileURLToPath(new URL('../dashboard/src', import.meta.url)) } },
  test: { environment: 'node' },
});
