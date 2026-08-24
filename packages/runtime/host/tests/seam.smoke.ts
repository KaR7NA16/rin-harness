/**
 * @rin/host — evolution reviewModel seam strip-types smoke.
 *
 * Reads src/cordis.yml, extracts the evolution row's reviewModel !!js
 * expression, evaluates it against a fake context exactly as the Loader does
 * (with(ctx){ eval(expr) }), and drives the adapter through a fake llm seam.
 * Verifies the adapter sends a well-formed user message (content is text
 * blocks, not a raw string), routes provider/model correctly, joins text-delta
 * chunks, and fails loud on a missing llm seam, no provider, or an error
 * finish chunk.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/seam.smoke.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

// Replicate the loader's YAML dialect: !!js scalars become { __jsExpr } nodes.
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

// Replicate the loader's expression evaluation scope (vendor/loader utils.ts).
const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')

const cordisPath = fileURLToPath(new URL('../src/cordis.yml', import.meta.url))
const rows = yaml.load(readFileSync(cordisPath, 'utf8'), { schema })
const evolution = rows.find((row) => row.id === 'evolution')
if (!evolution) throw new Error('cordis.yml must declare an evolution row')
const expr = evolution.config?.reviewModel?.__jsExpr
if (typeof expr !== 'string') throw new Error('evolution reviewModel must be a !!js expression')

/** Build a fake llm seam whose stream() records the call and yields chunks. */
function fakeLlm(chunks) {
  const calls = []
  return {
    calls,
    listProviders: () => [{ id: 'fake-provider', name: 'Fake' }],
    stream: async function* (options) {
      calls.push(options)
      for (const chunk of chunks) yield chunk
    },
  }
}

// 1. Adapter joins text-delta chunks and passes a well-formed user message.
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: 'Hello' },
    { type: 'text-delta', index: 0, text: ' World' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const reviewModel = evaluate({ get: (name) => (name === 'llm' ? llm : undefined) }, expr)
  const result = await reviewModel('the prompt', 'the-model')
  if (result !== 'Hello World') throw new Error('adapter must join text-delta chunks, got: ' + JSON.stringify(result))
  const call = llm.calls[0]
  if (!call) throw new Error('adapter must call llm.stream once')
  if (call.provider !== 'fake-provider') throw new Error('adapter must route the first registered provider')
  if (call.model !== 'the-model') throw new Error('adapter must pass the requested model')
  const message = call.messages?.[0]
  if (!message || message.role !== 'user') throw new Error('adapter must send one user-role message')
  if (!Array.isArray(message.content)) throw new Error('message content must be content blocks, not a raw string')
  if (message.content.length !== 1 || message.content[0].type !== 'text' || message.content[0].text !== 'the prompt') {
    throw new Error('message content must be a single text block carrying the prompt')
  }
  if (message.source?.kind !== 'user') throw new Error('message source must be user')
}

// 2. Missing llm seam fails loud.
{
  const reviewModel = evaluate({ get: () => undefined }, expr)
  let threw = false
  try { await reviewModel('p', 'm') } catch { threw = true }
  if (!threw) throw new Error('adapter must throw when the llm seam is absent')
}

// 3. No registered provider fails loud.
{
  const llm = fakeLlm([])
  llm.listProviders = () => []
  const reviewModel = evaluate({ get: (name) => (name === 'llm' ? llm : undefined) }, expr)
  let threw = false
  try { await reviewModel('p', 'm') } catch { threw = true }
  if (!threw) throw new Error('adapter must throw when no provider is registered')
}

// 4. Provider error finish chunk fails loud instead of returning an empty string.
{
  const llm = fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500', code: 'HTTP' } } }])
  const reviewModel = evaluate({ get: (name) => (name === 'llm' ? llm : undefined) }, expr)
  let threw = false
  try { await reviewModel('p', 'm') } catch { threw = true }
  if (!threw) throw new Error('adapter must throw on an error finish chunk')
}

console.log('BUNDLE-REVIEW-MODEL-SMOKE-OK', { expressionLength: expr.length })
