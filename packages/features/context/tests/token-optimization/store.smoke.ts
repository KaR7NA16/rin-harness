import { TokenOptimizationCore } from '../../src/token-optimization/store-core.ts'

const installed: string[] = []
const listeners: string[] = []
const disposers: Array<() => void> = []
const fakeSeam = {
  systemPrompt: {
    section: (section) => {
      installed.push(section.name)
      return () => {
        const at = installed.indexOf(section.name)
        if (at >= 0) installed.splice(at, 1)
      }
    },
  },
  on: (event) => {
    listeners.push(event)
    return () => {
      const at = listeners.indexOf(event)
      if (at >= 0) listeners.splice(at, 1)
    }
  },
  effect: (fn) => disposers.push(fn),
}

const core = new TokenOptimizationCore(fakeSeam, { cleanPrompt: false })
if (installed.length !== 0) throw new Error('cleanPrompt off should install nothing')
if (listeners.length !== 0) throw new Error('cleanPrompt off should register nothing')
core.setCleanPrompt(true)
if (listeners.length !== 1 || listeners[0] !== 'system-prompt/assemble') throw new Error('cleaner should register listener')
core.setCleanPrompt(false)
if (listeners.length !== 0) throw new Error('cleaner off should remove listener')
if (core.getStatus().cleanPrompt !== false) throw new Error('status wrong')
disposers.forEach(fn => fn())
if (listeners.length !== 0) throw new Error('dispose should clean everything')
console.log('TOKEN-STORE-SMOKE-OK', JSON.stringify(core.getStatus()))
