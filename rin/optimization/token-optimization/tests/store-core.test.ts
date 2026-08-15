import { describe, expect, test } from 'vitest'
import { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from '../src/prompts.ts'
import {
  SECTION_NAME,
  SECTION_ORDER,
  TokenOptimizationCore,
  validateResponseStyle,
  type PromptAssembly,
  type TokenOptimizationSeam,
} from '../src/store-core.ts'

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

describe('validateResponseStyle', () => {
  test('accepts every known style', () => {
    expect(validateResponseStyle('off')).toBe('off')
    expect(validateResponseStyle('caveman')).toBe('caveman')
    expect(validateResponseStyle('ponytail')).toBe('ponytail')
  })

  test('rejects an unknown style', () => {
    expect(() => validateResponseStyle('bogus')).toThrow(/responseStyle must be off, caveman, or ponytail/)
  })
})

describe('TokenOptimizationCore construction', () => {
  test('installs nothing for the default off/disabled knobs', () => {
    const { seam, sections, listeners, effects } = makeSeam()
    const core = new TokenOptimizationCore(seam)
    expect(core.getStatus()).toEqual({ responseStyle: 'off', cleanPrompt: false })
    expect(sections).toHaveLength(0)
    expect(listeners).toHaveLength(0)
    expect(effects).toHaveLength(1)
  })

  test('installs the caveman section when configured', () => {
    const { seam, sections } = makeSeam()
    new TokenOptimizationCore(seam, { responseStyle: 'caveman' })
    expect(sections).toEqual([{ name: SECTION_NAME, order: SECTION_ORDER, text: CAVEMAN_PROMPT }])
  })

  test('installs the ponytail section when configured', () => {
    const { seam, sections } = makeSeam()
    new TokenOptimizationCore(seam, { responseStyle: 'ponytail' })
    expect(sections).toEqual([{ name: SECTION_NAME, order: SECTION_ORDER, text: PONYTAIL_PROMPT }])
  })

  test('installs the cleaner listener when cleanPrompt is enabled', () => {
    const { seam, listeners } = makeSeam()
    new TokenOptimizationCore(seam, { cleanPrompt: true })
    expect(listeners).toHaveLength(1)
    expect(listeners[0]?.event).toBe('system-prompt/assemble')
  })

  test('rejects an invalid configured style', () => {
    const { seam } = makeSeam()
    expect(() => new TokenOptimizationCore(seam, { responseStyle: 'bogus' as 'off' })).toThrow()
  })
})

describe('setResponseStyle', () => {
  test('swaps sections without duplicating them', () => {
    const { seam, sections } = makeSeam()
    const core = new TokenOptimizationCore(seam, { responseStyle: 'off' })
    expect(core.setResponseStyle('caveman')).toEqual({ responseStyle: 'caveman', cleanPrompt: false })
    expect(sections.map(section => section.text)).toEqual([CAVEMAN_PROMPT])
    core.setResponseStyle('ponytail')
    expect(sections.map(section => section.text)).toEqual([PONYTAIL_PROMPT])
    core.setResponseStyle('off')
    expect(sections).toHaveLength(0)
  })
})

describe('setCleanPrompt', () => {
  test('registers and removes the assemble listener', () => {
    const { seam, listeners } = makeSeam()
    const core = new TokenOptimizationCore(seam, { cleanPrompt: false })
    expect(core.setCleanPrompt(true)).toEqual({ responseStyle: 'off', cleanPrompt: true })
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
  test('the registered effect disposes both installs', () => {
    const { seam, sections, listeners, effects } = makeSeam()
    new TokenOptimizationCore(seam, { responseStyle: 'ponytail', cleanPrompt: true })
    expect(sections).toHaveLength(1)
    expect(listeners).toHaveLength(1)
    effects.forEach(dispose => dispose())
    expect(sections).toHaveLength(0)
    expect(listeners).toHaveLength(0)
  })
})
