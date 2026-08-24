/**
 * rin evolution — seam projection strip-types smoke.
 *
 * Verifies the opt-in automatic-review trigger wiring point: disabled by
 * default (registers no listener), enabled by config.autoTrigger (subscribes
 * to the session lifecycle event and traces through logDebug), and the
 * returned disposer removes the listener. registerSeam delegates to the same
 * wiring with the full plugin config surface.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/seam.smoke.ts
 */

import {
  EVOLUTION_TRIGGER_EVENT,
  registerEvolutionTriggers,
  registerSeam,
} from '../src/seam.ts'

/** @returns a fake seam recording listeners and their removal. */
function fakeSeam() {
  const listeners = new Map()
  return {
    listeners,
    on(event, listener) {
      listeners.set(event, listener)
      return () => { listeners.delete(event) }
    },
  }
}

// 1. Disabled by default: no listener, disposer is a no-op.
{
  const seam = fakeSeam()
  const dispose = registerEvolutionTriggers(seam, {})
  if (typeof dispose !== 'function') throw new Error('disabled trigger must return a disposer')
  dispose()
  if (seam.listeners.size !== 0) throw new Error('disabled trigger must not register a listener')
}

// 2. Enabled: one session/created listener that traces through logDebug.
{
  const seam = fakeSeam()
  const debug = []
  const dispose = registerEvolutionTriggers(seam, {
    autoTrigger: true,
    logDebug: (message) => { debug.push(message) },
  })
  if (seam.listeners.size !== 1) throw new Error('enabled trigger must register exactly one listener')
  if (!seam.listeners.has(EVOLUTION_TRIGGER_EVENT)) {
    throw new Error('trigger must subscribe to ' + EVOLUTION_TRIGGER_EVENT)
  }
  seam.listeners.get(EVOLUTION_TRIGGER_EVENT)({ id: 'session-1' })
  if (debug.length !== 1) throw new Error('trigger handler must call logDebug once')
  if (!debug[0].includes(EVOLUTION_TRIGGER_EVENT)) throw new Error('debug line must name the trigger event')

  // 3. The disposer removes the listener.
  dispose()
  if (seam.listeners.size !== 0) throw new Error('trigger disposer must remove the listener')
}

// 4. registerSeam delegates with the full plugin config surface.
{
  const seam = fakeSeam()
  const debug = []
  registerSeam(seam, {
    globalConfigRoot: '/tmp/rin-evolution',
    reviewModel: async () => '',
    autoTrigger: true,
    logDebug: (message) => { debug.push(message) },
  })
  if (seam.listeners.size !== 1) throw new Error('registerSeam must register the trigger when enabled')
  seam.listeners.get(EVOLUTION_TRIGGER_EVENT)({})
  if (debug.length !== 1) throw new Error('registerSeam handler must call logDebug once')
}

console.log('EVOLUTION-SEAM-SMOKE-OK', { triggerEvent: EVOLUTION_TRIGGER_EVENT })
