/**
 * Build configuration.
 *
 * The build emits one ESM entry. Every DeepSeek Harness package stays
 * external: the host supplies one shared copy, and a second copy in the
 * bundle would break service identity. The `ws` runtime dependency is bundled
 * to avoid environment-specific export-condition resolution in the host.
 *
 * @module dsh-luoyu/tsdown.config
 */

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  // Keep the entry file in place so DSH's linked-package HMR watcher observes
  // content changes instead of a clean/remove/recreate cycle.
  clean: false,
  sourcemap: false,
  deps: {
    // Keep Harness packages external to preserve shared service identity, but
    // bundle ws so the host loader cannot select its browser export condition.
    alwaysBundle: ['ws'],
    neverBundle: [/^@deepseek-ai\//],
  },
})
