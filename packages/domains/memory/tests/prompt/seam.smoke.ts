import {
  PROMPT_MEMORY_SECTION_NAME,
  PROMPT_MEMORY_SECTION_ORDER,
  registerPromptMemorySeam,
} from '../../src/prompt/seam.ts'
import { buildPromptMemorySectionText } from '../../src/prompt/projection.ts'
import { USER_PROMPT_MEMORY_CHAR_LIMIT } from '../../src/prompt/types.ts'

function makeFile(content) {
  return {
    target: null,
    filename: '',
    path: '',
    exists: content.length > 0,
    content,
    entries: [],
    format: 'plain',
    charCount: content.length,
    limit: Infinity,
    overLimit: false,
  }
}

function makeStatus({ soul, brief, user }) {
  return {
    files: {
      soul: makeFile(soul),
      brief: makeFile(brief),
      user: makeFile(user),
    },
  }
}

const sections = []
const listeners = []
const disposers = []
let status = makeStatus({
  soul: 'You are Rin.',
  brief: '',
  user: 'The user prefers TypeScript.',
})

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
    disposers.push(fn)
  },
  promptMemory: {
    async getStatus() {
      return status
    },
  },
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

// 2. section text contains soul and user memory
const initialText = sections[0].text
if (!initialText.includes('You are Rin.')) throw new Error('soul missing from section text')
if (!initialText.includes('The user prefers TypeScript.')) throw new Error('user memory missing from section text')

// 3. assemble listener registered, and it refreshes from the store (fresh content)
if (listeners.length !== 1 || listeners[0].event !== 'system-prompt/assemble') {
  throw new Error('assemble listener not registered')
}
status = makeStatus({ soul: 'You are Rin.', brief: '', user: 'Now the user prefers Rust.' })
const refreshed = await listeners[0].listener(emptyAssembly(), null, async () => emptyAssembly())
if (!refreshed.sections[0].text.includes('Now the user prefers Rust.')) {
  throw new Error('assemble listener did not refresh section text')
}
if (refreshed.sections[0].text.includes('The user prefers TypeScript.')) {
  throw new Error('assemble listener returned stale text')
}

// 4. budget truncation when user memory exceeds its limit
status = makeStatus({
  soul: 'You are Rin.',
  brief: '',
  user: 'x'.repeat(USER_PROMPT_MEMORY_CHAR_LIMIT + 100),
})
const truncated = await listeners[0].listener(emptyAssembly(), null, async () => emptyAssembly())
if (!truncated.sections[0].text.includes('[Truncated USER.md')) {
  throw new Error('budget truncation notice missing')
}

// 5. disposer cleans up the section and listener
if (disposers.length !== 1) throw new Error('expected one effect disposer, got ' + disposers.length)
disposers.forEach(fn => fn())
if (sections.length !== 0) throw new Error('section not removed by disposer')
if (listeners.length !== 0) throw new Error('listener not removed by disposer')

// 6. pure builder honours the component switches
const withAll = buildPromptMemorySectionText(
  makeStatus({ soul: 'S', brief: 'B', user: 'U' }),
  { injectSoul: true, injectBrief: true },
)
if (!withAll.includes('S') || !withAll.includes('B') || !withAll.includes('U')) {
  throw new Error('builder should include soul, brief, and user')
}
const withoutExtras = buildPromptMemorySectionText(
  makeStatus({ soul: 'S', brief: 'B', user: 'U' }),
  { injectSoul: false, injectBrief: false },
)
if (withoutExtras.includes('S')) throw new Error('soul should be omitted when injectSoul=false')
if (withoutExtras.includes('B')) throw new Error('brief should be omitted when injectBrief=false')
if (!withoutExtras.includes('U')) throw new Error('user memory should always be included')

// 7. empty status produces empty text
const empty = buildPromptMemorySectionText(
  makeStatus({ soul: '', brief: '', user: '' }),
  { injectSoul: true, injectBrief: true },
)
if (empty !== '') throw new Error('empty status should produce empty text, got: ' + JSON.stringify(empty))

console.log('PROMPT-MEMORY-SEAM-SMOKE-OK')
