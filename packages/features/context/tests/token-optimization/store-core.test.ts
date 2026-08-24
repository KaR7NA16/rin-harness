import { describe, expect, test } from 'vitest'
import {
  TokenOptimizationCore,
  type PromptAssembly,
  type TokenOptimizationSeam,
} from '../../src/token-optimization/store-core.ts'

interface InstalledSection { name: string; order: number; text: string }
interface InstalledListener { event: string; listener: (assembly: PromptAssembly, context: unknown, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly> | void }

function makeSeam() {
  const sections: InstalledSection[] = []
  const listeners: InstalledListener[] = []
  const effects: Array<() => void> = []
  const seam: TokenOptimizationSeam = {
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {
          const at = sections.indexOf(section)
          if (at >= 0) sections.splice(at, 1)
        }
      },
    },
    on(event, listener) {
      listeners.push({ event, listener })
      return () => {
        const at = listeners.findIndex(item => item.listener === listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
    effect(disposer) {
      effects.push(disposer)
    },
  }
  return { seam, sections, listeners, effects }
}

const emptyAssembly: PromptAssembly = { sections: [], contexts: [], tools: [], variables: {} }

describe('TokenOptimizationCore construction', () => {
  test('installs nothing for the default disabled knob', () => {
    const { seam, sections, listeners, effects } = makeSeam()
    const core = new TokenOptimizationCore(seam)
    expect(core.getStatus()).toEqual({ cleanPrompt: false })
    expect(sections).toHaveLength(0)
    expect(listeners).toHaveLength(0)
    expect(effects).toHaveLength(1)
  })

  test('installs the cleaner listener when cleanPrompt is enabled', () => {
    const { seam, listeners } = makeSeam()
    new TokenOptimizationCore(seam, { cleanPrompt: true })
    expect(listeners).toHaveLength(1)
    expect(listeners[0]?.event).toBe('system-prompt/assemble')
  })
})

describe('setCleanPrompt', () => {
  test('registers and removes the assemble listener', () => {
    const { seam, listeners } = makeSeam()
    const core = new TokenOptimizationCore(seam, { cleanPrompt: false })
    expect(core.setCleanPrompt(true)).toEqual({ cleanPrompt: true })
    expect(listeners).toHaveLength(1)
    core.setCleanPrompt(false)
    expect(listeners).toHaveLength(0)
  })

  test('cleans every assembled section through the listener', async () => {
    const { seam, listeners } = makeSeam()
    new TokenOptimizationCore(seam, { cleanPrompt: true })
    const listener = listeners[0]!.listener
    const result = await listener(emptyAssembly, {}, async () => ({
      sections: [
        { name: 'a', text: 'first  \r\n\r\nsecond  ' },
        { name: 'b', text: 'trailing   ' },
      ],
      contexts: [],
      tools: [],
      variables: {},
    }))
    if (result === undefined) throw new Error('expected an assembly')
    expect(result.sections).toEqual([
      { name: 'a', text: 'first\n\nsecond' },
      { name: 'b', text: 'trailing' },
    ])
  })
})

describe('disposal', () => {
  test('the registered effect disposes the install', () => {
    const { seam, sections, listeners, effects } = makeSeam()
    new TokenOptimizationCore(seam, { cleanPrompt: true })
    expect(sections).toHaveLength(0)
    expect(listeners).toHaveLength(1)
    effects.forEach(dispose => dispose())
    expect(listeners).toHaveLength(0)
  })
})
