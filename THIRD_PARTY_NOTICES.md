# Third-Party Notices

rin-harness is licensed under [MIT](LICENSE). Each dependency remains under its
own license; nothing in this file changes those terms.

This is a pre-release checkout. The dependency model described here is the
current registry-only model, not a promise that the project has already been
published. Direct dependency declarations live in the workspace `package.json`
files, and the complete npm closure with exact versions is recorded in
[`pnpm-lock.yaml`](pnpm-lock.yaml). This repository does not contain a vendored
`vendor/` or `packages/` source tree.

## Registry dependencies

The dsh base and its Cordis foundation packages are consumed from the public npm
registry under the `@deepseek-ai/*` scope. Their versions are pinned in the
workspace manifests and lockfile; their license metadata is supplied by the
published packages. They are upstream runtime dependencies, not first-party
source copied into this checkout.

The `@rin/*` packages are first-party workspace packages in this repository. They
are not third-party notices and are licensed by the root `LICENSE` file.

## Local patches

pnpm applies the following local patch to a registry dependency during install:

| Package | Patch |
| --- | --- |
| `node-pty@1.1.0` | [`patches/node-pty@1.1.0.patch`](patches/node-pty@1.1.0.patch) |

The patch file is the complete record of the local modification. No third-party
source is copied into the repository outside this explicit `patches/` directory.

## Runtime npm dependencies

External packages that a workspace package resolves at runtime. The tier covers every plugin a user can mount from `cordis.yml` — not only what the `dsh` CLI and Web UI load by default.

