import {
  PROMPT_MEMORY_SECTION_NAME,
  PROMPT_MEMORY_SECTION_ORDER,
  registerPromptMemorySeam,
} from '../../src/prompt/seam.ts'

/**
 * Strip-types smoke for the canonical prompt-memory seam: the section renders
 * the cognition workspace, refreshes on every assemble, keeps its projection
 * checkpoint clean, and refuses to mount without the canonical surface.
 */

const sections = []
const listeners = []
const disposers = []

let workspaceText = 'You are Rin.\nThe user prefers TypeScript.'
let workspaceHash = 'ws-hash-1'
let checkpointCalls = []

function makeMemorySurface() {
  return {
    recall: async () => ({
      workspace: {
        schemaVersion: 2,
        cycleId: 'smoke-cycle-' + workspaceHash,
        materializedVersion: 1,
        query: {},
        budget: { maxItems: 4, maxTokens: 600, usedItems: 1, usedTokens: 40 },
        currentField: undefined,
        items: [{
          id: 'scene-1',
          role: 'support',
          memory: undefined,
          external: { content: workspaceText },
          epistemic: 'observed',
          influence: 'permitted',
          confidence: 0.9,
          score: 0.5,
          scoreBreakdown: { cueFit: 0.1, contextualFit: 0.1, accessibility: 0.1, salience: 0.1, utility: 0, openLoopPressure: 0, relationRelevance: 0, predictionRelevance: 0, inhibition: 0, contradictionCost: 0, uncertaintyPenalty: 0, invalidityPenalty: 0, total: 0.5 },
          uncertainty: [],
          selectionReasons: ['smoke'],
        }],
        links: [],
        uncertainty: [],
        hash: workspaceHash,
      },
      trace: { candidates: [], selectedIds: ['scene-1'] },
    }),
    readCognitionState: () => ({ version: 1, memories: [] }),
    getProjectionCheckpoint: () => ({ status: 'dirty', materializedVersion: 0, stateHash: 'stale' }),
    requireProjectionReady: () => {
      checkpointCalls.push('require')
      return { status: 'clean', materializedVersion: 1, stateHash: workspaceHash }
    },
    markProjectionDirty: () => ({ status: 'dirty' }),
    markProjectionCleanAtCurrent: (projection, version, hash) => {
      checkpointCalls.push({ projection, version, hash })
      return { status: 'clean', materializedVersion: version, stateHash: hash }
    },
  }
}

const fakeSeam = {
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
      const at = listeners.findIndex(entry => entry.listener === listener)
      if (at >= 0) listeners.splice(at, 1)
    }
  },
  effect(fn) {
    const disposer = fn()
    if (typeof disposer === 'function') disposers.push(disposer)
  },
  memory: makeMemorySurface(),
}

const emptyAssembly = () => ({
  sections: [{ name: PROMPT_MEMORY_SECTION_NAME, text: '' }],
  contexts: [],
  tools: [],
  variables: {},
})

await registerPromptMemorySeam(fakeSeam, { injectSoul: true, injectBrief: true })

// 1. section registered exactly once with the right name and order
if (sections.length !== 1) throw new Error('expected one section, got ' + sections.length)
if (sections[0].name !== PROMPT_MEMORY_SECTION_NAME) throw new Error('wrong section name: ' + sections[0].name)
if (sections[0].order !== PROMPT_MEMORY_SECTION_ORDER) throw new Error('wrong section order: ' + sections[0].order)

// 2. section text renders the canonical cognition workspace
const initialText = sections[0].text
if (!initialText.includes('You are Rin.')) throw new Error('workspace content missing from section text')
if (!initialText.includes('The user prefers TypeScript.')) throw new Error('user memory missing from section text')

// 3. assemble listener registered, and it re-renders the refreshed workspace
if (listeners.length !== 1 || listeners[0].event !== 'system-prompt/assemble') {
  throw new Error('assemble listener not registered')
}
workspaceText = 'You are Rin.\nNow the user prefers Rust.'
workspaceHash = 'ws-hash-2'
const refreshed = await listeners[0].listener(emptyAssembly(), null, async () => emptyAssembly())
if (!refreshed.sections[0].text.includes('Now the user prefers Rust.')) {
  throw new Error('assemble listener did not refresh section text')
}
if (refreshed.sections[0].text.includes('The user prefers TypeScript.')) {
  throw new Error('assemble listener returned stale text')
}

// 4. the projection checkpoint was repaired toward the fresh workspace hash
const repairs = checkpointCalls.filter(entry => typeof entry === 'object')
if (repairs.length === 0) throw new Error('checkpoint repair was not invoked')
if (!repairs.every(entry => entry.projection === 'prompt-memory')) throw new Error('checkpoint repair targeted the wrong projection')
if (!repairs.some(entry => entry.hash === 'ws-hash-2')) throw new Error('checkpoint repair did not bind the fresh workspace hash')

// 5. disposer cleans up the section and listener
if (disposers.length !== 1) throw new Error('expected one effect disposer, got ' + disposers.length)
disposers.forEach(fn => fn())
if (sections.length !== 0) throw new Error('section not removed by disposer')
if (listeners.length !== 0) throw new Error('listener not removed by disposer')

// 6. the seam refuses to mount without the canonical cognition surface
let rejected = false
try {
  await registerPromptMemorySeam({
    systemPrompt: { section: () => () => {} },
    on: () => () => {},
    effect: () => {},
    memory: {},
  }, { injectSoul: true, injectBrief: true })
} catch (error) {
  rejected = String(error).includes('canonical cognition surface is required')
}
if (!rejected) throw new Error('seam must reject a missing canonical cognition surface')

console.log('PROMPT-MEMORY-SEAM-SMOKE-OK')
