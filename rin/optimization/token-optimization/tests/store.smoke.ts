import { TokenOptimizationCore, SECTION_NAME, validateResponseStyle } from '../src/store-core.ts'

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

const core = new TokenOptimizationCore(fakeSeam, { responseStyle: 'off', cleanPrompt: false })
if (installed.length !== 0) throw new Error('off should install nothing, got ' + installed)
if (listeners.length !== 0) throw new Error('cleanPrompt off should register nothing')
core.setResponseStyle('ponytail')
if (installed.length !== 1 || installed[0] !== SECTION_NAME) throw new Error('ponytail should install section, got ' + installed)
core.setResponseStyle('caveman')
if (installed.length !== 1) throw new Error('style swap should not duplicate sections, got ' + installed)
core.setResponseStyle('off')
if (installed.length !== 0) throw new Error('off should remove section, got ' + installed)
core.setCleanPrompt(true)
if (listeners.length !== 1 || listeners[0] !== 'system-prompt/assemble') throw new Error('cleaner should register listener')
core.setCleanPrompt(false)
if (listeners.length !== 0) throw new Error('cleaner off should remove listener')
if (core.getStatus().responseStyle !== 'off' || core.getStatus().cleanPrompt !== false) throw new Error('status wrong')
let threw = false
try { validateResponseStyle('bogus') } catch { threw = true }
if (!threw) throw new Error('bogus style should throw')
disposers.forEach(fn => fn())
if (installed.length !== 0 || listeners.length !== 0) throw new Error('dispose should clean everything')
console.log('TOKEN-STORE-SMOKE-OK', JSON.stringify(core.getStatus()))
