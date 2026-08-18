/**
 * @rin/bundle context-helper provider for dsh harness boots.
 *
 * The @rin/cli launcher provides `rinHome`, `builtinRepositoryRoot`, and
 * `webUiDistRoot` on the boot context before mounting the assembly (host.ts
 * `prepare`); the dsh harness profile mechanism has no such host hook, so
 * this bundle exports a zero-logic plugin that provides the same names
 * through an entry row. Declared first in cordis.patch.yml, it activates
 * before any row whose config interpolates a `!!js` helper.
 *
 * This module registers no plugin in the bundle's main surface — it is the
 * harness-side counterpart to the launcher's prepare hook and is imported
 * only by the harness patch row.
 * @module @rin/bundle/providers
 */

import type { Context } from '@deepseek-ai/cordis'
import { builtinRepositoryRoot, rinHome, webUiDistRoot } from './index.ts'

/** Provide the assembly path helpers on the boot context. */
const apply = (ctx: Context): void => {
  ctx.provide('rinHome', rinHome)
  ctx.provide('builtinRepositoryRoot', builtinRepositoryRoot)
  ctx.provide('webUiDistRoot', webUiDistRoot)
}

export default apply