import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'

/**
 * Resolution facade shared by both lanes: the root tsconfig.base.json has no
 * include (match-all for vite-tsconfig-paths), so its paths map applies to
 * every rin test file. `projects` is resolved against vite's `root`
 * (= process.cwd()), and `pnpm rin:test` runs from the repo root, so
 * './tsconfig.base.json' matches the dsh config exactly.
 */
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({ projects: ['./tsconfig.base.json'] })

// Host packages put tests under <group>/<pkg>/tests; web-ui colocates its
// tests next to source under src/ (stores/pages/lib/utils/api/components).
const hostTests = ['rin/*/*/tests/**/*.test.ts']
const webUiTests = ['rin/web/web-ui/src/**/*.test.{ts,tsx}']

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin()],
  test: {
    // Vitest 4 removed environmentMatchGlobs; the node/jsdom split is a
    // two-project workspace, mirroring the dsh config's project layout.
    projects: [
      {
        plugins: [pathsPlugin(), standardDecoratorPlugin()],
        test: {
          name: 'host',
          environment: 'node',
          execArgv: vitestExecArgv,
          pool: 'forks',
          include: hostTests,
        },
      },
      {
        plugins: [pathsPlugin(), standardDecoratorPlugin()],
        test: {
          name: 'web-ui',
          environment: 'jsdom',
          // web-ui tests import '@testing-library/jest-dom' (not the /vitest
          // entry) and rely on React Testing Library auto-cleanup; both need
          // the `expect` / `afterEach` globals that vitest only injects here.
          globals: true,
          execArgv: vitestExecArgv,
          pool: 'forks',
          include: webUiTests,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Generate the report even while the lane still has failing suites,
      // otherwise a single red test would discard the whole coverage run and
      // the progressive threshold would never get a signal.
      reportOnFailure: true,
      // Coverage measures rin's runtime source. Types-only files carry no
      // executable code and are excluded (same convention as dsh).
      include: ['rin/*/*/src/**/*.{ts,tsx}'],
      exclude: [
        'rin/*/*/src/types.ts',
      ],
      reporter: ['text', 'html'],
      // Progressive global floor (~60% of the measured baseline), not 100%.
      // Per-package progressive targets live in rin/coverage-thresholds.json;
      // a follow-up gate reads that file for the fine-grained check.
      thresholds: {
        statements: 30,
        branches: 28,
        functions: 30,
        lines: 31,
      },
    },
  },
})
