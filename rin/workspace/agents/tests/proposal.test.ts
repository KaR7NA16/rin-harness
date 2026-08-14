import { describe, expect, test } from 'vitest'
import { buildAgentProposalPrompt, parseAgentProposal, proposeAgent } from '../src/proposal.ts'

const fence = String.fromCharCode(96).repeat(3)

describe('parseAgentProposal', () => {
  test('accepts a plain object', () => {
    expect(parseAgentProposal({ name: 'g', description: 'D', systemPrompt: 'S' }).name).toBe('g')
  })

  test('accepts a JSON string', () => {
    expect(parseAgentProposal('{"name":"g","description":"D","systemPrompt":"S"}').description).toBe('D')
  })

  test('accepts a code-fenced string', () => {
    const raw = fence + 'json\n' + '{"name":"g","description":"D","systemPrompt":"S"}' + '\n' + fence
    expect(parseAgentProposal(raw).systemPrompt).toBe('S')
  })

  test('accepts a chat-completion envelope', () => {
    expect(parseAgentProposal({ content: '{"name":"g","description":"D","systemPrompt":"S"}' }).name).toBe('g')
  })

  test('rejects an invalid permissionMode', () => {
    expect(() =>
      parseAgentProposal({ name: 'g', description: 'D', systemPrompt: 'S', permissionMode: 'bogus' }),
    ).toThrow(/permissionMode/)
  })
})

describe('proposeAgent', () => {
  test('passes the prompt to the adapter and validates its result', async () => {
    const prompts: string[] = []
    const proposal = await proposeAgent('a greeter', async (prompt) => {
      prompts.push(prompt)
      return JSON.stringify({ name: 'greeter', description: 'Greets', systemPrompt: 'You greet.', tools: ['bash'] })
    })
    expect(proposal.name).toBe('greeter')
    expect(proposal.tools).toEqual(['bash'])
    expect(prompts[0]).toContain('a greeter')
  })
})

describe('buildAgentProposalPrompt', () => {
  test('embeds the user instructions', () => {
    expect(buildAgentProposalPrompt('write docs')).toContain('write docs')
  })
})