| Package | License |
| --- | --- |
| [`@agentclientprotocol/sdk`](https://github.com/agentclientprotocol/typescript-sdk) | Apache-2.0 |
| [`@babel/code-frame`](https://github.com/babel/babel) | MIT |
| [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi) | MIT |
| [`@joplin/turndown-plugin-gfm`](https://github.com/laurent22/joplin-turndown-plugin-gfm) | MIT |
| [`@jridgewell/gen-mapping`](https://github.com/jridgewell/sourcemaps) | MIT |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [`@opentelemetry/api`](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 |
| [`@opentelemetry/api-logs`](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 |
| [`@opentelemetry/exporter-logs-otlp-http`](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 |
| [`@opentelemetry/otlp-exporter-base`](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 |
| [`@opentelemetry/resources`](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 |
| [`@opentelemetry/sdk-logs`](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 |
| [`@shikijs/langs`](https://github.com/shikijs/shiki) | MIT |
| [`@standard-schema/spec`](https://github.com/standard-schema/standard-schema) | MIT |
| [`@tailwindcss/typography`](https://github.com/tailwindlabs/tailwindcss-typography) | MIT |
| [`@tanstack/react-virtual`](https://github.com/TanStack/virtual) | MIT |
| [`@tauri-apps/api`](https://github.com/tauri-apps/tauri) | Apache-2.0 OR MIT |
| [`@tauri-apps/cli`](https://github.com/tauri-apps/tauri) | Apache-2.0 OR MIT |
| [`@tauri-apps/plugin-dialog`](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [`@tauri-apps/plugin-process`](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [`@tauri-apps/plugin-shell`](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [`@types/mdast`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@vscode/codicons`](https://github.com/microsoft/vscode-codicons) | CC-BY-4.0 |
| [`@vscode/ripgrep`](https://github.com/microsoft/vscode-ripgrep) | MIT |
| [`@xterm/addon-fit`](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) | MIT |
| [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) | MIT |
| [`anser`](https://github.com/IonicaBizau/anser) | MIT |
| [`chokidar`](https://github.com/paulmillr/chokidar) | MIT |
| [`clsx`](https://github.com/lukeed/clsx) | MIT |
| [`commander`](https://github.com/tj/commander.js) | MIT |
| [`diff`](https://github.com/kpdecker/jsdiff) | BSD-3-Clause |
| [`dompurify`](https://github.com/cure53/DOMPurify) | (MPL-2.0 OR Apache-2.0) |
| [`e2b`](https://github.com/e2b-dev/e2b) | MIT |
| [`eventsource-parser`](https://github.com/rexxars/eventsource-parser) | MIT |
| [`fflate`](https://github.com/101arrowz/fflate) | MIT |
| [`framer-motion`](https://github.com/motiondivision/motion/) | MIT |
| [`immer`](https://github.com/immerjs/immer) | MIT |
| [`js-yaml`](https://github.com/nodeca/js-yaml) | MIT |
| [`katex`](https://github.com/KaTeX/KaTeX) | MIT |
| [`koffi`](https://github.com/Koromix/koffi) | MIT |
| [`lucide-react`](https://github.com/lucide-icons/lucide) | ISC |
| [`marked`](https://github.com/markedjs/marked) | MIT |
| [`mdast-util-from-markdown`](https://github.com/syntax-tree/mdast-util-from-markdown) | MIT |
| [`mdast-util-gfm`](https://github.com/syntax-tree/mdast-util-gfm) | MIT |
| [`mdast-util-math`](https://github.com/syntax-tree/mdast-util-math) | MIT |
| [`mermaid`](https://github.com/mermaid-js/mermaid) | MIT |
| [`micromark-core-commonmark`](https://github.com/micromark/micromark/tree/main/packages/micromark-core-commonmark) | MIT |
| [`micromark-extension-gfm`](https://github.com/micromark/micromark-extension-gfm) | MIT |
| [`micromark-extension-math`](https://github.com/micromark/micromark-extension-math) | MIT |
| [`micromark-factory-space`](https://github.com/micromark/micromark/tree/main/packages/micromark-factory-space) | MIT |
| [`micromark-util-character`](https://github.com/micromark/micromark/tree/main/packages/micromark-util-character) | MIT |
| [`micromark-util-classify-character`](https://github.com/micromark/micromark/tree/main/packages/micromark-util-classify-character) | MIT |
| [`micromark-util-sanitize-uri`](https://github.com/micromark/micromark/tree/main/packages/micromark-util-sanitize-uri) | MIT |
| [`micromark-util-symbol`](https://github.com/micromark/micromark/tree/main/packages/micromark-util-symbol) | MIT |
| [`micromark-util-types`](https://github.com/micromark/micromark/tree/main/packages/micromark-util-types) | MIT |
| [`motion-dom`](https://github.com/motiondivision/motion) | MIT |
| [`motion-utils`](https://github.com/motiondivision/motion) | MIT |
| [`node-addon-require-builtin`](https://www.npmjs.com/package/node-addon-require-builtin) | MIT |
| [`node-pty`](https://github.com/microsoft/node-pty) | MIT |
| [`picomatch`](https://github.com/micromatch/picomatch) | MIT |
| [`prism-react-renderer`](https://github.com/FormidableLabs/prism-react-renderer) | MIT |
| [`react`](https://github.com/facebook/react) | MIT |
| [`react-diff-viewer-continued`](https://github.com/Aeolun/react-diff-viewer-continued) | MIT |
| [`react-dom`](https://github.com/facebook/react) | MIT |
| [`react-shiki`](https://github.com/AVGVSTVS96/react-shiki) | MIT |
| [`react-virtuoso`](https://github.com/petyosi/react-virtuoso) | MIT |
| [`sharp`](https://github.com/lovell/sharp) | Apache-2.0 |
| [`shiki`](https://github.com/shikijs/shiki) | MIT |
| [`supports-color`](https://github.com/chalk/supports-color) | MIT |
| [`tsx`](https://github.com/privatenumber/tsx) | MIT |
| [`turndown`](https://github.com/mixmark-io/turndown) | MIT |
| [`typescript`](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [`use-sync-external-store`](https://github.com/facebook/react) | MIT |
| [`web-tree-sitter`](https://github.com/tree-sitter/tree-sitter) | MIT |
| [`ws`](https://github.com/websockets/ws) | MIT |
| [`yaml`](https://github.com/eemeli/yaml) | ISC |
| [`zod`](https://github.com/colinhacks/zod) | MIT |
| [`zustand`](https://github.com/pmndrs/zustand) | MIT |

pnpm applies local patches to the following packages at install time, so shipped artifacts carry modified copies; each patch file is the complete record of the modification:

- `node-pty@1.1.0` — [`patches/node-pty@1.1.0.patch`](patches/node-pty@1.1.0.patch)


## Development-only npm dependencies

External packages **directly declared** only by repository tooling, test infrastructure, the documentation site, the demo leaves, or the native launcher's build workspace. No shipped surface names them itself. A package here may still be pulled in transitively by a runtime dependency — `pnpm-lock.yaml` is the authority on the full closure — so this tier records who declares a package, not what a build ultimately bundles.

| Package | License |
| --- | --- |
| [`@braintree/sanitize-url`](https://github.com/braintree/sanitize-url) | MIT |
| [`@modelcontextprotocol/server-everything`](https://github.com/modelcontextprotocol/servers) | MIT / Apache-2.0 |
| [`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers) | MIT / Apache-2.0 |
| [`@stylistic/eslint-plugin`](https://github.com/eslint-stylistic/eslint-stylistic) | MIT |
| [`@tailwindcss/vite`](https://github.com/tailwindlabs/tailwindcss) | MIT |
| [`@testing-library/dom`](https://github.com/testing-library/dom-testing-library) | MIT |
| [`@testing-library/jest-dom`](https://github.com/testing-library/jest-dom) | MIT |
| [`@testing-library/react`](https://github.com/testing-library/react-testing-library) | MIT |
| [`@types/babel__code-frame`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/js-yaml`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/jsdom`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/node`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/picomatch`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/react`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/react-dom`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/spdx-expression-parse`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/turndown`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@types/ws`](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |
| [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react) | MIT |
| [`@vitest/coverage-v8`](https://github.com/vitest-dev/vitest) | MIT |
| [`@yarnpkg/cli-dist`](https://github.com/yarnpkg/berry) | BSD-2-Clause |
| [`cytoscape`](https://github.com/cytoscape/cytoscape.js) | MIT |
| [`cytoscape-cose-bilkent`](https://github.com/cytoscape/cytoscape.js-cose-bilkent) | MIT |
| [`dayjs`](https://github.com/iamkun/dayjs) | MIT |
| [`debug`](https://github.com/debug-js/debug) | MIT |
| [`esbuild`](https://github.com/evanw/esbuild) | MIT |
| [`eslint-plugin-sonarjs`](https://github.com/SonarSource/SonarJS) | LGPL-3.0-only |
| [`execa`](https://github.com/sindresorhus/execa) | MIT |
| [`fast-check`](https://github.com/dubzzz/fast-check) | MIT |
| [`istanbul-lib-report`](https://github.com/istanbuljs/istanbuljs) | BSD-3-Clause |
| [`jscpd`](https://github.com/kucherenko/jscpd) | MIT |
| [`jsdom`](https://github.com/jsdom/jsdom) | MIT |
| [`knip`](https://github.com/webpro-nl/knip) | ISC |
| [`lefthook`](https://github.com/evilmartians/lefthook) | MIT |
| [`lightningcss`](https://github.com/parcel-bundler/lightningcss) | MPL-2.0 |
| [`oxlint`](https://github.com/oxc-project/oxc) | MIT |
| [`oxlint-tsgolint`](https://github.com/oxc-project/tsgolint) | MIT |
| [`playwright`](https://github.com/microsoft/playwright) | Apache-2.0 |
| [`publint`](https://github.com/publint/publint) | MIT |
| [`smol-toml`](https://github.com/squirrelchat/smol-toml) | BSD-3-Clause |
| [`spdx-expression-parse`](https://github.com/jslicense/spdx-expression-parse.js) | MIT |
| [`tailwindcss`](https://github.com/tailwindlabs/tailwindcss) | MIT |
| [`tsdown`](https://github.com/rolldown/tsdown) | MIT |
| [`typescript-language-server`](https://github.com/typescript-language-server/typescript-language-server) | Apache-2.0 |
| [`vite`](https://github.com/vitejs/vite) | MIT |
| [`vite-tsconfig-paths`](https://github.com/aleclarson/vite-tsconfig-paths) | MIT |
| [`vitepress`](https://github.com/vuejs/vitepress) | MIT |
| [`vitepress-plugin-mermaid`](https://github.com/emersonbottero/vitepress-plugin-mermaid) | MIT |
| [`vitest`](https://github.com/vitest-dev/vitest) | MIT |

`eslint-plugin-sonarjs` (LGPL-3.0-only) and `lightningcss` (MPL-2.0) run only as development tooling; their code is not linked into or distributed with any DeepSeek Harness artifact.
