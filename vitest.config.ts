import tsconfigPaths from 'vite-tsconfig-paths'
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/** Worker arguments that keep process-wide Web Storage from shadowing jsdom storage. */
const vitestExecArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

/** Transform standard TypeScript decorators before Vite parses source files. */
function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

/**
 * Resolution facade shared by both lanes: the root tsconfig.base.json has no
 * include (match-all for vite-tsconfig-paths), so its paths map applies to
 * every rin test file. `projects` is resolved against vite's `root`
 * (= process.cwd()), and `pnpm test` runs from the repo root, so
 * './tsconfig.base.json' matches the dsh config exactly.
 */
const pathsPlugin = (): ReturnType<typeof tsconfigPaths> => tsconfigPaths({ projects: ['./tsconfig.base.json'] })

// Runtime packages put tests under their package tests/ directory; the Web app
// colocates tests next to source under src/.
const hostTests = [
  'packages/*/*/tests/**/*.test.ts',
  'apps/cli/tests/**/*.test.ts',
]
const webTests = ['apps/web/src/**/*.test.{ts,tsx}']

const webSetupFiles = [
  'apps/web/src/test-setup.ts',
  'apps/web/src/test-websocket-setup.ts',
].filter(path => existsSync(path))

interface CoverageFloor {
  source: string
  statements: number
  branches: number
  functions: number
  lines: number
}

const coveragePolicy = JSON.parse(
  readFileSync('tooling/config/coverage-thresholds.json', 'utf8'),
) as {
  globalThresholds: Omit<CoverageFloor, 'source'>
  packages: Record<string, CoverageFloor>
}

const coverageThresholds = Object.fromEntries([
  ...Object.entries(coveragePolicy.globalThresholds),
  ...Object.entries(coveragePolicy.packages).map(([, floor]) => {
    const { source, ...thresholds } = floor
    return [source, thresholds]
  }),
])

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
          name: 'web',
          environment: 'jsdom',
          // web-ui tests import '@testing-library/jest-dom' (not the /vitest
          // entry) and rely on React Testing Library auto-cleanup; both need
          // the `expect` / `afterEach` globals that vitest only injects here.
          globals: true,
          // jsdom browser API mocks (ResizeObserver/IntersectionObserver/
          // localStorage/Virtuoso metrics) plus the WebSocket stub that keeps
          // tests off the real undici WebSocket (cross-realm Event dispatch).
          setupFiles: webSetupFiles,
          execArgv: vitestExecArgv,
          pool: 'forks',
          include: webTests,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Generate the report even while the lane still has failing suites,
      // otherwise a single red test would discard the whole coverage run and
      // the progressive threshold would never get a signal.
      reportOnFailure: true,
      reportsDirectory: '.artifacts/coverage',
      // Coverage measures rin's runtime source. Types-only files carry no
      // executable code and are excluded (same convention as dsh).
      include: [
        'packages/*/*/src/**/*.{ts,tsx}',
        'apps/*/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'packages/*/*/src/types.ts',
      ],
      reporter: ['text', 'html'],
      // One checked policy owns both global and package/subpath regression
      // floors. Vitest natively enforces glob thresholds during this command.
      thresholds: coverageThresholds,
    },
  },
})
