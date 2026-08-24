/**
 * @rin/health public module groups.
 *
 * Doctor and monitor remain independent Cordis plugins. They are exported as
 * namespaces and as package subpaths so their `name` and `apply` entries do
 * not collide when the package is consumed by the host.
 */
export * as doctor from './doctor/index.ts'
export * as monitor from './monitor/index.ts'
