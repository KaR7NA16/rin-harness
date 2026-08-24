/**
 * Workspace domain public module groups.
 *
 * Cordis mounts explicit subpaths so each service keeps its configuration
 * lifecycle while sharing one workspace package.
 */
export * as environment from './environment/index.ts'
export * as filesystem from './filesystem/index.ts'
export * as agents from './agents/index.ts'
export * as plugins from './plugins/index.ts'
export * as sandboxes from './sandboxes/index.ts'
